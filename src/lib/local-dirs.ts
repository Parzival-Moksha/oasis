// ░▒▓ LOCAL DIRS — list folders on this machine for the "Browse…" picker when summoning an agent ▓▒░
// Server-side only (GET /api/local/dirs, local requests only). A browser can't hand a page the real
// path of a folder it picked, and on a phone it would be the phone's folder, not this machine's,
// where the agent actually runs. So the Oasis walks this machine's folders itself.

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface DirEntry {
  name: string
  path: string
  /** Has a .git folder: probably a project. */
  git: boolean
}

export interface DirListing {
  /** The folder listed, or '' for the top level (drives / root and home). */
  path: string
  parent: string | null
  entries: DirEntry[]
  /** Hidden by the filter (dot folders, system folders). */
  hidden: number
  truncated: boolean
  error?: string
}

const MAX_ENTRIES = 1500
const SYSTEM_NAMES = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'config.msi', 'recovery', 'node_modules', '.git'])

export function isHiddenFolderName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || SYSTEM_NAMES.has(name.toLowerCase())
}

/** Drives on Windows (C:\, D:\ …), / elsewhere, plus the home folder. */
export function listRoots(platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync, home = os.homedir()): DirEntry[] {
  const roots: DirEntry[] = []
  if (platform === 'win32') {
    for (let code = 67; code <= 90; code++) { // C: .. Z:
      const drive = `${String.fromCharCode(code)}:\\`
      if (exists(drive)) roots.push({ name: drive, path: drive, git: false })
    }
  } else {
    roots.push({ name: '/', path: '/', git: false })
  }
  if (home && !roots.some(root => root.path === home)) roots.unshift({ name: `Home (${home})`, path: home, git: false })
  return roots
}

/** The folder above, or null at a drive / filesystem root ('' means: back to the top level). */
export function parentOf(dir: string, pathApi: typeof path = path): string | null {
  const resolved = pathApi.resolve(dir)
  const parent = pathApi.dirname(resolved)
  return parent === resolved ? '' : parent
}

export async function listDirectory(dir: string, options: { showHidden?: boolean } = {}): Promise<DirListing> {
  if (!dir) return { path: '', parent: null, entries: listRoots(), hidden: 0, truncated: false }
  const resolved = path.resolve(dir)
  let names: import('node:fs').Dirent[]
  try {
    names = await fs.readdir(resolved, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const message = code === 'ENOENT' ? 'That folder does not exist.' : code === 'EACCES' || code === 'EPERM' ? 'No permission to open that folder.' : code === 'ENOTDIR' ? 'That is a file, not a folder.' : 'Could not open that folder.'
    return { path: resolved, parent: parentOf(resolved), entries: [], hidden: 0, truncated: false, error: message }
  }
  let hidden = 0
  const folders = names.filter(entry => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return false
    if (!options.showHidden && isHiddenFolderName(entry.name)) {
      hidden += 1
      return false
    }
    return true
  })
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  const truncated = folders.length > MAX_ENTRIES
  const entries = await Promise.all(folders.slice(0, MAX_ENTRIES).map(async entry => {
    const full = path.join(resolved, entry.name)
    let git = false
    try {
      git = (await fs.stat(path.join(full, '.git'))).isDirectory()
    } catch { /* not a repo, or unreadable */ }
    return { name: entry.name, path: full, git }
  }))
  return { path: resolved, parent: parentOf(resolved), entries, hidden, truncated }
}
