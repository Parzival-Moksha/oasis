'use client'

// ░▒▓ VILLAGE ACADEMY MAP — the skill tree you drag and zoom: the Character menu's Skills tab ▓▒░
// A board drawn on its own canvas (academy-map-engine.ts): the core skills in the middle, every lane a
// slice, every tier a ring. Click a skill for its sheet: prompt, proof, keys, "I did it", "Ask Anorak to
// check". The menu (CharacterMenu.tsx) owns the keys, the frame and closing; this file is the board, its
// bar (set, trainee, zoom) and the HUD's way in.
//
// Not on screen, it is nothing: no canvas, no frame callback, no pointer work. The DOM here is the bar
// around the board; the skills themselves are never DOM or React.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { academyLaneColor, nodeLook, type AcademyKeyKind } from '../../lib/village/village-academy'
import { academyLaneLook, layoutAcademyMap } from '../../lib/village/academy-map'
import { AcademyMapEngine, type MapNodeSpec } from './academy-map-engine'
import { getKeychainState, keyStates, subscribeKeychain, watchKeychainFromMap } from './keychain-store'
import {
  closeAcademyMap,
  getAcademyState,
  mapContent,
  mapSetId,
  mapTrainee,
  openAcademyMap,
  openAcademyReader,
  selectAcademyTrainee,
  setAcademyMapSet,
  subscribeAcademy,
  useAcademyEnabled,
} from './academy-store'
import { getCharacterState, setCharacterTab, subscribeCharacter } from './character-store'
import { showNotice } from '../forge/GlobalNotice'
import { VILLAGE_FONT_BODY, VILLAGE_TYPE_CLASS } from './village-status'

const BUTTON = 'rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-bold text-white/85 transition hover:bg-white/15'

/** The HUD's way in. */
export function AcademyMapButton() {
  const enabled = useAcademyEnabled()
  const open = useSyncExternalStore(subscribeCharacter, () => getCharacterState().open && getCharacterState().tab === 'skills', () => false)
  const has = useSyncExternalStore(subscribeAcademy, () => Boolean(getAcademyState().content), () => false)
  if (!enabled || !has) return null
  return (
    <button
      type="button"
      data-academy-map-button
      onClick={() => (open ? closeAcademyMap() : openAcademyMap())}
      className="shrink-0 rounded-md border border-amber-300/40 bg-amber-400/15 px-2.5 py-1 text-[11px] font-black text-amber-50 transition hover:bg-amber-400/30"
      title="The skill map: what your agents can learn, and what they have (K)"
    >
      <span className="mr-1 rounded bg-black/40 px-1 font-mono">K</span>Skills
    </button>
  )
}

