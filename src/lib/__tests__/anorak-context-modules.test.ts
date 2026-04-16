import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileMock, readdirMock, findManyMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  readdirMock: vi.fn(),
  findManyMock: vi.fn(),
}))

vi.mock('fs', () => ({
  promises: {
    readFile: readFileMock,
    readdir: readdirMock,
  },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    mission: {
      findMany: findManyMock,
    },
  },
}))

import { BUILT_IN_MODULE_IDS } from '../anorak-context-config'
import { renderContextModuleSections, resolveContextModulesForLobe } from '../anorak-context-modules'

describe('resolveContextModulesForLobe', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    readdirMock.mockReset()
    findManyMock.mockReset()
  })

  it('skips disabled custom modules even if attached', async () => {
    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [
        { id: 'custom:off', name: 'Off', content: 'hidden', enabled: false, type: 'text', filePath: '' },
      ],
      lobeModules: { curator: ['custom:off'], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(modules).toEqual([])
  })

  it('keeps enabled custom modules while skipping disabled siblings', async () => {
    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [
        { id: 'custom:off', name: 'Off', content: 'hidden', enabled: false, type: 'text', filePath: '' },
        { id: 'custom:on', name: 'On', content: 'visible', enabled: true, type: 'text', filePath: '' },
      ],
      lobeModules: { curator: ['custom:off', 'custom:on'], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(modules).toHaveLength(1)
    expect(modules[0].name).toBe('On')
  })

  it('skips whitespace-only text modules', async () => {
    const modules = await resolveContextModulesForLobe({
      lobe: 'reviewer',
      customModules: [
        { id: 'custom:blank', name: 'Blank', content: '   ', enabled: true, type: 'text', filePath: '' },
      ],
      lobeModules: { curator: [], coder: [], reviewer: ['custom:blank'], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(modules).toEqual([])
  })

  it('resolves file-backed modules from disk', async () => {
    readFileMock.mockResolvedValue('linked content')
    readdirMock.mockResolvedValue([])

    const modules = await resolveContextModulesForLobe({
      lobe: 'coder',
      customModules: [
        { id: 'custom:file', name: 'Spec File', content: '', enabled: true, type: 'file', filePath: 'carbondir/openclawuispec.txt' },
      ],
      lobeModules: { curator: [], coder: ['custom:file'], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(readFileMock).toHaveBeenCalled()
    expect(modules[0].name).toBe('Spec File')
    expect(modules[0].content).toContain('linked content')
  })

  it('renders built-in queued missions from the database', async () => {
    findManyMock.mockResolvedValue([
      { id: 7, name: 'Queue me', description: 'ship queue ui', priority: 9.5, assignedTo: 'anorak', status: 'todo', maturityLevel: 1 },
    ])

    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [],
      lobeModules: { curator: [BUILT_IN_MODULE_IDS.queued], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { not: 'done' },
        maturityLevel: { lt: 3 },
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      },
    }))
    expect(modules[0].name).toBe('Queued Missions')
    expect(modules[0].content).toContain('Queued curator missions:')
    expect(modules[0].content).toContain('#7')
  })

  it('renders RL signal module without hitting the database', async () => {
    // readFile mock not configured → throws → fallback message
    readFileMock.mockRejectedValue(new Error('ENOENT'))

    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [],
      lobeModules: { curator: [BUILT_IN_MODULE_IDS.rl], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(findManyMock).not.toHaveBeenCalled()
    expect(modules[0].content).toContain('curator-rl.md not found')
  })

  it('renders all todo missions', async () => {
    findManyMock.mockResolvedValue([
      { id: 8, name: 'All todo', description: 'ship all', priority: 8.2, assignedTo: 'carbondev', status: 'todo', maturityLevel: 2 },
    ])

    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [],
      lobeModules: { curator: [BUILT_IN_MODULE_IDS.allTodo], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'todo' } }))
    expect(modules[0].content).toContain('All TODO missions:')
    expect(modules[0].content).toContain('#8')
  })

  it('renders anorak todo missions', async () => {
    findManyMock.mockResolvedValue([
      { id: 9, name: 'Anorak todo', description: 'ship anorak', priority: 7.4, assignedTo: 'anorak', status: 'todo', maturityLevel: 1 },
    ])

    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [],
      lobeModules: { curator: [BUILT_IN_MODULE_IDS.anorakTodo], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'todo',
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      },
    }))
    expect(modules[0].content).toContain('Anorak TODO missions:')
    expect(modules[0].content).toContain('#9')
  })

  it('renders top anorak missions with the requested count', async () => {
    findManyMock.mockResolvedValue([
      { id: 10, name: 'Top one', description: 'ship top', priority: 10, assignedTo: 'anorak-pro', status: 'todo', maturityLevel: 1 },
    ])

    const modules = await resolveContextModulesForLobe({
      lobe: 'curator',
      customModules: [],
      lobeModules: { curator: [BUILT_IN_MODULE_IDS.topAnorak], coder: [], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 5,
    })

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'todo',
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      },
      take: 5,
    }))
    expect(modules[0].content).toContain('Top 5 anorak TODO missions:')
    expect(modules[0].content).toContain('#10')
  })

  it('degrades file read failures into module content', async () => {
    readFileMock.mockRejectedValue(new Error('boom'))
    readdirMock.mockResolvedValue([])

    const modules = await resolveContextModulesForLobe({
      lobe: 'tester',
      customModules: [
        { id: 'custom:file', name: 'Spec File', content: '', enabled: true, type: 'file', filePath: 'missing.txt' },
      ],
      lobeModules: { curator: [], coder: [], reviewer: [], tester: ['custom:file'], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(modules[0].content).toContain('Failed to read linked file: boom')
  })

  it('recovers basename-only links by preferring carbondir matches inside the repo', async () => {
    readFileMock.mockImplementation(async (target: string) => {
      const normalized = target.replace(/\\/g, '/')
      if (normalized.endsWith('/carbondir/oasisspec3.txt')) return 'oasis spec content'
      const error = new Error(`ENOENT: no such file or directory, open '${target}'`) as Error & { code?: string }
      error.code = 'ENOENT'
      throw error
    })
    readdirMock.mockImplementation(async (target: string) => {
      const normalized = String(target).replace(/\\/g, '/')
      if (normalized.endsWith('/carbondir')) {
        return [
          {
            name: 'oasisspec3.txt',
            isDirectory: () => false,
            isFile: () => true,
          },
        ]
      }
      return [
        {
          name: 'carbondir',
          isDirectory: () => true,
          isFile: () => false,
        },
      ]
    })

    const modules = await resolveContextModulesForLobe({
      lobe: 'coder',
      customModules: [
        { id: 'custom:file', name: 'Spec File', content: '', enabled: true, type: 'file', filePath: 'oasisspec3.txt' },
      ],
      lobeModules: { curator: [], coder: ['custom:file'], reviewer: [], tester: [], gamer: [], 'anorak-pro': [] },
      topMissionCount: 3,
    })

    expect(modules[0].content).toContain('oasis spec content')
    expect(modules[0].filePath?.replace(/\\/g, '/')).toContain('/carbondir/oasisspec3.txt')
  })
})

describe('renderContextModuleSections', () => {
  it('renders empty string for no modules', () => {
    expect(renderContextModuleSections([])).toBe('')
  })

  it('renders file source lines and content blocks', () => {
    const text = renderContextModuleSections([
      { id: 'a', name: 'Alpha', description: 'x', kind: 'custom', filePath: 'C:/tmp/alpha.txt', content: 'payload' },
      { id: 'b', name: 'Beta', description: 'y', kind: 'builtin', content: 'second payload' },
    ])

    expect(text).toContain('## Context Module: Alpha')
    expect(text).toContain('Source: C:/tmp/alpha.txt')
    expect(text).toContain('second payload')
  })

  it('keeps module ordering stable in rendered output', () => {
    const text = renderContextModuleSections([
      { id: 'first', name: 'First', description: 'x', kind: 'custom', content: 'alpha' },
      { id: 'second', name: 'Second', description: 'y', kind: 'builtin', content: 'beta' },
    ])

    expect(text.indexOf('Context Module: First')).toBeLessThan(text.indexOf('Context Module: Second'))
  })
})
