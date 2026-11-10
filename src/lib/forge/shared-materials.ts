// ░▒▓ SHARED MATERIALS — meshes that look the same use the same material object ▓▒░
// three re-sends a material's whole uniform set whenever the material changes between two draw
// calls, and it sorts solid meshes by material. A crafted world had one material per mesh (hundreds,
// most of them identical in every value), so every draw paid that. Here a material is looked up by
// a signature of its values; users retain and release it, and it is disposed a moment after the
// last user lets go (so a remount in between gets the same object back).

import type { Material } from 'three'

interface Entry {
  material: Material
  users: number
  disposeTimer: ReturnType<typeof setTimeout> | null
}

export class SharedMaterials {
  private entries = new Map<string, Entry>()

  /** `lingerMs`: how long an unused material is kept before it is disposed. */
  constructor(private lingerMs = 2000) {}

  /** The material for `signature`, made by `create` if nobody has it yet. Does not count as a use. */
  get<T extends Material>(signature: string, create: () => T): T {
    let entry = this.entries.get(signature)
    if (!entry) {
      entry = { material: create(), users: 0, disposeTimer: null }
      this.entries.set(signature, entry)
      // Nobody may ever retain it (a render that never commits): start the clock now.
      this.scheduleDispose(signature, entry)
    }
    return entry.material as T
  }

  /** Counts a user of `signature`'s material. Returns the release function. */
  retain(signature: string): () => void {
    const entry = this.entries.get(signature)
    if (!entry) return () => {}
    entry.users += 1
    if (entry.disposeTimer !== null) {
      clearTimeout(entry.disposeTimer)
      entry.disposeTimer = null
    }
    let released = false
    return () => {
      if (released) return
      released = true
      entry.users -= 1
      if (entry.users <= 0 && this.entries.get(signature) === entry) this.scheduleDispose(signature, entry)
    }
  }

  private scheduleDispose(signature: string, entry: Entry): void {
    if (entry.disposeTimer !== null) clearTimeout(entry.disposeTimer)
    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null
      if (entry.users > 0 || this.entries.get(signature) !== entry) return
      this.entries.delete(signature)
      entry.material.dispose()
    }, this.lingerMs)
  }

  get size(): number {
    return this.entries.size
  }
}
