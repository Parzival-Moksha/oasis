import { Server, matchMaker } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import http from 'node:http'
import { WorldRoom } from './rooms/WorldRoom.js'

// 4519 NOT 4517: the OpenClaw/Hermes WSS relay sidecar
// (scripts/openclaw-relay.mjs, ecosystem.openclaw.config.cjs) already binds
// 4517. The Colyseus room sidecar must not collide with it on hosted PM2.
const PORT = Number(process.env.OASIS_ROOM_PORT) || 4519

const httpServer = http.createServer((req, res) => {
  if (req.url === '/rooms/health') {
    matchMaker.stats.fetchAll()
      .then(stats => {
        const totalRooms = stats.reduce((sum, node) => sum + node.roomCount, 0)
        const totalConns = stats.reduce((sum, node) => sum + node.ccu, 0)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, rooms: totalRooms, connections: totalConns }))
      })
      .catch(error => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }))
      })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('oasis-room-server')
})

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
})

gameServer.define('world', WorldRoom)
  .filterBy(['worldId'])

gameServer.listen(PORT).then(() => {
  console.log(`[oasis-room-server] listening on :${PORT}`)
})

process.on('SIGINT', () => { void gameServer.gracefullyShutdown().then(() => process.exit(0)) })
process.on('SIGTERM', () => { void gameServer.gracefullyShutdown().then(() => process.exit(0)) })
