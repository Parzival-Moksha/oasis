// ═══════════════════════════════════════════════════════════════════════════════
// CRAFT TAB — LLM procedural geometry: prompt, streaming, scene list + library
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useCallback } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import type { CraftedScene } from '../../../lib/conjure/types'
import { dispatch } from '../../../lib/event-bus'
import { extractPartialCraftData } from '../../../lib/craft-stream'
import { addToSceneLibrary, getSceneLibrary } from '../../../lib/forge/scene-library'
import { generateSingleCraftedThumbnail } from '../../../hooks/useThumbnailGenerator'
import { CraftedGallery, galleryScenes } from '../CraftedGallery'
import { awardXp } from '../../../hooks/useXp'
import { derivePlayerCastSpawn } from '../../../lib/player-avatar-runtime'
import { CRAFT_MODEL_OPTIONS } from '../../../lib/craft-models'
import { OASIS_BASE } from './shared'

interface CraftTabProps {
  setError: (error: string | null) => void
}

export function CraftTabHeader({ setError }: CraftTabProps) {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const addCraftedScene = useOasisStore(s => s.addCraftedScene)
  const updateCraftedScene = useOasisStore(s => s.updateCraftedScene)
  const craftModel = useOasisStore(s => s.craftModel)
  const setCraftModel = useOasisStore(s => s.setCraftModel)
  const setCraftingState = useOasisStore(s => s.setCraftingState)

  const [craftPromptInput, setCraftPromptInput] = useState('')
  const [activeCrafts, setActiveCrafts] = useState(0)
  const [craftHistory, setCraftHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])


  const handleCraft = useCallback(async () => {
    if (!craftPromptInput.trim()) return
    setError(null)
    const craftPrompt = craftPromptInput.trim()
    setCraftPromptInput('')
    setActiveCrafts(n => n + 1)
    setCraftingState(true, craftPrompt)
    const originWorldId = useOasisStore.getState().activeWorldId

    const currentCraftedScenes = useOasisStore.getState().craftedScenes
    const lastScene = currentCraftedScenes[currentCraftedScenes.length - 1]
    const iterativePrompt = lastScene && craftHistory.length > 0
      ? `Previous scene "${lastScene.name}" had ${lastScene.objects.length} objects: ${JSON.stringify(lastScene.objects.slice(0, 5))}...\n\nUser wants: ${craftPrompt}`
      : craftPrompt

    const sceneId = `craft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const spawn = derivePlayerCastSpawn(4)
    const placeholderScene: CraftedScene = {
      id: sceneId,
      name: 'Crafting...',
      prompt: craftPrompt,
      objects: [],
      position: spawn.position,
      model: craftModel,
      createdAt: new Date().toISOString(),
    }

    try {
      const res = await fetch(`${OASIS_BASE}/api/craft/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: iterativePrompt, model: craftModel }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || `HTTP ${res.status}`)
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
      const finalScene: CraftedScene = {
        id: sceneId,
        name: finalParsed.name || 'Unnamed Scene',
        prompt: craftPrompt,
        objects: finalParsed.objects,
        position: spawn.position,
        createdAt: placeholderScene.createdAt,
        model: craftModel,
      }

      if (finalParsed.objects.length === 0) {
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
        throw new Error('LLM returned no valid objects')
      }

      updateCraftedScene(sceneId, { name: finalScene.name, objects: finalScene.objects })

      const currentWorldId = useOasisStore.getState().activeWorldId
      if (currentWorldId !== originWorldId) {
        console.log(`[Forge:Craft:Stream] World changed during craft (${originWorldId} → ${currentWorldId}). Moving result to origin.`)
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
        try {
          const { loadWorld, saveWorld } = await import('../../../lib/forge/world-persistence')
          const originState = await loadWorld(originWorldId)
          if (originState) {
            const withoutPlaceholder = (originState.craftedScenes || []).filter((s: { id: string }) => s.id !== sceneId)
            await saveWorld({ ...originState, craftedScenes: [...withoutPlaceholder, finalScene] }, originWorldId)
          }
        } catch (saveErr) {
          console.error('[Forge:Craft:Stream] Failed to save to origin world:', saveErr)
        }
      }

      addToSceneLibrary(finalScene).then(() =>
        getSceneLibrary().then(lib => useOasisStore.setState({ sceneLibrary: lib }))
      )
      generateSingleCraftedThumbnail(finalScene).catch(() => {})
      awardXp('CRAFT_SCENE', originWorldId)
      dispatch({ type: 'SAVE_WORLD' })
      setCraftHistory(prev => [
        ...prev,
        { role: 'user', content: craftPrompt },
        { role: 'assistant', content: `Created "${finalScene.name}" with ${finalScene.objects.length} primitives` },
      ])

      console.log(`[Forge:Craft:Stream] Done: "${finalScene.name}" — ${finalScene.objects.length} objects streamed in`)

    } catch (err: unknown) {
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
  }, [craftPromptInput, addCraftedScene, updateCraftedScene, craftHistory, craftModel, setCraftingState, setError])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCraft()
    }
  }, [handleCraft])

  return (
    <>
      {/* ─═̷─═̷─ CRAFT MODE info bar + model selector + animated toggle ─═̷─═̷─ */}
      <div className="px-3 py-2 border-b border-gray-700/30 flex items-center justify-between flex-shrink-0"
        style={{ background: 'rgba(20, 20, 20, 0.5)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400/70 font-mono">LLM craft</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 font-mono">{craftedScenes.length} scene{craftedScenes.length !== 1 ? 's' : ''}</span>
          <select
            value={craftModel}
            onChange={(e) => setCraftModel(e.target.value)}
            className="text-[10px] bg-black/60 border border-blue-700/30 rounded px-1.5 py-0.5 text-blue-300 font-mono cursor-pointer focus:outline-none focus:border-blue-500/50 appearance-none"
            style={{ backgroundImage: 'none' }}
            title="LLM model for crafting + terrain"
          >
            {CRAFT_MODEL_OPTIONS.map(model => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─═̷─═̷─ CRAFT SPELL INPUT ─═̷─═̷─ */}
      <div className="px-3 py-2 flex gap-2 flex-shrink-0">
        <textarea
          value={craftPromptInput}
          onChange={(e) => setCraftPromptInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="craft a red house with a blue door and chimney..."
          className="flex-1 text-xs bg-black/60 border border-blue-700/40 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500/50"
        />
        <button
          onClick={handleCraft}
          disabled={!craftPromptInput.trim()}
          className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
          style={{ background: '#3B82F633', color: '#3B82F6', border: '1px solid #3B82F655' }}
          title="Craft scene from description"
        >
          {activeCrafts > 0 ? `Craft \u2699 (${activeCrafts})` : 'Craft \u2699'}
        </button>
      </div>
    </>
  )
}

export function CraftTabContent() {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const count = galleryScenes(craftedScenes, sceneLibrary).length

  // Thumbnails, not names: click places a copy, ⓘ opens the rotating preview, × removes / deletes (CraftedGallery).
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
          ── Crafted Scenes ({count}) ──
        </span>
      </div>
      <CraftedGallery defaultColumns={3} />
    </>
  )
}
