# Oasis agent engine

Runs Claude Code sessions as Oasis agents. Each agent you own is one long-lived `claude -p` stream-json process. The engine discovers your existing sessions, can mirror any of them read-only, and accepts Claude Code `type: "http"` hooks. Everything is bridged to the Oasis page over one WebSocket.

- Start it from the af_oasis root with `pnpm dev:engine`, next to `pnpm dev`.
- It listens on `127.0.0.1:4530` (`/ws`, `/health`, `/hook`, `/api/*`). Requests must come from a loopback Host and, when they carry an Origin, a loopback Origin. That stops other websites and DNS rebinding.
- The roster of agents you spawned lives in `data/agent-engine.local.json` (gitignored), and agents come back with `--resume` after a restart.
- Smoke test (0 turns): with the engine running, `node packages/oasis-agent-engine/scripts/smoke.mjs basic`. It only touches the scratch agents in `sandbox/`.

This package grew out of the 7c_oasis spike (`C:/7c_oasis/spike`). The schema and findings below were verified against Claude Code 2.1.316 on Windows.

## How an agent process is spawned

```
claude.exe -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages      # text deltas (+ system/status "requesting")
  --replay-user-messages          # echo of each user message at the moment the CLI takes it in
  --forward-subagent-text         # subagent text too, tagged with parent_tool_use_id
  --permission-prompt-tool stdio  # permission prompts, AskUserQuestion, ExitPlanMode -> host
  [--model haiku|sonnet|opus|<id>] [--permission-mode ...] [--effort ...]
  --resume <id> [--fork-session]  # existing session (found in any project dir)
  | --session-id <new uuid>       # new agent: the id is known before the first turn
```

- **Windows:** `%APPDATA%\npm\claude.cmd` only runs `node_modules\@anthropic-ai\claude-code\bin\claude.exe %*`. `claude.js` parses the shim and spawns the exe directly with `shell:false`. That avoids cmd.exe quoting, and `kill()` reaches the real process. If parsing fails, it falls back to `claude.cmd` through a shell.
- **Env:** every `CLAUDECODE` / `CLAUDE*` variable is dropped, except `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_GIT_BASH_PATH`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK/VERTEX` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. The desktop app injects about 30 of these (session id, messaging socket and token, entrypoint, effort...). With them stripped, the children ran as normal `sdk-cli` sessions on the subscription (`apiKeySource:"none"`).
- **Sandbox agents** also get `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. `spike/sandbox` sits inside the 7c_oasis git repo, so without it a scratch agent loads the repo's `CLAUDE.md` **and the owner's 7c_oasis auto-memory**. `get_context_usage` listed `memory_files` = repo CLAUDE.md, the sandbox CLAUDE.md, and `~/.claude/projects/C--7c-oasis/memory/MEMORY.md`.
- The owner's global hooks (agentcraft) also run in every child. That's expected, since these are real Claude Code sessions.

## Event schema v1

Every event is `{ v: 1, agentId, ts, kind, ...payload }`. The envelope fields always win over the payload.

