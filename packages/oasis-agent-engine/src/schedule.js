// Schedules: agents that wake up on their own (the owner, 2026-11-16 and 2026-11-18: "I cannot set you proactive,
// but I want to"; a Council set for 16:20 never happened because nothing spoke to Anorak then).
//
// Per agent, kept in the roster:
//   schedule      { every: off | hourly | 3h | 6h | daily | weekly, at: "HH:MM", day: 0-6 (weekly, 0 = Sunday),
//                   prompt: its own standing prompt (null: DEFAULT_PROMPT), since: when it was set }
//   appointments  [{ id, at (ms), repeat: null | daily | weekly, note, prompt, by }]   one-off or repeating
//   wake          { lastAt, day, count }   when it last woke on its schedule, and how often today
// For all agents (Settings > Agents, the schedule settings file next to the roster):
//   quiet hours (default 01:00 to 08:00) and a daily cap (default 8): both for the recurring wake-ups only. An
//   appointment was asked for at its time, so it fires then (the Council at 16:20 must not lose to a cap spent on
//   hourly wake-ups); it counts in the day's number all the same.
//
// The rules:
// - A slot or an appointment that is due wakes the agent when it is idle (no turn, no queued message, no open
//   decision). Busy: it waits for the turn to end. Never more than one scheduled turn queued per agent: everything
//   due at once goes out as one message.
// - Missed slots collapse: the engine was off, or the agent busy for hours: it wakes once, not once per slot.
//   A recurring slot in quiet hours is skipped; one that was missed fires after the quiet hours end.
// - An appointment missed by more than a day (and not repeating) is dropped with a notice: a week-old "Council at
//   16:20" is not news. A repeating one fires once and moves to its next time.
// The message says it comes from the schedule, not from the owner ([Oasis schedule: …], hidden in the thread, which
// shows a "scheduled" tag instead), and the turn it starts is marked so the page does not treat it as the owner's.
// Pure helpers and the Scheduler (with an injectable clock) are unit-tested (src/lib/__tests__/agent-engine-schedule.test.ts).
import { setting } from './settings.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const EVERY = ['off', 'hourly', '3h', '6h', 'daily', 'weekly'];
const INTERVAL_HOURS = { hourly: 1, '3h': 3, '6h': 6 };
export const REPEATS = ['daily', 'weekly'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_SETTINGS = { quiet: { from: '01:00', to: '08:00' }, dailyCap: 8 };
/** The owner's words (2026-11-18), the standing prompt of an agent that has none of its own. */
export const DEFAULT_PROMPT = 'You woke up on your schedule. The owner may be away. Look at what is yours to do (your missions, your open items, messages waiting), do what needs no decision from him, write what you did in your thread in three lines, and ' + (setting('questionsDir') ? `write each question for him as a file in ${setting('questionsDir').replace(/\\/g, '/')} (its README.md says how).` : setting('grillFile') ? `add questions for him to ${setting('grillFile')}.` : 'put questions for him at the end of that.') + ' If something truly needs him now, tell him on Telegram, once.';
export const PROMPT_MAX = 2000;
const STALE_APPOINTMENT_MS = 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

const pad = (n) => String(n).padStart(2, '0');

/** "9:5" -> "09:05"; null when it is not a time of day. */
export function parseClock(value) {
  const m = String(value ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
const clockMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** A schedule as it may be stored, whatever came in. null: off. */
export function normalizeSchedule(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || !EVERY.includes(input.every) || input.every === 'off') {
    // Off keeps its own prompt, so switching back on does not lose it.
    const prompt = typeof input?.prompt === 'string' && input.prompt.trim() ? input.prompt.trim().slice(0, PROMPT_MAX) : null;
    return prompt ? { every: 'off', prompt } : null;
  }
  const every = input.every;
  const at = parseClock(input.at) || (INTERVAL_HOURS[every] ? '00:00' : '09:00');
  const day = every === 'weekly' ? (Number.isInteger(input.day) && input.day >= 0 && input.day <= 6 ? input.day : 1) : undefined;
  const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.trim().slice(0, PROMPT_MAX) : null;
  const since = typeof input.since === 'number' && Number.isFinite(input.since) ? input.since : now;
  return { every, at, ...(day !== undefined ? { day } : {}), prompt, since };
}

export function normalizeSettings(input) {
  const quiet = input?.quiet === null ? null : {
    from: parseClock(input?.quiet?.from) || DEFAULT_SETTINGS.quiet.from,
    to: parseClock(input?.quiet?.to) || DEFAULT_SETTINGS.quiet.to,
  };
  const cap = Number(input?.dailyCap);
  return { quiet, dailyCap: Number.isInteger(cap) && cap >= 0 && cap <= 200 ? cap : DEFAULT_SETTINGS.dailyCap };
}

/** Inside the quiet hours (from inclusive, to exclusive; a window may wrap past midnight). */
export function isQuiet(ms, quiet) {
  if (!quiet) return false;
  const m = new Date(ms).getHours() * 60 + new Date(ms).getMinutes();
  const from = clockMinutes(quiet.from);
  const to = clockMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** When the quiet hours that hold `ms` end (ms itself when it is not quiet). */
export function quietEnd(ms, quiet) {
  if (!isQuiet(ms, quiet)) return ms;
  const d = new Date(ms);
  const [h, m] = quiet.to.split(':').map(Number);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  return end > ms ? end : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m).getTime();
}

/** The schedule's slots on one local day (y, mo, d), in ms, ascending. */
function slotsOn(schedule, y, mo, d) {
  const [h, m] = schedule.at.split(':').map(Number);
  const hours = INTERVAL_HOURS[schedule.every];
  if (hours) {
    const step = hours * 60;
    const first = (h * 60 + m) % step;
    const out = [];
    for (let min = first; min < 1440; min += step) out.push(new Date(y, mo, d, 0, min).getTime());
    return out;
  }
  if (schedule.every === 'daily') return [new Date(y, mo, d, h, m).getTime()];
  if (schedule.every === 'weekly' && new Date(y, mo, d).getDay() === schedule.day) return [new Date(y, mo, d, h, m).getTime()];
  return [];
}

/** Slots in (from, to], ascending; at most `limit`. */
export function slotsBetween(schedule, from, to, limit = 1000) {
  if (!schedule || schedule.every === 'off' || !(to > from)) return [];
  const out = [];
  const start = new Date(from);
  for (let i = 0; ; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (day.getTime() > to) break;
    for (const s of slotsOn(schedule, day.getFullYear(), day.getMonth(), day.getDate())) {
      if (s > from && s <= to) { out.push(s); if (out.length >= limit) return out; }
    }
    if (i > 400) break; // a year and more: enough
  }
  return out;
}

/** The first slot after `after` outside the quiet hours; null when there is none within two weeks. */
export function nextSlot(schedule, after, quiet) {
  for (const s of slotsBetween(schedule, after, after + 14 * DAY_MS, 400)) if (!isQuiet(s, quiet)) return s;
  return null;
}

/** "hourly", "every 3 hours from 01:30", "daily at 09:00", "weekly on Wednesday at 16:20". */
export function describeSchedule(schedule) {
  if (!schedule || schedule.every === 'off') return 'off';
  if (schedule.every === 'hourly') return schedule.at.endsWith(':00') ? 'hourly' : `hourly at :${schedule.at.slice(3)}`;
  if (INTERVAL_HOURS[schedule.every]) return `every ${INTERVAL_HOURS[schedule.every]} hours${schedule.at !== '00:00' ? ` from ${schedule.at}` : ''}`;
  if (schedule.every === 'daily') return `daily at ${schedule.at}`;
  return `weekly on ${DAYS[schedule.day]} at ${schedule.at}`;
}

/**
 * A time from a person or an agent -> ms, or null.
 *   1794850000000 (ms) · an ISO string · "2026-11-25 16:20" · "16:20" (the next one) · "wed 16:20" (the next Wednesday)
 *   "tomorrow 9:00" · "in 30m" / "in 2h"
 */
export function parseWhen(value, now = Date.now()) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  let m = text.match(/^in\s+(\d+)\s*(m|min|mins|minutes?|h|hours?)$/);
  if (m) return now + Number(m[1]) * (m[2].startsWith('h') ? 3600_000 : 60_000);
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  m = text.match(/^(?:(today|tomorrow|sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(?:at\s+)?(\d{1,2}(?::\d{2})?)$/);
  if (m) {
    const clock = parseClock(m[2]);
    if (!clock) return null;
    const [h, min] = clock.split(':').map(Number);
    const base = new Date(now);
    const day = m[1];
    if (day === 'today' || day === 'tomorrow') {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + (day === 'tomorrow' ? 1 : 0), h, min).getTime();
    }
    if (day) {
      const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day.slice(0, 3));
      for (let i = 0; i <= 7; i++) {
        const t = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, min);
        if (t.getDay() === want && t.getTime() > now) return t.getTime();
      }
      return null;
    }
    const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min).getTime();
    return today > now ? today : new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, h, min).getTime();
  }
  const iso = Date.parse(value);
  return Number.isFinite(iso) ? iso : null;
}

