// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// EVENT BUS — Centralized command queue for the Oasis
// ─═̷─═̷─ॐ─═̷─═̷─ Every mutation is a command. Commands are truth. ─═̷─═̷─ॐ─═̷─═̷─
//
// Works alongside direct store mutations during migration.
// Subscribe to events for logging, undo, analytics, or side effects.
// Dispatch commands instead of calling store actions directly.
//
// Migration strategy: one action at a time, move from
//   `store.doThing()` → `dispatch({ type: 'DO_THING', payload })`.
// The bus handler calls the store action internally — consumers don't know.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND TYPES — every dispatchable action in the system
// Start small, grow as we migrate actions from direct store calls.
// ═══════════════════════════════════════════════════════════════════════════

export type OasisCommand =
  // Object management
  | { type: 'SELECT_OBJECT'; payload: { id: string | null } }
  | { type: 'DELETE_OBJECT'; payload: { id: string } }
  | { type: 'INSPECT_OBJECT'; payload: { id: string | null } }

  // Agent windows
  | { type: 'FOCUS_AGENT_WINDOW'; payload: { id: string } }
  | { type: 'UNFOCUS_AGENT_WINDOW' }
  | { type: 'ADD_AGENT_WINDOW'; payload: { agentType: string; position: [number, number, number] } }
  | { type: 'REMOVE_AGENT_WINDOW'; payload: { id: string } }

  // Camera
  | { type: 'CYCLE_CAMERA_MODE' }
  | { type: 'SET_CAMERA_MODE'; payload: { mode: 'orbit' | 'noclip' | 'third-person' } }

  // World
  | { type: 'SAVE_WORLD' }
  | { type: 'UNDO' }
  | { type: 'REDO' }

  // Placement
  | { type: 'ENTER_PLACEMENT'; payload: { pending: unknown } }
  | { type: 'CANCEL_PLACEMENT' }
  | { type: 'ENTER_PAINT_MODE'; payload: { presetId: string } }
  | { type: 'EXIT_PAINT_MODE' }

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIBER — anyone who wants to react to commands
// ═══════════════════════════════════════════════════════════════════════════

type CommandHandler = (cmd: OasisCommand) => void

// ═══════════════════════════════════════════════════════════════════════════
// THE BUS
// ═══════════════════════════════════════════════════════════════════════════

class EventBus {
  private subscribers = new Set<CommandHandler>()
  private queue: OasisCommand[] = []
  private processing = false
  private history: Array<{ cmd: OasisCommand; timestamp: number }> = []
  private maxHistory = 200

  /** Subscribe to all commands. Returns unsubscribe function. */
  subscribe(handler: CommandHandler): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  /** Dispatch a command. Processed immediately unless already processing (then queued). */
  dispatch(cmd: OasisCommand): void {
    this.queue.push(cmd)

    // Log to history
    this.history.push({ cmd, timestamp: Date.now() })
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    // Process queue if not already processing (prevents re-entrant dispatch)
    if (!this.processing) {
      this.processQueue()
    }
  }

  private processQueue(): void {
    this.processing = true
    while (this.queue.length > 0) {
      const cmd = this.queue.shift()!

      // Dev logging (strip in production)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[EventBus] ${cmd.type}`, 'payload' in cmd ? (cmd as { payload?: unknown }).payload : '')
      }

      // Notify all subscribers
      for (const handler of this.subscribers) {
        try {
          handler(cmd)
        } catch (err) {
          console.error(`[EventBus] Handler error on ${cmd.type}:`, err)
        }
      }
    }
    this.processing = false
  }

  /** Get recent command history (for debugging) */
  getHistory(): Array<{ cmd: OasisCommand; timestamp: number }> {
    return [...this.history]
  }

  /** Clear history */
  clearHistory(): void {
    this.history = []
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON — one bus for the entire app
// ═══════════════════════════════════════════════════════════════════════════

export const eventBus = new EventBus()

/** Convenience: dispatch a command */
export function dispatch(cmd: OasisCommand): void {
  eventBus.dispatch(cmd)
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE HANDLER — bridges EventBus commands to oasisStore actions
// Call registerStoreHandler() once on app mount.
// As we migrate actions, add cases here and remove direct store calls.
// ═══════════════════════════════════════════════════════════════════════════

let storeHandlerUnsub: (() => void) | null = null

export function registerStoreHandler(): () => void {
  // If already registered, clean up old one first (handles HMR + StrictMode)
  if (storeHandlerUnsub) {
    storeHandlerUnsub()
    storeHandlerUnsub = null
  }

  const unsub = eventBus.subscribe((cmd) => {
    // Lazy import to avoid circular deps (same pattern as oasisStore → input-manager)
    const store = require('../store/oasisStore').useOasisStore.getState()
    const input = require('./input-manager').useInputManager.getState()

    switch (cmd.type) {
      case 'SELECT_OBJECT':
        store.selectObject(cmd.payload.id)
        break
      case 'DELETE_OBJECT': {
        const id = cmd.payload.id
        if (store.placedCatalogAssets.some((a: { id: string }) => a.id === id)) store.removeCatalogAsset(id)
        else if (store.craftedScenes.some((s: { id: string }) => s.id === id)) store.removeCraftedScene(id)
        else if (store.worldConjuredAssetIds.includes(id)) store.removeConjuredAssetFromWorld(id)
        else if (store.worldLights.some((l: { id: string }) => l.id === id)) store.removeWorldLight(id)
        else if (store.placedAgentWindows.some((w: { id: string }) => w.id === id)) store.removeAgentWindow(id)
        store.selectObject(null)
        store.setInspectedObject(null)
        break
      }
      case 'INSPECT_OBJECT':
        store.setInspectedObject(cmd.payload.id)
        break
      case 'FOCUS_AGENT_WINDOW':
        // focusAgentWindow internally calls input.enterAgentFocus() — no double-call
        store.focusAgentWindow(cmd.payload.id)
        break
      case 'UNFOCUS_AGENT_WINDOW':
        store.focusAgentWindow(null)
        break
      case 'CYCLE_CAMERA_MODE': {
        const modes: Array<'orbit' | 'noclip' | 'third-person'> = ['orbit', 'noclip', 'third-person']
        const current = input.inputState
        const idx = modes.indexOf(current as 'orbit' | 'noclip' | 'third-person')
        const next = modes[(idx + 1) % modes.length]
        input.transition(next)
        break
      }
      case 'SET_CAMERA_MODE':
        input.syncFromControlMode(cmd.payload.mode)
        break
      case 'SAVE_WORLD':
        store.saveWorldState()
        break
      case 'UNDO':
        store.undo()
        break
      case 'REDO':
        store.redo()
        break
      case 'CANCEL_PLACEMENT':
        store.cancelPlacement()
        break
      case 'EXIT_PAINT_MODE':
        store.exitPaintMode()
        break
      case 'ENTER_PLACEMENT':
        store.enterPlacementMode(cmd.payload.pending)
        break
      case 'ENTER_PAINT_MODE':
        store.enterPaintMode(cmd.payload.presetId)
        break
      case 'ADD_AGENT_WINDOW':
        store.addAgentWindow({
          id: `agent-${cmd.payload.agentType}-${Date.now()}`,
          agentType: cmd.payload.agentType,
          position: cmd.payload.position,
          rotation: [0, 0, 0],
          scale: 1,
          width: 800,
          height: 600,
        })
        break
      case 'REMOVE_AGENT_WINDOW':
        store.removeAgentWindow(cmd.payload.id)
        break
    }
  })

  storeHandlerUnsub = unsub
  return () => {
    unsub()
    storeHandlerUnsub = null
  }
}
