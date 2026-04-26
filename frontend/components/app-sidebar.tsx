'use client'

import { cn } from '@/lib/utils'
import { navItems } from '@/lib/nav-items'
import {
  LayoutDashboard,
  Server,
  History,
  ShieldAlert,
  Repeat,
  Crosshair,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Radar,
  Zap,
  Code,
  GitCompare,
  Puzzle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import Image from 'next/image'

const iconMap: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  LayoutDashboard,
  Server,
  History,
  ShieldAlert,
  Repeat,
  Crosshair,
  FileText,
  Settings,
  Radar,
  Zap,
  Code,
  GitCompare,
  Puzzle,
}

interface AppSidebarProps {
  activeItem: string
  onItemClick: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function AppSidebar({
  activeItem,
  onItemClick,
  collapsed,
  onToggleCollapse,
}: AppSidebarProps) {
  const mainNavItems = navItems.slice(0, 5)
  const toolsNavItems = navItems.slice(5, 11)
  const bottomNavItems = navItems.slice(11)

  const renderNavItem = (item: typeof navItems[0]) => {
    const Icon = iconMap[item.icon] || LayoutDashboard
    const isActive = activeItem === item.id

    const button = (
      <button
        onClick={() => onItemClick(item.id)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg transition-all duration-150',
          'hover:bg-primary/8',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-foreground/70 hover:text-foreground',
          collapsed && 'justify-center px-0'
        )}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <Badge 
                variant="secondary" 
                className="h-5 min-w-[20px] px-1.5 text-[10px] font-semibold bg-destructive/10 text-destructive border-0"
              >
                {item.badge}
              </Badge>
            )}
          </>
        )}
        {collapsed && item.badge && (
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive" />
        )}
      </button>
    )

    if (collapsed) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            <div className="relative">{button}</div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={12} className="text-xs font-medium">
            <div className="flex items-center gap-2">
              {item.label}
              {item.badge && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 bg-destructive/10 text-destructive">
                  {item.badge}
                </Badge>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )
    }

    return <div key={item.id}>{button}</div>
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'flex flex-col h-full bg-card border-r border-border transition-all duration-200',
          collapsed ? 'w-[52px]' : 'w-[220px]'
        )}
      >
        {/* Logo area */}
        <div className={cn(
          'flex items-center h-14 border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-4'
        )}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center shadow-sm overflow-hidden">
              <Image src="/logo.png" alt="Skuntir" width={32} height={32} />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold text-foreground tracking-tight">Proxer</span>
                <span className="text-[10px] text-muted-foreground font-medium">HTTP/S Proxy</span>
              </div>
            )}
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {/* Main navigation */}
          <div className="space-y-0.5">
            {!collapsed && (
              <div className="px-3 mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Main</span>
              </div>
            )}
            {mainNavItems.map(renderNavItem)}
          </div>

          {/* Tools section */}
          <div className={cn('mt-6 pt-4 border-t border-border space-y-0.5', collapsed && 'mt-4 pt-3')}>
            {!collapsed && (
              <div className="px-3 mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tools</span>
              </div>
            )}
            {toolsNavItems.map(renderNavItem)}
          </div>

          {/* Bottom section */}
          <div className={cn('mt-6 pt-4 border-t border-border space-y-0.5', collapsed && 'mt-4 pt-3')}>
            {!collapsed && (
              <div className="px-3 mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System</span>
              </div>
            )}
            {bottomNavItems.map(renderNavItem)}
          </div>
        </nav>

        {/* Collapse toggle */}
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className={cn(
              'w-full h-8 justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50',
              !collapsed && 'justify-start px-3'
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
