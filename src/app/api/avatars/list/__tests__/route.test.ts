// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/avatars/list — filesystem scanner route tests
// ─═̷─═̷─ॐ─═̷─═̷─ verifies VRM-only filter, id/name derivation, fs access ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Mock fs BEFORE importing route — route binds fs.promises at module load
// ═══════════════════════════════════════════════════════════════════════════
vi.mock('fs', () => ({
  default: {
    promises: {
      access: vi.fn(),
      readdir: vi.fn(),
    },
  },
  promises: {
    access: vi.fn(),
    readdir: vi.fn(),
  },
}))

// Mock NextResponse.json — returns a plain object we can inspect in tests
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown) => ({
      status: 200,
      json: async () => body,
      _body: body,
    }),
  },
}))

import fs from 'fs'
import { GET, type DiskAvatarEntry } from '../route'

// ═══════════════════════════════════════════════════════════════════════════
// Dirent factory — mimics fs.Dirent with the predicates the route uses
// ═══════════════════════════════════════════════════════════════════════════
type FakeDirent = {
  name: string
  isFile: () => boolean
  isSymbolicLink: () => boolean
  isDirectory: () => boolean
}

function makeDirent(name: string, kind: 'file' | 'dir' | 'symlink'): FakeDirent {
  return {
    name,
    isFile: () => kind === 'file' || kind === 'symlink',
    isSymbolicLink: () => kind === 'symlink',
    isDirectory: () => kind === 'dir',
  }
}

const mockAccess = fs.promises.access as unknown as ReturnType<typeof vi.fn>
const mockReaddir = fs.promises.readdir as unknown as ReturnType<typeof vi.fn>

async function callRoute(): Promise<DiskAvatarEntry[]> {
  const res = await GET()
  // Using the mocked NextResponse shape from above
  return (res as unknown as { _body: DiskAvatarEntry[] })._body
}

describe('GET /api/avatars/list', () => {
  beforeEach(() => {
    mockAccess.mockReset()
    mockReaddir.mockReset()
  })

  it('returns [] when the gallery directory does not exist', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'))
    const body = await callRoute()
    expect(body).toEqual([])
    expect(mockReaddir).not.toHaveBeenCalled()
  })

  it('returns [] when readdir itself throws', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockRejectedValueOnce(new Error('EACCES'))
    const body = await callRoute()
    expect(body).toEqual([])
  })

  it('filters out non-.vrm files, directories, and symlinks', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('CoolAlien.vrm', 'file'),
      makeDirent('notes.txt', 'file'),
      makeDirent('model.glb', 'file'),
      makeDirent('thumbs', 'dir'),
      makeDirent('shortcut.vrm', 'symlink'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    expect(body).toHaveLength(1)
    expect(body[0].file).toBe('CoolAlien.vrm')
  })

  it('accepts uppercase .VRM extensions', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('Witch.VRM', 'file'),
      makeDirent('Juanita.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    expect(body.map(e => e.file).sort()).toEqual(['Juanita.vrm', 'Witch.VRM'])
  })

  it('derives ids by lowercasing and replacing non-alphanumerics with underscores', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('VIPE_Hero__2770.vrm', 'file'),
      makeDirent('Mr.vrm', 'file'),
      makeDirent('CaptainLobster.vrm', 'file'),
      makeDirent('Lady Fawn.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    const byFile = Object.fromEntries(body.map(e => [e.file, e]))
    expect(byFile['VIPE_Hero__2770.vrm'].id).toBe('vipe_hero_2770')
    expect(byFile['Mr.vrm'].id).toBe('mr')
    expect(byFile['CaptainLobster.vrm'].id).toBe('captainlobster')
    expect(byFile['Lady Fawn.vrm'].id).toBe('lady_fawn')
  })

  it('derives display names by replacing underscores/whitespace runs with single spaces', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('VIPE_Hero__2770.vrm', 'file'),
      makeDirent('CaptainLobster.vrm', 'file'),
      makeDirent('Lady Fawn.vrm', 'file'),
      makeDirent('Mr.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    const byFile = Object.fromEntries(body.map(e => [e.file, e]))
    expect(byFile['VIPE_Hero__2770.vrm'].name).toBe('VIPE Hero 2770')
    expect(byFile['CaptainLobster.vrm'].name).toBe('CaptainLobster')
    expect(byFile['Lady Fawn.vrm'].name).toBe('Lady Fawn')
    expect(byFile['Mr.vrm'].name).toBe('Mr')
  })

  it('strips the .vrm extension from the derived id', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('Witch.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])
    const body = await callRoute()
    expect(body[0].id).toBe('witch')
    expect(body[0].id.includes('vrm')).toBe(false)
  })

  it('sorts entries by display name using localeCompare', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('Zebra.vrm', 'file'),
      makeDirent('Alpha.vrm', 'file'),
      makeDirent('Mango.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    expect(body.map(e => e.name)).toEqual(['Alpha', 'Mango', 'Zebra'])
  })

  it('returns an empty array when the directory contains zero VRMs', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('README.md', 'file'),
      makeDirent('thumbs', 'dir'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    expect(body).toEqual([])
  })

  it('returns objects with exactly { id, file, name } shape', async () => {
    mockAccess.mockResolvedValueOnce(undefined)
    mockReaddir.mockResolvedValueOnce([
      makeDirent('Witch.vrm', 'file'),
    ] as unknown as import('fs').Dirent[])

    const body = await callRoute()
    expect(body).toHaveLength(1)
    const keys = Object.keys(body[0]).sort()
    expect(keys).toEqual(['file', 'id', 'name'])
  })
})
