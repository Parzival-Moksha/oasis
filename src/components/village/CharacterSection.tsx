'use client'

// Character: who this agent is, in the agent's settings menu. The engine keeps a card per agent
// (packages/oasis-agent-engine/src/character.js, one md file per session); this shows it and lets the owner
// write the two parts that are words: the role (one sentence) and "who you are" (a few). The agent can write
// them too (scripts/me.mjs), so the text is read fresh each time the menu opens. The agent is told again with
// the next message after a change.

import { useEffect, useState } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineCharacter } from '../../lib/agent-engine-types'
import { showNotice } from '../forge/GlobalNotice'

const HEADING = 'mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55'
const FIELD = 'w-full rounded border border-white/15 bg-black/40 px-1.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-sky-300/60 focus:outline-none'

export function CharacterSection({ agentId, name }: { agentId: string; name: string }) {
  const [card, setCard] = useState<EngineCharacter | null>(null)
  const [role, setRole] = useState('')
  const [who, setWho] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'old-engine' | 'none'>('loading')

  useEffect(() => {
    let alive = true
    getAgentEngineClient()
      .getCharacter(agentId)
      .then(reply => {
        if (!alive) return
        const data = (reply as { data?: EngineCharacter })?.data || (reply as unknown as EngineCharacter)
        setCard(data)
        setRole(data.role || '')
        setWho(data.who || '')
        setState('ready')
      })
      .catch(error => {
        if (!alive) return
        setState(/unknown command/i.test(error instanceof Error ? error.message : String(error)) ? 'old-engine' : 'none')
      })
    return () => { alive = false }
  }, [agentId])

  if (state === 'loading') return <div className="mb-3 text-white/45">Character…</div>
  if (state === 'old-engine') return <div className="mb-3 text-white/45">Character: restart the agent engine (pnpm dev:engine) to give agents a card.</div>
  if (state === 'none' || !card) return <div className="mb-3 text-white/45">Character: no card yet (the agent has no session).</div>

  const changed = role.trim() !== (card.role || '') || who.trim() !== (card.who || '')
  const save = () => {
    setState('saving')
    getAgentEngineClient()
      .setCharacter(agentId, { role, who })
      .then(reply => {
        const data = (reply as { data?: EngineCharacter })?.data || (reply as unknown as EngineCharacter)
        setCard(data)
        setRole(data.role || '')
        setWho(data.who || '')
        showNotice(`Saved. ${name} is told with your next message.`, 'info')
      })
      .catch(error => showNotice(`Character not saved: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setState('ready'))
  }

  return (
    <div className="mb-3" data-agent-character>
      <div className={HEADING} title={card.file ? `The card is the file ${card.file}` : undefined}>Character · {name}</div>
      <label className="mb-1.5 block">
        <span className="text-white/65">Role, in a sentence</span>
        <input
          value={role}
          maxLength={240}
          onChange={event => setRole(event.target.value)}
          placeholder="What it is here for"
          data-agent-role
          className={FIELD}
        />
      </label>
      <label className="mb-1.5 block">
        <span className="text-white/65">Who you are</span>
        <textarea
          value={who}
          maxLength={1200}
          rows={4}
          onChange={event => setWho(event.target.value)}
          placeholder="A few sentences, written to the agent. It can write its own too."
          data-agent-who
          className={`${FIELD} resize-y leading-snug`}
        />
      </label>
      {(card.look || card.place) && (
        <div className="mb-1.5 max-h-[84px] overflow-y-auto rounded bg-white/5 px-1.5 py-1 text-[10.5px] leading-snug text-white/55" title="Kept up to date by the Oasis: the avatar it wears and what is around its place">
          {card.look && <div><span className="text-white/75">Look:</span> {card.look}</div>}
          {card.place && <div><span className="text-white/75">Place:</span> {card.world ? `${card.world}. ` : ''}{card.place}</div>}
        </div>
      )}
      <button
        type="button"
        disabled={!changed || state === 'saving'}
        onClick={save}
        data-agent-character-save
        className="rounded border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-bold text-sky-50 transition hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === 'saving' ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
