---
sidebar_position: 5
title: Gotchas
---

# Gotchas

Hard-won lessons from building a 3D world builder in React. Read these before contributing.

## React Three Fiber

### InstancedMesh + `map=null`

If an `InstancedMesh` has `map=null` on its material, the GPU compiles the shader **without** a texture sampler. When you later assign a texture, the shader recompiles — causing a frame hitch.

**Fix:** Always use a placeholder texture (1x1 white pixel) instead of null.

### Declarative Props on InstancedMesh

R3F's declarative prop system is unreliable for dynamic textures on `InstancedMesh`. Props may not trigger re-renders correctly.

**Fix:** Use imperative refs. Set `mesh.material.map = texture` directly.

### drei `<Html>` with `transform`

`<Html transform>` creates a CSS overlay — it's **not** in the WebGL depth buffer. It won't be occluded by 3D objects.

**Fix:** Use `zIndexRange={[0,0]}` to minimize z-fighting. Accept that HTML overlays are always "on top" of the 3D scene.

## Next.js

### SSR and `document`

Never use `document`, `window`, or other browser APIs at module level. Next.js pre-renders on the server where these don't exist.

**Fix:** Lazy-initialize in functions, use `useEffect`, or dynamic imports with `ssr: false`.

### `globalThis` Cache in Route Handlers

Next.js dev mode splits route handlers into separate chunks. A cache in one route handler won't be visible to another.

**Fix:** Pin caches to `globalThis` (e.g., `globalThis.__registryCache`).

## Zustand

### Stale Closures in Intervals

```typescript
// ❌ BAD — captures value at render time
const count = useStore(s => s.count)
setInterval(() => console.log(count), 1000) // always logs initial value

// ✅ GOOD — reads fresh value each time
setInterval(() => console.log(useStore.getState().count), 1000)
```

Always use `useStore.getState()` inside `setInterval`, `setTimeout`, or any long-lived callback.

## World Persistence

### Save Debouncing

World saves use 100ms + 1000ms debouncing. Don't call `saveWorldState()` in tight loops or you'll queue redundant writes.

### `_worldReady` Guard

The `_worldReady` flag must be `true` before any save is allowed. This prevents saving an empty state during world loading.

### Nuke Protection

If the system loaded 5+ objects but a save attempt contains 0 objects, the save is blocked. This prevents accidental world wipes from state race conditions.

## URLs

### External URL Detection

When handling asset URLs, check `startsWith('http')` before prepending the app's basePath. Otherwise you'll create broken URLs like `/conjured/https://cdn.meshy.ai/...`.

## Performance

### FPS is Never Capped

`frameloop="always"` runs at native refresh rate. **Never** add FPS limiting. The Oasis is built for gamers who want 250fps.

## Agent Sessions

### Session ID Collision

Two Claude Code windows sharing a session ID will corrupt each other's context. Every window MUST have a unique session ID.

### HMR Safety

`pnpm dev` hot-reloads without restarting the server. You can edit files while it's running — but be careful with state that persists across HMR (Zustand stores, globalThis caches).
