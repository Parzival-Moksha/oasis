'use client'

import { useState, useCallback, Suspense, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import { extractModelStats, type ModelStats } from './ModelPreview'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

const AVATAR_GALLERY = [
  { id: 'orion', file: 'Orion.vrm', name: 'Orion', color: '#60A5FA' },
  { id: 'cool_alien', file: 'CoolAlien.vrm', name: 'Cool Alien', color: '#34D399' },
  { id: 'binky', file: 'Binky_Cranberry.vrm', name: 'Binky Cranberry', color: '#F472B6' },
  { id: 'mushy', file: 'Mushy.vrm', name: 'Mushy', color: '#A78BFA' },
  { id: 'vipe_2723', file: 'VIPE_Hero__2723.vrm', name: 'VIPE Hero 2723', color: '#FBBF24' },
  { id: 'vipe_2784', file: 'VIPE_Hero__2784.vrm', name: 'VIPE Hero 2784', color: '#FB923C' },
  { id: 'vipe_2799', file: 'VIPE_Hero__2799.vrm', name: 'VIPE Hero 2799', color: '#F87171' },
  { id: 'munch', file: 'Munch_Gingerbread.vrm', name: 'Munch Gingerbread', color: '#D97706' },
  { id: 'gary', file: 'GARY_GRIFTER_1_0.vrm', name: 'Gary Grifter', color: '#6366F1' },
  { id: 'steamboat', file: 'STEAMBOAT_SUMMER.vrm', name: 'Steamboat Summer', color: '#14B8A6' },
  { id: 'eye_diviner', file: 'EYE_Diviner.vrm', name: 'Eye Diviner', color: '#8B5CF6' },
  { id: 'king_mutatio', file: 'King_Mutatio.vrm', name: 'King Mutatio', color: '#EF4444' },
  { id: 'crustybutt', file: 'Crustybutt_da_king.vrm', name: 'Crustybutt da King', color: '#CA8A04' },
  { id: 'harvester', file: 'Harvester__Summer.vrm', name: 'Harvester Summer', color: '#059669' },
  { id: 'esktix', file: 'Esktix__Magma.vrm', name: 'Esktix Magma', color: '#DC2626' },
  { id: 'grifter_squad', file: 'Grifter_Squaddie__764.vrm', name: 'Grifter Squaddie', color: '#7C3AED' },
  { id: 'mimic_slime', file: 'Mimic_Slime__Classic.vrm', name: 'Mimic Slime', color: '#10B981' },
  { id: 'the_worm', file: 'The_Worm.vrm', name: 'The Worm', color: '#78716C' },
  { id: 'anna', file: 'Anna.vrm', name: 'Anna', color: '#F9A8D4' },
  { id: 'bruno', file: 'Bruno.vrm', name: 'Bruno', color: '#6EE7B7' },
  { id: 'david', file: 'David.vrm', name: 'David', color: '#93C5FD' },
  { id: 'eugenia', file: 'Eugenia.vrm', name: 'Eugenia', color: '#FDE68A' },
  { id: 'amazonas', file: 'Amazonas.vrm', name: 'Amazonas', color: '#6EE7B7' },
  { id: 'cookieman', file: 'Cookieman.vrm', name: 'Cookieman', color: '#D97706' },
  { id: 'cool_cow', file: 'CoolCow.vrm', name: 'Cool Cow', color: '#F3F4F6' },
  { id: 'cool_cyclops', file: 'CoolCyclops.vrm', name: 'Cool Cyclops', color: '#818CF8' },
  { id: 'cool_guitar', file: 'CoolGuitar.vrm', name: 'Cool Guitar', color: '#F87171' },
  { id: 'cool_radish', file: 'CoolRadish.vrm', name: 'Cool Radish', color: '#FB923C' },
  { id: 'cool_spaguetti', file: 'CoolSpaguetti.vrm', name: 'Cool Spaguetti', color: '#FBBF24' },
  { id: 'cosmic_bot', file: 'CosmicBot.vrm', name: 'Cosmic Bot', color: '#A78BFA' },
  { id: 'cute_moth', file: 'CuteMoth.vrm', name: 'Cute Moth', color: '#F9A8D4' },
  { id: 'cyberpal', file: 'Cyberpal.vrm', name: 'Cyberpal', color: '#22D3EE' },
  { id: 'dream_eater', file: 'DreamEater.vrm', name: 'Dream Eater', color: '#8B5CF6' },
  { id: 'eye_cleric', file: 'EYECleric.vrm', name: 'Eye Cleric', color: '#34D399' },
  { id: 'good_knight', file: 'GoodKnight.vrm', name: 'Good Knight', color: '#94A3B8' },
  { id: 'hodler_king', file: 'HodlerKing.vrm', name: 'Hodler King', color: '#FBBF24' },
  { id: 'mocking_spit', file: 'Mocking_Spit__Sea_Sick.vrm', name: 'Mocking Spit', color: '#6EE7B7' },
  { id: 'mushroom_fairy', file: 'MushroomFairy.vrm', name: 'Mushroom Fairy', color: '#F472B6' },
  { id: 'pitcher_dude', file: 'PitcherDude.vrm', name: 'Pitcher Dude', color: '#60A5FA' },
  { id: 'ripped_jimbo', file: 'RippedJimbo.vrm', name: 'Ripped Jimbo', color: '#EF4444' },
  { id: 'sport_tv', file: 'SportTV.vrm', name: 'Sport TV', color: '#14B8A6' },
  { id: 'stingcake', file: 'Stingcake.vrm', name: 'Stingcake', color: '#FB923C' },
  { id: 'unicorn_person', file: 'UnicornPerson.vrm', name: 'Unicorn Person', color: '#E879F9' },
]

const PREVIEW_BACKDROPS = [
  { id: 'midnight', label: 'Midnight', background: 'radial-gradient(circle at top, rgba(76,29,149,0.9), rgba(3,7,18,0.96) 60%)' },
  { id: 'teal', label: 'Teal Lab', background: 'radial-gradient(circle at top, rgba(20,184,166,0.45), rgba(6,11,20,0.96) 62%)' },
  { id: 'sunset', label: 'Sunset', background: 'radial-gradient(circle at top, rgba(251,146,60,0.45), rgba(17,24,39,0.96) 62%)' },
] as const

function avatarFallbackGlyph(name: string): string {
  if (name.includes('Alien')) return '\u{1F47D}'
  if (name.includes('Worm')) return '\u{1FAB1}'
  if (name.includes('Slime')) return '\u{1FAE0}'
  if (name.includes('Mushy')) return '\u{1F344}'
  if (name.includes('Gingerbread')) return '\u{1F36A}'
  if (name.includes('Eye')) return '\u{1F441}\uFE0F'
  if (name.includes('King') || name.includes('king')) return '\u{1F451}'
  if (name.includes('Hero')) return '\u2694\uFE0F'
  if (name.includes('Magma')) return '\u{1F30B}'
  return '\u{1F9D1}'
}

function VRMPreview({ url, onStats }: { url: string; onStats?: (stats: ModelStats) => void }) {
  const vrmRef = useRef<VRM | null>(null)
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) return
    VRMUtils.rotateVRM0(vrm)
    vrmRef.current = vrm
    onStats?.(extractModelStats(vrm.scene, gltf.animations || []))
  }, [gltf, onStats])

  useFrame((_, delta) => {
    vrmRef.current?.update(delta)
  })

  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) return null

  const { center, fitScale } = (() => {
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const size = box.getSize(new THREE.Vector3())
    const c = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    return { center: c, fitScale: maxDim > 0 ? 2.2 / maxDim : 1 }
  })()

  return (
    <group scale={fitScale} position={[-center.x * fitScale, -center.y * fitScale + 0.1, -center.z * fitScale]}>
      <primitive object={vrm.scene} />
    </group>
  )
}

