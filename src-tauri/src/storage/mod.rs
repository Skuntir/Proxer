use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    http_types::{HeaderPair, HistoryEntry, HistoryEntrySummary, ProxyRequest, ProxyResponse, StoredRequest, StoredResponse},
};

pub struct SqliteStore {
    pool: SqlitePool,
}

impl SqliteStore {
    pub async fn open(app: &AppHandle) -> tauri::Result<Self> {
        let db_path = app
            .path()
            .resolve("proxer/proxer.db", BaseDirectory::AppData)?;

        if let Some(parent) = db_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        let opts = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await
            .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;

        let store = Self { pool };
        store.init().await.map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
        Ok(store)
    }

    async fn init(&self) -> Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS traffic (
              id TEXT PRIMARY KEY,
              started_ms INTEGER NOT NULL,
              scheme TEXT NOT NULL,
              host TEXT NOT NULL,
              method TEXT NOT NULL,
              url TEXT NOT NULL,
              req_headers TEXT NOT NULL,
              req_body BLOB NOT NULL,
              resp_status INTEGER,
              resp_headers TEXT,
              resp_body BLOB,
              elapsed_ms INTEGER,
              error TEXT
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS traffic_started_idx ON traffic(started_ms DESC);")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_ms INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS logs (
              id TEXT PRIMARY KEY,
              ts_ms INTEGER NOT NULL,
              level TEXT NOT NULL,
              source TEXT NOT NULL,
              message TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS logs_ts_idx ON logs(ts_ms DESC);")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS vulnerabilities (
              id TEXT PRIMARY KEY,
              ts_ms INTEGER NOT NULL,
              severity TEXT NOT NULL,
              title TEXT NOT NULL,
              host TEXT NOT NULL,
              path TEXT NOT NULL,
              description TEXT NOT NULL,
              remediation TEXT NOT NULL,
              confidence TEXT NOT NULL,
              cvss TEXT,
              cwe TEXT,
              requests INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS vulns_ts_idx ON vulnerabilities(ts_ms DESC);")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS intruder_attacks (
              id TEXT PRIMARY KEY,
              started_ms INTEGER NOT NULL,
              status TEXT NOT NULL,
              template_raw TEXT NOT NULL,
              config_json TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS intruder_results (
              id TEXT PRIMARY KEY,
              attack_id TEXT NOT NULL,
              ts_ms INTEGER NOT NULL,
              seq INTEGER NOT NULL,
              status_code INTEGER,
              duration_ms INTEGER,
              size INTEGER,
              error TEXT,
              raw_request TEXT NOT NULL,
              raw_response TEXT
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS intruder_results_attack_idx ON intruder_results(attack_id, seq);")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS extensions (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              author TEXT NOT NULL,
              description TEXT NOT NULL,
              version TEXT NOT NULL,
              installed INTEGER NOT NULL,
              enabled INTEGER NOT NULL,
              rating REAL NOT NULL,
              downloads TEXT NOT NULL,
              category TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert(&self, req: &ProxyRequest, resp: Option<&ProxyResponse>, error: Option<&str>) -> Result<()> {
        let req_headers = serde_json::to_string(&req.headers).unwrap_or_else(|_| "[]".into());

        let (resp_status, resp_headers, resp_body, elapsed_ms) = match resp {
            Some(r) => (
                Some(r.status as i64),
                Some(serde_json::to_string(&r.headers).unwrap_or_else(|_| "[]".into())),
                Some(r.body.clone()),
                Some(r.elapsed_ms as i64),
            ),
            None => (None, None, None, None),
        };

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO traffic
              (id, started_ms, scheme, host, method, url, req_headers, req_body,
               resp_status, resp_headers, resp_body, elapsed_ms, error)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
               ?9, ?10, ?11, ?12, ?13)
            "#,
        )
        .bind(req.id.to_string())
        .bind(req.started_ms)
        .bind(&req.scheme)
        .bind(&req.host)
        .bind(&req.method)
        .bind(&req.url)
        .bind(req_headers)
        .bind(req.body.clone())
        .bind(resp_status)
        .bind(resp_headers)
        .bind(resp_body)
        .bind(elapsed_ms)
        .bind(error.unwrap_or(""))
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn list(&self, limit: u32, offset: u32) -> Result<Vec<HistoryEntrySummary>> {
        let rows = sqlx::query(
            r#"
            SELECT id, started_ms, method, url, resp_status, elapsed_ms,
                   length(req_body) as req_len,
                   CASE WHEN resp_body IS NULL THEN NULL ELSE length(resp_body) END as resp_len,
                   NULLIF(error, '') as error
            FROM traffic
            ORDER BY started_ms DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(HistoryEntrySummary {
                id: r.get::<String, _>("id"),
                started_ms: r.get::<i64, _>("started_ms"),
                method: r.get::<String, _>("method"),
                url: r.get::<String, _>("url"),
                status: r.get::<Option<i64>, _>("resp_status").map(|v| v as u16),
                elapsed_ms: r.get::<Option<i64>, _>("elapsed_ms").map(|v| v as u64),
                request_bytes: r.get::<i64, _>("req_len") as usize,
                response_bytes: r.get::<Option<i64>, _>("resp_len").map(|v| v as usize),
                error: r.get::<Option<String>, _>("error"),
            });
        }
        Ok(out)
    }

    pub async fn get(&self, id: &str) -> Result<HistoryEntry> {
        let row = sqlx::query(
            r#"
            SELECT id, started_ms, scheme, host, method, url, req_headers, req_body,
                   resp_status, resp_headers, resp_body, elapsed_ms, NULLIF(error, '') as error
            FROM traffic
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        let started_ms = row.get::<i64, _>("started_ms");
        let method = row.get::<String, _>("method");
        let url = row.get::<String, _>("url");
        let status = row.get::<Option<i64>, _>("resp_status").map(|v| v as u16);
        let elapsed_ms = row.get::<Option<i64>, _>("elapsed_ms").map(|v| v as u64);
        let req_body: Vec<u8> = row.get("req_body");
        let resp_body: Option<Vec<u8>> = row.try_get("resp_body").ok();
        let error: Option<String> = row.get("error");

        let req_headers: Vec<HeaderPair> = parse_json_list(row.get::<String, _>("req_headers"))?;
        let resp_headers: Option<Vec<HeaderPair>> = row
            .get::<Option<String>, _>("resp_headers")
            .map(parse_json_list)
            .transpose()?;

        let scheme = row.get::<String, _>("scheme");
        let host = row.get::<String, _>("host");

        let summary = HistoryEntrySummary {
            id: row.get::<String, _>("id"),
            started_ms,
            method: method.clone(),
            url: url.clone(),
            status,
            elapsed_ms,
            request_bytes: req_body.len(),
            response_bytes: resp_body.as_ref().map(|b| b.len()),
            error,
        };

        let request = StoredRequest {
            scheme,
            host,
            method,
            url,
            headers: req_headers,
            body_base64: B64.encode(req_body),
        };

        let response = match (status, resp_headers, resp_body, elapsed_ms) {
            (Some(status), Some(headers), Some(body), Some(elapsed_ms)) => Some(StoredResponse {
                status,
                headers,
                body_base64: B64.encode(body),
                elapsed_ms,
            }),
            _ => None,
        };

        Ok(HistoryEntry {
            summary,
            request,
            response,
        })
    }

    pub async fn traffic_clear(&self) -> Result<()> {
        sqlx::query("DELETE FROM traffic").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_for_replay(&self, id: &str) -> Result<ProxyRequest> {
        let row = sqlx::query(
            r#"
            SELECT id, started_ms, scheme, host, method, url, req_headers, req_body
            FROM traffic
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        let req_headers: Vec<HeaderPair> = parse_json_list(row.get::<String, _>("req_headers"))?;

        Ok(ProxyRequest {
            id: Uuid::parse_str(&row.get::<String, _>("id"))
                .map_err(|e| AppError::InvalidInput(format!("invalid id in db: {e}")))?,
            started_ms: row.get::<i64, _>("started_ms"),
            scheme: row.get::<String, _>("scheme"),
            host: row.get::<String, _>("host"),
            method: row.get::<String, _>("method"),
            url: row.get::<String, _>("url"),
            headers: req_headers,
            body: row.get::<Vec<u8>, _>("req_body"),
        })
    }

    pub async fn setting_get(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query(
            r#"
            SELECT value
            FROM settings
            WHERE key = ?1
            "#,
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.get::<String, _>("value")))
    }

    pub async fn setting_set(&self, key: &str, value: &str, updated_ms: i64) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO settings (key, value, updated_ms)
            VALUES (?1, ?2, ?3)
            "#,
        )
        .bind(key)
        .bind(value)
        .bind(updated_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn logs_insert(&self, id: &str, ts_ms: i64, level: &str, source: &str, message: &str) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO logs (id, ts_ms, level, source, message)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(ts_ms)
        .bind(level)
        .bind(source)
        .bind(message)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn logs_clear(&self) -> Result<()> {
        sqlx::query("DELETE FROM logs;").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn logs_list(&self, level: Option<&str>, limit: u32, offset: u32) -> Result<Vec<(String, i64, String, String, String)>> {
        let rows = match level {
            Some(level) => {
                sqlx::query(
                    r#"
                    SELECT id, ts_ms, level, source, message
                    FROM logs
                    WHERE level = ?1
                    ORDER BY ts_ms DESC
                    LIMIT ?2 OFFSET ?3
                    "#,
                )
                .bind(level)
                .bind(limit as i64)
                .bind(offset as i64)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query(
                    r#"
                    SELECT id, ts_ms, level, source, message
                    FROM logs
                    ORDER BY ts_ms DESC
                    LIMIT ?1 OFFSET ?2
                    "#,
                )
                .bind(limit as i64)
                .bind(offset as i64)
                .fetch_all(&self.pool)
                .await?
            }
        };

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("id"),
                r.get::<i64, _>("ts_ms"),
                r.get::<String, _>("level"),
                r.get::<String, _>("source"),
                r.get::<String, _>("message"),
            ));
        }
        Ok(out)
    }

    pub async fn vulnerabilities_upsert(
        &self,
        id: &str,
        ts_ms: i64,
        severity: &str,
        title: &str,
        host: &str,
        path: &str,
        description: &str,
        remediation: &str,
        confidence: &str,
        cvss: Option<&str>,
        cwe: Option<&str>,
        requests: i64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO vulnerabilities
              (id, ts_ms, severity, title, host, path, description, remediation, confidence, cvss, cwe, requests)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
        )
        .bind(id)
        .bind(ts_ms)
        .bind(severity)
        .bind(title)
        .bind(host)
        .bind(path)
        .bind(description)
        .bind(remediation)
        .bind(confidence)
        .bind(cvss.unwrap_or(""))
        .bind(cwe.unwrap_or(""))
        .bind(requests)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn vulnerabilities_list(
        &self,
        severity: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<(String, i64, String, String, String, String, String, String, String, Option<String>, Option<String>, i64)>> {
        let rows = match severity {
            Some(sev) => {
                sqlx::query(
                    r#"
                    SELECT id, ts_ms, severity, title, host, path, description, remediation, confidence,
                           NULLIF(cvss, '') as cvss,
                           NULLIF(cwe, '') as cwe,
                           requests
                    FROM vulnerabilities
                    WHERE severity = ?1
                    ORDER BY ts_ms DESC
                    LIMIT ?2 OFFSET ?3
                    "#,
                )
                .bind(sev)
                .bind(limit as i64)
                .bind(offset as i64)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query(
                    r#"
                    SELECT id, ts_ms, severity, title, host, path, description, remediation, confidence,
                           NULLIF(cvss, '') as cvss,
                           NULLIF(cwe, '') as cwe,
                           requests
                    FROM vulnerabilities
                    ORDER BY ts_ms DESC
                    LIMIT ?1 OFFSET ?2
                    "#,
                )
                .bind(limit as i64)
                .bind(offset as i64)
                .fetch_all(&self.pool)
                .await?
            }
        };

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("id"),
                r.get::<i64, _>("ts_ms"),
                r.get::<String, _>("severity"),
                r.get::<String, _>("title"),
                r.get::<String, _>("host"),
                r.get::<String, _>("path"),
                r.get::<String, _>("description"),
                r.get::<String, _>("remediation"),
                r.get::<String, _>("confidence"),
                r.get::<Option<String>, _>("cvss"),
                r.get::<Option<String>, _>("cwe"),
                r.get::<i64, _>("requests"),
            ));
        }
        Ok(out)
    }

    pub async fn intruder_attack_insert(&self, id: &str, started_ms: i64, status: &str, template_raw: &str, config_json: &str) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO intruder_attacks (id, started_ms, status, template_raw, config_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(started_ms)
        .bind(status)
        .bind(template_raw)
        .bind(config_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn intruder_attack_update_status(&self, id: &str, status: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE intruder_attacks
            SET status = ?2
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn intruder_result_insert(
        &self,
        id: &str,
        attack_id: &str,
        ts_ms: i64,
        seq: i64,
        status_code: Option<i64>,
        duration_ms: Option<i64>,
        size: Option<i64>,
        error: Option<&str>,
        raw_request: &str,
        raw_response: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO intruder_results
              (id, attack_id, ts_ms, seq, status_code, duration_ms, size, error, raw_request, raw_response)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(id)
        .bind(attack_id)
        .bind(ts_ms)
        .bind(seq)
        .bind(status_code)
        .bind(duration_ms)
        .bind(size)
        .bind(error.unwrap_or(""))
        .bind(raw_request)
        .bind(raw_response.unwrap_or(""))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn intruder_results_list(
        &self,
        attack_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<(String, i64, i64, Option<i64>, Option<i64>, Option<i64>, Option<String>, String, Option<String>)>> {
        let rows = sqlx::query(
            r#"
            SELECT id, ts_ms, seq, status_code, duration_ms, size, NULLIF(error, '') as error, raw_request, NULLIF(raw_response, '') as raw_response
            FROM intruder_results
            WHERE attack_id = ?1
            ORDER BY seq ASC
            LIMIT ?2 OFFSET ?3
            "#,
        )
        .bind(attack_id)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("id"),
                r.get::<i64, _>("ts_ms"),
                r.get::<i64, _>("seq"),
                r.get::<Option<i64>, _>("status_code"),
                r.get::<Option<i64>, _>("duration_ms"),
                r.get::<Option<i64>, _>("size"),
                r.get::<Option<String>, _>("error"),
                r.get::<String, _>("raw_request"),
                r.get::<Option<String>, _>("raw_response"),
            ));
        }
        Ok(out)
    }

    pub async fn extensions_seed_if_empty(&self, items: &[(String, String, String, String, f64, String, String)]) -> Result<()> {
        let count = sqlx::query("SELECT count(1) as c FROM extensions;")
            .fetch_one(&self.pool)
            .await?
            .get::<i64, _>("c");
        if count > 0 {
            return Ok(());
        }

        for (id, name, author, description, rating, downloads, category) in items {
            sqlx::query(
                r#"
                INSERT OR REPLACE INTO extensions
                  (id, name, author, description, version, installed, enabled, rating, downloads, category)
                VALUES
                  (?1, ?2, ?3, ?4, '1.0.0', 0, 0, ?5, ?6, ?7)
                "#,
            )
            .bind(id)
            .bind(name)
            .bind(author)
            .bind(description)
            .bind(*rating)
            .bind(downloads)
            .bind(category)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn extensions_list(&self, installed: Option<bool>) -> Result<Vec<(String, String, String, String, String, bool, bool, f64, String, String)>> {
        let rows = match installed {
            Some(true) => sqlx::query(
                r#"
                SELECT id, name, author, description, version, installed, enabled, rating, downloads, category
                FROM extensions
                WHERE installed = 1
                ORDER BY name ASC
                "#,
            )
            .fetch_all(&self.pool)
            .await?,
            Some(false) => sqlx::query(
                r#"
                SELECT id, name, author, description, version, installed, enabled, rating, downloads, category
                FROM extensions
                WHERE installed = 0
                ORDER BY name ASC
                "#,
            )
            .fetch_all(&self.pool)
            .await?,
            None => sqlx::query(
                r#"
                SELECT id, name, author, description, version, installed, enabled, rating, downloads, category
                FROM extensions
                ORDER BY name ASC
                "#,
            )
            .fetch_all(&self.pool)
            .await?,
        };

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("id"),
                r.get::<String, _>("name"),
                r.get::<String, _>("author"),
                r.get::<String, _>("description"),
                r.get::<String, _>("version"),
                r.get::<i64, _>("installed") != 0,
                r.get::<i64, _>("enabled") != 0,
                r.get::<f64, _>("rating"),
                r.get::<String, _>("downloads"),
                r.get::<String, _>("category"),
            ));
        }
        Ok(out)
    }

    pub async fn extensions_set_installed(&self, id: &str, installed: bool) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extensions
            SET installed = ?2
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(if installed { 1i64 } else { 0i64 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn extensions_set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extensions
            SET enabled = ?2
            WHERE id = ?1
            "#,
        )
        .bind(id)
        .bind(if enabled { 1i64 } else { 0i64 })
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn traffic_stats(&self) -> Result<(i64, i64, Option<f64>, i64, i64)> {
        let row = sqlx::query(
            r#"
            SELECT
              count(1) as total_requests,
              sum(length(req_body)) as total_req_bytes,
              sum(CASE WHEN resp_body IS NULL THEN 0 ELSE length(resp_body) END) as total_resp_bytes,
              avg(elapsed_ms) as avg_elapsed_ms,
              count(distinct host) as unique_hosts
            FROM traffic
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let total_requests = row.get::<i64, _>("total_requests");
        let total_req_bytes = row.get::<Option<i64>, _>("total_req_bytes").unwrap_or(0);
        let total_resp_bytes = row.get::<Option<i64>, _>("total_resp_bytes").unwrap_or(0);
        let avg_elapsed_ms = row.get::<Option<f64>, _>("avg_elapsed_ms");
        let unique_hosts = row.get::<i64, _>("unique_hosts");
        Ok((total_requests, total_req_bytes, avg_elapsed_ms, unique_hosts, total_resp_bytes))
    }

    pub async fn traffic_sitemap_rows(&self, limit: u32) -> Result<Vec<(String, String, String, i64, String, i64, Option<i64>)>> {
        let rows = sqlx::query(
            r#"
            SELECT
              t.host,
              t.method,
              t.url,
              count(1) as c,
              (
                SELECT id
                FROM traffic t2
                WHERE t2.host = t.host AND t2.method = t.method AND t2.url = t.url
                ORDER BY t2.started_ms DESC
                LIMIT 1
              ) as last_id,
              (
                SELECT started_ms
                FROM traffic t2
                WHERE t2.host = t.host AND t2.method = t.method AND t2.url = t.url
                ORDER BY t2.started_ms DESC
                LIMIT 1
              ) as last_started_ms,
              (
                SELECT resp_status
                FROM traffic t2
                WHERE t2.host = t.host AND t2.method = t.method AND t2.url = t.url
                ORDER BY t2.started_ms DESC
                LIMIT 1
              ) as last_resp_status
            FROM traffic t
            WHERE t.method != 'CONNECT'
            GROUP BY t.host, t.method, t.url
            ORDER BY c DESC
            LIMIT ?1
            "#,
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("host"),
                r.get::<String, _>("method"),
                r.get::<String, _>("url"),
                r.get::<i64, _>("c"),
                r.get::<String, _>("last_id"),
                r.get::<i64, _>("last_started_ms"),
                r.get::<Option<i64>, _>("last_resp_status"),
            ));
        }
        Ok(out)
    }

    pub async fn traffic_status_buckets(&self) -> Result<(i64, i64, i64, i64, i64)> {
        let row = sqlx::query(
            r#"
            SELECT
              sum(CASE WHEN resp_status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) as c2xx,
              sum(CASE WHEN resp_status BETWEEN 300 AND 399 THEN 1 ELSE 0 END) as c3xx,
              sum(CASE WHEN resp_status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) as c4xx,
              sum(CASE WHEN resp_status BETWEEN 500 AND 599 THEN 1 ELSE 0 END) as c5xx,
              sum(CASE WHEN resp_status IS NULL THEN 1 ELSE 0 END) as c0xx
            FROM traffic
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok((
            row.get::<Option<i64>, _>("c2xx").unwrap_or(0),
            row.get::<Option<i64>, _>("c3xx").unwrap_or(0),
            row.get::<Option<i64>, _>("c4xx").unwrap_or(0),
            row.get::<Option<i64>, _>("c5xx").unwrap_or(0),
            row.get::<Option<i64>, _>("c0xx").unwrap_or(0),
        ))
    }

    pub async fn traffic_top_hosts(&self, limit: u32) -> Result<Vec<(String, i64)>> {
        let rows = sqlx::query(
            r#"
            SELECT host, count(1) as c
            FROM traffic
            GROUP BY host
            ORDER BY c DESC
            LIMIT ?1
            "#,
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((r.get::<String, _>("host"), r.get::<i64, _>("c")));
        }
        Ok(out)
    }

    pub async fn vulnerabilities_severity_counts(&self) -> Result<Vec<(String, i64)>> {
        let rows = sqlx::query(
            r#"
            SELECT severity, count(1) as c
            FROM vulnerabilities
            GROUP BY severity
            ORDER BY c DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((r.get::<String, _>("severity"), r.get::<i64, _>("c")));
        }
        Ok(out)
    }

    pub async fn traffic_scan_rows(
        &self,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<(String, i64, String, String, String, Option<i64>, Option<String>, Option<String>)>> {
        let rows = sqlx::query(
            r#"
            SELECT id, started_ms, scheme, host, url, resp_status,
                   req_headers,
                   resp_headers
            FROM traffic
            ORDER BY started_ms DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push((
                r.get::<String, _>("id"),
                r.get::<i64, _>("started_ms"),
                r.get::<String, _>("scheme"),
                r.get::<String, _>("host"),
                r.get::<String, _>("url"),
                r.get::<Option<i64>, _>("resp_status"),
                r.get::<Option<String>, _>("req_headers"),
                r.get::<Option<String>, _>("resp_headers"),
            ));
        }
        Ok(out)
    }
}

fn parse_json_list<T: serde::de::DeserializeOwned>(s: String) -> Result<T> {
    serde_json::from_str::<T>(&s).map_err(|e| AppError::Other(format!("invalid stored json: {e}")))
}

#[allow(dead_code)]
fn _db_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    app.path().resolve("proxer/proxer.db", BaseDirectory::AppData)
}
