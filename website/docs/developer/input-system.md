---
sidebar_position: 4
title: Input System
---

# Input System

Oasis routes world input through a single state machine.

## Input states

Current states in `src/lib/input-manager.ts`:

- `orbit`
- `noclip`
- `third-person`
- `agent-focus`
- `placement`
- `paint`
- `ui-focused`

## Why this matters

The input manager is the current source of truth for:

- movement permissions
- mouse look permissions
- pointer lock lifecycle
- transform shortcut availability
- whether object selection should work

That means other parts of the app should ask the input manager what is allowed instead of re-deriving input behavior ad hoc.

## Important files

| File | Responsibility |
| --- | --- |
| `src/lib/input-manager.ts` | State machine, capabilities, pointer lock lifecycle |
| `src/components/CameraController.tsx` | Camera behavior for world movement |
| `src/components/forge/WorldObjects.tsx` | Selection and transform shortcuts |
| `src/components/forge/WizardConsole.tsx` | UI-side interactions |
| `src/components/forge/AgentWindow3D.tsx` | In-world window interaction |
| `src/components/forge/AgentWindowPortals.tsx` | DOM portal bridge for agent surfaces |

## Current transform shortcuts

Selected-object transform mode is switched with:

- `R` for translate
- `T` for rotate
- `Y` for scale

Do not document the older `W / E / R` mapping for this codebase.

## Current movement shortcuts

The Help panel and input manager currently reflect:

- `WASD` move
- `Q / E` vertical movement in noclip
- `Shift` sprint
- `Space` slow movement
- `Ctrl + Alt + C` cycle camera mode

## Documentation rule

When you update input docs, use `src/lib/input-manager.ts` and the in-app Help panel as the source of truth.
