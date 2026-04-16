---
sidebar_position: 4
title: Data Model
---

# Data Model

The Oasis uses Prisma with SQLite. Schema lives in `prisma/schema.prisma`.

## Tables

### Mission

The atomic unit of work in DevCraft.

| Field | Type | Description |
|-------|------|-------------|
| `id` | Int (auto) | Primary key |
| `name` | String | Task title |
| `description` | String? | What to do |
| `status` | String | `todo` / `wip` / `done` / `archived` |
| `urgency` | Int (1-10) | How urgent |
| `easiness` | Int (1-10) | How easy |
| `impact` | Int (1-10) | How impactful |
| `priority` | Float | `(U×E×I)/125` |
| `valor` | Float (0-2) | Self-assessed focus quality |
| `score` | Float | `(seconds/60) × valor × priority` |
| `startedAt` | DateTime? | When work started |
| `endedAt` | DateTime? | When work finished |
| `actualSeconds` | Int | Total active seconds |
| `isPaused` | Boolean | Currently paused? |
| `totalPausedMs` | Int | Cumulative pause time |
| `maturityLevel` | Int (0-8) | para → carbontested |
| `executionMode` | String? | `crispr` or `builder` |
| `carbonDescription` | String? | Human context |
| `siliconDescription` | String? | Technical spec |
| `acceptanceCriteria` | String? | Definition of done |
| `flawlessPercent` | Float? | Quality score |
| `history` | Json? | Array of HistoryEntry |

### World

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `userId` | String | Defaults to `'local-user'` |
| `name` | String | World name |
| `icon` | String | Emoji icon |
| `visibility` | String | `private` / `public` / `unlisted` / `public_edit` |
| `data` | String? | JSON-serialized `WorldState` |
| `creatorName` | String? | Display name for shared worlds |
| `creatorAvatar` | String? | Avatar for shared worlds |
| `thumbnailUrl` | String? | Preview image |
| `visitCount` | Int | Times opened |
| `objectCount` | Int | Objects in world |
| `createdAt` | DateTime | Created time |
| `updatedAt` | DateTime | Last save / metadata update |

### WorldSnapshot

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Primary key |
| `worldId` | String | Foreign key → World |
| `data` | String? | JSON-serialized `WorldState` snapshot |
| `objectCount` | Int | Saved object count at snapshot time |
| `source` | String | `auto` or `manual` |
| `createdAt` | DateTime | Snapshot timestamp |

### Profile

| Field | Type | Description |
|-------|------|-------------|
| `userId` | String | `'local-user'` |
| `displayName` | String? | Display name |
| `bio` | String? | Bio text |
| `avatarUrl` | String? | 2D avatar |
| `avatar3dUrl` | String? | VRM avatar |
| `totalXp` | Int | Experience points |
| `level` | Int | Current level |
| `aura` | Int | Aura score |

### Memory

| Field | Type | Description |
|-------|------|-------------|
| `category` | String | preference / habit / goal / fact / pattern |
| `key` | String | Identifier |
| `value` | String | Content |

Unique constraint on `(category, key)`.

### CarbonModelEntry

Training data for the Carbon Model (predict → observe → learn loop):

| Field | Type | Description |
|-------|------|-------------|
| `missionId` | Int | Related mission |
| `context` | String | Situation |
| `predictedResponse` | String | What was predicted |
| `actualResponse` | String | What actually happened |
| `accepted` | Boolean | Was prediction correct? |
| `rating` | Float (0-10) | Quality rating |
| `confidence` | Float (0-1) | Model confidence |

### TokenBurn

Hourly aggregated token usage:

| Field | Type | Description |
|-------|------|-------------|
| `source` | String | Which agent/route |
| `inputTokens` | Int | Tokens consumed |
| `outputTokens` | Int | Tokens produced |
| `window` | String | ISO hour bucket (`'2026-03-28T14'`) |

### Other Tables

- **Journal** — timestamped reflections with tags and mood
- **AppConfig** — dynamic key-value settings
- **CuratorLog** — curator invocation tracking with token counts
