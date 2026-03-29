'use client'

import { useEffect, useCallback } from 'react'

interface DeleteConfirmModalProps {
  isOpen: boolean
  itemName: string
  placedCount?: number
  /** Number of worlds the asset is placed in (cross-world count) */
  worldCount?: number
  /** Loading state while fetching cross-world usage */
  loadingUsage?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ isOpen, itemName, placedCount, worldCount, loadingUsage, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
  }, [onCancel])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, handleKey])

  if (!isOpen) return null

  // Build the placement message
  const total = placedCount ?? 0
  const worlds = worldCount ?? 0
  let placementMsg: string | null = null
  if (loadingUsage) {
    placementMsg = 'Checking usage across worlds...'
  } else if (total > 0) {
    if (worlds > 1) {
      placementMsg = `This asset is placed ${total} time${total > 1 ? 's' : ''} across ${worlds} worlds.`
    } else if (worlds === 1) {
      placementMsg = `This asset is placed ${total} time${total > 1 ? 's' : ''} in this world.`
    } else {
      // Fallback: placedCount without worldCount (legacy)
      placementMsg = `This asset is placed ${total} time${total > 1 ? 's' : ''} in your oasis.`
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}>
      <div className="bg-gray-900 border border-teal-500/30 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-200 mb-2">Delete &ldquo;{itemName}&rdquo;?</h3>
        {placementMsg ? (
          <p className={`text-xs mb-3 ${loadingUsage ? 'text-gray-400 animate-pulse' : 'text-yellow-400'}`}>
            {placementMsg}
            {!loadingUsage && ' Deleting will remove the file permanently.'}
          </p>
        ) : (
          <p className="text-xs text-gray-400 mb-3">This removes the file permanently.</p>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-gray-700/50 text-gray-300 border border-gray-600/50 hover:bg-gray-600/50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loadingUsage}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-40 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
