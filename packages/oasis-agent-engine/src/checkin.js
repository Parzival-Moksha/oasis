// The daily check-in: at 21:00 local (the owner's ask, 2026-11-16), the Telegram line sends one short message about
// the day's work, read from the Mindcraft work counter (GET http://127.0.0.1:4516/api/village/work, the Next app's
// /api/village/work route, src/lib/village/work-vow.ts): time against the vow, XP, where the XP came from, the week.
// The owner asked for the tone: "a sum-up of the day's work, what generated most XP… it would be most effective if it
// told me that I sucked if I don't knock out three hours… casual and hacker-minded." Blunt about the work, never
// about him. Pure: no network, no timers (telegram.js schedules it and keeps lastSent in its state file).

export const CHECKIN_DEFAULT = Object.freeze({ on: true, time: '21:00', lastSent: null });

const two = (n) => String(n).padStart(2, '0');

/** "21", "21:30", "9:05", "2130", "9pm", "9:30 pm" -> "HH:MM"; anything else null. */
export function parseCheckinTime(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${two(h)}:${two(min)}`;
}

/** This machine's local date of a moment: "2026-11-16". */
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The local date whose check-in is due at `now`, or null: on, past its time today, and not sent today yet. */
export function checkinDue(now, c) {
  if (!c?.on) return null;
  const time = parseCheckinTime(c.time) || CHECKIN_DEFAULT.time;
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  const date = localDate(now);
  return now >= at && c.lastSent !== date ? date : null;
}

/** "1:05" (hours and minutes; the phone doesn't need seconds). */
export function hm(seconds) {
  const min = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  return `${Math.floor(min / 60)}:${two(min % 60)}`;
}

const xpText = (n) => String(Math.round((Number(n) || 0) * 10) / 10);
const pick = (seed, list) => list[Math.abs(seed) % list.length];
const DAY_MARK = { hit: '✅', missed: '❌', open: '⏳', ahead: '·' };

/** Where today's XP came from: the counter's own list when it has one, else its missions and free time. */
function sources(today) {
  if (Array.isArray(today.topXp) && today.topXp.length) {
    return today.topXp.filter((x) => x && x.label).map((x) => ({ label: String(x.label), seconds: Number(x.seconds) || 0, xp: Number(x.xp) || 0 }));
  }
  const missions = (Array.isArray(today.missions) ? today.missions : []).map((m) => ({ label: String(m.title || m.file || 'a mission'), seconds: Number(m.seconds) || 0, xp: Number(m.xp) || 0 }));
  const missionXp = missions.reduce((sum, m) => sum + m.xp, 0);
  const free = { label: 'free time in the Oasis', seconds: Number(today.freeSeconds) || 0, xp: Math.max(0, (Number(today.xp) || 0) - missionXp) };
  return [...missions, free].filter((x) => x.seconds >= 60 || x.xp >= 1);
}

/**
 * The check-in for a work-counter snapshot (WorkSnapshot in src/lib/village/work-vow.ts). `now` is the moment it goes
 * out (what's left of the day is counted from it). Plain text, a handful of short lines.
 */
export function checkinText(snap, now = Date.now()) {
  const d = new Date(now);
  const today = snap?.today || {};
  const worked = Number(today.seconds) || 0;
  const target = Number(snap?.targetSeconds) || Number(snap?.vow?.dailySeconds) || 3 * 3600;
  const week = Array.isArray(snap?.week) ? snap.week : [];
  const vow = Array.isArray(snap?.commitments) ? snap.commitments[0] || null : null;
  const dayIndex = week.findIndex((w) => w.date === snap?.date);
  const inVow = dayIndex >= 0;
  const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const lines = [`🕘 ${two(d.getHours())}:${two(d.getMinutes())} check-in · ${weekday}${inVow ? ` · vow day ${dayIndex + 1}/${week.length}` : ''}`];

  if (!inVow) {
    lines.push(`No vow running today. ${hm(worked)} in the Oasis, ${xpText(today.xp)} XP.`);
  } else if (worked >= target) {
    const bonus = vow?.days?.[dayIndex]?.bonusXp;
    lines.push(`✅ ${hm(worked)} of ${hm(target)}. Vow kept. ${pick(seed, ['Well done.', 'Well done. Green build.', 'Well done. Ship it.', 'Well done. Merged.'])}`);
    lines.push(`XP today: ${xpText(today.xp)}${bonus ? `, +${xpText(bonus)} for keeping the vow (x${vow.multiplier || 2})` : ''}.`);
  } else {
    const short = target - worked;
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const left = Math.max(0, Math.floor((midnight - now) / 1000));
    if (worked < 60) lines.push(`❌ Zero. Not one minute in the Oasis today, and the vow says ${hm(target)}. You sucked today.`);
    else {
      lines.push(`❌ ${hm(worked)} of ${hm(target)}. ${pick(seed, [
        `You sucked today: ${hm(short)} short.`,
        `You sucked today. ${hm(short)} short, and excuses don't compile.`,
        `You sucked today: ${hm(short)} short. The vow doesn't read your reasons.`,
      ])}`);
    }
    if (left >= short) lines.push(`${hm(left)} till midnight, so it's still a hit if you put in ${hm(short)} now. ${pick(seed, ['Go.', 'Clock is running.', 'Log in.'])}`);
    else if (left >= 60) lines.push(`${hm(left)} till midnight: too late to close it, but every minute you add still saves ${xpText(vow?.penaltyPerMinute || 7)} XP.`);
    if (vow?.today?.penaltyIfStopped) lines.push(`Stop now: −${xpText(vow.today.penaltyIfStopped)} XP.${left >= short ? ` Make it: +${xpText(vow.today.bonusIfHit)}.` : ''}`);
    if (worked >= 60) lines.push(`XP today: ${xpText(today.xp)}.`);
  }

  const top = sources(today).sort((a, b) => b.xp - a.xp).slice(0, 3);
  if (top.length) lines.push(`Most XP: ${top.map((x) => `${x.label} ${hm(x.seconds)} (${xpText(x.xp)})`).join(', ')}.`);
  const agents = (Array.isArray(today.agents) ? today.agents : []).filter((a) => a && a.name && Number(a.seconds) >= 60)
    .sort((a, b) => b.seconds - a.seconds).slice(0, 4);
  if (agents.length) lines.push(`With: ${agents.map((a) => `${a.name} ${hm(a.seconds)}`).join(', ')}.`);
  const crew = Number(snap?.summary?.agentHours?.totalSeconds) || 0;
  if (crew >= 60) lines.push(`The agents put in ${hm(crew)} of their own.`);
  if (inVow) {
    const kept = week.filter((w) => w.status === 'hit').length;
    const counted = week.filter((w) => w.status !== 'ahead').length;
    const net = snap?.totals?.netXp;
    lines.push(`Week: ${week.map((w) => DAY_MARK[w.status] || '·').join('')}  ${kept}/${counted} kept${net != null ? `, ${xpText(net)} XP net` : ''}.`);
  }
  return lines.join('\n');
}
