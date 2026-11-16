---
sidebar_position: 2
title: Keybinds
---

# Keybinds

## Movement

| Key | Action | Active In |
|-----|--------|-----------|
| **W** | Move forward | Noclip, TPS |
| **A** | Move left | Noclip, TPS |
| **S** | Move backward | Noclip, TPS |
| **D** | Move right | Noclip, TPS |
| **Space** | Slow movement modifier | Noclip, TPS |
| **Mouse** | Look around | Noclip, TPS (pointer locked) |
| **Scroll** | Zoom in/out | Orbit |

## Object Manipulation

| Key | Action | Active In |
|-----|--------|-----------|
| **Click** | Select object | Orbit, Noclip, TPS |
| **W** (with object selected) | Translate gizmo | Orbit, Noclip, TPS |
| **E** | Rotate gizmo | Orbit, Noclip, TPS |
| **R** | Scale gizmo | Orbit, Noclip, TPS |
| **Delete** | Remove selected object | Orbit, Noclip, TPS, UI Focus |

:::note
**W** serves double duty: movement when no object is selected, translate gizmo when one is. The system disambiguates based on selection state.
:::

## Navigation

| Key | Action |
|-----|--------|
| **Right-click ground** | Send avatar walking (TPS mode) |
| **Enter** | Focus 3D agent window |
| **Escape** | Deselect / Cancel / Exit mode / Release pointer |

## Mode Transitions

| Action | Result |
|--------|--------|
| Click asset in catalog | Enter Placement mode |
| Click brush icon | Enter Paint mode |
| Click 3D agent window | Enter Agent Focus mode |
| Focus text input | Enter UI Focus mode |
| Escape | Return to previous camera mode |

## Camera Modes

Switch between camera modes via the mode selector in the toolbar:

| Mode | Description |
|------|-------------|
| **Orbit** | Mouse-free orbit around focal point |
| **Noclip** | Quake-style fly camera (default for building) |
| **Third-Person** | Avatar-based movement |
