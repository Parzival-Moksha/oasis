#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import prismaClientPkg from '../node_modules/.prisma/client/index.js'

const { PrismaClient } = prismaClientPkg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const publicRoot = path.join(repoRoot, 'public')

const args = new Set(process.argv.slice(2))
const shouldFix = args.has('--fix')
const strict = args.has('--strict')
const jsonOutput = args.has('--json')
const worldIdArg = process.argv.find(arg => arg.startsWith('--world-id='))
const worldIdFilter = worldIdArg ? worldIdArg.slice('--world-id='.length) : ''

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function loadStaticCatalog() {
  const extras = readJson('data/asset-catalog-extras.json')
  const source = readFileSync(path.join(repoRoot, 'src/components/scene-lib/constants.ts'), 'utf8')
  const start = source.indexOf('const _BASE_ASSET_CATALOG')
  const end = source.indexOf('CATALOG MERGE', start)
  if (start < 0 || end < 0) {
    throw new Error('Could not locate _BASE_ASSET_CATALOG in constants.ts')
  }

  const baseSource = source.slice(start, end)
  const deletedIds = new Set(extras.deletedIds || [])
  const aliases = extras.legacyAliases || {}
  const active = new Map()
  const baseAll = new Map()
  const baseAssetPattern = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*path:\s*'([^']+)',\s*category:\s*'([^']+)'(?:,\s*defaultScale:\s*([0-9.]+))?\s*\}/g

  for (const match of baseSource.matchAll(baseAssetPattern)) {
    const [, id, name, assetPath, category, scale] = match
    const asset = {
      id,
      name,
      path: assetPath,
      category,
      defaultScale: scale ? Number(scale) : 1,
      source: 'constants',
    }
    baseAll.set(id, asset)
    if (deletedIds.has(id)) continue
    active.set(id, asset)
  }

  for (const addition of extras.additions || []) {
    active.set(addition.id, { ...addition, source: 'extras' })
  }

  return { active, aliases, deletedIds, baseAll }
}

