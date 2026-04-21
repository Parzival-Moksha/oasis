// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/avatars/list — Runtime disk scan of public/avatars/gallery/*.vrm
// ─═̷─═̷─ॐ─═̷─═̷─ Drop a VRM in the folder, the Oasis auto-assimilates ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const GALLERY_DIR = path.join(process.cwd(), 'public', 'avatars', 'gallery')

export interface DiskAvatarEntry {
  id: string
  file: string
  name: string
}

function fileToId(filename: string): string {
  return filename
    .replace(/\.vrm$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function fileToDisplayName(filename: string): string {
  const base = filename.replace(/\.vrm$/i, '')
  return base
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET() {
  try {
    try { await fs.promises.access(GALLERY_DIR) } catch { return NextResponse.json([]) }
    const dirents = await fs.promises.readdir(GALLERY_DIR, { withFileTypes: true })
    // Reject symlinks — static file serving would follow them and leak adjacent files.
    const entries: DiskAvatarEntry[] = dirents
      .filter(d => d.isFile() && !d.isSymbolicLink() && d.name.toLowerCase().endsWith('.vrm'))
      .map(d => ({
        id: fileToId(d.name),
        file: d.name,
        name: fileToDisplayName(d.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json(entries)
  } catch {
    return NextResponse.json([])
  }
}
