use std::{
    fmt::Debug,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{
    body::Incoming,
    header::{
        HeaderName, CONNECTION, SEC_WEBSOCKET_ACCEPT, SEC_WEBSOCKET_KEY, TE, TRAILER,
        TRANSFER_ENCODING, UPGRADE,
    },
    http::uri::PathAndQuery,
    Method, Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use sha1::{Digest, Sha1};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
};
use tokio_rustls::{TlsAcceptor, TlsConnector};
use tokio_socks::tcp::Socks5Stream;
use url::Url;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    events::{now_ms, BackendEvent, EventBus},
    fingerprint,
    http_types::{HeaderPair, ProxyRequest, ProxyResponse},
    intercept::{apply_raw_edit, InterceptDecision, InterceptManager},
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

        self.engine.events.emit(BackendEvent::proxy_status_changed(
            true,
            Some(bind.to_string()),
        ));

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
    persisted_count: Arc<AtomicU64>,
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
        Self {
            _app: app,
            events,
            store,
            settings,
            rules,
            tls,
            intercept,
            persisted_count: Arc::new(AtomicU64::new(0)),
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
            persisted_count: self.persisted_count.clone(),
        }
    }

    async fn serve_mitm_connection(
        &self,
        stream: impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        host: String,
    ) -> Result<()> {
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
    async fn handle(
        self,
        req: Request<Incoming>,
    ) -> std::result::Result<Response<Full<Bytes>>, hyper::Error> {
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

        let host = authority.split(':').next().unwrap_or("").to_string();

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

        self.engine
            .persist_traffic(&proxy_req, Some(&proxy_resp), None)
            .await?;

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
            if let Ok(upgraded) = on_upgrade.await {
                match acceptor.accept(TokioIo::new(upgraded)).await {
                    Ok(tls_stream) => {
                        engine
                            .tls
                            .emit_tls_handshake(host, "mitm".into(), true, None);
                        let _ = engine
                            .serve_mitm_connection(tls_stream, authority_clone)
                            .await;
                    }
                    Err(e) => {
                        engine.tls.emit_tls_handshake(
                            host,
                            "mitm".into(),
                            false,
                            Some(e.to_string()),
                        );
                    }
                }
            }
        });

        Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::new(Bytes::new()))?)
    }

    async fn tunnel_passthrough(
        &self,
        req: Request<Incoming>,
        authority: String,
    ) -> Result<Response<Full<Bytes>>> {
        let on_upgrade = hyper::upgrade::on(req);
        let engine = self.engine.clone();
        tokio::task::spawn_local(async move {
            if let Ok(upgraded) = on_upgrade.await {
                let _ = engine.tunnel_bytes(upgraded, authority).await;
            }
        });

        Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::new(Bytes::new()))?)
    }

    async fn handle_forward(&self, mut req: Request<Incoming>) -> Result<Response<Full<Bytes>>> {
        let started_ms = now_ms();
        let started = Instant::now();
        let id = Uuid::new_v4();

        let (scheme, host, url) = resolve_target(&req, &self.ctx)?;
        let method = req.method().to_string();
        let headers = headers_to_pairs(req.headers());
        let websocket_upgrade = is_websocket_upgrade(&headers);
        let on_upgrade = if websocket_upgrade {
            Some(hyper::upgrade::on(&mut req))
        } else {
            None
        };

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

        if let Some(decision) = self.engine.intercept.pause_request(&proxy_req).await? {
            match decision {
                InterceptDecision::Forward { edited_raw } => {
                    if let Some(raw) = edited_raw {
                        proxy_req = apply_raw_edit(proxy_req, &raw)?;
                    }
                }
                InterceptDecision::Drop => {
                    let reason = "dropped by intercept".to_string();
                    self.engine.events.emit(BackendEvent::RequestCaptured {
                        ts_ms: started_ms,
                        id: id.to_string(),
                        method: proxy_req.method.clone(),
                        url: proxy_req.url.clone(),
                        host: proxy_req.host.clone(),
                        scheme: proxy_req.scheme.clone(),
                        request_bytes: proxy_req.body.len(),
                        preview_base64: preview_b64(&proxy_req.body),
                    });
                    self.engine
                        .persist_traffic(&proxy_req, None, Some(&reason))
                        .await?;
                    self.engine.events.emit(BackendEvent::ResponseReceived {
                        ts_ms: now_ms(),
                        id: id.to_string(),
                        status: StatusCode::FORBIDDEN.as_u16(),
                        response_bytes: reason.len(),
                        preview_base64: preview_b64(reason.as_bytes()),
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    });
                    return Ok(Response::builder()
                        .status(StatusCode::FORBIDDEN)
                        .body(Full::new(Bytes::from(reason)))?);
                }
            }
        }

        self.engine.events.emit(BackendEvent::RequestCaptured {
            ts_ms: started_ms,
            id: id.to_string(),
            method: proxy_req.method.clone(),
            url: proxy_req.url.clone(),
            host: proxy_req.host.clone(),
            scheme: proxy_req.scheme.clone(),
            request_bytes: proxy_req.body.len(),
            preview_base64: preview_b64(&proxy_req.body),
        });

        let decision = self.engine.rules.apply_request(&mut proxy_req).await;
        if decision.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(decision.delay_ms)).await;
        }
        if let Some(reason) = decision.blocked_reason {
            self.engine
                .persist_traffic(&proxy_req, None, Some(&reason))
                .await?;
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Full::new(Bytes::from(reason)))?);
        }

        if let Some(on_upgrade) = on_upgrade {
            return self.handle_websocket(proxy_req, started, on_upgrade).await;
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

                self.engine
                    .persist_traffic(&proxy_req, Some(&proxy_resp), None)
                    .await?;

                Ok(build_client_response(&proxy_resp)?)
            }
            Err(e) => {
                let err = e.to_string();
                self.engine
                    .persist_traffic(&proxy_req, None, Some(&err))
                    .await?;
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

    async fn handle_websocket(
        &self,
        proxy_req: ProxyRequest,
        started: Instant,
        on_upgrade: hyper::upgrade::OnUpgrade,
    ) -> Result<Response<Full<Bytes>>> {
        let upstream = self.engine.open_websocket_upstream(&proxy_req).await;
        match upstream {
            Ok(ws) => {
                let accept = websocket_accept_value(&proxy_req)
                    .ok_or_else(|| AppError::InvalidInput("missing Sec-WebSocket-Key".into()))?;
                let proxy_resp = ProxyResponse {
                    status: StatusCode::SWITCHING_PROTOCOLS.as_u16(),
                    headers: ws.response_headers.clone(),
                    body: Vec::new(),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                };
                self.engine.events.emit(BackendEvent::ResponseReceived {
                    ts_ms: now_ms(),
                    id: proxy_req.id.to_string(),
                    status: proxy_resp.status,
                    response_bytes: 0,
                    preview_base64: String::new(),
                    elapsed_ms: proxy_resp.elapsed_ms,
                });
                self.engine
                    .persist_traffic(&proxy_req, Some(&proxy_resp), None)
                    .await?;

                let mut builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
                {
                    let headers = builder
                        .headers_mut()
                        .ok_or_else(|| AppError::Other("response builder headers".into()))?;
                    headers.insert(
                        CONNECTION,
                        hyper::header::HeaderValue::from_static("Upgrade"),
                    );
                    headers.insert(
                        UPGRADE,
                        hyper::header::HeaderValue::from_static("websocket"),
                    );
                    headers.insert(
                        SEC_WEBSOCKET_ACCEPT,
                        hyper::header::HeaderValue::from_str(&accept)
                            .map_err(|e| AppError::Other(e.to_string()))?,
                    );
                    for h in &ws.response_headers {
                        if h.name.eq_ignore_ascii_case("sec-websocket-accept")
                            || h.name.eq_ignore_ascii_case(CONNECTION.as_str())
                            || h.name.eq_ignore_ascii_case(UPGRADE.as_str())
                            || is_hop_header(&h.name)
                        {
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

                let intercept = self.engine.intercept.clone();
                tokio::task::spawn_local(async move {
                    if let Ok(upgraded) = on_upgrade.await {
                        let (mut cr, mut cw) = tokio::io::split(TokioIo::new(upgraded));
                        let (mut ur, mut uw) = tokio::io::split(ws.stream);
                        let ic = intercept.clone();
                        let c2s = tokio::task::spawn_local(async move {
                            loop {
                                let frame = match ws_read_frame(&mut cr).await {
                                    Ok(f) => f,
                                    Err(_) => break,
                                };
                                let is_close = frame.opcode == 0x8;
                                let is_data = frame.opcode == 0x1 || frame.opcode == 0x2;
                                let frame = if is_data {
                                    let raw = if frame.opcode == 0x1 {
                                        format!("→ {}", String::from_utf8_lossy(&frame.payload))
                                    } else {
                                        format!("→ [binary] {}", B64.encode(&frame.payload))
                                    };
                                    match ic.pause_ws_frame(raw).await {
                                        Ok(Some(InterceptDecision::Forward { edited_raw })) => {
                                            if let Some(edited) = edited_raw {
                                                let body = edited
                                                    .strip_prefix("→ ")
                                                    .unwrap_or(&edited)
                                                    .as_bytes()
                                                    .to_vec();
                                                WsFrame { fin: frame.fin, opcode: frame.opcode, payload: body }
                                            } else {
                                                frame
                                            }
                                        }
                                        Ok(Some(InterceptDecision::Drop)) | Err(_) => break,
                                        Ok(None) => frame,
                                    }
                                } else {
                                    frame
                                };
                                let encoded = ws_encode_frame(&frame, Some([0x37, 0xfa, 0x21, 0x3d]));
                                if uw.write_all(&encoded).await.is_err() {
                                    break;
                                }
                                if is_close {
                                    break;
                                }
                            }
                        });
                        let s2c = tokio::task::spawn_local(async move {
                            loop {
                                let frame = match ws_read_frame(&mut ur).await {
                                    Ok(f) => f,
                                    Err(_) => break,
                                };
                                let is_close = frame.opcode == 0x8;
                                let encoded = ws_encode_frame(&frame, None);
                                if cw.write_all(&encoded).await.is_err() {
                                    break;
                                }
                                if is_close {
                                    break;
                                }
                            }
                        });
                        tokio::select! {
                            _ = c2s => {}
                            _ = s2c => {}
                        }
                    }
                });

                Ok(builder.body(Full::new(Bytes::new()))?)
            }
            Err(e) => {
                let err = e.to_string();
                self.engine
                    .persist_traffic(&proxy_req, None, Some(&err))
                    .await?;
                Ok(Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Full::new(Bytes::from(err)))?)
            }
        }
    }
}

struct WebSocketUpstream {
    stream: Box<dyn AsyncReadWrite>,
    response_headers: Vec<HeaderPair>,
}

trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncReadWrite for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

struct WsFrame {
    fin: bool,
    opcode: u8,
    payload: Vec<u8>,
}

async fn ws_read_frame<R: AsyncReadExt + Unpin>(reader: &mut R) -> Result<WsFrame> {
    let mut hdr = [0u8; 2];
    reader.read_exact(&mut hdr).await?;
    let fin = (hdr[0] & 0x80) != 0;
    let opcode = hdr[0] & 0x0f;
    let masked = (hdr[1] & 0x80) != 0;
    let len7 = (hdr[1] & 0x7f) as u64;
    let payload_len: u64 = match len7 {
        126 => {
            let mut b = [0u8; 2];
            reader.read_exact(&mut b).await?;
            u16::from_be_bytes(b) as u64
        }
        127 => {
            let mut b = [0u8; 8];
            reader.read_exact(&mut b).await?;
            u64::from_be_bytes(b)
        }
        n => n,
    };
    if payload_len > 16 * 1024 * 1024 {
        return Err(AppError::Other("ws frame too large".into()));
    }
    let masking_key = if masked {
        let mut k = [0u8; 4];
        reader.read_exact(&mut k).await?;
        Some(k)
    } else {
        None
    };
    let mut payload = vec![0u8; payload_len as usize];
    if !payload.is_empty() {
        reader.read_exact(&mut payload).await?;
    }
    if let Some(k) = masking_key {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= k[i & 3];
        }
    }
    Ok(WsFrame { fin, opcode, payload })
}

fn ws_encode_frame(frame: &WsFrame, masking_key: Option<[u8; 4]>) -> Vec<u8> {
    let plen = frame.payload.len();
    let mut out = Vec::with_capacity(14 + plen);
    out.push((if frame.fin { 0x80u8 } else { 0 }) | (frame.opcode & 0x0f));
    let mb = if masking_key.is_some() { 0x80u8 } else { 0 };
    if plen < 126 {
        out.push(mb | plen as u8);
    } else if plen <= 0xffff {
        out.push(mb | 126);
        out.extend_from_slice(&(plen as u16).to_be_bytes());
    } else {
        out.push(mb | 127);
        out.extend_from_slice(&(plen as u64).to_be_bytes());
    }
    if let Some(k) = masking_key {
        out.extend_from_slice(&k);
        for (i, &b) in frame.payload.iter().enumerate() {
            out.push(b ^ k[i & 3]);
        }
    } else {
        out.extend_from_slice(&frame.payload);
    }
    out
}

impl ProxyEngine {
    async fn send_upstream(&self, req: &ProxyRequest) -> Result<ProxyResponse> {
        let started = Instant::now();

        let method = reqwest::Method::from_bytes(req.method.as_bytes())
            .map_err(|_| AppError::InvalidInput(format!("unsupported method {}", req.method)))?;

        let settings = self.settings.get().await.unwrap_or_default();
        let timeout_secs = settings.request_timeout_seconds.clamp(1, 300) as u64;

        if settings.tls_fingerprint_enabled {
            let imp = fingerprint::primp_profile(&settings.tls_fingerprint_profile)?;
            let os = fingerprint::primp_os(&settings.tls_fingerprint_os)?;
            let mut builder = primp::Client::builder()
                .redirect(primp::redirect::Policy::none())
                .timeout(Duration::from_secs(timeout_secs))
                .connect_timeout(Duration::from_secs(timeout_secs))
                .impersonate(imp)
                .impersonate_os(os);
            if !settings.verify_certificates {
                builder = builder.danger_accept_invalid_certs(true);
            }
            if settings.upstream_proxy_enabled {
                if settings.upstream_proxy_url.trim().is_empty() {
                    return Err(AppError::InvalidInput(
                        "upstream proxy URL is required when upstream proxy is enabled".into(),
                    ));
                }
                let proxy = primp::Proxy::all(settings.upstream_proxy_url.trim())
                    .map_err(|e| AppError::InvalidInput(format!("invalid upstream proxy: {e}")))?;
                builder = builder.proxy(proxy);
            } else {
                builder = builder.no_proxy();
            }
            let client = builder
                .build()
                .map_err(|e| AppError::Other(format!("primp client: {e}")))?;
            let method = primp::Method::from_bytes(req.method.as_bytes()).map_err(|_| {
                AppError::InvalidInput(format!("unsupported method {}", req.method))
            })?;
            let mut builder = client
                .request(method, &req.url)
                .timeout(Duration::from_secs(timeout_secs))
                .body(req.body.clone());

            for h in &req.headers {
                if is_hop_header(&h.name) || h.name.eq_ignore_ascii_case("host") {
                    continue;
                }
                if let (Ok(name), Ok(value)) = (
                    primp::header::HeaderName::from_bytes(h.name.as_bytes()),
                    primp::header::HeaderValue::from_str(&h.value),
                ) {
                    builder = builder.header(name, value);
                }
            }

            let resp = builder
                .send()
                .await
                .map_err(|e| AppError::Other(format!("primp request: {e}")))?;
            let status = resp.status().as_u16();
            let headers = resp
                .headers()
                .iter()
                .map(|(k, v)| HeaderPair {
                    name: k.as_str().to_string(),
                    value: v.to_str().unwrap_or("").to_string(),
                })
                .collect::<Vec<_>>();
            let body = resp
                .bytes()
                .await
                .map_err(|e| AppError::Other(format!("primp body: {e}")))?
                .to_vec();

            return Ok(ProxyResponse {
                status,
                headers,
                body,
                elapsed_ms: started.elapsed().as_millis() as u64,
            });
        }

        let mut client_builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy();
        if !settings.verify_certificates {
            client_builder = client_builder.danger_accept_invalid_certs(true);
        }
        if settings.upstream_proxy_enabled {
            if settings.upstream_proxy_url.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "upstream proxy URL is required when upstream proxy is enabled".into(),
                ));
            }
            let proxy = reqwest::Proxy::all(settings.upstream_proxy_url.trim())
                .map_err(|e| AppError::InvalidInput(format!("invalid upstream proxy: {e}")))?;
            client_builder = client_builder.proxy(proxy);
        }
        let client = client_builder.build()?;

        let mut builder = client
            .request(method, &req.url)
            .timeout(Duration::from_secs(timeout_secs))
            .body(req.body.clone());

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

    async fn open_websocket_upstream(&self, req: &ProxyRequest) -> Result<WebSocketUpstream> {
        let settings = self.settings.get().await.unwrap_or_default();
        let parsed = Url::parse(&req.url)
            .map_err(|e| AppError::InvalidInput(format!("invalid websocket url: {e}")))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| AppError::InvalidInput("websocket URL missing host".into()))?;
        let port = parsed
            .port_or_known_default()
            .ok_or_else(|| AppError::InvalidInput("websocket URL missing port".into()))?;
        let authority = format!("{host}:{port}");
        let mut stream: Box<dyn AsyncReadWrite> = if settings.upstream_proxy_enabled {
            if settings.upstream_proxy_url.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "upstream proxy URL is required when upstream proxy is enabled".into(),
                ));
            }
            connect_via_upstream_proxy(&settings.upstream_proxy_url, &authority).await?
        } else {
            Box::new(TcpStream::connect(&authority).await?)
        };

        if parsed.scheme() == "https" || parsed.scheme() == "wss" {
            let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
                .map_err(|_| AppError::InvalidInput("invalid websocket SNI host".into()))?;
            let config = client_tls_config(settings.verify_certificates);
            let tls = TlsConnector::from(Arc::new(config))
                .connect(server_name, stream)
                .await
                .map_err(|e| AppError::Tls(e.to_string()))?;
            stream = Box::new(tls);
        }

        let raw = render_upstream_request(req, &parsed);
        stream.write_all(raw.as_bytes()).await?;
        stream.flush().await?;

        let response = read_http_head(&mut stream).await?;
        let (status, headers) = parse_response_head(&response)?;
        if status != StatusCode::SWITCHING_PROTOCOLS.as_u16() {
            return Err(AppError::Other(format!(
                "websocket upstream rejected upgrade with status {status}"
            )));
        }

        Ok(WebSocketUpstream {
            stream,
            response_headers: headers,
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
            self.persist_traffic(&original, None, Some(&reason)).await?;
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

        self.persist_traffic(&original, Some(&resp), None).await?;
        Ok(original.id)
    }

    async fn persist_traffic(
        &self,
        req: &ProxyRequest,
        resp: Option<&ProxyResponse>,
        error: Option<&str>,
    ) -> Result<()> {
        let store = self.store.get();
        store.insert(req, resp, error).await?;
        let count = self.persisted_count.fetch_add(1, Ordering::Relaxed) + 1;
        if !count.is_multiple_of(100) {
            return Ok(());
        }
        let max_rows = self
            .settings
            .get()
            .await
            .map(|s| s.max_history_items.clamp(100, 100_000))
            .unwrap_or(10_000);
        store.prune_traffic(max_rows).await?;
        Ok(())
    }
}

