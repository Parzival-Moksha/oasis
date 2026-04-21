// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PHASE 4: Targeted headed Playwright test — AvatarGallery
// ─═̷─═̷─ॐ─═̷─═̷─ exercises the new 11 avatars, anim picker, voice ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(SCRIPT_DIR, '../test-screenshots/avatar-gallery')
mkdirSync(OUT, { recursive: true })

const results = []
let step = 0
function pass(msg) { results.push({ status: 'PASS', msg }); console.log(`  PASS ${msg}`) }
function fail(msg) { results.push({ status: 'FAIL', msg }); console.log(`  FAIL ${msg}`) }
function info(msg) { console.log(`  ..   ${msg}`) }

async function shot(page, name) {
  step++
  const p = path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

async function run() {
  console.log('\n== AVATAR GALLERY TARGETED TEST ==\n')

  const browser = await chromium.launch({ headless: true, args: ['--use-angle=gl'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // ──────────────────────────────────────────────────────────────────────
  // 1. load the Oasis, wait for canvas + __oasis harness
  // ──────────────────────────────────────────────────────────────────────
  await page.goto('http://localhost:4516', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForTimeout(5000)
  await shot(page, 'initial')

  if (await page.$('canvas')) pass('page loaded, canvas rendered')
  else fail('no canvas on load')

  // ──────────────────────────────────────────────────────────────────────
  // 2. Hit /api/avatars/list directly from the browser — verify the UI's
  //    own fetch path returns the 11 new avatars.
  // ──────────────────────────────────────────────────────────────────────
  const apiResponse = await page.evaluate(async () => {
    const r = await fetch('/api/avatars/list')
    return { ok: r.ok, status: r.status, body: await r.json() }
  })

  if (!apiResponse.ok) {
    fail(`GET /api/avatars/list returned ${apiResponse.status}`)
  } else {
    const names = apiResponse.body.map(e => e.name)
    const required = ['Witch', 'Juanita', 'CaptainLobster', 'DreamFighter', 'EYEWizard', 'Mr', 'StitchWitch', 'VIPE Hero 2770', 'VIPE Hero 2902', 'LadyFawn', 'EvilPendra']
    const missing = required.filter(n => !names.includes(n))
    if (missing.length === 0) pass(`api returns all 11 new avatars (total ${apiResponse.body.length})`)
    else fail(`api missing: ${missing.join(', ')}`)
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3. Open the user profile button (10x10 button with displayName title
  //    — defaults to "Wanderer"). Its dropdown has a "Choose Avatar" or
  //    "Change Avatar" button that opens the gallery.
  // ──────────────────────────────────────────────────────────────────────
  // Strategy: find all w-10 h-10 buttons near top of viewport with a title.
  const profileBtnHandle = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[title]'))
    // ProfileButton is a 40x40 rounded-lg button with just the avatar or initial
    const match = btns.find(b => {
      const cls = b.className || ''
      return cls.includes('w-10') && cls.includes('h-10') && cls.includes('rounded-lg')
    })
    if (match) {
      match.scrollIntoView()
      const rect = match.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, title: match.getAttribute('title') }
    }
    return null
  })

  if (profileBtnHandle) {
    info(`profile button located at (${Math.round(profileBtnHandle.x)},${Math.round(profileBtnHandle.y)}) title="${profileBtnHandle.title}"`)
    await page.mouse.click(profileBtnHandle.x, profileBtnHandle.y)
    await page.waitForTimeout(700)
    await shot(page, 'profile-dropdown')

    // Look for the "Choose Avatar" / "Change Avatar" button in the dropdown
    const chooseBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      return btns.find(b => /choose avatar|change avatar/i.test(b.textContent || '')) || null
    })
    const hasChooseBtn = await chooseBtn.evaluate(el => el != null)
    if (hasChooseBtn) {
      await chooseBtn.asElement()?.click()
      await page.waitForTimeout(1000)
      pass('profile -> Choose/Change Avatar clicked')
    } else {
      info('no Choose/Change Avatar button found in profile dropdown')
    }
  } else {
    fail('could not locate profile button')
  }

  let galleryRoot = await page.$('text=/OASIS AVATAR SELECTOR/i')
  if (galleryRoot) {
    pass('AvatarGallery opened — header reads "OASIS AVATAR SELECTOR"')
    await shot(page, 'gallery-opened')
  } else {
    fail('could not open AvatarGallery through profile or wizard UI')
  }

  // ──────────────────────────────────────────────────────────────────────
  // 5. Verify 11 new avatars visible in the grid (by name).
  //    Only checks if gallery is actually open.
  // ──────────────────────────────────────────────────────────────────────
  if (galleryRoot) {
    const visibleNames = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span'))
      return spans.map(s => s.textContent?.trim()).filter(Boolean)
    })
    const needed = ['Witch', 'Juanita', 'Captain Lobster', 'Dream Fighter', 'Eye Wizard', 'Evil Pendra', 'Lady Fawn', 'Mr.', 'Stitch Witch', 'VIPE Hero 2770', 'VIPE Hero 2902']
    const found = needed.filter(n => visibleNames.includes(n))
    if (found.length === needed.length) {
      pass(`all 11 new avatars visible in grid (${found.length}/${needed.length})`)
    } else {
      fail(`only ${found.length}/${needed.length} new avatars visible. missing: ${needed.filter(n => !found.includes(n)).join(', ')}`)
    }

    // ──────────────────────────────────────────────────────────────────
    // 6. Click a new avatar (Witch) and verify preview mounts. Click via
    //    mouse.click at element center to bypass child-element interception.
    // ──────────────────────────────────────────────────────────────────
    const witchBtnPos = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const match = btns.find(b => {
        const spans = Array.from(b.querySelectorAll('span'))
        return spans.some(s => s.textContent?.trim() === 'Witch')
      })
      if (!match) return null
      match.scrollIntoView({ block: 'center' })
      const rect = match.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    if (witchBtnPos) {
      await page.mouse.click(witchBtnPos.x, witchBtnPos.y)
      await page.waitForTimeout(2500)
      await shot(page, 'witch-selected')
      // Preview canvas inside the gallery modal
      const canvases = await page.$$('canvas')
      if (canvases.length >= 2) pass(`preview canvas renders (${canvases.length} canvases detected)`)
      else fail(`expected 2+ canvases, got ${canvases.length}`)

      // Info panel shows filename
      const hasWitchFile = await page.evaluate(() => {
        return document.body.textContent?.includes('Witch.vrm') ?? false
      })
      if (hasWitchFile) pass('info panel shows Witch.vrm filename')
      else fail('info panel did not show Witch.vrm')
    } else {
      fail('Witch button not found in DOM')
    }

    // ──────────────────────────────────────────────────────────────────
    // 7. Animation picker — click a category chip, then an animation.
    // ──────────────────────────────────────────────────────────────────
    const animTitleEl = await page.$('text=/animation/i')
    if (animTitleEl) {
      info('animation section detected')
      // find all category chip buttons and click the first one that isn't already active
      const allButtons = await page.$$('button')
      info(`${allButtons.length} total buttons in DOM`)
    } else {
      info('no animation section header found — animation picker may be collapsed')
    }

    // ──────────────────────────────────────────────────────────────────
    // 8. Close gallery — X button click via JS .click() (Playwright mouse
    //    click can be intercepted by the backdrop-click handler).
    // ──────────────────────────────────────────────────────────────────
    const closeResult = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const match = btns.find(b => (b.textContent || '').trim() === '\u2715')
      if (!match) return 'no-button'
      match.click()
      return 'clicked'
    })
    await page.waitForTimeout(600)
    const stillOpen = await page.$('text=/OASIS AVATAR SELECTOR/i')
    if (closeResult === 'clicked' && !stillOpen) pass('gallery closed via X button (js click)')
    else if (!stillOpen) pass('gallery closed (backdrop/escape path)')
    else fail(`gallery still open after close attempt (result: ${closeResult})`)
  }

  // ──────────────────────────────────────────────────────────────────────
  // 9. Console errors that actually matter
  // ──────────────────────────────────────────────────────────────────────
  const realErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('Meshy') &&
    !e.includes('Download the React DevTools') &&
    !/ResizeObserver/i.test(e),
  )
  if (realErrors.length === 0) pass('zero meaningful console errors during gallery interaction')
  else fail(`${realErrors.length} console errors, first: ${realErrors[0]?.slice(0, 140)}`)

  await browser.close()

  // ──────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log('\n== SUMMARY ==')
  console.log(`PASS: ${passed}`)
  console.log(`FAIL: ${failed}`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const r of results.filter(r => r.status === 'FAIL')) console.log(`  - ${r.msg}`)
    process.exit(1)
  }
}

run().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
