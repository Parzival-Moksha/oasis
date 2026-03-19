'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Profile Button + Dropdown
// First button in top-left bar. Shows avatar, opens profile panel.
// Fetches credits/xp/level from Supabase via /api/profile.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useContext, useCallback } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '@/store/oasisStore'
import { FREE_CREDITS, CREDIT_PACKS } from '@/lib/conjure/types'
import { XP_AWARDS } from '@/lib/xp'
import { AvatarGallery } from './AvatarGallery'

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

const XP_ACTION_LABELS = [
  { label: 'Place object', xp: XP_AWARDS.PLACE_CATALOG_OBJECT },
  { label: 'Conjure asset', xp: XP_AWARDS.CONJURE_ASSET },
  { label: 'Craft scene', xp: XP_AWARDS.CRAFT_SCENE },
  { label: 'Add light', xp: XP_AWARDS.ADD_LIGHT },
  { label: 'Set world public', xp: XP_AWARDS.SET_WORLD_PUBLIC },
  { label: 'World upvoted', xp: XP_AWARDS.WORLD_UPVOTED },
  { label: 'Daily login', xp: XP_AWARDS.DAILY_LOGIN },
  { label: 'Submit feedback', xp: XP_AWARDS.SUBMIT_FEEDBACK },
]

export function ProfileButton() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [profile, setProfile] = useState<ProfileData>({ credits: FREE_CREDITS, xp: 0, level: 1, aura: 0, wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░', levelProgress: 0, xpToNext: 100, needsOnboarding: true, displayName: 'Wanderer', bio: null, avatar_url: null, avatar_3d_url: null, lastLoginDate: null })
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const [showPacks, setShowPacks] = useState(false)
  const [showXpInfo, setShowXpInfo] = useState(false)
  const [buying, setBuying] = useState(false)
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
    if (session?.user) fetchProfile()
  }, [session?.user, fetchProfile])

  const buyCredits = useCallback(async (packId: string) => {
    setBuying(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (err) {
      console.error('[Profile] Checkout failed:', err)
    } finally {
      setBuying(false)
    }
  }, [])

  // Refresh profile data when dropdown opens
  useEffect(() => {
    if (!isOpen || !session?.user) return
    fetchProfile()
  }, [isOpen, session?.user, fetchProfile])

  // Auto-open and refresh after Stripe checkout return
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('credits') === 'success') {
      setIsOpen(true)
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname)
      // Refetch profile to show new credit balance
      fetch('/api/profile')
        .then(r => r.json())
        .then(data => setProfile(data))
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!session?.user) return null

  const user = session.user
  const displayName = profile.displayName || user.name || 'Wanderer'
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
        className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden transition-all hover:scale-110"
        style={{
          background: isOpen ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.6)',
          border: `1px solid ${isOpen ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
          boxShadow: isOpen ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
        }}
        title={displayName}
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
          className="absolute top-12 left-0 w-64 rounded-lg overflow-hidden"
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
                <button
                  onClick={startEditing}
                  className="text-gray-500 hover:text-purple-400 transition-colors cursor-pointer text-xs"
                  title="Edit Profile"
                >
                  ✏️
                </button>
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
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-green-400">{Number.isInteger(profile.credits) ? profile.credits : profile.credits.toFixed(2)}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Credits</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-400">{profile.level}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Level</p>
              </div>
              <div>
                <p className="text-lg font-bold text-pink-400">{profile.aura}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Aura</p>
              </div>
            </div>
          </div>

          {/* XP Actions — collapsible */}
          <div className="px-4 py-2 border-b border-white/10">
            <button
              onClick={() => setShowXpInfo(!showXpInfo)}
              className="w-full flex items-center justify-between text-[10px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
            >
              <span className="uppercase tracking-wider">XP Guide</span>
              <span>{showXpInfo ? '▲' : '▼'}</span>
            </button>
            {showXpInfo && (
              <div className="mt-2 space-y-0.5 text-[10px]">
                {XP_ACTION_LABELS.map(({ label, xp }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-purple-400 font-mono">+{xp}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Buy Credits */}
          <div className="px-4 py-3 border-b border-white/10">
            {!showPacks ? (
              <button
                onClick={() => setShowPacks(true)}
                className="w-full py-2 rounded-md text-sm font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all cursor-pointer"
              >
                Buy Credits
              </button>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Select a pack</p>
                {CREDIT_PACKS.map(pack => (
                  <button
                    key={pack.id}
                    disabled={buying}
                    onClick={() => buyCredits(pack.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-all cursor-pointer ${
                      pack.popular
                        ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30'
                        : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
                    } ${buying ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    <span className="font-medium">{pack.credits} credits</span>
                    <span className="float-right text-green-400">${(pack.priceUsd / 100).toFixed(0)}</span>
                    {pack.popular && <span className="block text-[9px] text-purple-400 mt-0.5">Most popular</span>}
                  </button>
                ))}
                <button
                  onClick={() => setShowPacks(false)}
                  className="w-full text-center text-[10px] text-gray-600 hover:text-gray-400 mt-1 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

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
            <button
              onClick={() => { window.open('/explore', '_blank'); setIsOpen(false) }}
              className="w-full text-left px-3 py-2 rounded text-sm text-purple-300 hover:bg-purple-500/10 transition-colors cursor-pointer"
            >
              🌐 Explore Worlds
            </button>
            <button
              disabled
              className="w-full text-left px-3 py-2 rounded text-sm text-gray-500 cursor-not-allowed"
            >
              Wallet (coming soon)
            </button>
            <button
              onClick={() => { signOut({ callbackUrl: '/login' }); setIsOpen(false) }}
              className="w-full text-left px-3 py-2 rounded text-sm text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              Sign Out
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
