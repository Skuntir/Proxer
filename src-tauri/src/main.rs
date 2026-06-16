mod api_leaks;
mod app_state;
mod attack_surface;
mod commands;
mod dashboard;
mod error;
mod events;
mod extensions;
mod fingerprint;
mod http_types;
mod intercept;
mod intruder;
mod logs;
mod mcp;
mod project;
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
use tracing::{Event, Subscriber};
use tracing_subscriber::{
    fmt::{format::Writer, FmtContext, FormatEvent, FormatFields},
    registry::LookupSpan,
};

struct TerminalFormatter;

impl<S, N> FormatEvent<S, N> for TerminalFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        writeln!(writer, "[{}] {}", terminal_time(), visitor.finish())
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: Option<String>,
    fields: Vec<String>,
}

impl MessageVisitor {
    fn finish(self) -> String {
        let mut out = self.message.unwrap_or_else(|| "event".into());
        if !self.fields.is_empty() {
            out.push_str(" | ");
            out.push_str(&self.fields.join(" "));
        }
        out
    }
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{value:?}").trim_matches('"').to_string());
        } else {
            self.fields.push(format!("{}={value:?}", field.name()));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else {
            self.fields.push(format!("{}={value}", field.name()));
        }
    }
}

fn terminal_time() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() % 86_400)
        .unwrap_or(0);
    let hh = secs / 3600;
    let mm = (secs % 3600) / 60;
    let ss = secs % 60;
    format!("{hh:02}:{mm:02}:{ss:02}")
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        tracing::error!("panic: {info}");
    }));

    let pid = std::process::id();
    let webview_data_dir = std::env::temp_dir()
        .join("proxer-webview2")
        .join(pid.to_string());
    let _ = std::fs::create_dir_all(&webview_data_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_data_dir);

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,proxer=info".into()),
        )
        .with_target(false)
        .event_format(TerminalFormatter)
        .init();

    tracing::info!("Proxer starting");

    if let Err(e) = rustls::crypto::ring::default_provider().install_default() {
        tracing::warn!(error = ?e, "failed to install rustls crypto provider");
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_state = tauri::async_runtime::block_on(AppState::new(app.handle().clone()))?;
            let mcp_state = app_state.clone();
            app.manage(app_state);
            tauri::async_runtime::spawn(async move {
                crate::mcp::start_if_enabled(mcp_state).await;
            });
            Ok(())
        })
        .on_window_event(|_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let _ = crate::system_proxy::disable_system_proxy();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::client_log,
            commands::project_status,
            commands::project_use_temporary,
            commands::project_open,
            commands::project_open_folder_dialog,
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
            commands::tls_fingerprint_options,
            commands::logs_list,
            commands::logs_clear,
            commands::dashboard_stats,
            commands::dashboard_details,
            commands::api_leaks_scan,
            commands::attack_surface_get,
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
            commands::intercept_queue,
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
