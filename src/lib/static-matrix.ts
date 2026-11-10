// ░▒▓ STATIC MATRIX KEEPER — world objects that stand still stop paying for matrix updates ▓▒░
// three.js recomputes every object's local and world matrix every frame. Most of a world never
// moves after it loads, so each registered root (one placed object and everything under it) is
// watched instead: once nothing under it has moved for a while it goes to sleep, and three's
// per-frame pass skips its whole subtree. It wakes the moment something under it changes.
//
// How a sleeping root is skipped: three calls `root.updateMatrixWorld()` from the parent every
// frame (a parent that updates its own matrix forces its children, so `matrixWorldAutoUpdate`
// alone does not help). A sleeping root carries its own `updateMatrixWorld` that returns at once
// unless the root's own position / rotation / scale, its child list, or its parent's world matrix
// changed. So a drag, a behavior moving the object, or a moving parent shows in the same frame.
//
// What else wakes it:
// - an object added or removed anywhere under it (three's 'added' event, `remove()`), in the same frame;
// - a position / rotation / scale / hand-written matrix change deeper in the subtree: the keeper
//   re-reads every subtree once in `spread` frames, so that shows a few frames late at most;
// - `wakeStaticMatrix(object)` from code that knows it is about to move something.
//
// Why watching and not "tell me when you move": objects are moved from many places (the gizmo,
// behaviors, agent tools, React props, animation mixers, spawn effects). A missed call would leave
// an object frozen on screen; a watcher cannot miss one.

import { Object3D, type Quaternion, type Vector3 } from 'three'

/** Numbers kept per object: position (3), quaternion (4), scale (3), a checksum of `matrix` for objects that write it themselves. */
const STRIDE = 11

interface Entry {
  keeper: StaticMatrixKeeper
  root: Object3D
  objects: Object3D[]
  /** The objects' own position / quaternion / scale vectors, in the same order (read without touching the objects). */
  positions: Vector3[]
  quaternions: Quaternion[]
  scales: Vector3[]
  /** Indexes of objects that write `matrix` themselves (`matrixAutoUpdate` off). */
  manual: number[]
  /** The child list changed since the last full walk. */
  dirty: boolean
  /** Reads since the last full walk. */
  reads: number
  snapshot: Float64Array
  /** The parent's world matrix when the root went to sleep. */
  parentWorld: Float64Array
  rootChildren: number
  /** Checks in a row that found nothing changed. */
  stable: number
  asleep: boolean
  /** Holds: while above zero the root never sleeps (a selected object under the gizmo). */
  holds: number
  sleeper: (force?: boolean) => void
}

export interface StaticMatrixStats {
  roots: number
  asleep: number
  /** Objects under sleeping roots: the ones three skips each frame. */
  objectsAsleep: number
}

/** Every registered root, across keepers (the 'added' hook looks roots up here). */
const ROOTS = new WeakMap<Object3D, Entry>()

let addedHookInstalled = false
function childListChanged(from: Object3D | null): void {
  let current = from
  while (current) {
    const entry = ROOTS.get(current)
    if (entry) {
      entry.dirty = true
      entry.keeper.wakeEntry(entry)
    }
    current = current.parent
  }
}

/**
 * three fires 'added' on every object that gets a parent (`add()`, and R3F's insertBefore), and
 * `remove()` takes one away: both wake the root above.
 */
function installAddedHook(): void {
  if (addedHookInstalled) return
  addedHookInstalled = true
  const proto = Object3D.prototype as unknown as {
    dispatchEvent: (event: { type: string }) => void
    remove: (...objects: Object3D[]) => Object3D
  }
  const dispatch = proto.dispatchEvent
  proto.dispatchEvent = function (this: Object3D, event: { type: string }) {
    if (event.type === 'added') childListChanged(this.parent)
    return dispatch.call(this, event)
  }
  const remove = proto.remove
  proto.remove = function (this: Object3D, ...objects: Object3D[]) {
    childListChanged(this)
    return remove.apply(this, objects)
  }
}

/** A full walk (which also catches a child list edited behind three's back) every this many reads. */
const FULL_WALK_EVERY = 16

