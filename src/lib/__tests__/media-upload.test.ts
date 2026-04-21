// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MEDIA UPLOAD TESTS — /api/media/upload route validation
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises to prevent actual file writes
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '../../app/api/media/upload/route'
import { writeFile, mkdir } from 'fs/promises'

const mockWriteFile = writeFile as ReturnType<typeof vi.fn>
const mockMkdir = mkdir as ReturnType<typeof vi.fn>

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — build NextRequest-like objects with FormData
// ═══════════════════════════════════════════════════════════════════════════

function makeRequest(file: File | null): any {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return {
    formData: () => Promise.resolve(formData),
  }
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  // Create a buffer of the specified size
  const buffer = new Uint8Array(Math.min(sizeBytes, 1024)) // small actual content
  const blob = new Blob([buffer], { type })
  // Override size for testing large files
  const file = new File([blob], name, { type })
  if (sizeBytes > 1024) {
    Object.defineProperty(file, 'size', { value: sizeBytes })
  }
  return file
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/media/upload', () => {
  beforeEach(() => {
    mockWriteFile.mockClear()
    mockMkdir.mockClear()
  })

  it('rejects request with no file', async () => {
    const req = makeRequest(null)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/no file/i)
  })

  it('rejects non-image file types', async () => {
    const file = makeFile('exploit.exe', 'application/octet-stream', 1024)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/unsupported type/i)
  })

  it('rejects PDF files', async () => {
    const file = makeFile('document.pdf', 'application/pdf', 1024)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/unsupported type/i)
  })

  it('rejects files over 250MB', async () => {
    const oversize = 251 * 1024 * 1024 // 251MB
    const file = makeFile('huge.png', 'image/png', oversize)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/too large/i)
  })

  it('accepts valid PNG upload', async () => {
    const file = makeFile('screenshot.png', 'image/png', 500)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.url).toMatch(/^\/images\/img-\d+-[a-z0-9]+\.png$/)
    expect(json.name).toBe('screenshot.png')
    expect(json.type).toBe('image/png')
    expect(mockMkdir).toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalled()
  })

  it('accepts valid JPEG upload', async () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 800)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.url).toMatch(/\.jpg$/)
    expect(json.type).toBe('image/jpeg')
  })

  it('accepts valid WebP upload', async () => {
    const file = makeFile('image.webp', 'image/webp', 300)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.url).toMatch(/\.webp$/)
  })

  it('accepts files exactly at 250MB limit', async () => {
    const exactLimit = 250 * 1024 * 1024
    const file = makeFile('big.png', 'image/png', exactLimit)
    const req = makeRequest(file)
    const res = await POST(req)
    await res.json()
    expect(res.status).toBe(200)
  })

  it('accepts audio extensions that rely on extension fallback', async () => {
    const file = makeFile('voice-note.m4a', '', 2048)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.mediaType).toBe('audio')
    expect(json.url).toMatch(/\.m4a$/)
  })

  it('sanitizes filename to safe format', async () => {
    const file = makeFile('../../etc/passwd.png', 'image/png', 100)
    const req = makeRequest(file)
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    // The URL should NOT contain path traversal — it should be sanitized
    expect(json.url).not.toMatch(/\.\./)
    expect(json.url).toMatch(/^\/images\/img-/)
  })
})
