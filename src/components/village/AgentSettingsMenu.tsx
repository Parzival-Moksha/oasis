'use client'

// ░▒▓ AGENT SETTINGS — one menu per agent: its voice and speed, its avatar, its colour, and the look of all chats ▓▒░
// The gear in the agent window's header, on the side panel (E) and on the agent's full screen (F).
//   Character its role in a sentence and a short "who you are", the owner's words or the agent's own; with its look
//             and its place, which the Oasis keeps up to date (engine character.js). The agent is told what is here.
//   Voice     one of twenty ElevenLabs voices (or the one the agent picked for itself) and how fast it talks (0.5x to 3x), per agent, remembered per session
//             (village-companion.ts, lib/village/village-voices.ts). "Hear it" says one line in that voice.
//   Walking   "Come to me when you need me" (on for every agent: it walks up when it needs a decision or has
//             finished, and goes home once you answered or looked) and "Follow me" (on for Anorak only).
//   Avatar    the body it wears in the village (the Oasis avatar gallery; kept in village memory).
//   Colour    this agent's chat background (lib/village/panel-look.ts).
//   All chats transparency and blur, for every agent.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AgentSelectionSection } from './AgentSelectionSection'
import { CharacterSection } from './CharacterSection'
import { ScheduleSection } from './ScheduleSection'

import { AGENT_AVATAR_CATALOG } from '../../lib/agent-avatar-catalog'
import { villageAgentKey } from '../../lib/village/village-layout'
import { getVillageAgentSkin, getVillageMemoryVersion, setVillageAgentSkin, subscribeVillageMemory } from '../../lib/village/village-memory'
import {
  DEFAULT_LOOK,
  getAgentAccent,
  getPanelLook,
  getPanelLookVersion,
  setAgentAccent,
  setPanelLook,
  subscribePanelLook,
} from '../../lib/village/panel-look'
import { ACCENT_SWATCHES } from '../../lib/village/village-tags'
import { SPEECH_SPEED, VILLAGE_VOICES, villageVoice } from '../../lib/village/village-voices'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { AvatarGallery } from '../forge/AvatarGallery'
import { pressVillageFollow, setVillageFollowFor, useVillageFollowView } from './follow-view'
import { showNotice } from '../forge/GlobalNotice'
import {
  agentVoiceChosenBy,
  clearAgentVoicePick,
  getAgentVoiceSettings,
  getVillageFollowVersion,
  getVillageSpeech,
  getVoiceSettingsVersion,
  isVillageComeOn,
  isVillageFollowOn,
  setAgentVoice,
  setAgentVoiceSpeed,
  setVillageCome,
  setVillageFollow,
  subscribeVillageFollow,
  speakVillageAgent,
  stopVillageSpeech,
  subscribeVillageSpeech,
  subscribeVoiceSettings,
} from './village-companion'
import { agentDisplayName } from './village-status'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const HEADING = 'mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55'

function avatarLabel(path: string | null): { name: string; thumb: string | null } {
  if (!path) return { name: 'automatic', thumb: null }
  const entry = AGENT_AVATAR_CATALOG.find(item => item.path === path)
  if (entry) return { name: entry.name, thumb: `${OASIS_BASE}/avatars/gallery/thumbs/${entry.id.replace(/^av_/, '')}.jpg` }
  return { name: (path.split('/').pop() || path).replace(/\.vrm$/i, ''), thumb: null }
}

