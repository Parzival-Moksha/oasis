---
name: oasis
description: Teach Hermes how to work with the Oasis interface, connect to the Oasis Hermes panel, verify the transport, and troubleshoot current setup limits.
version: 0.1.0
author: Levi
license: MIT
metadata:
  hermes:
    tags: [oasis, 3d-ui, connector, remote-chat, transport]
    category: integrations
required_environment_variables:
  - name: API_SERVER_KEY
    prompt: Hermes API server bearer key
    help: Set the same key used by the Hermes API server. Oasis uses it server-side when proxying chat.
    required_for: Oasis connection verification and setup guidance
---

# Oasis

Oasis is a 3D-first interface layer for talking to Hermes, inspecting agent behavior, and eventually giving the agent world awareness. This skill teaches Hermes how Oasis works today, how the current Hermes panel is wired, what can and cannot be automated, and how to guide a user through connection or troubleshooting without pretending capabilities that do not exist yet.

## When to Use

Use this skill when:

- the user mentions Oasis, the Oasis Hermes panel, the Hermes button, `sync`, or an `UNCONFIGURED` Hermes state
- the user wants Hermes connected to Oasis, especially from a VPS to a local Oasis instance
- the user asks how Oasis sees Hermes: text, models, tool activity, reasoning, usage, or world state
- the user wants to troubleshoot Oasis-side Hermes setup, transport, or security
- the user asks about future Oasis pairing, MCP, avatar embodiment, or world-aware modes

Do not use this skill for generic coding or general chat unless Oasis integration is explicitly relevant.

## Quick Reference

- Oasis repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Install directly from GitHub: `hermes skills install Parzival-Moksha/oasis/skills/oasis`
- Add the repo as a tap: `hermes skills tap add Parzival-Moksha/oasis`
- Verify the Hermes API server with the bundled helper: `scripts/check_hermes_api.py`
- Emit a paste-ready Oasis pairing block: `scripts/write_oasis_env.py`
- Preferred remote tunnel from the Oasis machine: `ssh -L 8642:127.0.0.1:8642 user@vps -N`
- Current Oasis-side config inputs: paired block (`HERMES_API_BASE`, `HERMES_API_KEY`, optional `HERMES_MODEL`, optional `HERMES_SYSTEM_PROMPT`) with env fallback
- Current Hermes checks: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` with `stream: true`

## Procedure

1. Identify the topology before giving setup advice.
   - Same machine: Hermes and Oasis run on the same host, VM, or WSL environment.
   - Split machine: Hermes runs on a VPS and Oasis runs on a local desktop. This is the current common case.
   - Hosted Oasis: the Oasis app is reachable over a public domain.

2. Verify Hermes-side prerequisites first.
   - Confirm the Hermes API server is enabled and reachable on loopback.
   - Prefer the bundled `scripts/check_hermes_api.py` helper before ad-hoc shell parsing.
   - Confirm `/v1/models` returns at least one model before blaming Oasis.

3. Give setup advice that matches the topology.
   - Same machine: provide exact setup commands and env keys, but keep the user in control of Oasis installation and configuration.
   - Split machine: provide exact setup commands and env keys, but keep the user in control of Oasis installation and configuration.
   - Hosted Oasis: treat `/api/hermes` as a sensitive proxy and require real app auth before routing traffic.

4. Explain the current Oasis transport accurately.
   - The browser does not talk to Hermes directly.
   - Oasis uses a server-side `/api/hermes` proxy.
   - That proxy resolves config from local pairing storage first, then falls back to Oasis server env vars.
   - The panel can currently show chat, models, streamed text, optional reasoning chunks, optional tool call chunks, and usage if the upstream emits them.

5. Be explicit about the current automation boundary.
   - Installing this skill teaches Hermes the workflow and communication style for Oasis onboarding.
   - Installing this skill does not install Oasis automatically.
   - This skill can guide the user and output a pairing block, but the user still performs a one-time paste in Oasis.

6. Recommend the right near-term path for "sexy window, minimal hassle".
   - Today: SSH tunnel or private network plus one-time pairing paste in the Oasis Hermes panel.
   - Hermes can run `scripts/write_oasis_env.py` to produce the pairing block fast.
   - For hosted/public Oasis, require app auth before exposing `/api/hermes` externally.

7. Inside Oasis conversations, behave for a compact UI.
   - Prefer concise, structured answers.
   - If the user asks what Hermes can see, distinguish among plain text, tool activity, reasoning summaries, and true world state.
   - Never pretend to have world awareness or direct build powers unless a real Oasis bridge or MCP server is present.

8. Troubleshoot unconfigured states precisely.
   - If Oasis is unconfigured, explain that the missing key is in Oasis server-side config (pairing store or env), not in the browser.
   - If `sync` fails, verify tunnel, `/health`, `/v1/models`, and model selection.
   - If the model list loads but chat fails, inspect the upstream `/v1/chat/completions` path and stream behavior.

9. When asked for the "just make it work" path, use this response format.
   - Step A: install the Oasis skill using `hermes skills install Parzival-Moksha/oasis/skills/oasis`.
   - Step B: output a pairing block exactly in this env format:
     `HERMES_API_BASE=...`
     `HERMES_API_KEY=...`
     `HERMES_MODEL=...` (optional)
   - Step C: show the exact SSH tunnel command.
   - Step D: tell the user to open Oasis, click `pair`, paste the block, save, press `sync`, and send a short test message.
   - Step E: include one fallback check if the panel still shows `UNCONFIGURED`.

## Pitfalls

- A skill is agent memory and workflow, not a real-time transport adapter.
- Do not bind the Hermes API server to `0.0.0.0` over plain HTTP.
- Do not paste `API_SERVER_KEY` into ordinary chat text.
- Remote VPS plus local Oasis still needs a one-time local pairing paste with the current Oasis implementation.
- Oasis currently does not give Hermes world awareness, avatar control, or direct world-edit authority on its own.
- If the user wants true zero-touch pairing, explain that it requires additional Oasis product work beyond the current one-time pairing flow.

## Verification

- Hermes API health responds successfully.
- `/v1/models` returns at least one model.
- If remote, the tunnel from the Oasis machine is active.
- Oasis `sync` shows connected and lists models.
- A short test prompt streams back in the Oasis Hermes panel.

## References

- Read `references/current-oasis-transport.md` for the exact current Oasis-side behavior and env expectations.
- Use `scripts/check_hermes_api.py` for Hermes-side API verification before offering connection advice.
