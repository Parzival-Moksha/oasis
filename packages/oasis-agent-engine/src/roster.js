// Roster persistence: data/agent-engine.local.json = [{id, name, cwd, sessionId, model, permissionMode, effort}]
import fs from 'node:fs';
import path from 'node:path';

export function loadRoster(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data.agents) ? data.agents : [];
  } catch {
    return [];
  }
}

let timer = null;
export function saveRoster(file, entries) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), agents: entries }, null, 2));
    fs.renameSync(tmp, file);
  }, 150);
}

export function saveRosterNow(file, entries) {
  clearTimeout(timer);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), agents: entries }, null, 2));
}
