#!/usr/bin/env node
// `npx oasis-village`: install (the first time) and open the Oasis, in front of you with its progress.
// The same launcher the Claude Code plugin uses (oasis-launch.mjs); --lite takes the small edition.
if (!process.argv.includes('--wait')) process.argv.push('--wait')
const { main } = await import('./oasis-launch.mjs')
process.exit(await main())
