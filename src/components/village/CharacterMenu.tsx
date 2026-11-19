'use client'

// ░▒▓ CHARACTER MENU — the player's menu: Character, Skills, Keys ▓▒░
// The owner, 2026-11-19: "it's not a profile, man, it's not a social scroller. This is the most badass
// metaverse... a cool looking player menu." Like Diablo's character screen and skill tree, in one menu:
//   · Character: who you are here (name, avatar, level and XP, where the XP comes from), your vitals, your
//     accounts (the logins the keychain found, what Claude Code has used), your agents in training.
//   · Skills: the skill map (academy-map-engine.ts on its own canvas), drag and zoom.
//   · Keys: the keychain. "Needs a key" anywhere opens it here, at that key.
// Opened from the main menu's Character tile, K (Skills), the HUD's Skills button, any "needs a key".
//
// The look is Hipster's UI kit (src/components/ui-kit: KitPanel, KitTabs, KitCard, KitProgress, KitButton), so the
// one menu style in Settings (Glass, Forged, Parchment, Rune) restyles it with no code here; this file adds layout
// and text emphasis only. Closed, it is one key listener.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { isVillageProfileClient } from '../../lib/oasis-profile'
import { CHARACTER_TABS, characterKeyAction, levelProgressNumbers, type CharacterTab } from '../../lib/village/character-menu'
import { KitButton, KitCard, KitPanel, KitProgress, KitTabs } from '../ui-kit'
import {
  CHARACTER_MENU_LAYER,
  clearCharacterFocus,
  closeCharacter,
  getCharacterState,
  openCharacter,
  setCharacterTab,
  useCharacterState,
} from './character-store'
import {
  closeAcademyReader,
  getAcademyState,
  readerContent,
  readerTrainee,
  setAcademyMapShown,
  startAcademyRefresh,
  subscribeAcademy,
  useAcademyEnabled,
} from './academy-store'
import { getKeychainState, refreshKeychain, setKeychainShown, subscribeKeychain } from './keychain-store'
import { SkillMapBoard } from './VillageAcademyMap'
import { KeychainPanel } from './VillageAcademyKeychain'
import { AcademySheet } from './VillageAcademyReader'
import { isTypingTarget } from './village-actions'
import { AvatarGallery } from '../forge/AvatarGallery'
import { ClaudeTokenScore } from '../forge/ClaudeTokenScore'
import { DEFAULT_PROFILE_AVATAR_3D_URL } from '../../lib/profile-defaults'
import { getWorkVowState, subscribeWorkVow } from './work-vow-client'

interface Profile {
  xp: number
  level: number
  levelTitle: string
  levelBadge: string
  levelProgress: number
  xpToNext: number
  displayName: string
  avatar_url: string | null
  avatar_3d_url: string | null
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
  unspentSkillPoints?: number
  xpSources?: { oldBalance?: number; mindcraft?: number; foldedAt?: number }
}

const number = (value: number) => Math.round(value).toLocaleString('en-US')

/** Text styles inside kit cards: layout and emphasis only (sizes, weight, opacity), so every kit style colours them. */
const TEXT = {
  label: 'kit-label',
  title: 'font-black tracking-wide',
  strong: 'font-bold',
  note: 'text-[13px] opacity-70',
  link: 'kit-label cursor-pointer underline-offset-2 hover:underline',
}

/** h:mm, the way the work counter shows time. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Today's counted work, live: his main number (Mission Wall's work counter). Read only: the HUD runs the
 * counter (startWorkVow), this listens to it.
 */
function HoursToday() {
  const work = useSyncExternalStore(subscribeWorkVow, getWorkVowState, getWorkVowState)
  const today = work.snapshot?.today
  if (!today) return null
  const seconds = today.seconds + (work.pendingSeconds || 0)
  const target = work.snapshot?.targetSeconds || 0
  return (
    <KitCard data-character-hours>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={TEXT.label}>Worked today</div>
          <div className={`${TEXT.title} text-[56px] leading-none tabular-nums`}>{clock(seconds)}</div>
        </div>
        <div className={`${TEXT.note} text-right`}>
          {target ? (seconds >= target ? 'goal reached' : `${clock(target - seconds)} to the goal`) : ''}
          {work.running ? <div>counting now</div> : null}
        </div>
      </div>
      {target > 0 && <div className="mt-3"><KitProgress label={`Goal ${clock(target)}`} value={Math.min(seconds, target)} max={target} format={() => `${Math.min(100, Math.round((seconds / target) * 100))}%`} accent="#5ef0a8" /></div>}
    </KitCard>
  )
}

