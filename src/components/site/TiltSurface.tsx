'use client'

import type { CSSProperties, MouseEvent, ReactNode } from 'react'

type TiltSurfaceProps = {
  children: ReactNode
  className?: string
  max?: number
}

type TiltStyle = CSSProperties & {
  '--tilt-x'?: string
  '--tilt-y'?: string
  '--glow-x'?: string
  '--glow-y'?: string
}

export function TiltSurface({ children, className, max = 10 }: TiltSurfaceProps) {
  function handleMove(event: MouseEvent<HTMLDivElement>) {
    if (!window.matchMedia('(hover: hover)').matches) return

    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2

    element.style.setProperty('--tilt-x', `${(-y * max).toFixed(2)}deg`)
    element.style.setProperty('--tilt-y', `${(x * max).toFixed(2)}deg`)
    element.style.setProperty('--glow-x', `${((x + 1) * 50).toFixed(1)}%`)
    element.style.setProperty('--glow-y', `${((y + 1) * 50).toFixed(1)}%`)
  }

  function handleLeave(event: MouseEvent<HTMLDivElement>) {
    const element = event.currentTarget
    element.style.setProperty('--tilt-x', '0deg')
    element.style.setProperty('--tilt-y', '0deg')
    element.style.setProperty('--glow-x', '50%')
    element.style.setProperty('--glow-y', '50%')
  }

  const style: TiltStyle = {
    '--tilt-x': '0deg',
    '--tilt-y': '0deg',
    '--glow-x': '50%',
    '--glow-y': '50%',
  }

  return (
    <div className={className} style={style} onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {children}
    </div>
  )
}
