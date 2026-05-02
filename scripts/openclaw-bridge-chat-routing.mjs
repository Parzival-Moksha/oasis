const TERMINAL_STATES = new Set(['final', 'aborted', 'error'])

function cleanString(value) {
  return typeof value === 'string' ? value : ''
}

function extractGatewayChatText(payload) {
  if (typeof payload?.message === 'string') return payload.message
  if (typeof payload?.delta === 'string') return payload.delta
  if (typeof payload?.content === 'string') return payload.content
  return ''
}

function extractSessionKey(payload) {
  return cleanString(payload?.sessionKey)
    || cleanString(payload?.sessionId)
    || cleanString(payload?.session)
}

export function createGatewayChatRouter({ sendRelay, log = () => {} }) {
  const pendingBySessionKey = new Map()
  const pendingByIdempotencyKey = new Map()
  const runIdToRelaySessionId = new Map()
  const bufferedByRunId = new Map()
  const completedRunIds = new Set()

  function rememberPending({ sessionId, sessionKey, idempotencyKey }) {
    const pending = {
      sessionId: cleanString(sessionId) || 'oasis-default',
      sessionKey: cleanString(sessionKey) || 'oasis-default',
      idempotencyKey: cleanString(idempotencyKey),
    }
    pendingBySessionKey.set(pending.sessionKey, pending)
    if (pending.idempotencyKey) pendingByIdempotencyKey.set(pending.idempotencyKey, pending)
    log('chat.user -> gateway', {
      sessionId: pending.sessionId,
      sessionKey: pending.sessionKey,
      idempotencyKey: pending.idempotencyKey || '(none)',
    })
    return pending
  }

  function forgetPending(pending, runId = '') {
    if (runId) runIdToRelaySessionId.delete(runId)
    if (!pending) return
    pendingBySessionKey.delete(pending.sessionKey)
    if (pending.idempotencyKey) pendingByIdempotencyKey.delete(pending.idempotencyKey)
  }

  function routePayload(payload, sessionId, pending = null) {
    const runId = cleanString(payload?.runId)
    const state = cleanString(payload?.state)
    const text = extractGatewayChatText(payload)
    log('chat.gateway -> relay', {
      state: state || '(none)',
      sessionId,
      sessionKey: pending?.sessionKey || extractSessionKey(payload) || '(none)',
      runId: runId || '(none)',
      chars: text.length,
    })

    if (state === 'delta') {
      sendRelay({ type: 'chat.agent.delta', sessionId, text })
      return true
    }

    if (state === 'final') {
      sendRelay({ type: 'chat.agent.final', sessionId, text })
      if (runId) completedRunIds.add(runId)
      forgetPending(pending, runId)
      return true
    }

    if (state === 'aborted' || state === 'error') {
      sendRelay({
        type: 'chat.agent.final',
        sessionId,
        text: text || `[OpenClaw chat ${state}]`,
      })
      if (runId) completedRunIds.add(runId)
      forgetPending(pending, runId)
      return true
    }

    return false
  }

  function resolvePendingForPayload(payload) {
    const runId = cleanString(payload?.runId)
    const sessionKey = extractSessionKey(payload)
    const idempotencyKey = cleanString(payload?.idempotencyKey)
      || cleanString(payload?.clientRequestId)
      || cleanString(payload?.requestId)

    const mappedSessionId = runId ? runIdToRelaySessionId.get(runId) : ''
    if (mappedSessionId) {
      return {
        sessionId: mappedSessionId,
        pending: sessionKey ? pendingBySessionKey.get(sessionKey) || null : null,
      }
    }

    const pending = (sessionKey ? pendingBySessionKey.get(sessionKey) : null)
      || (idempotencyKey ? pendingByIdempotencyKey.get(idempotencyKey) : null)
      || null
    if (pending && runId) runIdToRelaySessionId.set(runId, pending.sessionId)
    return {
      sessionId: pending?.sessionId || '',
      pending,
    }
  }

  function flushBuffered(runId, sessionId, pending) {
    const buffered = bufferedByRunId.get(runId)
    if (!buffered) return
    bufferedByRunId.delete(runId)
    log('chat.buffer flush', { runId, sessionId, count: buffered.length })
    for (const payload of buffered) {
      routePayload(payload, sessionId, pending)
    }
  }

  return {
    beginChat: rememberPending,

    attachRunId({ runId, sessionId, sessionKey, idempotencyKey }) {
      const cleanRunId = cleanString(runId)
      if (!cleanRunId) return
      if (completedRunIds.has(cleanRunId)) {
        log('chat.send -> gateway resolved after terminal event', { runId: cleanRunId })
        return
      }
      const pending = (cleanString(sessionKey) ? pendingBySessionKey.get(sessionKey) : null)
        || (cleanString(idempotencyKey) ? pendingByIdempotencyKey.get(idempotencyKey) : null)
        || {
          sessionId: cleanString(sessionId) || 'oasis-default',
          sessionKey: cleanString(sessionKey) || 'oasis-default',
          idempotencyKey: cleanString(idempotencyKey),
        }
      runIdToRelaySessionId.set(cleanRunId, pending.sessionId)
      log('chat.send -> gateway', {
        sessionId: pending.sessionId,
        sessionKey: pending.sessionKey,
        runId: cleanRunId,
      })
      flushBuffered(cleanRunId, pending.sessionId, pending)
    },

    handleGatewayChatPayload(payload) {
      const runId = cleanString(payload?.runId)
      const state = cleanString(payload?.state)
      const { sessionId, pending } = resolvePendingForPayload(payload)
      if (sessionId) return routePayload(payload, sessionId, pending)

      if (runId && TERMINAL_STATES.has(state)) {
        const buffered = bufferedByRunId.get(runId) || []
        buffered.push(payload)
        bufferedByRunId.set(runId, buffered.slice(-8))
        log('chat.buffer <- gateway', { runId, state, count: bufferedByRunId.get(runId)?.length || 0 })
        return false
      }

      log('chat.drop <- gateway', {
        state: state || '(none)',
        runId: runId || '(none)',
        sessionKey: extractSessionKey(payload) || '(none)',
      })
      return false
    },
  }
}
