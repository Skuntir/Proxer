use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderPair {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct ProxyRequest {
    pub id: Uuid,
    pub started_ms: i64,
    pub scheme: String,
    pub host: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderPair>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: Vec<HeaderPair>,
    pub body: Vec<u8>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntrySummary {
    pub id: String,
    pub started_ms: i64,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub elapsed_ms: Option<u64>,
    pub request_bytes: usize,
    pub response_bytes: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub summary: HistoryEntrySummary,
    pub request: StoredRequest,
    pub response: Option<StoredResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredRequest {
    pub scheme: String,
    pub host: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderPair>,
    pub body_base64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredResponse {
    pub status: u16,
    pub headers: Vec<HeaderPair>,
    pub body_base64: String,
    pub elapsed_ms: u64,
}
