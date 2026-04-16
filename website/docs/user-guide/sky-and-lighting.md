---
sidebar_position: 5
title: Sky & Lighting
---

# Sky & Lighting

## Sky Environments

24 sky presets available per-world:

### Procedural Night Skies (4K)
Tonemapped panoramas rendered from procedural star fields:
- `night001`, `night004`, `night007` (default), `night008`

### Poly Haven HDRIs (2K)
Real-world photography converted to HDR environment maps:
- `alps_field` — Alpine meadow
- `autumn_ground` — Autumn forest floor
- `belfast_sunset` — Irish coastal sunset
- `blue_grotto` — Mediterranean cave
- `evening_road` — Twilight highway
- And 3 more

### drei Presets
Standard Three.js environment presets (10 options).

### Procedural Stars
Real-time generated star field — no texture, pure math.

Sky selection is stored per-world. Changing the sky updates the environment map, which affects reflections on metallic objects.

## Lighting System

### Light Types

| Type | Description |
|------|-------------|
| **Point** | Omnidirectional light from a point in space |
| **Spotlight** | Directional cone of light |
| **Hemisphere** | Ambient light with sky/ground color gradient |

### Per-Light Properties

- **Position** (x, y, z)
- **Color** (RGB)
- **Intensity** (0+)
- **Shadow** enable/disable
- **Shadow properties** (map size, bias)

### Managing Lights

Lights are managed through the **Joystick** (Object Inspector) panel or via the Merlin agent:

```
"Add a warm point light above the campfire"
"Place spotlights on each tower, pointing down"
```

Lights are stored per-world in the `lights[]` array of WorldState.
