#!/usr/bin/env node
// Cuts the slim Oasis out of this repository: the village, the engine, the plugin and a small set of
// redistributable assets, into a folder of its own. That folder is what the small public repository holds.
// It is a build product: change the workshop (or scripts/slim/cut.config.mjs), then cut again.
//
//   node scripts/cut-slim.mjs [--out <folder>] [--report-only] [--no-archive]
//
//   --out          where to write the cut (default: ../oasis-slim next to this repository). The folder is
//                  emptied first, except its .git and node_modules folders, so it can be a checkout of the slim repository.
//   --report-only  print the size table for what would be cut; write nothing
//   --no-archive   skip measuring the .tar.gz (faster)
//   --release      also write the release archive the plugin downloads (<out>/../<asset name from
//                  plugins/oasis/scripts/release.json>) and put its sha256 into the cut's release.json
//   --working-tree take tracked files as they are on disk, not as committed (to try a change before committing)
//
// Only committed files are taken, with their committed content (git HEAD), so nothing local, ignored, secret or
// half-finished in the working tree can slip in. --working-tree takes the files as they are on disk instead.
// Exit codes: 0 fine, 1 the cut is over a limit or an asset has no licence that allows redistribution.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { ARCHIVE_LIMIT_MIB, FILE_LIMIT, assetLicences, avatars, exclude, firstWorld, include, transforms } from './slim/cut.config.mjs'

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
export function vrmLicence(source) {
  const data = Buffer.isBuffer(source) ? source : fs.readFileSync(source)
  if (data.toString('latin1', 0, 4) !== 'glTF') return null
  const length = data.readUInt32LE(12)
  const ext = JSON.parse(data.toString('utf8', 20, 20 + length)).extensions || {}
  const old = ext.VRM?.meta
  if (old) return { licence: old.licenseName || '', author: old.author || '', title: old.title || '' }
  const meta = ext.VRMC_vrm?.meta
  if (meta) return { licence: meta.licenseUrl || '', author: (meta.authors || []).join(', '), title: meta.name || '' }
  return null
}

function tracked() {
  const argv = flag('--working-tree') ? ['ls-files', '-z'] : ['ls-tree', '-r', '-z', '--name-only', 'HEAD']
  const out = execFileSync('git', argv, { cwd: ROOT, maxBuffer: 64 * MIB }).toString('utf8')
  return out.split('\0').filter(Boolean)
}

/** The content of each file: as committed (one `git cat-file --batch` for all of them), or from disk. */
function contents(files) {
  const map = new Map()
  if (flag('--working-tree')) {
    for (const file of files) map.set(file, fs.readFileSync(path.join(ROOT, file)))
    return map
  }
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: ROOT, input: files.map((f) => `HEAD:${f}\n`).join(''), maxBuffer: 1024 * MIB })
  let at = 0
  for (const file of files) {
    const eol = out.indexOf(10, at)
    const header = out.toString('utf8', at, eol)
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header)
    if (!match) throw new Error(`git has no committed content for ${file}: ${header}`)
    const size = Number(match[1])
    map.set(file, out.subarray(eol + 1, eol + 1 + size))
    at = eol + 1 + size + 1
  }
  return map
}

const thumbOf = (file) => `${file.replace(/\.vrm$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/_+/g, '_').toLowerCase()}.jpg`

