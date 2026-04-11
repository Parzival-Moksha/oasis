export interface MerlinPanelPosition {
  x: number
  y: number
}

export interface MerlinPanelSize {
  w: number
  h: number
}

export interface MerlinViewport {
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function clampMerlinPanelSize(
  size: MerlinPanelSize,
  viewport: MerlinViewport,
  minWidth: number,
  minHeight: number,
): MerlinPanelSize {
  const maxWidth = Math.max(1, Math.round(finiteNumber(viewport.width, minWidth)))
  const maxHeight = Math.max(1, Math.round(finiteNumber(viewport.height, minHeight)))
  const safeMinWidth = Math.min(minWidth, maxWidth)
  const safeMinHeight = Math.min(minHeight, maxHeight)

  return {
    w: clamp(Math.round(finiteNumber(size.w, safeMinWidth)), safeMinWidth, maxWidth),
    h: clamp(Math.round(finiteNumber(size.h, safeMinHeight)), safeMinHeight, maxHeight),
  }
}

export function clampMerlinPanelPosition(
  position: MerlinPanelPosition,
  size: MerlinPanelSize,
  viewport: MerlinViewport,
): MerlinPanelPosition {
  const maxX = Math.max(0, Math.round(finiteNumber(viewport.width, size.w)) - Math.round(finiteNumber(size.w, 0)))
  const maxY = Math.max(0, Math.round(finiteNumber(viewport.height, size.h)) - Math.round(finiteNumber(size.h, 0)))

  return {
    x: clamp(Math.round(finiteNumber(position.x, 0)), 0, maxX),
    y: clamp(Math.round(finiteNumber(position.y, 0)), 0, maxY),
  }
}

export function clampMerlinGeometry(
  position: MerlinPanelPosition,
  size: MerlinPanelSize,
  viewport: MerlinViewport,
  minWidth: number,
  minHeight: number,
): { position: MerlinPanelPosition; size: MerlinPanelSize } {
  const nextSize = clampMerlinPanelSize(size, viewport, minWidth, minHeight)
  const nextPosition = clampMerlinPanelPosition(position, nextSize, viewport)
  return { position: nextPosition, size: nextSize }
}
