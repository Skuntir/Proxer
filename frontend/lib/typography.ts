import type { Settings } from '@/lib/proxer'

export function applyTypography(settings: Partial<Pick<Settings, 'fontSize' | 'fontFamily'>>) {
  const root = document.documentElement

  const size = typeof settings.fontSize === 'number' && Number.isFinite(settings.fontSize) ? settings.fontSize : 12
  root.style.setProperty('--editor-font-size', `${Math.max(8, Math.min(32, Math.round(size)))}px`)

  const family = (settings.fontFamily || 'mono').toString().toLowerCase()
  if (family === 'fira') {
    root.style.setProperty('--font-sans', 'var(--font-fira-code)')
    root.style.setProperty('--font-mono', 'var(--font-fira-code)')
  } else if (family === 'source') {
    root.style.setProperty('--font-sans', 'var(--font-source-code-pro)')
    root.style.setProperty('--font-mono', 'var(--font-source-code-pro)')
  } else if (family === 'mono') {
    root.style.setProperty('--font-sans', 'var(--font-jetbrains-mono)')
    root.style.setProperty('--font-mono', 'var(--font-jetbrains-mono)')
  } else {
    root.style.setProperty('--font-sans', 'var(--font-geist)')
    root.style.setProperty('--font-mono', 'var(--font-geist-mono)')
  }
}