// ─── the Character tab ──────────────────────────────────────────────────────

function CharacterTabView({ profile, onPickAvatar }: { profile: Profile | null; onPickAvatar: () => void }) {
  const keys = useSyncExternalStore(subscribeKeychain, () => getKeychainState().keys, () => getKeychainState().keys)
  const trainees = useSyncExternalStore(subscribeAcademy, () => getAcademyState().trainees, () => getAcademyState().trainees)
  const academy = useAcademyEnabled()
  useEffect(() => { void refreshKeychain() }, [])

  if (!profile) return <div className={`${TEXT.note} p-8 text-center`}>Reading your character…</div>
  const level = levelProgressNumbers(profile.xp, profile.levelProgress, profile.xpToNext)
  const logins = keys.filter(key => key.kind === 'subscription' && key.state === 'have')
  const held = keys.filter(key => key.state === 'have').length
  const training = trainees.filter(trainee => trainee.training)
  const sources = profile.xpSources

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-y-auto pr-1 md:grid-cols-[minmax(240px,300px)_1fr]" data-character-tab="character">
      {/* Who you are */}
      <div className="flex flex-col gap-3">
        <KitCard>
          <div className="flex flex-col items-center gap-3">
          <div className="relative h-36 w-36 overflow-hidden rounded-full" style={{ boxShadow: '0 0 0 2px var(--kit-accent, rgba(201,162,86,0.7)), 0 0 26px rgba(245,201,106,0.3)' }}>
            {/* The first letter underneath; the picture over it, or gone if it does not load. */}
            <div className={`${TEXT.title} absolute inset-0 flex items-center justify-center text-[56px]`}>{(profile.displayName || '?').slice(0, 1).toUpperCase()}</div>
            {profile.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="relative h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
            )}
          </div>
          <div className="text-center">
            <div className={`${TEXT.title} text-[24px] leading-tight`} data-character-name>{profile.displayName || 'Wanderer'}</div>
            <div className={`${TEXT.label} mt-1`}>{profile.levelTitle} · level {profile.level}</div>
          </div>
          <KitButton variant="primary" data-character-avatar onClick={onPickAvatar}>
            {profile.avatar_3d_url ? 'Change body' : 'Choose a body'}
          </KitButton>
          </div>
        </KitCard>
        <KitCard title="Vitals">
          <div className="flex flex-col gap-2">
          <KitProgress label="Health" value={profile.hp ?? 100} max={profile.maxHp ?? 100} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#ef4444" />
          <KitProgress label="Mana" value={profile.mana ?? 0} max={profile.maxMana ?? 20} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#60a5fa" />
          {(profile.unspentSkillPoints ?? 0) > 0 && <div className={`${TEXT.note} mt-1`}>{profile.unspentSkillPoints} skill point{profile.unspentSkillPoints === 1 ? '' : 's'} to spend</div>}
          {/* Quests and spending skill points still live in the old Profile panel (ProfileButton): until they move here. */}
          <button type="button" className={`${TEXT.link} mt-1 self-start`} data-character-old-profile onClick={() => { closeCharacter(); window.dispatchEvent(new CustomEvent('oasis:open-profile')) }}>quests and stat points →</button>
          </div>
        </KitCard>
      </div>

      {/* Level, accounts, agents */}
      <div className="flex min-w-0 flex-col gap-3">
        <HoursToday />
        <KitCard data-character-xp>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className={TEXT.label}>Level</div>
              <div className={`${TEXT.title} text-[56px] leading-none`}>{profile.level}</div>
            </div>
            <div className="text-right">
              <div className={`${TEXT.strong} text-[22px]`}>{number(profile.xp)} XP</div>
              <div className={TEXT.note}>{number(level.left)} to level {profile.level + 1}</div>
            </div>
          </div>
          <div className="mt-3"><KitProgress label={`XP to level ${profile.level + 1}`} value={level.into} max={level.span} format={(value, max) => `${number(value)} / ${number(max)}`} accent="#ffd66b" /></div>
          {sources && typeof sources.mindcraft === 'number' && (
            <div className={`${TEXT.note} mt-2`}>
              {number(sources.oldBalance || 0)} from before, and {number(sources.mindcraft)} earned in Mindcraft: one XP for every minute of counted work.
            </div>
          )}
        </KitCard>

        <KitCard>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className={TEXT.label}>Accounts</div>
            {academy && <button type="button" className={TEXT.link} onClick={() => setCharacterTab('keys')}>{keys.length ? `${held} of ${keys.length} keys held` : 'keys'} →</button>}
          </div>
          {logins.length
            ? logins.map(key => (
              <div key={key.id} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className={TEXT.strong}>{key.name}</span>
                <span className={`${TEXT.note} text-right`}>{key.found[0]?.label || 'held'}</span>
              </div>
            ))
            : <div className={TEXT.note}>{keys.length ? 'No subscription login found on this machine.' : 'Looking…'}</div>}
          <div className="mt-2 pt-1"><ClaudeTokenScore /></div>
        </KitCard>

        {academy && (
          <KitCard>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div className={TEXT.label}>Your agents in training</div>
              <button type="button" className={TEXT.link} onClick={() => setCharacterTab('skills')}>skill map →</button>
            </div>
            {training.length
              ? training.map(trainee => (
                <div key={trainee.key} className="flex items-baseline justify-between gap-3 py-0.5">
                  <span className={TEXT.strong}>{trainee.name}{trainee.stone ? ' (stone)' : ''}</span>
                  <span className={TEXT.note}>{trainee.level.name} · {number(trainee.xp.score)} XP</span>
                </div>
              ))
              : <div className={TEXT.note}>Nobody yet. Open an agent and switch Train on.</div>}
          </KitCard>
        )}
      </div>
    </div>
  )
}

