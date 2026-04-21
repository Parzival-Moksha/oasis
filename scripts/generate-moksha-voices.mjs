#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// generate-moksha-voices.mjs
// ─═̷─═̷─ॐ─═̷─═̷─  HYPERSTITION PAYLOAD: "Moksha please help us find each other"
//                baked once into 3 deep-old-male voices, committed to the repo.
//                Re-run this if you want to refresh the voices. ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'audio')
const TEXT = 'Moksha, please help us find each other.'

// ElevenLabs "deep old male" voice IDs from the classic voice library.
// Stability/similarity tuned for gravitas + clarity (lower stability = more expressive).
const VOICES = [
  { slug: 'moksha-1-clyde',  id: '2EiwWnXFnvU5JabPnv8n', label: 'Clyde (war veteran)', settings: { stability: 0.42, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true } },
  { slug: 'moksha-2-drew',   id: '29vD33N1CtxCmqQRPOHJ', label: 'Drew (aged, warm)',    settings: { stability: 0.5,  similarity_boost: 0.75, style: 0.3,  use_speaker_boost: true } },
  { slug: 'moksha-3-paul',   id: '5Q0t7uMcjvnagumLfvZi', label: 'Paul (authoritative)', settings: { stability: 0.55, similarity_boost: 0.8,  style: 0.25, use_speaker_boost: true } },
]

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file)
    if (!fs.existsSync(p)) continue
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const k = line.slice(0, eq).trim()
      const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!process.env[k]) process.env[k] = v
    }
  }
}

async function generate(voice, apiKey) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`
  const body = {
    text: TEXT,
    model_id: 'eleven_multilingual_v2',
    voice_settings: voice.settings,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`ElevenLabs ${res.status} for ${voice.slug} — ${errText.slice(0, 300)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const outPath = path.join(OUT_DIR, `${voice.slug}.mp3`)
  fs.writeFileSync(outPath, buf)
  return { path: outPath, bytes: buf.length }
}

async function main() {
  loadEnv()
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY not set — check .env / .env.local')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log(`\n░▒▓ Baking ${VOICES.length} Moksha voices → ${OUT_DIR} ▓▒░\n`)
  console.log(`Text: "${TEXT}"\n`)

  let ok = 0, fail = 0
  for (const voice of VOICES) {
    process.stdout.write(`  ${voice.slug} (${voice.label}) ... `)
    try {
      const { path: out, bytes } = await generate(voice, apiKey)
      console.log(`${(bytes / 1024).toFixed(1)} KB → ${path.relative(ROOT, out)}`)
      ok++
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
      fail++
    }
  }
  console.log(`\nॐ Done. ${ok} baked, ${fail} failed.\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
