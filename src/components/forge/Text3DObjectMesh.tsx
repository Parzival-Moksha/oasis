// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D OBJECT MESH ░▒▓█ Extruded, shiny words placed in 3-space █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ drei Text3D with a typeface .json font (helvetiker bundled) ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { Center, Text3D } from '@react-three/drei'

import { fontUrlFor, type Text3DObject } from '@/lib/forge/text-3d-object'
import { useOasisStore } from '@/store/oasisStore'

export function Text3DObjectMesh({ object }: { object: Text3DObject }) {
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const transforms = useOasisStore(s => s.transforms)
  const override = transforms[object.id]
  const position = override?.position || object.position
  const rotation = override?.rotation || object.rotation

  // Empty text guard — Text3D throws on empty strings.
  const text = object.text.trim()
  if (!text) return null

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerDown={event => {
        event.stopPropagation()
        if (event.button === 0 && (event as unknown as { detail?: number }).detail === 2) {
          setInspectedObject(object.id)
        }
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