function plan() {
  const problems = []
  const files = tracked()
  const take = chooser(include, exclude)
  const chosen = new Set(files.filter(take))
  for (const pattern of include) if (!files.some(rule(pattern))) problems.push(`nothing matches the include rule ${pattern}`)

  // Avatars: named one by one, each checked against what the file says about itself.
  const thumbs = files.filter((f) => f.startsWith('public/avatars/gallery/thumbs/'))
  const wanted = []
  for (const a of avatars) {
    const rel = `public/avatars/gallery/${a.file}`
    if (!files.includes(rel)) { problems.push(`avatar not in the repository: ${rel}`); continue }
    if (a.licence !== 'CC0') { problems.push(`${rel}: licence "${a.licence}" is not one the cut ships`); continue }
    wanted.push(rel)
    const stem = a.file.replace(/\.vrm$/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const thumb = thumbs.find((t) => path.basename(t, path.extname(t)).toLowerCase().replace(/[^a-z0-9]/g, '') === stem)
    if (thumb) chosen.add(thumb)
  }
  for (const rel of wanted) chosen.add(rel)
  for (const file of [firstWorld.seed, 'package.json', 'data/asset-catalog-extras.json', 'src/components/scene-lib/constants.ts', 'plugins/oasis/mcp/directory.mcp.json', 'plugins/oasis/.claude-plugin/plugin.json']) {
    if (!files.includes(file)) problems.push(`not in the repository: ${file}`)
  }
  const sorted = [...chosen].sort()
  const data = contents([...new Set([...sorted, firstWorld.seed, 'package.json', 'data/asset-catalog-extras.json', ...fs.readdirSync(path.join(ROOT, 'scripts', 'slim', 'root')).map((n) => `scripts/slim/root/${n}`)])].filter((f) => files.includes(f)))

  const avatarRows = []
  for (const rel of wanted) {
    const meta = vrmLicence(data.get(rel))
    if (meta?.licence !== 'CC0') { problems.push(`${rel}: listed as CC0, but the file says "${meta?.licence ?? 'nothing'}"`); chosen.delete(rel); continue }
    avatarRows.push({ file: rel, licence: 'CC0 1.0', source: meta.author, title: meta.title || path.basename(rel) })
  }

  for (const file of chosen) {
    if (!file.startsWith('public/') || file.startsWith('public/avatars/')) continue
    if (!/\.(png|jpe?g|webp|gif|svg|hdr|glb|gltf|vrm|mp3|ogg|wav|woff2?|ttf|otf|json|bin|mjs|js|md|txt)$/i.test(file)) problems.push(`unexpected kind of file under public/: ${file}`)
  }
  return { chosen: [...chosen].sort(), avatarRows, problems, data }
}

/** Catalog entries (id and file) written in src/components/scene-lib/constants.ts, one per line. */
export function catalogEntries(source) {
  const entries = []
  for (const line of source.split('\n')) {
    const id = /\bid: '([^']+)'/.exec(line)
    const file = /\bpath: '(\/[^']+)'/.exec(line)
    if (id && file) entries.push({ id: id[1], path: file[1] })
  }
  return entries
}

/** The catalog override for the cut: every built-in entry whose file is not shipped is taken out. */
export function slimCatalogExtras(extras, entries, shipped) {
  const has = (p) => shipped.has(`public${decodeURIComponent(p)}`)
  const deleted = new Set(extras.deletedIds || [])
  for (const entry of entries) if (!has(entry.path)) deleted.add(entry.id)
  return {
    _doc: 'Written by scripts/cut-slim.mjs: the catalog entries whose files the slim Oasis does not ship are taken out here.',
    deletedIds: [...deleted].sort(),
    additions: (extras.additions || []).filter((entry) => entry?.path && has(entry.path)),
  }
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
  ['Ground and plants of the first world', (f) => f.startsWith('public/ground/') || f.startsWith('public/models/')],
  ['Icons, fonts, lip sync', (f) => f.startsWith('public/')],
  ['Config, scripts, docs', () => true],
]

