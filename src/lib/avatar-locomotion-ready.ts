const avatarLocomotionReady = new Map<string, boolean>()

export function setAvatarLocomotionReady(id: string, ready: boolean) {
  if (!id) return
  if (ready) {
    avatarLocomotionReady.set(id, true)
    return
  }
  avatarLocomotionReady.delete(id)
}

export function clearAvatarLocomotionReady(id: string) {
  if (!id) return
  avatarLocomotionReady.delete(id)
}

export function isAvatarLocomotionReady(id?: string): boolean {
  if (!id) return true
  return avatarLocomotionReady.get(id) ?? true
}
