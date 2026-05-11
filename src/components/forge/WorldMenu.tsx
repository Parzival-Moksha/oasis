'use client'

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useOasisStore } from '@/store/oasisStore'
import { useAudioManager } from '@/lib/audio-manager'
import { useUILayer } from '@/lib/input-manager'
import type { WorldMeta } from '@/lib/forge/world-persistence'
import { SettingsContext } from '@/components/scene-lib'

import { GameMenuButton } from './GameMenuButton'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

const SHAREABLE_VISIBILITIES = new Set([
  'public',
  'public_edit',
  'ffa',
  'only-with-link',
  'unlisted',
  'core',
  'template',
])

const VISIBILITY_OPTIONS: Array<{ value: WorldMeta['visibility']; label: string; note: string }> = [
  { value: 'private', label: 'Private', note: 'owner only' },
  { value: 'unlisted', label: 'Unlisted', note: 'anyone with link can enter' },
  { value: 'public', label: 'Public', note: 'discoverable, owner edits' },
  { value: 'public_edit', label: 'Sandbox', note: 'anyone can build' },
]

interface SnapshotMeta {
  id: string
  world_id: string
  object_count: number
  source: 'auto' | 'manual'
  created_at: string
}

function formatVisibility(visibility?: string): string {
  switch (visibility) {
    case 'public_edit':
    case 'ffa':
      return 'Sandbox'
    case 'public':
      return 'Public'
    case 'only-with-link':
    case 'unlisted':
      return 'Unlisted'
    case 'core':
      return 'Core'
    case 'template':
      return 'Template'
    case 'private':
    default:
      return 'Private'
  }
}