/** An appointment's next time after `now` (a repeating one), or null (a one-off is done). */
export function nextRepeat(appointment, now) {
  if (!REPEATS.includes(appointment.repeat)) return null;
  const step = appointment.repeat === 'daily' ? 1 : 7;
  const d = new Date(appointment.at);
  for (let k = 1; k < 5000; k++) {
    // Calendar days, so a repeating 16:20 stays 16:20 across a clock change.
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k * step, d.getHours(), d.getMinutes()).getTime();
    if (t > now) return t;
  }
  return null;
}

export function normalizeAppointment(input, now = Date.now()) {
  const at = parseWhen(input?.at, now);
  if (at === null) throw new Error('at: a time like "16:20", "wed 16:20", "2026-11-25 16:20", "in 30m" or an ISO time');
  const repeat = REPEATS.includes(input?.repeat) ? input.repeat : null;
  const note = typeof input?.note === 'string' ? input.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const prompt = typeof input?.prompt === 'string' && input.prompt.trim() ? input.prompt.trim().slice(0, PROMPT_MAX) : null;
  if (!note && !prompt) throw new Error('say what it is for: note (a few words) or prompt (what the agent is told)');
  const by = typeof input?.by === 'string' ? input.by.slice(0, 80) : null;
  return { id: typeof input?.id === 'string' && /^[a-z0-9-]{4,40}$/i.test(input.id) ? input.id : `appt-${randomUUID().slice(0, 8)}`, at, repeat, note, prompt, by, createdAt: now };
}

