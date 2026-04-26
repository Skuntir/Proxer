use std::{path::PathBuf, sync::Arc};

use dashmap::DashMap;
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    ServerConfig,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::sync::RwLock;

use crate::{
    error::{AppError, Result},
    events::{BackendEvent, EventBus},
};

pub struct TlsManager {
    app: AppHandle,
    events: EventBus,
    mitm_enabled: RwLock<bool>,
    ca: RwLock<Option<Arc<CertificateAuthority>>>,
    leaf_cache: DashMap<String, Arc<ServerConfig>>,
}

impl TlsManager {
    pub async fn load_or_empty(app: AppHandle, events: EventBus) -> tauri::Result<Self> {
        let mgr = Self {
            app,
            events,
            mitm_enabled: RwLock::new(false),
            ca: RwLock::new(None),
            leaf_cache: DashMap::new(),
        };

        let app = mgr.app.clone();
        if let Ok(paths) = ca_paths(&app) {
            if tokio::fs::try_exists(&paths.cert_pem).await.unwrap_or(false)
                && tokio::fs::try_exists(&paths.key_pem).await.unwrap_or(false)
            {
                if let (Ok(cert_pem), Ok(key_pem)) = (
                    tokio::fs::read_to_string(&paths.cert_pem).await,
                    tokio::fs::read_to_string(&paths.key_pem).await,
                ) {
                    if let Ok(ca) = CertificateAuthority::load_existing(paths, &cert_pem, &key_pem) {
                        let mut lock = mgr.ca.write().await;
                        *lock = Some(Arc::new(ca));
                    }
                }
            }
        }

        Ok(mgr)
    }

    pub async fn mitm_enabled(&self) -> bool {
        *self.mitm_enabled.read().await
    }

    pub async fn set_mitm_enabled(&self, enabled: bool) -> Result<()> {
        if enabled && self.ca.read().await.is_none() {
            return Err(AppError::MitmNoCa);
        }
        *self.mitm_enabled.write().await = enabled;
        Ok(())
    }

    pub async fn ca_info(&self) -> Option<CaInfo> {
        let ca = self.ca.read().await.clone()?;
        Some(CaInfo {
            cert_pem_path: ca.cert_pem_path.clone(),
        })
    }

    pub async fn generate_ca(&self) -> Result<CaInfo> {
        let app = self.app.clone();
        let paths = ca_paths(&app).map_err(|e| AppError::Other(e.to_string()))?;

        if let Some(parent) = paths.cert_pem.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let ca = tauri::async_runtime::spawn_blocking(move || CertificateAuthority::generate(paths))
            .await
            .map_err(|e| AppError::Other(format!("CA generation task failed: {e}")))??;

        tokio::fs::write(&ca.cert_pem_path, ca.cert_pem.as_bytes()).await?;
        tokio::fs::write(&ca.key_pem_path, ca.key_pem.as_bytes()).await?;

        let mut lock = self.ca.write().await;
        *lock = Some(Arc::new(ca));
        self.leaf_cache.clear();

        Ok(self.ca_info().await.ok_or_else(|| AppError::Other("failed to store CA".into()))?)
    }

    pub async fn import_ca_pem(&self, cert_pem: &str, key_pem: &str) -> Result<CaInfo> {
        let app = self.app.clone();
        let paths = ca_paths(&app).map_err(|e| AppError::Other(e.to_string()))?;
        if let Some(parent) = paths.cert_pem.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&paths.cert_pem, cert_pem.as_bytes()).await?;
        tokio::fs::write(&paths.key_pem, key_pem.as_bytes()).await?;

