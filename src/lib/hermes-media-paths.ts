export type HermesMediaType = 'image' | 'audio' | 'video'

const MEDIA_EXTENSION_RE = /\.(?:mp3|wav|ogg|oga|opus|m4a|png|jpg|jpeg|gif|webp|mp4|webm|m4v)(?:\?[^\s"'`<>]+)?$/i
const EXPLICIT_MEDIA_REF_RE = /((?:https?:\/\/|file:\/\/|~\/|\/(?:home|tmp|generated-images|generated-voices|generated-videos|generated-music|merlin\/screenshots|api\/hermes\/media))[^\s"'`<>]*?\.(?:mp3|wav|ogg|oga|opus|m4a|png|jpg|jpeg|gif|webp|mp4|webm|m4v)(?:\?[^\s"'`<>]+)?)/gi
const MARKDOWN_MEDIA_REF_RE = /!?\[([^\]]*)\]\(([^)]+)\)/g

export interface HermesMediaReference {
  path: string
  mediaType: HermesMediaType
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function unwrapHermesPathLikeValue(path: string): string {
  let next = sanitizeString(path)
  if (!next) return ''

  const wrappedMatch = next.match(/^(?:Path|PosixPath)\((['"])(.+)\1\)$/)
  if (wrappedMatch?.[2]) {
    next = wrappedMatch[2].trim()
  }

  next = next.replace(/^['"`]+|['"`]+$/g, '').trim()

  if (/^file:\/\//i.test(next)) {
    try {
      const url = new URL(next)
      next = decodeURIComponent(url.pathname)
    } catch {
      next = next.replace(/^file:\/\//i, '')
    }
  }

  const explicitPathMatch = next.match(/((?:https?:\/\/|file:\/\/|~\/|\/(?:home|tmp|generated-images|generated-voices|generated-videos|generated-music|merlin\/screenshots|api\/hermes\/media))[^\s"'`<>]*?\.(?:mp3|wav|ogg|oga|opus|m4a|png|jpg|jpeg|gif|webp|mp4|webm|m4v)(?:\?[^\s"'`<>]+)?)/i)
  if (explicitPathMatch?.[1]) {
    return explicitPathMatch[1].trim()
  }

  return next.replace(/[)\],.;:!?]+$/g, '').trim()
}

export function normalizeHermesMediaPath(path: string): string {
  const next = unwrapHermesPathLikeValue(path)
  if (!next) return ''
  if (isDirectHermesMediaUrl(next)) return next
  return next
}

export function detectHermesMediaType(path: string): HermesMediaType | null {
  const normalized = normalizeHermesMediaPath(path)
  if (/^data:image\//i.test(normalized)) return 'image'
  if (/^data:audio\//i.test(normalized)) return 'audio'
  if (/^data:video\//i.test(normalized)) return 'video'
  if (/\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
  if (/\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
  if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
  if (/(?:fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)/i.test(normalized)) {
    if (/video|mp4|webm/i.test(normalized)) return 'video'
    return 'image'
  }
  if (/(?:api\.elevenlabs\.io|elevenlabs\.io\/)/i.test(normalized)) return 'audio'
  return null
}

export function isDirectHermesMediaUrl(path: string): boolean {
  return /^(?:https?:\/\/|blob:|data:)/i.test(path)
}

export function shouldProxyHermesMediaPath(path: string): boolean {
  const normalized = normalizeHermesMediaPath(path)
  if (!normalized || isDirectHermesMediaUrl(normalized)) return false
  return /^(?:~\/|\/home\/[^/]+\/|\/tmp\/)/.test(normalized) && MEDIA_EXTENSION_RE.test(normalized)
}

export function buildHermesMediaUrl(path: string): string {
  const normalized = normalizeHermesMediaPath(path)
  if (!normalized) return ''
  if (shouldProxyHermesMediaPath(normalized)) {
    return `/api/hermes/media?path=${encodeURIComponent(normalized)}`
  }
  return normalized
}

export function hermesMediaReferenceKey(path: string, mediaType: HermesMediaType): string {
  return `${mediaType}:${normalizeHermesMediaPath(path)}`
}

function pushMediaReference(refs: HermesMediaReference[], seen: Set<string>, rawPath: string) {
  const path = normalizeHermesMediaPath(rawPath)
  const mediaType = detectHermesMediaType(path)
  if (!path || !mediaType) return

  const key = hermesMediaReferenceKey(path, mediaType)
  if (seen.has(key)) return
  seen.add(key)
  refs.push({ path, mediaType })
}

export function extractHermesMediaReferencesFromText(content: string): HermesMediaReference[] {
  const refs: HermesMediaReference[] = []
  const seen = new Set<string>()

  for (const match of content.matchAll(MARKDOWN_MEDIA_REF_RE)) {
    pushMediaReference(refs, seen, match[2] || '')
  }

  for (const match of content.matchAll(EXPLICIT_MEDIA_REF_RE)) {
    pushMediaReference(refs, seen, match[1] || '')
  }

  return refs
}

function stripPromotedHermesMediaFromLine(line: string): string {
  let next = line.replace(MARKDOWN_MEDIA_REF_RE, (full, label: string, rawPath: string) => {
    const path = normalizeHermesMediaPath(rawPath)
    return detectHermesMediaType(path) ? (label || '').trim() : full
  })

  next = next.replace(EXPLICIT_MEDIA_REF_RE, '')
  return next.replace(/[ \t]{2,}/g, ' ').trimEnd()
}

export function promoteHermesContentMediaReferences(content: string): string {
  if (!content) return ''

  const lines: string[] = []
  const seen = new Set<string>()

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('MEDIA:')) {
      const path = normalizeHermesMediaPath(trimmed.slice('MEDIA:'.length))
      const mediaType = detectHermesMediaType(path)
      if (!path || !mediaType) {
        lines.push(line)
        continue
      }

      const key = hermesMediaReferenceKey(path, mediaType)
      if (!seen.has(key)) {
        seen.add(key)
        lines.push(`MEDIA:${path}`)
      }
      continue
    }

    const refs = extractHermesMediaReferencesFromText(line)
    if (refs.length === 0) {
      lines.push(line)
      continue
    }

    const strippedLine = stripPromotedHermesMediaFromLine(line)
    if (strippedLine.trim()) {
      lines.push(strippedLine)
    }

    for (const ref of refs) {
      const key = hermesMediaReferenceKey(ref.path, ref.mediaType)
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`MEDIA:${ref.path}`)
    }
  }

  return lines.join('\n')
}
