// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SCENE LIBRARY API — Crafted scenes that outlive their worlds
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/worlds/scene-library  — All saved scenes
//   PUT  /api/worlds/scene-library  — Update entire library
//   POST /api/worlds/scene-library  — Add a scene (deduplicates)
//
// ░▒▓█ SCENE LIBRARY ROUTE █▓▒░

import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CraftedScene } from '@/lib/conjure/types'

const DATA_DIR = join(process.cwd(), 'data')
const LIBRARY_PATH = join(DATA_DIR, 'scene-library.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadLibrary(): CraftedScene[] {
  ensureDir()
  if (!existsSync(LIBRARY_PATH)) return []
  try {
    return JSON.parse(readFileSync(LIBRARY_PATH, 'utf-8')) as CraftedScene[]
  } catch { return [] }
}

function saveLibrary(scenes: CraftedScene[]): void {
  ensureDir()
  writeFileSync(LIBRARY_PATH, JSON.stringify(scenes, null, 2), 'utf-8')
}

// GET — all scenes
export async function GET() {
  return NextResponse.json(loadLibrary())
}

// PUT — replace entire library (for delete operations)
export async function PUT(request: Request) {
  try {
    const body = await request.json() as CraftedScene[]
    saveLibrary(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST — add or update a scene (upsert by id)
export async function POST(request: Request) {
  try {
    const scene = await request.json() as CraftedScene
    const library = loadLibrary()
    const existing = library.findIndex(s => s.id === scene.id)
    if (existing >= 0) {
      library[existing] = scene
    } else {
      library.push(scene)
    }
    saveLibrary(library)
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ▓▓▓▓【S̸C̸E̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【L̸I̸B̸R̸A̸R̸Y̸】▓▓▓▓
