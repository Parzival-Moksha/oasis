// ═══════════════════════════════════════════════════════════════════════════════
// CRAFT TAB — LLM procedural geometry: prompt, streaming, scene list + library
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useCallback } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import type { CraftedScene } from '../../../lib/conjure/types'
import { dispatch } from '../../../lib/event-bus'
import { usePricing } from '../../../hooks/usePricing'
import { extractPartialCraftData } from '../../../lib/craft-stream'
import { addToSceneLibrary, getSceneLibrary } from '../../../lib/forge/scene-library'
import { generateSingleCraftedThumbnail } from '../../../hooks/useThumbnailGenerator'
import { awardXp } from '../../../hooks/useXp'
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
  const [craftAnimated, setCraftAnimated] = useState(false)
  const [craftHistory, setCraftHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])

  const { pricing } = usePricing()
  const p = useCallback((key: string, fallback: number = 1) => {
    return pricing[key] ?? fallback
  }, [pricing])

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
    const placeholderScene: CraftedScene = {
      id: sceneId,
      name: 'Crafting...',
      prompt: craftPrompt,
      objects: [],
      position: [0, 0, 0],
      model: craftModel,
      createdAt: new Date().toISOString(),
    }

    try {
      const res = await fetch(`${OASIS_BASE}/api/craft/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: iterativePrompt, model: craftModel, animated: craftAnimated }),
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
        position: [0, 0, 0],
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
  }, [craftPromptInput, addCraftedScene, updateCraftedScene, craftHistory, craftModel, setCraftingState, setError, craftAnimated])

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
          {/* Static / Animated toggle */}
          <button
            onClick={() => setCraftAnimated(!craftAnimated)}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-all ${
              craftAnimated
                ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
                : 'border-gray-700/30 bg-black/40 text-gray-500 hover:text-gray-400'
            }`}
            title={craftAnimated ? 'Animated mode — LLM will add motion to primitives' : 'Static mode — no animations'}
          >
            {craftAnimated ? 'Animated' : 'Static'}
          </button>
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
            <option value="moonshotai/kimi-k2.5">Kimi K2.5</option>
            <option value="anthropic/claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="anthropic/claude-haiku-4-5">Haiku 4.5</option>
            <option value="z-ai/glm-5">GLM-5</option>
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
          title={`Costs ${p('craft', 0.05)} credits`}
        >
          {activeCrafts > 0 ? `Craft \u2699 (${activeCrafts})` : `Craft \u2699 ${p('craft', 0.05) > 0 ? `(${p('craft', 0.05)} cr)` : ''}`}
        </button>
      </div>
    </>
  )
}

export function CraftTabContent() {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const deleteFromLibrary = useOasisStore(s => s.deleteFromLibrary)

  // Craft history is local to the header — we render a placeholder here
  // The actual craft history display lives in the header component

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
          ── Crafted Scenes ({craftedScenes.length}) ──
        </span>
      </div>

      {craftedScenes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <div className="text-3xl mb-2">&#9881;</div>
          <div className="text-xs">No scenes crafted yet</div>
          <div className="text-[10px] mt-1 text-gray-500">Describe a scene and the LLM will build it from primitives</div>
          <div className="text-[10px] mt-1 text-blue-500/40">Iterative: each new craft builds on the last</div>
        </div>
      ) : (
        <div className="space-y-2">
          {craftedScenes.map(scene => (
            <div
              key={scene.id}
              className="rounded-lg border p-2 group transition-all duration-200 hover:border-blue-500/30"
              style={{
                background: 'rgba(20, 20, 20, 0.8)',
                borderColor: 'rgba(59, 130, 246, 0.15)',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-blue-300 font-medium">{scene.name}</span>
                <button
                  onClick={() => removeCraftedScene(scene.id)}
                  className="text-gray-400 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove from world (stays in library)"
                >
                  &#10005;
                </button>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {scene.objects.length} primitive{scene.objects.length !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─═̷─═̷─ SCENE LIBRARY — The permanent archive ─═̷─═̷─ */}
      {sceneLibrary.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-4 mb-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
              ── Library ({sceneLibrary.length}) ──
            </span>
          </div>
          <div className="space-y-1.5">
            {sceneLibrary.map(scene => {
              const isInWorld = craftedScenes.some(s => s.id === scene.id)
              return (
                <div
                  key={scene.id}
                  className="rounded-lg border p-2 group transition-all duration-200 hover:border-purple-500/30 flex items-center justify-between"
                  style={{
                    background: 'rgba(15, 15, 20, 0.8)',
                    borderColor: isInWorld ? 'rgba(59, 130, 246, 0.2)' : 'rgba(128, 90, 213, 0.15)',
                  }}
                >
                  <div>
                    <span className="text-[11px] text-purple-300/80 font-medium">{scene.name}</span>
                    <span className="text-[9px] text-gray-400 ml-2">
                      {scene.objects.length} obj{scene.objects.length !== 1 ? 's' : ''}
                    </span>
                    {isInWorld && (
                      <span className="text-[8px] text-blue-400/50 ml-1.5">in world</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => enterPlacementMode({ type: 'library', sceneId: scene.id, name: scene.name })}
                      className="text-[9px] text-emerald-400/70 hover:text-emerald-300 font-mono border border-emerald-500/20 rounded px-1.5 py-0.5"
                      title="Place a copy in current world (click-to-place)"
                    >
                      + place
                    </button>
                    <button
                      onClick={() => deleteFromLibrary(scene.id)}
                      className="text-[9px] text-red-400/50 hover:text-red-400 font-mono"
                      title="Delete permanently from library"
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