        let ca = CertificateAuthority::load_existing(paths, cert_pem, key_pem)?;
        let mut lock = self.ca.write().await;
        *lock = Some(Arc::new(ca));
        self.leaf_cache.clear();
        Ok(self.ca_info().await.ok_or_else(|| AppError::Other("failed to store CA".into()))?)
    }

    pub async fn server_config_for_host(&self, host: &str) -> Result<Arc<ServerConfig>> {
        if let Some(cfg) = self.leaf_cache.get(host).map(|v| v.clone()) {
            return Ok(cfg);
        }

        let ca = self.ca.read().await.clone().ok_or(AppError::MitmNoCa)?;
        let host = host.to_string();
        let host_for_task = host.clone();
        let cfg = tauri::async_runtime::spawn_blocking(move || ca.server_config_for_host(&host_for_task))
            .await
            .map_err(|e| AppError::Other(format!("leaf cert task failed: {e}")))??;

        let cfg = Arc::new(cfg);
        self.leaf_cache.insert(host, cfg.clone());
        Ok(cfg)
    }

    pub async fn export_ca_pem(&self) -> Result<String> {
        let info = self.ca_info().await.ok_or(AppError::MitmNoCa)?;
        let pem = tokio::fs::read_to_string(&info.cert_pem_path).await?;
        Ok(pem)
    }

    pub async fn export_ca_der(&self) -> Result<Vec<u8>> {
        let pem = self.export_ca_pem().await?;
        let cert = pem::parse(pem).map_err(|e| AppError::Tls(format!("parse CA pem: {e}")))?;
        Ok(cert.contents().to_vec())
    }

    pub fn emit_tls_handshake(&self, host: String, mode: String, ok: bool, error: Option<String>) {
        self.events.emit(BackendEvent::TlsHandshake {
            ts_ms: crate::events::now_ms(),
            host,
            mode,
            ok,
            error,
        });
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CaInfo {
    pub cert_pem_path: String,
}

struct CaPaths {
    cert_pem: PathBuf,
    key_pem: PathBuf,
}

fn ca_paths(app: &AppHandle) -> tauri::Result<CaPaths> {
    let cert_pem = app.path().resolve("proxer/ca.pem", BaseDirectory::AppData)?;
    let key_pem = app
        .path()
        .resolve("proxer/ca-key.pem", BaseDirectory::AppData)?;
    Ok(CaPaths { cert_pem, key_pem })
}

pub struct CertificateAuthority {
    cert: rcgen::Certificate,
    key: rcgen::KeyPair,
    cert_pem: String,
    key_pem: String,
    cert_der: Vec<u8>,
    cert_pem_path: String,
    key_pem_path: PathBuf,
}

impl CertificateAuthority {
    fn generate(paths: CaPaths) -> Result<Self> {
        let key = rcgen::KeyPair::generate()
            .map_err(|e| AppError::Tls(format!("generate CA key: {e}")))?;

        let mut params = rcgen::CertificateParams::new(Vec::<String>::new())
            .map_err(|e| AppError::Tls(format!("rcgen params: {e}")))?;
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Proxer Local CA");
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::KeyCertSign,
            rcgen::KeyUsagePurpose::DigitalSignature,
            rcgen::KeyUsagePurpose::CrlSign,
        ];

        let cert = params
            .self_signed(&key)
            .map_err(|e| AppError::Tls(format!("rcgen CA: {e}")))?;
        let cert_der = cert.der().to_vec();
        let cert_pem = cert.pem();
        let key_pem = key.serialize_pem();

        Ok(Self {
            cert,
            key,
            cert_pem,
            key_pem,
            cert_der,
            cert_pem_path: paths.cert_pem.to_string_lossy().to_string(),
            key_pem_path: paths.key_pem,
        })
    }

    fn load_existing(paths: CaPaths, cert_pem: &str, key_pem: &str) -> Result<Self> {
        let key = rcgen::KeyPair::from_pem(key_pem)
            .map_err(|e| AppError::Tls(format!("parse CA key: {e}")))?;
        let params = rcgen::CertificateParams::from_ca_cert_pem(cert_pem)
            .map_err(|e| AppError::Tls(format!("parse CA cert: {e}")))?;

        let cert = params
            .self_signed(&key)
            .map_err(|e| AppError::Tls(format!("rcgen CA load: {e}")))?;

        let cert_der = pem::parse(cert_pem)
            .map_err(|e| AppError::Tls(format!("parse CA cert pem: {e}")))?
            .contents()
            .to_vec();

        Ok(Self {
            cert,
            key,
            cert_pem: cert_pem.to_string(),
            key_pem: key_pem.to_string(),
            cert_der,
            cert_pem_path: paths.cert_pem.to_string_lossy().to_string(),
            key_pem_path: paths.key_pem,
        })
    }

    fn server_config_for_host(&self, host: &str) -> Result<ServerConfig> {
        let leaf_key = rcgen::KeyPair::generate()
            .map_err(|e| AppError::Tls(format!("generate leaf key: {e}")))?;

        let mut params = rcgen::CertificateParams::new(vec![host.to_string()])
            .map_err(|e| AppError::Tls(format!("leaf params: {e}")))?;
        params.is_ca = rcgen::IsCa::NoCa;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, host);
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::DigitalSignature,
            rcgen::KeyUsagePurpose::KeyEncipherment,
        ];

        let leaf = params
            .signed_by(&leaf_key, &self.cert, &self.key)
            .map_err(|e| AppError::Tls(format!("leaf sign: {e}")))?;

        let key_der = leaf_key.serialize_der().to_vec();
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der));
        let chain = vec![
            CertificateDer::from(leaf.der().to_vec()),
            CertificateDer::from(self.cert_der.clone()),
        ];

        let cfg = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(chain, key)
            .map_err(|e| AppError::Tls(format!("rustls server config: {e}")))?;

        Ok(cfg)
    }
}
