'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
} from '@xyflow/react'
import { 
  ShieldAlert, Crosshair, FileText, Activity, Zap, Lock, 
  ChevronRight, ChevronLeft, ChevronDown, Folder, FileCode, Globe, Play, Pause, Plus, Trash2, Download,
  AlertTriangle, Search, Filter, RefreshCw, Send, Copy,
  ArrowRightLeft, Star, Package, RotateCcw,
  Upload, Clipboard, X, ArrowUp, Edit3,
  HardDrive, Cpu, MemoryStick, Sparkles, KeyRound, Network
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { applyTheme } from '@/lib/theme'
import { applyTypography } from '@/lib/typography'
import { checkForUpdates } from '@/lib/update-check'
import { buildLineDiff, type DiffRow } from '@/lib/diff'
import { cn } from '@/lib/utils'
import { uiInfo, uiPrompt, uiToastError, uiToastSuccess, uiTwoField } from '@/lib/overlays'
import {
  appInfo,
  apiLeaksScan,
  attackSurfaceGet,
  configExport,
  configImport,
  dashboardStats,
  dashboardDetails,
  downloadsWriteText,
  extensionsInstall,
  extensionsList,
  extensionsSetEnabled,
  formatBytes,
  formatDurationMs,
  interceptDrop,
  interceptForward,
  interceptQueue,
  intruderStart,
  intruderStop,
  logsClear,
  logsList,
  onBackendEvent,
  proxyStart,
  proxyStatus,
  proxyStop,
  rulesList,
  rulesRemove,
  rulesUpsert,
  repeaterSendRaw,
  scannerFindingsList,
  scannerStart,
  scannerStatus,
  scannerStop,
  settingsGet,
  settingsSet,
  sitemapGet,
  uiHistoryGet,
  tlsCaInfo,
  tlsExportCaToDownloads,
  tlsGenerateCa,
  tlsGetMitmEnabled,
  tlsFingerprintOptions,
  tlsImportCaPem,
  tlsSetMitmEnabled,
  type BackendEvent,
  type AppInfo,
  type ApiLeakFinding,
  type ApiLeakSummary,
  type AttackSurface,
  type DashboardDetails,
  type DashboardStats,
  type Extension,
  type LogEntry,
  type HttpRequest,
  type InterceptQueueItem,
  type IntruderResult,
  type RepeaterSendResult,
  type RuleSpec,
  type ScanStatus,
  type Settings,
  type SitemapNode,
  type TlsFingerprintOptions,
  type Vulnerability,
} from '@/lib/proxer'

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [details, setDetails] = useState<DashboardDetails | null>(null)
  const [activityRange, setActivityRange] = useState('24h')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [recentFindings, setRecentFindings] = useState<Vulnerability[]>([])
  const reloadTimerRef = useRef<number | null>(null)
  const reloadInFlightRef = useRef(false)
  const activityRangeRef = useRef('24h')

  const reload = async () => {
    if (reloadInFlightRef.current) return
    reloadInFlightRef.current = true
    try {
      const [ds, dd, ss, findings] = await Promise.all([
        dashboardStats(),
        dashboardDetails(activityRangeRef.current),
        scannerStatus(),
        scannerFindingsList(undefined, 10, 0),
      ])
      setStats(ds)
      setDetails(dd)
      setScanStatus(ss)
      setRecentFindings(findings.slice(0, 4))
    } finally {
      reloadInFlightRef.current = false
    }
  }

  const scheduleReload = () => {
    if (reloadTimerRef.current) return
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null
      reload().catch(() => {
        reloadInFlightRef.current = false
      })
    }, 1000)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    const onCleared = () => reload().catch(() => {})
    onBackendEvent((ev) => {
      if (ev.type === 'RequestCaptured' || ev.type === 'ResponseReceived') {
        scheduleReload()
      }
      if (ev.type === 'ScanFinding' || ev.type === 'ScanProgress' || ev.type === 'ScanCompleted') {
        scheduleReload()
      }
    }).then((u) => (unlisten = u))
    window.addEventListener('skuntir:traffic-cleared', onCleared)
    return () => {
      unlisten?.()
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      window.removeEventListener('skuntir:traffic-cleared', onCleared)
    }
  }, [])

  const statCards = [
    {
      label: 'Total Requests',
      value: stats ? String(stats.totalRequests) : '-',
      change: scanStatus?.running ? 'Capturing' : 'Idle',
      changeType: 'increase',
      icon: Activity,
    },
    {
      label: 'Vulnerabilities',
      value: stats ? String(recentFindings.length) : '-',
      change: recentFindings.some((v) => v.severity === 'Critical') ? 'Critical present' : 'No critical',
      changeType: 'alert',
      icon: AlertTriangle,
    },
    {
      label: 'Avg Response',
      value: stats ? `${stats.avgResponseMs}ms` : '-',
      change: scanStatus?.running ? 'Scanning' : '—',
      changeType: 'decrease',
      icon: Zap,
    },
    {
      label: 'Unique Hosts',
      value: stats ? String(stats.uniqueHosts) : '-',
      change: 'Observed',
      changeType: 'increase',
      icon: Globe,
    },
    {
      label: 'Data Transferred',
      value: stats ? formatBytes(stats.totalTransferredBytes) : '-',
      change: 'Captured',
      changeType: 'increase',
      icon: HardDrive,
    },
    {
      label: 'Active Scans',
      value: scanStatus?.running ? '1' : '0',
      change: scanStatus?.running ? 'Running' : 'Stopped',
      changeType: 'active',
      icon: Radar,
    },
  ] as const

  const severityItems = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of details?.severity ?? []) counts.set(it.severity, it.count)
    const order = ['Critical', 'High', 'Medium', 'Low', 'Info']
    const total = order.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0)
    const colors: Record<string, string> = {
      Critical: 'bg-status-server-error',
      High: 'bg-status-server-error',
      Medium: 'bg-status-client-error',
      Low: 'bg-status-redirect',
      Info: 'bg-muted-foreground',
    }
    return order.map((severity) => {
      const count = counts.get(severity) ?? 0
      const pct = total > 0 ? Math.round((count / total) * 100) : 0
      return { severity, count, percentage: pct, color: colors[severity] ?? 'bg-muted-foreground' }
    })
  }, [details])

  const responseCodeItems = useMemo(() => {
    const rc = details?.responseCodes
    return [
      { code: '2xx', label: 'Success', count: rc?.success2xx ?? 0, color: 'text-status-success', bg: 'bg-status-success/10' },
      { code: '3xx', label: 'Redirect', count: rc?.redirect3xx ?? 0, color: 'text-status-redirect', bg: 'bg-status-redirect/10' },
      { code: '4xx', label: 'Client Err', count: rc?.client4xx ?? 0, color: 'text-status-client-error', bg: 'bg-status-client-error/10' },
      { code: '5xx', label: 'Server Err', count: rc?.server5xx ?? 0, color: 'text-status-server-error', bg: 'bg-status-server-error/10' },
    ] as const
  }, [details])

  const topHostItems = useMemo(() => {
    const items = details?.topHosts ?? []
    const max = Math.max(1, ...items.map((i) => i.requests))
    return items.map((i) => ({ ...i, percentage: Math.round((i.requests / max) * 100) }))
  }, [details])

  const activityItems = useMemo(() => {
    const items = details?.activity ?? []
    const max = Math.max(1, ...items.map((i) => i.requests))
    return items.map((item) => ({
      ...item,
      height: item.requests > 0 ? Math.max(6, Math.round((item.requests / max) * 100)) : 0,
      label:
        activityRange === '1h' || activityRange === '24h'
          ? new Date(item.bucketMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : new Date(item.bucketMs).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    }))
  }, [activityRange, details])

  const activityAxisLabels = useMemo(() => {
    if (activityItems.length === 0) return ['-', '-', '-', '-', '-']
    const last = activityItems.length - 1
    return [0, 0.25, 0.5, 0.75, 1].map((p) => activityItems[Math.round(last * p)]?.label ?? '-')
  }, [activityItems])

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor proxy activity and security findings</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3 bg-status-success/10 text-status-success border-status-success/20">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            Project Active
          </Badge>
          <Button variant="outline" size="sm" onClick={() => reload().catch(() => {})}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const report = {
                generatedAt: new Date().toISOString(),
                stats,
                details,
                recentFindings,
              }
              downloadsWriteText(`proxer-report-${Date.now()}.json`, JSON.stringify(report, null, 2))
                .then((r) => uiToastSuccess('Report exported', r.path))
                .catch(() => {})
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="p-4 bg-card border-border hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                <p className={cn(
                  'text-xs font-medium mt-1',
                  stat.changeType === 'alert' ? 'text-destructive' : 
                  stat.changeType === 'increase' ? 'text-status-success' : 
                  stat.changeType === 'active' ? 'text-primary' : 'text-muted-foreground'
                )}>
                  {stat.change}
                </p>
              </div>
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center',
                stat.changeType === 'alert' ? 'bg-destructive/10' : 'bg-primary/10'
              )}>
                <stat.icon className={cn(
                  'w-5 h-5',
                  stat.changeType === 'alert' ? 'text-destructive' : 'text-primary'
                )} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 p-4 bg-card border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Request Activity</h3>
            <Select
              value={activityRange}
              onValueChange={(value) => {
                activityRangeRef.current = value
                setActivityRange(value)
                reload().catch(() => {})
              }}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="h-48 flex items-end justify-between gap-1 px-4 border-b border-border">
            {activityItems.map((item) => (
              <div
                key={item.bucketMs}
                className={cn(
                  'flex-1 rounded-t transition-colors',
                  item.requests > 0 ? 'bg-primary/35 hover:bg-primary/60 cursor-pointer' : 'bg-muted/30'
                )}
                style={{ height: `${item.height}%` }}
                title={`${item.label}: ${item.requests} request${item.requests === 1 ? '' : 's'}`}
              />
            ))}
          </div>
          <div className="flex justify-between px-4 mt-2 text-[10px] text-muted-foreground">
            {activityAxisLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-card border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Recent Findings</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-primary"
              onClick={() => appNavigate('scanner')}
            >
              View All
            </Button>
          </div>
          <ScrollArea className="h-52">
            <div className="space-y-2">
              {recentFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer border border-transparent hover:border-border"
                  onClick={() => appNavigate('scanner')}
                >
                  <div className="flex items-start gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{finding.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{finding.path}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Severity Distribution</h3>
          <div className="space-y-3">
            {severityItems.map((item) => (
              <div key={item.severity} className="flex items-center gap-3">
                <div className="w-14 text-xs text-muted-foreground">{item.severity}</div>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', item.color)} style={{ width: `${item.percentage}%` }} />
                </div>
                <div className="w-6 text-xs font-medium text-foreground text-right">{item.count}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Response Codes</h3>
          <div className="grid grid-cols-2 gap-2">
            {responseCodeItems.map((item) => (
              <div key={item.code} className={cn('p-3 rounded-lg', item.bg)}>
                <span className={cn('text-lg font-bold', item.color)}>{item.count}</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.code} {item.label}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Top Hosts</h3>
          <div className="space-y-2.5">
            {topHostItems.map((item) => (
              <div key={item.host} className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{item.host}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={item.percentage} className="h-1.5 flex-1" />
                    <span className="text-[10px] text-muted-foreground w-8">{item.requests}</span>
                  </div>
                </div>
              </div>
            ))}
            {topHostItems.length === 0 && (
              <div className="text-xs text-muted-foreground">No traffic captured yet.</div>
            )}
          </div>
        </Card>

        <Card className="p-4 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">System Status</h3>
          <div className="space-y-3">
            {[
              { label: 'CPU Usage', value: details?.system.cpu ?? 0, icon: Cpu },
              { label: 'Memory', value: details?.system.memory ?? 0, icon: MemoryStick },
              { label: 'Disk', value: details?.system.disk ?? 0, icon: HardDrive },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}%</span>
                  </div>
                  <Progress value={item.value} className="h-1.5" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: Vulnerability['severity'] }) {
  const config = {
    Critical: { bg: 'bg-status-server-error/10', text: 'text-status-server-error', border: 'border-status-server-error/20' },
    High: { bg: 'bg-status-server-error/10', text: 'text-status-server-error', border: 'border-status-server-error/20' },
    Medium: { bg: 'bg-status-client-error/10', text: 'text-status-client-error', border: 'border-status-client-error/20' },
    Low: { bg: 'bg-status-redirect/10', text: 'text-status-redirect', border: 'border-status-redirect/20' },
    Info: { bg: 'bg-muted/40', text: 'text-muted-foreground', border: 'border-border' },
  } as const
  const c =
    config[(severity as keyof typeof config) ?? 'Info'] ??
    { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
  return (
    <Badge variant="outline" className={cn('text-[10px] font-semibold px-1.5 py-0', c.bg, c.text, c.border)}>
      {severity}
    </Badge>
  )
}

export function TargetView() {
  const [nodes, setNodes] = useState<SitemapNode[]>([])
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState('all')
  const [scopeRegex, setScopeRegex] = useState<string>('^$')
  const [textFilter, setTextFilter] = useState('')
  const textFilterRef = useRef<HTMLInputElement | null>(null)
  const [lastCapture, setLastCapture] = useState<HttpRequest | null>(null)
  const [visualClearAfterMs, setVisualClearAfterMs] = useState<number | null>(null)
  const reloadTimerRef = useRef<number | null>(null)
  const reloadInFlightRef = useRef(false)

  const reload = async () => {
    if (reloadInFlightRef.current) return
    reloadInFlightRef.current = true
    try {
      const n = await sitemapGet(2000)
      setNodes(n)
      if (n.length > 0) {
        setExpandedNodes((prev) => {
          if (prev.size > 0) return prev
          return new Set([n[0].id])
        })
      }
    } finally {
      reloadInFlightRef.current = false
    }
  }

  const scheduleReload = () => {
    if (reloadTimerRef.current) return
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null
      reload().catch(() => {
        reloadInFlightRef.current = false
      })
    }, 1000)
  }

  useEffect(() => {
    settingsGet().then((s) => setScopeRegex(s.scopeRegex || '^$')).catch(() => {})
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    const onCleared = () => {
      setNodes([])
      setExpandedNodes(new Set())
      setSelectedNode(null)
      setLastCapture(null)
      reload().catch(() => {})
    }
    const onVisualClear = (ev: Event) => {
      const e = ev as CustomEvent
      const ts = typeof e.detail?.tsMs === 'number' ? e.detail.tsMs : Date.now()
      setVisualClearAfterMs(ts)
      setSelectedNode(null)
      setLastCapture(null)
    }
    onBackendEvent((ev) => {
      if (ev.type === 'RequestCaptured' || ev.type === 'ResponseReceived') {
        scheduleReload()
      }
    }).then((u) => (unlisten = u))
    window.addEventListener('skuntir:traffic-cleared', onCleared)
    window.addEventListener('skuntir:visual-clear', onVisualClear)
    return () => {
      unlisten?.()
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      window.removeEventListener('skuntir:traffic-cleared', onCleared)
      window.removeEventListener('skuntir:visual-clear', onVisualClear)
    }
  }, [])

  const inScope = (host: string) => {
    const lines = (scopeRegex || '').split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return true
    for (const line of lines) {
      try {
        const re = new RegExp(line)
        if (re.test(host)) return true
      } catch {
      }
    }
    return false
  }

  const filteredNodes = useMemo(() => {
    const q = textFilter.trim().toLowerCase()
    const matches = (n: SitemapNode) => {
      if (!q) return true
      const parts = [
        n.name ?? '',
        n.method ?? '',
        n.url ?? '',
        n.type ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return parts.includes(q)
    }

    const wantScope = scopeFilter !== 'all'
    const wantIn = scopeFilter === 'in-scope'
    const cutoff = visualClearAfterMs

    const filterTree = (n: SitemapNode): SitemapNode | null => {
      if (cutoff && (n.lastStartedMs ?? 0) > 0 && (n.lastStartedMs ?? 0) < cutoff) {
        if (!n.children || n.children.length === 0) return null
      }
      if (wantScope && n.type === 'host') {
        const ok = inScope(n.name)
        if (wantIn ? !ok : ok) return null
      }

      if (!n.children || n.children.length === 0) {
        if (cutoff && (n.lastStartedMs ?? 0) > 0 && (n.lastStartedMs ?? 0) < cutoff) return null
        return matches(n) ? n : null
      }

      const children = n.children.map(filterTree).filter(Boolean) as SitemapNode[]
      if (children.length > 0) return { ...n, children }
      if (cutoff && (n.lastStartedMs ?? 0) > 0 && (n.lastStartedMs ?? 0) < cutoff) return null
      return matches(n) ? { ...n, children: [] } : null
    }

    return nodes.map(filterTree).filter(Boolean) as SitemapNode[]
  }, [nodes, scopeFilter, scopeRegex, textFilter, visualClearAfterMs])

  const selected = useMemo(() => {
    if (!selectedNode) return null
    const walk = (list: SitemapNode[]): SitemapNode | null => {
      for (const n of list) {
        if (n.id === selectedNode) return n
        if (n.children) {
          const hit = walk(n.children)
          if (hit) return hit
        }
      }
      return null
    }
    return walk(nodes)
  }, [nodes, selectedNode])

  const selectedUrl = useMemo(() => {
    const raw = selected?.url
    if (!raw) return null
    try {
      return new URL(raw)
    } catch {
      return null
    }
  }, [selected?.url])

  useEffect(() => {
    const id = selected?.lastId
    if (!id) {
      setLastCapture(null)
      return
    }
    uiHistoryGet(id)
      .then((r) => setLastCapture(r))
      .catch(() => setLastCapture(null))
  }, [selected?.lastId])

  const navigate = (nav: string, payload?: any) => {
    window.dispatchEvent(new CustomEvent('skuntir:navigate', { detail: { nav, payload } }))
  }

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const toggleNode = (id: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedNodes(newExpanded)
  }

  const renderNode = (node: SitemapNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedNodes.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = selectedNode === node.id

    return (
      <div key={node.id}>
        <button
          onClick={() => {
            if (hasChildren) toggleNode(node.id)
            setSelectedNode(node.id)
          }}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded-md transition-colors',
            'text-left',
            isSelected && 'bg-primary/10 text-primary'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <span className="w-4" />
          )}
          {node.type === 'host' && <Globe className="w-4 h-4 text-primary shrink-0" />}
          {node.type === 'folder' && <Folder className="w-4 h-4 text-yellow-500 shrink-0" />}
          {node.type === 'endpoint' && <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className={cn('flex-1 truncate', node.type === 'host' ? 'font-medium' : 'text-foreground/80')}>
            {node.name}
          </span>
          {node.method && (
            <Badge variant="outline" className={cn('text-[10px] font-mono shrink-0', getMethodColor(node.method))}>
              {node.method}
            </Badge>
          )}
          {node.type === 'endpoint' && typeof node.lastStatus === 'number' && node.lastStatus > 0 && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] font-mono shrink-0',
                node.lastStatus >= 200 && node.lastStatus < 300
                  ? 'bg-status-success/10 text-status-success border-status-success/20'
                  : node.lastStatus >= 400 && node.lastStatus < 500
                    ? 'bg-status-client-error/10 text-status-client-error border-status-client-error/20'
                    : node.lastStatus >= 500
                      ? 'bg-status-server-error/10 text-status-server-error border-status-server-error/20'
                      : 'bg-muted text-muted-foreground'
              )}
            >
              {node.lastStatus}
            </Badge>
          )}
          {node.requestCount && (
            <span className="text-xs text-muted-foreground">{node.requestCount}</span>
          )}
        </button>
        {hasChildren && isExpanded && node.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  const counts = useMemo(() => {
    let hosts = 0
    let endpoints = 0
    const walk = (n: SitemapNode) => {
      if (n.type === 'host') hosts++
      if (n.type === 'endpoint') endpoints++
      n.children?.forEach(walk)
    }
    filteredNodes.forEach(walk)
    return { hosts, endpoints }
  }, [filteredNodes])

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full bg-background min-h-0 min-w-0">
      <ResizablePanel defaultSize={28} minSize={18}>
      <div className="h-full border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Site Map</h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => {
                const host =
                  selected?.type === 'host'
                    ? selected.name
                    : selectedUrl?.host || null
                if (!host) {
                  uiPrompt({
                    title: 'Add scope regex line',
                    description: 'Add one regex per line.',
                    placeholder: '^example\\.com$',
                  })
                    .then((next) => {
                      if (!next) return
                      return settingsSet({ scopeRegex: `${scopeRegex}\n${next}`.trim() }).then((s) =>
                        setScopeRegex(s.scopeRegex || '^$')
                      )
                    })
                    .catch(() => {})
                  return
                }
                settingsGet()
                  .then((s) => {
                    const current = (s.scopeRegex || '').trim()
                    const line = `^${escapeRegex(host)}$`
                    const lines = current.split('\n').map((l) => l.trim()).filter(Boolean)
                    if (lines.includes(line)) return s
                    return settingsSet({ scopeRegex: [...lines, line].join('\n') })
                  })
                  .then((s) => setScopeRegex(s.scopeRegex || '^$'))
                  .catch(() => {})
              }}
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => reload().catch(() => {})}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => textFilterRef.current?.focus()}
            >
              <Filter className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="p-2 border-b border-border space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={textFilterRef}
              placeholder="Filter sitemap..."
              className="h-8 pl-8 text-sm"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
            />
          </div>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="in-scope">In Scope</SelectItem>
              <SelectItem value="out-scope">Out of Scope</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2">
            {filteredNodes.map((node) => renderNode(node))}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border text-[10px] text-muted-foreground">
          {counts.hosts} hosts, {counts.endpoints} endpoints discovered
        </div>
      </div>
      </ResizablePanel>
      <ResizableHandle withHandle className="bg-border hover:bg-primary/20 transition-colors" />
      <ResizablePanel defaultSize={72} minSize={30}>
      <div className="h-full flex flex-col min-h-0 min-w-0">
        {selected ? (
          <div className="p-4 flex-1 min-h-0">
            <Card className="p-4 flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Endpoint Details</h3>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selected?.lastId}
                    onClick={() => {
                      if (!selected?.lastId) return
                      navigate('history', { selectHistoryId: selected.lastId })
                    }}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Open in History
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedUrl || !selected?.method}
                    onClick={() => {
                      if (!selectedUrl || !selected?.method) return
                      const raw = [
                        `${selected.method} ${selectedUrl.toString()} HTTP/1.1`,
                        `Host: ${selectedUrl.host}`,
                        'User-Agent: Proxer/1.0',
                        'Accept: */*',
                        '',
                        '',
                      ].join('\r\n')
                      navigate('repeater', { rawRequest: raw })
                    }}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send to Repeater
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedUrl || !selected?.method}
                    onClick={() => {
                      if (!selectedUrl || !selected?.method) return
                      const raw = [
                        `${selected.method} ${selectedUrl.toString()} HTTP/1.1`,
                        `Host: ${selectedUrl.host}`,
                        'User-Agent: Proxer/1.0',
                        'Accept: */*',
                        '',
                        '',
                      ].join('\r\n')
                      navigate('intruder', { templateRaw: raw })
                    }}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Send to Intruder
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Host:</span>
                  <span className="ml-2 font-mono">{selectedUrl?.host || (selected.type === 'host' ? selected.name : '-')}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Port:</span>
                  <span className="ml-2 font-mono">{selectedUrl?.port || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Protocol:</span>
                  <span className="ml-2">{selectedUrl?.protocol ? selectedUrl.protocol.replace(':', '').toUpperCase() : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Requests:</span>
                  <span className="ml-2">{selected.requestCount ?? '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">URL:</span>
                  <span className="ml-2 font-mono break-all">{selectedUrl?.toString() || selected.url || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Status:</span>
                  <span className="ml-2 font-mono">{selected.lastStatus ?? '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Seen:</span>
                  <span className="ml-2 font-mono">
                    {typeof selected.lastStartedMs === 'number' ? new Date(selected.lastStartedMs).toISOString() : '-'}
                  </span>
                </div>
              </div>
              {lastCapture && (
                <div className="mt-4 flex flex-col min-h-0 flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-muted-foreground">Latest Capture</div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] font-mono',
                        lastCapture.statusCode >= 200 && lastCapture.statusCode < 300
                          ? 'bg-status-success/10 text-status-success border-status-success/20'
                          : lastCapture.statusCode >= 400 && lastCapture.statusCode < 500
                            ? 'bg-status-client-error/10 text-status-client-error border-status-client-error/20'
                            : lastCapture.statusCode >= 500
                              ? 'bg-status-server-error/10 text-status-server-error border-status-server-error/20'
                              : ''
                      )}
                    >
                      {lastCapture.statusCode}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="bg-muted/30 rounded-md p-2">
                      <div className="text-[10px] text-muted-foreground">Time</div>
                      <div className="font-mono">{lastCapture.time}</div>
                    </div>
                    <div className="bg-muted/30 rounded-md p-2">
                      <div className="text-[10px] text-muted-foreground">Size</div>
                      <div className="font-mono">{lastCapture.size}</div>
                    </div>
                    <div className="bg-muted/30 rounded-md p-2">
                      <div className="text-[10px] text-muted-foreground">Content-Type</div>
                      <div className="font-mono truncate">{lastCapture.contentType || '-'}</div>
                    </div>
                  </div>
                  {lastCapture.responseBody && (
                    <Textarea
                      className="mt-3 font-mono text-xs flex-1 min-h-0 resize-none"
                      value={lastCapture.responseBody.slice(0, 20000)}
                      readOnly
                    />
                  )}
                </div>
              )}
            </Card>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Crosshair className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium">Select an endpoint to view details</p>
              <p className="text-xs text-muted-foreground mt-1">Or right-click to send to tools</p>
            </div>
          </div>
        )}
      </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export function ApiLeaksView() {
  const [summary, setSummary] = useState<ApiLeakSummary | null>(null)
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('all')
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      setSummary(await apiLeaksScan(5000))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload().catch(() => {})
  }, [])

  const findings = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (summary?.findings ?? []).filter((f) => {
      if (severity !== 'all' && f.severity !== severity) return false
      if (!q) return true
      return [f.host, f.url, f.name, f.category, f.location, f.evidence].some((v) => v.toLowerCase().includes(q))
    })
  }, [query, severity, summary])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of summary?.findings ?? []) map.set(f.severity, (map.get(f.severity) ?? 0) + 1)
    return map
  }, [summary])

  const severityClass = (s: string) =>
    s === 'Critical'
      ? 'bg-destructive/10 text-destructive border-destructive/20'
      : s === 'High'
        ? 'bg-status-server-error/10 text-status-server-error border-status-server-error/20'
        : s === 'Medium'
          ? 'bg-status-client-error/10 text-status-client-error border-status-client-error/20'
          : 'bg-muted text-muted-foreground'

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-5 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">API Leaks</h1>
          <p className="text-sm text-muted-foreground mt-1">Secrets, tokens, keys, PGP blocks, credentials, and high-entropy values found in captured traffic</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => reload().catch(() => {})} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          Rescan
        </Button>
      </div>

      <div className="p-5 grid grid-cols-5 gap-3">
        {['Critical', 'High', 'Medium', 'Low', 'Info'].map((s) => (
          <Card key={s} className="p-3 bg-card border-border">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">{s}</div>
            <div className="mt-1 text-2xl font-bold">{counts.get(s) ?? 0}</div>
          </Card>
        ))}
      </div>

      <div className="px-5 pb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Filter findings" />
        </div>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {['Critical', 'High', 'Medium', 'Low', 'Info'].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline">{summary?.scannedRequests ?? 0} scanned</Badge>
      </div>

      <div className="flex-1 min-h-0 px-5 pb-5">
        <div className="h-full overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Host</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Evidence</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-2"><Badge variant="outline" className={severityClass(f.severity)}>{f.severity}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{f.name}</div>
                    <div className="text-muted-foreground">{f.category}</div>
                  </td>
                  <td className="px-3 py-2 max-w-64">
                    <button className="font-mono text-left truncate max-w-full text-primary" onClick={() => appNavigate('history', { selectHistoryId: f.requestId })}>
                      {f.host}
                    </button>
                    <div className="font-mono text-[10px] text-muted-foreground truncate">{f.method} {f.url}</div>
                  </td>
                  <td className="px-3 py-2">{f.location}</td>
                  <td className="px-3 py-2 font-mono max-w-80 truncate">{f.evidence}</td>
                  <td className="px-3 py-2 font-mono">{f.status ?? '-'}</td>
                </tr>
              ))}
              {findings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                    <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    No leaks matched the current filter
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

type AttackFlowNodeData = {
  id: string
  label: string
  kind: string
  icon: string
  subtitle?: string
  facts?: string[]
  hasChildren?: boolean
  isCollapsed?: boolean
  meta?: { title: string; items: string[]; total: number }
  stats?: {
    requests?: number
    endpoints?: number
    success?: number
    redirects?: number
    clientErrors?: number
    serverErrors?: number
    schemes?: string[]
    methods?: string[]
  }
}

const compactCount = (value: number | undefined) => {
  const safe = value ?? 0
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}m`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`
  return String(safe)
}

