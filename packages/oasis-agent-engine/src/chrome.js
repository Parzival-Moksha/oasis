// Claude in Chrome for an agent (roster `chrome: true`, off by default, switched on per agent by the owner).
//
// Verified with Claude Code 2.1.318 on Windows (2026-11-11): `claude -p --input-format stream-json
// --chrome` gets the 22 mcp__claude-in-chrome__* tools headless, its server reports "connected" and it
// reaches the owner's Chrome through the extension (list_connected_browsers: 1 local browser). The
// engine's cleanEnv strips nothing it needs.
//
// Permissions: an agent the owner switched Chrome on for drives Chrome like his other sessions do, under the
// session's own permission mode (decisions.md, 2026-11-19). Until then Chrome agents loaded a settings file with
// an "ask" rule for the whole server; an ask rule beats every allow, so each click came as a decision card and
// "Allow always" never stuck ("allow fatigue", Shipwright every 20 s). No forced ask now: the switch is the consent.

export const CHROME_SERVER = 'claude-in-chrome';

/** Spawn args for an agent with Chrome on. */
export function chromeArgs() {
  return ['--chrome'];
}
