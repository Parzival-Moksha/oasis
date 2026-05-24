'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Profile Button + Dropdown
// First button in top-left bar. Shows avatar, opens profile panel.
// Fetches xp/level from local /api/profile stub.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '@/store/oasisStore'
import { AvatarGallery } from './AvatarGallery'
import { useUILayer } from '@/lib/input-manager'
import { useAudioManager } from '@/lib/audio-manager'
import { fmtTokens } from '@/lib/anorak-engine'
import {
  type ProfileTokenBurnSummaryData,
  formatProfileTokenCost,
  getProfileDisplayInputTokens,
  hasProfileTokenUsage,
  normalizeProfileTokenBurnSummary,
} from '@/lib/profile-token-display'
import { DEFAULT_PROFILE_AVATAR_3D_URL } from '@/lib/profile-defaults'
import { QUESTS, QUEST_IDS, getQuestProgress, type QuestId } from '@/lib/quests'
import { GameMenuButton } from './GameMenuButton'
import {
  DEFAULT_PLAYER_SKILLS,
  PLAYER_SKILL_CAP,
  PLAYER_SKILL_DEFS,
  summarizeSkill,
  type PlayerComputedStats,
  type PlayerSkillKey,
  type PlayerSkillSet,
} from '@/lib/player-progression'

interface ProfileData {
  credits: number
  xp: number
  level: number
  aura: number
  wallet_address: string | null
  levelTitle: string
  levelBadge: string
  levelProgress: number
  xpToNext: number
  needsOnboarding: boolean
  displayName: string
  bio: string | null
  avatar_url: string | null
  avatar_3d_url: string | null
  lastLoginDate: string | null
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
  unspentSkillPoints?: number
  skills?: PlayerSkillSet
  playerStats?: PlayerComputedStats
}

type ProfileTab = 'player' | 'quests' | 'skills'

const DEFAULT_PLAYER_STATS: PlayerComputedStats = {
  maxHp: 100,
  maxMana: 20,
  fireboltDamage: 14,
  fireboltManaCost: 1,
  fireboltSpeedMetersPerSecond: 24,
  manaRegenMultiplier: 1,
  conjureManaCost: 20,
  moveSpeedMultiplier: 1,
}

