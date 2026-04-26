'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { 
  ShieldAlert, Crosshair, FileText, Activity, Zap, Lock, 
  ChevronRight, ChevronDown, Folder, FileCode, Globe, Play, Pause, Plus, Trash2, Download,
  AlertTriangle, Search, Filter, RefreshCw, Send, Copy,
  ArrowRightLeft, Star, Package, RotateCcw,
  Upload, Clipboard, X, ArrowUp, Edit3,
  HardDrive, Cpu, MemoryStick, Sparkles
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
import { cn } from '@/lib/utils'
import { uiInfo, uiPrompt, uiToastError, uiToastSuccess, uiTwoField } from '@/lib/overlays'
import {
  appInfo,
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
  interceptGetEnabled,
  interceptForward,
  interceptSetEnabled,
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
  tlsImportCaPem,
  tlsSetMitmEnabled,
  type BackendEvent,
  type AppInfo,
  type DashboardDetails,
  type DashboardStats,
  type Extension,
  type LogEntry,
  type HttpRequest,
  type RepeaterSendResult,
  type RuleSpec,
  type ScanStatus,
  type Settings,
  type SitemapNode,
  type Vulnerability,
} from '@/lib/proxer'

const chartData = [45, 62, 78, 55, 89, 72, 95, 68, 82, 91, 76, 63, 88, 74, 69, 85, 92, 77, 64, 71, 86, 79, 93, 81]

