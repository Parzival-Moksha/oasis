// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANIMATION LIBRARY — Local dance moves, no API calls, infinite groove
// ─═̷─═̷─ॐ─═̷─═̷─ The dancefloor was built. Now we turn on the music. ─═̷─═̷─ॐ─═̷─═̷─
//
// Mixamo FBX files (downloaded without skin) → loaded with FBXLoader →
// AnimationClips extracted → retargeted to any rigged character.
//
// Providers rig differently:
//   Meshy: bone names like "Hips", "Spine", "LeftArm" (no prefix)
//   Tripo: bone names like "mixamorigHips", "mixamorigSpine" (mixamorig prefix)
//   Mixamo FBX: tracks like "mixamorigHips.quaternion"
//
// The retargetClip() function bridges these worlds.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

const OASIS_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_BASE_PATH || '')
  : ''

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION CATALOG — What's on the jukebox
// ═══════════════════════════════════════════════════════════════════════════════

export type AnimCategory = 'locomotion' | 'dance' | 'combat' | 'emote' | 'acrobatics' | 'survival' | 'idle-var'

export interface LocalAnimation {
  id: string
  filename: string
  label: string
  category: AnimCategory
  glbClipName?: string
}

export const ANIMATION_LIBRARY: LocalAnimation[] = [
  // ░▒▓ Locomotion ▓▒░
  { id: 'idle',        filename: 'ual/UAL1_Standard.glb',            label: 'Idle',          category: 'locomotion', glbClipName: 'Idle_Loop' },
  { id: 'walk',        filename: 'Unarmed Walk Forward.fbx',        label: 'Walk',       category: 'locomotion' },
  { id: 'run',         filename: 'Medium Run.fbx',                  label: 'Run',           category: 'locomotion' },
  { id: 'sprint',      filename: 'Running.fbx',                     label: 'Sprint',        category: 'locomotion' },
  { id: 'idle-fight',  filename: 'Standing Idle To Fight Idle.fbx',  label: 'Fight Idle',       category: 'locomotion' },
  { id: 'drunk-walk',  filename: 'Drunk Walk.fbx',                  label: 'Drunk Walk', category: 'locomotion' },
  { id: 'catwalk',     filename: 'Catwalk Walk Turn 180 Tight.fbx', label: 'Catwalk',    category: 'locomotion' },
  { id: 'low-crawl',   filename: 'Low Crawl.fbx',                   label: 'Low Crawl',  category: 'locomotion' },

  // ░▒▓ Dance ▓▒░
  { id: 'breakdance',  filename: 'Breakdance 1990.fbx',             label: 'Breakdance',     category: 'dance' },
  { id: 'freeze',      filename: 'Breakdance Freeze Var 3.fbx',     label: 'Freeze',         category: 'dance' },
  { id: 'twirl',       filename: 'Butterfly Twirl.fbx',             label: 'Butterfly Twirl',category: 'dance' },
  { id: 'capoeira',    filename: 'Capoeira.fbx',                    label: 'Capoeira',       category: 'dance' },
  { id: 'hip-hop',     filename: 'Hip Hop Dancing.fbx',             label: 'Hip Hop',        category: 'dance' },
  { id: 'moonwalk',    filename: 'Moonwalk.fbx',                    label: 'Moonwalk',       category: 'dance' },
  { id: 'shuffling',   filename: 'Shuffling.fbx',                   label: 'Shuffling',      category: 'dance' },
  { id: 'thriller',    filename: 'Thriller Part 3.fbx',             label: 'Thriller',       category: 'dance' },
  { id: 'twerk',       filename: 'Dancing Twerk.fbx',               label: 'Twerk',          category: 'dance' },
  { id: 'twist',       filename: 'Twist Dance.fbx',                 label: 'Twist',          category: 'dance' },

  // ░▒▓ Combat ▓▒░
  { id: 'mma-kick',    filename: 'Mma Kick.fbx',                    label: 'MMA Kick',  category: 'combat' },

  // ░▒▓ Emote ▓▒░
  { id: 'praying',     filename: 'Praying.fbx',                     label: 'Praying',   category: 'emote' },
  { id: 'situps',      filename: 'Situps.fbx',                      label: 'Situps',    category: 'emote' },

  // ░▒▓ Acrobatics ▓▒░
  { id: 'jump',        filename: 'Jump.fbx',                        label: 'Jump',       category: 'acrobatics' },
  { id: 'front-flip',  filename: 'Front Flip.fbx',                  label: 'Front Flip', category: 'acrobatics' },
  { id: 'twist-flip',  filename: 'Front Twist Flip.fbx',            label: 'Twist Flip', category: 'acrobatics' },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ░▒▓ UAL (Universal Animation Library) — GLB packs ▓▒░
  // ═══════════════════════════════════════════════════════════════════════════════

  // ░▒▓ UAL1 Locomotion ▓▒░
  { id: 'ual-crouch-fwd',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Crouch_Fwd_Loop',     label: 'Crouch Walk',    category: 'locomotion' },
  { id: 'ual-crouch-idle',    filename: 'ual/UAL1_Standard.glb', glbClipName: 'Crouch_Idle_Loop',    label: 'Crouch Idle',    category: 'locomotion' },
  { id: 'ual-jog',            filename: 'ual/UAL1_Standard.glb', glbClipName: 'Jog_Fwd_Loop',       label: 'Jog',            category: 'locomotion' },
  { id: 'ual-walk-formal',    filename: 'ual/UAL1_Standard.glb', glbClipName: 'Walk_Formal_Loop',   label: 'Formal Walk',    category: 'locomotion' },
  { id: 'ual-walk',           filename: 'ual/UAL1_Standard.glb', glbClipName: 'Walk_Loop',          label: 'UAL Walk',       category: 'locomotion' },
  { id: 'ual-sprint',         filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sprint_Loop',        label: 'UAL Sprint',     category: 'locomotion' },
  { id: 'ual-push',           filename: 'ual/UAL1_Standard.glb', glbClipName: 'Push_Loop',          label: 'Push',           category: 'locomotion' },
  { id: 'ual-roll',           filename: 'ual/UAL1_Standard.glb', glbClipName: 'Roll',               label: 'Roll',           category: 'locomotion' },
  { id: 'ual-swim-fwd',       filename: 'ual/UAL1_Standard.glb', glbClipName: 'Swim_Fwd_Loop',     label: 'Swim',           category: 'locomotion' },
  { id: 'ual-swim-idle',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Swim_Idle_Loop',    label: 'Swim Idle',      category: 'locomotion' },

  // ░▒▓ UAL2 Locomotion ▓▒░
  { id: 'ual-walk-carry',     filename: 'ual/UAL2_Standard.glb', glbClipName: 'Walk_Carry_Loop',    label: 'Walk Carry',     category: 'locomotion' },
  { id: 'ual-slide',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'Slide_Loop',         label: 'Slide',          category: 'locomotion' },
  { id: 'ual-climb',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'ClimbUp_1m_RM',      label: 'Climb',          category: 'locomotion' },

  // ░▒▓ UAL1 Dance ▓▒░
  { id: 'ual-dance',          filename: 'ual/UAL1_Standard.glb', glbClipName: 'Dance_Loop',         label: 'UAL Dance',      category: 'dance' },

  // ░▒▓ UAL1 Combat ▓▒░
  { id: 'ual-pistol-idle',    filename: 'ual/UAL1_Standard.glb', glbClipName: 'Pistol_Idle_Loop',   label: 'Pistol Idle',    category: 'combat' },
  { id: 'ual-pistol-aim',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Pistol_Aim_Neutral', label: 'Pistol Aim',     category: 'combat' },
  { id: 'ual-pistol-shoot',   filename: 'ual/UAL1_Standard.glb', glbClipName: 'Pistol_Shoot',      label: 'Pistol Shoot',   category: 'combat' },
  { id: 'ual-pistol-reload',  filename: 'ual/UAL1_Standard.glb', glbClipName: 'Pistol_Reload',     label: 'Pistol Reload',  category: 'combat' },
  { id: 'ual-punch-cross',    filename: 'ual/UAL1_Standard.glb', glbClipName: 'Punch_Cross',       label: 'Punch Cross',    category: 'combat' },
  { id: 'ual-punch-jab',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Punch_Jab',         label: 'Punch Jab',      category: 'combat' },
  { id: 'ual-sword-attack',   filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sword_Attack',      label: 'Sword Attack',   category: 'combat' },
  { id: 'ual-sword-idle',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sword_Idle',        label: 'Sword Idle',     category: 'combat' },
  { id: 'ual-spell-idle',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Spell_Simple_Idle_Loop', label: 'Spell Idle', category: 'combat' },
  { id: 'ual-spell-shoot',    filename: 'ual/UAL1_Standard.glb', glbClipName: 'Spell_Simple_Shoot', label: 'Spell Shoot',   category: 'combat' },
  { id: 'ual-hit-chest',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Hit_Chest',         label: 'Hit Chest',      category: 'combat' },
  { id: 'ual-hit-head',       filename: 'ual/UAL1_Standard.glb', glbClipName: 'Hit_Head',          label: 'Hit Head',       category: 'combat' },
  { id: 'ual-death',          filename: 'ual/UAL1_Standard.glb', glbClipName: 'Death01',           label: 'Death',          category: 'combat' },

  // ░▒▓ UAL2 Combat ▓▒░
  { id: 'ual-melee-hook',     filename: 'ual/UAL2_Standard.glb', glbClipName: 'Melee_Hook',        label: 'Melee Hook',     category: 'combat' },
  { id: 'ual-sword-block',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Sword_Block',       label: 'Sword Block',    category: 'combat' },
  { id: 'ual-sword-combo',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Sword_Regular_Combo', label: 'Sword Combo',  category: 'combat' },
  { id: 'ual-shield-idle',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_Shield_Loop',  label: 'Shield Idle',    category: 'combat' },
  { id: 'ual-shield-dash',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Shield_Dash_RM',    label: 'Shield Dash',    category: 'combat' },
  { id: 'ual-throw',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'OverhandThrow',     label: 'Throw',          category: 'combat' },
  { id: 'ual-hit-knockback',  filename: 'ual/UAL2_Standard.glb', glbClipName: 'Hit_Knockback',     label: 'Hit Knockback',  category: 'combat' },

  // ░▒▓ UAL1 Emote ▓▒░
  { id: 'ual-talking',        filename: 'ual/UAL1_Standard.glb', glbClipName: 'Idle_Talking_Loop', label: 'Talking',        category: 'emote' },
  { id: 'ual-driving',        filename: 'ual/UAL1_Standard.glb', glbClipName: 'Driving_Loop',      label: 'Driving',        category: 'emote' },
  { id: 'ual-fixing',         filename: 'ual/UAL1_Standard.glb', glbClipName: 'Fixing_Kneeling',   label: 'Fixing',         category: 'emote' },
  { id: 'ual-interact',       filename: 'ual/UAL1_Standard.glb', glbClipName: 'Interact',          label: 'Interact',       category: 'emote' },
  { id: 'ual-pickup',         filename: 'ual/UAL1_Standard.glb', glbClipName: 'PickUp_Table',      label: 'Pick Up',        category: 'emote' },
  { id: 'ual-sit-enter',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sitting_Enter',     label: 'Sit Down',       category: 'emote' },
  { id: 'ual-sit-idle',       filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sitting_Idle_Loop', label: 'Sitting',        category: 'emote' },
  { id: 'ual-sit-talk',       filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sitting_Talking_Loop', label: 'Sit Talk',    category: 'emote' },

  // ░▒▓ UAL2 Emote ▓▒░
  { id: 'ual-yes',            filename: 'ual/UAL2_Standard.glb', glbClipName: 'Yes',               label: 'Yes',            category: 'emote' },
  { id: 'ual-fold-arms',      filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_FoldArms_Loop', label: 'Fold Arms',     category: 'emote' },
  { id: 'ual-phone',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_TalkingPhone_Loop', label: 'Phone',     category: 'emote' },
  { id: 'ual-no',             filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_No_Loop',      label: 'No',             category: 'emote' },
  { id: 'ual-lay-to-idle',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'LayToIdle',         label: 'Get Up',         category: 'emote' },
  { id: 'ual-consume',        filename: 'ual/UAL2_Standard.glb', glbClipName: 'Consume',           label: 'Consume',        category: 'emote' },
  { id: 'ual-chest-open',     filename: 'ual/UAL2_Standard.glb', glbClipName: 'Chest_Open',        label: 'Open Chest',     category: 'emote' },

  // ░▒▓ UAL2 Survival ▓▒░
  { id: 'ual-harvest',        filename: 'ual/UAL2_Standard.glb', glbClipName: 'Farm_Harvest',      label: 'Harvest',        category: 'survival' },
  { id: 'ual-plant',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'Farm_PlantSeed',    label: 'Plant Seed',     category: 'survival' },
  { id: 'ual-water',          filename: 'ual/UAL2_Standard.glb', glbClipName: 'Farm_Watering',     label: 'Water',          category: 'survival' },
  { id: 'ual-chop',           filename: 'ual/UAL2_Standard.glb', glbClipName: 'TreeChopping_Loop', label: 'Chop Tree',      category: 'survival' },

  // ░▒▓ UAL1 Idle Variants ▓▒░
  { id: 'ual-idle',           filename: 'ual/UAL1_Standard.glb', glbClipName: 'Idle_Loop',         label: 'UAL Idle',       category: 'idle-var' },
  { id: 'ual-idle-torch',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Idle_Torch_Loop',   label: 'Torch Idle',     category: 'idle-var' },

  // ░▒▓ UAL2 Idle Variants ▓▒░
  { id: 'ual-idle-lantern',   filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_Lantern_Loop', label: 'Lantern Idle',   category: 'idle-var' },
  { id: 'ual-idle-rail',      filename: 'ual/UAL2_Standard.glb', glbClipName: 'Idle_Rail_Loop',    label: 'Rail Lean',      category: 'idle-var' },
  { id: 'ual-zombie-idle',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Zombie_Idle_Loop',  label: 'Zombie Idle',    category: 'idle-var' },
  { id: 'ual-zombie-walk',    filename: 'ual/UAL2_Standard.glb', glbClipName: 'Zombie_Walk_Fwd_Loop', label: 'Zombie Walk', category: 'idle-var' },
  { id: 'ual-zombie-scratch', filename: 'ual/UAL2_Standard.glb', glbClipName: 'Zombie_Scratch',   label: 'Zombie Scratch', category: 'idle-var' },
  { id: 'ual-ninja-idle',     filename: 'ual/UAL2_Standard.glb', glbClipName: 'NinjaJump_Idle_Loop', label: 'Ninja Idle',   category: 'idle-var' },

  // ░▒▓ UAL1 Acrobatics ▓▒░
  { id: 'ual-jump-start',     filename: 'ual/UAL1_Standard.glb', glbClipName: 'Jump_Start',        label: 'Jump Start',     category: 'acrobatics' },
  { id: 'ual-jump-loop',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Jump_Loop',         label: 'Jump Air',       category: 'acrobatics' },
  { id: 'ual-jump-land',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Jump_Land',         label: 'Jump Land',      category: 'acrobatics' },

  // ░▒▓ UAL2 Acrobatics ▓▒░
  { id: 'ual-ninja-jump',     filename: 'ual/UAL2_Standard.glb', glbClipName: 'NinjaJump_Start',   label: 'Ninja Jump',     category: 'acrobatics' },
]

// Category display order + emoji
export const ANIM_CATEGORIES: { id: AnimCategory; label: string; icon: string }[] = [
  { id: 'locomotion',  label: 'Move',      icon: '🚶' },
  { id: 'dance',       label: 'Dance',     icon: '💃' },
  { id: 'combat',      label: 'Combat',    icon: '⚔' },
  { id: 'emote',       label: 'Emote',     icon: '🙏' },
  { id: 'acrobatics',  label: 'Acrobat',   icon: '🤸' },
  { id: 'survival',   label: 'Craft',     icon: '🌾' },
  { id: 'idle-var',   label: 'Idle+',     icon: '🧟' },
]

// ═══════════════════════════════════════════════════════════════════════════════
// BONE NAME MAPPING — The Rosetta Stone of rigged characters
// ░▒▓ Mixamo FBX uses "mixamorigHips", Meshy GLBs use "Hips" ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

// ░▒▓ Meshy spine naming: Spine01/Spine02 instead of Spine1/Spine2 ▓▒░
const SPINE_ALIASES: Record<string, string> = {
  'Spine1': 'Spine01',
  'Spine2': 'Spine02',
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXAMO → VRM BONE MAPPING — Bridge between Mixamo FBX and VRM humanoid
// ░▒▓ VRM uses its own standard names (hips, spine, chest, leftUpperArm...) ▓▒░
// ░▒▓ Mixamo uses mixamorigHips, mixamorigSpine, mixamorigSpine1... ▓▒░
// The normalized VRM skeleton from @pixiv/three-vrm names bones exactly
// matching VRM standard (lowercase). This table maps Mixamo bare → VRM.
// ═══════════════════════════════════════════════════════════════════════════════

const MIXAMO_TO_VRM: Record<string, string> = {
  // Core
  'Hips': 'hips', 'Spine': 'spine', 'Spine1': 'chest', 'Spine2': 'upperChest',
  'Neck': 'neck', 'Head': 'head',
  // Left arm
  'LeftShoulder': 'leftShoulder', 'LeftArm': 'leftUpperArm',
  'LeftForeArm': 'leftLowerArm', 'LeftHand': 'leftHand',
  // Right arm
  'RightShoulder': 'rightShoulder', 'RightArm': 'rightUpperArm',
  'RightForeArm': 'rightLowerArm', 'RightHand': 'rightHand',
  // Left leg
  'LeftUpLeg': 'leftUpperLeg', 'LeftLeg': 'leftLowerLeg',
  'LeftFoot': 'leftFoot', 'LeftToeBase': 'leftToes',
  // Right leg
  'RightUpLeg': 'rightUpperLeg', 'RightLeg': 'rightLowerLeg',
  'RightFoot': 'rightFoot', 'RightToeBase': 'rightToes',
  // Fingers (left)
  'LeftHandThumb1': 'leftThumbMetacarpal', 'LeftHandThumb2': 'leftThumbProximal', 'LeftHandThumb3': 'leftThumbDistal',
  'LeftHandIndex1': 'leftIndexProximal', 'LeftHandIndex2': 'leftIndexIntermediate', 'LeftHandIndex3': 'leftIndexDistal',
  'LeftHandMiddle1': 'leftMiddleProximal', 'LeftHandMiddle2': 'leftMiddleIntermediate', 'LeftHandMiddle3': 'leftMiddleDistal',
  'LeftHandRing1': 'leftRingProximal', 'LeftHandRing2': 'leftRingIntermediate', 'LeftHandRing3': 'leftRingDistal',
  'LeftHandPinky1': 'leftLittleProximal', 'LeftHandPinky2': 'leftLittleIntermediate', 'LeftHandPinky3': 'leftLittleDistal',
  // Fingers (right)
  'RightHandThumb1': 'rightThumbMetacarpal', 'RightHandThumb2': 'rightThumbProximal', 'RightHandThumb3': 'rightThumbDistal',
  'RightHandIndex1': 'rightIndexProximal', 'RightHandIndex2': 'rightIndexIntermediate', 'RightHandIndex3': 'rightIndexDistal',
  'RightHandMiddle1': 'rightMiddleProximal', 'RightHandMiddle2': 'rightMiddleIntermediate', 'RightHandMiddle3': 'rightMiddleDistal',
  'RightHandRing1': 'rightRingProximal', 'RightHandRing2': 'rightRingIntermediate', 'RightHandRing3': 'rightRingDistal',
  'RightHandPinky1': 'rightLittleProximal', 'RightHandPinky2': 'rightLittleIntermediate', 'RightHandPinky3': 'rightLittleDistal',
}

// ═══════════════════════════════════════════════════════════════════════════════
// UE (Unreal Engine) → VRM BONE MAPPING — Bridge for UAL (Universal Animation Library)
// ░▒▓ UAL GLBs use UE skeleton naming: pelvis, spine_01, upperarm_l, etc. ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const UE_TO_VRM: Record<string, string> = {
  // Core
  'pelvis': 'hips', 'spine_01': 'spine', 'spine_02': 'chest', 'spine_03': 'upperChest',
  'neck_01': 'neck', 'Head': 'head',
  // Left arm
  'clavicle_l': 'leftShoulder', 'upperarm_l': 'leftUpperArm',
  'lowerarm_l': 'leftLowerArm', 'hand_l': 'leftHand',
  // Right arm
  'clavicle_r': 'rightShoulder', 'upperarm_r': 'rightUpperArm',
  'lowerarm_r': 'rightLowerArm', 'hand_r': 'rightHand',
  // Left leg
  'thigh_l': 'leftUpperLeg', 'calf_l': 'leftLowerLeg',
  'foot_l': 'leftFoot', 'ball_l': 'leftToes',
  // Right leg
  'thigh_r': 'rightUpperLeg', 'calf_r': 'rightLowerLeg',
  'foot_r': 'rightFoot', 'ball_r': 'rightToes',
  // Fingers (left)
  'thumb_01_l': 'leftThumbMetacarpal', 'thumb_02_l': 'leftThumbProximal', 'thumb_03_l': 'leftThumbDistal',
  'index_01_l': 'leftIndexProximal', 'index_02_l': 'leftIndexIntermediate', 'index_03_l': 'leftIndexDistal',
  'middle_01_l': 'leftMiddleProximal', 'middle_02_l': 'leftMiddleIntermediate', 'middle_03_l': 'leftMiddleDistal',
  'ring_01_l': 'leftRingProximal', 'ring_02_l': 'leftRingIntermediate', 'ring_03_l': 'leftRingDistal',
  'pinky_01_l': 'leftLittleProximal', 'pinky_02_l': 'leftLittleIntermediate', 'pinky_03_l': 'leftLittleDistal',
  // Fingers (right)
  'thumb_01_r': 'rightThumbMetacarpal', 'thumb_02_r': 'rightThumbProximal', 'thumb_03_r': 'rightThumbDistal',
  'index_01_r': 'rightIndexProximal', 'index_02_r': 'rightIndexIntermediate', 'index_03_r': 'rightIndexDistal',
  'middle_01_r': 'rightMiddleProximal', 'middle_02_r': 'rightMiddleIntermediate', 'middle_03_r': 'rightMiddleDistal',
  'ring_01_r': 'rightRingProximal', 'ring_02_r': 'rightRingIntermediate', 'ring_03_r': 'rightRingDistal',
  'pinky_01_r': 'rightLittleProximal', 'pinky_02_r': 'rightLittleIntermediate', 'pinky_03_r': 'rightLittleDistal',
}

/**
 * Retarget a Mixamo animation clip for a specific VRM model.
 *
 * WHY THIS NEEDS THE ACTUAL VRM OBJECT:
 * three-vrm creates "normalized" proxy bones named "Normalized_" + ORIGINAL_BONE_NAME,
 * where ORIGINAL_BONE_NAME is the raw GLTF bone name (e.g. "J_Bip_C_Hips" for VRoid,
 * "Hips" for Mixamo-rigged VRMs). This is file-specific — we can't use a static table.
 * The AnimationMixer targets bones by name in the scene. Using a wrong name = silent no-op.
 *
 * This function queries vrm.humanoid.getNormalizedBoneNode(vrmBoneName) to get the actual
 * node for each VRM humanoid bone, reads its .name, and retargets Mixamo tracks to that.
 */
export function retargetClipForVRM(
  clip: THREE.AnimationClip,
  vrm: VRM,
  cacheKey: string,
): THREE.AnimationClip {
  const fullKey = `vrm4__${clip.name}__${cacheKey}`
  if (retargetCache.has(fullKey)) {
    return retargetCache.get(fullKey)!
  }

  // Build per-VRM mapping: Mixamo bare name → actual normalized bone node name
  // e.g. "Hips" → "Normalized_J_Bip_C_Hips" (for VRoid avatars)
  const mixamoToNodeName: Record<string, string> = {}
  for (const [mixamoBare, vrmBoneName] of Object.entries(MIXAMO_TO_VRM)) {
    const node = vrm.humanoid.getNormalizedBoneNode(vrmBoneName as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    if (node) mixamoToNodeName[mixamoBare] = node.name
  }

  // ░▒▓ REST-POSE COMPENSATION — the canonical pixiv formula ▓▒░
  // result = parentRestWorldQuat * Q * restWorldQuatInverse
  const animId = clip.name.replace(LIB_PREFIX, '')
  const restData = mixamoRestCache.get(animId)

  // VRM 0.x coordinate flip detection
  const isVRM0 = (vrm.meta as any)?.metaVersion === '0'

  // Hips height ratio for position track scaling
  const mixamoHipsY = mixamoHipsHeightCache.get(animId) || 1
  const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
  const vrmHipsY = vrmHipsNode ? vrmHipsNode.position.y : 1

  let remapped = 0
  let unmapped = 0
  let compensated = 0

  const tracks: THREE.KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf('.')
    if (dotIdx === -1) { tracks.push(track.clone()); continue }

    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx)

    // Strip "mixamorig" prefix → bare Mixamo name → actual node name in this VRM
    const bare = boneName.replace(/^mixamorig/, '')
    const nodeName = mixamoToNodeName[bare]

    if (!nodeName) { unmapped++; continue }
    remapped++

    // ░▒▓ Quaternion tracks — apply pixiv rest-pose compensation ▓▒░
    if (property === '.quaternion' && restData) {
      const rest = restData.get(boneName)
      if (rest) {
        const vals = track.values.slice()
        const tmpQ = new THREE.Quaternion()
        for (let i = 0; i < vals.length; i += 4) {
          tmpQ.set(vals[i], vals[i + 1], vals[i + 2], vals[i + 3])
          tmpQ.premultiply(rest.parentRestWorldQuat).multiply(rest.restWorldQuatInverse)
          vals[i] = tmpQ.x; vals[i + 1] = tmpQ.y; vals[i + 2] = tmpQ.z; vals[i + 3] = tmpQ.w
        }
        // VRM 0.x coordinate flip
        if (isVRM0) {
          for (let i = 0; i < vals.length; i += 4) {
            vals[i] = -vals[i]; vals[i + 2] = -vals[i + 2]
          }
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, track.times, vals))
        compensated++
        continue
      }
    }

    // ░▒▓ Position tracks (hips) — scale by VRM/Mixamo height ratio ▓▒░
    if (property === '.position' && (bare === 'Hips' || bare === 'mixamorigHips')) {
      const scale = vrmHipsY / mixamoHipsY
      const vals = track.values.slice()
      for (let i = 0; i < vals.length; i++) {
        vals[i] *= scale
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.position`, track.times, vals))
      continue
    }

    const t = track.clone()
    t.name = nodeName + property
    tracks.push(t)
  }

  const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks)
  retargetCache.set(fullKey, retargeted)
  console.log(`[AnimLib:VRM] Retargeted "${clip.name}" (${cacheKey}): ${remapped} mapped, ${compensated} compensated, ${unmapped} unmapped`)
  return retargeted
}

/**
 * Build a mapping from normalized Mixamo track bone names → target skeleton bone names.
 *
 * Our FBX animation tracks are normalized to "mixamorigHips", "mixamorigSpine", etc.
 * Target skeletons come in multiple flavors:
 *   - Tripo:  "mixamorig:Hips" (colon-separated prefix)
 *   - Meshy:  "Hips", "Spine01", "neck" (bare, sometimes different casing/numbering)
 *   - Direct: "mixamorigHips" (rare, would be a perfect match)
 *
 * Rather than iterating a hardcoded bone list, we resolve per-track dynamically.
 */
export function buildBoneMap(targetBoneNames: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const targetSet = new Set(targetBoneNames)

  // Build lookups for fuzzy matching
  const targetLower = new Map<string, string>()  // lowercase → original
  const targetNoColon = new Map<string, string>() // colonless → original (Tripo "mixamorig:Hips")
  for (const name of targetBoneNames) {
    targetLower.set(name.toLowerCase(), name)
    // "mixamorig:Hips" → key "mixamorigHips" → value "mixamorig:Hips"
    targetNoColon.set(name.replace(/:/g, ''), name)
  }

  // Return a lazy-resolving Map: resolves bone names on first access
  const lazyMap: Map<string, string> = {
    get(trackBoneName: string): string | undefined {
      if (map.has(trackBoneName)) return map.get(trackBoneName)
      const resolved = resolveBone(trackBoneName, targetSet, targetLower, targetNoColon)
      if (resolved) map.set(trackBoneName, resolved)
      return resolved
    },
    has(trackBoneName: string): boolean {
      return this.get(trackBoneName) !== undefined
    },
    set(k: string, v: string) { map.set(k, v); return this },
    get size() { return map.size },
    entries() { return map.entries() },
    keys() { return map.keys() },
    values() { return map.values() },
    forEach(cb: (v: string, k: string, m: Map<string, string>) => void) { map.forEach(cb) },
    delete(k: string) { return map.delete(k) },
    clear() { map.clear() },
    [Symbol.iterator]() { return map.entries() },
    [Symbol.toStringTag]: 'BoneMap',
  } as Map<string, string>

  return lazyMap
}

function resolveBone(
  trackBone: string,
  targetSet: Set<string>,
  targetLower: Map<string, string>,
  targetNoColon: Map<string, string>,
): string | undefined {
  // Strategy 1: Direct match ("mixamorigHips" → "mixamorigHips")
  if (targetSet.has(trackBone)) return trackBone

  // Strategy 2: Track bone matches target with colons stripped
  // Our track: "mixamorigHips" → targetNoColon has "mixamorigHips" → "mixamorig:Hips"
  const colonMatch = targetNoColon.get(trackBone)
  if (colonMatch) return colonMatch

  // Strategy 3: Strip "mixamorig" prefix → bare name ("Hips")
  const bare = trackBone.replace(/^mixamorig/, '')
  if (targetSet.has(bare)) return bare

  // Strategy 4: Case-insensitive bare name ("neck" vs "Neck")
  const lowerBare = bare.toLowerCase()
  const lowerMatch = targetLower.get(lowerBare)
  if (lowerMatch) return lowerMatch

  // Strategy 5: Meshy spine aliases (Spine1 → Spine01, Spine2 → Spine02)
  const alias = SPINE_ALIASES[bare]
  if (alias && targetSet.has(alias)) return alias

  // Strategy 6: Case-insensitive on full name
  const lowerFull = trackBone.toLowerCase()
  const fullLowerMatch = targetLower.get(lowerFull)
  if (fullLowerMatch) return fullLowerMatch

  return undefined
}

/**
 * Retarget a library animation clip to match a specific character's bone names.
 * Creates a new clip with remapped track names. Cached per skeleton type.
 */
const retargetCache = new Map<string, THREE.AnimationClip>()

export function retargetClip(
  clip: THREE.AnimationClip,
  targetBoneNames: string[],
  cacheKey: string,
): THREE.AnimationClip {
  const fullKey = `${clip.name}__${cacheKey}`
  if (retargetCache.has(fullKey)) {
    return retargetCache.get(fullKey)!
  }

  const boneMap = buildBoneMap(targetBoneNames)
  let remapped = 0
  let unmapped = 0

  const remappedTracks = clip.tracks.map(track => {
    const dotIdx = track.name.indexOf('.')
    if (dotIdx === -1) return track.clone()

    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx)

    const mappedBone = boneMap.get(boneName)
    if (mappedBone) {
      if (mappedBone !== boneName) remapped++
      const newTrack = track.clone()
      newTrack.name = mappedBone + property
      return newTrack
    }
    // No mapping found — keep original (will be silently ignored by mixer)
    unmapped++
    return track.clone()
  })

  const retargeted = new THREE.AnimationClip(
    clip.name,
    clip.duration,
    remappedTracks,
  )

  console.log(`[AnimLib] Retargeted "${clip.name}" for "${cacheKey}": ${remapped} remapped, ${unmapped} unmapped, ${clip.tracks.length} total tracks`)

  retargetCache.set(fullKey, retargeted)
  return retargeted
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION CLIP CACHE — Load once, reuse forever
// ░▒▓ FBXLoader extracts clips from Mixamo "without skin" files ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const clipCache = new Map<string, THREE.AnimationClip>()
const loadingPromises = new Map<string, Promise<THREE.AnimationClip | null>>()

// ░▒▓ MIXAMO REST ROTATIONS — per-bone T-pose WORLD quaternions extracted from FBX skeleton ▓▒░
// VRM normalized bones expect rotations relative to identity (T-pose = no rotation).
// Mixamo tracks store ABSOLUTE rotations. The canonical pixiv formula:
//   result = parentRestWorldQuat * Q * restWorldQuatInverse
// This converts from Mixamo's rest frame to VRM's identity frame.
interface MixamoRestData {
  restWorldQuatInverse: THREE.Quaternion
  parentRestWorldQuat: THREE.Quaternion
}
const mixamoRestCache = new Map<string, Map<string, MixamoRestData>>()
const mixamoHipsHeightCache = new Map<string, number>()

/** The lib: prefix indicates a library animation in behavior config */
export const LIB_PREFIX = 'lib:'

/**
 * Load an animation clip from the library by ID.
 * Returns cached clip if already loaded, otherwise fetches + parses the FBX.
 * Clips are stored with Mixamo naming — use retargetClip() to adapt to specific skeletons.
 */
export async function loadAnimationClip(animId: string): Promise<THREE.AnimationClip | null> {
  // Check cache first
  if (clipCache.has(animId)) {
    return clipCache.get(animId)!
  }

  // Dedupe concurrent loads
  if (loadingPromises.has(animId)) {
    return loadingPromises.get(animId)!
  }

  const entry = ANIMATION_LIBRARY.find(a => a.id === animId)
  if (!entry) {
    console.warn(`[AnimLib] Animation "${animId}" not found in library`)
    return null
  }

  // ░▒▓ UAL GLB pack — route through dedicated loader ▓▒░
  if (entry.glbClipName) {
    const promise = loadUALClip(entry)
    loadingPromises.set(animId, promise)
    return promise
  }

  const promise = (async () => {
    try {
      // Dynamic import — FBXLoader uses DOM APIs, must be client-side only
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
      const loader = new FBXLoader()

      const url = `${OASIS_BASE}/animations/${encodeURIComponent(entry.filename)}`
      console.log(`[AnimLib] Loading ${animId} from ${url}`)

      const fbx = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      })

      if (!fbx.animations || fbx.animations.length === 0) {
        console.warn(`[AnimLib] ${animId}: FBX has no animations`)
        return null
      }

      // ░▒▓ Extract Mixamo rest WORLD rotations from FBX skeleton ▓▒░
      // "Without skin" FBX still has bones in T-pose. We need world quaternions
      // for the canonical pixiv retarget formula:
      //   result = parentRestWorldQuat * Q * restWorldQuatInverse
      fbx.updateWorldMatrix(true, true)
      const restRotations = new Map<string, MixamoRestData>()
      let hipsHeight = 1
      const restWorldQuat = new THREE.Quaternion()
      const parentRestWorldQuat = new THREE.Quaternion()
      fbx.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          let name = child.name
          // Same normalization as track names
          if (name.includes('|')) name = name.split('|').pop()!
          name = name.replace(/:/g, '')
          child.getWorldQuaternion(restWorldQuat)
          if (child.parent) child.parent.getWorldQuaternion(parentRestWorldQuat)
          else parentRestWorldQuat.identity()
          restRotations.set(name, {
            restWorldQuatInverse: restWorldQuat.clone().invert(),
            parentRestWorldQuat: parentRestWorldQuat.clone(),
          })
          // Capture hips height for position track scaling
          if (name === 'mixamorigHips' || name === 'Hips') {
            hipsHeight = child.position.y
          }
        }
      })
      if (restRotations.size > 0) {
        mixamoRestCache.set(animId, restRotations)
        mixamoHipsHeightCache.set(animId, hipsHeight)
        console.log(`[AnimLib] ${animId}: extracted ${restRotations.size} bone rest world rotations, hipsY=${hipsHeight.toFixed(1)}`)
      }

      // Extract the first clip
      const rawClip = fbx.animations[0]

      // ░▒▓ TRACK NAME NORMALIZATION ▓▒░
      // Normalize FBX track names to canonical Mixamo format: "mixamorigHips.quaternion"
      // Strip prefixes like "Armature|" and convert colons: "mixamorig:Hips" → "mixamorigHips"
      const sampleTrackNames = rawClip.tracks.slice(0, 3).map(t => t.name)
      console.log(`[AnimLib] ${animId} raw tracks (first 3):`, sampleTrackNames)

      const normalizedTracks: THREE.KeyframeTrack[] = []

      for (const track of rawClip.tracks) {
        const dotIdx = track.name.indexOf('.')
        if (dotIdx === -1) {
          normalizedTracks.push(track.clone())
          continue
        }

        let objectPath = track.name.substring(0, dotIdx)
        const property = track.name.substring(dotIdx)  // includes the dot

        // Strip common prefixes: "Armature|" or namespace separators
        if (objectPath.includes('|')) {
          objectPath = objectPath.split('|').pop()!
        }

        // Normalize Mixamo naming: "mixamorig:Hips" → "mixamorigHips"
        objectPath = objectPath.replace(/:/g, '')

        const normalizedName = objectPath + property

        // ░▒▓ ROOT MOTION — Keep Y-axis bob, zero X/Z drift ▓▒░
        // The hip up-down motion makes walking look natural.
        // X/Z translation would teleport the character off its Oasis position.
        if (objectPath === 'mixamorigHips' && property === '.position') {
          // ░▒▓ ROOT POSITION — strip entirely ▓▒░
          // FBX stores absolute hip positions (e.g. Y=97cm). Applied to a world-space
          // model this teleports it. Stripping the whole track is safest — the skeleton
          // rest pose already positions the hips correctly, and rotation tracks handle
          // the body movement. Keeping Y-bob caused -infinity teleports on Tripo.
          console.log(`[AnimLib] ${animId}: stripped root position track entirely (prevents teleport)`)
          continue  // skip this track
        }

        const newTrack = track.clone()
        newTrack.name = normalizedName
        normalizedTracks.push(newTrack)
      }

      const clip = new THREE.AnimationClip(
        `${LIB_PREFIX}${animId}`,
        rawClip.duration,
        normalizedTracks,
      )

      // Cache it
      clipCache.set(animId, clip)
      console.log(`[AnimLib] ${animId} loaded: ${clip.duration.toFixed(1)}s, ${clip.tracks.length} tracks`)

      // Dispose the FBX scene — we only need the clip
      fbx.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat) mat.dispose()
        }
      })

      return clip
    } catch (err) {
      console.error(`[AnimLib] Failed to load ${animId}:`, err)
      return null
    } finally {
      loadingPromises.delete(animId)
    }
  })()

  loadingPromises.set(animId, promise)
  return promise
}

// ═══════════════════════════════════════════════════════════════════════════════
// UAL GLB PACK LOADER — Universal Animation Library (Unreal Engine skeleton)
// ░▒▓ GLB packs contain multiple named clips. Cache the whole pack, extract by name. ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const ualGlbCache = new Map<string, { animations: THREE.AnimationClip[]; scene: THREE.Group }>()

async function loadUALClip(entry: LocalAnimation): Promise<THREE.AnimationClip | null> {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')

    const url = `${OASIS_BASE}/animations/${entry.filename}`
    let pack = ualGlbCache.get(entry.filename)

    if (!pack) {
      console.log(`[AnimLib:UAL] Loading pack ${entry.filename}`)
      const loader = new GLTFLoader()
      const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        loader.load(url, resolve as any, undefined, reject)
      })
      pack = { animations: gltf.animations, scene: gltf.scene }
      ualGlbCache.set(entry.filename, pack)

      // ░▒▓ Extract rest rotations once per pack → stored under '__ual__' key ▓▒░
      if (!mixamoRestCache.has('__ual__')) {
        gltf.scene.updateWorldMatrix(true, true)
        const restRotations = new Map<string, MixamoRestData>()
        let hipsHeight = 1
        const ualRestWorldQuat = new THREE.Quaternion()
        const ualParentRestWorldQuat = new THREE.Quaternion()
        gltf.scene.traverse((child) => {
          if ((child as THREE.Bone).isBone) {
            const name = child.name
            child.getWorldQuaternion(ualRestWorldQuat)
            if (child.parent) child.parent.getWorldQuaternion(ualParentRestWorldQuat)
            else ualParentRestWorldQuat.identity()
            restRotations.set(name, {
              restWorldQuatInverse: ualRestWorldQuat.clone().invert(),
              parentRestWorldQuat: ualParentRestWorldQuat.clone(),
            })
            if (name === 'pelvis') {
              hipsHeight = child.position.y
            }
          }
        })
        if (restRotations.size > 0) {
          mixamoRestCache.set('__ual__', restRotations)
          mixamoHipsHeightCache.set('__ual__', hipsHeight)
          console.log(`[AnimLib:UAL] Extracted ${restRotations.size} rest world rotations from ${entry.filename}, hipsY=${hipsHeight.toFixed(1)}`)
        }
      }
    }

    // Find the named clip
    const rawClip = pack.animations.find(a => a.name === entry.glbClipName)
    if (!rawClip) {
      console.warn(`[AnimLib:UAL] Clip "${entry.glbClipName}" not found in ${entry.filename}. Available:`, pack.animations.map(a => a.name))
      return null
    }

    // Normalize tracks — strip root position on pelvis to prevent teleporting
    const normalizedTracks: THREE.KeyframeTrack[] = []
    for (const track of rawClip.tracks) {
      const dotIdx = track.name.indexOf('.')
      if (dotIdx === -1) { normalizedTracks.push(track.clone()); continue }

      const boneName = track.name.substring(0, dotIdx)
      const property = track.name.substring(dotIdx)

      // Strip pelvis/root position tracks
      if (boneName === 'pelvis' && property === '.position') {
        continue
      }

      normalizedTracks.push(track.clone())
    }

    const clip = new THREE.AnimationClip(
      `${LIB_PREFIX}${entry.id}`,
      rawClip.duration,
      normalizedTracks,
    )

    clipCache.set(entry.id, clip)
    console.log(`[AnimLib:UAL] ${entry.id} loaded: "${entry.glbClipName}" ${clip.duration.toFixed(1)}s, ${normalizedTracks.length} tracks`)
    return clip
  } catch (err) {
    console.error(`[AnimLib:UAL] Failed to load ${entry.id}:`, err)
    return null
  } finally {
    loadingPromises.delete(entry.id)
  }
}

/**
 * Retarget a UAL (Unreal Engine skeleton) animation clip for a VRM model.
 * Same pixiv formula as retargetClipForVRM but uses UE_TO_VRM bone mapping
 * and '__ual__' rest data.
 */
export function retargetUALClipForVRM(
  clip: THREE.AnimationClip,
  vrm: VRM,
  cacheKey: string,
): THREE.AnimationClip {
  const fullKey = `vrm4ual__${clip.name}__${cacheKey}`
  if (retargetCache.has(fullKey)) {
    return retargetCache.get(fullKey)!
  }

  // Build per-VRM mapping: UE bone name → actual normalized bone node name
  const ueToNodeName: Record<string, string> = {}
  for (const [ueBone, vrmBoneName] of Object.entries(UE_TO_VRM)) {
    const node = vrm.humanoid.getNormalizedBoneNode(vrmBoneName as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    if (node) ueToNodeName[ueBone] = node.name
  }

  const restData = mixamoRestCache.get('__ual__')
  const isVRM0 = (vrm.meta as any)?.metaVersion === '0'

  const mixamoHipsY = mixamoHipsHeightCache.get('__ual__') || 1
  const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
  const vrmHipsY = vrmHipsNode ? vrmHipsNode.position.y : 1

  let remapped = 0
  let unmapped = 0
  let compensated = 0

  const tracks: THREE.KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf('.')
    if (dotIdx === -1) { tracks.push(track.clone()); continue }

    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx)

    const nodeName = ueToNodeName[boneName]
    if (!nodeName) { unmapped++; continue }
    remapped++

    // Quaternion tracks — pixiv formula
    if (property === '.quaternion' && restData) {
      const rest = restData.get(boneName)
      if (rest) {
        const vals = track.values.slice()
        const tmpQ = new THREE.Quaternion()
        for (let i = 0; i < vals.length; i += 4) {
          tmpQ.set(vals[i], vals[i + 1], vals[i + 2], vals[i + 3])
          tmpQ.premultiply(rest.parentRestWorldQuat).multiply(rest.restWorldQuatInverse)
          vals[i] = tmpQ.x; vals[i + 1] = tmpQ.y; vals[i + 2] = tmpQ.z; vals[i + 3] = tmpQ.w
        }
        if (isVRM0) {
          for (let i = 0; i < vals.length; i += 4) {
            vals[i] = -vals[i]; vals[i + 2] = -vals[i + 2]
          }
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, track.times, vals))
        compensated++
        continue
      }
    }

    // Position tracks (pelvis) — scale by VRM/UAL height ratio
    if (property === '.position' && boneName === 'pelvis') {
      const scale = vrmHipsY / mixamoHipsY
      const vals = track.values.slice()
      for (let i = 0; i < vals.length; i++) {
        vals[i] *= scale
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${nodeName}.position`, track.times, vals))
      continue
    }

    const t = track.clone()
    t.name = nodeName + property
    tracks.push(t)
  }

  const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks)
  retargetCache.set(fullKey, retargeted)
  console.log(`[AnimLib:UAL→VRM] Retargeted "${clip.name}" (${cacheKey}): ${remapped} mapped, ${compensated} compensated, ${unmapped} unmapped`)
  return retargeted
}

/**
 * Check if an animation ID refers to a UAL (GLB pack) animation
 */
export function isUALAnimation(animId: string): boolean {
  const entry = ANIMATION_LIBRARY.find(a => a.id === animId)
  return !!entry?.glbClipName
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLTF CLIP EXTRACTION — Steal animations from character GLTFs for VRM avatars
// ░▒▓ Character GLTFs (Leela, Mike, etc.) have proper looping Idle/Walk clips ▓▒░
// ░▒▓ Way better quality than Mixamo FBX transition clips (no snap, clean loops) ▓▒░
// Same retargeting pipeline — rest-pose compensation works identically.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load an animation clip from a character GLTF file (not FBX).
 * Extracts the named clip + skeleton rest rotations → caches both.
 * Track names normalized same as FBX pipeline → compatible with retargetClipForVRM.
 */
export async function loadClipFromGLTF(
  gltfPath: string,
  clipPattern: RegExp,
  animId: string,
): Promise<THREE.AnimationClip | null> {
  if (clipCache.has(animId)) return clipCache.get(animId)!
  if (loadingPromises.has(animId)) return loadingPromises.get(animId)!

  const promise = (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const loader = new GLTFLoader()

      const url = `${OASIS_BASE}${gltfPath}`
      console.log(`[AnimLib:GLTF] Loading /${clipPattern.source}/ from ${url}`)

      const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        loader.load(url, resolve as any, undefined, reject)
      })

      if (!gltf.animations || gltf.animations.length === 0) {
        console.warn(`[AnimLib:GLTF] ${gltfPath} has no animations`)
        return null
      }

      // Find clip matching pattern
      const rawClip = gltf.animations.find(a => clipPattern.test(a.name))
      if (!rawClip) {
        console.warn(`[AnimLib:GLTF] No clip matching /${clipPattern.source}/ in ${gltfPath}. Available:`, gltf.animations.map(a => a.name))
        return null
      }

      // ░▒▓ Extract rest WORLD rotations from GLTF skeleton — same formula as FBX pipeline ▓▒░
      gltf.scene.updateWorldMatrix(true, true)
      const restRotations = new Map<string, MixamoRestData>()
      let hipsHeight = 1
      const gltfRestWorldQuat = new THREE.Quaternion()
      const gltfParentRestWorldQuat = new THREE.Quaternion()
      gltf.scene.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          let name = child.name
          if (name.includes('|')) name = name.split('|').pop()!
          name = name.replace(/:/g, '')
          child.getWorldQuaternion(gltfRestWorldQuat)
          if (child.parent) child.parent.getWorldQuaternion(gltfParentRestWorldQuat)
          else gltfParentRestWorldQuat.identity()
          restRotations.set(name, {
            restWorldQuatInverse: gltfRestWorldQuat.clone().invert(),
            parentRestWorldQuat: gltfParentRestWorldQuat.clone(),
          })
          if (name === 'mixamorigHips' || name === 'Hips') {
            hipsHeight = child.position.y
          }
        }
      })
      if (restRotations.size > 0) {
        mixamoRestCache.set(animId, restRotations)
        mixamoHipsHeightCache.set(animId, hipsHeight)
        console.log(`[AnimLib:GLTF] ${animId}: ${restRotations.size} rest world rotations from ${gltfPath}`)
      }

      // Log first 5 bone names + first 3 track names for debugging
      const boneNames = [...restRotations.keys()].slice(0, 5)
      const trackSample = rawClip.tracks.slice(0, 3).map(t => t.name)
      console.log(`[AnimLib:GLTF] ${animId} bones (first 5):`, boneNames)
      console.log(`[AnimLib:GLTF] ${animId} tracks (first 3):`, trackSample)

      // Normalize tracks — same pipeline as FBX: strip prefixes, remove colons, kill root position
      const normalizedTracks: THREE.KeyframeTrack[] = []
      for (const track of rawClip.tracks) {
        const dotIdx = track.name.indexOf('.')
        if (dotIdx === -1) { normalizedTracks.push(track.clone()); continue }

        let boneName = track.name.substring(0, dotIdx)
        const property = track.name.substring(dotIdx)

        if (boneName.includes('|')) boneName = boneName.split('|').pop()!
        boneName = boneName.replace(/:/g, '')

        // Strip root position — prevents teleporting (same as FBX pipeline)
        if ((boneName === 'Hips' || boneName === 'mixamorigHips') && property === '.position') {
          continue
        }

        const newTrack = track.clone()
        newTrack.name = boneName + property
        normalizedTracks.push(newTrack)
      }

      const clip = new THREE.AnimationClip(
        `${LIB_PREFIX}${animId}`,
        rawClip.duration,
        normalizedTracks,
      )

      clipCache.set(animId, clip)
      console.log(`[AnimLib:GLTF] ${animId} loaded: "${rawClip.name}" ${clip.duration.toFixed(1)}s, ${normalizedTracks.length} tracks`)

      // Dispose GLTF scene — we only needed clips + rest rotations
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat) (mat as THREE.Material).dispose()
        }
      })

      return clip
    } catch (err) {
      console.error(`[AnimLib:GLTF] Failed to load from ${gltfPath}:`, err)
      return null
    } finally {
      loadingPromises.delete(animId)
    }
  })()

  loadingPromises.set(animId, promise)
  return promise
}

/**
 * Get a cached clip synchronously — returns null if not yet loaded.
 * Use loadAnimationClip() to trigger loading first.
 */
export function getCachedClip(animId: string): THREE.AnimationClip | null {
  return clipCache.get(animId) || null
}

/**
 * Check if an animation ID refers to the local library (prefixed with "lib:")
 */
export function isLibraryAnimation(clipName: string): boolean {
  return clipName.startsWith(LIB_PREFIX)
}

/**
 * Extract the library animation ID from a clip name
 */
export function getLibraryAnimId(clipName: string): string {
  return clipName.replace(LIB_PREFIX, '')
}

// ▓▓▓▓【A̸N̸I̸M̸】▓▓▓▓ॐ▓▓▓▓【L̸I̸B̸R̸A̸R̸Y̸】▓▓▓▓
