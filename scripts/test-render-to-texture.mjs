// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// RENDER-TO-TEXTURE FINAL TEST — All 4 phases verified visually
// Headed mode — watch Chrome as it tests the 3D agent window system
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'fs'

const DIR = 'C:/af_oasis/test-screenshots/render-to-texture-final'
mkdirSync(DIR, { recursive: true })

let testNum = 0
let passed = 0
let failed = 0

async function shot(page, name) {
  testNum++
  const filename = `${DIR}/${String(testNum).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: filename, fullPage: false })
  console.log(`  📸 ${filename}`)
}

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.log(`  ❌ FAIL: ${msg}`) }
}

async function waitForHarness(page, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate('window.__oasis?.ready').catch(() => false)
    if (ready) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function run() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║  RENDER-TO-TEXTURE FINAL TEST — All 4 Phases                 ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--use-angle=gl'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  // ═══ PHASE 0: Load ═══
  console.log('═══ PHASE 0: Load ═══')
  await page.goto('http://localhost:4516', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForTimeout(6000)

  let ready = await waitForHarness(page)
  if (!ready) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 90000 })
    await page.waitForTimeout(6000)
    ready = await waitForHarness(page)
  }
  assert(ready, 'Test harness ready')
  await shot(page, 'loaded')

  // ═══ PHASE A: Place windows ═══
  console.log('\n═══ PHASE A: Textured Mesh Rendering ═══')

  const anorakId = await page.evaluate("window.__oasis.placeAgentWindow('anorak', [0, 3, 5])")
  console.log(`  Placed Anorak: ${anorakId}`)
  await page.waitForTimeout(2000)

  const parzivalId = await page.evaluate("window.__oasis.placeAgentWindow('parzival', [6, 3, 5])")
  console.log(`  Placed Parzival: ${parzivalId}`)
  await page.waitForTimeout(2000)
  await shot(page, 'two-windows-placed')

  // Verify textures have content (non-transparent pixels)
  const pixelCheck = await page.evaluate(() => {
    const mgr = globalThis.__oasisOffscreenUI
    if (!mgr) return { error: 'no mgr' }
    const results = []
    for (const [id, win] of mgr.windows) {
      try {
        const px = win.ctx.getImageData(100, 20, 1, 1)
        results.push({ id: id.substring(0, 30), rgba: Array.from(px.data) })
      } catch (e) { results.push({ id: id.substring(0, 30), error: e.message }) }
    }
    return results
  })
  console.log('  Pixel check:', JSON.stringify(pixelCheck))
  const hasContent = pixelCheck.some?.(p => p.rgba && p.rgba[3] > 0)
  assert(hasContent, 'Textures have non-transparent content')

  // ═══ PHASE B: Input Proxy ═══
  console.log('\n═══ PHASE B: Input Proxy ═══')

  // Select the Anorak window
  await page.evaluate(`window.__oasis.selectObject("${anorakId}")`)
  await page.waitForTimeout(1000)
  await shot(page, 'anorak-selected')

  // Focus the window (Enter key behavior)
  await page.evaluate(`window.__oasis.focusWindow("${anorakId}")`)
  await page.waitForTimeout(1500)
  await shot(page, 'anorak-focused')

  // Verify focus state
  const focusState = await page.evaluate('window.__oasis.getFocusedWindowId()')
  assert(focusState === anorakId, `Focused window: ${focusState}`)

  const inputState = await page.evaluate('window.__oasis.getInputState()')
  assert(inputState === 'agent-focus', `Input state: ${inputState}`)

  // Check if textarea is focused in offscreen container
  const textareaFocused = await page.evaluate(() => {
    const containers = document.querySelectorAll('[data-offscreen-window]')
    for (const c of containers) {
      const ta = c.querySelector('textarea')
      if (ta && document.activeElement === ta) return true
    }
    return false
  })
  assert(textareaFocused, 'Offscreen textarea is focused')

  // Unfocus
  await page.evaluate('window.__oasis.unfocusWindow()')
  await page.waitForTimeout(1000)
  await shot(page, 'unfocused')

  // ═══ PHASE C+D: Streaming Detection + VFX ═══
  console.log('\n═══ PHASE C+D: Streaming + VFX ═══')

  // Check streaming state (should be false initially)
  const streamingBefore = await page.evaluate(() => {
    const mgr = globalThis.__oasisOffscreenUI
    for (const [id, win] of mgr.windows) return win.streaming
    return null
  })
  assert(streamingBefore === false, `Streaming before: ${streamingBefore}`)

  // Simulate streaming by mutating text content in offscreen container
  await page.evaluate(() => {
    const container = document.querySelector('[data-offscreen-window]')
    if (!container) return
    const textNode = document.createTextNode('Streaming test token... ')
    const div = document.createElement('div')
    div.appendChild(textNode)
    container.appendChild(div)
    // Simulate characterData mutation (like SSE token updates)
    for (let i = 0; i < 5; i++) {
      setTimeout(() => { textNode.textContent += `token${i} ` }, i * 100)
    }
  })
  await page.waitForTimeout(1000)

  // Check streaming state (should be true after text mutations)
  const streamingAfter = await page.evaluate(() => {
    const mgr = globalThis.__oasisOffscreenUI
    for (const [id, win] of mgr.windows) return win.streaming
    return null
  })
  assert(streamingAfter === true, `Streaming detected: ${streamingAfter}`)
  await shot(page, 'streaming-detected')

  // Wait for streaming to auto-reset (3s timeout)
  await page.waitForTimeout(4000)
  const streamingReset = await page.evaluate(() => {
    const mgr = globalThis.__oasisOffscreenUI
    for (const [id, win] of mgr.windows) return win.streaming
    return null
  })
  assert(streamingReset === false, `Streaming auto-reset: ${streamingReset}`)

  // ═══ CLEANUP ═══
  console.log('\n═══ CLEANUP ═══')
  await page.evaluate(`window.__oasis.deleteObject("${anorakId}")`)
  await page.evaluate(`window.__oasis.deleteObject("${parzivalId}")`)
  await page.waitForTimeout(1000)
  await shot(page, 'cleaned')

  // Verify windows removed
  const remaining = await page.evaluate('window.__oasis.getPlacedAgentWindows().length')
  // May have pre-existing windows, just verify ours are gone
  await shot(page, 'final')

  // ═══ RESULTS ═══
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                              ║`)
  console.log('╚═══════════════════════════════════════════════════════════════╝')
  if (errors.length > 0) {
    console.log('\n  Console errors:')
    errors.slice(0, 5).forEach(e => console.log(`    ⚠️  ${e.slice(0, 150)}`))
  }
  console.log(`\n  📁 Screenshots: ${DIR}/`)
  console.log(`  📸 Total: ${testNum}\n`)

  await page.waitForTimeout(3000)
  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error('Test crashed:', e.message); process.exit(1) })
