#!/usr/bin/env node
// Cuts the slim Oasis out of this repository: the village, the engine, the plugin and a small set of
// redistributable assets, into a folder of its own. That folder is what the small public repository holds.
// It is a build product: change the workshop (or scripts/slim/cut.config.mjs), then cut again.
//
//   node scripts/cut-slim.mjs [--out <folder>] [--report-only] [--no-archive]
//
//   --out          where to write the cut (default: ../oasis-slim next to this repository). The folder is
//                  emptied first, except its .git folder, so it can be a checkout of the slim repository.
//   --report-only  print the size table for what would be cut; write nothing
//   --no-archive   skip measuring the .tar.gz (faster)
//
// Only tracked files are taken (git ls-files), so nothing local, ignored or secret can slip in.
// Exit codes: 0 fine, 1 the cut is over a limit or an asset has no licence that allows redistribution.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCHIVE_LIMIT_MIB, FILE_LIMIT, assetLicences, avatars, exclude, include } from './slim/cut.config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const OUT = path.resolve(value('--out') || path.join(ROOT, '..', 'oasis-slim'))
const MIB = 1024 * 1024

/** 'dir/', a glob with * and **, or an exact path -> a test for a forward-slash path. */
export function rule(pattern) {
  if (pattern.endsWith('/') && !pattern.includes('*')) return (file) => file.startsWith(pattern)
  if (!pattern.includes('*')) return (file) => file === pattern
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*')
  const re = new RegExp(`^${source}${pattern.endsWith('/') ? '' : '$'}`)
  return (file) => re.test(file)
}

export function chooser(includes, excludes) {
  const inc = includes.map(rule)
  const exc = excludes.map(rule)
  return (file) => inc.some((t) => t(file)) && !exc.some((t) => t(file))
}

/** The licence a .vrm file states about itself (VRM 0.x `licenseName`, VRM 1.0 `licenseUrl`). */
export function vrmLicence(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    fs.readSync(fd, head, 0, 20, 0)
    if (head.toString('latin1', 0, 4) !== 'glTF') return null
    const length = head.readUInt32LE(12)
    const json = Buffer.alloc(length)
    fs.readSync(fd, json, 0, length, 20)
    const ext = JSON.parse(json.toString('utf8')).extensions || {}
    const old = ext.VRM?.meta
    if (old) return { licence: old.licenseName || '', author: old.author || '', title: old.title || '' }
    const meta = ext.VRMC_vrm?.meta
    if (meta) return { licence: meta.licenseUrl || '', author: (meta.authors || []).join(', '), title: meta.name || '' }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * MIB }).toString('utf8')
  return out.split('\0').filter(Boolean)
}

const thumbOf = (file) => `${file.replace(/\.vrm$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_+/g, '_').toLowerCase()}.jpg`

