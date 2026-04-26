use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{error::Result, events::BackendEvent, events::EventBus, storage::SqliteStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiExtension {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub version: String,
    pub installed: bool,
    pub enabled: bool,
    pub rating: f64,
    pub downloads: String,
    pub category: String,
}

pub struct ExtensionManager {
    store: Arc<SqliteStore>,
    events: EventBus,
}

impl ExtensionManager {
    pub async fn new(store: Arc<SqliteStore>, events: EventBus) -> Result<Self> {
        let seed = vec![
            (
                "ext.passive-scanner".to_string(),
                "Passive Scanner+".to_string(),
                "Proxer".to_string(),
                "Adds additional passive security checks.".to_string(),
                4.7,
                "12.4k".to_string(),
                "Scanner".to_string(),
            ),
            (
                "ext.reporter".to_string(),
                "Report Builder".to_string(),
                "Proxer".to_string(),
                "Export findings and traffic into reports.".to_string(),
                4.4,
                "8.1k".to_string(),
                "Reporting".to_string(),
            ),
            (
                "ext.traffic-tags".to_string(),
                "Traffic Tagger".to_string(),
                "Proxer".to_string(),
                "Adds tagging/annotations to captured requests.".to_string(),
                4.2,
                "6.7k".to_string(),
                "Traffic".to_string(),
            ),
            (
                "ext.decoder".to_string(),
                "Decoder Pack".to_string(),
                "Proxer".to_string(),
                "Extra encoding/decoding helpers.".to_string(),
                4.1,
                "5.0k".to_string(),
                "Utilities".to_string(),
            ),
        ];

        store.extensions_seed_if_empty(&seed).await?;
        Ok(Self { store, events })
    }

    pub async fn list(&self, installed: Option<bool>) -> Result<Vec<UiExtension>> {
        let rows = self.store.extensions_list(installed).await?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, name, author, description, version, installed, enabled, rating, downloads, category) in rows {
            out.push(UiExtension {
                id,
                name,
                author,
                description,
                version,
                installed,
                enabled,
                rating,
                downloads,
                category,
            });
        }
        Ok(out)
    }

    pub async fn install(&self, id: &str) -> Result<()> {
        self.store.extensions_set_installed(id, true).await?;
        self.events.emit(BackendEvent::ExtensionInstalled {
            ts_ms: crate::events::now_ms(),
            id: id.to_string(),
        });
        Ok(())
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.store.extensions_set_enabled(id, enabled).await?;
        self.events.emit(BackendEvent::ExtensionEnabledChanged {
            ts_ms: crate::events::now_ms(),
            id: id.to_string(),
            enabled,
        });
        Ok(())
    }
}

