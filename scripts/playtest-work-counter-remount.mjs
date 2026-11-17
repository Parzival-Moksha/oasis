// Does the HUD count after a remount? The real page code against a stand-in server: the work API is answered
// in the test by the app's own applyWorkBeat / releaseWorkHolder / workSnapshot (loaded in the page) on a book
// kept in the test. Nothing reaches the owner's real book.
// Run: node scripts/playtest-work-counter-remount.mjs   (needs the dev server on :4516 and the read-only viewer the
// village agents share: %TEMP%/fps-hunt/viewer.mjs, or OASIS_VIEWER=<path>). About two and a half minutes.
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { openViewer, installModuleAccess } = await import(pathToFileURL(process.env.OASIS_VIEWER || path.join(os.tmpdir(), 'fps-hunt', 'viewer.mjs')).href)
const agents = ['Anorak', 'Mission Wall'].map((name, i) => ({ id: `a${i}`, kind: 'owned', name, status: 'idle', alive: true, cwd: 'C:/af_oasis', sessionId: `s${i}` }))
const { browser, page, log } = await openViewer({ agents, settleMs: 20000, onConsole: m => { if (m.type() === 'error' && !/ERR_FAILED|404|GLTF/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) } })
let fail = 0
const check = (label, ok, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', label, detail); if (!ok) fail++ }
try {
  await installModuleAccess(page)
  await page.evaluate(() => { window.__book = window.__mod('lib/village/work-vow.ts').emptyWorkFile(); window.__posts = [] })
  const serve = async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      const body = await page.evaluate(() => { const w = window.__mod('lib/village/work-vow.ts'); return JSON.stringify(w.workSnapshot(window.__book, Date.now())) })
      return route.fulfill({ status: 200, contentType: 'application/json', body })
    }
    const beat = JSON.parse(req.postData() || '{}')
    const body = await page.evaluate((beat) => {
      const w = window.__mod('lib/village/work-vow.ts'); const now = Date.now()
      window.__posts.push({ seq: beat.seq, seconds: beat.seconds, release: !!beat.release, back: !!beat.back })
      if (typeof beat.tab !== 'string') return JSON.stringify({ ok: true })
      const r = w.applyWorkBeat(window.__book, beat, now)
      let file = r.file
      if (beat.release) file = w.releaseWorkHolder(file, beat.tab)
      window.__book = file
      return JSON.stringify({ ok: true, counting: r.counting, credited: r.credited, otherTab: r.otherTab === true, snapshot: w.workSnapshot(file, now) })
    }, beat).catch(() => '{"ok":true}')
    return route.fulfill({ status: 200, contentType: 'application/json', body })
  }
  await page.route('**/api/village/work', serve)   // registered last: wins over the viewer's block
  const hud = () => page.evaluate(() => { const s = window.__oasisWork.state(); const day = Object.values(window.__book.days)[0]; return { booked: day ? day.freeSeconds + (day.agentSeconds || 0) : 0, pending: s.pendingSeconds, running: s.running, other: s.otherTab, text: document.querySelector('button[data-ui-panel="village-work-vow"]')?.innerText.split('\n').slice(1, 4).join(' | ') } })
  const active = async (seconds) => { for (let i = 0; i < seconds; i++) { await page.mouse.move(500 + (i % 20) * 6, 320); await page.waitForTimeout(1000) } }

  await active(34)
  const first = await hud(); console.log('before remount', JSON.stringify(first))
  check('counts before the remount', first.booked >= 14 && !first.other, `booked ${first.booked}s`)
  check('says what is counted and the rate', /COUNTING: IN THE OASIS · 0\.7 XP\/MIN/i.test(first.text || ''), first.text)

  // The remount: the HUD's effect cleanup runs (it lets go), then it starts again; same page, same tab id.
  // (The counter runs while a HUD is mounted, so the test takes the mounted HUD's place: last user gone, then one again.)
  await page.evaluate(() => { const c = window.__mod('components/village/work-vow-client.ts'); globalThis.__oasisWorkVow.users = 0; const stop = c.startWorkVow(); stop(); window.__stopAgain = c.startWorkVow() })
  const released = await page.evaluate(() => ({ holder: window.__book.holder, released: window.__book.released || null }))
  console.log('after letting go', JSON.stringify(released))
  await active(36)
  const second = await hud(); console.log('after remount', JSON.stringify(second))
  const posts = await page.evaluate(() => window.__posts)
  const rel = posts.findIndex(p => p.release)
  console.log('reports around the remount', JSON.stringify(posts.slice(Math.max(0, rel - 1), rel + 3)))
  check('the letting-go reached the server, and a later report was taken', rel >= 0 && posts.slice(rel + 1).some(p => p.seq > posts[rel].seq))
  check('still counts after the remount', second.booked >= first.booked + 14, `booked ${first.booked}s -> ${second.booked}s`)
  check('never says "another tab" with one tab', !second.other && !/another/i.test(second.text || ''), second.text)
  check('this tab holds the place again', await page.evaluate(() => window.__book.holder?.tab === window.__oasisWork.tab()))

  // A second tab that really reports: now, and only now, "another tab".
  await page.evaluate(() => { const w = window.__mod('lib/village/work-vow.ts'); window.__book = { ...window.__book, holder: { tab: 'someone-else', seq: 1, at: Date.now() } } })
  await active(17)
  const third = await hud(); console.log('with another tab reporting', JSON.stringify(third))
  check('says "another tab" when one really reported', third.other && /another oasis tab/i.test(third.text || ''), third.text)
  // That tab goes quiet: this one takes over within about a minute.
  await page.evaluate(() => { window.__book = { ...window.__book, holder: { tab: 'someone-else', seq: 1, at: Date.now() - 60000 } } })
  await active(18)
  const fourth = await hud(); console.log('after the other tab went quiet', JSON.stringify(fourth))
  check('takes over when the other tab is gone', !fourth.other, fourth.text)
  console.log('page errors', JSON.stringify(log.errors), fail ? `${fail} FAILED` : 'ALL PASS')
} finally { await browser.close() }
process.exit(fail ? 1 : 0)
