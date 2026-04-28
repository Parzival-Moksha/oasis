// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ACTION LOG — The temporal cortex, witnessing every world edit
// ─═̷─═̷─⏪─═̷─═̷─ Ctrl+Z undoes, Ctrl+Shift+Z redoes ─═̷─═̷─⏪─═̷─═̷─
//
// Floating panel showing the last N undo/redo commands.
// Current position in the stack is highlighted.
// Toggle via a small button in the top-right area.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useRef, useEffect } from 'react'
import { useOasisStore, type UndoCommand } from '../../store/oasisStore'

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION LOG TOGGLE BUTTON — sits next to the asset explorer button
// ═══════════════════════════════════════════════════════════════════════════════

export function ActionLogButton({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label="Action Log"
      data-oasis-tooltip="Action Log"
      className={`oasis-tooltip relative w-10 h-10 rounded-lg flex items-center justify-center text-xs font-mono transition-all duration-200 hover:scale-110 ${
        isOpen
          ? 'bg-violet-500/20 border-violet-400/50 text-violet-300'
          : 'bg-black/60 border-gray-700/40 text-gray-400 hover:border-violet-500/30 hover:text-violet-300'
      } border`}
    >
      <span className="text-lg">⏪</span>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION LOG PANEL — floating history of world edits
// ═══════════════════════════════════════════════════════════════════════════════

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ActionLogPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const undoStack = useOasisStore(s => s.undoStack)
  const redoStack = useOasisStore(s => s.redoStack)
  const undo = useOasisStore(s => s.undo)
  const redo = useOasisStore(s => s.redo)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to current position
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [undoStack.length])

  if (!isOpen) return null

  // Build combined timeline: redo (future) + undo (past)
  // Display order: oldest at top, newest at bottom, redo items below current
  const hasHistory = undoStack.length > 0 || redoStack.length > 0

  return (
    <div className="fixed top-14 right-4 w-64 max-h-[400px] rounded-xl border border-violet-500/20 bg-black/90 backdrop-blur-md shadow-2xl z-[201] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-violet-500/10">
        <div className="text-xs font-mono text-violet-300 flex items-center gap-1.5">
          <span>⏪</span> Action Log
        </div>
        <div className="flex items-center gap-2">
          {/* Undo/Redo buttons */}
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="px-1.5 py-0.5 text-[10px] rounded border border-gray-700/30 text-gray-400 hover:text-violet-300 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="px-1.5 py-0.5 text-[10px] rounded border border-gray-700/30 text-gray-400 hover:text-violet-300 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-sm leading-none"
          >
            x
          </button>
        </div>
      </div>

      {/* History list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 py-1 min-h-[60px] max-h-[340px]">
        {!hasHistory && (
          <div className="text-center text-gray-600 text-[10px] py-4 font-mono">
            No actions yet<br />
            <span className="text-gray-700">Ctrl+Z to undo</span>
          </div>
        )}

        {/* Undo stack entries (past actions, from oldest to newest) */}
        {undoStack.map((cmd, i) => (
          <ActionEntry
            key={`undo-${i}-${cmd.timestamp}`}
            command={cmd}
            isCurrent={i === undoStack.length - 1}
            isPast={true}
          />
        ))}

        {/* ─── Current position marker ─── */}
        {hasHistory && (
          <div className="flex items-center gap-1 px-2 py-0.5">
            <div className="flex-1 h-px bg-violet-500/30" />
            <span className="text-[9px] text-violet-400/50 font-mono">now</span>
            <div className="flex-1 h-px bg-violet-500/30" />
          </div>
        )}

        {/* Redo stack entries (future actions, from nearest to farthest) */}
        {[...redoStack].reverse().map((cmd, i) => (
          <ActionEntry
            key={`redo-${i}-${cmd.timestamp}`}
            command={cmd}
            isCurrent={false}
            isPast={false}
          />
        ))}
      </div>

      {/* Footer with keyboard hints */}
      <div className="px-3 py-1.5 border-t border-violet-500/10 text-[9px] text-gray-600 font-mono flex justify-between">
        <span>Ctrl+Z undo</span>
        <span>Ctrl+Shift+Z redo</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE ACTION ENTRY — one row in the action log
// ═══════════════════════════════════════════════════════════════════════════════

function ActionEntry({ command, isCurrent, isPast }: { command: UndoCommand; isCurrent: boolean; isPast: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono transition-colors ${
        isCurrent
          ? 'bg-violet-500/15 text-violet-200'
          : isPast
            ? 'text-gray-400 hover:bg-white/5'
            : 'text-gray-600 opacity-60 hover:bg-white/5'
      }`}
    >
      <span className="text-sm flex-shrink-0">{command.icon}</span>
      <span className="flex-1 truncate">{command.label}</span>
      <span className="text-[9px] text-gray-600 flex-shrink-0">{formatTime(command.timestamp)}</span>
    </div>
  )
}

// ▓▓▓▓【A̸C̸T̸I̸O̸N̸】▓▓▓▓ॐ▓▓▓▓【L̸O̸G̸】▓▓▓▓ॐ▓▓▓▓【T̸I̸M̸E̸】▓▓▓▓
