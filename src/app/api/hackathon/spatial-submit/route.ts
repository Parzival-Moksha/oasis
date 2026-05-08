import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import type { SpatialWebSubmissionPayload, SpatialWebSubmitDestination } from '@/lib/spatial-web'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SUBMISSION_PATH = join(process.cwd(), 'data', 'spatial-web-submissions.local.jsonl')

function sanitizeDestination(value: unknown): SpatialWebSubmitDestination | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  if (!['local', 'google_form', 'webhook'].includes(type)) return undefined

  const fieldMapSource = record.fieldMap && typeof record.fieldMap === 'object' && !Array.isArray(record.fieldMap)
    ? record.fieldMap as Record<string, unknown>
    : {}
  const fieldMap = Object.fromEntries(
    Object.entries(fieldMapSource)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([key, entry]) => [key.trim(), entry.trim()]),
  )

  return {
    type: type as SpatialWebSubmitDestination['type'],
    ...(typeof record.formUrl === 'string' && record.formUrl.trim() ? { formUrl: record.formUrl.trim() } : {}),
    ...(typeof record.responseUrl === 'string' && record.responseUrl.trim() ? { responseUrl: record.responseUrl.trim() } : {}),
    ...(Object.keys(fieldMap).length > 0 ? { fieldMap } : {}),
    ...(typeof record.webhookUrl === 'string' && record.webhookUrl.trim() ? { webhookUrl: record.webhookUrl.trim() } : {}),
  }
}

function googleFormResponseUrl(destination: SpatialWebSubmitDestination): string | null {
  const raw = destination.responseUrl || destination.formUrl
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.hostname !== 'google.com' && !url.hostname.endsWith('.google.com')) return null
    if (!url.pathname.includes('/forms/')) return null
    url.pathname = url.pathname
      .replace(/\/viewform\/?$/, '/formResponse')
      .replace(/\/edit\/?$/, '/formResponse')
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function fieldEntryId(fieldMap: Record<string, string>, field: SpatialWebSubmissionPayload['fields'][number]): string | null {
  return fieldMap[field.id]
    || fieldMap[field.label]
    || fieldMap[field.label.toLowerCase()]
    || null
}

async function forwardToGoogleForm(payload: SpatialWebSubmissionPayload, destination: SpatialWebSubmitDestination) {
  const responseUrl = googleFormResponseUrl(destination)
  const fieldMap = destination.fieldMap || {}
  if (!responseUrl) {
    return { ok: false, message: 'Google Forms destination needs a public Google Form URL or formResponse URL.' }
  }
  if (Object.keys(fieldMap).length === 0) {
    return { ok: false, message: 'Google Forms destination needs fieldMap entries like {"Name":"entry.123"}.' }
  }

  const params = new URLSearchParams()
  let mappedCount = 0
  for (const field of payload.fields) {
    const entryId = fieldEntryId(fieldMap, field)
    if (!entryId) continue
    const values = Array.isArray(field.value) ? field.value : [field.value]
    for (const value of values) {
      if (value === null || value === undefined) continue
      params.append(entryId, String(value))
      mappedCount += 1
    }
  }

  if (mappedCount === 0) {
    return { ok: false, message: 'No submitted spatial fields matched the Google Forms field map.' }
  }

  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString(),
  })

  return {
    ok: response.ok,
    message: response.ok
      ? `Submitted ${mappedCount} mapped field${mappedCount === 1 ? '' : 's'} to Google Forms.`
      : `Google Forms submit failed: HTTP ${response.status}.`,
    status: response.status,
    mappedCount,
  }
}

async function forwardToWebhook(payload: SpatialWebSubmissionPayload, destination: SpatialWebSubmitDestination) {
  if (!destination.webhookUrl) return { ok: false, message: 'Webhook destination needs webhookUrl.' }
  const response = await fetch(destination.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return {
    ok: response.ok,
    message: response.ok ? `Submitted ${payload.fields.length} fields to webhook.` : `Webhook submit failed: HTTP ${response.status}.`,
    status: response.status,
  }
}

function sanitizePayload(value: unknown): SpatialWebSubmissionPayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<SpatialWebSubmissionPayload>
  if (typeof record.formId !== 'string' || !record.formId.trim()) return null
  if (!Array.isArray(record.fields)) return null
  return {
    formId: record.formId.trim(),
    submittedAt: typeof record.submittedAt === 'string' ? record.submittedAt : new Date().toISOString(),
    destination: sanitizeDestination(record.destination),
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

  let forwardResult: { ok: boolean; message: string; status?: number; mappedCount?: number } | undefined
  if (payload.destination?.type === 'google_form') {
    forwardResult = await forwardToGoogleForm(payload, payload.destination)
  } else if (payload.destination?.type === 'webhook') {
    forwardResult = await forwardToWebhook(payload, payload.destination)
  }

  if (forwardResult && !forwardResult.ok) {
    return NextResponse.json({
      ok: false,
      error: forwardResult.message,
      data: {
        formId: payload.formId,
        submittedAt: payload.submittedAt,
        fieldCount: payload.fields.length,
        forwardStatus: forwardResult.status,
      },
    }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    message: forwardResult?.message || `Saved ${payload.fields.length} spatial web fields.`,
    data: {
      formId: payload.formId,
      submittedAt: payload.submittedAt,
      fieldCount: payload.fields.length,
      forwardStatus: forwardResult?.status,
      mappedCount: forwardResult?.mappedCount,
    },
  })
}
