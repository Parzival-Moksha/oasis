'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ONBOARDING MODAL — First-login identity setup
// Name your builder. Choose your face. Enter the Oasis.
// Appears once, when display_name is null (never set).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'

export function OnboardingModal() {
  const { data: session } = useSession()
  const [show, setShow] = useState(false)
  const [checked, setChecked] = useState(false)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Check if user needs onboarding
  useEffect(() => {
    if (!session?.user || checked) return
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        setChecked(true)
        if (data.needsOnboarding) {
          setShow(true)
          setAvatarPreview(session.user?.image || null)
        }
      })
      .catch(() => setChecked(true))
  }, [session?.user, checked])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2MB')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    setError('')
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      // Update profile name + bio
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: trimmed, bio: bio.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save profile')

      // Upload avatar if changed
      if (avatarFile) {
        const formData = new FormData()
        formData.append('avatar', avatarFile)
        await fetch('/api/profile/avatar', { method: 'POST', body: formData })
      }

      setShow(false)
    } catch (err) {
      console.error('[Onboarding] Failed:', err)
      setError('Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!show) return null

  const initial = (session?.user?.name?.[0] || '?').toUpperCase()

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-md mx-4 rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(15,0,30,0.95), rgba(30,10,60,0.95))',
          border: '1px solid rgba(168,85,247,0.3)',
          boxShadow: '0 0 60px rgba(168,85,247,0.15), 0 0 120px rgba(88,28,135,0.1)',
        }}
      >
        {/* Header */}
        <div className="text-center pt-8 pb-4 px-6">
          <h2 className="text-2xl font-bold text-white mb-1">Welcome to the Oasis</h2>
          <p className="text-sm text-gray-400">Choose your identity, builder.</p>
        </div>

        {/* Avatar */}
        <div className="flex justify-center pb-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative w-24 h-24 rounded-full overflow-hidden group cursor-pointer"
            style={{
              border: '2px solid rgba(168,85,247,0.5)',
              boxShadow: '0 0 20px rgba(168,85,247,0.2)',
            }}
            type="button"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full bg-purple-900 flex items-center justify-center">
                <span className="text-3xl font-bold text-purple-300">{initial}</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-xs font-medium">Change</span>
            </div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Form */}
        <div className="px-6 pb-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
              Builder Name <span className="text-purple-400">*</span>
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              maxLength={30}
              placeholder="What shall we call you?"
              className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none transition-all placeholder-gray-600"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(168,85,247,0.3)',
              }}
              onFocus={e => (e.target.style.borderColor = 'rgba(168,85,247,0.6)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(168,85,247,0.3)')}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && name.trim().length >= 2) handleSubmit()
              }}
            />
            <p className="text-[10px] text-gray-600 mt-1">{name.length}/30</p>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">
              Bio <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Tell the Oasis about yourself..."
              className="w-full px-4 py-3 rounded-lg text-white text-sm outline-none transition-all resize-none placeholder-gray-600"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(168,85,247,0.3)',
              }}
              onFocus={e => (e.target.style.borderColor = 'rgba(168,85,247,0.6)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(168,85,247,0.3)')}
            />
            <p className="text-[10px] text-gray-600 mt-1">{bio.length}/200</p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || name.trim().length < 2 || submitting}
            className="w-full py-3 rounded-lg text-white font-medium text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: name.trim().length >= 2
                ? 'linear-gradient(135deg, #7C3AED, #6D28D9)'
                : 'rgba(255,255,255,0.1)',
            }}
          >
            {submitting ? 'Entering...' : 'Enter the Oasis'}
          </button>
        </div>
      </div>
    </div>
  )
}
