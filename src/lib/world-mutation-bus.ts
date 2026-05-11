'use client'

import type { CatalogPlacement } from '@/lib/conjure/types'

export type WorldMutation =
  | { kind: 'object_added'; payload: CatalogPlacement }
  | { kind: 'object_removed'; payload: { id: string } }

type Sender = (mutation: WorldMutation) => void
type Listener = (mutation: WorldMutation) => void

class WorldMutationBus {
  private sender: Sender | null = null
  private listeners = new Set<Listener>()

  setSender(sender: Sender | null): void {
    this.sender = sender
  }

  broadcast(mutation: WorldMutation): void {
    if (!this.sender) return
    try {
      this.sender(mutation)
    } catch {
      // sender errored; swallow until reconnect logic exists
    }
  }

  applyIncoming(mutation: WorldMutation): void {
    for (const listener of this.listeners) {
      try {
        listener(mutation)
      } catch {
        // ignore per-listener errors
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

const globalState = globalThis as typeof globalThis & {
  __oasisWorldMutationBus?: WorldMutationBus
}

if (!globalState.__oasisWorldMutationBus) {
  globalState.__oasisWorldMutationBus = new WorldMutationBus()
}

export const worldMutationBus = globalState.__oasisWorldMutationBus
