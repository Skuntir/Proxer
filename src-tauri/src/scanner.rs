use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};

use crate::{
    error::Result,
    events::{now_ms, BackendEvent, EventBus},
    http_types::HeaderPair,
    storage::StoreHandle,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiVulnerability {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub path: String,
    pub host: String,
    pub description: String,
    pub remediation: String,
    pub confidence: String,
    pub cvss: Option<String>,
    pub cwe: Option<String>,
    pub requests: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub running: bool,
    pub scan_id: Option<String>,
    pub progress_done: i64,
    pub progress_total: i64,
}

struct RunningScan {
    scan_id: String,
    stop: oneshot::Sender<()>,
    progress_done: Arc<Mutex<i64>>,
    progress_total: Arc<Mutex<i64>>,
}

pub struct ScannerManager {
    store: StoreHandle,
    events: EventBus,
    running: Arc<Mutex<Option<RunningScan>>>,
}

impl ScannerManager {
    pub fn new(store: StoreHandle, events: EventBus) -> Self {
        Self {
            store,
            events,
            running: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start(&self, limit: u32) -> Result<String> {
        let mut lock = self.running.lock().await;
        if let Some(r) = lock.as_ref() {
            return Ok(r.scan_id.clone());
        }

        let scan_id = format!("scan-{}", uuid::Uuid::new_v4());
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let store = self.store.get();
        let passive_plus_enabled = store.extension_enabled("ext.passive-scanner").await.unwrap_or(false);
        let events = self.events.clone();
        let progress_done = Arc::new(Mutex::new(0));
        let progress_total = Arc::new(Mutex::new(0));
        let pd = progress_done.clone();
        let pt = progress_total.clone();

        events.emit(BackendEvent::ScanStarted {
            ts_ms: now_ms(),
            scan_id: scan_id.clone(),
        });

        let running_ref = self.running.clone();
        let scan_id_for_task = scan_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut offset: u32 = 0;
            let mut done: i64 = 0;
            let mut total: i64 = 0;

            loop {
                tokio::select! {
                    _ = &mut stop_rx => {
                        events.emit(BackendEvent::ScanCompleted { ts_ms: now_ms(), scan_id: scan_id_for_task.clone() });
                        let mut lock = running_ref.lock().await;
                        *lock = None;
                        return;
                    }
                    page = store.traffic_scan_rows(500, offset) => {
                        let Ok(rows) = page else {
                            events.emit(BackendEvent::ScanCompleted { ts_ms: now_ms(), scan_id: scan_id_for_task.clone() });
                            let mut lock = running_ref.lock().await;
                            *lock = None;
                            return;
                        };
                        if rows.is_empty() || done as u32 >= limit {
                            events.emit(BackendEvent::ScanCompleted { ts_ms: now_ms(), scan_id: scan_id_for_task.clone() });
                            let mut lock = running_ref.lock().await;
                            *lock = None;
                            return;
                        }

                        total += rows.len() as i64;
                        {
                            let mut l = pt.lock().await;
                            *l = total;
                        }

                        for (_id, started_ms, scheme, host, url, _status, _req_headers, resp_headers_json) in rows {
                            done += 1;
                            {
                                let mut l = pd.lock().await;
                                *l = done;
                            }
                            if done as u32 > limit {
                                events.emit(BackendEvent::ScanCompleted { ts_ms: now_ms(), scan_id: scan_id_for_task.clone() });
                                let mut lock = running_ref.lock().await;
                                *lock = None;
                                return;
                            }

                            let path = url::Url::parse(&url)
                                .ok()
                                .map(|u| u.path().to_string())
                                .unwrap_or_else(|| "/".to_string());
                            let resp_headers: Vec<HeaderPair> = resp_headers_json
                                .and_then(|s| serde_json::from_str::<Vec<HeaderPair>>(&s).ok())
                                .unwrap_or_default();

                            let findings = passive_checks(&scheme, &host, &path, &resp_headers, passive_plus_enabled);
                            for f in findings {
                                let _ = store.vulnerabilities_upsert(
                                    &f.id,
                                    started_ms,
                                    &f.severity,
                                    &f.title,
                                    &f.host,
                                    &f.path,
                                    &f.description,
                                    &f.remediation,
                                    &f.confidence,
                                    f.cvss.as_deref(),
                                    f.cwe.as_deref(),
                                    f.requests,
                                ).await;
                                events.emit(BackendEvent::ScanFinding { ts_ms: now_ms(), scan_id: scan_id_for_task.clone(), finding: f });
                            }

                            events.emit(BackendEvent::ScanProgress {
                                ts_ms: now_ms(),
                                scan_id: scan_id_for_task.clone(),
                                done,
                                total,
                            });
                        }

                        offset = offset.saturating_add(500);
                    }
                }
            }
        });

        *lock = Some(RunningScan {
            scan_id: scan_id.clone(),
            stop: stop_tx,
            progress_done,
            progress_total,
        });

        Ok(scan_id)
    }

    pub async fn stop(&self) -> Result<()> {
        let mut lock = self.running.lock().await;
        let Some(r) = lock.take() else {
            return Ok(());
        };
        let _ = r.stop.send(());
        Ok(())
    }

    pub async fn status(&self) -> ScanStatus {
        let lock = self.running.lock().await;
        match lock.as_ref() {
            Some(r) => {
                let done = *r.progress_done.lock().await;
                let total = *r.progress_total.lock().await;
                ScanStatus {
                    running: true,
                    scan_id: Some(r.scan_id.clone()),
                    progress_done: done,
                    progress_total: total,
                }
            }
            None => ScanStatus {
                running: false,
                scan_id: None,
                progress_done: 0,
                progress_total: 0,
            },
        }
    }

    pub async fn findings_list(&self, severity: Option<String>, limit: u32, offset: u32) -> Result<Vec<UiVulnerability>> {
        let sev = severity.map(|s| normalize_severity(&s));
        let store = self.store.get();
        let rows = store.vulnerabilities_list(sev.as_deref(), limit, offset).await?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, _ts_ms, severity, title, host, path, description, remediation, confidence, cvss, cwe, requests) in rows {
            out.push(UiVulnerability {
                id,
                severity,
                title,
                path,
                host,
                description,
                remediation,
                confidence,
                cvss,
                cwe,
                requests,
            });
        }
        Ok(out)
    }
}

