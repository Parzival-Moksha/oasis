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
import { fmtTokens } from '@/lib/anorak-engine'
import {
  type ProfileTokenBurnSummaryData,
  formatProfileTokenCost,
  getProfileDisplayInputTokens,
  hasProfileTokenUsage,
  normalizeProfileTokenBurnSummary,
} from '@/lib/profile-token-display'

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
}

export function ProfileButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  useUILayer('profile', isOpen || showAvatarGallery)
  const [profile, setProfile] = useState<ProfileData>({ credits: 0, xp: 0, level: 1, aura: 0, wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░', levelProgress: 0, xpToNext: 100, needsOnboarding: true, displayName: 'Wanderer', bio: null, avatar_url: null, avatar_3d_url: null, lastLoginDate: null })
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editFileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { settings } = useContext(SettingsContext)

  const setAvatar3dUrl = useOasisStore(s => s.setAvatar3dUrl)
  const [dailyBonusToast, setDailyBonusToast] = useState<string | null>(null)
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
        if (data.avatar_3d_url) setAvatar3dUrl(data.avatar_3d_url)

        // Auto-claim daily login bonus on first successful fetch
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
                  setDailyBonusToast(`+${bonus.xp} XP Daily Bonus!${bonus.leveledUp ? ` Level up! Lv.${bonus.level}` : ''}`)
                  // Re-fetch profile to reflect new XP
                  fetch('/api/profile').then(r => r.json()).then(d => setProfile(d)).catch(() => {})
                  setTimeout(() => setDailyBonusToast(null), 4000)
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
  const avatarSrc = profile.avatar_url || null
  const initial = (displayName[0] || '?').toUpperCase()

  const startEditing = () => {
    setEditName(profile.displayName || '')
    setEditBio(profile.bio || '')
    setEditAvatarPreview(avatarSrc || null)
    setEditAvatarFile(null)
    setEditing(true)
  }

  const handleEditAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || file.size > 2 * 1024 * 1024 || !file.type.startsWith('image/')) return
    setEditAvatarFile(file)
    setEditAvatarPreview(URL.createObjectURL(file))
  }

  const saveProfile = async () => {
    if (!editName.trim() || editName.trim().length < 2) return
    setSaving(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: editName.trim(), bio: editBio.trim() }),
      })
      if (editAvatarFile) {
        const fd = new FormData()
        fd.append('avatar', editAvatarFile)
        await fetch('/api/profile/avatar', { method: 'POST', body: fd })
      }
      setEditing(false)
      fetchProfile()
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      console.error('[Profile] Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={displayName}
        data-oasis-tooltip={displayName}
        className="oasis-tooltip w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden transition-all hover:scale-110"
        style={{
          background: isOpen ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.6)',
          border: `1px solid ${isOpen ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
          boxShadow: isOpen ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
        }}
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-sm font-bold text-purple-300">{initial}</span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          data-ui-panel
          className="absolute top-12 left-0 w-64 rounded-lg overflow-hidden"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            backgroundColor: `rgba(0, 0, 0, ${settings.uiOpacity})`,
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

          {/* Stats */}
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
              onClick={() => { setShowAvatarGallery(true); setIsOpen(false) }}
              className="w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer"
              style={{
                color: profile.avatar_3d_url ? '#A855F7' : '#60A5FA',
                background: profile.avatar_3d_url ? 'rgba(168,85,247,0.08)' : 'transparent',
              }}
            >
              {profile.avatar_3d_url ? '🧑 Change Avatar' : '✨ Choose Avatar'}
            </button>
          </div>
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
      {/* Daily bonus toast */}
      {dailyBonusToast && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[10001] px-5 py-3 rounded-lg border border-yellow-500/40 shadow-lg animate-bounce"
          style={{ background: 'rgba(20,10,0,0.9)', boxShadow: '0 0 20px rgba(234, 179, 8, 0.3)' }}
        >
          <span className="text-yellow-400 font-bold text-sm">{dailyBonusToast}</span>
        </div>
      )}
    </div>
  )
}
