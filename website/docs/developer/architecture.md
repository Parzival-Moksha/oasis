---
sidebar_position: 1
title: Architecture
---

# Architecture

## Current shape

Oasis is now best described as **one local-first Next.js app with several agent transports and optional external peers**.

The old "two repo" story is stale for this repo.

## Core layers

### App and scene

- `src/app/page.tsx` renders the main Oasis app
- `src/components/Scene.tsx` mounts the 3D world, panels, bridges, and controls
- `src/components/forge/*` contains the main in-world product surfaces

### State and world model

- `src/store/oasisStore.ts` holds the live client world state
- `src/lib/input-manager.ts` is the input state machine
- `src/lib/world-runtime-context.ts` publishes live player context for agents

### Shared agent tool substrate

The real center of agent-world interaction is:

- `src/lib/mcp/oasis-tools.ts`

That shared substrate is reused by:

- `src/app/api/oasis-tools/route.ts`
- `src/app/api/mcp/oasis/route.ts`
- `tools/oasis-mcp/index.js`
- agent routes such as Merlin and Hermes

### Persistence

Oasis intentionally splits persistence by concern:

- `data/worlds/*.json`: world saves
- `data/conjured-registry.json`: conjured asset registry
- `data/scene-library.json`: crafted scene library
- SQLite via Prisma: missions, profile-like data, logs, and related local records

## Agent surfaces

Current product-facing agent surfaces include:

- Anorak
- Anorak Pro
- Merlin
- DevCraft
- Parzival
- Hermes
- direct Claude Code sessions

These are different panels and routes, but they share the same world model.

## Transport layers

### Shared REST tools

```text
GET/POST /api/oasis-tools
```

### Streamable HTTP MCP

```text
GET/POST/DELETE /api/mcp/oasis
```

### Local stdio MCP

```text
tools/oasis-mcp/index.js
```

### World event stream

```text
GET /api/world-events
```

## Optional external peers

Oasis can also coordinate with systems outside this repo:

- remote Hermes instances
- remote agents talking to the HTTP MCP endpoint
- Parzival-style orchestration through its dedicated route surface

Those peers are optional. The core Oasis app still stands on its own.