/**
 * What wakes this agent next: its next recurring slot (outside the quiet hours) or its next appointment, whichever
 * is first. -> { at, label } or null.
 */
export function nextWake({ schedule, appointments = [], wake = {} }, settings, now) {
  const options = [];
  if (schedule && schedule.every !== 'off') {
    const after = Math.max(now, wake.lastAt || 0, schedule.since || 0);
    const s = nextSlot(schedule, after, settings.quiet);
    if (s !== null) options.push({ at: s, label: describeSchedule(schedule) });
  }
  for (const a of appointments) options.push({ at: a.at, label: appointmentLabel(a) });
  options.sort((x, y) => x.at - y.at);
  return options[0] || null;
}

export function appointmentLabel(a) {
  const when = REPEATS.includes(a.repeat) ? `${a.repeat === 'weekly' ? `weekly, ${DAYS[new Date(a.at).getDay()]}` : 'daily'} ${hhmm(a.at)}` : `${localDate(a.at)} ${hhmm(a.at)}`;
  return `appointment${a.note ? `: ${a.note}` : ''} (${when})`;
}

/**
 * What is due for one agent at `now`. -> { recurring: slot ms | null, appointments: [due ones], stale: [dropped ones] }.
 * A recurring slot counts when it lies after the last wake (or the time the schedule was set), is outside the quiet
 * hours, and the quiet hours are not on now.
 */
