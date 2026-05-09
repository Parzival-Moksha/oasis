'use client'

import { Center, Text3D } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { useOasisStore } from '@/store/oasisStore'
import { useAudioManager } from '@/lib/audio-manager'
import {
  type SpatialWebObject,
  type SpatialWebValue,
} from '@/lib/spatial-web'
import { SettingsContext } from '@/components/scene-lib'

const TEXT3D_FONT = '/fonts/helvetiker_regular.typeface.json'

function displayValue(value: SpatialWebValue): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return 'Blank'
  return String(value)
}

function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value.trim())) return fallback
  return value.trim()
}

function valueForLabel(object: SpatialWebObject): string {
  if ((object.type === 'select' || object.type === 'multiselect') && object.options?.length) {
    if (Array.isArray(object.value)) {
      const labels = object.value.map(value => object.options?.find(option => option.value === value)?.label || value)
      return labels.length ? labels.join(', ') : 'None'
    }
    const selected = object.options.find(option => option.value === object.value)
    return selected?.label || displayValue(object.value ?? null)
  }
  return displayValue(object.value ?? null)
}

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function colorTimes(hex: string, scalar: number): string {
  const color = new THREE.Color(normalizeHex(hex, '#ffffff'))
  color.multiplyScalar(scalar)
  return `#${color.getHexString()}`
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxChars) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word.length > maxChars ? clampText(word, maxChars) : word
    if (lines.length >= maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length > maxLines) lines.length = maxLines
  const original = value.replace(/\s+/g, ' ').trim()
  const joined = lines.join(' ')
  if (joined.length < original.length && lines.length > 0) {
    lines[lines.length - 1] = clampText(lines[lines.length - 1], Math.max(4, maxChars - 3)) + '...'
  }
  return lines
}

function EmbossedText({
  children,
  position,
  fontSize,
  maxChars,
  maxLines = 2,
  color = '#f8fafc',
  sideColor,
}: {
  children: string
  position: [number, number, number]
  fontSize: number
  maxChars: number
  maxLines?: number
  color?: string
  sideColor?: string
}) {
  const lines = wrapText(children, maxChars, maxLines)
  const lineHeight = fontSize * 1.42
  const top = ((lines.length - 1) * lineHeight) / 2
  const darkSide = sideColor || colorTimes(color, 0.22)
  return (
    <group position={position}>
      {lines.map((line, index) => (
        <group key={`${line}-${index}`} position={[0, top - index * lineHeight, 0]}>
          <Center>
            <Text3D
              font={TEXT3D_FONT}
              size={fontSize}
              height={fontSize * 0.24}
              bevelEnabled={false}
              curveSegments={2}
            >
              {line}
              <meshBasicMaterial
                attach="material-0"
                color={color}
              />
              <meshBasicMaterial
                attach="material-1"
                color={darkSide}
              />
            </Text3D>
          </Center>
        </group>
      ))}
    </group>
  )
}

function setPointerCapture(event: ThreeEvent<PointerEvent>) {
  const target = event.target as EventTarget & { setPointerCapture?: (pointerId: number) => void }
  target?.setPointerCapture?.(event.pointerId)
}

function releasePointerCapture(event: ThreeEvent<PointerEvent>) {
  const target = event.target as EventTarget & { releasePointerCapture?: (pointerId: number) => void }
  target?.releasePointerCapture?.(event.pointerId)
}

type ConfettiPiece = {
  angle: number
  radius: number
  rise: number
  fall: number
  spin: number
  size: number
  color: THREE.Color
}