interface AvatarGalleryProps {
  currentAvatarUrl: string | null
  onSelect: (avatarUrl: string | null) => void
  onClose: () => void
}

async function renderVrmThumbnail(vrmUrl: string): Promise<Blob> {
  const size = 256
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(size, size)
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1)
  dirLight.position.set(3, 5, 3)
  scene.add(dirLight)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await loader.loadAsync(vrmUrl)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('No VRM data')
  VRMUtils.rotateVRM0(vrm)

  const box = new THREE.Box3().setFromObject(vrm.scene)
  const modelSize = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z)
  const fitScale = maxDim > 0 ? 2.2 / maxDim : 1

  const group = new THREE.Group()
  group.scale.setScalar(fitScale)
  group.position.set(-center.x * fitScale, -center.y * fitScale + 0.1, -center.z * fitScale)
  group.add(vrm.scene)
  scene.add(group)

  camera.position.set(0, 1, 3)
  camera.lookAt(0, 1, 0)

  renderer.render(scene, camera)

  const canvas = renderer.domElement
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85)
  })

  renderer.dispose()
  scene.clear()
  return blob
}

export function AvatarGallery({ currentAvatarUrl, onSelect, onClose }: AvatarGalleryProps) {
  const [previewAvatar, setPreviewAvatar] = useState<typeof AVATAR_GALLERY[number] | null>(null)
  const [previewStats, setPreviewStats] = useState<ModelStats | null>(null)
  const [previewBackdrop, setPreviewBackdrop] = useState<typeof PREVIEW_BACKDROPS[number]['id']>('midnight')
  const [saving, setSaving] = useState(false)
  const [thumbIds, setThumbIds] = useState<Set<string>>(new Set())
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })

  const currentFile = currentAvatarUrl?.split('/').pop()
  const selectedAvatar = AVATAR_GALLERY.find(avatar => avatar.file === currentFile) || null
  const activeBackdrop = PREVIEW_BACKDROPS.find(entry => entry.id === previewBackdrop) || PREVIEW_BACKDROPS[0]

  useEffect(() => {
    fetch(`${OASIS_BASE}/api/avatar-thumbs`)
      .then(response => response.json())
      .then((ids: string[]) => setThumbIds(new Set(ids)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!previewAvatar) {
      setPreviewAvatar(selectedAvatar || AVATAR_GALLERY[0] || null)
    }
  }, [previewAvatar, selectedAvatar])

  useEffect(() => {
    setPreviewStats(null)
  }, [previewAvatar?.id])

  const handleSelect = useCallback(async (avatar: typeof AVATAR_GALLERY[number] | null) => {
    setSaving(true)
    onSelect(avatar ? `/avatars/gallery/${avatar.file}` : null)
    setSaving(false)
  }, [onSelect])

  const handleBatchGenerate = useCallback(async () => {
    const missing = AVATAR_GALLERY.filter(avatar => !thumbIds.has(avatar.id))
    if (missing.length === 0) return

    setBatchGenerating(true)
    setBatchProgress({ done: 0, total: missing.length })

    const newIds = new Set(thumbIds)
    for (let i = 0; i < missing.length; i++) {
      const avatar = missing[i]
      try {
        const blob = await renderVrmThumbnail(`/avatars/gallery/${avatar.file}`)
        const form = new FormData()
        form.append('id', avatar.id)
        form.append('thumbnail', blob, `${avatar.id}.jpg`)
        const response = await fetch(`${OASIS_BASE}/api/avatar-thumbs`, { method: 'PUT', body: form })
        if (response.ok) newIds.add(avatar.id)
      } catch (error) {
        console.warn(`[AvatarGallery] Thumb gen failed for ${avatar.name}:`, error)
      }
      setBatchProgress({ done: i + 1, total: missing.length })
    }

    setThumbIds(newIds)
    setBatchGenerating(false)
  }, [thumbIds])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(10px)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 980,
          maxWidth: '95vw',
          maxHeight: '90vh',
          background: 'rgba(7, 10, 18, 0.97)',
          border: '1px solid rgba(94, 234, 212, 0.22)',
          borderRadius: 18,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 30px 120px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: '#67e8f9', fontWeight: 700, letterSpacing: '0.08em' }}>
              CHOOSE YOUR AVATAR
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#7dd3fc80', fontFamily: 'monospace' }}>
              Shared selector for Hermes, Merlin, Anorak Pro, and future agent bodies
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleBatchGenerate}
              disabled={batchGenerating}
              style={{
                background: batchGenerating ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(20,184,166,0.3)',
                borderRadius: 6,
                padding: '4px 10px',
                color: batchGenerating ? '#14b8a6' : '#999',
                fontSize: 11,
                fontFamily: 'monospace',
                cursor: batchGenerating ? 'default' : 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
              title="Generate thumbnails for all avatars"
            >
              {batchGenerating ? `${batchProgress.done}/${batchProgress.total}` : '\u{1F4F7} Generate All Thumbnails'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                fontSize: 20,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              width: 360,
              padding: 16,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
              alignContent: 'start',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <button
              onClick={() => { void handleSelect(null) }}
              style={{
                background: !currentAvatarUrl ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${!currentAvatarUrl ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12,
                padding: 10,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 10,
                transition: 'all 0.15s',
                minHeight: 142,
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 10,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                }}
              >
                🚫
              </div>
              <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                <span style={{ fontSize: 10, color: !currentAvatarUrl ? '#EF4444' : '#cbd5e1', lineHeight: 1.2, fontWeight: 700 }}>
                  No Avatar
                </span>
                <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
                  remove shared body
                </span>
              </div>
            </button>

            {AVATAR_GALLERY.map(avatar => {
              const isSelected = currentFile === avatar.file
              const isPreviewing = previewAvatar?.id === avatar.id
              return (
                <button
                  key={avatar.id}
                  onClick={() => setPreviewAvatar(avatar)}
                  onDoubleClick={() => { void handleSelect(avatar) }}
                  style={{
                    background: isPreviewing
                      ? 'rgba(168,85,247,0.2)'
                      : isSelected
                        ? 'rgba(34,197,94,0.15)'
                        : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isPreviewing ? 'rgba(168,85,247,0.5)' : isSelected ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 12,
                    padding: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 10,
                    transition: 'all 0.15s',
                    minHeight: 142,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 10,
                      background: `linear-gradient(135deg, ${avatar.color}40, ${avatar.color}20)`,
                      border: `1px solid ${avatar.color}55`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 28,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {thumbIds.has(avatar.id) ? (
                      <img
                        src={`/avatars/gallery/thumbs/${avatar.id}.jpg`}
                        alt={avatar.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      avatarFallbackGlyph(avatar.name)
                    )}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          padding: '2px 5px',
                          borderRadius: 999,
                          background: 'rgba(15,23,42,0.82)',
                          border: '1px solid rgba(34,197,94,0.32)',
                          color: '#22C55E',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                        }}
                      >
                        ACTIVE
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                    <span style={{ fontSize: 10, color: isPreviewing ? '#A855F7' : '#e2e8f0', lineHeight: 1.2, fontWeight: isPreviewing ? 700 : 600 }}>
                      {avatar.name}
                    </span>
                    <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace', lineHeight: 1.2 }}>
                      {avatar.file}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {previewAvatar ? (
              <>
                <div style={{ flex: 1, minHeight: 360, position: 'relative', background: activeBackdrop.background }}>
                  <Canvas camera={{ position: [0, 1, 3], fov: 35 }} style={{ background: 'transparent' }}>
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[3, 5, 3]} intensity={1} />
                    <Suspense fallback={null}>
                      <VRMPreview
                        key={previewAvatar.id}
                        url={`/avatars/gallery/${previewAvatar.file}`}
                        onStats={setPreviewStats}
                      />
                    </Suspense>
                    <OrbitControls enablePan={false} minDistance={1.5} maxDistance={6} target={[0, 1, 0]} />
                  </Canvas>
                </div>

                <div
                  style={{
                    padding: 18,
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 170px',
                    gap: 18,
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 18, color: '#fff', fontWeight: 700 }}>{previewAvatar.name}</p>
                    <p style={{ margin: '4px 0 12px', fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                      /avatars/gallery/{previewAvatar.file}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
                      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Triangles</div>
                        <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>{previewStats?.triangles?.toLocaleString() || '—'}</div>
                      </div>
                      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Vertices</div>
                        <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>{previewStats?.vertices?.toLocaleString() || '—'}</div>
                      </div>
                      <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Size</div>
                        <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>
                          {previewStats ? `${previewStats.dimensions.w} × ${previewStats.dimensions.h} × ${previewStats.dimensions.d}` : '—'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                      {PREVIEW_BACKDROPS.map(backdrop => (
                        <button
                          key={backdrop.id}
                          onClick={() => setPreviewBackdrop(backdrop.id)}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${previewBackdrop === backdrop.id ? 'rgba(103,232,249,0.5)' : 'rgba(148,163,184,0.18)'}`,
                            background: previewBackdrop === backdrop.id ? 'rgba(8,47,73,0.55)' : 'rgba(15,23,42,0.7)',
                            color: previewBackdrop === backdrop.id ? '#67e8f9' : '#cbd5e1',
                            padding: '6px 10px',
                            fontSize: 10,
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                          }}
                        >
                          {backdrop.label}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => { void handleSelect(previewAvatar) }}
                      disabled={saving || currentFile === previewAvatar.file}
                      style={{
                        width: '100%',
                        padding: '10px 0',
                        borderRadius: 6,
                        border: 'none',
                        background: currentFile === previewAvatar.file
                          ? 'rgba(34,197,94,0.2)'
                          : 'linear-gradient(135deg, #0f766e, #164e63)',
                        color: currentFile === previewAvatar.file ? '#22C55E' : '#fff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: currentFile === previewAvatar.file ? 'default' : 'pointer',
                      }}
                    >
                      {currentFile === previewAvatar.file ? '✓ Current Avatar' : saving ? 'Saving...' : 'Select Avatar'}
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                    {[
                      ['Meshes', previewStats?.meshCount],
                      ['Materials', previewStats?.materialCount],
                      ['Bones', previewStats?.boneCount],
                      ['Clips', previewStats?.clips?.length ?? 0],
                    ].map(([label, value]) => (
                      <div key={label} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                        <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                        <div style={{ marginTop: 4, fontSize: 14, color: '#f8fafc', fontWeight: 700 }}>{value || '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                  Click an avatar to preview.
                  <br />
                  Double-click to select instantly.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
