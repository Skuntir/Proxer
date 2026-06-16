use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{error::Result, storage::SqliteStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_requests: i64,
    pub unique_hosts: i64,
    pub total_transferred_bytes: i64,
    pub avg_response_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResponseCodes {
    pub success_2xx: i64,
    pub redirect_3xx: i64,
    pub client_4xx: i64,
    pub server_5xx: i64,
    pub no_response: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardHostItem {
    pub host: String,
    pub requests: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSeverityItem {
    pub severity: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardActivityItem {
    pub bucket_ms: i64,
    pub requests: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub cpu: i64,
    pub memory: i64,
    pub disk: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDetails {
    pub response_codes: DashboardResponseCodes,
    pub top_hosts: Vec<DashboardHostItem>,
    pub severity: Vec<DashboardSeverityItem>,
    pub activity: Vec<DashboardActivityItem>,
    pub system: SystemStatus,
}

pub async fn compute_dashboard_stats(store: Arc<SqliteStore>) -> Result<DashboardStats> {
    let (total_requests, total_req_bytes, avg_elapsed_ms, unique_hosts, total_resp_bytes) = store.traffic_stats().await?;
    Ok(DashboardStats {
        total_requests,
        unique_hosts,
        total_transferred_bytes: total_req_bytes + total_resp_bytes,
        avg_response_ms: avg_elapsed_ms.unwrap_or(0.0).round() as i64,
    })
}

pub async fn compute_dashboard_details(store: Arc<SqliteStore>, range: Option<&str>) -> Result<DashboardDetails> {
    let (c2, c3, c4, c5, c0) = store.traffic_status_buckets().await?;
    let top_hosts = store
        .traffic_top_hosts(6)
        .await?
        .into_iter()
        .map(|(host, requests)| DashboardHostItem { host, requests })
        .collect::<Vec<_>>();

    let severity = store
        .vulnerabilities_severity_counts()
        .await?
        .into_iter()
        .map(|(severity, count)| DashboardSeverityItem { severity, count })
        .collect::<Vec<_>>();

    let now = crate::events::now_ms();
    let (bucket_count, bucket_ms) = match range.unwrap_or("24h") {
        "1h" => (12_i64, 5 * 60 * 1000),
        "7d" => (7_i64, 24 * 60 * 60 * 1000),
        "30d" => (30_i64, 24 * 60 * 60 * 1000),
        _ => (24_i64, 60 * 60 * 1000),
    };
    let since_ms = now.saturating_sub((bucket_count - 1) * bucket_ms);
    let mut raw_activity = store
        .traffic_activity_buckets(since_ms, bucket_ms, bucket_count as u32)
        .await?
        .into_iter()
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut activity = Vec::with_capacity(bucket_count as usize);
    let first_bucket = (since_ms / bucket_ms) * bucket_ms;
    for i in 0..bucket_count {
        let bucket = first_bucket + (i * bucket_ms);
        activity.push(DashboardActivityItem {
            bucket_ms: bucket,
            requests: raw_activity.remove(&bucket).unwrap_or(0),
        });
    }

    let system = read_system_status();

    Ok(DashboardDetails {
        response_codes: DashboardResponseCodes {
            success_2xx: c2,
            redirect_3xx: c3,
            client_4xx: c4,
            server_5xx: c5,
            no_response: c0,
        },
        top_hosts,
        severity,
        activity,
        system,
    })
}

fn read_system_status() -> SystemStatus {
    use sysinfo::{Disks, System};

    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu = sys.global_cpu_usage().round().clamp(0.0, 100.0) as i64;

    let mem_total = sys.total_memory().max(1) as f64;
    let mem_used = sys.used_memory() as f64;
    let memory = ((mem_used / mem_total) * 100.0).round().clamp(0.0, 100.0) as i64;

    let disks = Disks::new_with_refreshed_list();
    let mut used: u64 = 0;
    let mut total: u64 = 0;
    for d in disks.list() {
        total = total.saturating_add(d.total_space());
        used = used.saturating_add(d.total_space().saturating_sub(d.available_space()));
    }
    let disk = if total == 0 {
        0
    } else {
        (((used as f64) / (total as f64)) * 100.0).round().clamp(0.0, 100.0) as i64
    };

    SystemStatus { cpu, memory, disk }
}
