---
sidebar_position: 3
title: Persistence
---

# Persistence

## Storage Layers

The Oasis uses multiple local storage layers:

| Storage | Location | Purpose |
|---------|----------|---------|
| **SQLite** | `prisma/data/oasis.db` | Missions, profiles, memories, worlds, snapshots, token burn, app config |
| **Asset Registry** | `data/conjured-registry.json` | Conjured asset metadata |
| **Scene Library** | `data/scene-library.json` | Saved crafted scenes that outlive a single world |
| **Hermes Pairing** | `data/hermes-config.local.json` | Stored Hermes API pairing |
| **Hermes Tunnel** | `data/hermes-tunnel.local.json` | Saved SSH tunnel command |
| **GLB Files** | `public/conjured/` | Runtime-generated 3D models |
| **Generated Images** | `public/generated-images/` | Text-to-image outputs |
| **Legacy Leftovers** | `data/worlds/*.json`, `data/oasis.db` | Older artifacts not read by the current world API |

All storage is local. There is no required cloud database.

Prisma resolves `DATABASE_URL="file:./data/oasis.db"` relative to `prisma/schema.prisma`, so the live SQLite file is `prisma/data/oasis.db`, not repo-root `data/oasis.db`.

## World Persistence

### WorldState Schema

```typescript
interface WorldState {
  version: 1
  terrain: TerrainParams | null
  groundPresetId?: string
  groundTiles?: Record<string, string>
  craftedScenes: CraftedScene[]
  conjuredAssetIds: string[]
  catalogPlacements?: CatalogPlacement[]
  transforms: Record<string, Transform>
  behaviors?: Record<string, ObjectBehavior>
  lights?: WorldLight[]
  skyBackgroundId?: string
  customGroundPresets?: GroundPreset[]
  agentWindows?: AgentWindow[]
  agentAvatars?: AgentAvatar[]
  savedAt: string
}
```

### Save Strategy

```text
Change detected
  -> saveWorldState() in Zustand
  -> _worldReady guard check
  -> nuke protection check
  -> 1000ms debounce
  -> PUT /api/worlds/[id]
  -> prisma.world.update({ data: JSON.stringify(worldState) })
  -> snapshotBeforeSave() + objectCount sync
```

Browser edits and MCP/subagent edits converge on the same storage target: the `World.data` JSON string in SQLite.

### Migration

`migrateIfNeeded()` is currently a no-op. The old file-based `data/worlds/*.json` model is legacy, and there is no live file-to-SQLite loader in the current app.

## SQLite Schema (Prisma)

### Core Tables

**Mission** - atomic unit of work
- Status lifecycle: `todo -> wip -> done -> archived`
- Priority triangle: urgency x easiness x impact
- Scoring: valor x priority x time

**World** - world container
- Full `WorldState` stored in the `data` field
- Metadata: name, icon, visibility, visit count, object count
- One row per world

**WorldSnapshot** - version history
- Full `WorldState` snapshot
- Source: `auto` or `manual`
- Indexed by `worldId` and timestamp

**Profile** - local user data
- Display name, bio, avatar URLs
- XP, level, aura

**Memory** - structured knowledge
- Categories: preference, habit, goal, fact, pattern
- Key-value pairs

**Journal** - timestamped reflections

**TokenBurn** - aggregated token usage tracking

**AppConfig** - dynamic settings

**CuratorLog** and **CarbonModelEntry** - agent and training metadata

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/worlds` | GET, POST | List, create, import worlds |
| `/api/worlds/[id]` | GET, PUT, PATCH, DELETE | Load, save, rename, delete a world |
| `/api/worlds/[id]/snapshots` | GET, PUT, POST | List, create, restore snapshots |
| `/api/worlds/scene-library` | GET, PUT, POST | Persist the crafted-scene library JSON |
