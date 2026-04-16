---
sidebar_position: 8
title: World Management
---

# World Management

## Creating Worlds

Click the world selector at the top of the Wizard Console, then choose **+ Create**. Each world is a completely independent save.

## World State

Every world stores:

| Data | Description |
|------|-------------|
| **Terrain** | Heightmap parameters and biome settings |
| **Ground** | Default preset plus sparse tile paint map |
| **Objects** | Catalog placements with transforms |
| **Crafted Scenes** | LLM-generated geometry |
| **Conjured Assets** | Text-to-3D model references |
| **Lights** | Point, spot, and hemisphere lights |
| **Sky** | Background environment ID |
| **Agent Windows** | 3D panels with position, size, and style |
| **Agent Avatars** | Embodied agent positions |
| **Behaviors** | Per-object animations and movement rules |

## Persistence

Worlds are stored in SQLite:

```text
prisma/data/oasis.db
```

Each world lives in the `World` table, with the full serialized `WorldState` stored in the `data` column.
Browser edits and MCP/subagent edits write back to that same row.

Legacy files can still exist under `data/worlds/`, but the current `/api/worlds` load/save path does not read them.
If you spot `data/oasis.db` in the repo root, treat it the same way: it is not the active Forge database.

### Autosave

The Oasis autosaves through `/api/worlds/[id]` using:

- **1000ms debounce** to coalesce rapid changes
- **`_worldReady` guard** so an empty boot state cannot overwrite a loaded world
- **Nuke protection** so a world that loaded 5+ objects cannot suddenly save 0 by mistake

### Snapshots

World snapshots provide version history. Snapshots can be:

- **Auto** - created before overwrites, throttled to avoid spam
- **Manual** - created on demand from the snapshots route

Snapshots live in the `WorldSnapshot` table inside the same SQLite database.

## Import / Export

Worlds are still portable as JSON exports. You can:

- **Export** a world as a JSON file
- **Import** a JSON file as a new world row in SQLite
- **Move** exported JSON between machines

The portable format is the export file, not the on-disk storage layout.

## Multiple Worlds

Switch between worlds instantly via the world selector. Each world keeps its own terrain, sky, objects, agents, lights, and behaviors.

On a fresh database, Oasis auto-creates a first world named **The Forge**.
