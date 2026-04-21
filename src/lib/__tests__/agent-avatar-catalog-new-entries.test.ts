// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// agent-avatar-catalog — new gallery VRM entries resolution
// ─═̷─═̷─ॐ─═̷─═̷─ 11 new drop-in avatars must be discoverable ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import {
  AGENT_AVATAR_CATALOG,
  isKnownAgentAvatarUrl,
  resolveAgentAvatarUrl,
} from '../agent-avatar-catalog'

// The 11 avatars added in this ship — catalog path, expected id, expected name
const NEW_AVATARS: Array<{ path: string; id: string; name: string }> = [
  { path: '/avatars/gallery/CaptainLobster.vrm',     id: 'av_captain_lobster', name: 'Captain Lobster' },
  { path: '/avatars/gallery/DreamFighter.vrm',       id: 'av_dream_fighter',   name: 'Dream Fighter' },
  { path: '/avatars/gallery/EYEWizard.vrm',          id: 'av_eye_wizard',      name: 'Eye Wizard' },
  { path: '/avatars/gallery/EvilPendra.vrm',         id: 'av_evil_pendra',     name: 'Evil Pendra' },
  { path: '/avatars/gallery/Juanita.vrm',            id: 'av_juanita',         name: 'Juanita' },
  { path: '/avatars/gallery/LadyFawn.vrm',           id: 'av_lady_fawn',       name: 'Lady Fawn' },
  { path: '/avatars/gallery/Mr.vrm',                 id: 'av_mr',              name: 'Mr.' },
  { path: '/avatars/gallery/StitchWitch.vrm',        id: 'av_stitch_witch',    name: 'Stitch Witch' },
  { path: '/avatars/gallery/VIPE_Hero__2770.vrm',    id: 'av_vipe_2770',       name: 'VIPE Hero 2770' },
  { path: '/avatars/gallery/VIPE_Hero__2902.vrm',    id: 'av_vipe_2902',       name: 'VIPE Hero 2902' },
  { path: '/avatars/gallery/Witch.vrm',              id: 'av_witch',           name: 'Witch' },
]

describe('AGENT_AVATAR_CATALOG — new 11 entries', () => {
  it('includes all 11 new avatars with correct id/name/path', () => {
    for (const expected of NEW_AVATARS) {
      const match = AGENT_AVATAR_CATALOG.find(e => e.path === expected.path)
      expect(match, `missing entry for ${expected.path}`).toBeTruthy()
      expect(match!.id).toBe(expected.id)
      expect(match!.name).toBe(expected.name)
    }
  })
})

describe('resolveAgentAvatarUrl — new avatar URLs', () => {
  it.each(NEW_AVATARS)('resolves %s by exact path', ({ path, id, name }) => {
    const result = resolveAgentAvatarUrl(path)
    expect(result.url).toBe(path)
    expect(result.resolved).toBe(true)
    expect(result.match).not.toBeNull()
    expect(result.match!.id).toBe(id)
    expect(result.match!.name).toBe(name)
  })

  it('resolves by filename alone (no directory) to the catalog entry', () => {
    // Use a unique-substring filename so the fuzzy matcher doesn't pick up a
    // longer name that happens to include it (e.g. "Witch" ⊂ "StitchWitch").
    const result = resolveAgentAvatarUrl('CaptainLobster.vrm')
    expect(result.match).not.toBeNull()
    expect(result.match!.path).toBe('/avatars/gallery/CaptainLobster.vrm')
    expect(result.url).toBe('/avatars/gallery/CaptainLobster.vrm')
  })

  it('resolves case-insensitively and ignoring spaces', () => {
    const result = resolveAgentAvatarUrl('captain lobster')
    expect(result.match).not.toBeNull()
    expect(result.match!.path).toBe('/avatars/gallery/CaptainLobster.vrm')
  })

  it('resolves by id token', () => {
    const result = resolveAgentAvatarUrl('av_vipe_2770')
    expect(result.match).not.toBeNull()
    expect(result.match!.path).toBe('/avatars/gallery/VIPE_Hero__2770.vrm')
  })
})

describe('isKnownAgentAvatarUrl — new avatars', () => {
  it.each(NEW_AVATARS.map(a => a.path))('returns true for %s', (path) => {
    expect(isKnownAgentAvatarUrl(path)).toBe(true)
  })
})
