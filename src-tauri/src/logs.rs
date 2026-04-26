use std::sync::Arc;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::Result,
    events::{now_ms, BackendEvent, EventBus},
    storage::SqliteStore,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiLogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

pub struct LogManager {
    store: Arc<SqliteStore>,
    events: EventBus,
}

impl LogManager {
    pub fn new(store: Arc<SqliteStore>, events: EventBus) -> Self {
        Self { store, events }
    }

    pub async fn emit(&self, level: &str, source: &str, message: &str) -> Result<UiLogEntry> {
        let id = Uuid::new_v4().to_string();
        let ts_ms = now_ms();
        self.store
            .logs_insert(&id, ts_ms, level, source, message)
            .await?;

        let entry = UiLogEntry {
            id,
            timestamp: format_time(ts_ms),
            level: level.to_string(),
            source: source.to_string(),
            message: message.to_string(),
        };
        self.events.emit(BackendEvent::LogEmitted {
            ts_ms,
            entry: entry.clone(),
        });
        Ok(entry)
    }

    pub async fn list(&self, level: Option<String>, limit: u32, offset: u32) -> Result<Vec<UiLogEntry>> {
        let level_filter = level.as_deref().map(|s| s.to_uppercase());
        let rows = self
            .store
            .logs_list(level_filter.as_deref(), limit, offset)
            .await?;

        let mut out = Vec::with_capacity(rows.len());
        for (id, ts_ms, level, source, message) in rows {
            out.push(UiLogEntry {
                id,
                timestamp: format_time(ts_ms),
                level,
                source,
                message,
            });
        }
        Ok(out)
    }

    pub async fn clear(&self) -> Result<()> {
        self.store.logs_clear().await?;
        Ok(())
    }
}

fn format_time(ts_ms: i64) -> String {
    let secs = (ts_ms / 1000).max(0);
    let day = 24 * 60 * 60;
    let s = secs % day;
    let hh = s / 3600;
    let mm = (s % 3600) / 60;
    let ss = s % 60;
    format!("{:02}:{:02}:{:02}", hh, mm, ss)
}

