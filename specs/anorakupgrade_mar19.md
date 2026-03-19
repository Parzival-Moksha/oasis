# ॐ ANORAK CLARITY UPGRADE — Mar 19 Spec

One-shot spec. Two files to edit. No new dependencies. Ship it.

## Files to modify

1. `src/app/api/claude-code/route.ts` (the backend — SSE stream from CLI)
2. `src/components/forge/AnorakPanel.tsx` (the frontend — renders everything)

---

## TASK 1: Forward stderr to browser

**File:** `src/app/api/claude-code/route.ts`
**Location:** Lines 354-359 — the `child.stderr.on('data')` handler

**Current code:**
```typescript
child.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim()
  if (text.length > 0 && text.length < 2000) {
    console.log(`[ClaudeCode:stderr] ${text.substring(0, 200)}`)
  }
})
```

**Change to:**
```typescript
child.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim()
  if (text.length > 0 && text.length < 2000) {
    console.log(`[ClaudeCode:stderr] ${text.substring(0, 200)}`)
    sendEvent('stderr', { content: text })
  }
})
```

That's it. One line added. The frontend already handles `case 'stderr'` at line 646-651 in AnorakPanel.tsx — it renders stderr as gray status text and filters out keepalive noise.

---

## TASK 2: Emit progress events (live token counts)

**File:** `src/app/api/claude-code/route.ts`
**Location:** Inside the `eventType === 'assistant'` block (line 190), AFTER the content diffing logic (after line 259 where `lastSeenContentLength = content.length`)

Claude Code's stream-json `assistant` events include usage data on the message object:
```json
{"type":"assistant","message":{"content":[...],"usage":{"input_tokens":12500,"output_tokens":340}}}
```

**Add after line 259** (`lastSeenContentLength = content.length`):
```typescript
// Extract token usage from assistant messages for live progress
if (msg.usage) {
  sendEvent('progress', {
    inputTokens: msg.usage.input_tokens || 0,
    outputTokens: msg.usage.output_tokens || 0,
  })
}
```

The frontend already handles `case 'progress'` at line 633-636 in AnorakPanel.tsx — it updates `turnInputTokens` and `turnOutputTokens` and calls `updateTurn()`.

---

## TASK 3: Live token counter in header

**File:** `src/components/forge/AnorakPanel.tsx`
**Location:** The header bar, between the cost indicator (line 762-766) and the session picker (line 769)

The turn metadata at the bottom (lines 1014-1021) already shows tokens AFTER streaming ends. We want a LIVE counter that updates DURING streaming.

**Add state** near line 312 (after `totalCost` state):
```typescript
const [liveTokens, setLiveTokens] = useState({ input: 0, output: 0 })
```

**Update the progress handler** in the `invoke()` switch statement (around line 633):
```typescript
case 'progress': {
  turnInputTokens = event.inputTokens
  turnOutputTokens = event.outputTokens
  setLiveTokens({ input: event.inputTokens, output: event.outputTokens })
  break
}
```

**Reset liveTokens** when streaming ends — in the `finally` block (around line 674):
```typescript
setLiveTokens({ input: 0, output: 0 })
```

