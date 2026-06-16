'use client'

import { invoke } from '@tauri-apps/api/core'

export type UnlistenFn = () => void

export type AppInfo = { name: string; version: string }

export async function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info')
}

export type HttpCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure?: boolean
  httpOnly?: boolean
}

export type HttpRequest = {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | string
  url: string
  host: string
  path: string
  statusCode: number
  time: string
  size: string
  contentType: string
  headers: Record<string, string>
  requestHeaders: Record<string, string>
  body: string
  responseBody: string
  cookies: HttpCookie[]
  timestamp: string
  protocol: 'HTTP' | 'HTTPS' | string
  port: number
}

export type BackendEvent =
  | {
      type: 'ProxyStatusChanged'
      payload: { ts_ms: number; running: boolean; bind?: string | null }
    }
  | {
      type: 'RequestCaptured'
      payload: {
        ts_ms: number
        id: string
        method: string
        url: string
        host: string
        scheme: string
        request_bytes: number
        preview_base64: string
      }
    }
  | {
      type: 'ResponseReceived'
      payload: {
        ts_ms: number
        id: string
        status: number
        response_bytes: number
        preview_base64: string
        elapsed_ms: number
      }
    }
  | { type: 'RequestModified'; payload: { ts_ms: number; id: string; reason: string } }
  | { type: 'RuleTriggered'; payload: { ts_ms: number; id: string; rule_id: string; action: string } }
  | {
      type: 'TlsHandshake'
      payload: { ts_ms: number; host: string; mode: string; ok: boolean; error?: string | null }
    }
  | {
      type: 'InterceptPaused'
      payload: { ts_ms: number; interception_id: string; request_id: string; raw: string }
    }
  | { type: 'LogEmitted'; payload: { ts_ms: number; entry: LogEntry } }
  | { type: 'ScanStarted'; payload: { ts_ms: number; scan_id: string } }
  | { type: 'ScanProgress'; payload: { ts_ms: number; scan_id: string; done: number; total: number } }
  | { type: 'ScanFinding'; payload: { ts_ms: number; scan_id: string; finding: Vulnerability } }
  | { type: 'ScanCompleted'; payload: { ts_ms: number; scan_id: string } }
  | { type: 'IntruderStarted'; payload: { ts_ms: number; attack_id: string } }
  | { type: 'IntruderProgress'; payload: { ts_ms: number; attack_id: string; done: number; total: number } }
  | { type: 'IntruderResult'; payload: { ts_ms: number; attack_id: string; result: IntruderResult } }
  | { type: 'IntruderCompleted'; payload: { ts_ms: number; attack_id: string } }
  | { type: 'ExtensionInstalled'; payload: { ts_ms: number; id: string } }
  | { type: 'ExtensionEnabledChanged'; payload: { ts_ms: number; id: string; enabled: boolean } }

export type Settings = {
  theme: 'light' | 'dark' | 'system' | string
  fontSize: number
  fontFamily: string
  compactMode: boolean
  showExamples: boolean
  projectName: string
  autoSave: boolean
  maxHistoryItems: number
  maxResponseSizeMb: number
  hardwareAcceleration: boolean
  autoUpdate: boolean
  betaUpdates: boolean
  requestTimeoutSeconds: number
  maxConcurrentConnections: number
  followRedirectsMax: number
  upstreamProxyEnabled: boolean
  verifyCertificates: boolean
  showConnectTunnels: boolean
  scopeRegex: string
  systemProxyEnabled: boolean
}

export async function settingsGet(): Promise<Settings> {
  return invoke<Settings>('settings_get')
}

export async function settingsSet(patch: Partial<Settings>): Promise<Settings> {
  return invoke<Settings>('settings_set', { patch })
}

export async function projectOpenFolderDialog(): Promise<ProjectStatus | null> {
  return invoke<ProjectStatus | null>('project_open_folder_dialog')
}

export type LogEntry = {
  id: string
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' | string
  source: string
  message: string
}

export async function logsList(level?: string, limit = 500, offset = 0): Promise<LogEntry[]> {
  return invoke<LogEntry[]>('logs_list', { level, limit, offset })
}

export async function logsClear(): Promise<void> {
  return invoke<void>('logs_clear')
}

export async function trafficClear(): Promise<void> {
  return invoke<void>('traffic_clear')
}

export type DashboardStats = {
  totalRequests: number
  uniqueHosts: number
  totalTransferredBytes: number
  avgResponseMs: number
}

export async function dashboardStats(): Promise<DashboardStats> {
  return invoke<DashboardStats>('dashboard_stats')
}

