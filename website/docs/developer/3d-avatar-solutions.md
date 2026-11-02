---
sidebar_position: 8
title: 3D Avatar Solution Candidates
---

# 3D Avatar Solution Candidates

Working scratchpad for avatar stacks worth testing for Oasis/OpenClaw embodied
agents. Keep this practical: every candidate should map to the current Three.js /
React Three Fiber world, agent-avatar tools, voice, lip sync, and hosted product
path.

## Current Baseline

- Oasis already loads VRM avatars with `@pixiv/three-vrm`.
- Agent bodies are driven through `set_avatar`, `walk_avatar_to`,
  `list_avatar_animations`, and `play_avatar_animation`.
- Existing gallery avatars live under `public/avatars/gallery/`.
- Current lip-sync work is VRM/AIUEO-oriented (`aa`, `ih`, `ou`, `ee`, `oh`).

## Candidate: Avaturn

Source:
- https://docs.avaturn.me/docs/integration/web/threejs/
- https://docs.avaturn.me/docs/integration/bodies/

What it is:
- Web avatar creator/export flow that can be embedded into a Three.js app.
- Avaturn opens as an iframe and sends an avatar GLB back to the app.
- Their Three.js example loads the returned GLB with `GLTFLoader`.
- Avatar type `T1` is more realistic/lightweight but has a static face.
- Avatar type `T2` supports face animation with ARKit blendshapes and visemes,
  at the cost of slightly less recognizability.
- Their docs also include a GLB-to-VRM conversion path, which matters because
  Oasis's strongest avatar path today is VRM-first.

Why it might fit Oasis:
- Fast route from "make yourself / make the customer-service agent" to an actual
  humanoid avatar in-world.
- Direct Three.js integration lines up with the existing R3F world.
- T2 face support could be useful for ElevenLabs/OpenAI realtime voice demos,
  especially a Fonio-style customer-service agent roleplay.
- GLB export can be tested before committing to deeper VRM conversion.

Demo wedge it supports:
- "Meet a Fonio-style AI receptionist in the Oasis."
- User enters a 3D lobby, walks up to an Avaturn-generated service avatar, speaks
  by realtime voice, and the agent books/cancels/reschedules a fake appointment.
- Voice provider can be ElevenLabs Conversational AI or OpenAI Realtime; Fonio is
  the product/workflow inspiration, not necessarily the provider layer.

Likely integration path:
1. Add a small Avaturn iframe launcher panel in a dev-only avatar lab.
2. Receive the exported GLB URL from the Avaturn callback.
3. Load it into an isolated R3F preview with `GLTFLoader`.
4. Test animation compatibility against Oasis walk/idle clips.
5. Test T2 facial blendshapes/visemes against the existing lip-sync driver.
6. If GLB runtime works, decide whether to store GLB as an agent avatar URL or
   convert to VRM for the existing avatar pipeline.

Unknowns / checks before betting:
- Licensing and whether generated avatars can be used commercially in hosted
  Oasis/OpenClaw demos.
- Whether the exported GLB skeleton retargets cleanly to current animation clips.
- Whether T2 ARKit blendshapes map cleanly to Oasis's AIUEO lip-sync state or
  need a separate ARKit-to-AIUEO adapter.
- Whether Avaturn iframe/export requires account-level setup, custom subdomain,
  or paid API access.
- Asset size and mobile load cost.
- Whether hosted production can persist user-created avatars safely without
  storing private/PII-heavy face data in repo artifacts.

Current take:
- Good candidate for a polished human agent/customer-service avatar demo.
- Do not replace the existing VRM gallery yet.
- First proof should be a local avatar lab: create/export one T2 avatar, load it
  in-world, make it idle/walk, and drive mouth movement from a test voice clip.
