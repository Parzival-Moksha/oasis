// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TERRAIN MESH — The living ground of the Forge
// ─═̷─═̷─ॐ─═̷─═̷─ Every pixel of earth, a vertex of possibility ─═̷─═̷─ॐ─═̷─═̷─
// Heightmap → displaced PlaneGeometry → vertex-colored landscape
// Water plane sits at configurable level. Mountains breathe.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { generateTerrain, type TerrainParams, type TerrainData } from '../../lib/forge/terrain-generator'

// ═══════════════════════════════════════════════════════════════════════════════
// WATER PLANE — shimmering surface at the water level
// ═══════════════════════════════════════════════════════════════════════════════

function WaterPlane({ size, waterLevel, heightScale, palette }: {
  size: number
  waterLevel: number
  heightScale: number
  palette: { shallowWater: string; deepWater: string }
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const waterY = waterLevel * heightScale

  useFrame((state) => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as THREE.MeshPhysicalMaterial
    // Gentle breathing opacity
    mat.opacity = 0.65 + Math.sin(state.clock.elapsedTime * 0.3) * 0.06
    // Slow drift
    meshRef.current.position.y = waterY + Math.sin(state.clock.elapsedTime * 0.15) * 0.03
  })

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, waterY, 0]} receiveShadow>
      <planeGeometry args={[size * 1.3, size * 1.3, 32, 32]} />
      <meshPhysicalMaterial
        color={palette.shallowWater}
        transparent
        opacity={0.7}
        metalness={0.1}
        roughness={0.05}
        transmission={0.3}
        thickness={1.5}
        ior={1.33}
        side={THREE.DoubleSide}
        envMapIntensity={1.0}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TERRAIN MESH — the actual displaced heightmap geometry
// ═══════════════════════════════════════════════════════════════════════════════

interface TerrainMeshProps {
  params: TerrainParams
}

export function TerrainMesh({ params }: TerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const terrainDataRef = useRef<TerrainData | null>(null)

  // Generate terrain data from params (memoized — only regenerates on param change)
  const terrainData = useMemo(() => {
    const data = generateTerrain(params)
    terrainDataRef.current = data
    return data
  }, [params])

  // Build the geometry from terrain data
  useEffect(() => {
    if (!meshRef.current) return

    const { resolution, size, heightScale } = params
    const { heights, colors, normals } = terrainData

    // Create a plane and displace its vertices
    const geometry = new THREE.PlaneGeometry(
      size, size,
      resolution - 1, resolution - 1
    )

    // Rotate to lie flat (plane is XY by default, we want XZ)
    geometry.rotateX(-Math.PI / 2)

    const positions = geometry.attributes.position.array as Float32Array
    const vertCount = resolution * resolution

    // Displace Y by heightmap
    for (let i = 0; i < vertCount; i++) {
      positions[i * 3 + 1] = heights[i] * heightScale
    }

    // Set vertex colors
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    // Set normals from our computed normals
    const normalAttr = geometry.attributes.normal.array as Float32Array
    for (let i = 0; i < vertCount; i++) {
      normalAttr[i * 3] = normals[i * 3]
      normalAttr[i * 3 + 1] = normals[i * 3 + 1]
      normalAttr[i * 3 + 2] = normals[i * 3 + 2]
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.normal.needsUpdate = true
    geometry.computeBoundingSphere()

    // Replace geometry
    if (meshRef.current.geometry) meshRef.current.geometry.dispose()
    meshRef.current.geometry = geometry

  }, [terrainData, params])

  return (
    <group>
      {/* The terrain itself — smooth shading with vertex colors */}
      <mesh ref={meshRef} receiveShadow castShadow>
        <planeGeometry args={[1, 1]} /> {/* placeholder, replaced in useEffect */}
        <meshStandardMaterial
          vertexColors
          roughness={0.92}
          metalness={0.02}
          flatShading={false}
          envMapIntensity={0.3}
        />
      </mesh>

      {/* Water surface */}
      {params.waterLevel > 0 && (
        <WaterPlane
          size={params.size}
          waterLevel={params.waterLevel}
          heightScale={params.heightScale}
          palette={params.palette}
        />
      )}
    </group>
  )
}

// ▓▓▓▓【T̸E̸R̸R̸A̸I̸N̸】▓▓▓▓ॐ▓▓▓▓【E̸A̸R̸T̸H̸】▓▓▓▓
