// ░▒▓ CLI ARGS — what a request may put on an agent CLI's command line ▓▒░
// /api/claude-code and /api/codex start the Claude Code / Codex CLIs with the request's model, session and (Codex)
// image paths. They ran through a shell (shell: true, for the npm .cmd shims), so a value with quotes, &, |, ; or
// backticks could run a command of its own (Shipwright, 2026-11-19). These routes answer localhost only, but any
// page open in the owner's browser can reach localhost. Now the CLIs start without a shell (claude-bin.ts resolves
// the shim to the real program) and every value is checked here first: a model id, a session uuid, an image file.
// Pure, so the checks are tested (src/lib/__tests__/cli-args.test.ts).

import fs from 'fs'

/** A model id or alias: "opus", "claude-opus-5-5", "claude-opus-4-6[1m]", "gpt-5.1-codex", "openai/gpt-5". */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/
/** A session id: a uuid (Claude Code and Codex both use them). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Characters a shell (cmd.exe or sh) gives a meaning, plus quotes and control characters. */
const SHELL_SPECIAL = /[&|;`$<>^%!"'\r\n\t\0*?()]/

export class CliArgError extends Error {
  readonly status = 400
}

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value)
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

/** The model to pass, or the fallback when none was sent. Throws CliArgError for anything that isn't a model id. */
export function checkModel(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  const model = typeof value === 'string' ? value.trim() : value
  if (!isModelId(model)) throw new CliArgError('model must be a model id (letters, digits, . _ - : / [ ])')
  return model
}

/** The session to resume, or undefined for a new one. Throws CliArgError for anything that isn't a uuid. */
export function checkSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const id = typeof value === 'string' ? value.trim() : value
  if (!isSessionId(id)) throw new CliArgError('sessionId must be a session uuid')
  return id
}

/**
 * An image path to hand a CLI: an existing file, not an option (no leading "-"), and nothing a shell would read
 * (so it stays safe even on the last-resort shell fallback).
 */
export function checkImagePath(value: unknown, exists: (p: string) => boolean = p => { try { return fs.statSync(p).isFile() } catch { return false } }): string {
  if (typeof value !== 'string' || !value.trim()) throw new CliArgError('image must be a file path')
  const p = value.trim()
  if (p.startsWith('-') || SHELL_SPECIAL.test(p)) throw new CliArgError('image path has characters that are not allowed')
  if (!exists(p)) throw new CliArgError(`image not found: ${p}`)
  return p
}
