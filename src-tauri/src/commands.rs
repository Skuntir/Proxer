use std::path::PathBuf;
use std::net::SocketAddr;

use tauri::{path::BaseDirectory, Manager, State};

use base64::Engine;
use http::header::HeaderName;
use serde::{Deserialize, Serialize};

use crate::{
    app_state::AppState,
    dashboard::{compute_dashboard_details, compute_dashboard_stats, DashboardDetails, DashboardStats},
    extensions::UiExtension,
    error::AppError,
    events::BackendEvent,
    http_types::{HistoryEntry, HistoryEntrySummary},
    intruder::{IntruderStartRequest, IntruderStartResponse, UiIntruderResult},
    logs::UiLogEntry,
    proxy::ProxyStatus,
    rules::RuleSpec,
    scanner::{ScanStatus, UiVulnerability},
    settings::UiSettings,
    sitemap::{build_sitemap, UiSitemapNode},
    tls::CaInfo,
    ui::{format_bytes, format_duration_ms, header_map, ms_to_iso, parse_cookies_from_headers, UiHttpRequest},
    system_proxy,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeaterSendResult {
    pub status_code: u16,
    pub duration_ms: u64,
    pub size: usize,
    pub raw_response: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsPollResult {
    pub cursor: u64,
    pub events: Vec<BackendEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedCaFiles {
    pub pem_path: String,
    pub cer_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedTextFile {
    pub path: String,
}

#[tauri::command]
pub async fn events_poll(
    state: State<'_, AppState>,
    cursor: Option<u64>,
    timeout_ms: Option<u64>,
) -> Result<EventsPollResult, String> {
    let (new_cursor, events) = state
        .events
        .poll(cursor.unwrap_or(0), timeout_ms.unwrap_or(2500), 200)
        .await;
    Ok(EventsPollResult {
        cursor: new_cursor,
        events,
    })
}

#[tauri::command]
pub async fn app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: "Skuntir".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<UiSettings, String> {
    state.settings.get().await.map_err(String::from)
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, patch: serde_json::Value) -> Result<UiSettings, String> {
    let before = state.settings.get().await.unwrap_or_default();
    let res = state.settings.set_patch(patch).await.map_err(String::from)?;

    if before.system_proxy_enabled != res.system_proxy_enabled {
        let status = state.proxy.status().await;
        if status.running {
            if let Some(bind) = status.bind.and_then(|b| b.parse::<SocketAddr>().ok()) {
                if res.system_proxy_enabled {
                    let _ = system_proxy::enable_system_proxy(bind);
                } else {
                    let _ = system_proxy::disable_system_proxy();
                }
            }
        } else if !res.system_proxy_enabled {
            let _ = system_proxy::disable_system_proxy();
        }
    }

    let _ = state
        .logs
        .emit("INFO", "settings", "settings updated")
        .await;
    Ok(res)
}

#[tauri::command]
pub async fn logs_list(
    state: State<'_, AppState>,
    level: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<UiLogEntry>, String> {
    state
        .logs
        .list(level, limit.unwrap_or(500), offset.unwrap_or(0))
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn logs_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.logs.clear().await.map_err(String::from)
}

#[tauri::command]
pub async fn dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    compute_dashboard_stats(state.store.clone())
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn dashboard_details(state: State<'_, AppState>) -> Result<DashboardDetails, String> {
    compute_dashboard_details(state.store.clone())
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn sitemap_get(state: State<'_, AppState>, limit: Option<u32>) -> Result<Vec<UiSitemapNode>, String> {
    build_sitemap(state.store.clone(), limit.unwrap_or(2000))
        .await
        .map_err(String::from)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub settings: UiSettings,
    pub mitm_enabled: bool,
    pub ca_info: Option<CaInfo>,
    pub intercept_enabled: bool,
    pub rules: Vec<RuleSpec>,
}

#[tauri::command]
pub async fn config_export(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.get().await.map_err(String::from)?;
    let mitm_enabled = state.tls.mitm_enabled().await;
    let ca_info = state.tls.ca_info().await;
    let intercept_enabled = state.intercept.is_enabled().await;
    let rules = state.rules.list().await;

    let out = ExportConfig {
        settings,
        mitm_enabled,
        ca_info,
        intercept_enabled,
        rules,
    };

    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn config_import(state: State<'_, AppState>, json: String) -> Result<(), String> {
    let parsed = serde_json::from_str::<ExportConfig>(&json).map_err(|e| format!("invalid config json: {e}"))?;

    let patch = serde_json::to_value(&parsed.settings).map_err(|e| e.to_string())?;
    let _ = state.settings.set_patch(patch).await.map_err(String::from)?;

    let _ = state.tls.set_mitm_enabled(parsed.mitm_enabled).await.map_err(String::from)?;
    state.intercept.set_enabled(parsed.intercept_enabled).await;

    for r in parsed.rules {
        let _ = state.rules.upsert(r).await;
    }

    let _ = state.logs.emit("INFO", "config", "config imported").await;
    Ok(())
}

#[tauri::command]
pub async fn scanner_start(state: State<'_, AppState>, limit: Option<u32>) -> Result<String, String> {
    let id = state.scanner.start(limit.unwrap_or(5000)).await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "scanner", "scan started").await;
    Ok(id)
}

#[tauri::command]
pub async fn scanner_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.scanner.stop().await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "scanner", "scan stopped").await;
    Ok(())
}

#[tauri::command]
pub async fn scanner_status(state: State<'_, AppState>) -> Result<ScanStatus, String> {
    Ok(state.scanner.status().await)
}

#[tauri::command]
pub async fn scanner_findings_list(
    state: State<'_, AppState>,
    severity: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<UiVulnerability>, String> {
    state
        .scanner
        .findings_list(severity, limit.unwrap_or(1000), offset.unwrap_or(0))
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn intruder_start(state: State<'_, AppState>, req: IntruderStartRequest) -> Result<IntruderStartResponse, String> {
    let res = state.intruder.start(req).await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "intruder", "attack started").await;
    Ok(res)
}

#[tauri::command]
pub async fn intruder_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.intruder.stop().await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "intruder", "attack stopped").await;
    Ok(())
}

#[tauri::command]
pub async fn intruder_results_list(
    state: State<'_, AppState>,
    attack_id: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<UiIntruderResult>, String> {
    state
        .intruder
        .results_list(attack_id, limit.unwrap_or(500), offset.unwrap_or(0))
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn traffic_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.store.traffic_clear().await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "traffic", "cleared traffic").await;
    Ok(())
}

#[tauri::command]
pub async fn extensions_list(state: State<'_, AppState>, installed: Option<bool>) -> Result<Vec<UiExtension>, String> {
    state.extensions.list(installed).await.map_err(String::from)
}

#[tauri::command]
pub async fn extensions_install(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.extensions.install(&id).await.map_err(String::from)?;
    let _ = state
        .logs
        .emit("INFO", "extensions", &format!("installed {id}"))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn extensions_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<(), String> {
    state
        .extensions
        .set_enabled(&id, enabled)
        .await
        .map_err(String::from)?;
    let _ = state
        .logs
        .emit("INFO", "extensions", &format!("{} {id}", if enabled { "enabled" } else { "disabled" }))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn proxy_start(state: State<'_, AppState>, port: Option<u16>) -> Result<ProxyStatus, String> {
    let port = port.unwrap_or(8080);
    let status = state
        .proxy
        .start(port)
        .await
        .map(|bind| ProxyStatus {
            running: true,
            bind: Some(bind.to_string()),
        })
        .map_err(String::from)?;

    let settings = state.settings.get().await.unwrap_or_default();
    if settings.system_proxy_enabled {
        if let Some(bind) = status.bind.as_ref().and_then(|b| b.parse::<SocketAddr>().ok()) {
            let _ = system_proxy::enable_system_proxy(bind);
        }
    }
    let _ = state
        .logs
        .emit("INFO", "proxy", &format!("proxy started on {}", status.bind.clone().unwrap_or_default()))
        .await;
    Ok(status)
}

#[tauri::command]
pub async fn proxy_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.proxy.stop().await.map_err(String::from)?;
    let _ = system_proxy::disable_system_proxy();
    let _ = state.logs.emit("INFO", "proxy", "proxy stopped").await;
    Ok(())
}

#[tauri::command]
pub async fn proxy_status(state: State<'_, AppState>) -> Result<ProxyStatus, String> {
    Ok(state.proxy.status().await)
}

#[tauri::command]
pub async fn tls_set_mitm_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.tls.set_mitm_enabled(enabled).await.map_err(String::from)?;
    let _ = state
        .logs
        .emit("INFO", "tls", &format!("MITM {}", if enabled { "enabled" } else { "disabled" }))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn tls_generate_ca(state: State<'_, AppState>) -> Result<CaInfo, String> {
    let ci = state.tls.generate_ca().await.map_err(String::from)?;
    let _ = state.logs.emit("INFO", "tls", "CA generated").await;
    Ok(ci)
}

#[tauri::command]
pub async fn tls_ca_info(state: State<'_, AppState>) -> Result<Option<CaInfo>, String> {
    Ok(state.tls.ca_info().await)
}

#[tauri::command]
pub async fn tls_get_mitm_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.tls.mitm_enabled().await)
}

#[tauri::command]
pub async fn tls_export_ca_pem(state: State<'_, AppState>) -> Result<String, String> {
    state.tls.export_ca_pem().await.map_err(String::from)
}

#[tauri::command]
pub async fn tls_export_ca_der_base64(state: State<'_, AppState>) -> Result<String, String> {
    let bytes = state.tls.export_ca_der().await.map_err(String::from)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn downloads_skuntir_dir(state: &AppState) -> Result<PathBuf, String> {
    state
        .app
        .path()
        .resolve("Skuntir", BaseDirectory::Download)
        .map_err(|e| e.to_string())
}

fn validate_download_filename(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err(String::from(AppError::InvalidInput("filename required".into())));
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err(String::from(AppError::InvalidInput("invalid filename".into())));
    }
    Ok(())
}

#[tauri::command]
pub async fn tls_export_ca_to_downloads(state: State<'_, AppState>) -> Result<ExportedCaFiles, String> {
    if state.tls.ca_info().await.is_none() {
        let _ = state.tls.generate_ca().await.map_err(String::from)?;
    }

    let pem = state.tls.export_ca_pem().await.map_err(String::from)?;
    let der = state.tls.export_ca_der().await.map_err(String::from)?;

    let dir = downloads_skuntir_dir(&state)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let ts = crate::events::now_ms();
    let pem_path = dir.join(format!("skuntir-ca-{ts}.pem"));
    let cer_path = dir.join(format!("skuntir-ca-{ts}.cer"));

    tokio::fs::write(&pem_path, pem.as_bytes()).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&cer_path, &der).await.map_err(|e| e.to_string())?;

    let _ = state
        .logs
        .emit(
            "INFO",
            "tls",
            &format!(
                "exported CA to downloads: {}, {}",
                pem_path.to_string_lossy(),
                cer_path.to_string_lossy()
            ),
        )
        .await;

    Ok(ExportedCaFiles {
        pem_path: pem_path.to_string_lossy().to_string(),
        cer_path: cer_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn downloads_write_text(state: State<'_, AppState>, filename: String, contents: String) -> Result<ExportedTextFile, String> {
    validate_download_filename(&filename)?;
    let dir = downloads_skuntir_dir(&state)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    tokio::fs::write(&path, contents.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(ExportedTextFile {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn tls_import_ca_pem(state: State<'_, AppState>, cert_pem: String, key_pem: String) -> Result<CaInfo, String> {
    state
        .tls
        .import_ca_pem(&cert_pem, &key_pem)
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<HistoryEntrySummary>, String> {
    state
        .store
        .list(limit.unwrap_or(200), offset.unwrap_or(0))
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn history_get(state: State<'_, AppState>, id: String) -> Result<HistoryEntry, String> {
    state.store.get(&id).await.map_err(String::from)
}

#[tauri::command]
pub async fn ui_history_list(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<UiHttpRequest>, String> {
    let rows = state
        .store
        .list(limit.unwrap_or(200), offset.unwrap_or(0))
        .await
        .map_err(String::from)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ui_from_summary(&row));
    }
    Ok(out)
}

#[tauri::command]
pub async fn ui_history_get(state: State<'_, AppState>, id: String) -> Result<UiHttpRequest, String> {
    let entry = state.store.get(&id).await.map_err(String::from)?;

    let url = url::Url::parse(&entry.summary.url).ok();
    let host = url
        .as_ref()
        .and_then(|u| u.host_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| entry.request.host.clone());
    let path = url
        .as_ref()
        .map(|u| {
            let mut p = u.path().to_string();
            if let Some(q) = u.query() {
                p.push('?');
                p.push_str(q);
            }
            p
        })
        .unwrap_or_else(|| "/".to_string());
    let port = url
        .as_ref()
        .and_then(|u| u.port_or_known_default())
        .unwrap_or(if entry.request.scheme == "https" { 443 } else { 80 });

    let request_headers_pairs: Vec<(String, String)> = entry
        .request
        .headers
        .iter()
        .map(|h| (h.name.clone(), h.value.clone()))
        .collect();
    let request_headers = header_map(&request_headers_pairs);

    let (status_code, elapsed_ms, response_bytes, response_headers, response_body, content_type) =
        if let Some(resp) = &entry.response {
            let resp_headers_pairs: Vec<(String, String)> = resp
                .headers
                .iter()
                .map(|h| (h.name.clone(), h.value.clone()))
                .collect();
            let resp_headers = header_map(&resp_headers_pairs);
            let ct = resp_headers
                .get("content-type")
                .or_else(|| resp_headers.get("Content-Type"))
                .cloned()
                .unwrap_or_default();

            let body_bytes = base64::engine::general_purpose::STANDARD
                .decode(&resp.body_base64)
                .unwrap_or_default();

            (
                resp.status as i64,
                Some(resp.elapsed_ms as i64),
                Some(body_bytes.len() as i64),
                resp_headers,
                String::from_utf8_lossy(&body_bytes).to_string(),
                ct,
            )
        } else {
            (
                0,
                entry.summary.elapsed_ms.map(|v| v as i64),
                entry.summary.response_bytes.map(|v| v as i64),
                std::collections::BTreeMap::new(),
                String::new(),
                String::new(),
            )
        };

    let req_body_bytes = base64::engine::general_purpose::STANDARD
        .decode(&entry.request.body_base64)
        .unwrap_or_default();
    let req_body = String::from_utf8_lossy(&req_body_bytes).to_string();

    let cookies = parse_cookies_from_headers(&request_headers, &response_headers, &host);

    Ok(UiHttpRequest {
        id: entry.summary.id,
        method: entry.summary.method,
        url: entry.summary.url,
        host,
        path,
        status_code,
        time: format_duration_ms(elapsed_ms),
        size: format_bytes(response_bytes),
        content_type,
        headers: response_headers,
        request_headers,
        body: req_body,
        response_body,
        cookies,
        timestamp: ms_to_iso(entry.summary.started_ms),
        protocol: if entry.request.scheme == "https" {
            "HTTPS".to_string()
        } else {
            "HTTP".to_string()
        },
        port: port as i64,
    })
}

#[tauri::command]
pub async fn history_replay(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let req = state.store.get_for_replay(&id).await.map_err(String::from)?;
    let new_id = state
        .proxy
        .engine()
        .replay(req)
        .await
        .map_err(String::from)?;
    Ok(new_id.to_string())
}

#[tauri::command]
pub async fn rules_list(state: State<'_, AppState>) -> Result<Vec<RuleSpec>, String> {
    Ok(state.rules.list().await)
}

#[tauri::command]
pub async fn rules_upsert(state: State<'_, AppState>, rule: RuleSpec) -> Result<(), String> {
    if rule.id.trim().is_empty() {
        return Err(String::from(AppError::InvalidInput("rule id required".into())));
    }
    state.rules.upsert(rule).await;
    Ok(())
}

#[tauri::command]
pub async fn rules_remove(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    Ok(state.rules.remove(&id).await)
}

#[tauri::command]
pub async fn repeater_send_raw(raw_request: String) -> Result<RepeaterSendResult, String> {
    let parsed = parse_raw_http_request(&raw_request).map_err(String::from)?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let mut rb = client.request(parsed.method, parsed.url);
    for (k, v) in parsed.headers {
        rb = rb.header(k, v);
    }
    if !parsed.body.is_empty() {
        rb = rb.body(parsed.body);
    }

    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let body_bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let dur = start.elapsed().as_millis() as u64;

    let mut raw = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""));
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

    Ok(RepeaterSendResult {
        status_code: status.as_u16(),
        duration_ms: dur,
        size: body_bytes.len(),
        raw_response: raw,
    })
}

#[tauri::command]
pub async fn intercept_set_enabled(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    state.intercept.set_enabled(enabled).await;
    Ok(state.intercept.is_enabled().await)
}

#[tauri::command]
pub async fn intercept_get_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.intercept.is_enabled().await)
}

#[tauri::command]
pub async fn intercept_forward(
    state: State<'_, AppState>,
    interception_id: String,
    edited_raw: Option<String>,
) -> Result<(), String> {
    state
        .intercept
        .forward(&interception_id, edited_raw)
        .map_err(String::from)
}

#[tauri::command]
pub async fn intercept_drop(state: State<'_, AppState>, interception_id: String) -> Result<(), String> {
    state.intercept.reject(&interception_id).map_err(String::from)
}

fn ui_from_summary(row: &HistoryEntrySummary) -> UiHttpRequest {
    let url = url::Url::parse(&row.url).ok();
    let scheme = url.as_ref().map(|u| u.scheme()).unwrap_or("http");
    let host = url
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or_default()
        .to_string();
    let path = url
        .as_ref()
        .map(|u| {
            let mut p = u.path().to_string();
            if let Some(q) = u.query() {
                p.push('?');
                p.push_str(q);
            }
            p
        })
        .unwrap_or_else(|| "/".to_string());
    let port = url
        .as_ref()
        .and_then(|u| u.port_or_known_default())
        .unwrap_or(if scheme == "https" { 443 } else { 80 });

    UiHttpRequest {
        id: row.id.clone(),
        method: row.method.clone(),
        url: row.url.clone(),
        host,
        path,
        status_code: row.status.unwrap_or(0) as i64,
        time: format_duration_ms(row.elapsed_ms.map(|v| v as i64)),
        size: format_bytes(row.response_bytes.map(|v| v as i64)),
        content_type: String::new(),
        headers: std::collections::BTreeMap::new(),
        request_headers: std::collections::BTreeMap::new(),
        body: String::new(),
        response_body: String::new(),
        cookies: Vec::new(),
        timestamp: ms_to_iso(row.started_ms),
        protocol: if scheme == "https" {
            "HTTPS".to_string()
        } else {
            "HTTP".to_string()
        },
        port: port as i64,
    }
}

struct ParsedRawRequest {
    method: reqwest::Method,
    url: url::Url,
    headers: Vec<(HeaderName, String)>,
    body: Vec<u8>,
}

fn parse_raw_http_request(raw: &str) -> crate::error::Result<ParsedRawRequest> {
    let raw = raw.replace("\r\n", "\n");
    let (head, body) = raw.split_once("\n\n").unwrap_or((&raw, ""));
    let mut lines = head.lines();
    let start = lines.next().unwrap_or_default().trim();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let target = parts.next().unwrap_or("/");

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| crate::error::AppError::InvalidInput("invalid method".into()))?;

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
            .map_err(|_| crate::error::AppError::InvalidInput("invalid header name".into()))?;
        headers.push((name, val));
    }

    let url = if target.starts_with("http://") || target.starts_with("https://") {
        url::Url::parse(target)
            .map_err(|_| crate::error::AppError::InvalidInput("invalid URL".into()))?
    } else {
        let host = host_hdr.ok_or_else(|| crate::error::AppError::InvalidInput("missing Host header".into()))?;
        let base = format!("http://{host}");
        let base = url::Url::parse(&base)
            .map_err(|_| crate::error::AppError::InvalidInput("invalid Host header".into()))?;
        base.join(target)
            .map_err(|_| crate::error::AppError::InvalidInput("invalid request target".into()))?
    };

    Ok(ParsedRawRequest {
        method,
        url,
        headers,
        body: body.as_bytes().to_vec(),
    })
}
