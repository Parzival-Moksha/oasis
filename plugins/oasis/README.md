# The Oasis

Your Claude Code sessions as characters in a 3D village that runs on your own machine. You walk around, see who is working, who is waiting and who needs a decision, and talk to any session by typing or by voice. What you say in the village arrives in that same session, so the desktop app, the terminal and the village all show one conversation.

## Install

```
/plugin marketplace add Parzival-Moksha/oasis-lite
/plugin install oasis@oasis
```

Then type `/oasis` in any session. You need Node.js 20 or later on your PATH.

The first `/oasis` installs the Oasis itself (see below): a few minutes, once. After that it starts in seconds, opens the village in your browser and walks the camera to that session's avatar. `/oasis status` says what is running.

## What the plugin adds

- `/oasis` and `/oasis status`, answered by the plugin itself: no model turn is spent.
- A bridge: once a second the session asks the Oasis engine on this machine whether you said something to it in the village, and submits that as a prompt of this session. While the session replies, the text is sent to the engine so the village shows it word by word.
- One short note in the system prompt (about 200 tokens) while the Oasis is running, saying that the session has an avatar there.
- The Oasis world tools (look at the world, place and change things in it, take a screenshot), through a small local server in this plugin (`mcp/oasis-mcp.mjs`) that passes each call to the Oasis on this machine. It offers no tool that generates pictures, video, music or speech.

## What it runs, sends and fetches

- **Runs, on `/oasis`:** `node scripts/oasis-launch.mjs`. It looks for the Oasis on this machine (`OASIS_HOME`, or `~/.oasis/app`) and runs its start script, which starts two local servers (the page on `127.0.0.1:4516`, the agent engine on `127.0.0.1:4530`) and opens your browser.
- **Fetches, on the first `/oasis` only:** one file, the slim Oasis, from this project's own GitHub releases, at the exact version and SHA-256 checksum written in `scripts/release.json`. A file that does not match the checksum is deleted and nothing is installed. It is unpacked to `~/.oasis/app`. The Oasis's own start script then installs its npm packages from its lockfile (with pnpm) and builds it. Nothing else is downloaded by the plugin, and nothing is fetched again until you update the plugin.
- **Runs, per session:** `node mcp/oasis-mcp.mjs` (the world tools, started by Claude Code), and once `node scripts/oasis-launch.mjs --token`, which reads the Oasis's local key from `~/.oasis/token`.
- **Sends:** requests to `http://127.0.0.1:4530` and `http://127.0.0.1:4516` on your own machine only: the session id, its working folder, the text of replies while they stream, world-tool calls, and the local key. Nothing is sent to any other address. The world-tools server refuses to talk to anything but a loopback address.
- **Reads from the environment:** `OASIS_ENGINE_URL`, `OASIS_WEB_URL`, `OASIS_HOME`, `OASIS_DATA_DIR`, `OASIS_TOKEN_FILE`, `OASIS_MISSIONS_DIR`, `OASIS_GRILL_FILE`, `OASIS_AGENT_ID`, to find the local Oasis. No credentials of yours are read.
- **The local key:** the Oasis makes a random key on its first start and refuses requests to its agent and tool routes without it, so another user of the computer or a page in another browser tab cannot drive your agents. The plugin sends it to the local Oasis and nowhere else.
- **The Oasis app** reads your Claude Code session transcripts in `~/.claude/projects` to list your sessions and show their history, and runs the sessions you start in the village as ordinary `claude` processes under your own account. Permission prompts are shown to you in the village; nothing is approved for you. All of it stays on your machine.

When the Oasis is not running, the plugin does nothing: its requests fail quietly and the tool list is empty.

## Voice

Agents in the village can speak, by default with your browser's built-in voices: no key, nothing leaves the machine. An ElevenLabs voice with your own key is an option you switch on in the Oasis's `.env` file; then the text to be spoken goes to ElevenLabs under your account.

## Privacy

Everything stays on your machine. See [Privacy](./PRIVACY.md).

## Licence

MIT. See [LICENSE](./LICENSE).
