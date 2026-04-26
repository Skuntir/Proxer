mod app_state;
mod commands;
mod dashboard;
mod error;
mod extensions;
mod events;
mod http_types;
mod intercept;
mod intruder;
mod logs;
mod proxy;
mod rules;
mod scanner;
mod settings;
mod sitemap;
mod storage;
mod system_proxy;
mod tls;
mod ui;

use crate::app_state::AppState;
use tauri::Manager;

fn main() {
    let pid = std::process::id();
    let webview_data_dir = std::env::temp_dir().join("proxer-webview2").join(pid.to_string());
    let _ = std::fs::create_dir_all(&webview_data_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_data_dir);

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,proxer=info".into()),
        )
        .with_target(false)
        .init();

    if let Err(e) = rustls::crypto::ring::default_provider().install_default() {
        tracing::warn!(error = ?e, "failed to install rustls crypto provider");
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_state = tauri::async_runtime::block_on(AppState::new(app.handle().clone()))?;
            app.manage(app_state);
            Ok(())
        })
        .on_window_event(|_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let _ = crate::system_proxy::disable_system_proxy();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::events_poll,
            commands::proxy_start,
            commands::proxy_stop,
            commands::proxy_status,
            commands::tls_set_mitm_enabled,
            commands::tls_generate_ca,
            commands::tls_ca_info,
            commands::tls_get_mitm_enabled,
            commands::tls_export_ca_pem,
            commands::tls_export_ca_der_base64,
            commands::tls_export_ca_to_downloads,
            commands::tls_import_ca_pem,
            commands::downloads_write_text,
            commands::settings_get,
            commands::settings_set,
            commands::logs_list,
            commands::logs_clear,
            commands::dashboard_stats,
            commands::dashboard_details,
            commands::sitemap_get,
            commands::config_export,
            commands::config_import,
            commands::scanner_start,
            commands::scanner_stop,
            commands::scanner_status,
            commands::scanner_findings_list,
            commands::intruder_start,
            commands::intruder_stop,
            commands::intruder_results_list,
            commands::traffic_clear,
            commands::extensions_list,
            commands::extensions_install,
            commands::extensions_set_enabled,
            commands::history_list,
            commands::history_get,
            commands::ui_history_list,
            commands::ui_history_get,
            commands::repeater_send_raw,
            commands::intercept_set_enabled,
            commands::intercept_get_enabled,
            commands::intercept_forward,
            commands::intercept_drop,
            commands::history_replay,
            commands::rules_list,
            commands::rules_upsert,
            commands::rules_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
