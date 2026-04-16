---
sidebar_position: 7
title: Avatars & Animation
---

# Avatars & Animation

## Player Avatar

In **Third-Person** camera mode, you control an avatar that walks and runs through the world.

- **WASD** to move
- **Right-click ground** to send the avatar walking (RTS-style pathfinding)
- Avatar uses a finite state machine: **idle → walk → run** with smooth blending

## VRM Support

The Oasis supports VRM avatars via `@pixiv/three-vrm`:

- Standard VRM format (`.vrm` files)
- Bone-based animation
- Expression/blendshape support

## Agent Avatars

AI agents can be embodied as avatars in the 3D world:

- Each agent window can spawn an avatar nearby
- Avatars are positioned relative to their parent window
- Scale and anchor points are computed from window dimensions

Current shared avatar tools:

- `set_avatar` to create or update an embodied agent body
- `walk_avatar_to` to move an embodied avatar through the world
- `list_avatar_animations` to inspect supported animation IDs
- `play_avatar_animation` to trigger a specific animation clip

## Animation System

### Object Behaviors

Any placed object can have behaviors attached:

| Behavior | Description |
|----------|-------------|
| `spin` | Continuous rotation |
| `hover` | Floating up and down |
| `bob` | Gentle bobbing motion |
| `orbit` | Orbit around a point |
| `patrol` | Move between waypoints |

Behaviors are set per-object through the Joystick panel or via Merlin.

### Character Rigging

Conjured models can be auto-rigged via the Meshy API:

1. Generate a 3D model via Conjure
2. Enable **Auto-Rig** in pipeline options
3. The model gets a skeleton suitable for animation
4. Enable **Auto-Animate** for walk cycles