function countLiveObjects(state: {
  worldConjuredAssetIds: string[]
  placedCatalogAssets: unknown[]
  craftedScenes: unknown[]
  portalGates: unknown[]
  spatialWebObjects: unknown[]
  placedAgentWindows: unknown[]
  placedAgentAvatars: unknown[]
}): number {
  return state.worldConjuredAssetIds.length +
    state.placedCatalogAssets.length +
    state.craftedScenes.length +
    state.portalGates.length +
    state.spatialWebObjects.length +
    state.placedAgentWindows.length +
    state.placedAgentAvatars.length
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function WorldMenu({ actionLogControl }: { actionLogControl?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [menuMessage, setMenuMessage] = useState<string | null>(null)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newWorldOpen, setNewWorldOpen] = useState(false)
  const [newWorldName, setNewWorldName] = useState('')
  const [newWorldIcon, setNewWorldIcon] = useState('O')
  // ░▒▓ 3-tab world menu: This World / My Worlds / Public Worlds ▓▒░
  const [worldTab, setWorldTab] = useState<'this' | 'my' | 'public'>('this')
  // Within Public Worlds, filter pills for visibility tier.
  const [publicFilter, setPublicFilter] = useState<'public' | 'sandbox' | 'unlisted'>('public')
  // Viewer identity (cookie-based, non-httpOnly so client can read directly).
  const viewerUserId = useMemo(() => {
    if (typeof document === 'undefined') return 'local-user'
    const m = document.cookie.match(/(?:^|;\s*)oasis-viewer-id=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : 'local-user'
  }, [])
  const menuRef = useRef<HTMLDivElement>(null)
  useUILayer('world-menu', isOpen)
  const { settings, updateSetting, rp1Locked } = useContext(SettingsContext)
  const playClick = () => useAudioManager.getState().play('buttonClick')

  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const isViewMode = useOasisStore(s => s.isViewMode)
  const viewingWorldId = useOasisStore(s => s.viewingWorldId)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const refreshWorldRegistry = useOasisStore(s => s.refreshWorldRegistry)
  const deleteWorldById = useOasisStore(s => s.deleteWorldById)
  const loadWorldState = useOasisStore(s => s.loadWorldState)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const createNewWorld = useOasisStore(s => s.createNewWorld)
  const liveObjectCount = useOasisStore(s => countLiveObjects({
    worldConjuredAssetIds: s.worldConjuredAssetIds,
    placedCatalogAssets: s.placedCatalogAssets,
    craftedScenes: s.craftedScenes,
    portalGates: s.portalGates,
    spatialWebObjects: s.spatialWebObjects,
    placedAgentWindows: s.placedAgentWindows,
    placedAgentAvatars: s.placedAgentAvatars,
  }))

  const worldId = isViewMode && viewingWorldId ? viewingWorldId : activeWorldId
  const ownedMeta = worldRegistry.find(world => world.id === activeWorldId)
  const meta = isViewMode && viewingWorldMeta ? viewingWorldMeta : ownedMeta
  const worldName = meta?.name || 'Current world'
  const worldIcon = meta?.icon || 'O'
  const visibility = meta?.visibility
  const visibilityLabel = formatVisibility(visibility)
  const ownerName = meta?.ownerName || meta?.creatorName || meta?.creator_name || 'Player 1'
  const ownerAvatar = meta?.ownerAvatar || meta?.creatorAvatar || meta?.creator_avatar || null
  const ownerLevel = meta?.ownerLevel || 1
  const ownerAura = meta?.ownerAura || 0
  const objectCount = liveObjectCount
  const visitCount = meta?.visitCount || 0
  const canEditSettings = Boolean(meta?.canEditSettings && !isViewMode)
  const canCopyLink = Boolean(worldId && (SHAREABLE_VISIBILITIES.has(visibility || '') || meta?.canEditSettings || meta?.canWrite))

  const worldUrl = useMemo(() => {
    if (typeof window === 'undefined' || !worldId) return ''
    return `${window.location.origin}${OASIS_BASE}/w/${encodeURIComponent(worldId)}`
  }, [worldId])
  const qrCodeUrl = useMemo(() => {
    if (!worldUrl) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=132x132&margin=10&data=${encodeURIComponent(worldUrl)}`
  }, [worldUrl])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!meta) return
    setEditName(meta.name || '')
    setEditIcon(meta.icon || '')
  }, [meta?.id, meta?.name, meta?.icon])

  const fetchSnapshots = async () => {
    if (!worldId || !canEditSettings) return
    setSnapshotsLoading(true)
    setMenuMessage(null)
    try {
      const response = await fetch(`${OASIS_BASE}/api/worlds/${encodeURIComponent(worldId)}/snapshots`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSnapshots(await response.json() as SnapshotMeta[])
    } catch {
      setMenuMessage('Could not load snapshots.')
    } finally {
      setSnapshotsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!worldUrl || !canCopyLink) return
    await copyText(worldUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const handleSaveMetadata = async () => {
    if (!worldId || !canEditSettings || !editName.trim()) return
    setBusyLabel('Saving')
    setMenuMessage(null)
    try {
      const response = await fetch(`${OASIS_BASE}/api/worlds/${encodeURIComponent(worldId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), icon: editIcon.trim() || 'O' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      refreshWorldRegistry()
      setEditOpen(false)
      setMenuMessage('World renamed.')
    } catch {
      setMenuMessage('Could not rename world.')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleVisibility = async (nextVisibility: WorldMeta['visibility']) => {
    if (!worldId || !canEditSettings) return
    setBusyLabel('Sharing')
    setMenuMessage(null)
    try {
      const response = await fetch(`${OASIS_BASE}/api/worlds/${encodeURIComponent(worldId)}/visibility`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVisibility }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      refreshWorldRegistry()
      setMenuMessage(`Visibility set to ${formatVisibility(nextVisibility)}.`)
    } catch {
      setMenuMessage('Could not change visibility.')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleCreateSnapshot = async () => {
    if (!worldId || !canEditSettings) return
    setBusyLabel('Snapshot')
    setMenuMessage(null)
    try {
      const response = await fetch(`${OASIS_BASE}/api/worlds/${encodeURIComponent(worldId)}/snapshots`, {
        method: 'PUT',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await fetchSnapshots()
      setMenuMessage('Snapshot created.')
    } catch {
      setMenuMessage('Could not create snapshot.')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleRestoreSnapshot = async (snapshotId: string) => {
    if (!worldId || !canEditSettings) return
    setBusyLabel('Restoring')
    setMenuMessage(null)
    try {
      const response = await fetch(`${OASIS_BASE}/api/worlds/${encodeURIComponent(worldId)}/snapshots`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      refreshWorldRegistry()
      loadWorldState({ silent: true })
      setMenuMessage('Snapshot restored.')
    } catch {
      setMenuMessage('Could not restore snapshot.')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleDeleteWorld = () => {
    if (!worldId || !canEditSettings) return
    deleteWorldById(worldId)
    setDeleteOpen(false)
    setIsOpen(false)
  }

  const handleSwitchWorld = (nextWorldId: string) => {
    if (!nextWorldId || nextWorldId === activeWorldId) return
    playClick()
    switchWorld(nextWorldId)
    setIsOpen(false)
  }

  const handleCreateWorld = () => {
    const name = newWorldName.trim()
    if (!name) return
    playClick()
    createNewWorld(name, newWorldIcon.trim() || 'O')
    setNewWorldName('')
    setNewWorldIcon('O')
    setNewWorldOpen(false)
    setIsOpen(false)
  }

  return (
    <div ref={menuRef} className="relative select-none">
      <GameMenuButton
        onClick={() => {
          playClick()
          setIsOpen(open => !open)
        }}
        aria-label="World menu"
        data-oasis-tooltip="World"
        className="oasis-tooltip"
        label="World"
        marker={worldIcon}
        accent="#22D3EE"
        active={isOpen}
      />

      {isOpen && (
        <div
          data-ui-panel
          className="absolute left-full top-0 z-[260] ml-2 max-h-[82vh] w-[360px] overflow-y-auto rounded-lg border border-white/10 bg-black/[0.92] p-3 font-mono text-white shadow-[0_0_54px_rgba(0,0,0,0.65),0_0_38px_rgba(34,211,238,0.14)] backdrop-blur-md max-[700px]:fixed max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:ml-0 max-[700px]:max-h-[calc(100vh-70px)] max-[700px]:w-auto max-[700px]:p-2"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="flex items-start gap-3 border-b border-white/10 pb-3">
            <button
              type="button"
              disabled={!canEditSettings}
              onClick={() => setEditOpen(open => !open)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-2xl transition hover:bg-cyan-300/15 disabled:cursor-default"
              title={canEditSettings ? 'Edit world name' : undefined}
            >
              {worldIcon}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-[0.12em]">{worldName}</div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {canEditSettings && (
                    <button
                      onClick={() => setEditOpen(open => !open)}
                      className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/60 transition hover:bg-white/10 hover:text-white"
                    >
                      Edit
                    </button>
                  )}
                  <label className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-amber-100/75 ${rp1Locked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={settings.rp1Mode}
                      disabled={rp1Locked}
                      onChange={event => updateSetting('rp1Mode', event.target.checked)}
                      className="sr-only"
                    />
                    <span className="relative h-4 w-8 rounded-full border border-amber-200/35 bg-stone-950 shadow-inner">
                      <span
                        className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full border border-amber-100/35 bg-stone-700 transition"
                        style={{
                          transform: settings.rp1Mode ? 'translateX(16px)' : 'translateX(0)',
                          background: settings.rp1Mode ? '#fde68a' : undefined,
                        }}
                      />
                    </span>
                    RP1
                  </label>
                </div>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-cyan-100/60">{visibilityLabel}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-white/75">
                {ownerAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ownerAvatar} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[10px]">
                    {(ownerName[0] || '?').toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 truncate">{ownerName}</span>
                <span className="shrink-0 text-cyan-200/75">Lv {ownerLevel}</span>
              </div>
            </div>
          </div>

          {editOpen && canEditSettings && (
            <div className="mt-3 rounded-md border border-white/10 bg-white/5 p-2">
              <div className="flex gap-2">
                <input
                  value={editIcon}
                  onChange={event => setEditIcon(event.target.value.slice(0, 4))}
                  className="w-12 rounded border border-white/10 bg-black/40 px-2 py-2 text-center text-sm text-white outline-none focus:border-cyan-300/50"
                  aria-label="World icon"
                />
                <input
                  value={editName}
                  onChange={event => setEditName(event.target.value)}
                  className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-white outline-none focus:border-cyan-300/50"
                  aria-label="World name"
                />
                <button
                  onClick={handleSaveMetadata}
                  disabled={Boolean(busyLabel) || !editName.trim()}
                  className="rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* ░▒▓ TAB BAR — This World / My Worlds / Public Worlds ▓▒░ */}
          <div className="mt-3 flex gap-1 border-b border-white/10 pb-2 text-[10px] font-black uppercase tracking-[0.12em]">
            {([
              { key: 'this' as const, label: 'This World' },
              { key: 'my' as const, label: 'My Worlds' },
              { key: 'public' as const, label: 'Public Worlds' },
            ]).map(tab => {
              const active = worldTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setWorldTab(tab.key)}
                  className="flex-1 rounded-t-md border-b px-2 py-1.5 transition-colors"
                  style={{
                    borderColor: active ? 'rgba(103,232,249,0.7)' : 'transparent',
                    color: active ? 'rgba(207,250,254,0.95)' : 'rgba(255,255,255,0.45)',
                    background: active ? 'rgba(34,211,238,0.10)' : 'transparent',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {worldTab === 'this' && (
          <div className="grid grid-cols-3 gap-2 py-3 text-center">
            <div className="rounded-md border border-white/10 bg-white/5 px-2 py-2">
              <div className="text-sm font-black text-cyan-100">{objectCount}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/45">objects</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 px-2 py-2">
              <div className="text-sm font-black text-cyan-100">{visitCount}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/45">visits</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 px-2 py-2">
              <div className="text-sm font-black text-cyan-100">{ownerAura}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/45">aura</div>
            </div>
          </div>
          )}

          {/* ░▒▓ MY WORLDS TAB — worlds owned by the viewer ▓▒░ */}
          {worldTab === 'my' && (() => {
            const myWorlds = worldRegistry.filter(w => w.userId === viewerUserId)
            return (
              <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/55">{myWorlds.length} worlds</div>
                  {!isViewMode && (
                    <button
                      onClick={() => setNewWorldOpen(open => !open)}
                      className="rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-300/20"
                    >
                      New
                    </button>
                  )}
                </div>
                {newWorldOpen && (
                  <div className="mb-2 flex gap-2">
                    <input
                      value={newWorldIcon}
                      onChange={event => setNewWorldIcon(event.target.value.slice(0, 4))}
                      className="w-12 rounded border border-white/10 bg-black/40 px-2 py-2 text-center text-sm text-white outline-none focus:border-cyan-300/50"
                      aria-label="New world icon"
                    />
                    <input
                      value={newWorldName}
                      onChange={event => setNewWorldName(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') handleCreateWorld() }}
                      className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-white outline-none focus:border-cyan-300/50"
                      aria-label="New world name"
                      placeholder="World name"
                    />
                    <button
                      onClick={handleCreateWorld}
                      disabled={!newWorldName.trim()}
                      className="rounded border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-40"
                    >
                      Go
                    </button>
                  </div>
                )}
                <div className="max-h-[44vh] space-y-1 overflow-y-auto pr-1">
                  {myWorlds.length === 0 ? (
                    <div className="py-4 text-center text-[10px] text-white/40">No worlds yet. Click <span className="text-cyan-200/80">New</span> to start one.</div>
                  ) : myWorlds.map(world => {
                    const active = world.id === activeWorldId
                    return (
                      <button
                        key={world.id}
                        onClick={() => handleSwitchWorld(world.id)}
                        disabled={active}
                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition hover:bg-white/10 disabled:cursor-default"
                        style={{
                          borderColor: active ? 'rgba(103,232,249,0.46)' : 'rgba(255,255,255,0.08)',
                          background: active ? 'rgba(34,211,238,0.12)' : 'rgba(0,0,0,0.22)',
                        }}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-white/10 text-sm">{world.icon || 'O'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-black uppercase tracking-[0.1em] text-white/80">{world.name}</span>
                          <span className="mt-0.5 block text-[9px] uppercase tracking-[0.1em] text-white/35">{formatVisibility(world.visibility)}</span>
                        </span>
                        {active && <span className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100/70">here</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ░▒▓ PUBLIC WORLDS TAB — other users' worlds, filtered by visibility ▓▒░ */}
          {worldTab === 'public' && (() => {
            const filterVis = (v: string | undefined): boolean => {
              if (!v || v === 'private' || v === 'core' || v === 'template') return false
              if (publicFilter === 'public') return v === 'public'
              if (publicFilter === 'sandbox') return v === 'public_edit' || v === 'ffa'
              if (publicFilter === 'unlisted') return v === 'unlisted' || v === 'only-with-link'
              return false
            }
            const publicWorlds = worldRegistry.filter(w => w.userId !== viewerUserId && filterVis(w.visibility))
            const PILL: Array<{ key: 'public' | 'sandbox' | 'unlisted'; label: string; tip: string }> = [
              { key: 'public', label: 'Public', tip: 'Visit and look around. Owner edits.' },
              { key: 'sandbox', label: 'Sandbox', tip: 'Anyone can build.' },
              { key: 'unlisted', label: 'Unlisted', tip: 'Link-only. Not in browse.' },
            ]
            return (
              <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-2">
                <div className="mb-2 flex flex-wrap gap-1">
                  {PILL.map(p => {
                    const active = publicFilter === p.key
                    return (
                      <button
                        key={p.key}
                        onClick={() => setPublicFilter(p.key)}
                        title={p.tip}
                        className="rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition"
                        style={{
                          borderColor: active ? 'rgba(103,232,249,0.55)' : 'rgba(255,255,255,0.10)',
                          background: active ? 'rgba(34,211,238,0.16)' : 'rgba(0,0,0,0.20)',
                          color: active ? 'rgba(207,250,254,0.95)' : 'rgba(255,255,255,0.60)',
                        }}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                  <div className="ml-auto text-[9px] uppercase tracking-[0.12em] text-white/40">{publicWorlds.length}</div>
                </div>
                <div className="max-h-[44vh] space-y-1 overflow-y-auto pr-1">
                  {publicWorlds.length === 0 ? (
                    <div className="py-4 text-center text-[10px] text-white/40">No {publicFilter} worlds visible to you.</div>
                  ) : publicWorlds.map(world => {
                    const active = world.id === activeWorldId
                    return (
                      <button
                        key={world.id}
                        onClick={() => handleSwitchWorld(world.id)}
                        disabled={active}
                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition hover:bg-white/10 disabled:cursor-default"
                        style={{
                          borderColor: active ? 'rgba(103,232,249,0.46)' : 'rgba(255,255,255,0.08)',
                          background: active ? 'rgba(34,211,238,0.12)' : 'rgba(0,0,0,0.22)',
                        }}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-white/10 text-sm">{world.icon || 'O'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-black uppercase tracking-[0.1em] text-white/80">{world.name}</span>
                          <span className="mt-0.5 block text-[9px] uppercase tracking-[0.1em] text-white/35">
                            {formatVisibility(world.visibility)}{world.ownerName ? ` · ${world.ownerName}` : ''}
                          </span>
                        </span>
                        {active && <span className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100/70">here</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {worldTab === 'this' && (
          <>
          {/* SCENE CONTROLS — sky / ground / lights. Visible to:
              - owner of any world (full edit)
              - any visitor of an FFA / public_edit world (full sandbox per user)
              Click opens WizCon at the World tab (which has sky + ground +
              terrain + lights sections collapsed-by-default). Future tiering:
              each button gates by `unlockedAtLevel` from a per-user level
              system that doesn't exist yet — default level=1 means all unlocked
              for now. When the level system lands, plumb the user's level
              through and disable buttons whose `unlockedAtLevel` is higher. */}
          {(() => {
            const sceneKind = (visibility === 'public_edit' || visibility === 'ffa')
            const canEditScene = canEditSettings || sceneKind
            type SceneButton = { id: 'sky' | 'ground' | 'lights'; label: string; icon: string; accent: string; unlockedAtLevel: number }
            const SCENE_BUTTONS: SceneButton[] = [
              { id: 'sky',    label: 'Sky',    icon: '🌅', accent: 'rgba(129,140,248,0.85)', unlockedAtLevel: 1 },
              { id: 'ground', label: 'Ground', icon: '🌿', accent: 'rgba(74,222,128,0.85)',  unlockedAtLevel: 1 },
              { id: 'lights', label: 'Lights', icon: '💡', accent: 'rgba(250,204,21,0.85)',  unlockedAtLevel: 1 },
            ]
            const viewerLevel = 1  // TODO: read from profile when level system ships
            return (
              <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-2">
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/55">Scene</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SCENE_BUTTONS.map(btn => {
                    const levelLocked = viewerLevel < btn.unlockedAtLevel
                    const disabled = !canEditScene || levelLocked || Boolean(busyLabel)
                    return (
                      <button
                        key={btn.id}
                        onClick={() => {
                          playClick()
                          // Tell Scene to open WizCon. WizCon defaults to the
                          // 'world' mode which is exactly sky/ground/lights.
                          if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('oasis:open-wizard', { detail: { section: btn.id } }))
                          }
                          setIsOpen(false)
                        }}
                        onMouseEnter={() => { if (!disabled) useAudioManager.getState().play('buttonHover') }}
                        disabled={disabled}
                        title={levelLocked ? `Unlocks at level ${btn.unlockedAtLevel}` : disabled ? 'Owner or sandbox-visitor only' : `Open ${btn.label.toLowerCase()} controls`}
                        className="group flex flex-col items-center gap-1 rounded-md border px-2 py-2 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 hover:scale-[1.04] active:scale-[0.97]"
                        style={{
                          borderColor: disabled ? 'rgba(255,255,255,0.08)' : btn.accent,
                          background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
                          boxShadow: disabled ? 'none' : `0 0 0 0 ${btn.accent}`,
                        }}
                        onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 14px 2px ${btn.accent}` }}
                        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 0 ' + btn.accent }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 0 ' + btn.accent }}
                      >
                        <span className="text-base leading-none transition-transform group-hover:scale-110 group-hover:rotate-3">{btn.icon}</span>
                        <span className="text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: disabled ? 'rgba(255,255,255,0.4)' : btn.accent }}>{btn.label}</span>
                      </button>
                    )
                  })}
                </div>
                {!canEditScene && (
                  <div className="mt-1.5 text-[9px] text-white/35">
                    {sceneKind ? 'Scene controls require owner permission.' : 'Only this world\'s owner can change scene. Sandbox visibility lets everyone edit.'}
                  </div>
                )}
              </div>
            )
          })()}

          <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-2">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/55">Visibility</div>
            <div className="grid grid-cols-2 gap-1.5">
              {VISIBILITY_OPTIONS.map(option => {
                const active = option.value === visibility || (option.value === 'unlisted' && visibility === 'only-with-link')
                return (
                  <button
                    key={option.value}
                    onClick={() => handleVisibility(option.value)}
                    disabled={!canEditSettings || Boolean(busyLabel)}
                    className="rounded-md border px-2 py-2 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    style={{
                      borderColor: active ? 'rgba(103,232,249,0.62)' : 'rgba(255,255,255,0.10)',
                      background: active ? 'rgba(34,211,238,0.14)' : 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-white/85">{option.label}</span>
                    <span className="mt-0.5 block text-[9px] text-white/42">{option.note}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-md border border-cyan-300/15 bg-cyan-300/5 p-2">
            <div className="flex gap-2">
              {qrCodeUrl && canCopyLink && (
                <img
                  src={qrCodeUrl}
                  alt="World link QR code"
                  className="h-20 w-20 shrink-0 rounded-md border border-white/10 bg-white p-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] text-cyan-50/70">{worldUrl || 'World link unavailable'}</div>
                <div className="mt-1 text-[9px] leading-3 text-cyan-100/42">Shareable when visibility is Unlisted, Public, or Sandbox.</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleCopy}
                disabled={!canCopyLink}
                className="flex-1 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                onClick={() => worldUrl && window.open(worldUrl, '_blank', 'noopener,noreferrer')}
                disabled={!worldUrl}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Open
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-white/10 bg-white/5 p-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const next = !snapshotsOpen
                  setSnapshotsOpen(next)
                  if (next) void fetchSnapshots()
                }}
                disabled={!canEditSettings}
                className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Snapshots
              </button>
              <button
                onClick={handleCreateSnapshot}
                disabled={!canEditSettings || Boolean(busyLabel)}
                className="rounded border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-300/20 disabled:opacity-40"
              >
                Save
              </button>
            </div>
            {snapshotsOpen && (
              <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
                {snapshotsLoading ? (
                  <div className="text-[10px] text-white/45">Loading snapshots...</div>
                ) : snapshots.length === 0 ? (
                  <div className="text-[10px] text-white/45">No snapshots yet.</div>
                ) : snapshots.map(snapshot => (
                  <div key={snapshot.id} className="flex items-center gap-2 rounded border border-white/10 bg-black/30 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] text-white/70">
                        {new Date(snapshot.created_at).toLocaleString()}
                      </div>
                      <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">
                        {snapshot.source} / {snapshot.object_count} obj
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreSnapshot(snapshot.id)}
                      disabled={Boolean(busyLabel)}
                      className="rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-cyan-100 disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {actionLogControl && (
            <div className="mt-3 rounded-md border border-amber-300/15 bg-amber-300/5 p-2">
              {actionLogControl}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setDeleteOpen(true)}
              disabled={!canEditSettings}
              className="rounded border border-red-400/25 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete world
            </button>
            {menuMessage && <div className="min-w-0 flex-1 truncate text-[10px] text-cyan-100/65">{menuMessage}</div>}
            {busyLabel && <div className="text-[10px] uppercase tracking-[0.12em] text-white/35">{busyLabel}...</div>}
          </div>

          {!canCopyLink && (
            <div className="mt-2 text-[10px] leading-relaxed text-amber-200/75">
              Private worlds need owner access. Public, Sandbox, and Unlisted worlds can be copied by visitors.
            </div>
          )}
          </>
          )}
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-red-400/30 bg-gray-950 p-5 font-mono text-white shadow-2xl">
            <div className="text-sm font-black uppercase tracking-[0.12em] text-red-100">Delete {worldName}?</div>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              Are you sure you wanna delete this world? This removes its saved state and snapshots from this Oasis.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setDeleteOpen(false)}
                className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteWorld}
                className="flex-1 rounded border border-red-400/35 bg-red-500/20 px-3 py-2 text-xs font-bold text-red-100 transition hover:bg-red-500/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
