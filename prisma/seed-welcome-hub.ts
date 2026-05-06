// Compatibility entrypoint for older deploy docs and muscle memory.
// The canonical default-world pipeline lives in seed-default-worlds.ts.

const defaults = ['--world=portal-zero', '--update-core', '--snapshot']
for (const arg of defaults) {
  if (!process.argv.includes(arg)) process.argv.push(arg)
}

import('./seed-default-worlds').catch((error) => {
  console.error('[seed:welcome-hub] Failed:', error)
  process.exit(1)
})
