'use client'

// Top right of the Settings menu: its blur, its transparency and its colour (src/lib/settings-look.ts).

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS_LOOK, SETTINGS_BLUR_MAX, SETTINGS_SWATCHES, setSettingsLook, useSettingsLook } from '@/lib/settings-look'

function Slider({ label, value, min, max, unit, onChange, tag }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void; tag: string }) {
  return (
    <label className="flex flex-col gap-0.5" data-settings-look={tag}>
      <span className="flex justify-between text-[9px] font-bold uppercase tracking-[0.12em] text-white/50">
        <span>{label}</span><span className="tabular-nums text-white/80">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="h-3 w-[100px] cursor-pointer accent-violet-300"
        aria-label={label}
      />
    </label>
  )
}

export function SettingsLookControls() {
  const look = useSettingsLook()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  }, [open])

  return (
    <div className="ml-auto flex shrink-0 items-end gap-3 max-[700px]:hidden" data-settings-look-controls>
      <Slider tag="blur" label="Blur" value={look.blur} min={0} max={SETTINGS_BLUR_MAX} unit="" onChange={blur => setSettingsLook({ blur })} />
      <Slider tag="transparency" label="See-through" value={look.transparency} min={0} max={100} unit="%" onChange={transparency => setSettingsLook({ transparency })} />
      <div ref={boxRef} className="relative">
        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/50">Colour</div>
        <button
          type="button"
          data-settings-look="color"
          title="The menu's colour"
          onClick={() => setOpen(value => !value)}
          className="block h-[18px] w-[34px] rounded border border-white/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ background: look.color }}
        />
        {open && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-[176px] rounded-md border border-white/15 bg-[#14161a] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.6)]" data-settings-look-palette>
            <div className="grid grid-cols-5 gap-1.5">
              {SETTINGS_SWATCHES.map(color => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => setSettingsLook({ color })}
                  className={`h-6 w-6 rounded border ${look.color === color ? 'border-white ring-1 ring-white/70' : 'border-white/20 hover:border-white/60'}`}
                  style={{ background: color }}
                />
              ))}
            </div>
            <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/60">
              Any colour
              <input type="color" value={look.color} onChange={event => setSettingsLook({ color: event.target.value })} className="h-6 w-10 cursor-pointer rounded border border-white/20 bg-transparent p-0" />
            </label>
            <button type="button" onClick={() => { setSettingsLook(DEFAULT_SETTINGS_LOOK); setOpen(false) }} className="mt-2 w-full rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10">
              Back to the defaults
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