**Render the live counter** in the header, between cost and session picker. Insert after line 766 (the `totalCost` span's closing tag):

```tsx
{/* Live token counter — visible during streaming */}
{isStreaming && (liveTokens.input > 0 || liveTokens.output > 0) && (
  <div className="flex items-center gap-1 text-[9px] font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
    <span className="text-sky-400/70" style={{ transition: 'color 0.3s' }}>
      {Math.round(liveTokens.input / 1000)}K↓
    </span>
    <span className="text-amber-400/70" style={{ transition: 'color 0.3s' }}>
      {Math.round(liveTokens.output / 1000)}K↑
    </span>
  </div>
)}
```

The `tabular-nums` font variant prevents digits from jumping around as numbers change. Sky for input (downloading context), amber for output (generating). Dims when not streaming via the conditional render.

---

## TASK 4: TodoWrite pretty renderer

**File:** `src/components/forge/AnorakPanel.tsx`
**Location:** Inside `ToolCallCard`, the expanded input section (lines 213-227)

**Current code has two special branches:**
```typescript
{name === 'Edit' && input?.old_string && input?.new_string ? (
  // ... diff view
) : name === 'Bash' && input?.command ? (
  // ... bash command view
) : (
  JSON.stringify(input, null, 2)  // ← everything else falls here
)}
```

**Add a TodoWrite branch BEFORE the fallback.** Replace the `else` block at lines 222-226:

```tsx
{name === 'Edit' && input?.old_string && input?.new_string ? (
  <>
    <div className="text-red-400/70 mb-1">- {String(input.old_string)}</div>
    <div className="text-green-400/70">+ {String(input.new_string)}</div>
  </>
) : name === 'Bash' && input?.command ? (
  <span className="text-amber-300">$ {String(input.command)}</span>
) : name === 'TodoWrite' && input?.todos ? (
  <div className="space-y-0.5">
    {(input.todos as Array<{ content: string; status: string }>).map((todo, i) => (
      <div key={i} className="flex items-start gap-1.5">
        <span className={
          todo.status === 'completed' ? 'text-green-400'
          : todo.status === 'in_progress' ? 'text-amber-400'
          : 'text-gray-600'
        }>
          {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}
        </span>
        <span className={
          todo.status === 'completed' ? 'text-green-400/70 line-through'
          : todo.status === 'in_progress' ? 'text-amber-300'
          : 'text-gray-400'
        }>
          {todo.content}
        </span>
      </div>
    ))}
  </div>
) : name === 'Grep' && input?.pattern ? (
  <span className="text-cyan-300">/{String(input.pattern)}/ <span className="text-gray-500">in {String(input.path || '.')}</span></span>
) : name === 'Glob' && input?.pattern ? (
  <span className="text-cyan-300">{String(input.pattern)}</span>
) : name === 'Read' && input?.file_path ? (
  <span className="text-blue-300">{String(input.file_path)}{input.offset ? ` :${input.offset}` : ''}{input.limit ? `-${Number(input.offset || 0) + Number(input.limit)}` : ''}</span>
) : name === 'Write' && input?.file_path ? (
  <>
    <div className="text-blue-300 mb-1">{String(input.file_path)}</div>
    {input.content && <div className="text-green-400/50 max-h-[100px] overflow-hidden">{String(input.content).substring(0, 500)}</div>}
  </>
) : name === 'Agent' && input?.prompt ? (
  <>
    {input.description && <div className="text-purple-300 mb-1">{String(input.description)}</div>}
    <div className="text-gray-400">{String(input.prompt).substring(0, 300)}{String(input.prompt).length > 300 ? '...' : ''}</div>
  </>
) : (
  JSON.stringify(input, null, 2)
)}
```

This adds pretty renderers for **TodoWrite, Grep, Glob, Read, Write, and Agent** — all the common tools. Each gets a purpose-built display instead of raw JSON.

---

## TASK 5: Fix tool call text truncation (oasisspec3 L85)

**File:** `src/components/forge/AnorakPanel.tsx`
**Location:** ToolCallCard header line — lines 196-201

**Current:** Tool display text is truncated with `max-w-[200px] truncate`:
```tsx
{isFileOp && filePath && (
  <span className="text-gray-400 truncate max-w-[200px]">...</span>
)}
{!isFileOp && (
  <span className="text-gray-500 truncate max-w-[200px]">...</span>
)}
```

**Change to:** Let text use available space, truncate with CSS `text-overflow: ellipsis` on one line only — no hard width cap:
```tsx
{isFileOp && filePath && (
  <span className="text-gray-400 truncate flex-1 min-w-0">{String(filePath).split(/[/\\]/).slice(-2).join('/')}</span>
)}
{!isFileOp && (
  <span className="text-gray-500 truncate flex-1 min-w-0">{display.replace(`${name}: `, '')}</span>
)}
```

The key change: `max-w-[200px]` → `flex-1 min-w-0`. This lets the text fill all available horizontal space in the flex row, truncating only when it hits the edge. `min-w-0` is required for truncation to work inside a flex child.

---

## TASK 6: Autoscroll with pause-on-scroll-up (oasisspec3 L121)

**File:** `src/components/forge/AnorakPanel.tsx`

### 6a. Add state + ref

Near the existing refs (around line 391-393):
```typescript
const scrollContainerRef = useRef<HTMLDivElement>(null)
const [autoScroll, setAutoScroll] = useState(true)
```

### 6b. Replace the current auto-scroll effect

**Current** (lines 468-471):
```typescript
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [turns])
```

**Replace with:**
```typescript
useEffect(() => {
  if (autoScroll) {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
}, [turns, autoScroll])
```

### 6c. Scroll handler on the stream container

The stream container div is at line 891. Add ref + onScroll:

**Current:**
```tsx
<div
  className="flex-1 overflow-y-auto px-3 py-2 space-y-4 min-h-0"
  style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
>
```

**Change to:**
```tsx
<div
  ref={scrollContainerRef}
  onScroll={() => {
    const el = scrollContainerRef.current
    if (!el) return
    // If user is within 80px of bottom, re-enable autoscroll
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAutoScroll(atBottom)
  }}
  className="flex-1 overflow-y-auto px-3 py-2 space-y-4 min-h-0 relative"
  style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
>
```

### 6d. Auto-scroll pill button

Right before the closing `</div>` of the stream container (before `{/* ═══ INPUT ═══ */}`), add:

```tsx
{/* Auto-scroll pill */}
{!autoScroll && isStreaming && (
  <button
    onClick={() => {
      setAutoScroll(true)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }}
    className="sticky bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-mono text-sky-400 cursor-pointer transition-all hover:scale-105 z-10"
    style={{
      background: 'rgba(8,10,15,0.9)',
      border: '1px solid rgba(56,189,248,0.4)',
      boxShadow: '0 2px 12px rgba(56,189,248,0.2)',
    }}
  >
    ↓ auto-scroll
  </button>
)}
```

---

## TASK 7: Upgrade "anorak is working" animation (oasisspec3 L22)

**File:** `src/components/forge/AnorakPanel.tsx`

### 7a. Replace the streaming indicator

**Current** (lines 1006-1011):
```tsx
{turn.isStreaming && (
  <div className="flex items-center gap-2 text-[10px] text-sky-400/60 font-mono py-1">
    <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
    anorak is working...
  </div>
)}
```

**Replace with:**
```tsx
{turn.isStreaming && (
  <div className="flex items-center gap-3 text-[10px] text-sky-400/60 font-mono py-2">
    <div className="flex items-center gap-[3px]">
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-sky-400"
          style={{
            animation: 'anorakWave 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.1}s`,
            height: '12px',
          }}
        />
      ))}
    </div>
    <span>anorak is working...</span>
  </div>
)}
```

### 7b. Add the wave keyframes

In the `<style>` block at the bottom (line 1080), add:

```css
@keyframes anorakWave {
  0%, 100% { transform: scaleY(0.4); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 1; }
}
```

This creates a 5-bar audio waveform effect that pulses in sequence.

---

## TASK 8: Markdown rendering for text blocks (oasisspec3 L28)

**File:** `src/components/forge/AnorakPanel.tsx`

No new dependencies. Use a lightweight inline renderer — regex-based, handles the common patterns Claude outputs.

### 8a. Add helper function

Place this after the `ToolCallCard` component (after line 249), before the `MODELS` constant:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// LIGHTWEIGHT MARKDOWN — no deps, handles Claude's common output patterns
// ═══════════════════════════════════════════════════════════════════════════

function renderMarkdownLine(line: string, idx: number): React.ReactNode {
  // Headers
  if (line.startsWith('### ')) return <div key={idx} className="text-sky-300 font-bold mt-2 mb-0.5">{line.slice(4)}</div>
  if (line.startsWith('## ')) return <div key={idx} className="text-sky-300 font-bold text-[13px] mt-2 mb-0.5">{line.slice(3)}</div>
  if (line.startsWith('# ')) return <div key={idx} className="text-sky-200 font-bold text-sm mt-3 mb-1">{line.slice(2)}</div>

  // Bullet points
  if (/^[-*] /.test(line)) return <div key={idx} className="pl-3">• {renderInline(line.slice(2))}</div>
  if (/^\d+\. /.test(line)) return <div key={idx} className="pl-3">{renderInline(line)}</div>

  // Horizontal rule
  if (/^---+$/.test(line.trim())) return <hr key={idx} className="border-white/10 my-2" />

  // Regular line
  return <div key={idx}>{renderInline(line)}</div>
}

function renderInline(text: string): React.ReactNode {
  // Split on code spans, bold, and italic — process in order
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Code span: `code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/)
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>)
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded text-sky-300" style={{ background: 'rgba(56,189,248,0.1)' }}>
          {codeMatch[2]}
        </code>
      )
      remaining = codeMatch[3]
      continue
    }
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/)
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>)
      parts.push(<strong key={key++} className="text-white font-semibold">{boldMatch[2]}</strong>)
      remaining = boldMatch[3]
      continue
    }
    // Nothing matched — emit rest as plain text
    parts.push(<span key={key++}>{remaining}</span>)
    break
  }

  return <>{parts}</>
}

