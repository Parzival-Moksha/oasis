---
sidebar_position: 1
title: API Routes
---

# API Routes

All routes are served from `http://localhost:4516/api`.

## Agent and orchestration

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/anorak/agent` | `POST` | Main Anorak coding surface |
| `/api/anorak/vibecode` | `POST` | Lighter Anorak interaction path |
| `/api/anorak/pro/context-preview` | `POST` | Preview Anorak Pro context |
| `/api/anorak/pro/curate` | `POST` | Curate or expand tasks |
| `/api/anorak/pro/execute` | `POST` | Run the execution stage |
| `/api/anorak/pro/feedback` | `POST` | Submit feedback into the loop |
| `/api/anorak/pro/heartbeat` | `POST` | Heartbeat for longer-running flows |
| `/api/anorak/pro/curator-logs` | `GET` | Inspect curator history |
| `/api/anorak/pro/lobeprompt` | `GET`, `PUT` | Read or update prompt material |
| `/api/claude-code` | `POST` | Direct Claude Code style session route |
| `/api/claude-code/sessions` | `GET` | List resumable coding sessions |
| `/api/merlin` | `POST` | World-builder agent |
| `/api/merlin/sessions` | `GET` | List Merlin sessions |
| `/api/parzival` | `GET`, `POST` | Parzival surface |
| `/api/parzival/proxy/[...path]` | `GET`, `POST` | Proxy path for Parzival integration |
| `/api/missions` | `GET`, `POST`, `DELETE` | Mission collection route |
| `/api/missions/[id]` | `GET`, `POST`, `DELETE` | Per-mission route |

## Hermes and voice

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/hermes` | `GET`, `POST` | Main Hermes chat bridge |
| `/api/hermes/config` | `GET`, `POST`, `DELETE` | Pairing and config storage |
| `/api/hermes/sessions` | `GET` | Hermes session history |
| `/api/hermes/media` | `GET` | Hermes media inspection |
| `/api/hermes/transcribe` | `GET`, `POST` | Hermes transcription route |
| `/api/hermes/tunnel` | `GET`, `POST`, `DELETE` | SSH tunnel config and control |
| `/api/voice/transcribe` | `GET`, `POST` | Shared transcription route |

## Generation and forge

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/conjure` | `GET`, `POST` | List or start conjurations |
| `/api/conjure/[id]` | `GET`, `POST` | Inspect or update one conjured asset |
| `/api/conjure/[id]/process` | `GET`, `POST` | Post-process a conjured asset |
| `/api/conjure/[id]/thumbnail` | `GET`, `POST` | Asset thumbnail route |
| `/api/conjure/animations` | `GET` | Available animation data |
| `/api/conjure/library` | `GET` | Conjured asset library |
| `/api/conjure/thumbnails` | `GET`, `POST` | Bulk thumbnail flow |
| `/api/craft` | `POST` | Craft route |
| `/api/craft/cc` | `POST` | Claude-driven craft mode |
| `/api/craft/stream` | `POST` | Streaming craft route |
| `/api/craft/thumbnail` | `GET`, `PUT` | Craft preview generation |
| `/api/imagine` | `POST` | Image generation |
| `/api/terrain` | `POST` | Terrain generation |

## Shared tools, vision, and browser bridges

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/mcp/oasis` | `GET`, `POST`, `DELETE` | Streamable HTTP MCP endpoint |
| `/api/oasis-tools` | `GET`, `POST` | Shared REST tool surface |
| `/api/world-events` | `GET` | World event stream |
| `/api/console/stream` | `GET` | Console stream bridge |
| `/api/avatar-thumbs` | `GET`, `PUT` | Avatar thumbnail generation |
| `/api/catalog/thumbnail` | `GET`, `PUT` | Asset thumbnail route |

## Worlds and persistence

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/worlds` | `GET`, `POST` | List or create worlds |
| `/api/worlds/[id]` | `GET`, `POST`, `PUT` | Load or save one world |
| `/api/worlds/[id]/snapshots` | `GET`, `POST`, `PUT` | World snapshot history |
| `/api/worlds/asset-usage` | `GET` | Asset usage inspection |
| `/api/worlds/scene-library` | `GET`, `POST`, `PUT` | Shared crafted scene library |

## Media, profile, and utility

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/media/upload` | `POST` | Upload media |
| `/api/media/list` | `GET` | List media |
| `/api/media/image` | `POST` | Image handling |
| `/api/media/video` | `GET`, `POST` | Video handling |
| `/api/media/voice` | `POST` | Voice generation |
| `/api/media/delete` | `POST` | Delete media |
| `/api/profile` | `GET`, `PATCH` | Profile read and update |
| `/api/profile/avatar` | `POST` | Upload 2D avatar |
| `/api/profile/avatar3d` | `POST` | Upload 3D avatar |
| `/api/health` | `GET` | Health check |
| `/api/models` | `GET` | Model listing |
| `/api/pricing` | `GET` | Pricing metadata |
| `/api/stats` | `GET` | Stats route |
| `/api/token-burn` | `GET`, `POST` | Token burn tracking |
| `/api/xp` | `POST` | XP updates |

## Current note about catalog data

There is **no** `/api/catalog` list route in this repo right now.

The current asset catalog source of truth is the shared client-side catalog data plus the thumbnail route above.