function SubmitConfetti({ trigger, accent }: { trigger?: string; accent: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const pieces = useMemo<ConfettiPiece[]>(() => {
    const colors = ['#facc15', '#fb7185', '#38bdf8', '#22c55e', '#f8fafc', accent]
    return Array.from({ length: 180 }, (_, index) => ({
      angle: (index * 2.399963 + (index % 7) * 0.13) % (Math.PI * 2),
      radius: 0.35 + ((index * 37) % 100) / 100 * 2.1,
      rise: 4.4 + ((index * 19) % 100) / 100 * 1.9,
      fall: 0.65 + ((index * 23) % 100) / 100 * 1.15,
      spin: 3.5 + ((index * 29) % 100) / 100 * 7,
      size: 0.045 + ((index * 31) % 100) / 100 * 0.055,
      color: new THREE.Color(colors[index % colors.length]),
    }))
  }, [accent])

  useEffect(() => {
    if (!trigger) return
    setStartedAt(performance.now())
  }, [trigger])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.count = 0
    pieces.forEach((piece, index) => mesh.setColorAt(index, piece.color))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [pieces])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    if (startedAt === null) {
      mesh.count = 0
      return
    }
    const elapsed = (performance.now() - startedAt) / 1000
    if (elapsed > 7.5) {
      mesh.count = 0
      return
    }
    const live = elapsed < 6.8 ? pieces.length : Math.floor(pieces.length * Math.max(0, 1 - (elapsed - 6.8) / 0.7))
    for (let index = 0; index < live; index += 1) {
      const piece = pieces[index]
      const burst = Math.min(1, elapsed / 1.1)
      const settle = Math.max(0, elapsed - 1.15)
      const swirl = piece.angle + elapsed * 0.75
      const radius = piece.radius * (0.2 + burst)
      const x = Math.cos(swirl) * radius
      const z = Math.sin(swirl) * radius
      const y = 0.22 + piece.rise * Math.sin(burst * Math.PI * 0.72) - settle * piece.fall
      dummy.position.set(x, Math.max(0.05, y), z)
      dummy.rotation.set(elapsed * piece.spin, elapsed * piece.spin * 0.37, piece.angle)
      dummy.scale.set(piece.size, piece.size * 0.22, piece.size * 1.6)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }
    mesh.count = live
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, pieces.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
    </instancedMesh>
  )
}