function rootMoved(entry: Entry): boolean {
  const root = entry.root, s = entry.snapshot
  const p = root.position, q = root.quaternion, sc = root.scale
  return (
    s[0] !== p.x || s[1] !== p.y || s[2] !== p.z ||
    s[3] !== q.x || s[4] !== q.y || s[5] !== q.z || s[6] !== q.w ||
    s[7] !== sc.x || s[8] !== sc.y || s[9] !== sc.z ||
    root.children.length !== entry.rootChildren
  )
}

export class StaticMatrixKeeper {
  private entries: Entry[] = []
  private cursor = 0
  private changed = false
  private index = 0
  private lastStamp: number | null = null
  private enabled = true

  /**
   * `spread`: every root is re-read once in that many frames (the longest a change deep in a
   * sleeping subtree can go unseen). `sleepAfter`: unchanged reads in a row before a root sleeps.
   */
  constructor(private spread = 6, private sleepAfter = 10) {}

  /** Starts watching `root`. Returns the function that stops (and hands the subtree back to three). */
  register(root: Object3D): () => void {
    installAddedHook()
    if (!ROOTS.has(root)) {
      const entry: Entry = {
        keeper: this, root, objects: [], positions: [], quaternions: [], scales: [], manual: [], dirty: true, reads: 0,
        snapshot: new Float64Array(STRIDE * 8), parentWorld: new Float64Array(16),
        rootChildren: 0, stable: 0, asleep: false, holds: 0, sleeper: () => {},
      }
      const update = Object3D.prototype.updateMatrixWorld
      entry.sleeper = (force?: boolean) => {
        if (rootMoved(entry)) {
          this.wakeEntry(entry)
          root.updateMatrixWorld(force)
          return
        }
        const parent = root.parent
        if (!parent) return
        const now = parent.matrixWorld.elements, then = entry.parentWorld
        for (let k = 0; k < 16; k++) {
          if (now[k] === then[k]) continue
          // The parent moved: follow it, stay asleep.
          for (let j = 0; j < 16; j++) then[j] = now[j]
          update.call(root, true)
          return
        }
      }
      this.entries.push(entry)
      ROOTS.set(root, entry)
    }
    return () => this.unregister(root)
  }

  private unregister(root: Object3D): void {
    const entry = ROOTS.get(root)
    if (!entry || entry.keeper !== this) return
    this.wakeEntry(entry)
    ROOTS.delete(root)
    const at = this.entries.indexOf(entry)
    if (at >= 0) this.entries.splice(at, 1)
  }

  /** Wakes the registered root that `object` belongs to (itself or an ancestor). */
  wake(object: Object3D | null | undefined): void {
    let current: Object3D | null | undefined = object
    while (current) {
      const entry = ROOTS.get(current)
      if (entry) entry.keeper.wakeEntry(entry)
      current = current.parent
    }
  }

  /** While held, a root stays awake. Returns the release function. */
  hold(root: Object3D | null | undefined): () => void {
    const entry = root ? ROOTS.get(root) : undefined
    if (!entry) return () => {}
    entry.holds += 1
    this.wakeEntry(entry)
    let released = false
    return () => {
      if (released) return
      released = true
      entry.holds = Math.max(0, entry.holds - 1)
    }
  }

  /** @internal */
  wakeEntry(entry: Entry): void {
    entry.stable = 0
    if (!entry.asleep) return
    entry.asleep = false
    // Back to three's own method (the sleeper was an own property over it).
    delete (entry.root as { updateMatrixWorld?: unknown }).updateMatrixWorld
  }

  /**
   * Once per frame, before the render: re-reads a slice of the roots. `stamp` (the frame's clock
   * time) makes a second call in the same frame a no-op.
   */
  tick(stamp?: number): void {
    if (!this.enabled) return
    if (stamp !== undefined) {
      if (stamp === this.lastStamp) return
      this.lastStamp = stamp
    }
    const total = this.entries.length
    if (total === 0) return
    const perFrame = Math.ceil(total / this.spread)
    for (let n = 0; n < perFrame; n++) {
      if (this.cursor >= this.entries.length) this.cursor = 0
      this.check(this.entries[this.cursor])
      this.cursor += 1
    }
  }

