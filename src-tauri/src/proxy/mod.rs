use std::{
    net::SocketAddr,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{
    body::Incoming,
    header::{HeaderName, CONNECTION, TE, TRAILER, TRANSFER_ENCODING, UPGRADE},
    http::uri::PathAndQuery,
    Method, Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
};
use tokio_rustls::TlsAcceptor;
use url::Url;
use uuid::Uuid;
use regex::Regex;

use crate::{
    error::{AppError, Result},
    events::{now_ms, BackendEvent, EventBus},
    http_types::{HeaderPair, ProxyRequest, ProxyResponse},
    intercept::{apply_raw_edit, InterceptManager, InterceptDecision},
    rules::RuleSet,
    settings::SettingsManager,
    storage::StoreHandle,
    tls::TlsManager,
};

pub struct ProxyManager {
    engine: Arc<ProxyEngine>,
    running: Mutex<Option<RunningProxy>>,
}

struct RunningProxy {
    bind: SocketAddr,
    stop: oneshot::Sender<()>,
    thread: thread::JoinHandle<()>,
}

impl ProxyManager {
    pub fn new(engine: Arc<ProxyEngine>) -> Self {
        Self {
            engine,
            running: Mutex::new(None),
        }
    }

    pub fn engine(&self) -> Arc<ProxyEngine> {
        self.engine.clone()
    }

    pub async fn start(&self, port: u16) -> Result<SocketAddr> {
        let mut lock = self.running.lock().await;
        if lock.is_some() {
            return Err(AppError::ProxyAlreadyRunning);
        }

        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
        let (addr_tx, addr_rx) = oneshot::channel::<SocketAddr>();
        let engine = self.engine.clone();

        let thread = thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(_) => return,
            };

            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let bind = SocketAddr::from(([127, 0, 0, 1], port));
                let listener = match TcpListener::bind(bind).await {
                    Ok(l) => l,
                    Err(_) => return,
                };

                let bind = match listener.local_addr() {
                    Ok(a) => a,
                    Err(_) => return,
                };
                let _ = addr_tx.send(bind);

                loop {
                    tokio::select! {
                        _ = &mut stop_rx => break,
                        accept = listener.accept() => {
                            let Ok((stream, peer)) = accept else { continue };
                            let engine = engine.clone();
                            tokio::task::spawn_local(async move {
                                if let Err(e) = engine.serve_plain_connection(stream, peer).await {
                                    tracing::debug!(error = %e, "connection terminated with error");
                                }
                            });
                        }
                    }
                }
            });
        });

        let bind = addr_rx
            .await
            .map_err(|_| AppError::Other("failed to start proxy listener".into()))?;

        *lock = Some(RunningProxy {
            bind,
            stop: stop_tx,
            thread,
        });

        self.engine
            .events
            .emit(BackendEvent::proxy_status_changed(true, Some(bind.to_string())));

        Ok(bind)
    }

    pub async fn stop(&self) -> Result<()> {
        let mut lock = self.running.lock().await;
        let running = lock.take().ok_or(AppError::ProxyNotRunning)?;
        let _ = running.stop.send(());
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = running.thread.join();
        })
        .await;

        self.engine
            .events
            .emit(BackendEvent::proxy_status_changed(false, None));

        Ok(())
    }

    pub async fn status(&self) -> ProxyStatus {
        let lock = self.running.lock().await;
        match lock.as_ref() {
            Some(r) => ProxyStatus {
                running: true,
                bind: Some(r.bind.to_string()),
            },
            None => ProxyStatus {
                running: false,
                bind: None,
            },
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub bind: Option<String>,
}

pub struct ProxyEngine {
    _app: tauri::AppHandle,
    pub events: EventBus,
    store: StoreHandle,
    settings: Arc<SettingsManager>,
    rules: Arc<RuleSet>,
    tls: Arc<TlsManager>,
    intercept: Arc<InterceptManager>,
    client: reqwest::Client,
}

#[derive(Clone)]
struct ConnCtx {
    forced_scheme: Option<String>,
    forced_host: Option<String>,
}

impl ProxyEngine {
    pub fn new(
        app: tauri::AppHandle,
        events: EventBus,
        store: StoreHandle,
        settings: Arc<SettingsManager>,
        rules: Arc<RuleSet>,
        tls: Arc<TlsManager>,
        intercept: Arc<InterceptManager>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            _app: app,
            events,
            store,
            settings,
            rules,
            tls,
            intercept,
            client,
        }
    }

    pub async fn serve_plain_connection(&self, stream: TcpStream, _peer: SocketAddr) -> Result<()> {
        let io = TokioIo::new(stream);
        let engine = Arc::new(self.clone_shallow());
        let ctx = ConnCtx {
            forced_scheme: None,
            forced_host: None,
        };

        let svc = hyper::service::service_fn(move |req| {
            let svc = ProxyService {
                engine: engine.clone(),
                ctx: ctx.clone(),
            };
            svc.handle(req)
        });

        hyper::server::conn::http1::Builder::new()
            .preserve_header_case(true)
            .title_case_headers(true)
            .serve_connection(io, svc)
            .with_upgrades()
            .await
            .map_err(|e| AppError::Other(format!("http serve: {e}")))?;

        Ok(())
    }

    fn clone_shallow(&self) -> Self {
        Self {
            _app: self._app.clone(),
            events: self.events.clone(),
            store: self.store.clone(),
            settings: self.settings.clone(),
            rules: self.rules.clone(),
            tls: self.tls.clone(),
            intercept: self.intercept.clone(),
            client: self.client.clone(),
        }
    }

    async fn serve_mitm_connection(&self, stream: impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static, host: String) -> Result<()> {
        let io = TokioIo::new(stream);
        let engine = Arc::new(self.clone_shallow());
        let ctx = ConnCtx {
            forced_scheme: Some("https".into()),
            forced_host: Some(host),
        };

        let svc = hyper::service::service_fn(move |req| {
            let svc = ProxyService {
                engine: engine.clone(),
                ctx: ctx.clone(),
            };
            svc.handle(req)
        });

        hyper::server::conn::http1::Builder::new()
            .preserve_header_case(true)
            .title_case_headers(true)
            .serve_connection(io, svc)
            .with_upgrades()
            .await
            .map_err(|e| AppError::Other(format!("mitm http serve: {e}")))?;

        Ok(())
    }
}

