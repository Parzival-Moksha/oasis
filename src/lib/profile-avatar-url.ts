export function normalizeProfileAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/api/profile/avatar/image/')) return trimmed
  if (trimmed.startsWith('/avatars/')) {
    const filename = trimmed.slice('/avatars/'.length).split(/[?#]/)[0]
    if (!filename) return null
    return `/api/profile/avatar/image/${encodeURIComponent(filename)}`
  }
  return trimmed
}

export function withProfileAvatarBust(url: string | null | undefined, version: number | string | null | undefined): string | null {
  const normalized = normalizeProfileAvatarUrl(url)
  if (!normalized || !version) return normalized
  return `${normalized}${normalized.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`
}