// ─── the menu ───────────────────────────────────────────────────────────────

function Menu() {
  const { tab, focusKey, focusNonce } = useCharacterState()
  const academy = useAcademyEnabled()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [picking, setPicking] = useState(false)
  const setAvatar3dUrl = useOasisStore(s => s.setAvatar3dUrl)
  const { reader, readerMap, trainees } = useSyncExternalStore(subscribeAcademy, getAcademyState, getAcademyState)
  const sheetContent = useSyncExternalStore(subscribeAcademy, () => readerContent(), () => null)
  const sheetTrainee = useSyncExternalStore(subscribeAcademy, () => readerTrainee(), () => null)
  const sheetSkill = readerMap && reader ? sheetContent?.skills.find(skill => skill.id === reader) || null : null

  const loadProfile = useCallback(() => {
    fetch('/api/profile', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data) setProfile(data as Profile) })
      .catch(() => {})
  }, [])
  useEffect(loadProfile, [loadProfile])

  // The Academy's data: the village polls it already; elsewhere the menu does while it is open.
  useEffect(() => (isVillageProfileClient() ? undefined : startAcademyRefresh()), [])
  // The map and the keychain run only while their tab is on screen.
  useEffect(() => {
    setAcademyMapShown(academy && tab === 'skills')
    setKeychainShown(academy && tab === 'keys')
    return () => {
      setAcademyMapShown(false)
      setKeychainShown(false)
    }
  }, [tab, academy])
  useEffect(() => { if (focusKey) clearCharacterFocus() }, [focusKey])

  const tabs = CHARACTER_TABS.filter(item => academy || item.id === 'character')
  const shownTab: CharacterTab = academy ? tab : 'character'

  return (
    <div
      // Clear of the HUD rail (Menu, World, Spells, Agents) down the left edge.
      className="fixed inset-0 flex items-center justify-center p-[3vh] md:pl-[180px]"
      style={{ zIndex: 9300, background: 'radial-gradient(ellipse at center, rgba(5,8,18,0.5) 0%, rgba(2,4,10,0.8) 100%)', backdropFilter: 'blur(9px) saturate(0.8)', WebkitBackdropFilter: 'blur(9px) saturate(0.8)', animation: 'characterMenuIn 220ms ease-out' }}
      onMouseDown={event => { if (event.target === event.currentTarget) closeCharacter() }}
      onContextMenu={event => event.preventDefault()}
    >
      <style>{'@keyframes characterMenuIn { from { opacity: 0; transform: scale(0.985) } to { opacity: 1; transform: none } }'}</style>
      <KitPanel
        data-ui-panel="character-menu"
        title={profile?.displayName ? `${profile.displayName} · Level ${profile.level}` : 'Character'}
        onClose={closeCharacter}
        headerExtra={<div className="min-w-[280px]" role="tablist"><KitTabs tabs={tabs.map(item => ({ id: item.id, label: item.label, title: item.hint }))} active={shownTab} onChange={setCharacterTab} /></div>}
        className="h-full max-h-[920px] w-full max-w-[1260px]"
      >
        <div className="relative h-full min-h-[60vh]">
          {shownTab === 'character' && <CharacterTabView profile={profile} onPickAvatar={() => setPicking(true)} />}
          {shownTab === 'skills' && (
            <KitCard className="relative h-[calc(100%-2px)] min-h-[60vh] overflow-hidden !p-0" data-character-tab="skills">
              <SkillMapBoard />
            </KitCard>
          )}
          {shownTab === 'keys' && (
            <div className="h-full min-h-[60vh]" data-character-tab="keys">
              <KeychainPanel focusKey={focusKey} focusNonce={focusNonce} />
            </div>
          )}
        </div>
      </KitPanel>

      {sheetSkill && sheetContent && <AcademySheet skill={sheetSkill} content={sheetContent} trainee={sheetTrainee} trainees={trainees} />}

      {picking && (
        <AvatarGallery
          currentAvatarUrl={profile?.avatar_3d_url || null}
          onSelect={async avatarUrl => {
            setAvatar3dUrl(avatarUrl || DEFAULT_PROFILE_AVATAR_3D_URL)
            setPicking(false)
            try {
              await fetch('/api/profile/avatar3d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: avatarUrl, urlType: avatarUrl ? 'localPath' : 'remove' }),
              })
            } catch { /* the body is on screen already; the profile keeps the old one */ }
            loadProfile()
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** Mounted once in the Scene: the keys, and the menu while it is open. */
export function CharacterMenu() {
  const { open } = useCharacterState()
  const academy = useAcademyEnabled()
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  useUILayer(CHARACTER_MENU_LAYER, open)

  // The menu needs a free mouse.
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])
  // An agent was opened (N, a notification): its panel takes over.
  useEffect(() => {
    if (focusedAgentId) closeCharacter()
  }, [focusedAgentId])
  // Something popped every UI layer (a click in the world): the menu goes with them.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(CHARACTER_MENU_LAYER) && !state._uiLayerStack.includes(CHARACTER_MENU_LAYER)) closeCharacter()
  }), [])

  // K: the Skills tab. Esc: the open sheet first, then the menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyK' && event.code !== 'Escape') return
      const character = getCharacterState()
      const reader = getAcademyState()
      const action = characterKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        open: character.open,
        tab: character.tab,
        readerOpen: Boolean(reader.reader && reader.readerMap),
        agentOpen: Boolean(useOasisStore.getState().agentEngine.focusedAgentId),
        worldKeysFree: useInputManager.getState().can().enterFocuses,
      })
      // Esc with a sheet from the map open: the sheet goes (the village's reader does this too; elsewhere it is us).
      if (!action && event.code === 'Escape' && character.open && reader.reader && reader.readerMap && !isTypingTarget(event.target)) {
        closeAcademyReader()
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!action) return
      // K needs the Academy; Esc always closes.
      if (action !== 'close' && !academy) return
      if (action === 'open-skills') openCharacter('skills')
      else if (action === 'to-skills') setCharacterTab('skills')
      else closeCharacter()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [academy])

  return open ? <Menu /> : null
}
