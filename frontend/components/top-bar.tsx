'use client'

import { useEffect, useState } from 'react'
import { Search, Circle, HelpCircle, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { onBackendEvent, proxyStatus } from '@/lib/proxer'

interface TopBarProps {
  interceptEnabled: boolean
  onInterceptToggle: (enabled: boolean) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  canClearTraffic: boolean
  onClearTraffic: () => void
}

export function TopBar({
  interceptEnabled,
  onInterceptToggle,
  searchQuery,
  onSearchChange,
  canClearTraffic,
  onClearTraffic,
}: TopBarProps) {
  const [bind, setBind] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean>(true)

  useEffect(() => {
    proxyStatus()
      .then((s) => {
        setConnected(Boolean(s.running))
        setBind(s.bind ?? null)
      })
      .catch(() => {})

    let unlisten: (() => void) | null = null
    onBackendEvent((ev) => {
      if (ev.type === 'ProxyStatusChanged') {
        setConnected(ev.payload.running)
        setBind(ev.payload.bind ?? null)
      }
    }).then((u) => (unlisten = u))
    return () => {
      unlisten?.()
    }
  }, [])

  return (
    <div className="h-14 border-b border-border bg-card flex items-center px-4 gap-4">
      {/* Search bar */}
      <div className="flex-1 max-w-lg relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search requests, hosts, or paths... (⌘K)"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9 text-sm bg-muted/30 border-border focus-visible:ring-1 focus-visible:ring-primary/50 focus-visible:bg-background"
        />
      </div>

      <div className="flex-1" />

      {/* Status indicators */}
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Circle
              className={cn(
                'w-2 h-2',
                connected ? 'fill-status-success text-status-success' : 'fill-muted-foreground text-muted-foreground'
              )}
            />
            <span className="text-xs font-medium text-foreground">{connected ? 'Connected' : 'Stopped'}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-muted-foreground font-mono">{bind ?? '127.0.0.1:8080'}</span>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Intercept toggle */}
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-muted/30">
          <span className="text-xs font-medium text-foreground">Intercept</span>
          <Switch
            checked={interceptEnabled}
            onCheckedChange={onInterceptToggle}
            className="data-[state=checked]:bg-primary h-5 w-9"
          />
          <Badge 
            variant={interceptEnabled ? "default" : "secondary"}
            className={cn(
              "text-[10px] font-semibold min-w-[32px] justify-center h-5",
              interceptEnabled ? "bg-primary text-primary-foreground" : "bg-muted"
            )}
          >
            {interceptEnabled ? 'ON' : 'OFF'}
          </Badge>
        </div>

        <div className="h-6 w-px bg-border" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={!canClearTraffic}
            title="Clear captured traffic"
            onClick={() => onClearTraffic()}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('skuntir:navigate', { detail: { nav: 'settings', payload: { tab: 'about' } } })
              )
            }}
          >
            <HelpCircle className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
