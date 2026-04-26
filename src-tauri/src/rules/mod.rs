use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    events::{BackendEvent, EventBus},
    http_types::{HeaderPair, ProxyRequest, ProxyResponse},
};

#[derive(Debug, Clone)]
pub struct RuleSet {
    events: EventBus,
    rules: Arc<RwLock<Vec<RuleSpec>>>,
}

impl RuleSet {
    pub fn new(events: EventBus) -> Self {
        Self {
            events,
            rules: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn list(&self) -> Vec<RuleSpec> {
        self.rules.read().await.clone()
    }

    pub async fn upsert(&self, rule: RuleSpec) {
        let mut rules = self.rules.write().await;
        if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
            *existing = rule;
        } else {
            rules.push(rule);
        }
    }

    pub async fn remove(&self, id: &str) -> bool {
        let mut rules = self.rules.write().await;
        let before = rules.len();
        rules.retain(|r| r.id != id);
        before != rules.len()
    }

    pub async fn apply_request(&self, req: &mut ProxyRequest) -> RuleDecision {
        let rules = self.rules.read().await;
        for rule in rules.iter().filter(|r| r.enabled) {
            if !rule.matcher.matches_request(req) {
                continue;
            }

            let mut decision = RuleDecision::default();
            for action in &rule.actions {
                match action.apply_request(req) {
                    RuleActionOutcome::None => {}
                    RuleActionOutcome::Modified(reason) => {
                        self.events.emit(BackendEvent::RuleTriggered {
                            ts_ms: req.started_ms,
                            id: req.id.to_string(),
                            rule_id: rule.id.clone(),
                            action: reason.clone(),
                        });
                        decision.modified = true;
                    }
                    RuleActionOutcome::Blocked(reason) => {
                        self.events.emit(BackendEvent::RuleTriggered {
                            ts_ms: req.started_ms,
                            id: req.id.to_string(),
                            rule_id: rule.id.clone(),
                            action: "block".into(),
                        });
                        decision.blocked_reason = Some(reason);
                        return decision;
                    }
                    RuleActionOutcome::Delay(ms) => {
                        self.events.emit(BackendEvent::RuleTriggered {
                            ts_ms: req.started_ms,
                            id: req.id.to_string(),
                            rule_id: rule.id.clone(),
                            action: format!("delay:{}ms", ms),
                        });
                        decision.delay_ms = decision.delay_ms.max(ms);
                    }
                }
            }

            if decision.modified {
                self.events.emit(BackendEvent::RequestModified {
                    ts_ms: req.started_ms,
                    id: req.id.to_string(),
                    reason: format!("rule:{}", rule.id),
                });
            }

            if decision.delay_ms > 0 || decision.modified || decision.blocked_reason.is_some() {
                return decision;
            }
        }

        RuleDecision::default()
    }

    pub async fn apply_response(&self, request_id: Uuid, started_ms: i64, resp: &mut ProxyResponse) {
        let rules = self.rules.read().await;
        for rule in rules.iter().filter(|r| r.enabled) {
            if !rule.matcher.matches_response(resp) {
                continue;
            }
            for action in &rule.actions {
                if let Some(reason) = action.apply_response(resp) {
                    self.events.emit(BackendEvent::RuleTriggered {
                        ts_ms: started_ms,
                        id: request_id.to_string(),
                        rule_id: rule.id.clone(),
                        action: reason,
                    });
                }
            }
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct RuleDecision {
    pub blocked_reason: Option<String>,
    pub modified: bool,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleSpec {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub matcher: RuleMatch,
    pub actions: Vec<RuleAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleMatch {
    pub method: Option<String>,
    pub url_contains: Option<String>,
    pub header_equals: Vec<HeaderEquals>,
    pub status_code: Option<u16>,
}

impl RuleMatch {
    fn matches_request(&self, req: &ProxyRequest) -> bool {
        if let Some(method) = &self.method {
            if !req.method.eq_ignore_ascii_case(method) {
                return false;
            }
        }

        if let Some(substr) = &self.url_contains {
            if !req.url.contains(substr) {
                return false;
            }
        }

        for he in &self.header_equals {
            if !header_equals(&req.headers, &he.name, &he.value) {
                return false;
            }
        }

        true
    }

    fn matches_response(&self, resp: &ProxyResponse) -> bool {
        if let Some(code) = self.status_code {
            if resp.status != code {
                return false;
            }
        }
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderEquals {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum RuleAction {
    Block { reason: String },
    AddHeader { name: String, value: String },
    SetHeader { name: String, value: String },
    RewriteUrlPrefix { from: String, to: String },
    DelayMs { ms: u64 },
    ReplaceRequestBodyBase64 { body_base64: String },
    ReplaceResponseBodyBase64 { body_base64: String },
}

enum RuleActionOutcome {
    None,
    Modified(String),
    Blocked(String),
    Delay(u64),
}

impl RuleAction {
    fn apply_request(&self, req: &mut ProxyRequest) -> RuleActionOutcome {
        match self {
            RuleAction::Block { reason } => RuleActionOutcome::Blocked(reason.clone()),
            RuleAction::AddHeader { name, value } => {
                req.headers.push(HeaderPair {
                    name: name.clone(),
                    value: value.clone(),
                });
                RuleActionOutcome::Modified("add_header".into())
            }
            RuleAction::SetHeader { name, value } => {
                set_header(&mut req.headers, name, value);
                RuleActionOutcome::Modified("set_header".into())
            }
            RuleAction::RewriteUrlPrefix { from, to } => {
                if req.url.starts_with(from) {
                    req.url = format!("{}{}", to, &req.url[from.len()..]);
                    RuleActionOutcome::Modified("rewrite_url_prefix".into())
                } else {
                    RuleActionOutcome::None
                }
            }
            RuleAction::DelayMs { ms } => RuleActionOutcome::Delay(*ms),
            RuleAction::ReplaceRequestBodyBase64 { body_base64 } => match B64.decode(body_base64) {
                Ok(bytes) => {
                    req.body = bytes;
                    RuleActionOutcome::Modified("replace_request_body".into())
                }
                Err(_) => RuleActionOutcome::None,
            },
            RuleAction::ReplaceResponseBodyBase64 { .. } => RuleActionOutcome::None,
        }
    }

    fn apply_response(&self, resp: &mut ProxyResponse) -> Option<String> {
        match self {
            RuleAction::AddHeader { name, value } => {
                resp.headers.push(HeaderPair {
                    name: name.clone(),
                    value: value.clone(),
                });
                Some("add_header".into())
            }
            RuleAction::SetHeader { name, value } => {
                set_header(&mut resp.headers, name, value);
                Some("set_header".into())
            }
            RuleAction::ReplaceResponseBodyBase64 { body_base64 } => match B64.decode(body_base64) {
                Ok(bytes) => {
                    resp.body = bytes;
                    Some("replace_response_body".into())
                }
                Err(_) => None,
            },
            _ => None,
        }
    }
}

fn header_equals(headers: &[HeaderPair], name: &str, value: &str) -> bool {
    headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case(name) && h.value.trim() == value.trim()
    })
}

fn set_header(headers: &mut Vec<HeaderPair>, name: &str, value: &str) {
    if let Some(h) = headers.iter_mut().find(|h| h.name.eq_ignore_ascii_case(name)) {
        h.value = value.to_string();
        return;
    }
    headers.push(HeaderPair {
        name: name.to_string(),
        value: value.to_string(),
    });
}
