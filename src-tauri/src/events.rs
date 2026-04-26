use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, Mutex, Notify};

#[derive(Debug, Clone)]
pub struct EventBus {
    tx: broadcast::Sender<BackendEvent>,
    seq: Arc<AtomicU64>,
    buf: Arc<Mutex<VecDeque<(u64, BackendEvent)>>>,
    notify: Arc<Notify>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            tx,
            seq: Arc::new(AtomicU64::new(0)),
            buf: Arc::new(Mutex::new(VecDeque::with_capacity(4096))),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn emit(&self, event: BackendEvent) {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let buf = self.buf.clone();
        let notify = self.notify.clone();
        let ev_for_buf = event.clone();
        tauri::async_runtime::spawn(async move {
            let mut lock = buf.lock().await;
            lock.push_back((seq, ev_for_buf));
            while lock.len() > 4096 {
                lock.pop_front();
            }
            notify.notify_waiters();
        });
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BackendEvent> {
        self.tx.subscribe()
    }

    pub fn spawn_tauri_emitter(&self, app: AppHandle) {
        let mut rx = self.subscribe();
        tauri::async_runtime::spawn(async move {
            while let Ok(ev) = rx.recv().await {
                let _ = app.emit("proxer://event", ev);
            }
        });
    }

    pub async fn poll(&self, after: u64, timeout_ms: u64, max: usize) -> (u64, Vec<BackendEvent>) {
        let max = max.clamp(1, 1000);

        let try_read = |buf: &VecDeque<(u64, BackendEvent)>| -> (u64, Vec<BackendEvent>) {
            let latest = buf.back().map(|(s, _)| *s).unwrap_or(0);
            let mut out = Vec::new();
            for (s, ev) in buf.iter() {
                if *s > after {
                    out.push(ev.clone());
                    if out.len() >= max {
                        break;
                    }
                }
            }
            (latest.max(after), out)
        };

        {
            let lock = self.buf.lock().await;
            let (cursor, events) = try_read(&lock);
            if !events.is_empty() {
                return (cursor, events);
            }
        }

        let notified = self.notify.notified();
        let _ = tokio::time::timeout(Duration::from_millis(timeout_ms), notified).await;

        let lock = self.buf.lock().await;
        try_read(&lock)
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum BackendEvent {
    ProxyStatusChanged {
        ts_ms: i64,
        running: bool,
        bind: Option<String>,
    },
    RequestCaptured {
        ts_ms: i64,
        id: String,
        method: String,
        url: String,
        host: String,
        scheme: String,
        request_bytes: usize,
        preview_base64: String,
    },
    ResponseReceived {
        ts_ms: i64,
        id: String,
        status: u16,
        response_bytes: usize,
        preview_base64: String,
        elapsed_ms: u64,
    },
    RequestModified {
        ts_ms: i64,
        id: String,
        reason: String,
    },
    RuleTriggered {
        ts_ms: i64,
        id: String,
        rule_id: String,
        action: String,
    },
    TlsHandshake {
        ts_ms: i64,
        host: String,
        mode: String,
        ok: bool,
        error: Option<String>,
    },
    InterceptPaused {
        ts_ms: i64,
        interception_id: String,
        request_id: String,
        raw: String,
    },
    LogEmitted {
        ts_ms: i64,
        entry: crate::logs::UiLogEntry,
    },
    ScanStarted {
        ts_ms: i64,
        scan_id: String,
    },
    ScanProgress {
        ts_ms: i64,
        scan_id: String,
        done: i64,
        total: i64,
    },
    ScanFinding {
        ts_ms: i64,
        scan_id: String,
        finding: crate::scanner::UiVulnerability,
    },
    ScanCompleted {
        ts_ms: i64,
        scan_id: String,
    },
    IntruderStarted {
        ts_ms: i64,
        attack_id: String,
    },
    IntruderProgress {
        ts_ms: i64,
        attack_id: String,
        done: i64,
        total: i64,
    },
    IntruderResult {
        ts_ms: i64,
        attack_id: String,
        result: crate::intruder::UiIntruderResult,
    },
    IntruderCompleted {
        ts_ms: i64,
        attack_id: String,
    },
    ExtensionInstalled {
        ts_ms: i64,
        id: String,
    },
    ExtensionEnabledChanged {
        ts_ms: i64,
        id: String,
        enabled: bool,
    },
}

impl BackendEvent {
    pub fn proxy_status_changed(running: bool, bind: Option<String>) -> Self {
        Self::ProxyStatusChanged {
            ts_ms: now_ms(),
            running,
            bind,
        }
    }
}
