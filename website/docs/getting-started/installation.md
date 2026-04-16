---
sidebar_position: 2
title: Installation
---

# Installation

## Recommended environment

| Requirement | Recommendation |
| --- | --- |
| Node.js | 20+ |
| pnpm | 9+ |
| OS | Windows, macOS, or Linux |
| Browser | Modern browser with WebGL support |

## Clone Oasis

```bash
git clone https://github.com/Parzival-Moksha/oasis.git
cd oasis
pnpm install
```

## Optional environment variables

Oasis is useful without API keys, but AI features need providers.

```env
MESHY_API_KEY=...
TRIPO_API_KEY=...
OPENROUTER_API_KEY=...
HERMES_API_BASE=...
HERMES_API_KEY=...
OASIS_MCP_KEY=...
```

What they unlock:

- `MESHY_API_KEY` and `TRIPO_API_KEY`: text-to-3D and post-processing
- `OPENROUTER_API_KEY`: craft and terrain generation
- `HERMES_API_BASE` and `HERMES_API_KEY`: Hermes chat panel defaults
- `OASIS_MCP_KEY`: bearer auth for remote MCP clients

## Run the app

```bash
pnpm dev
```

Open `http://localhost:4516`.

## Run the docs site locally

The published documentation source lives in `website/`.

```bash
cd website
pnpm install
pnpm start
```

## If Prisma complains

Most local runs should boot without extra database setup, but on a fresh machine or after schema drift you may need:

```bash
npx prisma db push
npx prisma generate
```

## What works without keys

Even with no external keys configured, you still get:

- the core 3D editor
- local world persistence
- built-in asset placement
- camera modes and input states
- agent window placement

The AI and remote-agent paths simply layer on top.