export function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [details, setDetails] = useState<DashboardDetails | null>(null)
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [recentFindings, setRecentFindings] = useState<Vulnerability[]>([])

  const reload = async () => {
    const [ds, dd, ss, findings] = await Promise.all([
      dashboardStats(),
      dashboardDetails(),
      scannerStatus(),
      scannerFindingsList(undefined, 10, 0),
    ])
    setStats(ds)
    setDetails(dd)
    setScanStatus(ss)
    setRecentFindings(findings.slice(0, 4))
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    const onCleared = () => reload().catch(() => {})
    onBackendEvent((ev) => {
      if (ev.type === 'RequestCaptured' || ev.type === 'ResponseReceived') {
        reload().catch(() => {})
      }
      if (ev.type === 'ScanFinding' || ev.type === 'ScanProgress' || ev.type === 'ScanCompleted') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    window.addEventListener('skuntir:traffic-cleared', onCleared)
    return () => {
      unlisten?.()
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
              downloadsWriteText(`skuntir-report-${Date.now()}.json`, JSON.stringify(report, null, 2))
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
            <Select defaultValue="24h">
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
            {chartData.map((height, i) => (
              <div 
                key={i} 
                className="flex-1 bg-primary/20 hover:bg-primary/40 rounded-t transition-colors cursor-pointer"
                style={{ height: `${height}%` }}
                title={`${height} requests`}
              />
            ))}
          </div>
          <div className="flex justify-between px-4 mt-2 text-[10px] text-muted-foreground">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
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

  const reload = async () => {
    const n = await sitemapGet(2000)
    setNodes(n)
    if (n.length > 0) {
      setExpandedNodes((prev) => {
        if (prev.size > 0) return prev
        return new Set([n[0].id])
      })
    }
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
    onBackendEvent((ev) => {
      if (ev.type === 'RequestCaptured' || ev.type === 'ResponseReceived') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    window.addEventListener('skuntir:traffic-cleared', onCleared)
    return () => {
      unlisten?.()
      window.removeEventListener('skuntir:traffic-cleared', onCleared)
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

    const filterTree = (n: SitemapNode): SitemapNode | null => {
      if (wantScope && n.type === 'host') {
        const ok = inScope(n.name)
        if (wantIn ? !ok : ok) return null
      }

      if (!n.children || n.children.length === 0) {
        return matches(n) ? n : null
      }

      const children = n.children.map(filterTree).filter(Boolean) as SitemapNode[]
      if (children.length > 0) return { ...n, children }
      return matches(n) ? { ...n, children: [] } : null
    }

    return nodes.map(filterTree).filter(Boolean) as SitemapNode[]
  }, [nodes, scopeFilter, scopeRegex, textFilter])

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

export function ProxyView() {
  const [proxy, setProxy] = useState<{ running: boolean; bind?: string | null } | null>(null)
  const [mitmEnabled, setMitmEnabled] = useState(false)
  const [interceptEnabled, setInterceptEnabled] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [rules, setRules] = useState<RuleSpec[]>([])

  const reload = async () => {
    const [ps, me, ie, ds, s, r] = await Promise.all([
      proxyStatus(),
      tlsGetMitmEnabled(),
      interceptGetEnabled(),
      dashboardStats(),
      settingsGet(),
      rulesList(),
    ])
    setProxy(ps)
    setMitmEnabled(me)
    setInterceptEnabled(ie)
    setStats(ds)
    setSettingsState(s)
    setRules(r)
  }

  useEffect(() => {
    reload().catch(() => {})
    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'ProxyStatusChanged' || ev.type === 'RequestCaptured' || ev.type === 'ResponseReceived') {
        reload().catch(() => {})
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
    }
  }, [])

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
                  return downloadsWriteText(`skuntir-config-${Date.now()}.json`, json)
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
                <p className="text-xs text-muted-foreground">Routes Windows HTTP/HTTPS through Proxer</p>
              </div>
              <Switch
                checked={Boolean(settings?.systemProxyEnabled)}
                onCheckedChange={(enabled) => {
                  settingsSet({ systemProxyEnabled: enabled })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
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
                  settingsSet({ showConnectTunnels: enabled })
                    .then((s) => {
                      setSettingsState(s)
                      window.dispatchEvent(
                        new CustomEvent('skuntir:settings-updated', {
                          detail: { showConnectTunnels: Boolean(s.showConnectTunnels) },
                        })
                      )
                    })
                    .catch(() => {})
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
                  })().catch(() => {})
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
                  settingsSet({ verifyCertificates: enabled })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
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
                  interceptSetEnabled(enabled)
                    .then((v) => setInterceptEnabled(v))
                    .catch(() => {})
                }}
              />
            </div>
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Scope Rules (Regex)</p>
              <Textarea
                className="font-mono text-xs h-20"
                placeholder=".*\\.example\\.com$&#10;.*\\/api\\/.*"
                value={settings?.scopeRegex ?? '^$'}
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
                  settingsSet({ upstreamProxyEnabled: enabled })
                    .then((s) => setSettingsState(s))
                    .catch(() => {})
                }}
              />
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
                  actions: [{ type: 'SetHeader', data: { name: 'User-Agent', value: 'Skuntir' } }],
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
              downloadsWriteText(`skuntir-scan-report-${Date.now()}.json`, JSON.stringify(report, null, 2))
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
  const [templateRaw, setTemplateRaw] = useState(`POST /api/auth/login HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer §token§

{
  "email": "§email§",
  "password": "§password§"
}`)
  const [payloadText, setPayloadText] = useState(`admin@example.com
user@example.com
test@example.com
admin
root
administrator`)
  const [attackId, setAttackId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    const next = localStorage.getItem('skuntir:intruderTemplateRaw')
    if (next) {
      setTemplateRaw(next)
      localStorage.removeItem('skuntir:intruderTemplateRaw')
    }

    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'IntruderStarted') {
        setAttackId(ev.payload.attack_id)
        setRunning(true)
        setProgress(null)
      }
      if (ev.type === 'IntruderProgress') {
        setProgress({ done: ev.payload.done, total: ev.payload.total })
      }
      if (ev.type === 'IntruderCompleted') {
        setRunning(false)
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
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
                  const payloads = payloadText
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                  intruderStart({ attackType, templateRaw, payloads })
                    .then((r) => {
                      setAttackId(r.attackId)
                      setRunning(true)
                      setProgress({ done: 0, total: r.payloadCount })
                    })
                    .catch(() => {})
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
        </div>
      </div>
    </div>
  )
}

export function RepeaterView() {
  const [response, setResponse] = useState<string | null>(null)
  const [result, setResult] = useState<RepeaterSendResult | null>(null)
  const [sending, setSending] = useState(false)
  const [rawRequest, setRawRequest] = useState(`POST /api/users/1 HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Accept: application/json

{
  "name": "Updated Name",
  "email": "updated@example.com"
}`)

  useEffect(() => {
    const next = localStorage.getItem('skuntir:repeaterRaw')
    if (next) {
      setRawRequest(next)
      localStorage.removeItem('skuntir:repeaterRaw')
      setResponse(null)
      setResult(null)
    }
  }, [])

  const handleSend = async () => {
    setSending(true)
    try {
      const res = await repeaterSendRaw(rawRequest)
      setResponse(res.rawResponse)
      setResult(res)
    } catch (e) {
      setResponse(`Error sending request:\n${String(e)}`)
      setResult(null)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="text-sm font-semibold text-foreground">Repeater</div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSend} disabled={sending}>
            <Send className="w-4 h-4 mr-2" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => appNavigate('intruder', { templateRaw: rawRequest })}
          >
            <Zap className="w-4 h-4 mr-2" />
            Send to Intruder
          </Button>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="flex-1 flex flex-col border-r border-border">
          <div className="flex-1 p-2">
            <Textarea
              className="h-full font-mono text-xs resize-none"
              value={rawRequest}
              onChange={(e) => setRawRequest(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="p-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">Response</span>
            {result && (
              <div className="flex items-center gap-3 text-xs">
                <Badge 
                  variant="outline" 
                  className={cn(
                    result.statusCode >= 200 && result.statusCode < 300
                      ? 'bg-status-success/10 text-status-success border-status-success/20'
                      : result.statusCode >= 400
                        ? 'bg-status-server-error/10 text-status-server-error border-status-server-error/20'
                        : ''
                  )}
                >
                  {result.statusCode}
                </Badge>
                <span className="text-muted-foreground">Time: {formatDurationMs(result.durationMs)}</span>
                <span className="text-muted-foreground">Size: {formatBytes(result.size)}</span>
              </div>
            )}
          </div>
          <div className="flex-1 p-2">
            {response ? (
              <Textarea 
                className="h-full font-mono text-xs resize-none bg-muted/30"
                value={response}
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
        </div>
      </div>
    </div>
  )
}

export function InterceptView() {
  const [isIntercepting, setIsIntercepting] = useState(false)
  const [active, setActive] = useState<{ interceptionId: string; raw: string } | null>(null)
  const [editedRaw, setEditedRaw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false

    const init = async () => {
      try {
        const enabled = await interceptGetEnabled()
        if (!cancelled) setIsIntercepting(enabled)
      } catch {}

      unlisten = await onBackendEvent((ev: BackendEvent) => {
        if (ev.type !== 'InterceptPaused') return
        setActive({ interceptionId: ev.payload.interception_id, raw: ev.payload.raw })
        setEditedRaw(ev.payload.raw)
      })
    }

    init()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant={isIntercepting ? 'default' : 'outline'}
            size="sm"
            onClick={async () => {
              const next = !isIntercepting
              setIsIntercepting(next)
              try {
                const actual = await interceptSetEnabled(next)
                setIsIntercepting(actual)
              } catch {}
            }}
            className={isIntercepting ? 'bg-destructive hover:bg-destructive/90' : ''}
          >
            {isIntercepting ? (
              <>
                <Pause className="w-4 h-4 mr-2" />
                Intercept is ON
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Intercept is OFF
              </>
            )}
          </Button>
          {active && (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await interceptForward(active.interceptionId, editedRaw)
                    setActive(null)
                    setEditedRaw('')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <ArrowUp className="w-4 h-4 mr-2" />
                Forward
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await interceptDrop(active.interceptionId)
                    setActive(null)
                    setEditedRaw('')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Drop
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => appNavigate('repeater', { rawRequest: editedRaw })}
              >
                <Send className="w-4 h-4 mr-2" />
                Send to Repeater
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => appNavigate('intruder', { templateRaw: editedRaw })}
              >
                <Zap className="w-4 h-4 mr-2" />
                Send to Intruder
              </Button>
            </div>
          )}
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            isIntercepting ? 'bg-destructive animate-pulse' : 'bg-muted-foreground'
          )} />
          {isIntercepting ? (active ? 'Paused' : 'Waiting for request...') : 'Passthrough mode'}
        </Badge>
      </div>

      <div className="flex-1 p-4">
        {active ? (
          <Textarea 
            className="h-full font-mono text-xs resize-none"
            value={editedRaw}
            onChange={(e) => setEditedRaw(e.target.value)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No request intercepted</p>
              <p className="text-xs text-muted-foreground mt-1">
                {isIntercepting ? 'Waiting for incoming requests...' : 'Turn on intercept to capture requests'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
        <span>{active ? `Interception: ${active.interceptionId}` : 'No active interception'}</span>
        <span></span>
      </div>
    </div>
  )
}

export function DecoderView() {
  const [input, setInput] = useState('Hello, World!')
  const [output, setOutput] = useState('')
  const [operation, setOperation] = useState('base64-encode')

  const handleOperation = () => {
    switch (operation) {
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
          ].map((op) => (
            <Button
              key={op.id}
              variant={operation === op.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setOperation(op.id)
                handleOperation()
              }}
            >
              {op.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={handleOperation}>
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
  const [item1, setItem1] = useState(`HTTP/1.1 200 OK
Content-Type: application/json

{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}`)
  const [item2, setItem2] = useState(`HTTP/1.1 200 OK
Content-Type: application/json

{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "admin"
  }
}`)

  const [stats, setStats] = useState({ differences: 0, added: 0, removed: 0, changed: 0 })
  const ref1 = useRef<HTMLTextAreaElement | null>(null)
  const ref2 = useRef<HTMLTextAreaElement | null>(null)

  const compute = () => {
    if (mode === 'bytes') {
      const a = item1.length
      const b = item2.length
      const added = Math.max(0, b - a)
      const removed = Math.max(0, a - b)
      setStats({ differences: added + removed, added, removed, changed: 0 })
      return
    }

    const split = (s: string) => (mode === 'lines' ? s.split(/\r?\n/) : s.split(/\s+/)).filter(Boolean)
    const a = split(item1)
    const b = split(item2)
    const sa = new Set(a)
    const sb = new Set(b)
    const removed = a.filter((x) => !sb.has(x)).length
    const added = b.filter((x) => !sa.has(x)).length
    const changed = Math.min(added, removed)
    setStats({ differences: added + removed, added, removed, changed })
  }

  const sync = (from: HTMLTextAreaElement, to: HTMLTextAreaElement) => {
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
              downloadsWriteText(`skuntir-logs-${Date.now()}.txt`, text)
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
          {filteredLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 py-1.5 px-2 hover:bg-muted/50 rounded text-sm font-mono">
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
                        .then(() => reload())
                        .catch(() => {})
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
        applyTheme(s.theme ?? 'system')
        window.dispatchEvent(new CustomEvent('proxer:theme', { detail: { theme: s.theme ?? 'system' } }))
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
    settingsSet(patch)
      .then((s) => {
        setSettingsState(s)
        applyTheme(s.theme ?? 'system')
        window.dispatchEvent(new CustomEvent('proxer:theme', { detail: { theme: s.theme ?? 'system' } }))
      })
      .catch(() => {})
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
                  <Select
                    value={
                      settings?.theme === 'system'
                        ? 'system-color'
                        : settings?.theme === 'dark'
                          ? 'dark-color'
                          : settings?.theme === 'light'
                            ? 'light-color'
                            : settings?.theme ?? 'system-color'
                    }
                    onValueChange={(v) => update({ theme: v })}
                  >
                    <SelectTrigger className="w-44 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system-color">System (Color)</SelectItem>
                      <SelectItem value="system-gray">System (Grayscale)</SelectItem>
                      <SelectItem value="light-color">Light (Color)</SelectItem>
                      <SelectItem value="light-gray">Light (Grayscale)</SelectItem>
                      <SelectItem value="dark-color">Dark (Color)</SelectItem>
                      <SelectItem value="dark-gray">Dark (Grayscale)</SelectItem>
                    </SelectContent>
                  </Select>
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
                    <SelectTrigger className="w-28 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
                  <Input value="AppData/skuntir" className="mt-1.5 h-9" readOnly />
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
                          return downloadsWriteText(`skuntir-project-${Date.now()}.json`, json)
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
              <h3 className="text-sm font-semibold text-foreground mb-4">Updates</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-update</p>
                    <p className="text-xs text-muted-foreground">Download updates automatically</p>
                  </div>
                  <Switch checked={Boolean(settings?.autoUpdate)} onCheckedChange={(v) => update({ autoUpdate: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Beta Updates</p>
                    <p className="text-xs text-muted-foreground">Receive pre-release versions</p>
                  </div>
                  <Switch checked={Boolean(settings?.betaUpdates)} onCheckedChange={(v) => update({ betaUpdates: v })} />
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="scanner" className="mt-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">Scanner Defaults</h3>
            <p className="text-sm text-muted-foreground">Configure scanner settings in the Scanner tab.</p>
          </Card>
        </TabsContent>

        <TabsContent value="hotkeys" className="mt-4">
          <Card className="p-5 bg-card border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-3">
              {[
                { action: 'Send to Repeater', keys: 'Ctrl+R' },
                { action: 'Send to Intruder', keys: 'Ctrl+I' },
                { action: 'Forward Request', keys: 'Ctrl+F' },
                { action: 'Drop Request', keys: 'Ctrl+D' },
                { action: 'Toggle Intercept', keys: 'Ctrl+Shift+I' },
                { action: 'Search', keys: 'Ctrl+Shift+F' },
                { action: 'New Tab', keys: 'Ctrl+T' },
                { action: 'Close Tab', keys: 'Ctrl+W' },
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
                <Image src="/logo.png" alt="Skuntir" width={56} height={56} />
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
