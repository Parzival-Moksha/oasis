---
sidebar_position: 6
title: Audio System
---

# Audio System

The Oasis AudioManager handles 102 sound events across 20 event categories using the Web Audio API.

## Event Types

Sounds play automatically on UI interactions, object operations, and world events:

- **UI interactions** — button clicks, tab switches, panel opens
- **Object creation** — conjure complete, craft finish
- **Object placement** — asset dropped in world
- **Object movement** — drag/rotate/scale feedback
- **World events** — sky change, terrain generation
- **Agent events** — message sent, response received
- **Mission events** — timer start, completion

## Sound Library

102 selectable sounds from:

- **Kenney UI Audio** — clean, game-ready UI sounds (CC0)
- **Web Audio synthesis** — procedurally generated tones and effects

## Configuration

Each event type has:

- **Sound selection** — choose which sound plays for each event
- **Volume** — per-event volume control
- **Playback settings** — rate, pitch adjustments

Audio settings are configured through the AudioManager UI accessible from the Wizard Console.

## Technical Details

- Uses the **Web Audio API** natively (no libraries)
- Sounds are lazy-loaded on first play
- Synthesis sounds are generated in real-time (no files needed)
- Audio context is created on first user interaction (browser requirement)
