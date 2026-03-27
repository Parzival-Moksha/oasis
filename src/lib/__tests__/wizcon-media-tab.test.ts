// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WIZCON MEDIA TAB TESTS — Mission #22
// DeleteConfirmModal, GalleryItem delete pattern, media playback,
// MediaLightbox, edge cases (placedCount nullish coalescing)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE LOADING — read the actual source for pattern analysis
// ═══════════════════════════════════════════════════════════════════════════

const FORGE_DIR = path.resolve(__dirname, '../../components/forge')
const deleteModalSrc = fs.readFileSync(path.join(FORGE_DIR, 'DeleteConfirmModal.tsx'), 'utf-8')
const wizConSrc = fs.readFileSync(path.join(FORGE_DIR, 'WizardConsole.tsx'), 'utf-8')

// ═══════════════════════════════════════════════════════════════════════════
// 1. DeleteConfirmModal logic
// ═══════════════════════════════════════════════════════════════════════════

describe('DeleteConfirmModal — source patterns', () => {
  it('exports DeleteConfirmModal as a named export', () => {
    expect(deleteModalSrc).toMatch(/export\s+function\s+DeleteConfirmModal/)
  })

  it('accepts correct props interface: isOpen, itemName, placedCount?, onConfirm, onCancel', () => {
    expect(deleteModalSrc).toContain('isOpen: boolean')
    expect(deleteModalSrc).toContain('itemName: string')
    expect(deleteModalSrc).toContain('placedCount?: number')
    expect(deleteModalSrc).toContain('onConfirm: () => void')
    expect(deleteModalSrc).toContain('onCancel: () => void')
  })

  it('returns null when isOpen is false (early-exit gate)', () => {
    // Pattern: if (!isOpen) return null
    expect(deleteModalSrc).toMatch(/if\s*\(\s*!isOpen\s*\)\s*return\s+null/)
  })

  it('displays itemName in the modal heading', () => {
    // Pattern: {itemName} in the heading
    expect(deleteModalSrc).toContain('{itemName}')
    // Uses ldquo/rdquo quotes around the name
    expect(deleteModalSrc).toContain('&ldquo;')
    expect(deleteModalSrc).toContain('&rdquo;')
  })

  it('uses nullish coalescing for placedCount > 0 check', () => {
    // Pattern: (placedCount ?? 0) > 0
    expect(deleteModalSrc).toContain('(placedCount ?? 0) > 0')
  })

  it('shows placed-count warning when (placedCount ?? 0) > 0', () => {
    // The yellow warning text containing placed count info
    expect(deleteModalSrc).toContain('text-yellow-400')
    expect(deleteModalSrc).toContain('placed')
    expect(deleteModalSrc).toContain('{placedCount}')
    expect(deleteModalSrc).toContain('time')
  })

  it('shows generic "removes permanently" when placedCount is 0 or undefined', () => {
    expect(deleteModalSrc).toContain('This removes the file permanently.')
  })

  it('pluralizes "times" when (placedCount ?? 0) > 1', () => {
    // Pattern: (placedCount ?? 0) > 1 ? 's' : ''
    expect(deleteModalSrc).toContain("(placedCount ?? 0) > 1 ? 's' : ''")
  })

  it('registers Escape keydown handler only when isOpen', () => {
    // The useEffect has isOpen in its deps and returns early if !isOpen
    expect(deleteModalSrc).toMatch(/if\s*\(\s*!isOpen\s*\)\s*return/)
    expect(deleteModalSrc).toContain("addEventListener('keydown'")
    expect(deleteModalSrc).toContain("removeEventListener('keydown'")
  })

  it('Escape key calls onCancel', () => {
    // handleKey checks for Escape and calls onCancel
    expect(deleteModalSrc).toMatch(/e\.key\s*===\s*'Escape'/)
    expect(deleteModalSrc).toContain('onCancel()')
  })

  it('backdrop click calls onCancel (outer div onClick)', () => {
    // The outer div has onClick={onCancel}
    // Pattern: className="fixed inset-0..." onClick={onCancel}
    const fixedOverlay = deleteModalSrc.match(/className="fixed inset-0[^"]*"[^>]*onClick=\{onCancel\}/)
    expect(fixedOverlay).toBeTruthy()
  })

  it('inner dialog stops propagation (does not close on content click)', () => {
    expect(deleteModalSrc).toContain('e.stopPropagation()')
  })

  it('has Cancel button wired to onCancel', () => {
    expect(deleteModalSrc).toMatch(/onClick=\{onCancel\}[\s\S]*?Cancel/)
  })

  it('has Delete button wired to onConfirm', () => {
    expect(deleteModalSrc).toMatch(/onClick=\{onConfirm\}[\s\S]*?Delete/)
  })

  it('uses z-[9999] for topmost stacking', () => {
    expect(deleteModalSrc).toContain('z-[9999]')
  })

  it('cleans up keydown listener on unmount (return cleanup in useEffect)', () => {
    expect(deleteModalSrc).toMatch(/return\s*\(\)\s*=>\s*document\.removeEventListener\('keydown'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. GalleryItem delete pattern
// ═══════════════════════════════════════════════════════════════════════════

describe('GalleryItem — unified delete pattern', () => {
  it('accepts onRequestDelete as an optional prop', () => {
    expect(wizConSrc).toMatch(/onRequestDelete\?\s*:\s*\(id:\s*string,\s*name:\s*string\)\s*=>\s*void/)
  })

  it('calls onRequestDelete when available, falling back to onDelete', () => {
    // Pattern: if (onRequestDelete) onRequestDelete(...) else onDelete(...)
    expect(wizConSrc).toContain('if (onRequestDelete) onRequestDelete(asset.id, name)')
    expect(wizConSrc).toContain('else onDelete(asset.id)')
  })

  it('does NOT use window.confirm for asset deletion', () => {
    // Extract GalleryItem function body
    const galleryStart = wizConSrc.indexOf('function GalleryItem(')
    const galleryEnd = wizConSrc.indexOf('\nfunction ', galleryStart + 1)
    const galleryBody = wizConSrc.slice(galleryStart, galleryEnd > galleryStart ? galleryEnd : galleryStart + 3000)
    // No window.confirm in GalleryItem delete flow
    expect(galleryBody).not.toMatch(/window\.confirm.*[Dd]elete/)
  })

  it('stops propagation on delete button click', () => {
    // The delete button handler: e.stopPropagation()
    // Find the delete button block in GalleryItem
    const galleryStart = wizConSrc.indexOf('function GalleryItem(')
    const galleryEnd = wizConSrc.indexOf('\nfunction ', galleryStart + 1)
    const galleryBody = wizConSrc.slice(galleryStart, galleryEnd > galleryStart ? galleryEnd : galleryStart + 3000)
    expect(galleryBody).toContain('e.stopPropagation()')
  })

  it('passes displayName or truncated prompt as name to onRequestDelete', () => {
    // Pattern: asset.displayName || asset.prompt?.slice(0, 30) || asset.id
    expect(wizConSrc).toContain("asset.displayName || asset.prompt?.slice(0, 30) || asset.id")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Media playback attributes
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaTab — media playback', () => {
  // Extract MediaTab function body for scoped analysis
  const mediaTabStart = wizConSrc.indexOf('function MediaTab()')
  const mediaTabEnd = wizConSrc.indexOf('\n// ═══', mediaTabStart + 1)
  const mediaTabBody = wizConSrc.slice(mediaTabStart, mediaTabEnd > mediaTabStart ? mediaTabEnd : mediaTabStart + 5000)

  it('renders <video> with controls attribute for video items', () => {
    expect(mediaTabBody).toMatch(/<video\s[^>]*controls/)
  })

  it('renders <audio> with controls attribute for audio items', () => {
    expect(mediaTabBody).toMatch(/<audio\s[^>]*controls/)
  })

  it('renders <img> for image items with click handler for lightbox', () => {
    // Image onClick sets lightboxUrl
    expect(mediaTabBody).toMatch(/<img\s[^>]*onClick=\{.*setLightboxUrl/)
  })

  it('video has preload="metadata" for efficient loading', () => {
    expect(mediaTabBody).toContain('preload="metadata"')
  })

  it('video has playsInline for mobile compatibility', () => {
    expect(mediaTabBody).toContain('playsInline')
  })

  it('images use lazy loading', () => {
    expect(mediaTabBody).toContain('loading="lazy"')
  })

  it('audio is wrapped in a container with icon', () => {
    // Audio items get a visual wrapper with the music note emoji
    expect(mediaTabBody).toContain('🎵')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. MediaLightbox pattern
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaLightbox — fullscreen image viewer', () => {
  // Extract MediaLightbox function
  const lbStart = wizConSrc.indexOf('function MediaLightbox(')
  const lbEnd = wizConSrc.indexOf('\nfunction ', lbStart + 1)
  const lightboxBody = wizConSrc.slice(lbStart, lbEnd > lbStart ? lbEnd : lbStart + 1000)

  it('accepts url and onClose props', () => {
    expect(lightboxBody).toContain('{ url, onClose }')
    expect(lightboxBody).toContain('url: string')
    expect(lightboxBody).toContain('onClose: () => void')
  })

  it('registers Escape key handler that calls onClose', () => {
    expect(lightboxBody).toMatch(/e\.key\s*===\s*'Escape'/)
    expect(lightboxBody).toContain('onClose()')
  })

  it('cleans up keydown listener on unmount', () => {
    expect(lightboxBody).toContain("document.addEventListener('keydown'")
    expect(lightboxBody).toContain("document.removeEventListener('keydown'")
  })

  it('backdrop click calls onClose', () => {
    // Outer div onClick={onClose}
    expect(lightboxBody).toContain('onClick={onClose}')
  })

  it('image click stops propagation (does not close lightbox)', () => {
    expect(lightboxBody).toContain('e.stopPropagation()')
  })

  it('uses fixed fullscreen overlay with z-[9999]', () => {
    expect(lightboxBody).toContain('fixed inset-0')
    expect(lightboxBody).toContain('z-[9999]')
  })

  it('has a close button (x symbol)', () => {
    expect(lightboxBody).toContain('&times;')
  })

  it('constrains image to 90vw/90vh for responsive viewing', () => {
    expect(lightboxBody).toContain('max-w-[90vw]')
    expect(lightboxBody).toContain('max-h-[90vh]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. MediaTab uses createPortal for both modals
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaTab — portal pattern', () => {
  const mediaTabStart = wizConSrc.indexOf('function MediaTab()')
  const mediaTabEnd = wizConSrc.indexOf('\n// ═══', mediaTabStart + 1)
  const mediaTabBody = wizConSrc.slice(mediaTabStart, mediaTabEnd > mediaTabStart ? mediaTabEnd : mediaTabStart + 5000)

  it('uses createPortal for DeleteConfirmModal', () => {
    // Pattern: createPortal(<DeleteConfirmModal ...>, document.body)
    expect(mediaTabBody).toMatch(/createPortal\(\s*<DeleteConfirmModal/)
  })

  it('uses createPortal for MediaLightbox', () => {
    expect(mediaTabBody).toMatch(/createPortal\(\s*<MediaLightbox/)
  })

  it('guards createPortal with typeof document check (SSR safety)', () => {
    // Pattern: typeof document !== 'undefined' && createPortal(...)
    expect(mediaTabBody).toContain("typeof document !== 'undefined'")
  })

  it('imports createPortal from react-dom', () => {
    expect(wizConSrc).toContain("import { createPortal } from 'react-dom'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. deleteTarget state shape and flow
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaTab — deleteTarget state management', () => {
  const mediaTabStart = wizConSrc.indexOf('function MediaTab()')
  const mediaTabEnd = wizConSrc.indexOf('\n// ═══', mediaTabStart + 1)
  const mediaTabBody = wizConSrc.slice(mediaTabStart, mediaTabEnd > mediaTabStart ? mediaTabEnd : mediaTabStart + 5000)

  it('declares deleteTarget state with url, name, placedCount', () => {
    expect(mediaTabBody).toMatch(/useState<\{\s*url:\s*string;\s*name:\s*string;\s*placedCount:\s*number\s*\}\s*\|\s*null>/)
  })

  it('initializes deleteTarget as null', () => {
    expect(mediaTabBody).toContain('>(null)')
  })

  it('sets deleteTarget with url, name, and placedCount on delete button click', () => {
    expect(mediaTabBody).toContain('setDeleteTarget({ url: item.url, name: item.name, placedCount })')
  })

  it('passes deleteTarget.name as itemName to DeleteConfirmModal', () => {
    expect(mediaTabBody).toContain("itemName={deleteTarget?.name || ''}")
  })

  it('passes deleteTarget.placedCount to DeleteConfirmModal', () => {
    expect(mediaTabBody).toContain('placedCount={deleteTarget?.placedCount}')
  })

  it('onConfirm calls handleDelete with deleteTarget.url', () => {
    expect(mediaTabBody).toContain('deleteTarget && handleDelete(deleteTarget.url)')
  })

  it('onCancel resets deleteTarget to null', () => {
    expect(mediaTabBody).toContain('setDeleteTarget(null)')
  })

  it('handleDelete also clears deleteTarget after API call', () => {
    // Inside handleDelete: setDeleteTarget(null) + fetchMedia()
    const handleDeleteMatch = mediaTabBody.match(/handleDelete[\s\S]*?setDeleteTarget\(null\)/)
    expect(handleDeleteMatch).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Conjured gallery also uses DeleteConfirmModal (dual usage)
// ═══════════════════════════════════════════════════════════════════════════

describe('WizardConsole — conjured gallery delete modal', () => {
  it('has conjureDeleteTarget state for conjured asset deletion', () => {
    expect(wizConSrc).toContain('conjureDeleteTarget')
    expect(wizConSrc).toContain('setConjureDeleteTarget')
  })

  it('passes onRequestDelete to GalleryItem from main gallery', () => {
    expect(wizConSrc).toMatch(/onRequestDelete=\{.*setConjureDeleteTarget/)
  })

  it('renders second DeleteConfirmModal for conjured assets', () => {
    // Two separate DeleteConfirmModal usages in the file
    const matches = wizConSrc.match(/<DeleteConfirmModal/g)
    expect(matches).toBeTruthy()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('imports DeleteConfirmModal from ./DeleteConfirmModal', () => {
    expect(wizConSrc).toContain("import { DeleteConfirmModal } from './DeleteConfirmModal'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Edge cases — placedCount nullish coalescing safety
// ═══════════════════════════════════════════════════════════════════════════

describe('DeleteConfirmModal — placedCount edge cases', () => {
  it('handles placedCount=undefined safely via nullish coalescing', () => {
    // The ?? 0 pattern ensures undefined doesn't cause NaN comparisons
    const matches = deleteModalSrc.match(/placedCount \?\? 0/g)
    expect(matches).toBeTruthy()
    // Used twice: once for > 0 check, once for > 1 pluralization
    expect(matches!.length).toBe(2)
  })

  it('placedCount=0 shows generic message (not placed-count warning)', () => {
    // (placedCount ?? 0) > 0 is false when placedCount is 0
    // So the else branch renders: "This removes the file permanently."
    expect(deleteModalSrc).toContain('This removes the file permanently.')
  })

  it('placedCount=1 shows singular "time" (not "times")', () => {
    // (placedCount ?? 0) > 1 is false when placedCount is 1
    // So the ternary returns '' (no s suffix)
    expect(deleteModalSrc).toContain("(placedCount ?? 0) > 1 ? 's' : ''")
  })

  it('placedCount=5 would show "5 times" (plural)', () => {
    // When placedCount > 1, the 's' suffix is added
    // Verify the template produces: {placedCount} time{s}
    expect(deleteModalSrc).toMatch(/\{placedCount\}\s*time\{/)
  })

  it('DeleteConfirmModal is a client component', () => {
    expect(deleteModalSrc).toMatch(/^'use client'/)
  })

  it('uses useCallback for handleKey memoization', () => {
    expect(deleteModalSrc).toContain('useCallback')
  })

  it('handleKey depends on onCancel in useCallback deps', () => {
    expect(deleteModalSrc).toContain('[onCancel]')
  })

  it('useEffect depends on isOpen and handleKey', () => {
    expect(deleteModalSrc).toContain('[isOpen, handleKey]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. MediaTab — countPlaced utility
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaTab — countPlaced helper', () => {
  const mediaTabStart = wizConSrc.indexOf('function MediaTab()')
  const mediaTabEnd = wizConSrc.indexOf('\n// ═══', mediaTabStart + 1)
  const mediaTabBody = wizConSrc.slice(mediaTabStart, mediaTabEnd > mediaTabStart ? mediaTabEnd : mediaTabStart + 5000)

  it('defines countPlaced function that uses placedCatalogAssets', () => {
    expect(mediaTabBody).toContain('countPlaced')
    expect(mediaTabBody).toContain('placedCatalogAssets')
  })

  it('counts assets by matching imageUrl or videoUrl', () => {
    expect(mediaTabBody).toContain('a.imageUrl === url')
    expect(mediaTabBody).toContain('a.videoUrl === url')
  })

  it('shows placed count badge when placedCount > 0', () => {
    expect(mediaTabBody).toContain('placedCount > 0')
    expect(mediaTabBody).toMatch(/\{placedCount\}\s*placed/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. lightboxUrl state for image viewer
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaTab — lightbox state', () => {
  const mediaTabStart = wizConSrc.indexOf('function MediaTab()')
  const mediaTabEnd = wizConSrc.indexOf('\n// ═══', mediaTabStart + 1)
  const mediaTabBody = wizConSrc.slice(mediaTabStart, mediaTabEnd > mediaTabStart ? mediaTabEnd : mediaTabStart + 5000)

  it('declares lightboxUrl state as string | null', () => {
    expect(mediaTabBody).toMatch(/useState<string\s*\|\s*null>/)
  })

  it('initializes lightboxUrl as null', () => {
    expect(mediaTabBody).toContain('setLightboxUrl] = useState')
  })

  it('only renders MediaLightbox when lightboxUrl is truthy', () => {
    // Pattern: lightboxUrl && ... createPortal(<MediaLightbox
    expect(mediaTabBody).toMatch(/lightboxUrl\s*&&/)
  })

  it('closes lightbox by setting lightboxUrl to null', () => {
    expect(mediaTabBody).toContain('setLightboxUrl(null)')
  })
})
