---
sidebar_position: 4
title: Terrain & Ground Painting
---

# Terrain & Ground Painting

## Procedural Terrain

Generate heightmap terrain from text descriptions. The Oasis uses SimplexNoise to create organic landscapes with vertex-colored biomes.

Terrain parameters are stored per-world in the WorldState.

## Ground Painting

Paint ground textures tile-by-tile in real-time.

### How to Paint

1. Enter **Paint** mode (brush icon in the toolbar)
2. Select a texture preset from the palette
3. Click and drag to paint tiles on the ground
4. **Escape** to exit paint mode

### Texture Presets

Built-in ground textures include:

- **Grass** — multiple variants
- **Stone** — cobblestone, flagstone
- **Sand** — desert, beach
- **Lava** — molten, cooled
- **Snow** — fresh, packed
- **Water** — shallow, deep
- Custom textures via AI image generation

### How It's Stored

Ground painting uses a **sparse tile map**: only painted tiles consume storage.

```json
{
  "groundTiles": {
    "0,0": "grass",
    "1,0": "stone",
    "-1,2": "sand"
  }
}
```

The key is `"x,z"` grid coordinates, the value is the preset ID. Unpainted tiles render the default ground texture.

### Custom Ground Textures

You can generate custom ground textures using the **Imagine** feature:

1. Use text-to-image to generate a texture (e.g., "seamless mossy cobblestone texture")
2. The system creates a 256x256 tileable version automatically
3. Apply it as a custom ground preset