fn build_client_response(resp: &ProxyResponse) -> Result<Response<Full<Bytes>>> {
    let mut builder =
        Response::builder().status(StatusCode::from_u16(resp.status).unwrap_or(StatusCode::OK));
    {
        let headers = builder
            .headers_mut()
            .ok_or_else(|| AppError::Other("response builder headers".into()))?;
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

fn is_websocket_upgrade(headers: &[HeaderPair]) -> bool {
    let has_upgrade = headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case(UPGRADE.as_str()) && h.value.eq_ignore_ascii_case("websocket")
    });
    let has_connection_upgrade = headers.iter().any(|h| {
        h.name.eq_ignore_ascii_case(CONNECTION.as_str())
            && h.value
                .split(',')
                .any(|v| v.trim().eq_ignore_ascii_case("upgrade"))
    });
    has_upgrade && has_connection_upgrade
}

fn websocket_accept_value(req: &ProxyRequest) -> Option<String> {
    let key = req
        .headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(SEC_WEBSOCKET_KEY.as_str()))?
        .value
        .trim();
    let mut sha = Sha1::new();
    sha.update(key.as_bytes());
    sha.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    Some(B64.encode(sha.finalize()))
}

fn render_upstream_request(req: &ProxyRequest, parsed: &Url) -> String {
    let path = {
        let mut out = parsed.path().to_string();
        if out.is_empty() {
            out.push('/');
        }
        if let Some(q) = parsed.query() {
            out.push('?');
            out.push_str(q);
        }
        out
    };

    let mut out = String::new();
    out.push_str(&format!("{} {} HTTP/1.1\r\n", req.method, path));
    if !req
        .headers
        .iter()
        .any(|h| h.name.eq_ignore_ascii_case("host"))
    {
        out.push_str("Host: ");
        out.push_str(&req.host);
        out.push_str("\r\n");
    }
    for h in &req.headers {
        if h.name.eq_ignore_ascii_case("proxy-connection") {
            continue;
        }
        out.push_str(&h.name);
        out.push_str(": ");
        out.push_str(&h.value);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    out
}

async fn read_http_head(stream: &mut Box<dyn AsyncReadWrite>) -> Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0_u8; 1024];
    loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Err(AppError::Other(
                "upstream closed before response headers".into(),
            ));
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            return Ok(buf);
        }
        if buf.len() > 64 * 1024 {
            return Err(AppError::Other(
                "upstream response headers too large".into(),
            ));
        }
    }
}

