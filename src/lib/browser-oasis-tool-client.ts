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

function stripHtmlForToolMessage(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function readOasisToolJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      return await response.json() as Record<string, unknown>
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Oasis tool returned malformed JSON.',
        data: {
          code: 'oasis_tool_malformed_json',
          status: response.status,
          contentType,
        },
      }
    }
  }

  const rawText = await response.text().catch(() => '')
  const text = stripHtmlForToolMessage(rawText).slice(0, 280)
  return {
    ok: false,
    error: `Oasis tool returned ${response.status} ${response.statusText || 'non-JSON response'}${text ? `: ${text}` : '.'}`,
    data: {
      code: 'oasis_tool_non_json_response',
      status: response.status,
      contentType,
    },
  }
}
