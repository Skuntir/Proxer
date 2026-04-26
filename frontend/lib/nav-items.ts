export type NavItem = {
  id: string
  label: string
  icon: string
  badge?: number
}

export const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'history', label: 'HTTP History', icon: 'History' },
  { id: 'target', label: 'Sitemap', icon: 'Crosshair' },
  { id: 'intercept', label: 'Intercept', icon: 'ShieldAlert' },
  { id: 'proxy', label: 'Proxy', icon: 'Server' },
  { id: 'scanner', label: 'Scanner', icon: 'Radar' },
  { id: 'intruder', label: 'Intruder', icon: 'Zap' },
  { id: 'repeater', label: 'Repeater', icon: 'Repeat' },
  { id: 'decoder', label: 'Decoder', icon: 'Code' },
  { id: 'comparer', label: 'Comparer', icon: 'GitCompare' },
  { id: 'logger', label: 'Logger', icon: 'FileText' },
  { id: 'extensions', label: 'Extensions', icon: 'Puzzle' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
]
