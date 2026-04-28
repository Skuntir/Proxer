use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use tauri::AppHandle;

use crate::{
    extensions::ExtensionManager,
    events::EventBus,
    intercept::InterceptManager,
    intruder::IntruderManager,
    logs::LogManager,
    project::{load_session_config, save_session_config, temp_project_db_path},
    proxy::{ProxyEngine, ProxyManager},
    rules::RuleSet,
    scanner::ScannerManager,
    settings::SettingsManager,
    system_proxy,
    storage::{SqliteStore, StoreHandle},
    tls::TlsManager,
};

#[derive(Debug, Clone)]
pub enum ProjectMode {
    Temporary,
    Project,
}

#[derive(Debug, Clone)]
pub struct ProjectState {
    pub mode: ProjectMode,
    pub path: Option<PathBuf>,
}

#[derive(Clone)]
pub struct AppState {
    pub app: AppHandle,
    pub events: EventBus,
    pub store: StoreHandle,
    pub project: Arc<RwLock<ProjectState>>,
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

        let cfg = load_session_config(&app).await;
        let (initial_mode, initial_state_path, initial_db_path) = if let Some(p) = cfg
            .last_project_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| p.exists())
        {
            (ProjectMode::Project, Some(p.clone()), p)
        } else {
            let p = temp_project_db_path();
            (ProjectMode::Temporary, None, p)
        };
        let store0 = Arc::new(SqliteStore::open_at(initial_db_path).await?);
        let store = StoreHandle::new(store0);
        let project = Arc::new(RwLock::new(ProjectState {
            mode: initial_mode,
            path: initial_state_path,
        }));

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
            project,
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

    pub fn project_state(&self) -> ProjectState {
        self.project
            .read()
            .map(|s| s.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    pub async fn set_project(&self, mode: ProjectMode, db_path: Option<PathBuf>, save_last: bool) -> crate::error::Result<()> {
        if self.proxy.status().await.running {
            let _ = self.proxy.stop().await;
        }
        let _ = self.scanner.stop().await;
        let _ = self.intruder.stop().await;

        let next_path = match mode {
            ProjectMode::Temporary => temp_project_db_path(),
            ProjectMode::Project => db_path.ok_or_else(|| crate::error::AppError::InvalidInput("missing project path".into()))?,
        };

        if let Some(parent) = next_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        let next = Arc::new(SqliteStore::open_at(next_path.clone()).await.map_err(|e| crate::error::AppError::Other(e.to_string()))?);
        self.store.swap(next);
        let _ = self.extensions.ensure_seeded().await;

        if let Ok(mut w) = self.project.write() {
            *w = ProjectState {
                mode: mode.clone(),
                path: if matches!(mode, ProjectMode::Project) { Some(next_path.clone()) } else { None },
            };
        }

        if save_last {
            let mut cfg = load_session_config(&self.app).await;
            cfg.last_project_path = if matches!(mode, ProjectMode::Project) {
                Some(next_path.to_string_lossy().to_string())
            } else {
                cfg.last_project_path
            };
            let _ = save_session_config(&self.app, &cfg).await;
        }

        Ok(())
    }

    pub async fn set_temporary(&self) -> crate::error::Result<()> {
        self.set_project(ProjectMode::Temporary, None, false).await
    }

    pub async fn open_project(&self, db_path: PathBuf) -> crate::error::Result<()> {
        self.set_project(ProjectMode::Project, Some(db_path), true).await
    }
}