export type DashboardDetails = {
  responseCodes: {
    success2xx: number
    redirect3xx: number
    client4xx: number
    server5xx: number
    noResponse: number
  }
  topHosts: { host: string; requests: number }[]
  severity: { severity: string; count: number }[]
  activity: { bucketMs: number; requests: number }[]
  system: { cpu: number; memory: number; disk: number }
}

export async function dashboardDetails(range?: string): Promise<DashboardDetails> {
  return invoke<DashboardDetails>('dashboard_details', { range })
}

export async function configExport(): Promise<string> {
  return invoke<string>('config_export')
}

export async function configImport(json: string): Promise<void> {
  return invoke<void>('config_import', { json })
}

export type SitemapNode = {
  id: string
  name: string
  type: 'host' | 'folder' | 'endpoint' | string
  method?: string
  url?: string
  lastId?: string
  lastStartedMs?: number
  lastStatus?: number
  children?: SitemapNode[]
  requestCount?: number
}

export async function sitemapGet(limit = 2000): Promise<SitemapNode[]> {
  return invoke<SitemapNode[]>('sitemap_get', { limit })
}

export type Vulnerability = {
  id: string
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info' | string
  title: string
  path: string
  host: string
  description: string
  remediation: string
  confidence: 'Certain' | 'Firm' | 'Tentative' | string
  cvss?: string | null
  cwe?: string | null
  requests: number
}

export type ScanStatus = {
  running: boolean
  scanId?: string | null
  progressDone: number
  progressTotal: number
}

export async function scannerStart(limit = 5000): Promise<string> {
  return invoke<string>('scanner_start', { limit })
}

export async function scannerStop(): Promise<void> {
  return invoke<void>('scanner_stop')
}

export async function scannerStatus(): Promise<ScanStatus> {
  return invoke<ScanStatus>('scanner_status')
}

export async function scannerFindingsList(
  severity?: string,
  limit = 1000,
  offset = 0
): Promise<Vulnerability[]> {
  return invoke<Vulnerability[]>('scanner_findings_list', { severity, limit, offset })
}

export type IntruderStartRequest = {
  attackType: string
  templateRaw: string
  payloads: string[]
  payloadSets?: string[][]
}

export type IntruderStartResponse = {
  attackId: string
  positions: number
  payloadCount: number
}

export type IntruderResult = {
  id: string
  tsMs: number
  seq: number
  statusCode?: number | null
  durationMs?: number | null
  size?: number | null
  error?: string | null
}

export async function intruderStart(req: IntruderStartRequest): Promise<IntruderStartResponse> {
  return invoke<IntruderStartResponse>('intruder_start', { req })
}

export async function intruderStop(): Promise<void> {
  return invoke<void>('intruder_stop')
}

export async function intruderResultsList(attackId: string, limit = 500, offset = 0): Promise<IntruderResult[]> {
  return invoke<IntruderResult[]>('intruder_results_list', { attack_id: attackId, limit, offset })
}

export type Extension = {
  id: string
  name: string
  author: string
  description: string
  version: string
  installed: boolean
  enabled: boolean
  rating: number
  downloads: string
  category: string
}

export async function extensionsList(installed?: boolean): Promise<Extension[]> {
  return invoke<Extension[]>('extensions_list', { installed })
}

export async function extensionsInstall(id: string): Promise<void> {
  return invoke<void>('extensions_install', { id })
}

export async function extensionsSetEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>('extensions_set_enabled', { id, enabled })
}

export type ProxyStatus = { running: boolean; bind?: string | null }

export async function proxyStatus(): Promise<ProxyStatus> {
  return invoke<ProxyStatus>('proxy_status')
}

export async function proxyStart(port?: number): Promise<ProxyStatus> {
  return invoke<ProxyStatus>('proxy_start', { port })
}

export async function proxyStop(): Promise<void> {
  return invoke<void>('proxy_stop')
}

export type CaInfo = { certPemPath: string }

export async function tlsCaInfo(): Promise<CaInfo | null> {
  return invoke<CaInfo | null>('tls_ca_info')
}

export async function tlsGenerateCa(): Promise<CaInfo> {
  return invoke<CaInfo>('tls_generate_ca')
}

export async function tlsSetMitmEnabled(enabled: boolean): Promise<void> {
  return invoke<void>('tls_set_mitm_enabled', { enabled })
}

export async function tlsGetMitmEnabled(): Promise<boolean> {
  return invoke<boolean>('tls_get_mitm_enabled')
}

export async function tlsExportCaPem(): Promise<string> {
  return invoke<string>('tls_export_ca_pem')
}

