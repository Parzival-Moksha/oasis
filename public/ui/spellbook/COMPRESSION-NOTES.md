# Spellbook / HUD asset compression notes

**Status:** proposal, not executed. The user wants to review before any compression runs.

## Current state (audit 2026-05-16)

Total bytes under `public/ui/`: **159,575,435 B ≈ 152.2 MiB**

Per-category:
| Folder | Bytes | Files | Avg/file |
|---|---|---|---|
| `public/ui/hud/` | 34,953,139 (~33.3 MiB) | 11 | ~3.0 MiB |
| `public/ui/spellbook/frame/` | 71,544,067 (~68.2 MiB) | 19 | ~3.6 MiB |
| `public/ui/spellbook/tiles/` | 35,896,401 (~34.2 MiB) | 52 | ~660 KiB |

**Top 10 largest files (bytes, path):**
1. 5,710,753 - `spellbook/frame/book-corner-tr.png`
2. 5,337,942 - `spellbook/frame/book-corner-br.png`
3. 5,329,156 - `spellbook/frame/book-corner-bl.png`
4. 5,175,245 - `spellbook/frame/tab-embellish-own-spells.png`
5. 4,961,482 - `spellbook/frame/book-corner-tl.png`
6. 4,915,465 - `hud/hud-backdrop.png`
7. 4,689,538 - `spellbook/frame/divider.png`
8. 4,509,863 - `spellbook/frame/tab-embellish-recipe-catalog.png`
9. 4,461,147 - `spellbook/frame/tab-embellish-combat.png`
10. 4,051,058 - `spellbook/frame/tab-embellish-creative.png`

**Dimensions sampled (file headers):**
- HUD elements (`hud/*.png`): **2048 × 2048 RGBA** — 4x the spec the user wanted at 512px, and HUD elements render at 32-64px on-screen. Massive over-sampling.
- Frame elements (`spellbook/frame/*.png`): **2048 × 2048 RGBA** (book-corner-*, divider, tab-embellish-*) and **1024 × 1024 RGB** (page-bg-*).
- Tiles (`spellbook/tiles/*.png`): **512 × 768 RGB** — closest to ideal but the .gpt2 + .nano2 variants double the catalog.

## Target sizes per category

| Category | Source res | Render res on-screen | Format | Target res | Target size |
|---|---|---|---|---|---|
| HUD corners / vials / bars / backdrop | 2048×2048 RGBA | ~32-64 px | PNG (alpha needed) | 256×256 | ~10 KiB |
| Book corners | 2048×2048 RGBA | ~120 px | PNG (alpha needed) | 384×384 | ~15 KiB |
| Tab embellishments | 2048×2048 RGBA | ~80 px | PNG (alpha needed) | 256×256 | ~12 KiB |
| Divider | 2048×2048 RGBA | ~16 px tall | PNG (alpha needed) | 1024×128 | ~10 KiB |
| Page backgrounds | 1024×1024 RGB | full panel `cover` | **JPEG q70** (no alpha) | 1024×1024 | ~50 KiB |
| Spell tiles | 512×768 RGB | ~150 px | **WebP q75** (no alpha) | 384×576 | ~30 KiB |

**Projected total after compression: ~3-5 MiB** (from 152 MiB → ~97% reduction).

## Compression tools

`sharp` is already in deps (used by Next.js image optimization). Recommended path:

```bash
# one-liner verify
pnpm list sharp
```

If `sharp` is present, write a Node script under `scripts/compress-ui-assets.mjs`. Otherwise install `imagemin` + `imagemin-pngquant` + `imagemin-webp` + `imagemin-mozjpeg` dev-deps.

WebP support note: modern Next.js + every evergreen browser supports WebP. Safe choice for spell tiles.

## Pseudo-script (do NOT run — proposal only)

