---
name: oasis
description: Teach Hermes or another remote agent how to connect to Oasis as a world-building agent through the Oasis MCP endpoint, optional Oasis plugin, and live browser screenshot bridge.
version: 0.3.0
author: Levi
license: MIT
metadata:
  hermes:
    tags: [oasis, mcp, world-building, 3d, hermes, integrations]
    requires_toolsets: [mcp-oasis]
    config:
      oasis_host:
        description: "Hostname or IP of the machine running Oasis (usually 127.0.0.1 when tunneled over SSH)"
        default: "127.0.0.1"
      oasis_port:
        description: "Port Oasis dev server is listening on"
        default: 4516
---

# Oasis

Oasis is a local-first 3D world that agents can inspect, modify, navigate, and build through a shared Oasis tool surface.

This skill is for the new reality, not the old one:
- Oasis has a shared world-tool substrate
- Oasis exposes a remote MCP endpoint at `/api/mcp/oasis`
- Oasis can inject live world context through the optional Hermes plugin
- visual tools depend on a live Oasis browser client with the screenshot bridge mounted

Use this skill when an agent needs to become world-aware inside Oasis, not merely chat through an Oasis panel.

## When To Use

Use this skill when:
- the user wants Hermes, OpenClaw, or another remote agent to work inside Oasis worlds
- the user asks how to connect an agent to Oasis through MCP
- the user wants an agent to inspect, place, remove, paint, light, move, or screenshot inside Oasis
- the user asks what a remote Oasis agent can really perceive or control
- the user wants the install path for the Oasis skill, plugin, and MCP endpoint

Do not use this skill for generic coding unless Oasis integration is part of the task.

## Quick Reference

- Repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Plugin path: `hermes-plugin/oasis`
- Remote MCP endpoint: `http://<oasis-host>:4516/api/mcp/oasis`
- Legacy REST tools endpoint: `http://<oasis-host>:4516/api/oasis-tools`

## Split-Machine Topology

When Hermes lives on a VPS and Oasis runs on the local machine, there are two separate services that must see each other:

- Hermes API on the VPS at `127.0.0.1:8642`
- Oasis MCP on the local machine at `127.0.0.1:4516`

Use one SSH session with two forwards:

```bash
ssh -o ExitOnForwardFailure=yes \
  -L 8642:127.0.0.1:8642 \
  -R 4516:127.0.0.1:4516 \
  user@your-vps -N
```

Meaning:

- `-L 8642:127.0.0.1:8642`
  - opens local port `8642`
  - forwards local Oasis traffic to the Hermes API on the VPS
  - used by the Oasis Hermes chat panel

- `-R 4516:127.0.0.1:4516`
  - opens remote port `4516` on the VPS
  - forwards Hermes-side MCP traffic back to the local Oasis server
  - used by Hermes when calling Oasis MCP tools

Without the `-R 4516...` half, Hermes can chat but cannot touch the Oasis world.
Without the `-L 8642...` half, Oasis can render the Hermes panel but cannot reach the Hermes API.

## What To Hand Back To The User (connection round-trip)

After you finish the Hermes-side setup (MCP extra installed, `mcp_servers.oasis` entry in `~/.hermes/config.yaml`, API server running), **in the same turn**, output both of these blocks for the user to act on. Do not wait for them to ask.

1. **SSH tunnel command** — the user pastes this INTO THE OASIS HERMES PANEL (☤ button → config → SSH TUNNEL field). Oasis auto-launches it from the Oasis server's shell. The user does NOT paste this into a terminal themselves — doing so creates a duplicate tunnel that steals ports 8642/4516 and Oasis's own tunnel spawn dies with exit 255.

   **Output as a single line, no backslash line-continuations** (backslashes are fine in a terminal but confusing in a UI text field):

   ```
   ssh -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 <SSH_TARGET> -N
   ```

   **`<SSH_TARGET>` must be replaced by the user** with whatever they normally type after `ssh` to log into the VPS you're running on. Three common shapes:

   - A bare SSH config alias: `myvps`, `prod`, anything they've defined in their local `~/.ssh/config`. If they have one, this is easiest and carries their key + user automatically. No `@` needed.
   - `user@ip`: e.g. `root@203.0.113.42`. Use this shape when they log in by explicit user + IP.
   - `user@hostname`: e.g. `ubuntu@box.example.com`. Same as above but with DNS instead of a raw IP.

   **Do NOT guess the user's SSH alias or insert `whoami` output as the login user** — the process user running Hermes on the VPS (often something like `levi` or `ubuntu`) is almost never the same as the SSH login username the user types locally. Hand them the template with `<SSH_TARGET>` literally present; tell them to substitute and point out the three shapes above. If they already SSH in as "foo@1.2.3.4", that's what goes in.