export function dueFor({ schedule, appointments = [], wake = {} }, settings, now) {
  let recurring = null;
  if (schedule && schedule.every !== 'off' && !isQuiet(now, settings.quiet)) {
    const from = Math.max(wake.lastAt || 0, schedule.since || 0);
    // The latest slot that was not in quiet hours: missed ones collapse into one wake.
    const slots = slotsBetween(schedule, from, now).filter((s) => !isQuiet(s, settings.quiet));
    if (slots.length) recurring = slots[slots.length - 1];
  }
  const due = [];
  const stale = [];
  for (const a of appointments) {
    if (a.at > now) continue;
    if (!REPEATS.includes(a.repeat) && now - a.at > STALE_APPOINTMENT_MS) stale.push(a);
    else due.push(a);
  }
  return { recurring, appointments: due, stale };
}

/** The message a wake-up sends: [{note, text}] -> what the agent reads. `tell`: the path of scripts/tell.mjs. */
export function wakeMessage({ schedule, recurring, appointments }, now, { tell = '' } = {}) {
  const parts = [];
  const labels = [];
  for (const a of appointments) {
    labels.push(appointmentLabel(a));
    parts.push(a.prompt || `It is time for your appointment: ${a.note}.${a.by ? ` (Set by ${a.by}.)` : ''}`);
  }
  if (recurring !== null && recurring !== undefined) {
    labels.push(`${describeSchedule(schedule)} wake-up`);
    // With an appointment at the same time, the appointment says what to do; the standing prompt only joins alone.
    if (!appointments.length) parts.push(schedule.prompt || DEFAULT_PROMPT);
  }
  const due = [...appointments.map((a) => a.at), ...(recurring !== null && recurring !== undefined ? [recurring] : [])];
  const dueAt = due.length ? Math.min(...due) : now;
  const late = now - dueAt > 10 * 60_000 ? `, due ${localDate(dueAt) === localDate(now) ? hhmm(dueAt) : `${localDate(dueAt)} ${hhmm(dueAt)}`} (sent ${hhmm(now)}: the engine was off or you were busy)` : `, ${hhmm(now)}`;
  const label = labels.join(' + ');
  const how = tell ? ` To tell the owner on Telegram: node "${tell}" "<a few lines>".` : '';
  const note = `[Oasis schedule: ${label}${late}. This message comes from your schedule, not from the owner.${how}]`.replace(/\](?=.)/g, ')');
  return { note, text: parts.join('\n\n'), label };
}

/** A note block that is the schedule's: its label, else null. */
export const SCHEDULE_NOTE = /^\[Oasis schedule: ([^\]]*)\]$/;

// ------------------------------------------------------------------ the scheduler
/**
 * One per engine. Every TICK_MS (and when an agent turns idle) it looks at each owned agent's schedule and
 * appointments and wakes the ones that are due and idle.
 */
export class Scheduler {
  /**
   * @param {{ agents: () => Iterable<any>, now?: () => number, settingsFile?: string|null, log?: (...a: any[]) => void,
   *   tell?: string, onChange?: (agent: any) => void, tickMs?: number }} o
   *   agents: the owned agents (agent.js): each has schedule, appointments, wake, isIdle(), wakeUp(), persist(), emit().
   */
  constructor(o) {
    this.agentsOf = o.agents;
    this.now = o.now || Date.now;
    this.settingsFile = o.settingsFile || null;
    this.log = o.log || (() => {});
    this.tell = o.tell || '';
    this.onChange = o.onChange || (() => {});
    this.tickMs = o.tickMs ?? 15_000;
    this.settings = normalizeSettings(this.readSettings());
    this.timer = null;
    this.paused = true; // until start(): the engine first brings everyone back (resume notes go first)
    /** True while no wake-up may go out (every Claude account is out of usage): due ones wait, then go once. */
    this.blocked = o.blocked || (() => false);
  }

  readSettings() {
    if (!this.settingsFile) return null;
    try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { return null; }
  }

