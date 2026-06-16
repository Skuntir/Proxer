'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

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

export function AppOverlays() {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<OverlayOpenDetail | null>(null)
  const [value, setValue] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  const kind = detail?.kind

  const isConfirm = kind === 'confirm'
  const isPrompt = kind === 'prompt'
  const isTwoField = kind === 'twoField'
  const isInfo = kind === 'info'
  const isUpdate = kind === 'update'

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const e = ev as CustomEvent<OverlayOpenDetail>
      if (!e.detail || typeof e.detail.id !== 'number') return
      setDetail(e.detail)
      if (e.detail.kind === 'prompt') {
        setValue(e.detail.defaultValue ?? '')
      } else if (e.detail.kind === 'twoField') {
        setA(e.detail.a.defaultValue ?? '')
        setB(e.detail.b.defaultValue ?? '')
      } else {
        setValue('')
        setA('')
        setB('')
      }
      setOpen(true)
    }
    window.addEventListener('skuntir:overlay:open', onOpen)
    return () => window.removeEventListener('skuntir:overlay:open', onOpen)
  }, [])

  const title = detail && detail.kind !== 'update' ? detail.title : ''
  const description = detail && detail.kind !== 'update' ? detail.description : undefined

  const confirmText = useMemo(() => {
    if (!detail) return 'OK'
    if (detail.kind === 'confirm') return detail.confirmText ?? 'Confirm'
    if (detail.kind === 'prompt') return detail.confirmText ?? 'OK'
    if (detail.kind === 'twoField') return detail.confirmText ?? 'OK'
    if (detail.kind === 'info') return detail.okText ?? 'OK'
    if (detail.kind === 'update') return 'Open GitHub'
    return 'OK'
  }, [detail])

  const cancelText = useMemo(() => {
    if (!detail) return 'Cancel'
    if (detail.kind === 'confirm') return detail.cancelText ?? 'Cancel'
    if (detail.kind === 'prompt') return detail.cancelText ?? 'Cancel'
    if (detail.kind === 'twoField') return detail.cancelText ?? 'Cancel'
    if (detail.kind === 'update') return 'Later'
    return 'Cancel'
  }, [detail])

  const resolve = (result: any) => {
    const id = detail?.id
    if (typeof id !== 'number') return
    window.dispatchEvent(new CustomEvent('skuntir:overlay:resolved', { detail: { id, result } }))
  }

  const close = () => {
    setOpen(false)
    setDetail(null)
    setValue('')
    setA('')
    setB('')
  }

  return (
    <>
      <AlertDialog
        open={open && isConfirm}
        onOpenChange={(next) => {
          if (!next && isConfirm) {
            resolve(false)
            close()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                resolve(false)
                close()
              }}
            >
              {cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              className={detail?.kind === 'confirm' && detail.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={() => {
                resolve(true)
                close()
              }}
            >
              {confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={open && (isPrompt || isTwoField || isInfo || isUpdate)}
        onOpenChange={(next) => {
          if (!next && (isPrompt || isTwoField)) {
            resolve(null)
            close()
          }
          if (!next && isInfo) {
            resolve(undefined)
            close()
          }
          if (!next && isUpdate) {
            resolve(false)
            close()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isUpdate ? 'Update available' : title}</DialogTitle>
            {isUpdate ? (
              <DialogDescription>
                Proxer {detail?.kind === 'update' ? detail.latestVersion : ''} is available. You are running{' '}
                {detail?.kind === 'update' ? detail.currentVersion : ''}. Update to get the latest bug fixes and stability improvements.
              </DialogDescription>
            ) : (
              description && <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>

          {detail?.kind === 'prompt' && (
            <>
              {detail.multiline ? (
                <Textarea
                  value={value}
                  placeholder={detail.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  className="font-mono text-xs min-h-40"
                  autoFocus
                />
              ) : (
                <Input
                  value={value}
                  placeholder={detail.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                />
              )}
            </>
          )}

          {detail?.kind === 'twoField' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">{detail.a.label}</div>
                {detail.a.multiline ? (
                  <Textarea
                    value={a}
                    placeholder={detail.a.placeholder}
                    onChange={(e) => setA(e.target.value)}
                    className="font-mono text-xs min-h-32"
                    autoFocus
                  />
                ) : (
                  <Input value={a} placeholder={detail.a.placeholder} onChange={(e) => setA(e.target.value)} autoFocus />
                )}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{detail.b.label}</div>
                {detail.b.multiline ? (
                  <Textarea
                    value={b}
                    placeholder={detail.b.placeholder}
                    onChange={(e) => setB(e.target.value)}
                    className="font-mono text-xs min-h-32"
                  />
                ) : (
                  <Input value={b} placeholder={detail.b.placeholder} onChange={(e) => setB(e.target.value)} />
                )}
              </div>
            </div>
          )}

          {detail?.kind === 'info' && detail.body && (
            <Textarea value={detail.body} readOnly className="font-mono text-xs min-h-56" />
          )}

          {detail?.kind === 'update' && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Current</span>
                <span className="font-mono">{detail.currentVersion}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Latest</span>
                <span className="font-mono font-semibold text-foreground">{detail.latestVersion}</span>
              </div>
              <div className="mt-3 truncate border-t border-border pt-3 font-mono text-xs text-muted-foreground">
                {detail.repoUrl}
              </div>
            </div>
          )}

          <DialogFooter>
            {(isPrompt || isTwoField || isUpdate) && (
              <Button
                variant="outline"
                onClick={() => {
                  resolve(isUpdate ? false : null)
                  close()
                }}
              >
                {cancelText}
              </Button>
            )}
            <Button
              onClick={() => {
                if (detail?.kind === 'prompt') {
                  resolve(value)
                } else if (detail?.kind === 'twoField') {
                  resolve({ a, b })
                } else if (detail?.kind === 'update') {
                  resolve(true)
                } else {
                  resolve(undefined)
                }
                close()
              }}
            >
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
