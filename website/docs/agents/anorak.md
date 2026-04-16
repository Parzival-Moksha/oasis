---
sidebar_position: 3
title: Anorak
---

# Anorak

Anorak is the coding face of Oasis.

## What Anorak is now

Today, Anorak is best understood as the in-world coding surface layered on top of Claude Code style execution.

You use it when you want:

- repo-aware coding inside Oasis
- streamed output in the UI
- a route that feels like an agent panel instead of a raw CLI

Primary route:

```text
POST /api/anorak/agent
```

## Anorak Pro

Anorak Pro extends that basic loop into a multi-step pipeline:

- `POST /api/anorak/pro/curate`
- `POST /api/anorak/pro/context-preview`
- `POST /api/anorak/pro/execute`
- `POST /api/anorak/pro/feedback`
- `POST /api/anorak/pro/heartbeat`
- `GET /api/anorak/pro/curator-logs`
- `GET/PUT /api/anorak/pro/lobeprompt`

There is also a lighter `POST /api/anorak/vibecode` path for more direct interaction.

## Relationship to Claude Code

Claude Code is still a real route in Oasis at `/api/claude-code`, but Anorak is the product-facing coding surface most people will feel first inside the world.

That means:

- `Claude Code` is the underlying direct session surface
- `Anorak` is the in-world coding persona and workflow

## What to document around it

The most useful docs for Anorak are:

- request shape and response stream expectations
- how it differs from Anorak Pro
- how it relates to the direct Claude Code session route
- what world-aware tools it can reach through the shared Oasis tool layer
