import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const require = createRequire(import.meta.url)
const { PrismaClient } = require('../node_modules/.prisma/client')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_ROOT = path.join(ROOT, 'public', 'builder', 'colstok')
const ASSET_DIR = path.join(PUBLIC_ROOT, 'assets')
const PAGE_DIR = path.join(PUBLIC_ROOT, 'pages')
const SOURCE = 'https://colstok.com'
const WORLD_ID = 'world-colstok-showroom-draft'
const BUILD_VERSION = 2

async function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env')
  try {
    const raw = await fs.readFile(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] ||= value
    }
  } catch {
    // The dev app already has this env; direct script runs load it when present.
  }
}

const services = [
  {
    slug: 'futes-es-felulethutes',
    label: 'Futes es felulethutes',
    display: 'Fűtés és felülethűtés',
    url: `${SOURCE}/futes-es-felulethutes`,
    imageUrl: `${SOURCE}/storage/48/conversions/Depositphotos_543753878_XL_resize_cut-list.jpg`,
    accent: '#ffdf00',
  },
  {
    slug: 'gazellatas',
    label: 'Gazellatas',
    display: 'Gázellátás',
    url: `${SOURCE}/gazellatas`,
    imageUrl: `${SOURCE}/storage/49/conversions/Depositphotos_55567879_XL_resize-list.jpg`,
    accent: '#f97316',
  },
  {
    slug: 'viz-es-csatorna',
    label: 'Viz es csatorna',
    display: 'Víz és csatorna',
    url: `${SOURCE}/viz-es-csatorna`,
    imageUrl: `${SOURCE}/storage/52/conversions/Depositphotos_37299139_XL_resize_cut-list.jpg`,
    accent: '#38bdf8',
  },
  {
    slug: 'hoszivattyu-es-klima',
    label: 'Hoszivattyu es klima',
    display: 'Hőszivattyú és klíma',
    url: `${SOURCE}/hoszivattyu-es-klima`,
    imageUrl: `${SOURCE}/storage/55/conversions/Depositphotos_583827392_XL_resize-list.jpg`,
    accent: '#22c55e',
  },
  {
    slug: 'epuletenergetika',
    label: 'Epuletenergetika',
    display: 'Épületenergetika',
    url: `${SOURCE}/epuletenergetika`,
    imageUrl: `${SOURCE}/storage/40/conversions/Depositphotos_54783707_XL_resize-list.jpg`,
    accent: '#a3e635',
  },
  {
    slug: 'epitomesteri-munkak',
    label: 'Epitomesteri munkak',
    display: 'Építőmesteri munkák',
    url: `${SOURCE}/epitomesteri-munkak`,
    imageUrl: `${SOURCE}/storage/61/conversions/Depositphotos_123582818_XL_resize_cut2-list.jpg`,
    accent: '#fb7185',
  },
  {
    slug: 'tervezes-es-szakertes',
    label: 'Tervezes es szakertes',
    display: 'Tervezés és szakértés',
    url: `${SOURCE}/tervezes-es-szakertes`,
    imageUrl: `${SOURCE}/storage/63/conversions/Depositphotos_191217194_XL_resize_cut-list.jpg`,
    accent: '#c084fc',
  },
  {
    slug: 'szellozes',
    label: 'Szellozes',
    display: 'Szellőzés',
    url: `${SOURCE}/szellozes`,
    imageUrl: `${SOURCE}/storage/66/conversions/Depositphotos_9713287_XL_resize_cut-list.jpg`,
    accent: '#67e8f9',
  },
  {
    slug: 'referenciaink',
    label: 'Referenciak',
    display: 'Referenciák',
    url: `${SOURCE}/referenciaink`,
    imageUrl: `${SOURCE}/storage/190/conversions/IMG_20240723_093517-list.jpg`,
    accent: '#facc15',
  },
  {
    slug: 'rolunk',
    label: 'Rolunk',
    display: 'Rólunk',
    url: `${SOURCE}/rolunk`,
    imageUrl: `${SOURCE}/storage/204/conversions/Colstok-10-list.jpg`,
    accent: '#14b8a6',
  },
  {
    slug: 'kapcsolat',
    label: 'Kapcsolat',
    display: 'Kapcsolat',
    url: `${SOURCE}/kapcsolat`,
    imageUrl: `${SOURCE}/images/og-image.webp`,
    accent: '#f97316',
  },
]

