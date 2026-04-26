use std::sync::Arc;

use http::header::HeaderName;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    events::{now_ms, BackendEvent, EventBus},
    storage::SqliteStore,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntruderStartRequest {
    pub attack_type: String,
    pub template_raw: String,
    pub payloads: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntruderStartResponse {
    pub attack_id: String,
    pub positions: i64,
    pub payload_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiIntruderResult {
    pub id: String,
    pub ts_ms: i64,
    pub seq: i64,
    pub status_code: Option<i64>,
    pub duration_ms: Option<i64>,
    pub size: Option<i64>,
    pub error: Option<String>,
}

struct RunningAttack {
    attack_id: String,
    stop: oneshot::Sender<()>,
}

pub struct IntruderManager {
    store: Arc<SqliteStore>,
    events: EventBus,
    running: Arc<Mutex<Option<RunningAttack>>>,
}

impl IntruderManager {
    pub fn new(store: Arc<SqliteStore>, events: EventBus) -> Self {
        Self {
            store,
            events,
            running: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start(&self, req: IntruderStartRequest) -> Result<IntruderStartResponse> {
        let mut lock = self.running.lock().await;
        if let Some(r) = lock.as_ref() {
            return Ok(IntruderStartResponse {
                attack_id: r.attack_id.clone(),
                positions: 0,
                payload_count: 0,
            });
        }

        if req.payloads.is_empty() {
            return Err(AppError::InvalidInput("no payloads provided".into()));
        }

        let markers = extract_markers(&req.template_raw);
        if markers.is_empty() {
            return Err(AppError::InvalidInput("no §markers§ found in template".into()));
        }

        let attack_id = format!("attack-{}", Uuid::new_v4());
        let started_ms = now_ms();
        let config_json = serde_json::to_string(&req).unwrap_or_else(|_| "{}".into());
        self.store
            .intruder_attack_insert(&attack_id, started_ms, "running", &req.template_raw, &config_json)
            .await?;

        let (stop_tx, mut stop_rx) = oneshot::channel();
        let store = self.store.clone();
        let events = self.events.clone();
        let attack_id_for_task = attack_id.clone();
        let running_ref = self.running.clone();
        let template = req.template_raw.clone();
        let payloads = req.payloads.clone();

        events.emit(BackendEvent::IntruderStarted {
            ts_ms: started_ms,
            attack_id: attack_id.clone(),
        });

        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::limited(10))
                .build()
            {
                Ok(c) => c,
                Err(_) => reqwest::Client::new(),
            };

            let total = payloads.len() as i64;
            for (idx, payload) in payloads.iter().enumerate() {
                tokio::select! {
                    _ = &mut stop_rx => {
                        let _ = store.intruder_attack_update_status(&attack_id_for_task, "stopped").await;
                        events.emit(BackendEvent::IntruderCompleted { ts_ms: now_ms(), attack_id: attack_id_for_task.clone() });
                        let mut lock = running_ref.lock().await;
                        *lock = None;
                        return;
                    }
                    _ = async {} => {}
                }

                let raw_req = apply_payload_all(&template, payload);
                let parsed = match parse_raw_http_request(&raw_req) {
                    Ok(p) => p,
                    Err(e) => {
                        let id = Uuid::new_v4().to_string();
                        let ts = now_ms();
                        let _ = store
                            .intruder_result_insert(
                                &id,
                                &attack_id_for_task,
                                ts,
                                idx as i64,
                                None,
                                None,
                                None,
                                Some(&e.to_string()),
                                &raw_req,
                                None,
                            )
                            .await;
                        events.emit(BackendEvent::IntruderResult {
                            ts_ms: ts,
                            attack_id: attack_id_for_task.clone(),
                            result: UiIntruderResult {
                                id,
                                ts_ms: ts,
                                seq: idx as i64,
                                status_code: None,
                                duration_ms: None,
                                size: None,
                                error: Some(e.to_string()),
                            },
                        });
                        continue;
                    }
                };

                let start = std::time::Instant::now();
                let mut rb = client.request(parsed.method, parsed.url);
                for (k, v) in parsed.headers {
                    rb = rb.header(k, v);
                }
                if !parsed.body.is_empty() {
                    rb = rb.body(parsed.body);
                }

                let (status_code, duration_ms, size, error, raw_resp) = match rb.send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        let status_code = status.as_u16() as i64;
                        let reason = status.canonical_reason().unwrap_or("");
                        let headers = resp.headers().clone();
                        let body_bytes = resp.bytes().await.unwrap_or_default();
                        let dur = start.elapsed().as_millis() as i64;

                        let mut raw = format!("HTTP/1.1 {} {}\r\n", status_code, reason);
                        for (k, v) in headers.iter() {
                            if let Ok(vs) = v.to_str() {
                                raw.push_str(k.as_str());
                                raw.push_str(": ");
                                raw.push_str(vs);
                                raw.push_str("\r\n");
                            }
                        }
                        raw.push_str("\r\n");
                        raw.push_str(&String::from_utf8_lossy(&body_bytes));

                        (
                            Some(status_code),
                            Some(dur),
                            Some(body_bytes.len() as i64),
                            None,
                            Some(raw),
                        )
                    }
                    Err(e) => (None, Some(start.elapsed().as_millis() as i64), None, Some(e.to_string()), None),
                };

                let id = Uuid::new_v4().to_string();
                let ts = now_ms();
                let _ = store
                    .intruder_result_insert(
                        &id,
                        &attack_id_for_task,
                        ts,
                        idx as i64,
                        status_code,
                        duration_ms,
                        size,
                        error.as_deref(),
                        &raw_req,
                        raw_resp.as_deref(),
                    )
                    .await;

                events.emit(BackendEvent::IntruderResult {
                    ts_ms: ts,
                    attack_id: attack_id_for_task.clone(),
                    result: UiIntruderResult {
                        id,
                        ts_ms: ts,
                        seq: idx as i64,
                        status_code,
                        duration_ms,
                        size,
                        error,
                    },
                });

                events.emit(BackendEvent::IntruderProgress {
                    ts_ms: ts,
                    attack_id: attack_id_for_task.clone(),
                    done: (idx as i64) + 1,
                    total,
                });
            }

            let _ = store.intruder_attack_update_status(&attack_id_for_task, "completed").await;
            events.emit(BackendEvent::IntruderCompleted { ts_ms: now_ms(), attack_id: attack_id_for_task.clone() });
            let mut lock = running_ref.lock().await;
            *lock = None;
        });

        *lock = Some(RunningAttack {
            attack_id: attack_id.clone(),
            stop: stop_tx,
        });

        Ok(IntruderStartResponse {
            attack_id,
            positions: markers.len() as i64,
            payload_count: req.payloads.len() as i64,
        })
    }

    pub async fn stop(&self) -> Result<()> {
        let mut lock = self.running.lock().await;
        if let Some(r) = lock.take() {
            let _ = r.stop.send(());
        }
        Ok(())
    }

    pub async fn results_list(&self, attack_id: String, limit: u32, offset: u32) -> Result<Vec<UiIntruderResult>> {
        let rows = self.store.intruder_results_list(&attack_id, limit, offset).await?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, ts_ms, seq, status_code, duration_ms, size, error, _raw_request, _raw_response) in rows {
            out.push(UiIntruderResult {
                id,
                ts_ms,
                seq,
                status_code,
                duration_ms,
                size,
                error,
            });
        }
        Ok(out)
    }
}

