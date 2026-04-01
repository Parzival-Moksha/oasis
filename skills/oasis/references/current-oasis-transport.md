# Current Oasis Hermes Transport

This reference describes the current Oasis implementation as of April 1, 2026.

## Distribution

- Repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Install command: `hermes skills install Parzival-Moksha/oasis/skills/oasis`

## Current Files

- `src/app/api/hermes/route.ts`
- `src/components/forge/HermesPanel.tsx`
- `src/components/Scene.tsx`

## Current Oasis-Side Configuration Inputs

The Oasis server route resolves config in this order:

1. Local pairing file: `data/hermes-config.local.json`
2. Server env fallback:

- `HERMES_API_BASE`
- `HERMES_API_KEY`
- `HERMES_MODEL` (optional default model)
- `HERMES_SYSTEM_PROMPT` (optional)

If no API key is available from pairing or env fallback, the Hermes panel will show an unconfigured state and the route will return an error.

Important: this is Oasis server configuration, not browser configuration.

## Current Transport Shape

Oasis currently expects an OpenAI-style Hermes API server and proxies through `POST /api/hermes`.

The route:

- checks `GET /v1/models` for connectivity
- sends chat to `POST /v1/chat/completions`
- uses `stream: true`
- transforms upstream SSE into local SSE events

The local Oasis stream currently emits these event types when present:

- `meta`
- `text`
- `reasoning`
- `tool`
- `usage`
- `done`
- `error`

Whether reasoning or tool chunks actually appear depends on what Hermes emits upstream.

## Current Remote Setup

For Hermes on a VPS and Oasis on a local machine:

1. Keep Hermes API bound to `127.0.0.1:8642`
2. Set `API_SERVER_KEY` on the Hermes side
3. Open a tunnel from the Oasis machine:

```bash
ssh -L 8642:127.0.0.1:8642 user@vps -N
```

4. In Oasis Hermes panel, click `pair`, then paste:

```env
HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=your_secret_here
HERMES_MODEL=optional_model_id
```

5. Save pairing in the panel
6. Press `sync`

## Current Limitations

- Installing the Oasis skill on Hermes does not automatically install Oasis itself.
- The current Oasis implementation still needs a one-time pairing paste in the Oasis panel.
- There is not yet an encrypted credential store, hosted multi-user auth layer, or user-account ACL around `/api/hermes`.
- Oasis does not currently provide Hermes with world state unless a separate bridge or MCP server is added.

## Recommended Truthful Framing

When guiding users, say:

- the skill teaches Hermes how Oasis works
- the current transport still needs one-time setup
- pairing paste removes `.env.local` editing for the common local workflow
- a future MCP or bridge would be needed for true world awareness