function GoogleFormsAltar({
  object,
  busy,
  accent,
  canClickInteract,
  interactionHint,
  runInteraction,
}: {
  object: SpatialWebObject
  busy: boolean
  accent: string
  canClickInteract: boolean
  interactionHint: boolean
  runInteraction: () => void
}) {
  const rootRef = useRef<THREE.Group>(null)
  const gearARef = useRef<THREE.Mesh>(null)
  const gearBRef = useRef<THREE.Mesh>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const streamARef = useRef<THREE.Mesh>(null)
  const streamBRef = useRef<THREE.Mesh>(null)
  const hasWorld = Boolean(object.generatedWorldUrl && object.generatedWorldId)
  const statusText = busy
    ? 'Building Oasis world...'
    : object.errorMessage
      ? object.errorMessage
      : hasWorld
        ? 'World ready. Press F to copy.'
        : 'Paste a public Google Forms URL.'
  const inputText = hasWorld
    ? object.generatedWorldUrl || ''
    : typeof object.value === 'string' && object.value
      ? object.value
      : object.placeholder || 'https://forms.gle/...'

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (rootRef.current) {
      const shake = busy ? Math.sin(t * 34) * 0.018 : 0
      rootRef.current.position.set(shake, busy ? Math.sin(t * 27) * 0.012 : 0, 0)
      rootRef.current.rotation.z = busy ? Math.sin(t * 41) * 0.006 : 0
    }
    if (gearARef.current) gearARef.current.rotation.z = busy ? t * 3.2 : t * 0.35
    if (gearBRef.current) gearBRef.current.rotation.z = busy ? -t * 3.7 : -t * 0.28
    if (coreRef.current) {
      const pulse = busy || hasWorld ? 1 + Math.sin(t * 5.5) * 0.08 : 1
      coreRef.current.scale.setScalar(pulse)
    }
    if (streamARef.current) streamARef.current.position.x = -2.1 + ((t * 1.8) % 4.2)
    if (streamBRef.current) streamBRef.current.position.x = 2.1 - ((t * 1.45) % 4.2)
  })

  return (
    <group
      ref={rootRef}
      onClick={(event) => {
        if (!canClickInteract) return
        event.stopPropagation()
        runInteraction()
      }}
    >
      <mesh castShadow receiveShadow position={[0, -0.58, 0]} scale={[1, 1, 1]}>
        <boxGeometry args={[5.25, 0.34, 1.2]} />
        <meshStandardMaterial color="#111827" roughness={0.58} metalness={0.18} emissive="#06111f" emissiveIntensity={0.22} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -0.34, 0.04]}>
        <boxGeometry args={[4.75, 0.26, 0.98]} />
        <meshStandardMaterial color="#263244" roughness={0.42} metalness={0.32} emissive={accent} emissiveIntensity={0.1} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.1, 0.02]}>
        <boxGeometry args={[4.42, 1.08, 0.42]} />
        <meshStandardMaterial color="#07111e" roughness={0.36} metalness={0.18} emissive={accent} emissiveIntensity={0.34} />
      </mesh>
      <mesh position={[0, 0.1, 0.29]}>
        <boxGeometry args={[3.72, 0.62, 0.055]} />
        <meshBasicMaterial color="#05111f" />
      </mesh>
      <mesh position={[0, 0.47, 0.34]}>
        <boxGeometry args={[3.95, 0.045, 0.05]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <mesh position={[0, -0.28, 0.34]}>
        <boxGeometry args={[3.95, 0.045, 0.05]} />
        <meshBasicMaterial color={hasWorld ? '#86efac' : accent} />
      </mesh>

      <group position={[-2.12, 0.08, 0.36]}>
        <mesh ref={gearARef} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.28, 0.045, 8, 18]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.34} metalness={0.68} emissive={accent} emissiveIntensity={busy ? 0.38 : 0.12} />
        </mesh>
        {Array.from({ length: 8 }, (_, index) => (
          <mesh key={index} rotation={[0, 0, (index / 8) * Math.PI * 2]} position={[Math.cos((index / 8) * Math.PI * 2) * 0.31, Math.sin((index / 8) * Math.PI * 2) * 0.31, 0]}>
            <boxGeometry args={[0.08, 0.045, 0.045]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.55} />
          </mesh>
        ))}
      </group>

      <group position={[2.12, 0.08, 0.36]}>
        <mesh ref={gearBRef}>
          <torusGeometry args={[0.22, 0.04, 8, 18]} />
          <meshStandardMaterial color="#bae6fd" roughness={0.28} metalness={0.62} emissive={accent} emissiveIntensity={busy ? 0.42 : 0.14} />
        </mesh>
        {Array.from({ length: 8 }, (_, index) => (
          <mesh key={index} rotation={[0, 0, (index / 8) * Math.PI * 2]} position={[Math.cos((index / 8) * Math.PI * 2) * 0.25, Math.sin((index / 8) * Math.PI * 2) * 0.25, 0]}>
            <boxGeometry args={[0.07, 0.04, 0.04]} />
            <meshStandardMaterial color="#e0f2fe" roughness={0.42} metalness={0.5} />
          </mesh>
        ))}
      </group>

      <mesh ref={coreRef} castShadow position={[0, 0.95, 0.1]}>
        <octahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial
          color={hasWorld ? '#86efac' : accent}
          emissive={hasWorld ? '#22c55e' : accent}
          emissiveIntensity={busy || hasWorld ? 1.6 : 0.72}
          roughness={0.18}
          metalness={0.18}
        />
      </mesh>
      <pointLight color={hasWorld ? '#86efac' : accent} intensity={busy || hasWorld ? 2.1 : 0.85} distance={5} position={[0, 0.95, 0.75]} />

      {busy && (
        <>
          <mesh ref={streamARef} position={[-2.1, 0.76, 0.42]}>
            <boxGeometry args={[0.72, 0.035, 0.035]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.82} />
          </mesh>
          <mesh ref={streamBRef} position={[2.1, -0.48, 0.42]}>
            <boxGeometry args={[0.64, 0.035, 0.035]} />
            <meshBasicMaterial color="#a7f3d0" transparent opacity={0.76} />
          </mesh>
        </>
      )}

      <EmbossedText position={[0, 1.52, 0.5]} fontSize={0.16} maxChars={24} maxLines={2} color="#e0f2fe" sideColor="#082f49">
        {busy ? 'Forging the world' : object.label}
      </EmbossedText>
      <EmbossedText position={[0, 0.22, 0.52]} fontSize={0.082} maxChars={42} maxLines={3} color="#f8fafc" sideColor="#020617">
        {inputText}
      </EmbossedText>
      <EmbossedText position={[0, -0.54, 0.52]} fontSize={0.075} maxChars={36} maxLines={2} color={object.errorMessage ? '#fecdd3' : '#a7f3d0'} sideColor="#042f2e">
        {statusText}
      </EmbossedText>

      {hasWorld && (
        <group position={[0, -1.04, 0.22]}>
          <mesh castShadow>
            <boxGeometry args={[2.18, 0.28, 0.18]} />
            <meshStandardMaterial color="#064e3b" roughness={0.34} metalness={0.2} emissive="#22c55e" emissiveIntensity={0.46} />
          </mesh>
          <EmbossedText position={[0, -0.03, 0.15]} fontSize={0.08} maxChars={18} color="#ecfdf5" sideColor="#022c22">
            Copy address
          </EmbossedText>
        </group>
      )}

      {interactionHint && (
        <group position={[0, 1.96, 0.56]}>
          <mesh>
            <boxGeometry args={[0.6, 0.26, 0.06]} />
            <meshStandardMaterial color="#020617" emissive={accent} emissiveIntensity={0.45} roughness={0.45} metalness={0.2} />
          </mesh>
          <EmbossedText position={[0, 0, 0.08]} fontSize={0.12} maxChars={2} color="#ffffff" sideColor="#111827">
            F
          </EmbossedText>
        </group>
      )}
    </group>
  )
}

