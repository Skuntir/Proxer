'use client'

import { HttpRequest } from '@/lib/proxer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
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

export function HttpHistoryTable({
  requests,
  selectedRequest,
  onSelectRequest,
}: HttpHistoryTableProps) {
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
      <ScrollArea className="flex-1 min-h-0">
        <div>
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                <Unlock className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium">No requests captured</p>
              <p className="text-xs mt-1">Configure your browser to use the proxy and start browsing</p>
            </div>
          ) : (
            requests.map((request, index) => (
              <button
                key={request.id}
                onClick={() => onSelectRequest(request)}
                className={cn(
                  'w-full grid grid-cols-[40px_70px_32px_1fr_70px_60px_60px] gap-2 px-4 py-2.5 text-sm transition-all text-left border-b border-border/50',
                  'hover:bg-muted/50',
                  selectedRequest?.id === request.id && 'bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary'
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
                    {request.statusCode}
                  </span>
                </div>
                <div className="text-right text-muted-foreground font-mono text-xs tabular-nums">
                  {request.time}
                </div>
                <div className="text-right text-muted-foreground font-mono text-xs tabular-nums">
                  {request.size}
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer with stats */}
      <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
        <span>{requests.length} requests</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-success" />
            2xx: {requests.filter(r => r.statusCode >= 200 && r.statusCode < 300).length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-client-error" />
            4xx: {requests.filter(r => r.statusCode >= 400 && r.statusCode < 500).length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-server-error" />
            5xx: {requests.filter(r => r.statusCode >= 500).length}
          </span>
        </div>
      </div>
    </div>
  )
}