function inferLegacyCatalogAlias(id, catalog) {
  if (!catalog.deletedIds.has(id)) return ''
  const asset = catalog.baseAll.get(id)
  if (!asset) return ''

  const haystack = `${asset.id} ${asset.name} ${asset.path} ${asset.category}`.toLowerCase()
  const target = (...ids) => ids.find(candidate => catalog.active.has(candidate)) || ''

  if (haystack.includes('/kenney-urban/')) {
    if (haystack.includes('light double')) return target('light_street2')
    if (haystack.includes('light')) return target('light_street1')
    if (haystack.includes('bench')) return target('fantasy-props_bench', 'kf_bench')
    if (haystack.includes('shrub')) return target('stylized-nature_bush_common')
    if (haystack.includes('pine small')) return target('stylized-nature_pine_1')
    if (haystack.includes('pine')) return target('stylized-nature_pine_4')
    if (haystack.includes('tree')) return target('stylized-nature_commontree_3')
    if (haystack.includes('grass hill')) return target('highlands_grass_03')
    if (haystack.includes('grass')) return target('highlands_grass_01')
    if (haystack.includes('cliff')) return target('highlands_wallmid')
    if (haystack.includes('wall') && haystack.includes('door')) return target('qv_wall_plaster_door', 'qmv_wall_unevenbrick_door_flat')
    if (haystack.includes('wall') && haystack.includes('window')) return target('qv_wall_plaster_window', 'qmv_wall_unevenbrick_window_wide_flat')
    if (haystack.includes('wall')) return target('qv_wall_plaster', 'qmv_wall_unevenbrick_straight')
    if (haystack.includes('door')) return target('qmv_door_1_flat')
    if (haystack.includes('window')) return target('qmv_window_wide_flat1')
    if (haystack.includes('roof')) return target('qmv_roof_wooden_2x1', 'qv_roof_roundtiles')
    if (haystack.includes('road')) return target('qmv_floor_unevenbrick')
    return target('qmv_floor_unevenbrick', 'qmv_floor_brick')
  }

  if (haystack.includes('/kenney-medieval/')) {
    if (haystack.includes('tower top')) return target('qv_roof_tower', 'highlands_tower')
    if (haystack.includes('tower')) return target('highlands_tower')
    if (haystack.includes('battlement')) return target('highlands_wallmid', 'qv_wall_arch')
    if (haystack.includes('wall') && (haystack.includes('door') || haystack.includes('gate'))) return target('qv_wall_plaster_door', 'qmv_wall_unevenbrick_door_flat')
    if (haystack.includes('wall') && haystack.includes('window')) return target('qv_wall_plaster_window', 'qmv_wall_unevenbrick_window_wide_flat')
    if (haystack.includes('wall')) return target('qv_wall_plaster', 'qmv_wall_unevenbrick_straight')
    if (haystack.includes('roof')) return target('qv_roof_roundtiles', 'qmv_roof_roundtiles_6x8')
    if (haystack.includes('stairs') || haystack.includes('steps')) return target('qv_stairs_exterior', 'qmv_stairs_exterior_straight_center')
    if (haystack.includes('dock corner')) return target('qmv_floor_wooddark_overhangcorner', 'qmv_floor_wooddark')
    if (haystack.includes('dock') || haystack.includes('wood floor')) return target('qmv_floor_wooddark')
    if (haystack.includes('floor')) return target('qmv_floor_brick')
    if (haystack.includes('column') || haystack.includes('structure') || haystack.includes('pole')) return target('qmv_prop_support')
    if (haystack.includes('brick')) return target('qmv_prop_brick1', 'qmv_floor_brick')
    if (haystack.includes('barrels')) return target('fantasy-props_barrel_holder', 'fantasy-props_barrel')
    if (haystack.includes('barrel')) return target('fantasy-props_barrel', 'highlands_barrel')
    if (haystack.includes('crate')) return target('qmv_prop_crate', 'fantasy-props_crate_wooden')
    if (haystack.includes('shrub')) return target('stylized-nature_bush_common')
    if (haystack.includes('tree')) return target('stylized-nature_commontree_3')
    if (haystack.includes('water')) return target('qmv_floor_unevenbrick', 'highlands_grass_02')
    return target('qmv_floor_brick')
  }

  return ''
}

function resolveCatalogId(id, catalog) {
  let current = id
  const seen = new Set()
  while (catalog.aliases[current] && !seen.has(current)) {
    seen.add(current)
    current = catalog.aliases[current]
  }
  return inferLegacyCatalogAlias(current, catalog) || current
}

function isLocalServedPath(assetPath) {
  return typeof assetPath === 'string'
    && assetPath.length > 0
    && !assetPath.startsWith('http://')
    && !assetPath.startsWith('https://')
    && !assetPath.startsWith('data:')
    && !assetPath.startsWith('blob:')
}

function localPathExists(assetPath) {
  if (!isLocalServedPath(assetPath)) return true
  const clean = assetPath.split('?')[0].split('#')[0].replace(/^\/+/, '')
  return existsSync(path.join(publicRoot, clean))
}

function summarizeIssue(issue) {
  const suffix = issue.reason ? ` (${issue.reason})` : ''
  if (issue.type === 'legacy-alias') {
    return `${issue.worldId} :: ${issue.placementId} :: ${issue.from} -> ${issue.to}${suffix}`
  }
  return `${issue.worldId} :: ${issue.placementId} :: ${issue.catalogId || '(no catalogId)'}${suffix}`
}

const staticCatalog = loadStaticCatalog()
const prisma = new PrismaClient()

