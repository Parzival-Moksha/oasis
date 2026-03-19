'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ═══════════════════════════════════════════════════════════════════════════
// LABEL CONFIGS — what shows up in each admin section
// ═══════════════════════════════════════════════════════════════════════════

const PRICE_LABELS: Record<string, { label: string; group: string }> = {
  conjure_meshy_preview: { label: 'Meshy Grey (preview)', group: 'Conjure' },
  conjure_meshy_refine: { label: 'Meshy Textured (refine)', group: 'Conjure' },
  conjure_tripo_turbo: { label: 'Tripo Turbo', group: 'Conjure' },
  conjure_tripo_draft: { label: 'Tripo v2.0', group: 'Conjure' },
  conjure_tripo_standard: { label: 'Tripo v2.5', group: 'Conjure' },
  conjure_tripo_premium: { label: 'Tripo v3.1 (premium)', group: 'Conjure' },
  post_texture: { label: 'Post-process: Texture', group: 'Post-Processing' },
  post_remesh: { label: 'Post-process: Remesh', group: 'Post-Processing' },
  post_rig: { label: 'Post-process: Rig', group: 'Post-Processing' },
  post_animate: { label: 'Post-process: Animate', group: 'Post-Processing' },
  craft: { label: 'LLM Craft', group: 'LLM' },
  terrain: { label: 'LLM Terrain', group: 'LLM' },
  imagine: { label: 'Text-to-Image (Imagine)', group: 'LLM' },
  free_credits: { label: 'Free credits on signup', group: 'Onboarding' },
}

