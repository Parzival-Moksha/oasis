import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import type { SpatialWebSubmissionPayload } from '@/lib/spatial-web'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SUBMISSION_PATH = join(process.cwd(), 'data', 'spatial-web-submissions.local.jsonl')

function sanitizePayload(value: unknown): SpatialWebSubmissionPayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<SpatialWebSubmissionPayload>
  if (typeof record.formId !== 'string' || !record.formId.trim()) return null
  if (!Array.isArray(record.fields)) return null
  return {
    formId: record.formId.trim(),
    submittedAt: typeof record.submittedAt === 'string' ? record.submittedAt : new Date().toISOString(),
    fields: record.fields
      .filter(field => field && typeof field === 'object')
      .map(field => {
        const item = field as unknown as Record<string, unknown>
        return {
          id: typeof item.id === 'string' ? item.id : '',
          label: typeof item.label === 'string' ? item.label : 'Field',
          type: typeof item.type === 'string' ? item.type as SpatialWebSubmissionPayload['fields'][number]['type'] : 'text',
          value: typeof item.value === 'string'
            || typeof item.value === 'number'
            || typeof item.value === 'boolean'
            || item.value === null
            || (Array.isArray(item.value) && item.value.every(entry => typeof entry === 'string'))
            ? item.value
            : null,
        }
      }),
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const payload = sanitizePayload(body)
  if (!payload) {
    return NextResponse.json({ ok: false, error: 'Invalid spatial web submission.' }, { status: 400 })
  }

  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  await appendFile(SUBMISSION_PATH, `${JSON.stringify(payload)}\n`, 'utf8')

  return NextResponse.json({
    ok: true,
    message: `Saved ${payload.fields.length} spatial web fields.`,
    data: {
      formId: payload.formId,
      submittedAt: payload.submittedAt,
      fieldCount: payload.fields.length,
    },
  })
}
