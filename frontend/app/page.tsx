'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { TopBar } from '@/components/top-bar'
import { HttpHistoryTable } from '@/components/http-history-table'
import { DetailPanel } from '@/components/detail-panel'
import { AppOverlays } from '@/components/app-overlays'
import {
  HttpRequest,
  formatBytes,
  formatDurationMs,
  interceptGetEnabled,
  interceptSetEnabled,
  onBackendEvent,
  settingsGet,
  trafficClear,
  uiHistoryGet,
  uiHistoryList,
} from '@/lib/proxer'
import { uiConfirm, uiToastSuccess } from '@/lib/overlays'
import { applyTheme, onSystemThemeChange } from '@/lib/theme'
import {
  DashboardView,
  TargetView,
  ProxyView,
  InterceptView,
  ScannerView,
  IntruderView,
  RepeaterView,
  DecoderView,
  ComparerView,
  LoggerView,
  ExtensionsView,
  SettingsView,
} from '@/components/workspace-views'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'

export default function ProxyApp() {
  const [activeNav, setActiveNav] = useState('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [interceptEnabled, setInterceptEnabled] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRequest, setSelectedRequest] = useState<HttpRequest | null>(null)
  const [requests, setRequests] = useState<HttpRequest[]>([])
  const [showConnectTunnels, setShowConnectTunnels] = useState<boolean>(false)
  const themeSettingRef = useRef<string>('system')

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    let unlistenSystem: (() => void) | null = null
    const onThemeEvent = (ev: Event) => {
      const e = ev as CustomEvent
      const next = (e.detail?.theme as string | undefined) ?? 'system'
      themeSettingRef.current = next
      applyTheme(next)
    }

    const init = async () => {
      try {
        const enabled = await interceptGetEnabled()
        if (!cancelled) setInterceptEnabled(enabled)
      } catch {}

      try {
        const s = await settingsGet()
        themeSettingRef.current = s.theme ?? 'system'
        applyTheme(themeSettingRef.current)
        setShowConnectTunnels(Boolean(s.showConnectTunnels))
      } catch {}

      try {
        const initial = await uiHistoryList(500, 0)
        if (!cancelled) setRequests(initial)
      } catch {
        if (!cancelled) setRequests([])
      }

      unlisten = await onBackendEvent((ev) => {
        if (ev.type === 'RequestCaptured') {
          setRequests((prev) => {
            if (prev.some((r) => r.id === ev.payload.id)) return prev
            let url: URL | null = null
            try {
              url = new URL(ev.payload.url)
            } catch {
              url = null
            }
            const protocol = ev.payload.scheme === 'https' ? 'HTTPS' : 'HTTP'
            return [
              {
                id: ev.payload.id,
                method: ev.payload.method,
                url: ev.payload.url,
                host: ev.payload.host,
                path: url ? `${url.pathname}${url.search}` : '/',
                statusCode: 0,
                time: '-',
                size: '-',
                contentType: '',
                headers: {},
                requestHeaders: {},
                body: '',
                responseBody: '',
                cookies: [],
                timestamp: new Date(ev.payload.ts_ms).toISOString(),
                protocol,
                port: url?.port ? Number(url.port) : protocol === 'HTTPS' ? 443 : 80,
              },
              ...prev,
            ]
          })
        }

        if (ev.type === 'ResponseReceived') {
          setRequests((prev) =>
            prev.map((r) =>
              r.id === ev.payload.id
                ? {
                    ...r,
                    statusCode: ev.payload.status,
                    time: formatDurationMs(ev.payload.elapsed_ms),
                    size: formatBytes(ev.payload.response_bytes),
                  }
                : r
            )
          )
        }
      })
    }

    init()

    unlistenSystem = onSystemThemeChange(() => {
      const t = themeSettingRef.current || 'system'
      if (t === 'system' || t.startsWith('system-')) {
        applyTheme(t)
      }
    })

    const onSettingsUpdated = (ev: Event) => {
      const e = ev as CustomEvent
      const detail = (e.detail || {}) as { showConnectTunnels?: boolean }
      if (typeof detail.showConnectTunnels === 'boolean') {
        setShowConnectTunnels(detail.showConnectTunnels)
      }
    }

    window.addEventListener('proxer:theme', onThemeEvent)
    window.addEventListener('skuntir:settings-updated', onSettingsUpdated)

    return () => {
      cancelled = true
      if (unlisten) unlisten()
      unlistenSystem?.()
      window.removeEventListener('proxer:theme', onThemeEvent)
      window.removeEventListener('skuntir:settings-updated', onSettingsUpdated)
    }
  }, [])

  // Filter requests based on search query
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests
    const query = searchQuery.toLowerCase()
    return requests.filter(
      (req) =>
        req.url.toLowerCase().includes(query) ||
        req.method.toLowerCase().includes(query) ||
        req.statusCode.toString().includes(query) ||
        req.host.toLowerCase().includes(query)
    )
  }, [searchQuery, requests])

  const visibleHistoryRequests = useMemo(() => {
    if (showConnectTunnels) return filteredRequests
    return filteredRequests.filter((r) => r.method !== 'CONNECT')
  }, [filteredRequests, showConnectTunnels])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const shortcuts: Record<string, string> = {
          '1': 'dashboard',
          '2': 'history',
          '3': 'target',
          '4': 'intercept',
          '5': 'proxy',
          '6': 'scanner',
          '7': 'intruder',
          '8': 'repeater',
          '9': 'decoder',
        }
        if (shortcuts[e.key]) {
          e.preventDefault()
          setActiveNav(shortcuts[e.key])
        }
        if (e.key === 'k') {
          e.preventDefault()
          document.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
        }
      }
      if (e.key === 'Escape') {
        setSelectedRequest(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const onNav = (ev: Event) => {
      const e = ev as CustomEvent
      const detail = (e.detail || {}) as { nav?: string; payload?: any }
      if (!detail.nav) return

      if (detail.nav === 'repeater' && typeof detail.payload?.rawRequest === 'string') {
        localStorage.setItem('skuntir:repeaterRaw', detail.payload.rawRequest)
      }
      if (detail.nav === 'intruder' && typeof detail.payload?.templateRaw === 'string') {
        localStorage.setItem('skuntir:intruderTemplateRaw', detail.payload.templateRaw)
      }
      if (detail.nav === 'settings' && typeof detail.payload?.tab === 'string') {
        localStorage.setItem('skuntir:settingsTab', detail.payload.tab)
      }
      if (detail.nav === 'history' && typeof detail.payload?.selectHistoryId === 'string') {
        uiHistoryGet(detail.payload.selectHistoryId)
          .then((full) => setSelectedRequest(full))
          .catch(() => {})
      }

      setActiveNav(detail.nav)
    }

    window.addEventListener('skuntir:navigate', onNav)
    return () => window.removeEventListener('skuntir:navigate', onNav)
  }, [])

  const renderWorkspace = () => {
    switch (activeNav) {
      case 'dashboard':
        return <DashboardView />
      case 'target':
        return <TargetView />
      case 'proxy':
        return <ProxyView />
      case 'history':
        return (
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel defaultSize={selectedRequest ? 50 : 100} minSize={30}>
              <HttpHistoryTable
                requests={visibleHistoryRequests}
                selectedRequest={selectedRequest}
                onSelectRequest={async (req) => {
                  try {
                    const full = await uiHistoryGet(req.id)
                    setSelectedRequest(full)
                  } catch {
                    setSelectedRequest(req)
                  }
                }}
              />
            </ResizablePanel>
            {selectedRequest && (
              <>
                <ResizableHandle withHandle className="bg-border hover:bg-primary/20 transition-colors" />
                <ResizablePanel defaultSize={50} minSize={25}>
                  <DetailPanel
                    request={selectedRequest}
                    onClose={() => setSelectedRequest(null)}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )
      case 'intercept':
        return <InterceptView />
      case 'scanner':
        return <ScannerView />
      case 'intruder':
        return <IntruderView />
      case 'repeater':
        return <RepeaterView />
      case 'decoder':
        return <DecoderView />
      case 'comparer':
        return <ComparerView />
      case 'logger':
        return <LoggerView />
      case 'extensions':
        return <ExtensionsView />
      case 'settings':
        return <SettingsView />
      default:
        return <DashboardView />
    }
  }

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <AppSidebar
        activeItem={activeNav}
        onItemClick={setActiveNav}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
        {/* Top bar */}
        <TopBar
          interceptEnabled={interceptEnabled}
          onInterceptToggle={async (enabled) => {
            setInterceptEnabled(enabled)
            try {
              const actual = await interceptSetEnabled(enabled)
              setInterceptEnabled(actual)
            } catch {}
          }}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          canClearTraffic={requests.length > 0}
          onClearTraffic={() => {
            uiConfirm({
              title: 'Clear captured traffic?',
              description: 'This will clear History and Site Map for the current project.',
              confirmText: 'Clear',
              cancelText: 'Cancel',
              destructive: true,
            })
              .then((ok) => {
                if (!ok) return
                return trafficClear().then(() => {
                  setSelectedRequest(null)
                  setRequests([])
                  window.dispatchEvent(new CustomEvent('skuntir:traffic-cleared'))
                  uiToastSuccess('Traffic cleared')
                })
              })
              .catch(() => {})
          }}
        />

        {/* Workspace */}
        <main className="flex-1 overflow-hidden min-h-0 min-w-0">
          {renderWorkspace()}
        </main>
      </div>
      <AppOverlays />
    </div>
  )
}
