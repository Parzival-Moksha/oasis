'use client'

// ░▒▓ ENVIRONMENT — the Wizard console's first page (owner, 2026-11-19 walkthrough 0:01–4:20) ▓▒░
// Four big items in this order: Lights, Background, Ground, Elevation. Ground is the texture half of the old
// "Terrain brush"; Elevation is its sculpting half. Every light slider reads 0 to 1 (src/lib/forge/light-scale.ts).
// Built only from Hipster's UI kit (src/components/ui-kit): the menu style switch in Settings restyles all of it.

import { useEffect, useState, type ReactNode } from 'react'
import { useOasisStore } from '@/store/oasisStore'
import { SKY_BACKGROUNDS } from '@/lib/sky-backgrounds'
import { GROUND_PRESETS, getTextureUrls, type GroundPreset } from '@/lib/forge/ground-textures'
import type { WorldLight, WorldLightType } from '@/lib/conjure/types'
import { intensityToSlider, sliderToIntensity } from '@/lib/forge/light-scale'
import { LightTooltipWrap } from './shared'
import { KitButton, KitCard, KitPickTile, KitSlider, KitTileButton } from '@/components/ui-kit'

export type EnvironmentSection = 'lights' | 'background' | 'ground' | 'elevation'

export const ENVIRONMENT_SECTIONS: { key: EnvironmentSection; label: string; icon: string; hint: string; accent: string; picture: string }[] = [
  { key: 'lights', label: 'Lights', icon: '💡', hint: 'Sun, sky glow and lamps', accent: '#facc15', picture: '/ui/spellbook/tiles/lights.gpt2.webp' },
  { key: 'background', label: 'Background', icon: '🌄', hint: 'The sky around the world', accent: '#818cf8', picture: '/ui/spellbook/tiles/sky-background.gpt2.webp' },
  { key: 'ground', label: 'Ground', icon: '🌱', hint: 'What the ground is made of', accent: '#34d399', picture: '/ui/spellbook/tiles/ground-texture.gpt2.webp' },
  { key: 'elevation', label: 'Elevation', icon: '⛰️', hint: 'Raise and lower the land', accent: '#fb923c', picture: '/ui/spellbook/tiles/ground-elevation.gpt2.webp' },
]

/** Plain text inside the kit's cards. */
const TEXT = 'text-[11px] opacity-80'

/** A picture for skies with no jpg of their own (HDR files and built-in presets). */
function skyPlaceholder(emoji: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#05060a"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><text x="80" y="58" font-size="34" text-anchor="middle">${emoji}</text></svg>`
  // Parentheses escaped too: the kit puts this inside an unquoted CSS url(...).
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29')}`
}

const SECTION_KEY = 'oasis-wizard-environment-section'

function readSection(): EnvironmentSection {
  if (typeof window === 'undefined') return 'lights'
  try {
    const raw = window.localStorage.getItem(SECTION_KEY)
    if (raw && ENVIRONMENT_SECTIONS.some(s => s.key === raw)) return raw as EnvironmentSection
  } catch { /* storage off */ }
  return 'lights'
}

// ─── a 0..1 slider: label and value side by side, readable ─────────────────

function UnitSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <KitSlider label={label} value={Math.round(value * 100) / 100} min={0} max={1} step={0.01} onChange={onChange} format={v => v.toFixed(2)} />
}

function DegreeSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  // Angles read 0..1 too: 0 is the low end of the range, 1 the high end.
  const unit = (value - min) / (max - min)
  return <UnitSlider label={label} value={Math.min(1, Math.max(0, unit))} onChange={p => onChange(min + p * (max - min))} />
}

const LIGHT_NAMES: Record<WorldLightType, { name: string; icon: string }> = {
  directional: { name: 'Sun', icon: '☀️' },
  ambient: { name: 'Ambient', icon: '🌤️' },
  hemisphere: { name: 'Sky glow', icon: '🌗' },
  environment: { name: 'Environment', icon: '🌐' },
  point: { name: 'Lamp', icon: '💡' },
  spot: { name: 'Spotlight', icon: '🔦' },
}

function directionOf(vec: [number, number, number] | undefined, fallback: [number, number, number]) {
  const v = vec || fallback
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1
  return {
    elevation: Math.asin(Math.min(1, Math.max(-1, v[1] / len))) * 180 / Math.PI,
    azimuth: ((Math.atan2(v[0], v[2]) * 180 / Math.PI) + 360) % 360,
  }
}

