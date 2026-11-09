import { describe, expect, it } from 'vitest'
import { hasInjectedText, parseInjectedUserText } from '../village/village-injected'

const notification = (summary: string, status = 'completed', result = 'All three pieces are **built**.') => [
  '<task-notification>',
  '<task-id>af87572c7677e6c2c</task-id>',
  '<tool-use-id>toolu_01V4NZPuxsFyzGocYyc5TeyH</tool-use-id>',
  '<output-file>C:\\Users\\l\\AppData\\Local\\Temp\\tasks\\af87572c7677e6c2c.output</output-file>',
  `<status>${status}</status>`,
  `<summary>${summary}</summary>`,
  '<note>A task-notification fires each time this agent stops.</note>',
  `<result>${result}</result>`,
  '</task-notification>',
].join('\n')

describe('parseInjectedUserText', () => {
  it('turns a finished subagent into a pill with its result and no tags', () => {
    const parsed = parseInjectedUserText(notification('Agent "Build home worlds" finished'))
    expect(parsed.text).toBe('')
    expect(parsed.reminders).toEqual([])
    expect(parsed.tasks).toEqual([{
      taskId: 'af87572c7677e6c2c',
      status: 'completed',
      label: 'Subagent finished: Build home worlds',
      body: 'All three pieces are **built**.',
      failed: false,
    }])
  })

  it('says failed when the task failed', () => {
    const [task] = parseInjectedUserText(notification('Agent "Sky maker" failed', 'failed', '')).tasks
    expect(task).toMatchObject({ label: 'Subagent failed: Sky maker', failed: true, body: 'Agent "Sky maker" failed' })
  })

  it('names background commands, and falls back to the summary for anything else', () => {
    const cmd = parseInjectedUserText(notification('Background command "Run a test agent engine on port 4535" completed (exit code 0)', 'completed', '')).tasks[0]
    expect(cmd.label).toBe('Background command finished: Run a test agent engine on port 4535')
    const other = parseInjectedUserText(notification('Monitor stopped', 'killed', '')).tasks[0]
    expect(other).toMatchObject({ label: 'Task failed: Monitor stopped', failed: true })
  })

  it('keeps what the owner wrote and folds system reminders away', () => {
    const raw = 'Please fix the panel.\n<system-reminder>\nThe user opened file X.\n</system-reminder>\nThanks!'
    const parsed = parseInjectedUserText(raw)
    expect(parsed.text).toBe('Please fix the panel.\n\nThanks!')
    expect(parsed.reminders).toEqual(['The user opened file X.'])
    expect(parsed.tasks).toEqual([])
  })

  it('handles several notifications, text after them, and a block clipped at the end', () => {
    const raw = `${notification('Agent "A" finished')}\n${notification('Agent "B" finished')}\nRead the output file.\n<task-notification>\n<status>completed</status>\n<summary>Agent "C" fini`
    const parsed = parseInjectedUserText(raw)
    expect(parsed.tasks.map(t => t.label)).toEqual(['Subagent finished: A', 'Subagent finished: B', 'Subagent finished: C'])
    expect(parsed.text).toBe('Read the output file.')
  })

  it('leaves plain prompts alone', () => {
    expect(hasInjectedText('just a prompt with <b>html</b>')).toBe(false)
    expect(parseInjectedUserText('just a prompt')).toEqual({ text: 'just a prompt', tasks: [], reminders: [] })
    expect(hasInjectedText('x <system-reminder>y</system-reminder>')).toBe(true)
  })
})
