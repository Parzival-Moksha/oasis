# Skills

This repo ships installable agent skills.

## openclaw-04515

- Public skill URL after deploy: `https://openclaw.04515.xyz/skill.md`
- Repo path: `skills/openclaw-04515`
- Target user flow: open `https://openclaw.04515.xyz`, mint a pairing code, give the code or pairing URL to OpenClaw, and let OpenClaw run the hosted relay bridge.

Use this skill when connecting a local OpenClaw runtime to the hosted 04515 Oasis. It is the product-facing hosted relay path, not the legacy SSH/local MCP path.

## oasis

- Repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Install command: `hermes skills install Parzival-Moksha/oasis/skills/oasis`
- Tap command: `hermes skills tap add Parzival-Moksha/oasis`

Use this skill when you want Hermes, OpenClaw, or another MCP-capable agent to connect to a locally run Oasis. This remains the canonical local/developer skill for same-machine MCP, laptop-to-VPS SSH tunnels, and local Oasis troubleshooting.
