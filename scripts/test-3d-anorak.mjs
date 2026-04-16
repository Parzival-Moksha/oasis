// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 3D ANORAK WINDOW TEST — Agentic visual test for Claudio's toes
// Uses window.__oasis test harness + Playwright screenshots
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(SCRIPT_DIR, '../test-screenshots/3d-anorak')
mkdirSync(DIR, { recursive: true })

let testNum = 0

async function shot(page, name) {
  testNum++
  const filename = `${DIR}/${String(testNum).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: filename, fullPage: false })
  console.log(`  📸 ${filename}`)
  return filename
}

async function harness(page, method, ...args) {
  const argsStr = args.map(a => JSON.stringify(a)).join(', ')
  return page.evaluate(`window.__oasis.${method}(${argsStr})`)
}

async function waitForHarness(page, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate('window.__oasis?.ready').catch(() => false)
    if (ready) return true
    await page.waitForTimeout(500)
  }
  return false
}

function log(icon, msg) { console.log(`  ${icon} ${msg}`) }

async function run() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║  3D ANORAK WINDOW TEST — The Padrino\'s Inspection            ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--use-angle=gl'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // Collect errors
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 0: Load + Harness Ready
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 0: Load ═══')
  await page.goto('http://localhost:4516', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForTimeout(5000) // Let R3F settle + HMR apply

  let harnessReady = await waitForHarness(page)
  if (!harnessReady) {
    log('⚠️', 'Harness not ready — reloading page to pick up HMR changes...')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('canvas', { timeout: 90000 })
    await page.waitForTimeout(5000)
    harnessReady = await waitForHarness(page)
  }
  if (!harnessReady) {
    log('❌', 'Test harness NOT ready after reload. Aborting.')
    await shot(page, 'harness-fail')
    await browser.close()
    process.exit(1)
  }
  log('✅', 'Test harness ready')

  // Clean up any stale agent windows from previous test runs
  const staleWindows = await harness(page, 'getPlacedAgentWindows')
  for (const w of staleWindows) {
    await harness(page, 'deleteObject', w.id)
  }
  if (staleWindows.length > 0) log('🧹', `Cleaned ${staleWindows.length} stale windows`)
  await page.waitForTimeout(300)

  await shot(page, 'loaded')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: ORBIT MODE — Place + Select + Focus + Interact
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 1: Orbit Mode ═══')

  // Switch to orbit mode
  await harness(page, 'setControlMode', 'orbit')
  await page.waitForTimeout(500)
  let inputState = await harness(page, 'getInputState')
  log(inputState === 'orbit' ? '✅' : '❌', `Control mode → orbit (inputState: ${inputState})`)

  // Place an anorak window
  const windowId = await harness(page, 'placeAgentWindow', 'anorak', [0, 3, 5])
  log('✅', `Placed anorak window: ${windowId}`)
  await page.waitForTimeout(1000) // Let it render
  await shot(page, 'orbit-placed')

  // Check windows list
  const windows = await harness(page, 'getPlacedAgentWindows')
  log(windows.length > 0 ? '✅' : '❌', `Agent windows count: ${windows.length}`)

  // Select the window
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(500)
  let selected = await harness(page, 'getSelectedObjectId')
  log(selected === windowId ? '✅' : '❌', `Selected: ${selected}`)
  await shot(page, 'orbit-selected')

  // Focus the window (zoomon)
  await harness(page, 'focusWindow', windowId)
  await page.waitForTimeout(2000) // Camera lerp duration is 1.2s
  inputState = await harness(page, 'getInputState')
  let focused = await harness(page, 'getFocusedWindowId')
  log(inputState === 'agent-focus' ? '✅' : '❌', `Input state after focus: ${inputState}`)
  log(focused === windowId ? '✅' : '❌', `Focused window: ${focused}`)

  const camPos = await harness(page, 'getCameraPosition')
  log('📍', `Camera position: [${camPos.map(n => n.toFixed(1)).join(', ')}]`)
  await shot(page, 'orbit-zoomon')

  // Check pointer is NOT locked (should be free for DOM interaction)
  const locked = await harness(page, 'isPointerLocked')
  log(!locked ? '✅' : '❌', `Pointer locked in zoomon: ${locked} (should be false)`)

  // Try to find the anorak window DOM content
  const anorakHeader = await page.$('.agent-window-3d')
  log(anorakHeader ? '✅' : '❌', `Anorak 3D window DOM element found: ${!!anorakHeader}`)

  // Try clicking inside the window area and typing
  // The 3D window uses CSS transform3d which confuses Playwright's element click.
  // Solution: get bounding box and click at computed coordinates, or use page.mouse.
  const textarea = await page.$('.agent-window-3d textarea')
  if (textarea) {
    // Focus the textarea via JS evaluation (bypasses CSS transform3d hit-test issues)
    await page.evaluate(() => {
      const ta = document.querySelector('.agent-window-3d textarea')
      if (ta) { ta.focus(); ta.click() }
    })
    await page.waitForTimeout(300)
    await page.keyboard.type('hello from playwright', { delay: 30 })
    await page.waitForTimeout(500)
    log('✅', 'Typed "hello from playwright" in textarea')
    await shot(page, 'orbit-typed')
  } else {
    log('⚠️', 'No textarea found in 3D window — checking for other inputs')
    const anyInput = await page.$('.agent-window-3d input, .agent-window-3d [contenteditable]')
    log(anyInput ? '⚠️' : '❌', `Alternative input element: ${!!anyInput}`)
    await shot(page, 'orbit-no-textarea')
  }

  // Try text selection (Ctrl+A to select all in textarea)
  if (textarea) {
    await page.evaluate(() => {
      const ta = document.querySelector('.agent-window-3d textarea')
      if (ta) ta.focus()
    })
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(300)
    await shot(page, 'orbit-text-selected')
    log('✅', 'Text selection attempted (Ctrl+A)')

    // Copy test
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(200)
    log('✅', 'Copy attempted (Ctrl+C)')
  }

  // Try scrolling inside the window
  if (anorakHeader) {
    const box = await anorakHeader.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 200) // scroll down
      await page.waitForTimeout(500)
      await shot(page, 'orbit-scrolled')
      log('✅', 'Scrolled inside 3D window')
    }
  }

  // Unfocus (escape)
  await harness(page, 'unfocusWindow')
  await page.waitForTimeout(1500)
  inputState = await harness(page, 'getInputState')
  focused = await harness(page, 'getFocusedWindowId')
  log(inputState !== 'agent-focus' ? '✅' : '❌', `After unfocus — inputState: ${inputState}`)
  log(!focused ? '✅' : '❌', `After unfocus — focusedWindowId: ${focused}`)
  await shot(page, 'orbit-unfocused')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: NOCLIP MODE — Same window, different camera mode
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 2: Noclip Mode ═══')

  await harness(page, 'setControlMode', 'noclip')
  await page.waitForTimeout(500)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'noclip' ? '✅' : '❌', `Noclip mode active (inputState: ${inputState})`)
  await shot(page, 'noclip-start')

  // Select + focus in noclip
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(300)
  await harness(page, 'focusWindow', windowId)
  await page.waitForTimeout(2000)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'agent-focus' ? '✅' : '❌', `Noclip → zoomon (inputState: ${inputState})`)
  await shot(page, 'noclip-zoomon')

  // Unfocus — should return to NOCLIP (not orbit)
  await harness(page, 'unfocusWindow')
  await page.waitForTimeout(1500)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'noclip' ? '✅' : '❌', `Returns to noclip after unfocus: ${inputState}`)
  await shot(page, 'noclip-returned')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: THIRD-PERSON MODE
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 3: Third-Person Mode ═══')

  await harness(page, 'setControlMode', 'third-person')
  await page.waitForTimeout(500)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'third-person' ? '✅' : '❌', `TPS mode active (inputState: ${inputState})`)
  await shot(page, 'tps-start')

  // Select + focus in TPS
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(300)
  await harness(page, 'focusWindow', windowId)
  await page.waitForTimeout(2000)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'agent-focus' ? '✅' : '❌', `TPS → zoomon (inputState: ${inputState})`)
  await shot(page, 'tps-zoomon')

  // Unfocus — should return to TPS
  await harness(page, 'unfocusWindow')
  await page.waitForTimeout(1500)
  inputState = await harness(page, 'getInputState')
  log(inputState === 'third-person' ? '✅' : '❌', `Returns to TPS after unfocus: ${inputState}`)
  await shot(page, 'tps-returned')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3b: FRAME TEST — set frames and check alignment in zoomon
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 3b: Frame Alignment ═══')

  await harness(page, 'setControlMode', 'orbit')
  await page.waitForTimeout(300)

  // Test with neon frame
  await harness(page, 'updateAgentWindow', windowId, { frameStyle: 'neon' })
  await page.waitForTimeout(500)
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(300)
  await harness(page, 'focusWindow', windowId)
  await page.waitForTimeout(2000)
  await shot(page, 'frame-neon-zoomon')
  log('📐', 'Neon frame zoomon captured — check frame alignment')

  await harness(page, 'unfocusWindow')
  await page.waitForTimeout(1500)

  // Test with gilded frame
  await harness(page, 'updateAgentWindow', windowId, { frameStyle: 'gilded' })
  await page.waitForTimeout(500)
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(300)
  await harness(page, 'focusWindow', windowId)
  await page.waitForTimeout(2000)
  await shot(page, 'frame-gilded-zoomon')
  log('📐', 'Gilded frame zoomon captured — check frame alignment')

  await harness(page, 'unfocusWindow')
  await page.waitForTimeout(1500)

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: KEYBOARD FLOW (real Enter/Escape key presses)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 4: Keyboard Enter/Escape ═══')

  // Go back to orbit + select window
  await harness(page, 'setControlMode', 'orbit')
  await page.waitForTimeout(500)
  await harness(page, 'selectObject', windowId)
  await page.waitForTimeout(500)

  // Press real Enter key — should trigger zoomon via TransformKeyHandler
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  inputState = await harness(page, 'getInputState')
  focused = await harness(page, 'getFocusedWindowId')
  log(inputState === 'agent-focus' ? '✅' : '❌', `Enter key → zoomon (inputState: ${inputState})`)
  log(focused === windowId ? '✅' : '❌', `Enter key → focused: ${focused}`)
  await shot(page, 'enter-zoomon')

  // Press real Escape key — should return to orbit
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  inputState = await harness(page, 'getInputState')
  focused = await harness(page, 'getFocusedWindowId')
  log(inputState !== 'agent-focus' ? '✅' : '❌', `Escape → back (inputState: ${inputState})`)
  log(!focused ? '✅' : '❌', `Escape → unfocused: ${focused}`)
  await shot(page, 'escape-back')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5: CLEANUP + REPORT
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 5: Cleanup ═══')

  // Remove the test window
  await harness(page, 'deleteObject', windowId)
  await page.waitForTimeout(500)
  const remainingWindows = await harness(page, 'getPlacedAgentWindows')
  log('🧹', `Cleaned up. Remaining windows: ${remainingWindows.length}`)
  await shot(page, 'cleaned')

  // Final error check
  const relevantErrors = errors.filter(e =>
    !e.includes('favicon') && !e.includes('Meshy') && !e.includes('404')
  )
  if (relevantErrors.length > 0) {
    console.log('\n⚠️  Console errors during test:')
    relevantErrors.forEach(e => console.log(`    ${e.slice(0, 120)}`))
  }

  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log(`║  DONE — Screenshots saved to ${DIR}`)
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  await browser.close()
}

run().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
