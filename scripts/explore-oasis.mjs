// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PLAYWRIGHT EXPLORATION — Claude sees the Oasis
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOTS_DIR = path.resolve(SCRIPT_DIR, '../test-screenshots')
mkdirSync(SCREENSHOTS_DIR, { recursive: true })

async function explore() {
  console.log('Launching browser...')
  const browser = await chromium.launch({
    headless: false,  // HEADED — you can watch!
    args: ['--use-angle=gl'],  // WebGL support
  })

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // Navigate to the Oasis
  console.log('Navigating to localhost:4516...')
  await page.goto('http://localhost:4516', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)  // Let WebGL scene render

  // Screenshot 1: Initial load
  console.log('Screenshot 1: Initial load')
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-initial-load.png`, fullPage: false })

  // Check what buttons are visible
  const buttons = await page.$$eval('button', btns =>
    btns.map(b => ({ text: b.textContent?.trim()?.slice(0, 30), title: b.title })).filter(b => b.text || b.title)
  )
  console.log('Visible buttons:', JSON.stringify(buttons.slice(0, 15), null, 2))

  // Click the Anorak/Claude Code button (💻)
  console.log('Looking for Claude Code button...')
  const ccButton = await page.$('button[title*="Claude Code"], button[title*="Anorak"]')
  if (ccButton) {
    await ccButton.click()
    await page.waitForTimeout(1000)
    console.log('Screenshot 2: Panel opened')
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-panel-open.png` })

    // Try typing into the panel
    const textarea = await page.$('textarea[placeholder*="Command"]')
    if (textarea) {
      await textarea.fill('hello from playwright!')
      console.log('Screenshot 3: Typed into panel')
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-typed.png` })
    } else {
      console.log('No textarea found')
    }

    // Close the panel - find the × button
    const closeBtn = await page.$('button:has-text("×")')
    if (closeBtn) {
      await closeBtn.click()
      await page.waitForTimeout(500)
    }
  } else {
    console.log('Claude Code button not found')
  }

  // Screenshot 4: Check the settings dropdown
  console.log('Looking for settings button...')
  const settingsBtn = await page.$('button[title*="Settings"]')
  if (settingsBtn) {
    await settingsBtn.click()
    await page.waitForTimeout(500)
    console.log('Screenshot 4: Settings open')
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-settings.png` })
  }

  // Check console errors
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

  // Screenshot 5: Final state
  await page.waitForTimeout(1000)
  console.log('Screenshot 5: Final state')
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-final.png` })

  console.log(`Console errors found: ${errors.length}`)
  errors.forEach(e => console.log('  ERROR:', e.slice(0, 100)))

  // Get the FPS counter if visible
  const fps = await page.$eval('.fixed.top-2.right-2', el => el?.textContent).catch(() => 'not found')
  console.log('FPS display:', fps)

  await browser.close()
  console.log('Done! Screenshots saved to', SCREENSHOTS_DIR)
}

explore().catch(console.error)
