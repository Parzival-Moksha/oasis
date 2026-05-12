# Paint Wand + 3D Text

> Wizardry tubes through 3-space + extruded shiny words. Real-time multiplayer,
> csillagszóró-tipped, playback-able from the Joystick.

This doc is the dropoff for the paint-wand + 3D-text feature. It covers what
got built, where the code lives, the architectural decisions (and the live
trade-offs behind each), the multiplayer protocol, the permission model, what
to test manually, and what's deferred.

The feature shipped over seven commits between [d053367..8abb3dc](#commit-history).

---

## TL;DR

- **Paint Wand**: Hold LMB and drag to draw a glowing 3D tube (or 2D ribbon)
  through space. Color, thickness, shine, distance, 2D/3D mode, and
  velocity-thickness are all panel-controlled. Strokes broadcast live to
  every other visitor in the same world via the Colyseus mutation channel.
  Each stroke persists with the world. Click any stroke to select; double-
  click to open the Joystick where a Play button replays the stroke from
  start to end with a sparkler riding the leading edge over a chosen
  duration (1–20s).
- **3D Text**: Type, pick a font (10 typeface variants), set size / depth /
  shine / color, hit "Place 3m in front" to drop the extruded glyphs facing
  the camera. Selectable, draggable via TransformControls, live-editable
  from the Joystick.
- **Mobile**: Held lower-right Paint button arms the wand while pressed;
  the look-overlay flips `pointer-events-none` so canvas drags route to
  PaintCursor; release to return the canvas to camera-look.
- **Permissions**: Treated as world-scoped assets. Hidden in read-only
  worlds (mobile button + WorldMenu Paint button + panels all gated).

---

## File map

```
src/lib/forge/
  paint-stroke.ts            # types, constants, helpers (PAINT_MAX_POINTS, thicknessForSegment)
  text-3d-object.ts          # types, font registry (10 fonts, helvetiker local + 9 unpkg)
  live-strokes.ts            # transient in-progress stroke store (useSyncExternalStore)
src/lib/
  multiplayer-color.ts       # extracted colorForPlayerId — used by ForgeRealm + presence layer
  world-mutation-bus.ts      # extended with stroke_started/pointed/ended/removed + text3d_*
src/components/forge/
  Sparkler.tsx               # csillagszóró VFX — THREE.Points particle system
  PaintStrokeMesh.tsx        # render persisted/live stroke (TubeGeometry or drei Line) + click handlers
  PaintCursor.tsx            # input owner — useFrame sampler, pointer-lock-aware projection, broadcast
  LiveStrokesLayer.tsx       # subscribes useLiveStrokes, renders one PaintStrokeMesh per active stroke
  PaintBrushPanel.tsx        # floating panel — color/thickness/shine/distance/2D-3D/velocity
  Text3DPanel.tsx            # floating panel — text, font, size, depth, shine, color, place
  Text3DObjectMesh.tsx       # render persisted text — drei Text3D + FontErrorBoundary fallback
  WorldObjects.tsx           # PaintStrokesSection + Text3DSection + PaintStrokePlaybackTicker
  ObjectInspector.tsx        # PaintStrokePlaybackSection + Text3DEditSection (debounced)
  WorldMenu.tsx              # SCENE_BUTTONS includes Paint + Text 3D
  WizardConsole.tsx          # "This World" placed-objects list includes strokes + text
  MobileOasisControls.tsx    # MobilePaintHoldButton + look-overlay paint-aware flip
  MultiplayerPresenceLayer.tsx  # routes stroke + text3d mutations from peers
src/components/realms/
  ForgeRealm.tsx             # mounts ForgePaintCursor inside the Canvas
src/components/
  Scene.tsx                  # mounts PaintBrushPanel + Text3DPanel; paint-mode camera-mode lock
src/store/
  oasisStore.ts              # paintStrokes/text3dObjects state, actions, save/load round-trip
src/lib/forge/world-persistence.ts
                             # WorldState extended with paintStrokes + text3dObjects
src/lib/input-manager.ts     # requestPointerLock guarded against mobile devices
website/docs/developer/paint-wand.md   # this doc
```

---

## Data model

### PaintStroke

```ts
interface PaintStroke {
  id: string                          // 'stroke-<random>'
  type: 'paint_stroke'
  points: number[]                    // flat [x,y,z, x,y,z, ...]
  color: string                       // hex
  thickness: number                   // metres
  shininess: number                   // 0..1
  mode: '2d' | '3d'                   // ribbon vs tube
  varyByVelocity?: boolean            // segment-pair speed → thickness
  authorId?: string                   // presence id
  authorColor?: string                // sparkler tint
  createdAt: number                   // Date.now()
}
```

`points` is a flat number array (not `[number, number, number][]`) for compact
persistence and so live in-progress strokes can use cheap `Array.push` to
append three numbers per sample.

`PAINT_MAX_POINTS = 20000` ([src/lib/forge/paint-stroke.ts](../../../src/lib/forge/paint-stroke.ts)) —
~11 minutes of continuous drawing at 30Hz before sampling caps. TubeGeometry
vertex count is bounded by `tubularSegments` (220 vertices regardless of
input N), so the rendered mesh size doesn't grow with stroke length.

### Text3DObject

```ts
interface Text3DObject {
  id: string                          // 'text3d-<random>'
  type: 'text_3d'
  text: string                        // up to 240 chars
  fontId: Text3DFontId                // one of 10 font keys
  size: number                        // metres
  depth: number                       // extrusion metres
  color: string                       // hex
  shininess: number                   // 0..1
  position: [number, number, number]  // world position (transforms[id] overrides at runtime)
  rotation: [number, number, number]  // world rotation
  authorId?: string
  createdAt: number
}
```

### WorldState extension

[src/lib/forge/world-persistence.ts:60-67](../../../src/lib/forge/world-persistence.ts#L60-L67):

```ts
interface WorldState {
  // ... existing fields
  paintStrokes?: PaintStroke[]
  text3dObjects?: Text3DObject[]
  savedAt: string
}
```

Both are optional for backward compatibility with worlds that pre-date the
feature. Load defaults to `[]`. Save always includes them when present.

### oasisStore additions

State:
```ts
paintStrokes: PaintStroke[]
text3dObjects: Text3DObject[]
paintStrokePlayback: Record<string, { progress, durationSec, startedAt }>
paintBrushPanelOpen: boolean
text3dPanelOpen: boolean
paintHeldActive: boolean
paintBrushSettings: { color, thickness, shininess, distance, mode, varyByVelocity }
text3dSettings: { text, fontId, size, depth, color, shininess }
```

Actions: `addPaintStroke`, `removePaintStroke`, `applyRemotePaintStroke`,
`applyRemotePaintStrokeRemoval`, `playPaintStroke`,
`setPaintStrokePlaybackProgress`, `stopPaintStrokePlayback`, `addText3dObject`,
`updateText3dObject`, `removeText3dObject`, plus the matching `applyRemote*`
trio, plus the panel-open + held-active + settings-update setters.

`setPaintHeldActive` is the load-bearing one — see
[Camera + pointer-lock](#camera--pointer-lock) below.

---

## Multiplayer protocol

Strokes ride the existing **Colyseus mutation channel** (NOT the OpenClaw
relay sidecar — that's for browser↔external-agent bridges, separate surface).

The bus pattern is in [src/lib/world-mutation-bus.ts](../../../src/lib/world-mutation-bus.ts).
Local writers call `worldMutationBus.broadcast({kind, payload})` → goes out
via `MultiplayerRoomConnection.sendMutation`. Remote arrivals come in via the
room's `'mutation'` message → `applyIncoming` → all subscribers route by `kind`.

New mutation kinds (all extending `WorldMutation`):

```ts
| { kind: 'stroke_started'; payload: { strokeId, authorId, authorColor, style } }
| { kind: 'stroke_pointed'; payload: { strokeId, point: [x,y,z] } }
| { kind: 'stroke_ended';   payload: { strokeId, finalStroke: PaintStroke } }
| { kind: 'stroke_updated'; payload: { id, updates } }
| { kind: 'stroke_removed'; payload: { id } }
| { kind: 'text3d_added';   payload: Text3DObject }
| { kind: 'text3d_removed'; payload: { id } }
| { kind: 'text3d_updated'; payload: { id, updates: Partial<Text3DObject> } }
```

### Live stroke flow

1. Author starts dragging. PaintCursor.onPointerDown:
   - Generates `strokeId`, broadcasts `stroke_started`
   - Broadcasts `stroke_pointed` for the initial point
   - Calls `startLiveStroke(...)` locally — records into the `live-strokes`
     module (NOT the persisted oasisStore)
2. Each useFrame tick (while LMB held):
   - Computes camera-forward-at-distance-D point
   - Throttle: sample if `time >= 33ms OR distance >= 10cm` (relaxed from
     AND because slow careful artist drags would starve)
   - On sample: `appendLiveStrokePoint(strokeId, point)` + broadcast
     `stroke_pointed`
3. Author releases. PaintCursor.finishStroke:
   - Builds final `PaintStroke`, calls `addPaintStroke(stroke)` (local
     persisted store + schedules debounced `saveWorldState`)
   - Broadcasts `stroke_ended` with the final stroke object
   - Calls `endLiveStroke(strokeId)` locally — clears live preview

Remote receivers:
- `stroke_started` → `startLiveStroke(...)` (renders immediately as live)
- `stroke_pointed` → `appendLiveStrokePoint(...)` (geometry grows in real time)
- `stroke_ended` → `applyRemotePaintStroke(finalStroke)` THEN `endLiveStroke`
  in that order — persisted mesh mounts before the live preview clears so
  there's no one-frame visual blink

Echo is prevented by the Colyseus room's `broadcast(..., {except: client})` —
the originator never receives their own mutation back.

### live-strokes module

[src/lib/forge/live-strokes.ts](../../../src/lib/forge/live-strokes.ts) is a
module-level signal store outside zustand to avoid re-rendering unrelated UI
when a stroke gets a new point at 30Hz. Implementation: a global record of
`{[strokeId]: InProgressStroke}` plus a Set of listeners. `useLiveStrokes()`
exposes it via `useSyncExternalStore`.

`clearAllLiveStrokes` is called only on actual world change (tracked via
`clearedWorldIdRef` in MultiplayerPresenceLayer) — transient WS reconnects
no longer wipe in-progress strokes mid-draw.

### Critical render-update detail

[src/components/forge/PaintStrokeMesh.tsx:65](../../../src/components/forge/PaintStrokeMesh.tsx#L65):

```ts
const allPoints = useMemo(() => unpackPoints(points), [points, points.length])
```

The `points.length` dep is load-bearing. `live-strokes` mutates the inner
points array in place via `Array.push` — the outer array reference is stable
across appends. Without `points.length` in the dep list, `useMemo` would
never re-run and the live tube would only appear on `stroke_ended`.

---

## Camera + pointer-lock

Painting at a fixed-distance plane in front of the camera doesn't make sense
in **orbit mode** (where the camera rotates around a fixed target). So:

- **Auto-flip**: When `paintHeldActive` flips false→true while controlMode is
  `'orbit'`, [Scene.tsx:1582-1595](../../../src/components/Scene.tsx#L1582-L1595)
  switches to `'noclip'` (one-shot, doesn't fire repeatedly).
- **C-key cycle**: While paint is armed, `C` cycles only `noclip ↔
  third-person` (orbit excluded).
  [Scene.tsx:1547-1572](../../../src/components/Scene.tsx#L1547-L1572).

The 3D paint wand is an overlay on the current base camera mode. It does not
enter InputManager's legacy temporary `paint` state. Third-person stays
third-person; noclip stays noclip. Pointer-lock is requested on paint arm when
the current base mode supports it:

[oasisStore.ts setPaintHeldActive](../../../src/store/oasisStore.ts):

```ts
setPaintHeldActive: (active) => {
  set({ paintHeldActive: active })
  const im = useInputManager.getState()
  if (active) {
    im.requestPointerLock()
  } else if (im.inputState === 'paint') {
    im.returnToPrevious()            // cleanup for legacy sessions only
  }
}
```

PaintBrushPanel deliberately does NOT call `useUILayer` so it doesn't push
onto `_uiLayerStack` (which would block `requestPointerLock`). Trade-off:
keystrokes flow to the avatar even when the panel is "focused" — fine because
the panel has only sliders, color picker, and toggle buttons.

`InputManager.requestPointerLock` is guarded against mobile devices
([src/lib/input-manager.ts:467](../../../src/lib/input-manager.ts#L467)) —
pointer-lock on Android Chrome would starve the touch-camera fingers.

### Pointer-lock + projection

When pointer is locked, the OS cursor freezes and `clientX/clientY` go stale.
`PaintCursor.projectPointerToWorld` detects `document.pointerLockElement` and
forces NDC `(0,0)` — strokes always land on the crosshair regardless of
stale cursor. Mirrors the existing `PointerLockRaycaster` fix in Scene.tsx.

---

## Selection + inspection

R3F event bubbling from a thin TubeGeometry mesh up through nested groups
(SelectableWrapper's pattern) proved unreliable for stroke selection. Two
fixes:

1. **PaintStrokeMesh** wraps its render in `<group onClick onDoubleClick>`
   directly. R3F has a stable target to fire pointer events on.
   It also renders an invisible oversized tube as a pick target so thin
   strokes and 2D lines can be selected reliably.
2. **Persisted strokes drop SelectableWrapper entirely**
   ([WorldObjects.tsx PersistedPaintStroke](../../../src/components/forge/WorldObjects.tsx)).
   Strokes have no single anchor for TransformControls, and the ground-ring
   highlight makes no sense for in-air ribbons. Visual selection feedback
   comes from `material.emissiveIntensity += 0.85` when selected — the
   stroke literally glows brighter.

**Text3D** keeps SelectableWrapper (text needs the gizmo for repositioning)
but Text3DObjectMesh adds a backstop click-group inside as belt-and-suspenders.

### Selection while armed

While paint is **armed**, `PaintCursor` owns capture-phase pointerdown. Before
starting a new stroke it raycasts against persisted stroke hit targets. If the
click hits a stroke, it selects and inspects that stroke instead of drawing
over it; otherwise it starts a new stroke.

---

## Playback

Stored per-stroke in `paintStrokePlayback: Record<id, {progress, durationSec, startedAt}>`.
Started via `playPaintStroke(id, durationSec)` (called from the Joystick's
PaintStrokePlaybackSection or WizCon's ▶ button).

[PaintStrokePlaybackTicker](../../../src/components/forge/WorldObjects.tsx) is
a single useFrame loop in WorldObjects that advances every active playback's
`progress` each frame. Each `PersistedPaintStroke` subscribes ONLY to its own
playback entry via `useOasisStore(s => s.paintStrokePlayback?.[stroke.id])`
so a single stroke's per-frame progress update doesn't re-render the others.

When `progress < 1`, PaintStrokeMesh slices `visiblePoints` to a prefix and
renders a leading-edge Sparkler tinted by `authorColor`. After progress hits
1, holds for 0.5s then `stopPaintStrokePlayback(id)` clears the entry.

---

## Persistence

`WorldState.paintStrokes[]` and `WorldState.text3dObjects[]` are saved/loaded
through every save site in oasisStore:

- `loadWorldState` — populates from `world.paintStrokes / text3dObjects`
- `saveWorldState` — includes both in the WorldState payload
- `switchWorld` — pre-switch save includes both AND the destination load
  replaces both store slices
- The avatar-repair save path (auto-fired on load if any agent avatar URL is
  corrupted) includes both — was a silent data-loss bug in round 2
- `enterViewMode` — populates from the loaded view world (was dropping them
  in round 2; now correct)
- All world-clear / reset blocks include `paintStrokes: []`, `text3dObjects: []`

`captureWorldSnapshot` (used by `withUndo`) does a `structuredClone` of the
small structures (transforms, behaviors, etc.) but treats `paintStrokes` and
`text3dObjects` as immutable arrays — only a shallow `.slice()`. Otherwise
a 20K-point stroke (240KB flat number array) would deep-clone twice per
unrelated undo command, freezing the UI.

`addPaintStroke`, `removePaintStroke`, `updatePaintStroke`, and the matching
3D text add/update/remove paths go through `withUndo`. Snapshot capture keeps
stroke arrays shallow, so Ctrl+Z can delete/restore a stroke without deep-
cloning every 20K-point flat array.

---

## Permission model

Both the wand and 3D text are write-class operations. Gating:

- **WorldMenu Paint / Text 3D buttons** — gated by `canEditScene`
  (owner OR FFA/public_edit visitor).
  [WorldMenu.tsx](../../../src/components/forge/WorldMenu.tsx) SCENE_BUTTONS.
- **PaintBrushPanel + Text3DPanel** — mounted under
  `{!hideEditTools && <Panel/>}` in
  [Scene.tsx](../../../src/components/Scene.tsx) so read-only views can't
  open them via stale localStorage state.
- **MobilePaintHoldButton** — `if (isReadOnly) return null` directly
  in the component. Mobile users in read-only worlds don't see the button.
- **PersistedPaintStroke** + **Text3DObjectMesh** — onSelect/onInspect
  callbacks are `undefined` in read-only mode so clicks no-op.
- **`saveWorldState`** — early-returns when `isViewMode && !isViewModeEditable`,
  so even if some entry-point gets through, persistence is blocked.

Local dev is full-admin (no read-only state to gate on); hosted Oasis applies
the visibility-derived gates above.

---

## How to test manually

### Desktop happy path

1. `pnpm dev` → open `localhost:4516`
2. Open the World menu (top-left) → "Paint" tile → opens PaintBrushPanel
3. Cursor should immediately disappear (pointer-lock); crosshair visible
4. Hold LMB, drag the mouse → stroke grows in real time, sparkler at the
   leading edge
5. Walk around with WASD/QE while holding LMB → stroke continues to record
   even if you don't move the mouse (useFrame sampler)
6. Release LMB → stroke persists, sparkler vanishes, no visual blink
7. Close the panel → cursor returns, paint mode releases
8. Single-click the stroke → it glows brighter (emissive boost)
9. Double-click it → Joystick opens with ▶ Play button + 1–20s slider
10. Hit Play → stroke replays from start to end with sparkler at leading
    edge, then stays fully revealed
11. Open WizCon → "This World" tab → see the stroke in the list with color
    swatch + point count + ▶ + delete

### 3D Text path

1. World menu → "Text 3D" tile → opens Text3DPanel
2. Type text, pick a font (try the streamed ones — Optimer, Gentilis,
   Droid)
3. Tweak size/depth/shine/color
4. "Place 3m in front" → text appears facing you
5. Single-click → highlight ring appears (TransformControls)
6. Drag the gizmo arrows → text moves in 3D
7. Double-click → Joystick opens with text edit (textarea debounces 220ms)
8. Edit text → updates after pause typing

### Multiplayer test

1. Open the world in two browser windows / tabs (private mode for the
   second so it gets its own session)
2. Paint a stroke in window A → window B sees it draw in real time with
   sparkler tinted by your presence color
3. Stroke completes → window B's persisted stroke replaces the live one
   atomically (no blink)
4. Window B clicks the stroke → selection feedback (glow)

### Mobile test

1. Open on phone or DevTools mobile emulation
2. Lower-right cluster: hold the "Paint" button
3. With Paint held, drag with the OTHER finger anywhere on canvas → stroke
4. Release Paint → drag steers the camera again

### Edge cases worth testing

- Long strokes (try a 1+ minute continuous drag) — should render fully,
  not truncate
- Open paint panel while in orbit mode — should auto-flip to noclip
- Press C while painting — should cycle noclip ↔ third-person only
- Switch worlds mid-stroke — live preview clears in the new world
- Disconnect network briefly mid-stroke (DevTools offline toggle) — local
  stroke should survive when WS reconnects
- Open a 3D text object in WizCon's "This World" list → click → camera
  focuses on it

---

## Known limitations / deferred work

### Selection while armed
Single-click on a stroke doesn't select while the wand is armed (PaintCursor
captures all LMB events). Workaround: close the panel to select. Future fix:
raycast on LMB-down before starting a stroke; if a stroke is hit, treat as
selection instead of new-stroke.

### Live tube perf at extreme stroke length
At ~5K+ live points, per-frame TubeGeometry rebuild starts to cost noticeable
ms (CatmullRomCurve3 walk over N control points). Cap is 20K. A future
optimization could use sliding-window LOD: rebuild only the last N segments
each frame, leave the prefix as a static merged mesh.

### CDN font cold-load
First placement with a non-helvetiker font fetches from unpkg. On flaky
networks the FontErrorBoundary falls back to helvetiker. A future fix
should vendor all 10 fonts to `public/fonts/` so the feature is fully
offline-capable.

### Tool-stack abstraction
The mutex between PaintBrushPanel and TerrainBrushPanel is hand-coded.
Other potential collisions (Paint vs object placement, Paint vs spatial-web
interaction) work today via InputManager state but aren't explicitly mutex'd.
A small `activeTool` enum in oasisStore with a single setter that closes
all other tools would scale better as more tools land.

### WizCon-style "select from panel"
The paint panel doesn't list recent strokes for click-to-select. WizCon does.
Adding it to the paint panel would help discoverability of strokes that
aren't in view.

### Eraser / partial deletion
Currently deleting a stroke removes the whole thing. No way to "erase a
section". Eraser tool is on the roadmap.

### 3D text rotation on non-axial views
Text always faces the camera at placement time. If you place text and then
walk around it, the back face shows the extruded back. Could be improved
with a billboard mode for some text objects.

### Per-stroke author attribution UI
Strokes carry `authorId` + `authorColor` but the Joystick doesn't surface
"painted by Visitor 12AB" yet. Easy to add.

---

## Architecture decisions

### Why `useFrame` for sampling instead of pointermove
Sampling tied to pointer events meant strokes stopped recording when the user
held LMB and only moved with WASD/QE. `useFrame` decouples sample rate from
input events — each frame, while a stroke is active, the camera-forward
direction is sampled. Pointer events shrunk to bracketing the stroke
(down=start, up=end) and caching the latest cursor for non-locked modes.

### Why drop SelectableWrapper for strokes
R3F event bubbling from a TubeGeometry mesh through SelectableWrapper's
nested `<group>` structure didn't fire reliably. PaintStrokeMesh got its own
`<group onClick onDoubleClick>` wrapper. As a side benefit, strokes opt out
of TransformControls (which doesn't make sense for point-anchored geometry)
and get a custom emissive-glow selection feedback that's visible mid-air.

### Why Colyseus mutation channel, not the relay
The OpenClaw relay sidecar is for browser↔external-agent bridges (Hermes,
OpenClaw). Visitor↔visitor presence already runs over a Colyseus room with
a generic `'mutation'` message channel — perfect transport for paint strokes
without inventing new infrastructure. New mutation kinds extend the existing
typed `WorldMutation` discriminated union.

### Why pop-the-cursor immediately on arm
The previous round had pointer-lock kick in only after the first stroke
completed (canvas-click handed control back to the world via CameraController's
"clear UI layers and lock" path). The user perceived "paint mode" as
not-really-on until they finished a stroke. Now `setPaintHeldActive(true)`
calls `requestPointerLock` directly so the wand feels game-armed from frame
zero.

### Why an ErrorBoundary specifically for fonts
drei's `<Text3D>` uses `useLoader(FontLoader)` which throws into Suspense on
network failure. Without a per-text-object boundary, an unpkg outage would
crash the entire scene tree. The boundary catches per-glyph failures and
falls back to the locally-vendored helvetiker.

### Why structuredClone-skip for strokes in undo
`captureWorldSnapshot` ran `structuredClone` over every collection. A 20K-
point stroke is a 60K-element flat number array (~240KB) and the snapshot
runs twice per undo command (before + after). With multiple strokes in the
undo stack, every unrelated mutation (placing a light, etc.) would freeze the
UI. Strokes are immutable post-creation so a shallow `.slice()` is
correctness-equivalent and cheap.

### Why the velocity-thickness curve uses a power function
Linear ratios produce strobing thickness when the user's hand wobbles near a
threshold. A `sign(ratio - 1) * |ratio - 1|^0.55 + 1` curve compresses the
mid-range so transitions are smooth, while still giving the user a 30x
dynamic range (0.10x to 3.0x baseline) at the extremes.

---

## Commit history

| Hash | Subject | Highlights |
|---|---|---|
| `f09665e` | Kill OasisLoader… | Parallel-session sweep that included the initial mesh/cursor/sparkler files |
| `376717f` | Wire paint wand + 3D text… | Integration: store, panels, dispatcher, inspector, mobile |
| `d053367` | Tier-1 reviewer fixes | Sparkler origin flash, tube winding, text3d events, pointercancel, InputManager paint state, world-switch live-stroke cleanup |
| `72bdf3b` | Paint wand iteration | Camera-mode lock, mobile canvas, fonts, selection, WizCon list, mutex, P1 cluster |
| `3bfc6b2` | Paint wand bug round | Live tube updates, pointer-lock drift, sparkler-only-while-drawing, dramatic velocity-thickness |
| `bf3b1de` | Paint wand bug round 3 | Selection works, immediate pointer-lock, useFrame sampling, no point cap |
| `8abb3dc` | Reviewer P0 fixes | Mobile lock guard, scoped UI-layer pop, gated live-stroke clear, snapshot clone perf, Text3D font fallback |

---

## Reviewer artifacts

The two-reviewer round on commits `d053367..bf3b1de` (logic + runtime traps)
flagged seven P0/P1 bugs; the five P0s all landed in `8abb3dc`. The remaining
two (selection-while-armed UX, live-tube perf at >5K points) are documented
above as known limitations / deferred work.

Pre-deploy smoke test: `pnpm tsc --noEmit` clean across all seven commits.
No automated visual/integration tests exist yet for the feature — manual
testing against the checklist above is the current bar.
