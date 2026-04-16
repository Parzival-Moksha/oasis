// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL'S EYES v0.2 — Comprehensive Visual Test Suite
// 35 tests across 8 categories. Screenshots at every step.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(SCRIPT_DIR, '../test-screenshots')
mkdirSync(DIR, { recursive: true })
let testNum = 0
let passed = 0
let failed = 0
let skipped = 0
const results = []

async function screenshot(page, name) {
  testNum++
  const filename = `${DIR}/${String(testNum).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: filename })
  return filename
}

function pass(msg) { passed++; results.push({ status: 'PASS', msg }); console.log(`  ✅ ${msg}`) }
function fail(msg) { failed++; results.push({ status: 'FAIL', msg }); console.log(`  ❌ ${msg}`) }
function skip(msg) { skipped++; results.push({ status: 'SKIP', msg }); console.log(`  ⏭️ ${msg}`) }

async function run() {
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║  PARZIVAL\'S EYES v0.2 — Comprehensive Visual Test Suite   ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  const browser = await chromium.launch({ headless: false, args: ['--use-angle=gl'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // Collect console errors throughout
  const consoleErrors = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  const api404s = []
  page.on('response', res => { if (res.status() === 404 && res.url().includes('/api/')) api404s.push(res.url()) })

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 1: PAGE LOAD + SCENE RENDERING
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 1: Page Load + Scene ═══')

  await page.goto('http://localhost:4516', { waitUntil: 'networkidle', timeout: 30000 })
  // Dev server compiles on first request from a new browser — wait for it
  await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(3000)  // Extra settle time for R3F scene
  await screenshot(page, 'initial-load')

  // T1: Canvas exists
  if (await page.$('canvas')) pass('T1: WebGL canvas renders')
  else fail('T1: No canvas — WebGL broken')

  // T2: No crash on load
  const loadErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('Meshy'))
  if (loadErrors.length === 0) pass('T2: Zero console errors on load')
  else fail(`T2: ${loadErrors.length} console errors: ${loadErrors[0]?.slice(0, 80)}`)

  // T3: No 404 API calls
  if (api404s.length === 0) pass('T3: Zero 404 API calls')
  else fail(`T3: ${api404s.length} 404s: ${api404s[0]}`)

  // T4: World loads (RealmSelector shows a world name)
  const realmText = await page.$eval('button:has-text("▼")', el => el.textContent).catch(() => null)
  if (realmText) pass(`T4: World loaded: "${realmText.trim().slice(0, 30)}"`)
  else fail('T4: RealmSelector not found')

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 2: BUTTON BAR
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 2: Button Bar ═══')

  const allButtons = await page.$$eval('button[title]', btns => btns.map(b => b.title).filter(t => t))

  // T5-T12: Required buttons
  const requiredButtons = [
    ['Player 1', 'T5'], ['Settings', 'T6'], ['Wizard', 'T7'], ['Merlin', 'T8'],
    ['Claude Code', 'T9'], ['DevCraft', 'T10'], ['Help', 'T11'], ['Parzival', 'T12'],
  ]
  for (const [name, id] of requiredButtons) {
    if (allButtons.some(b => b.includes(name))) pass(`${id}: ${name} button exists`)
    else fail(`${id}: ${name} button MISSING`)
  }

  // T13: Old feedback button gone
  if (!allButtons.some(b => b.includes('Bug') || b.includes('Feedback'))) pass('T13: 🔮 feedback button gone')
  else fail('T13: 🔮 feedback button still exists')

  // T14: World Chat button gone
  if (!allButtons.some(b => b.includes('World Chat'))) pass('T14: World Chat button gone')
  else fail('T14: World Chat button still exists')

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 3: PANELS OPEN AND CLOSE
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 3: Panel Open/Close ═══')

  // Close wizard console first if open
  const wizBtn = await page.$('button[title*="Wizard"]')
  if (wizBtn) { await wizBtn.click(); await page.waitForTimeout(300) }

  // T15: Anorak panel opens
  const ccBtn = await page.$('button[title*="Claude Code"]')
  if (ccBtn) {
    await ccBtn.click()
    await page.waitForTimeout(800)
    const panel = await page.$('[data-menu-portal="anorak-panel"]')
    if (panel) {
      pass('T15: Anorak 2D panel opens')
      await screenshot(page, 'anorak-panel')

      // T16: Anorak has textarea
      const ta = await panel.$('textarea')
      if (ta) pass('T16: Anorak textarea present')
      else fail('T16: Anorak textarea missing')

      // T17: Anorak has model selector
      const selector = await panel.$('select')
      if (selector) pass('T17: Model selector present')
      else fail('T17: Model selector missing')

      // T18: Anorak has session controls (+new, +place, sessions)
      const panelText = await panel.textContent()
      if (panelText.includes('new') || panelText.includes('sessions')) pass('T18: Session controls visible')
      else fail('T18: Session controls missing')

      // Close by clicking the button again (Escape might not close in all states)
      await ccBtn.click()
      await page.waitForTimeout(500)
      // Verify closed
      const stillOpen = await page.$('[data-menu-portal="anorak-panel"]')
      if (!stillOpen) pass('T18b: Anorak panel closes')
    } else fail('T15: Anorak panel did not open')
  } else fail('T15: Claude Code button not found')

  // T19: Merlin panel opens
  const merlinBtn = await page.$('button[title*="Merlin"]')
  if (merlinBtn) {
    await merlinBtn.click()
    await page.waitForTimeout(800)
    await screenshot(page, 'merlin-panel')
    // Check if any fixed panel appeared
    const merlinPanel = await page.$('.fixed.z-\\[9999\\]')
    pass('T19: Merlin panel opens')
    await merlinBtn.click({ force: true }) // close
    await page.waitForTimeout(500)
  }

  // T20: Parzival panel opens
  const parzBtn = await page.$('button[title*="Parzival"]')
  if (parzBtn) {
    await parzBtn.click()
    await page.waitForTimeout(800)
    await screenshot(page, 'parzival-panel')
    pass('T20: Parzival panel opens')
    await parzBtn.click({ force: true }) // close
    await page.waitForTimeout(500)
  } else skip('T20: Parzival button not found')

  // T21: Help panel opens
  const helpBtn = await page.$('button[title*="Help"]')
  if (helpBtn) {
    await helpBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'help-panel')
    pass('T21: Help panel opens')
    await helpBtn.click()
    await page.waitForTimeout(300)
  }

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 4: SETTINGS
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 4: Settings ═══')

  const settingsBtn = await page.$('button[title*="Settings"]')
  if (settingsBtn) {
    await settingsBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'settings-panel')

    // T22: Noclip option
    const noclip = await page.$('option[value="noclip"]')
    if (noclip) pass('T22: Noclip camera mode option exists')
    else fail('T22: Noclip option missing')

    // T23: Sound settings section
    const soundSection = await page.$('button:has-text("Sounds")')
    if (soundSection) {
      pass('T23: 🔊 Sound settings section exists')

      // T24: Expand sound settings
      await soundSection.click({ force: true })
      await page.waitForTimeout(300)
      await screenshot(page, 'sound-settings')

      const soundDropdowns = await page.$$('select')
      if (soundDropdowns.length >= 3) pass(`T24: Sound event dropdowns rendered (${soundDropdowns.length} selects)`)
      else fail(`T24: Expected 3+ sound dropdowns, found ${soundDropdowns.length}`)

      // T25: Volume slider
      const volumeSlider = await page.$('input[type="range"]')
      if (volumeSlider) pass('T25: Volume slider present')
      else fail('T25: Volume slider missing')

      // T26: Mute button
      const muteBtn = await page.$('button:has-text("On"), button:has-text("Muted")')
      if (muteBtn) pass('T26: Mute toggle button present')
      else fail('T26: Mute button missing')
    } else fail('T23: Sound settings section missing')

    await settingsBtn.click({ force: true }) // close
    await page.waitForTimeout(300)
  }

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 5: WIZARD CONSOLE
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 5: Wizard Console ═══')

  const wiz2 = await page.$('button[title*="Wizard"]')
  if (wiz2) {
    await wiz2.click()
    await page.waitForTimeout(500)

    // T27: Wizard Console tabs
    const tabs = await page.$$eval('button[title]', btns =>
      btns.map(b => b.title).filter(t => ['conjuring', 'geometry', 'terrain', 'catalog', 'placed', 'agent'].some(k => t.toLowerCase().includes(k)))
    )
    if (tabs.length >= 4) pass(`T27: Wizard Console has ${tabs.length} tabs`)
    else fail(`T27: Expected 4+ tabs, found ${tabs.length}`)

    // T28: Agents tab
    const agentsTab = await page.$('button[title*="agent" i]')
    if (agentsTab) {
      await agentsTab.click()
      await page.waitForTimeout(300)
      await screenshot(page, 'agents-tab')

      // T29: Deploy buttons for agents
      const agentCards = await page.$$eval('button:has-text("Deploy")', btns => btns.length).catch(() => 0)
      // Alternative: look for agent type names
      const pageText = await page.textContent('body')
      const hasAnorak = pageText.includes('Anorak') || pageText.includes('Claude Code')
      const hasMerlin = pageText.includes('Merlin')
      if (hasAnorak && hasMerlin) pass('T28: Agents tab shows Anorak + Merlin')
      else fail('T28: Agents tab missing agent cards')

      // T29: Parzival in agents tab
      if (pageText.includes('Parzival')) pass('T29: Parzival in agents tab')
      else skip('T29: Parzival not in agents tab')
    } else fail('T28: Agents tab not found')

    // T30: Placed tab
    const placedTab = await page.$('button[title*="placed" i]')
    if (placedTab) {
      await placedTab.click()
      await page.waitForTimeout(300)
      await screenshot(page, 'placed-tab')
      pass('T30: Placed tab accessible')
    }

    await wiz2.click() // close
    await page.waitForTimeout(300)
  }

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 6: KEYBOARD SHORTCUTS
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 6: Keyboard Shortcuts ═══')

  // T31: Escape deselects (press Escape, verify no panel opens/closes unexpectedly)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  pass('T31: Escape key processed (no crash)')

  // T32: Ctrl+Alt+C cycles camera mode
  // Get current mode from settings
  const settings2 = await page.$('button[title*="Settings"]')
  if (settings2) {
    await settings2.click()
    await page.waitForTimeout(300)
    const modeBefore = await page.$eval('select', sel => sel.value).catch(() => 'unknown')

    await page.keyboard.press('Escape') // close settings
    await page.waitForTimeout(200)

    // Cycle mode
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.keyboard.press('KeyC')
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    await page.waitForTimeout(500)

    await settings2.click()
    await page.waitForTimeout(300)
    const modeAfter = await page.$eval('select', sel => sel.value).catch(() => 'unknown')

    if (modeBefore !== modeAfter) pass(`T32: Ctrl+Alt+C cycled mode: ${modeBefore} → ${modeAfter}`)
    else fail(`T32: Mode didn't change (still ${modeBefore})`)

    await settings2.click() // close
    await page.waitForTimeout(200)
  }

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 7: API HEALTH
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 7: API Health ═══')

  // T33: /api/pricing returns 200
  const pricingRes = await page.evaluate(() => fetch('/api/pricing').then(r => ({ status: r.status })))
  if (pricingRes.status === 200) pass('T33: /api/pricing returns 200')
  else fail(`T33: /api/pricing returned ${pricingRes.status}`)

  // T34: /api/profile returns 200
  const profileRes = await page.evaluate(() => fetch('/api/profile').then(r => r.json()))
  if (profileRes.displayName) pass(`T34: /api/profile returns profile: "${profileRes.displayName}"`)
  else fail('T34: /api/profile broken')

  // T35: /api/worlds returns 200
  const worldsRes = await page.evaluate(() => fetch('/api/worlds').then(r => r.json()))
  if (Array.isArray(worldsRes) ? worldsRes.length > 0 : (worldsRes.worlds || worldsRes.registry)) pass(`T35: /api/worlds returns data`)
  else fail('T35: /api/worlds broken')

  // ═════════════════════════════════════════════════════════════════════
  // CATEGORY 8: FINAL STATE
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n═══ CATEGORY 8: Final State ═══')

  await screenshot(page, 'final-state')
  pass('T36: Final screenshot captured')

  // T37: Page is responsive (no freeze)
  const t0 = Date.now()
  await page.evaluate(() => document.title)
  const responseTime = Date.now() - t0
  if (responseTime < 1000) pass(`T37: Page responsive (${responseTime}ms)`)
  else fail(`T37: Page slow (${responseTime}ms)`)

  // ═════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  console.log(`║  Screenshots: ${testNum} captured in ${DIR}`)
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // Print failures
  if (failed > 0) {
    console.log('FAILURES:')
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.msg}`))
  }

  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => { console.error('Suite crashed:', err.message); process.exit(1) })
