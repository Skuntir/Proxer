use std::sync::Arc;

use http::header::HeaderName;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    events::{now_ms, BackendEvent, EventBus},
    storage::StoreHandle,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntruderStartRequest {
    pub attack_type: String,
    pub template_raw: String,
    pub payloads: Vec<String>,
    #[serde(default)]
    pub payload_sets: Vec<Vec<String>>,
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
    store: StoreHandle,
    events: EventBus,
    running: Arc<Mutex<Option<RunningAttack>>>,
}

impl IntruderManager {
    pub fn new(store: StoreHandle, events: EventBus) -> Self {
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

        let attack_type = req.attack_type.trim().to_ascii_lowercase();
        let payload_sets = if !req.payload_sets.is_empty() {
            req.payload_sets.clone()
        } else {
            vec![req.payloads.clone()]
        };
        if payload_sets.iter().all(|s| s.is_empty()) {
            return Err(AppError::InvalidInput("no payloads provided".into()));
        }

        let markers = extract_markers(&req.template_raw);
        if markers.is_empty() {
            return Err(AppError::InvalidInput("no §markers§ found in template".into()));
        }

        let template = req.template_raw.clone();
        let raw_requests: Vec<String> = match attack_type.as_str() {
            "sniper" => {
                let payloads = payload_sets.first().cloned().unwrap_or_default();
                if payloads.is_empty() {
                    return Err(AppError::InvalidInput("no payloads provided".into()));
                }
                let mut out = Vec::with_capacity(payloads.len() * markers.len());
                for m in &markers {
                    for p in &payloads {
                        let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
                        map.insert(m.clone(), p.clone());
                        out.push(apply_payload_map(&template, &map));
                    }
                }
                out
            }
            "pitchfork" => {
                if payload_sets.len() != markers.len() {
                    return Err(AppError::InvalidInput(format!(
                        "pitchfork requires {} payload sets (separated by blank lines)",
                        markers.len()
                    )));
                }
                if payload_sets.iter().any(|s| s.is_empty()) {
                    return Err(AppError::InvalidInput("one or more payload sets are empty".into()));
                }
                let total = payload_sets.iter().map(|s| s.len()).min().unwrap_or(0);
                if total == 0 {
                    return Err(AppError::InvalidInput("no payloads provided".into()));
                }
                let mut out = Vec::with_capacity(total);
                for i in 0..total {
                    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
                    for (pos, m) in markers.iter().enumerate() {
                        map.insert(m.clone(), payload_sets[pos][i].clone());
                    }
                    out.push(apply_payload_map(&template, &map));
                }
                out
            }
            "cluster-bomb" | "clusterbomb" => {
                if payload_sets.len() != markers.len() {
                    return Err(AppError::InvalidInput(format!(
                        "cluster bomb requires {} payload sets (separated by blank lines)",
                        markers.len()
                    )));
                }
                if payload_sets.iter().any(|s| s.is_empty()) {
                    return Err(AppError::InvalidInput("one or more payload sets are empty".into()));
                }
                let cap: usize = 5000;
                let mut total: usize = 1;
                for s in &payload_sets {
                    total = total.saturating_mul(s.len());
                    if total > cap {
                        return Err(AppError::InvalidInput(format!(
                            "cluster bomb expands to too many requests ({total}); reduce payloads"
                        )));
                    }
                }
                let mut idxs = vec![0usize; markers.len()];
                let mut out = Vec::with_capacity(total);
                loop {
                    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
                    for (pos, m) in markers.iter().enumerate() {
                        map.insert(m.clone(), payload_sets[pos][idxs[pos]].clone());
                    }
                    out.push(apply_payload_map(&template, &map));
                    let mut carry = true;
                    for pos in (0..idxs.len()).rev() {
                        if !carry {
                            break;
                        }
                        idxs[pos] += 1;
                        if idxs[pos] >= payload_sets[pos].len() {
                            idxs[pos] = 0;
                            carry = true;
                        } else {
                            carry = false;
                        }
                    }
                    if carry {
                        break;
                    }
                }
                out
            }
            _ => {
                let payloads = payload_sets.first().cloned().unwrap_or_default();
                if payloads.is_empty() {
                    return Err(AppError::InvalidInput("no payloads provided".into()));
                }
                payloads.iter().map(|p| apply_payload_all(&template, p)).collect()
            }
        };
        let payload_count = raw_requests.len() as i64;

        let attack_id = format!("attack-{}", Uuid::new_v4());
        let started_ms = now_ms();
        let config_json = serde_json::to_string(&req).unwrap_or_else(|_| "{}".into());
        let store = self.store.get();
        store
            .intruder_attack_insert(&attack_id, started_ms, "running", &req.template_raw, &config_json)
            .await?;

        let (stop_tx, mut stop_rx) = oneshot::channel();
        let store = store.clone();
        let events = self.events.clone();
        let attack_id_for_task = attack_id.clone();
        let running_ref = self.running.clone();
        let raw_requests_for_task = raw_requests.clone();

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

            let total = raw_requests_for_task.len() as i64;
            for (idx, raw_req) in raw_requests_for_task.iter().enumerate() {
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
            payload_count,
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
        let store = self.store.get();
        let rows = store.intruder_results_list(&attack_id, limit, offset).await?;
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
    let mark_len = '§'.len_utf8();
    while let Some(start) = rest.find('§') {
        let after = &rest[start + mark_len..];
        let Some(end) = after.find('§') else {
            break;
        };
        let name = &after[..end];
        if !name.is_empty() && !out.contains(&name.to_string()) {
            out.push(name.to_string());
        }
        rest = &after[end + mark_len..];
    }
    out
}

fn apply_payload_all(template: &str, payload: &str) -> String {
    let mut out = String::with_capacity(template.len() + payload.len());
    let mut rest = template;
    let mark_len = '§'.len_utf8();
    loop {
        let Some(start) = rest.find('§') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + mark_len..];
        let Some(end) = after.find('§') else {
            out.push_str(&rest[start..]);
            break;
        };
        out.push_str(payload);
        rest = &after[end + mark_len..];
    }
    out
}

fn apply_payload_map(template: &str, values: &std::collections::HashMap<String, String>) -> String {
    let mut out = String::with_capacity(template.len() + 32);
    let mut rest = template;
    let mark_len = '§'.len_utf8();
    loop {
        let Some(start) = rest.find('§') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + mark_len..];
        let Some(end) = after.find('§') else {
            out.push_str(&rest[start..]);
            break;
        };
        let key = &after[..end];
        if let Some(v) = values.get(key) {
            out.push_str(v);
        }
        rest = &after[end + mark_len..];
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
        let infer_scheme = || -> &'static str {
            if host.contains(":443") {
                return "https";
            }
            if host.contains(":80") {
                return "http";
            }
            for (k, v) in &headers {
                let key = k.as_str().to_ascii_lowercase();
                let val = v.trim();
                if key == "x-forwarded-proto" {
                    if val.eq_ignore_ascii_case("https") {
                        return "https";
                    }
                    if val.eq_ignore_ascii_case("http") {
                        return "http";
                    }
                }
                if key == "forwarded" {
                    let lower = val.to_ascii_lowercase();
                    if lower.contains("proto=https") {
                        return "https";
                    }
                    if lower.contains("proto=http") {
                        return "http";
                    }
                }
                if key == "origin" || key == "referer" {
                    if let Ok(u) = url::Url::parse(val) {
                        if u.scheme() == "https" {
                            return "https";
                        }
                        if u.scheme() == "http" {
                            return "http";
                        }
                    }
                }
            }
            "https"
        };
        let base = format!("{}://{host}", infer_scheme());
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
