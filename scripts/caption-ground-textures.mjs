// scripts/caption-ground-textures.mjs
// Vision-captions every ground preset that has a customTextureUrl, producing
// a 1-4 word `shortLabel` and one-sentence `description`. Writes back into
// data/ground-presets-extras.json so agents can pick textures by *what they
// actually look like* instead of by id substring.
//
// Uses Gemini Flash via @google/genai (GEMINI_API_KEY in .env).

import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GoogleGenAI } from '@google/genai'

// Tiny dotenv-replacement to avoid the dependency.
function loadEnv(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m || line.trim().startsWith('#')) continue
      const [, key, val] = m
      const trimmed = val.replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) process.env[key] = trimmed
    }
  } catch {}
}

loadEnv('c:/af_oasis/.env')
loadEnv('c:/af_oasis/.env.local')

const KEY = process.env.GEMINI_API_KEY
if (!KEY) throw new Error('GEMINI_API_KEY missing')
const ai = new GoogleGenAI({ apiKey: KEY })
const MODEL = 'gemini-2.5-flash'

const ROOT = 'c:/af_oasis'
const EXTRAS_PATH = path.join(ROOT, 'data', 'ground-presets-extras.json')
const PUBLIC_DIR = path.join(ROOT, 'public')

const PROMPT = [
  'You are labeling a small (128x128) tileable game ground/material texture for a 3D world editor.',
  'Output exactly ONE line in this format with no extra prose:',
  'SHORT: <1-4 words capturing the look> | DESC: <one short sentence, max 12 words>',
  'Examples:',
  'SHORT: Weathered Grey Bricks | DESC: Aged grey stone bricks with mossy mortar gaps.',
  'SHORT: Smooth Maple Planks | DESC: Pale yellow wood with fine vertical grain.',
  'SHORT: Cracked Red Sandstone | DESC: Coarse rusty-red rock with rough surface texture.',
  'Be concrete about color, surface roughness, and pattern. No flowery language.',
].join('\n')

async function readExtras() {
  return JSON.parse(await fs.readFile(EXTRAS_PATH, 'utf8'))
}

async function writeExtras(data) {
  await fs.writeFile(EXTRAS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function parseLine(text) {
  const cleaned = text.trim().replace(/^\*+\s*/, '').replace(/\n.*/s, '')
  const m = cleaned.match(/SHORT:\s*(.+?)\s*\|\s*DESC:\s*(.+)$/i)
  if (m) return { shortLabel: m[1].trim(), description: m[2].trim() }
  // Fallback: assume first ~4 words = short, rest = desc.
  const words = cleaned.split(/\s+/)
  return { shortLabel: words.slice(0, 4).join(' '), description: cleaned }
}

async function captionOne(absPath) {
  const buf = await fs.readFile(absPath)
  const inlineData = { mimeType: 'image/png', data: buf.toString('base64') }
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ inlineData }, { text: PROMPT }] }],
    // Disable thinking — these are simple visual labels, not a reasoning task.
    // Without this 2.5-flash burns the maxOutputTokens budget on hidden thoughts
    // and emits a truncated reply.
    config: { temperature: 0.2, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
  })
  return parseLine(res.text || res.candidates?.[0]?.content?.parts?.[0]?.text || '')
}

async function pLimit(jobs, concurrency) {
  const results = new Array(jobs.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= jobs.length) return
      try { results[i] = await jobs[i]() } catch (e) { results[i] = { error: String(e) } }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

async function main() {
  const extras = await readExtras()
  const targets = (extras.additions || []).filter(a => typeof a.customTextureUrl === 'string')
  const force = process.argv.includes('--force')
  const todo = targets.filter(a => force || !a.shortLabel || !a.description)
  console.log(`[caption] ${todo.length}/${targets.length} entries need captioning (force=${force})`)

  const jobs = todo.map(a => async () => {
    const rel = a.customTextureUrl.replace(/^\/+/, '')
    const abs = path.join(PUBLIC_DIR, rel)
    try {
      const cap = await captionOne(abs)
      a.shortLabel = cap.shortLabel
      a.description = cap.description
      // Update name to the human label too (so the UI looks better).
      if (cap.shortLabel) a.name = `SBS ${cap.shortLabel}`
      return { id: a.id, ok: true, ...cap }
    } catch (err) {
      return { id: a.id, ok: false, error: String(err) }
    }
  })

  let done = 0
  let saveCounter = 0
  const wrapped = jobs.map(j => async () => {
    const r = await j()
    done++
    saveCounter++
    if (r.ok) console.log(`[${done}/${jobs.length}] ${r.id} -> ${r.shortLabel}`)
    else console.warn(`[${done}/${jobs.length}] ${r.id} FAILED: ${r.error}`)
    if (saveCounter >= 25) {
      saveCounter = 0
      await writeExtras(extras)
    }
    return r
  })

  await pLimit(wrapped, 5)
  await writeExtras(extras)
  console.log('[caption] done — saved updates back to', EXTRAS_PATH)
}

main().catch(err => { console.error(err); process.exit(1) })
