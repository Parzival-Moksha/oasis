---
sidebar_position: 1
title: Agent Overview
---

# Agent Overview

Oasis has multiple agent surfaces, but they all meet at the same world model.

## Placeable agent windows

These can be deployed as 3D windows inside the world:

| Surface | Role | Primary route |
| --- | --- | --- |
| `Anorak` | In-world Claude Code style coding surface | `/api/anorak/agent` |
| `Anorak Pro` | Curate/execute/feedback pipeline | `/api/anorak/pro/*` |
| `Merlin` | World-builder agent | `/api/merlin` |
| `DevCraft` | Missions and gamified execution | `/api/missions` |
| `Parzival` | External or proxied orchestration surface | `/api/parzival` |

## Other first-class agent surfaces

These are not the same as placeable window types, but they are part of the live stack:

| Surface | Role | Route |
| --- | --- | --- |
| `Hermes` | World-aware chat bridge with pairing and tunnel support | `/api/hermes` |
| `Claude Code` | Direct session route for resumable CLI-backed sessions | `/api/claude-code` |

## Shared behavior

Across these surfaces, Oasis consistently uses:

- Server-Sent Events for streaming UI updates
- the shared Oasis tool substrate for world actions
- browser-mediated screenshot capture for visual grounding
- local-first persistence for world state

## Mental model

Think of Oasis as one world with several agent entry points, not several disconnected bots glued onto a scene.

The route or panel changes. The underlying world state, tools, and persistence model stay the same.
