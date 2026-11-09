import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isHiddenFolderName, listDirectory, listRoots, parentOf } from '../local-dirs'

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'oasis-dirs-'))
  for (const name of ['beta', 'Alpha', 'project10', 'project9', '.hidden', 'node_modules']) mkdirSync(path.join(root, name))
  mkdirSync(path.join(root, 'beta', '.git'))
  writeFileSync(path.join(root, 'notes.txt'), 'not a folder')
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('listDirectory', () => {
  it('lists folders only, sorted naturally, and marks git projects', async () => {
    const listing = await listDirectory(root)
    expect(listing.entries.map(entry => entry.name)).toEqual(['Alpha', 'beta', 'project9', 'project10'])
    expect(listing.entries.find(entry => entry.name === 'beta')?.git).toBe(true)
    expect(listing.entries.find(entry => entry.name === 'Alpha')?.git).toBe(false)
    expect(listing.hidden).toBe(2)
    expect(listing.parent).toBe(path.dirname(path.resolve(root)))
  })

  it('shows hidden folders on request', async () => {
    const listing = await listDirectory(root, { showHidden: true })
    expect(listing.entries.map(entry => entry.name)).toContain('.hidden')
    expect(listing.entries.map(entry => entry.name)).toContain('node_modules')
  })

  it('reports a missing folder instead of throwing', async () => {
    const listing = await listDirectory(path.join(root, 'nope'))
    expect(listing.error).toMatch(/does not exist/)
    expect(listing.entries).toEqual([])
  })

  it('reports a file', async () => {
    const listing = await listDirectory(path.join(root, 'notes.txt'))
    expect(listing.error).toMatch(/file, not a folder/)
  })

  it('the top level lists the roots', async () => {
    const listing = await listDirectory('')
    expect(listing.path).toBe('')
    expect(listing.parent).toBeNull()
    expect(listing.entries.length).toBeGreaterThan(0)
  })
})

describe('roots and parents', () => {
  it('Windows: existing drives, home first', () => {
    const roots = listRoots('win32', p => p === 'C:\\' || p === 'D:\\', 'C:\\Users\\l')
    expect(roots.map(root => root.path)).toEqual(['C:\\Users\\l', 'C:\\', 'D:\\'])
  })

  it('elsewhere: / and home', () => {
    expect(listRoots('darwin', () => true, '/Users/l').map(root => root.path)).toEqual(['/Users/l', '/'])
  })

  it('the parent of a drive root is the top level', () => {
    expect(parentOf('C:\\', path.win32)).toBe('')
    expect(parentOf('C:\\af_oasis', path.win32)).toBe('C:\\')
    expect(parentOf('/', path.posix)).toBe('')
  })

  it('hides dot, $ and system folders', () => {
    expect(isHiddenFolderName('.git')).toBe(true)
    expect(isHiddenFolderName('$Recycle.Bin')).toBe(true)
    expect(isHiddenFolderName('System Volume Information')).toBe(true)
    expect(isHiddenFolderName('af_oasis')).toBe(false)
  })
})
