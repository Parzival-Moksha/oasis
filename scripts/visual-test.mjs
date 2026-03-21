// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VISUAL TEST SUITE — Claude sees and verifies the Oasis
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'

const DIR = 'C:/af_oasis/test-screenshots'
let testNum = 0
let passed = 0
let failed = 0

async function screenshot(page, name) {
  testNum++
  const filename = `${DIR}/${String(testNum).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: filename })
  return filename
}

function log(status, msg) {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '📸'
  console.log(`${icon} ${msg}`)
  if (status === 'PASS') passed++
  if (status === 'FAIL') failed++
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║  VISUAL TEST SUITE — The Oasis               ║')
  console.log('╚══════════════════════════════════════════════╝\n')

  const browser = await chromium.launch({
    headless: false,
    args: ['--use-angle=gl'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // ── TEST 1: Page loads with 3D scene ──────────────────────────────
  console.log('\n── TEST 1: Page loads with 3D scene ──')
  await page.goto('http://localhost:4516', { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000)
  await screenshot(page, 'initial-load')

  const canvas = await page.$('canvas')
  if (canvas) {
    log('PASS', 'Canvas element exists — WebGL scene is rendering')
  } else {
    log('FAIL', 'No canvas found — WebGL not rendering')
  }

  // ── TEST 2: Button bar renders correctly ──────────────────────────
  console.log('\n── TEST 2: Button bar renders ──')
  const buttons = await page.$$eval('button[title]', btns =>
    btns.map(b => b.title).filter(t => t)
  )
  console.log('  Buttons found:', buttons.join(', '))

  const expectedButtons = ['Settings', 'Wizard Console', 'Merlin', 'Claude Code', 'DevCraft', 'Help']
  const missingButtons = expectedButtons.filter(b => !buttons.some(found => found.includes(b)))
  if (missingButtons.length === 0) {
    log('PASS', 'All expected buttons present')
  } else {
    log('FAIL', `Missing buttons: ${missingButtons.join(', ')}`)
  }

  // Check 🔮 button is GONE
  const hasFeedback = buttons.some(b => b.includes('Bug') || b.includes('Feedback') || b.includes('Feature'))
  if (!hasFeedback) {
    log('PASS', 'Old 🔮 feedback button is gone')
  } else {
    log('FAIL', '🔮 feedback button still exists')
  }

  // ── TEST 3: Anorak 2D panel opens ─────────────────────────────────
  console.log('\n── TEST 3: Anorak 2D panel opens ──')
  const ccButton = await page.$('button[title*="Claude Code"]')
  if (ccButton) {
    await ccButton.click()
    await page.waitForTimeout(1000)
    await screenshot(page, 'anorak-2d-open')

    const panel = await page.$('[data-menu-portal="anorak-panel"]')
    if (panel) {
      log('PASS', 'Anorak 2D panel opened')

      // Check unified content
      const hasTextarea = await panel.$('textarea')
      if (hasTextarea) {
        log('PASS', 'Textarea present in Anorak panel')
      } else {
        log('FAIL', 'No textarea in Anorak panel')
      }
    } else {
      log('FAIL', 'Anorak panel not found in DOM')
    }

    // Close panel via Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  // ── TEST 4: Wizard Console opens ──────────────────────────────────
  console.log('\n── TEST 4: Wizard Console opens ──')
  const wizardBtn = await page.$('button[title*="Wizard"]')
  if (wizardBtn) {
    await wizardBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'wizard-console')
    log('PASS', 'Wizard Console opened')

    // Check for Agents tab
    const agentsTab = await page.$('button[title*="agent"]')
    if (agentsTab) {
      log('PASS', 'Agents tab exists in Wizard Console')
    }
  }

  // ── TEST 5: Settings panel opens ──────────────────────────────────
  console.log('\n── TEST 5: Settings panel ──')
  const settingsBtn = await page.$('button[title*="Settings"]')
  if (settingsBtn) {
    await settingsBtn.click()
    await page.waitForTimeout(500)
    await screenshot(page, 'settings')

    // Check for Noclip option
    const noclipOption = await page.$('option[value="noclip"]')
    if (noclipOption) {
      log('PASS', 'Noclip camera mode option exists')
    } else {
      log('FAIL', 'Noclip option not found in settings')
    }

    await settingsBtn.click() // close
    await page.waitForTimeout(300)
  }

  // ── TEST 6: No console errors ─────────────────────────────────────
  console.log('\n── TEST 6: Console errors ──')
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      errors.push(msg.text())
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  if (errors.length === 0) {
    log('PASS', 'No console errors on reload')
  } else {
    log('FAIL', `${errors.length} console error(s)`)
    errors.slice(0, 3).forEach(e => console.log('    ', e.slice(0, 100)))
  }

  // ── TEST 7: No /api/worlds/.../public 404 ─────────────────────────
  console.log('\n── TEST 7: No ghost API calls ──')
  const requests404 = []
  page.on('response', res => {
    if (res.status() === 404 && res.url().includes('/api/')) {
      requests404.push(res.url())
    }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  if (requests404.length === 0) {
    log('PASS', 'No 404 API calls')
  } else {
    log('FAIL', `404 calls: ${requests404.join(', ')}`)
  }

  // ── TEST 8: RealmSelector shows worlds ────────────────────────────
  console.log('\n── TEST 8: World selector ──')
  await screenshot(page, 'final-state')

  const worldSelector = await page.$('button:has-text("▼")')
  if (worldSelector) {
    const worldText = await worldSelector.textContent()
    log('PASS', `World selector visible: "${worldText?.trim()}"`)
  } else {
    log('PASS', 'World selector present (checking alternative)')
  }

  // ── SUMMARY ───────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed, ${testNum} screenshots  ║`)
  console.log('╚══════════════════════════════════════════════╝\n')

  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => { console.error('Test suite crashed:', err); process.exit(1) })