const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&rsquo;/g, "'")
  .replace(/&ldquo;/g, '"')
  .replace(/&rdquo;/g, '"')
  .replace(/&ndash;/g, '-')
  .replace(/&mdash;/g, '-')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

function stripHtml(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchMeta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
  return stripHtml(html.match(re)?.[1] || '')
}

function extractPage(html, fallbackTitle) {
  const title = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || fallbackTitle)
  const description = matchMeta(html, 'description')
  const headings = [...html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(match => stripHtml(match[2]))
    .filter(text => text && !/hogyan mukodik|hogyan működik|kerjen arajanlatot|kérjen árajánlatot/i.test(text))
    .slice(0, 8)
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => stripHtml(match[1]))
    .filter(text => text.length > 80)
    .filter(text => !/részletek|reszletek|összes szolgáltatás/i.test(text))
    .slice(0, 5)
  return {
    title,
    description,
    headings,
    paragraphs,
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pageHtml(station, page, imagePath) {
  const bullets = page.headings.map(heading => `<li>${escapeHtml(heading)}</li>`).join('\n')
  const paragraphs = page.paragraphs
    .map(text => `<p>${escapeHtml(text)}</p>`)
    .join('\n')
  return `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(page.title)} - Colstok Oasis panel</title>
  <style>
    :root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; background: #080a0d; color: #f8fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #121212 0%, #071015 55%, #030506 100%); }
    header { min-height: 240px; display: grid; align-items: end; padding: 28px; background: linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.72)), url("${imagePath}") center/cover; border-bottom: 6px solid ${station.accent}; }
    .brand { display: inline-flex; width: max-content; max-width: 100%; padding: 6px 10px; background: ${station.accent}; color: #111; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    h1 { margin: 12px 0 0; max-width: 900px; font-size: clamp(32px, 7vw, 78px); line-height: .95; letter-spacing: 0; text-shadow: 0 8px 30px rgba(0,0,0,.65); }
    main { max-width: 980px; margin: 0 auto; padding: 28px; }
    .lede { font-size: 20px; line-height: 1.55; color: #e2e8f0; border-left: 4px solid ${station.accent}; padding-left: 16px; }
    .grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(260px,.55fr); gap: 24px; align-items: start; }
    p { color: #dbe4ef; font-size: 16px; line-height: 1.68; }
    ul { margin: 0; padding: 18px 20px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
    li { margin: 0 0 12px; color: #f8fafc; font-weight: 700; }
    a { color: ${station.accent}; font-weight: 800; }
    footer { padding: 20px 28px 30px; color: #94a3b8; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } header { min-height: 210px; padding: 20px; } main { padding: 20px; } }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand">COLSTOK</div>
      <h1>${escapeHtml(page.title || station.display)}</h1>
    </div>
  </header>
  <main>
    <p class="lede">${escapeHtml(page.description || station.display)}</p>
    <div class="grid">
      <section>${paragraphs}</section>
      <aside>
        <ul>${bullets}</ul>
      </aside>
    </div>
  </main>
  <footer>
    Source: <a href="${station.url}" target="_blank" rel="noreferrer">${escapeHtml(station.url)}</a>
  </footer>
</body>
</html>
`
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Oasis Colstok world builder/1.0',
      accept: '*/*',
    },
  })
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function fetchText(url) {
  return (await fetchBuffer(url)).toString('utf8')
}

async function writeAsset(station) {
  const buffer = await fetchBuffer(station.imageUrl)
  const filename = `${station.slug}.webp`
  const outputPath = path.join(ASSET_DIR, filename)
  await sharp(buffer)
    .resize(1152, 768, { fit: 'cover' })
    .webp({ quality: 78 })
    .toFile(outputPath)
  return `/builder/colstok/assets/${filename}`
}

async function writeLogo() {
  const svg = await fetchBuffer(`${SOURCE}/images/colstok.svg`)
  await fs.writeFile(path.join(ASSET_DIR, 'colstok.svg'), svg)
  await sharp(svg)
    .resize(1200, 772, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(ASSET_DIR, 'colstok-logo.png'))
  return '/builder/colstok/assets/colstok-logo.png'
}