function plan() {
  const problems = []
  const files = tracked()
  const take = chooser(include, exclude)
  const chosen = new Set(files.filter(take))

  // Avatars: named one by one, each checked against what the file says about itself.
  const avatarRows = []
  const thumbs = files.filter((f) => f.startsWith('public/avatars/gallery/thumbs/'))
  for (const a of avatars) {
    const rel = `public/avatars/gallery/${a.file}`
    if (!files.includes(rel)) { problems.push(`avatar not in the repository: ${rel}`); continue }
    const meta = vrmLicence(path.join(ROOT, rel))
    if (a.licence === 'CC0' && meta?.licence !== 'CC0') { problems.push(`${rel}: listed as CC0, but the file says "${meta?.licence ?? 'nothing'}"`); continue }
    if (a.licence !== 'CC0' && a.licence !== 'ours') { problems.push(`${rel}: licence "${a.licence}" is not one the cut ships`); continue }
    chosen.add(rel)
    avatarRows.push({ file: rel, licence: a.licence === 'ours' ? 'Made for the Oasis; MIT with the code' : 'CC0 1.0', source: a.licence === 'ours' ? 'the Oasis' : meta.author, title: meta?.title || a.file })
    const stem = a.file.replace(/\.vrm$/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const thumb = thumbs.find((t) => path.basename(t, path.extname(t)).toLowerCase().replace(/[^a-z0-9]/g, '') === stem) || thumbs.find((t) => t.endsWith(`/${thumbOf(a.file)}`))
    if (thumb) chosen.add(thumb)
  }

  // Every asset under public/ must have a licence line, or it does not ship.
  for (const file of chosen) {
    if (!file.startsWith('public/') || file.startsWith('public/avatars/')) continue
    if (!/\.(png|jpe?g|webp|gif|svg|hdr|glb|gltf|vrm|fbx|mp3|ogg|wav|woff2?|ttf|otf|json|bin|mjs|ico|webmanifest|md|txt)$/i.test(file)) problems.push(`unexpected kind of file under public/: ${file}`)
  }
  return { chosen: [...chosen].sort(), avatarRows, problems }
}

/** The table's rows: a label and a test. First match wins. */
const ROWS = [
  ['App source (src)', (f) => f.startsWith('src/')],
  ['Agent engine', (f) => f.startsWith('packages/oasis-agent-engine/')],
  ['Plugin and marketplace', (f) => f.startsWith('plugins/') || f.startsWith('.claude-plugin/')],
  ['Database schema and first worlds', (f) => f.startsWith('prisma/')],
  ['Avatars', (f) => f.startsWith('public/avatars/')],
  ['Animations', (f) => f.startsWith('public/animations/')],
  ['Skies', (f) => f.startsWith('public/skies/')],
  ['Menu and HUD art', (f) => f.startsWith('public/ui/')],
  ['Sounds', (f) => f.startsWith('public/audio/')],
  ['Ground', (f) => f.startsWith('public/ground/')],
  ['Splash, icons, fonts, lip sync', (f) => f.startsWith('public/')],
  ['Config, scripts, docs', () => true],
]

function sizes(files, base) {
  const rows = ROWS.map(([label]) => ({ label, files: 0, bytes: 0 }))
  for (const file of files) {
    const bytes = fs.statSync(path.join(base, file)).size
    const row = rows[ROWS.findIndex(([, test]) => test(file))]
    row.files++
    row.bytes += bytes
  }
  return rows
}

function printTable(rows, archiveBytes) {
  const mb = (n) => (n / MIB).toFixed(1).padStart(7)
  console.log('\n  What                               Files      MiB')
  console.log('  ---------------------------------  -----  -------')
  for (const r of rows) if (r.files) console.log(`  ${r.label.padEnd(33)}  ${String(r.files).padStart(5)}  ${mb(r.bytes)}`)
  const total = rows.reduce((a, r) => ({ files: a.files + r.files, bytes: a.bytes + r.bytes }), { files: 0, bytes: 0 })
  console.log('  ---------------------------------  -----  -------')
  console.log(`  ${'Total on disk'.padEnd(33)}  ${String(total.files).padStart(5)}  ${mb(total.bytes)}`)
  if (archiveBytes !== undefined) console.log(`  ${'As a .tar.gz archive'.padEnd(33)}         ${mb(archiveBytes)}   (limit here ${ARCHIVE_LIMIT_MIB}, the directory's 50)`)
  return total
}

function emptyExceptGit(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') continue
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
  }
}

