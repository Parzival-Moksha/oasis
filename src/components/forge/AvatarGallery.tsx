'use client'

// Avatar Gallery — "Pick Your Look" character select grid
// Shows VRM avatars from public/avatars/gallery/, user clicks to select
// Selected avatar gets saved to profile and rendered in world

import { useState, useCallback, Suspense, useRef, useEffect } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'

// Gallery entries — curated from opensourceavatars.com (CC0)
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
]

// Mini VRM preview for the 3D preview panel
function VRMPreview({ url }: { url: string }) {
  const vrmRef = useRef<VRM | null>(null)

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    const v = gltf.userData.vrm as VRM | undefined
    if (!v) return
    VRMUtils.rotateVRM0(v)
    vrmRef.current = v
  }, [gltf])

  useFrame((_, delta) => {
    vrmRef.current?.update(delta)
  })

  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) return null

  // Auto-fit: compute bounding box and center/scale
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

export function AvatarGallery({ currentAvatarUrl, onSelect, onClose }: AvatarGalleryProps) {
  const [previewAvatar, setPreviewAvatar] = useState<typeof AVATAR_GALLERY[0] | null>(null)
  const [saving, setSaving] = useState(false)

  const currentFile = currentAvatarUrl?.split('/').pop()

  const handleSelect = useCallback(async (avatar: typeof AVATAR_GALLERY[0]) => {
    setSaving(true)
    const url = `/avatars/gallery/${avatar.file}`
    onSelect(url)
    setSaving(false)
  }, [onSelect])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 720,
          maxWidth: '95vw',
          maxHeight: '90vh',
          background: 'rgba(10,5,20,0.95)',
          border: '1px solid rgba(168,85,247,0.3)',
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: '#A855F7', fontWeight: 700, letterSpacing: '0.05em' }}>
              CHOOSE YOUR AVATAR
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
              CC0 avatars from opensourceavatars.com
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#666', fontSize: 20,
              cursor: 'pointer', padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Grid */}
          <div style={{
            flex: 1,
            padding: 16,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8,
            alignContent: 'start',
          }}>
            {/* Remove avatar option */}
            <button
              onClick={() => onSelect(null)}
              style={{
                background: !currentAvatarUrl ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${!currentAvatarUrl ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8,
                padding: '12px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(239,68,68,0.1)',
                border: '2px solid rgba(239,68,68,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}>
                🚫
              </div>
              <span style={{
                fontSize: 9, color: !currentAvatarUrl ? '#EF4444' : '#999',
                textAlign: 'center', lineHeight: 1.2,
              }}>
                No Avatar
              </span>
            </button>
            {AVATAR_GALLERY.map(avatar => {
              const isSelected = currentFile === avatar.file
              const isPreviewing = previewAvatar?.id === avatar.id
              return (
                <button
                  key={avatar.id}
                  onClick={() => setPreviewAvatar(avatar)}
                  onDoubleClick={() => handleSelect(avatar)}
                  style={{
                    background: isPreviewing
                      ? 'rgba(168,85,247,0.2)'
                      : isSelected
                        ? 'rgba(34,197,94,0.15)'
                        : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isPreviewing ? 'rgba(168,85,247,0.5)' : isSelected ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 8,
                    padding: '12px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                  }}
                >
                  {/* Avatar icon placeholder */}
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: `linear-gradient(135deg, ${avatar.color}40, ${avatar.color}20)`,
                    border: `2px solid ${avatar.color}60`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                  }}>
                    {avatar.name.includes('Alien') ? '👽' :
                     avatar.name.includes('Worm') ? '🪱' :
                     avatar.name.includes('Slime') ? '🫠' :
                     avatar.name.includes('Mushy') ? '🍄' :
                     avatar.name.includes('Gingerbread') ? '🍪' :
                     avatar.name.includes('Eye') ? '👁️' :
                     avatar.name.includes('King') || avatar.name.includes('king') ? '👑' :
                     avatar.name.includes('Hero') ? '⚔️' :
                     avatar.name.includes('Magma') ? '🌋' :
                     '🧑'}
                  </div>
                  <span style={{
                    fontSize: 9, color: isPreviewing ? '#A855F7' : '#999',
                    textAlign: 'center', lineHeight: 1.2,
                    fontWeight: isPreviewing ? 600 : 400,
                  }}>
                    {avatar.name}
                  </span>
                  {isSelected && (
                    <span style={{ fontSize: 8, color: '#22C55E', fontWeight: 700 }}>ACTIVE</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Preview panel */}
          <div style={{
            width: 260,
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {previewAvatar ? (
              <>
                {/* 3D preview */}
                <div style={{ flex: 1, minHeight: 300, position: 'relative' }}>
                  <Canvas
                    camera={{ position: [0, 1, 3], fov: 35 }}
                    style={{ background: 'rgba(0,0,0,0.3)' }}
                  >
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[3, 5, 3]} intensity={1} />
                    <Suspense fallback={null}>
                      <VRMPreview
                        key={previewAvatar.id}
                        url={`/avatars/gallery/${previewAvatar.file}`}
                      />
                    </Suspense>
                    <OrbitControls
                      enablePan={false}
                      minDistance={1.5}
                      maxDistance={6}
                      target={[0, 1, 0]}
                    />
                  </Canvas>
                </div>
                {/* Info + select button */}
                <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <p style={{ margin: 0, fontSize: 14, color: '#fff', fontWeight: 600 }}>
                    {previewAvatar.name}
                  </p>
                  <p style={{ margin: '4px 0 12px', fontSize: 10, color: '#666' }}>
                    Click &amp; drag to rotate preview
                  </p>
                  <button
                    onClick={() => handleSelect(previewAvatar)}
                    disabled={saving || currentFile === previewAvatar.file}
                    style={{
                      width: '100%',
                      padding: '10px 0',
                      borderRadius: 6,
                      border: 'none',
                      background: currentFile === previewAvatar.file
                        ? 'rgba(34,197,94,0.2)'
                        : 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                      color: currentFile === previewAvatar.file ? '#22C55E' : '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: currentFile === previewAvatar.file ? 'default' : 'pointer',
                    }}
                  >
                    {currentFile === previewAvatar.file ? '✓ Current Avatar' : saving ? 'Saving...' : 'Select Avatar'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20, textAlign: 'center',
              }}>
                <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
                  Click an avatar to preview<br />
                  Double-click to select instantly
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
