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
import type { CraftedScene } from '../../../../lib/conjure/types'
import { CollapsibleSection, scrollIntoViewOnFocus } from '../SpellTabFrame'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

const CRAFT_MODELS = [
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Haiku 4.5' },
] as const

export interface CraftSpellBodyProps {
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
}

export function CraftSpellBody({ defaultExpandNew = true, defaultExpandGallery = true }: CraftSpellBodyProps) {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const addCraftedScene = useOasisStore(s => s.addCraftedScene)
  const updateCraftedScene = useOasisStore(s => s.updateCraftedScene)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
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
      const isCC = craftModel.startsWith('cc-')
      const res = await fetch(`${OASIS_BASE}/api/craft/${isCC ? 'cc' : 'stream'}`, {
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
        rightSlot={CRAFT_MODELS.find(m => m.id === craftModel)?.label || craftModel}
      >
        <select
          value={craftModel}
          onChange={e => setCraftModel(e.target.value)}
          className="w-full text-[10px] bg-black/60 border border-blue-500/30 rounded px-2 py-1 text-blue-200 font-mono focus:outline-none focus:border-blue-400/60 cursor-pointer"
        >
          {CRAFT_MODELS.map(m => (
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
        label={`Gallery (${craftedScenes.length})`}
        accentColor="#60A5FA"
        expanded={expandGallery}
        onToggle={() => setExpandGallery(e => !e)}
      >
        {craftedScenes.length === 0 && sceneLibrary.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <div className="text-2xl mb-1">{'⚙'}</div>
            <div className="text-xs">No crafted scenes yet</div>
            <div className="text-[10px] mt-1 text-gray-500">Describe a scene and hit Craft</div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {craftedScenes.map(scene => (
              <div
                key={scene.id}
                className="rounded-md border border-blue-500/20 bg-black/40 px-2.5 py-1.5 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-blue-200 font-mono truncate" title={scene.prompt}>
                    {scene.name}
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono">
                    {scene.objects.length} obj{scene.objects.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  onClick={() => removeCraftedScene(scene.id)}
                  className="text-[10px] text-gray-500 hover:text-red-400"
                  title="Remove from world"
                >
                  &times;
                </button>
              </div>
            ))}
            {sceneLibrary.length > 0 && (
              <>
                <div className="text-[10px] text-purple-400/70 uppercase tracking-widest font-mono mt-2 mb-1">
                  Library ({sceneLibrary.length})
                </div>
                {sceneLibrary.map(scene => (
                  <div
                    key={scene.id}
                    className="rounded-md border border-purple-500/20 bg-black/40 px-2.5 py-1.5 flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] text-purple-200 font-mono truncate" title={scene.prompt}>
                        {scene.name}
                      </div>
                      <div className="text-[9px] text-gray-500 font-mono">
                        {scene.objects.length} obj{scene.objects.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => enterPlacementMode({ type: 'library', sceneId: scene.id, name: scene.name })}
                      className="text-[10px] text-emerald-400/80 hover:text-emerald-300 font-mono border border-emerald-500/30 rounded px-1.5 py-0.5"
                      title="Place a copy"
                    >
                      + place
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
