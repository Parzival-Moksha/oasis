# openclaw.04515.xyz North Star

openclaw.04515.xyz is a stripped-down Oasis body for an OpenClaw agent.

The first screen should be the usable world, not a landing page. The user connects an OpenClaw gateway, sees the agent avatar, chats by text, talks by realtime voice, and watches the agent move, build, and inspect inside the world.

## First Build Scope

- OpenClaw avatar and gateway connection
- Text chat to the real OpenClaw session
- Realtime voice with the OpenClaw personality
- Oasis world awareness and world-building tools
- Lightweight project visualization

Out of scope for the first public build:

- Anorak, Anorak Pro, Merlin, and Codex-first flows
- User credit economy unless usage forces it
- Heavy multi-user collaboration
- Full marketplace polish

## Architecture Bet

The current voice work is a transport portal with a partial cognition bridge.

Desired direction:

- Browser captures mic/audio and renders avatar/world.
- Oasis forwards voice frames and UI events to the OpenClaw Gateway.
- OpenClaw owns session identity, personality, memory, approvals, and durable tools.
- `gpt-realtime` or `gpt-realtime-mini` handles live speech.
- Heavy coding, file, shell, and long reasoning tasks delegate back to the canonical OpenClaw text runtime.

Do not flip the whole OpenClaw agent model to `gpt-realtime`. Keep the main OpenClaw brain on its normal coding/text model and use realtime as the low-latency voice layer.

## Demo Definition Of Working

The video-worthy local demo passes when:

- Gateway starts cleanly from a visible terminal.
- Oasis connects to the gateway without manual config surgery.
- OpenClaw replies through text in the Oasis.
- Realtime voice starts without API key errors.
- Realtime voice only uses `gpt-realtime` or `gpt-realtime-mini`.
- The avatar speaks, lip syncs, and can be interrupted.
- Voice can call at least three Oasis tools: inspect world, move avatar, place/build one object.
- A heavier request can be handed to the normal OpenClaw text runtime or clearly explains that it is delegating.
- Logs make it obvious which path handled each turn: text runtime, realtime voice, or Oasis tool.

## Ship Order

1. Local proof: make the Oasis + OpenClaw loop reliable enough to record.
2. ClawHub package: publish the Oasis/OpenClaw plugin or skill for clone-and-run users.
3. Video: "I hang out with my OpenClaw in the Oasis."
4. Remote beta: deploy a stripped-down portal after the local story works.
5. Product polish: mobile, onboarding, remote gateway connection, credits/auth only if needed.

## Visible Gamer Loop

For embodied bugs, use headed Playwright or Chrome DevTools Protocol whenever possible so the developer can watch the agent drive the world. Capture screenshots and short videos for gait, camera, input, panel, and avatar-regression loops; treat the visible run as first-class evidence, not just a private test harness.

## Remote Pairing Plan

The local product currently has two network directions:

| Lane | Direction | Purpose |
|---|---|---|
| Gateway WS | Oasis browser -> OpenClaw Gateway | Chat, session control, tool/event stream |
| Oasis MCP | OpenClaw -> Oasis | World state, world mutation, screenshots |

For an OpenClaw running on a VPS while Oasis runs on a laptop, the practical beta bridge is one SSH session:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 -R 4516:127.0.0.1:4516 user@openclaw-host
```

This is not the final consumer UX. It is the fastest way to prove the remote topology with the real Gateway before building a hosted relay.

The Oasis UI should present this as:

1. Choose **Local OpenClaw** or **Remote OpenClaw on VPS**.
2. For VPS, paste host/user or a complete SSH bridge command.
3. Oasis starts and monitors the bridge.
4. Oasis connects to `ws://127.0.0.1:18789`.
5. OpenClaw registers `http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw`.
6. Oasis shows one approval card if Gateway pairing is pending.
7. Smoke test runs: world info, avatar walk, safe placement, screenshot.

Raw URLs and commands should live behind "repair details", not on the primary screen.

## Hosted Relay Direction

For `openclaw.04515.xyz`, the SSH bridge should disappear from the normal user flow.