| kind | payload |
|---|---|
| `init` | `sessionId, model, permissionMode, cwd, tools[], mcpServers[{name,status}], agents[], claudeCodeVersion`. Emitted again only when one of these changes (the CLI re-sends init every turn) |
| `meta` | `models[{value,resolvedModel,displayName}], subscription, claudeCodeVersion, permissionMode` (from `initialize`), or `title` (observe) |
| `status` | `status: working \| waiting \| needs-decision \| error \| idle`, `reason` |
| `user.sent` / `user.consumed` | `uuid, text, midTurn, priority` / `uuid, folded (true = taken into the running turn), waitedMs` |
| `user` | `text, uuid, replay`: a prompt seen in the stream or a transcript |
| `text.delta` / `text` | `messageId, index, text, parentToolUseId` / `messageId, text, parentToolUseId, model` |
| `tool.start` / `tool.end` | `toolUseId, name, input (clipped), summary, parentToolUseId` / `toolUseId, name, isError, output (clipped)` |
| `todo` | `source: TodoWrite \| Task`, `todos[{content,status,activeForm}]`: the whole list every time |
| `subagent.start` / `.progress` / `.end` | `toolUseId, taskId, description, subagentType, prompt` / `lastToolName, usage` / `status, summary, usage` |
| `permission.request` / `.resolved` / `.denied` | `requestId, requestKind: permission \| question \| plan, toolName, toolUseId, input, summary, suggestions, readOnly?` / `requestId, behavior` / `toolName, message` (an auto-deny) |
| `turn.end` | `subtype, isError, outcome: done-waiting \| needs-decision \| error, reason, result, durationMs, durationApiMs, numTurns, usage{input,output,cacheRead,cacheCreation}, costUsd (this turn), totalCostUsd (process total), contextTokens, contextWindow, model, permissionDenials[], terminalReason, stopReason, notices?` |
| `context` | `usedTokens, maxTokens, percent, model` (from `get_context_usage` after every turn; costs no quota) |
| `rate_limit` | `status, utilization, resetsAt, window` (the subscription's 7-day window) |
| `notice` / `error` / `exit` / `model` / `hook` / `removed` | misc: interrupt, compaction, model fallback, process exit and stderr, model switch, a hook fired for an owned agent, agent removed |

`reason` on a `turn.end` is one of `end_turn`, `interrupted`, `permission`, `permission-denied`, `question`, `question-text`, `plan`, or the error subtype. `needs-decision` covers: a `can_use_tool` request still open (permission, AskUserQuestion, ExitPlanMode), an auto-denied tool (`permission_denials` the host did not answer itself), a pending AskUserQuestion or ExitPlanMode tool call, or, as a heuristic, a final text ending in `?`.

**Status machine (owned agents):** `idle` after spawn, then `working` from the send until the `result` while queued messages remain, `needs-decision` while a `can_use_tool` is open, then `waiting`, `needs-decision` or `error` from the outcome. An interrupt resolves to `waiting`. A non-zero exit is `error`. A killed agent is `idle`.

**WebSocket** `ws://127.0.0.1:4530/ws`: on connect you get `{type:"hello", agents, backlog}`. Then come `{type:"event", event}` and `{type:"agents", agents}` (snapshots). Send `{id, cmd, ...args}` and you get `{type:"reply", id, ok, data|error}`. Commands: `listAgents, listSessions, listLive, spawnAgent{name,cwd,sessionId?,model?,permissionMode?,effort?,fork?,force?}, send{agentId,text,priority?}, interrupt{agentId,cancelQueued?}, setModel{agentId,model}, setPermissionMode{agentId,mode}, respond{agentId,requestId,behavior:"allow"|"deny",answers?,always?,message?}, contextUsage, kill{agentId}, restart, observe{sessionPath}, unobserve, history, shutdown`. `POST /api/cmd` takes the same JSON. The server binds 127.0.0.1 and refuses non-localhost `Origin`s. There is no auth, which is fine for a spike, not for a product.

## FINDINGS

Spend: **17 short turns** (16 haiku, 1 sonnet), about $0.12 at list price according to `total_cost_usd`. Everything else (initialize, get_context_usage, set_model, set_permission_mode, resume, observe) costs no quota.

**Process and protocol.** One `claude -p --input-format stream-json` process stays alive across turns until stdin closes (then exit code 0). Before the first user message it only emits `SessionStart` hook messages. **No `system/init` arrives until the first message, and init is re-emitted at the start of every turn.** Its tool count grew from 29 to 51 once the claude.ai MCP connectors finished connecting. Stdin user message: `{"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null,"session_id":"","uuid":"<client uuid>"}`. The client `uuid` comes back unchanged on the replay echo. Control channel: host → CLI `{"type":"control_request","request_id":"x","request":{"subtype":...}}`, answered by `{"type":"control_response","response":{"subtype":"success"|"error","request_id":"x","response":{...}|"error":"..."}}`. An unknown subtype gets `"Unsupported control request subtype: ..."`. Zero-cost requests verified: `initialize` (returns `commands`, `agents`, **`models` (13 entries with value, resolvedModel and supported effort levels)**, `account` (subscription type), `pid`, `current_permission_mode`, `session_state`), `get_context_usage`, `set_model`, `set_permission_mode`, `get_settings`, `get_status`, `mcp_status`. The binary also handles `end_session`, `cancel_async_message`, `rewind_conversation`, `fork_conversation`, `get_plan`, `side_question` and more. Those are untested.

**Mid-turn messages ("talk to it while it works"): works, two verified behaviours, no host-side queue needed.**
1. Sent while a tool runs, the message is **folded into the running turn at the next tool-result boundary**. Probe: `sleep 8` was running when "end with PINEAPPLE" was sent at t+3.4s. The echo (`isReplay:true`) arrived right after the tool_result at t+11.6s, and the same turn answered `first-done\nPINEAPPLE`. One `result` with `num_turns:2`. The engine repeated this over WebSocket (KIWI, `user.consumed folded:true, waitedMs 11619`).
2. Sent while the model streams plain text (no tool boundary left), the message **queues and runs as the next turn** right after the `result`. A new `system/init` comes first, then the echo, then a second `result`. Probe: BANANA. In the UI: MANGO was sent just after the tool finished, so it showed "ran as the next turn".
- So one result does not mean one message. The engine tracks sent-but-not-echoed uuids and keeps the avatar `working` until all are consumed.
- The CLI also supports `priority: "now"` on a user message ("stop the turn at its next model request and answer this", running shell commands are backgrounded) and `"later"`, plus `interrupt {send_now:true, message_uuid}` and `cancel_async_message {uuid}` (from the schema in the binary, advertised in init `capabilities: interrupt_send_now_v1, interrupt_cancel_queued_v1, msg_lifecycle_v1`). The engine passes `priority` through (the UI "urgent" checkbox). **`"now"` itself was not exercised (no turn spent on it).**

**Interrupt: works.** `{"subtype":"interrupt"}` → `{"still_queued":[]}` (queued uuids that will still run; add `cancel_queued:true` to drop them). Then `[Request interrupted by user]` (or `... for tool use`) and a `result` with `subtype:"error_during_execution"`, `is_error:true`, `terminal_reason:"aborted_streaming"` (during generation) or `"aborted_tools"` (during a running Bash call; that tool_result is an error saying the call was stopped). The process stays usable. The engine maps this to `outcome done-waiting, reason interrupted`. Side finding: the Bash tool **refuses long foreground sleeps** (`sleep 40` gave "Blocked: sleep 40 followed by: echo late"), so use something like `node -e "setTimeout(...)"` for slow test commands.

**Model switching: no respawn needed.** `{"subtype":"set_model","model":"sonnet"}` → `{"model":"claude-sonnet-5-5"}`, plus a synthetic `<local-command-stdout>Set model to sonnet (claude-sonnet-5-5)` echo. The next turn's init and assistant messages said `claude-sonnet-5-5`, and `result.modelUsage` listed both models. Aliases resolved in this account: `haiku` → `claude-haiku-5-5`, `sonnet` → `claude-sonnet-5-5`, `default`/`opus` → `claude-opus-5-5` (full list from `initialize.models`). `--effort` exists as a flag. A live effort switch was not tested (`set_max_thinking_tokens` exists in the binary).

**init carries** `session_id, cwd, model, permissionMode, tools[], mcp_servers[{name,status}], slash_commands, agents, skills, plugins, claude_code_version, apiKeySource, capabilities, messaging_socket_path, fast_mode_state`. Permission mode names: `--help` lists `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`. **`--permission-mode default` is still accepted.** Both `default` and `manual` report `current_permission_mode: "default"`.

**Permission prompts via host: works, but only with the hidden flag `--permission-prompt-tool stdio`.**
- `--permission-mode default --permission-prompts host` alone (host is the default) gives **no** control request. Writes were auto-denied with `system/permission_denied` ("Claude requested permissions to write to ..., but you haven't granted it yet.") and listed in `result.permission_denials`.
- Adding `--permission-prompt-tool stdio` (what the Agent SDK passes when `canUseTool` is set; found in the binary) makes each prompt arrive as `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{...},"description":"perm-a.txt","permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],"tool_use_id":"toolu_..."}}`.
- Allow: `{"type":"control_response","response":{"subtype":"success","request_id":"<same>","response":{"behavior":"allow","updatedInput":{...}}}}`. Add `"updatedPermissions":[<a suggestion>]` for "allow always".
- Deny: `{... "response":{"behavior":"deny","message":"..."}}`. The model sees the message as the tool_result, and the result's `permission_denials` lists it (the engine doesn't flag host-denied calls as needs-decision).
- Verified: allow created `perm-a.txt`, deny left `perm-b.txt` absent. A pending AskUserQuestion request sat about 3.7 minutes and was still answerable (no timeout seen).
- The engine always passes `--permission-prompt-tool stdio`. Agents use the mode the owner picks per agent, or with no `--permission-mode`, the owner's settings (`defaultMode: auto` on this machine). bypassPermissions is not forced.

