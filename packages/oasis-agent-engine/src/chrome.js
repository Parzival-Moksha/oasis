// Claude in Chrome for an agent (roster `chrome: true`, off by default).
//
// Verified with Claude Code 2.1.318 on Windows (2026-11-11): `claude -p --input-format stream-json
// --chrome` gets the 22 mcp__claude-in-chrome__* tools headless, its server reports "connected" and it
// reaches the owner's Chrome through the extension (list_connected_browsers: 1 local browser). The
// engine's cleanEnv strips nothing it needs.
// The owner's settings run in auto mode, which approved Chrome calls without asking. An agent driving
// the owner's real browser (logged-in accounts) should ask, so Chrome agents also load a settings file
// with an "ask" rule for the whole server: every Chrome call comes to the Oasis as a decision card.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const CHROME_SERVER = 'claude-in-chrome';
export const CHROME_ASK_SETTINGS = { permissions: { ask: [`mcp__${CHROME_SERVER}`] } };

let file = null;
/** A file, not inline JSON (the cmd.exe fallback spawn mangles quotes); named after its content. */
export function chromeAskSettingsFile() {
  if (file && fs.existsSync(file)) return file;
  const json = JSON.stringify(CHROME_ASK_SETTINGS, null, 2);
  file = path.join(os.tmpdir(), `oasis-agent-engine-chrome-ask-${createHash('sha1').update(json).digest('hex').slice(0, 8)}.json`);
  fs.writeFileSync(file, json);
  return file;
}

/** Spawn args for an agent with Chrome on. */
export function chromeArgs() {
  return ['--chrome', '--settings', chromeAskSettingsFile()];
}
