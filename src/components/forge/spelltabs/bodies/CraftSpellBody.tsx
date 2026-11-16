// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CRAFT SPELL BODY — Text-to-3D / LLM procedural-scene panel body
// ─═̷─ A trimmed-down craft surface for the standalone Text-to-3D spelltab.
// Reuses the same streaming craft endpoint and oasisStore.craftedScenes list
// as the Wizard Console's full Craft tab, so output lands in the same place. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useState } from 'react'
import { useOasisStore } from '../../../../store/oasisStore'
import { dispatch } from '../../../../lib/event-bus'
import { extractPartialCraftData } from '../../../../lib/craft-stream'
import { addToSceneLibrary, getSceneLibrary } from '../../../../lib/forge/scene-library'
import { generateSingleCraftedThumbnail } from '../../../../hooks/useThumbnailGenerator'
import { awardXp } from '../../../../hooks/useXp'
import { derivePlayerCastSpawn } from '../../../../lib/player-avatar-runtime'
import { CRAFT_MODEL_OPTIONS } from '../../../../lib/craft-models'
import { CraftedGallery, galleryScenes } from '../../CraftedGallery'
import type { CraftedScene } from '../../../../lib/conjure/types'
import { CollapsibleSection, scrollIntoViewOnFocus } from '../SpellTabFrame'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export interface CraftSpellBodyProps {
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
}

export function CraftSpellBody({ defaultExpandNew = true, defaultExpandGallery = true }: CraftSpellBodyProps) {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const addCraftedScene = useOasisStore(s => s.addCraftedScene)
  const updateCraftedScene = useOasisStore(s => s.updateCraftedScene)
  const craftModel = useOasisStore(s => s.craftModel)
  const setCraftModel = useOasisStore(s => s.setCraftModel)
  const setCraftingState = useOasisStore(s => s.setCraftingState)

  const [prompt, setPrompt] = useState('')
  const [activeCrafts, setActiveCrafts] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [expandNew, setExpandNew] = useState(defaultExpandNew)
  const [expandGallery, setExpandGallery] = useState(defaultExpandGallery)

  const handleCraft = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    setError(null)
    setPrompt('')
    setActiveCrafts(n => n + 1)
    setCraftingState(true, text)
    const originWorldId = useOasisStore.getState().activeWorldId

    const sceneId = `craft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const spawn = derivePlayerCastSpawn(4)
    const placeholderScene: CraftedScene = {
      id: sceneId,
      name: 'Crafting...',
      prompt: text,
      objects: [],
      position: spawn.position,
      model: craftModel,
      createdAt: new Date().toISOString(),
    }

    try {
      const res = await fetch(`${OASIS_BASE}/api/craft/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, model: craftModel }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Craft failed' }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      if (!res.body) throw new Error('No stream body')

      if (useOasisStore.getState().activeWorldId === originWorldId) {
        addCraftedScene(placeholderScene)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let lastObjectCount = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        const partial = extractPartialCraftData(accumulated)
        if (partial.name && partial.name !== 'Crafting...') {
          updateCraftedScene(sceneId, { name: partial.name })
        }
        if (partial.objects.length > lastObjectCount) {
          updateCraftedScene(sceneId, { objects: [...partial.objects] })
          lastObjectCount = partial.objects.length
        }
      }

      const finalParsed = extractPartialCraftData(accumulated)
      if (finalParsed.objects.length === 0) {
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
        throw new Error('LLM returned no valid objects')
      }
      const finalScene: CraftedScene = {
        id: sceneId,
        name: finalParsed.name || 'Unnamed Scene',
        prompt: text,
        objects: finalParsed.objects,
        position: spawn.position,
        createdAt: placeholderScene.createdAt,
        model: craftModel,
      }
      updateCraftedScene(sceneId, { name: finalScene.name, objects: finalScene.objects })
      addToSceneLibrary(finalScene).then(() =>
        getSceneLibrary().then(lib => useOasisStore.setState({ sceneLibrary: lib })),
      )
      generateSingleCraftedThumbnail(finalScene).catch(() => {})
      awardXp('CRAFT_SCENE', originWorldId)
      dispatch({ type: 'SAVE_WORLD' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Craft failed')
      const existing = useOasisStore.getState().craftedScenes.find(s => s.id === sceneId)
      if (existing && existing.objects.length === 0) {
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
      }
    } finally {
      setActiveCrafts(n => {
        const next = n - 1
        if (next <= 0) setCraftingState(false)
        return Math.max(0, next)
      })
    }
  }, [prompt, craftModel, addCraftedScene, updateCraftedScene, setCraftingState])

  return (
    <div className="space-y-2">
      <CollapsibleSection
        label="New Craft"
        accentColor="#60A5FA"
        expanded={expandNew}
        onToggle={() => setExpandNew(e => !e)}
        rightSlot={CRAFT_MODEL_OPTIONS.find(m => m.id === craftModel)?.label || craftModel}
      >
        <select
          value={craftModel}
          onChange={e => setCraftModel(e.target.value)}
          className="w-full text-[10px] bg-black/60 border border-blue-500/30 rounded px-2 py-1 text-blue-200 font-mono focus:outline-none focus:border-blue-400/60 cursor-pointer"
        >
          {CRAFT_MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          rows={3}
          placeholder="craft a red house with a blue door and chimney..."
          className="w-full text-xs bg-black/60 border border-blue-500/30 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-400/60 font-mono"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-blue-400/60 font-mono">
            Streaming LLM scene composer
          </span>
          <button
            onClick={handleCraft}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(59, 130, 246, 0.3)',
              color: '#93C5FD',
              border: '1px solid rgba(59, 130, 246, 0.5)',
            }}
          >
            {activeCrafts > 0 ? `Craft (${activeCrafts})` : 'Craft ⚙'}
          </button>
        </div>

        {error && (
          <div className="text-[10px] text-red-400 font-mono">{error}</div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label={`Gallery (${galleryScenes(craftedScenes, sceneLibrary).length})`}
        accentColor="#60A5FA"
        expanded={expandGallery}
        onToggle={() => setExpandGallery(e => !e)}
      >
        {/* Thumbnails, not names: click places, ⓘ opens the rotating preview (CraftedGallery). */}
        <CraftedGallery defaultColumns={3} />
      </CollapsibleSection>
    </div>
  )
}