const XP_LABELS: Record<string, { label: string; group: string }> = {
  PLACE_CATALOG_OBJECT: { label: 'Place catalog object', group: 'Building' },
  CONJURE_ASSET: { label: 'Conjure asset', group: 'Building' },
  CRAFT_SCENE: { label: 'Craft scene (LLM)', group: 'Building' },
  GENERATE_IMAGE: { label: 'Generate image (Imagine)', group: 'Building' },
  PAINT_GROUND_BATCH: { label: 'Paint ground (~10 tiles)', group: 'Building' },
  ADD_LIGHT: { label: 'Add light', group: 'Building' },
  FIRST_OBJECT_IN_WORLD: { label: 'First object in world', group: 'Milestones' },
  FIRST_WORLD_CREATED: { label: 'First world created', group: 'Milestones' },
  SET_WORLD_PUBLIC: { label: 'Set world public', group: 'Milestones' },
  WORLD_10_OBJECTS: { label: 'World reaches 10 objects', group: 'Milestones' },
  WORLD_50_OBJECTS: { label: 'World reaches 50 objects', group: 'Milestones' },
  WORLD_VISITED: { label: 'Your world visited (passive)', group: 'Social' },
  WORLD_UPVOTED: { label: 'Your world upvoted (passive)', group: 'Social' },
  VISIT_OTHER_WORLD: { label: 'Visit another world', group: 'Social' },
  UPVOTE_WORLD: { label: 'Upvote a world', group: 'Social' },
  DAILY_LOGIN: { label: 'Daily login bonus', group: 'Social' },
  CO_BUILD: { label: 'Co-build in others world', group: 'Social' },
  SUBMIT_FEEDBACK: { label: 'Submit feedback (Anorak)', group: 'Meta' },
  VIBECODE_REPORT: { label: 'Vibecode deep report', group: 'Meta' },
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE SECTION COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function Section({
  title,
  subtitle,
  accentColor,
  defaultOpen = true,
  children,
  actions,
}: {
  title: string
  subtitle: string
  accentColor: 'orange' | 'purple'
  defaultOpen?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const colors = {
    orange: { text: 'text-orange-400', border: 'border-orange-500/20', chevron: 'text-orange-500/50' },
    purple: { text: 'text-purple-400', border: 'border-purple-500/20', chevron: 'text-purple-500/50' },
  }[accentColor]

  return (
    <div className={`border border-gray-800 rounded-lg overflow-hidden ${colors.border}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-gray-900/50 px-4 py-2.5 border-b border-gray-800 flex items-center justify-between cursor-pointer hover:bg-gray-900/70 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${colors.chevron} transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
            ▶
          </span>
          <span className={`text-sm ${colors.text} font-bold tracking-wide`}>{title}</span>
        </div>
        <span className="text-[9px] text-gray-600">{subtitle}</span>
      </button>

      <div
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: open ? '2000px' : '0px', opacity: open ? 1 : 0 }}
      >
        {children}
        {actions && (
          <div className="px-4 py-3 bg-gray-900/20 border-t border-gray-800/50 flex items-center gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUPED ROWS — renders label + input + unit + reset for a config group
// ═══════════════════════════════════════════════════════════════════════════

function GroupedRows({
  labels,
  values,
  editing,
  setEditing,
  defaults,
  unit,
  step,
  accentColor,
}: {
  labels: Record<string, { label: string; group: string }>
  values: Record<string, number>
  editing: Record<string, string>
  setEditing: React.Dispatch<React.SetStateAction<Record<string, string>>>
  defaults: Record<string, number>
  unit: string
  step: string
  accentColor: 'orange' | 'purple'
}) {
  const groups = new Map<string, string[]>()
  for (const [key, meta] of Object.entries(labels)) {
    if (!groups.has(meta.group)) groups.set(meta.group, [])
    groups.get(meta.group)!.push(key)
  }

  const changedBorder = accentColor === 'orange' ? 'border-orange-500/50 text-orange-300' : 'border-purple-500/50 text-purple-300'

  return (
    <>
      {Array.from(groups.entries()).map(([groupName, keys]) => (
        <div key={groupName}>
          <div className="px-4 py-1.5 bg-gray-900/30 border-b border-gray-800/50">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">{groupName}</span>
          </div>
          {keys.map(key => {
            const meta = labels[key]
            const isChanged = editing[key] !== String(values[key])
            return (
              <div key={key} className="px-4 py-2 border-b border-gray-800/30 flex items-center gap-3 hover:bg-gray-900/20 transition-colors">
                <span className="text-xs text-gray-400 flex-1">{meta.label}</span>
                <input
                  type="number"
                  step={step}
                  min="0"
                  value={editing[key] ?? '0'}
                  onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
                  className={`w-20 text-right text-xs bg-black/60 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-600 ${
                    isChanged ? changedBorder : 'border-gray-700/30 text-gray-300'
                  }`}
                />
                <span className="text-[10px] text-gray-600 w-6">{unit}</span>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM SCROLLBAR STYLES
// ═══════════════════════════════════════════════════════════════════════════

const scrollbarStyles = `
  .admin-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .admin-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .admin-scroll::-webkit-scrollbar-thumb {
    background: rgba(100, 100, 100, 0.3);
    border-radius: 3px;
  }
  .admin-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(140, 140, 140, 0.5);
  }
  .admin-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(100, 100, 100, 0.3) transparent;
  }
`

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [pricing, setPricing] = useState<Record<string, number>>({})
  const [defaults, setDefaults] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const [xpAwards, setXpAwards] = useState<Record<string, number>>({})
  const [xpDefaults, setXpDefaults] = useState<Record<string, number>>({})
  const [xpEditing, setXpEditing] = useState<Record<string, string>>({})
  const [xpSaving, setXpSaving] = useState(false)
  const [xpMessage, setXpMessage] = useState('')

  // Default worlds
  const [dwAnon, setDwAnon] = useState('')
  const [dwNewUser, setDwNewUser] = useState('')
  const [dwSavedAnon, setDwSavedAnon] = useState('')
  const [dwSavedNewUser, setDwSavedNewUser] = useState('')
  const [dwSaving, setDwSaving] = useState(false)
  const [dwMessage, setDwMessage] = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
    if (status === 'authenticated') {
      Promise.all([
        fetch('/api/admin/pricing').then(r => r.ok ? r.json() : Promise.reject('Forbidden')),
        fetch('/api/admin/xp').then(r => r.ok ? r.json() : Promise.reject('Forbidden')),
        fetch('/api/admin/default-worlds').then(r => r.ok ? r.json() : Promise.reject('Forbidden')),
      ])
        .then(([priceData, xpData, dwData]) => {
          setPricing(priceData.pricing)
          setDefaults(priceData.defaults)
          const edits: Record<string, string> = {}
          for (const key of Object.keys(priceData.pricing)) {
            edits[key] = String(priceData.pricing[key])
          }
          setEditing(edits)

          setXpAwards(xpData.xpAwards)
          setXpDefaults(xpData.defaults)
          const xpEdits: Record<string, string> = {}
          for (const key of Object.keys(xpData.xpAwards)) {
            xpEdits[key] = String(xpData.xpAwards[key])
          }
          setXpEditing(xpEdits)

          const dw = dwData.defaultWorlds || {}
          setDwAnon(dw.anon || '')
          setDwNewUser(dw.new_user || '')
          setDwSavedAnon(dw.anon || '')
          setDwSavedNewUser(dw.new_user || '')
          setLoading(false)
        })
        .catch(() => {
          setMessage('Access denied — admin only')
          setLoading(false)
        })
    }
  }, [status, router])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    const updates: Record<string, number> = {}
    let hasChanges = false
    for (const [key, val] of Object.entries(editing)) {
      const num = parseFloat(val)
      if (isNaN(num) || num < 0) {
        setMessage(`Invalid value for ${PRICE_LABELS[key]?.label || key}`)
        setSaving(false)
        return
      }
      if (num !== pricing[key]) { updates[key] = num; hasChanges = true }
    }
    if (!hasChanges) { setMessage('No changes to save'); setSaving(false); return }

    const res = await fetch('/api/admin/pricing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const data = await res.json()
      setPricing(data.pricing)
      setMessage('Pricing updated successfully')
    } else {
      setMessage('Failed to save')
    }
    setSaving(false)
  }

  const handleXpSave = async () => {
    setXpSaving(true)
    setXpMessage('')
    const updates: Record<string, number> = {}
    let hasChanges = false
    for (const [key, val] of Object.entries(xpEditing)) {
      const num = parseInt(val, 10)
      if (isNaN(num) || num < 0) {
        setXpMessage(`Invalid value for ${XP_LABELS[key]?.label || key}`)
        setXpSaving(false)
        return
      }
      if (num !== xpAwards[key]) { updates[key] = num; hasChanges = true }
    }
    if (!hasChanges) { setXpMessage('No changes to save'); setXpSaving(false); return }

    const res = await fetch('/api/admin/xp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const data = await res.json()
      setXpAwards(data.xpAwards)
      setXpMessage('XP rewards updated successfully')
    } else {
      setXpMessage('Failed to save')
    }
    setXpSaving(false)
  }

  const handleDwSave = async () => {
    setDwSaving(true)
    setDwMessage('')
    const trimAnon = dwAnon.trim()
    const trimNewUser = dwNewUser.trim()
    if (trimAnon === dwSavedAnon && trimNewUser === dwSavedNewUser) {
      setDwMessage('No changes to save')
      setDwSaving(false)
      return
    }
    const res = await fetch('/api/admin/default-worlds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anon: trimAnon || null, new_user: trimNewUser || null }),
    })
    if (res.ok) {
      const data = await res.json()
      const dw = data.defaultWorlds
      setDwAnon(dw.anon || '')
      setDwNewUser(dw.new_user || '')
      setDwSavedAnon(dw.anon || '')
      setDwSavedNewUser(dw.new_user || '')
      setDwMessage('Default worlds updated — takes effect in ~5 min (server cache)')
    } else {
      setDwMessage('Failed to save')
    }
    setDwSaving(false)
  }

  // ─── RENDER ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-gray-500 font-mono text-sm animate-pulse">Loading admin panel...</div>
      </div>
    )
  }

  if (message === 'Access denied — admin only') {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-red-400 font-mono text-sm">{message}</div>
      </div>
    )
  }

  return (
    <>
      <style>{scrollbarStyles}</style>
      <div className="h-screen bg-black text-gray-200 font-mono flex flex-col overflow-hidden">
        {/* ─── FIXED HEADER ─── */}
        <div className="shrink-0 px-6 pt-5 pb-3 border-b border-gray-800/50 bg-black/90 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg text-orange-400 font-bold tracking-wider">
                04515 Admin
              </h1>
              <span className="text-[9px] text-gray-700 border border-gray-800 rounded px-1.5 py-0.5">
                dashboard
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[10px] text-gray-600">
                {session?.user?.email}
              </span>
              <button
                onClick={() => router.push('/')}
                className="text-[10px] text-gray-600 hover:text-gray-400 border border-gray-800 rounded px-2 py-1 hover:border-gray-600 transition-all"
              >
                Back to Oasis
              </button>
            </div>
          </div>
        </div>

        {/* ─── SCROLLABLE CONTENT ─── */}
        <div className="flex-1 overflow-y-auto admin-scroll px-6 py-6">
          <div className="max-w-2xl mx-auto space-y-6">

            {/* ═══════ CREDIT PRICING ═══════ */}
            <Section
              title="Credit Pricing"
              subtitle="1 credit = $1"
              accentColor="orange"
              actions={
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-50 transition-all"
                  >
                    {saving ? 'Saving...' : 'Save Pricing'}
                  </button>
                  {message && (
                    <span className={`text-[10px] ${message.includes('success') ? 'text-green-400' : 'text-amber-400'}`}>
                      {message}
                    </span>
                  )}
                </>
              }
            >
              <GroupedRows
                labels={PRICE_LABELS}
                values={pricing}
                editing={editing}
                setEditing={setEditing}
                defaults={defaults}
                unit="cr"
                step="0.01"
                accentColor="orange"
              />
            </Section>

            {/* ═══════ XP REWARDS ═══════ */}
            <Section
              title="XP Rewards"
              subtitle="per action"
              accentColor="purple"
              actions={
                <>
                  <button
                    onClick={handleXpSave}
                    disabled={xpSaving}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50 transition-all"
                  >
                    {xpSaving ? 'Saving...' : 'Save XP Rewards'}
                  </button>
                  {xpMessage && (
                    <span className={`text-[10px] ${xpMessage.includes('success') ? 'text-green-400' : 'text-amber-400'}`}>
                      {xpMessage}
                    </span>
                  )}
                </>
              }
            >
              <GroupedRows
                labels={XP_LABELS}
                values={xpAwards}
                editing={xpEditing}
                setEditing={setXpEditing}
                defaults={xpDefaults}
                unit="xp"
                step="1"
                accentColor="purple"
              />
            </Section>

            {/* ═══════ DEFAULT WORLDS ═══════ */}
            <Section
              title="Default Worlds"
              subtitle="routing for new / anonymous users"
              accentColor="orange"
              actions={
                <>
                  <button
                    onClick={handleDwSave}
                    disabled={dwSaving}
                    className="px-4 py-1.5 rounded text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-50 transition-all"
                  >
                    {dwSaving ? 'Saving...' : 'Save Default Worlds'}
                  </button>
                  {dwMessage && (
                    <span className={`text-[10px] ${dwMessage.includes('updated') ? 'text-green-400' : 'text-amber-400'}`}>
                      {dwMessage}
                    </span>
                  )}
                </>
              }
            >
              <div className="px-4 py-1.5 bg-gray-900/30 border-b border-gray-800/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">Anonymous Visitors</span>
              </div>
              <div className="px-4 py-3 border-b border-gray-800/30">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 flex-1">Default world (logged-out users)</span>
                  <input
                    type="text"
                    placeholder="world-xxxx... or empty"
                    value={dwAnon}
                    onChange={e => setDwAnon(e.target.value)}
                    className={`w-64 text-xs bg-black/60 border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-600 font-mono ${
                      dwAnon !== dwSavedAnon ? 'border-orange-500/50 text-orange-300' : 'border-gray-700/30 text-gray-300'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-gray-600 mt-1.5">
                  If set, anonymous visitors see this world in view mode instead of /explore.
                  Leave empty to redirect to /explore.
                </p>
              </div>

              <div className="px-4 py-1.5 bg-gray-900/30 border-b border-gray-800/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">New Users</span>
              </div>
              <div className="px-4 py-3 border-b border-gray-800/30">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 flex-1">First-login showcase world</span>
                  <input
                    type="text"
                    placeholder="world-xxxx... or empty"
                    value={dwNewUser}
                    onChange={e => setDwNewUser(e.target.value)}
                    className={`w-64 text-xs bg-black/60 border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-600 font-mono ${
                      dwNewUser !== dwSavedNewUser ? 'border-orange-500/50 text-orange-300' : 'border-gray-700/30 text-gray-300'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-gray-600 mt-1.5">
                  Shown in view mode on first login. User can fork or dismiss.
                  Leave empty to skip showcase and drop them in their own world.
                </p>
              </div>

              <div className="px-4 py-2 border-b border-gray-800/30">
                <p className="text-[10px] text-gray-600">
                  Tip: Copy a world ID from the Explore page or RealmSelector. Format: <code className="text-gray-500">world-XXXXXXXXX-XXXX</code>
                </p>
              </div>
            </Section>

            {/* ═══════ FOOTER ═══════ */}
            <div className="text-[9px] text-gray-700 text-center pb-4">
              Changes take effect within 60 seconds (server cache TTL).
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