try {
  const dbAssets = await prisma.asset.findMany({
    select: { id: true, name: true, path: true, defaultScale: true, category: true, scope: true },
  })
  for (const asset of dbAssets) {
    staticCatalog.active.set(asset.id, { ...asset, source: 'asset-table' })
  }

  const worlds = await prisma.world.findMany({
    where: worldIdFilter ? { id: worldIdFilter } : undefined,
    select: { id: true, name: true, visibility: true, data: true },
    orderBy: { updatedAt: 'desc' },
  })

  const issues = []
  const fixed = []
  let placementCount = 0

  for (const world of worlds) {
    if (!world.data) continue

    let state
    try {
      state = JSON.parse(world.data)
    } catch (error) {
      issues.push({
        type: 'invalid-world-json',
        worldId: world.id,
        worldName: world.name,
        placementId: '(world)',
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    const placements = Array.isArray(state.catalogPlacements) ? state.catalogPlacements : []
    if (placements.length === 0) continue

    let changed = false
    for (const placement of placements) {
      placementCount += 1
      if (!placement || typeof placement !== 'object') continue

      const placementId = typeof placement.id === 'string' ? placement.id : '(missing placement id)'
      const catalogId = typeof placement.catalogId === 'string' ? placement.catalogId : ''
      const hasMedia = Boolean(placement.imageUrl || placement.videoUrl || placement.audioUrl)
      const targetId = catalogId ? resolveCatalogId(catalogId, staticCatalog) : ''
      const target = targetId ? staticCatalog.active.get(targetId) : undefined

      if (target && catalogId !== target.id) {
        const issue = {
          type: 'legacy-alias',
          fixable: true,
          worldId: world.id,
          worldName: world.name,
          placementId,
          from: catalogId,
          to: target.id,
          oldPath: placement.glbPath || '',
          newPath: target.path,
        }
        issues.push(issue)

        if (shouldFix) {
          placement.catalogId = target.id
          placement.glbPath = target.path
          if (!placement.scale && target.defaultScale) placement.scale = target.defaultScale
          changed = true
          fixed.push(issue)
        }
        continue
      }

      const pathToCheck = target?.path || placement.glbPath || ''
      if (!hasMedia && pathToCheck && !localPathExists(pathToCheck)) {
        issues.push({
          type: 'missing-path',
          worldId: world.id,
          worldName: world.name,
          placementId,
          catalogId,
          reason: `${pathToCheck} is not present under public/`,
        })
        continue
      }

      if (!hasMedia && catalogId && !target && !placement.glbPath) {
        issues.push({
          type: 'unknown-catalog',
          worldId: world.id,
          worldName: world.name,
          placementId,
          catalogId,
          reason: 'no active catalog/asset-table entry and no fallback glbPath',
        })
      }
    }

    if (shouldFix && changed) {
      state.savedAt = new Date().toISOString()
      await prisma.world.update({
        where: { id: world.id },
        data: { data: JSON.stringify(state) },
      })
    }
  }

  const summary = {
    mode: shouldFix ? 'fix' : 'audit',
    worldsScanned: worlds.length,
    placementsScanned: placementCount,
    issueCount: issues.length,
    fixableCount: issues.filter(issue => issue.fixable).length,
    fixedCount: fixed.length,
    unresolvedCount: issues.filter(issue => !issue.fixable).length,
    issues,
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`[catalog audit] mode=${summary.mode} worlds=${summary.worldsScanned} placements=${summary.placementsScanned} issues=${summary.issueCount} fixable=${summary.fixableCount} unresolved=${summary.unresolvedCount} fixed=${summary.fixedCount}`)
    for (const issue of issues.slice(0, 100)) {
      console.log(`- ${issue.type}: ${summarizeIssue(issue)}`)
    }
    if (issues.length > 100) console.log(`... ${issues.length - 100} more issues not shown`)
    if (!shouldFix && issues.length > 0) console.log('Run again with --fix to rewrite legacy aliases in world JSON.')
  }

  if (strict && summary.unresolvedCount > 0) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
