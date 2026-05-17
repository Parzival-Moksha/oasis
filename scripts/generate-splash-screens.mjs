#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// generate-splash-screens.mjs
// ─═̷─═̷─🎴─═̷─═̷─  Bake 8 designs × 2 image models = 16 splash backgrounds
//                into public/splash/. Re-run any time you want fresh art.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'splash')

const MODELS = [
  { slug: 'nano2', id: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
  { slug: 'gpt2',  id: 'openai/gpt-5.4-image-2',                label: 'GPT Image 2' },
]

const DESIGNS = [
  {
    id: 'retrowave-rp1',
    label: 'Retrowave RP1',
    prompt: `Fullscreen 1980s retrowave neon poster, 16:9. Massive 3D chrome lettering "04515" centered (magenta and cyan gradient, glossy reflective metal). Behind the lettering, a half-sun with horizontal scan lines in pink and violet. Infinite teal chrome grid floor receding to a horizon. Palm tree silhouettes at edges. Deep starfield navy-black sky with a few sparkle stars. Tron-meets-Outrun aesthetic. No other text in the image. Ultra high quality cinematic game key art. Negative: watermarks, signatures, captions.`,
  },
  {
    id: 'wizards-atrium',
    label: 'Wizards Atrium',
    prompt: `Fullscreen dark-fantasy academy interior, 16:9. A leather-bound spellbook lying open on a dark oak desk. On the right page, the glyphs "0 4 5 1 5" burn in gold leaf as if freshly inscribed by spell. Ember particles float upward, candlelight flickers from off-frame. Parchment textures, ink wells, a brass astrolabe, blurred mahogany library shelves in deep background. Halliday's mystical archive aesthetic. Cinematic AAA game key art, ultra detail. No other text. Negative: watermarks, signatures, modern objects.`,
  },
  {
    id: 'agent-console',
    label: 'Agent Console',
    prompt: `Fullscreen retro CRT terminal, 16:9. Green-on-black phosphor monospace text filling the screen with realistic-looking boot log lines (mounting world registry, opening realtime channel, hydrating spellbook). Center-top: a giant ASCII-art block-rendering of the digits "04515" in box-drawing characters. Scanlines, slight CRT curvature, chromatic aberration on the edges. Bottom: a single line "[OASIS@NODE-01 ~] $ _" with a blinking cursor. Hacker terminal aesthetic. AAA cinematic. Negative: emoji, watermarks, modern UI chrome.`,
  },
  {
    id: 'carbon-silicon',
    label: 'Carbon-Silicon Unity',
    prompt: `Fullscreen cinematic illustration, 16:9. Four mythic figures standing shoulder to shoulder on a golden circular dais: a robed white-bearded wizard with a glowing staff, a hooded violet-cloaked mage, a crimson-armored warrior with a glowing claw gauntlet, a chrome winged messenger. Behind them, a colossal stone arch with the digits "04515" carved into the keystone. Molten gold sky bleeding into deep indigo, distant floating islands. Ready Player One meets Tolkien meets Tron. AAA game cover key art, ultra detail. No other text. Negative: watermarks, signatures.`,
  },
  {
    id: 'psychedelic-genesis',
    label: 'Psychedelic Genesis',
    prompt: `Fullscreen sacred geometry mandala, 16:9. Intricate Sri Yantra inspired design centered on a dark cosmic background. At the bullseye center, the digits "04515" glow gold like a sigil. Lotus petals, fractal recursion, interlocking triangles. Palette: vivid magenta, electric cyan, deep violet, molten gold. Slow-bloom luminescence. DMT-vision quality. Cinematic, no other text in image. Negative: watermarks, signatures, captions.`,
  },
  {
    id: 'cyber-datacenter',
    label: 'Cyberpunk Datacenter',
    prompt: `Fullscreen cyberpunk server room interior POV, 16:9. Looking down a long corridor of glowing server racks with neon green and magenta status LEDs. Glass floor with mirror reflections. Suspended overhead, a holographic blue sign reads "04515 // OASIS NODE 01" in clean tech typography. Volumetric fog, ray-traced reflections, rain on a glass ceiling. Tokyo Akihabara neon-noir aesthetic. AAA game cinematic, ultra detail. Negative: watermarks, signatures, people, real-world logos.`,
  },
  {
    id: 'halliday-workshop',
    label: 'Halliday Workshop',
    prompt: `Fullscreen 1980s teenage bedroom, 16:9. A beige CRT monitor on a cluttered wooden desk shows a low-poly 3D wireframe of an arch / castle world spinning. Walls have vintage Atari and Tron posters. On the desk: a Rubik's cube, D&D dungeon master screen, dirty Coke can, soldering iron, scattered floppy disks. A bright yellow Post-it note is stuck to the monitor frame with "04515" hand-scrawled in black marker. Dust motes float in golden afternoon light from a slatted blind. Ready Player One Halliday founder myth. Photoreal cinematic, nostalgic. Negative: text other than 04515, watermarks.`,
  },
  {
    id: 'living-threejs',
    label: 'Living Three.js',
    prompt: `Fullscreen low-poly procedural fantasy world mid-formation, 16:9. Geometric vertices and triangles popping into existence to build mountains, trees, and a winding river. In the foreground, a stone arch portal with "04515" carved into the keystone, glowing softly. Ethereal volumetric dawn light, magenta sky bleeding to indigo, distant floating islands. R3F / Three.js game engine aesthetic but rendered cinematically. Soul of a game world being conjured. AAA key art. No other text. Negative: watermarks, signatures, captions.`,
  },
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

// ═══════════════════════════════════════════════════════════════════════════════
// Image extraction — same strategy bag as /api/imagine for OpenRouter responses.
// ═══════════════════════════════════════════════════════════════════════════════
function extractImage(data) {
  const top = data.data
  if (Array.isArray(top)) {
    for (const item of top) {
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
      if (item?.url) return item.url
    }
  }
  const msg = data.choices?.[0]?.message
  if (msg) {
    const content = msg.content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'image_url' && part.image_url?.url) return part.image_url.url
        if (part?.type === 'image' && part.source?.data) {
          const mime = part.source.media_type || 'image/png'
          return `data:${mime};base64,${part.source.data}`
        }
        if (part?.type === 'text' && typeof part.text === 'string') {
          const m = part.text.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
          if (m) return m[0]
        }
      }
    }
    if (typeof content === 'string') {
      const m = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
      if (m) return m[0]
      const u = content.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp)/i)
      if (u) return u[0]
    }
    // Some OpenRouter models stuff the image into msg.images[].image_url.url
    if (Array.isArray(msg.images)) {
      for (const img of msg.images) {
        if (img?.image_url?.url) return img.image_url.url
        if (typeof img === 'string' && img.startsWith('data:image')) return img
      }
    }
  }
  // Deep scan
  const s = JSON.stringify(data)
  const m = s.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/)
  if (m) return m[0]
  const b = s.match(/"b64_json"\s*:\s*"([A-Za-z0-9+/=]{100,})"/)
  if (b) return `data:image/png;base64,${b[1]}`
  return null
}