fn normalize_severity(s: &str) -> String {
    match s.to_ascii_lowercase().as_str() {
        "critical" => "Critical".into(),
        "high" => "High".into(),
        "medium" => "Medium".into(),
        "low" => "Low".into(),
        _ => "Info".into(),
    }
}

fn header_get(headers: &[HeaderPair], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
}

fn passive_checks(scheme: &str, host: &str, path: &str, resp_headers: &[HeaderPair], passive_plus_enabled: bool) -> Vec<UiVulnerability> {
    let mut out = Vec::new();

    if scheme.eq_ignore_ascii_case("https") && header_get(resp_headers, "strict-transport-security").is_none() {
        out.push(UiVulnerability {
            id: format!("vuln:hsts-missing:{host}:{path}"),
            severity: "Info".into(),
            title: "Missing Strict-Transport-Security".into(),
            host: host.to_string(),
            path: path.to_string(),
            description: "The response over HTTPS does not include the Strict-Transport-Security header.".into(),
            remediation: "Add the Strict-Transport-Security header to enforce HTTPS for subsequent requests.".into(),
            confidence: "Firm".into(),
            cvss: None,
            cwe: Some("CWE-319".into()),
            requests: 1,
        });
    }

    if header_get(resp_headers, "x-content-type-options").is_none() {
        out.push(UiVulnerability {
            id: format!("vuln:xcto-missing:{host}:{path}"),
            severity: "Low".into(),
            title: "Missing X-Content-Type-Options".into(),
            host: host.to_string(),
            path: path.to_string(),
            description: "The response does not include the X-Content-Type-Options header.".into(),
            remediation: "Add X-Content-Type-Options: nosniff to prevent MIME-type sniffing.".into(),
            confidence: "Firm".into(),
            cvss: None,
            cwe: Some("CWE-16".into()),
            requests: 1,
        });
    }

    if header_get(resp_headers, "x-frame-options").is_none() {
        out.push(UiVulnerability {
            id: format!("vuln:xfo-missing:{host}:{path}"),
            severity: "Low".into(),
            title: "Missing X-Frame-Options".into(),
            host: host.to_string(),
            path: path.to_string(),
            description: "The response does not include the X-Frame-Options header.".into(),
            remediation: "Add X-Frame-Options: DENY or SAMEORIGIN to mitigate clickjacking.".into(),
            confidence: "Firm".into(),
            cvss: None,
            cwe: Some("CWE-1021".into()),
            requests: 1,
        });
    }

    if let Some(server) = header_get(resp_headers, "server") {
        if server.chars().any(|c| c.is_ascii_digit()) {
            out.push(UiVulnerability {
                id: format!("vuln:server-version:{host}:{path}"),
                severity: "Info".into(),
                title: "Server version disclosure".into(),
                host: host.to_string(),
                path: path.to_string(),
                description: format!("The Server header appears to disclose a version: {server}"),
                remediation: "Configure the server to remove or generalize the Server header.".into(),
                confidence: "Tentative".into(),
                cvss: None,
                cwe: Some("CWE-200".into()),
                requests: 1,
            });
        }
    }

    if passive_plus_enabled {
        if header_get(resp_headers, "content-security-policy").is_none() {
            out.push(UiVulnerability {
                id: format!("vuln:csp-missing:{host}:{path}"),
                severity: "Medium".into(),
                title: "Missing Content-Security-Policy".into(),
                host: host.to_string(),
                path: path.to_string(),
                description: "The response does not include a Content-Security-Policy header.".into(),
                remediation: "Add a restrictive Content-Security-Policy header to reduce XSS and injection impact.".into(),
                confidence: "Firm".into(),
                cvss: None,
                cwe: Some("CWE-693".into()),
                requests: 1,
            });
        }

        if header_get(resp_headers, "referrer-policy").is_none() {
            out.push(UiVulnerability {
                id: format!("vuln:referrer-policy-missing:{host}:{path}"),
                severity: "Low".into(),
                title: "Missing Referrer-Policy".into(),
                host: host.to_string(),
                path: path.to_string(),
                description: "The response does not include a Referrer-Policy header.".into(),
                remediation: "Add Referrer-Policy, for example strict-origin-when-cross-origin.".into(),
                confidence: "Firm".into(),
                cvss: None,
                cwe: Some("CWE-200".into()),
                requests: 1,
            });
        }

        if header_get(resp_headers, "permissions-policy").is_none() {
            out.push(UiVulnerability {
                id: format!("vuln:permissions-policy-missing:{host}:{path}"),
                severity: "Info".into(),
                title: "Missing Permissions-Policy".into(),
                host: host.to_string(),
                path: path.to_string(),
                description: "The response does not include a Permissions-Policy header.".into(),
                remediation: "Add Permissions-Policy to limit browser features that pages may use.".into(),
                confidence: "Tentative".into(),
                cvss: None,
                cwe: Some("CWE-16".into()),
                requests: 1,
            });
        }
    }

    out
}