/** The board with its bar, filling the box it is put in (the Character menu's Skills tab). */
export function SkillMapBoard() {
  const content = useSyncExternalStore(subscribeAcademy, () => mapContent(), () => null)
  const trainee = useSyncExternalStore(subscribeAcademy, () => mapTrainee(), () => null)
  const { sets, trainees, reader, readerMap } = useSyncExternalStore(subscribeAcademy, getAcademyState, getAcademyState)
  const setId = useSyncExternalStore(subscribeAcademy, () => mapSetId(), () => null)
  const frame = useRef<HTMLDivElement>(null)
  const engine = useRef<AcademyMapEngine | null>(null)
  // Which keys are held: a held key's gem is lit on every skill that lists it.
  const keychain = useSyncExternalStore(subscribeKeychain, () => getKeychainState().keys, () => getKeychainState().keys)
  useEffect(() => {
    watchKeychainFromMap(true)
    return () => watchKeychainFromMap(false)
  }, [])

  useEffect(() => {
    if (!frame.current) return
    // A canvas of its own per engine: a WebGL context that was let go cannot be taken up again (React
    // runs this twice in development), and letting it go is what keeps the browser's context count down.
    const canvas = document.createElement('canvas')
    canvas.dataset.academyMapCanvas = ''
    canvas.className = 'block h-full w-full touch-none'
    canvas.style.cursor = 'grab'
    frame.current.appendChild(canvas)
    let made: AcademyMapEngine
    try {
      made = new AcademyMapEngine(canvas, {
        onHover: () => {},
        onPick: id => { openAcademyReader(id, true) },
      })
    } catch (error) {
      // No second WebGL context to be had (a lost GPU, a browser at its limit): say so and step back.
      showNotice(`The skill map could not start its canvas: ${error instanceof Error ? error.message : String(error)}`, 'error')
      canvas.remove()
      return
    }
    engine.current = made
    const box = frame.current
    const fitCanvas = () => made.resize(box.clientWidth, box.clientHeight)
    fitCanvas()
    const observer = new ResizeObserver(fitCanvas)
    observer.observe(box)
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__oasisAcademyMap = made
    return () => {
      observer.disconnect()
      made.dispose()
      canvas.remove()
      engine.current = null
      if (process.env.NODE_ENV !== 'production') delete (window as unknown as Record<string, unknown>).__oasisAcademyMap
    }
  }, [])

  // The board's shape depends on the skills alone; looks on the trainee's progress.
  const layout = useMemo(() => (content ? layoutAcademyMap(content.skills, content.lanes) : null), [content])
  const looksKey = content ? content.skills.map(skill => nodeLook(trainee, skill)).join(',') : ''
  useEffect(() => {
    if (!engine.current || !content || !layout) return
    const kinds = new Map(content.keys.map(key => [key.id, key.kind]))
    const held = keyStates(getKeychainState())
    const laneIndex = new Map(content.lanes.map((lane, index) => [lane.id, index]))
    const specs: MapNodeSpec[] = content.skills.map(skill => {
      const look = academyLaneLook(laneIndex.get(skill.lane) ?? 0)
      return {
        id: skill.id,
        name: skill.short || skill.name,
        order: skill.order,
        xp: skill.xp,
        color: academyLaneColor(skill.lane),
        corners: look.corners,
        pattern: look.pattern,
        icon: skill.icon || null,
        keys: skill.keys.map(id => ({ kind: kinds.get(id) || 'account' as AcademyKeyKind, state: held.get(id) || 'unknown' as const })),
        perk: Boolean(skill.perk),
        flag: Boolean(skill.flag),
        look: nodeLook(trainee, skill),
      }
    })
    engine.current.setBoard(layout, specs, `${setId}:${trainee?.key || ''}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, layout, looksKey, trainee?.key, setId, keychain])

  useEffect(() => {
    engine.current?.setSelected(readerMap ? reader : null)
  }, [reader, readerMap])

  const done = content && trainee ? content.skills.filter(skill => trainee.skills[skill.id]?.state === 'verified').length : 0
  return (
    <div
      data-ui-panel="village-academy-map"
      className={`absolute inset-0 overflow-hidden text-white ${VILLAGE_TYPE_CLASS}`}
      style={{ fontFamily: VILLAGE_FONT_BODY }}
      onContextMenu={event => event.preventDefault()}
    >
      <div ref={frame} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
          {sets.length > 1 && (
            <div className="flex overflow-hidden rounded-md border border-white/15" role="radiogroup" aria-label="Skill set">
              {sets.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === setId}
                  data-academy-set={item.id}
                  title={item.title}
                  onClick={() => setAcademyMapSet(item.id)}
                  className={`max-w-[190px] truncate px-2.5 py-1 text-[11px] font-bold transition-colors ${item.id === setId ? 'bg-amber-500 text-black' : 'bg-transparent text-white/60 hover:bg-white/10 hover:text-white'}`}
                >
                  {item.count} skills
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11.5px]">
            <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">trainee</span>
            <select
              data-academy-map-trainee
              value={trainee?.key || ''}
              onChange={event => selectAcademyTrainee(event.target.value || null)}
              onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
              className="max-w-[170px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11.5px] text-white outline-none"
            >
              {!trainee && <option value="">nobody yet</option>}
              {trainees.map(item => <option key={item.key} value={item.key}>{item.name}{item.training ? '' : ' (not training)'}</option>)}
            </select>
          </label>
          {trainee && content && (
            <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11.5px]" title="Level: verified XP plus half of the claimed XP">
              <span className="font-bold text-amber-300">{trainee.level.name}</span>
              <span className="text-white/60">{trainee.xp.score} XP{trainee.level.next ? ` / ${trainee.level.next.xp}` : ''}</span>
              <span className="text-white/45">· {done} of {content.skills.length}</span>
            </span>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950/70 px-2 py-2">
          <button type="button" data-academy-map-keychain className={BUTTON} onClick={() => setCharacterTab('keys')} title="Which keys you hold: a key you hold lights its gem here">Keys</button>
          <button type="button" className={BUTTON} onClick={() => engine.current?.zoomBy(-260)} title="Closer (wheel)">+</button>
          <button type="button" className={BUTTON} onClick={() => engine.current?.zoomBy(260)} title="Further (wheel)">−</button>
          <button type="button" data-academy-map-fit className={BUTTON} onClick={() => engine.current?.fit()} title="The whole map (double-click the background)">fit</button>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[10.5px] uppercase tracking-[0.18em] text-white/55">
        {content ? 'drag to move · wheel to zoom · click a skill' : 'loading the skills…'}
      </div>
    </div>
  )
}
