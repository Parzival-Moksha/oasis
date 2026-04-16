---
sidebar_position: 1
title: Controls & Camera
---

# Controls & Camera

Oasis currently uses seven input states and starts in `noclip`.

## Core movement

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Q / E` | Move down / up in noclip |
| `Shift` | Sprint |
| `Space` | Slow movement |
| `Mouse` | Look around while pointer lock is active |
| `Right click` | Release pointer lock |
| `Ctrl + Alt + C` | Cycle camera mode |

## Editing and world actions

| Input | Action |
| --- | --- |
| `Left click` | Select object |
| `Scroll` | Zoom |
| `R` | Translate mode |
| `T` | Rotate mode |
| `Y` | Scale mode |
| `Delete` | Remove selected object |
| `Ctrl + C` | Copy selected object |
| `Ctrl + V` | Paste and enter placement mode |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |
| `Escape` | Cancel, deselect, or leave temporary state |
| `Ctrl + Shift + P` | Panorama screenshot |

## Input states

| State | What it is for |
| --- | --- |
| `orbit` | Mouse-free camera orbiting |
| `noclip` | Free-fly building mode |
| `third-person` | Avatar-based movement |
| `agent-focus` | Interacting with a 3D agent window |
| `placement` | Placing objects into the world |
| `paint` | Painting ground tiles |
| `ui-focused` | Typing into UI panels |

## Current source of truth

If controls ever disagree across docs, trust:

1. `src/lib/input-manager.ts`
2. the in-app Help panel
3. the actual key handling in `src/components/forge/WorldObjects.tsx`
