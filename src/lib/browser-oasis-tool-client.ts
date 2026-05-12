'use client'

import { useOasisStore } from '@/store/oasisStore'

type OasisToolArgs = Record<string, unknown>

type BrowserOasisToolOptions = {
  worldId?: string | null
}

function currentBrowserWorldId(explicitWorldId?: string | null): string {
  if (typeof explicitWorldId === 'string' && explicitWorldId.trim()) {
    return explicitWorldId.trim()
  }
  return useOasisStore.getState().activeWorldId || ''
}

export function withBrowserWorldId(args: OasisToolArgs = {}, explicitWorldId?: string | null): OasisToolArgs {
  const worldId = currentBrowserWorldId(explicitWorldId)
  if (!worldId || typeof args.worldId === 'string' && args.worldId.trim()) {
    return { ...args }
  }
  return { ...args, worldId }
}

export function fetchOasisToolFromBrowser(
  tool: string,
  args: OasisToolArgs = {},
  options: BrowserOasisToolOptions = {},
): Promise<Response> {
  const worldId = currentBrowserWorldId(options.worldId)
  const toolArgs = withBrowserWorldId(args, worldId)
  const url = worldId
    ? `/api/oasis-tools?worldId=${encodeURIComponent(worldId)}`
    : '/api/oasis-tools'

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool,
      args: toolArgs,
    }),
  })
}
