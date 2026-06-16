'use client'

import { useEffect, useRef } from 'react'
import { clientLog } from '@/lib/proxer'

function errorMessage(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function RuntimeLogger() {
  const lastStallLogRef = useRef(0)

  useEffect(() => {
    const log = (level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG', source: string, message: string) => {
      clientLog(level, source, message).catch(() => {})
    }

    const onError = (event: ErrorEvent) => {
      log('ERROR', 'frontend', `Unhandled error: ${event.message}${event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : ''}`)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      log('ERROR', 'frontend', `Unhandled promise rejection: ${errorMessage(event.reason)}`)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    let lastTick = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now()
      const drift = now - lastTick - 1000
      lastTick = now
      const sinceLastLog = now - lastStallLogRef.current
      if (drift > 1500 && sinceLastLog > 10000) {
        lastStallLogRef.current = now
        log('WARNING', 'frontend', `UI thread stalled for ${Math.round(drift)}ms`)
      }
    }, 1000)

    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        const longest = list.getEntries().reduce((max, entry) => Math.max(max, entry.duration), 0)
        if (longest > 250) {
          log('WARNING', 'frontend', `Long UI task detected: ${Math.round(longest)}ms`)
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {}

    log('INFO', 'frontend', 'Runtime logger attached')

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.clearInterval(interval)
      observer?.disconnect()
    }
  }, [])

  return null
}
