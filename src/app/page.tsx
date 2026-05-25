import { headers } from 'next/headers'

import OasisClient from './OasisClient'

const OPENCLAW_HOST_PREFIX = 'openclaw.'
const OPENCLAW_HUB_WORLD_ID = 'world-openclaw-hub-system'

export default function OasisPage() {
  const host = headers().get('host') || ''
  if (host.startsWith(OPENCLAW_HOST_PREFIX)) {
    return <OasisClient fallbackWorldId={OPENCLAW_HUB_WORLD_ID} />
  }
  return <OasisClient />
}