#[derive(Clone)]
struct ProxyService {
    engine: Arc<ProxyEngine>,
    ctx: ConnCtx,
}

impl ProxyService {
    async fn handle(self, req: Request<Incoming>) -> std::result::Result<Response<Full<Bytes>>, hyper::Error> {
        let res = match *req.method() {
            Method::CONNECT => self.handle_connect(req).await,
            _ => self.handle_forward(req).await,
        };

        Ok(match res {
            Ok(r) => r,
            Err(e) => error_response(&e),
        })
    }

    async fn handle_connect(&self, req: Request<Incoming>) -> Result<Response<Full<Bytes>>> {
        let started_ms = now_ms();
        let id = Uuid::new_v4();

        let authority = req
            .uri()
            .authority()
            .ok_or_else(|| AppError::InvalidInput("CONNECT missing authority".into()))?
            .as_str()
            .to_string();

        let host = authority
            .split(':')
            .next()
            .unwrap_or("")
            .to_string();

        let proxy_req = ProxyRequest {
            id,
            started_ms,
            scheme: "https".into(),
            host: host.clone(),
            method: "CONNECT".into(),
            url: format!("https://{authority}/"),
            headers: headers_to_pairs(req.headers()),
            body: Vec::new(),
        };

        self.engine.events.emit(BackendEvent::RequestCaptured {
            ts_ms: started_ms,
            id: id.to_string(),
            method: proxy_req.method.clone(),
            url: proxy_req.url.clone(),
            host: proxy_req.host.clone(),
            scheme: proxy_req.scheme.clone(),
            request_bytes: 0,
            preview_base64: String::new(),
        });

        let proxy_resp = ProxyResponse {
            status: 200,
            headers: Vec::new(),
            body: Vec::new(),
            elapsed_ms: 0,
        };

        let store = self.engine.store.get();
        store.insert(&proxy_req, Some(&proxy_resp), None).await?;

        self.engine.events.emit(BackendEvent::ResponseReceived {
            ts_ms: now_ms(),
            id: id.to_string(),
            status: 200,
            response_bytes: 0,
            preview_base64: String::new(),
            elapsed_ms: 0,
        });

        let mitm_enabled = self.engine.tls.mitm_enabled().await;
        if !mitm_enabled {
            return self.tunnel_passthrough(req, authority).await;
        }

        let cfg = match self.engine.tls.server_config_for_host(&host).await {
            Ok(cfg) => cfg,
            Err(e) => {
                self.engine.tls.emit_tls_handshake(
                    host,
                    "passthrough".into(),
                    false,
                    Some(e.to_string()),
                );
                return self.tunnel_passthrough(req, authority).await;
            }
        };

        let acceptor = TlsAcceptor::from(cfg);
        let engine = self.engine.clone();
        let authority_clone = authority.clone();
        let on_upgrade = hyper::upgrade::on(req);
        tokio::task::spawn_local(async move {
            match on_upgrade.await {
                Ok(upgraded) => match acceptor.accept(TokioIo::new(upgraded)).await {
                    Ok(tls_stream) => {
                        engine.tls.emit_tls_handshake(host, "mitm".into(), true, None);
                        let _ = engine.serve_mitm_connection(tls_stream, authority_clone).await;
                    }
                    Err(e) => {
                        engine
                            .tls
                            .emit_tls_handshake(host, "mitm".into(), false, Some(e.to_string()));
                    }
                },
                Err(_) => {}
            }
        });

        Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::new(Bytes::new()))?)
    }

    async fn tunnel_passthrough(&self, req: Request<Incoming>, authority: String) -> Result<Response<Full<Bytes>>> {
        let on_upgrade = hyper::upgrade::on(req);
        tokio::task::spawn_local(async move {
            if let Ok(upgraded) = on_upgrade.await {
                let _ = tunnel_bytes(upgraded, authority).await;
            }
        });

        Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::new(Bytes::new()))?)
    }

    async fn handle_forward(&self, req: Request<Incoming>) -> Result<Response<Full<Bytes>>> {
        let started_ms = now_ms();
        let started = Instant::now();
        let id = Uuid::new_v4();

        let (scheme, host, url) = resolve_target(&req, &self.ctx)?;
        let method = req.method().to_string();
        let headers = headers_to_pairs(req.headers());

        let body_bytes = req
            .into_body()
            .collect()
            .await
            .map_err(|e| AppError::Other(format!("read body: {e}")))?
            .to_bytes()
            .to_vec();

        let mut proxy_req = ProxyRequest {
            id,
            started_ms,
            scheme: scheme.clone(),
            host: host.clone(),
            method,
            url: url.clone(),
            headers,
            body: body_bytes,
        };

        let preview = preview_b64(&proxy_req.body);
        self.engine.events.emit(BackendEvent::RequestCaptured {
            ts_ms: started_ms,
            id: id.to_string(),
            method: proxy_req.method.clone(),
            url: proxy_req.url.clone(),
            host: host.clone(),
            scheme: scheme.clone(),
            request_bytes: proxy_req.body.len(),
            preview_base64: preview,
        });

        let in_scope = self
            .engine
            .settings
            .get()
            .await
            .ok()
            .map(|s| host_in_scope(&host, &s.scope_regex))
            .unwrap_or(true);

        if in_scope {
            if let Some(decision) = self.engine.intercept.pause_request(&proxy_req).await? {
                match decision {
                    InterceptDecision::Forward { edited_raw } => {
                        if let Some(raw) = edited_raw {
                            proxy_req = apply_raw_edit(proxy_req, &raw)?;
                        }
                    }
                    InterceptDecision::Drop => {
                        let reason = "dropped by intercept".to_string();
                        let store = self.engine.store.get();
                        store.insert(&proxy_req, None, Some(&reason)).await?;
                        return Ok(Response::builder()
                            .status(StatusCode::FORBIDDEN)
                            .body(Full::new(Bytes::from(reason)))?);
                    }
                }
            }
        }

        let decision = self.engine.rules.apply_request(&mut proxy_req).await;
        if decision.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(decision.delay_ms)).await;
        }
        if let Some(reason) = decision.blocked_reason {
            let store = self.engine.store.get();
            store.insert(&proxy_req, None, Some(&reason)).await?;
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Full::new(Bytes::from(reason)))?);
        }

        let upstream = self.engine.send_upstream(&proxy_req).await;
        match upstream {
            Ok(mut proxy_resp) => {
                self.engine
                    .rules
                    .apply_response(proxy_req.id, proxy_req.started_ms, &mut proxy_resp)
                    .await;

                let preview = preview_b64(&proxy_resp.body);
                self.engine.events.emit(BackendEvent::ResponseReceived {
                    ts_ms: now_ms(),
                    id: id.to_string(),
                    status: proxy_resp.status,
                    response_bytes: proxy_resp.body.len(),
                    preview_base64: preview,
                    elapsed_ms: proxy_resp.elapsed_ms,
                });

                let store = self.engine.store.get();
                store.insert(&proxy_req, Some(&proxy_resp), None).await?;

                Ok(build_client_response(&proxy_resp)?)
            }
            Err(e) => {
                let err = e.to_string();
                let store = self.engine.store.get();
                store.insert(&proxy_req, None, Some(&err)).await?;
                let elapsed = started.elapsed().as_millis() as u64;
                self.engine.events.emit(BackendEvent::ResponseReceived {
                    ts_ms: now_ms(),
                    id: id.to_string(),
                    status: 0,
                    response_bytes: 0,
                    preview_base64: "".into(),
                    elapsed_ms: elapsed,
                });
                Ok(Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Full::new(Bytes::from(err)))?)
            }
        }
    }
}

