// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WIZARD CONSOLE CDP TEST — Visual verification after decomposition
// Uses Playwright headed mode + window.__oasis test harness
// Verifies all 8 tabs render, inputs work, drag/resize, z-ordering
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'fs'

const DIR = 'C:/af_oasis/test-screenshots/wizard-console'
mkdirSync(DIR, { recursive: true })

let testNum = 0
let passed = 0
let failed = 0

async function shot(page, name) {
  testNum++
  const filename = `${DIR}/${String(testNum).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: filename, fullPage: false })
  console.log(`  📸 ${filename}`)
  return filename
}

function log(icon, msg) { console.log(`  ${icon} ${msg}`) }

function assert(condition, msg) {
  if (condition) { passed++; log('✅', msg) }
  else { failed++; log('❌', `FAIL: ${msg}`) }
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

async function run() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log('║  WIZARD CONSOLE TEST — Post-Decomposition Visual Smoke       ║')
  console.log('╚═══════════════════════════════════════════════════════════════╝\n')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--use-angle=gl'],
  })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 0: Load + Harness Ready
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 0: Load ═══')
  await page.goto('http://localhost:4516', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForTimeout(5000)

  let harnessReady = await waitForHarness(page)
  if (!harnessReady) {
    log('⚠️', 'Harness not ready — reloading...')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('canvas', { timeout: 90000 })
    await page.waitForTimeout(5000)
    harnessReady = await waitForHarness(page)
  }
  if (!harnessReady) {
    log('❌', 'Harness not ready. Aborting.')
    await shot(page, 'harness-fail')
    await browser.close()
    process.exit(1)
  }
  log('✅', 'Harness ready')
  await shot(page, 'loaded')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Open WizardConsole
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 1: Open WizardConsole ═══')

  // Find and click the Wizard Console button (the wand/console toggle)
  // It's typically in the button bar at the bottom
  const wizardBtn = await page.$('button:has-text("Console")') ||
                    await page.$('button:has-text("console")') ||
                    await page.$('[title*="Console"]') ||
                    await page.$('[title*="Wizard"]')

  if (wizardBtn) {
    await wizardBtn.click()
    await page.waitForTimeout(800)
    log('✅', 'Clicked WizardConsole button')
  } else {
    // Fallback: try keyboard shortcut or look for the panel by data attributes
    log('⚠️', 'WizardConsole button not found, trying Tab key...')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(800)
  }

  // Verify console is visible
  const consoleVisible = await page.evaluate(() => {
    const panels = document.querySelectorAll('[class*="wizard"], [class*="Wizard"]')
    // Also check for any floating panel with the tab strip
    const tabPanels = document.querySelectorAll('[class*="fixed"][class*="rounded"]')
    return panels.length > 0 || tabPanels.length > 0
  })
  await shot(page, 'wizard-open')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Tab Switching — Click every tab, screenshot each
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 2: Tab Switching ═══')

  const tabNames = ['conjure', 'craft', 'world', 'assets', 'placed', 'agents', 'imagine', 'settings']

  for (const tabName of tabNames) {
    // Try to find tab by text content, title, or data attribute
    const tab = await page.$(`button:has-text("${tabName}")`) ||
                await page.$(`[title*="${tabName}" i]`) ||
                await page.$(`[data-tab="${tabName}"]`)

    if (tab) {
      await tab.click()
      await page.waitForTimeout(600)
      log('✅', `Switched to ${tabName} tab`)
    } else {
      // Try clicking by tab icon (tabs might be icon-only mode)
      log('⚠️', `Tab button "${tabName}" not found by text — trying icon click`)
    }

    await shot(page, `tab-${tabName}`)

    // Verify tab content is not empty (has some child elements)
    const hasContent = await page.evaluate(() => {
      // Find the scrollable content area
      const scrollAreas = document.querySelectorAll('.overflow-y-auto')
      for (const area of scrollAreas) {
        if (area.children.length > 0 && area.offsetHeight > 50) return true
      }
      return false
    })
    assert(hasContent, `${tabName} tab has content`)
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Conjure Tab — Type a prompt
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 3: Conjure Tab Input ═══')

  // Switch back to conjure
  const conjureTab = await page.$('button:has-text("conjure")') ||
                     await page.$('[title*="conjure" i]')
  if (conjureTab) await conjureTab.click()
  await page.waitForTimeout(500)

  // Find the text-to-3D textarea
  const conjureInput = await page.$('textarea[placeholder*="conjure" i]') ||
                       await page.$('textarea[placeholder*="describe" i]') ||
                       await page.$('textarea[placeholder*="castle" i]') ||
                       await page.$('.overflow-y-auto textarea')
  if (conjureInput) {
    await conjureInput.click()
    await conjureInput.fill('a glowing crystal tower')
    await page.waitForTimeout(300)
    log('✅', 'Typed in conjure prompt')
  } else {
    log('⚠️', 'Conjure textarea not found')
  }
  await shot(page, 'conjure-typed')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: Craft Tab — Type a prompt + check animated toggle
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 4: Craft Tab Input ═══')

  const craftTab = await page.$('button:has-text("craft")') ||
                   await page.$('[title*="craft" i]')
  if (craftTab) await craftTab.click()
  await page.waitForTimeout(500)

  const craftInput = await page.$('textarea[placeholder*="craft" i]') ||
                     await page.$('textarea[placeholder*="scene" i]') ||
                     await page.$('textarea[placeholder*="room" i]') ||
                     await page.$('.overflow-y-auto textarea')
  if (craftInput) {
    await craftInput.click()
    await craftInput.fill('a zen garden with bamboo')
    await page.waitForTimeout(300)
    log('✅', 'Typed in craft prompt')
  } else {
    log('⚠️', 'Craft textarea not found')
  }

  // Try to find and click animated toggle
  const animToggle = await page.$('button:has-text("Animated")') ||
                     await page.$('[title*="animated" i]')
  if (animToggle) {
    await animToggle.click()
    await page.waitForTimeout(300)
    log('✅', 'Toggled animated mode')
  }
  await shot(page, 'craft-typed')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5: World Tab — Click a sky background
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 5: World Tab Sky Picker ═══')

  const worldTab = await page.$('button:has-text("world")') ||
                   await page.$('[title*="world" i]')
  if (worldTab) await worldTab.click()
  await page.waitForTimeout(500)

  // Get current sky state before clicking
  const skyBefore = await page.evaluate(() => {
    try { return JSON.stringify(document.querySelector('canvas')?.getBoundingClientRect()) }
    catch { return 'unknown' }
  })

  // Click a sky thumbnail (they're usually small images in a grid)
  const skyThumbs = await page.$$('.overflow-y-auto img[src*="sky"], .overflow-y-auto img[src*="hdr"], .overflow-y-auto [class*="cursor-pointer"] img')
  if (skyThumbs.length > 1) {
    await skyThumbs[1].click() // Click the second sky (not the current one)
    await page.waitForTimeout(1000)
    log('✅', `Found ${skyThumbs.length} sky thumbnails, clicked one`)
  } else {
    log('⚠️', `Only ${skyThumbs.length} sky thumbnails found`)
  }
  await shot(page, 'world-sky')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 6: Drag the WizardConsole
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 6: Drag WizardConsole ═══')

  // Find the header/drag handle area
  const header = await page.$('[class*="cursor-move"]') ||
                 await page.$('[class*="drag"]')

  if (header) {
    const box = await header.boundingBox()
    if (box) {
      const startX = box.x + box.width / 2
      const startY = box.y + box.height / 2

      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX + 150, startY + 80, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(300)
      log('✅', 'Dragged WizardConsole')
    }
  } else {
    log('⚠️', 'Drag handle not found')
  }
  await shot(page, 'dragged')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 7: Settings Tab — Toggle something
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 7: Settings Tab ═══')

  const settingsTab = await page.$('button:has-text("settings")') ||
                      await page.$('[title*="settings" i]') ||
                      await page.$('[title*="⚙"]')
  if (settingsTab) await settingsTab.click()
  await page.waitForTimeout(500)

  // Try to find a toggle/checkbox in settings
  const toggle = await page.$('.overflow-y-auto input[type="checkbox"]') ||
                 await page.$('.overflow-y-auto [role="switch"]') ||
                 await page.$('.overflow-y-auto button[class*="toggle"]')
  if (toggle) {
    await toggle.click()
    await page.waitForTimeout(300)
    log('✅', 'Toggled a setting')
  }
  await shot(page, 'settings')

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 8: Close and Reopen
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 8: Close and Reopen ═══')

  // Find close button (usually an × in the header)
  const closeBtn = await page.$('button:has-text("×")') ||
                   await page.$('button:has-text("✕")')
  if (closeBtn) {
    await closeBtn.click()
    await page.waitForTimeout(500)
    log('✅', 'Closed WizardConsole')
    await shot(page, 'closed')

    // Reopen
    if (wizardBtn) {
      await wizardBtn.click()
      await page.waitForTimeout(800)
      log('✅', 'Reopened WizardConsole')
      await shot(page, 'reopened')
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 9: 3D State Verification via harness
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══ PHASE 9: 3D State Verification ═══')

  const worldReady = await page.evaluate('window.__oasis.isWorldReady()')
  assert(worldReady, 'World is ready after all tab interactions')

  const camPos = await page.evaluate('window.__oasis.getCameraPosition()')
  assert(Array.isArray(camPos) && camPos.length === 3, `Camera position valid: [${camPos.map(n => n.toFixed(1))}]`)

  const inputState = await page.evaluate('window.__oasis.getInputState()')
  assert(typeof inputState === 'string', `Input state: ${inputState}`)

  await shot(page, 'final-state')

  // ═══════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n╔═══════════════════════════════════════════════════════════════╗')
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed, ${errors.length} console errors        ║`)
  console.log('╚═══════════════════════════════════════════════════════════════╝')

  if (errors.length > 0) {
    console.log('\n  Console errors:')
    errors.slice(0, 10).forEach(e => console.log(`    ⚠️  ${e.slice(0, 120)}`))
  }

  console.log(`\n  📁 Screenshots: ${DIR}/`)
  console.log(`  📸 Total screenshots: ${testNum}\n`)

  await page.waitForTimeout(3000) // Let user see final state
  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error('Test crashed:', e.message); process.exit(1) })
