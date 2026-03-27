'use client'

import { useEffect, useCallback } from 'react'

interface DeleteConfirmModalProps {
  isOpen: boolean
  itemName: string
  placedCount?: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ isOpen, itemName, placedCount, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
  }, [onCancel])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, handleKey])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}>
      <div className="bg-gray-900 border border-teal-500/30 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-200 mb-2">Delete &ldquo;{itemName}&rdquo;?</h3>
        {(placedCount ?? 0) > 0 ? (
          <p className="text-xs text-yellow-400 mb-3">
            This asset is placed {placedCount} time{(placedCount ?? 0) > 1 ? 's' : ''} in your world.
            Deleting will remove the file permanently.
          </p>
        ) : (
          <p className="text-xs text-gray-400 mb-3">This removes the file permanently.</p>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-gray-700/50 text-gray-300 border border-gray-600/50 hover:bg-gray-600/50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