**AskUserQuestion / ExitPlanMode.** Without a prompt handler these tools are **not offered at all** in `-p`. With `--permission-prompt-tool stdio` the init tools gain `AskUserQuestion, EnterPlanMode, ExitPlanMode`. A question arrives as `can_use_tool` with `tool_name:"AskUserQuestion"`, and the input has `questions[{question, header, options[{label,description}], multiSelect}]`. Answer with `behavior:"allow"` and `updatedInput:{...input, answers:{"<question text>":"<label>"}}`. The tool_result was `Your questions have been answered: "Do you prefer tea or coffee?"="Tea"` and the agent replied `Tea`. Verified over WebSocket. Agent status was `needs-decision` while it waited. ExitPlanMode should go the same way. Not exercised.

**Subagents (Agent tool; init still lists it as `Task`).** The parent emits `tool_use name:"Agent"` with input `{description, prompt, subagent_type, run_in_background}`. Then come `system/task_started {task_id, tool_use_id: <Agent tool_use id>, task_type:"local_agent", subagent_type, is_backgrounded, spawn_depth, prompt}`. Every subagent message carries **`parent_tool_use_id = the Agent tool_use id`** plus `agent_id, subagent_type, task_description`. That covers its prompt, tool_use (`Glob`), tool_result, and text (text needs `--forward-subagent-text`). Then `system/task_progress {last_tool_name, usage}`, `system/task_updated {patch:{status:"completed"}}`, `system/task_notification {status, summary, output_file, usage}`, and the parent's tool_result with `tool_use_result {status, agentId, agentType, toolsUsed, ...}`. `result.subagent_stats` counts spawned, completed and failed. Bash calls are tasks too (`task_type:"local_bash"`). Agents default to background (`run_in_background` defaults true). The engine ends a subagent on `task_notification`, or on the tool_result when it was foreground. Subagent transcripts live in `<session>/subagents/agent-<id>.jsonl` + `.meta.json`.

