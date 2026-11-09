# Oasis generated skies

Procedural equirectangular sky panoramas made by `scripts/generate-skies.py`
(numpy, no image APIs). Each sky is two files:

- `<id>.jpg`: 4096x2048 background, drawn exactly as authored (sRGB).
- `<id>_env.hdr`: 1024x512 linear Radiance HDR that lights the scene. It's the
  same sky, scaled to the brightness of the bundled HDRIs, with the sun or
  moon added as a real light source.

## Preset ids

| id | what it looks like |
| --- | --- |
| `oasis_dusk` | Warm desert sunset: low golden sun over a sea of ray-marched dunes (orange lit faces, violet shadows), pink cirrus streaks radiating from the sun, the evening star. |
| `aurora_night` | Deep blue arctic night: green and violet aurora curtains, dense star field, faint Milky Way, pine treeline. |
| `pastel_dawn` | Soft pink and lavender dawn: low hazy sun, layered misty hills with fog in the valleys, thin glowing wisps. |
| `cyber_dusk` | Synthwave dusk: violet sky burning to orange at the horizon, giant striped moon, neon-rimmed mountains, magenta grid floor. |
| `clear_day` | Bright midday: deep blue zenith to a pale horizon, volumetric cumulus, distant blue hills. |
| `aurora_night_sky` | `aurora_night` with no land: stars and Milky Way continue below the horizon. For floating islands / worlds with no ground plane. |
| `clear_day_sky` | `clear_day` with no land: open, slightly paler blue sky below the horizon. For floating islands / worlds with no ground plane. |

Aliases the server also accepts: `desert`/`dunes`/`oasis` -> oasis_dusk,
`aurora`/`northern_lights` -> aurora_night, `pastel`/`pink_dawn` -> pastel_dawn,
`synthwave`/`retrowave`/`vaporwave`/`cyberpunk`/`neon` -> cyber_dusk,
`day`/`daytime`/`noon`/`clear`/`sunny`/`blue_sky`/`clouds` -> clear_day.

## How to set one

```
POST http://127.0.0.1:4516/api/oasis-tools
{"tool": "set_sky", "args": {"worldId": "<your world id>", "presetId": "cyber_dusk"}}
```

or the `set_sky` MCP tool with the same args, or the Sky panel in the world menu.

## Lighting notes

- The Oasis scales image-based lighting by the world's `environment` light
  (`add_light` with `type: "environment"`). With no environment light, materials
  get no IBL at all and crafted primitives render black unless you add other
  lights. The generated `_env.hdr` files are calibrated like the bundled HDRIs,
  so an environment light of 0.8-1.0 behaves the same as it does with them.
- The sun/moon direction (azimuth, measured like three.js equirect `atan2(z, x)`,
  elevation above the horizon), for placing a matching `directional` light:
  - `oasis_dusk`: sun at -138 deg azimuth, 3 deg up (direction about (-0.74, 0.06, -0.67)); warm orange.
  - `pastel_dawn`: sun at -128 deg, 4 deg up (about (-0.61, 0.07, -0.79)); pale peach.
  - `cyber_dusk`: moon at -124 deg, 17 deg up (about (-0.53, 0.29, -0.79)); pink.
  - `clear_day`: sun at -48 deg, 52 deg up (about (0.41, 0.79, -0.46)); white.
  - `aurora_night`: no sun; the aurora hangs over azimuth -60 deg (about (0.5, *, -0.87)), cool green.
  A directional light sits at its `position` and shines toward the origin, so put it
  along that direction, e.g. `position: [-30, 3, -27]` for oasis_dusk.
- The five main skies paint their own landscape below the horizon (dunes, misty hills,
  treeline, neon grid, green land), which shows past the edge of the 100 m ground plane.
  `pastel_dawn`'s lower half is a sea of fog and `cyber_dusk`'s is a grid floor, so both also
  work for floating worlds. For the others use the `_sky` variants.

## Regenerating

```
python scripts/generate-skies.py                     # all seven, full size (~20 min)
python scripts/generate-skies.py clear_day --preview --out <tmp> --views <tmp>/views
```
