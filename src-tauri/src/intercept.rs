use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{oneshot, RwLock};

use crate::{
    error::{AppError, Result},
    events::{BackendEvent, EventBus},
    http_types::{HeaderPair, ProxyRequest},
};

#[derive(Debug, Clone)]
pub struct InterceptManager {
    events: EventBus,
    enabled: Arc<RwLock<bool>>,
    pending: Arc<DashMap<String, oneshot::Sender<InterceptDecision>>>,
}

#[derive(Debug)]
pub enum InterceptDecision {
    Forward { edited_raw: Option<String> },
    Drop,
}

impl InterceptManager {
    pub fn new(events: EventBus) -> Self {
        Self {
            events,
            enabled: Arc::new(RwLock::new(false)),
            pending: Arc::new(DashMap::new()),
        }
    }

    pub async fn is_enabled(&self) -> bool {
        *self.enabled.read().await
    }

    pub async fn set_enabled(&self, enabled: bool) {
        *self.enabled.write().await = enabled;
    }

    pub async fn pause_request(&self, req: &ProxyRequest) -> Result<Option<InterceptDecision>> {
        if !self.is_enabled().await {
            return Ok(None);
        }

        let id = req.id.to_string();
        if self.pending.len() > 256 {
            return Err(AppError::Other("intercept queue full".into()));
        }

        let (tx, rx) = oneshot::channel();
        self.pending.insert(id.clone(), tx);

        self.events.emit(BackendEvent::InterceptPaused {
            ts_ms: crate::events::now_ms(),
            interception_id: id.clone(),
            request_id: id.clone(),
            raw: render_raw_request(req),
        });

        match rx.await {
            Ok(decision) => Ok(Some(decision)),
            Err(_) => Ok(Some(InterceptDecision::Drop)),
        }
    }

    pub fn forward(&self, interception_id: &str, edited_raw: Option<String>) -> Result<()> {
        let Some((_, tx)) = self.pending.remove(interception_id) else {
            return Err(AppError::InvalidInput("unknown interception id".into()));
        };
        let _ = tx.send(InterceptDecision::Forward { edited_raw });
        Ok(())
    }

    pub fn reject(&self, interception_id: &str) -> Result<()> {
        let Some((_, tx)) = self.pending.remove(interception_id) else {
            return Err(AppError::InvalidInput("unknown interception id".into()));
        };
        let _ = tx.send(InterceptDecision::Drop);
        Ok(())
    }
}

pub fn render_raw_request(req: &ProxyRequest) -> String {
    let url = url::Url::parse(&req.url).ok();
    let target = url
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

    let mut out = String::new();
    out.push_str(&format!("{} {} HTTP/1.1\r\n", req.method, target));
    out.push_str(&format!("Host: {}\r\n", req.host));
    for h in &req.headers {
        if h.name.eq_ignore_ascii_case("host") {
            continue;
        }
        out.push_str(&h.name);
        out.push_str(": ");
        out.push_str(&h.value);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    out.push_str(&String::from_utf8_lossy(&req.body));
    out
}

pub fn apply_raw_edit(mut req: ProxyRequest, edited_raw: &str) -> Result<ProxyRequest> {
    let raw = edited_raw.replace("\r\n", "\n");
    let (head, body) = raw.split_once("\n\n").unwrap_or((&raw, ""));
    let mut lines = head.lines();
    let start = lines.next().unwrap_or_default().trim();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or(&req.method).to_string();
    let target = parts.next().unwrap_or("/");

    req.method = method;

    let mut headers: Vec<HeaderPair> = Vec::new();
    let mut host: Option<String> = None;
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let name = k.trim().to_string();
        let value = v.trim().to_string();
        if name.eq_ignore_ascii_case("host") {
            host = Some(value.clone());
        }
        headers.push(HeaderPair { name, value });
    }
    if let Some(h) = host {
        req.host = h;
    }
    req.headers = headers;
    req.body = body.as_bytes().to_vec();

    let url = if target.starts_with("http://") || target.starts_with("https://") {
        url::Url::parse(target)
            .map_err(|_| AppError::InvalidInput("invalid URL".into()))?
            .to_string()
    } else {
        let base = format!("{}://{}", req.scheme, req.host);
        let base = url::Url::parse(&base)
            .map_err(|_| AppError::InvalidInput("invalid host".into()))?;
        base.join(target)
            .map_err(|_| AppError::InvalidInput("invalid request target".into()))?
            .to_string()
    };
    req.url = url;

    Ok(req)
}
