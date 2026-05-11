import { Server, matchMaker } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import http from 'node:http'
import { WorldRoom } from './rooms/WorldRoom.js'
import { getRosterStats, getWorldPlayers } from './world-roster.js'

// 4519 NOT 4517: the OpenClaw/Hermes WSS relay sidecar
// (scripts/openclaw-relay.mjs, ecosystem.openclaw.config.cjs) already binds
// 4517. The Colyseus room sidecar must not collide with it on hosted PM2.
const PORT = Number(process.env.OASIS_ROOM_PORT) || 4519

const httpServer = http.createServer((req, res) => {
  // Match both /health and /rooms/health: locally we serve on root, but on
  // hosted nginx routes /rooms/* here so /rooms/health is the public URL.
  // Nginx is configured to rewrite /rooms away, so by the time the request
  // lands we typically see /health. Match both for resilience.
  const url = req.url || ''
  if (url === '/health' || url === '/rooms/health') {
    matchMaker.stats.fetchAll()
      .then(stats => {
        const totalRooms = stats.reduce((sum, node) => sum + node.roomCount, 0)
        const totalConns = stats.reduce((sum, node) => sum + node.ccu, 0)
        const rosterStats = getRosterStats()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, rooms: totalRooms, connections: totalConns, roster: rosterStats }))
      })
      .catch(error => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
      })
    return
  }
  // /world-players?worldId=X — players currently connected to that world.
  // Also matches /rooms/world-players?worldId=X for the nginx-hosted path.
  if (url.startsWith('/world-players') || url.startsWith('/rooms/world-players')) {
    try {
      const u = new URL(url, 'http://internal')
      const worldId = (u.searchParams.get('worldId') || '').trim().replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 96)
      const players = worldId ? getWorldPlayers(worldId) : []
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, worldId, players }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String((error as Error)?.message || error) }))
    }
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('oasis-room-server')
})

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Set the ws-transport payload ceiling slightly above the app-level
    // MUTATION_MAX_BYTES (16 KiB) so our silent app-level drop fires first.
    // Default ws@8 maxPayload is lower than 16 KiB once Colyseus's own
    // overhead is accounted for, so oversize mutations were tripping the
    // transport's RangeError and writing stack traces to room.err.log
    // instead of being silently rejected by our handler. 32 KiB headroom
    // catches legitimate large room state ops while still bounding abuse.
    maxPayload: 32 * 1024,
  }),
})

gameServer.define('world', WorldRoom)
  .filterBy(['worldId'])

gameServer.listen(PORT).then(() => {
  console.log(`[oasis-room-server] listening on :${PORT}`)
})

process.on('SIGINT', () => { void gameServer.gracefullyShutdown().then(() => process.exit(0)) })
process.on('SIGTERM', () => { void gameServer.gracefullyShutdown().then(() => process.exit(0)) })
