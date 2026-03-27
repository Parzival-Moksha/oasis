// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Shared Utilities
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** Generate a unique asset ID for conjured objects */
export function generateAssetId(): string {
  return 'conj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Sleep utility — because even blacksmiths need to rest between hammer strikes */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Terminal states for conjured assets — shared across registry, hooks, and routes */
export const TERMINAL_STATES: string[] = ['ready', 'failed']
