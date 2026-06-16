use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub last_project_path: Option<String>,
}

pub fn session_config_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    app.path()
        .resolve("proxer/session.json", BaseDirectory::AppData)
}

pub async fn load_session_config(app: &AppHandle) -> SessionConfig {
    let Ok(path) = session_config_path(app) else {
        return SessionConfig::default();
    };
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return SessionConfig::default();
    };
    serde_json::from_slice::<SessionConfig>(&bytes).unwrap_or_default()
}

pub async fn save_session_config(app: &AppHandle, cfg: &SessionConfig) -> tauri::Result<()> {
    let path = session_config_path(app)?;
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let bytes = serde_json::to_vec_pretty(cfg).unwrap_or_else(|_| b"{}".to_vec());
    tokio::fs::write(path, bytes)
        .await
        .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
    Ok(())
}

pub fn temp_project_db_path() -> PathBuf {
    let id = uuid::Uuid::new_v4().to_string();
    std::env::temp_dir()
        .join("proxer-temp")
        .join(format!("proxer-{id}.db"))
}