**Todos.** With 5.x models, **TodoWrite is not available in `-p`** (`ToolSearch select:TodoWrite` → "No matching deferred tools found"). `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` did not change that. The model uses the deferred **TaskCreate / TaskUpdate** tools instead (`TaskCreate {subject, description, activeForm}` → "Task #1 created", `TaskUpdate {taskId:"1", status:"completed"}`). The normalizer maps both shapes to `todo` events with the whole list. Verified: wait/answer went pending → completed. (The desktop app uses its own plan tool via MCP, so a real Oasis may want its own todo tool too.)

**Usage, context, limits.**
- `result.usage` and `result.model_usage_since_last_result` are **per turn**. `result.total_cost_usd` is **cumulative for the process** (0.00345 → 0.00393 → 0.00439 ...).
- Each assistant message has `usage`. Context ≈ `input + cache_creation + cache_read` of the last main-thread message. `modelUsage[model].contextWindow` was 1,000,000 for haiku-5-5 and sonnet-5-5.
- `get_context_usage` gives the exact breakdown (`totalTokens`, `maxTokens`, `percentage`, `categories`, `memoryFiles`, `messageBreakdown`). A fresh sandbox session is about 22k tokens.
- `rate_limit_event` arrives once per turn with the **subscription 7-day utilization** (`0.67`, `resetsAt`). The UI shows it.
- `thinking_tokens` system messages give thinking progress. Thinking text itself is empty (`thinking:""` + signature).

**Resuming a session created elsewhere: works.** A one-shot `claude -p "Remember the codeword ZEBRA"` session (stand-in for "created in a terminal") was resumed by a stream-json process with `--resume <id>`. Same session id, no fork, and it answered `ZEBRA`. Transcripts from every entrypoint share one `.jsonl` format (`entrypoint` is `cli`, `claude-desktop`, `claude-vscode` or `sdk-cli`), so desktop or terminal sessions resume the same way. That part is inferred from the format, because no owner session was touched. `--resume` **found the session even from a different cwd** (the history loaded). The engine still spawns in the session's original cwd (from discovery), so tools and CLAUDE.md match. Caveats:
- A resume with no turn still **appends** to the transcript (`cost-state` / `last-prompt` records on exit). Only observe mode is truly read-only.
- `get_context_usage` right after `--resume` proves the history is loaded, and costs no quota. Restored roster agents measured 36.8k tokens against about 22k for a fresh session.

