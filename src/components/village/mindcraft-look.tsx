'use client'

// The LOOK of Mindcraft and the work counter (Hipster). Content and logic are the Mission Wall
// agent's, in MindcraftView.tsx and WorkVowHud.tsx; those files only carry the class names below.
//
// Materials are the spell book's: painted stone plates in gem-set iron and a jewelled frame
// (public/ui/rail, cut from the atlases in public/ui/wizard-textures), the dark page, gold
// lettering. Typefaces are the two the Oasis already ships: Cinzel for names and numbers,
// Cormorant Garamond for sentences. No 3D, nothing animated at rest.

export const MC_DISPLAY = "var(--font-cinzel), 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Apple Color Emoji', 'Oasis Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif"
export const MC_BODY = "var(--font-cormorant), 'Palatino Linotype', Palatino, Georgia, 'Apple Color Emoji', 'Oasis Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif"

const CSS = `
.mc-scope { font-family: ${MC_BODY}; font-size: 15.5px; line-height: 1.3; color: #efe6d2; font-variant-numeric: lining-nums tabular-nums; }
.mc-scope .mc-eyebrow { font-family: ${MC_DISPLAY}; font-size: 11px; font-weight: 700; letter-spacing: 0.36em; text-transform: uppercase; color: #e3c27a; text-shadow: 0 1px 0 #000; }
.mc-scope .mc-title { font-family: ${MC_DISPLAY}; font-weight: 700; letter-spacing: 0.03em; color: #f1dca8; background: linear-gradient(180deg, #fff3cf 0%, #ecc978 58%, #b98a3a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 1px 0 rgba(0,0,0,0.9)); }
.mc-scope .mc-title span { -webkit-text-fill-color: rgba(239,230,210,0.5); }
.mc-scope .mc-note { font-size: 17px; color: rgba(239,230,210,0.72); }
.mc-scope .mc-label { font-family: ${MC_DISPLAY}; font-size: 10px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(227,194,122,0.85); }

/* Tabs and buttons: a painted plate each. They grow towards you on hover, in place. */
.mc-scope .mc-tab, .mc-scope .mc-btn { border: 0; border-radius: 0; background: url(/ui/rail/plate-silver.png) center / 100% 100% no-repeat; color: #efe6d2; text-align: center; cursor: pointer; filter: drop-shadow(0 4px 5px rgba(0,0,0,0.5)); transition: transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1.3), filter 150ms ease-out; }
.mc-scope .mc-tab { min-width: 128px; padding: 13px 24px 12px; }
.mc-scope .mc-tab > :first-child { font-family: ${MC_DISPLAY}; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #f1dca8; text-shadow: 0 1px 0 #000; white-space: nowrap; }
.mc-scope .mc-tab > :last-child { font-family: ${MC_BODY}; font-size: 12.5px; color: rgba(239,230,210,0.7); white-space: nowrap; }
.mc-scope .mc-tab:hover, .mc-scope .mc-btn:hover { transform: scale(1.07); filter: drop-shadow(0 6px 8px rgba(0,0,0,0.55)) brightness(1.22); }
.mc-scope .mc-tab:active, .mc-scope .mc-btn:active { transform: scale(0.97); }
.mc-scope .mc-tab[data-on="1"] { background-image: url(/ui/rail/plate-gold.png); filter: drop-shadow(0 5px 7px rgba(0,0,0,0.55)) drop-shadow(0 0 9px rgba(245,201,106,0.75)) brightness(1.18); }
.mc-scope .mc-btn { display: block; width: 100%; padding: 12px 22px 11px; font-family: ${MC_DISPLAY}; font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; color: #f1dca8; text-shadow: 0 1px 0 #000; }
.mc-scope .mc-btn[data-tone="go"] { background-image: url(/ui/rail/plate-green.png); }
.mc-scope .mc-btn[data-tone="stop"] { background-image: url(/ui/rail/plate-ember.png); }
.mc-scope .mc-close { width: 40px; height: 32px; padding: 0; border: 0; border-radius: 0; background: url(/ui/rail/plate-red.png) center / 100% 100% no-repeat; font-family: ${MC_DISPLAY}; font-size: 12px; font-weight: 700; color: #ffe2c2; text-shadow: 0 1px 0 #000; cursor: pointer; transition: transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1.3), filter 150ms ease-out; }
.mc-scope .mc-close:hover { transform: scale(1.12); filter: brightness(1.3); background-color: transparent; }

/* Rows and boxes: an inlaid panel, bronze hairline, a lit top edge. */
.mc-scope .mc-card { border: 1px solid rgba(201,162,86,0.4); border-radius: 5px; background: linear-gradient(180deg, rgba(52,43,29,0.62) 0%, rgba(22,18,13,0.66) 100%); box-shadow: inset 0 1px 0 rgba(255,225,160,0.14), inset 0 0 0 1px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4); }
.mc-scope .mc-card > button:hover { background: rgba(255,225,160,0.06); }
.mc-scope .mc-card strong, .mc-scope .mc-strong { font-family: ${MC_DISPLAY}; font-weight: 700; letter-spacing: 0.03em; }
.mc-scope .mc-track { height: 10px; border-radius: 3px; background: #0b0907; box-shadow: inset 0 1px 3px #000, 0 0 0 1px rgba(201,162,86,0.5); overflow: hidden; }
.mc-scope .mc-track > * { position: relative; border-radius: 2px; }
.mc-scope .mc-track > *::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.3) 100%); }
.mc-scope .mc-field { border: 1px solid rgba(201,162,86,0.45); border-radius: 5px; background: rgba(12,10,7,0.6); box-shadow: inset 0 1px 0 rgba(255,225,160,0.1); color: rgba(239,230,210,0.85); font-size: 14.5px; }
.mc-scope .mc-field select { border: 1px solid rgba(201,162,86,0.6); border-radius: 3px; background: #15110b; color: #f1dca8; font-family: ${MC_DISPLAY}; font-size: 12px; font-weight: 700; }
.mc-scope .mc-foot { border-top: 1px solid rgba(201,162,86,0.3); font-style: italic; font-size: 17.5px; line-height: 1.3; color: rgba(239,230,210,0.62); }

/* The counter in the HUD: a stone plate, studded along its edges (the plate's edge is tiled, not stretched). */
.mc-hud { border: 14px solid transparent !important; border-image: url(/ui/rail/plate-silver.png) 46 fill / 14px / 3px round !important; background: none !important; border-radius: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; padding: 0 6px 0 2px !important; filter: drop-shadow(0 6px 9px rgba(0,0,0,0.55)); transition: transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1.3), filter 150ms ease-out; transform-origin: 0% 100%; font-family: ${MC_BODY}; }
.mc-hud:hover { transform: scale(1.06); filter: drop-shadow(0 8px 12px rgba(0,0,0,0.6)) brightness(1.18); }
.mc-hud[data-done="1"] { border-image-source: url(/ui/rail/plate-green.png) !important; }
.mc-hud .mc-clock { font-family: ${MC_DISPLAY} !important; font-weight: 700; letter-spacing: 0.04em; }
.mc-hud .mc-status { font-family: ${MC_DISPLAY} !important; font-size: 8.5px !important; letter-spacing: 0.12em; }

/* The jewelled iron frame, nine-sliced (public/ui/rail/frame-9.png): the four corners keep their size and shape,
   and what runs between them is a plain length of the bar, which can stretch along its own axis without showing it.
   The jewels of the long sides are separate pieces of fixed size (frame-ornament-*.png). --frame-k scales the lot. */
.oasis-frame { --frame-k: 0.4; border-style: solid; border-color: transparent; border-width: calc(165px * var(--frame-k)) calc(125px * var(--frame-k)) calc(115px * var(--frame-k)) calc(125px * var(--frame-k)); border-image: url(/ui/rail/frame-9.png) 165 125 115 125 / calc(165px * var(--frame-k)) calc(125px * var(--frame-k)) calc(115px * var(--frame-k)) calc(125px * var(--frame-k)) / 4px stretch; border-radius: 10px; background: linear-gradient(180deg, rgba(13,15,22,0.9) 0%, rgba(9,10,15,0.95) 100%) border-box, url(/ui/spellbook/frame/page-bg-agent.jpg) center / cover border-box; box-shadow: 0 24px 70px rgba(0,0,0,0.6); }
.oasis-frame[data-jewels="1"]::before, .oasis-frame[data-jewels="1"]::after { content: ''; position: absolute; left: 50%; pointer-events: none; background: center / 100% 100% no-repeat; }
.oasis-frame[data-jewels="1"]::before { width: calc(234px * var(--frame-k) * 1.5); height: calc(125px * var(--frame-k) * 1.5); top: calc(-165px * var(--frame-k) - 4px - 18px * var(--frame-k)); transform: translateX(-50%); background-image: url(/ui/rail/frame-ornament-top.png); }
.oasis-frame[data-jewels="1"]::after { width: calc(110px * var(--frame-k) * 1.5); height: calc(62px * var(--frame-k) * 1.5); bottom: calc(-115px * var(--frame-k) - 4px - 10px * var(--frame-k)); transform: translateX(-50%); background-image: url(/ui/rail/frame-ornament-bottom.png); }

/* The counter's detail: the same frame, smaller. It scrolls, so it carries no jewels on its long sides. */
.mc-popup.oasis-frame { --frame-k: 0.27; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; padding: 0 2px 2px !important; width: 400px !important; border-radius: 8px !important; }
`

let injected = false
/** Call from a component that uses the classes: the stylesheet goes into the page once. */
export function useMindcraftLook(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.getElementById('oasis-mindcraft-look') ?? document.head.appendChild(document.createElement('style'))
  style.id = 'oasis-mindcraft-look'
  style.textContent = CSS
}
