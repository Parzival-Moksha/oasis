import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_HOMES, HOME, cleanHome, homeOf, parseHomesFile, withAnswer, withHome, withRequest, yawToward } from '../village-homes'
import { applyHomesAction, readHomes } from '../village-homes-server'
import { describePlace } from '../village-place'

describe('homes', () => {
  it('cleans what it is given', () => {
    expect(cleanHome({ x: 1.234, z: -3, yaw: 0.5 })).toMatchObject({ x: 1.23, z: -3, yaw: 0.5, by: 'owner' })
    expect(cleanHome({ x: 'a', z: 1 })).toBeNull()
    expect(cleanHome({ x: 1e9, z: 1 })).toBeNull()
    expect(cleanHome({ x: 1, z: 2, by: 'agent' })?.by).toBe('agent')
  })
  it('sets and clears one agent in one world, leaving the rest', () => {
    let file = withHome(EMPTY_HOMES, 'w1', 's1', { x: 1, z: 2, yaw: 0, by: 'owner', at: 1 })
    file = withHome(file, 'w1', 's2', { x: 3, z: 4, yaw: 0, by: 'agent', at: 1 })
    file = withHome(file, 'w2', 's1', { x: 5, z: 6, yaw: 0, by: 'owner', at: 1 })
    expect(homeOf(file, 'w1', 's1')?.x).toBe(1)
    expect(homeOf(file, 'w2', 's1')?.x).toBe(5)
    file = withHome(file, 'w1', 's1', null)
    expect(homeOf(file, 'w1', 's1')).toBeNull()
    expect(homeOf(file, 'w1', 's2')?.x).toBe(3)
    expect(file.version).toBe(4)
  })
  it('keeps one request per agent, answers them, and drops old or broken ones on reading', () => {
    let file = withRequest(EMPTY_HOMES, { id: 'r1', agentKey: 's1', agentId: null, kind: 'here', at: 1000 })
    file = withRequest(file, { id: 'r2', agentKey: 's1', agentId: null, kind: 'clear', at: 1000 })
    expect(file.requests.map(r => r.id)).toEqual(['r2'])
    file = withAnswer(file, 'r2', { ok: true, note: 'back' }, 2000)
    expect(file.requests).toEqual([])
    expect(file.done[0]).toMatchObject({ id: 'r2', ok: true })
    const read = parseHomesFile({ ...file, requests: [{ id: 'old', agentKey: 's1', kind: 'here', at: 0 }, { id: 'bad', agentKey: 's1', kind: 'at', at: 5000 }] }, 5000 + HOME.requestTtlMs - 1)
    expect(read.requests).toEqual([])
    expect(parseHomesFile('nonsense')).toEqual(EMPTY_HOMES)
  })
  it('faces a point', () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: 5 })).toBeCloseTo(0)
    expect(yawToward({ x: 0, z: 0 }, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2)
  })
})

describe('the homes file on the server', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
  it('sets, asks, answers and clears, one change after the other', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'homes-'))
    const file = path.join(dir, 'homes.json')
    await Promise.all([
      applyHomesAction({ action: 'set', world: 'w1', agent: 's1', home: { x: 1, z: 2, yaw: 0 } }, file),
      applyHomesAction({ action: 'set', world: 'w1', agent: 's2', home: { x: 3, z: 4, yaw: 0 } }, file),
    ])
    expect(Object.keys((await readHomes(file)).homes.w1).sort()).toEqual(['s1', 's2'])
    const { request } = await applyHomesAction({ action: 'request', agent: 's3', kind: 'at', x: 7, z: 8 }, file)
    expect(request?.kind).toBe('at')
    await applyHomesAction({ action: 'answer', id: request!.id, ok: true, world: 'w1', agent: 's3', home: { x: 7, z: 8, yaw: 1 }, note: 'done' }, file)
    // A second page answering the same request changes nothing.
    await applyHomesAction({ action: 'answer', id: request!.id, ok: true, world: 'w1', agent: 's3', home: { x: 0, z: 0, yaw: 0 }, note: 'late' }, file)
    const after = await readHomes(file)
    expect(after.homes.w1.s3).toMatchObject({ x: 7, z: 8, by: 'agent' })
    expect(after.done.filter(d => d.id === request!.id)).toHaveLength(1)
    await applyHomesAction({ action: 'clear', world: 'w1', agent: 's1' }, file)
    expect((await readHomes(file)).homes.w1.s1).toBeUndefined()
    await expect(applyHomesAction({ action: 'set', world: 'w1', agent: 's1', home: { x: 'no' } }, file)).rejects.toThrow(/x and z/)
    await expect(applyHomesAction({ action: 'dance' }, file)).rejects.toThrow(/unknown/)
  })
})

describe('the card with a home', () => {
  it('says where it lives and what it may build', () => {
    const text = describePlace({ anchor: [34, 0, 1], rotationY: 0, plaza: [0, 0, 7.5], things: [], neighbours: [], home: { buildRadius: HOME.buildRadius, objects: HOME.objects, lights: HOME.lights } })
    expect(text).toMatch(/no desk/)
    expect(text).toMatch(/40 objects and 2 lights/)
    expect(text).toMatch(/within 8 m/)
    expect(text).toMatch(/me\.mjs home/)
    const desk = describePlace({ anchor: [3, 0, 1], rotationY: 0, plaza: [0, 0, 7.5], things: [], neighbours: [] })
    expect(desk).toMatch(/^Your desk is/)
  })
})