  setSettings(patch) {
    const next = normalizeSettings({ ...this.settings, ...patch });
    this.settings = next;
    if (this.settingsFile) {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
      const tmp = `${this.settingsFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ...next, updatedAt: new Date(this.now()).toISOString() }, null, 2));
      fs.renameSync(tmp, this.settingsFile);
    }
    for (const a of this.agentsOf()) this.onChange(a);
    return next;
  }

  start({ delayMs = 0 } = {}) {
    clearInterval(this.timer);
    const begin = () => {
      this.paused = false;
      this.tick();
      this.timer = setInterval(() => this.tick(), this.tickMs);
      this.timer.unref?.();
    };
    if (delayMs > 0) setTimeout(begin, delayMs).unref?.(); else begin();
  }

  stop() { this.paused = true; clearInterval(this.timer); this.timer = null; }

  nextWakeOf(agent) {
    return nextWake(agent, this.settings, this.now());
  }

  /** The day's count of scheduled turns, for this local day. */
  countToday(agent, now = this.now()) {
    return agent.wake?.day === localDate(now) ? agent.wake.count || 0 : 0;
  }

  /** Look at one agent now (also called when it turns idle). -> what happened: 'woke' | 'waiting' | 'capped' | null */
  check(agent, now = this.now()) {
    if (this.paused || !agent || agent.kind !== 'owned') return null;
    const due = dueFor(agent, this.settings, now);
    for (const a of due.stale) {
      agent.appointments = agent.appointments.filter((x) => x.id !== a.id);
      agent.emit('notice', { subtype: 'schedule', text: `An appointment was missed by more than a day and dropped: ${appointmentLabel(a)}` });
      this.log(`[${agent.name}] schedule: dropped a stale ${appointmentLabel(a)}`);
      agent.persist();
      this.onChange(agent);
    }
    let recurring = due.recurring;
    if (recurring === null && !due.appointments.length) return null;
    // The cap is for the recurring wake-ups; an appointment always fires (it was asked for at its time).
    if (recurring !== null && this.countToday(agent, now) >= this.settings.dailyCap) {
      agent.wake = { ...agent.wake, lastAt: now };
      agent.emit('notice', { subtype: 'schedule', text: `Skipped a scheduled wake-up: the daily cap of ${this.settings.dailyCap} is reached (Settings > Agents).` });
      this.log(`[${agent.name}] schedule: cap ${this.settings.dailyCap} reached, wake-up skipped`);
      agent.persist();
      this.onChange(agent);
      recurring = null;
      if (!due.appointments.length) return 'capped';
    }
    // Busy, or its last scheduled message is not taken in yet: wait (the next check, or the idle poke, sends it).
    if (!agent.isIdle() || agent.scheduledPending || this.blocked()) return 'waiting';
    const message = wakeMessage({ schedule: agent.schedule, recurring, appointments: due.appointments }, now, { tell: this.tell });
    // Book it before it goes out, so a second check (or a restart while it is on its way) never sends it twice.
    agent.wake = { lastAt: recurring !== null ? now : agent.wake?.lastAt ?? null, day: localDate(now), count: this.countToday(agent, now) + 1 };
    for (const a of due.appointments) {
      const next = nextRepeat(a, now);
      agent.appointments = next === null ? agent.appointments.filter((x) => x.id !== a.id) : agent.appointments.map((x) => (x.id === a.id ? { ...x, at: next } : x));
    }
    agent.persist();
    this.log(`[${agent.name}] schedule: waking up (${message.label})`);
    agent.wakeUp(message).catch((e) => this.log(`[${agent.name}] schedule: the wake-up could not go out (${e.message})`));
    this.onChange(agent);
    return 'woke';
  }

  tick() {
    if (this.paused) return;
    const now = this.now();
    for (const a of this.agentsOf()) {
      try { this.check(a, now); } catch (e) { this.log(`[${a.name}] schedule check failed: ${e.message}`); }
    }
  }
}

/** Next to the roster: data/agent-engine.local.json -> data/agent-engine.schedule.local.json. */
export function scheduleSettingsFileFor(rosterFile) {
  const dir = path.dirname(rosterFile);
  const base = path.basename(rosterFile);
  return path.join(dir, /\.local\.json$/i.test(base) ? base.replace(/\.local\.json$/i, '.schedule.local.json') : base.replace(/(\.json)?$/i, '.schedule.json'));
}
