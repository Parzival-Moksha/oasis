// ░▒▓ LOCAL MEDIA URL — the same file whether an agent wrote localhost or 127.0.0.1 ▓▒░
// Agents save media as absolute URLs (http://127.0.0.1:4516/generated-videos/x.mp4) while the owner
// may open the Oasis as http://localhost:4516: a different origin. Videos and textures load with
// crossOrigin='anonymous' for WebGL and the dev server sends no CORS header, so the browser refused
// them: video error 4, no picture. Loopback URLs for this server become same-origin paths.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
/** Public folders of this server: rewritten whatever port the URL names (agents sometimes guess it). */
const OASIS_MEDIA_PATHS = /^\/(generated-images|generated-videos|generated-music|generated-voices|uploads)\//

function portOf(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/**
 * `url` as the page should load it: a loopback URL that points at this Oasis server becomes
 * `pageOrigin + path`. Anything else (other hosts, the agent engine on another port, data: and
 * relative URLs) is returned unchanged.
 */
export function resolveLocalMediaUrl(url: string, pageOrigin: string | null | undefined): string {
  if (!url || !pageOrigin || !/^https?:\/\//i.test(url)) return url
  let parsed: URL
  let page: URL
  try {
    parsed = new URL(url)
    page = new URL(pageOrigin)
  } catch {
    return url
  }
  if (!LOOPBACK.has(parsed.hostname) || !LOOPBACK.has(page.hostname)) return url
  const samePort = portOf(parsed) === portOf(page)
  if (!samePort && !OASIS_MEDIA_PATHS.test(parsed.pathname)) return url
  return `${page.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** In the browser: against this page's origin. */
export function localMediaUrl(url: string): string {
  if (typeof window === 'undefined') return url
  return resolveLocalMediaUrl(url, window.location.origin)
}

/** True when the URL is on another origin than the page (then WebGL needs CORS to use it). */
export function isCrossOrigin(url: string, pageOrigin: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    return new URL(url).origin !== new URL(pageOrigin).origin
  } catch {
    return false
  }
}
