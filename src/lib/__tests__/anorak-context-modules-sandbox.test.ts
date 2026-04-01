// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PATH SANDBOXING — Tests for readLinkedFile in anorak-context-modules.ts
// Verifies that path traversal attacks are blocked
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const MODULE_SRC_PATH = path.resolve(__dirname, '../anorak-context-modules.ts')
const moduleSrc = fs.readFileSync(MODULE_SRC_PATH, 'utf-8')

// ═══════════════════════════════════════════════════════════════════════════
// Mirror of readLinkedFile sandbox logic for unit testing
// (extracted from anorak-context-modules.ts — avoids importing prisma)
// ═══════════════════════════════════════════════════════════════════════════

const MAX_FILE_MODULE_CONTENT = 12000

function readLinkedFileSandboxCheck(filePath: string, projectRoot: string, userHome: string): { allowed: boolean; resolved: string } {
  const target = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath)

  const resolved = path.resolve(target)
  const allowed = resolved.startsWith(path.resolve(projectRoot)) || resolved.startsWith(path.resolve(userHome))
  return { allowed, resolved }
}

// ═══════════════════════════════════════════════════════════════════════════
// Source verification — sandbox code exists
// ═══════════════════════════════════════════════════════════════════════════

describe('readLinkedFile — source verification', () => {
  it('readLinkedFile function exists', () => {
    expect(moduleSrc).toContain('async function readLinkedFile(filePath: string)')
  })

  it('resolves absolute vs relative paths', () => {
    expect(moduleSrc).toContain('path.isAbsolute(filePath)')
    expect(moduleSrc).toContain("path.resolve(process.cwd(), filePath)")
  })

  it('computes oasisRoot from cwd', () => {
    expect(moduleSrc).toContain("const oasisRoot = path.resolve(process.cwd())")
  })

  it('computes userHome from env', () => {
    expect(moduleSrc).toContain('process.env.USERPROFILE || process.env.HOME || oasisRoot')
  })

  it('checks resolved path starts with oasisRoot or userHome', () => {
    expect(moduleSrc).toContain('!resolved.startsWith(oasisRoot) && !resolved.startsWith(path.resolve(userHome))')
  })

  it('throws descriptive error on sandbox violation', () => {
    expect(moduleSrc).toContain('File path must be within project root or user home')
  })

  it('enforces MAX_FILE_MODULE_CONTENT truncation', () => {
    expect(moduleSrc).toContain('const MAX_FILE_MODULE_CONTENT = 400000')
    expect(moduleSrc).toContain('content.length > MAX_FILE_MODULE_CONTENT')
  })

  it('adds truncation notice', () => {
    expect(moduleSrc).toContain('[truncated to ${MAX_FILE_MODULE_CONTENT} chars for prompt safety]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Sandbox logic — path rejection
// ═══════════════════════════════════════════════════════════════════════════

describe('readLinkedFile — rejects paths outside project root and user home', () => {
  const projectRoot = 'C:\\af_oasis'
  const userHome = 'C:\\Users\\testuser'

  it('rejects /etc/passwd (Unix absolute)', () => {
    const result = readLinkedFileSandboxCheck('/etc/passwd', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })

  it('rejects C:\\Windows\\System32\\config (system dir)', () => {
    const result = readLinkedFileSandboxCheck('C:\\Windows\\System32\\config\\sam', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })

  it('rejects path traversal with ../ from project root', () => {
    const result = readLinkedFileSandboxCheck('../../../../etc/passwd', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })

  it('rejects path traversal with ..\\ on Windows', () => {
    const result = readLinkedFileSandboxCheck('..\\..\\..\\Windows\\System32\\config\\sam', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })

  it('rejects D:\\ drive (different root)', () => {
    const result = readLinkedFileSandboxCheck('D:\\secret\\data.txt', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })

  it('rejects absolute path to sibling project', () => {
    const result = readLinkedFileSandboxCheck('C:\\other_project\\secrets.env', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Sandbox logic — path acceptance
// ═══════════════════════════════════════════════════════════════════════════

describe('readLinkedFile — accepts paths within project root', () => {
  const projectRoot = 'C:\\af_oasis'
  const userHome = 'C:\\Users\\testuser'

  it('accepts absolute path within project root', () => {
    const result = readLinkedFileSandboxCheck('C:\\af_oasis\\src\\lib\\foo.ts', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })

  it('accepts relative path within project (src/lib/foo.ts)', () => {
    const result = readLinkedFileSandboxCheck('src\\lib\\foo.ts', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })

  it('accepts relative path with ./ prefix', () => {
    const result = readLinkedFileSandboxCheck('.\\carbondir\\oasisspec3.txt', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })

  it('accepts path within user home', () => {
    const result = readLinkedFileSandboxCheck('C:\\Users\\testuser\\.claude\\agents\\reviewer.md', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })

  it('accepts project root itself', () => {
    const result = readLinkedFileSandboxCheck('C:\\af_oasis', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })

  it('accepts nested relative path', () => {
    const result = readLinkedFileSandboxCheck('src\\components\\forge\\AnorakProPanel.tsx', projectRoot, userHome)
    expect(result.allowed).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Sandbox logic — relative path resolution
// ═══════════════════════════════════════════════════════════════════════════

describe('readLinkedFile — properly resolves relative paths', () => {
  const projectRoot = 'C:\\af_oasis'
  const userHome = 'C:\\Users\\testuser'

  it('resolves "foo.txt" to projectRoot/foo.txt', () => {
    const result = readLinkedFileSandboxCheck('foo.txt', projectRoot, userHome)
    expect(result.resolved).toBe(path.resolve(projectRoot, 'foo.txt'))
    expect(result.allowed).toBe(true)
  })

  it('resolves "./bar/baz.md" to projectRoot/bar/baz.md', () => {
    const result = readLinkedFileSandboxCheck('.\\bar\\baz.md', projectRoot, userHome)
    expect(result.resolved).toBe(path.resolve(projectRoot, 'bar', 'baz.md'))
    expect(result.allowed).toBe(true)
  })

  it('absolute path is not re-resolved against project root', () => {
    const abs = 'C:\\af_oasis\\prisma\\schema.prisma'
    const result = readLinkedFileSandboxCheck(abs, projectRoot, userHome)
    expect(result.resolved).toBe(path.resolve(abs))
  })

  it('relative path that resolves outside project is rejected', () => {
    // Enough ../ to escape the project root
    const result = readLinkedFileSandboxCheck('..\\..\\..\\..\\Windows\\win.ini', projectRoot, userHome)
    expect(result.allowed).toBe(false)
  })
})
