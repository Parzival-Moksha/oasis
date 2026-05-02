import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createBridgeMcpServerConfig,
  installBridgeMcpConfig,
  restoreBridgeMcpConfig,
} from '../openclaw-mcp-config-guard.mjs'

const tempDirs = []

async function tempConfig(initialConfig) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oasis-openclaw-mcp-'))
  tempDirs.push(dir)
  const configPath = path.join(dir, 'openclaw.json')
  const statePath = path.join(dir, 'mcp-oasis-restore.json')
  await writeJson(configPath, initialConfig)
  return { dir, configPath, statePath }
}

async function writeJson(filePath, value) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true })
  }
})

describe('OpenClaw MCP config guard', () => {
  it('temporarily points oasis at the bridge MCP URL and restores the previous server', async () => {
    const localServer = {
      url: 'http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw',
      transport: 'streamable-http',
    }
    const bridgeServer = createBridgeMcpServerConfig('http://127.0.0.1:17890/mcp')
    const { configPath, statePath } = await tempConfig({
      model: { provider: 'openai' },
      mcp: { servers: { oasis: localServer } },
    })

    const guard = await installBridgeMcpConfig({
      configPath,
      statePath,
      serverName: 'oasis',
      serverConfig: bridgeServer,
    })

    expect(guard.changed).toBe(true)
    expect((await readJson(configPath)).mcp.servers.oasis).toEqual(bridgeServer)

    const restored = await guard.restore()
    expect(restored.restored).toBe(true)
    expect((await readJson(configPath)).mcp.servers.oasis).toEqual(localServer)
  })

  it('removes the temporary oasis server on restore when there was no previous server', async () => {
    const { configPath, statePath } = await tempConfig({ profile: { name: 'test' } })
    const bridgeServer = createBridgeMcpServerConfig('http://127.0.0.1:17890/mcp')

    await installBridgeMcpConfig({
      configPath,
      statePath,
      serverName: 'oasis',
      serverConfig: bridgeServer,
    })
    expect((await readJson(configPath)).mcp.servers.oasis).toEqual(bridgeServer)

    const restored = await restoreBridgeMcpConfig({ statePath })
    expect(restored.restored).toBe(true)
    expect((await readJson(configPath)).mcp).toBeUndefined()
  })

  it('can create a missing OpenClaw config file for first-time installs', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'oasis-openclaw-mcp-'))
    tempDirs.push(dir)
    const configPath = path.join(dir, 'openclaw.json')
    const statePath = path.join(dir, 'mcp-oasis-restore.json')
    const bridgeServer = createBridgeMcpServerConfig('http://127.0.0.1:17890/mcp')

    await installBridgeMcpConfig({
      configPath,
      statePath,
      serverName: 'oasis',
      serverConfig: bridgeServer,
    })

    expect((await readJson(configPath)).mcp.servers.oasis).toEqual(bridgeServer)
  })

  it('does not clobber a user change made while the bridge was running', async () => {
    const localServer = {
      url: 'http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw',
      transport: 'streamable-http',
    }
    const userChangedServer = {
      url: 'http://127.0.0.1:4516/api/mcp/oasis?agentType=other',
      transport: 'streamable-http',
    }
    const { configPath, statePath } = await tempConfig({
      mcp: { servers: { oasis: localServer } },
    })

    await installBridgeMcpConfig({
      configPath,
      statePath,
      serverName: 'oasis',
      serverConfig: createBridgeMcpServerConfig('http://127.0.0.1:17890/mcp'),
    })
    await writeJson(configPath, { mcp: { servers: { oasis: userChangedServer } } })

    const restored = await restoreBridgeMcpConfig({ statePath })
    expect(restored.restored).toBe(false)
    expect(restored.reason).toBe('changed_by_user')
    expect((await readJson(configPath)).mcp.servers.oasis).toEqual(userChangedServer)
  })
})