**Same session open in two places: it silently forks.** Two stream-json processes resumed the same id at the same time. There was no lock, no error and no auto-fork, and both wrote to the same `.jsonl`. Each keeps its own in-memory history: A never saw B's message. The transcript's `parentUuid` chain forked at the last shared record. The next fresh `--resume` followed the **last `last-prompt.leafUuid` written** (here B's branch, because B exited last), and A's exchange was orphaned. **Rule for the Oasis: never drive a session that another process has open.** Use observe, or `--fork-session`. The engine enforces this. `spawnAgent` refuses a session that is live in a foreign process (see the registry below) unless `fork:true` or `force:true`. Verified with a sandbox session held open by a foreign `claude -p`.

**Bonus: a live registry of every running session, at no cost.** Every Claude Code process, whether desktop app, terminal, `-p` or SDK (including the engine's own children), maintains `~/.claude/sessions/<pid>.json` = `{pid, sessionId, cwd, kind, entrypoint, name, status: "idle"|"busy", statusUpdatedAt, messagingSocketPath, peerFeatures, ...}`. Files of dead pids linger, so check the pid. The `<pid>.<hash>.key` files hold peer tokens, and the engine never reads them. `claude agents --json [--all]` prints the same data: `[{pid, cwd, kind:"interactive", startedAt, sessionId, name, status}]`. On this machine it showed 22 open sessions, all `kind:"interactive"`, with `idle`/`busy`. The engine uses the registry for exact "open elsewhere" detection in `listSessions` (`live` field, "open · busy" badge in the UI) and for observer status (busy → working, idle → waiting). `messagingSocketPath` (a named pipe, `peerProtocol:1`) looks like the channel desktop sessions use to message each other. It might let the Oasis talk to sessions it doesn't own. **Unexplored.** Not tested: `claude --bg` background agents and their working/blocked/done states (that would have spent turns).

**Observe mode (read-only tail): works**, against the owner's live desktop sessions and sandbox ones. It replays the last 512 KB of the transcript as events, then polls every second for appended bytes. It splits on `\n` at byte level and tolerates partial lines and giant records. Transcript records differ from the stream:
- one `assistant` record per content block
- no `result` record, so turn ends come from `system/stop_hook_summary` or `turn_duration`, and observed turns have no cost
- titles come from `custom-title` / `agent-name` records or `<session>/custom-title.json`
- `queue-operation` records show mid-turn enqueues
- the `.jsonl` interleaves both branches of a fork in file order

Status comes from records plus the live registry. Without a registry entry, "working" with no writes for 10 minutes becomes idle.

**Hooks over HTTP (third path): works except SessionStart.** Project-level `spike/sandbox/agent-b/.claude/settings.json` with `{"type":"http","url":"http://127.0.0.1:4530/hook"}` delivered `UserPromptSubmit, PreToolUse, PermissionRequest, Notification, PostToolUse, Stop, SessionEnd` to `POST /hook`. Answering `{}` (no decision) left the session's own behaviour unchanged, and the AskUserQuestion still reached our `can_use_tool` handler. **`SessionStart` did not arrive** at process start, though the owner's command-type SessionStart hook did run. Loopback URLs are explicitly allowed. Hook events for unknown sessions become read-only "hook" agents. For owned agents they only add a `hook` marker event.

**Session discovery.** 193 transcripts (7.2 GB, 107 over 5 MB) are listed in about 260 ms cold and 8 ms cached. Only a 128 KB head and tail are read per file. cwd comes from the first record that has one, and some sessions start with a >128 KB `file-history-snapshot`, so the tail is the fallback. Title order: `custom-title.json` → last `custom-title` → `agent-name` → `summary` → first real prompt. The encoded project dir is the cwd with every non-alphanumeric character turned into `-` (`C:\7c_oasis\spike` → `C--7c-oasis-spike`).

**Bare mode.** We never pass `--bare` (its help says auth is "strictly ANTHROPIC_API_KEY or apiKeyHelper"). Non-bare `-p` used the subscription: `apiKeySource:"none"`, `get_status` said "Claude Ultra account", and `rate_limit_event` showed the 7-day window. In 2.1.316 nothing suggests `-p` defaults to bare.

**What I verified, and what I didn't.**
- Engine: everything above was exercised with real turns or zero-cost control requests (probe logs in `spike/data/probe-logs`, gitignored).
- UI, in the desktop app's browser pane (screenshots): the scene renders; the 3D windows show live cards (text, tool calls, todos, subagent, turn end with cost and context); the status rings show all five colours (working green, waiting blue, needs-decision amber, error red, idle gray); clicking an avatar or a row focuses it and flies the camera there; the composer sent a turn and a mid-turn message; "observe" and the "open · busy" badges work.
- **Not checked in the browser:** answering a permission or question by clicking the window's buttons (the same `respond` command was verified over WebSocket), the "urgent" (`priority:"now"`) path, ExitPlanMode, and how it performs with more than six agents.