function assetsDoc(files, avatarRows) {
  const lines = [
    '# Assets and their licences',
    '',
    'Every picture, sound, animation, avatar and font in this repository, with where it comes from and the licence it ships under. The source code is MIT (see LICENSE). This file is written by `scripts/cut-slim.mjs`.',
    '',
    '## Avatars',
    '',
    '| File | Name | Author | Licence |',
    '|---|---|---|---|',
    ...avatarRows.map((a) => `| \`${a.file}\` | ${a.title} | ${a.source} | ${a.licence} |`),
    '',
    'The CC0 avatars state that licence inside the file (VRM metadata); the cut checks it each time.',
    '',
    '## Everything else',
    '',
    '| Folder | Files | Source | Licence |',
    '|---|---|---|---|',
  ]
  const unknown = []
  const groups = new Map()
  for (const file of files) {
    if (!file.startsWith('public/') || file.startsWith('public/avatars/')) continue
    const entry = assetLicences.find((l) => file.startsWith(l.match))
    if (!entry) { unknown.push(file); continue }
    const g = groups.get(entry.match) || { entry, count: 0 }
    g.count++
    groups.set(entry.match, g)
  }
  for (const { entry, count } of groups.values()) lines.push(`| \`${entry.match}\` | ${count} | ${entry.source} | ${entry.licence} |`)
  lines.push('')
  return { text: lines.join('\n'), unknown }
}

function writeCut({ chosen, avatarRows }) {
  emptyExceptGit(OUT)
  for (const file of chosen) {
    const to = path.join(OUT, file)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(ROOT, file), to)
  }
  // The plugin's world tools: the local server inside the plugin, not the workshop's http entry.
  fs.copyFileSync(path.join(ROOT, 'plugins/oasis/mcp/directory.mcp.json'), path.join(OUT, 'plugins/oasis/.mcp.json'))
  // Files the cut has under other names than the workshop.
  const slim = path.join(ROOT, 'scripts', 'slim', 'root')
  if (fs.existsSync(slim)) fs.cpSync(slim, OUT, { recursive: true })
  const doc = assetsDoc(chosen, avatarRows)
  fs.writeFileSync(path.join(OUT, 'ASSETS.md'), doc.text)
  return doc.unknown
}

function archiveSize(dir) {
  const file = path.join(os.tmpdir(), `oasis-slim-${process.pid}.tar.gz`)
  try {
    execFileSync('tar', ['-czf', file, '--exclude=.git', '--exclude=node_modules', '--exclude=.next', '-C', dir, '.'], { stdio: 'ignore' })
    return fs.statSync(file).size
  } finally {
    fs.rmSync(file, { force: true })
  }
}

function main() {
  const cut = plan()
  const problems = [...cut.problems]
  if (flag('--report-only')) {
    const total = printTable(sizes(cut.chosen, ROOT))
    const doc = assetsDoc(cut.chosen, cut.avatarRows)
    for (const file of doc.unknown) problems.push(`no licence line for ${file} (scripts/slim/cut.config.mjs, assetLicences)`)
    if (total.files > FILE_LIMIT) problems.push(`${total.files} files: over ${FILE_LIMIT}`)
    return finish(problems)
  }
  const unknown = writeCut(cut)
  for (const file of unknown) problems.push(`no licence line for ${file} (scripts/slim/cut.config.mjs, assetLicences)`)
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.next') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(OUT, full).split(path.sep).join('/'))
    }
  }
  walk(OUT)
  const archive = flag('--no-archive') ? undefined : archiveSize(OUT)
  const total = printTable(sizes(files, OUT), archive)
  console.log(`\n  Written to ${OUT}`)
  if (total.files > FILE_LIMIT) problems.push(`${total.files} files: over ${FILE_LIMIT}`)
  if (archive !== undefined && archive > ARCHIVE_LIMIT_MIB * MIB) problems.push(`the archive is ${(archive / MIB).toFixed(1)} MiB: over ${ARCHIVE_LIMIT_MIB}`)
  return finish(problems)
}

function finish(problems) {
  if (!problems.length) { console.log('\n  The cut is within its limits, and every asset has a licence line.\n'); return 0 }
  console.log(`\n  ${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
  for (const p of problems.slice(0, 40)) console.log(`   - ${p}`)
  if (problems.length > 40) console.log(`   … and ${problems.length - 40} more`)
  console.log('')
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
