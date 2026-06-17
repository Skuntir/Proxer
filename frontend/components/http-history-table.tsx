'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { HttpRequest } from '@/lib/proxer'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { Lock, Unlock } from 'lucide-react'

interface HttpHistoryTableProps {
  requests: HttpRequest[]
  selectedRequest: HttpRequest | null
  onSelectRequest: (request: HttpRequest) => void
}

function getMethodColor(method: string) {
  switch (method) {
    case 'GET':
      return 'bg-method-get/15 text-method-get border-method-get/30 hover:bg-method-get/25'
    case 'POST':
      return 'bg-method-post/15 text-method-post border-method-post/30 hover:bg-method-post/25'
    case 'PUT':
      return 'bg-method-put/15 text-method-put border-method-put/30 hover:bg-method-put/25'
    case 'PATCH':
      return 'bg-method-patch/15 text-method-patch border-method-patch/30 hover:bg-method-patch/25'
    case 'DELETE':
      return 'bg-method-delete/15 text-method-delete border-method-delete/30 hover:bg-method-delete/25'
    case 'OPTIONS':
      return 'bg-method-options/15 text-method-options border-method-options/30 hover:bg-method-options/25'
    case 'HEAD':
      return 'bg-method-head/15 text-method-head border-method-head/30 hover:bg-method-head/25'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function getStatusColor(status: number) {
  if (status >= 200 && status < 300) {
    return 'text-status-success bg-status-success/10'
  } else if (status >= 300 && status < 400) {
    return 'text-status-redirect bg-status-redirect/10'
  } else if (status >= 400 && status < 500) {
    return 'text-status-client-error bg-status-client-error/10'
  } else if (status >= 500) {
    return 'text-status-server-error bg-status-server-error/10'
  }
  return 'text-muted-foreground'
}

function rawFromRequest(request: HttpRequest) {
  const headers = Object.keys(request.requestHeaders).length ? request.requestHeaders : { Host: request.host }
  return `${request.method} ${request.url || request.path} HTTP/1.1
${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')}
${request.body ? `\n${request.body}` : ''}`
}

function navigate(nav: string, payload?: unknown) {
  window.dispatchEvent(new CustomEvent('skuntir:navigate', { detail: { nav, payload } }))
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {})
}

const HistoryRow = memo(function HistoryRow({
  request,
  index,
  isSelected,
  onSelect,
}: {
  request: HttpRequest
  index: number
  isSelected: boolean
  onSelect: (r: HttpRequest) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => onSelect(request)}
          onContextMenu={() => onSelect(request)}
          className={cn(
            'w-full grid grid-cols-[40px_70px_32px_1fr_70px_60px_60px] gap-2 px-4 py-2.5 text-sm transition-colors text-left border-b border-border/50',
            'hover:bg-muted/50',
            isSelected && 'bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary'
          )}
        >
          <div className="text-muted-foreground font-mono text-xs tabular-nums">{index + 1}</div>
          <div>
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-[10px] font-bold px-1.5 py-0 transition-colors',
                getMethodColor(request.method)
              )}
            >
              {request.method}
            </Badge>
          </div>
          <div className="flex items-center justify-center">
            {request.protocol === 'HTTPS' ? (
              <Lock className="w-3 h-3 text-emerald-500" />
            ) : (
              <Unlock className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
          <div className="truncate font-mono text-xs flex items-center gap-1" title={request.url}>
            <span className="text-muted-foreground">{request.host}</span>
            <span className="text-foreground font-medium">{request.path}</span>
          </div>
          <div className="flex justify-center">
            <span className={cn(
              'font-mono font-semibold text-xs px-1.5 py-0.5 rounded',
              getStatusColor(request.statusCode)
            )}>
              {request.statusCode || '—'}
            </span>
          </div>
          <div className="text-right text-muted-foreground font-mono text-xs tabular-nums">
            {request.time}
          </div>
          <div className="text-right text-muted-foreground font-mono text-xs tabular-nums">
            {request.size}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onSelect(request)}>Open details</ContextMenuItem>
        <ContextMenuItem onClick={() => navigate('repeater', { rawRequest: rawFromRequest(request) })}>
          Send to Repeater
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate('intruder', { templateRaw: rawFromRequest(request) })}>
          Send to Intruder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => copyText(request.url)}>Copy URL</ContextMenuItem>
        <ContextMenuItem onClick={() => copyText(rawFromRequest(request))}>Copy raw request</ContextMenuItem>
        <ContextMenuItem onClick={() => copyText(request.responseBody || '')} disabled={!request.responseBody}>
          Copy response body
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

export function HttpHistoryTable({
  requests,
  selectedRequest,
  onSelectRequest,
}: HttpHistoryTableProps) {
  const rowHeight = 41
  const overscan = 12
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const totalHeight = requests.length * rowHeight
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan)
  const visibleCount = Math.ceil((viewport.height || 600) / rowHeight) + overscan * 2
  const end = Math.min(requests.length, start + visibleCount)
  const visibleRequests = requests.slice(start, end)
  const statusCounts = useMemo(() => {
    let success2xx = 0, client4xx = 0, server5xx = 0
    for (const r of requests) {
      const s = r.statusCode
      if (s >= 200 && s < 300) success2xx++
      else if (s >= 400 && s < 500) client4xx++
      else if (s >= 500) server5xx++
    }
    return { success2xx, client4xx, server5xx }
  }, [requests])

  const updateViewport = () => {
    const el = scrollRef.current
    if (!el) return
    setViewport({ top: el.scrollTop, height: el.clientHeight })
  }

  const scheduleViewportUpdate = () => {
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateViewport()
    })
  }

  useEffect(() => {
    updateViewport()
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [requests.length])

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Table header */}
      <div className="grid grid-cols-[40px_70px_32px_1fr_70px_60px_60px] gap-2 px-4 py-2 border-b border-border bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <div>#</div>
        <div>Method</div>
        <div></div>
        <div>URL</div>
        <div className="text-center">Status</div>
        <div className="text-right">Time</div>
        <div className="text-right">Size</div>
      </div>

      {/* Table body */}
      <div ref={scrollRef} onScroll={scheduleViewportUpdate} className="fast-scroll flex-1 min-h-0 overflow-auto" onMouseEnter={updateViewport}>
        <div style={{ height: requests.length === 0 ? undefined : totalHeight, position: 'relative' }}>
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <Unlock className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium">No requests captured</p>
              <p className="text-xs mt-1">Configure your browser to use the proxy and start browsing</p>
            </div>
          ) : (
            <div style={{ transform: `translateY(${start * rowHeight}px)` }}>
              {visibleRequests.map((request, localIndex) => (
                <HistoryRow
                  key={request.id}
                  request={request}
                  index={start + localIndex}
                  isSelected={selectedRequest?.id === request.id}
                  onSelect={onSelectRequest}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer with stats */}
      <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
        <span>{requests.length} requests</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-success" />
            2xx: {statusCounts.success2xx}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-client-error" />
            4xx: {statusCounts.client4xx}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-server-error" />
            5xx: {statusCounts.server5xx}
          </span>
        </div>
      </div>
    </div>
  )
}