function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n')
  const result: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code fences
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        // End code block
        result.push(
          <div key={`code-${i}`} className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
            {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
            <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
            </pre>
          </div>
        )
        inCodeBlock = false
        codeLines = []
        codeLang = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    result.push(renderMarkdownLine(line, i))
  }

  // Unclosed code block — render what we have
  if (inCodeBlock && codeLines.length > 0) {
    result.push(
      <div key="code-unclosed" className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
        {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
        <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
        </pre>
      </div>
    )
  }

  return <>{result}</>
}
```

### 8b. Use it in text block rendering

**Current** (lines 942-946):
```tsx
case 'text':
  return (
    <div key={block.id} className="text-[12px] text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">
      {block.content}
    </div>
  )
```

**Replace with:**
```tsx
case 'text':
  return (
    <div key={block.id} className="text-[12px] text-gray-300 leading-relaxed font-mono">
      {renderMarkdown(block.content)}
    </div>
  )
```

Note: remove `whitespace-pre-wrap` since the markdown renderer handles line breaks via `split('\n')`.

---

## TASK 9: Message queuing — type while Anorak works (oasisspec3 L90)

**File:** `src/components/forge/AnorakPanel.tsx`

### 9a. Add queued message state

Near line 296 (with other state):
```typescript
const [queuedMessage, setQueuedMessage] = useState<string | null>(null)
```

### 9b. Update the input area to allow typing during streaming

**Current** (line 1051): `disabled={isStreaming}`

**Change to:** Remove the `disabled` prop entirely. The textarea should always be typeable.

### 9c. Update the Enter/send handler

**Current** `onKeyDown` handler (lines 1036-1040) calls `invoke()` directly.

**Replace with:**
```tsx
onKeyDown={e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (isStreaming) {
      // Queue message for when current turn completes
      if (input.trim()) {
        setQueuedMessage(input.trim())
        setInput('')
      }
    } else {
      invoke()
    }
  }
}}
```

Also update the send button `onClick`:
```tsx
onClick={isStreaming ? (input.trim() ? () => { setQueuedMessage(input.trim()); setInput('') } : cancel) : invoke}
```

### 9d. Show queued indicator

Add after the input textarea, before the send button:
```tsx
{queuedMessage && (
  <div className="absolute -top-6 left-3 right-3 flex items-center justify-between text-[9px] font-mono text-amber-400/70">
    <span>⏳ queued: &quot;{queuedMessage.substring(0, 40)}{queuedMessage.length > 40 ? '...' : ''}&quot;</span>
    <button onClick={() => setQueuedMessage(null)} className="text-gray-500 hover:text-red-400 cursor-pointer">✕</button>
  </div>
)}
```

Make the input container `relative` for this to position correctly.

### 9e. Auto-send queued message when turn completes

Add a `useEffect` after the existing effects:
```typescript
useEffect(() => {
  if (!isStreaming && queuedMessage) {
    setInput(queuedMessage)
    setQueuedMessage(null)
    // Small delay to let state settle, then invoke
    setTimeout(() => {
      // Trigger invoke by setting input and calling it
      // We need to call invoke after input is set
    }, 100)
  }
}, [isStreaming, queuedMessage])
```

Actually, cleaner approach — modify the `finally` block in `invoke()` (around line 674). After `setIsStreaming(false)`:
```typescript
// Auto-send queued message
const queued = queuedMessage
if (queued) {
  setQueuedMessage(null)
  // Use setTimeout to allow state to settle after this turn completes
  setTimeout(() => {
    setInput(queued)
    // We need a ref to track this — or just trigger invoke directly
  }, 200)
}
```

**Better approach** — use a ref:
```typescript
const queuedRef = useRef<string | null>(null)
```
Keep `queuedRef.current` in sync with `queuedMessage` state. In the `finally` block:
```typescript
if (queuedRef.current) {
  const next = queuedRef.current
  queuedRef.current = null
  setQueuedMessage(null)
  // Re-invoke with the queued prompt
  setTimeout(() => {
    setInput('')  // Clear in case it was set
    // Directly construct and fire the next turn
    // ... invoke logic with `next` as the prompt
  }, 300)
}
```

The cleanest path: extract the core of `invoke()` to accept a prompt parameter rather than reading from `input` state. Then call it from the queue handler.

Refactor `invoke` signature to:
```typescript
const invoke = useCallback(async (overridePrompt?: string) => {
  const userPrompt = (overridePrompt || input).trim()
  if (!userPrompt || isStreaming) return
  if (!overridePrompt) setInput('')
  // ... rest unchanged, uses userPrompt
```

Then in the `finally` block:
```typescript
if (queuedRef.current) {
  const next = queuedRef.current
  queuedRef.current = null
  setQueuedMessage(null)
  setTimeout(() => invoke(next), 300)
}
```

---

## Summary — execution order

| # | Task | Effort | Files |
|---|------|--------|-------|
| 1 | stderr forwarding | 1 line | route.ts |
| 2 | progress events | 5 lines | route.ts |
| 3 | live token counter | 15 lines | AnorakPanel.tsx |
| 4 | TodoWrite + tool renderers | 40 lines | AnorakPanel.tsx |
| 5 | truncation fix | 2 lines | AnorakPanel.tsx |
| 6 | autoscroll with pause | 25 lines | AnorakPanel.tsx |
| 7 | working animation | 15 lines | AnorakPanel.tsx |
| 8 | markdown renderer | 90 lines | AnorakPanel.tsx |
| 9 | message queuing | 30 lines | AnorakPanel.tsx |

Tasks 1-2 are backend (route.ts). Tasks 3-9 are frontend (AnorakPanel.tsx).
Do route.ts first, then AnorakPanel.tsx top-to-bottom.

After all changes: `pnpm build` to verify. No new deps needed.

---

```
░▒▓█ CARBON TESTS █▓▒░

▶ TEST 1: stderr visibility (30s)
  Do: Open Anorak, send any prompt. Watch for gray italic status messages
      appearing that weren't there before (rate limit info, verbose output).
  Expected: Gray status lines from stderr appear in the stream.

▶ TEST 2: live token counter (30s)
  Do: Open Anorak, send a prompt. Watch the header bar during streaming.
  Expected: "12K↓ 1K↑" style counter appears next to cost, updates live,
            disappears when streaming ends.

▶ TEST 3: TodoWrite rendering (60s)
  Do: Send Anorak a task that uses TodoWrite (e.g., "plan the implementation
      of X, break it into tasks"). Click to expand the TodoWrite tool card.
  Expected: Pretty checklist with ✓ (green, strikethrough), ◉ (amber), ○ (gray)
            instead of raw JSON.

▶ TEST 4: tool text not truncated (15s)
  Do: Observe any Grep/Glob/Read tool cards in the stream.
  Expected: Display text fills available width, no premature "..." cutoff.
            Only truncates at panel edge.

▶ TEST 5: autoscroll pause (30s)
  Do: While Anorak streams, scroll UP in the output.
  Expected: Scrolling stops following output. "↓ auto-scroll" pill appears
            at bottom. Click it → jumps back to bottom and resumes following.

▶ TEST 6: working animation (15s)
  Do: Send a prompt, watch "anorak is working..." indicator.
  Expected: 5-bar waveform animation instead of single pulsing dot.

▶ TEST 7: markdown in text output (30s)
  Do: Ask Anorak something that produces markdown (e.g., "explain the
      architecture of this project with code examples").
  Expected: Headers styled, `code spans` highlighted, **bold** rendered,
            code fences get dark background with language label, bullet points
            indented with •.

▶ TEST 8: type while working (30s)
  Do: Send a prompt. While streaming, type a new message and hit Enter.
  Expected: "⏳ queued:" indicator appears above input. When first turn
            completes, queued message auto-sends as next turn.
```

ॐ ship this whole thing in one pass ॐ