fn parse_response_head(buf: &[u8]) -> Result<(u16, Vec<HeaderPair>)> {
    let end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| AppError::Other("invalid response head".into()))?;
    let head = String::from_utf8_lossy(&buf[..end]);
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| AppError::Other("invalid websocket response status".into()))?;
    let headers = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some(HeaderPair {
                name: name.trim().to_string(),
                value: value.trim().to_string(),
            })
        })
        .collect();
    Ok((status, headers))
}

async fn connect_via_upstream_proxy(
    proxy_url: &str,
    authority: &str,
) -> Result<Box<dyn AsyncReadWrite>> {
    let proxy = Url::parse(proxy_url)
        .map_err(|_| AppError::InvalidInput("invalid upstream proxy URL".into()))?;
    match proxy.scheme() {
        "http" | "https" => {
            let host = proxy
                .host_str()
                .ok_or_else(|| AppError::InvalidInput("upstream proxy missing host".into()))?;
            let port = proxy
                .port_or_known_default()
                .unwrap_or(if proxy.scheme() == "https" { 443 } else { 80 });
            let mut stream: Box<dyn AsyncReadWrite> =
                Box::new(TcpStream::connect(format!("{host}:{port}")).await?);
            if proxy.scheme() == "https" {
                let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
                    .map_err(|_| {
                        AppError::InvalidInput("invalid upstream proxy SNI host".into())
                    })?;
                let tls = TlsConnector::from(Arc::new(client_tls_config(true)))
                    .connect(server_name, stream)
                    .await
                    .map_err(|e| AppError::Tls(e.to_string()))?;
                stream = Box::new(tls);
            }

            let auth = proxy_auth_header(&proxy);
            let mut req = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
            if let Some(auth) = auth {
                req.push_str("Proxy-Authorization: Basic ");
                req.push_str(&auth);
                req.push_str("\r\n");
            }
            req.push_str("\r\n");
            stream.write_all(req.as_bytes()).await?;
            stream.flush().await?;
            let head = read_http_head(&mut stream).await?;
            let (status, _) = parse_response_head(&head)?;
            if status / 100 != 2 {
                return Err(AppError::Other(format!(
                    "upstream proxy CONNECT failed with status {status}"
                )));
            }
            Ok(stream)
        }
        "socks5" | "socks5h" => {
            let proxy_host = proxy
                .host_str()
                .ok_or_else(|| AppError::InvalidInput("upstream proxy missing host".into()))?;
            let proxy_port = proxy.port_or_known_default().unwrap_or(1080);
            let user = proxy.username();
            let pass = proxy.password().unwrap_or("");
            let proxy_addr = format!("{proxy_host}:{proxy_port}");
            let stream = if user.is_empty() {
                Socks5Stream::connect(proxy_addr.as_str(), authority)
                    .await
                    .map_err(|e| AppError::Other(format!("SOCKS upstream connect failed: {e}")))?
            } else {
                Socks5Stream::connect_with_password(proxy_addr.as_str(), authority, user, pass)
                    .await
                    .map_err(|e| AppError::Other(format!("SOCKS upstream connect failed: {e}")))?
            };
            Ok(Box::new(stream.into_inner()))
        }
        _ => Err(AppError::InvalidInput(
            "unsupported upstream proxy scheme".into(),
        )),
    }
}