impl ProxyEngine {
    async fn send_upstream(&self, req: &ProxyRequest) -> Result<ProxyResponse> {
        let started = Instant::now();

        let method = reqwest::Method::from_bytes(req.method.as_bytes())
            .map_err(|_| AppError::InvalidInput(format!("unsupported method {}", req.method)))?;

        let mut builder = self.client.request(method, &req.url).body(req.body.clone());

        for h in &req.headers {
            if is_hop_header(&h.name) {
                continue;
            }
            if h.name.eq_ignore_ascii_case("host") {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(h.name.as_bytes()),
                reqwest::header::HeaderValue::from_str(&h.value),
            ) {
                builder = builder.header(name, value);
            }
        }

        let resp = builder.send().await?;
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .map(|(k, v)| HeaderPair {
                name: k.as_str().to_string(),
                value: v.to_str().unwrap_or("").to_string(),
            })
            .collect::<Vec<_>>();
        let body = resp.bytes().await?.to_vec();

        Ok(ProxyResponse {
            status,
            headers,
            body,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    pub async fn replay(&self, mut original: ProxyRequest) -> Result<Uuid> {
        original.id = Uuid::new_v4();
        original.started_ms = now_ms();

        self.events.emit(BackendEvent::RequestCaptured {
            ts_ms: original.started_ms,
            id: original.id.to_string(),
            method: original.method.clone(),
            url: original.url.clone(),
            host: original.host.clone(),
            scheme: original.scheme.clone(),
            request_bytes: original.body.len(),
            preview_base64: preview_b64(&original.body),
        });

        let decision = self.rules.apply_request(&mut original).await;
        if decision.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(decision.delay_ms)).await;
        }
        if let Some(reason) = decision.blocked_reason {
            let store = self.store.get();
            store.insert(&original, None, Some(&reason)).await?;
            return Ok(original.id);
        }

        let mut resp = self.send_upstream(&original).await?;
        self.rules
            .apply_response(original.id, original.started_ms, &mut resp)
            .await;

        self.events.emit(BackendEvent::ResponseReceived {
            ts_ms: now_ms(),
            id: original.id.to_string(),
            status: resp.status,
            response_bytes: resp.body.len(),
            preview_base64: preview_b64(&resp.body),
            elapsed_ms: resp.elapsed_ms,
        });

        let store = self.store.get();
        store.insert(&original, Some(&resp), None).await?;
        Ok(original.id)
    }
}

fn build_client_response(resp: &ProxyResponse) -> Result<Response<Full<Bytes>>> {
    let mut builder = Response::builder().status(StatusCode::from_u16(resp.status).unwrap_or(StatusCode::OK));
    {
        let headers = builder.headers_mut().ok_or_else(|| AppError::Other("response builder headers".into()))?;
        for h in &resp.headers {
            if is_hop_header(&h.name) {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(h.name.as_bytes()),
                hyper::header::HeaderValue::from_str(&h.value),
            ) {
                headers.insert(name, value);
            }
        }
    }
    Ok(builder.body(Full::new(Bytes::from(resp.body.clone())))?)
}

fn error_response(err: &AppError) -> Response<Full<Bytes>> {
    let body = err.to_string();
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .body(Full::new(Bytes::from(body)))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::new())))
}

