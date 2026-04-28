export function readBrowserStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeBrowserStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (error) {
    console.warn('[OasisStorage] localStorage write failed:', key, error)
    return false
  }
}

export function removeBrowserStorage(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function readJsonBrowserStorage<T>(key: string, fallback: T): T {
  const raw = readBrowserStorage(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonBrowserStorage<T>(key: string, value: T): boolean {
  return writeBrowserStorage(key, JSON.stringify(value))
}
