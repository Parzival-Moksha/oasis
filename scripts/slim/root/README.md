# The Oasis

Your Claude Code sessions as characters in a 3D village on your own machine. Walk around, see who is working, who is waiting and who needs a decision, and talk to any session by typing or by voice. What you say in the village arrives in that same session.

This repository is the packaged Oasis: the village, the agent engine, the Claude Code plugin and a Hermes skill, with only assets that may be passed on. It is made from the authors' main repository by a script, so changes made here by hand are overwritten.

## Install with Claude Code

```
/plugin marketplace add Parzival-Moksha/uploader
/plugin install oasis@oasis
```

Then type `/oasis` in any session. The first time it downloads this repository's release, installs its packages and builds it (a few minutes, once). After that it starts in seconds and opens the village in your browser.

## Or by hand

You need Node.js 20 or later and Claude Code.

```
git clone --depth 1 https://github.com/Parzival-Moksha/uploader.git
cd uploader
node scripts/oasis.mjs start
```

`node scripts/oasis.mjs status` says what is running, `node scripts/oasis.mjs stop` stops it. It works the same on Windows, macOS and Linux. (macOS and Linux: written with care, not yet run by us on a Mac.)

## What runs on your machine

- **The page server** on `127.0.0.1:4516` (Next.js): the 3D village in your browser.
- **The agent engine** on `127.0.0.1:4530`: it lists your Claude Code sessions from `~/.claude/projects`, mirrors them, and runs the ones you start in the village as ordinary `claude` processes under your own account, with the permission mode you choose. Permission prompts appear in the village for you to answer; nothing is approved for you.
- Both listen on this machine only. Nothing is sent to us: no account, no telemetry.

## Voice

- Agents can speak. By default they use your browser's built-in voices: free, no key.
- You can talk instead of typing where your browser offers speech recognition.
- Optional: an ElevenLabs voice with your own key (`ELEVENLABS_API_KEY` in `.env`). Then the text to be spoken goes to ElevenLabs under your account.

## What the characters can do today

- Your own body and every agent stand, idle, walk, jog, sprint, roll, talk with moving hands, cast, flinch and fall. These come from the Quaternius Universal Animation Library (CC0).
- They do not dance, sit, wave or emote yet. The dances and some walks in the authors' own Oasis are Mixamo files, which Adobe does not allow to be passed on as files, so they are not in this package. A free set is being added.
- With an ElevenLabs voice, an agent's mouth follows its words. With the browser's built-in voice it speaks, but the mouth does not move yet.
- 41 avatars in the full Oasis, 12 in the lite one. All state CC0 in their own files.

## Licences

The code is MIT (see `LICENSE`). Pictures, 3D models, avatars, animations, sounds and fonts keep the licences of their authors. Every avatar, sound, picture, animation and font is listed with its source and licence in `ASSETS.md`.