export function ProfileButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  useUILayer('profile', isOpen || showAvatarGallery)
  const [profile, setProfile] = useState<ProfileData>({ credits: 0, xp: 0, level: 1, aura: 0, wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░', levelProgress: 0, xpToNext: 100, needsOnboarding: true, displayName: 'Wanderer', bio: null, avatar_url: null, avatar_3d_url: DEFAULT_PROFILE_AVATAR_3D_URL, lastLoginDate: null })
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProfileTab>('player')
  // Cache-bust counter: bumps on every successful avatar upload AND every
  // profile fetch. Avoids the same-day stale-image case where lastLoginDate
  // alone (day granularity) lets the browser keep showing the old pic.
  const [avatarBust, setAvatarBust] = useState<number>(() => Date.now())
  const [saving, setSaving] = useState(false)
  const editFileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { settings } = useContext(SettingsContext)

  const setAvatar3dUrl = useOasisStore(s => s.setAvatar3dUrl)
  const dailyBonusTriedRef = useRef(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [tokenBurn, setTokenBurn] = useState<{
    daily: ProfileTokenBurnSummaryData
    weekly: ProfileTokenBurnSummaryData
    alltime: ProfileTokenBurnSummaryData
  } | null>(null)

  const fetchTokenBurn = useCallback(() => {
    Promise.all([
      fetch('/api/token-burn?range=daily').then(r => r.json()).catch(() => null),
      fetch('/api/token-burn?range=weekly').then(r => r.json()).catch(() => null),
      fetch('/api/token-burn?range=alltime').then(r => r.json()).catch(() => null),
    ]).then(([daily, weekly, alltime]) => {
      setTokenBurn({
        daily: normalizeProfileTokenBurnSummary(daily),
        weekly: normalizeProfileTokenBurnSummary(weekly),
        alltime: normalizeProfileTokenBurnSummary(alltime),
      })
    })
  }, [])

  const fetchProfile = useCallback(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        setProfile(data)
        if ('avatar_3d_url' in data) setAvatar3dUrl(data.avatar_3d_url || DEFAULT_PROFILE_AVATAR_3D_URL)

        // Auto-claim daily login XP at a low amount; the HUD shows the small
        // gain, but default first-load no longer jumps straight into level-up.
        if (!dailyBonusTriedRef.current) {
          const today = new Date().toISOString().split('T')[0]
          if (data.lastLoginDate !== today) {
            dailyBonusTriedRef.current = true
            fetch('/api/xp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'DAILY_LOGIN' }),
            })
              .then(r => r.json())
              .then(bonus => {
                if (bonus.xp && bonus.xp > 0) {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: bonus }))
                  }
                  fetch('/api/profile').then(r => r.json()).then(d => setProfile(d)).catch(() => {})
                }
              })
              .catch(() => {})
          } else {
            dailyBonusTriedRef.current = true
          }
        }
      })
      .catch(() => {})
  }, [setAvatar3dUrl])

  // Eager fetch on mount to get displayName for avatar button
  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  // Refresh profile + token burn data when dropdown opens
  useEffect(() => {
    if (!isOpen) return
    fetchProfile()
    fetchTokenBurn()
  }, [isOpen, fetchProfile, fetchTokenBurn])


  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const displayName = profile.displayName || 'Wanderer'
  // Cache-bust the avatar URL so a freshly-uploaded pic actually renders.
  // Profile.avatarUrl always serves the same path (/avatars/<userId>.<ext>)
  // because filenames are keyed by user, not content. Without ?v= the
  // browser cache holds the old (or 404) version after upload.
  const avatarSrc = profile.avatar_url
    ? `${profile.avatar_url}?v=${avatarBust}`
    : null
  const initial = (displayName[0] || '?').toUpperCase()
  const playClick = () => useAudioManager.getState().play('buttonClick')

  const startEditing = () => {
    setEditName(profile.displayName || '')
    setEditBio(profile.bio || '')
    setEditAvatarPreview(avatarSrc || null)
    setEditAvatarFile(null)
    setEditing(true)
  }

  const handleEditAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
    const looksLikeImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt)
    if (!looksLikeImage) {
      setSaveError('That file is not an image. Use JPEG/PNG/WebP/GIF.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setSaveError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — must be under 2 MB.`)
      return
    }
    setSaveError(null)
    setEditAvatarFile(file)
    setEditAvatarPreview(URL.createObjectURL(file))
  }

  const saveProfile = async () => {
    if (!editName.trim() || editName.trim().length < 2) return
    setSaving(true)
    try {
      const patchRes = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: editName.trim(), bio: editBio.trim() }),
      })
      if (!patchRes.ok) {
        const errBody = await patchRes.json().catch(() => ({}))
        throw new Error(errBody?.error || `Profile save failed (HTTP ${patchRes.status})`)
      }
      if (editAvatarFile) {
        const fd = new FormData()
        fd.append('avatar', editAvatarFile)
        const upRes = await fetch('/api/profile/avatar', { method: 'POST', body: fd })
        if (!upRes.ok) {
          const errBody = await upRes.json().catch(() => ({}))
          throw new Error(errBody?.error || `Avatar upload failed (HTTP ${upRes.status})`)
        }
      }
      setEditing(false)
      setSaveError(null)
      fetchProfile()
      setAvatarBust(Date.now())
      // Notify multiplayer presence layer + other listeners that the profile
      // changed mid-session so they re-pull displayName/avatarUrl/etc.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oasis:profile-updated'))
      }
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      console.error('[Profile] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={panelRef} className="relative select-none">
      <GameMenuButton
        onClick={() => {
          playClick()
          setIsOpen(!isOpen)
        }}
        aria-label={displayName}
        data-oasis-tooltip={displayName}
        className="oasis-tooltip"
        label="Profile"
        marker={initial}
        accent="#C084FC"
        active={isOpen || showAvatarGallery}
      />

      {/* Dropdown panel */}
      {isOpen && (
        <div
          data-ui-panel
          className="absolute left-full top-0 z-[260] ml-2 max-h-[calc(100vh-24px)] w-80 overflow-y-auto rounded-lg max-[700px]:fixed max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:ml-0 max-[700px]:max-h-[calc(100vh-70px)] max-[700px]:w-auto"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            backgroundColor: `rgba(0, 0, 0, ${Math.max(0.92, settings.uiOpacity)})`,
            border: '1px solid rgba(168,85,247,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          {/* User info header */}
          <div className="p-4 border-b border-white/10">
            {!editing ? (
              <div className="flex items-center gap-3">
                {avatarSrc ? (
                  <img src={avatarSrc} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-purple-900 flex items-center justify-center">
                    <span className="text-lg font-bold text-purple-300">{initial}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{displayName}</p>
                  {profile.bio && <p className="text-[10px] text-gray-500 truncate">{profile.bio}</p>}
                </div>
                {savedFlash ? (
                  <span className="text-green-400 text-xs font-bold animate-pulse">Saved!</span>
                ) : (
                  <button
                    onClick={startEditing}
                    className="text-gray-500 hover:text-purple-400 transition-colors cursor-pointer text-xs"
                    aria-label="Edit Profile"
                  >
                    ✏️
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => editFileRef.current?.click()}
                    className="relative w-10 h-10 rounded-full overflow-hidden group cursor-pointer flex-shrink-0"
                    style={{ border: '1px solid rgba(168,85,247,0.4)' }}
                    type="button"
                  >
                    {editAvatarPreview ? (
                      <img src={editAvatarPreview} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full bg-purple-900 flex items-center justify-center">
                        <span className="text-sm font-bold text-purple-300">{initial}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-[8px]">pic</span>
                    </div>
                  </button>
                  <input ref={editFileRef} type="file" accept="image/*" onChange={handleEditAvatarChange} className="hidden" />
                  {saveError && (
                    <div className="absolute left-0 right-0 -top-7 mx-2 rounded-md px-2 py-1 text-[10px] text-red-100" style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.45)' }}>
                      {saveError}
                    </div>
                  )}
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    maxLength={30}
                    placeholder="Builder name"
                    className="flex-1 min-w-0 px-2 py-1 rounded text-white text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(168,85,247,0.3)' }}
                    autoFocus
                  />
                </div>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="Bio (optional)"
                  className="w-full px-2 py-1 rounded text-white text-xs outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(168,85,247,0.3)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveProfile}
                    disabled={!editName.trim() || editName.trim().length < 2 || saving}
                    className="flex-1 py-1 rounded text-xs font-medium text-white cursor-pointer disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)' }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.05)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 border-b border-white/10 p-2">
            {(['player', 'quests', 'skills'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors"
                style={{
                  color: activeTab === tab ? '#F8FAFC' : 'rgba(255,255,255,0.48)',
                  background: activeTab === tab ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${activeTab === tab ? 'rgba(168,85,247,0.45)' : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Stats */}
          {activeTab === 'player' && (
          <>
          <div className="p-4 border-b border-white/10">
            {/* Level title + badge */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-purple-400 font-bold tracking-wider">
                {profile.levelBadge} Lv.{profile.level} {profile.levelTitle}
              </span>
              <span className="text-xs text-gray-600">
                {profile.xp} / {profile.xp + (profile.xpToNext - Math.round(profile.levelProgress * profile.xpToNext))} XP
              </span>
            </div>
            {/* XP progress bar */}
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(2, profile.levelProgress * 100)}%`,
                  background: 'linear-gradient(90deg, #7C3AED, #A855F7)',
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-orange-400">{profile.level}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Level</p>
              </div>
              <div>
                <p className="text-lg font-bold text-teal-400">{profile.xp}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">XP</p>
              </div>
            </div>
          </div>

          {/* Token Burn */}
          {tokenBurn && hasProfileTokenUsage(tokenBurn.alltime.grand) && (
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-[10px] text-teal-400 uppercase tracking-wider mb-2 font-bold">Token Burn</p>
              <div className="space-y-1.5 font-mono">
                {[
                  { label: 'Today', data: tokenBurn.daily },
                  { label: 'Week', data: tokenBurn.weekly },
                  { label: 'All Time', data: tokenBurn.alltime },
                ].map(({ label, data }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-teal-400 text-xs w-14">{label}</span>
                    <span className="text-lg text-white font-bold">
                      <span>in {fmtTokens(getProfileDisplayInputTokens(data.grand))}</span>
                      {' '}
                      <span>out {fmtTokens(data.grand.outputTokens)}</span>
                      {/*
                      <span title="Input tokens">↓{fmtTokens(data.inputTokens)}</span>
                      {' '}
                      <span title="Output tokens">↑{fmtTokens(data.outputTokens)}</span>
                      */}
                    </span>
                    <span className="text-white text-sm text-right w-16">
                      {formatProfileTokenCost(data)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Menu items */}
          <div className="p-2">
            <button
              onClick={() => {
                useAudioManager.getState().play('chooseCharacter')
                setShowAvatarGallery(true)
                setIsOpen(false)
              }}
              className="w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer"
              style={{
                color: profile.avatar_3d_url ? '#A855F7' : '#60A5FA',
                background: profile.avatar_3d_url ? 'rgba(168,85,247,0.08)' : 'transparent',
              }}
            >
              {profile.avatar_3d_url ? '🧑 Change Avatar' : '✨ Choose Avatar'}
            </button>
          </div>
          </>
          )}

          {activeTab === 'quests' && <QuestProfilePanel />}
          {activeTab === 'skills' && <SkillsProfilePanel profile={profile} onAllocated={fetchProfile} />}
        </div>
      )}
      {/* Avatar Gallery */}
      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={profile.avatar_3d_url}
          onSelect={async (avatarUrl) => {
            setAvatar3dUrl(avatarUrl)
            setShowAvatarGallery(false)
            // Save to profile (null = remove avatar)
            try {
              await fetch('/api/profile/avatar3d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: avatarUrl, urlType: avatarUrl ? 'localPath' : 'remove' }),
              })
              fetchProfile()
            } catch (err) {
              console.error('[Profile] Avatar save failed:', err)
            }
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}
    </div>
  )
}

function QuestProfilePanel() {
  const [progress, setProgress] = useState<Partial<Record<QuestId, boolean>>>(() => getQuestProgress())

  useEffect(() => {
    const refresh = () => setProgress(getQuestProgress())
    refresh()
    window.addEventListener('quest-complete', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('quest-complete', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const done = QUEST_IDS.filter(id => progress[id]).length
  const total = QUEST_IDS.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const nextQuest = QUESTS.find(quest => !progress[quest.id])

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-lg border border-purple-400/25 bg-purple-400/10 p-3 shadow-[0_0_24px_rgba(168,85,247,0.14)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-200">Quest Log</p>
            <p className="mt-1 text-xs text-white/60">{nextQuest ? nextQuest.title : 'All builder quests complete'}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-white">{done}/{total}</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-purple-200/70">complete</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #22D3EE, #A855F7, #F59E0B)',
              boxShadow: '0 0 18px rgba(168,85,247,0.55)',
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {QUESTS.map(quest => {
          const isDone = Boolean(progress[quest.id])
          return (
            <div
              key={quest.id}
              className="rounded-lg p-2.5"
              style={{
                background: isDone ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.035)',
                border: `1px solid ${isDone ? 'rgba(34,197,94,0.28)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">
                    <span className={isDone ? 'text-green-300' : 'text-purple-300'}>{quest.number}. </span>
                    {quest.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/45">{quest.description}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${isDone ? 'bg-green-400/15 text-green-200' : 'bg-white/5 text-white/45'}`}>
                  {isDone ? 'done' : '+25 xp'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SkillsProfilePanel({ profile, onAllocated }: { profile: ProfileData; onAllocated: () => void }) {
  const [allocating, setAllocating] = useState<PlayerSkillKey | null>(null)
  const skills = profile.skills ?? DEFAULT_PLAYER_SKILLS
  const stats = profile.playerStats ?? DEFAULT_PLAYER_STATS
  const unspent = profile.unspentSkillPoints ?? 0

  const allocate = async (skill: PlayerSkillKey) => {
    if (allocating || unspent <= 0 || (skills[skill] ?? 0) >= PLAYER_SKILL_CAP) return
    setAllocating(skill)
    try {
      const res = await fetch('/api/profile/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill }),
      })
      if (res.ok) onAllocated()
    } finally {
      setAllocating(null)
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">Wizard Stats</p>
            <p className="mt-1 text-xs leading-snug text-white/60">
              Firebolt is the first combat spell: {stats.fireboltManaCost} mana, {stats.fireboltDamage} damage, {stats.fireboltSpeedMetersPerSecond} m/s.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black text-white">{unspent}</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-cyan-100/70">points</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-white/70">
            HP <strong className="float-right text-green-200">{profile.hp ?? 100}/{profile.maxHp ?? stats.maxHp}</strong>
          </div>
          <div className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-white/70">
            Mana <strong className="float-right text-cyan-200">{profile.mana ?? 20}/{profile.maxMana ?? stats.maxMana}</strong>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {PLAYER_SKILL_DEFS.map(skill => {
          const rank = skills[skill.id] ?? 0
          const canSpend = unspent > 0 && rank < PLAYER_SKILL_CAP
          const nextSkills = { ...skills, [skill.id]: Math.min(PLAYER_SKILL_CAP, rank + 1) }
          return (
          <div key={skill.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-white">{skill.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-white/45">{skill.description}</p>
              </div>
              <button
                onClick={() => allocate(skill.id)}
                disabled={!canSpend || allocating !== null}
                className="shrink-0 rounded-md border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] disabled:opacity-35"
                style={{
                  color: canSpend ? skill.tone : 'rgba(255,255,255,0.45)',
                  borderColor: canSpend ? `${skill.tone}88` : 'rgba(255,255,255,0.1)',
                  background: canSpend ? `${skill.tone}18` : 'rgba(0,0,0,0.25)',
                }}
              >
                {allocating === skill.id ? '...' : rank >= PLAYER_SKILL_CAP ? 'max' : `Lv.${rank}`}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-white/45">
              <span>{summarizeSkill(skill.id, skills)}</span>
              <span className="text-right text-white/60">next {summarizeSkill(skill.id, nextSkills)}</span>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
