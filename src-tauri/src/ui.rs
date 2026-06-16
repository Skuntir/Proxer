use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiHttpCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiHttpRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub status_code: i64,
    pub time: String,
    pub size: String,
    pub content_type: String,
    pub headers: BTreeMap<String, String>,
    pub request_headers: BTreeMap<String, String>,
    pub body: String,
    pub response_body: String,
    pub cookies: Vec<UiHttpCookie>,
    pub timestamp: String,
    pub protocol: String,
    pub port: i64,
}

pub fn format_duration_ms(ms: Option<i64>) -> String {
    match ms {
        Some(ms) if ms >= 0 => format!("{ms}ms"),
        _ => "-".to_string(),
    }
}

pub fn ms_to_iso(ms: i64) -> String {
    let secs = ms / 1000;
    let nanos = (ms % 1000).unsigned_abs() as u32 * 1_000_000;
    let dt = OffsetDateTime::from_unix_timestamp(secs).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    let dt = dt.replace_nanosecond(nanos).unwrap_or(dt);
    dt.format(&Rfc3339).unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

pub fn format_bytes(bytes: Option<i64>) -> String {
    let Some(mut b) = bytes.and_then(|v| if v >= 0 { Some(v as f64) } else { None }) else {
        return "-".to_string();
    };
    let units = ["B", "KB", "MB", "GB"];
    let mut idx = 0usize;
    while b >= 1024.0 && idx + 1 < units.len() {
        b /= 1024.0;
        idx += 1;
    }
    if idx == 0 {
        format!("{:.0} {}", b, units[idx])
    } else {
        format!("{:.1} {}", b, units[idx])
    }
}

pub fn header_map(pairs: &[(String, String)]) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in pairs {
        out.entry(k.clone())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(v);
            })
            .or_insert_with(|| v.clone());
    }
    out
}

pub fn parse_cookies_from_headers(
    request_headers: &BTreeMap<String, String>,
    response_headers: &BTreeMap<String, String>,
    fallback_domain: &str,
) -> Vec<UiHttpCookie> {
    let mut cookies: Vec<UiHttpCookie> = Vec::new();

    if let Some(cookie_hdr) = request_headers
        .get("cookie")
        .or_else(|| request_headers.get("Cookie"))
    {
        for part in cookie_hdr.split(';') {
            let part = part.trim();
            let Some((name, value)) = part.split_once('=') else {
                continue;
            };
            cookies.push(UiHttpCookie {
                name: name.trim().to_string(),
                value: value.trim().to_string(),
                domain: fallback_domain.to_string(),
                path: "/".to_string(),
                secure: false,
                http_only: false,
            });
        }
    }

    for (k, v) in response_headers {
        if !k.eq_ignore_ascii_case("set-cookie") {
            continue;
        }
        if let Ok(parsed) = cookie::Cookie::parse(v.clone()) {
            let mut domain = fallback_domain.to_string();
            if let Some(d) = parsed.domain() {
                domain = d.to_string();
            }
            let path = parsed.path().unwrap_or("/").to_string();
            cookies.push(UiHttpCookie {
                name: parsed.name().to_string(),
                value: parsed.value().to_string(),
                domain,
                path,
                secure: parsed.secure().unwrap_or(false),
                http_only: parsed.http_only().unwrap_or(false),
            });
        }
    }

    cookies
}
