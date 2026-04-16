---
sidebar_position: 4
title: Claude Code
---

# Claude Code

Oasis still exposes a direct Claude Code session surface.

## Primary route

```text
POST /api/claude-code
```

Session listing:

```text
GET /api/claude-code/sessions
```

## What it is for

Use the direct Claude Code route when you want:

- resumable coding sessions
- explicit session management
- a lower-level coding surface than the Anorak product layer

## How it fits with Anorak

The current product shape is:

- `Claude Code` is the direct session route
- `Anorak` is the in-world coding face
- `Anorak Pro` is the heavier multi-stage pipeline

If you are documenting the user-facing experience, talk about Anorak first.
If you are documenting transport, session semantics, or integration points, document Claude Code directly.

## Current documentation focus

The most important things to capture accurately are:

- how sessions are resumed
- how streamed output reaches the UI
- which routes list or reopen sessions
- how the coding surfaces differ from Hermes and Merlin