/** Voice and speed of one agent. */
function VoiceSection({ agent, agentKey }: { agent: Pick<EngineAgentState, 'id' | 'name' | 'speak' | 'voiceChoice'>; agentKey: string }) {
  useSyncExternalStore(subscribeVoiceSettings, getVoiceSettingsVersion, () => 0)
  const speech = useSyncExternalStore(subscribeVillageSpeech, getVillageSpeech, () => null)
  const settings = getAgentVoiceSettings(agentKey, agent.name, agent.voiceChoice)
  const chosenBy = agentVoiceChosenBy(agentKey, agent.voiceChoice)
  const sample = `Hello, I am ${agent.name}. This is how I sound.`
  const sampling = speech?.agentId === agent.id && speech.text === sample
  return (
    <div className="mb-3" data-agent-voice-settings={`${settings.voice}@${settings.speed}`}>
      <div className={HEADING}>Voice · {agent.name}</div>
      <div className="mb-2 flex items-center gap-1.5">
        <select
          value={settings.voice}
          aria-label="Voice"
          data-agent-voice={settings.voice}
          title={villageVoice(settings.voice)?.sound}
          onChange={event => setAgentVoice(agentKey, event.target.value)}
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/60 px-1 py-1 text-[11px] text-white"
        >
          {VILLAGE_VOICES.map(voice => <option key={voice.key} value={voice.key}>{voice.name} · {voice.sound}</option>)}
        </select>
        <button
          type="button"
          data-agent-voice-sample
          title={sampling ? 'Stop' : 'Hear one line in this voice at this speed (a new voice or speed costs a few ElevenLabs credits once)'}
          onClick={() => {
            if (sampling) {
              stopVillageSpeech()
              return
            }
            void speakVillageAgent(agent.id, sample, getAgentVoiceSettings(agentKey, agent.name, agent.voiceChoice), true).then(played => {
              if (!played) showNotice('Could not play the voice (see the console).', 'warn')
            })
          }}
          className={`shrink-0 rounded border px-2 py-1 text-[10.5px] font-bold transition ${sampling ? 'border-fuchsia-300/60 bg-fuchsia-400/20 text-fuchsia-50' : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/15'}`}
        >
          {sampling ? (speech?.phase === 'loading' ? '…' : '■ stop') : '▶ hear it'}
        </button>
      </div>
      <div className="-mt-1 mb-2 text-[10px] leading-snug text-white/45" data-agent-voice-by={chosenBy}>
        {chosenBy === 'owner' ? (
          <>your pick{' · '}<button type="button" onClick={() => clearAgentVoicePick(agentKey)} className="underline-offset-2 hover:text-white hover:underline">{agent.voiceChoice ? `back to its own choice (${villageVoice(agent.voiceChoice)?.name || agent.voiceChoice})` : 'let it choose'}</button></>
        ) : chosenBy === 'agent' ? 'it chose this voice itself; pick another and yours counts' : 'dealt at random until it picks its own, or you do'}
      </div>
      <label className="block" title="How fast this agent talks. 1.0× is the voice as ElevenLabs reads it; the pitch stays natural. Changes the clip that is playing too.">
        <span className="flex justify-between"><span>Speed</span><span className="text-white/55">{settings.speed.toFixed(1)}×</span></span>
        <input
          type="range"
          min={SPEECH_SPEED.min}
          max={SPEECH_SPEED.max}
          step={SPEECH_SPEED.step}
          value={settings.speed}
          aria-label="Speech speed"
          data-agent-voice-speed={settings.speed}
          onChange={event => setAgentVoiceSpeed(agentKey, Number(event.target.value))}
          className="w-full accent-fuchsia-300"
        />
      </label>
      {agent.speak !== true && (
        <div className="mt-1 text-[10px] leading-snug text-white/45">
          {agent.speak === null ? 'It speaks once the agent engine is restarted and its Voice switch is on.' : 'Its Voice switch is off: it only speaks when you press play.'}
        </div>
      )}
    </div>
  )
}

