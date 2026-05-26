const globalMutationLocks = globalThis as typeof globalThis & {
  __oasisWorldMutationLocks?: Map<string, Promise<void>>
}

const worldMutationLocks = globalMutationLocks.__oasisWorldMutationLocks ?? new Map<string, Promise<void>>()
globalMutationLocks.__oasisWorldMutationLocks = worldMutationLocks

export async function withWorldMutationLock<T>(worldId: string, task: () => Promise<T>): Promise<T> {
  const previous = worldMutationLocks.get(worldId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  worldMutationLocks.set(worldId, tail)

  await previous.catch(() => {})
  try {
    return await task()
  } finally {
    release()
    if (worldMutationLocks.get(worldId) === tail) {
      worldMutationLocks.delete(worldId)
    }
  }
}