function sizes(files, sizeOf) {
  const rows = ROWS.map(([label]) => ({ label, files: 0, bytes: 0 }))
  for (const file of files) {
    const bytes = sizeOf(file)
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
  if (archiveBytes !== undefined) console.log(`  ${'As a .tar.gz archive (about)'.padEnd(33)}         ${mb(archiveBytes)}   (limit here ${ARCHIVE_LIMIT_MIB}, the directory's 50)`)
  return total
}

function emptyExceptGit(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue // a checkout of the slim repository; installed packages
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

function writeCut({ chosen, avatarRows, data }, problems) {
  emptyExceptGit(OUT)
  const put = (file, content) => {
    const to = path.join(OUT, file)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, content)
  }
  const texts = new Map()
  for (const t of transforms) {
    const before = texts.get(t.file) ?? data.get(t.file)?.toString('utf8')
    if (before === undefined) { problems.push(`transform: ${t.file} is not in the cut`); continue }
    if (before.split(t.from).length !== 2) { problems.push(`transform: expected exactly one "${t.from.slice(0, 60)}…" in ${t.file}`); continue }
    texts.set(t.file, before.replace(t.from, t.to))
  }
  for (const file of chosen) put(file, texts.get(file) ?? data.get(file))

  // The plugin's world tools: the local server inside the plugin, not the workshop's http entry.
  put('plugins/oasis/.mcp.json', data.get('plugins/oasis/mcp/directory.mcp.json'))
  // Files the cut has under other names than the workshop (README, .gitignore, .env.example, the marker).
  for (const [file, content] of data) if (file.startsWith('scripts/slim/root/')) put(file.slice('scripts/slim/root/'.length), content)

  // The catalog: only what is shipped.
  const shipped = new Set(chosen)
  const extras = slimCatalogExtras(JSON.parse(data.get('data/asset-catalog-extras.json').toString('utf8')), catalogEntries(data.get('src/components/scene-lib/constants.ts').toString('utf8')), shipped)
  put('data/asset-catalog-extras.json', `${JSON.stringify(extras, null, 1)}\n`)

  // The first world: one seed, its sky changed to a shipped one, and a manifest that lists only it.
  const seed = JSON.parse(data.get(firstWorld.seed).toString('utf8'))
  seed.data.skyBackgroundId = firstWorld.sky
  for (const placement of seed.data.catalogPlacements || []) {
    if (placement.glbPath && !shipped.has(`public${placement.glbPath}`)) problems.push(`the first world places ${placement.glbPath}, which the cut does not ship`)
  }
  const seedName = path.basename(firstWorld.seed)
  put(`prisma/default-worlds/${seedName}`, `${JSON.stringify(seed)}\n`)
  put('prisma/default-worlds/manifest.json', `${JSON.stringify({ seedVersion: 1, worlds: [{ slug: seed.slug, id: seed.id, file: seedName, name: seed.name, visibility: seed.visibility }] }, null, 2)}\n`)

  // package.json: the same dependencies (the lockfile must still match), the slim Oasis's own name and scripts.
  const pkg = JSON.parse(data.get('package.json').toString('utf8'))
  const plugin = JSON.parse(data.get('plugins/oasis/.claude-plugin/plugin.json').toString('utf8'))
  pkg.name = 'oasis-village'
  pkg.version = plugin.version
  pkg.description = 'The Oasis: your Claude Code sessions as characters in a 3D village on your own machine.'
  pkg.license = 'MIT'
  pkg.scripts = {
    oasis: 'node scripts/oasis.mjs start',
    'oasis:setup': 'node scripts/oasis.mjs setup',
    'oasis:status': 'node scripts/oasis.mjs status',
    'oasis:stop': 'node scripts/oasis.mjs stop',
    'oasis:engine': 'node packages/oasis-agent-engine/src/index.js',
    dev: 'next dev -p 4516 -H 127.0.0.1',
    'dev:engine': 'node packages/oasis-agent-engine/src/index.js',
    build: 'next build',
    start: 'next start -p 4516 -H 127.0.0.1',
  }
  put('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  const doc = assetsDoc(chosen, avatarRows)
  put('ASSETS.md', doc.text)
  return doc.unknown
}

/** About what the folder weighs as a .tar.gz: each file gzipped on its own, plus a tar header each (a little over the real figure). */
function archiveSize(dir, files) {
  let bytes = 0
  for (const file of files) bytes += zlib.gzipSync(fs.readFileSync(path.join(dir, file)), { level: 6 }).length + 64
  return bytes
}

/**
 * The archive the plugin's launcher downloads on a first run: the cut itself, as one .tar.gz, with its
 * checksum written into the cut's plugins/oasis/scripts/release.json (the plugin refuses any other file).
 */
function writeRelease(files) {
  const releaseFile = path.join(OUT, 'plugins', 'oasis', 'scripts', 'release.json')
  const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'))
  const archive = path.join(path.dirname(OUT), release.asset)
  const list = path.join(path.dirname(OUT), `${release.asset}.files.txt`)
  fs.writeFileSync(list, files.map((file) => `${file}\n`).join(''))
  // On Windows: the system's own tar. A GNU tar from Git Bash on the PATH reads "C:" as a remote host.
  const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const tar = process.platform === 'win32' && fs.existsSync(systemTar) ? systemTar : 'tar'
  try {
    execFileSync(tar, ['-czf', archive, '-C', OUT, '-T', list], { stdio: 'inherit' })
  } finally {
    fs.rmSync(list, { force: true })
  }
  release.sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  fs.writeFileSync(releaseFile, `${JSON.stringify(release, null, 2)}\n`)
  console.log(`\n  Release archive: ${archive} (${(fs.statSync(archive).size / MIB).toFixed(1)} MiB)`)
  console.log(`  sha256 ${release.sha256} (written to the cut's release.json)`)
  return fs.statSync(archive).size
}

function main() {
  const cut = plan()
  const problems = [...cut.problems]
  if (flag('--report-only')) {
    const total = printTable(sizes(cut.chosen, (f) => cut.data.get(f).length))
    const doc = assetsDoc(cut.chosen, cut.avatarRows)
    for (const file of doc.unknown) problems.push(`no licence line for ${file} (scripts/slim/cut.config.mjs, assetLicences)`)
    if (total.files > FILE_LIMIT) problems.push(`${total.files} files: over ${FILE_LIMIT}`)
    return finish(problems)
  }
  const unknown = writeCut(cut, problems)
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
  const archive = flag('--release') ? writeRelease(files) : flag('--no-archive') ? undefined : archiveSize(OUT, files)
  const total = printTable(sizes(files, (f) => fs.statSync(path.join(OUT, f)).size), archive)
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
