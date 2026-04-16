---
sidebar_position: 5
title: Phoenix Protocol
---

# Phoenix Protocol

The Phoenix Protocol governs how code changes are made, tested, and deployed — especially when autonomous agents (Anorak, Parzival) are writing code.

## Execution Modes

### CRISPR Mode

For changes that touch runtime code (`src/`, `prisma/`, configs):

1. **Coder works in a git worktree** (`../af_oasis_worktree`)
2. **Reviewer** verifies the changes in the worktree
3. **Tester** runs tests in the worktree
4. Changes are **merged into main**
5. The **dev-agent** detects changes → rebuilds → live server updates

This isolates risky changes from the running server. The blue-green `pnpm dev:agent` server handles rebuild+restart automatically.

### Builder Mode

For changes that **don't touch runtime code** (`builder/`, `tools/`, `scripts/`, `.claude/`):

1. Coder works **directly on main**
2. No worktree, no HMR risk
3. Changes take effect immediately

### When In Doubt

Default to CRISPR. The extra safety of a worktree is worth the overhead.

## Maturity Pipeline

Every mission (code change) goes through maturity levels:

```
0 para → 1 pashyanti → 2 madhyama → 3 vaikhari
→ 4 built → 5 reviewed → 6 tested → 7 gamertested → 8 carbontested
```

| Level | Gate |
|-------|------|
| 0-3 | Specification maturity (idea → fully articulated) |
| 4 | Code written and building |
| 5 | Reviewer agent scored ≥ 90/100 |
| 6 | Tester agent: all tests passing, new tests written |
| 7 | Human verified (gameplay, UX) |
| 8 | Carbon Model validated (pattern learning) |

## Build → Review → Test Protocol

**Strictly sequential. Never run reviewer and tester in parallel.**

1. **Build** — `pnpm build` must pass
2. **Review** — invoke reviewer agent. Score 0-100. Fix HIGH/MEDIUM findings. Re-review until ≥ 90.
3. **Test** — only after reviewer ≥ 90. Tester agent:
   - Writes NEW vitest tests for every changed file
   - Runs ALL existing tests (regression)
   - Runs Playwright visual regression for UI changes
   - Verifies API endpoints for route changes
   - Outputs pass% + valor
4. **Report** — reviewer score, tester score, valor, new tests written

## Blue-Green Server

`pnpm dev:agent` runs a blue-green deployment server:

- Watches for git changes on main
- Rebuilds the Next.js app
- Hot-swaps the running server
- Zero downtime for the "gamer" (person using the Oasis)

This is the required server mode for autonomous agent sessions.
