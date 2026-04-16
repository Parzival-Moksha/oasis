// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS TAB — 3D agent windows management + placement
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useOasisStore } from '../../../store/oasisStore'

const AGENT_TYPES = [
  { type: 'browser' as const, label: 'Browser', icon: 'WWW', color: '#f97316', desc: 'Live 3D browser surface with real typing and selection' },
  { type: 'anorak' as const, label: 'Anorak', icon: '💻', color: '#38bdf8', desc: 'Claude Code agent — full multi-turn sessions' },
  { type: 'anorak-pro' as const, label: 'Anorak Pro', icon: '🔮', color: '#14b8a6', desc: 'Autonomous dev pipeline — curator, coder, reviewer, tester' },
  { type: 'hermes' as const, label: 'Hermes', icon: '☤', color: '#fb7185', desc: 'Embodied co-builder — remote tool agent inside the Oasis' },
  { type: 'merlin' as const, label: 'Merlin', icon: '🧙', color: '#a855f7', desc: 'World-builder agent — place objects, set sky' },
  { type: 'devcraft' as const, label: 'DevCraft', icon: '⚡', color: '#22c55e', desc: 'Mission management + gamification' },
  { type: 'parzival' as const, label: 'Parzival', icon: '🧿', color: '#c084fc', desc: 'Autonomous brain — modes, missions, thought stream' },
] as const

export function AgentsTabContent() {
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const setCameraLookAt = useOasisStore(s => s.setCameraLookAt)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const transforms = useOasisStore(s => s.transforms)
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const removeAgentWindow = useOasisStore(s => s.removeAgentWindow)
  const focusAgentWindow = useOasisStore(s => s.focusAgentWindow)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)

  return (
    <>
      {/* ░▒▓ DEPLOY NEW AGENT ▓▒░ */}
      <div className="mb-3">
        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
          ── Deploy Agent ──
        </span>
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {AGENT_TYPES.map(agent => (
            <button
              key={agent.type}
              onClick={() => enterPlacementMode({ type: 'agent', name: agent.label, agentType: agent.type })}
              className="rounded-lg border border-gray-700/30 bg-black/40 hover:border-gray-600/50 p-2 text-left transition-all duration-200 group"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-lg group-hover:scale-110 transition-transform">{agent.icon}</span>
                <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.label}</span>
              </div>
              <div className="text-[8px] text-gray-500 mt-1 leading-tight">{agent.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ░▒▓ PLACED AGENTS ▓▒░ */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
          ── Deployed ({placedAgentWindows.length}) ──
        </span>
      </div>

      {placedAgentWindows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <div className="text-3xl mb-2">💻</div>
          <div className="text-xs">No agents deployed</div>
          <div className="text-[10px] mt-1 text-gray-500">Click an agent above, then click the ground to place</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {placedAgentWindows.map(win => {
            const isSelected = selectedObjectId === win.id
            const isFocused = focusedAgentWindowId === win.id
            const agent = AGENT_TYPES.find(a => a.type === win.agentType) || AGENT_TYPES.find(a => a.type === 'anorak') || AGENT_TYPES[0]
            const pos = transforms[win.id]?.position || win.position
            return (
              <div
                key={win.id}
                className={`rounded-lg border p-2 cursor-pointer transition-all duration-200 ${
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{agent.icon}</span>
                    <div>
                      <span className="text-[11px] font-bold" style={{ color: agent.color }}>{win.label || agent.label}</span>
                      {win.sessionId && <span className="text-[8px] text-gray-600 font-mono ml-1.5">{win.sessionId.slice(0, 8)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        selectObject(win.id)
                        focusAgentWindow(isFocused ? null : win.id)
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono border transition-colors hover:bg-purple-500/20"
                      style={{ color: agent.color, borderColor: `${agent.color}33` }}
                      title={isFocused ? 'Stop following this window' : 'Follow — fly camera to this window'}
                    >
                      {isFocused ? 'unfollow' : 'follow'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeAgentWindow(win.id) }}
                      className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                      title="Remove from world"
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[8px] text-gray-500 font-mono">
                  <span>pos: [{pos.map(v => v.toFixed(1)).join(', ')}]</span>
                  <span>scale: {(() => { const s = transforms[win.id]?.scale; return typeof s === 'number' ? s.toFixed(2) : Array.isArray(s) ? s[0].toFixed(2) : win.scale.toFixed(2) })()}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
