// ░▒▓ useFrameWhen — a useFrame that only subscribes while it has work ▓▒░
// R3F calls every useFrame callback every frame, and a world has hundreds of components whose
// callback returns on its first line (a primitive without an animation, an object that is not
// moving). This subscribes to the frame loop only while `active` is true, so an idle component
// costs nothing per frame. Same callback arguments and priority rules as useFrame.

import { useLayoutEffect, useRef } from 'react'
import { useStore, type RenderCallback } from '@react-three/fiber'

export function useFrameWhen(active: boolean, callback: RenderCallback, renderPriority = 0): void {
  const store = useStore()
  const ref = useRef<RenderCallback>(callback)
  useLayoutEffect(() => { ref.current = callback }, [callback])
  useLayoutEffect(() => {
    if (!active) return
    return store.getState().internal.subscribe(ref, renderPriority, store)
  }, [active, renderPriority, store])
}
