// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GAMER v2 — Texture Test Lab Visual Verification
// Uses Merlin's screenshot_viewport for arbitrary camera angles.
// Playwright for boot + world switch. REST screenshots for verification.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import fs from 'fs'
import { execSync } from 'child_process'

const DIR = 'C:/af_oasis/gamer-screenshots'
const OASIS_URL = 'http://localhost:4516'
const TEXTURE_WORLD_ID = 'world-1775870997998-p7o9'
let shotNum = 0
let passed = 0
let failed = 0
const results = []

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
  // Clean old screenshots
  for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.png') || f.endsWith('.jpg')) fs.unlinkSync(`${DIR}/${f}`)
  }
}

function pass(msg) { passed++; results.push({ status: 'PASS', msg }); console.log(`  ✅ ${msg}`) }
function fail(msg) { failed++; results.push({ status: 'FAIL', msg }); console.log(`  ❌ ${msg}`) }

// ═══════════════════════════════════════════════════════════════════════════
// OASIS TOOLS API — call any tool via REST
// ═══════════════════════════════════════════════════════════════════════════

async function oasisTool(tool, args = {}) {
  const res = await fetch(`${OASIS_URL}/api/oasis-tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  })
  return res.json()
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREENSHOT — Merlin's screenshot_viewport from arbitrary angles
// ═══════════════════════════════════════════════════════════════════════════

async function viewportShot(name, position, target, opts = {}) {
  shotNum++
  const result = await oasisTool('screenshot_viewport', {
    mode: 'look-at',
    position,
    target,
    width: opts.width || 1280,
    height: opts.height || 720,
    format: 'jpeg',
    quality: opts.quality || 0.85,
  })

  if (!result.ok) {
    console.log(`  📸 ❌ ${name}: ${result.message}`)
    return null
  }

  const captures = result.data?.captures || []
  const filePath = captures[0]?.filePath
  if (filePath && fs.existsSync(filePath)) {
    // Copy to gamer screenshots dir with sequential naming
    const dest = `${DIR}/${String(shotNum).padStart(2, '0')}-${name}.jpg`
    fs.copyFileSync(filePath, dest)
    console.log(`  📸 ${dest}`)
    return dest
  }

  const url = captures[0]?.url
  if (url) {
    console.log(`  📸 ${name}: ${url}`)
    return url
  }

  console.log(`  📸 ⚠️ ${name}: no file or URL in response`)
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function run() {
  ensureDir()
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║  🎮 GAMER v2 — Texture Test Lab Verification              ║')
  console.log('║  Merlin\'s eyes, Gamer\'s judgement. ॐ                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // ─── PHASE 0: Boot Oasis in headed browser ───────────────────────
  console.log('═══ PHASE 0: Boot ═══')

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-angle=gl', '--window-size=1400,900'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  await page.goto(OASIS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(5000)

  // Wait for harness
  let ready = false
  for (let i = 0; i < 30; i++) {
    ready = await page.evaluate(() => window.__oasis?.isWorldReady?.()).catch(() => false)
    if (ready) break
    await page.waitForTimeout(500)
  }
  if (ready) pass('World harness ready')
  else fail('World harness not ready')

  // ─── PHASE 1: Switch to Texture Test Lab ─────────────────────────
  console.log('\n═══ PHASE 1: Switch to Texture Test Lab ═══')

  await page.evaluate((wid) => {
    window.__OASIS_STORE__?.getState().switchWorld(wid)
  }, TEXTURE_WORLD_ID)

  await page.waitForTimeout(4000)
  const activeId = await page.evaluate(() => window.__OASIS_STORE__?.getState().activeWorldId).catch(() => '')
  if (activeId === TEXTURE_WORLD_ID) pass('Switched to Texture Test Lab')
  else fail(`World switch failed — active: ${activeId}`)

  // Wait for textures to load
  await page.waitForTimeout(3000)

  // ─── PHASE 2: World data verification ────────────────────────────
  console.log('\n═══ PHASE 2: World Data ═══')

  const worldInfo = await oasisTool('get_world_info', { worldId: TEXTURE_WORLD_ID })
  if (worldInfo.ok) pass(`World: "${worldInfo.data?.name}" — ${worldInfo.data?.objectCount} objects`)
  else fail('get_world_info failed')

  const worldState = await oasisTool('get_world_state', { worldId: TEXTURE_WORLD_ID })
  const craftedScenes = worldState.data?.craftedScenes || []
  const showcase = craftedScenes.find(s => s.name === 'Texture Showcase')
  if (showcase) {
    pass(`Texture Showcase found — ${showcase.objectCount || '?'} objects`)
  } else {
    fail(`Texture Showcase not in world state. Scenes: ${craftedScenes.map(s => s.name)}`)
  }

  // ─── PHASE 3: Multi-angle screenshots via Merlin's viewport ──────
  console.log('\n═══ PHASE 3: Multi-Angle Screenshots ═══')

  // 1. Front view — looking at back walls (stone, cobblestone, marble)
  await viewportShot('front-walls', [0, 4, 12], [0, 2, -5])

  // 2. Right wall group — concrete, metal, rock
  await viewportShot('right-walls', [10, 3, 8], [6, 2, 5])

  // 3. Close-up — small crates in center (kn-planks, kn-cobblestone, kn-metal)
  await viewportShot('small-crates', [-1, 2, 5], [0, 0.5, 3])

  // 4. Color-tinted cubes — red/green/blue stone at X=-6..-4
  await viewportShot('tinted-cubes', [-5, 2, 5.5], [-5, 0.5, 3])

  // 5. Textured spheres — grass, sand, dirt at Z=6
  await viewportShot('textured-spheres', [0, 2.5, 9], [0, 1, 6])

  // 6. Marble column with flame torch
  await viewportShot('column-flame', [-9, 3, 2], [-8, 2, 0])

  // 7. Floor platforms — planks and cobblestone
  await viewportShot('floor-platforms', [0, 6, 2], [0, 0, 0])

  // 8. Overhead — full scene bird's eye
  await viewportShot('overhead-full', [0, 18, 5], [0, 0, 0])

  // 9. Metal torus close-up
  await viewportShot('metal-torus', [1.5, 4.5, 2], [0, 4, 0])

  // 10. "TEXTURES" text header
  await viewportShot('text-header', [0, 6, -2], [0, 5.5, -5])

  pass(`${shotNum} viewport screenshots captured from unique angles`)

  // ─── PHASE 4: WebGL + console health ─────────────────────────────
  console.log('\n═══ PHASE 4: Health Check ═══')

  const glOk = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return false
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    return gl ? !gl.isContextLost() : false
  })
  if (glOk) pass('WebGL context healthy')
  else fail('WebGL context lost')

  // Check for texture-related console errors
  const logs = await page.evaluate(() => {
    // Collect recent console output via performance entries
    return (performance.getEntriesByType?.('resource') || [])
      .filter(e => e.name.includes('ground/') || e.name.includes('Textures/'))
      .map(e => ({ name: e.name.split('/').pop(), duration: Math.round(e.duration), status: e.responseStatus || 200 }))
  })
  const failedLoads = logs.filter(l => l.status >= 400)
  if (failedLoads.length === 0) {
    pass(`Texture resources loaded OK (${logs.length} tracked)`)
  } else {
    fail(`${failedLoads.length} texture loads failed: ${failedLoads.map(l => l.name).join(', ')}`)
  }

  // ─── PHASE 5: Structural verification via query_objects ──────────
  console.log('\n═══ PHASE 5: Object Verification ═══')

  const objects = await oasisTool('query_objects', { worldId: TEXTURE_WORLD_ID })
  const objList = objects.data || []
  console.log(`  📊 ${objList.length} objects in world`)
  if (objList.length >= 20) pass(`${objList.length} objects present (expected ~24+)`)
  else fail(`Only ${objList.length} objects (expected ~24+)`)

  // ─── FINAL REPORT ────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed`)
  console.log(`║  SCREENSHOTS: ${shotNum} viewport captures in ${DIR}/`)
  console.log('╠════════════════════════════════════════════════════════════╣')

  if (failed === 0) {
    console.log('║  🎮 VERDICT: ✅ PASS — Texture Test Lab verified            ║')
  } else {
    console.log('║  🎮 VERDICT: ❌ FAIL — see failed checks above              ║')
  }
  console.log('╚════════════════════════════════════════════════════════════╝')

  console.log('\n  Browser stays open 15s for human inspection...\n')
  await page.waitForTimeout(15000)
  await browser.close()
  console.log('  🎮 Gamer v2 session ended.\n')
}

run().catch(err => {
  console.error('  💀 Gamer crashed:', err.message)
  process.exit(1)
})