export async function tlsExportCaDerBase64(): Promise<string> {
  return invoke<string>('tls_export_ca_der_base64')
}

export type ExportedCaFiles = { pemPath: string; cerPath: string }

export async function tlsExportCaToDownloads(): Promise<ExportedCaFiles> {
  return invoke<ExportedCaFiles>('tls_export_ca_to_downloads')
}

export type ExportedTextFile = { path: string }

export async function downloadsWriteText(filename: string, contents: string): Promise<ExportedTextFile> {
  return invoke<ExportedTextFile>('downloads_write_text', { filename, contents })
}

export async function tlsImportCaPem(certPem: string, keyPem: string): Promise<CaInfo> {
  return invoke<CaInfo>('tls_import_ca_pem', { cert_pem: certPem, key_pem: keyPem })
}

export type RuleSpec = {
  id: string
  name: string
  enabled: boolean
  matcher: {
    method?: string | null
    urlContains?: string | null
    headerEquals: { name: string; value: string }[]
    statusCode?: number | null
  }
  actions: any[]
}

export async function rulesList(): Promise<RuleSpec[]> {
  return invoke<RuleSpec[]>('rules_list')
}

export async function rulesUpsert(rule: RuleSpec): Promise<void> {
  return invoke<void>('rules_upsert', { rule })
}

export async function rulesRemove(id: string): Promise<boolean> {
  return invoke<boolean>('rules_remove', { id })
}

export async function historyReplay(id: string): Promise<string> {
  return invoke<string>('history_replay', { id })
}

export async function uiHistoryList(limit = 200, offset = 0): Promise<HttpRequest[]> {
  return invoke<HttpRequest[]>('ui_history_list', { limit, offset })
}

export async function uiHistoryGet(id: string): Promise<HttpRequest> {
  return invoke<HttpRequest>('ui_history_get', { id })
}

export type RepeaterSendResult = {
  statusCode: number
  durationMs: number
  size: number
  rawResponse: string
}

export async function repeaterSendRaw(rawRequest: string): Promise<RepeaterSendResult> {
  return invoke<RepeaterSendResult>('repeater_send_raw', { rawRequest })
}

export type ProjectStatus = {
  mode: 'temporary' | 'project' | string
  path?: string | null
  recentPath?: string | null
}

export async function projectStatus(): Promise<ProjectStatus> {
  return invoke<ProjectStatus>('project_status')
}

export async function projectUseTemporary(): Promise<ProjectStatus> {
  return invoke<ProjectStatus>('project_use_temporary')
}

export async function projectOpen(path: string): Promise<ProjectStatus> {
  return invoke<ProjectStatus>('project_open', { path })
}

export async function interceptGetEnabled(): Promise<boolean> {
  return invoke<boolean>('intercept_get_enabled')
}

export async function interceptSetEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>('intercept_set_enabled', { enabled })
}

export async function interceptForward(interceptionId: string, editedRaw?: string): Promise<void> {
  return invoke<void>('intercept_forward', { interception_id: interceptionId, edited_raw: editedRaw })
}

export async function interceptDrop(interceptionId: string): Promise<void> {
  return invoke<void>('intercept_drop', { interception_id: interceptionId })
}

const backendEventHandlers = new Set<(ev: BackendEvent) => void>()
let backendEventLoopRunning = false

export async function onBackendEvent(handler: (ev: BackendEvent) => void): Promise<UnlistenFn> {
  backendEventHandlers.add(handler)
  startBackendEventLoop()

  return () => {
    backendEventHandlers.delete(handler)
  }
}

function startBackendEventLoop() {
  if (backendEventLoopRunning) return
  backendEventLoopRunning = true

  let cursor = 0
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  ;(async () => {
    while (backendEventLoopRunning) {
      if (backendEventHandlers.size === 0) {
        await sleep(250)
        continue
      }

      try {
        const res = await invoke<{ cursor: number; events: BackendEvent[] }>('events_poll', {
          cursor,
          timeout_ms: 2500,
        })
        cursor = res.cursor
        for (const ev of res.events) {
          for (const activeHandler of [...backendEventHandlers]) {
            activeHandler(ev)
          }
        }
      } catch {
        await sleep(750)
      }
    }
  })()
}

export function formatDurationMs(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '-'
  return `${Math.round(ms)}ms`
}

export function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let b = bytes
  let idx = 0
  while (b >= 1024 && idx < units.length - 1) {
    b = b / 1024
    idx++
  }
  if (idx === 0) return `${Math.round(b)} ${units[idx]}`
  return `${b.toFixed(1)} ${units[idx]}`
}
