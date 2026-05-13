// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D OBJECT MESH ░▒▓█ Extruded, shiny words placed in 3-space █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ drei Text3D with a typeface .json font (helvetiker bundled) ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { Center, Text3D } from '@react-three/drei'
import React, { Suspense } from 'react'

import { fontUrlFor, TEXT3D_FONT_OPTIONS, type Text3DObject } from '@/lib/forge/text-3d-object'
import { useOasisStore } from '@/store/oasisStore'

// drei <Text3D> uses useLoader(FontLoader) which throws into Suspense on
// network failure. The 9 streamed fonts depend on unpkg @ three@0.162.0;
// if unpkg is unreachable (offline, firewall, regional outage), the throw
// would crash the entire scene tree. This boundary catches the failure
// per text object and falls back to the locally-vendored helvetiker.
class FontErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: Error) {
    console.warn('[Text3D] font load failed, using fallback:', err.message)
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

const FALLBACK_FONT_URL = TEXT3D_FONT_OPTIONS[0].url

interface Text3DGlyphsProps {
  text: string
  fontUrl: string
  size: number
  depth: number
  color: string
  toneBias?: number
  shininess: number
}

function mixHexChannel(channel: number, target: number, amount: number) {
  return Math.round(channel + (target - channel) * amount)
}

function readableTextColor(color: string, toneBias = 0): string {
  const normalized = color.trim()
  const expanded = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized
  const match = expanded.match(/^#?([0-9a-f]{6})$/i)
  if (!match) return color
  const hex = match[1]
  const bias = Math.max(-1, Math.min(1, toneBias))
  if (Math.abs(bias) < 0.001) return `#${hex}`
  const amount = Math.abs(bias)
  const target = bias > 0 ? 255 : 0
  const r = mixHexChannel(parseInt(hex.slice(0, 2), 16), target, amount)
  const g = mixHexChannel(parseInt(hex.slice(2, 4), 16), target, amount)
  const b = mixHexChannel(parseInt(hex.slice(4, 6), 16), target, amount)
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function Text3DGlyphs({ text, fontUrl, size, depth, color, toneBias, shininess }: Text3DGlyphsProps) {
  const clamped = Math.max(0, Math.min(1, shininess))
  const displayColor = readableTextColor(color, toneBias)
  return (
    <Center>
      <Text3D font={fontUrl} size={size} height={depth} curveSegments={6} bevelEnabled={false}>
        {text}
        <meshStandardMaterial
          color={displayColor}
          metalness={clamped * 0.8}
          roughness={1 - clamped * 0.8}
          emissive={displayColor}
          emissiveIntensity={clamped * 0.25}
        />
      </Text3D>
    </Center>
  )
}

// Position + rotation are handled by the outer SelectableWrapper (so single-
// click selects, double-click inspects, and TransformControls can drag the
// text in the world). This component just renders the glyphs at origin.
// We add direct onClick / onDoubleClick handlers on a wrapping group as a
// belt-and-suspenders backstop — R3F event bubbling from a deeply nested
// drei <Text3D> mesh through SelectableWrapper proved unreliable.
export function Text3DObjectMesh({ object }: { object: Text3DObject }) {
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)
  const text = object.text.trim()
  if (!text) return null

  const fontUrl = fontUrlFor(object.fontId)
  const styleProps = { text, size: object.size, depth: object.depth, color: object.color, toneBias: object.toneBias, shininess: object.shininess }

  return (
    <group
      onClick={(e) => {
        if (isReadOnly) return
        e.stopPropagation()
        selectObject(object.id)
      }}
      onDoubleClick={(e) => {
        if (isReadOnly) return
        e.stopPropagation()
        selectObject(object.id)
        setInspectedObject(object.id)
      }}
    >
      <FontErrorBoundary
        fallback={
          <Suspense fallback={null}>
            <Text3DGlyphs {...styleProps} fontUrl={FALLBACK_FONT_URL} />
          </Suspense>
        }
      >
        <Suspense fallback={null}>
          <Text3DGlyphs {...styleProps} fontUrl={fontUrl} />
        </Suspense>
      </FontErrorBoundary>
    </group>
  )
}