export function SpatialWebObject3D({
  object,
  interactionHint = false,
}: {
  object: SpatialWebObject
  interactionHint?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [draggingSlider, setDraggingSlider] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const { effectiveRp1Mode } = useContext(SettingsContext)
  const interactSpatialWebObject = useOasisStore(s => s.interactSpatialWebObject)
  const setSpatialWebObjectValue = useOasisStore(s => s.setSpatialWebObjectValue)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)
  const canClickInteract = effectiveRp1Mode || isReadOnly

  const accent = normalizeHex(object.accentColor, '#38bdf8')
  const width = object.width ?? (object.type === 'button' ? 2.2 : 2.6)
  const baseHeight = object.height ?? (object.type === 'output' || object.type === 'text' ? 1.05 : 0.82)
  const labelValue = valueForLabel(object)
  const isWidePanel = object.type === 'output' || object.type === 'text'
  const visualStyle = object.visualStyle
    || (object.type === 'button' ? 'arcade-button'
      : object.type === 'slider' ? 'glass-slider'
        : isWidePanel ? 'terminal-panel'
          : 'neon-panel')
  const isPortalButton = visualStyle === 'portal-zero-button'
  const isGoogleFormsAltar = visualStyle === 'google-form-altar'
  const depth = isPortalButton ? 0.34 : isGoogleFormsAltar ? 0.5 : visualStyle === 'arcade-button' ? 0.42 : visualStyle === 'terminal-panel' ? 0.18 : 0.24
  const labelText = busy ? 'Sending...' : object.label
  const valueText = object.type === 'text' && !object.value ? object.placeholder || 'Empty' : labelValue
  const labelMaxChars = isWidePanel ? 36 : 30
  const valueMaxChars = isWidePanel ? 42 : 26
  const labelLines = wrapText(labelText, labelMaxChars, 3)
  const valueLines = object.type === 'button' ? [] : wrapText(valueText, valueMaxChars, isWidePanel ? 5 : 3)
  const height = Math.max(
    baseHeight,
    baseHeight + Math.max(0, labelLines.length - 1) * 0.18 + Math.max(0, valueLines.length - 1) * (isWidePanel ? 0.18 : 0.24),
  )

  const material = useMemo(() => {
    const color = new THREE.Color(accent)
    const base = color.clone().multiplyScalar(visualStyle === 'arcade-button' || isPortalButton ? 0.76 : visualStyle === 'terminal-panel' ? 0.24 : 0.38)
    return {
      color: `#${base.getHexString()}`,
      emissive: accent,
      emissiveIntensity: visualStyle === 'arcade-button' || isPortalButton ? 0.9 : visualStyle === 'terminal-panel' ? 0.22 : 0.36,
    }
  }, [accent, isPortalButton, visualStyle])

  const sliderProgress = useMemo(() => {
    if (object.type !== 'slider') return 0
    const min = object.min ?? 0
    const max = object.max ?? 100
    const current = typeof object.value === 'number' ? object.value : min
    if (max <= min) return 0
    return Math.min(1, Math.max(0, (current - min) / (max - min)))
  }, [object])

  const runInteraction = () => {
    if (busy) return
    const waitsForNetwork = (object.type === 'button' && object.action?.type === 'submit_form')
      || (object.action?.type === 'create_world_from_google_form' && !object.generatedWorldUrl)
    if (waitsForNetwork) setBusy(true)
    void interactSpatialWebObject(object.id).finally(() => {
      if (waitsForNetwork) setBusy(false)
    })
  }

  const handleInteractClick = (event: { stopPropagation: () => void }) => {
    if (!canClickInteract || object.type === 'slider') return
    event.stopPropagation()
    runInteraction()
  }

  const updateSliderFromPointer = (event: ThreeEvent<PointerEvent>) => {
    if (object.type !== 'slider' || !groupRef.current) return
    const min = object.min ?? 0
    const max = object.max ?? 100
    const step = object.step ?? 1
    const local = groupRef.current.worldToLocal(event.point.clone())
    const trackWidth = width * 0.72
    const rawProgress = (local.x + trackWidth / 2) / trackWidth
    const progress = Math.min(1, Math.max(0, rawProgress))
    const rawValue = min + progress * (max - min)
    const snapped = step > 0 ? Math.round(rawValue / step) * step : rawValue
    const value = Math.min(max, Math.max(min, Number(snapped.toFixed(4))))
    setSpatialWebObjectValue(object.id, value)
  }

  const handleSliderPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (object.type !== 'slider') return
    event.stopPropagation()
    try {
      useAudioManager.getState().play('modeSwitch')
    } catch {}
    setPointerCapture(event)
    setDraggingSlider(true)
    updateSliderFromPointer(event)
  }

  const handleSliderPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingSlider) return
    event.stopPropagation()
    updateSliderFromPointer(event)
  }

  if (isGoogleFormsAltar) {
    return (
      <GoogleFormsAltar
        object={object}
        busy={busy}
        accent={accent}
        canClickInteract={canClickInteract}
        interactionHint={interactionHint}
        runInteraction={runInteraction}
      />
    )
  }

  if (isPortalButton) {
    const buttonColor = busy ? '#fecdd3' : object.type === 'toggle'
      ? object.value === true ? accent : '#94a3b8'
      : accent
    const emissive = new THREE.Color(buttonColor)
    return (
      <group
        ref={groupRef}
        onClick={(event) => {
          if (!canClickInteract) return
          event.stopPropagation()
          runInteraction()
        }}
      >
        <mesh castShadow receiveShadow position={[0, -0.28, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.64, 0.74, 0.2, 48]} />
          <meshStandardMaterial color="#1f2937" roughness={0.5} metalness={0.35} />
        </mesh>
        <mesh castShadow position={[0, busy ? -0.12 : -0.05, 0]} scale={[1, busy ? 0.68 : 1, 1]}>
          <cylinderGeometry args={[0.42, 0.5, 0.18, 48]} />
          <meshStandardMaterial
            color={buttonColor}
            emissive={emissive}
            emissiveIntensity={canClickInteract || busy ? 0.65 : 0.28}
            roughness={0.32}
            metalness={0.18}
          />
        </mesh>
        <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.58, 64]} />
          <meshBasicMaterial color={buttonColor} transparent opacity={canClickInteract ? 0.78 : 0.4} />
        </mesh>
        <pointLight color={buttonColor} intensity={canClickInteract ? 1.2 : 0.45} distance={4} position={[0, 0.55, 0]} />
        <SubmitConfetti trigger={object.submittedAt} accent={accent} />
        <EmbossedText
          position={[0, 0.68, 0.36]}
          fontSize={0.16}
          maxChars={16}
          maxLines={2}
          color="#fff7ed"
          sideColor="#3b1020"
        >
          {busy ? 'Sending...' : object.label}
        </EmbossedText>
        {object.description && (
          <EmbossedText position={[0, 0.34, 0.42]} fontSize={0.07} maxChars={24} maxLines={2} color="#fecdd3" sideColor="#451a1f">
            {object.description}
          </EmbossedText>
        )}
        {interactionHint && (
          <EmbossedText position={[0, 1.02, 0.38]} fontSize={0.12} maxChars={3} color="#ffffff" sideColor="#111827">
            F
          </EmbossedText>
        )}
      </group>
    )
  }

  return (
    <group
      ref={groupRef}
      onClick={(event) => {
        if (object.type === 'slider') {
          event.stopPropagation()
          return
        }
        handleInteractClick(event)
      }}
      onPointerDown={object.type === 'slider' ? handleSliderPointerDown : undefined}
      onPointerMove={handleSliderPointerMove}
      onPointerUp={(event) => {
        if (draggingSlider) {
          event.stopPropagation()
          releasePointerCapture(event)
        }
        setDraggingSlider(false)
      }}
      onPointerLeave={() => setDraggingSlider(false)}
    >
      <mesh castShadow receiveShadow position={[0, 0, -0.03]}>
        <boxGeometry args={[width + 0.16, height + 0.16, depth * 0.52]} />
        <meshStandardMaterial
          color={visualStyle === 'terminal-panel' ? '#031013' : '#020617'}
          emissive={accent}
          emissiveIntensity={0.08}
          roughness={0.7}
          metalness={0.28}
        />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0, depth * 0.08]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={material.color}
          emissive={material.emissive}
          emissiveIntensity={material.emissiveIntensity}
          roughness={0.42}
          metalness={object.type === 'button' ? 0.28 : 0.14}
        />
      </mesh>

      <mesh position={[0, 0, depth * 0.62]}>
        <boxGeometry args={[width * 0.9, height * 0.68, 0.035]} />
        <meshStandardMaterial
          color={visualStyle === 'terminal-panel' ? '#05202a' : '#08111f'}
          emissive={accent}
          emissiveIntensity={visualStyle === 'terminal-panel' ? 0.16 : 0.1}
          roughness={0.54}
          metalness={0.2}
        />
      </mesh>

      {visualStyle === 'arcade-button' && (
        <mesh castShadow position={[0, 0.03, depth * 0.82]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[Math.min(width, height) * 0.28, Math.min(width, height) * 0.38, 0.22, 32]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.15} roughness={0.35} metalness={0.25} />
        </mesh>
      )}

      {visualStyle === 'terminal-panel' && (
        <mesh position={[-width * 0.42, height * 0.39, depth * 0.82]}>
          <boxGeometry args={[0.11, 0.11, 0.04]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}

      <mesh position={[0, height / 2 + 0.035, depth * 0.25]}>
        <boxGeometry args={[width * 0.92, 0.035, 0.035]} />
        <meshBasicMaterial color={accent} />
      </mesh>

      <mesh position={[0, -height / 2 - 0.035, depth * 0.25]}>
        <boxGeometry args={[width * 0.92, 0.035, 0.035]} />
        <meshBasicMaterial color={accent} />
      </mesh>

      {object.type === 'slider' && (
        <group
          onPointerDown={handleSliderPointerDown}
          onPointerMove={handleSliderPointerMove}
          onPointerUp={() => setDraggingSlider(false)}
        >
          <mesh position={[0, -height * 0.21, depth * 0.72]}>
            <boxGeometry args={[width * 0.72, 0.08, 0.08]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          <mesh position={[-width * 0.36 + (width * 0.72 * sliderProgress) / 2, -height * 0.21, depth * 0.78]}>
            <boxGeometry args={[Math.max(0.05, width * 0.72 * sliderProgress), 0.06, 0.1]} />
            <meshBasicMaterial color={accent} />
          </mesh>
          <mesh position={[(sliderProgress - 0.5) * width * 0.72, -height * 0.21, depth * 0.9]}>
            <boxGeometry args={[0.16, 0.26, 0.12]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.1} />
          </mesh>
        </group>
      )}

      {object.type === 'toggle' && (
        <>
          <mesh position={[0, -height * 0.2, depth * 0.78]}>
            <boxGeometry args={[width * 0.46, 0.16, 0.1]} />
            <meshBasicMaterial color="#020617" />
          </mesh>
          <mesh position={[object.value === true ? width * 0.14 : -width * 0.14, -height * 0.2, depth * 0.94]}>
            <boxGeometry args={[0.22, 0.26, 0.16]} />
            <meshStandardMaterial color={object.value === true ? '#86efac' : '#94a3b8'} emissive={accent} emissiveIntensity={0.5} />
          </mesh>
        </>
      )}

      {(object.type === 'select' || object.type === 'multiselect') && object.options?.slice(0, 3).map((option, index) => {
        const selected = Array.isArray(object.value) ? object.value.includes(option.value) : object.value === option.value
        return (
          <mesh key={option.value} position={[-width * 0.27 + index * width * 0.27, -height * 0.23, depth * 0.78]}>
            <boxGeometry args={[width * 0.22, 0.13, 0.08]} />
            <meshBasicMaterial color={selected ? accent : '#0f172a'} />
          </mesh>
        )
      })}

      <EmbossedText
        position={[0, height / 2 + 0.25 + Math.max(0, labelLines.length - 1) * 0.08, depth * 0.84]}
        fontSize={object.type === 'button' ? 0.18 : isWidePanel ? 0.115 : 0.14}
        maxChars={labelMaxChars}
        maxLines={3}
        color={busy ? '#fecdd3' : accent}
      >
        {labelText}
      </EmbossedText>

      {object.type !== 'button' && (
        <EmbossedText
          position={[
            0,
            isWidePanel ? 0 : object.type === 'slider' || object.type === 'toggle' ? height * 0.05 : -height * 0.02,
            depth * 0.78,
          ]}
          fontSize={isWidePanel ? 0.095 : 0.18}
          maxChars={valueMaxChars}
          maxLines={isWidePanel ? 5 : 3}
          color="#e2e8f0"
        >
          {valueText}
        </EmbossedText>
      )}

      {object.description && object.type === 'button' && (
        <EmbossedText position={[0, -height * 0.28, depth * 0.78]} fontSize={0.075} maxChars={28} maxLines={2} color="#fecdd3">
          {object.description}
        </EmbossedText>
      )}

      {interactionHint && (
        <>
          <mesh position={[0, height / 2 + 0.62 + labelLines.length * 0.12, depth * 0.9]}>
            <boxGeometry args={[0.54, 0.24, 0.05]} />
            <meshStandardMaterial color="#020617" emissive={accent} emissiveIntensity={0.35} roughness={0.45} metalness={0.2} />
          </mesh>
          <EmbossedText position={[0, height / 2 + 0.62 + labelLines.length * 0.12, depth * 1.08]} fontSize={0.12} maxChars={2} color="#ffffff">
            F
          </EmbossedText>
        </>
      )}
    </group>
  )
}