function fromDirection(azimuthDeg: number, elevationDeg: number, r: number): [number, number, number] {
  const a = azimuthDeg * Math.PI / 180
  const el = elevationDeg * Math.PI / 180
  return [r * Math.cos(el) * Math.sin(a), r * Math.sin(el), r * Math.cos(el) * Math.cos(a)]
}

function LightCard({ light, skyId }: { light: WorldLight; skyId: string }) {
  const updateWorldLight = useOasisStore(s => s.updateWorldLight)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)
  const meta = LIGHT_NAMES[light.type]
  const brightness = intensityToSlider(light.type, light.intensity, skyId)
  const sun = light.type === 'directional' ? directionOf(light.position, [30, 40, 20]) : null
  const spot = light.type === 'spot' ? directionOf(light.target, [0, -1, 0]) : null

  return (
    <LightTooltipWrap type={light.type} className="relative">
      <KitCard>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg leading-none">{meta.icon}</span>
          <span className="text-[13px] font-semibold">{meta.name}</span>
          {light.type !== 'environment' && (
            <input
              type="color"
              value={light.color}
              onChange={e => updateWorldLight(light.id, { color: e.target.value })}
              className="ml-1 h-5 w-6 cursor-pointer rounded border-0 bg-transparent"
              title="Colour"
            />
          )}
          {light.type === 'hemisphere' && (
            <input
              type="color"
              value={light.groundColor || '#3a5f0b'}
              onChange={e => updateWorldLight(light.id, { groundColor: e.target.value })}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent"
              title="Ground colour"
            />
          )}
          <KitButton className="ml-auto" onClick={() => removeWorldLight(light.id)} title="Remove this light">&#215;</KitButton>
        </div>
        <div className="space-y-2">
          <UnitSlider label="Brightness" value={brightness} onChange={p => updateWorldLight(light.id, { intensity: sliderToIntensity(light.type, p, skyId) })} />
          {sun && (
            <>
              <DegreeSlider label="Turn" value={sun.azimuth} min={0} max={360} onChange={a => updateWorldLight(light.id, { position: fromDirection(a, sun.elevation, 50) })} />
              <DegreeSlider label="Height" value={sun.elevation} min={5} max={90} onChange={el => updateWorldLight(light.id, { position: fromDirection(sun.azimuth, el, 50) })} />
            </>
          )}
          {spot && (
            <>
              <DegreeSlider label="Cone" value={light.angle ?? 45} min={5} max={90} onChange={angle => updateWorldLight(light.id, { angle })} />
              <DegreeSlider label="Turn" value={spot.azimuth} min={0} max={360} onChange={a => updateWorldLight(light.id, { target: fromDirection(a, spot.elevation, 1) })} />
              <DegreeSlider label="Tilt" value={spot.elevation} min={-90} max={90} onChange={el => updateWorldLight(light.id, { target: fromDirection(spot.azimuth, el, 1) })} />
            </>
          )}
        </div>
      </KitCard>
    </LightTooltipWrap>
  )
}

function LightsSection() {
  const worldLights = useOasisStore(s => s.worldLights)
  const addWorldLight = useOasisStore(s => s.addWorldLight)
  const skyId = useOasisStore(s => s.worldSkyBackground)
  const sceneLights = worldLights.filter(l => l.type !== 'point' && l.type !== 'spot')
  const placedLights = worldLights.filter(l => l.type === 'point' || l.type === 'spot')
  const adds: { type: WorldLightType; label: string }[] = [
    { type: 'directional', label: 'Sun' },
    { type: 'ambient', label: 'Ambient' },
    { type: 'hemisphere', label: 'Sky glow' },
    ...(worldLights.some(l => l.type === 'environment') ? [] : [{ type: 'environment' as const, label: 'Environment' }]),
    { type: 'point', label: 'Lamp' },
    { type: 'spot', label: 'Spotlight' },
  ]

  return (
    <div className="space-y-2">
      {sceneLights.map(light => <LightCard key={light.id} light={light} skyId={skyId} />)}
      {placedLights.map(light => <LightCard key={light.id} light={light} skyId={skyId} />)}
      {worldLights.length === 0 && <div className={`py-2 text-center ${TEXT}`}>No lights. The world is dark.</div>}
      <div className={`pt-1 ${TEXT}`}>Add a light</div>
      <div className="grid grid-cols-3 gap-1.5">
        {adds.map(add => (
          <LightTooltipWrap key={add.type} type={add.type} className="relative">
            <KitButton className="w-full" onClick={() => addWorldLight(add.type)}>
              {LIGHT_NAMES[add.type].icon} {add.label}
            </KitButton>
          </LightTooltipWrap>
        ))}
      </div>
    </div>
  )
}

