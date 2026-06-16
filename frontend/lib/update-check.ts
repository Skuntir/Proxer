'use client'

import { appInfo } from '@/lib/proxer'
import { uiToastError, uiToastSuccess, uiUpdateAvailable } from '@/lib/overlays'

const REPO_URL = 'https://github.com/Skuntir/Proxer'
const VERSION_FILE_URL = 'https://raw.githubusercontent.com/Skuntir/Proxer/main/src-tauri/Cargo.toml'
const DISMISSED_KEY = 'proxer:update-dismissed-version'

type RemoteVersion = {
  version: string
  sourceUrl: string
}

export async function checkForUpdates(options?: { manual?: boolean }) {
  try {
    const [info, remote] = await Promise.all([appInfo(), fetchRemoteVersion()])
    if (!remote) {
      if (options?.manual) uiToastError('Update check failed', 'Could not read the latest GitHub version.')
      return
    }
    if (!isNewerVersion(remote.version, info.version)) {
      if (options?.manual) uiToastSuccess('Proxer is up to date', `Current version: ${info.version}`)
      return
    }
    if (!options?.manual && localStorage.getItem(DISMISSED_KEY) === remote.version) return

    const open = await uiUpdateAvailable({
      currentVersion: info.version,
      latestVersion: remote.version,
      repoUrl: REPO_URL,
    })

    if (open) {
      window.open(REPO_URL, '_blank', 'noopener,noreferrer')
    } else if (!options?.manual) {
      localStorage.setItem(DISMISSED_KEY, remote.version)
    }
  } catch (e) {
    if (options?.manual) uiToastError('Update check failed', String(e))
  }
}

async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  const res = await fetch(`${VERSION_FILE_URL}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'text/plain' },
  })
  if (!res.ok) return null

  const text = await res.text()
  const match = text.match(/(?:^|\s)version\s*=\s*["']([^"']+)["']/m)
  if (!match?.[1]) return null

  return {
    version: normalizeVersion(match[1]),
    sourceUrl: VERSION_FILE_URL,
  }
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, '')
}

export function isNewerVersion(remote: string, current: string) {
  const a = normalizeVersion(remote).split(/[.-]/).map(versionPart)
  const b = normalizeVersion(current).split(/[.-]/).map(versionPart)
  const len = Math.max(a.length, b.length)

  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }

  return false
}

function versionPart(part: string) {
  const parsed = Number.parseInt(part, 10)
  return Number.isFinite(parsed) ? parsed : 0
}
