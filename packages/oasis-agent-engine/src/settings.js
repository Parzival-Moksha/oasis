// Where this machine keeps things: one small file, data/oasis-settings.local.json (not in git), read by the
// engine and by the page server (src/lib/oasis-settings.ts reads the same file). An environment variable wins
// over the file; with neither, the place is unset and the feature that needs it says less or stays off.
//
//   key            environment            what
//   missionsDir    OASIS_MISSIONS_DIR     the mission board's folder (default: data/missions in the Oasis folder)
//   grillFile      OASIS_GRILL_FILE       the owner's list of open questions (a script writes it from questionsDir)
//   questionsDir   OASIS_QUESTIONS_DIR    where agents put questions for the owner that can wait: one file each (its README.md)
//   academyDir     OASIS_ACADEMY_DIR      the Academy's skill tree
//   anorakProCwd   OASIS_ANORAK_PRO_CWD   the lead agent's home folder, offered in the session picker
//   scribeEnv      OASIS_SCRIBE_ENV       a .env file holding ELEVENLABS_API_KEY (the Oasis's own .env is read first)
//   tylerDir       OASIS_TYLER_DIR        a folder with a ready voice-typing helper (Tyler/ears/.venv)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SETTINGS_FILE = process.env.OASIS_SETTINGS_FILE || path.join(ROOT, 'data', 'oasis-settings.local.json');
const ENV = {
  missionsDir: 'OASIS_MISSIONS_DIR',
  grillFile: 'OASIS_GRILL_FILE',
  questionsDir: 'OASIS_QUESTIONS_DIR',
  academyDir: 'OASIS_ACADEMY_DIR',
  anorakProCwd: 'OASIS_ANORAK_PRO_CWD',
  scribeEnv: 'OASIS_SCRIBE_ENV',
  tylerDir: 'OASIS_TYLER_DIR',
};

let cache = { mtime: -1, value: {} };
function fileSettings(file = SETTINGS_FILE) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime !== cache.mtime) cache = { mtime, value: JSON.parse(fs.readFileSync(file, 'utf8')) || {} };
    return cache.value;
  } catch {
    return {};
  }
}

/** One place, or '' when this machine has none. */
export function setting(key, { env = process.env, file = SETTINGS_FILE } = {}) {
  const fromEnv = ENV[key] && env[ENV[key]];
  if (fromEnv) return String(fromEnv).trim();
  const value = fileSettings(file)[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** KEY=value out of a .env file's text. */
export function envValue(text, key) {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(text || '');
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** A key from the Oasis's own .env (the engine is started without it being loaded). */
export function ownEnvValue(key, root = ROOT) {
  for (const name of ['.env.local', '.env']) {
    try {
      const value = envValue(fs.readFileSync(path.join(root, name), 'utf8'), key);
      if (value) return value;
    } catch { /* no such file */ }
  }
  return '';
}

/** Writes one value into this machine's settings file (the file is made when it is not there). */
export function saveSetting(key, value, file = SETTINGS_FILE) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* a new file */ }
  all[key] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}
`);
  cache = { mtime: -1, value: {} };
}