const attackSurfaceNodeIcon = (kind: string) => {
  if (kind === 'domain') return '🌐'
  if (kind === 'host') return '⬡'
  if (kind === 'category') return '▤'
  if (kind === 'summary') return '⋯'
  if (kind === 'port') return '◈'
  if (kind === 'leak') return '⚠'
  if (kind === 'tech') return '◆'
  if (kind === 'api') return '⌁'
  if (kind === 'auth') return '⚷'
  if (kind === 'interesting') return '◉'
  return '◧'
}

const nodeAccent: Record<string, string> = {
  domain:      'from-slate-700/60 to-slate-800/80 border-slate-500/60',
  host:        'bg-card border-cyan-500/40',
  category:    'bg-muted/50 border-border/70',
  summary:     'bg-transparent border-dashed border-muted-foreground/30',
  port:        'bg-muted/30 border-border/50',
  tech:        'bg-teal-500/8 border-teal-500/30',
  api:         'bg-blue-500/8 border-blue-500/35',
  auth:        'bg-amber-500/8 border-amber-500/35',
  interesting: 'bg-violet-500/8 border-violet-500/35',
  endpoint:    'bg-card border-border/60',
  leak:        'bg-red-500/10 border-red-500/50',
}

const nodeAccentBar: Record<string, string> = {
  domain:      '',
  host:        'bg-cyan-500',
  api:         'bg-blue-500',
  auth:        'bg-amber-500',
  interesting: 'bg-violet-500',
  tech:        'bg-teal-500',
  leak:        'bg-red-500',
  endpoint:    'bg-muted-foreground/40',
}

const nodeLabelColor: Record<string, string> = {
  domain: 'text-slate-100',
  leak:   'text-red-300',
  api:    'text-blue-300',
  auth:   'text-amber-300',
  interesting: 'text-violet-300',
  tech:   'text-teal-300',
}

