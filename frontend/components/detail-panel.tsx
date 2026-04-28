'use client'

import { HttpRequest } from '@/lib/proxer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Copy, Check, X, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface DetailPanelProps {
  request: HttpRequest | null
  onClose: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 mr-1 text-status-success" />
          <span className="text-xs">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1" />
          <span className="text-xs">Copy</span>
        </>
      )}
    </Button>
  )
}

function CodeBlock({ content, title, className }: { content: string; title?: string; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border overflow-hidden flex flex-col min-h-0", className)}>
      {title && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <CopyButton text={content} />
        </div>
      )}
      <pre className="proxer-editor whitespace-pre-wrap break-all p-3 bg-card overflow-auto flex-1 min-h-0 text-foreground">
        {content || <span className="text-muted-foreground italic">No content</span>}
      </pre>
    </div>
  )
}

function HeadersTable({ headers, title }: { headers: Record<string, string>; title: string }) {
  const entries = Object.entries(headers)

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border p-4">
        <span className="text-muted-foreground text-sm italic">No {title.toLowerCase()}</span>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Badge variant="secondary" className="text-xs">{entries.length} headers</Badge>
      </div>
      <div className="divide-y divide-border">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[200px_1fr] text-xs group hover:bg-muted/30 transition-colors"
          >
            <div className="font-mono text-foreground font-medium px-3 py-2 bg-muted/20 border-r border-border">
              {key}
            </div>
            <div className="font-mono text-foreground/80 px-3 py-2 break-all flex items-start justify-between gap-2">
              <span className="flex-1">{value}</span>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <CopyButton text={value} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CookiesTable({ cookies }: { cookies: HttpRequest['cookies'] }) {
  if (cookies.length === 0) {
    return (
      <div className="rounded-md border border-border p-4">
        <span className="text-muted-foreground text-sm italic">No cookies</span>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">Cookies</span>
        <Badge variant="secondary" className="text-xs">{cookies.length} cookies</Badge>
      </div>
      <div className="divide-y divide-border">
        {cookies.map((cookie, index) => (
          <div
            key={index}
            className="px-3 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-foreground font-medium">{cookie.name}</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-mono text-sm text-foreground/80 truncate">{cookie.value}</span>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Domain: <span className="text-foreground/70">{cookie.domain}</span></span>
              <span>Path: <span className="text-foreground/70">{cookie.path}</span></span>
              {cookie.secure && <Badge variant="outline" className="text-xs py-0">Secure</Badge>}
              {cookie.httpOnly && <Badge variant="outline" className="text-xs py-0">HttpOnly</Badge>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getMethodColor(method: string) {
  switch (method) {
    case 'GET':
      return 'bg-method-get/10 text-method-get border-method-get/20'
    case 'POST':
      return 'bg-method-post/10 text-method-post border-method-post/20'
    case 'PUT':
      return 'bg-method-put/10 text-method-put border-method-put/20'
    case 'PATCH':
      return 'bg-method-patch/10 text-method-patch border-method-patch/20'
    case 'DELETE':
      return 'bg-method-delete/10 text-method-delete border-method-delete/20'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function getStatusColor(status: number) {
  if (status >= 200 && status < 300) {
    return 'text-status-success'
  } else if (status >= 400) {
    return 'text-status-server-error'
  }
  return 'text-foreground'
}

export function DetailPanel({ request, onClose }: DetailPanelProps) {
  if (!request) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground bg-card border-t border-border">
        <div className="text-center">
          <p className="text-sm font-medium">No request selected</p>
          <p className="text-xs mt-1">Click on a request above to view its details</p>
        </div>
      </div>
    )
  }

  const rawRequest = `${request.method} ${request.path} HTTP/1.1
Host: ${request.host}
${Object.entries(request.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
${request.body ? `\n${request.body}` : ''}`

  const rawResponse = `HTTP/1.1 ${request.statusCode} ${request.statusCode === 200 ? 'OK' : request.statusCode === 201 ? 'Created' : request.statusCode === 404 ? 'Not Found' : 'Error'}
${Object.entries(request.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
${request.responseBody ? `\n${request.responseBody}` : ''}`

  return (
    <div className="flex flex-col h-full bg-card border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <Badge 
            variant="outline" 
            className={cn(
              'font-mono text-xs font-semibold px-2 py-0.5',
              getMethodColor(request.method)
            )}
          >
            {request.method}
          </Badge>
          <span className="text-sm font-mono text-muted-foreground">{request.host}</span>
          <span className="text-sm font-mono text-foreground font-medium truncate max-w-md">{request.path}</span>
          <Badge 
            variant="secondary" 
            className={cn('font-mono text-xs', getStatusColor(request.statusCode))}
          >
            {request.statusCode}
          </Badge>
          <span className="text-xs text-muted-foreground">{request.time}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs content */}
      <Tabs defaultValue="headers" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 pt-2 pb-2 border-b border-border bg-card">
          <TabsList className="h-9 bg-muted/50 p-1">
            <TabsTrigger value="headers" className="text-xs px-3 data-[state=active]:bg-card data-[state=active]:shadow-sm">Headers</TabsTrigger>
            <TabsTrigger value="body" className="text-xs px-3 data-[state=active]:bg-card data-[state=active]:shadow-sm">Body</TabsTrigger>
            <TabsTrigger value="raw" className="text-xs px-3 data-[state=active]:bg-card data-[state=active]:shadow-sm">Raw</TabsTrigger>
            <TabsTrigger value="cookies" className="text-xs px-3 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Cookies
              {request.cookies.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">{request.cookies.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

          <TabsContent value="headers" className="m-0 p-4 flex-1 min-h-0 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              <HeadersTable headers={request.requestHeaders} title="Request Headers" />
              <HeadersTable headers={request.headers} title="Response Headers" />
            </div>
          </TabsContent>

          <TabsContent value="body" className="m-0 p-4 flex-1 min-h-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-4 h-full min-h-0">
              <CodeBlock content={request.body} title="Request Body" />
              <CodeBlock content={request.responseBody} title="Response Body" />
            </div>
          </TabsContent>

          <TabsContent value="raw" className="m-0 p-4 flex-1 min-h-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-4 h-full min-h-0">
              <CodeBlock content={rawRequest} title="Raw Request" />
              <CodeBlock content={rawResponse} title="Raw Response" />
            </div>
          </TabsContent>

          <TabsContent value="cookies" className="m-0 p-4 flex-1 min-h-0 overflow-auto">
            <CookiesTable cookies={request.cookies} />
          </TabsContent>
      </Tabs>
    </div>
  )
}
