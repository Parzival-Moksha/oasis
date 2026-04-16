---
sidebar_position: 2
title: Text-to-3D Conjuring
---

# Text-to-3D Conjuring

Turn text prompts into 3D models using AI generation APIs.

## How It Works

1. Open the **Conjure** tab in the Wizard Console
2. Type a prompt (e.g., "medieval treasure chest", "sci-fi hover bike")
3. Select a provider and quality tier
4. Hit Generate
5. The model appears in your conjured library when ready
6. Click to place it in your world

## Providers

| Provider | Format | Speed | Quality |
|----------|--------|-------|---------|
| **Meshy** | GLB | ~30-60s | High detail, textured |
| **Tripo** | GLB | ~20-40s | Fast, good topology |

Both providers return GLB files that are cached locally in `public/conjured/`.

## Generation Pipeline

Each conjured asset goes through 4 phases:

```
Queued → Generating → Downloading → Ready
```

1. **Queued** — Request sent to provider
2. **Generating** — Provider is working (polled every 5 seconds)
3. **Downloading** — GLB downloaded and saved locally
4. **Ready** — Asset available for placement

## Pipeline Extensions

Conjured assets can optionally go through additional processing:

- **Auto-Rig** — Automatically add a skeleton for animation
- **Auto-Animate** — Generate walk cycles and custom animations
- **Thumbnail** — CDN thumbnails are downloaded and saved locally (they expire after 3 days on provider CDNs)

## Asset Storage

| What | Where |
|------|-------|
| GLB files | `public/conjured/{assetId}.glb` |
| Metadata | `data/conjured-registry.json` |
| Thumbnails | Saved alongside GLBs |

## Configuration

Requires API keys in your `.env`:

```env
MESHY_API_KEY=your_meshy_key
TRIPO_API_KEY=your_tripo_key
```

Get keys from [Meshy](https://www.meshy.ai/) and [Tripo](https://www.tripo3d.ai/).