fn proxy_auth_header(proxy: &Url) -> Option<String> {
    let user = proxy.username();
    if user.is_empty() {
        return None;
    }
    let password = proxy.password().unwrap_or("");
    Some(B64.encode(format!("{user}:{password}")))
}

fn client_tls_config(_verify_certificates: bool) -> rustls::ClientConfig {
    let root_store =
        rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    if !_verify_certificates {
        config
            .dangerous()
            .set_certificate_verifier(Arc::new(NoCertificateVerification));
    }
    config
}

#[derive(Debug)]
struct NoCertificateVerification;

impl rustls::client::danger::ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
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

impl ProxyEngine {
    async fn tunnel_bytes(
        &self,
        client: hyper::upgrade::Upgraded,
        authority: String,
    ) -> Result<()> {
        let settings = self.settings.get().await.unwrap_or_default();
        let mut client = TokioIo::new(client);
        let mut upstream: Box<dyn AsyncReadWrite> = if settings.upstream_proxy_enabled {
            if settings.upstream_proxy_url.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "upstream proxy URL is required when upstream proxy is enabled".into(),
                ));
            }
            connect_via_upstream_proxy(&settings.upstream_proxy_url, &authority).await?
        } else {
            Box::new(TcpStream::connect(&authority).await?)
        };
        tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
        Ok(())
    }
}