  private check(entry: Entry): void {
    this.changed = false
    entry.reads += 1
    if (entry.dirty || entry.reads >= FULL_WALK_EVERY) this.walk(entry)
    else this.read(entry)
    if (this.changed) {
      this.wakeEntry(entry)
      return
    }
    entry.stable += 1
    if (!entry.asleep && entry.holds === 0 && entry.stable >= this.sleepAfter) {
      const root = entry.root
      // One last full update, so the frozen matrices are the current ones.
      root.updateMatrixWorld(true)
      if (root.parent) entry.parentWorld.set(root.parent.matrixWorld.elements)
      entry.rootChildren = root.children.length
      root.updateMatrixWorld = entry.sleeper
      entry.asleep = true
    }
  }

  /** The full walk: rebuilds the entry's lists from the tree, then reads them. */
  private walk(entry: Entry): void {
    this.index = 0
    entry.manual.length = 0
    this.visit(entry, entry.root)
    const count = this.index
    if (count !== entry.objects.length) {
      entry.objects.length = count
      entry.positions.length = count
      entry.quaternions.length = count
      entry.scales.length = count
      this.changed = true
    }
    if (count * STRIDE > entry.snapshot.length) {
      const grown = new Float64Array(Math.max(entry.snapshot.length * 2, count * STRIDE))
      grown.set(entry.snapshot)
      entry.snapshot = grown
    }
    entry.dirty = false
    entry.reads = 0
    this.read(entry)
  }

  private visit(entry: Entry, object: Object3D): void {
    const i = this.index++
    if (entry.objects[i] !== object) {
      entry.objects[i] = object
      entry.positions[i] = object.position
      entry.quaternions[i] = object.quaternion
      entry.scales[i] = object.scale
      this.changed = true
    }
    if (!object.matrixAutoUpdate) entry.manual.push(i)
    const children = object.children
    for (let c = 0; c < children.length; c++) this.visit(entry, children[c])
  }

  /** Compares every object's position / quaternion / scale (and hand-written matrices) with the last read. */
  private read(entry: Entry): void {
    const s = entry.snapshot
    const positions = entry.positions, quaternions = entry.quaternions, scales = entry.scales
    let changed = false
    for (let i = 0, o = 0, n = positions.length; i < n; i++, o += STRIDE) {
      const p = positions[i], q = quaternions[i], sc = scales[i]
      if (
        s[o] !== p.x || s[o + 1] !== p.y || s[o + 2] !== p.z ||
        s[o + 3] !== q.x || s[o + 4] !== q.y || s[o + 5] !== q.z || s[o + 6] !== q.w ||
        s[o + 7] !== sc.x || s[o + 8] !== sc.y || s[o + 9] !== sc.z
      ) {
        s[o] = p.x; s[o + 1] = p.y; s[o + 2] = p.z
        s[o + 3] = q.x; s[o + 4] = q.y; s[o + 5] = q.z; s[o + 6] = q.w
        s[o + 7] = sc.x; s[o + 8] = sc.y; s[o + 9] = sc.z
        changed = true
      }
    }
    const manual = entry.manual
    for (let m = 0; m < manual.length; m++) {
      const i = manual[m]
      const e = entry.objects[i].matrix.elements
      let sum = 0
      for (let k = 0; k < 16; k++) sum += e[k] * (k + 1)
      if (s[i * STRIDE + 10] !== sum) {
        s[i * STRIDE + 10] = sum
        changed = true
      }
    }
    if (changed) this.changed = true
  }

  /** Off: every root awake and left to three (for before/after measurements). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) for (const entry of this.entries) this.wakeEntry(entry)
  }

  stats(): StaticMatrixStats {
    let asleep = 0, objectsAsleep = 0
    for (const entry of this.entries) {
      if (!entry.asleep) continue
      asleep += 1
      objectsAsleep += entry.objects.length
    }
    return { roots: this.entries.length, asleep, objectsAsleep }
  }
}

/** The world's keeper: placed objects register here, `StaticMatrixDriver` ticks it. */
export const staticMatrixKeeper = new StaticMatrixKeeper()

export function wakeStaticMatrix(object: Object3D | null | undefined): void {
  staticMatrixKeeper.wake(object)
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisStaticMatrix = {
    stats: () => staticMatrixKeeper.stats(),
    setEnabled: (enabled: boolean) => staticMatrixKeeper.setEnabled(enabled),
  }
}
