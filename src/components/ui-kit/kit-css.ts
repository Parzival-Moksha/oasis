// The UI kit's stylesheet: one set of rules per menu style. Every kit element carries data-kit-style="<style>",
// so a sample can show another style than the one in use, and the one big switch restyles everything at once.
// Textures: public/ui/rail (cut from the painted atlases), public/ui/spellbook (page backgrounds).

const GOLD_TEXT = 'background: linear-gradient(180deg, #fff3cf 0%, #ecc978 58%, #b98a3a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;'
const SERIF = "var(--font-cinzel), 'Palatino Linotype', Palatino, Georgia, serif"
const BODY_SERIF = "var(--font-cormorant), 'Palatino Linotype', Palatino, Georgia, serif"

export const KIT_CSS = `
/* ── shared ──────────────────────────────────────────────────────────────── */
/* No position here: the menu that uses the kit places the panel (fixed, absolute…); the kit only dresses it. */
.kit-panel { display: flex; flex-direction: column; min-height: 0; color: var(--kit-fg, #eef1f5); }
.kit-panel-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 8px; }
.kit-panel-title { flex: 1; min-width: 0; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; font-size: 13px; }
.kit-panel-body { min-height: 0; flex: 1; overflow-y: auto; padding: 4px 12px 12px; scrollbar-width: thin; }
.kit-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; margin-bottom: 4px; }
.kit-hint { display: block; font-size: 11px; opacity: 0.55; margin-top: 2px; line-height: 1.3; }
.kit-btn, .kit-tile, .kit-tab, .kit-close, .kit-toggle { transition: transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.3), filter 140ms ease-out, background 140ms ease-out, border-color 140ms ease-out, box-shadow 140ms ease-out; }
.kit-btn:hover:not(:disabled), .kit-tile:hover:not(:disabled), .kit-tab:hover, .kit-close:hover { transform: scale(1.06); }
.kit-btn:active:not(:disabled), .kit-tile:active:not(:disabled) { transform: scale(0.97); }
.kit-btn { cursor: pointer; padding: 8px 16px; font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
.kit-btn:disabled, .kit-tile:disabled { cursor: default; opacity: 0.45; filter: grayscale(0.7); }
.kit-tile { position: relative; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; min-height: 120px; padding: 0; text-align: left; }
.kit-tile-pic { position: absolute; inset: 0; background-size: cover; background-position: center; }
.kit-tile-pic::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.78) 100%); }
.kit-tile-text { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px; }
.kit-tile-icon { flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--kit-accent, #8fd3ff); color: #0b0c10; font-size: 15px; box-shadow: 0 0 12px var(--kit-accent, #8fd3ff); }
.kit-tile-label { display: block; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; color: #fff; text-shadow: 0 2px 6px #000; }
.kit-tile-sub { display: block; font-size: 11px; color: rgba(255,255,255,0.75); text-shadow: 0 1px 4px #000; }
.kit-tile-badge { position: absolute; top: 8px; right: 8px; padding: 2px 7px; border-radius: 99px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; background: rgba(0,0,0,0.65); color: #fff; border: 1px solid rgba(255,255,255,0.35); }
.kit-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 6px 0; user-select: none; }
.kit-toggle-track { position: relative; flex: none; width: 46px; height: 24px; border-radius: 99px; }
.kit-toggle-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; transition: transform 180ms cubic-bezier(0.3, 1.4, 0.5, 1); }
.kit-toggle[data-on="1"] .kit-toggle-knob { transform: translateX(22px); }
.kit-toggle-text { min-width: 0; font-size: 13px; }
.kit-slider { display: block; padding: 4px 0; }
.kit-slider-row { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px; }
.kit-slider input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; background: transparent; cursor: pointer; }
.kit-slider input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 99px; }
.kit-slider input[type=range]::-moz-range-track { height: 6px; border-radius: 99px; }
.kit-slider input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -5px; border-radius: 50%; }
.kit-slider input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; border: 0; }
.kit-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.kit-tab { flex: 1 1 auto; cursor: pointer; padding: 7px 12px; font-size: 11.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
.kit-field { display: block; }
.kit-field input, .kit-field textarea, .kit-field select { width: 100%; padding: 8px 10px; font-size: 13px; outline: none; font-family: inherit; }
.kit-close { flex: none; cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; }
.kit-dialog-backdrop { position: fixed; inset: 0; z-index: 30000; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(4,6,14,0.45), rgba(4,6,14,0.82)); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); animation: kitFade 160ms ease-out both; }
.kit-dialog { width: min(460px, calc(100vw - 32px)); animation: kitPop 260ms cubic-bezier(0.2, 1.3, 0.4, 1) both; }
.kit-dialog-body { font-size: 14px; line-height: 1.45; padding: 4px 16px 6px; }
.kit-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px 14px; }
@keyframes kitFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes kitPop { from { opacity: 0; transform: scale(0.86) translateY(10px); } to { opacity: 1; transform: none; } }
.kit-dialog[data-danger="1"] { animation: kitPop 260ms cubic-bezier(0.2, 1.3, 0.4, 1) both, kitDangerPulse 2.4s ease-in-out 300ms infinite; }
@keyframes kitDangerPulse { 0%, 100% { filter: drop-shadow(0 0 0 rgba(255,70,70,0)); } 50% { filter: drop-shadow(0 0 18px rgba(255,70,70,0.45)); } }
@media (prefers-reduced-motion: reduce) { .kit-dialog, .kit-dialog-backdrop { animation: none !important; } }

/* ── GLASS: see-through, blur, a colour (Settings: the look controls) ───── */
.kit-panel[data-kit-style="glass"], .kit-dialog[data-kit-style="glass"] { background: var(--kit-glass-bg, rgba(31,33,37,0.25)); -webkit-backdrop-filter: var(--kit-glass-blur, blur(5px)); backdrop-filter: var(--kit-glass-blur, blur(5px)); border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12); font-family: inherit; }
.kit-dialog[data-kit-style="glass"][data-danger="1"] { border-color: rgba(255,110,110,0.55); }
[data-kit-style="glass"].kit-btn { border-radius: 8px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.07); color: #fff; }
[data-kit-style="glass"].kit-btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.5); }
[data-kit-style="glass"].kit-btn[data-variant="primary"] { border-color: rgba(143,211,255,0.7); background: rgba(143,211,255,0.2); }
[data-kit-style="glass"].kit-btn[data-variant="danger"] { border-color: rgba(255,110,110,0.8); background: rgba(255,80,80,0.25); }
[data-kit-style="glass"].kit-tile { border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: #0b0f1a; box-shadow: 0 8px 22px rgba(0,0,0,0.45); }
[data-kit-style="glass"].kit-tile:hover:not(:disabled) { border-color: var(--kit-accent, #8fd3ff); box-shadow: 0 12px 30px rgba(0,0,0,0.5), 0 0 26px -6px var(--kit-accent, #8fd3ff); }
[data-kit-style="glass"] .kit-toggle-track, [data-kit-style="glass"].kit-toggle .kit-toggle-track { background: rgba(255,255,255,0.14); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18); }
[data-kit-style="glass"].kit-toggle[data-on="1"] .kit-toggle-track { background: var(--kit-accent, #8fd3ff); }
[data-kit-style="glass"].kit-toggle .kit-toggle-knob { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
[data-kit-style="glass"].kit-slider input::-webkit-slider-runnable-track { background: rgba(255,255,255,0.18); }
[data-kit-style="glass"].kit-slider input::-moz-range-track { background: rgba(255,255,255,0.18); }
[data-kit-style="glass"].kit-slider input::-webkit-slider-thumb { background: #fff; box-shadow: 0 0 0 3px var(--kit-accent, #8fd3ff); }
[data-kit-style="glass"].kit-slider input::-moz-range-thumb { background: #fff; box-shadow: 0 0 0 3px var(--kit-accent, #8fd3ff); }
[data-kit-style="glass"].kit-tab { border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.65); }
[data-kit-style="glass"].kit-tab[data-on="1"] { border-color: rgba(252,211,77,0.65); background: rgba(252,211,77,0.12); color: #fde68a; }
[data-kit-style="glass"].kit-field input, [data-kit-style="glass"].kit-field textarea, [data-kit-style="glass"].kit-field select { border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.35); color: #fff; }
[data-kit-style="glass"].kit-field input:focus, [data-kit-style="glass"].kit-field textarea:focus { border-color: rgba(143,211,255,0.8); }
[data-kit-style="glass"].kit-close { border-radius: 8px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #fff; }

/* ── FORGED: jewelled iron, stone plates, gold letters ──────────────────── */
.kit-panel[data-kit-style="forged"], .kit-dialog[data-kit-style="forged"] { border-style: solid; border-color: transparent; border-width: 40px 30px 28px 30px; border-image: url(/ui/rail/frame-9.png) 165 125 115 125 / 40px 30px 28px 30px / 0 stretch; background: linear-gradient(180deg, rgba(14,15,20,0.94), rgba(8,9,13,0.97)) 6px 15px / calc(100% - 12.5px) calc(100% - 22px) no-repeat border-box, url(/ui/spellbook/frame/page-bg-agent.jpg) 6px 15px / calc(100% - 12.5px) calc(100% - 22px) no-repeat border-box; background-clip: border-box; border-radius: 0; font-family: ${BODY_SERIF}; --kit-fg: #efe6d2; }
.kit-panel[data-kit-style="forged"] .kit-panel-head, .kit-dialog[data-kit-style="forged"] .kit-panel-head { padding-top: 0; }
.kit-panel[data-kit-style="forged"] .kit-panel-title, .kit-dialog[data-kit-style="forged"] .kit-panel-title { font-family: ${SERIF}; font-size: 15px; ${GOLD_TEXT} }
[data-kit-style="forged"] .kit-label, .kit-panel[data-kit-style="forged"] .kit-label { font-family: ${SERIF}; color: #e3c27a; opacity: 0.9; }
[data-kit-style="forged"].kit-btn { border: 0; padding: 12px 24px 11px; background: url(/ui/rail/plate-silver.png) center / 100% 100% no-repeat; color: #f1dca8; font-family: ${SERIF}; text-shadow: 0 1px 0 #000; filter: drop-shadow(0 4px 5px rgba(0,0,0,0.5)); }
[data-kit-style="forged"].kit-btn[data-variant="primary"] { background-image: url(/ui/rail/plate-gold.png); }
[data-kit-style="forged"].kit-btn[data-variant="danger"] { background-image: url(/ui/rail/plate-red.png); color: #ffe0c8; }
[data-kit-style="forged"].kit-btn:hover:not(:disabled) { filter: drop-shadow(0 6px 8px rgba(0,0,0,0.55)) brightness(1.22); }
[data-kit-style="forged"].kit-tile { border: 3px solid transparent; border-image: url(/ui/rail/plate-gold.png) 46 / 14px / 2px stretch; background: #0b0f1a; border-radius: 0; }
[data-kit-style="forged"].kit-tile .kit-tile-label { font-family: ${SERIF}; ${GOLD_TEXT} filter: drop-shadow(0 2px 3px #000); }
[data-kit-style="forged"].kit-tile:hover:not(:disabled) { filter: brightness(1.15) drop-shadow(0 0 12px rgba(245,201,106,0.6)); }
[data-kit-style="forged"].kit-toggle .kit-toggle-track { background: #0b0907; box-shadow: inset 0 1px 3px #000, 0 0 0 1px rgba(201,162,86,0.7), 0 0 0 3px rgba(40,30,18,0.9); }
[data-kit-style="forged"].kit-toggle .kit-toggle-knob { background: radial-gradient(circle at 35% 30%, #fff3cf 0%, #e2b85e 45%, #7a5216 100%); box-shadow: 0 1px 2px #000; }
[data-kit-style="forged"].kit-toggle[data-on="1"] .kit-toggle-knob { background: radial-gradient(circle at 35% 30%, #d9ffe9 0%, #36d68a 45%, #0d5a34 100%); box-shadow: 0 0 10px #36d68a; }
[data-kit-style="forged"].kit-toggle .kit-toggle-text { font-family: ${BODY_SERIF}; font-size: 15px; }
[data-kit-style="forged"].kit-slider { font-family: ${BODY_SERIF}; }
[data-kit-style="forged"].kit-slider input::-webkit-slider-runnable-track { background: #0b0907; box-shadow: inset 0 1px 2px #000, 0 0 0 1px rgba(201,162,86,0.6); }
[data-kit-style="forged"].kit-slider input::-moz-range-track { background: #0b0907; box-shadow: 0 0 0 1px rgba(201,162,86,0.6); }
[data-kit-style="forged"].kit-slider input::-webkit-slider-thumb { background: radial-gradient(circle at 35% 30%, #fff3cf, #e2b85e 45%, #7a5216); transform: rotate(45deg); border-radius: 3px; }
[data-kit-style="forged"].kit-slider input::-moz-range-thumb { background: #e2b85e; border-radius: 3px; }
[data-kit-style="forged"].kit-tab { border: 0; padding: 11px 20px 10px; background: url(/ui/rail/plate-silver.png) center / 100% 100% no-repeat; color: #d9cba9; font-family: ${SERIF}; text-shadow: 0 1px 0 #000; }
[data-kit-style="forged"].kit-tab[data-on="1"] { background-image: url(/ui/rail/plate-gold.png); color: #fff3cf; filter: drop-shadow(0 0 8px rgba(245,201,106,0.6)); }
[data-kit-style="forged"].kit-field input, [data-kit-style="forged"].kit-field textarea, [data-kit-style="forged"].kit-field select { border: 1px solid rgba(201,162,86,0.6); border-radius: 4px; background: rgba(10,8,6,0.75); color: #f1dca8; font-family: ${BODY_SERIF}; font-size: 15px; box-shadow: inset 0 1px 3px #000; }
[data-kit-style="forged"].kit-close { border: 0; background: url(/ui/rail/plate-red.png) center / 100% 100% no-repeat; color: #ffe2c2; width: 40px; }

/* ── PARCHMENT: painted parchment in carved frames, ink ─────────────────── */
.kit-panel[data-kit-style="parchment"], .kit-dialog[data-kit-style="parchment"] { border: 22px solid transparent; border-image: url(/ui/rail/parchment-wood.png) 62 fill / 22px / 4px stretch; background: none; font-family: ${BODY_SERIF}; --kit-fg: #34230f; text-shadow: 0 1px 0 rgba(255,246,220,0.5); }
.kit-panel[data-kit-style="parchment"] .kit-panel-title, .kit-dialog[data-kit-style="parchment"] .kit-panel-title { font-family: ${SERIF}; font-size: 15px; color: #4a2d0c; }
[data-kit-style="parchment"] .kit-label, .kit-panel[data-kit-style="parchment"] .kit-label { font-family: ${SERIF}; color: #5d3a10; opacity: 0.85; }
[data-kit-style="parchment"].kit-btn { border: 12px solid transparent; border-image: url(/ui/rail/parchment-stone.png) 62 fill / 12px / 1px stretch; background: none; padding: 2px 10px; color: #34230f; font-family: ${SERIF}; }
[data-kit-style="parchment"].kit-btn[data-variant="primary"] { border-image-source: url(/ui/rail/parchment-gold.png); }
[data-kit-style="parchment"].kit-btn[data-variant="danger"] { border-image-source: url(/ui/rail/parchment-wood.png); color: #7a1a10; }
[data-kit-style="parchment"].kit-tile { border: 12px solid transparent; border-image: url(/ui/rail/parchment-gold.png) 62 / 12px / 0 stretch; background: #2a1d10; }
[data-kit-style="parchment"].kit-tile .kit-tile-label { font-family: ${SERIF}; }
[data-kit-style="parchment"].kit-toggle .kit-toggle-track { background: #d9c49a; box-shadow: inset 0 1px 3px rgba(60,35,10,0.6), 0 0 0 1px #6b4a1e; }
[data-kit-style="parchment"].kit-toggle .kit-toggle-knob { background: radial-gradient(circle at 35% 30%, #c0392b, #7b1d14); box-shadow: 0 1px 2px rgba(0,0,0,0.6); }
[data-kit-style="parchment"].kit-toggle[data-on="1"] .kit-toggle-track { background: #a8c88a; }
[data-kit-style="parchment"].kit-toggle .kit-toggle-text { font-size: 15px; }
[data-kit-style="parchment"].kit-slider input::-webkit-slider-runnable-track { background: #c8b083; box-shadow: inset 0 1px 2px rgba(60,35,10,0.6); }
[data-kit-style="parchment"].kit-slider input::-moz-range-track { background: #c8b083; }
[data-kit-style="parchment"].kit-slider input::-webkit-slider-thumb { background: radial-gradient(circle at 35% 30%, #c0392b, #7b1d14); }
[data-kit-style="parchment"].kit-slider input::-moz-range-thumb { background: #9b2a1c; }
[data-kit-style="parchment"].kit-tab { border: 0; border-bottom: 2px solid rgba(90,58,16,0.35); background: none; color: #6b4a1e; font-family: ${SERIF}; }
[data-kit-style="parchment"].kit-tab[data-on="1"] { border-bottom-color: #9b2a1c; color: #34230f; }
[data-kit-style="parchment"].kit-field input, [data-kit-style="parchment"].kit-field textarea, [data-kit-style="parchment"].kit-field select { border: 0; border-bottom: 1.5px solid #6b4a1e; border-radius: 0; background: rgba(255,248,226,0.45); color: #34230f; font-family: ${BODY_SERIF}; font-size: 15px; }
[data-kit-style="parchment"].kit-close { border: 0; background: none; color: #7b1d14; font-size: 18px; }

/* ── RUNE: bronze-edged dark tablets ─────────────────────────────────────── */
.kit-panel[data-kit-style="rune"], .kit-dialog[data-kit-style="rune"] { border-radius: 6px; border: 1px solid #b89358; background: linear-gradient(180deg, rgba(52,38,22,0.96) 0%, rgba(30,21,12,0.97) 60%, rgba(22,15,8,0.98) 100%); box-shadow: 0 16px 40px rgba(0,0,0,0.6), inset 0 0 0 3px #1b130b, inset 0 0 0 4px rgba(214,178,116,0.45); font-family: ${BODY_SERIF}; --kit-fg: #f6e7c8; }
.kit-panel[data-kit-style="rune"] .kit-panel-title, .kit-dialog[data-kit-style="rune"] .kit-panel-title { font-family: ${SERIF}; font-variant: small-caps; text-transform: none; letter-spacing: 0.08em; font-size: 16px; color: #f0d199; }
[data-kit-style="rune"] .kit-label, .kit-panel[data-kit-style="rune"] .kit-label { font-family: ${SERIF}; color: #e8c98a; opacity: 0.85; }
[data-kit-style="rune"].kit-btn { border-radius: 4px; border: 1px solid #b89358; background: linear-gradient(180deg, #43321f, #1b130b); color: #f6e7c8; font-family: ${SERIF}; font-variant: small-caps; text-transform: none; letter-spacing: 0.06em; font-size: 14px; box-shadow: inset 0 0 0 2px #1b130b, inset 0 0 0 3px rgba(214,178,116,0.4); }
[data-kit-style="rune"].kit-btn[data-variant="primary"] { border-color: #f0d199; color: #fff3cf; }
[data-kit-style="rune"].kit-btn[data-variant="danger"] { border-color: #d0583f; color: #ffd2c2; }
[data-kit-style="rune"].kit-btn:hover:not(:disabled) { filter: brightness(1.2); }
[data-kit-style="rune"].kit-tile { border-radius: 4px; border: 1px solid #b89358; box-shadow: inset 0 0 0 2px #1b130b, inset 0 0 0 3px rgba(214,178,116,0.4); background: #1b130b; }
[data-kit-style="rune"].kit-tile .kit-tile-label { font-family: ${SERIF}; font-variant: small-caps; text-transform: none; color: #f6e7c8; }
[data-kit-style="rune"].kit-toggle .kit-toggle-track { border-radius: 4px; background: #1b130b; box-shadow: inset 0 0 0 1px #b89358; }
[data-kit-style="rune"].kit-toggle .kit-toggle-knob { border-radius: 2px; transform: rotate(45deg) scale(0.8); background: #b89358; }
[data-kit-style="rune"].kit-toggle[data-on="1"] .kit-toggle-knob { transform: translateX(22px) rotate(45deg) scale(0.8); background: #f0d199; box-shadow: 0 0 8px #f0c26e; }
[data-kit-style="rune"].kit-toggle .kit-toggle-text { font-size: 15px; }
[data-kit-style="rune"].kit-slider input::-webkit-slider-runnable-track { background: #1b130b; box-shadow: inset 0 0 0 1px #b89358; }
[data-kit-style="rune"].kit-slider input::-moz-range-track { background: #1b130b; }
[data-kit-style="rune"].kit-slider input::-webkit-slider-thumb { background: #f0d199; border-radius: 2px; transform: rotate(45deg); }
[data-kit-style="rune"].kit-slider input::-moz-range-thumb { background: #f0d199; border-radius: 2px; }
[data-kit-style="rune"].kit-tab { border-radius: 4px; border: 1px solid rgba(184,147,88,0.55); background: #1b130b; color: #d9c49a; font-family: ${SERIF}; font-variant: small-caps; text-transform: none; font-size: 13.5px; }
[data-kit-style="rune"].kit-tab[data-on="1"] { border-color: #f0d199; color: #fff3cf; box-shadow: 0 0 10px -2px #f0c26e; }
[data-kit-style="rune"].kit-field input, [data-kit-style="rune"].kit-field textarea, [data-kit-style="rune"].kit-field select { border-radius: 4px; border: 1px solid #b89358; background: #140e07; color: #f6e7c8; font-family: ${BODY_SERIF}; font-size: 15px; }
[data-kit-style="rune"].kit-close { border-radius: 4px; border: 1px solid #b89358; background: #1b130b; color: #f0d199; }
/* ── card and progress bar (all styles) ─────────────────────────────────── */
.kit-card { display: block; padding: 10px 12px; }
.kit-card-title { display: block; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; margin-bottom: 4px; }
.kit-progress { display: block; }
.kit-progress-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.kit-progress-track { position: relative; height: 10px; overflow: hidden; }
.kit-progress-fill { position: absolute; inset: 0 auto 0 0; transition: width 400ms ease-out; }
.kit-progress-fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.25) 100%); }
[data-kit-style="glass"].kit-card { border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.05); }
[data-kit-style="glass"].kit-progress .kit-progress-track { border-radius: 99px; background: rgba(255,255,255,0.14); }
[data-kit-style="glass"].kit-progress .kit-progress-fill { border-radius: 99px; background: var(--kit-accent, #8fd3ff); }
[data-kit-style="forged"].kit-card { border: 1px solid rgba(201,162,86,0.45); border-radius: 5px; background: linear-gradient(180deg, rgba(52,43,29,0.62), rgba(22,18,13,0.7)); box-shadow: inset 0 1px 0 rgba(255,225,160,0.14), inset 0 0 0 1px rgba(0,0,0,0.55); }
[data-kit-style="forged"].kit-card .kit-card-title { font-family: var(--font-cinzel), Georgia, serif; color: #e3c27a; }
[data-kit-style="forged"].kit-progress .kit-progress-track { border-radius: 3px; background: #0b0907; box-shadow: inset 0 1px 3px #000, 0 0 0 1px rgba(201,162,86,0.55); }
[data-kit-style="forged"].kit-progress .kit-progress-fill { background: linear-gradient(90deg, #9a6a24, #f5c96a); }
[data-kit-style="parchment"].kit-card { border: 1px solid rgba(107,74,30,0.55); border-radius: 3px; background: rgba(255,248,226,0.35); }
[data-kit-style="parchment"].kit-card .kit-card-title { font-family: var(--font-cinzel), Georgia, serif; color: #4a2d0c; }
[data-kit-style="parchment"].kit-progress .kit-progress-track { background: #c8b083; box-shadow: inset 0 1px 2px rgba(60,35,10,0.6); }
[data-kit-style="parchment"].kit-progress .kit-progress-fill { background: #9b2a1c; }
[data-kit-style="rune"].kit-card { border: 1px solid rgba(184,147,88,0.6); border-radius: 4px; background: #1b130b; box-shadow: inset 0 0 0 2px #120c06; }
[data-kit-style="rune"].kit-card .kit-card-title { font-family: var(--font-cinzel), Georgia, serif; font-variant: small-caps; text-transform: none; color: #f0d199; }
[data-kit-style="rune"].kit-progress .kit-progress-track { border-radius: 2px; background: #140e07; box-shadow: inset 0 0 0 1px #b89358; }
[data-kit-style="rune"].kit-progress .kit-progress-fill { background: linear-gradient(90deg, #8a6a34, #f0d199); }

/* ── chosen tiles, and the small picture-pick tile (skies, grounds) ─────── */
.kit-pick { position: relative; display: flex; flex-direction: column; cursor: pointer; padding: 0; overflow: hidden; text-align: left; transition: transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.3), filter 140ms ease-out, box-shadow 140ms ease-out; }
.kit-pick:hover:not(:disabled) { transform: scale(1.05); z-index: 1; }
.kit-pick-pic { display: block; width: 100%; aspect-ratio: 16 / 10; background-size: cover; background-position: center; }
.kit-pick-label { display: block; padding: 4px 6px; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-kit-style="glass"].kit-pick { border-radius: 8px; border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.35); color: #fff; }
[data-kit-style="forged"].kit-pick { border: 1px solid rgba(201,162,86,0.55); border-radius: 4px; background: #0b0907; color: #e9d6a8; font-family: var(--font-cinzel), Georgia, serif; }
[data-kit-style="parchment"].kit-pick { border: 1px solid #6b4a1e; border-radius: 2px; background: rgba(255,248,226,0.5); color: #34230f; }
[data-kit-style="rune"].kit-pick { border: 1px solid #b89358; border-radius: 4px; background: #1b130b; color: #f6e7c8; }
[data-kit-style="glass"].kit-tile[data-selected="1"], [data-kit-style="glass"].kit-pick[data-selected="1"] { border-color: var(--kit-accent, #fde68a); box-shadow: 0 0 0 2px var(--kit-accent, #fde68a), 0 0 22px -4px var(--kit-accent, #fde68a); }
[data-kit-style="forged"].kit-tile[data-selected="1"], [data-kit-style="forged"].kit-pick[data-selected="1"] { filter: brightness(1.18) drop-shadow(0 0 10px rgba(245,201,106,0.85)); border-color: #f5c96a; }
[data-kit-style="parchment"].kit-tile[data-selected="1"], [data-kit-style="parchment"].kit-pick[data-selected="1"] { box-shadow: 0 0 0 3px #9b2a1c; }
[data-kit-style="rune"].kit-tile[data-selected="1"], [data-kit-style="rune"].kit-pick[data-selected="1"] { border-color: #f0d199; box-shadow: 0 0 14px -2px #f0c26e, inset 0 0 0 2px #1b130b; }

/* ── large fields ── */
.kit-field[data-size="large"] input, .kit-field[data-size="large"] textarea, .kit-field[data-size="large"] select { padding: 12px 14px; font-size: 16px; }
.kit-field[data-size="large"] .kit-label { font-size: 12px; }
.kit-field select option { color: #111; background: #fff; }

/* ── readable text inside every kit panel, also in menus written before the kit ── */
.kit-panel[data-kit-style="glass"], .kit-dialog[data-kit-style="glass"] { text-shadow: 0 1px 2px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.45); font-family: var(--font-space-grotesk), 'Segoe UI', system-ui, sans-serif; }
.kit-panel .font-mono { font-family: inherit; }
.kit-panel:not([data-kit-style="parchment"]) :is(.text-gray-400, .text-gray-500, .text-gray-600, .text-white\/35, .text-white\/40, .text-white\/42, .text-white\/45, .text-white\/50, .text-white\/55, .text-white\/60) { color: rgba(236, 232, 224, 0.8) !important; }
.kit-panel:not([data-kit-style="parchment"]) :is(.text-gray-300, .text-white\/65, .text-white\/70, .text-white\/75) { color: rgba(246, 243, 236, 0.92) !important; }
.kit-panel[data-kit-style="forged"] .text-sm, .kit-panel[data-kit-style="rune"] .text-sm { font-size: 15px; }

/* ══ SWITCH DESIGNS (data-toggle): win over every style's slide switch ══ */
.kit-toggle[data-toggle]:not([data-toggle="slide"]) .kit-toggle-track { background: none; box-shadow: none; border-radius: 0; }
.kit-toggle[data-toggle]:not([data-toggle="slide"]) .kit-toggle-knob { transform: none; }
.kit-toggle input:focus-visible + .kit-toggle-track { outline: 2px solid #fde68a; outline-offset: 3px; }

/* Gem socket: an octagonal iron socket; on, a faceted emerald glows in it */
.kit-toggle.kit-toggle[data-toggle="gem"] .kit-toggle-track { width: 30px; height: 30px; clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); background: linear-gradient(145deg, #b89358 0%, #5a4220 45%, #2a1d10 100%); }
.kit-toggle.kit-toggle[data-toggle="gem"] .kit-toggle-knob { top: 4px; left: 4px; width: 22px; height: 22px; border-radius: 0; clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); background: radial-gradient(circle at 40% 35%, #2b2b2e 0%, #0c0c0e 70%); box-shadow: inset 0 2px 4px #000; transition: background 160ms ease-out, filter 200ms ease-out; }
.kit-toggle.kit-toggle[data-toggle="gem"][data-on="1"] .kit-toggle-knob { background: conic-gradient(from 20deg at 50% 50%, #b9ffd9, #2fd384, #0f7a47, #63f0a8, #0b5c35, #b9ffd9); filter: drop-shadow(0 0 6px #36d68a) brightness(1.15); }
.kit-toggle.kit-toggle[data-toggle="gem"][data-on="1"] .kit-toggle-track { filter: drop-shadow(0 0 8px rgba(54, 214, 138, 0.65)); }

/* Rune lever: a brass lever on a dark slot; thrown right for on, and the rune at its foot lights */
.kit-toggle.kit-toggle[data-toggle="lever"] .kit-toggle-track { width: 40px; height: 30px; background: linear-gradient(180deg, #1b130b, #0c0805); border-radius: 4px; box-shadow: inset 0 0 0 1px #b89358, inset 0 2px 4px #000; }
.kit-toggle.kit-toggle[data-toggle="lever"] .kit-toggle-track::after { content: 'ᚱ'; position: absolute; left: 50%; bottom: 1px; transform: translateX(-50%); font-size: 11px; line-height: 1; color: #4a3a22; transition: color 160ms, text-shadow 160ms; }
.kit-toggle.kit-toggle[data-toggle="lever"][data-on="1"] .kit-toggle-track::after { color: #9cf3ff; text-shadow: 0 0 6px #4fd8ff, 0 0 12px #4fd8ff; }
.kit-toggle.kit-toggle[data-toggle="lever"] .kit-toggle-knob { top: 3px; left: calc(50% - 3px); width: 6px; height: 20px; border-radius: 3px 3px 1px 1px; background: linear-gradient(90deg, #7a5216, #f5d488 45%, #9a6a24); transform-origin: 50% 100%; transform: rotate(-38deg); transition: transform 220ms cubic-bezier(0.3, 1.6, 0.5, 1); box-shadow: 0 1px 2px #000; }
.kit-toggle.kit-toggle[data-toggle="lever"] .kit-toggle-knob::before { content: ''; position: absolute; top: -4px; left: -2px; width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff3cf, #c9952f 55%, #6b4a12); }
.kit-toggle.kit-toggle[data-toggle="lever"][data-on="1"] .kit-toggle-knob { transform: rotate(38deg); }

/* Flip switch: a machine toggle on a riveted plate; up for on, with a lamp beside it */
.kit-toggle.kit-toggle[data-toggle="flip"] .kit-toggle-track { width: 44px; height: 30px; border-radius: 4px; background: linear-gradient(180deg, #4a4f58, #23262c); box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), inset 0 0 0 1px #0d0f12, 0 2px 3px rgba(0,0,0,0.5); }
.kit-toggle.kit-toggle[data-toggle="flip"] .kit-toggle-track::before { content: ''; position: absolute; left: 7px; top: 9px; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 50% 40%, #3a1a14, #1a0a08); box-shadow: inset 0 1px 2px #000, 0 0 0 1px #0d0f12; transition: background 120ms, box-shadow 160ms; }
.kit-toggle.kit-toggle[data-toggle="flip"][data-on="1"] .kit-toggle-track::before { background: radial-gradient(circle at 45% 35%, #fff2c2, #ffb23a 50%, #c55a00); box-shadow: 0 0 8px #ffb23a, 0 0 0 1px #0d0f12; }
.kit-toggle.kit-toggle[data-toggle="flip"] .kit-toggle-knob { left: auto; right: 8px; top: 13px; width: 10px; height: 14px; border-radius: 2px 2px 5px 5px; background: linear-gradient(90deg, #8a9099, #e7ebf0 50%, #7b818a); box-shadow: 0 2px 2px rgba(0,0,0,0.6); transition: top 120ms ease-out, height 120ms ease-out, border-radius 120ms; }
.kit-toggle.kit-toggle[data-toggle="flip"][data-on="1"] .kit-toggle-knob { top: 3px; border-radius: 5px 5px 2px 2px; box-shadow: 0 -1px 2px rgba(0,0,0,0.5); }

/* Check plate: a small framed stone; on, a gold check is set into it */
.kit-toggle.kit-toggle[data-toggle="plate"] .kit-toggle-track { width: 28px; height: 28px; border-radius: 3px; background: linear-gradient(160deg, #3a3d44, #1b1d21); box-shadow: inset 0 0 0 1px #b89358, inset 0 0 0 3px #15110b, inset 0 0 0 4px rgba(184,147,88,0.45), inset 0 3px 6px rgba(0,0,0,0.8); }
.kit-toggle.kit-toggle[data-toggle="plate"] .kit-toggle-knob { top: 0; left: 0; width: 28px; height: 28px; background: none; display: flex; align-items: center; justify-content: center; }
.kit-toggle.kit-toggle[data-toggle="plate"] .kit-toggle-knob::after { content: '✓'; font-size: 20px; font-weight: 900; line-height: 1; color: #f5c96a; text-shadow: 0 1px 0 #6b4a12, 0 0 8px rgba(245,201,106,0.8); transform: scale(0.2); opacity: 0; transition: transform 200ms cubic-bezier(0.3, 1.8, 0.5, 1), opacity 120ms; }
.kit-toggle.kit-toggle[data-toggle="plate"][data-on="1"] .kit-toggle-knob::after { transform: scale(1); opacity: 1; }
.kit-toggle[data-toggle]:hover .kit-toggle-track { filter: brightness(1.15); }
`