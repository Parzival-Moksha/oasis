// Does the work counter survive a hot reload? A fresh copy of its module is loaded under the mounted HUD; the HUD must
// stay, keep its number, and only one clock may run. Writes are blocked by the shared read-only viewer.
// Run: node scripts/playtest-work-counter-hotreload.mjs   (dev server on :4516; viewer at %TEMP%/fps-hunt/viewer.mjs or OASIS_VIEWER)
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { openViewer, installModuleAccess } = await import(pathToFileURL(process.env.OASIS_VIEWER || path.join(os.tmpdir(), 'fps-hunt', 'viewer.mjs')).href)
const agents = ['Anorak', 'Mission Wall'].map((name, i) => ({ id: `a${i}`, kind: 'owned', name, status: 'idle', alive: true, cwd: 'C:/af_oasis', sessionId: `s${i}` }))
// The counter refuses test browsers; this playtest of the counter itself opts in (the viewer blocks every write anyway).
const { browser, page, log } = await openViewer({ agents, settleMs: 18000, initScript: () => { window.__oasisWorkTestMode = true } })
let fail = 0
const check = (label, ok, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', label, detail); if (!ok) fail++ }
try {
  await installModuleAccess(page)
  const read = () => page.evaluate(() => { const g = globalThis.__oasisWorkVow; return { hud: document.querySelector('button[data-ui-panel="village-work-vow"]')?.innerText.replace(/\n/g, ' | ') || 'MISSING', shown: (g.state.snapshot?.today.seconds || 0) + g.state.pendingSeconds, pending: g.state.pendingSeconds, tab: g.tab, users: g.users, running: !!g.halt } })
  const active = async n => { for (let i = 0; i < n; i++) { await page.mouse.move(400 + i * 5, 300); await page.waitForTimeout(1000) } }
  await active(6)
  const before = await read(); console.log('before', JSON.stringify(before))
  // A hot reload: the module is evaluated again from scratch while the HUD stays mounted.
  const swapped = await page.evaluate(() => { const req = window.__wpReq; const id = Object.keys(req.c).find(k => k.includes('components/village/work-vow-client.ts')); if (!id) return false; delete req.c[id]; req(id); return true })
  check('a fresh copy of the counter module was loaded', swapped)
  await active(10)
  const after = await read(); console.log('after', JSON.stringify(after))
  check('the HUD is still there', after.hud !== 'MISSING', after.hud)
  // The shown number may also grow from the owner's own tab (the book is shared), so the test page's own seconds are judged.
  check('it kept its number and went on', after.shown >= before.shown + 8, `${before.shown}s -> ${after.shown}s in about 10 s`)
  check('one clock, not two (the old copy stopped)', after.pending - before.pending >= 8 && after.pending - before.pending <= 12, `own seconds ${before.pending} -> ${after.pending}`)
  check('the same tab id, one user, running', after.tab === before.tab && after.users === 1 && after.running)
  // The 3D clock reads the same store: its face was reprinted with the same number.
  const same = await page.evaluate(() => { const g = globalThis.__oasisWorkVow; const hud = document.querySelector('button[data-ui-panel="village-work-vow"]').innerText; const s = (g.state.snapshot?.today.seconds || 0) + g.state.pendingSeconds; const two = n => String(n).padStart(2, '0'); return hud.includes(`${Math.floor(s / 3600)}:${two(Math.floor(s % 3600 / 60))}:${two(s % 60)}`) })
  check('the HUD shows the shared number', same)
  console.log('errors', JSON.stringify(log.errors), fail ? `${fail} FAILED` : 'ALL PASS')
} finally { await browser.close() }
process.exit(fail ? 1 : 0)
