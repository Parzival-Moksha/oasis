// ═══════════════════════════════════════════════════════════════════════════════
// PLACED TAB — All objects placed in this world
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useOasisStore } from '../../../store/oasisStore'
import { useConjure } from '../../../hooks/useConjure'
import { LightTooltipWrap } from './shared'

export function PlacedTab() {
  const { conjuredAssets } = useConjure()

  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const removeConjuredAssetFromWorld = useOasisStore(s => s.removeConjuredAssetFromWorld)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const removeCatalogAsset = useOasisStore(s => s.removeCatalogAsset)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const worldLights = useOasisStore(s => s.worldLights)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const removeAgentWindow = useOasisStore(s => s.removeAgentWindow)
  const focusAgentWindow = useOasisStore(s => s.focusAgentWindow)

  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const setCameraLookAt = useOasisStore(s => s.setCameraLookAt)
  const transforms = useOasisStore(s => s.transforms)

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
          ── Placed Objects ──
        </span>
        <span className="text-[10px] text-cyan-500/60 font-mono">
          {worldConjuredAssetIds.length + placedCatalogAssets.length + craftedScenes.length + worldLights.length + placedAgentWindows.length} total
        </span>
      </div>

      {worldConjuredAssetIds.length === 0 && placedCatalogAssets.length === 0 && craftedScenes.length === 0 && worldLights.length === 0 && placedAgentWindows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <div className="text-3xl mb-2">&#128203;</div>
          <div className="text-xs">No objects placed yet</div>
          <div className="text-[10px] mt-1 text-gray-500">Conjure, craft, or add from the Asset catalog</div>
        </div>
      ) : (
        <div className="space-y-1">
          {/* ── CONJURED ── */}
          {worldConjuredAssetIds.length > 0 && (
            <div className="text-[9px] text-purple-400/60 uppercase tracking-wider font-mono mt-1 mb-0.5">✨ Conjured ({worldConjuredAssetIds.length})</div>
          )}
          {worldConjuredAssetIds.map(id => {
            const asset = conjuredAssets.find(a => a.id === id)
            if (!asset || asset.status !== 'ready') return null
            const isSelected = selectedObjectId === id
            return (
              <div
                key={id}
                className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                  isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-cyan-500/30'
                }`}
                style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                onClick={() => {
                  if (isSelected) { selectObject(null); setInspectedObject(null) }
                  else {
                    selectObject(id); setInspectedObject(id)
                    const pos = transforms[id]?.position || asset?.position
                    if (pos) setCameraLookAt(pos)
                  }
                }}
              >
                <div>
                  <span className="text-[10px] text-orange-400 font-mono mr-1">&#10024;</span>
                  <span className="text-[11px] text-gray-200">{(asset.displayName || asset.prompt).slice(0, 30)}{(asset.displayName || asset.prompt).length > 30 ? '...' : ''}</span>
                  <span className="text-[9px] text-gray-400 ml-1.5">{asset.provider}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeConjuredAssetFromWorld(id) }}
                  className="text-gray-500 hover:text-red-400 text-xs"
                >
                  &#10005;
                </button>
              </div>
            )
          })}

          {/* ── CATALOG ── */}
          {placedCatalogAssets.length > 0 && (
            <div className="text-[9px] text-cyan-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">📦 Catalog ({placedCatalogAssets.length})</div>
          )}
          {placedCatalogAssets.map(ca => {
            const isSelected = selectedObjectId === ca.id
            return (
              <div
                key={ca.id}
                className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                  isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-cyan-500/30'
                }`}
                style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                onClick={() => {
                  if (isSelected) { selectObject(null); setInspectedObject(null) }
                  else {
                    selectObject(ca.id); setInspectedObject(ca.id)
                    const pos = transforms[ca.id]?.position || ca.position
                    if (pos) setCameraLookAt(pos)
                  }
                }}
              >
                <div>
                  <span className={`text-[10px] font-mono mr-1 ${ca.imageUrl ? 'text-pink-400' : 'text-yellow-400'}`}>{ca.imageUrl ? '🖼️' : '📦'}</span>
                  <span className="text-[11px] text-gray-200">{ca.name}</span>
                  <span className="text-[9px] text-gray-400 ml-1.5">{ca.imageUrl ? 'image' : 'catalog'}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeCatalogAsset(ca.id) }}
                  className="text-gray-500 hover:text-red-400 text-xs"
                >
                  &#10005;
                </button>
              </div>
            )
          })}

          {/* ── CRAFTED ── */}
          {craftedScenes.length > 0 && (
            <div className="text-[9px] text-amber-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">⚒️ Crafted ({craftedScenes.length})</div>
          )}
          {craftedScenes.map(scene => {
            const isSelected = selectedObjectId === scene.id
            return (
              <div
                key={scene.id}
                className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                  isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-cyan-500/30'
                }`}
                style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                onClick={() => {
                  if (isSelected) { selectObject(null); setInspectedObject(null) }
                  else {
                    selectObject(scene.id); setInspectedObject(scene.id)
                    const pos = transforms[scene.id]?.position || scene.position
                    if (pos) setCameraLookAt(pos)
                  }
                }}
              >
                <div>
                  <span className="text-[10px] text-blue-400 font-mono mr-1">&#9881;</span>
                  <span className="text-[11px] text-gray-200">{scene.name}</span>
                  <span className="text-[9px] text-gray-400 ml-1.5">{scene.objects.length} prims</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeCraftedScene(scene.id) }}
                  className="text-gray-500 hover:text-red-400 text-xs"
                >
                  &#10005;
                </button>
              </div>
            )
          })}

          {/* ── LIGHTS ── */}
          {worldLights.length > 0 && (
            <div className="text-[9px] text-yellow-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">💡 Lights ({worldLights.length})</div>
          )}
          {worldLights.map(light => {
            const isSelected = selectedObjectId === light.id
            const emoji = light.type === 'point' ? '💡' : light.type === 'spot' ? '🔦' : light.type === 'directional' ? '☀️' : light.type === 'hemisphere' ? '🌗' : light.type === 'ambient' ? '🌤️' : '🌐'
            return (
              <LightTooltipWrap key={light.id} type={light.type} className="relative">
                <div
                  className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                    isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-cyan-500/30'
                  }`}
                  style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                  onClick={() => {
                    if (isSelected) { selectObject(null); setInspectedObject(null) }
                    else {
                      selectObject(light.id); setInspectedObject(light.id)
                      if (light.position) setCameraLookAt(light.position)
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{emoji}</span>
                    <span className="text-[11px] text-gray-200">{light.type}</span>
                    <span className="text-[9px] text-gray-400">int {light.intensity.toFixed(1)}</span>
                    <div className="w-3 h-3 rounded-full border border-gray-700/30" style={{ backgroundColor: light.color }} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeWorldLight(light.id) }}
                    className="text-gray-500 hover:text-red-400 text-xs"
                  >
                    &#10005;
                  </button>
                </div>
              </LightTooltipWrap>
            )
          })}

          {/* ── AGENTS ── */}
          {placedAgentWindows.length > 0 && (
            <div className="text-[9px] text-sky-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">💻 Agents ({placedAgentWindows.length})</div>
          )}
          {placedAgentWindows.map(win => {
            const isSelected = selectedObjectId === win.id
            const agentIcon = win.agentType === 'anorak' ? '💻' : win.agentType === 'anorak-pro' ? '🔮' : win.agentType === 'openclaw' ? '🦞' : win.agentType === 'merlin' ? '🧙' : win.agentType === 'realtime' ? '🗣️' : win.agentType === 'parzival' ? '🧿' : '⚡'
            const agentColor = win.agentType === 'anorak' ? 'text-sky-400' : win.agentType === 'anorak-pro' ? 'text-teal-400' : win.agentType === 'openclaw' ? 'text-cyan-300' : win.agentType === 'merlin' ? 'text-purple-400' : win.agentType === 'realtime' ? 'text-violet-300' : win.agentType === 'parzival' ? 'text-violet-400' : 'text-green-400'
            const agentIconResolved = win.agentType === 'browser' ? 'WWW' : win.agentType === 'codex' ? '⌘' : agentIcon
            const agentColorResolved = win.agentType === 'browser' ? 'text-orange-400' : win.agentType === 'codex' ? 'text-emerald-400' : agentColor
            const pos = transforms[win.id]?.position || win.position
            return (
              <div
                key={win.id}
                className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                  isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-purple-500/30'
                }`}
                style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                onClick={() => {
                  if (isSelected) { selectObject(null); setInspectedObject(null) }
                  else {
                    selectObject(win.id); setInspectedObject(win.id)
                    if (pos) setCameraLookAt(pos)
                  }
                }}
              >
                <div>
                  <span className={`text-[10px] font-mono mr-1 ${agentColorResolved}`}>{agentIconResolved}</span>
                  <span className="text-[11px] text-gray-200">{win.label || win.agentType}</span>
                  <span className="text-[9px] text-gray-400 ml-1.5">agent</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); selectObject(win.id); focusAgentWindow(win.id) }}
                    className="text-[9px] text-purple-400 hover:text-purple-300 font-mono transition-colors"
                    title="Focus this window"
                  >
                    focus
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeAgentWindow(win.id) }}
                    className="text-gray-500 hover:text-red-400 text-xs"
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
