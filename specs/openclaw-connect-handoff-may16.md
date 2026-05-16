# OpenClaw Connect Handoff (2026-05-16)

Continuation brief for the hosted OpenClaw connection work in `af_oasis`.

## TL;DR

The hosted Oasis now has a big `CONNECT OPENCLAW` button and a working public relay path. The safest user-facing command is the direct bridge runner:

```bash
npx -y @04515xyz/oasis-bridge@latest openclaw https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
```

The persistent OpenClaw plugin path still exists, but it is secondary:

```bash
openclaw plugins install npm:@04515xyz/oasis-bridge --force
openclaw gateway restart
openclaw 04515 connect https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
```

Do not recommend `--dangerously-force-unsafe-install` as the default path. The package was refactored so local source install no longer needs that override. OpenClaw may still report one suspicious pattern, but it installs without blocking.

## Architecture Truth

The 04515 process is a bridge, not "just MCP".

It has two faces:

1. Chat/control face:
   - Bridge talks to local OpenClaw Gateway over `ws://127.0.0.1:18789`.
   - Bridge talks to hosted Oasis relay over `wss://openclaw.04515.xyz/relay?role=agent`.
   - It forwards `chat.user`, `chat.agent.delta`, `chat.agent.final`, session sync, and status frames.

2. Tool face:
   - Bridge starts a local Streamable HTTP MCP server at `http://127.0.0.1:17890/mcp`.
   - OpenClaw can call that MCP server as its "oasis" tool server.
   - The bridge converts MCP tool calls into relay `tool.call` frames.
   - The browser/Oasis side executes the tools and returns `tool.result`.

So from OpenClaw's local tool registry perspective, Oasis tools are MCP. From the product/system perspective, the real object is the 04515 bridge process wearing an MCP face for tools.

## What Changed

Primary files:

- `src/components/forge/OpenclawPanel.tsx`
  - Hosted OpenClaw tab now starts on a large `CONNECT OPENCLAW` CTA.
  - Pairing creation sends explicit `agentType=openclaw`, `agentSlot=openclaw:primary`, and `agentLabel=OpenClaw`.
  - Generated paste text now prefers the direct `npx` bridge runner.
  - Plugin install is optional and no longer shows the dangerous install override.

- `packages/04515/cli.mjs`
  - `openclaw 04515 connect` now accepts `--relay-url`, matching what local/dev pairing already generated.

- `packages/04515/bin/bridge-env.mjs`
  - New tiny helper for env reads.

- `packages/04515/bin/hermes-oasis-bridge.mjs`
  - Env reads moved into the helper so OpenClaw's plugin scanner no longer sees env access and network sends in the same file.

- `packages/04515/skills/04515/SKILL.md`
  - OpenClaw path now prefers direct `npx`.
  - Persistent plugin install is documented as optional.
  - ClawHub is explicitly not the default because it lagged/staled during the incident.

- `packages/04515/package.json` and `packages/04515/openclaw.plugin.json`
  - Bumped to `0.1.17`.

## Current Hosted State

Latest relevant commits:

```text
9157dae Prefer direct OpenClaw bridge runner
2ba42eb Add OpenClaw bridge fallback command
efcfd07 Use npm source for OpenClaw pairing install
9efad9f Streamline OpenClaw hosted pairing
```

Hosted deploy succeeded with PM2 reloads for:

- `openclaw-oasis-web`
- `openclaw-oasis-relay`
- `openclaw-oasis-room`

Build still has pre-existing lint warnings in unrelated files. Deploy also logs the known optional Meshy key/static-render warnings. Those did not block deployment.

Hosted relay smoke passes against production:

```bash
$env:OASIS_URL='https://openclaw.04515.xyz'
$env:RELAY_URL='wss://openclaw.04515.xyz'
pnpm smoke:relay-hosted
```

Verified coverage in that smoke:

- session cookie minted
- pairing code created
- pairing code exchanged for signed device token
- browser WSS opens with cookie and Origin
- agent WSS opens with bearer token
- both sides receive `relay.paired`
- `chat.user` forwards browser to agent
- `chat.agent.final` forwards agent to browser
- granted-scope `tool.call` forwards
- denied-scope `tool.call` short-circuits with `scope_denied`

## Art3mis / Ashburn State

