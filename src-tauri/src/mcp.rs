use std::{collections::BTreeMap, net::SocketAddr};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};

use crate::{app_state::AppState, error::AppError, proxy::ProxyStatus};

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct ToolSpec {
    name: String,
    description: String,
    input_schema: Value,
}

pub async fn start_if_enabled(state: AppState) {
    let settings = state.settings.get().await.unwrap_or_default();
    if !settings.mcp_enabled {
        return;
    }
    let port = settings.mcp_port.clamp(1, 65535) as u16;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(state, port).await {
            tracing::warn!(error = %e, "MCP server stopped");
        }
    });
}

async fn serve(state: AppState, port: u16) -> crate::error::Result<()> {
    let bind = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(bind).await?;
    let _ = state
        .logs
        .emit(
            "INFO",
            "mcp",
            &format!("MCP JSON-RPC server listening on {bind}"),
        )
        .await;

    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_client(state, stream).await {
                tracing::debug!(error = %e, "MCP client disconnected");
            }
        });
    }
}

async fn handle_client(state: AppState, stream: TcpStream) -> crate::error::Result<()> {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let parsed = serde_json::from_str::<JsonRpcRequest>(&line);
        let response = match parsed {
            Ok(req) => dispatch(&state, req).await,
            Err(e) => json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": { "code": -32700, "message": format!("parse error: {e}") }
            }),
        };
        write.write_all(response.to_string().as_bytes()).await?;
        write.write_all(b"\n").await?;
    }
    Ok(())
}

async fn dispatch(state: &AppState, req: JsonRpcRequest) -> Value {
    let id = req.id.clone().unwrap_or(Value::Null);
    let result = match req.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "serverInfo": { "name": "proxer", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "tools": {} }
        })),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call_tool(state, req.params).await,
        other => Err(AppError::InvalidInput(format!(
            "unknown JSON-RPC method: {other}"
        ))),
    };

    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": e.to_string() }
        }),
    }
}

async fn call_tool(state: &AppState, params: Value) -> crate::error::Result<Value> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::InvalidInput("tools/call requires name".into()))?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match name {
        "proxy.status" => {
            Ok(serde_json::to_value(state.proxy.status().await).unwrap_or(Value::Null))
        }
        "proxy.start" => {
            let port = args.get("port").and_then(Value::as_u64).unwrap_or(8080) as u16;
            let bind = state.proxy.start(port).await?;
            Ok(serde_json::to_value(ProxyStatus {
                running: true,
                bind: Some(bind.to_string()),
            })
            .unwrap_or(Value::Null))
        }
        "proxy.stop" => {
            state.proxy.stop().await?;
            Ok(json!({ "ok": true }))
        }
        "settings.get" => {
            Ok(serde_json::to_value(state.settings.get().await?).unwrap_or(Value::Null))
        }
        "settings.set" => {
            let patch = args.get("patch").cloned().unwrap_or(args);
            Ok(serde_json::to_value(state.settings.set_patch(patch).await?).unwrap_or(Value::Null))
        }
        "history.list" => {
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(200) as u32;
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as u32;
            Ok(
                serde_json::to_value(state.store.get().list(limit, offset).await?)
                    .unwrap_or(Value::Null),
            )
        }
        "history.get" => {
            let id = string_arg(&args, "id")?;
            Ok(serde_json::to_value(state.store.get().get(&id).await?).unwrap_or(Value::Null))
        }
        "history.replay" => {
            let id = string_arg(&args, "id")?;
            let req = state.store.get().get_for_replay(&id).await?;
            let new_id = state.proxy.engine().replay(req).await?;
            Ok(json!({ "id": new_id.to_string() }))
        }
        "intercept.enabled" => Ok(json!({ "enabled": state.intercept.is_enabled().await })),
        "intercept.set_enabled" => {
            let enabled = args
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            state.intercept.set_enabled(enabled).await;
            Ok(json!({ "enabled": state.intercept.is_enabled().await }))
        }
        "intercept.queue" => {
            Ok(serde_json::to_value(state.intercept.queue()).unwrap_or(Value::Null))
        }
        "intercept.forward" => {
            let id = string_arg(&args, "interceptionId")?;
            let raw = args
                .get("editedRaw")
                .and_then(Value::as_str)
                .map(str::to_string);
            state.intercept.forward(&id, raw)?;
            Ok(json!({ "ok": true }))
        }
        "intercept.drop" => {
            let id = string_arg(&args, "interceptionId")?;
            state.intercept.reject(&id)?;
            Ok(json!({ "ok": true }))
        }
        "scanner.start" => {
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(5000) as u32;
            Ok(json!({ "scanId": state.scanner.start(limit).await? }))
        }
        "scanner.stop" => {
            state.scanner.stop().await?;
            Ok(json!({ "ok": true }))
        }
        "scanner.status" => {
            Ok(serde_json::to_value(state.scanner.status().await).unwrap_or(Value::Null))
        }
        "scanner.findings" => {
            let severity = args
                .get("severity")
                .and_then(Value::as_str)
                .map(str::to_string);
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(1000) as u32;
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as u32;
            Ok(
                serde_json::to_value(state.scanner.findings_list(severity, limit, offset).await?)
                    .unwrap_or(Value::Null),
            )
        }
        "rules.list" => Ok(serde_json::to_value(state.rules.list().await).unwrap_or(Value::Null)),
        "rules.upsert" => {
            let rule = serde_json::from_value(args.get("rule").cloned().unwrap_or(args))
                .map_err(|e| AppError::InvalidInput(format!("invalid rule: {e}")))?;
            state.rules.upsert(rule).await;
            Ok(json!({ "ok": true }))
        }
        "rules.remove" => {
            let id = string_arg(&args, "id")?;
            Ok(json!({ "removed": state.rules.remove(&id).await }))
        }
        _ => Err(AppError::InvalidInput(format!("unknown tool: {name}"))),
    }
}

