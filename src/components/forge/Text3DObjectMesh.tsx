// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D OBJECT MESH ░▒▓█ Extruded, shiny words placed in 3-space █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ drei Text3D with a typeface .json font (helvetiker bundled) ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { Center, Text3D } from '@react-three/drei'

import { fontUrlFor, type Text3DObject } from '@/lib/forge/text-3d-object'

// Position + rotation are handled by the outer SelectableWrapper (so single-
// click selects, double-click inspects, and TransformControls can drag the
// text in the world). This component just renders the glyphs at origin.
export function Text3DObjectMesh({ object }: { object: Text3DObject }) {
  // Empty text guard — Text3D throws on empty strings.
  const text = object.text.trim()
  if (!text) return null

  return (
    <Center>
      <Text3D
        font={fontUrlFor(object.fontId)}
        size={object.size}
        height={object.depth}
        curveSegments={6}
        bevelEnabled={false}
      >
        {text}
        <meshStandardMaterial
          color={object.color}
          metalness={Math.max(0, Math.min(1, object.shininess)) * 0.8}
          roughness={1 - Math.max(0, Math.min(1, object.shininess)) * 0.8}
          emissive={object.color}
          emissiveIntensity={Math.max(0, Math.min(1, object.shininess)) * 0.25}
        />
      </Text3D>
    </Center>
  )
}
