// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIVE STROKES LAYER ░▒▓█ Render in-progress strokes (local + remote) █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ One PaintStrokeMesh + leading Sparkler per active stroke ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useLiveStrokes } from '@/lib/forge/live-strokes'
import { PaintStrokeMesh } from './PaintStrokeMesh'

export function LiveStrokesLayer() {
  const liveStrokes = useLiveStrokes()
  const entries = Object.values(liveStrokes)
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(stroke => (
        <PaintStrokeMesh
          key={stroke.id}
          points={stroke.points}
          color={stroke.color}
          thickness={stroke.thickness}
          shininess={stroke.shininess}
          mode={stroke.mode}
          varyByVelocity={stroke.varyByVelocity}
          showLeadingSparkler
          leadingSparklerColor={stroke.authorColor}
        />
      ))}
    </>
  )
}
