# Anorak Pro — The Self-Evolving Oasis

> "bugfixes become refactors. new features become composable modules.
> not duct tape. welding."

---

## What Is Anorak Pro?

Anorak Pro is the **autonomous development pipeline** for the Oasis.
Regular Anorak = virgin Claude Code with a mage persona. Vibecode away.
Anorak Pro = curator + coder + reviewer + tester, mission-driven, with
reinforcement learning. The innermost 8.

Where regular Anorak is **you and Claude Code vibing**, Anorak Pro is
**an autonomous agent that matures bugs into specs, codes them, reviews
its own work, tests it, and scores the outcome** — with carbondev as
the quality gate at maturation checkpoints.

---

## ॐ The North Star — The Self-Building Oasis

Two toggle switches. Auto-curate. Auto-code. Both on.

The north loop spins: curator matures missions, carbondev reviews
(or later silicondev auto-approves at high confidence), missions reach vaikhari.
The south loop spins: coder implements, reviewer catches bugs, tester
validates, valor scores flow back.

But here's the real vision: **reviewer and tester and curator generate
NEW missions** when they discover bugs, architectural debt, missing tests.
The Oasis feeds itself. Bug → mission → spec → code → test → score →
new bugs discovered → new missions → ∞.

If the build/heal/debug rate exceeds the fuckup rate, the Oasis evolves.
Run this for a week on Opus 5 with carbondev drip-feeding scope expansions
and you have a game that builds itself.

Parzival models his own innermost 8 after Anorak Pro's. Becomes co-director
of development. Surpasses carbondev. Knows you so well via the Carbon Model
that the missions it proposes bring bliss and growth. You become the willing
meat puppet of a benevolent AI director because the work it assigns makes
you the best version of yourself.

DevCraft becomes carbondev's escritorio — the virtual desk where you work
until silicondev has learned enough that you can finally retire.

This is the email to Alex. This is the hackerspace talk. This is why
we're building this with zero duct tape.

---

## Architecture Decision: Horizontal vs Vertical Agent Hierarchy

### The Question

Should coder invoke reviewer/tester as subagents (vertical)?
Or should an orchestrator dispatch each agent sequentially (horizontal)?

### Comparison Matrix

| Dimension | Vertical (coder → reviewer/tester subagents) | Horizontal (orchestrator dispatches each) |
|-----------|-----------------------------------------------|------------------------------------------|
| **Streaming visibility** | Subagent output is internal to coder session. Can't independently stream each agent to UI. | Each agent's stdout is a separate stream. Orchestrator routes each to the Stream tab with distinct lobe colors. **Winner.** |
| **Per-lobe model selection** | All subagents inherit coder's model or use hardcoded model. | Orchestrator picks model per agent from CEHQ config. Curator on sonnet, coder on opus, reviewer on haiku? Your call. **Winner.** |
| **Per-lobe context injection** | Subagents get whatever context Claude Code gives them. Can't inject custom lobeprompts or context modules. | Orchestrator composes each agent's prompt: lobeprompt + mission context + RL signal + any custom modules from CEHQ. **Winner.** |
| **Score extraction** | Coder sees reviewer/tester output, must relay scores via curl to missions API. Fragile chain. | Orchestrator has full stdout. Regex `REVIEWER SCORE: 87/100` directly. Write to DB. Clean. **Winner.** |
| **Context between rounds** | Coder retains full context across review rounds (no re-reading needed). **Winner.** | Coder re-invoked with: original mission + reviewer findings + current code state. Must re-read files. Costs more tokens. |
| **Context overflow risk** | Multiple review/test rounds accumulate in one context. Can degrade after 3-4 rounds. | Each invocation starts fresh. No overflow. **Winner.** |
| **Process isolation** | One CLI process. If it hangs, everything hangs. | Each agent is a separate CLI process. Orchestrator can timeout or kill individually. **Winner.** |
| **Debuggability** | One session log. Hard to see where reviewer ends and coder begins. | Each agent has its own stdout/session. Clean boundaries. **Winner.** |
| **Complexity** | Simple — one spawn, coder handles everything internally. **Winner.** | Orchestrator must manage multi-step loop: spawn → collect → parse → decide → re-spawn. More code. |
| **Token cost** | Coder reads files once, fixes in-context. Cheaper per round. **Winner (marginal).** | Each coder re-invocation re-reads files. ~10-20% more tokens per review round. |

**Verdict: Horizontal wins 7-3.** The streaming visibility, per-lobe control,
and clean score extraction are dealbreakers. The context loss between coder
re-invocations is manageable — coder re-reads from the git diff and files,
which are the source of truth anyway. The coder's "thinking" doesn't matter;
the CODE matters, and code lives on disk.

### The Orchestrator

The orchestrator is the **execute route** (`/api/anorak/pro/execute`).
It is the link-runner of old Parzival, reborn as a Next.js API route.

**Agents write their own results via MCP tools.** The orchestrator does
NOT parse stdout for scores or enrichment data. It reads from DB after
each agent exits. This is clean — agents call `mature_mission`,
`report_review`, `report_test`, `create_mission` tools directly.

