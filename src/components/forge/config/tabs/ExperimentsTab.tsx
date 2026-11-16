'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS TAB — things to try before they become the default.
// Each experiment is its own section component, so several agents can add one
// without editing each other's code.
// ═══════════════════════════════════════════════════════════════════════════════

import { IntroOverlayExperiment } from '@/components/forge/splash/IntroOverlayExperiment'

export function ExperimentsTab() {
  return (
    <div className="space-y-6 text-white">
      <IntroOverlayExperiment />
    </div>
  )
}
