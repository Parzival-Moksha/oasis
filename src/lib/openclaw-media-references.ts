export type OpenclawMediaType = 'image' | 'audio' | 'video'

export interface OpenclawMediaReference {
  path: string
  mediaType: OpenclawMediaType
}

const OPENCLAW_MEDIA_URL_RE = /(?:https?:\/\/[^\s"'<>]+|\/(?:generated-(?:images|voices|videos|music)|merlin\/screenshots)\/[^\s"'<>]+)/gi

function mimeTypeForInlineImage(record: Record<string, unknown>): string | null {
  const data = typeof record.base64 === 'string' ? record.base64.trim() : ''
  if (!data) return null
  const explicitMime = typeof record.mimeType === 'string' ? record.mimeType.trim().toLowerCase() : ''
  if (/^image\/(?:png|jpe?g|webp|gif)$/.test(explicitMime)) return explicitMime
  const format = typeof record.format === 'string' ? record.format.trim().toLowerCase() : ''
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'gif') return 'image/gif'
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (typeof record.viewId === 'string' || typeof record.captureCount === 'number') return 'image/jpeg'
  return null
}

export function detectOpenclawMediaType(path: string): OpenclawMediaType | null {
  const normalized = path.trim()
  if (!normalized) return null
  if (/^data:image\//i.test(normalized)) return 'image'
  if (/^data:audio\//i.test(normalized)) return 'audio'
  if (/^data:video\//i.test(normalized)) return 'video'
  if (/\/generated-images\/|\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
  if (/\/generated-(?:voices|music)\/|\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
  if (/\/generated-videos\/|\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
  if (/^(?:https?:\/\/|blob:)/i.test(normalized)) {
    if (/\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
    if (/\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
    if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
    if (/(?:fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)/i.test(normalized)) {
      if (/video|mp4|webm/i.test(normalized)) return 'video'
      return 'image'
    }
    if (/(?:api\.elevenlabs\.io|elevenlabs\.io\/)/i.test(normalized)) return 'audio'
  }
  return null
}

function pushOpenclawMediaReference(
  refs: OpenclawMediaReference[],
  seen: Set<string>,
  path: string,
  mediaType: OpenclawMediaType | null = detectOpenclawMediaType(path),
) {
  const trimmed = path.trim()
  if (!trimmed || !mediaType) return
  const key = `${mediaType}:${trimmed}`
  if (seen.has(key)) return
  seen.add(key)
  refs.push({ path: trimmed, mediaType })
}

export function collectOpenclawMediaReferences(
  value: unknown,
  refs: OpenclawMediaReference[] = [],
  seen = new Set<string>(),
): OpenclawMediaReference[] {
  if (typeof value === 'string') {
    const matches = value.match(OPENCLAW_MEDIA_URL_RE) || []
    for (const match of matches) pushOpenclawMediaReference(refs, seen, match)

    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
      try {
        collectOpenclawMediaReferences(JSON.parse(trimmed) as unknown, refs, seen)
      } catch {
        // Keep regex-discovered URLs from the raw string.
      }
    }
    return refs
  }

  if (Array.isArray(value)) {
    for (const item of value) collectOpenclawMediaReferences(item, refs, seen)
    return refs
  }

  if (!value || typeof value !== 'object') return refs
  const record = value as Record<string, unknown>
  const hasInlineScreenshotCaptures = Array.isArray(record.captures)
    && record.captures.some(capture => Boolean(capture && typeof capture === 'object' && mimeTypeForInlineImage(capture as Record<string, unknown>)))

  if (record.type === 'image' && typeof record.data === 'string') {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : 'image/png'
    pushOpenclawMediaReference(refs, seen, `data:${mimeType};base64,${record.data}`, 'image')
  }

  const inlineImageMimeType = mimeTypeForInlineImage(record)
  if (inlineImageMimeType && typeof record.base64 === 'string') {
    pushOpenclawMediaReference(refs, seen, `data:${inlineImageMimeType};base64,${record.base64}`, 'image')
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'base64' || key === 'url' || key === 'filePath' || key === 'primaryCaptureUrl' || key === 'primaryCapturePath') continue
      collectOpenclawMediaReferences(nested, refs, seen)
    }
    return refs
  }

  const url = typeof record.url === 'string' ? record.url : ''
  if (url) pushOpenclawMediaReference(refs, seen, url)

  for (const [key, nested] of Object.entries(record)) {
    if (hasInlineScreenshotCaptures && (key === 'primaryCaptureUrl' || key === 'primaryCapturePath')) continue
    collectOpenclawMediaReferences(nested, refs, seen)
  }
  return refs
}
