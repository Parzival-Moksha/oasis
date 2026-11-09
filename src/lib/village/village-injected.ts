// ░▒▓ INJECTED USER TEXT — what Claude Code adds to the "user" side that the owner never typed ▓▒░
// A background subagent or command that finishes arrives as a user message starting with <task-notification>
// (task-id, status, summary, note, result). Hooks and the harness add <system-reminder> blocks to prompts.
// Shown raw they read as a strange XML "prompt": the thread turns them into quiet pills instead. Pure, so it is tested.

export interface TaskNotice {
  taskId: string | null
  status: string | null
  /** The pill's line, e.g. "Subagent finished: Build home worlds". */
  label: string
  /** What the task reported (its <result>, else the summary), for the opened pill. */
  body: string
  failed: boolean
}

export interface InjectedUserText {
  /** What the owner (or the agent's caller) actually wrote, with the injected blocks taken out. */
  text: string
  tasks: TaskNotice[]
  reminders: string[]
}

/** The text between <tag> and </tag>; an unclosed tag (clipped message) runs to the end. */
function tagValue(block: string, tag: string): string | null {
  const open = block.indexOf(`<${tag}>`)
  if (open === -1) return null
  const start = open + tag.length + 2
  const close = block.indexOf(`</${tag}>`, start)
  return (close === -1 ? block.slice(start) : block.slice(start, close)).trim()
}

/** Pull every <tag>…</tag> block out of the text. Unclosed blocks (a clipped message) run to the end. */
function extractBlocks(text: string, tag: string): { rest: string; blocks: string[] } {
  const blocks: string[] = []
  let rest = ''
  let i = 0
  const open = `<${tag}>`
  const close = `</${tag}>`
  for (;;) {
    const start = text.indexOf(open, i)
    if (start === -1) {
      rest += text.slice(i)
      break
    }
    rest += text.slice(i, start)
    const end = text.indexOf(close, start + open.length)
    if (end === -1) {
      blocks.push(text.slice(start + open.length))
      break
    }
    blocks.push(text.slice(start + open.length, end))
    i = end + close.length
  }
  return { rest, blocks }
}

const FAILED = /^(failed|error|killed|cancelled|canceled|stopped|timeout|timed[_ -]?out)$/i

function taskLabel(summary: string, status: string | null): { label: string; failed: boolean } {
  const failed = Boolean(status && FAILED.test(status)) || /\b(failed|errored|was killed)\b/i.test(summary)
  const verb = failed ? 'failed' : status && !/^(completed|done|finished|success)$/i.test(status) ? status : 'finished'
  const agent = summary.match(/^Agent "(.+)"/)
  if (agent) return { label: `Subagent ${verb}: ${agent[1]}`, failed }
  const command = summary.match(/^Background command "(.+)"/)
  if (command) return { label: `Background command ${verb}: ${command[1]}`, failed }
  return { label: summary ? `Task ${verb}: ${summary}` : `Background task ${verb}`, failed }
}

export function parseInjectedUserText(raw: string): InjectedUserText {
  const notices = extractBlocks(raw, 'task-notification')
  const reminders = extractBlocks(notices.rest, 'system-reminder')
  const tasks = notices.blocks.map((block): TaskNotice => {
    const status = tagValue(block, 'status')
    const summary = (tagValue(block, 'summary') || '').replace(/\s+/g, ' ')
    const result = tagValue(block, 'result')
    return { taskId: tagValue(block, 'task-id'), status, ...taskLabel(summary, status), body: result || summary }
  })
  return {
    text: reminders.rest.trim(),
    tasks,
    reminders: reminders.blocks.map(block => block.trim()).filter(Boolean),
  }
}

/** Quick check before parsing: most prompts carry nothing injected. */
export function hasInjectedText(raw: string): boolean {
  return raw.includes('<task-notification>') || raw.includes('<system-reminder>')
}
