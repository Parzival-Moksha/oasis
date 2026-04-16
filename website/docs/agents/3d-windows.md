---
sidebar_position: 8
title: 3D Agent Windows
---

# 3D Agent Windows

Deploy interactive agent panels as physical objects floating in your 3D world.

## What Are 3D Windows?

Instead of agents living only in sidebars, the Oasis lets you place agent panels *inside* the 3D scene. They're rendered as HTML overlays with `drei <Html>` and interact with the world's depth buffer.

## Window Types

| Type | Agent |
|------|-------|
| `anorak` | Anorak coding agent |
| `anorak-pro` | Anorak with curator pipeline |
| `merlin` | Merlin world builder |
| `devcraft` | DevCraft mission panel |
| `parzival` | Parzival brain agent |
| `mission` | Mission detail view |

## Deploying Windows

1. Open the **Agents** tab in the Wizard Console
2. Select an agent type
3. The window appears in the world
4. Position and configure it

## Window Properties

Each 3D window has:

| Property | Description |
|----------|-------------|
| **Position** | x, y, z in world space |
| **Rotation** | Orientation |
| **Scale** | Uniform scale multiplier |
| **Width / Height** | Pixel dimensions of the HTML content |
| **Opacity** | 0 (invisible) to 1 (opaque) |
| **Blur** | 0 to 20px backdrop blur |
| **Frame Style** | Visual frame around the panel |
| **Frame Thickness** | 0.2x to 3x multiplier |
| **Session ID** | For Claude Code — unique per window |
| **Label** | User-assignable name |

## Frame Styles

Available frames:

- `wood` — wooden picture frame
- `metal` — brushed metal
- `ornate` — decorative gold
- `minimal` — thin border
- `neon` — glowing edges
- `hologram` — sci-fi translucent
- And more

## Interaction

- **Click** a window to focus it → camera zooms in, pointer unlocks for DOM interaction
- **Escape** to return to the world (restores previous camera state)
- **Resize** via the bottom-right corner handle
- The last-clicked window gets the highest z-index

## Session Isolation

Each window maintains its own session. This is critical for Claude Code windows — sharing a session ID between two windows corrupts the context.

## Persistence

3D windows are saved as part of the world state in `agentWindows[]`. When you reload a world, all agent windows reappear in their saved positions with their configurations intact.