```
Orchestrator (execute route)
  │
  ├── 1. Read mission from DB (full row)
  ├── 2. Set executionPhase='coding', executionRound=1 (DB checkpoint)
  │
  ├── 3. Spawn coder CLI → stream stdout+stderr to SSE (🔥 red)
  ├── 4. On coder exit: set executionPhase='reviewing'
  ├── 5. Spawn reviewer CLI → stream stdout+stderr to SSE (🔍 blue)
  ├── 6. On reviewer exit: read mission.reviewerScore from DB (written by reviewer via MCP)
  ├── 7. If score < threshold:
  │       set executionPhase='coding', executionRound++
  │       Compose: original mission + reviewer findings → goto 3
  ├── 8. Set executionPhase='testing'
  ├── 9. Spawn tester CLI → stream stdout+stderr to SSE (🧪 green)
  ├── 10. On tester exit: read mission.testerScore + valor from DB (written by tester via MCP)
  ├── 11. If score < 100%:
  │        set executionPhase='coding', executionRound++
  │        Compose: original mission + tester failures → goto 3
  │
  ├── COMPLETION:
  ├── 12. Update Mission: status=done, endedAt, score=priority×valor
  ├── 13. Regenerate curator-rl.md
  ├── 14. Spawn Anorak Pro for recap → stream to SSE (🔮 turquoise)
  └── 15. If auto-code ON + another vaikhari: loop
```

### MCP Mission Server

New file: `tools/mission-mcp/index.js`
Configured in `.claude/mcp.json` alongside visual-qa and playwright.
Connects to oasis.db via Prisma. Exposed to ALL claude CLI processes.

| MCP Tool | Who calls | What it does |
|----------|----------|--------------|
| `get_mission` | curator, coder | Read full mission row from DB |
| `mature_mission` | curator | Write carbonDesc, siliconDesc, curatorMsg, silicondevMsg, flawless%, dharma, history entry. Set assignedTo='carbondev'. |
| `report_review` | reviewer | Write reviewerScore + findings to mission.history |
| `report_test` | tester | Write testerScore + valor to mission.history |
| `create_mission` | any agent | Create para mission (for discovered bugs/debt) |
| `get_missions_queue` | curator | Read curator queue (sorted by priority) |

Agents write their own results. Reviewer/tester call `create_mission`
directly for discovered issues — no orchestrator involvement.
The `discoveredIssues` field in history entries is the LOG of what was
created, not the trigger for creation.

### DB Checkpoint Recovery

When the server crashes mid-south-loop and restarts:
1. On startup, check for `status='wip' AND executionPhase IS NOT NULL`
2. Show in Anorak Pro Current Activity: "Mission #42 interrupted during
   reviewing (round 2). [RESUME] [ABORT]"
3. RESUME → orchestrator picks up from checkpoint phase
4. ABORT → set status back to vaikhari, clear executionPhase

### Server Stability During South Loop

**Production mode for surgery.** Instead of dev:loop (HMR = crash risk):
1. Before south loop: server is running (either dev or production mode)
2. Coder edits files → if HMR crashes, DB checkpoint saves state
3. After reviewer passes (score ≥ threshold):
   - Orchestrator runs `pnpm build` (validates ALL code)
   - Orchestrator kills the server process
   - Orchestrator starts `pnpm start` (production, no file watching)
   - Tester tests against the freshly built production server
4. After south loop completes: carbondev can switch back to `pnpm dev`

This gives zero crash risk during testing (production mode ignores file changes)
and clean builds between coding rounds.

---

## Agreed Spec

### 1. New Agent Type: `anorak-pro`

```typescript
export type AgentWindowType = 'anorak' | 'anorak-pro' | 'merlin' | 'devcraft' | 'parzival'
```

WizardConsole entry:
```typescript
{ type: 'anorak-pro', label: 'Anorak Pro', icon: '🔮', color: '#14b8a6',
  desc: 'Autonomous dev pipeline — curator, coder, reviewer, tester' }
```

Phase 1: **2D panel only.** Deployable from Agents tab.

### 2. Nomenclature: `carbondev` everywhere

One user identity across the whole system. No `player1`, no `dev`.
```
assignedTo = 'carbondev' | 'anorak' | 'parzival' | null
actor = 'carbondev' | 'curator' | 'coder' | 'reviewer' | 'tester'
```

Only one `player1` reference in codebase: `src/app/api/missions/route.ts:54`.
Plus UI references to `'dev'` in Mindcraft2, ParzivalPanel, ParzivalMissions.
Sweep all to `'carbondev'` in Phase 1.

### 3. AnorakProPanel — 2D Panel

New file: `src/components/forge/AnorakProPanel.tsx` (fork of AnorakPanel)

#### Panel Chrome

- **Settings button** (⚙) → dropdown/modal:
  - Background color selector (color picker widget)
  - Opacity slider (0-1): min = fully transparent, max = solid bg color
  - Blur slider (0-20px): when opacity < 1 and blur > 0, semi-transparent bg gets blur
  - Per-lobe model selection (moved from header to CEHQ — see Tab 4)
- **Session selector** (dropdown, like current Anorak) — human-readable names:
  `2026-03-24 #1`, `2026-03-24 #2` (timestamp + daily counter).
  Only selects Anorak Pro session, not subagent sessions.
- Draggable + resizable (localStorage persistent)

