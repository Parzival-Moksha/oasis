// Ephemeral smoke test for hosted Colyseus room server.
// Usage: node scripts/_tester-smoke.mjs
// Delete this file after the run.

import { Client } from 'colyseus.js'

const ENDPOINT = 'wss://04515.xyz/rooms'
const WORLD_ID = `tester-smoke-${Date.now()}`

function deadline(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms))
}

async function waitFor(predicate, timeoutMs, label, poll = 50) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    await new Promise(r => setTimeout(r, poll))
  }
  throw new Error(`timeout ${timeoutMs}ms waiting for ${label}`)
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function singleClientFlow() {
  const client = new Client(ENDPOINT)
  let room
  try {
    room = await Promise.race([
      client.joinOrCreate('world', {
        worldId: WORLD_ID,
        playerId: 'tester-A',
        displayName: 'TesterA',
        color: '#38bdf8',
      }),
      deadline(8000, 'joinOrCreate'),
    ])
    record('1. joinOrCreate', true, `roomId=${room.roomId} sessionId=${room.sessionId}`)
  } catch (e) {
    record('1. joinOrCreate', false, e.message)
    return
  }

  let firstStateSeen = false
  room.onStateChange(() => {
    firstStateSeen = true
  })

  // wait for first state
  try {
    await waitFor(() => firstStateSeen, 5000, 'first state change')
    const me = room.state.players?.get?.(room.sessionId)
    if (me) {
      record('2. state has local player', true, `displayName=${me.displayName} color=${me.color}`)
    } else {
      // fallback: iterate
      let found = false
      room.state.players.forEach((p, sid) => {
        if (sid === room.sessionId) found = true
      })
      record('2. state has local player', found, found ? '' : 'local sessionId not in state.players')
    }
  } catch (e) {
    record('2. state has local player', false, e.message)
  }

  // input message
  try {
    room.send('input', { x: 1, y: 0, z: -2, yaw: 0.5, vx: 0.1, vz: -0.1, animState: 'walk' })
    await new Promise(r => setTimeout(r, 250))
    record('3. send input (no error)', true)
  } catch (e) {
    record('3. send input (no error)', false, e.message)
  }

  // mutation message
  try {
    room.send('mutation', {
      kind: 'object_added',
      payload: { id: 'test-1', catalogId: 'foo', name: 'Test', glbPath: '', position: [0, 0, 0], scale: 1 },
    })
    await new Promise(r => setTimeout(r, 250))
    record('4. send mutation (no error)', true)
  } catch (e) {
    record('4. send mutation (no error)', false, e.message)
  }

  try {
    await room.leave()
    record('5. leave cleanly', true)
  } catch (e) {
    record('5. leave cleanly', false, e.message)
  }
}

async function twoClientPeerVisibility() {
  const TWO_WORLD = `tester-smoke-peer-${Date.now()}`
  const a = new Client(ENDPOINT)
  const b = new Client(ENDPOINT)
  let roomA, roomB
  try {
    roomA = await Promise.race([
      a.joinOrCreate('world', { worldId: TWO_WORLD, playerId: 'peer-A', displayName: 'PeerA', color: '#22c55e' }),
      deadline(8000, 'peer A join'),
    ])
    roomB = await Promise.race([
      b.joinOrCreate('world', { worldId: TWO_WORLD, playerId: 'peer-B', displayName: 'PeerB', color: '#f43f5e' }),
      deadline(8000, 'peer B join'),
    ])
    record('6. two clients joined same world', true, `sidA=${roomA.sessionId} sidB=${roomB.sessionId} room=${roomA.roomId === roomB.roomId ? 'same' : 'DIFFERENT'}`)
  } catch (e) {
    record('6. two clients joined same world', false, e.message)
    try { await roomA?.leave?.() } catch {}
    try { await roomB?.leave?.() } catch {}
    return
  }

  if (roomA.roomId !== roomB.roomId) {
    record('7. peer visibility within 1s', false, 'different rooms — matchmaker did not co-locate')
    await roomA.leave().catch(() => {})
    await roomB.leave().catch(() => {})
    return
  }

  let aSeesB = false
  let bSeesA = false
  function check() {
    try {
      roomA.state?.players?.forEach?.((_, sid) => { if (sid === roomB.sessionId) aSeesB = true })
      roomB.state?.players?.forEach?.((_, sid) => { if (sid === roomA.sessionId) bSeesA = true })
    } catch {
      // ignore — schema may not be fully decoded yet
    }
  }
  roomA.onStateChange(check)
  roomB.onStateChange(check)
  check()

  try {
    await waitFor(() => aSeesB && bSeesA, 1500, 'mutual visibility')
    record('7. peer visibility within ~1s', true, `aSeesB=${aSeesB} bSeesA=${bSeesA}`)
  } catch (e) {
    record('7. peer visibility within ~1s', false, `aSeesB=${aSeesB} bSeesA=${bSeesA} :: ${e.message}`)
  }

  await roomA.leave().catch(() => {})
  await roomB.leave().catch(() => {})
}

