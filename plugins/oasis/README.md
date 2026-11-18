# The Oasis

Your Claude Code sessions as characters in a 3D village that runs on your own machine. You walk around, see who is working, who is waiting and who needs a decision, and talk to any session by typing or by voice. What you say in the village arrives in that same session, so the desktop app, the terminal and the village all show one conversation.

## Install

```
/plugin marketplace add Parzival-Moksha/oasis
/plugin install oasis@oasis
```

Then type `/oasis` in any session. It starts the Oasis if it is not running, opens the village in your browser and walks the camera to that session's avatar. `/oasis status` says what is running.

## What the plugin adds

- `/oasis` and `/oasis status`, answered by the plugin itself: no model turn is spent.
- A bridge: once a second the session asks the local Oasis engine whether you said something to it in the village, and submits that as a prompt of this session. While the session replies, the text is sent to the engine so the village shows it word by word.
- One short note in the system prompt (about 200 tokens) while the Oasis is running, saying that the session has an avatar there.
- The Oasis world tools (look at the world, place and change things, take a screenshot), from the Oasis running on your machine.

## What it runs, sends and fetches

- **Runs:** on `/oasis`, the launcher script in `scripts/`, which starts the two local Oasis servers (the page on port 4516, the agent engine on port 4530) and opens your browser. Nothing starts until you type `/oasis`.
- **Sends:** requests to `http://127.0.0.1:4530` (the engine) and `http://127.0.0.1:4516` (the page) on your own machine: the session id, its working folder, and the text of replies while they stream. Nothing is sent to any other address.
- **Fetches:** nothing from the internet.
- **Reads from the environment:** `OASIS_ENGINE_URL`, `OASIS_HOME`, `OASIS_MISSIONS_DIR`, `OASIS_GRILL_FILE`, `OASIS_AGENT_ID` and `OS`, to find the local Oasis. No credentials.
- The Oasis app itself reads your Claude Code session transcripts in `~/.claude/projects` to show your sessions and their history. They stay on your machine.

When the Oasis is not running, the plugin does nothing: its requests fail quietly.

## Privacy

Everything stays on your machine. See [Privacy](./PRIVACY.md).

## Licence

MIT. See [LICENSE](./LICENSE).