function BackgroundSection() {
  const skyId = useOasisStore(s => s.worldSkyBackground)
  const setSky = useOasisStore(s => s.setWorldSkyBackground)
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {SKY_BACKGROUNDS.map(sky => {
        const picture = sky.path && sky.path.endsWith('.jpg') ? sky.path : skyPlaceholder('preset' in sky ? '🏙️' : sky.path ? '🌌' : '✨')
        return <KitPickTile key={sky.id} picture={picture} label={sky.name} selected={skyId === sky.id} accent="#818cf8" title={sky.name} onClick={() => setSky(sky.id)} />
      })}
    </div>
  )
}

function groundPicture(preset: GroundPreset): string {
  const src = preset.customTextureUrl || (preset.assetName ? getTextureUrls(preset.assetName).diffuse : null)
  return src || skyPlaceholder(preset.icon)
}

function GroundSection() {
  const groundPresetId = useOasisStore(s => s.groundPresetId)
  const setGroundPreset = useOasisStore(s => s.setGroundPreset)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const setTerrainBrushPanelOpen = useOasisStore(s => s.setTerrainBrushPanelOpen)
  const setTerrainBrushMode = useOasisStore(s => s.setTerrainBrushMode)
  const presets = [...GROUND_PRESETS, ...customGroundPresets.filter(c => !GROUND_PRESETS.some(p => p.id === c.id))]

  return (
    <div className="space-y-2">
      <div className={TEXT}>Click a ground to cover the whole world with it, or the brush to paint it by hand.</div>
      <div className="grid grid-cols-3 gap-1.5">
        {presets.map(preset => {
          const active = groundPresetId === preset.id
          return (
            <div key={preset.id} className="relative">
              <KitPickTile picture={groundPicture(preset)} label={preset.name} selected={active} accent="#34d399" title={preset.description || preset.name} onClick={() => setGroundPreset(preset.id)} className="w-full" />
              {preset.id !== 'none' && (
                <KitButton
                  className="absolute right-1 top-1"
                  onClick={() => { setTerrainBrushMode('texture'); setTerrainBrushPanelOpen(true); enterPaintMode(preset.id) }}
                  title={`Paint ${preset.name} by hand`}
                >
                  🖌️
                </KitButton>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ElevationSection() {
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const radius = useOasisStore(s => s.terrainBrushRadius)
  const intensity = useOasisStore(s => s.terrainBrushIntensity)
  const direction = useOasisStore(s => s.terrainBrushDirection)
  const setTerrainBrushPanelOpen = useOasisStore(s => s.setTerrainBrushPanelOpen)
  const setTerrainBrushMode = useOasisStore(s => s.setTerrainBrushMode)
  const shaped = terrainHeights.some(h => Math.abs(h) > 0.001)
  return (
    <div className="space-y-2">
      <KitButton variant="primary" className="w-full" onClick={() => { setTerrainBrushPanelOpen(true); setTerrainBrushMode('sculpt') }}>
        ⛰️ Shape the land
      </KitButton>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <KitCard title="Brush"><div className="text-[13px]">{direction}</div></KitCard>
        <KitCard title="Radius"><div className="text-[13px]">{radius.toFixed(1)} m</div></KitCard>
        <KitCard title="Strength"><div className="text-[13px]">{intensity.toFixed(1)}/s</div></KitCard>
      </div>
      <div className={TEXT}>{shaped ? 'This world has hills and valleys.' : 'This world is flat.'}</div>
    </div>
  )
}

export function EnvironmentTab({ footer }: { footer?: ReactNode }) {
  const [section, setSection] = useState<EnvironmentSection>('lights')
  useEffect(() => { setSection(readSection()) }, [])
  const choose = (key: EnvironmentSection) => {
    setSection(key)
    try { window.localStorage.setItem(SECTION_KEY, key) } catch { /* storage off */ }
  }

  return (
    <div className="space-y-3" data-wizard-environment>
      <div className="grid grid-cols-2 gap-2.5">
        {ENVIRONMENT_SECTIONS.map(item => {
          const active = section === item.key
          return (
              <KitTileButton
                key={item.key}
                selected={active}
                picture={item.picture}
                icon={item.icon}
                label={item.label}
                sub={item.hint}
                accent={item.accent}
                title={item.hint}
                data-environment-section={item.key}
                onClick={() => choose(item.key)}
                className="w-full"
                style={{ minHeight: 96 }}
              />
          )
        })}
      </div>
      {section === 'lights' && <LightsSection />}
      {section === 'background' && <BackgroundSection />}
      {section === 'ground' && <GroundSection />}
      {section === 'elevation' && <ElevationSection />}
      {footer}
    </div>
  )
}
