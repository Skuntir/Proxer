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
  const s = (setting || 'system') as string

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

  const prefersDark = () => {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    } catch {
      return false
    }
  }

  const dark = mode === 'dark' ? true : mode === 'light' ? false : prefersDark()

  root.classList.toggle('dark', dark)
  root.classList.toggle('tone-gray', tone === 'gray')
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