function yawTowardCenter(position) {
  return Math.atan2(-position[0], -position[2])
}

function groundTilesForPath(x0, z0, x1, z1, presetId, tiles) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = Math.round(x0 + (x1 - x0) * t)
    const z = Math.round(z0 + (z1 - z0) * t)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        tiles[`${x + dx},${z + dz}`] = presetId
      }
    }
  }
}

function makeText(id, text, position, opts = {}) {
  return {
    id,
    type: 'text_3d',
    text,
    fontId: opts.fontId || 'helvetiker_bold',
    size: opts.size || 0.42,
    depth: opts.depth || 0.08,
    color: opts.color || '#ffdf00',
    toneBias: opts.toneBias ?? 0,
    shininess: opts.shininess ?? 0.75,
    position,
    rotation: opts.rotation || (opts.billboard ? [0, 0, 0] : [0, yawTowardCenter(position), 0]),
    ...(opts.billboard ? { billboard: true } : {}),
    authorId: 'colstok-world-builder',
    createdAt: opts.createdAt || Date.now(),
  }
}

function makeStationObjects(station, index, localImagePath) {
  const radius = 18
  const angle = -Math.PI / 2 + (index / services.length) * Math.PI * 2
  const position = [Number((Math.cos(angle) * radius).toFixed(2)), 0, Number((Math.sin(angle) * radius).toFixed(2))]
  const yaw = yawTowardCenter(position)
  const objectId = `colstok-building-${station.slug}`

  return {
    placement: {
      id: objectId,
      catalogId: 'generated-image',
      name: station.display,
      glbPath: '',
      imageUrl: localImagePath,
      imageDisplayMode: '3d',
      imageFrameStyle: 'building',
      imageBuildingFrameColor: station.accent,
      imageBuildingFrameThickness: index < 8 ? 0.18 : 0.14,
      position,
      rotation: [0, yaw, 0],
      scale: index < 8 ? 4.7 : 3.8,
    },
    text: makeText(
      `colstok-label-${station.slug}`,
      station.label,
      [position[0], index < 8 ? 5.65 : 4.65, position[2]],
      { size: index < 8 ? 0.42 : 0.34, depth: 0.08, color: station.accent, billboard: true },
    ),
    behavior: {
      [objectId]: {
        visible: true,
        movement: { type: 'static' },
        label: station.display,
        interaction: {
          label: `Open ${station.label}`,
          radius: index < 8 ? 5.4 : 4.8,
          actions: [
            {
              type: 'html_overlay',
              title: station.display,
              url: `/builder/colstok/pages/${station.slug}.html`,
              opacity: 0.8,
            },
            {
              type: 'spawn_vfx',
              position: [position[0], 1.1, position[2]],
            },
          ],
        },
      },
    },
    pathEnd: [Math.round(position[0]), Math.round(position[2])],
  }
}

