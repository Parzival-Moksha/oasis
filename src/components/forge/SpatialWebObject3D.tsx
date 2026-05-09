'use client'

import { Center, Text3D } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useContext, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { useOasisStore } from '@/store/oasisStore'
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
              bevelEnabled
              bevelThickness={fontSize * 0.035}
              bevelSize={fontSize * 0.018}
              bevelSegments={3}
              curveSegments={5}
            >
              {line}
              <meshStandardMaterial
                attach="material-0"
                color={color}
                emissive={color}
                emissiveIntensity={0.48}
                metalness={0.16}
                roughness={0.34}
              />
              <meshStandardMaterial
                attach="material-1"
                color={darkSide}
                emissive={darkSide}
                emissiveIntensity={0.14}
                metalness={0.76}
                roughness={0.24}
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
  const height = object.height ?? (object.type === 'output' || object.type === 'text' ? 1.05 : 0.82)
  const labelValue = valueForLabel(object)
  const isWidePanel = object.type === 'output' || object.type === 'text'
  const visualStyle = object.visualStyle
    || (object.type === 'button' ? 'arcade-button'
      : object.type === 'slider' ? 'glass-slider'
        : isWidePanel ? 'terminal-panel'
          : 'neon-panel')
  const isPortalButton = visualStyle === 'portal-zero-button'
  const depth = isPortalButton ? 0.34 : visualStyle === 'arcade-button' ? 0.42 : visualStyle === 'terminal-panel' ? 0.18 : 0.24

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
    const waitsForNetwork = object.type === 'button' && object.action?.type === 'submit_form'
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
    setPointerCapture(event)
    setDraggingSlider(true)
    updateSliderFromPointer(event)
  }

  const handleSliderPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!draggingSlider) return
    event.stopPropagation()
    updateSliderFromPointer(event)
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
        position={[
          0,
          isWidePanel ? height * 0.28 : object.type === 'button' ? 0.05 : height * 0.22,
          depth * 0.76,
        ]}
        fontSize={object.type === 'button' ? 0.18 : isWidePanel ? 0.12 : 0.135}
        maxChars={isWidePanel ? 38 : 28}
        maxLines={isWidePanel ? 2 : 2}
        color={busy ? '#fecdd3' : accent}
      >
        {busy ? 'Sending...' : object.label}
      </EmbossedText>

      {object.type !== 'button' && (
        <EmbossedText
          position={[
            0,
            isWidePanel ? height * 0.07 : object.type === 'slider' || object.type === 'toggle' ? height * 0.02 : -height * 0.03,
            depth * 0.78,
          ]}
          fontSize={isWidePanel ? 0.095 : 0.18}
          maxChars={isWidePanel ? 42 : 26}
          maxLines={isWidePanel ? 4 : 2}
          color="#e2e8f0"
        >
          {object.type === 'text' && !object.value ? object.placeholder || 'Empty' : labelValue}
        </EmbossedText>
      )}

      {object.description && object.type === 'button' && (
        <EmbossedText position={[0, -height * 0.28, depth * 0.78]} fontSize={0.075} maxChars={28} maxLines={2} color="#fecdd3">
          {object.description}
        </EmbossedText>
      )}

      {interactionHint && (
        <>
          <mesh position={[0, height / 2 + 0.34, depth * 0.9]}>
            <boxGeometry args={[0.54, 0.24, 0.05]} />
            <meshStandardMaterial color="#020617" emissive={accent} emissiveIntensity={0.35} roughness={0.45} metalness={0.2} />
          </mesh>
          <EmbossedText position={[0, height / 2 + 0.34, depth * 1.08]} fontSize={0.12} maxChars={2} color="#ffffff">
            F
          </EmbossedText>
        </>
      )}
    </group>
  )
}
