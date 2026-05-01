'use client'

import { FormEvent, useEffect, useState } from 'react'

interface AdminSessionState {
  configured: boolean
  admin: boolean
  subject: string | null
}

export default function AdminPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<AdminSessionState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    const res = await fetch('/api/admin/session', { cache: 'no-store' })
    const json = await res.json()
    setStatus({
      configured: Boolean(json.configured),
      admin: Boolean(json.admin),
      subject: json.subject ?? null,
    })
  }

  useEffect(() => {
    refresh().catch(() => setMessage('Could not read admin session.'))
  }, [])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setMessage(body?.error || `Login failed (${res.status})`)
      return
    }
    setToken('')
    setMessage('Admin session active.')
    await refresh()
  }

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    setMessage('Admin session cleared.')
    await refresh()
  }

  return (
    <main className="min-h-screen bg-[#0a0d11] text-slate-100">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-10">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Oasis Admin</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-wide">Hosted Control Room</h1>
        </div>

        <div className="rounded border border-white/15 bg-white/[0.03] p-5">
          <div className="mb-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-slate-500">Configured</div>
              <div className="font-mono text-cyan-200">{status?.configured ? 'yes' : 'no'}</div>
            </div>
            <div>
              <div className="text-slate-500">Session</div>
              <div className="font-mono text-cyan-200">{status?.admin ? 'admin' : 'visitor'}</div>
            </div>
            <div>
              <div className="text-slate-500">Subject</div>
              <div className="truncate font-mono text-cyan-200">{status?.subject || 'none'}</div>
            </div>
          </div>

          {!status?.admin ? (
            <form onSubmit={login} className="flex flex-col gap-3 sm:flex-row">
              <input
                value={token}
                onChange={event => setToken(event.target.value)}
                type="password"
                placeholder="Admin token"
                className="min-h-11 flex-1 rounded border border-white/15 bg-black/40 px-3 font-mono text-sm outline-none focus:border-cyan-300"
              />
              <button
                type="submit"
                disabled={!token.trim() || !status?.configured}
                className="min-h-11 rounded border border-cyan-300/40 px-5 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Login
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3">
              <a
                href="/"
                className="rounded border border-cyan-300/40 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100"
              >
                Open Oasis
              </a>
              <button
                onClick={logout}
                className="rounded border border-white/15 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
              >
                Logout
              </button>
            </div>
          )}

          {message && <p className="mt-4 text-sm text-amber-200">{message}</p>}
        </div>
      </section>
    </main>
  )
}
