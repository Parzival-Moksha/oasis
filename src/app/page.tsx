// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS — Main Page (Server Component)
// Fetches default world config at SSR time → passes to client.
// Server-side redirects for anon users = ZERO forge flash.
// ─═̷─═̷─ॐ─═̷─═̷─ Where consciousness renders itself ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getDefaultWorlds } from '@/lib/default-worlds'
import OasisClient from './OasisClient'

export default async function OasisPage({
  searchParams,
}: {
  searchParams: { view?: string; world?: string }
}) {
  const [session, defaultWorlds] = await Promise.all([
    auth(),
    getDefaultWorlds(),
  ])

  const viewParam = searchParams.view || null
  const worldParam = searchParams.world || null

  // ─── CASE 3: Not logged in, no ?view= param ──────────────────────
  // Server-side redirect: never sends page HTML, zero forge flash.
  if (!session && !viewParam) {
    if (defaultWorlds.anon) {
      // Admin set a default world → redirect to view it
      redirect(`/?view=${defaultWorlds.anon}`)
    }
    redirect('/explore')
  }

  // ─── All other cases: render the client component with routing info ──
  return (
    <OasisClient
      initialViewWorld={viewParam}
      initialSwitchWorld={session ? worldParam : null}
      isAuthenticated={!!session}
      defaultNewUserWorld={defaultWorlds.new_user}
    />
  )
}
