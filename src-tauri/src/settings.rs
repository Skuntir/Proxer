use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    events::now_ms,
    fingerprint::{validate_os, validate_profile},
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
    #[serde(default = "default_max_memory_mb")]
    pub max_memory_mb: i64,
    #[serde(default = "default_scanner_memory_mb")]
    pub scanner_memory_mb: i64,
    #[serde(default = "default_scanner_max_rows")]
    pub scanner_max_rows: i64,
    pub hardware_acceleration: bool,
    pub auto_update: bool,
    pub beta_updates: bool,
    pub request_timeout_seconds: i64,
    pub max_concurrent_connections: i64,
    pub follow_redirects_max: i64,
    pub upstream_proxy_enabled: bool,
    #[serde(default)]
    pub upstream_proxy_url: String,
    pub verify_certificates: bool,
    #[serde(default)]
    pub tls_fingerprint_enabled: bool,
    #[serde(default = "default_tls_fingerprint_profile")]
    pub tls_fingerprint_profile: String,
    #[serde(default = "default_tls_fingerprint_os")]
    pub tls_fingerprint_os: String,
    #[serde(default = "default_mcp_enabled")]
    pub mcp_enabled: bool,
    #[serde(default = "default_mcp_port")]
    pub mcp_port: i64,
    #[serde(default)]
    pub show_connect_tunnels: bool,
    #[serde(default = "default_scope_regex")]
    pub scope_regex: String,
    #[serde(default)]
    pub system_proxy_enabled: bool,
}

fn default_scope_regex() -> String {
    ".*".into()
}

fn default_show_examples() -> bool {
    true
}

fn default_max_memory_mb() -> i64 {
    512
}

fn default_scanner_memory_mb() -> i64 {
    256
}

fn default_scanner_max_rows() -> i64 {
    5000
}

fn default_tls_fingerprint_profile() -> String {
    "chrome".into()
}

fn default_tls_fingerprint_os() -> String {
    "windows".into()
}

fn default_mcp_enabled() -> bool {
    false
}

fn default_mcp_port() -> i64 {
    8765
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
            max_memory_mb: default_max_memory_mb(),
            scanner_memory_mb: default_scanner_memory_mb(),
            scanner_max_rows: default_scanner_max_rows(),
            hardware_acceleration: true,
            auto_update: true,
            beta_updates: false,
            request_timeout_seconds: 30,
            max_concurrent_connections: 100,
            follow_redirects_max: 10,
            upstream_proxy_enabled: false,
            upstream_proxy_url: String::new(),
            verify_certificates: true,
            tls_fingerprint_enabled: false,
            tls_fingerprint_profile: default_tls_fingerprint_profile(),
            tls_fingerprint_os: default_tls_fingerprint_os(),
            mcp_enabled: false,
            mcp_port: default_mcp_port(),
            show_connect_tunnels: false,
            scope_regex: ".*".into(),
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
        serde_json::from_str::<UiSettings>(&raw)
            .map_err(|e| AppError::Other(format!("invalid settings json: {e}")))
    }

    pub async fn set_patch(&self, patch: serde_json::Value) -> Result<UiSettings> {
        let current = self.get().await.unwrap_or_default();
        let mut base = serde_json::to_value(current).map_err(|e| AppError::Other(e.to_string()))?;
        merge_json(&mut base, patch);
        let next = serde_json::from_value::<UiSettings>(base)
            .map_err(|e| AppError::InvalidInput(format!("invalid settings patch: {e}")))?;
        next.validate()?;
        let raw = serde_json::to_string(&next).map_err(|e| AppError::Other(e.to_string()))?;
        let store = self.store.get();
        store.setting_set(Self::KEY, &raw, now_ms()).await?;
        Ok(next)
    }
}

impl UiSettings {
    pub fn validate(&self) -> Result<()> {
        validate_profile(&self.tls_fingerprint_profile)?;
        validate_os(&self.tls_fingerprint_os)?;
        if !self.upstream_proxy_url.trim().is_empty() {
            let raw = self.upstream_proxy_url.trim();
            let parsed = url::Url::parse(raw)
                .map_err(|_| AppError::InvalidInput("invalid upstream proxy URL".into()))?;
            match parsed.scheme() {
                "http" | "https" | "socks5" | "socks5h" => {}
                _ => {
                    return Err(AppError::InvalidInput(
                        "upstream proxy URL must use http, https, socks5, or socks5h".into(),
                    ))
                }
            }
        }
        if !(1..=65535).contains(&self.mcp_port) {
            return Err(AppError::InvalidInput(
                "MCP port must be between 1 and 65535".into(),
            ));
        }
        if !(128..=65_536).contains(&self.max_memory_mb) {
            return Err(AppError::InvalidInput(
                "max memory must be between 128 MB and 65536 MB".into(),
            ));
        }
        if !(64..=32_768).contains(&self.scanner_memory_mb) {
            return Err(AppError::InvalidInput(
                "scanner memory must be between 64 MB and 32768 MB".into(),
            ));
        }
        if !(100..=250_000).contains(&self.scanner_max_rows) {
            return Err(AppError::InvalidInput(
                "scanner max rows must be between 100 and 250000".into(),
            ));
        }
        Ok(())
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
