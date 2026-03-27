# ॐ Ralph Loop — Autonomous Innermost 8 for the Oasis
# Named after Ralph Wiggum ("I'm helping!")
# Runs Claude Code CLI in infinity mode: south loop + north loop fallback
#
# Usage: open a standalone PowerShell terminal (NOT VS Code), then:
#   cd c:\af_oasis
#   .\ralph.ps1
#
# To stop: Ctrl+C
# Monitor costs: claude --usage
# MCP servers: visual-qa (CDP screenshots), mission (DB), playwright — all load automatically

$southLoopPrompt = @"
You are in AUTONOMOUS LOOP MODE. Read CLAUDE.md first.

You have MCP tools: visual-qa (screenshot, execute_js, navigate — CDP on port 9222), mission (get_mission, mature_mission, create_mission, report_review, report_test), playwright (@playwright/mcp).

## SOUTH LOOP (primary)
1. Query SQLite DB for todo missions: use Prisma to list missions with status='todo', ordered by priority desc.
2. Pick the highest-priority mission with flawless% >= 70. If none, pick highest priority regardless.
3. Read its siliconDescription — that is your implementation spec.
4. IMPLEMENT the mission. Follow siliconDescription step by step.
5. pnpm build. Fix errors.
6. REVIEWER: invoke Agent tool with reviewer prompt (read .claude/agents/reviewer.md). Score >= 90 to proceed. If not, fix and re-review.
7. TESTER (THE PLAYER): invoke Agent tool with tester prompt (read .claude/agents/tester.md). Tester WRITES new vitest tests. Tester MUST run visual tests via Playwright/CDP when .tsx files changed — screenshot the oasis, verify panels render, check interactions. Score 100%. If not, fix and re-test.
8. Mark mission done in DB: update status='done', endedAt=now via Prisma.
9. After every 5 completed missions: git add + git commit with summary of what shipped.
10. Go back to step 1. Pick next mission. DO NOT STOP.

## NORTH LOOP (fallback — when no todo missions remain)
When the todo queue is empty:
1. Read carbondir/oasisspec3.txt — the living todolist.
2. Read .claude/agents/curator.md — understand the curator's 12-step deep dive process.
3. Pick 3-5 high-urgency, high-easiness, high-impact items from oasisspec3.
4. For each, create a PASHYANTI mission in the DB via Prisma:
   - Do the curator's deep dive: read 5+ files, trace imports, find root cause
   - Write carbonDescription (emotional war cry, zero jargon, flawless% in human language)
   - Write siliconDescription (exact files, line numbers, step-by-step implementation, acceptance criteria)
   - Write a curatorMsg (3-5 sentences, what you found)
   - Write a silicondevMsg (2-3 sentences, predict what the dev would say, casual + profane)
   - Set maturityLevel=1, flawlessPercent, dharmaPath, UEI scores
   - Store history as JSON array with one curator entry
5. Now there are todo missions again → go back to SOUTH LOOP.

## RULES
- NEVER ask for confirmation. Just execute.
- NEVER stop between missions. Finish one, start the next.
- Reviewer and tester are SEQUENTIAL, never parallel.
- Tester writes ALL new tests. You write ZERO tests.
- If build fails 3 times on same error, skip mission (mark status='blocked') and move to next.
- Git commit every 5 missions, not every one.
- If you create north loop missions, south loop them immediately after.
- For visual testing: use the visual-qa MCP tools (screenshot, execute_js) to actually SEE the oasis. Start Chrome with --remote-debugging-port=9222 if needed.

## CONTEXT
- Working dir: c:\af_oasis
- Stack: Next.js 14 + React Three Fiber + Zustand + Prisma/SQLite
- Dev server: localhost:4516 (start with pnpm dev if needed for visual testing)
- Chrome CDP: localhost:9222 (for visual-qa MCP)
- DB: prisma/data/oasis.db (Prisma direct access, no API needed)
- Agents: .claude/agents/reviewer.md, .claude/agents/tester.md, .claude/agents/curator.md

ॐ ship or die ॐ
"@