fn preview_b64(bytes: &[u8]) -> String {
    let n = bytes.len().min(1024);
    if n == 0 {
        return String::new();
    }
    B64.encode(&bytes[..n])
}

fn headers_to_pairs(headers: &hyper::HeaderMap) -> Vec<HeaderPair> {
    headers
        .iter()
        .map(|(k, v)| HeaderPair {
            name: k.as_str().to_string(),
            value: v.to_str().unwrap_or("").to_string(),
        })
        .collect()
}

fn is_hop_header(name: &str) -> bool {
    name.eq_ignore_ascii_case(CONNECTION.as_str())
        || name.eq_ignore_ascii_case("proxy-connection")
        || name.eq_ignore_ascii_case(TE.as_str())
        || name.eq_ignore_ascii_case(TRAILER.as_str())
        || name.eq_ignore_ascii_case(TRANSFER_ENCODING.as_str())
        || name.eq_ignore_ascii_case(UPGRADE.as_str())
        || name.eq_ignore_ascii_case("keep-alive")
}

fn host_in_scope(host: &str, scope_regex: &str) -> bool {
    let lines = scope_regex
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return false;
    }
    for line in lines {
        if let Ok(re) = Regex::new(line) {
            if re.is_match(host) {
                return true;
            }
        }
    }
    false
}