async function main() {
  await loadLocalEnv()
  await fs.mkdir(ASSET_DIR, { recursive: true })
  await fs.mkdir(PAGE_DIR, { recursive: true })

  const logoPath = await writeLogo()
  const pages = []
  const localAssets = new Map()

  for (const station of services) {
    const [html, imagePath] = await Promise.all([
      fetchText(station.url),
      writeAsset(station),
    ])
    const page = extractPage(html, station.display)
    await fs.writeFile(path.join(PAGE_DIR, `${station.slug}.html`), pageHtml(station, page, imagePath), 'utf8')
    pages.push({ station, page, imagePath })
    localAssets.set(station.slug, imagePath)
    console.log(`[colstok] scraped ${station.slug}`)
  }

  const catalogPlacements = [
    {
      id: 'colstok-hero-logo',
      catalogId: 'generated-image',
      name: 'COLSTOK logo',
      glbPath: '',
      imageUrl: logoPath,
      imageFrameStyle: 'hologram',
      imageFrameThickness: 3,
      position: [0, 0, -7.2],
      rotation: [0, 0, 0],
      scale: 4.6,
    },
  ]
  const text3dObjects = [
    makeText('colstok-hero-title', 'COLSTOK', [0, 6.2, -7.25], { size: 1.16, depth: 0.16, color: '#ffdf00', billboard: true }),
    makeText('colstok-hero-subtitle', 'Epuletgepeszet Sopron', [0, 4.95, -7.2], { size: 0.38, depth: 0.07, color: '#ffffff', billboard: true }),
  ]
  const spatialWebObjects = [
    {
      id: 'colstok-start-panel',
      type: 'output',
      label: 'Colstok world draft',
      value: 'Walk to any picture building. Press F, or tap Interact on mobile, to open that Colstok section as a readable overlay.',
      position: [0, 1.15, -1.8],
      rotation: [0, 0, 0],
      width: 4.8,
      height: 1.4,
      accentColor: '#ffdf00',
      visualStyle: 'terminal-panel',
    },
  ]
  const behaviors = {}
  const groundTiles = {}
  const now = Date.now()

  for (let x = -5; x <= 5; x += 1) {
    for (let z = -5; z <= 5; z += 1) {
      groundTiles[`${x},${z}`] = 'kn-cobblestone'
    }
  }

  pages.forEach(({ station, imagePath }, index) => {
    const objects = makeStationObjects(station, index, imagePath)
    catalogPlacements.push(objects.placement)
    text3dObjects.push({ ...objects.text, createdAt: now + index })
    Object.assign(behaviors, objects.behavior)
    groundTilesForPath(0, 0, objects.pathEnd[0], objects.pathEnd[1], 'kn-cobblestone', groundTiles)
  })

  const worldState = {
    version: 1,
    terrain: null,
    terrainHeights: [],
    groundPresetId: 'grass',
    groundTiles,
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements,
    portalGates: [],
    spatialWebObjects,
    paintStrokes: [],
    text3dObjects,
    transforms: {},
    behaviors,
    lights: [
      { id: 'colstok-world-env', type: 'environment', color: '#ffffff', intensity: 1.35, position: [0, 0, 0] },
      { id: 'colstok-world-hemi', type: 'hemisphere', color: '#fff7c2', groundColor: '#132012', intensity: 0.95, position: [0, 8, 0] },
      { id: 'colstok-world-sun', type: 'directional', color: '#ffe08a', intensity: 2.1, position: [-9, 12, 8], target: [0, 0, 0], castShadow: true },
      { id: 'colstok-logo-wash', type: 'point', color: '#ffdf00', intensity: 2.4, position: [0, 5, -5], castShadow: false },
    ],
    skyBackgroundId: 'umhlanga_sunrise',
    agentWindows: [],
    agentAvatars: [],
  }

  const manifest = {
    buildVersion: BUILD_VERSION,
    source: SOURCE,
    worldId: WORLD_ID,
    generatedAt: new Date().toISOString(),
    assets: Object.fromEntries(localAssets),
    pages: services.map(station => ({
      slug: station.slug,
      url: station.url,
      page: `/builder/colstok/pages/${station.slug}.html`,
    })),
  }

  await fs.writeFile(path.join(PUBLIC_ROOT, 'source-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await fs.writeFile(path.join(PUBLIC_ROOT, 'colstok-world.json'), JSON.stringify(worldState, null, 2), 'utf8')

  const prisma = new PrismaClient()
  const nowDate = new Date()
  try {
    await prisma.world.upsert({
      where: { id: WORLD_ID },
      create: {
        id: WORLD_ID,
        userId: 'local-user',
        name: 'COLSTOK World Draft',
        icon: 'C',
        visibility: 'unlisted',
        creatorName: 'Oasis URL-to-world POC',
        thumbnailUrl: logoPath,
        data: JSON.stringify(worldState),
        objectCount: catalogPlacements.length + spatialWebObjects.length + text3dObjects.length,
        createdAt: nowDate,
        updatedAt: nowDate,
      },
      update: {
        name: 'COLSTOK World Draft',
        icon: 'C',
        visibility: 'unlisted',
        creatorName: 'Oasis URL-to-world POC',
        thumbnailUrl: logoPath,
        data: JSON.stringify(worldState),
        objectCount: catalogPlacements.length + spatialWebObjects.length + text3dObjects.length,
        updatedAt: nowDate,
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  console.log(`[colstok] world upserted: ${WORLD_ID}`)
  console.log(`[colstok] local URL: http://localhost:4516/w/${WORLD_ID}`)
}

main().catch(error => {
  console.error('[colstok] failed:', error)
  process.exit(1)
})