fn extract_markers(template: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find('§') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('§') else {
            break;
        };
        let name = &after[..end];
        if !name.is_empty() && !out.contains(&name.to_string()) {
            out.push(name.to_string());
        }
        rest = &after[end + 1..];
    }
    out
}

fn apply_payload_all(template: &str, payload: &str) -> String {
    let mut out = String::with_capacity(template.len() + payload.len());
    let mut rest = template;
    loop {
        let Some(start) = rest.find('§') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('§') else {
            out.push_str(&rest[start..]);
            break;
        };
        out.push_str(payload);
        rest = &after[end + 1..];
    }
    out
}

struct ParsedRawRequest {
    method: reqwest::Method,
    url: url::Url,
    headers: Vec<(HeaderName, String)>,
    body: Vec<u8>,
}

fn parse_raw_http_request(raw: &str) -> Result<ParsedRawRequest> {
    let raw = raw.replace("\r\n", "\n");
    let (head, body) = raw.split_once("\n\n").unwrap_or((&raw, ""));
    let mut lines = head.lines();
    let start = lines.next().unwrap_or_default().trim();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let target = parts.next().unwrap_or("/");

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| AppError::InvalidInput("invalid method".into()))?;

    let mut headers: Vec<(HeaderName, String)> = Vec::new();
    let mut host_hdr: Option<String> = None;
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim().to_string();
        if key.eq_ignore_ascii_case("host") {
            host_hdr = Some(val.clone());
        }
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| AppError::InvalidInput("invalid header name".into()))?;
        headers.push((name, val));
    }

    let url = if target.starts_with("http://") || target.starts_with("https://") {
        url::Url::parse(target).map_err(|_| AppError::InvalidInput("invalid URL".into()))?
    } else {
        let host = host_hdr.ok_or_else(|| AppError::InvalidInput("missing Host header".into()))?;
        let base = format!("http://{host}");
        let base = url::Url::parse(&base).map_err(|_| AppError::InvalidInput("invalid Host header".into()))?;
        base.join(target)
            .map_err(|_| AppError::InvalidInput("invalid request target".into()))?
    };

    Ok(ParsedRawRequest {
        method,
        url,
        headers,
        body: body.as_bytes().to_vec(),
    })
}
