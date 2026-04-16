---
sidebar_position: 3
title: Asset Catalog
---

# Asset Catalog

The Oasis ships with hundreds of built-in 3D assets, all CC0 (public domain) licensed.

## Categories

### Medieval (Kenney Retro Medieval Kit)
~105 models: castles, towers, walls, gates, bridges, weapons, shields, barrels, carts, market stalls, wells, windmills, and more.

### Urban (Kenney Retro Urban Kit)
~124 models: buildings, houses, shops, vehicles, street lights, benches, fences, roads, parking structures, signs, and more.

### Furniture (Kenney Furniture Kit)
~140 models: beds, chairs, tables, desks, shelves, lamps, bathtubs, toilets, fridges, ovens, TVs, computers, plants, and more.

### Nature
Trees, rocks, flowers, bushes, grass patches.

### Characters
People, animals, fantasy creatures.

### Cyberpunk (Quaternius Sci-Fi Essentials)
Sci-fi props, terminals, containers, barriers, doors.

## Asset Format

All assets are GLB files stored in `public/models/`. They're loaded via React Three Fiber's `useGLTF` hook and rendered as `InstancedMesh` for performance.

## Browsing Assets

Assets are browsable in the **Catalog** tab of the Wizard Console. They are also exposed to agents through the shared Oasis tool layer:

- `search_assets` for keyword lookup
- `get_asset_catalog` for the grouped catalog payload

The catalog source currently lives in `src/components/scene-lib/constants.ts`.

### Catalog Routes

There is **no** standalone `GET /api/catalog` list route in this repo right now.

The current thumbnail route is:

```bash
GET /api/catalog/thumbnail?path=/models/kenney-furniture/table.glb
```

That returns a thumbnail for a specific asset path.

## Adding Custom Assets

### Via Conjuring
Use the Conjure tab to generate custom GLB models from text prompts. These are stored in `public/conjured/` and tracked in `data/conjured-registry.json`.

### Via Crafting
Use the Craft tab to generate procedural geometry from text descriptions. These are stored in `data/scene-library.json`.

## Credits

| Source | License | Assets |
|--------|---------|--------|
| [Kenney](https://kenney.nl/) | CC0 | Medieval, Urban, Furniture kits |
| [Quaternius](https://quaternius.com/) | CC0 | Sci-Fi, Nature, Characters |
| [Poly Haven](https://polyhaven.com/) | CC0 | HDRI sky environments |