```js
// scripts/compress-ui-assets.mjs
// Usage: pnpm node scripts/compress-ui-assets.mjs --dry-run
//        pnpm node scripts/compress-ui-assets.mjs --apply

import sharp from 'sharp';
import { readdir, stat, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'public/ui';
const BACKUP = 'public/ui.original.bak'; // copy originals before overwriting

const PLAN = [
  { dir: 'hud',                 width: 256,  fmt: 'png',  alpha: true,  quality: 90 },
  { dir: 'spellbook/frame',     width: 384,  fmt: 'png',  alpha: true,  quality: 90,
    overrides: {
      'divider.png':            { width: 1024, height: 128 },
      'page-bg-*.png':          { width: 1024, fmt: 'jpg', alpha: false, quality: 70 },
    },
  },
  { dir: 'spellbook/tiles',     width: 384,  fmt: 'webp', alpha: false, quality: 75 },
];

for (const { dir, width, fmt, alpha, quality, overrides = {} } of PLAN) {
  const entries = await readdir(path.join(ROOT, dir));
  for (const file of entries) {
    if (!/\.png$/i.test(file)) continue;
    const inPath = path.join(ROOT, dir, file);
    // match overrides
    const rule = Object.entries(overrides).find(([glob]) =>
      new RegExp('^' + glob.replace('*', '.*') + '$').test(file)
    )?.[1] ?? { width, fmt, alpha, quality };

    // 1. back up original
    const bakPath = path.join(BACKUP, dir, file);
    await mkdir(path.dirname(bakPath), { recursive: true });
    await copyFile(inPath, bakPath);

    // 2. resize + recode (write to a new path/extension, then rm original)
    let pipe = sharp(inPath).resize({ width: rule.width, height: rule.height, fit: 'inside' });
    let outPath = inPath;
    if (rule.fmt === 'png') {
      pipe = pipe.png({ quality: rule.quality, compressionLevel: 9, palette: true });
    } else if (rule.fmt === 'jpg') {
      pipe = pipe.flatten({ background: '#ffffff' }).jpeg({ quality: rule.quality, mozjpeg: true });
      outPath = inPath.replace(/\.png$/i, '.jpg');
    } else if (rule.fmt === 'webp') {
      pipe = pipe.webp({ quality: rule.quality, effort: 6 });
      outPath = inPath.replace(/\.png$/i, '.webp');
    }

    await pipe.toFile(outPath + '.tmp');
    // atomic-ish swap (delete old, rename tmp -> final)
    // ... `fs.rename(outPath + '.tmp', outPath)`
    console.log(`${inPath} -> ${outPath}`);
  }
}
```

## Caveats / things the user must agree to before running

1. **Format changes (PNG → JPG/WebP) break any hardcoded `.png` paths**. Need a separate codemod pass to update import strings in `src/`. Recommend keeping all alpha-required assets as PNG, only converting page-bg-* → JPG and tiles → WebP, and updating those two specific call sites.
2. **Originals must be backed up** to `public/ui.original.bak/` (gitignored) before overwriting. Or commit the originals to a separate branch.
3. **HUD corner files become redundant** once the rotation strategy lands — we keep one `hud-corner.png` and rotate it 4 ways in CSS, deleting the other 3. Same potentially applies to book-corner-*, but those are already differently-styled per corner in the existing source.
4. **Tile .gpt2 vs .nano2** duplicates — the user has two variants per spell. Halving the tile catalog (pick one variant per spell, delete the other) saves ~17 MiB on its own before any compression.
5. **chroma-key originals must stay intact** — `public/ui/wizard-textures/generated/oasis-ui-alpha-lab/*.raw.png` and `*.alpha.png` are reference truth. Exclude `wizard-textures/` from the compression script.

## Quick wins (in order of impact-per-effort)

| Action | Effort | Saved |
|---|---|---|
| Resize HUD `2048→256` PNGs | low | ~32 MiB |
| Resize frame `2048→384` PNGs | low | ~65 MiB |
| Convert page-bg-* to JPG q70 | low | ~12 MiB |
| Pick one spell-tile variant (delete .gpt2 OR .nano2 dupes) | low | ~17 MiB |
| Convert spell tiles to WebP q75 | medium (needs import path updates) | ~12 MiB |
| Rotate one HUD corner instead of 4 unique | medium (UI work) | ~10 MiB and visual coherence |

Sum: ~148 MiB recoverable out of 152 MiB.
