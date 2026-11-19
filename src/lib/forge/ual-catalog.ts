// Every clip in the two free Quaternius packs the Oasis ships (public/animations/ual/, CC0:
// "Free to use in personal, educational and commercial projects"), so the animation browser can play
// any of them on the owner's avatar. Names read from the GLB files on 2026-11-19 (two A_TPose left out).

import { ANIMATION_LIBRARY, type AnimCategory } from './animation-library'

export const UAL_PACKS: Record<string, string[]> = {
  'ual/UAL1_Standard.glb': [
    'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Death01', 'Driving_Loop', 'Fixing_Kneeling', 'Hit_Chest', 'Hit_Head',
    'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Interact', 'Jog_Fwd_Loop', 'Jump_Land', 'Jump_Loop', 'Jump_Start',
    'PickUp_Table', 'Pistol_Aim_Down', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Idle_Loop', 'Pistol_Reload', 'Pistol_Shoot',
    'Punch_Cross', 'Punch_Jab', 'Push_Loop', 'Roll', 'Roll_RM', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop',
    'Sitting_Talking_Loop', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Sprint_Loop',
    'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Sword_Attack', 'Sword_Attack_RM', 'Sword_Idle', 'Walk_Formal_Loop', 'Walk_Loop',
  ],
  'ual/UAL2_Standard.glb': [
    'Chest_Open', 'ClimbUp_1m_RM', 'Consume', 'Farm_Harvest', 'Farm_PlantSeed', 'Farm_Watering', 'Hit_Knockback', 'Hit_Knockback_RM',
    'Idle_FoldArms_Loop', 'Idle_Lantern_Loop', 'Idle_No_Loop', 'Idle_Rail_Call', 'Idle_Rail_Loop', 'Idle_Shield_Break', 'Idle_Shield_Loop',
    'Idle_TalkingPhone_Loop', 'LayToIdle', 'Melee_Hook', 'Melee_Hook_Rec', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'NinjaJump_Start',
    'OverhandThrow', 'Shield_Dash_RM', 'Shield_OneShot', 'Slide_Exit', 'Slide_Loop', 'Slide_Start', 'Sword_Block', 'Sword_Dash_RM',
    'Sword_Regular_A', 'Sword_Regular_A_Rec', 'Sword_Regular_B', 'Sword_Regular_B_Rec', 'Sword_Regular_C', 'Sword_Regular_Combo',
    'TreeChopping_Loop', 'Walk_Carry_Loop', 'Yes', 'Zombie_Idle_Loop', 'Zombie_Scratch', 'Zombie_Walk_Fwd_Loop',
  ],
}

export interface UalClip { id: string; file: string; clip: string; label: string; group: string }

function groupOf(clip: string): string {
  if (/Walk|Jog|Sprint|Crouch|Swim|Slide|Climb|Roll|Jump/.test(clip)) return 'Moving'
  if (/Idle|Sitting|Driving|Lay/.test(clip)) return 'Standing and sitting'
  if (/Sword|Shield|Pistol|Punch|Melee|Hit|Death|Throw|Spell/.test(clip)) return 'Fighting'
  return 'Doing things'
}

const pretty = (clip: string) => clip.replace(/_RM$/, ' (moves)').replace(/_Loop$/, '').replace(/_/g, ' ')

let cached: UalClip[] | null = null

/** All free clips, each with a library id (an existing one when the Oasis already names that clip). */
export function freeUalClips(): UalClip[] {
  if (cached) return cached
  const out: UalClip[] = []
  for (const [file, clips] of Object.entries(UAL_PACKS)) {
    for (const clip of clips) {
      const known = ANIMATION_LIBRARY.find(a => a.filename === file && a.glbClipName === clip)
      let id = known?.id
      if (!id) {
        id = `ualfree-${file.includes('UAL2') ? 2 : 1}-${clip}`
        const category: AnimCategory = groupOf(clip) === 'Fighting' ? 'combat' : groupOf(clip) === 'Moving' ? 'locomotion' : 'emote'
        ANIMATION_LIBRARY.push({ id, filename: file, glbClipName: clip, label: pretty(clip), category })
      }
      out.push({ id, file, clip, label: pretty(clip), group: groupOf(clip) })
    }
  }
  cached = out
  return out
}
