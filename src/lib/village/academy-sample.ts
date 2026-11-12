// ░▒▓ ACADEMY SAMPLE — the three skills this repo ships ▓▒░
// The Academy reads its real skill list from a folder outside this repo (OASIS_ACADEMY_DIR). When that
// folder is missing, the tree shows these three, so the feature works on a fresh clone.
// Same shape as that folder's skills.json and keys.json.

export const ACADEMY_SAMPLE_SKILLS = [
  {
    order: 1,
    id: 'spirit',
    name: 'Spirit',
    tier: 0,
    lane: 'core',
    what: 'A model that answers: a Claude or ChatGPT plan you sign in with, or an API key.',
    prompt: 'Hello. Before we start: which model are you, and what are you allowed to do on my plan? Answer in three short lines.',
    proof: 'It answers a question, and you can show the plan or key it runs on.',
    xp: 10,
    mins: 5,
    keys: ['claude-plan', 'api-key'],
    way: null,
    needs: [],
  },
  {
    order: 2,
    id: 'body',
    name: 'Body',
    tier: 0,
    lane: 'core',
    what: 'A place where it can act: a coding agent in a terminal on your machine, with a folder of its own.',
    prompt: 'You now run on my machine. Make a folder called agent-home, put a README in it that says what the folder is for, and tell me the full path.',
    proof: 'The folder exists on disk and the README says what it is for.',
    xp: 10,
    mins: 10,
    keys: ['claude-plan', 'api-key'],
    way: null,
    needs: [],
  },
  {
    order: 3,
    id: 'soul',
    name: 'Name and soul',
    tier: 1,
    lane: 'core',
    what: 'It has a name, a few lines about who it is, and it remembers something about you.',
    prompt: 'Pick a name for yourself and write five lines about who you are into SOUL.md in your folder. Then ask me two questions about myself and save the answers where you will find them next time.',
    proof: 'In a new conversation it says its name and both things it learned about you.',
    xp: 20,
    mins: 15,
    keys: [],
    way: null,
    needs: ['spirit', 'body'],
  },
]

export const ACADEMY_SAMPLE_KEYS = {
  keys: [
    { id: 'claude-plan', name: 'A Claude plan', short: 'Claude', kind: 'subscription', cost: 'A monthly plan', link: 'https://claude.com/pricing' },
    { id: 'api-key', name: 'A model API key', short: 'API key', kind: 'api', cost: 'Pay for what you use', link: 'https://console.anthropic.com/settings/keys' },
  ],
  levels: [
    { name: 'Stone', xp: 0 },
    { name: 'Awake', xp: 20 },
    { name: 'Named', xp: 40 },
  ],
}