fn string_arg(args: &Value, key: &str) -> crate::error::Result<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::InvalidInput(format!("missing {key}")))
}

fn tools() -> Vec<ToolSpec> {
    let empty = json!({ "type": "object", "properties": {} });
    let mut schemas: BTreeMap<&str, Value> = BTreeMap::new();
    schemas.insert(
        "proxy.start",
        json!({ "type": "object", "properties": { "port": { "type": "integer" } } }),
    );
    schemas.insert("settings.set", json!({ "type": "object", "properties": { "patch": { "type": "object" } }, "required": ["patch"] }));
    schemas.insert("history.list", json!({ "type": "object", "properties": { "limit": { "type": "integer" }, "offset": { "type": "integer" } } }));
    schemas.insert("history.get", json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }));
    schemas.insert("history.replay", schemas["history.get"].clone());
    schemas.insert("intercept.set_enabled", json!({ "type": "object", "properties": { "enabled": { "type": "boolean" } }, "required": ["enabled"] }));
    schemas.insert("intercept.forward", json!({ "type": "object", "properties": { "interceptionId": { "type": "string" }, "editedRaw": { "type": "string" } }, "required": ["interceptionId"] }));
    schemas.insert("intercept.drop", json!({ "type": "object", "properties": { "interceptionId": { "type": "string" } }, "required": ["interceptionId"] }));
    schemas.insert(
        "scanner.start",
        json!({ "type": "object", "properties": { "limit": { "type": "integer" } } }),
    );
    schemas.insert("scanner.findings", json!({ "type": "object", "properties": { "severity": { "type": "string" }, "limit": { "type": "integer" }, "offset": { "type": "integer" } } }));
    schemas.insert("rules.upsert", json!({ "type": "object", "properties": { "rule": { "type": "object" } }, "required": ["rule"] }));
    schemas.insert("rules.remove", json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }));

    let names = [
        "proxy.status",
        "proxy.start",
        "proxy.stop",
        "settings.get",
        "settings.set",
        "history.list",
        "history.get",
        "history.replay",
        "intercept.enabled",
        "intercept.set_enabled",
        "intercept.queue",
        "intercept.forward",
        "intercept.drop",
        "scanner.start",
        "scanner.stop",
        "scanner.status",
        "scanner.findings",
        "rules.list",
        "rules.upsert",
        "rules.remove",
    ];

    names
        .iter()
        .map(|name| ToolSpec {
            name: (*name).into(),
            description: format!("Run Proxer action {name}"),
            input_schema: schemas.get(name).cloned().unwrap_or_else(|| empty.clone()),
        })
        .collect()
}