async function generateOne(design, model, apiKey) {
  const body = {
    model: model.id,
    messages: [
      {
        role: 'user',
        content: `Generate an image: ${design.prompt} Output ONLY the image, no text.`,
      },
    ],
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://04515.xyz',
      'X-Title': 'Oasis Splash Bakery',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${text.slice(0, 240)}`)
  }
  const data = await res.json()
  const imageRef = extractImage(data)
  if (!imageRef) {
    throw new Error(`no image in response (keys: ${Object.keys(data).join(',')})`)
  }

  let buffer, mime
  if (imageRef.startsWith('http')) {
    const r = await fetch(imageRef)
    if (!r.ok) throw new Error(`download ${r.status}`)
    buffer = Buffer.from(await r.arrayBuffer())
    mime = r.headers.get('content-type') || 'image/png'
  } else {
    const m = imageRef.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (!m) throw new Error('bad data uri')
    mime = m[1]
    buffer = Buffer.from(m[2], 'base64')
  }
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  const filename = `${design.id}.${model.slug}.${ext}`
  fs.writeFileSync(path.join(OUT_DIR, filename), buffer)
  return { filename, bytes: buffer.length }
}

async function withRetry(fn, attempts = 3, delayMs = 4000) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastErr
}

async function runBatch(tasks, concurrency = 3) {
  const queue = tasks.slice()
  const results = []
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const t = queue.shift()
      if (!t) break
      const label = `${t.design.id} × ${t.model.slug}`
      try {
        const { filename, bytes } = await withRetry(() => generateOne(t.design, t.model, t.apiKey))
        console.log(`  ✓ ${label.padEnd(34)} → ${filename}  (${(bytes / 1024).toFixed(0)} KB)`)
        results.push({ ok: true, label, filename, bytes })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  ✗ ${label.padEnd(34)} FAILED: ${msg.slice(0, 200)}`)
        results.push({ ok: false, label, error: msg })
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  loadEnv()
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set — check .env / .env.local')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const onlyArg = process.argv.find(a => a.startsWith('--only='))
  const onlyIds = onlyArg ? onlyArg.slice('--only='.length).split(',') : null
  const modelArg = process.argv.find(a => a.startsWith('--model='))
  const onlyModels = modelArg ? modelArg.slice('--model='.length).split(',') : null

  const tasks = []
  for (const design of DESIGNS) {
    if (onlyIds && !onlyIds.includes(design.id)) continue
    for (const model of MODELS) {
      if (onlyModels && !onlyModels.includes(model.slug)) continue
      tasks.push({ design, model, apiKey })
    }
  }

  console.log(`\n░▒▓ Baking ${tasks.length} splash images → ${path.relative(ROOT, OUT_DIR)} ▓▒░\n`)
  const t0 = Date.now()
  const results = await runBatch(tasks, 3)
  const ok = results.filter(r => r.ok).length
  const fail = results.length - ok
  console.log(`\nॐ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. ${ok} baked, ${fail} failed.\n`)

  // Write a manifest so the frontend knows what's actually on disk.
  const manifest = {
    generatedAt: new Date().toISOString(),
    designs: DESIGNS.map(d => ({
      id: d.id,
      label: d.label,
      variants: MODELS.map(m => {
        const candidates = ['png', 'webp', 'jpg']
        for (const ext of candidates) {
          const fname = `${d.id}.${m.slug}.${ext}`
          if (fs.existsSync(path.join(OUT_DIR, fname))) {
            return { model: m.slug, modelLabel: m.label, url: `/splash/${fname}` }
          }
        }
        return { model: m.slug, modelLabel: m.label, url: null }
      }),
    })),
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`📜 wrote ${path.relative(ROOT, path.join(OUT_DIR, 'manifest.json'))}`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
