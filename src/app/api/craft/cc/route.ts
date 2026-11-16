// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/craft/cc — craft through the owner's Claude Code login (lib/craft-claude-code.ts)
// /api/craft/stream does the same when the picker is on a Claude Code model; this route stays for callers that
// ask for Claude Code explicitly. Local only. Body: { prompt, model: 'cc-opus-5-5' | 'cc-fable-5-2' }.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { claudeCodeCraftModel } from '../../../../lib/craft-models'
import { claudeCodeCraftResponse } from '../../../../lib/craft-claude-code'
import { guardAgentRoute } from '@/lib/local-request-guard'

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    const { prompt, model } = await request.json()
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) return json({ error: 'Prompt is required' }, 400)
    if (prompt.length > 2000) return json({ error: 'Prompt too long' }, 400)
    const cliModel = claudeCodeCraftModel(model)
    if (!cliModel) return json({ error: `Not a Claude Code craft model: ${model}` }, 400)
    return claudeCodeCraftResponse(prompt, cliModel, request.signal)
  } catch (err) {
    console.error('[Craft:CC] Unexpected error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
}