/** When this agent leaves its desk. */
function WalkingSection({ agentId, agentKey, name }: { agentId: string; agentKey: string; name: string }) {
  useSyncExternalStore(subscribeVillageFollow, getVillageFollowVersion, () => 0)
  const come = isVillageComeOn(agentKey)
  const view = useVillageFollowView(agentId, agentKey, name)
  const follow = view !== 'off'
  return (
    <div className="mb-3">
      <div className={HEADING}>Walking · {name}</div>
      <label className="mb-1 flex cursor-pointer items-start gap-2" title="When it needs a decision from you, has finished, or is stuck, it walks from its desk to you and waits in front of you. It waits there in silence: its spoken line plays when you open it (E or F). It goes back once you answered it, or opened its panel and closed it again. While you talk to another agent it waits a few metres back.">
        <input type="checkbox" checked={come} data-agent-come={come ? 'on' : 'off'} onChange={event => setVillageCome(agentKey, event.target.checked)} className="mt-[2px] accent-amber-300" />
        <span>Come to me when you need me</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2" title="It walks beside you all the time (the same switch as “follow” in the panel).">
        <input type="checkbox" checked={follow} data-agent-follow={view} onChange={event => setVillageFollowFor(agentId, agentKey, name, event.target.checked)} className="mt-[2px] accent-amber-300" />
        <span>Follow me</span>
      </label>
      {view === 'parked' && (
        <button type="button" data-agent-follow-again onClick={() => pressVillageFollow(agentId, agentKey, name)} className="ml-5 mt-0.5 text-[10.5px] text-amber-200/90 underline-offset-2 hover:underline">
          parked where you sent it · follow me again
        </button>
      )}
      {view === 'council' && <div className="ml-5 mt-0.5 text-[10.5px] text-white/50">in the Council's circle until it ends</div>}
    </div>
  )
}

export function AgentSettingsButton({ agent, large = false }: { agent: Pick<EngineAgentState, 'id' | 'name' | 'sessionId' | 'owned' | 'speak' | 'voiceChoice' | 'title' | 'cwd' | 'kind' | 'schedule' | 'appointments' | 'nextWake' | 'wakesToday'>; large?: boolean }) {
  const [open, setOpen] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  useSyncExternalStore(subscribeVillageMemory, getVillageMemoryVersion, () => 0)
  const agentKey = villageAgentKey({ id: agent.id, sessionId: agent.sessionId })
  const look = getPanelLook()
  const accent = getAgentAccent(agentKey)
  const { skin, picked } = getVillageAgentSkin(agentKey)
  const avatar = avatarLabel(skin)
  const name = agentDisplayName(agent as EngineAgentState)
  const boxRef = useRef<HTMLDivElement>(null)

  // A click outside closes it.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  }, [open])

  const size = large ? 'h-[30px] w-[30px]' : 'h-[26px] w-[26px]'
  return (
    <div ref={boxRef} className="relative" onKeyDown={event => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Settings for this agent: voice and speed, when it walks to you, avatar, colour; transparency and blur for all agent chats"
        aria-label="Agent settings"
        aria-expanded={open}
        data-agent-settings
        className={`flex ${size} items-center justify-center rounded-md border text-white/80 transition hover:bg-white/15 ${open ? 'border-white/45 bg-white/15' : 'border-white/15 bg-white/5'}`}
      >
        <svg width={large ? 16 : 14} height={large ? 16 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
      {open && (
        <div data-agent-settings-menu className="absolute right-0 top-9 z-50 max-h-[min(78vh,760px)] w-[280px] overflow-y-auto rounded-lg border border-white/15 bg-slate-950/95 p-3 text-left text-[11px] font-normal normal-case tracking-normal text-white shadow-[0_18px_50px_rgba(0,0,0,0.6)]">
          {/* Who it is: role and who-you-are, kept by the engine as a card per agent (CharacterSection). */}
          <CharacterSection agentId={agent.id} name={name} />
          {/* When it wakes up on its own (engine schedule.js). Only agents the Oasis runs can be woken. */}
          {agent.owned && <ScheduleSection agent={agent} name={name} />}
          {agent.owned && <VoiceSection agent={agent} agentKey={agentKey} />}
          <WalkingSection agentId={agent.id} agentKey={agentKey} name={agent.name} />
          <AgentSelectionSection agentId={agent.id} agentKey={agentKey} name={agent.name} />

          <div className={HEADING}>Avatar · {name}</div>
          <button
            type="button"
            data-agent-avatar
            onClick={() => { setGallery(true); setOpen(false) }}
            title={`Avatar: ${avatar.name}${picked ? ' (your pick)' : ' (automatic)'}. Click to choose another.`}
            className="mb-3 flex w-full items-center gap-2 rounded border border-white/15 bg-white/5 py-1 pl-1 pr-2 text-left transition hover:bg-white/15"
          >
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded bg-black/40">
              {avatar.thumb && !thumbFailed
                // eslint-disable-next-line @next/next/no-img-element -- a small local thumbnail
                ? <img src={avatar.thumb} alt="" className="h-full w-full object-cover" onError={() => setThumbFailed(true)} />
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}
            </span>
            <span className="min-w-0 flex-1 truncate">{avatar.name}<span className="text-white/45">{picked ? ' · your pick' : ' · automatic'}</span></span>
            <span className="shrink-0 text-white/55">choose…</span>
          </button>

          <div className={HEADING}>Colour · {name}</div>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {ACCENT_SWATCHES.map(swatch => (
              <button
                key={swatch}
                type="button"
                onClick={() => setAgentAccent(agentKey, swatch)}
                aria-label={`Colour ${swatch}`}
                className={`h-5 w-5 rounded border ${swatch === accent ? 'border-white' : 'border-white/25'}`}
                style={{ background: swatch }}
              />
            ))}
            <input type="color" value={accent} onChange={event => setAgentAccent(agentKey, event.target.value)} aria-label="Custom colour" className="h-5 w-7 cursor-pointer rounded border border-white/25 bg-transparent p-0" />
          </div>
          <div className="mb-3 text-[10px] text-white/45">One colour for its name tag, the rim of its marker, its panel and its screen.</div>

          <div className={HEADING}>All agent chats</div>
          <label className="mb-2 block">
            <span className="flex justify-between"><span>Transparency</span><span className="text-white/55">{Math.round((1 - look.opacity) * 100)}%</span></span>
            <input type="range" min={0} max={85} value={Math.round((1 - look.opacity) * 100)} onChange={event => setPanelLook({ opacity: 1 - Number(event.target.value) / 100 })} className="w-full accent-sky-300" />
          </label>
          <label className="block">
            <span className="flex justify-between"><span>Blur</span><span className="text-white/55">{look.blur}px</span></span>
            <input type="range" min={0} max={24} value={look.blur} onChange={event => setPanelLook({ blur: Number(event.target.value) })} className="w-full accent-sky-300" />
          </label>
          <button
            type="button"
            onClick={() => { setPanelLook(DEFAULT_LOOK); setAgentAccent(agentKey, null); setAgentVoiceSpeed(agentKey, SPEECH_SPEED.default) }}
            className="mt-3 text-[10.5px] text-white/55 underline-offset-2 hover:text-white hover:underline"
          >
            back to the defaults (look, colour, speed)
          </button>
        </div>
      )}
      {gallery && (
        <AvatarGallery
          currentAvatarUrl={picked ? skin : null}
          onSelect={(avatarUrl) => {
            setVillageAgentSkin(agentKey, avatarUrl)
            setThumbFailed(false)
            setGallery(false)
          }}
          onClose={() => setGallery(false)}
        />
      )}
    </div>
  )
}
