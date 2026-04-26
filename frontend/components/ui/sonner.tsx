'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'
import { useEffect, useState } from 'react'

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<ToasterProps['theme']>('system')

  useEffect(() => {
    const compute = () => {
      const dark = document.documentElement.classList.contains('dark')
      setTheme(dark ? 'dark' : 'light')
    }
    compute()
    window.addEventListener('proxer:theme', compute as EventListener)
    return () => window.removeEventListener('proxer:theme', compute as EventListener)
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