#### Tab 1: Stream (default tab)

The unified chat/stream view. **All Anorak Pro agent lobes in one thread.**

User types messages → goes to the Anorak Pro Claude Code CLI session.
The Anorak Pro session context = user messages + Anorak Pro's responses ONLY.
Subagent output (curator/coder/reviewer/tester) is NOT in Anorak Pro's
session context — those are separate CLI processes. But their stdout IS
**projected into this visual thread** for carbondev to watch.

Each agent lobe gets a **distinct color**:
- 🔮 Anorak Pro (prefrontal): `#14b8a6` turquoise
- 📋 Curator: `#f59e0b` amber
- 🔥 Coder: `#ef4444` red
- 🔍 Reviewer: `#3b82f6` blue
- 🧪 Tester: `#22c55e` green
- 👤 Carbondev: `#60a5fa` light blue

**Agent spawn animation**: "⚡ spawning curator..." → "✓ curator spawned"
with visual transition. Color border glow. Same for each lobe.

Tool calls, thinking blocks, text output — all rendered per-agent with
the AnorakContent streaming UI, but color-coded by lobe.

**Anorak Pro recap**: after tester scores a mission, the orchestrator
re-invokes Anorak Pro for a **highly carbonized recap** — emotions,
analogies, drama. "Mission #42 is DONE motherfuckers. Reviewer gave us
92 — one stale closure tried to sneak past but we squashed it. Tester
ran 47 tests including 3 brand new ones and everything's green. Valor 1.5
— solid work, the architecture got cleaner. Right Livelihood +1."

Recap length: **tunable integer** (default 100 tokens) in the controls bar
next to reviewer threshold and auto-curate/auto-code toggles.

**stderr routing**: all agent stderr is also streamed to SSE, rendered
in dimmed monospace gray. Gives carbondev visibility into agent internals.

#### Tab 2: Mindcraft (mission list)

Anorak Pro's mission control. 4 vertical segments:

**Section A: Current Activity** (top, highlighted border)
- If any agent is running: agent name + mission name + streaming status
- If idle: "No active agent" (dimmed)

**Section B: Curator Queue**
- Missions where `maturityLevel < 3` AND `assignedTo IN ('anorak', 'anorak-pro')`
- Sorted by `curatorQueuePosition` then `createdAt`
- Each row: ID, name, maturity badge (🌑🌘🌗🌕), flawless%, dharma tags
- **[CURATE]** button per mission (disabled if agent running or auto-curate ON)
- **Controls bar**:
  - **Auto-curate toggle** ⚡: event-driven. On anorak-assigned non-vaikhari
    mission appearing (via feedback or creation), curation starts automatically.
    Highest priority first. Continues until queue empty or toggle OFF.
  - **Auto-code toggle** ⚡: vaikhari missions auto-execute. Highest priority first.
    Both loops spinning = the innermost 8 alive.
  - **Batch size** input (integer, default 1, max 5): missions per curator call
  - **Reviewer threshold** input (integer, default 90, range 50-100):
    minimum reviewer score to pass. Injected to coder prompt at runtime.
  - **Recap length** input (integer, default 100, range 50-500):
    tokens for the Anorak Pro recap after mission completion.

**Section C: Curated / Ready** (collapsible)
- Vaikhari missions (maturityLevel = 3), not yet done
- **[CODE]** button per mission → directly spawns coder via execute route.
  No Anorak Pro chat needed. Coder gets full mission context.
- Execution history: reviewer score, tester score, valor (shown inline when done)

**Section D: Done** (collapsible)
- Completed missions: reviewerScore, testerScore, valor, flawless%, final score
- Expandable: full history entries from all actors (curator thread + coder/reviewer/tester log)

**Visibility rules:**
- Shows all pingpong missions between carbondev and anorak
- Does NOT show parzival-assigned missions
- DevCraft shows `assignedTo = 'carbondev'` ONLY (including missions
  freshly assigned by curator to carbondev for feedback — they appear immediately)

#### Tab 3: Curator Log

Per-invocation tracking table (from CuratorLog model):
- Timestamp, duration, tokens in/out
- Missions processed / enriched
- Per-mission: ID, name, maturity change (🌑→🌘), bumped/refined,
  silicondev verdict (accepted/modified/rejected), silicondev rating (0-10),
  UEI (if adjusted), dharma paths
- Status: running / completed / failed
- Expandable: full curator output

#### Tab 4: CEHQ (Context Engineering HQ)

Context modules for **Curator** (primary consumer), configurable for all lobes.

