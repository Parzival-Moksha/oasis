---
sidebar_position: 3
title: Your First World
---

# Your First World

Build a scene in 5 minutes using the Wizard Console.

## 1. Create a World

Click the **world selector** (top of the Wizard Console) and hit **+ Create**. Name it whatever you want.

Each world is an independent save file stored in `data/worlds/`. You can have as many as you want.

## 2. Place Some Assets

Open the **Catalog** tab in the Wizard Console. You'll see 565+ built-in 3D assets organized by category:

- **Medieval** — castles, towers, walls, weapons (Kenney Retro Medieval Kit)
- **Urban** — buildings, vehicles, street furniture (Kenney Retro Urban Kit)
- **Furniture** — chairs, tables, beds, shelves (Kenney Furniture Kit)
- **Nature** — trees, rocks, flowers
- **Characters** — people, animals, creatures

Click any asset to enter **Placement mode**. Move your mouse to position it in the world, then click to place.

## 3. Transform Objects

Select any placed object by clicking it, then use the gizmos:

| Key | Transform |
|-----|-----------|
| **W** | Translate (move) |
| **E** | Rotate |
| **R** | Scale |
| **Delete** | Remove object |

The **Joystick** panel (right side) shows the selected object's properties — position, rotation, scale, and behaviors.

## 4. Change the Sky

Open the **Settings** or use an agent to change the sky. 24 environments available:

- 4 procedural night skies (4K)
- 8 Poly Haven HDRIs (alps, sunset, grotto, etc.)
- 10 drei presets
- 1 procedural star generator

## 5. Paint the Ground

Switch to **Paint** mode (brush icon in the toolbar). Choose a texture preset:

- Grass, stone, sand, lava, snow, water, and more
- Click and drag to paint tiles
- Each tile is stored as a sparse map — only painted tiles use memory

## 6. Conjure from Text (requires API key)

Open the **Conjure** tab, type a prompt like "medieval treasure chest", select a provider (Meshy or Tripo), and hit generate. The model appears in your library when ready — click to place it.

## 7. Craft Geometry (requires API key)

Open the **Craft** tab and describe what you want: "a cyberpunk cityscape with neon towers". Claude generates Three.js primitives (boxes, spheres, cylinders) arranged into your scene.

## What's Saved

Everything is autosaved. The Oasis uses debounced writes (100ms + 1000ms) so your world persists after every change. World state includes:

- All placed objects and their transforms
- Terrain and ground tiles
- Lights and sky
- Agent windows
- Conjured and crafted assets
- Object behaviors and animations

Your world lives in `data/worlds/{id}.json` — you can back it up, share it, or move it to another machine.
