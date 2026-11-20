# oasis-village

The Oasis: your coding agents (Claude Code sessions, Hermes agents) as characters in a 3D village on your own machine. You walk around, see who is working and who needs a decision, and talk to any of them by typing or by voice.

```
npx oasis-village          install (the first time) and open the full Oasis, about 570 MB
npx oasis-village --lite   the small edition, about 30 MB, for a quick look
```

You need Node.js 20 or later.

## What this package does

It is one small launcher. The first time, it downloads one file, the packaged Oasis, from this project's GitHub releases (https://github.com/Parzival-Moksha/uploader/releases), at the version and SHA-256 checksum written in `release.json` in this package; a file that does not match is deleted and nothing is installed. It unpacks it to `~/.oasis/app`, where the Oasis's own start script installs its npm packages from its lockfile and builds it (a few minutes, once). Then, and every later time, it starts two servers on your machine only (the page on `127.0.0.1:4516`, the agent engine on `127.0.0.1:4530`) and opens your browser.

Nothing is sent to the authors: no account, no telemetry. The servers refuse requests without a local key made on the first start.

To stop it: `node ~/.oasis/app/scripts/oasis.mjs stop`. To remove it: delete `~/.oasis`.

MIT. Source, assets and their licences: https://github.com/Parzival-Moksha/uploader
