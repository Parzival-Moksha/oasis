// What a file an agent sends is, for the thread: a picture (the viewer), sound (a player in the thread), video
// (the full-screen viewer) or any other file (downloaded without leaving the Oasis). By its media type, else by
// its extension, like the engine's files.js serves it.

export type AttachmentKind = 'image' | 'audio' | 'video' | 'text' | 'file'

const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'aac'])
const VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm'])

export function attachmentKind(file: { name: string; isImage?: boolean; mediaType?: string | null }): AttachmentKind {
  if (file.isImage) return 'image'
  const type = (file.mediaType || '').toLowerCase()
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (AUDIO.has(ext)) return 'audio'
  if (VIDEO.has(ext)) return 'video'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx' || ext === 'txt') return 'text'
  return 'file'
}

/**
 * Download a file from the engine without the page going anywhere. A plain cross-origin link navigates the tab (the
 * download attribute only works same-origin) and a fetch needs CORS the engine doesn't send; a hidden frame loads
 * it instead: the engine serves other files as attachments, so the browser saves it and the Oasis stays.
 */
export async function downloadInPlace(url: string, name: string): Promise<void> {
  const sameOrigin = new URL(url, window.location.href).origin === window.location.origin
  if (sameOrigin) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(response.status === 404 ? 'that file is gone' : `HTTP ${response.status}`)
    const href = URL.createObjectURL(await response.blob())
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
    return
  }
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.src = url
  document.body.appendChild(frame)
  setTimeout(() => frame.remove(), 60_000)
}
