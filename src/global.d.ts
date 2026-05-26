// ═══════════════════════════════════════════════════════════════════════════════
// React Three Fiber JSX Type Declarations
// ═══════════════════════════════════════════════════════════════════════════════
// Extends JSX.IntrinsicElements with Three.js/R3F elements like mesh, group, etc.
// Without this, TypeScript doesn't know <group>, <mesh> etc. exist in JSX.
// — Silicon Mother, Feb 2026
// ═══════════════════════════════════════════════════════════════════════════════

import type { ThreeElements } from '@react-three/fiber'
import type { OasisDesktopCaptureBridge } from './lib/desktop-capture'

declare global {
  interface Window {
    oasisDesktopCapture?: OasisDesktopCaptureBridge
    __oasisPreferredWorldId?: string
    __oasisPreferredShortCode?: string
    __oasisWorldShortCodes?: Record<string, string>
    __oasisFallbackWorldId?: string
  }

  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