function AttackSurfaceFlowNode({ data, selected }: NodeProps<FlowNode<AttackFlowNodeData>>) {
  const kind = data.kind
  const meta = data.meta
  const stats = data.stats
  const isDomain = kind === 'domain'
  const isHost = kind === 'host'
  const isSummary = kind === 'summary'
  const isLeak = kind === 'leak'
  const hasBar = Boolean(nodeAccentBar[kind])

  const statusBits = stats
    ? ([
        ['2xx', stats.success ?? 0, 'text-emerald-400'],
        ['3xx', stats.redirects ?? 0, 'text-sky-400'],
        ['4xx', stats.clientErrors ?? 0, 'text-amber-400'],
        ['5xx', stats.serverErrors ?? 0, 'text-red-400'],
      ] as const).filter(([, c]) => Number(c) > 0)
    : []

  const baseClass = selected
    ? 'border-primary bg-primary/20 ring-1 ring-primary/60'
    : isDomain
      ? 'bg-gradient-to-br ' + (nodeAccent[kind] ?? '')
      : (nodeAccent[kind] ?? 'bg-card border-border')

  return (
    <div
      title={data.label}
      className={cn(
        'relative min-w-0 overflow-hidden rounded-lg border text-xs shadow-lg transition-shadow hover:shadow-xl',
        baseClass
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-foreground/30" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-foreground/30" isConnectable={false} />

      {/* Accent bar for non-domain nodes */}
      {hasBar && !isDomain && (
        <div className={cn('absolute left-0 top-0 h-full w-[3px]', nodeAccentBar[kind])} />
      )}

      <div className={cn('px-3 py-2', hasBar && !isDomain && 'pl-4')}>
        {/* Header row */}
        <div className="flex items-start gap-1.5">
          <span className={cn(
            'mt-px shrink-0 text-[11px] leading-none',
            isDomain ? 'text-slate-300' : 'text-muted-foreground'
          )}>
            {data.icon ?? attackSurfaceNodeIcon(kind)}
          </span>
          <div className="min-w-0 flex-1">
            {meta ? (
              <>
                <div className={cn('text-[11px] font-semibold leading-tight', selected ? 'text-primary-foreground' : 'text-foreground')}>
                  {meta.title}
                </div>
                <div className="mt-1 space-y-0.5">
                  {meta.items.map((item) => (
                    <div key={item} className="text-[10px] leading-[1.3] text-muted-foreground break-words">{item}</div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className={cn(
                  'font-semibold leading-tight',
                  isDomain ? 'text-[13px] text-slate-100' : isHost ? 'text-[12px] text-foreground' : 'text-[11px]',
                  isDomain || isHost ? 'truncate' : 'break-words',
                  !isDomain && !isHost && (nodeLabelColor[kind] ?? 'text-foreground')
                )}>
                  {data.label}
                </div>
                {data.subtitle && (
                  <div className={cn('mt-0.5 break-words text-[10px] leading-[1.3]', isDomain ? 'text-slate-400' : 'text-muted-foreground')}>
                    {data.subtitle}
                  </div>
                )}
              </>
            )}

            {/* Facts row */}
            {!!data.facts?.length && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {data.facts.slice(0, 4).map((fact) => (
                  <span key={fact} className="rounded bg-foreground/8 px-1 py-px text-[9px] text-muted-foreground">{fact}</span>
                ))}
              </div>
            )}

            {/* Stats row (host/domain) */}
            {stats && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[9px] font-mono text-muted-foreground">{compactCount(stats.requests)}r</span>
                <span className="text-[9px] font-mono text-muted-foreground">{compactCount(stats.endpoints)}p</span>
                {statusBits.map(([label, count, cls]) => (
                  <span key={label} className={cn('text-[9px] font-mono font-semibold', cls)}>{label}:{count}</span>
                ))}
                {isHost && (stats.schemes ?? []).slice(0, 2).map((s) => (
                  <span key={s} className="rounded border border-border/50 px-1 py-px text-[8px] text-muted-foreground">{s.toUpperCase()}</span>
                ))}
              </div>
            )}

            {/* Leak severity */}
            {isLeak && meta && (
              <span className="mt-1 inline-block rounded border border-red-500/40 bg-red-500/15 px-1 py-px text-[9px] font-semibold text-red-400">
                {meta.title}
              </span>
            )}

            {/* Summary indicator */}
            {isSummary && (
              <div className="text-[10px] text-muted-foreground/70 italic">{data.label}</div>
            )}
          </div>

          {/* Collapse toggle */}
          {data.hasChildren && (
            <span className={cn(
              'ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold',
              selected ? 'border-primary-foreground/40 text-primary-foreground' : 'border-border/70 text-muted-foreground'
            )}>
              {data.isCollapsed ? '+' : '−'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const attackSurfaceNodeTypes = { attackSurface: AttackSurfaceFlowNode }

function AttackSurfaceConnectorEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<FlowEdge<{ relation?: string; weight?: number }>>) {
  const midX = sourceX + Math.max(48, (targetX - sourceX) / 2)
  const edgePath = `M ${sourceX} ${sourceY} H ${midX} V ${targetY} H ${targetX}`
  const relation = data?.relation
  const edgeOpacity = relation === 'leaks' ? 0.78 : relation === 'inventory' || relation === 'serves' ? 0.68 : 0.58
  const edgeWidth = relation === 'leaks' ? 1.8 : relation === 'inventory' || relation === 'serves' ? 1.5 : 1.25

  return (
    <>
      <BaseEdge
        id={`${id}-halo`}
        path={edgePath}
        interactionWidth={22}
        style={{
          stroke: 'hsl(var(--background))',
          strokeOpacity: 0.72,
          strokeWidth: edgeWidth + 3,
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={22}
        style={{
          stroke: 'hsl(var(--foreground))',
          strokeOpacity: edgeOpacity,
          strokeWidth: edgeWidth,
        }}
      />
    </>
  )
}

const attackSurfaceEdgeTypes = { connector: AttackSurfaceConnectorEdge }

export function AttackSurfaceView() {
  const [surface, setSurface] = useState<AttackSurface | null>(null)
  const [leaks, setLeaks] = useState<ApiLeakFinding[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [domain, setDomain] = useState('all')
  const [query, setQuery] = useState('')
  const [nodeFilter, setNodeFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const [surfaceSidebarCollapsed, setSurfaceSidebarCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const reloadTimerRef = useRef<number | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const next = await attackSurfaceGet(2500)
      setSurface(next)
      setLoading(false)
      apiLeaksScan(1500)
        .then((leakSummary) => setLeaks(leakSummary.findings))
        .catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type !== 'RequestCaptured' && ev.type !== 'ResponseReceived') return
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null
        reload().catch(() => {})
      }, 900)
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
    }
  }, [])

  const canvas = useMemo(() => {
    const hosts = surface?.hosts ?? []
    const originalNodes = surface?.nodes ?? []
    const originalEdges = surface?.edges ?? []
    const sourceNodes = originalNodes.filter((node) => node.kind === 'domain' || node.kind === 'host')
    const sourceNodeIds = new Set(sourceNodes.map((node) => node.id))
    const sourceEdges = originalEdges.filter((edge) => sourceNodeIds.has(edge.from) && sourceNodeIds.has(edge.to))
    const hostByName = new Map(hosts.map((h) => [h.host, h]))
    const domainByName = new Map((surface?.domains ?? []).map((d) => [d.name, d]))
    const groupedNodeMeta = new Map<string, { title: string; items: string[]; total: number }>()
    const endpointLeakTotals = new Map<string, number>()
    const endpointId = (host: string, path: string) => `endpoint:${host}:${path}`
    const leakGroupId = (host: string, path: string, severity: string, name: string) => `leak:${host}:${path}:${severity}:${name}`
    const categoryId = (host: string, category: string) => `category:${category}:${host}`
    const leakPath = (leak: ApiLeakFinding) => {
      try {
        const parsed = new URL(leak.url)
        return parsed.pathname || '/'
      } catch {
        return leak.url.startsWith('/') ? leak.url : '/'
      }
    }
    const visualLimit = {
      ports: 32,
      tech: 32,
      endpoints: 48,
      leaksPerEndpoint: 10,
    }
    const splitVisible = <T,>(items: T[], limit: number) => ({
      shown: items.slice(0, limit),
      hidden: Math.max(0, items.length - limit),
    })
    const addNode = (id: string, label: string, kind: string, lane: number, weight = 1) => {
      sourceNodes.push({
        id,
        label,
        kind,
        weight,
        lane,
      })
    }
    const addEdge = (from: string, to: string, weight = 1) => {
      sourceEdges.push({
        from,
        to,
        weight,
      })
    }
    const addCategory = (host: AttackSurface['hosts'][number], category: string, label: string, lane: number, total: number) => {
      if (!total) return null
      const id = categoryId(host.host, category)
      addNode(id, `${label} (${total})`, 'category', lane, total)
      groupedNodeMeta.set(id, {
        title: label,
        items: [
          `${total} ${total === 1 ? 'item' : 'items'}`,
          `${compactCount(host.requests)} captured requests`,
          host.methods.length ? `Methods: ${host.methods.slice(0, 4).join(', ')}` : '',
        ].filter(Boolean),
        total,
      })
      addEdge(`host:${host.host}`, id, total)
      return id
    }
    const addSummary = (parentId: string | null, id: string, label: string, lane: number, count: number) => {
      addNode(id, label, 'summary', lane, count)
      groupedNodeMeta.set(id, { title: 'More', items: [label], total: count })
      if (parentId) addEdge(parentId, id, count)
    }
    for (const host of hosts) {
      const ports = host.ports.map((item) => item.trim()).filter(Boolean)
      const portsCategoryId = addCategory(host, 'ports', 'Ports', 3, ports.length)
      const visiblePorts = splitVisible(ports, visualLimit.ports)
      for (const port of visiblePorts.shown) {
        const id = `port:${host.host}:${port}`
        addNode(id, port, 'port', 4)
        if (portsCategoryId) addEdge(portsCategoryId, id)
      }
      if (portsCategoryId && visiblePorts.hidden) {
        addSummary(portsCategoryId, `summary:ports:${host.host}`, `+${visiblePorts.hidden} more ports`, 4, visiblePorts.hidden)
      }

      const technologies = host.technologies.map((item) => item.trim()).filter(Boolean)
      const techCategoryId = addCategory(host, 'tech', 'Technologies', 3, technologies.length)
      const visibleTech = splitVisible(technologies, visualLimit.tech)
      for (const tech of visibleTech.shown) {
        const id = `tech:${host.host}:${tech}`
        addNode(id, tech, 'tech', 4)
        if (techCategoryId) addEdge(techCategoryId, id)
      }
      if (techCategoryId && visibleTech.hidden) {
        addSummary(techCategoryId, `summary:tech:${host.host}`, `+${visibleTech.hidden} more technologies`, 4, visibleTech.hidden)
      }

      const leakCounts = new Map<string, { path: string; severity: string; name: string; count: number }>()
      for (const leak of leaks.filter((item) => item.host === host.host)) {
        const path = leakPath(leak)
        const key = `${path}\u0000${leak.severity}\u0000${leak.name}`
        const current = leakCounts.get(key) ?? { path, severity: leak.severity, name: leak.name, count: 0 }
        current.count += 1
        leakCounts.set(key, current)
      }
      const allEndpointPaths = new Set([
        ...host.apiPaths,
        ...host.authPaths,
        ...host.interestingPaths,
        ...host.endpointPaths,
        ...[...leakCounts.values()].map((leak) => leak.path),
      ].filter(Boolean))
      const endpointsCategoryId = addCategory(host, 'endpoints', 'Endpoints', 3, allEndpointPaths.size)
      const orderedEndpointPaths = [...allEndpointPaths].sort((a, b) => {
        const score = (path: string) =>
          (host.apiPaths.includes(path) ? 0 : 10)
          + (host.authPaths.includes(path) ? 0 : 10)
          + (host.interestingPaths.includes(path) ? 0 : 10)
          - [...leakCounts.values()].filter((leak) => leak.path === path).reduce((sum, leak) => sum + leak.count, 0)
        return score(a) - score(b) || a.localeCompare(b)
      })
      const visibleEndpoints = splitVisible(orderedEndpointPaths, visualLimit.endpoints)
      for (const path of visibleEndpoints.shown) {
        const kind = host.apiPaths.includes(path)
          ? 'api'
          : host.authPaths.includes(path)
            ? 'auth'
            : host.interestingPaths.includes(path)
              ? 'interesting'
              : 'endpoint'
        const id = endpointId(host.host, path)
        addNode(id, path, kind, 4)
        if (endpointsCategoryId) addEdge(endpointsCategoryId, id)
      }
      if (endpointsCategoryId && visibleEndpoints.hidden) {
        addSummary(endpointsCategoryId, `summary:endpoints:${host.host}`, `+${visibleEndpoints.hidden} more endpoints`, 4, visibleEndpoints.hidden)
      }
      const visibleEndpointSet = new Set(visibleEndpoints.shown)
      const leaksByEndpoint = new Map<string, { path: string; severity: string; name: string; count: number }[]>()
      for (const leak of [...leakCounts.values()].filter((item) => visibleEndpointSet.has(item.path))) {
        const next = leaksByEndpoint.get(leak.path) ?? []
        next.push(leak)
        leaksByEndpoint.set(leak.path, next)
      }
      for (const [path, endpointLeaks] of leaksByEndpoint.entries()) {
        const orderedLeaks = endpointLeaks.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        const visibleLeaks = splitVisible(orderedLeaks, visualLimit.leaksPerEndpoint)
        for (const leak of visibleLeaks.shown) {
          const id = leakGroupId(host.host, leak.path, leak.severity, leak.name)
          addNode(id, `${leak.name} (${leak.count}x)`, 'leak', 5, leak.count)
          groupedNodeMeta.set(id, { title: leak.severity, items: [leak.name, `${leak.count} occurrences`], total: leak.count })
          const parentEndpointId = endpointId(host.host, leak.path)
          endpointLeakTotals.set(parentEndpointId, (endpointLeakTotals.get(parentEndpointId) ?? 0) + leak.count)
          addEdge(parentEndpointId, id, leak.count)
        }
        if (visibleLeaks.hidden) {
          const parentEndpointId = endpointId(host.host, path)
          endpointLeakTotals.set(parentEndpointId, (endpointLeakTotals.get(parentEndpointId) ?? 0) + visibleLeaks.hidden)
          addSummary(parentEndpointId, `summary:leaks:${host.host}:${path}`, `+${visibleLeaks.hidden} more leak types`, 5, visibleLeaks.hidden)
        }
      }
    }
    const selectedDomainHostNames = new Set(hosts.filter((h) => domain === 'all' || h.domain === domain).map((h) => h.host))
    const hostIds = new Set([...selectedDomainHostNames].map((h) => `host:${h}`))
    const adjacency = new Map<string, string[]>()
    const parentByChild = new Map<string, string[]>()
    for (const edge of sourceEdges) {
      const next = adjacency.get(edge.from) ?? []
      next.push(edge.to)
      adjacency.set(edge.from, next)
      const parents = parentByChild.get(edge.to) ?? []
      parents.push(edge.from)
      parentByChild.set(edge.to, parents)
    }
    const collapsibleIds = new Set([...adjacency.keys()])

    const descendantIds = (roots: Set<string>) => {
      const out = new Set<string>()
      const stack = [...roots]
      while (stack.length) {
        const id = stack.pop()
        if (!id) continue
        for (const child of adjacency.get(id) ?? []) {
          if (out.has(child)) continue
          out.add(child)
          stack.push(child)
        }
      }
      return out
    }
    const domainIds = new Set(
      sourceNodes
        .filter((node) => node.kind === 'domain' && (domain === 'all' || node.label === domain))
        .map((node) => node.id)
    )
    const allowedDescendants = descendantIds(new Set([...domainIds, ...hostIds]))
    const allowedIds = new Set<string>()
    for (const node of sourceNodes) {
      if (node.kind === 'domain' && (domain === 'all' || node.label === domain)) allowedIds.add(node.id)
      if (node.kind === 'host' && selectedDomainHostNames.has(node.label)) allowedIds.add(node.id)
      if (allowedDescendants.has(node.id)) {
        allowedIds.add(node.id)
      }
    }
    const hiddenByCollapse = descendantIds(collapsed)

    const q = query.trim().toLowerCase()
    const baseNodes = sourceNodes
      .filter((node) => allowedIds.has(node.id))
      .filter((node) => !hiddenByCollapse.has(node.id))
      .filter((node) => {
        if (!q) return true
        const host = node.kind === 'host' ? hostByName.get(node.label) : null
        return node.label.toLowerCase().includes(q)
          || node.kind.toLowerCase().includes(q)
          || host?.technologies.join(' ').toLowerCase().includes(q)
          || host?.ports.join(' ').toLowerCase().includes(q)
          || host?.endpointPaths.join(' ').toLowerCase().includes(q)
          || host?.apiPaths.join(' ').toLowerCase().includes(q)
          || host?.interestingPaths.join(' ').toLowerCase().includes(q)
          || host?.authPaths.join(' ').toLowerCase().includes(q)
      })

    const contextIds = new Set<string>()
    const addAncestors = (id: string) => {
      contextIds.add(id)
      for (const parent of parentByChild.get(id) ?? []) {
        if (contextIds.has(parent)) continue
        addAncestors(parent)
      }
    }
    if (nodeFilter !== 'all') {
      for (const node of baseNodes) {
        if (node.kind === nodeFilter) addAncestors(node.id)
      }
    }

    const visibleNodes = baseNodes
      .filter((node) => nodeFilter === 'all' || contextIds.has(node.id))
      .sort((a, b) => a.lane - b.lane || b.weight - a.weight)

    const visibleIds = new Set(visibleNodes.map((node) => node.id))
    const nodeWidthFor = (node: AttackSurface['nodes'][number]) => {
      if (node.kind === 'domain') return 320
      if (node.kind === 'host') return 340
      if (node.kind === 'category') return 260
      if (node.kind === 'port' || node.kind === 'tech') return 250
      if (node.kind === 'summary') return 260
      if (node.kind === 'leak') return 300
      return 380
    }
    const estimatedWrappedLines = (text: string, width: number) => Math.max(1, Math.ceil(text.length / Math.max(18, Math.floor(width / 7))))
    const nodeHeightFor = (node: AttackSurface['nodes'][number]) => {
      const meta = groupedNodeMeta.get(node.id)
      const width = nodeWidthFor(node)
      if (meta) return 50 + meta.items.reduce((sum, item) => sum + estimatedWrappedLines(item, width - 46) * 14, 0)
      if (node.kind === 'domain') return 70
      if (node.kind === 'host') return 88
      if (node.kind === 'category') return 64
      if (node.kind === 'port' || node.kind === 'tech') return 42
      if (node.kind === 'leak') return 76
      return Math.max(54, 34 + estimatedWrappedLines(node.label, width - 40) * 15)
    }
    const leftX = 120
    const topY = 110
    const siblingGap = 64
    const domainGap = 180
    const levelGap = 170
    const kindRank: Record<string, number> = {
      root: 0,
      domain: 1,
      host: 2,
      category: 3,
      port: 4,
      tech: 5,
      api: 6,
      endpoint: 7,
      auth: 8,
      interesting: 9,
      leak: 10,
    }
    const nodeById = new Map(visibleNodes.map((node) => [node.id, node]))
    const visibleChildren = new Map<string, AttackSurface['nodes']>()
    for (const edge of sourceEdges) {
      if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue
      const child = nodeById.get(edge.to)
      if (!child) continue
      const children = visibleChildren.get(edge.from) ?? []
      if (!children.some((existing) => existing.id === child.id)) {
        children.push(child)
      }
      visibleChildren.set(edge.from, children)
    }
    for (const children of visibleChildren.values()) {
      children.sort((a, b) => {
        const rank = (kindRank[a.kind] ?? 99) - (kindRank[b.kind] ?? 99)
        if (rank !== 0) return rank
        return b.weight - a.weight || a.label.localeCompare(b.label)
      })
    }

    const positionById = new Map<string, { x: number; y: number }>()
    const domainNodes = visibleNodes.filter((node) => node.kind === 'domain')
    let cursorY = topY
    const measureCache = new Map<string, number>()
    const measureSubtree = (node: AttackSurface['nodes'][number], stack = new Set<string>()): number => {
      if (measureCache.has(node.id)) return measureCache.get(node.id) ?? nodeWidthFor(node)
      if (stack.has(node.id)) return nodeHeightFor(node)
      stack.add(node.id)
      const children = visibleChildren.get(node.id) ?? []
      const childHeight = children.reduce((sum, child, index) => sum + measureSubtree(child, new Set(stack)) + (index ? siblingGap : 0), 0)
      const height = Math.max(nodeHeightFor(node), childHeight)
      measureCache.set(node.id, height)
      return height
    }
    const placeSubtree = (node: AttackSurface['nodes'][number], x: number, top: number, stack = new Set<string>()) => {
      if (stack.has(node.id)) return
      stack.add(node.id)
      const subtreeHeight = measureSubtree(node)
      const nodeHeight = nodeHeightFor(node)
      positionById.set(node.id, {
        x,
        y: top + subtreeHeight / 2 - nodeHeight / 2,
      })
      const children = visibleChildren.get(node.id) ?? []
      const childrenHeight = children.reduce((sum, child, index) => sum + measureSubtree(child) + (index ? siblingGap : 0), 0)
      let childTop = top + Math.max(0, (subtreeHeight - childrenHeight) / 2)
      for (const child of children) {
        const childHeight = measureSubtree(child)
        placeSubtree(child, x + nodeWidthFor(node) + levelGap, childTop, new Set(stack))
        childTop += childHeight + siblingGap
      }
    }

    for (const domainNode of domainNodes.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))) {
      const height = measureSubtree(domainNode)
      placeSubtree(domainNode, leftX, cursorY)
      cursorY += height + domainGap
    }

    let orphanY = cursorY
    for (const node of visibleNodes) {
      if (positionById.has(node.id)) continue
      positionById.set(node.id, { x: leftX, y: orphanY })
      orphanY += nodeHeightFor(node) + levelGap
    }

    const positioned = visibleNodes.map((node) => {
      const auto = positionById.get(node.id) ?? { x: 140, y: topY }
      const manual = nodePositions[node.id]
      return {
        ...node,
        x: manual?.x ?? auto.x,
        y: manual?.y ?? auto.y,
        width: nodeWidthFor(node),
        height: nodeHeightFor(node),
      }
    })

    const byId = new Map(positioned.map((node) => [node.id, node]))
    const lines: { id: string; path: string; relation?: string }[] = []
    const relationForKind = (kind: string) => {
      if (kind === 'host') return 'host'
      if (kind === 'category') return 'inventory'
      if (kind === 'port') return 'exposes'
      if (kind === 'tech') return 'uses'
      if (['api', 'endpoint', 'auth', 'interesting'].includes(kind)) return 'serves'
      if (kind === 'leak') return 'leaks'
      return undefined
    }
    const addLine = (id: string, path: string, relation?: string) => {
      lines.push({ id, path, relation })
    }
    for (const parent of positioned) {
      const children = (visibleChildren.get(parent.id) ?? [])
        .map((child) => byId.get(child.id))
        .filter((child): child is NonNullable<typeof child> => Boolean(child))
        .sort((a, b) => a.y - b.y)
      if (!children.length) continue
      const parentRightX = parent.x + parent.width
      const parentCenterY = parent.y + parent.height / 2
      const firstCenterY = children[0].y + children[0].height / 2
      const lastCenterY = children[children.length - 1].y + children[children.length - 1].height / 2
      const childLeftX = Math.min(...children.map((child) => child.x))
      const busX = parentRightX + Math.max(36, (childLeftX - parentRightX) / 2)
      const parentRelation = relationForKind(parent.kind)
      addLine(`${parent.id}:drop`, `M ${parentRightX} ${parentCenterY} H ${busX}`, parentRelation)
      addLine(`${parent.id}:bus`, `M ${busX} ${Math.min(firstCenterY, parentCenterY)} V ${Math.max(lastCenterY, parentCenterY)}`, parentRelation)
      for (const child of children) {
        const childCenterY = child.y + child.height / 2
        addLine(`${parent.id}->${child.id}`, `M ${busX} ${childCenterY} H ${child.x}`, relationForKind(child.kind))
      }
    }

    const width = Math.max(1900, ...positioned.map((node) => node.x + node.width + 160), 1900)
    const height = Math.max(1000, ...positioned.map((node) => node.y + node.height + 120), 1000)
    const flowNodes: FlowNode<AttackFlowNodeData>[] = positioned.map((node) => {
      const host = node.kind === 'host' ? hostByName.get(node.label) : null
      const domainInfo = node.kind === 'domain' ? domainByName.get(node.label) : null
      const endpointLeakTotal = endpointLeakTotals.get(node.id) ?? 0
      const isEndpoint = ['api', 'auth', 'interesting', 'endpoint'].includes(node.kind)
      const endpointClass =
        node.kind === 'api'
          ? 'API surface'
          : node.kind === 'auth'
            ? 'Auth surface'
            : node.kind === 'interesting'
              ? 'Interesting surface'
              : isEndpoint
                ? 'Observed endpoint'
                : undefined
      return {
        id: node.id,
        type: 'attackSurface',
        position: { x: node.x, y: node.y },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: true,
        selectable: true,
        style: { width: node.width },
        data: {
          id: node.id,
          label: node.label,
          kind: node.kind,
          icon: attackSurfaceNodeIcon(node.kind),
          subtitle: domainInfo
            ? `${compactCount(domainInfo.hosts)} hosts · ${compactCount(domainInfo.requests)} requests · ${compactCount(domainInfo.endpoints)} endpoints`
            : host
              ? host.domain
              : endpointClass,
          facts: host
            ? [
                host.methods.length ? `Methods ${host.methods.slice(0, 4).join('/')}` : '',
                host.ports.length ? `${host.ports.length} ports` : '',
                host.technologies.length ? `${host.technologies.length} tech` : '',
                host.apiPaths.length ? `${host.apiPaths.length} API` : '',
              ].filter(Boolean)
            : isEndpoint
              ? [
                  endpointLeakTotal ? `${compactCount(endpointLeakTotal)} leaks` : '',
                  node.kind === 'auth' ? 'auth' : '',
                  node.kind === 'api' ? 'api' : '',
                ].filter(Boolean)
              : undefined,
          hasChildren: collapsibleIds.has(node.id),
          isCollapsed: collapsed.has(node.id),
          meta: groupedNodeMeta.get(node.id),
          stats: host
            ? {
                requests: host.requests,
                endpoints: host.endpoints,
                success: host.success,
                redirects: host.redirects,
                clientErrors: host.clientErrors,
                serverErrors: host.serverErrors,
                schemes: host.schemes,
                methods: host.methods,
              }
            : domainInfo
              ? {
                  requests: domainInfo.requests,
                  endpoints: domainInfo.endpoints,
                }
            : undefined,
        },
      }
    })
    const relationFor = (_from: string, to: string) => {
      const child = byId.get(to)
      return child ? relationForKind(child.kind) : undefined
    }
    const flowEdges: FlowEdge[] = sourceEdges
      .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      .map((edge, index) => ({
        id: `${edge.from}->${edge.to}:${index}`,
        source: edge.from,
        target: edge.to,
        type: 'connector',
        animated: false,
        data: {
          relation: relationFor(edge.from, edge.to),
          weight: edge.weight,
        },
        style: { stroke: 'hsl(var(--foreground))', strokeWidth: 1.25 },
      }))
    return { nodes: positioned, flowNodes, flowEdges, lines, width, height, collapsibleIds, groupedNodeMeta }
  }, [collapsed, domain, leaks, nodeFilter, nodePositions, query, surface])

  const selectedNode = canvas.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedHost = selectedNode?.kind === 'host' ? surface?.hosts.find((h) => h.host === selectedNode.label) : null
  const selectedLeak = selectedNode?.kind === 'leak' ? leaks.find((l) => selectedNode.id === `leak:${l.id}` || selectedNode.id.includes(l.requestId)) : null

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className="relative grid h-full select-none overflow-hidden bg-background text-foreground"
      style={{ gridTemplateColumns: surfaceSidebarCollapsed ? 'minmax(0, 1fr) 44px' : 'minmax(0, 1fr) 320px' }}
    >
      <div className="relative min-w-0 overflow-hidden">
      <div className="absolute inset-0 border-t border-border" />

      <div className="absolute left-4 top-3 z-30 flex items-center gap-3">
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="h-8 w-44 rounded-full border-border bg-card/95 text-xs text-foreground">
            <SelectValue placeholder="All domains" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All domains</SelectItem>
            {(surface?.domains ?? []).map((d) => (
              <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="absolute right-4 top-3 z-30 flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-8 w-56 rounded-full border-border bg-card/95 pl-8 text-xs text-foreground"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-full border-border bg-card/95 px-3" onClick={() => reload().catch(() => {})} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="absolute inset-0">
        <ReactFlow
          nodes={canvas.flowNodes}
          edges={[]}
          nodeTypes={attackSurfaceNodeTypes}
          edgeTypes={attackSurfaceEdgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.08}
          maxZoom={1.8}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'connector', style: { stroke: 'hsl(var(--foreground))', strokeWidth: 1.25 } }}
          onNodesChange={(changes) => {
            const positions: Record<string, { x: number; y: number }> = {}
            for (const change of changes) {
              if (change.type === 'position' && change.position) {
                positions[change.id] = { x: change.position.x, y: change.position.y }
              }
            }
            if (Object.keys(positions).length) {
              setNodePositions((prev) => ({ ...prev, ...positions }))
            }
          }}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onNodeDoubleClick={(_, node) => {
            if (canvas.collapsibleIds.has(node.id)) toggleCollapse(node.id)
          }}
          onNodeDragStop={(_, node) => {
            setNodePositions((prev) => ({
              ...prev,
              [node.id]: { x: node.position.x, y: node.position.y },
            }))
          }}
          className="bg-background"
        >
          <ViewportPortal>
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={canvas.width}
              height={canvas.height}
              viewBox={`0 0 ${canvas.width} ${canvas.height}`}
              aria-hidden="true"
              style={{ zIndex: 1 }}
            >
              {canvas.lines.map((line) => {
                const isLeak = line.relation === 'leaks'
                const isServe = line.relation === 'serves'
                const isInventory = line.relation === 'inventory'
                const stroke = isLeak ? 'rgb(239 68 68 / 0.55)' : isServe ? 'rgb(59 130 246 / 0.45)' : isInventory ? 'rgb(100 116 139 / 0.55)' : 'hsl(var(--foreground) / 0.22)'
                const w = isLeak ? 1.5 : isServe || isInventory ? 1.25 : 1
                return (
                  <g key={line.id}>
                    <path d={line.path} fill="none" stroke="hsl(var(--background))" strokeWidth={w + 3} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
                    <path d={line.path} fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={isLeak ? '4 3' : undefined} />
                  </g>
                )
              })}
            </svg>
          </ViewportPortal>
          <Background gap={28} size={0.5} color="hsl(var(--muted-foreground) / 0.18)" />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            maskColor="hsl(var(--background) / 0.7)"
            className="!bg-card/90 !border !border-border !rounded-lg overflow-hidden"
            nodeColor={(node) => {
              const d = node.data as AttackFlowNodeData | undefined
              if (d?.kind === 'domain') return 'rgb(100 116 139)'
              if (d?.kind === 'host') return 'rgb(6 182 212 / 0.6)'
              if (d?.kind === 'leak') return 'rgb(239 68 68 / 0.7)'
              if (d?.kind === 'api') return 'rgb(59 130 246 / 0.5)'
              if (d?.kind === 'auth') return 'rgb(245 158 11 / 0.5)'
              if (d?.kind === 'interesting') return 'rgb(139 92 246 / 0.5)'
              if (d?.kind === 'tech') return 'rgb(20 184 166 / 0.4)'
              return 'hsl(var(--muted))'
            }}
          />
          <Controls className="!bg-card/90 !border !border-border !rounded-lg [&_button]:!bg-transparent [&_button]:!border-0 [&_button]:!text-muted-foreground [&_button:hover]:!text-foreground [&_button:hover]:!bg-muted/50" />
        </ReactFlow>
      </div>

      {canvas.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No attack surface nodes matched the current filter
        </div>
      )}
      </div>

      <aside className={cn(
        'z-20 flex min-h-0 flex-col border-l border-border bg-card/95 backdrop-blur-sm text-xs transition-[width]',
        surfaceSidebarCollapsed ? 'items-center overflow-hidden p-2' : 'overflow-auto'
      )}>
        {surfaceSidebarCollapsed ? (
          <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0 mt-1" onClick={() => setSurfaceSidebarCollapsed(false)} title="Expand panel">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : (
          <>
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Surface Panel</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => setSurfaceSidebarCollapsed(true)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Filter section */}
            <div className="px-4 pt-4 pb-3 border-b border-border/40">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filter by type</div>
              <div className="space-y-0.5">
                {([
                  ['all',         '◈ All nodes'],
                  ['domain',      '🌐 Domains'],
                  ['host',        '⬡ Subdomains'],
                  ['api',         '⌁ API endpoints'],
                  ['auth',        '⚷ Auth paths'],
                  ['interesting', '◉ Interesting'],
                  ['endpoint',    '◧ Endpoints'],
                  ['tech',        '◆ Technologies'],
                  ['port',        '◈ Ports'],
                  ['leak',        '⚠ API leaks'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setNodeFilter(id)}
                    className={cn(
                      'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[11px] text-left transition-colors',
                      nodeFilter === id
                        ? 'bg-primary/15 text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected node detail */}
            <div className="flex-1 overflow-auto px-4 pt-4 pb-4">
              {selectedNode ? (
                <div className="space-y-3">
                  <div>
                    <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{selectedNode.kind}</div>
                    <div className="break-all font-mono text-[12px] font-semibold text-foreground leading-tight">{selectedNode.label}</div>
                  </div>

                  {canvas.collapsibleIds.has(selectedNode.id) && (
                    <Button size="sm" variant="outline" className="h-7 w-full text-[11px] border-border bg-muted/30" onClick={() => toggleCollapse(selectedNode.id)}>
                      {collapsed.has(selectedNode.id) ? '+ Expand children' : '− Collapse children'}
                    </Button>
                  )}

                  {selectedHost && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ['Requests', compactCount(selectedHost.requests)],
                          ['Endpoints', compactCount(selectedHost.endpoints)],
                          ['Success', compactCount(selectedHost.success ?? 0)],
                          ['Errors', compactCount((selectedHost.clientErrors ?? 0) + (selectedHost.serverErrors ?? 0))],
                        ].map(([label, val]) => (
                          <div key={label} className="rounded-md bg-muted/40 px-2.5 py-2">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
                            <div className="font-mono text-[12px] font-semibold text-foreground">{val}</div>
                          </div>
                        ))}
                      </div>
                      {selectedHost.methods.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">Methods</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedHost.methods.map((m) => (
                              <span key={m} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{m}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedHost.ports.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">Open ports</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedHost.ports.map((p) => (
                              <span key={p} className="rounded border border-cyan-500/30 bg-cyan-500/8 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">{p}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedHost.technologies.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">Technologies</div>
                          <div className="flex flex-wrap gap-1">
                            {selectedHost.technologies.slice(0, 12).map((t) => (
                              <span key={t} className="rounded border border-teal-500/30 bg-teal-500/8 px-1.5 py-0.5 text-[10px] text-teal-400">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {(selectedHost.apiPaths.length > 0 || selectedHost.endpointPaths.length > 0) && (
                        <div>
                          <div className="mb-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">Top paths</div>
                          <div className="space-y-1">
                            {(selectedHost.apiPaths.length ? selectedHost.apiPaths : selectedHost.endpointPaths).slice(0, 8).map((p) => (
                              <div key={p} className="truncate rounded bg-muted/40 px-2 py-1 font-mono text-[10px] text-foreground">{p}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {selectedLeak && (
                    <div className="space-y-2">
                      <span className="inline-block rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                        {selectedLeak.severity}
                      </span>
                      <div className="rounded bg-muted/50 px-2 py-1.5 font-mono text-[10px] text-foreground break-all">{selectedLeak.evidence}</div>
                      <div className="break-all text-[10px] text-muted-foreground">{selectedLeak.url}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-center text-muted-foreground/60">
                  <div>
                    <div className="text-2xl mb-2">◎</div>
                    <div className="text-[11px]">Click a node to inspect</div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

export function ProxyView({
  interceptEnabled,
  onInterceptToggle,
}: {
  interceptEnabled: boolean
  onInterceptToggle: (enabled: boolean) => void
}) {
  const [proxy, setProxy] = useState<{ running: boolean; bind?: string | null } | null>(null)
  const [mitmEnabled, setMitmEnabled] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [fingerprintOptions, setFingerprintOptions] = useState<TlsFingerprintOptions | null>(null)
  const [rules, setRules] = useState<RuleSpec[]>([])

  const reload = async () => {
    const [ps, me, ds, s, r, fo] = await Promise.all([
      proxyStatus(),
      tlsGetMitmEnabled(),
      dashboardStats(),
      settingsGet(),
      rulesList(),
      tlsFingerprintOptions(),
    ])
    setProxy(ps)
    setMitmEnabled(me)
    setStats(ds)
    setSettingsState(s)
    setRules(r)
    setFingerprintOptions(fo)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'ProxyStatusChanged') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    const interval = window.setInterval(() => {
      dashboardStats().then(setStats).catch(() => {})
    }, 3000)
    return () => {
      unlisten?.()
      window.clearInterval(interval)
    }
  }, [])

  const updateSettings = (patch: Partial<Settings>) => {
    setSettingsState((prev) => (prev ? ({ ...prev, ...patch } as Settings) : prev))
    settingsSet(patch)
      .then((s) => setSettingsState(s))
      .catch(() => {})
  }

  const bind = proxy?.bind || '127.0.0.1:8080'
  const [address, portStr] = bind.split(':')
  const port = Number(portStr) || 8080
  const running = Boolean(proxy?.running)
  const listeners = [{ id: 1, address, port, protocol: 'HTTP/HTTPS', running }]

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Proxy Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure proxy listeners and connection options</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              configExport()
                .then((json) => {
                  return downloadsWriteText(`proxer-config-${Date.now()}.json`, json)
                })
                .then((r) => {
                  uiToastSuccess('Config exported', r.path)
                })
                .catch(() => {})
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Config
          </Button>
          <Button
            size="sm"
            onClick={() => {
              uiPrompt({
                title: 'Listener port',
                description: 'Enter a port number (1-65535).',
                defaultValue: String(port),
                placeholder: '8080',
              })
                .then((raw) => {
                  if (!raw) return
                  const nextPort = Number(raw)
                  if (!Number.isFinite(nextPort) || nextPort < 1 || nextPort > 65535) {
                    uiToastError('Invalid port', 'Must be between 1 and 65535')
                    return
                  }
                  return proxyStop()
                    .then(() => proxyStart(nextPort))
                    .then(() => reload())
                })
                .catch(() => {})
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Listener
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Proxy Listeners</h3>
          <div className="space-y-3">
            {listeners.map((listener) => (
              <div key={listener.id} className={cn(
                'flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border',
                !listener.running && 'opacity-60'
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-2.5 h-2.5 rounded-full',
                    listener.running ? 'bg-status-success animate-pulse' : 'bg-muted-foreground'
                  )} />
                  <div>
                    <span className="text-sm font-mono font-medium">{listener.address}:{listener.port}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{listener.protocol}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={cn(
                    listener.running ? 'bg-status-success/10 text-status-success' : ''
                  )}>
                    {listener.running ? 'Running' : 'Stopped'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      if (listener.running) {
                        proxyStop().then(() => reload()).catch(() => {})
                      } else {
                        proxyStart(listener.port).then(() => reload()).catch(() => {})
                      }
                    }}
                  >
                    {listener.running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => {
                      if (listener.running) {
                        proxyStop().then(() => reload()).catch(() => {})
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Use System Proxy</p>
                <p className="text-xs text-muted-foreground">Routes system HTTP/HTTPS through Proxer</p>
              </div>
              <Switch
                checked={Boolean(settings?.systemProxyEnabled)}
                onCheckedChange={(enabled) => {
                  updateSettings({ systemProxyEnabled: enabled })
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              If Intercept is ON and system proxy is enabled, other apps may pause until you Forward/Drop.
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Show CONNECT in History</p>
                <p className="text-xs text-muted-foreground">Toggle whether CONNECT tunnels appear in HTTP History</p>
              </div>
              <Switch
                checked={Boolean(settings?.showConnectTunnels)}
                onCheckedChange={(enabled) => {
                  updateSettings({ showConnectTunnels: enabled })
                }}
              />
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">SSL/TLS Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">SSL Interception</p>
                  <p className="text-xs text-muted-foreground">Decrypt HTTPS traffic</p>
                </div>
              </div>
              <Switch
                checked={mitmEnabled}
                onCheckedChange={(enabled) => {
                  setMitmEnabled(enabled)
                  ;(async () => {
                    if (enabled) {
                      if (!(await tlsCaInfo())) {
                        await tlsGenerateCa()
                      }
                      await tlsSetMitmEnabled(true)
                    } else {
                      await tlsSetMitmEnabled(false)
                    }
                    setMitmEnabled(await tlsGetMitmEnabled())
                  })().catch((e) => {
                    setMitmEnabled(false)
                    uiToastError('Could not update SSL interception', String(e))
                  })
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Verify Certificates</p>
                  <p className="text-xs text-muted-foreground">Validate server certificates</p>
                </div>
              </div>
              <Switch
                checked={Boolean(settings?.verifyCertificates)}
                onCheckedChange={(enabled) => {
                  updateSettings({ verifyCertificates: enabled })
                }}
              />
            </div>
            <div className="pt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  ;(async () => {
                    if (!(await tlsCaInfo())) {
                      await tlsGenerateCa()
                    }
                    const files = await tlsExportCaToDownloads()
                    uiToastSuccess('CA exported', files.cerPath)
                    await uiInfo({
                      title: 'Install CA in browser',
                      body: [
                        'CA exported to your Downloads folder:',
                        files.pemPath,
                        files.cerPath,
                        '',
                        'Browser install (Windows):',
                        '- Chrome/Edge: Settings → Privacy and security → Security → Manage certificates → Trusted Root Certification Authorities → Import → select the .cer',
                        '- Firefox: Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import → select the .pem or .cer and trust for websites',
                      ].join('\n'),
                    })
                  })().catch(() => {})
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Export CA
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  uiTwoField({
                    title: 'Import CA',
                    description: 'Paste the CA certificate and private key PEM.',
                    confirmText: 'Import',
                    a: { label: 'Certificate PEM', placeholder: '-----BEGIN CERTIFICATE-----', multiline: true },
                    b: { label: 'Private Key PEM', placeholder: '-----BEGIN PRIVATE KEY-----', multiline: true },
                  })
                    .then((res) => {
                      if (!res) return
                      return tlsImportCaPem(res.a, res.b)
                        .then(() => tlsSetMitmEnabled(true))
                        .then(() => tlsGetMitmEnabled().then(setMitmEnabled))
                        .then(() => uiToastSuccess('CA imported'))
                    })
                    .catch(() => {})
                }}
              >
                <Upload className="w-4 h-4 mr-2" />
                Import CA
              </Button>
            </div>
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Custom TLS Fingerprint</p>
                  <p className="text-xs text-muted-foreground">Uses primp browser impersonation for upstream HTTP(S)</p>
                </div>
                <Switch
                  checked={Boolean(settings?.tlsFingerprintEnabled)}
                  onCheckedChange={(enabled) => updateSettings({ tlsFingerprintEnabled: enabled })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Browser Profile</label>
                  <Select
                    value={settings?.tlsFingerprintProfile ?? 'chrome'}
                    onValueChange={(v) => updateSettings({ tlsFingerprintProfile: v })}
                  >
                    <SelectTrigger className="mt-1.5 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(fingerprintOptions?.profiles ?? ['chrome']).map((profile) => (
                        <SelectItem key={profile} value={profile}>{profile}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Operating System</label>
                  <Select
                    value={settings?.tlsFingerprintOs ?? 'windows'}
                    onValueChange={(v) => updateSettings({ tlsFingerprintOs: v })}
                  >
                    <SelectTrigger className="mt-1.5 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(fingerprintOptions?.operatingSystems ?? ['windows']).map((os) => (
                        <SelectItem key={os} value={os}>{os}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Reference: {fingerprintOptions?.reference ?? 'https://github.com/deedy5/primp'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Request Interception Rules</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Intercept Requests</p>
                <p className="text-xs text-muted-foreground">Hold requests for manual review</p>
              </div>
              <Switch
                checked={interceptEnabled}
                onCheckedChange={(enabled) => {
                  onInterceptToggle(enabled)
                }}
              />
            </div>
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Scope Rules (Regex)</p>
              <Textarea
                className="font-mono text-xs h-20"
                placeholder=".*\\.example\\.com$&#10;.*\\/api\\/.*"
                value={settings?.scopeRegex ?? '.*'}
                onChange={(e) => {
                  settingsSet({ scopeRegex: e.target.value })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
                }}
              />
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Connection Options</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Request Timeout (seconds)</label>
              <Input
                type="number"
                value={settings?.requestTimeoutSeconds ?? 30}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  settingsSet({ requestTimeoutSeconds: v })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
                }}
                className="mt-1.5 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Max Concurrent Connections</label>
              <Input
                type="number"
                value={settings?.maxConcurrentConnections ?? 100}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  settingsSet({ maxConcurrentConnections: v })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
                }}
                className="mt-1.5 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Follow Redirects (max)</label>
              <Input
                type="number"
                value={settings?.followRedirectsMax ?? 10}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  settingsSet({ followRedirectsMax: v })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
                }}
                className="mt-1.5 h-9"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium">Upstream Proxy</p>
                <p className="text-xs text-muted-foreground">Route through another proxy</p>
              </div>
              <Switch
                checked={Boolean(settings?.upstreamProxyEnabled)}
                onCheckedChange={(enabled) => {
                  updateSettings({ upstreamProxyEnabled: enabled })
                }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Upstream Proxy URL</label>
              <Input
                value={settings?.upstreamProxyUrl ?? ''}
                placeholder="http://127.0.0.1:8081 or socks5h://127.0.0.1:9050"
                onChange={(e) => updateSettings({ upstreamProxyUrl: e.target.value })}
                className="mt-1.5 h-9 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground mt-1">HTTP, HTTPS, SOCKS5, and SOCKS5H are supported for HTTP(S) requests.</p>
            </div>
            <div className="pt-3 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">MCP Server</p>
                  <p className="text-xs text-muted-foreground">JSON-RPC tools for agents on localhost</p>
                </div>
                <Switch
                  checked={Boolean(settings?.mcpEnabled)}
                  onCheckedChange={(enabled) => updateSettings({ mcpEnabled: enabled })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">MCP Port</label>
                <Input
                  type="number"
                  value={settings?.mcpPort ?? 8765}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) updateSettings({ mcpPort: v })
                  }}
                  className="mt-1.5 h-9"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Restart Proxer after changing MCP server settings.</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Match & Replace Rules</h3>
          <div className="space-y-3">
            {rules.map((rule) => {
              const actions = (rule.actions || []).map((a: any) => a?.type).filter(Boolean).join(', ') || '—'
              const matchParts = [
                rule.matcher?.method ? `method=${rule.matcher.method}` : null,
                rule.matcher?.urlContains ? `url~=${rule.matcher.urlContains}` : null,
                rule.matcher?.statusCode ? `status=${rule.matcher.statusCode}` : null,
              ].filter(Boolean)
              const match = matchParts.length ? matchParts.join(' ') : 'any'
              return (
                <div key={rule.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(rule.enabled)}
                        onCheckedChange={(enabled) => {
                          rulesUpsert({ ...rule, enabled })
                            .then(() => reload())
                            .catch(() => {})
                        }}
                      />
                      <span className="font-medium text-foreground truncate">{rule.name}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1 truncate">
                      match: {match} • actions: {actions}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => {
                        uiPrompt({
                          title: 'Edit rule JSON',
                          defaultValue: JSON.stringify(rule, null, 2),
                          multiline: true,
                          confirmText: 'Save',
                        })
                          .then((next) => {
                            if (!next) return
                            try {
                              const parsed = JSON.parse(next)
                              return rulesUpsert(parsed).then(() => reload())
                            } catch {
                              uiToastError('Invalid JSON')
                            }
                          })
                          .catch(() => {})
                      }}
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => {
                        rulesRemove(rule.id)
                          .then(() => reload())
                          .catch(() => {})
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
            {rules.length === 0 && (
              <div className="text-xs text-muted-foreground">No rules yet.</div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                const template: RuleSpec = {
                  id: `rule-${Date.now()}`,
                  name: 'New rule',
                  enabled: true,
                  matcher: { method: null, urlContains: null, headerEquals: [], statusCode: null },
                  actions: [{ type: 'SetHeader', data: { name: 'User-Agent', value: 'Proxer' } }],
                }
                uiPrompt({
                  title: 'New rule JSON',
                  defaultValue: JSON.stringify(template, null, 2),
                  multiline: true,
                  confirmText: 'Create',
                })
                  .then((raw) => {
                    if (!raw) return
                    try {
                      const parsed = JSON.parse(raw)
                      return rulesUpsert(parsed).then(() => reload())
                    } catch {
                      uiToastError('Invalid JSON')
                    }
                  })
                  .catch(() => {})
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </Card>

        <Card className="p-5 bg-card border-border">
          <h3 className="text-sm font-semibold text-foreground mb-4">Traffic Statistics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-muted/30 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats ? stats.totalRequests : '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Requests</p>
            </div>
            <div className="text-center p-3 bg-muted/30 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats ? formatBytes(stats.totalTransferredBytes) : '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">Data Transferred</p>
            </div>
            <div className="text-center p-3 bg-muted/30 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats ? `${stats.avgResponseMs}ms` : '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">Avg Response</p>
            </div>
            <div className="text-center p-3 bg-muted/30 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{stats ? stats.uniqueHosts : '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">Unique Hosts</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export function ScannerView() {
  const [selectedSeverity, setSelectedSeverity] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [scanStatusState, setScanStatusState] = useState<ScanStatus | null>(null)
  const [vulns, setVulns] = useState<Vulnerability[]>([])

  const reload = async () => {
    const [ss, findings] = await Promise.all([scannerStatus(), scannerFindingsList(undefined, 2000, 0)])
    setScanStatusState(ss)
    setVulns(findings)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'ScanFinding' || ev.type === 'ScanProgress' || ev.type === 'ScanCompleted') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
    }
  }, [])

  const filteredVulns = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return vulns.filter((v) => {
      if (selectedSeverity !== 'all' && v.severity.toLowerCase() !== selectedSeverity) return false
      if (!q) return true
      const hay = [v.title, v.host, v.path, v.description, v.remediation, v.severity].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [vulns, selectedSeverity, searchText])
  const isScanning = Boolean(scanStatusState?.running)

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">Automated vulnerability detection and analysis</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const report = {
                generatedAt: new Date().toISOString(),
                scanStatus: scanStatusState,
                findings: vulns,
              }
              downloadsWriteText(`proxer-scan-report-${Date.now()}.json`, JSON.stringify(report, null, 2))
                .then((r) => uiToastSuccess('Scan report exported', r.path))
                .catch(() => {})
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
          <Button 
            size="sm" 
            onClick={() => {
              if (isScanning) {
                scannerStop().then(() => reload()).catch(() => {})
              } else {
                scannerStart().then(() => reload()).catch(() => {})
              }
            }}
            variant={isScanning ? 'destructive' : 'default'}
          >
            {isScanning ? (
              <>
                <Pause className="w-4 h-4 mr-2" />
                Stop Scan
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Start Scan
              </>
            )}
          </Button>
        </div>
      </div>

      {isScanning && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Radar className="w-4 h-4 text-primary animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium">Active Scan Running</p>
                <p className="text-xs text-muted-foreground">
                  Scanning captured traffic - {scanStatusState?.progressTotal ? Math.round((scanStatusState.progressDone / Math.max(1, scanStatusState.progressTotal)) * 100) : 0}% complete
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium">{scanStatusState?.progressDone ?? 0} / {scanStatusState?.progressTotal ?? 0}</p>
                <p className="text-xs text-muted-foreground">Requests sent</p>
              </div>
              <Progress
                value={scanStatusState?.progressTotal ? (scanStatusState.progressDone / Math.max(1, scanStatusState.progressTotal)) * 100 : 0}
                className="w-32 h-2"
              />
            </div>
          </div>
        </Card>
      )}

      <div className="mt-4">
        <div className="flex gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search vulnerabilities..."
              className="pl-9"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <Select value={selectedSeverity} onValueChange={setSelectedSeverity}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {filteredVulns.map((vuln) => (
            <Card key={vuln.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <SeverityBadge severity={vuln.severity} />
                    <h3 className="text-sm font-semibold text-foreground">{vuln.title}</h3>
                    {vuln.cvss && (
                      <Badge variant="outline" className="text-[10px] font-mono">CVSS {vuln.cvss}</Badge>
                    )}
                    {vuln.cwe && (
                      <Badge variant="outline" className="text-[10px] font-mono">{vuln.cwe}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{vuln.description}</p>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{vuln.host}</span>
                      <span className="font-mono ml-1">{vuln.path}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Confidence: <span className="font-medium text-foreground">{vuln.confidence}</span>
                    </span>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{vuln.requests}</span> requests
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

export function IntruderView() {
  const [attackType, setAttackType] = useState('sniper')
  const exampleTemplateRaw = `POST https://api.example.com/api/auth/login HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer §token§

{
  "email": "§email§",
  "password": "§password§"
}`
  const examplePayloadText = `admin@example.com
user@example.com
test@example.com
admin
root
administrator`
  const [templateRaw, setTemplateRaw] = useState(exampleTemplateRaw)
  const [payloadText, setPayloadText] = useState(examplePayloadText)
  const [attackId, setAttackId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<IntruderResult[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const visualClearAfterMsRef = useRef<number | null>(null)

  useEffect(() => {
    const next = localStorage.getItem('skuntir:intruderTemplateRaw')
    if (next) {
      setTemplateRaw(next)
      localStorage.removeItem('skuntir:intruderTemplateRaw')
    }
    settingsGet()
      .then((s) => {
        if (s.showExamples === false) {
          setTemplateRaw((prev) => (prev === exampleTemplateRaw ? '' : prev))
          setPayloadText((prev) => (prev === examplePayloadText ? '' : prev))
        } else {
          setTemplateRaw((prev) => (prev.trim() === '' ? exampleTemplateRaw : prev))
          setPayloadText((prev) => (prev.trim() === '' ? examplePayloadText : prev))
        }
      })
      .catch(() => {})

    let unlisten: (() => void) | null = null
    const onVisualClear = (ev: Event) => {
      const e = ev as CustomEvent
      const ts = typeof e.detail?.tsMs === 'number' ? e.detail.tsMs : Date.now()
      visualClearAfterMsRef.current = ts
      setResults([])
      setProgress(null)
      setErrorMsg(null)
    }
    onBackendEvent((ev) => {
      if (ev.type === 'IntruderStarted') {
        setAttackId(ev.payload.attack_id)
        setRunning(true)
        setProgress(null)
        setResults([])
        setErrorMsg(null)
      }
      if (ev.type === 'IntruderProgress') {
        setProgress({ done: ev.payload.done, total: ev.payload.total })
      }
      if (ev.type === 'IntruderResult') {
        const r = ev.payload.result
        const cutoff = visualClearAfterMsRef.current
        if (cutoff && r.tsMs < cutoff) return
        setResults((prev) => [r, ...prev].slice(0, 5000))
      }
      if (ev.type === 'IntruderCompleted') {
        setRunning(false)
      }
    }).then((u) => (unlisten = u))
    window.addEventListener('skuntir:visual-clear', onVisualClear)
    return () => {
      unlisten?.()
      window.removeEventListener('skuntir:visual-clear', onVisualClear)
    }
  }, [])

  return (
    <div className="flex h-full bg-background">
      <div className="flex-1 flex flex-col border-r border-border">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Positions</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAttackId(null)
                  setRunning(false)
                  setProgress(null)
                }}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant={running ? 'destructive' : 'default'}
                onClick={() => {
                  if (running) {
                    intruderStop().catch(() => {})
                    return
                  }
                  setErrorMsg(null)
                  setResults([])
                  const blocks = payloadText
                    .split(/\n\s*\n/g)
                    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
                    .filter((b) => b.length > 0)
                  const payloadSets = blocks.length > 0 ? blocks : []
                  const payloads = payloadSets[0] ?? []
                  intruderStart({ attackType, templateRaw, payloads, payloadSets })
                    .then((r) => {
                      setAttackId(r.attackId)
                      setRunning(true)
                      setProgress({ done: 0, total: r.payloadCount })
                    })
                    .catch((e) => {
                      setRunning(false)
                      setProgress(null)
                      setErrorMsg(String(e))
                    })
                }}
              >
                {running ? (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Stop Attack
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Start Attack
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
        
        <div className="p-4 border-b border-border">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">Attack Type</label>
              <Select value={attackType} onValueChange={setAttackType}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sniper">Sniper</SelectItem>
                  <SelectItem value="battering-ram">Battering Ram</SelectItem>
                  <SelectItem value="pitchfork">Pitchfork</SelectItem>
                  <SelectItem value="cluster-bomb">Cluster Bomb</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-auto">
          <Textarea
            className="h-full font-mono text-xs resize-none"
            value={templateRaw}
            onChange={(e) => setTemplateRaw(e.target.value)}
          />
        </div>

        <div className="p-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          {running
            ? `Running${attackId ? ` (${attackId})` : ''} - ${progress ? `${progress.done}/${progress.total}` : 'starting'}`
            : `Ready${attackId ? ` (${attackId})` : ''}`}
        </div>
      </div>

      <div className="w-80 flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-semibold">Payloads</h2>
        </div>
        
        <div className="flex-1 p-4 overflow-auto">
          <label className="text-xs font-medium text-muted-foreground">Payload Options</label>
          <Textarea
            className="mt-1.5 h-40 font-mono text-xs"
            placeholder="Enter one payload per line..."
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
          />
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => navigator.clipboard.readText().then(setPayloadText).catch(() => {})}
            >
              <Clipboard className="w-3 h-3 mr-1" />
              Paste
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setPayloadText('')}>
              <Trash2 className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
          {errorMsg && <div className="mt-3 text-xs text-destructive whitespace-pre-wrap break-words">{errorMsg}</div>}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Results</span>
              <span className="text-xs text-muted-foreground">{results.length}</span>
            </div>
            {results.length === 0 ? (
              <div className="text-xs text-muted-foreground">No results yet</div>
            ) : (
              <div className="space-y-1">
                {results.slice().reverse().map((r, idx) => (
                  <div
                    key={`${r.id}-${r.tsMs}-${r.seq}-${idx}`}
                    className={cn(
                      'rounded-md border border-border px-2 py-1 text-xs font-mono flex items-center justify-between',
                      r.error ? 'bg-destructive/10' : r.statusCode && r.statusCode >= 200 && r.statusCode < 400 ? 'bg-status-success/10' : 'bg-muted/30'
                    )}
                  >
                    <span className="text-muted-foreground">#{r.seq + 1}</span>
                    <span className="text-foreground">{r.statusCode ?? 'ERR'}</span>
                    <span className="text-muted-foreground">{r.durationMs ?? '-'}ms</span>
                    <span className="text-muted-foreground">{r.size ?? '-'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RepeaterView() {
  type RepeaterTab = {
    id: string
    title: string
    rawRequest: string
    response: string | null
    result: RepeaterSendResult | null
    sending: boolean
  }

  const [sending, setSending] = useState(false)
  const exampleRawRequest = `POST https://api.example.com/api/users/1 HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Accept: application/json

{
  "name": "Updated Name",
  "email": "updated@example.com"
}`
  const storageKey = 'skuntir:repeaterTabs'
  const activeStorageKey = 'skuntir:repeaterActiveTab'
  const tabsRef = useRef(0)
  const tabsStateRef = useRef<RepeaterTab[]>([])
  const activeTabIdRef = useRef('initial')
  const [tabs, setTabs] = useState<RepeaterTab[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]') as RepeaterTab[]
      if (Array.isArray(stored) && stored.length > 0) {
        const restored = stored.slice(0, 50).map((tab, index) => ({
          id: tab.id || `restored-${index + 1}`,
          title: tab.title || `Request ${index + 1}`,
          rawRequest: tab.rawRequest || '',
          response: tab.response ?? null,
          result: tab.result ?? null,
          sending: false,
        }))
        tabsRef.current = restored.length
        tabsStateRef.current = restored
        activeTabIdRef.current = localStorage.getItem(activeStorageKey) || restored[0].id
        return restored
      }
    } catch {
      localStorage.removeItem(storageKey)
      localStorage.removeItem(activeStorageKey)
    }

    tabsRef.current = 1
    const initial = [{
      id: 'initial',
      title: 'Request 1',
      rawRequest: exampleRawRequest,
      response: null,
      result: null,
      sending: false,
    }]
    tabsStateRef.current = initial
    return initial
  })
  const [activeTabId, setActiveTabId] = useState(activeTabIdRef.current)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const activateTab = (id: string) => {
    activeTabIdRef.current = id
    setActiveTabId(id)
  }

  useEffect(() => {
    tabsStateRef.current = tabs
    localStorage.setItem(storageKey, JSON.stringify(tabs.map((tab) => ({ ...tab, sending: false }))))
  }, [tabs])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
    localStorage.setItem(activeStorageKey, activeTabId)
  }, [activeTabId])

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      activateTab(tabs[0].id)
    }
  }, [tabs, activeTabId])

  const addTab = (rawRequest = exampleRawRequest) => {
    tabsRef.current += 1
    const tab: RepeaterTab = {
      id: `${Date.now()}-${tabsRef.current}`,
      title: `Request ${tabsRef.current}`,
      rawRequest,
      response: null,
      result: null,
      sending: false,
    }
    setTabs((prev) => [...prev, tab])
    activateTab(tab.id)
  }

  const closeTab = (id = activeTabIdRef.current) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const index = prev.findIndex((tab) => tab.id === id)
      const next = prev.filter((tab) => tab.id !== id)
      if (id === activeTabIdRef.current) {
        activateTab(next[Math.max(0, index - 1)]?.id ?? next[0].id)
      }
      return next
    })
  }

  const updateActiveTab = (patch: Partial<RepeaterTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabIdRef.current ? { ...tab, ...patch } : tab)))
  }

  const handleSend = async () => {
    const tab = tabsStateRef.current.find((item) => item.id === activeTabIdRef.current)
    if (!tab || tab.sending) return
    setSending(true)
    setTabs((prev) => prev.map((item) => item.id === tab.id ? { ...item, sending: true } : item))
    try {
      const res = await repeaterSendRaw(tab.rawRequest)
      setTabs((prev) => prev.map((item) => item.id === tab.id ? { ...item, response: res.rawResponse, result: res, sending: false } : item))
    } catch (e) {
      setTabs((prev) => prev.map((item) => item.id === tab.id ? { ...item, response: `Error sending request:\n${String(e)}`, result: null, sending: false } : item))
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    const addPending = () => {
      const next = localStorage.getItem('skuntir:repeaterRaw')
      if (!next) return
      localStorage.removeItem('skuntir:repeaterRaw')
      addTab(next)
    }
    addPending()

    settingsGet()
      .then((s) => {
        if (s.showExamples === false) {
          setTabs((prev) => prev.map((tab) => tab.rawRequest === exampleRawRequest ? { ...tab, rawRequest: '' } : tab))
        } else {
          setTabs((prev) => prev.map((tab) => tab.rawRequest.trim() === '' ? { ...tab, rawRequest: exampleRawRequest } : tab))
        }
      })
      .catch(() => {})

    const onAdd = (ev: Event) => {
      const e = ev as CustomEvent
      const rawRequest = e.detail?.rawRequest
      if (typeof rawRequest === 'string') addTab(rawRequest)
    }
    const onHotkey = (ev: Event) => {
      const e = ev as CustomEvent
      if (e.detail?.action === 'send-repeater') handleSend().catch(() => {})
      if (e.detail?.action === 'new-tab') addTab('')
      if (e.detail?.action === 'close-tab') closeTab()
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault()
        handleSend()
      }
    }
    window.addEventListener('skuntir:repeater:add', onAdd)
    window.addEventListener('skuntir:hotkey', onHotkey)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('skuntir:repeater:add', onAdd)
      window.removeEventListener('skuntir:hotkey', onHotkey)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm font-semibold text-foreground">Repeater</div>
          <Badge variant="outline" className="text-[10px]">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => addTab('')}>
            <Plus className="w-4 h-4 mr-2" />
            New
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending || !activeTab}>
            <Send className="w-4 h-4 mr-2" />
            {activeTab?.sending ? 'Sending...' : 'Send'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => activeTab && appNavigate('intruder', { templateRaw: activeTab.rawRequest })}
            disabled={!activeTab}
          >
            <Zap className="w-4 h-4 mr-2" />
            Send to Intruder
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => activateTab(tab.id)}
            className={cn(
              'group flex items-center gap-2 h-8 max-w-48 rounded-md border px-3 text-xs transition-colors',
              activeTabId === tab.id
                ? 'bg-card border-border text-foreground shadow-sm'
                : 'bg-transparent border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground'
            )}
          >
            <span className="truncate">{tab.title}</span>
            {tab.result && (
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                {tab.result.statusCode}
              </Badge>
            )}
            {tabs.length > 1 && (
              <X
                className="w-3 h-3 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              />
            )}
          </button>
        ))}
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={44} minSize={25} className="flex flex-col">
          <div className="px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
            Request
          </div>
          <div className="flex-1 p-2 min-h-0">
            <Textarea
              className="h-full font-mono text-xs resize-none"
              value={activeTab?.rawRequest ?? ''}
              onChange={(e) => updateActiveTab({ rawRequest: e.target.value, response: null, result: null })}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border hover:bg-primary/20 transition-colors" />

        <ResizablePanel defaultSize={56} minSize={35} className="flex flex-col">
          <div className="p-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">Response</span>
            {activeTab?.result && (
              <div className="flex items-center gap-3 text-xs">
                <Badge 
                  variant="outline" 
                  className={cn(
                    activeTab.result.statusCode >= 200 && activeTab.result.statusCode < 300
                      ? 'bg-status-success/10 text-status-success border-status-success/20'
                      : activeTab.result.statusCode >= 400
                        ? 'bg-status-server-error/10 text-status-server-error border-status-server-error/20'
                        : ''
                  )}
                >
                  {activeTab.result.statusCode}
                </Badge>
                <span className="text-muted-foreground">Time: {formatDurationMs(activeTab.result.durationMs)}</span>
                <span className="text-muted-foreground">Size: {formatBytes(activeTab.result.size)}</span>
              </div>
            )}
          </div>
          <div className="flex-1 p-2 min-h-0">
            {activeTab?.response ? (
              <Textarea 
                className="h-full font-mono text-xs resize-none bg-muted/30"
                value={activeTab.response}
                readOnly
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Send className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Click Send to execute the request</p>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export function InterceptView({
  interceptEnabled,
  onInterceptToggle,
}: {
  interceptEnabled: boolean
  onInterceptToggle: (enabled: boolean) => void
}) {
  const [queue, setQueue] = useState<InterceptQueueItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editedRaw, setEditedRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const activeIdRef = useRef<string | null>(null)
  const active = queue.find((item) => item.interceptionId === activeId) ?? queue[0] ?? null

  const persistQueue = (items: InterceptQueueItem[]) => {
    localStorage.setItem('skuntir:interceptQueue', JSON.stringify(items.slice(0, 100)))
  }

  const activateIntercept = (item: InterceptQueueItem | null) => {
    activeIdRef.current = item?.interceptionId ?? null
    setActiveId(item?.interceptionId ?? null)
    setEditedRaw(item?.raw ?? '')
  }

  const removeFromQueue = (interceptionId: string) => {
    setQueue((prev) => {
      const next = prev.filter((item) => item.interceptionId !== interceptionId)
      persistQueue(next)
      const nextActive = next[0] ?? null
      activateIntercept(nextActive)
      return next
    })
  }

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('skuntir:interceptQueue') || '[]') as InterceptQueueItem[]
      setQueue(stored)
      activateIntercept(stored[0] ?? null)
    } catch {
      localStorage.removeItem('skuntir:interceptQueue')
    }

    const onPaused = (ev: Event) => {
      const e = ev as CustomEvent<InterceptQueueItem>
      const item = e.detail
      if (!item?.interceptionId || !item.raw) return

      setQueue((prev) => {
        const next = [item, ...prev.filter((queued) => queued.interceptionId !== item.interceptionId)].slice(0, 100)
        persistQueue(next)
        if (!activeIdRef.current) activateIntercept(item)
        return next
      })
    }

    window.addEventListener('skuntir:intercept:paused', onPaused)
    return () => window.removeEventListener('skuntir:intercept:paused', onPaused)
  }, [])

  useEffect(() => {
    interceptQueue()
      .then((items) => {
        if (!items.length) return
        setQueue((prev) => {
          const next = [
            ...items,
            ...prev.filter((queued) => !items.some((item) => item.interceptionId === queued.interceptionId)),
          ].slice(0, 100)
          persistQueue(next)
          if (!activeIdRef.current) activateIntercept(next[0] ?? null)
          return next
        })
      })
      .catch(() => {})
  }, [])

  const forwardActive = async () => {
    if (!active || busy) return
    const current = active
    setBusy(true)
    try {
      await interceptForward(current.interceptionId, editedRaw)
      removeFromQueue(current.interceptionId)
    } catch (e) {
      removeFromQueue(current.interceptionId)
      uiToastError('Could not forward request', String(e))
    } finally {
      setBusy(false)
    }
  }

  const dropActive = async () => {
    if (!active || busy) return
    const current = active
    setBusy(true)
    try {
      await interceptDrop(current.interceptionId)
      removeFromQueue(current.interceptionId)
    } catch (e) {
      removeFromQueue(current.interceptionId)
      uiToastError('Could not drop request', String(e))
    } finally {
      setBusy(false)
    }
  }

  const forwardAll = async () => {
    if (busy) return
    const items = [...queue]
    setBusy(true)
    for (const item of items) {
      try { await interceptForward(item.interceptionId) } catch { /* swallow */ }
      removeFromQueue(item.interceptionId)
    }
    setBusy(false)
  }

  const dropAll = async () => {
    if (busy) return
    const items = [...queue]
    setBusy(true)
    for (const item of items) {
      try { await interceptDrop(item.interceptionId) } catch { /* swallow */ }
      removeFromQueue(item.interceptionId)
    }
    setBusy(false)
  }

  useEffect(() => {
    const onHotkey = (ev: Event) => {
      const e = ev as CustomEvent
      if (e.detail?.action === 'forward') forwardActive().catch(() => {})
      if (e.detail?.action === 'drop') dropActive().catch(() => {})
    }
    window.addEventListener('skuntir:hotkey', onHotkey)
    return () => window.removeEventListener('skuntir:hotkey', onHotkey)
  }, [active, busy, editedRaw])

  const parseQueueItem = (item: InterceptQueueItem) => {
    if (item.kind === 'ws-message') {
      const dir = item.raw.startsWith('→') ? '→' : '←'
      const text = item.raw.replace(/^[→←]\s*/, '').replace(/^\[binary\]\s*/, '')
      return { method: 'WS', path: text.slice(0, 80), host: dir === '→' ? 'client → server' : 'server → client', isWs: true }
    }
    const firstLine = item.raw.split(/\r?\n/, 1)[0] ?? ''
    const parts = firstLine.split(' ')
    const method = parts[0] ?? 'GET'
    const rawUrl = parts[1] ?? '/'
    let path = rawUrl
    let host = item.raw.match(/^host:\s*(.+)$/im)?.[1]?.trim() ?? ''
    try {
      if (rawUrl.startsWith('http')) {
        const u = new URL(rawUrl)
        path = u.pathname + u.search
        if (!host) host = u.host
      }
    } catch { /* ignore */ }
    return { method, path: path.slice(0, 100), host, isWs: false }
  }

  const methodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':    return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'POST':   return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      case 'PUT':    return 'bg-violet-500/20 text-violet-400 border-violet-500/30'
      case 'PATCH':  return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
      case 'DELETE': return 'bg-red-500/20 text-red-400 border-red-500/30'
      case 'WS':     return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      default:       return 'bg-muted text-muted-foreground border-border'
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap">
        <Button
          variant={interceptEnabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => onInterceptToggle(!interceptEnabled)}
          className={cn('font-mono text-xs', interceptEnabled ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : '')}
        >
          {interceptEnabled ? <Pause className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
          {interceptEnabled ? 'Intercept ON' : 'Intercept OFF'}
        </Button>

        <div className="h-5 w-px bg-border mx-0.5" />

        <Button
          variant="outline"
          size="sm"
          disabled={!active || busy}
          onClick={() => forwardActive().catch(() => {})}
          className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
        >
          <ArrowUp className="w-3.5 h-3.5 mr-1.5" />
          Forward
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!active || busy}
          onClick={() => dropActive().catch(() => {})}
          className="border-red-500/50 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Drop
        </Button>

        {queue.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => forwardAll().catch(() => {})}
              className="text-xs text-muted-foreground hover:text-emerald-400"
            >
              Forward All ({queue.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => dropAll().catch(() => {})}
              className="text-xs text-muted-foreground hover:text-red-400"
            >
              Drop All
            </Button>
          </>
        )}

        {active && (
          <>
            <div className="h-5 w-px bg-border mx-0.5" />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => appNavigate('repeater', { rawRequest: editedRaw })}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Repeater
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => appNavigate('intruder', { templateRaw: editedRaw })}
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              Intruder
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {queue.length > 0 && (
            <Badge className="bg-destructive/20 text-destructive border border-destructive/40 font-mono text-[10px] animate-pulse gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />
              {queue.length} INTERCEPTED
            </Badge>
          )}
          {interceptEnabled && queue.length === 0 && (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              Waiting...
            </Badge>
          )}
          {!interceptEnabled && (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              Passthrough
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Queue sidebar — always visible */}
        <div className="w-72 border-r border-border flex flex-col shrink-0 bg-muted/10">
          <div className="px-3 py-1.5 border-b border-border/60 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Queue ({queue.length})
          </div>
          <div className="flex-1 overflow-auto">
            {queue.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground/50 mt-6">
                {interceptEnabled ? 'No paused requests' : 'Intercept is off'}
              </div>
            ) : (
              queue.map((item) => {
                const { method, path, host } = parseQueueItem(item)
                const isSelected = active?.interceptionId === item.interceptionId
                return (
                  <button
                    key={item.interceptionId}
                    type="button"
                    onClick={() => activateIntercept(item)}
                    className={cn(
                      'w-full border-b border-border/40 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors',
                      isSelected && 'bg-primary/10 border-l-2 border-l-primary'
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded border font-mono', methodColor(method))}>
                        {method}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono truncate text-foreground leading-tight">{path}</div>
                    <div className="text-[10px] truncate text-muted-foreground mt-0.5">{host}</div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {active ? (
            <>
              <div className="px-3 py-1 border-b border-border/60 bg-destructive/5 flex items-center gap-2 shrink-0">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <span className="text-[10px] font-mono text-destructive font-semibold tracking-wider">INTERCEPTED</span>
                <span className="text-[10px] text-muted-foreground font-mono ml-2 truncate">{active.interceptionId}</span>
              </div>
              <Textarea
                className="flex-1 font-mono text-xs resize-none rounded-none border-0 focus-visible:ring-0 min-h-0"
                value={editedRaw}
                onChange={(e) => setEditedRaw(e.target.value)}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No request intercepted</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {interceptEnabled ? 'Waiting for incoming requests...' : 'Enable intercept to capture requests'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function DecoderView() {
  const [input, setInput] = useState('Hello, World!')
  const [output, setOutput] = useState('')
  const [operation, setOperation] = useState('base64-encode')
  const [decoderPackEnabled, setDecoderPackEnabled] = useState(false)

  useEffect(() => {
    extensionsList(true)
      .then((items) => setDecoderPackEnabled(items.some((e) => e.id === 'ext.decoder' && e.enabled)))
      .catch(() => setDecoderPackEnabled(false))
  }, [])

  const handleOperation = (selectedOperation = operation) => {
    switch (selectedOperation) {
      case 'base64-encode':
        setOutput(btoa(input))
        break
      case 'base64-decode':
        try { setOutput(atob(input)) } catch { setOutput('Invalid Base64') }
        break
      case 'url-encode':
        setOutput(encodeURIComponent(input))
        break
      case 'url-decode':
        setOutput(decodeURIComponent(input))
        break
      case 'html-encode':
        setOutput(input.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m] || m)))
        break
      case 'hex-encode':
        setOutput(Array.from(input).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '))
        break
      case 'rot13':
        setOutput(input.replace(/[a-zA-Z]/g, (c) => {
          const base = c <= 'Z' ? 65 : 97
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
        }))
        break
      case 'json-pretty':
        try { setOutput(JSON.stringify(JSON.parse(input), null, 2)) } catch { setOutput('Invalid JSON') }
        break
      case 'jwt-decode':
        try {
          const parts = input.trim().split('.')
          if (parts.length < 2) throw new Error('Invalid JWT')
          const decodePart = (part: string) => {
            const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
            return JSON.parse(atob(padded))
          }
          setOutput(JSON.stringify({ header: decodePart(parts[0]), payload: decodePart(parts[1]) }, null, 2))
        } catch {
          setOutput('Invalid JWT')
        }
        break
      case 'unicode-escape':
        setOutput(Array.from(input).map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''))
        break
      default:
        setOutput(input)
    }
  }

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Decoder</h1>
        <p className="text-sm text-muted-foreground mt-1">Encode and decode data in various formats</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Input</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setInput('')}>
                <Trash2 className="w-3 h-3 mr-1" />
                Clear
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.readText().then(setInput)}>
                <Clipboard className="w-3 h-3 mr-1" />
                Paste
              </Button>
            </div>
          </div>
          <Textarea 
            className="h-48 font-mono text-sm resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to encode/decode..."
          />
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Output</h3>
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(output)}>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </Button>
          </div>
          <Textarea 
            className="h-48 font-mono text-sm resize-none bg-muted/30"
            value={output}
            readOnly
            placeholder="Output will appear here..."
          />
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-4">Operations</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'base64-encode', label: 'Base64 Encode' },
            { id: 'base64-decode', label: 'Base64 Decode' },
            { id: 'url-encode', label: 'URL Encode' },
            { id: 'url-decode', label: 'URL Decode' },
            { id: 'html-encode', label: 'HTML Encode' },
            { id: 'hex-encode', label: 'Hex Encode' },
            ...(decoderPackEnabled
              ? [
                  { id: 'rot13', label: 'ROT13' },
                  { id: 'json-pretty', label: 'JSON Pretty' },
                  { id: 'jwt-decode', label: 'JWT Decode' },
                  { id: 'unicode-escape', label: 'Unicode Escape' },
                ]
              : []),
          ].map((op) => (
            <Button
              key={op.id}
              variant={operation === op.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setOperation(op.id)
                handleOperation(op.id)
              }}
            >
              {op.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={() => handleOperation()}>
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Apply Operation
          </Button>
          <Button variant="outline" onClick={() => { setInput(output); setOutput('') }}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Use Output as Input
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-4">Smart Decode</h3>
        <p className="text-sm text-muted-foreground mb-3">Automatically detect and decode the input format</p>
        <Button
          variant="outline"
          onClick={() => {
            const s = input.trim()
            if (!s) {
              setOutput('')
              return
            }
            try {
              const v = atob(s)
              if (v && v !== s) {
                setOutput(v)
                return
              }
            } catch {}
            try {
              const v = decodeURIComponent(s)
              if (v && v !== s) {
                setOutput(v)
                return
              }
            } catch {}
            const compactHex = s.replace(/\s+/g, '')
            if (/^[0-9a-fA-F]+$/.test(compactHex) && compactHex.length % 2 === 0) {
              try {
                const bytes: number[] = []
                for (let i = 0; i < compactHex.length; i += 2) {
                  bytes.push(parseInt(compactHex.slice(i, i + 2), 16))
                }
                const v = new TextDecoder().decode(new Uint8Array(bytes))
                setOutput(v)
                return
              } catch {}
            }
            setOutput(s)
          }}
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Auto Decode
        </Button>
      </Card>
    </div>
  )
}

export function ComparerView() {
  const [mode, setMode] = useState<'words' | 'lines' | 'bytes'>('words')
  const [syncScroll, setSyncScroll] = useState(false)
  const exampleItem1 = `HTTP/1.1 200 OK
Content-Type: application/json

{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}`
  const exampleItem2 = `HTTP/1.1 200 OK
Content-Type: application/json

{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "admin"
  }
}`
  const [item1, setItem1] = useState(exampleItem1)
  const [item2, setItem2] = useState(exampleItem2)

  const [stats, setStats] = useState({ differences: 0, added: 0, removed: 0, changed: 0 })
  const ref1 = useRef<HTMLTextAreaElement | null>(null)
  const ref2 = useRef<HTMLTextAreaElement | null>(null)
  const diffRef1 = useRef<HTMLDivElement | null>(null)
  const diffRef2 = useRef<HTMLDivElement | null>(null)
  const [diffRows, setDiffRows] = useState<DiffRow[] | null>(null)
  const [view, setView] = useState<'edit' | 'diff'>('edit')

  useEffect(() => {
    settingsGet()
      .then((s) => {
        if (s.showExamples === false) {
          setItem1((prev) => (prev === exampleItem1 ? '' : prev))
          setItem2((prev) => (prev === exampleItem2 ? '' : prev))
        } else {
          setItem1((prev) => (prev.trim() === '' ? exampleItem1 : prev))
          setItem2((prev) => (prev.trim() === '' ? exampleItem2 : prev))
        }
      })
      .catch(() => {})
  }, [])

  const compute = () => {
    if (mode === 'bytes') {
      const a = item1.length
      const b = item2.length
      const added = Math.max(0, b - a)
      const removed = Math.max(0, a - b)
      setStats({ differences: added + removed, added, removed, changed: 0 })
      setDiffRows(null)
      setView('edit')
      return
    }

    const rows = buildLineDiff(item1, item2)
    setDiffRows(rows)
    const added = rows.filter((r) => r.kind === 'add').length
    const removed = rows.filter((r) => r.kind === 'remove').length
    const changed = rows.filter((r) => r.kind === 'change').length
    setStats({ differences: added + removed + changed, added, removed, changed })
    setView('diff')
  }

  const sync = (from: HTMLTextAreaElement, to: HTMLTextAreaElement) => {
    const denom = Math.max(1, from.scrollHeight - from.clientHeight)
    const ratio = from.scrollTop / denom
    to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight)
  }

  const syncDiv = (from: HTMLDivElement, to: HTMLDivElement) => {
    const denom = Math.max(1, from.scrollHeight - from.clientHeight)
    const ratio = from.scrollTop / denom
    to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight)
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Comparer</h1>
          <p className="text-sm text-muted-foreground">Compare requests and responses side by side</p>
        </div>
        <div className="flex gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="words">By Words</SelectItem>
              <SelectItem value="lines">By Lines</SelectItem>
              <SelectItem value="bytes">By Bytes</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={view === 'diff' ? 'default' : 'outline'} size="sm" onClick={() => setView((v) => (v === 'diff' ? 'edit' : 'diff'))}>
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            {view === 'diff' ? 'Edit' : 'Diff'}
          </Button>
          <Button
            variant={syncScroll ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSyncScroll((v) => !v)}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Scroll {syncScroll ? 'On' : 'Off'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="flex-1 flex flex-col border-r border-border">
          <div className="p-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">Item 1</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.readText().then(setItem1).catch(() => {})}
            >
              <Clipboard className="w-3 h-3 mr-1" />
              Paste
            </Button>
          </div>
          {view === 'diff' && diffRows ? (
            <div
              ref={diffRef1}
              className="flex-1 overflow-auto m-2 rounded-md border border-border bg-card"
              onScroll={(e) => {
                if (!syncScroll) return
                const other = diffRef2.current
                if (!other) return
                syncDiv(e.currentTarget, other)
              }}
            >
              <pre className="proxer-editor p-2">
                {diffRows.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'grid grid-cols-[52px_1fr] gap-2 px-2 py-0.5 rounded-sm',
                      r.kind === 'add'
                        ? 'bg-status-success/10'
                        : r.kind === 'remove'
                          ? 'bg-destructive/10'
                          : r.kind === 'change'
                            ? 'bg-yellow-500/10'
                            : ''
                    )}
                  >
                    <span className="text-muted-foreground select-none text-right">{r.left ? idx + 1 : ''}</span>
                    <span className="whitespace-pre-wrap break-all">{r.left}</span>
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <Textarea
              className="flex-1 font-mono text-xs resize-none m-2 rounded-md"
              placeholder="Paste first item here..."
              ref={ref1 as any}
              value={item1}
              onChange={(e) => setItem1(e.target.value)}
              onScroll={(e) => {
                if (!syncScroll) return
                const other = ref2.current
                if (!other) return
                sync(e.currentTarget, other)
              }}
            />
          )}
        </div>

        <div className="flex-1 flex flex-col">
          <div className="p-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">Item 2</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.readText().then(setItem2).catch(() => {})}
            >
              <Clipboard className="w-3 h-3 mr-1" />
              Paste
            </Button>
          </div>
          {view === 'diff' && diffRows ? (
            <div
              ref={diffRef2}
              className="flex-1 overflow-auto m-2 rounded-md border border-border bg-card"
              onScroll={(e) => {
                if (!syncScroll) return
                const other = diffRef1.current
                if (!other) return
                syncDiv(e.currentTarget, other)
              }}
            >
              <pre className="proxer-editor p-2">
                {diffRows.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'grid grid-cols-[52px_1fr] gap-2 px-2 py-0.5 rounded-sm',
                      r.kind === 'add'
                        ? 'bg-status-success/10'
                        : r.kind === 'remove'
                          ? 'bg-destructive/10'
                          : r.kind === 'change'
                            ? 'bg-yellow-500/10'
                            : ''
                    )}
                  >
                    <span className="text-muted-foreground select-none text-right">{r.right ? idx + 1 : ''}</span>
                    <span className="whitespace-pre-wrap break-all">{r.right}</span>
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <Textarea
              className="flex-1 font-mono text-xs resize-none m-2 rounded-md"
              placeholder="Paste second item here..."
              ref={ref2 as any}
              value={item2}
              onChange={(e) => setItem2(e.target.value)}
              onScroll={(e) => {
                if (!syncScroll) return
                const other = ref1.current
                if (!other) return
                sync(e.currentTarget, other)
              }}
            />
          )}
        </div>
      </div>

      <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">Differences: <span className="font-medium text-foreground">{stats.differences}</span></span>
          <span className="text-muted-foreground">Added: <span className="font-medium text-status-success">{stats.added}</span></span>
          <span className="text-muted-foreground">Removed: <span className="font-medium text-destructive">{stats.removed}</span></span>
          <span className="text-muted-foreground">Changed: <span className="font-medium text-yellow-600">{stats.changed}</span></span>
        </div>
        <Button size="sm" onClick={compute}>
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          Compare
        </Button>
      </div>
    </div>
  )
}

export function LoggerView() {
  const [filter, setFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])

  const reload = async () => {
    const l = await logsList(undefined, 1000, 0)
    setLogs(l)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'LogEmitted') {
        setLogs((prev) => [ev.payload.entry, ...prev].slice(0, 2000))
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
    }
  }, [])

  const filteredLogs = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return logs.filter((log) => {
      if (filter !== 'all' && log.level.toLowerCase() !== filter) return false
      if (!q) return true
      const hay = [log.timestamp, log.level, log.source, log.message].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [logs, filter, searchText])

  const levelColors = {
    INFO: 'text-status-redirect bg-status-redirect/10',
    WARNING: 'text-status-client-error bg-status-client-error/10',
    ERROR: 'text-status-server-error bg-status-server-error/10',
    DEBUG: 'text-muted-foreground bg-muted/40',
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">Logger</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter logs..."
              className="w-64 h-8 pl-8 text-sm"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const text = filteredLogs.map((l) => `${l.timestamp} [${l.level}] [${l.source}] ${l.message}`).join('\n')
              downloadsWriteText(`proxer-logs-${Date.now()}.txt`, text)
                .then((r) => uiToastSuccess('Logs exported', r.path))
                .catch(() => {})
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              logsClear()
                .then(() => setLogs([]))
                .catch(() => {})
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {filteredLogs.map((log, idx) => (
            <div
              key={`${log.id}-${log.timestamp}-${idx}`}
              className="flex items-start gap-3 py-1.5 px-2 hover:bg-muted/50 rounded text-sm font-mono"
            >
              <span className="text-muted-foreground w-16 shrink-0">{log.timestamp}</span>
              <Badge
                variant="outline"
                className={cn(
                  'w-16 justify-center text-[10px] shrink-0',
                  levelColors[(log.level as keyof typeof levelColors) ?? 'INFO'] ?? ''
                )}
              >
                {log.level}
              </Badge>
              <span className="text-muted-foreground w-20 shrink-0">[{log.source}]</span>
              <span className="flex-1">{log.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
        <span>{filteredLogs.length} log entries</span>
        <span>Last updated: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  )
}

export function ExtensionsView() {
  const [installedExts, setInstalledExts] = useState<Extension[]>([])
  const [availableExts, setAvailableExts] = useState<Extension[]>([])
  const [searchText, setSearchText] = useState('')

  const reload = async () => {
    const [installed, available] = await Promise.all([extensionsList(true), extensionsList(false)])
    setInstalledExts(installed)
    setAvailableExts(available)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'ExtensionInstalled' || ev.type === 'ExtensionEnabledChanged') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
    }
  }, [])

  const filteredAvailable = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return availableExts
    return availableExts.filter((e) =>
      [e.name, e.description, e.author, e.category].join(' ').toLowerCase().includes(q)
    )
  }, [availableExts, searchText])

  const buildExtensionReport = async () => {
    const [stats, details, findings, logs] = await Promise.all([
      dashboardStats(),
      dashboardDetails('24h'),
      scannerFindingsList(undefined, 500, 0),
      logsList(undefined, 500, 0),
    ])
    const report = {
      generatedAt: new Date().toISOString(),
      stats,
      responseCodes: details.responseCodes,
      topHosts: details.topHosts,
      activity: details.activity,
      findings,
      logs,
    }
    const result = await downloadsWriteText(`proxer-report-${Date.now()}.json`, JSON.stringify(report, null, 2))
    uiToastSuccess('Report built', result.path)
  }

  const extensionAction = (ext: Extension) => {
    if (!ext.enabled) return null
    if (ext.id === 'ext.decoder') {
      return { label: 'Open Decoder', run: () => appNavigate('decoder') }
    }
    if (ext.id === 'ext.passive-scanner') {
      return {
        label: 'Run Scan',
        run: () => {
          scannerStart(5000)
            .then(() => {
              uiToastSuccess('Passive scan started', 'Passive Scanner+ checks are enabled.')
              appNavigate('scanner')
            })
            .catch((e) => uiToastError('Could not start scan', String(e)))
        },
      }
    }
    if (ext.id === 'ext.reporter') {
      return {
        label: 'Build Report',
        run: () => buildExtensionReport().catch((e) => uiToastError('Report failed', String(e))),
      }
    }
    if (ext.id === 'ext.traffic-tags') {
      return {
        label: 'Tag Traffic',
        run: () => {
          uiToastSuccess('Traffic Tagger enabled', 'Open a request in History and use the Tags tab.')
          appNavigate('history')
        },
      }
    }
    return null
  }

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Extensions</h1>
          <p className="text-sm text-muted-foreground mt-1">Extend functionality with community plugins</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => reload().catch(() => {})}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Check Updates
          </Button>
        </div>
      </div>

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">Installed ({installedExts.length})</TabsTrigger>
          <TabsTrigger value="available">Available</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {installedExts.map((ext) => (
              <Card key={ext.id} className="p-4 bg-card border-border">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Package className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{ext.name}</h3>
                        <p className="text-xs text-muted-foreground">v{ext.version} by {ext.author}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">{ext.description}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-medium">{ext.rating}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{ext.category}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    <Switch
                      checked={ext.enabled}
                      onCheckedChange={(enabled) => {
                        extensionsSetEnabled(ext.id, enabled)
                          .then(() => reload())
                          .catch(() => {})
                      }}
                    />
                    {extensionAction(ext) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => extensionAction(ext)?.run()}
                      >
                        {extensionAction(ext)?.label}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="available" className="mt-4">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search extensions..."
                className="pl-9"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {filteredAvailable.map((ext) => (
              <Card key={ext.id} className="p-4 bg-card border-border">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{ext.name}</h3>
                        <p className="text-xs text-muted-foreground">v{ext.version} by {ext.author}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">{ext.description}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-medium">{ext.rating}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{ext.downloads} downloads</span>
                      <Badge variant="outline" className="text-[10px]">{ext.category}</Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="ml-4"
                    onClick={() => {
                      extensionsInstall(ext.id)
                        .then(() => {
                          uiToastSuccess('Extension installed', `${ext.name} is enabled.`)
                          return reload()
                        })
                        .catch((e) => uiToastError('Install failed', String(e)))
                    }}
                  >
                    Install
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function SettingsView() {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [tab, setTab] = useState('general')

  useEffect(() => {
    settingsGet()
      .then((s) => {
        setSettingsState(s)
        applyTheme(s.theme ?? 'dark-color-amoled-red')
        applyTypography(s)
        window.dispatchEvent(new CustomEvent('proxer:theme', { detail: { theme: s.theme ?? 'dark-color-amoled-red' } }))
      })
      .catch(() => {})
    appInfo().then(setInfo).catch(() => {})
    const next = localStorage.getItem('skuntir:settingsTab')
    if (next) {
      setTab(next)
      localStorage.removeItem('skuntir:settingsTab')
    }
  }, [])

  const update = (patch: Partial<Settings>) => {
    setSettingsState((prev) => (prev ? ({ ...prev, ...patch } as Settings) : prev))
    if (typeof patch.theme === 'string') {
      applyTheme(patch.theme)
      window.dispatchEvent(new CustomEvent('proxer:theme', { detail: { theme: patch.theme } }))
    }
    if (typeof patch.fontSize === 'number' || typeof patch.fontFamily === 'string') {
      applyTypography({ fontSize: patch.fontSize, fontFamily: patch.fontFamily })
      window.dispatchEvent(
        new CustomEvent('skuntir:settings-updated', {
          detail: {
            fontSize: patch.fontSize,
            fontFamily: patch.fontFamily,
          },
        })
      )
    }

    settingsSet(patch)
      .then((s) => {
        setSettingsState(s)
        applyTheme(s.theme ?? 'dark-color-amoled-red')
        applyTypography(s)
        window.dispatchEvent(new CustomEvent('proxer:theme', { detail: { theme: s.theme ?? 'dark-color-amoled-red' } }))
        window.dispatchEvent(
          new CustomEvent('skuntir:settings-updated', {
            detail: {
              fontSize: s.fontSize,
              fontFamily: s.fontFamily,
              showConnectTunnels: Boolean(s.showConnectTunnels),
              showExamples: s.showExamples !== false,
              maxHistoryItems: s.maxHistoryItems,
            },
          })
        )
      })
      .catch(() => {})
  }

  const parseTheme = (v: string | null | undefined) => {
    const raw = (v || 'dark-color-amoled-red').toString()
    const lower = raw.toLowerCase()
    const mode =
      lower === 'dark' || lower.startsWith('dark-')
        ? 'dark'
        : lower === 'light' || lower.startsWith('light-')
          ? 'light'
          : 'system'
    const tone = lower.includes('gray') || lower.includes('grey') || lower.includes('grayscale') ? 'gray' : 'color'
    const parts = lower.split('-')
    const palette = parts.length >= 3 ? parts.slice(2).join('-') : 'default'
    return { mode, tone, palette }
  }

  const buildTheme = (mode: string, tone: string, palette: string) => {
    const m = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'system'
    const t = tone === 'gray' ? 'gray' : 'color'
    const p = palette && palette !== 'default' ? palette : 'default'
    return `${m}-${t}${p === 'default' ? '' : `-${p}`}`
  }

  return (
    <div className="p-6 space-y-6 bg-background h-full overflow-auto">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure application preferences</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="scanner">Scanner</TabsTrigger>
          <TabsTrigger value="hotkeys">Hotkeys</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <div className="grid grid-cols-2 gap-6">
            <Card className="p-5 bg-card border-border">
              <h3 className="text-sm font-semibold text-foreground mb-4">Appearance</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Theme</p>
                    <p className="text-xs text-muted-foreground">Choose color scheme</p>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={parseTheme(settings?.theme).mode}
                      onValueChange={(mode) => {
                        const t = parseTheme(settings?.theme)
                        update({ theme: buildTheme(mode, t.tone, t.palette) })
                      }}
                    >
                      <SelectTrigger className="w-28 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select
                      value={parseTheme(settings?.theme).palette}
                      onValueChange={(palette) => {
                        const t = parseTheme(settings?.theme)
                        update({ theme: buildTheme(t.mode, t.tone, palette) })
                      }}
                    >
                      <SelectTrigger className="w-36 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="catppuccin">Catppuccin</SelectItem>
                        <SelectItem value="gruvbox">Gruvbox</SelectItem>
                        <SelectItem value="nord">Nord</SelectItem>
                        <SelectItem value="dracula">Dracula</SelectItem>
                        <SelectItem value="tokyo-night">Tokyo Night</SelectItem>
                        <SelectItem value="one-dark">One Dark</SelectItem>
                        <SelectItem value="solarized">Solarized</SelectItem>
                        <SelectItem value="monokai">Monokai</SelectItem>
                        <SelectItem value="github">GitHub</SelectItem>
                        <SelectItem value="ayu">Ayu</SelectItem>
                        <SelectItem value="material">Material</SelectItem>
                        <SelectItem value="rose-pine">Rosé Pine</SelectItem>
                        <SelectItem value="everforest">Everforest</SelectItem>
                        <SelectItem value="kanagawa">Kanagawa</SelectItem>
                        <SelectItem value="night-owl">Night Owl</SelectItem>
                        <SelectItem value="papercolor">PaperColor</SelectItem>
                        <SelectItem value="vesper">Vesper</SelectItem>
                        <SelectItem value="amoled-red">AMOLED Red</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select
                      value={parseTheme(settings?.theme).tone}
                      onValueChange={(tone) => {
                        const t = parseTheme(settings?.theme)
                        update({ theme: buildTheme(t.mode, tone, t.palette) })
                      }}
                    >
                      <SelectTrigger className="w-24 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="color">Color</SelectItem>
                        <SelectItem value="gray">Gray</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Font Size</p>
                    <p className="text-xs text-muted-foreground">Editor font size</p>
                  </div>
                  <Select
                    value={String(settings?.fontSize ?? 12)}
                    onValueChange={(v) => update({ fontSize: Number(v) })}
                  >
                    <SelectTrigger className="w-28 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10px</SelectItem>
                      <SelectItem value="12">12px</SelectItem>
                      <SelectItem value="14">14px</SelectItem>
                      <SelectItem value="16">16px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Font Family</p>
                    <p className="text-xs text-muted-foreground">Editor font</p>
                  </div>
                  <Select value={settings?.fontFamily ?? 'mono'} onValueChange={(v) => update({ fontFamily: v })}>
                    <SelectTrigger className="w-40 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Geist</SelectItem>
                      <SelectItem value="mono">JetBrains Mono</SelectItem>
                      <SelectItem value="fira">Fira Code</SelectItem>
                      <SelectItem value="source">Source Code Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Compact Mode</p>
                    <p className="text-xs text-muted-foreground">Reduce UI spacing</p>
                  </div>
                  <Switch checked={Boolean(settings?.compactMode)} onCheckedChange={(v) => update({ compactMode: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Show Examples</p>
                    <p className="text-xs text-muted-foreground">Show example templates in tools</p>
                  </div>
                  <Switch checked={settings?.showExamples !== false} onCheckedChange={(v) => update({ showExamples: v })} />
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-card border-border">
              <h3 className="text-sm font-semibold text-foreground mb-4">Project</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Project Name</label>
                  <Input
                    value={settings?.projectName ?? ''}
                    onChange={(e) => update({ projectName: e.target.value })}
                    className="mt-1.5 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Save Location</label>
                  <Input value="AppData/proxer" className="mt-1.5 h-9" readOnly />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-save</p>
                    <p className="text-xs text-muted-foreground">Save project automatically</p>
                  </div>
                  <Switch checked={Boolean(settings?.autoSave)} onCheckedChange={(v) => update({ autoSave: v })} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      configExport()
                        .then((json) => {
                          return downloadsWriteText(`proxer-project-${Date.now()}.json`, json)
                        })
                        .then((r) => {
                          uiToastSuccess('Project exported', r.path)
                        })
                        .catch(() => {})
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      uiPrompt({
                        title: 'Import config JSON',
                        description: 'Paste the exported JSON.',
                        multiline: true,
                        confirmText: 'Import',
                      })
                        .then((json) => {
                          if (!json) return
                          return configImport(json)
                            .then(() => settingsGet().then(setSettingsState))
                            .then(() => uiToastSuccess('Config imported'))
                        })
                        .catch(() => {})
                    }}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-card border-border">
              <h3 className="text-sm font-semibold text-foreground mb-4">Performance</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max History Items</label>
                  <Input
                    type="number"
                    value={settings?.maxHistoryItems ?? 10000}
                    onChange={(e) => update({ maxHistoryItems: Number(e.target.value) })}
                    className="mt-1.5 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max Response Size (MB)</label>
                  <Input
                    type="number"
                    value={settings?.maxResponseSizeMb ?? 10}
                    onChange={(e) => update({ maxResponseSizeMb: Number(e.target.value) })}
                    className="mt-1.5 h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max App Memory (MB)</label>
                  <Input
                    type="number"
                    min={128}
                    max={65536}
                    value={settings?.maxMemoryMb ?? 512}
                    onChange={(e) => update({ maxMemoryMb: Number(e.target.value) })}
                    className="mt-1.5 h-9"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">Caps memory-heavy history, leak, and attack-surface collection sizes.</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Hardware Acceleration</p>
                    <p className="text-xs text-muted-foreground">Use GPU for rendering</p>
                  </div>
                  <Switch
                    checked={Boolean(settings?.hardwareAcceleration)}
                    onCheckedChange={(v) => update({ hardwareAcceleration: v })}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-card border-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">Updates</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    checkForUpdates({ manual: true }).catch((e) => uiToastError('Update check failed', String(e)))
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Check
                </Button>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-update</p>
                    <p className="text-xs text-muted-foreground">Check GitHub for update notices</p>
                  </div>
                  <Switch checked={Boolean(settings?.autoUpdate)} onCheckedChange={(v) => update({ autoUpdate: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Beta Updates</p>
                    <p className="text-xs text-muted-foreground">Reserved for pre-release update notices</p>
                  </div>
                  <Switch checked={Boolean(settings?.betaUpdates)} onCheckedChange={(v) => update({ betaUpdates: v })} />
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="scanner" className="mt-4">
          <Card className="p-5 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">Scanner Defaults</h3>
            <div className="grid max-w-2xl gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Scanner Memory Budget (MB)</label>
                <Input
                  type="number"
                  min={64}
                  max={32768}
                  value={settings?.scannerMemoryMb ?? 256}
                  onChange={(e) => update({ scannerMemoryMb: Number(e.target.value) })}
                  className="mt-1.5 h-9"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Used to cap scan batches, API leak scans, and scanner result processing.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Max Scan Rows</label>
                <Input
                  type="number"
                  min={100}
                  max={250000}
                  value={settings?.scannerMaxRows ?? 5000}
                  onChange={(e) => update({ scannerMaxRows: Number(e.target.value) })}
                  className="mt-1.5 h-9"
                />
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Effective scan size is the smaller of Max Scan Rows and the memory-derived budget.
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="hotkeys" className="mt-4">
          <Card className="p-5 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-3">
              {[
                { action: 'Send to Repeater', keys: 'Ctrl+R' },
                { action: 'Send to Intruder', keys: 'Ctrl+I' },
                { action: 'Send Repeater request', keys: 'Ctrl+Enter' },
                { action: 'Forward Request', keys: 'Ctrl+F' },
                { action: 'Drop Request', keys: 'Ctrl+D' },
                { action: 'Toggle Intercept', keys: 'Ctrl+Shift+I' },
                { action: 'Focus Search', keys: 'Ctrl+K' },
                { action: 'Search', keys: 'Ctrl+Shift+F' },
                { action: 'New Repeater Tab', keys: 'Ctrl+T' },
                { action: 'Close Repeater Tab', keys: 'Ctrl+W' },
                { action: 'Save Project', keys: 'Ctrl+S' },
                { action: 'Open Project', keys: 'Ctrl+O' },
              ].map((item) => (
                <div key={item.action} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-md">
                  <span className="text-sm">{item.action}</span>
                  <Badge variant="outline" className="font-mono text-xs">{item.keys}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="about" className="mt-4">
          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center shadow-sm overflow-hidden">
                <Image src="/logo.png" alt="Proxer" width={56} height={56} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Proxer</h2>
                <p className="text-sm text-muted-foreground">Version {info?.version ?? '-'}</p>
                <p className="text-sm text-muted-foreground">Website skuntir.com</p>
                <p className="text-xs text-muted-foreground mt-1">Local interception proxy for HTTP/HTTPS security testing</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Proxer captures and analyzes HTTP/HTTPS traffic on your machine. Enable SSL Interception in Proxy Settings, export the CA certificate, and import it into your browser or OS trust store to decrypt HTTPS.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Radar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  )
}

function appNavigate(nav: string, payload?: any) {
  window.dispatchEvent(new CustomEvent('skuntir:navigate', { detail: { nav, payload } }))
}

function getMethodColor(method: string) {
  switch (method) {
    case 'GET': return 'bg-method-get/10 text-method-get border-method-get/20'
    case 'POST': return 'bg-method-post/10 text-method-post border-method-post/20'
    case 'PUT': return 'bg-method-put/10 text-method-put border-method-put/20'
    case 'PATCH': return 'bg-method-patch/10 text-method-patch border-method-patch/20'
    case 'DELETE': return 'bg-method-delete/10 text-method-delete border-method-delete/20'
    case 'OPTIONS': return 'bg-method-options/10 text-method-options border-method-options/20'
    case 'HEAD': return 'bg-method-head/10 text-method-head border-method-head/20'
    default: return 'bg-muted/40 text-muted-foreground border-border'
  }
}