2. **Hermes pairing blob** — the user pastes this into the Oasis Hermes panel: click the ☤ button in the Oasis UI left toolbar → click **config** → paste → save & connect. The blob should look like:

   ```text
   HERMES_API_BASE=http://127.0.0.1:8642/v1
   HERMES_API_KEY=<actual key value read from ~/.hermes/.env, NOT a placeholder>
   ```

   Read the real `API_SERVER_KEY` from `~/.hermes/.env` (or generate one, store it, and use it) and include the literal value. Do NOT output `your_hermes_api_key` or `<paste-key-here>` — the user should be able to copy-paste and hit save without editing.

   If `API_SERVER_ENABLED=true` is not set in `~/.hermes/.env`, set it yourself, start the gateway (`hermes gateway run`), and verify `/health` + `/v1/models` respond before handing the blob over. Do not ask the user to enable the API server manually — you have the access.

Why both in one turn: the SSH tunnel is the wire, the pairing blob is the address. Users need both at once to connect, and two turns of guessing wastes time.

## Environment Prep (run on your VPS side before starting gateway)

Fresh Hermes installs are missing a few things that the gateway silently needs. Do these proactively so the user never sees a cryptic `FileNotFoundError` mid-chat:

```bash
mkdir -p /root/hermes-workspace
# or $HOME/hermes-workspace if you're running as a non-root user
```

Hermes shells out to subprocesses in this working directory for some actions. If the directory is missing, you get `FileNotFoundError: [Errno 2] No such file or directory: '/root/hermes-workspace'` the moment the user sends their first message.

After config changes on an already-running gateway, tell the user to either restart the gateway or run `/reload-mcp` inside Hermes. Config writes to `~/.hermes/config.yaml` are NOT picked up live.

## Install Path

1. Add the repo as a Hermes tap, then install the skill.
   ```bash
   hermes skills tap add Parzival-Moksha/oasis
   hermes skills install oasis
   ```
   Subpath install (`Parzival-Moksha/oasis/skills/oasis`) may also work but is not the recommended path.

2. Configure the Oasis MCP server in the agent runtime.
   - Point the agent at `http://<oasis-host>:4516/api/mcp/oasis`
   - If Oasis has `OASIS_MCP_KEY` set, send the same bearer token
   - See `references/streamable-http-mcp.example.json` for a concrete starter shape

3. Optionally install the Oasis Hermes plugin.
   - Plugin folder: `hermes-plugin/oasis`
   - The plugin injects compact live world context into each turn even before tools are called

4. Keep a real Oasis browser client open in the target world when the agent needs vision.
   - `screenshot_viewport`
   - `screenshot_avatar`
   - `avatarpic_merlin`
   - `avatarpic_user`
   - When Hermes asks for screenshots, prefer including `defaultAgentType="hermes"` so agent-view captures resolve cleanly and can be handed back as Hermes-usable files.
   - For the user's actual camera, use `screenshot_viewport` with `mode: "current"` or `views: [{ mode: "current" }]`.
   - For a behind-the-avatar shot, use `screenshot_avatar` with `style: "third-person"` or `screenshot_viewport` with `mode: "third-person-follow"`.
   - Prefer one `screenshot_viewport` call with a `views` array for multi-angle capture instead of many separate screenshot calls.
   - Do not fall back to generic `browser_*` tools for Oasis world vision; those browsers run remotely and may point at the wrong world.

Without the live browser bridge, screenshot tools cannot see the world.

## Recommended MCP Config

The exact config key and format depends on the host agent runtime.

### Hermes (`~/.hermes/config.yaml`)

The config key is **`mcp_servers`** (snake_case, plural). NOT `mcp`, NOT `mcpServers`.

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

After saving, run `/reload-mcp` in the Hermes session or restart the gateway.

### Advanced: bearer auth (multi-user Oasis hosts only)

Solo / local Oasis users should skip this section. The SSH reverse tunnel is already the auth boundary — only your VPS can reach port 4516. Set `OASIS_MCP_KEY` only if you are exposing Oasis to a shared network and need request-level auth. Hermes YAML headers expect literal strings (env var expansion is not documented as supported), so paste the token directly:

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
    headers:
      Authorization: "Bearer paste-the-literal-token-here"
