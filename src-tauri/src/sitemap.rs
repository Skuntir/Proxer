use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{error::Result, storage::SqliteStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSitemapNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub method: Option<String>,
    pub url: Option<String>,
    pub last_id: Option<String>,
    pub last_started_ms: Option<i64>,
    pub last_status: Option<i64>,
    pub children: Option<Vec<UiSitemapNode>>,
    pub request_count: Option<i64>,
}

pub async fn build_sitemap(store: Arc<SqliteStore>, limit: u32) -> Result<Vec<UiSitemapNode>> {
    let rows = store.traffic_sitemap_rows(limit).await?;

    let mut hosts: BTreeMap<String, HostNode> = BTreeMap::new();
    for (host, method, url, count, last_id, last_started_ms, last_status) in rows {
        let path = url::Url::parse(&url)
            .ok()
            .map(|u| {
                let mut p = u.path().to_string();
                if let Some(q) = u.query() {
                    p.push('?');
                    p.push_str(q);
                }
                p
            })
            .unwrap_or_else(|| "/".to_string());

        let entry = hosts.entry(host.clone()).or_insert_with(|| HostNode::new(&host));
        entry.insert_endpoint(&path, &method, &url, count, &last_id, last_started_ms, last_status);
    }

    Ok(hosts.into_values().map(|h| h.into_ui()).collect())
}

struct HostNode {
    host: String,
    folders: BTreeMap<String, FolderNode>,
    endpoints: Vec<UiSitemapNode>,
}

impl HostNode {
    fn new(host: &str) -> Self {
        Self {
            host: host.to_string(),
            folders: BTreeMap::new(),
            endpoints: Vec::new(),
        }
    }

    fn insert_endpoint(
        &mut self,
        path: &str,
        method: &str,
        url: &str,
        count: i64,
        last_id: &str,
        last_started_ms: i64,
        last_status: Option<i64>,
    ) {
        let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            self.endpoints
                .push(endpoint_node(
                    &format!("{}/", self.host),
                    "/",
                    method,
                    url,
                    count,
                    last_id,
                    last_started_ms,
                    last_status,
                ));
            return;
        }

        let last = parts.pop().unwrap_or("");
        let mut cur: Option<&mut FolderNode> = None;
        for seg in parts {
            let next = match cur.take() {
                None => self
                    .folders
                    .entry(seg.to_string())
                    .or_insert_with(|| FolderNode::new(seg)),
                Some(node) => node
                    .folders
                    .entry(seg.to_string())
                    .or_insert_with(|| FolderNode::new(seg)),
            };
            cur = Some(next);
        }
        match cur {
            Some(node) => node
                .endpoints
                .push(endpoint_node(
                    &format!("{}:{}:{}", self.host, path, method),
                    last,
                    method,
                    url,
                    count,
                    last_id,
                    last_started_ms,
                    last_status,
                )),
            None => self
                .endpoints
                .push(endpoint_node(
                    &format!("{}:{}:{}", self.host, path, method),
                    last,
                    method,
                    url,
                    count,
                    last_id,
                    last_started_ms,
                    last_status,
                )),
        }
    }

    fn into_ui(self) -> UiSitemapNode {
        let mut children: Vec<UiSitemapNode> = Vec::new();
        for folder in self.folders.into_values() {
            children.push(folder.into_ui(&self.host));
        }
        children.extend(self.endpoints);

        UiSitemapNode {
            id: format!("host:{}", self.host),
            name: self.host,
            node_type: "host".into(),
            method: None,
            url: None,
            last_id: None,
            last_started_ms: None,
            last_status: None,
            children: Some(children),
            request_count: None,
        }
    }
}

struct FolderNode {
    name: String,
    folders: BTreeMap<String, FolderNode>,
    endpoints: Vec<UiSitemapNode>,
}

impl FolderNode {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            folders: BTreeMap::new(),
            endpoints: Vec::new(),
        }
    }

    fn into_ui(self, host: &str) -> UiSitemapNode {
        let mut children: Vec<UiSitemapNode> = Vec::new();
        for folder in self.folders.into_values() {
            children.push(folder.into_ui(host));
        }
        children.extend(self.endpoints);

        UiSitemapNode {
            id: format!("folder:{host}:{}", self.name),
            name: self.name,
            node_type: "folder".into(),
            method: None,
            url: None,
            last_id: None,
            last_started_ms: None,
            last_status: None,
            children: Some(children),
            request_count: None,
        }
    }
}

fn endpoint_node(
    id: &str,
    name: &str,
    method: &str,
    url: &str,
    count: i64,
    last_id: &str,
    last_started_ms: i64,
    last_status: Option<i64>,
) -> UiSitemapNode {
    UiSitemapNode {
        id: id.to_string(),
        name: name.to_string(),
        node_type: "endpoint".into(),
        method: Some(method.to_string()),
        url: Some(url.to_string()),
        last_id: Some(last_id.to_string()),
        last_started_ms: Some(last_started_ms),
        last_status,
        children: None,
        request_count: Some(count),
    }
}