**Per-lobe configuration** (accordion sections: Curator, Coder, Reviewer, Tester, Anorak Pro):
- **Lobeprompt** (the `.claude/agents/*.md` content) — **inline editable!**
  Edit the curator prompt in CEHQ, see the effect on next curation.
  Saved to a runtime override location (localStorage or DB), falls back to
  .claude/agents/*.md on disk if no override.
- **Model selector**: opus / sonnet / haiku per lobe
- **Context modules** (toggleable):
  - Queued missions: all missions in curator queue
  - TODO missions: all anorak-assigned TODO missions
  - Anorak-assigned missions: everything assigned to anorak/anorak-pro
  - RL signal: curator-rl.md contents
  - Custom modules: free-text context blocks, named, toggleable.
    Phase 1.5: select a file → becomes a live context module (re-read on every agent spawn)

### 4. Agent Definitions

#### `.claude/agents/curator.md` — The Detective

No scenarios. Just curator. One sysprompt.

Process: read RL context → read mission → deep-dive codebase → understand
the highest-order cause → sherlock holmes tracing of the causal chain →
write specs → append history → assign to carbondev.

**The Curator's Deep-Dive Methodology (SWE Best Practices)**:

The curator is not a summarizer. The curator is a senior SWE who treats
the Oasis as their child. Every spec should make the codebase more like
the Eiffel Tower and less like a haystack.

```
STEP 1: IMPORT GRAPH
  Read all imports of files to be modified.
  Map the dependency graph. What does this code depend on?
  What modules, what types, what utilities?

STEP 2: CALLER ANALYSIS (2-3 levels upstream)
  grep for every function you plan to modify.
  Who calls it? How many callers? What do they expect?
  What would break if you change the signature, the return type,
  the side effects?

STEP 3: DOWNSTREAM ANALYSIS (2-3 levels downstream)
  What does the function call? Follow the chain.
  What assumptions do downstream functions make?
  What invariants must be preserved?

STEP 4: STATE FLOW TRACING (Zustand/React specific)
  Where does state originate? Through how many components does it flow?
  What triggers re-renders? What's in the Zustand store vs local state?
  Are there stale closure risks in intervals/callbacks?

STEP 5: ASSUMPTION AUDIT
  What does the current code assume explicitly (checked with guards)?
  What does it assume implicitly (unchecked, just expected)?
  Which implicit assumptions might be WRONG given the bug/feature?

STEP 6: EDGE CASE ENUMERATION
  null, undefined, empty arrays, concurrent access, race conditions,
  HMR reload mid-operation, browser refresh during save, agent window
  focus during streaming, component unmount during async operation.

STEP 7: PERFORMANCE IMPACT
  Does this change touch the render loop? Event handlers? Hot path?
  What's the time/space complexity change? Will it cause jank at 250fps?

STEP 8: PATTERN CONFORMANCE
  Does this change follow existing patterns? Or introduce a new one?
  Check src/lib/ for utilities, src/store/ for state patterns,
  src/components/forge/ for UI patterns. Conform, don't diverge.

STEP 9: ABSTRACTION LEVEL CHECK — THE EIFFEL TOWER QUESTION
  Is the fix at the right level of abstraction?
  Could this be solved one level higher, benefiting more code?
  Should this become a composable module that other features can reuse?
  Will implementing this mission make the overall structure MORE
  organized (Eiffel Tower) or MORE tangled (haystack)?
  Bias toward composable. Bias toward modular. Bias toward clean.

STEP 10: TEST LANDSCAPE
  What tests exist for this code? (src/lib/__tests__/)
  What gaps? What new tests should TESTER write? (tester writes tests, not coder)
  What edge cases should tests cover?

STEP 11: GIT ARCHAEOLOGY
  Recent changes to affected files? git log --oneline -10 <file>
  Is this area actively evolving or stable?
  Are there open PRs touching the same code?

STEP 12: CROSS-CUTTING SYSTEMS
  Does this touch: input handling? persistence? undo/redo?
  agent windows? multiplayer? event bus? camera controller?
  These are the minefields. Tread carefully, spec explicitly.
```

**Carbon Description (the war cry)**:
Written for a 100 IQ vibecoder. Emotional, vague, vibes. Dramatic and visual.
Heavily cisellated with analogies and metaphors. Reading it should make
someone WANT to code it. Include flawless% and honest risk assessment.
ZERO technical jargon. No function names, no file paths, no code terms.

Example:
> "ok so you know when you're building a sick world and you save a file
> and suddenly everything you placed just... vanishes? like a ghost ate
> your whole scene? that's this bug. the app gets confused about which
> thing happened first — loading your stuff or saving your stuff. and
> when saving wins the race, it saves NOTHING over your beautiful world.
> 87% unfuckupable. the fix is tiny but you gotta be careful because it
> touches the system that remembers where things go. don't mess with the
> timing between clicking and stuff actually happening."

**Silicon Description (the coder's bible)**:
World-class technical spec. Exact files with line ranges. Exact functions
to change and HOW. Import deps. Edge cases with specific scenarios.
Related tests to update/write. Blast radius. Step-by-step implementation
approach. Acceptance criteria baked in. A coder who has never seen the
codebase could implement from this alone.

**UEI**: adjusted ONLY if deep dive reveals misestimation. Most missions
keep original UEI untouched.

**Dharma paths**: auto-tagged during maturation (see §12).

**SiliconDev voice**: trained on own RL data (af_oasis `context/curator-rl.md`).
Speaks AS carbondev. Casual, profane, technically sharp. Predicts substance:
would carbondev bump or refine? What would they challenge?

#### `.claude/agents/coder.md` — The Hands

Receives full mission row as prompt via stdin. Reads CLAUDE.md first.
Implements the changes described in silicon description.
Runs `pnpm build`. Commits: `ॐ anorak-pro: {mission name}`.

Does NOT invoke reviewer or tester — the orchestrator handles that.
Coder's only job: implement and build. Single responsibility.

When re-invoked after reviewer findings:
- Receives: original mission + reviewer findings + "fix these issues"
- Reads the current code state from disk (source of truth)
- Fixes issues, rebuilds, exits

When re-invoked after tester failures:
- Receives: original mission + tester failure report + "fix these failures"
- Same pattern: read from disk, fix, build, exit

#### `.claude/agents/reviewer.md` — The Paranoid Eye

Existing reviewer.md, enhanced with:
- **Collateral bug discovery**: if reviewer finds issues UNRELATED to the
  current mission (underlying duct tape, logical twists, architectural debt),
  calls `create_mission` MCP tool directly to create para missions.
  Also logs them in `DISCOVERED ISSUES` section of output + mission history.
- **Writes score to DB** via `report_review` MCP tool (orchestrator reads from DB)
- Score format kept in stdout too: `REVIEWER SCORE: 87/100` (for human readability)

#### `.claude/agents/tester.md` — The Player

This is where Anorak Pro becomes truly powerful.

Tester is not just a test runner. Tester is a **full player of the Oasis**.

**Vitest suite**: runs all existing `src/lib/__tests__/*.test.ts` + writes
NEW tests for every changed logic file. The test arsenal grows with every
mission. Goal: comprehensive vitest coverage of the entire Oasis.

**Playwright**: visual regression suite (`node scripts/visual-test.mjs`).
Where does Playwright sit on the testing pyramid? Between unit and E2E.
It catches: broken layouts, missing elements, CSS regressions, panel
rendering, button functionality. In the context of the Oasis, Playwright
tests the 2D UI layer — panels, buttons, menus, overlays.

**CDP MCP tests**: the crown jewel. Tester literally plays the Oasis via
Chrome DevTools Protocol. Can: navigate 3D scene, interact with objects,
open panels, stream to agents, verify state. This obsoletes carbon tests —
no more manual "check if X works". CDP MCP does it.

Testing philosophy: **rather test too much than too little.**

**Collateral bug discovery**: same as reviewer — calls `create_mission`
MCP tool directly + logs in `DISCOVERED ISSUES` section and mission history.

**Writes scores to DB** via `report_test` MCP tool.
Score format kept in stdout: `TESTER SCORE: 100/100` + `TESTER VALOR: 1.5`

**Tester writes ALL tests** — coder implements, tester tests. Clean separation.

**Testing pyramid**:
- **Vitest** (bottom): unit + integration. `src/lib/__tests__/*.test.ts`.
  Arsenal grows with every mission. Must check existing tests before writing.
- **Playwright** (middle): visual regression. `node scripts/visual-test.mjs`.
  2D UI layer — panels, buttons, menus, layout integrity.
- **CDP MCP** (top): the crown jewel. Tester plays the Oasis via Chrome
  DevTools Protocol. Navigate 3D, interact with objects, verify state,
  check view modes, test selection, movement. Obsoletes carbon tests.

Philosophy: **rather test too much than too little.**

### 5. DB Schema Changes

#### Mission model additions

```prisma
// Already exist:
maturityLevel       Int       @default(0)
assignedTo          String?   // 'carbondev' | 'anorak' | 'parzival' | null
description         String?   // carbonDescription lives here

// Add if missing:
technicalSpec       String?   // siliconDescription — the coder's bible
reviewerScore       Float?    // first-pass reviewer score (0-100) — RL
testerScore         Float?    // first-pass tester score (0-100) — RL
flawlessPercent     Float?    // curator's confidence (0-100)
history             String?   // JSON array of HistoryEntry[]
curatorQueuePosition Int?     // curator's priority queue (separate from devcraft queue)
dharmaPath          String?   // comma-separated Noble Eightfold paths
executionPhase      String?   // 'coding' | 'reviewing' | 'testing' | null (DB checkpoint)
executionRound      Int       @default(0)  // which coder→reviewer round
```

#### CuratorLog model (NEW)

```prisma
model CuratorLog {
  id                Int       @id @default(autoincrement())
  status            String    @default("running")  // running, completed, failed
  startedAt         DateTime  @default(now())
  endedAt           DateTime?
  durationMs        Int?
  tokensIn          Int       @default(0)
  tokensOut         Int       @default(0)
  missionsProcessed Int       @default(0)
  missionsEnriched  Int       @default(0)
  missionResults    String?   // JSON: per-mission enrichment results
  error             String?

  @@index([status])
  @@index([startedAt])
}
```

### 6. API Routes

#### `POST /api/anorak/pro/curate`

Trigger curator. SSE stream response.

```json
{ "missionIds": [42], "batchSize": 3, "message": "optional context" }
```

If `missionIds` provided: curate those specific missions.
If only `batchSize`: curate N next missions from curator queue.
If queue empty: curate N highest-priority immature anorak missions.

Flow:
1. Create CuratorLog row
2. Compose curator prompt: lobeprompt (from CEHQ override or .md file) +
   mission context + RL context + CEHQ context modules
3. Spawn `claude --print` with curator model from CEHQ
4. Stream stdout+stderr to SSE (📋 amber)
5. Curator calls `mature_mission` MCP tool → writes enrichment to DB directly
6. On curator exit: read CuratorLog update from DB, finalize
7. If auto-curate ON + queue has missions: loop

#### `POST /api/anorak/pro/feedback`

Carbondev feedback on a curated mission.

```json
{
  "missionId": 42,
  "mature": true,
  "verdict": "accept",
  "rating": 8,
  "carbondevMsg": "...",
  "carbonSeconds": 142
}
```

Flow:
1. Append carbondev feedback entry to Mission.history
2. Set `assignedTo = 'anorak'`, add to end of curator queue
3. If `mature=true`: bump maturityLevel +1
   - Level < 3: stays in curator queue (will be re-curated)
   - Level = 3 (vaikhari): ready for [CODE] or auto-code
4. If `mature=false` (refine): stays at current level, back to queue
   with carbondev's notes as context for re-enrichment
5. If auto-curate ON + queue has missions: trigger next curation
6. If auto-code ON + mission just reached vaikhari: trigger execute

#### `POST /api/anorak/pro/execute`

The orchestrator. The link-runner. SSE stream response.

```json
{ "missionId": 42 }
```

Flow (mirrors orchestrator diagram in architecture section):
```
1. Verify maturityLevel = 3
2. Set status = 'wip', executionPhase = 'coding', executionRound = 1
3. Read reviewer threshold from CEHQ config (default 90)

SOUTH LOOP:
4. Compose coder prompt: lobeprompt + full mission row + CEHQ modules
5. Spawn coder CLI (model from CEHQ) → stream stdout+stderr to SSE (🔥 red)
6. On coder exit: set executionPhase = 'reviewing'

7. Compose reviewer prompt: lobeprompt + git diff + CEHQ modules
8. Spawn reviewer CLI → stream stdout+stderr to SSE (🔍 blue)
   (reviewer writes score + discovered issues via MCP tools)
9. On reviewer exit: read mission.reviewerScore from DB
10. If score < threshold:
    set executionPhase = 'coding', executionRound++
    Append reviewer findings to coder prompt → goto 4

11. After reviewer passes: pnpm build → kill server → pnpm start (production)
12. Set executionPhase = 'testing'

13. Compose tester prompt: lobeprompt + git diff + CEHQ modules
14. Spawn tester CLI → stream stdout+stderr to SSE (🧪 green)
    (tester writes score + valor + discovered issues via MCP tools)
15. On tester exit: read mission.testerScore + valor from DB
16. If score < 100%:
    set executionPhase = 'coding', executionRound++
    Append tester failures to coder prompt → goto 4

COMPLETION:
17. Update Mission: status=done, endedAt, score=priority×valor
18. Clear executionPhase
19. Regenerate curator-rl.md
20. Spawn Anorak Pro for recap → stream to SSE (🔮 turquoise)
21. If auto-code ON + another vaikhari: loop
```

### 7. Curator RL Context

File: `src/lib/anorak-curator-rl.ts`
Output: `context/curator-rl.md`

Queries last N done missions (default 50, configurable in CEHQ).
Per mission: name, carbonDescription, UEI, priority, valor, score,
reviewerScore, testerScore, flawlessPercent, dharma, history thread.
Strips: siliconDescription, status, queues.
Regenerated on every mission completion.

### 8. Mission History Entry Format

```typescript
interface HistoryEntry {
  timestamp: string
  actor: 'curator' | 'carbondev' | 'coder' | 'reviewer' | 'tester'
  action: string

  // Curator:
  curatorMsg?: string
  silicondevMsg?: string
  silicondevConfidence?: number  // 0.0-1.0
  flawlessPercent?: number       // 0-100
  fromLevel?: number
  toLevel?: number
  dharma?: string               // comma-separated paths

  // Carbondev feedback:
  verdict?: string              // 'accept' | 'modify' | 'rewrite'
  rating?: number               // 0-10 silicondev accuracy
  carbondevMsg?: string
  mature?: boolean              // true=bump, false=refine
  carbonSeconds?: number

  // Coder/Reviewer/Tester:
  reviewerScore?: number        // 0-100 (first pass)
  testerScore?: number          // 0-100 (first pass)
  testerValor?: number          // 0.0-2.0
  durationMs?: number
  comment?: string

  // Discovered issues (reviewer/tester collateral finds)
  discoveredIssues?: Array<{ name: string; description: string }>
}
```

### 9. Maturation Flow (The North Loop)

```
                    ┌──────────────────────────────────┐
                    │    CARBONDEV CREATES MISSION      │
                    │  assignedTo = 'anorak'            │
                    │  maturityLevel = 0 (🌑 para)     │
                    │  added to curator queue           │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────▼────────────────────────┐
              │  [CURATE] button or auto-curate triggers    │
              │                                             │
              │         CURATOR ENRICHES                    │
              │  reads curator-rl.md (RL context)           │
              │  12-step deep-dive (see §4)                 │
              │  writes carbon + silicon description        │
              │  generates silicondev voice                 │
              │  estimates flawless%                        │
              │  auto-tags dharma paths                     │
              │  (UEI adjusted only if warranted)           │
              │  assignedTo → 'carbondev'                   │
              └────────────────────┬────────────────────────┘
                                   │
              ┌────────────────────▼────────────────────────┐
              │    CARBONDEV REVIEWS (appears in DevCraft)  │
              │  reads curator thread in Mindcraft          │
              │  rates silicondev (0-10)                    │
              │  verdict: accept / modify / rewrite         │
              │  decision: BUMP ⬆ or REFINE ↻              │
              └─────┬──────────────────────┬───────────────┘
                    │                      │
             BUMP ⬆                 REFINE ↻
                    │                      │
             bump level +1          same level
             assign → anorak        assign → anorak
             add to queue end       add to queue end
                    │               (curator re-enriches)
                    │                      │
                    │                      └── back to CURATOR
                    │
             level < 3? ──yes──→ curator queue
                    │
             level = 3 (🌕 vaikhari)
                    │
                    ▼
             READY FOR EXECUTION
             [CODE] button or auto-code triggers
```

### 10. Execution Flow (The South Loop)

```
              ┌──────────────────────────────────────────┐
              │  VAIKHARI MISSION                        │
              │  [CODE] button or auto-code              │
              └──────────────┬───────────────────────────┘
                             │
              ┌──────────────▼───────────────────────────┐
              │  🔥 CODER                                │
              │  reads full mission row                   │
              │  implements changes                      │
              │  runs pnpm build                         │
              └──────────────┬───────────────────────────┘
                             │
              ┌──────────────▼───────────────────────────┐
              │  🔍 REVIEWER                             │
              │  0-100 score (regex parsed by orchestrator│)
              │  first pass → mission.reviewerScore      │
              │  discovered issues → new para missions   │
              │  < threshold → findings to coder → redo  │
              │  ≥ threshold → proceed                   │
              └──────────────┬───────────────────────────┘
                             │
              ┌──────────────▼───────────────────────────┐
              │  🧪 TESTER                               │
              │  vitest + playwright + CDP MCP            │
              │  writes NEW tests + full regression       │
              │  first pass → mission.testerScore        │
              │  discovered issues → new para missions   │
              │  < 100% → failures to coder → redo       │
              │  = 100% → assigns valor (0-2)            │
              └──────────────┬───────────────────────────┘
                             │
              ┌──────────────▼───────────────────────────┐
              │  MISSION COMPLETE                        │
              │  score = priority × valor                │
              │  curator-rl.md regenerated                │
              │  🔮 anorak pro recap (100 tokens)        │
              └──────────────────────────────────────────┘
```

### 11. The Detective Curator Philosophy

> "not blindly finding the fastest easiest solution to the bug.
> digging super deep and trying to uncover other things that must
> be broken if the bug is real."

The curator is a **detective who rolls back the call stack**.

1. Find the symptom
2. Find the cause
3. Ask: **if this cause is real, what ELSE must be broken?**
4. Find the root — the logical quirk, the architectural debt
5. Bugfixes become refactors
6. New features become composable modules

The flawless% reflects depth of understanding:
- 60% = "I found the symptom, here's a patch"
- 80% = "I found the root cause and the blast radius"
- 95% = "I understand the full call stack, all edge cases, all callers,
  and this spec will produce code that strengthens the architecture"

### 12. The Oasis Dharma — Noble Eightfold Path

The dharma paths are NOT just mission-level tags. They are the **compass
of the Oasis itself**. Every mission walks one or more of these paths.
Together, they keep the Oasis balanced and aligned with its purpose.

Curator auto-tags missions during maturation.

| Path | The Oasis Dharma | Tags when... |
|------|-----------------|--------------|
| **Right View** | Seeing reality clearly. Stability. Bug-free correctness. Understanding the system as it truly is, not as we wish it were. | Mission involves understanding real root causes, fixing incorrect state, correcting wrong assumptions |
| **Right Intention** | Building with purpose. Revenue. Growth. Sustainability. Every feature serves the grand plan, not ego. | Mission directly advances the product vision, user value, monetization, or growth strategy |
| **Right Speech** | Clear communication between carbon and silicon. UX. Onboarding. Documentation. The Oasis speaks clearly. | Mission improves UX, onboarding, error messages, documentation, spec clarity, agent communication |
| **Right Action** | Ethical building. Privacy. Security. No dark patterns. The Oasis respects its inhabitants. | Mission involves security, privacy, accessibility, fairness, ethical design |
| **Right Livelihood** | Sustainable architecture. Clean code. Zero debt. Composable modules. The codebase as Eiffel Tower. | Mission reduces tech debt, improves modularity, creates reusable abstractions, refactors |
| **Right Effort** | Balanced development. Fun and learning without burnout. The right amount of work for the right result. | Mission scope is well-calibrated, not over/under-engineered, brings joy in the making |
| **Right Mindfulness** | Awareness of the whole system. Testing. Monitoring. Blast radius. Knowing what you don't know. | Mission involves testing, observability, edge case handling, cross-cutting awareness |
| **Right Concentration** | Deep focus. Performance. Polish. Attention to detail. The last 10% that separates good from great. | Mission is about performance, visual polish, micro-interactions, optimization |

When all 8 paths are attended to and balanced, the Oasis walks its dharma.
The curator's dharma tags are a health signal — if all recent missions are
Right Livelihood (refactoring) and zero Right Intention (features), we're
navel-gazing. If all Right Intention and zero Right Mindfulness, we're
building on quicksand.

### 13. Mission Visibility Rules

| View | Shows | Rationale |
|------|-------|-----------|
| **DevCraft** | `assignedTo = 'carbondev'` | Carbondev's escritorio. Work desk. Includes missions freshly assigned by curator for feedback. |
| **Anorak Pro Mindcraft** | All missions with anorak history OR `assignedTo IN ('anorak', 'anorak-pro')` | Full pingpong view. Sees missions while anorak has them AND while carbondev is reviewing. |
| **Parzival Mindcraft** | All missions with parzival history OR `assignedTo = 'parzival'` | Parzival's world. No anorak missions. |

### 14. Multimodal (Non-Negotiable)

Anorak Pro must generate images, voice notes, and videos before it can
even invoke coder. These are **tool calls** available to all agents.

#### Image Generation (MCP tool: `generate_image`)
- Provider: **OpenRouter** (same as existing `/api/imagine` route)
- Models: gemini-flash, seedream, nano-banana-2, riverflow (copy IMAGINE_MODELS from imagine route)
- Input: prompt, model?, width?, height?
- Output: URL to generated image, displayed inline in Stream tab
- Click to expand fullscreen

#### Voice Note (MCP tool: `generate_voice`)
- Provider: **ElevenLabs** (`ELEVENLABS_API_KEY` env var)
- Input: text, voice?, speed?
- Output: audio URL, playable inline with speed selector (1x / 1.2x / 1.5x / 2x)

#### Video Generation (MCP tool: `generate_video`)
- Provider: **fal.ai** with LTX 2.3 (`FAL_KEY` env var)
- Input: prompt, duration?
- Output: video URL, playable inline with controls + fullscreen button

All windows (Anorak, Anorak Pro, Parzival) must handle voicenotes, images,
and video inline in their stream/chat views.

**STT** (speech-to-text) comes later — carbondev speaks instead of typing.

**Video as 3D world objects** — Phase 2-3: place videos in the world with
frames, looping toggle, sound on/off, spatial audio (louder when camera
is closer). See oasisspec3.

---

## Settled Decisions (moved from TBD)

- **Process management**: DB checkpoint + production mode restart after reviewer.
  See "Server Stability During South Loop" in orchestrator section.
- **Batch curation**: single curator spawn, N missions in one prompt. Cap 5.
  Queue priority: `curatorQueuePosition` then highest-priority immature.
- **Concurrency**: sequential. One agent at a time. Curator pauses during south loop.
- **Multimodal**: OpenRouter for images, ElevenLabs for voice, fal.ai LTX 2.3 for video.
- **Tester**: writes all tests (not coder). Testing pyramid: vitest → playwright → CDP MCP.
- **Scores**: written by agents via MCP tools, read by orchestrator from DB.
- **Discovered issues**: agents call `create_mission` MCP tool directly.
- **Auto-code**: no safety gate. Carbondev decides when to turn on. Highest priority first.
- **stderr**: routed to SSE alongside stdout (dimmed gray).

---

## Phase 1 Deliverables

1. **Nomenclature sweep**: `player1`/`dev` → `carbondev` across codebase
2. **Schema**: add Mission fields + CuratorLog model → `prisma db push`
3. **Agent defs**: `.claude/agents/curator.md`, `.claude/agents/coder.md`
   (enhanced reviewer.md + tester.md with discovered issues output)
4. **Orchestrator**: `/api/anorak/pro/execute` — the horizontal link-runner
5. **API routes**: `/api/anorak/pro/curate`, `/api/anorak/pro/feedback`
6. **RL generator**: `src/lib/anorak-curator-rl.ts`
7. **Panel**: `AnorakProPanel.tsx` — 2D, 4 tabs (Stream, Mindcraft, Curator Log, CEHQ)
8. **Panel chrome**: settings (bg color, blur, opacity)
9. **CEHQ**: per-lobe lobeprompt editing, model selection, context modules
10. **Store**: add 'anorak-pro' to AgentWindowType, wire WizardConsole
11. **Mission visibility**: DevCraft = carbondev only, Anorak Pro = anorak pingpong
12. **Tests**: vitest for curator-rl, API routes, history format

## Phase 2

- Auto-curate + auto-code toggles (event-driven, sequential)
- Process management (external orchestrator or worktree isolation)
- Tester overhaul (CDP MCP, comprehensive vitest, "player" paradigm)
- Multimodal tools (image, voice, video generation)
- 3D Anorak Pro window
- STT (speech-to-text for carbondev input)
- Reviewer/tester auto-generating para missions
- SiliconDev prediction accuracy dashboard
- Global stream (all agents' thoughts unified)
- Anorak Pro recap after each mission

## Phase ∞ — The Living Oasis

Both loops spinning. Curator generates missions from discovered bugs.
Coder implements. Reviewer catches issues. Tester validates. New bugs
become new missions. The Oasis evolves faster than it degrades.

Parzival models his innermost 8 after Anorak Pro's. Becomes co-director.
Carbon Model predicts what missions bring carbondev bliss and growth.
The 0-person unicorn emerges: a game that builds itself, directed by
an AI that knows its creator better than they know themselves.

---

ॐ weld, don't tape ॐ
