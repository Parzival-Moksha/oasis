// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useAutoresizeTextarea — grow a <textarea> with its content, cap at maxPx
// ─═̷─═̷─ॐ─═̷─═̷─ Keep inputs compact for one line, expand as user types. ─═̷─═̷─
// Works by resetting height to 'auto' (so scrollHeight collapses to content
// height) then setting inline style.height to the measured scrollHeight.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useLayoutEffect, type RefObject } from 'react'

export function useAutoresizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options?: { minPx?: number; maxPx?: number },
): void {
  const minPx = options?.minPx ?? 30
  const maxPx = options?.maxPx ?? 220
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset so scrollHeight reflects the content, not the previous height.
    el.style.height = 'auto'
    const next = Math.min(maxPx, Math.max(minPx, el.scrollHeight))
    el.style.height = `${next}px`
    // Allow internal scroll only when we hit the cap; otherwise hide scrollbar.
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [ref, value, minPx, maxPx])
}
