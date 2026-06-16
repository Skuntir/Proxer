export type ThemeSetting =
  | 'system'
  | 'system-color'
  | 'system-gray'
  | 'light'
  | 'light-color'
  | 'light-gray'
  | 'dark'
  | 'dark-color'
  | 'dark-gray'
  | string

export function applyTheme(setting: ThemeSetting) {
  const root = document.documentElement
  const s = (setting || 'dark-color-amoled-red') as string

  const toTone = (v: string) => {
    if (v.includes('gray') || v.includes('grey') || v.includes('grayscale')) return 'gray'
    return 'color'
  }

  const toMode = (v: string) => {
    if (v === 'dark' || v.startsWith('dark-')) return 'dark'
    if (v === 'light' || v.startsWith('light-')) return 'light'
    if (v === 'system' || v.startsWith('system-')) return 'system'
    return 'system'
  }

  const tone = toTone(s)
  const mode = toMode(s)

  const toPalette = (v: string) => {
    const lower = v.toLowerCase()
    const parts = lower.split('-')
    if (parts.length >= 3) {
      const p = parts.slice(2).join('-')
      if (p) return p
    }

    const known = [
      'catppuccin',
      'gruvbox',
      'nord',
      'dracula',
      'tokyo-night',
      'one-dark',
      'solarized',
      'monokai',
      'github',
      'ayu',
      'material',
      'rose-pine',
      'everforest',
      'kanagawa',
      'night-owl',
      'papercolor',
      'vesper',
      'amoled-red',
    ]
    for (const k of known) {
      if (lower.includes(k)) return k
    }
    return 'default'
  }

  const prefersDark = () => {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    } catch {
      return false
    }
  }

  const dark = mode === 'dark' ? true : mode === 'light' ? false : prefersDark()

  for (const c of Array.from(root.classList)) {
    if (c.startsWith('palette-')) root.classList.remove(c)
  }

  root.classList.toggle('dark', dark)
  root.classList.toggle('tone-gray', tone === 'gray')

  const palette = toPalette(s)
  if (palette !== 'default') root.classList.add(`palette-${palette}`)
}

export function onSystemThemeChange(handler: () => void): (() => void) | null {
  try {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return null
    const cb = () => handler()
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  } catch {
    return null
  }
}
