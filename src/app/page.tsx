// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS — Hostname-routed welcome. Local-first by default; the
// openclaw.04515.xyz subdomain drops visitors straight into the
// OpenClaw Hub world for ClawCon-flavored arrivals.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import OasisClient from './OasisClient'

const OPENCLAW_HOST_PREFIX = 'openclaw.'
const OPENCLAW_HUB_WORLD_ID = 'world-openclaw-hub-system'

export default function OasisPage() {
  // Server-side hostname check — no client flash, no fetch delay.
  // Any host whose first label is `openclaw` (openclaw.04515.xyz,
  // openclaw.dev.04515.xyz, openclaw.local, …) lands in the Hub.
  // Everyone else falls through to Portal Zero via OasisClient default.
  const host = headers().get('host') || ''
  if (host.startsWith(OPENCLAW_HOST_PREFIX)) {
    redirect(`/w/${OPENCLAW_HUB_WORLD_ID}`)
  }
  return <OasisClient />
}
