import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core'

export default definePluginEntry({
  id: '04515',
  name: '04515',
  description: 'Pair OpenClaw with the hosted Oasis at openclaw.04515.xyz.',
  configSchema: emptyPluginConfigSchema,
  register(api) {
    api.registerCli(async ({ program }) => {
      const { register04515Cli } = await import('./cli.mjs')
      register04515Cli({ program })
    }, {
      descriptors: [{
        name: '04515',
        description: 'Connect OpenClaw to the hosted Oasis at openclaw.04515.xyz',
        hasSubcommands: true,
      }],
    })
    api?.logger?.info?.('[04515] Hosted Oasis bridge plugin loaded. Use the bundled 04515 skill to pair with openclaw.04515.xyz.')
  },
})