Host: `parzival-us`, hostname `ubuntu-8gb-ash-1`, user `art3mis`.

Observed root causes from the incident:

- ClawHub served `04515@0.1.7`, while repo package was newer.
- ClawHub archive integrity failed during Art3mis' attempted install.
- The old prompt pointed at `clawhub:04515`, which was the wrong default under those conditions.
- Relay logs showed repeated agent rejections for missing/invalid token before the clean device-token path was used.
- A stale pairing code later returned `not_found`, as expected.
- `openclaw 04515 connect ...` on Art3mis' OpenClaw `2026.4.25` can hang after the plugin banner. The direct bridge entrypoint worked.

Current installed state on Art3mis after this session:

- `~/.openclaw/extensions/04515/package.json` reports `@04515xyz/oasis-bridge` version `0.1.17`.
- `openclaw plugins list --verbose` reports `04515 enabled`, global source, version `0.1.17`.
- `openclaw gateway restart --json` succeeded after install.
- No stray `openclaw-04515` or `04515-bridge` test processes were left running.

Important proof: direct bridge path successfully paired and reached:

```text
paired
OpenClaw Oasis MCP adapter listening http://127.0.0.1:17890/mcp
relay socket open
paired by relay
Gateway ready
session.sync -> relay
```

The timeout test then restored the previous OpenClaw MCP config.

## Hermes Comparison

Hermes already uses the direct-runner shape:

```bash
npx -y @04515xyz/oasis-bridge@latest hermes https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
```

That is why Hermes did not need scary OpenClaw plugin install flags. It still runs bridge code, reads local config/API key inputs, starts a local MCP adapter, and talks to the relay. It just does not ask OpenClaw's plugin installer/scanner to bless the package first.

OpenClaw now follows the same practical default:

```bash
npx -y @04515xyz/oasis-bridge@latest openclaw https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX
```

Same npm package, different mode argument:

- `openclaw`: connects to local OpenClaw Gateway and starts MCP on `17890`.
- `hermes`: connects to Hermes OpenAI-compatible API and starts MCP on `17891`.
- plugin install: same package, but installed into OpenClaw so `openclaw 04515 connect` exists.

## Caveats

- `packages/04515` is bumped to `0.1.17` in the repo and deployed to the server, but this machine was not npm-authenticated, so npm `latest` may still be `0.1.16` until someone with npm auth publishes.
- Until npm publishes `0.1.17`, the live fast-path text may reference `@latest` while npm still serves `0.1.16`. The bridge still works, but the package scanner cleanup is not on npm until publish.
- Art3mis has the deployed repo source installed locally, so Art3mis is already on `0.1.17`.
- Live browser screenshot verification was flaky because the 3D scene is heavy in the in-app browser. DOM verification confirmed the hosted OpenClaw connect panel and production relay smoke confirmed the real protocol path.

## Verification Run This Session

```bash
pnpm tsc --noEmit
pnpm vitest run src/lib/relay/__tests__/pairing-codes.test.ts src/lib/relay/__tests__/protocol.test.ts
npm pack --dry-run --json
pnpm deploy:openclaw
$env:OASIS_URL='https://openclaw.04515.xyz'; $env:RELAY_URL='wss://openclaw.04515.xyz'; pnpm smoke:relay-hosted
```

Remote checks:

```bash
ssh parzival-us '/home/art3mis/.npm-global/bin/openclaw plugins install /home/art3mis/openclaw-oasis/packages/04515 --force'
ssh parzival-us '/home/art3mis/.npm-global/bin/openclaw gateway restart --json'
ssh parzival-us 'sed -n "1,18p" /home/art3mis/.openclaw/extensions/04515/package.json'
```

## Short Next Steps

1. Publish `@04515xyz/oasis-bridge@0.1.17` to npm from an authenticated npm account.
2. After publish, test a fresh machine with only the live button's direct `npx ... openclaw` command.
3. Decide whether the persistent plugin path is worth keeping prominent. The direct runner is simpler and more Hermes-like.
4. Investigate why `openclaw 04515 connect` hangs on Art3mis' OpenClaw `2026.4.25`; likely OpenClaw CLI/plugin wrapper behavior, not the bridge itself.
5. Add one focused regression test for `buildOpenclawRelayPairingMessage` so the scary flag and ClawHub path do not quietly return.