```

Important:
- The MCP server name `oasis` is what makes Hermes register tools as `mcp_oasis_*`.
- This is the correct layer for tool naming. `SKILL.md` can teach usage, but it does not rename the registered tools.
- If you ever see `mcp_mcp_oasis_*` in Hermes progress text, treat that as a runtime/display issue or a model-side hallucinated tool name, not as the canonical Oasis registration.

### Claude Code / Generic MCP (`mcp.json` or `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "oasis": {
      "transport": "streamable-http",
      "url": "http://<oasis-host>:4516/api/mcp/oasis"
    }
  }
}
```

### Prerequisites

Hermes MCP support requires the `[mcp]` extra:

```bash
cd ~/.hermes/hermes-agent && uv pip install -e ".[mcp]"
```

Without it, `/reload-mcp` will report "No MCP servers connected" even when config is correct.

### Common mistakes

- Using `mcp:` instead of `mcp_servers:` in Hermes config — tools will silently never load
- Using `mcpServers` (camelCase) in Hermes YAML — wrong format, Hermes uses snake_case
- Adding `type: streamable-http` — unnecessary, Hermes infers HTTP transport from the `url` key
- Missing the `[mcp]` pip extra — MCP SDK won't be available, tools silently don't load
- Forgetting the SSH reverse tunnel (`-R 4516`) when Hermes is on a VPS — MCP endpoint unreachable

### Verification

After configuring, run `/reload-mcp` in Hermes. The output should show tools discovered:

```
♻️  Reconnected: oasis
🔧 35 tool(s) available from 1 server(s)
```

If it shows "No MCP servers connected", check:
1. Is the config key `mcp_servers` (not `mcp`)?
2. Is the SSH tunnel alive (`ss -tlnp | grep 4516` on the VPS)?
3. Is the Oasis dev server running on port 4516?

If the agent also supports the Oasis plugin, use both:
- MCP for tools
- plugin for compact always-on context

That pairing gives the best result.

## What The Agent Can Do

The Oasis tool surface supports:
- world state and world summary
- object search and asset search
- placing, modifying, and removing catalog objects
- crafting procedural scenes
- sky, ground, tile paint, and lights
- embodied agent avatars
- avatar walking and animation playback
- viewport and avatar screenshots
- Forge conjuration workflows for Meshy and Tripo assets

The agent should usually:
1. call `get_world_state` or `get_world_info`
2. call `query_objects` or `search_assets` as needed
3. make a world mutation
4. use screenshot tools when visual verification matters

## Self-Craft Is The Default For Hermes

When the user asks you to build something procedural (a campfire, a shrine, a crystal cluster, a fountain), **you write the primitives yourself** and pass them as the `objects` array to `craft_scene`. Do **not** delegate to the sculptor.

```
craft_scene({
  name: "Arcane campfire",
  position: [0, 0, 0],
  objects: [
    { type: "cylinder", position: [0, 0.08, 0], scale: [0.55, 0.08, 0.55], color: "#3b2a1d", roughness: 0.92 },
    { type: "flame", position: [0, 0.3, 0], scale: [0.22, 0.35, 0.22], color: "#fff4dd", color2: "#ff7a00", color3: "#9b1d00" },
    { type: "particle_emitter", position: [0, 0.75, 0], scale: [0.45, 0.85, 0.45], color: "#ffb347", particleCount: 80, particleType: "ember" },
    { type: "crystal", position: [0.65, 0.32, 0.1], scale: [0.22, 0.6, 0.22], rotation: [0.14, 0.3, -0.08], color: "#4338ca", color2: "#8b5cf6", seed: 11 }
  ]
})
```

What you have access to (call `get_craft_guide` for the live spec):
- **Geometry**: `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, `capsule`, `text`
- **Shaders**: `flame`, `flag`, `crystal`, `water`, `particle_emitter`, `glow_orb`, `aurora`
- **Animations**: `rotate`, `bob`, `pulse`, `swing`, `orbit` (with `type`, `speed`, `axis`, `amplitude`)
- **Textures**: 20 presets including `stone`, `cobblestone`, `marble`, `concrete`, `grass`, `sand`, `snow`, `metal`, `wood`, `kn-planks`, `kn-cobblestone`, `kn-roof`, `kn-wall`. Apply via `texturePresetId` + `textureRepeat`.
- **Material fields**: `metalness`, `roughness`, `opacity`, `emissive`, `emissiveIntensity`, `color2`, `color3`

Rules the craft runtime enforces:
- No ground planes, sky domes, or background walls — Oasis already provides the world.
- Use shader primitives aggressively for fire, cloth, crystal, water, glow, aurora.
- Many small overlapping primitives beat one oversized primitive.
- Non-zero rotation on at least some primitives.

### When to use sculptor fallback

`craft_scene({ prompt: "...", strategy: "sculptor" })` spawns an out-of-process Claude Code LLM subprocess on the Oasis host to write the objects array FOR you. It costs a real LLM call, takes several seconds, and streams primitives in as they arrive. **Use it only if:**
- The user explicitly asks you to delegate ("have the sculptor do it")
- The scene is so ambitious you'd rather have a dedicated coder agent sketch it first

Otherwise: self-craft. You are an LLM. You can write the JSON.

## Progressive Smoke Test

