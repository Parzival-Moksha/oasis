// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PAINT STROKE — wizardry: draw shiny lines in space
// ─═̷─═̷─ॐ─═̷─═̷─ Csillagszóró-tipped procedural tubes through 3-space ─═̷─═̷─ॐ─═̷─═̷─
//
// A stroke is a sequence of 3D points + style. The renderer reconstructs
// either a TubeGeometry (3D mode) or a screen-space line (2D mode) on load.
// Variable-thickness mode uses point-pair velocity (closer = thicker).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export const PAINT_MIN_POINT_DISTANCE = 0.10
export const PAINT_MAX_POINTS = 600
export const PAINT_DEFAULT_THICKNESS = 0.04
export const PAINT_DEFAULT_DISTANCE = 3.0
export const PAINT_DEFAULT_COLOR = '#ff3df0'
export const PAINT_DEFAULT_SHININESS = 0.7

export type PaintStrokeMode = '2d' | '3d'

export interface PaintStrokeStyle {
  color: string
  thickness: number
  shininess: number
  mode: PaintStrokeMode
  /** When true, segment thickness scales inversely with point spacing (faster sweep = thinner). */
  varyByVelocity?: boolean
}

export interface PaintStroke extends PaintStrokeStyle {
  id: string
  type: 'paint_stroke'
  /** Flat [x,y,z, x,y,z, ...] for compact persistence + fast geometry rebuild. */
  points: number[]
  authorId?: string
  authorColor?: string
  createdAt: number
}

export interface InProgressStroke extends PaintStrokeStyle {
  id: string
  authorId: string
  authorColor: string
  points: number[]
  startedAt: number
}

export function packPoints(points: Array<[number, number, number]>): number[] {
  const out: number[] = []
  for (const [x, y, z] of points) out.push(x, y, z)
  return out
}

export function unpackPoints(points: number[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]])
  return out
}

export function strokePointCount(stroke: { points: number[] }): number {
  return Math.floor(stroke.points.length / 3)
}

export function strokePoint(stroke: { points: number[] }, index: number): [number, number, number] {
  const i = index * 3
  return [stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]]
}

/** Distance between consecutive 3D points; used for both throttling AND velocity-based thickness. */
export function distanceBetween(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Map a segment length to an inverse-velocity thickness; clamped so thin strokes stay visible. */
export function thicknessForSegment(baseThickness: number, segmentLength: number, varyByVelocity: boolean | undefined): number {
  if (!varyByVelocity) return baseThickness
  // 10cm step ≈ baseline. <2cm → 1.6x. >40cm → 0.35x. Tuned by feel.
  const ref = 0.10
  const ratio = ref / Math.max(0.005, segmentLength)
  const scaled = baseThickness * Math.max(0.35, Math.min(1.6, ratio))
  return Math.max(0.005, scaled)
}

export function makeStrokeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `stroke-${crypto.randomUUID().slice(0, 12)}`
  }
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