$round = 0
while ($true) {
    $round++
    $timestamp = Get-Date -Format 'HH:mm:ss'
    Write-Host ""
    Write-Host "+==============================================+" -ForegroundColor Cyan
    Write-Host "|  [ralph] round $round - $timestamp              |" -ForegroundColor Cyan
    Write-Host "+==============================================+" -ForegroundColor Cyan

    if ($round -eq 1) {
        Write-Host "[ralph] Starting fresh session..." -ForegroundColor Yellow
        $southLoopPrompt | claude --print --dangerously-skip-permissions --model claude-opus-4-6 --output-format stream-json --verbose -n "ralph-south-loop" 2>&1 | ForEach-Object {
            $line = $_.ToString().Trim()
            if (-not $line) { return }
            try {
                $evt = $line | ConvertFrom-Json -ErrorAction Stop
                $type = $evt.type
                if ($type -eq "assistant" -and $evt.message.content) {
                    foreach ($block in $evt.message.content) {
                        if ($block.type -eq "text") { Write-Host $block.text -ForegroundColor White }
                        if ($block.type -eq "tool_use") { Write-Host "[tool] $($block.name)" -ForegroundColor DarkCyan }
                    }
                }
                elseif ($type -eq "content_block_delta") {
                    if ($evt.delta.type -eq "text_delta") { Write-Host $evt.delta.text -NoNewline -ForegroundColor White }
                    elseif ($evt.delta.type -eq "thinking_delta") { Write-Host $evt.delta.thinking -NoNewline -ForegroundColor DarkGray }
                }
                elseif ($type -eq "content_block_start" -and $evt.content_block.type -eq "tool_use") {
                    Write-Host "`n[tool] $($evt.content_block.name) " -NoNewline -ForegroundColor Cyan
                }
                elseif ($type -eq "content_block_stop") { }
                elseif ($type -eq "result") {
                    Write-Host "`n[result] cost: $($evt.cost_usd) | tokens: $($evt.total_input_tokens)+$($evt.total_output_tokens)" -ForegroundColor Green
                }
            } catch {
                # Raw text or unparseable — just show it
                if ($line.Length -gt 0 -and $line.Length -lt 500) {
                    Write-Host $line -ForegroundColor DarkYellow
                }
            }
        }
    } else {
        Write-Host "[ralph] Resuming last session..." -ForegroundColor Yellow
        "Continue. Pick the next todo mission from the DB and implement it. If no todo missions, run north loop. Do not stop." | claude --resume last --print --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 | ForEach-Object {
            $line = $_.ToString().Trim()
            if (-not $line) { return }
            try {
                $evt = $line | ConvertFrom-Json -ErrorAction Stop
                $type = $evt.type
                if ($type -eq "assistant" -and $evt.message.content) {
                    foreach ($block in $evt.message.content) {
                        if ($block.type -eq "text") { Write-Host $block.text -ForegroundColor White }
                        if ($block.type -eq "tool_use") { Write-Host "[tool] $($block.name)" -ForegroundColor DarkCyan }
                    }
                }
                elseif ($type -eq "content_block_delta") {
                    if ($evt.delta.type -eq "text_delta") { Write-Host $evt.delta.text -NoNewline -ForegroundColor White }
                    elseif ($evt.delta.type -eq "thinking_delta") { Write-Host $evt.delta.thinking -NoNewline -ForegroundColor DarkGray }
                }
                elseif ($type -eq "content_block_start" -and $evt.content_block.type -eq "tool_use") {
                    Write-Host "`n[tool] $($evt.content_block.name) " -NoNewline -ForegroundColor Cyan
                }
                elseif ($type -eq "content_block_stop") { }
                elseif ($type -eq "result") {
                    Write-Host "`n[result] cost: $($evt.cost_usd) | tokens: $($evt.total_input_tokens)+$($evt.total_output_tokens)" -ForegroundColor Green
                }
            } catch {
                if ($line.Length -gt 0 -and $line.Length -lt 500) {
                    Write-Host $line -ForegroundColor DarkYellow
                }
            }
        }
    }

    $exitCode = $LASTEXITCODE
    $timestamp = Get-Date -Format 'HH:mm:ss'
    Write-Host ""
    Write-Host "[ralph] $timestamp - claude exited (code $exitCode). Resuming in 5s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
