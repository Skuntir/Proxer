use std::collections::HashSet;

use regex::Regex;
use serde::Serialize;

use crate::{error::Result, events::now_ms, storage::SqliteStore};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLeakFinding {
    pub id: String,
    pub ts_ms: i64,
    pub request_id: String,
    pub host: String,
    pub method: String,
    pub url: String,
    pub status: Option<i64>,
    pub category: String,
    pub name: String,
    pub severity: String,
    pub location: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiLeakSummary {
    pub scanned_requests: i64,
    pub findings: Vec<ApiLeakFinding>,
    pub generated_at_ms: i64,
}

struct LeakRule {
    name: &'static str,
    category: &'static str,
    severity: &'static str,
    regex: Regex,
}

pub async fn scan_api_leaks(store: &SqliteStore, limit: u32) -> Result<ApiLeakSummary> {
    let rows = store.traffic_leak_scan_rows(limit, 0).await?;
    let rules = leak_rules();
    let mut findings = Vec::new();
    let mut seen = HashSet::new();

    for (
        request_id,
        ts_ms,
        method,
        host,
        url,
        status,
        req_headers,
        req_body,
        resp_headers,
        resp_body,
    ) in rows.iter()
    {
        let mut sources = vec![
            ("request headers", req_headers.clone()),
            ("request body", lossy_limited(req_body)),
        ];
        if let Some(headers) = resp_headers {
            sources.push(("response headers", headers.clone()));
        }
        if let Some(body) = resp_body {
            sources.push(("response body", lossy_limited(body)));
        }

        for (location, text) in sources {
            if text.trim().is_empty() {
                continue;
            }
            for rule in &rules {
                for m in rule.regex.find_iter(&text).take(25) {
                    let raw = m.as_str().trim();
                    if raw.len() < 8 || looks_like_placeholder(raw) {
                        continue;
                    }
                    let evidence = redact(raw);
                    let dedupe = format!("{}:{}:{}:{}", request_id, rule.name, location, evidence);
                    if !seen.insert(dedupe) {
                        continue;
                    }
                    findings.push(ApiLeakFinding {
                        id: format!(
                            "{}:{}:{}:{}",
                            request_id,
                            location.replace(' ', "-"),
                            rule.name,
                            findings.len()
                        ),
                        ts_ms: *ts_ms,
                        request_id: request_id.clone(),
                        host: host.clone(),
                        method: method.clone(),
                        url: url.clone(),
                        status: *status,
                        category: rule.category.into(),
                        name: rule.name.into(),
                        severity: rule.severity.into(),
                        location: location.into(),
                        evidence,
                    });
                    if findings.len() >= 5000 {
                        break;
                    }
                }
                if findings.len() >= 5000 {
                    break;
                }
            }
            if findings.len() >= 5000 {
                break;
            }
        }
        if findings.len() >= 5000 {
            break;
        }
    }

    findings.sort_by(|a, b| {
        severity_rank(&b.severity)
            .cmp(&severity_rank(&a.severity))
            .then(b.ts_ms.cmp(&a.ts_ms))
    });

    Ok(ApiLeakSummary {
        scanned_requests: rows.len() as i64,
        findings,
        generated_at_ms: now_ms(),
    })
}

fn leak_rules() -> Vec<LeakRule> {
    let specs = [
        (
            "AWS Access Key",
            "Cloud",
            "Critical",
            r"\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ASIA)[A-Z0-9]{16}\b",
        ),
        (
            "AWS Secret Assignment",
            "Cloud",
            "Critical",
            r#"(?i)\b(?:aws_?secret_?access_?key|aws_?secret|aws_secret_key)\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}["']?"#,
        ),
        (
            "Google API Key",
            "Cloud",
            "High",
            r"\bAIza[0-9A-Za-z_-]{35}\b",
        ),
        (
            "Google OAuth Client Secret",
            "Cloud",
            "High",
            r"\bGOCSPX-[0-9A-Za-z_-]{28,}\b",
        ),
        (
            "Google Service Account",
            "Cloud",
            "Critical",
            r#""type"\s*:\s*"service_account""#,
        ),
        (
            "Azure Storage Key",
            "Cloud",
            "Critical",
            r#"(?i)\b(?:accountkey|azure_storage_key)\b\s*[:=]\s*["']?[A-Za-z0-9+/=]{60,}["']?"#,
        ),
        (
            "Firebase Secret",
            "Cloud",
            "High",
            r#"(?i)\bfirebase[^"'&\s]{0,32}[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?"#,
        ),
        (
            "JWT",
            "Token",
            "High",
            r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
        ),
        (
            "Bearer Token",
            "Token",
            "High",
            r#"(?i)\bauthorization\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/=-]{20,}"#,
        ),
        (
            "Generic API Key Assignment",
            "Token",
            "Medium",
            r#"(?i)\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|private[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}["']?"#,
        ),
        (
            "OpenAI Key",
            "AI",
            "Critical",
            r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b",
        ),
        (
            "Anthropic Key",
            "AI",
            "Critical",
            r"\bsk-ant-[A-Za-z0-9_-]{32,}\b",
        ),
        (
            "GitHub Token",
            "Source Control",
            "Critical",
            r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b",
        ),
        (
            "GitHub Fine Grained Token",
            "Source Control",
            "Critical",
            r"\bgithub_pat_[A-Za-z0-9_]{40,255}\b",
        ),
        (
            "GitLab Token",
            "Source Control",
            "Critical",
            r"\bglpat-[A-Za-z0-9_-]{20,}\b",
        ),
        (
            "Slack Token",
            "Messaging",
            "Critical",
            r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b",
        ),
        (
            "Slack Webhook",
            "Messaging",
            "Critical",
            r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{30,}",
        ),
        (
            "Discord Webhook",
            "Messaging",
            "High",
            r"https://discord(?:app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+",
        ),
        (
            "Telegram Bot Token",
            "Messaging",
            "High",
            r"\b[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}\b",
        ),
        (
            "Stripe Secret Key",
            "Payments",
            "Critical",
            r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b",
        ),
        (
            "Stripe Publishable Key",
            "Payments",
            "Low",
            r"\bpk_(?:live|test)_[A-Za-z0-9]{20,}\b",
        ),
        (
            "PayPal Token",
            "Payments",
            "High",
            r#"(?i)\bpaypal[^"'&\s]{0,24}[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?"#,
        ),
        (
            "Twilio Account SID",
            "Messaging",
            "Medium",
            r"\bAC[a-fA-F0-9]{32}\b",
        ),
        (
            "Twilio Auth Token",
            "Messaging",
            "Critical",
            r#"(?i)\btwilio[^"'&\s]{0,24}(?:auth)?token\s*[:=]\s*["']?[a-f0-9]{32}["']?"#,
        ),
        (
            "SendGrid Key",
            "Email",
            "Critical",
            r"\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b",
        ),
        ("Mailgun Key", "Email", "High", r"\bkey-[0-9a-fA-F]{32}\b"),
        (
            "Sentry DSN",
            "Monitoring",
            "Medium",
            r"https://[a-f0-9]{32}@[A-Za-z0-9.-]+/[0-9]+",
        ),
        (
            "Mapbox Token",
            "Maps",
            "Medium",
            r"\bpk\.eyJ[A-Za-z0-9._-]{40,}\b",
        ),
        (
            "Notion Token",
            "SaaS",
            "High",
            r"\bsecret_[A-Za-z0-9]{30,}\b",
        ),
        (
            "Linear Key",
            "SaaS",
            "High",
            r"\blin_api_[A-Za-z0-9]{20,}\b",
        ),
        (
            "Heroku API Key",
            "Platform",
            "High",
            r#"(?i)\bheroku[^"'&\s]{0,24}[:=]\s*["']?[0-9a-f]{8}-[0-9a-f-]{27,}["']?"#,
        ),
        (
            "NPM Token",
            "Package Registry",
            "High",
            r"\bnpm_[A-Za-z0-9]{36,}\b",
        ),
        (
            "PyPI Token",
            "Package Registry",
            "High",
            r"\bpypi-[A-Za-z0-9_-]{40,}\b",
        ),
        (
            "Docker Token",
            "Package Registry",
            "High",
            r#"(?i)\bdocker[^"'&\s]{0,24}(?:token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{20,}["']?"#,
        ),
        (
            "Database URL",
            "Database",
            "Critical",
            r#"(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp)://[^/\s:@]+:[^@\s]+@[^\s"'<>]+"#,
        ),
        (
            "Basic Auth URL",
            "Credential",
            "High",
            r#"(?i)\bhttps?://[^/\s:@]+:[^@\s]+@[^\s"'<>]+"#,
        ),
        (
            "Password Assignment",
            "Credential",
            "Medium",
            r#"(?i)\b(?:password|passwd|pwd)\b\s*[:=]\s*["']?[^\s"',;{}]{8,}["']?"#,
        ),
        (
            "PEM Private Key",
            "Private Key",
            "Critical",
            r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----",
        ),
        (
            "OpenSSH Private Key",
            "Private Key",
            "Critical",
            r"-----BEGIN OPENSSH PRIVATE KEY-----",
        ),
        (
            "PGP Private Key",
            "Private Key",
            "Critical",
            r"-----BEGIN PGP PRIVATE KEY BLOCK-----",
        ),
        (
            "PGP Public Key",
            "Public Key",
            "Info",
            r"-----BEGIN PGP PUBLIC KEY BLOCK-----",
        ),
        (
            "SSH Public Key",
            "Public Key",
            "Info",
            r"\bssh-(?:rsa|ed25519|ecdsa) [A-Za-z0-9+/=]{40,}",
        ),
        (
            "X.509 Certificate",
            "Certificate",
            "Info",
            r"-----BEGIN CERTIFICATE-----",
        ),
        (
            "High Entropy Hex Secret",
            "Token",
            "Medium",
            r"\b[a-fA-F0-9]{48,128}\b",
        ),
        (
            "High Entropy Base64 Secret",
            "Token",
            "Medium",
            r"\b[A-Za-z0-9+/]{40,}={0,2}\b",
        ),
    ];

    specs
        .into_iter()
        .map(|(name, category, severity, pattern)| LeakRule {
            name,
            category,
            severity,
            regex: Regex::new(pattern).expect("valid leak regex"),
        })
        .collect()
}

fn lossy_limited(bytes: &[u8]) -> String {
    let max = bytes.len().min(512 * 1024);
    String::from_utf8_lossy(&bytes[..max]).to_string()
}

fn redact(raw: &str) -> String {
    let compact = raw.replace(['\r', '\n', '\t'], " ");
    if compact.len() <= 16 {
        return compact;
    }
    let chars = compact.chars().collect::<Vec<_>>();
    let head = chars.iter().take(8).collect::<String>();
    let tail = chars
        .iter()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{head}...{tail}")
}

fn looks_like_placeholder(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("example")
        || lower.contains("placeholder")
        || lower.contains("your_")
        || lower.contains("changeme")
        || lower.contains("dummy")
        || lower.contains("redacted")
}

fn severity_rank(severity: &str) -> i32 {
    match severity {
        "Critical" => 5,
        "High" => 4,
        "Medium" => 3,
        "Low" => 2,
        _ => 1,
    }
}
