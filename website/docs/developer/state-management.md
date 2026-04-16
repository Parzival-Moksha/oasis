---
sidebar_position: 2
title: State Management
---

# State Management

The Oasis uses a single **Zustand** store (`src/store/oasisStore.ts`) as the single source of truth for all application state.

## Store Structure

The store manages:

### World Registry
- All saved worlds and their metadata
- Active world ID
- World switching

### World State
- Placed objects (catalog + conjured + crafted)
- Terrain parameters
- Ground tiles (sparse map)
- Lights array
- Sky background ID
- Agent windows and avatars
- Object transforms and behaviors

### UI State
- Selected object ID
- Transform gizmo mode (translate/rotate/scale)
- Active Wizard Console tab
- Panel opacity

### Camera State
- Position, rotation
- Control mode (orbit/noclip/TPS)
- FOV, sensitivity, move speed

### Settings
- Bloom, vignette, chromatic aberration
- Show orbit target, grid, FPS counter
- Sky background, UI opacity
- Stream opacity

## Key Patterns

### Always Use `getState()` in Intervals

```typescript
// ❌ BAD — stale closure
const { position } = useOasisStore()
setInterval(() => console.log(position), 1000)

// ✅ GOOD — fresh read every tick
setInterval(() => {
  const { position } = useOasisStore.getState()
  console.log(position)
}, 1000)
```

Zustand subscriptions capture values at render time. Inside `setInterval`, `setTimeout`, or any long-lived callback, always use `useStore.getState()`.

### Debounced World Saves

The store exposes `debouncedSaveWorld()` which:

1. Waits **100ms** after the first change
2. Coalesces additional changes within a **1000ms** window
3. Writes the full world state to SQLite

Never call `saveWorldState()` in tight loops.

### World Ready Guard

The `_worldReady` flag must be `true` before any save is allowed. This prevents empty-state overwrites during world loading.

Additionally, `_loadedObjectCount` tracks how many objects were loaded. If 5+ objects were loaded but a save attempt has 0 objects, nuke protection blocks it.

## Key Methods

| Method | Description |
|--------|-------------|
| `loadWorld(id)` | Load a world by ID |
| `saveWorld(id, state)` | Save world state |
| `createWorld(name, icon)` | Create new world |
| `deleteWorld(id)` | Delete a world |
| `exportWorld(id)` | Export as JSON |
| `importWorld(data, name)` | Import from JSON |
| `awardXp(amount)` | XP progression hook |
| `getCameraSnapshot()` | Current camera state |
| `migrateIfNeeded(world)` | Handle schema upgrades |

## VFX State

The store also manages visual effects:

- **8 conjure effects**: textswirl, arcane, vortex, quantumassembly, primordialcauldron, stellarnursery, chronoforge, abyssalemergence
- **12 placement effects**: runeflash, sparkburst, portalring, sigilpulse, and more
- Active VFX tracking (position, type, duration, animation state)
