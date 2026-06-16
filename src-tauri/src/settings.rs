use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    events::now_ms,
    storage::StoreHandle,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    pub theme: String,
    pub font_size: i64,
    pub font_family: String,
    pub compact_mode: bool,
    #[serde(default = "default_show_examples")]
    pub show_examples: bool,
    pub project_name: String,
    pub auto_save: bool,
    pub max_history_items: i64,
    pub max_response_size_mb: i64,
    pub hardware_acceleration: bool,
    pub auto_update: bool,
    pub beta_updates: bool,
    pub request_timeout_seconds: i64,
    pub max_concurrent_connections: i64,
    pub follow_redirects_max: i64,
    pub upstream_proxy_enabled: bool,
    pub verify_certificates: bool,
    #[serde(default)]
    pub show_connect_tunnels: bool,
    #[serde(default = "default_scope_regex")]
    pub scope_regex: String,
    #[serde(default)]
    pub system_proxy_enabled: bool,
}

fn default_scope_regex() -> String {
    "^$".into()
}

fn default_show_examples() -> bool {
    true
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            theme: "dark-color-amoled-red".into(),
            font_size: 12,
            font_family: "mono".into(),
            compact_mode: false,
            show_examples: true,
            project_name: "Proxer".into(),
            auto_save: true,
            max_history_items: 10000,
            max_response_size_mb: 10,
            hardware_acceleration: true,
            auto_update: true,
            beta_updates: false,
            request_timeout_seconds: 30,
            max_concurrent_connections: 100,
            follow_redirects_max: 10,
            upstream_proxy_enabled: false,
            verify_certificates: true,
            show_connect_tunnels: false,
            scope_regex: "^$".into(),
            system_proxy_enabled: false,
        }
    }
}

pub struct SettingsManager {
    store: StoreHandle,
}

impl SettingsManager {
    const KEY: &'static str = "settings";

    pub fn new(store: StoreHandle) -> Self {
        Self { store }
    }

    pub async fn get(&self) -> Result<UiSettings> {
        let store = self.store.get();
        let Some(raw) = store.setting_get(Self::KEY).await? else {
            return Ok(UiSettings::default());
        };
        serde_json::from_str::<UiSettings>(&raw).map_err(|e| AppError::Other(format!("invalid settings json: {e}")))
    }

    pub async fn set_patch(&self, patch: serde_json::Value) -> Result<UiSettings> {
        let current = self.get().await.unwrap_or_default();
        let mut base = serde_json::to_value(current).map_err(|e| AppError::Other(e.to_string()))?;
        merge_json(&mut base, patch);
        let next = serde_json::from_value::<UiSettings>(base).map_err(|e| AppError::InvalidInput(format!("invalid settings patch: {e}")))?;
        let raw = serde_json::to_string(&next).map_err(|e| AppError::Other(e.to_string()))?;
        let store = self.store.get();
        store
            .setting_set(Self::KEY, &raw, now_ms())
            .await?;
        Ok(next)
    }
}

fn merge_json(dst: &mut serde_json::Value, patch: serde_json::Value) {
    match (dst, patch) {
        (serde_json::Value::Object(dst_map), serde_json::Value::Object(patch_map)) => {
            for (k, v) in patch_map {
                match dst_map.get_mut(&k) {
                    Some(existing) => merge_json(existing, v),
                    None => {
                        dst_map.insert(k, v);
                    }
                }
            }
        }
        (dst_val, patch_val) => {
            *dst_val = patch_val;
        }
    }
}
