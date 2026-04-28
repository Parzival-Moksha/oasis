import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  listCodexSessionFileSummaries,
  parseCodexSessionFile,
  parseCodexSessionFileDetail,
  readCodexSessionFileDetail,
} from '@/lib/codex-session-files'

const tempRoots: string[] = []

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'codex-session-files-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('codex-session-files', () => {
  it('parses Codex JSONL session metadata and the last assistant message', async () => {
    const root = await makeTempRoot()
    const filePath = join(root, 'rollout-test.jsonl')
    await writeFile(filePath, [
      JSON.stringify({
        timestamp: '2026-04-27T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-1',
          timestamp: '2026-04-27T01:00:00.000Z',
          cwd: 'C:\\af_oasis',
          originator: 'codex_exec',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:00.500Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n<cwd>C:\\af_oasis</cwd>\n</environment_context>' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<oasis-codex-context>\nUser request:\nAdd session picker' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Implemented the session picker.' }],
        },
      }),
    ].join('\n'))

    const summary = await parseCodexSessionFile(filePath)

    expect(summary?.sessionId).toBe('session-1')
    expect(summary?.cwd).toBe('C:\\af_oasis')
    expect(summary?.title).toBe('Add session picker')
    expect(summary?.lastMessage).toBe('Implemented the session picker.')
    expect(summary?.lastMessageRole).toBe('assistant')
    expect(summary?.lastMessageLine).toBe(4)
  })

  it('lists only sessions for the requested cwd', async () => {
    const root = await makeTempRoot()
    await writeFile(join(root, 'one.jsonl'), `${JSON.stringify({
      timestamp: '2026-04-27T01:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'session-1', cwd: 'C:\\af_oasis' },
    })}\n`)
    await writeFile(join(root, 'two.jsonl'), `${JSON.stringify({
      timestamp: '2026-04-27T01:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'session-2', cwd: 'C:\\other' },
    })}\n`)

    const summaries = await listCodexSessionFileSummaries({ root, cwd: 'C:\\af_oasis', limit: 10 })

    expect(summaries.map(summary => summary.sessionId)).toEqual(['session-1'])
  })

  it('loads a file-backed transcript detail for Codex window hydration', async () => {
    const root = await makeTempRoot()
    const filePath = join(root, 'rollout-test.jsonl')
    await writeFile(filePath, [
      JSON.stringify({
        timestamp: '2026-04-27T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-1',
          timestamp: '2026-04-27T01:00:00.000Z',
          cwd: 'C:\\af_oasis',
          originator: 'codex_exec',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<oasis-codex-context>\nUser request:\nLoad this session' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'call-1',
          arguments: JSON.stringify({ command: 'pnpm tsc --noEmit' }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'Exit code: 0\nOutput:\nTypecheck passed',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:03.500Z',
        type: 'event_msg',
        payload: {
          type: 'error',
          message: 'stream disconnected before completion',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-27T01:00:04.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Loaded the session transcript.' }],
        },
      }),
    ].join('\n'))

    const detail = await parseCodexSessionFileDetail(filePath)

    expect(detail?.turns).toHaveLength(1)
    expect(detail?.turns[0].userPrompt).toBe('Load this session')
    expect(detail?.turns[0].blocks.map(block => block.kind)).toEqual(['tool', 'tool_result', 'error', 'text'])
    expect(detail?.turns[0].blocks[0].toolInput).toEqual({ command: 'pnpm tsc --noEmit' })
    expect(detail?.turns[0].blocks[2].content).toBe('stream disconnected before completion')
    expect(detail?.turns[0].blocks[3].content).toBe('Loaded the session transcript.')

    const found = await readCodexSessionFileDetail({ root, cwd: 'C:\\af_oasis', sessionId: 'session-1' })
    expect(found?.turns[0].userPrompt).toBe('Load this session')
  })
})
