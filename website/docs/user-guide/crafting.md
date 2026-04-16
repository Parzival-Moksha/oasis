---
sidebar_position: 3
title: LLM Procedural Craft
---

# LLM Procedural Craft

Generate 3D scenes from natural language using LLM-written Three.js primitives.

## How It Works

1. Open the **Craft** tab in the Wizard Console
2. Describe what you want: "a cyberpunk cityscape with neon towers and floating platforms"
3. Select an AI model (Claude Sonnet, Haiku, GPT-5.4, Gemini, etc.)
4. Hit Craft

Claude (or your selected model) writes a JSON scene description using primitive shapes. The Oasis renders it in real-time.

## Available Primitives

Each crafted scene is built from these building blocks:

| Primitive | Description |
|-----------|-------------|
| `box` | Rectangular prism |
| `sphere` | Sphere |
| `cylinder` | Cylinder |
| `cone` | Cone |
| `torus` | Donut/ring shape |
| `plane` | Flat surface |
| `capsule` | Rounded cylinder |
| `text` | 3D text |

## Per-Object Properties

Each primitive supports:

- **Position** (x, y, z)
- **Scale** (x, y, z)
- **Rotation** (x, y, z in radians)
- **Color** (hex)
- **Metalness** (0-1)
- **Roughness** (0-1)
- **Emissive** color (for glow)
- **Opacity** (0-1)

## Animations

Crafted objects can have animations:

| Animation | Description |
|-----------|-------------|
| `rotate` | Continuous rotation around an axis |
| `bob` | Up-and-down floating |
| `pulse` | Scale pulsing |
| `swing` | Pendulum swing |
| `orbit` | Orbit around a point |

Each animation has `speed`, `axis`, and `amplitude` parameters.

## Scene Complexity

The LLM is prompted to generate **8-50 objects per scene**. A post-processing filter removes "parasitic ground planes" — a common LLM hallucination where the model adds unnecessary flat surfaces.

## Model Selection

Available models in Settings:

- Claude Sonnet 4.6, Haiku 4.5
- GPT-5.4
- Gemini 3.1 Pro
- Grok 4.20 Beta
- Qwen 3.5 397B
- And more via OpenRouter

## Storage

Crafted scenes are saved in `data/scene-library.json` and persist across sessions.
