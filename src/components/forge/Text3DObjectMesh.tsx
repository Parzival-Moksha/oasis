// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D OBJECT MESH ░▒▓█ Extruded, shiny words placed in 3-space █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ drei Text3D with a typeface .json font (helvetiker bundled) ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { Center, Text3D } from '@react-three/drei'

import { fontUrlFor, type Text3DObject } from '@/lib/forge/text-3d-object'
import { useOasisStore } from '@/store/oasisStore'

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
    </group>
  )
}