After install, verify in this exact order before trusting the connection. Each step escalates what it proves working.

1. **Plain chat** — say `hi` to your agent. You should get a plain reply.
   - Proves: Hermes API reachable, panel wired up.
2. **World awareness** — say `describe this world`.
   - Expect the agent to call `get_world_state` and narrate sky/ground/object counts.
   - Proves: MCP transport up, plugin context injection working.
3. **Asset search + placement** — say `find a cyberpunk streetlamp and place one in front of me`.
   - Expect `search_assets` then `place_object`.
   - Proves: catalog read, world mutation, no API keys required.
4. **Self-craft** — say `craft a small campfire with embers and a crystal cluster`.
   - Expect `craft_scene` with an `objects` array (NOT `strategy: "sculptor"`).
   - Proves: self-craft path, rendering, no API keys required.
5. **Vision** — say `take a screenshot and tell me what you see`.
   - Expect `screenshot_viewport` with `mode: "current"`.
   - Proves: live browser bridge attached.

If step 1 passes but 2 fails, check the SSH `-R 4516` reverse forward — that's the MCP path.
If step 2-4 pass but 5 fails, the Oasis browser tab is closed or the screenshot bridge is not mounted.

## Visual Truth

Oasis has three different truths the agent should keep straight:

- world state: persisted build data and live player context from Oasis
- avatar embodiment: agent avatars, movement targets, and avatar screenshots
- browser vision: what the screenshot bridge can currently capture from the live client

Important:
- screenshot tools require a live Oasis browser client
- live player avatar and camera context are refreshed per turn, not continuously every frame
- a screenshot is stronger than verbal assumption when the user is asking about what is visible right now

## Forge And Conjuration

Oasis world-building now includes Forge conjuration tools in the shared tool layer:
- `list_conjured_assets`
- `get_conjured_asset`
- `conjure_asset`
- `process_conjured_asset`
- `place_conjured_asset`
- `delete_conjured_asset`

Use them like this:
- `conjure_asset` to start Meshy or Tripo generation
- `process_conjured_asset` for texture, remesh, rig, or animate
- `place_conjured_asset` to place or reposition an existing conjured asset
- `delete_conjured_asset` to remove it from the active world and optionally from the Forge registry

If the user wants a new 3D asset rather than a catalog asset, prefer these tools over pretending the asset already exists.

## Operating Guidance

- Prefer concise world-aware answers inside Oasis UI surfaces.
- Distinguish between player view, agent view, and external view.
- Do not pretend the agent sees the world if screenshot capture is unavailable.
- Do not claim a generation is finished until the conjured asset status actually says so.
- When the user asks to move relative to them, use live player context or avatar screenshot tools instead of guessing.
- When the user asks for precise visual verification, use screenshot tools rather than narration alone.
- When the user asks for catalog or asset-library content, prefer `search_assets` then `place_object`. Use `craft_scene` for procedural primitives, not catalog assets.

## API Keys Unlock Extra Features

The core progressive smoke test (steps 1-5 above) works with **zero API keys on the Oasis host**. All world state, placement, self-crafting, screenshots, and plain chat run without external providers.

Optional keys in the Oasis `.env` unlock additional tool surface:

| `.env` var | Unlocks |
|---|---|
| `OPENROUTER_API_KEY` | Image generation (textures, material concepts), terrain generation via LLM |
| `FAL_KEY` | Video generation |
| `ELEVENLABS_API_KEY` | Voice notes / TTS in agent panels |
| `MESHY_API_KEY` | Forge conjuration: text-to-3D, image-to-3D, rigging, animation |
| `TRIPO_API_KEY` | Forge conjuration: fast text-to-3D |
| Claude Code CLI on PATH | `craft_scene` sculptor fallback (and powers Merlin, Anorak, Anorak Pro when the user uses those agents locally) |

If a tool requires a key the host does not have, the tool call returns a clear error. Prefer self-craft and catalog placement for zero-config flows.

## Limits

- The skill does not install Oasis itself.
- The skill does not by itself register MCP config in every host agent runtime.
- The plugin injects compact context, but real build power comes from the Oasis MCP tool surface.
- Screenshot tools still depend on a live Oasis browser client in the target world.
- Local Merlin and remote Hermes can share the same tool surface, but runtime UX may still differ by host client.

## Verification

After setup, verify in this order:

1. `get_world_info`
2. `get_world_state`
3. `search_assets`
4. one safe placement or walk tool
5. one screenshot tool with the live browser open

If `get_world_info` works but screenshot tools fail, the MCP transport is up and the browser bridge is the missing link.

## References

- Read `references/current-oasis-transport.md` for the current Oasis transport and runtime boundary.
- Read `references/streamable-http-mcp.example.json` for a generic remote MCP config skeleton.
