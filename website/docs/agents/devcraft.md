---
sidebar_position: 6
title: DevCraft
---

# DevCraft ⚡

**Gamified productivity tracking.** DevCraft turns development work into scored missions with timers, valor, and analytics.

## Missions

A mission is an atomic unit of work. Create missions from the DevCraft panel:

| Field | Description |
|-------|-------------|
| **Name** | Short task title |
| **Description** | What needs to be done |
| **Status** | `todo` → `wip` → `done` → `archived` |
| **Urgency** | 1-10 how urgent |
| **Easiness** | 1-10 how easy |
| **Impact** | 1-10 how impactful |

## Scoring: The Punya System ☸

Missions earn **Punya** (merit) based on:

```
score = (actual_seconds / 60) × valor × priority
priority = (urgency × easiness × impact) / 125
```

### Valor (0.0 - 2.0)

Self-assessed focus quality. Were you locked in (2.0) or half-distracted (0.5)?

The valor slider stays available even after the timer expires, so you can honestly rate your session.

## Timer

- **Horizon types**: `fixed` (time-boxed) or `open` (no limit)
- **Recurring beep** every N minutes (configurable)
- **TIME'S UP** auto-pause when fixed horizon reached
- **Extend** button to keep going

## Maturity Levels

Missions progress through 9 maturity levels:

| Level | Name | Description |
|-------|------|-------------|
| 0 | para | Raw idea |
| 1 | pashyanti | Visible intent |
| 2 | madhyama | Middle speech — specified |
| 3 | vaikhari | Fully articulated |
| 4 | built | Code written |
| 5 | reviewed | Code reviewed (score 0-100) |
| 6 | tested | Tests passing |
| 7 | gamertested | Human-verified |
| 8 | carbontested | Carbon Model validated |

## Analytics

The DevCraft panel includes charts with hover tooltips showing punya breakdown per mission. Track your productivity over time.

## API

| Route | Method | Action |
|-------|--------|--------|
| `/api/missions` | GET | List all missions |
| `/api/missions` | POST | Create mission |
| `/api/missions/[id]` | GET | Get mission detail |
| `/api/missions/[id]` | PATCH | Update mission |
| `/api/missions/[id]` | DELETE | Delete mission |