fn resolve_target(req: &Request<Incoming>, ctx: &ConnCtx) -> Result<(String, String, String)> {
    if let (Some(scheme), Some(host)) = (&ctx.forced_scheme, &ctx.forced_host) {
        let pq: PathAndQuery = req
            .uri()
            .path_and_query()
            .cloned()
            .unwrap_or_else(|| PathAndQuery::from_static("/"));
        let url = format!("{}://{}{}", scheme, host, pq);
        return Ok((scheme.clone(), host.clone(), url));
    }

    if req.uri().scheme().is_some() {
        let url = req.uri().to_string();
        let parsed =
            Url::parse(&url).map_err(|e| AppError::InvalidInput(format!("invalid url: {e}")))?;
        let scheme = parsed.scheme().to_string();
        let host = parsed
            .host_str()
            .ok_or_else(|| AppError::InvalidInput("missing host".into()))?
            .to_string();
        let host = if let Some(port) = parsed.port() {
            format!("{}:{}", host, port)
        } else {
            host
        };
        return Ok((scheme, host, url));
    }

    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::InvalidInput("missing host header".into()))?
        .to_string();

    let pq: PathAndQuery = req
        .uri()
        .path_and_query()
        .cloned()
        .unwrap_or_else(|| PathAndQuery::from_static("/"));
    let url = format!("http://{}{}", host, pq);
    Ok(("http".into(), host, url))
}

async fn tunnel_bytes(client: hyper::upgrade::Upgraded, authority: String) -> Result<()> {
    let mut client = TokioIo::new(client);
    let mut upstream = TcpStream::connect(&authority).await?;
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}
