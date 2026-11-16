'use client'

// ░▒▓ COMPOSER PICTURES — paste (Ctrl+V) or drop pictures into an agent chat ▓▒░
// They wait above the text box as thumbnail chips (× removes one) and go out with the next message as image
// blocks (engine: pictures.js). Kept per agent, so the side panel (E) and the screen (F) show the same ones.
// Ctrl+V works with the box focused or not, while the agent's chat is open. Big pictures are scaled down to
// the size the models read anyway (1568 px on the long side) and kept under the API's 5 MB.

import { useCallback, useEffect, useSyncExternalStore, type DragEvent as ReactDragEvent } from 'react'

import type { EngineSendPicture } from '../../lib/agent-engine-types'
import { useOasisStore } from '../../store/oasisStore'
import { showNotice } from '../forge/GlobalNotice'

export interface ComposerPicture {
  id: string
  name: string
  mediaType: string
  /** base64, no data: prefix */
  data: string
  /** for the chip */
  url: string
}

export const PICTURES_MAX = 10
const LONG_EDGE = 1568
/** base64 characters: the API takes 5 MB a picture. */
const MAX_BASE64 = 5 * 1024 * 1024 - 1024
const READ_AS_IS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const byAgent = new Map<string, ComposerPicture[]>()
const listeners = new Set<() => void>()
const EMPTY: ComposerPicture[] = []
let counter = 0

function emit() {
  listeners.forEach(listener => listener())
}

function setPictures(agentId: string, next: ComposerPicture[]) {
  if (next.length) byAgent.set(agentId, next)
  else byAgent.delete(agentId)
  emit()
}

export function getComposerPictures(agentId: string): ComposerPicture[] {
  return byAgent.get(agentId) || EMPTY
}

export function clearComposerPictures(agentId: string) {
  if (byAgent.has(agentId)) setPictures(agentId, [])
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error || new Error('could not read the picture'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('not a picture the browser can open'))
    image.src = url
  })
}

/** A file from the clipboard or a drop -> what the engine takes: as it is when it fits, else scaled and re-encoded. */
export async function preparePicture(file: File): Promise<ComposerPicture> {
  const url = URL.createObjectURL(file)
  const image = await loadImage(url).catch(error => { URL.revokeObjectURL(url); throw error })
  const name = file.name || `pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`
  const long = Math.max(image.naturalWidth, image.naturalHeight)
  if (READ_AS_IS.has(file.type) && long <= LONG_EDGE && file.size * 4 / 3 < MAX_BASE64) {
    return { id: `p${++counter}`, name, mediaType: file.type, data: await blobToBase64(file), url }
  }
  const scale = Math.min(1, LONG_EDGE / long)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  const encode = (type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
  // Screenshots stay sharp as PNG; a photo that is still too big as PNG becomes a JPEG.
  let blob = await encode('image/png')
  if (!blob || blob.size * 4 / 3 >= MAX_BASE64) blob = await encode('image/jpeg', 0.9)
  if (!blob || blob.size * 4 / 3 >= MAX_BASE64) blob = await encode('image/jpeg', 0.75)
  if (!blob) throw new Error('could not encode the picture')
  return { id: `p${++counter}`, name: name.replace(/\.[a-z0-9]+$/i, '') + (blob.type === 'image/png' ? '.png' : '.jpg'), mediaType: blob.type, data: await blobToBase64(blob), url }
}

export async function addPictureFiles(agentId: string, files: File[]): Promise<void> {
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) return
  const room = PICTURES_MAX - getComposerPictures(agentId).length
  if (room <= 0) {
    showNotice(`At most ${PICTURES_MAX} pictures in one message.`, 'warn')
    return
  }
  if (images.length > room) showNotice(`At most ${PICTURES_MAX} pictures in one message: added the first ${room}.`, 'warn')
  for (const file of images.slice(0, room)) {
    try {
      const picture = await preparePicture(file)
      setPictures(agentId, [...getComposerPictures(agentId), picture])
    } catch (error) {
      showNotice(`Picture not added: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }
}

function imagesIn(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files || []).filter(file => file.type.startsWith('image/'))
  if (files.length) return files
  return Array.from(data.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types || []).includes('Files'))
}

/** Is the paste for this chat: the box, or nothing in particular (not another text field elsewhere). */
function pasteIsOurs(target: EventTarget | null, box: HTMLElement | null): boolean {
  const el = target as HTMLElement | null
  if (!el || el === box) return true
  if (el === document.body || el === document.documentElement) return true
  const tag = el.tagName
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable)
}

/**
 * The pictures waiting for `agentId`, and the handlers: paste anywhere while this agent's chat is open, drop on
 * the composer.
 */
export function useComposerPictures(agentId: string, box: () => HTMLElement | null) {
  const list = useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => getComposerPictures(agentId),
    () => EMPTY,
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if ((event as ClipboardEvent & { oasisPictures?: boolean }).oasisPictures) return // the panel and the screen are both open
      if (useOasisStore.getState().agentEngine.focusedAgentId !== agentId) return
      if (!pasteIsOurs(event.target, box())) return
      const files = imagesIn(event.clipboardData)
      if (!files.length) return // plain text pastes as usual
      ;(event as ClipboardEvent & { oasisPictures?: boolean }).oasisPictures = true
      event.preventDefault()
      void addPictureFiles(agentId, files)
    }
    window.addEventListener('paste', onPaste, { capture: true })
    return () => window.removeEventListener('paste', onPaste, { capture: true })
  }, [agentId, box])

  const remove = useCallback((id: string) => {
    const picture = getComposerPictures(agentId).find(p => p.id === id)
    if (picture) URL.revokeObjectURL(picture.url)
    setPictures(agentId, getComposerPictures(agentId).filter(p => p.id !== id))
  }, [agentId])

  const clear = useCallback(() => {
    getComposerPictures(agentId).forEach(p => URL.revokeObjectURL(p.url))
    clearComposerPictures(agentId)
  }, [agentId])

  const dropProps = {
    onDragOver: (event: ReactDragEvent) => {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (event: ReactDragEvent) => {
      const files = imagesIn(event.dataTransfer)
      if (!files.length) return
      event.preventDefault()
      event.stopPropagation()
      void addPictureFiles(agentId, files)
    },
  }

  const payload = (): EngineSendPicture[] => list.map(p => ({ data: p.data, mediaType: p.mediaType, name: p.name }))

  return { list, remove, clear, dropProps, payload }
}

export function PictureChips({ pictures, onRemove, large = false }: { pictures: ComposerPicture[]; onRemove: (id: string) => void; large?: boolean }) {
  if (!pictures.length) return null
  const size = large ? 64 : 48
  return (
    <div className="flex flex-wrap gap-1.5" data-composer-pictures>
      {pictures.map(picture => (
        <div key={picture.id} className="relative overflow-hidden rounded-md border border-white/25 bg-black/40" style={{ height: size }} title={picture.name}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={picture.url} alt={picture.name} className="block h-full w-auto max-w-[120px] object-cover" />
          <button
            type="button"
            onClick={() => onRemove(picture.id)}
            aria-label={`Remove ${picture.name}`}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[10px] leading-none text-white hover:bg-rose-500"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
