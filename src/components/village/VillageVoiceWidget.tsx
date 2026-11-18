'use client'

// ░▒▓ VOICE WIDGET — voice typing that goes with the owner ▓▒░
// Dictation (and a Scribe voice message) belongs to the agent, not to its panel: Esc closes the panel and the mic
// stays on, so the owner can run around the Oasis and keep talking. This small card at the bottom left (above the
// work clock) shows each one that is running: who it is for, how long, the last few words, Send and Stop.
//   Send: the draft (and any pictures waiting in the box) goes to the agent now; the mic stops.
//   Stop: the mic stops, the words stay in the agent's box; a voice message is kept as an unsent draft.
// Not shown for the agent whose panel is open: the panel shows all of it. Plain and clean on purpose: the
// Hipster skins it (data-voice-widget, data-part="…").

import { useEffect, useState, useSyncExternalStore } from 'react'

import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import {
  dictationVersion,
  lastWords,
  runningDictations,
  stopDictation,
  subscribeDictation,
  takeDraftForSend,
} from '../../lib/voice/village-dictation'
import { clearComposerPictures, getComposerPictures } from './ComposerPictures'
import { discardUnsent, formatClip, resendRecording, stopRecording, subscribeVoiceMessages, voiceMessageList, voiceMessagesVersion } from './VoiceMessage'
import { showNotice } from '../forge/GlobalNotice'

const TITLE_FONT = '"Arial Black", Impact, "Segoe UI Black", "Trebuchet MS", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

/** Send what the agent's box holds (and its waiting pictures), from anywhere. */
export async function sendDraftFromWidget(agentId: string, name: string): Promise<void> {
  const pictures = getComposerPictures(agentId)
  const take = takeDraftForSend(agentId)
  const text = take.text.trim()
  if (!text && !pictures.length) {
    showNotice(`Nothing to send to ${name} yet.`, 'info')
    return
  }
  try {
    await getAgentEngineClient().send(agentId, text, undefined, pictures.length ? pictures.map(p => ({ data: p.data, mediaType: p.mediaType, name: p.name })) : undefined)
    take.sent()
    if (pictures.length) clearComposerPictures(agentId)
    showNotice(`Sent to ${name}.`, 'info')
  } catch (error) {
    showNotice(`Send failed (the words stay in ${name}'s box): ${error instanceof Error ? error.message : String(error)}`, 'error')
  }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

const button = 'rounded-md border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40'

export function VillageVoiceWidget() {
  useSyncExternalStore(subscribeDictation, dictationVersion, () => 0)
  useSyncExternalStore(subscribeVoiceMessages, voiceMessagesVersion, () => 0)
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const agents = useOasisStore(s => s.agentEngine.agents)
  // The md reader's mic (key md:<file>) shows in the reader itself and stops when it closes.
  const dictations = runningDictations().filter(d => d.agentId !== focusedId && !d.agentId.startsWith('md:'))
  const messages = voiceMessageList().filter(m => m.agentId !== focusedId)
  const now = useNow(dictations.length + messages.length > 0)
  if (!dictations.length && !messages.length) return null
  const nameOf = (id: string) => agents[id]?.name || 'an agent'

  return (
    <div data-voice-widget className="oasis-voice-widget pointer-events-none fixed bottom-[76px] left-3 z-[171] flex w-[236px] flex-col gap-1.5 max-[700px]:bottom-auto max-[700px]:left-2 max-[700px]:top-[124px]">
      {dictations.map(d => {
        const name = nameOf(d.agentId)
        const settling = d.phase === 'stopping'
        const words = lastWords(d.agentId, 10)
        return (
          <div key={`d-${d.agentId}`} data-voice-item="dictation" className="pointer-events-auto rounded-lg border border-rose-300/40 bg-slate-950/90 p-2 text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full bg-rose-400 ${settling ? '' : 'animate-pulse'}`} style={{ boxShadow: `0 0 ${4 + Math.round(d.level * 18)}px #fb7185` }} />
              <span data-part="title" className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-[0.12em]" style={{ fontFamily: TITLE_FONT }}>
                {settling ? 'settling' : 'voice typing'} <span className="text-white/60">· {name}</span>
              </span>
              <span data-part="timer" className="font-mono text-[11px] tabular-nums text-white/80">{formatClip(now - d.startedAt)}</span>
            </div>
            <div data-part="words" className="mt-1 min-h-[16px] line-clamp-2 break-words text-[11.5px] leading-snug text-white/85" title={words}>
              {words || <span className="text-white/45">{d.status || 'listening…'}</span>}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" data-part="send" onClick={() => void sendDraftFromWidget(d.agentId, name)} className={`${button} border-emerald-300/50 bg-emerald-400/20 text-emerald-50 hover:bg-emerald-400/35`} title={`Send what you said to ${name} now`}>
                Send
              </button>
              <button type="button" data-part="stop" disabled={settling} onClick={() => stopDictation(d.agentId)} className={`${button} border-white/20 bg-white/5 text-white/85 hover:bg-white/15`} title={`Stop the mic; the words stay in ${name}'s box`}>
                Stop
              </button>
            </div>
          </div>
        )
      })}
      {messages.map(m => {
        const name = nameOf(m.agentId)
        const recording = m.phase === 'recording'
        const unsent = m.phase === 'unsent'
        return (
          <div key={`m-${m.agentId}`} data-voice-item="voice-message" className="pointer-events-auto rounded-lg border border-rose-300/40 bg-slate-950/90 p-2 text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${recording ? 'animate-pulse bg-rose-400' : unsent ? 'bg-amber-300' : 'bg-sky-300'}`} />
              <span data-part="title" className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-[0.12em]" style={{ fontFamily: TITLE_FONT }}>
                {recording ? 'recording' : unsent ? 'not sent' : 'sending'} <span className="text-white/60">· {name}</span>
              </span>
              <span data-part="timer" className="font-mono text-[11px] tabular-nums text-white/80">{formatClip(recording ? now - m.startedAt : m.durationMs)}</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {recording && (
                <>
                  <button type="button" data-part="send" onClick={() => stopRecording(m.agentId)} className={`${button} border-emerald-300/50 bg-emerald-400/20 text-emerald-50 hover:bg-emerald-400/35`} title={`Send this voice message to ${name}`}>Send</button>
                  <button type="button" data-part="stop" onClick={() => stopRecording(m.agentId, { keep: true })} className={`${button} border-white/20 bg-white/5 text-white/85 hover:bg-white/15`} title="Stop recording and keep it to send later">Stop</button>
                </>
              )}
              {unsent && (
                <>
                  <button type="button" data-part="send" onClick={() => resendRecording(m.agentId)} className={`${button} border-emerald-300/50 bg-emerald-400/20 text-emerald-50 hover:bg-emerald-400/35`}>Send</button>
                  <button type="button" data-part="discard" onClick={() => discardUnsent(m.agentId)} className={`${button} border-white/20 bg-white/5 text-white/70 hover:bg-white/15`} title="Throw this voice message away">Discard</button>
                </>
              )}
              {!recording && !unsent && <span className="text-[11px] text-white/55">transcribing…</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
