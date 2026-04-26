use std::sync::Arc;

use tauri::AppHandle;

use crate::{
    extensions::ExtensionManager,
    events::EventBus,
    intercept::InterceptManager,
    intruder::IntruderManager,
    logs::LogManager,
    proxy::{ProxyEngine, ProxyManager},
    rules::RuleSet,
    scanner::ScannerManager,
    settings::SettingsManager,
    system_proxy,
    storage::SqliteStore,
    tls::TlsManager,
};

#[derive(Clone)]
pub struct AppState {
    pub app: AppHandle,
    pub events: EventBus,
    pub store: Arc<SqliteStore>,
    pub settings: Arc<SettingsManager>,
    pub logs: Arc<LogManager>,
    pub rules: Arc<RuleSet>,
    pub tls: Arc<TlsManager>,
    pub intercept: Arc<InterceptManager>,
    pub scanner: Arc<ScannerManager>,
    pub intruder: Arc<IntruderManager>,
    pub extensions: Arc<ExtensionManager>,
    pub proxy: Arc<ProxyManager>,
}

impl AppState {
    pub async fn new(app: AppHandle) -> tauri::Result<Self> {
        let events = EventBus::new();
        events.spawn_tauri_emitter(app.clone());

        let store = Arc::new(SqliteStore::open(&app).await?);
        let settings = Arc::new(SettingsManager::new(store.clone()));
        let logs = Arc::new(LogManager::new(store.clone(), events.clone()));
        let rules = Arc::new(RuleSet::new(events.clone()));
        let tls = Arc::new(TlsManager::load_or_empty(app.clone(), events.clone()).await?);
        let intercept = Arc::new(InterceptManager::new(events.clone()));
        let scanner = Arc::new(ScannerManager::new(store.clone(), events.clone()));
        let intruder = Arc::new(IntruderManager::new(store.clone(), events.clone()));
        let extensions = Arc::new(
            ExtensionManager::new(store.clone(), events.clone())
                .await
                .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?,
        );

        let engine = Arc::new(ProxyEngine::new(
            app.clone(),
            events.clone(),
            store.clone(),
            settings.clone(),
            
            rules.clone(),
            tls.clone(),
            intercept.clone(),
        ));
        let proxy = Arc::new(ProxyManager::new(engine));

        let mut started = false;
        for port in 8080u16..=8090u16 {
            match proxy.start(port).await {
                Ok(bind) => {
                    tracing::info!(bind = %bind, "proxy auto-started");
                    if let Ok(s) = settings.get().await {
                        if s.system_proxy_enabled {
                            let _ = system_proxy::enable_system_proxy(bind);
                        }
                    }
                    started = true;
                    break;
                }
                Err(e) => {
                    tracing::warn!(port = port, error = %e, "proxy auto-start failed");
                }
            }
        }
        if !started {
            tracing::warn!("proxy did not auto-start on any default port");
        }

        Ok(Self {
            app,
            events,
            store,
            settings,
            logs,
            rules,
            tls,
            intercept,
            scanner,
            intruder,
            extensions,
            proxy,
        })
    }
}
