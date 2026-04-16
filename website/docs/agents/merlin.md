---
sidebar_position: 2
title: Merlin
---

# Merlin 🧙

**The World Builder.** Merlin takes natural language instructions and directly modifies your world with a real Claude Code CLI session — placing objects, changing the sky, painting the ground, adding lights, walking his avatar, and looking around.

## How It Works

Merlin runs as a **persistent Claude Code CLI agent** with the Oasis and mission MCP servers loaded:

1. You say: *"Build a medieval village with a tavern, market stalls, and torch-lit streets"*
2. Merlin resumes or starts a Claude Code session that follows `.claude/agents/merlin.md`
3. Each tool call modifies the world state in real-time
4. You see objects appear as Merlin works

Sessions persist across turns, so Merlin can keep iterating instead of starting from scratch each time.

## Available Tools

| Tool | Description |
|------|-------------|
| `place_object` | Place any of the 565+ built-in 3D assets |
| `remove_object` | Delete an object by ID |
| `craft_scene` | Create procedural primitives (box, sphere, cylinder, etc.) |
| `add_light` | Place point, spot, directional, ambient, or hemisphere lights |
| `set_sky` | Change sky environment (night, forest, dawn, sunset, etc.) |
| `set_ground_preset` | Change ground texture (grass, sand, stone, snow, water, etc.) |
| `screenshot_viewport` | Inspect the world from player, external, or Merlin phantom-camera views |
| `set_avatar` / `walk_avatar_to` | Embody Merlin and move him through the world |
| `set_behavior` | Add animation to objects (spin, hover, bob, orbit, patrol) |
| `clear_world` | Remove everything (nuclear option) |

## Example Prompts

```
"Create a Japanese zen garden with stone lanterns and a koi pond"
"Add warm point lights along the village path"  
"Change the sky to sunset and the ground to sand"
"Make the windmill spin slowly"
"Clear the world and build a space station"
```

## Architecture

```
User message → POST /api/merlin
  → Claude Code CLI session (--resume when applicable)
  → MCP servers: oasis + mission
  → World writes land in SQLite and emit world-events for live manifestation
  → SSE stream: session | text | tool | result | done
```
