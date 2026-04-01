# Oasis — The Oasis

**Conjure 3D worlds from text. Build. Paint. Persist.**

A standalone 3D world builder with AI-powered text-to-3D conjuring, terrain painting, procedural terrain generation, and full world persistence. Built with Next.js 14 + React Three Fiber + Three.js + Zustand.

## Quick Start

```bash
git clone https://github.com/Parzival-Moksha/oasis.git
cd oasis
pnpm install
```

Create a `.env` file with at least one API key:

```env
MESHY_API_KEY=your_key_here       # meshy.ai — text-to-3D + rigging + animation
TRIPO_API_KEY=your_key_here       # tripo3d.ai — text-to-3D (fast)
OPENROUTER_API_KEY=your_key_here  # openrouter.ai — LLM craft + terrain generation
```

Then run:

```bash
pnpm dev
```

Open [http://localhost:4516](http://localhost:4516)

## Hermes Skill (Oasis)

If you use Hermes, this repo includes an installable skill at `skills/oasis`.

```bash
hermes skills install Parzival-Moksha/oasis/skills/oasis
```

You can also point Hermes at the raw repo URL:

- `https://github.com/Parzival-Moksha/oasis`

Then ask Hermes to install the `oasis` skill and guide Oasis setup.

Paste-ready prompt for Hermes:

```text
Install the oasis skill from https://github.com/Parzival-Moksha/oasis and guide me through connecting Oasis to this Hermes instance.
```

Expected Hermes guidance flow:

1. Give you a pairing block (`HERMES_API_BASE`, `HERMES_API_KEY`, optional `HERMES_MODEL`).
2. Give the SSH tunnel command if Hermes runs remotely.
3. Tell you to open the Oasis Hermes panel, click `pair`, paste, save, then press `sync`.

Hermes security defaults in Oasis:

- `/api/hermes` is localhost-only by default.
- Pairing writes (`POST`/`DELETE /api/hermes/config`) are localhost-only by default.
- To allow remote access intentionally, set:
  - `OASIS_ALLOW_REMOTE_HERMES_PROXY=true`
  - `OASIS_ALLOW_REMOTE_HERMES_PAIRING=true`
- Local pairing is stored in `data/hermes-config.local.json` (git-ignored).

## What You Can Do

- **Conjure** — Type a prompt, get a 3D model. Multiple providers (Meshy, Tripo, Rodin) with different quality tiers.
- **Animate** — Rig and animate conjured characters. Walk cycles, idle animations, custom motion.
- **Paint** — Paint ground textures tile-by-tile with real-time brush. Grass, stone, sand, lava, and more.
- **Terrain** — Describe a landscape in natural language, get procedural terrain with height maps and vertex-colored biomes.
- **Craft** — LLM-powered scene generation. Describe a scene, get procedural geometry.
- **Build** — Place, move, rotate, scale any object. 480+ built-in assets (cyberpunk, medieval, urban, furniture, nature). Full transform gizmos.
- **Light** — Add point lights, spotlights, hemisphere lights. Full color, intensity, shadow control.
- **Persist** — Every change autosaves. Create multiple worlds, switch between them.
- **Sky** — 24 sky environments: 4 night panoramas + 8 Poly Haven HDRIs (alps, grotto, sunset, stadium...) + 10 drei presets + procedural stars

## Controls

| Key | Action |
|-----|--------|
| WASD | Move camera |
| Mouse drag | Look around |
| Scroll | Zoom |
| W / E / R | Translate / Rotate / Scale (when object selected) |
| Escape | Deselect / Cancel placement |
| Delete | Remove selected object |
| Right-click ground | Send animated character to position (RTS-style) |

## Architecture

```
src/
  components/
    Scene.tsx              — Main R3F canvas, sky, post-processing
    forge/
      WizardConsole.tsx    — The command center (conjure, craft, assets, settings)
      WorldObjects.tsx     — Renders all placed objects + placement system
      ConjuredObject.tsx   — Individual GLB renderer with spawn VFX
  store/
    oasisStore.ts          — Zustand state (worlds, assets, UI)
  lib/
    conjure/               — Provider clients (Meshy, Tripo, Rodin) + registry
    forge/                 — World persistence, terrain generator
  app/
    api/                   — Next.js API routes (conjure, craft, terrain, worlds)
data/
  conjured-registry.json   — Asset metadata (GLB paths, providers, thumbnails)
  worlds/                  — World save files (JSON per world)
  scene-library.json       — Saved crafted scenes
public/
  conjured/                — Runtime-generated GLB files
  models/                  — Built-in asset library (Quaternius + Kenney, all CC0)
  hdri/                    — Sky environment textures
  textures/                — Ground painting textures
```

## Requirements

- Node.js 18+
- pnpm (recommended) or npm
- At least one API key (Meshy, Tripo, or OpenRouter)

## API Keys

| Provider | What For | Get Key |
|----------|----------|---------|
| [Meshy](https://meshy.ai) | Text-to-3D, image-to-3D, rigging, animation | Dashboard > API Keys |
| [Tripo](https://tripo3d.ai) | Text-to-3D, image-to-3D (fast) | Dashboard > API |
| [OpenRouter](https://openrouter.ai) | LLM craft + terrain generation | Dashboard > Keys |

You need at least one 3D provider key (Meshy or Tripo) to conjure. OpenRouter enables terrain and craft features.

## Default World

The repo ships with a showcase world (`forge-default`) containing:
- Oasis logo (image-to-3D)
- Walking character (animated, right-click to move)
- Maitreya shrine, Pixie Amazon, Moana boat
- Cyberpunk street lights
- Painted stone/grass circular plaza
- Venice sunset sky

## Asset Credits

Built-in 3D assets and environments provided by these incredible creators (all CC0 / public domain):

- **[Quaternius](https://quaternius.com)** — Cyberpunk Game Kit, Sci-Fi Essentials, characters
- **[Kenney](https://kenney.nl)** — Retro Medieval Kit (105 models), Retro Urban Kit (124 models), Furniture Kit (140 models)
- **[Poly Haven](https://polyhaven.com)** — HDR environment maps (alps, autumn, blue grotto, belfast sunset, and more)

No attribution is legally required (CC0), but these people give away their life's work for free. Consider supporting them.

## License

MIT

---

Built by [Parzival-Moksha](https://github.com/Parzival-Moksha) with vibes, sweat, and Claude.
