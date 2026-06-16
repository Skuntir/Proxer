'use client'

import { toast } from 'sonner'

type OverlayOpenDetail =
  | {
      id: number
      kind: 'confirm'
      title: string
      description?: string
      confirmText?: string
      cancelText?: string
      destructive?: boolean
    }
  | {
      id: number
      kind: 'prompt'
      title: string
      description?: string
      placeholder?: string
      defaultValue?: string
      confirmText?: string
      cancelText?: string
      multiline?: boolean
    }
  | {
      id: number
      kind: 'twoField'
      title: string
      description?: string
      confirmText?: string
      cancelText?: string
      a: { label: string; placeholder?: string; defaultValue?: string; multiline?: boolean }
      b: { label: string; placeholder?: string; defaultValue?: string; multiline?: boolean }
    }
  | {
      id: number
      kind: 'info'
      title: string
      description?: string
      body?: string
      okText?: string
    }
  | {
      id: number
      kind: 'update'
      currentVersion: string
      latestVersion: string
      repoUrl: string
    }

type OverlayResolvedDetail = { id: number; result: any }

let seq = 0
const pending = new Map<number, (result: any) => void>()
let listenerInstalled = false

function ensureListener() {
  if (listenerInstalled) return
  if (typeof window === 'undefined') return
  window.addEventListener('skuntir:overlay:resolved', (ev: Event) => {
    const e = ev as CustomEvent<OverlayResolvedDetail>
    const id = e.detail?.id
    if (typeof id !== 'number') return
    const res = pending.get(id)
    if (!res) return
    pending.delete(id)
    res(e.detail?.result)
  })
  listenerInstalled = true
}

function openOverlay<T = any>(detail: Omit<OverlayOpenDetail, 'id'>): Promise<T> {
  ensureListener()
  const id = (seq += 1)
  return new Promise<T>((resolve) => {
    pending.set(id, resolve as any)
    window.dispatchEvent(new CustomEvent('skuntir:overlay:open', { detail: { ...detail, id } }))
  })
}

export function uiToastSuccess(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined)
}

export function uiToastError(message: string, description?: string) {
  toast.error(message, description ? { description } : undefined)
}

export function uiConfirm(opts: {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}): Promise<boolean> {
  return openOverlay<boolean>({ kind: 'confirm', ...opts })
}

export function uiPrompt(opts: {
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  multiline?: boolean
}): Promise<string | null> {
  return openOverlay<string | null>({ kind: 'prompt', ...opts })
}

export function uiTwoField(opts: {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  a: { label: string; placeholder?: string; defaultValue?: string; multiline?: boolean }
  b: { label: string; placeholder?: string; defaultValue?: string; multiline?: boolean }
}): Promise<{ a: string; b: string } | null> {
  return openOverlay<{ a: string; b: string } | null>({ kind: 'twoField', ...opts })
}

export function uiInfo(opts: { title: string; description?: string; body?: string; okText?: string }): Promise<void> {
  return openOverlay<void>({ kind: 'info', ...opts })
}

export function uiUpdateAvailable(opts: {
  currentVersion: string
  latestVersion: string
  repoUrl: string
}): Promise<boolean> {
  return openOverlay<boolean>({ kind: 'update', ...opts })
}
