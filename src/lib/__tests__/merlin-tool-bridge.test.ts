import { beforeEach, describe, expect, it, vi } from 'vitest'

const callToolMock = vi.fn()

vi.mock('../mcp/oasis-tools', () => ({
  callTool: callToolMock,
}))

describe('executeMerlinTool', () => {
  beforeEach(() => {
    callToolMock.mockReset()
    callToolMock.mockResolvedValue({ ok: true, message: 'ok' })
  })

  it('maps add_catalog_object to the shared place_object tool', async () => {
    const { executeMerlinTool } = await import('../mcp/merlin-tool-bridge')

    await executeMerlinTool('add_catalog_object', {
      catalogId: 'km_tower',
      position: [1, 0, 2],
      rotation: [0, 1, 0],
      scale: 2,
      label: 'Tower',
    }, 'world-123')

    expect(callToolMock).toHaveBeenCalledWith('place_object', {
      worldId: 'world-123',
      catalogId: 'km_tower',
      position: [1, 0, 2],
      rotation: [0, 1, 0],
      scale: 2,
      label: 'Tower',
    })
  })

  it('maps set_ground to set_ground_preset with world scoping', async () => {
    const { executeMerlinTool } = await import('../mcp/merlin-tool-bridge')

    await executeMerlinTool('set_ground', { presetId: 'grass' }, 'world-456')

    expect(callToolMock).toHaveBeenCalledWith('set_ground_preset', {
      worldId: 'world-456',
      presetId: 'grass',
    })
  })
})