async function rateLimitAndPayloadCap() {
  const RATE_WORLD = `tester-smoke-rate-${Date.now()}`
  // sender
  const cs = new Client(ENDPOINT)
  // observer that should *not* receive over-cap broadcasts
  const co = new Client(ENDPOINT)
  let sender, observer
  try {
    sender = await cs.joinOrCreate('world', { worldId: RATE_WORLD, playerId: 'sender', displayName: 'Sender', color: '#a78bfa' })
    observer = await co.joinOrCreate('world', { worldId: RATE_WORLD, playerId: 'observer', displayName: 'Observer', color: '#f59e0b' })
  } catch (e) {
    record('8. rate-limit setup', false, e.message)
    return
  }
  if (sender.roomId !== observer.roomId) {
    record('8. rate-limit setup', false, 'sender/observer in different rooms')
    await sender.leave().catch(() => {})
    await observer.leave().catch(() => {})
    return
  }

  let mutationReceived = 0
  observer.onMessage('mutation', () => { mutationReceived += 1 })

  // === 60-message burst ===
  let crashed = false
  try {
    for (let i = 0; i < 60; i += 1) {
      sender.send('mutation', { kind: 'rate_test', payload: { i } })
    }
  } catch (e) {
    crashed = true
    record('8. burst of 60 mutations sent', false, e.message)
  }
  // give server time to broadcast
  await new Promise(r => setTimeout(r, 1500))
  // server should still be responsive: send another input and verify connection is alive
  let stillAlive = false
  try {
    sender.send('input', { x: 2, y: 0, z: 2 })
    await new Promise(r => setTimeout(r, 250))
    stillAlive = sender.connection?.isOpen !== false  // best-effort
  } catch {
    stillAlive = false
  }
  if (!crashed) record('8. burst of 60 mutations sent (no client error, server alive)', stillAlive, `mutationReceived@observer=${mutationReceived}`)

  // === 20 KiB oversize payload ===
  const beforeOversize = mutationReceived
  // 16 KiB cap is on the *serialized envelope*. Build payload >16 KiB.
  const bigStr = 'x'.repeat(20 * 1024)
  try {
    sender.send('mutation', { kind: 'oversize_test', payload: { blob: bigStr } })
  } catch (e) {
    record('9. send oversize (20 KiB) mutation', false, `send threw: ${e.message}`)
  }
  await new Promise(r => setTimeout(r, 800))
  // We expect the oversize mutation NOT to be broadcast (cap is server-side).
  // Other rate-test mutations may still be in flight from the burst window,
  // so allow some slop. The critical check: no new mutation with our oversize
  // kind/marker should arrive. Use a marker-aware observer:
  let oversizeReceived = false
  observer.onMessage('mutation', (m) => { if (m?.kind === 'oversize_test') oversizeReceived = true })
  // Re-send to give the marker-aware handler a chance to catch it if server
  // broadcasts. (The first send already happened, but listener was attached
  // after — so we resend.)
  try {
    sender.send('mutation', { kind: 'oversize_test', payload: { blob: bigStr } })
  } catch {}
  await new Promise(r => setTimeout(r, 800))
  record('9. oversize (20 KiB) mutation NOT broadcast', !oversizeReceived, `oversizeReceived=${oversizeReceived} totalReceivedDelta=${mutationReceived - beforeOversize}`)

  await sender.leave().catch(() => {})
  await observer.leave().catch(() => {})
}

async function main() {
  console.log(`[smoke] endpoint=${ENDPOINT} worldId(prefix)=tester-smoke-...`)
  try {
    await singleClientFlow()
  } catch (e) {
    record('singleClientFlow (unexpected)', false, e.message)
  }
  try {
    await twoClientPeerVisibility()
  } catch (e) {
    record('twoClientPeerVisibility (unexpected)', false, e.message)
  }
  try {
    await rateLimitAndPayloadCap()
  } catch (e) {
    record('rateLimitAndPayloadCap (unexpected)', false, e.message)
  }

  console.log('\n=== SUMMARY ===')
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' :: ' + r.detail : ''}`)
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length} checks, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(2)
})