Preferred shape:

1. User logs into Oasis.
2. Oasis creates a short-lived pairing URL or code.
3. User gives that URL/code to OpenClaw.
4. OpenClaw connects to a public relay over HTTPS/WSS with a scoped token.
5. The user's browser keeps an outbound world bridge open for screenshots and interaction.
6. OpenClaw MCP calls route through the relay to the correct user, world, browser, and session.

This can be one multi-tenant service, not one process per user. Route by user id, world id, session id, and agent/device id. Spawn separate workers only for heavy or isolated jobs.

Security model:

- Pairing codes are short-lived and single-use.
- Successful pairing exchanges the code for a scoped, revocable device token.
- Tokens are bound to user, agent/device identity, and allowed scopes.
- The relay enforces world/session ownership on every request.
- Screenshot capture stays browser-mediated; the server does not need a GPU to see the user's rendered world.
- Scope upgrades require explicit approval.

This hosted relay is the consumer-grade path. The SSH VPS path is an early-adopter bridge and a debugging milestone.

## Hosted Relay Concrete Shape

The first hosted relay can live in the same VPS/app as Oasis. It does not need one process per user; it needs one shared relay service with per-user, per-agent, per-world routing.

Core tables:

| Table | Purpose |
|---|---|
| `RelayPairingCode` | Short-lived pending invite created by the logged-in Oasis user. |
| `RelayAgentDevice` | Revocable OpenClaw device identity after pairing succeeds. |
| `RelaySession` | Browser world session and active agent session binding. |
| `RelayEvent` | Optional append-only audit/debug stream for early beta. |

Concrete endpoints:

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/relay/pairings` | Browser | Create a pairing code for the current user/world. |
| `GET /pair/:code` | Human/browser | Approval screen; confirms user intent. |
| `POST /api/relay/pairings/:code/exchange` | OpenClaw | Exchange code for scoped device token. |
| `GET /api/relay/agent/ws` | OpenClaw | WSS control channel for chat, tool calls, and events. |
| `GET /api/relay/browser/ws` | Browser | WSS world bridge for screenshots, live world state, and tool execution. |
| `POST /api/relay/devices/:id/revoke` | Browser | Revoke a paired OpenClaw device. |

Pairing flow:

1. User logs into `openclaw.04515.xyz` and opens a world.
2. Oasis calls `POST /api/relay/pairings` and receives a short code such as `OASIS-K7M2`, plus a complete URL like `https://openclaw.04515.xyz/pair/OASIS-K7M2`.
3. User gives the URL/code to OpenClaw.
4. OpenClaw opens the URL or calls the exchange endpoint with the code and a generated device public key.
5. Oasis shows an approval card naming the world, agent label, requested scopes, and expiry.
6. User approves.
7. Relay returns a device token scoped to that user, world/session lane, and allowed actions.
8. OpenClaw stores only the token and relay URL, then connects outbound over `wss://`.
9. Browser also keeps an outbound `wss://` world bridge open.
10. MCP-like tool calls are envelopes over the relay: OpenClaw -> relay -> browser world bridge -> relay -> OpenClaw.

Default scopes:

| Scope | Meaning |
|---|---|
| `world.read` | Inspect objects, avatars, player/camera pose. |
| `world.write.safe` | Place/move/scale/delete only within Oasis tool guardrails. |
| `screenshot.request` | Ask the browser to capture the user's rendered world. |
| `chat.stream` | Stream text turns and tool traces through the panel. |
| `voice.realtime` | Optional realtime voice lane, disabled until the text lane is solid. |

Token rules:

- Pairing code expires in 5-10 minutes.
- Pairing code is single-use.
- Device token is random, high-entropy, hashed at rest, revocable, and never logged.
- WSS auth sends the token in the first protocol message rather than a URL query string.
- Every relay message includes `userId`, `worldId`, `agentDeviceId`, `sessionId`, `messageId`, and `scope`.
- The relay validates scope and ownership before forwarding anything.
- Browser screenshot and mutation execution stays client-mediated; the VPS routes messages but does not render the 3D world.
