use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::{error::Result, storage::SqliteStore};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackSurface {
    pub domains: Vec<SurfaceDomain>,
    pub hosts: Vec<SurfaceHost>,
    pub nodes: Vec<SurfaceNode>,
    pub edges: Vec<SurfaceEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceDomain {
    pub name: String,
    pub hosts: i64,
    pub requests: i64,
    pub endpoints: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceHost {
    pub host: String,
    pub domain: String,
    pub schemes: Vec<String>,
    pub methods: Vec<String>,
    pub requests: i64,
    pub endpoints: i64,
    pub success: i64,
    pub redirects: i64,
    pub client_errors: i64,
    pub server_errors: i64,
    pub technologies: Vec<String>,
    pub ports: Vec<String>,
    pub endpoint_paths: Vec<String>,
    pub api_paths: Vec<String>,
    pub interesting_paths: Vec<String>,
    pub auth_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceNode {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub weight: i64,
    pub lane: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceEdge {
    pub from: String,
    pub to: String,
    pub weight: i64,
}

#[derive(Default)]
struct HostAgg {
    host: String,
    domain: String,
    schemes: BTreeSet<String>,
    methods: BTreeSet<String>,
    endpoints: BTreeSet<String>,
    requests: i64,
    success: i64,
    redirects: i64,
    client_errors: i64,
    server_errors: i64,
    technologies: BTreeSet<String>,
    ports: BTreeSet<String>,
    endpoint_paths: BTreeMap<String, i64>,
    api_paths: BTreeMap<String, i64>,
    interesting_paths: BTreeMap<String, i64>,
    auth_paths: BTreeMap<String, i64>,
}

pub async fn build_attack_surface(store: &SqliteStore, limit: u32) -> Result<AttackSurface> {
    let rows = store.traffic_attack_surface_rows(limit, 0).await?;
    let mut hosts: BTreeMap<String, HostAgg> = BTreeMap::new();

    for (scheme, host, method, url, status, _req_headers, resp_headers) in rows {
        if host.trim().is_empty() {
            continue;
        }
        let domain = root_domain(&host);
        let parsed_url = url::Url::parse(&url).ok();
        let path = parsed_url
            .as_ref()
            .map(|u| {
                let mut p = u.path().to_string();
                if p.is_empty() {
                    p.push('/');
                }
                p
            })
            .unwrap_or_else(|| "/".into());
        let agg = hosts.entry(host.clone()).or_insert_with(|| HostAgg {
            host: host.clone(),
            domain,
            ..Default::default()
        });
        agg.requests += 1;
        agg.schemes.insert(scheme.to_uppercase());
        agg.methods.insert(method);
        agg.endpoints.insert(path.clone());
        if let Some(port) = parsed_url
            .as_ref()
            .and_then(|u| u.port_or_known_default())
            .or_else(|| {
                if scheme == "https" {
                    Some(443)
                } else if scheme == "http" {
                    Some(80)
                } else {
                    None
                }
            })
        {
            agg.ports.insert(format!("Port {port}"));
        }
        *agg.endpoint_paths.entry(path.clone()).or_default() += 1;
        if is_api_path(&path) {
            *agg.api_paths.entry(path.clone()).or_default() += 1;
        }
        match status.unwrap_or(0) {
            200..=299 => agg.success += 1,
            300..=399 => agg.redirects += 1,
            400..=499 => agg.client_errors += 1,
            500..=599 => agg.server_errors += 1,
            _ => {}
        }

        for tech in technology_hints(resp_headers.as_deref().unwrap_or_default()) {
            agg.technologies.insert(tech);
        }
        if is_interesting_path(&path) {
            *agg.interesting_paths.entry(path.clone()).or_default() += 1;
        }
        if is_auth_path(&path) {
            *agg.auth_paths.entry(path).or_default() += 1;
        }
    }

    let mut domain_map: BTreeMap<String, (BTreeSet<String>, i64, BTreeSet<String>)> =
        BTreeMap::new();
    for agg in hosts.values() {
        let entry = domain_map.entry(agg.domain.clone()).or_default();
        entry.0.insert(agg.host.clone());
        entry.1 += agg.requests;
        for ep in &agg.endpoints {
            entry.2.insert(format!("{}{}", agg.host, ep));
        }
    }

    let mut domains = domain_map
        .iter()
        .map(|(name, (hosts, requests, endpoints))| SurfaceDomain {
            name: name.clone(),
            hosts: hosts.len() as i64,
            requests: *requests,
            endpoints: endpoints.len() as i64,
        })
        .collect::<Vec<_>>();
    domains.sort_by(|a, b| b.requests.cmp(&a.requests));

    let mut surface_hosts = hosts
        .into_values()
        .map(|agg| SurfaceHost {
            host: agg.host,
            domain: agg.domain,
            schemes: agg.schemes.into_iter().collect(),
            methods: agg.methods.into_iter().collect(),
            requests: agg.requests,
            endpoints: agg.endpoints.len() as i64,
            success: agg.success,
            redirects: agg.redirects,
            client_errors: agg.client_errors,
            server_errors: agg.server_errors,
            technologies: agg.technologies.into_iter().collect(),
            ports: agg.ports.into_iter().collect(),
            endpoint_paths: top_keys(agg.endpoint_paths, 24),
            api_paths: top_keys(agg.api_paths, 16),
            interesting_paths: top_keys(agg.interesting_paths, 8),
            auth_paths: top_keys(agg.auth_paths, 8),
        })
        .collect::<Vec<_>>();
    surface_hosts.sort_by(|a, b| b.requests.cmp(&a.requests));

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    nodes.push(SurfaceNode {
        id: "internet".into(),
        label: "Captured Traffic".into(),
        kind: "root".into(),
        weight: domains.iter().map(|d| d.requests).sum(),
        lane: 0,
    });

    for domain in &domains {
        let domain_id = format!("domain:{}", domain.name);
        nodes.push(SurfaceNode {
            id: domain_id.clone(),
            label: domain.name.clone(),
            kind: "domain".into(),
            weight: domain.requests,
            lane: 1,
        });
        edges.push(SurfaceEdge {
            from: "internet".into(),
            to: domain_id.clone(),
            weight: domain.requests,
        });

        for host in surface_hosts
            .iter()
            .filter(|h| h.domain == domain.name)
            .take(24)
        {
            let host_id = format!("host:{}", host.host);
            nodes.push(SurfaceNode {
                id: host_id.clone(),
                label: host.host.clone(),
                kind: "host".into(),
                weight: host.requests,
                lane: 2,
            });
            edges.push(SurfaceEdge {
                from: domain_id.clone(),
                to: host_id.clone(),
                weight: host.requests,
            });

            for port in host.ports.iter().take(12) {
                let port_id = format!("port:{}:{}", host.host, port);
                nodes.push(SurfaceNode {
                    id: port_id.clone(),
                    label: port.clone(),
                    kind: "port".into(),
                    weight: host.requests,
                    lane: 3,
                });
                edges.push(SurfaceEdge {
                    from: host_id.clone(),
                    to: port_id,
                    weight: host.requests,
                });
            }

            for tech in host.technologies.iter().take(10) {
                let tech_id = format!("tech:{}:{}", host.host, tech);
                nodes.push(SurfaceNode {
                    id: tech_id.clone(),
                    label: tech.clone(),
                    kind: "tech".into(),
                    weight: host.requests,
                    lane: 3,
                });
                edges.push(SurfaceEdge {
                    from: host_id.clone(),
                    to: tech_id,
                    weight: host.requests,
                });
            }

            for endpoint in endpoint_groups(host).into_iter().take(32) {
                let kind = if host.api_paths.iter().any(|p| p == &endpoint) {
                    "api"
                } else if host.auth_paths.iter().any(|p| p == &endpoint) {
                    "auth"
                } else if host.interesting_paths.iter().any(|p| p == &endpoint) {
                    "interesting"
                } else {
                    "endpoint"
                };
                let group_id = format!("{kind}:{}:{}", host.host, endpoint);
                nodes.push(SurfaceNode {
                    id: group_id.clone(),
                    label: endpoint,
                    kind: kind.into(),
                    weight: 1,
                    lane: 4,
                });
                edges.push(SurfaceEdge {
                    from: host_id.clone(),
                    to: group_id,
                    weight: host.endpoints,
                });
            }
        }
    }

    Ok(AttackSurface {
        domains,
        hosts: surface_hosts,
        nodes,
        edges,
    })
}

fn root_domain(host: &str) -> String {
    let without_port = host.split(':').next().unwrap_or(host);
    let parts = without_port
        .split('.')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    if parts.len() >= 2 {
        format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
    } else {
        without_port.to_string()
    }
}

fn technology_hints(headers: &str) -> Vec<String> {
    let lower = headers.to_ascii_lowercase();
    let mut out = Vec::new();
    for (needle, label) in [
        ("server", "Server header"),
        ("x-powered-by", "X-Powered-By"),
        ("cloudflare", "Cloudflare"),
        ("nginx", "nginx"),
        ("apache", "Apache"),
        ("express", "Express"),
        ("next.js", "Next.js"),
        ("vercel", "Vercel"),
        ("aws", "AWS"),
        ("akamai", "Akamai"),
        ("fastly", "Fastly"),
        ("set-cookie", "Cookies"),
        ("strict-transport-security", "HSTS"),
        ("content-security-policy", "CSP"),
    ] {
        if lower.contains(needle) {
            out.push(label.to_string());
        }
    }
    out
}

fn is_interesting_path(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    [
        "admin", "debug", "internal", "graphql", "swagger", "openapi", "api-docs", "actuator",
        "metrics", "health", "config", ".env", "backup",
    ]
    .iter()
    .any(|needle| p.contains(needle))
}

fn is_auth_path(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    [
        "login", "logout", "oauth", "sso", "saml", "token", "session", "auth", "jwt", "password",
        "reset",
    ]
    .iter()
    .any(|needle| p.contains(needle))
}

fn is_api_path(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    p.contains("/api")
        || p.contains("/graphql")
        || p.contains("/rpc")
        || p.contains("/rest")
        || p.contains("openapi")
        || p.contains("swagger")
}

fn top_keys(map: BTreeMap<String, i64>, limit: usize) -> Vec<String> {
    let mut items = map.into_iter().collect::<Vec<_>>();
    items.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    items.into_iter().take(limit).map(|(k, _)| k).collect()
}

fn endpoint_groups(host: &SurfaceHost) -> Vec<String> {
    let mut groups = BTreeSet::new();
    for path in host
        .api_paths
        .iter()
        .chain(host.auth_paths.iter())
        .chain(host.interesting_paths.iter())
        .chain(host.endpoint_paths.iter())
    {
        groups.insert(path.clone());
    }
    if groups.is_empty() {
        groups.insert(format!("{} endpoints", host.endpoints));
    }
    groups.into_iter().collect()
}
