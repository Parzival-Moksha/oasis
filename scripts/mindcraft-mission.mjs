#!/usr/bin/env node
// An agent says which mission it is working on, so its working minutes (and XP) are booked there.
//   node scripts/mindcraft-mission.mjs "Agent Name" work-vow.md     work on that mission
//   node scripts/mindcraft-mission.mjs "Agent Name" none            back to the default: the mission whose `who` names the agent
// Needs the Oasis dev server on this machine (http://127.0.0.1:4516). Missions are the files in C:\7c_oasis\docs\missions.
const [agent, mission] = process.argv.slice(2)
if (!agent || !mission) {
  console.error('usage: node scripts/mindcraft-mission.mjs "Agent Name" <mission-file.md | none>')
  process.exit(2)
}
const base = process.env.OASIS_URL || 'http://127.0.0.1:4516'
const response = await fetch(`${base}/api/village/work`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ agentMission: { agent, mission: /^(none|null|-)$/i.test(mission) ? null : mission } }),
})
const data = await response.json().catch(() => ({}))
if (!response.ok) {
  console.error(`not set: ${data.error || response.status}`)
  process.exit(1)
}
console.log(data.mission ? `${agent} now works on "${data.title}" (${data.mission}): ${data.priority} XP a minute.` : `${agent} is back on the mission whose "who" names it.`)
