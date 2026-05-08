'use client'

import { Text } from '@react-three/drei'
import { useMemo, useState } from 'react'
import * as THREE from 'three'

import { useOasisStore } from '@/store/oasisStore'
import {
  SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT,
  buildSpatialWebSubmission,
  summarizeSpatialWebSubmission,
  type SpatialWebObject,
  type SpatialWebValue,
} from '@/lib/spatial-web'

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

function nextCycledOption(object: SpatialWebObject): string {
  const options = object.options || []
  if (options.length === 0) return ''
  const current = typeof object.value === 'string' ? object.value : ''
  const currentIndex = options.findIndex(option => option.value === current)
  return options[(currentIndex + 1) % options.length]?.value || options[0].value
}

function nextMultiSelectValue(object: SpatialWebObject): string[] {
  const options = object.options || []
  if (options.length === 0) return []
  const selected = Array.isArray(object.value) ? object.value.filter((value): value is string => typeof value === 'string') : []
  if (selected.length >= options.length) return []
  const next = options.find(option => !selected.includes(option.value))
  return next ? [...selected, next.value] : selected
}

function nextSliderValue(object: SpatialWebObject): number {
  const min = object.min ?? 0
  const max = object.max ?? 100
  const step = object.step ?? 1
  const current = typeof object.value === 'number' ? object.value : min
  const next = current + step
  return next > max ? min : next
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

function SpatialText({
  children,
  position,
  fontSize,
  maxWidth,
  color = '#f8fafc',
  anchorX = 'center',
  anchorY = 'middle',
}: {
  children: string
  position: [number, number, number]
  fontSize: number
  maxWidth: number
  color?: string
  anchorX?: 'left' | 'center' | 'right'
  anchorY?: 'top' | 'middle' | 'bottom'
}) {
  return (
    <Text
      position={position}
      fontSize={fontSize}
      maxWidth={maxWidth}
      anchorX={anchorX}
      anchorY={anchorY}
      textAlign={anchorX === 'center' ? 'center' : 'left'}
      color={color}
      outlineWidth={0.006}
      outlineColor="#020617"
    >
      {children}
    </Text>
  )
}

export function SpatialWebObject3D({ object }: { object: SpatialWebObject }) {
  const [busy, setBusy] = useState(false)
  const setValue = useOasisStore(s => s.setSpatialWebObjectValue)
  const updateObject = useOasisStore(s => s.updateSpatialWebObject)
  const spawnPlacementVfx = useOasisStore(s => s.spawnPlacementVfx)
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)

  const accent = normalizeHex(object.accentColor, '#38bdf8')
  const width = object.width ?? (object.type === 'button' ? 2.2 : 2.6)
  const height = object.height ?? (object.type === 'output' || object.type === 'text' ? 1.05 : 0.82)
  const labelValue = valueForLabel(object)
  const isWidePanel = object.type === 'output' || object.type === 'text'
  const depth = object.type === 'button' ? 0.34 : 0.22

  const material = useMemo(() => {
    const color = new THREE.Color(accent)
    const base = color.clone().multiplyScalar(object.type === 'button' ? 0.72 : 0.38)
    return {
      color: `#${base.getHexString()}`,
      emissive: accent,
      emissiveIntensity: object.type === 'button' ? 0.8 : 0.32,
    }
  }, [accent, object.type])

  const sliderProgress = useMemo(() => {
    if (object.type !== 'slider') return 0
    const min = object.min ?? 0
    const max = object.max ?? 100
    const current = typeof object.value === 'number' ? object.value : min
    if (max <= min) return 0
    return Math.min(1, Math.max(0, (current - min) / (max - min)))
  }, [object])

  const markSelected = () => {
    selectObject(object.id)
    setInspectedObject(object.id)
  }

  const submitForm = async () => {
    if (!object.formId || busy) return
    setBusy(true)
    const payload = buildSpatialWebSubmission(useOasisStore.getState().spatialWebObjects, object.formId)
    const endpoint = object.action?.endpoint || SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT
    let status = object.action?.successMessage || 'Submitted.'

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) status = `Submit failed: HTTP ${response.status}`
    } catch (error) {
      status = error instanceof Error ? `Submit failed: ${error.message}` : 'Submit failed.'
    }

    const receipt = `${status}\n\n${summarizeSpatialWebSubmission(payload)}`
    useOasisStore.getState().spatialWebObjects
      .filter(candidate => candidate.formId === object.formId && candidate.type === 'output' && candidate.id !== object.id)
      .forEach(candidate => updateObject(candidate.id, { value: receipt, submittedAt: payload.submittedAt }))
    updateObject(object.id, { submittedAt: payload.submittedAt })
    spawnPlacementVfx(object.position)
    setBusy(false)
  }

  const handleInteract = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    markSelected()

    switch (object.type) {
      case 'toggle':
        setValue(object.id, !(object.value === true))
        break
      case 'slider':
        setValue(object.id, nextSliderValue(object))
        break
      case 'select':
        setValue(object.id, nextCycledOption(object))
        break
      case 'multiselect':
        setValue(object.id, nextMultiSelectValue(object))
        break
      case 'button':
        if (object.action?.type === 'submit_form') void submitForm()
        else spawnPlacementVfx(object.position)
        break
      default:
        break
    }
  }

  return (
    <group onClick={handleInteract}>
      <mesh castShadow receiveShadow position={[0, 0, -0.03]}>
        <boxGeometry args={[width + 0.16, height + 0.16, depth * 0.52]} />
        <meshStandardMaterial
          color="#020617"
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

      <mesh position={[0, height / 2 + 0.035, depth * 0.25]}>
        <boxGeometry args={[width * 0.92, 0.035, 0.035]} />
        <meshBasicMaterial color={accent} />
      </mesh>

      <mesh position={[0, -height / 2 - 0.035, depth * 0.25]}>
        <boxGeometry args={[width * 0.92, 0.035, 0.035]} />
        <meshBasicMaterial color={accent} />
      </mesh>

      {object.type === 'slider' && (
        <>
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
        </>
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

      <SpatialText
        position={[
          isWidePanel ? -width * 0.43 : 0,
          isWidePanel ? height * 0.28 : object.type === 'button' ? 0.05 : height * 0.22,
          depth * 0.72,
        ]}
        fontSize={object.type === 'button' ? 0.19 : 0.105}
        maxWidth={width * (isWidePanel ? 0.86 : 0.82)}
        color={busy ? '#fecdd3' : accent}
        anchorX={isWidePanel ? 'left' : 'center'}
      >
        {clampText(busy ? 'Sending...' : object.label, object.type === 'button' ? 22 : 30)}
      </SpatialText>

      {object.type !== 'button' && (
        <SpatialText
          position={[
            isWidePanel ? -width * 0.43 : 0,
            isWidePanel ? height * 0.07 : object.type === 'slider' || object.type === 'toggle' ? height * 0.02 : -height * 0.03,
            depth * 0.74,
          ]}
          fontSize={isWidePanel ? 0.09 : 0.16}
          maxWidth={width * (isWidePanel ? 0.86 : 0.76)}
          color="#e2e8f0"
          anchorX={isWidePanel ? 'left' : 'center'}
        >
          {clampText(object.type === 'text' && !object.value ? object.placeholder || 'Empty' : labelValue, isWidePanel ? 72 : 28)}
        </SpatialText>
      )}

      {object.description && object.type === 'button' && (
        <SpatialText position={[0, -height * 0.28, depth * 0.74]} fontSize={0.075} maxWidth={width * 0.8} color="#fecdd3">
          {clampText(object.description, 32)}
        </SpatialText>
      )}
    </group>
  )
}
