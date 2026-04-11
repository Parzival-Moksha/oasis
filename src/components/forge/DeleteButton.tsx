'use client'

import type { MouseEvent } from 'react'

interface DeleteButtonProps {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  title: string
  className?: string
}

export function DeleteButton({ onClick, title, className = '' }: DeleteButtonProps) {
  return (
    <button
      data-card-action="delete"
      onClick={onClick}
      className={`absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-[10px] text-red-400/75 transition-colors hover:text-red-300 ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      {'\u{1F5D1}'}
    </button>
  )
}
