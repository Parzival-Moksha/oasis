#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outArgIndex = process.argv.indexOf('--out')
const outDir = path.resolve(
  outArgIndex >= 0 && process.argv[outArgIndex + 1]
    ? process.argv[outArgIndex + 1]
    : 'public/ui/wizard-textures/prompts',
)

const sharedStyle = [
  'dark fantasy wizard game UI',
  'hand-painted but clean production game asset',
  'transparent background',
  'isolated asset sheet',
  'no text, no letters, no numbers, no logo, no watermark',
  'orthographic front view',
  'sharp readable silhouette at small sizes',
  'consistent amber, ember red, cyan mana, steel, and smoky black palette',
  'ready for web game UI textures',
].join(', ')

const negativePrompt = [
  'photorealistic',
  'mockup screen',
  'perspective skew',
  'drop shadow outside alpha bounds',
  'blurred edges',
  'baked words',
  'letters',
  'numbers',
  'logo',
  'watermark',
  'random icons',
].join(', ')

const packs = [
  {
    id: 'rp1-hud-bars',
    size: '1024x1024',
    prompt: [
      sharedStyle,
      'create a UI atlas for RPG health and mana bars',
      'include one empty ornate HP frame, one red filled HP segment, one empty ornate mana frame, one blue filled mana segment',
      'include simple end caps and center stretch regions that can be used as 9-slice textures',
      'leave at least 24 pixels of transparent padding around every element',
      'elements must be horizontally aligned, cleanly separated, and easy to slice',
    ].join(', '),
    slices: [
      'hp_frame: 9-slice, preserve left/right caps, stretch center only',
      'hp_fill: horizontal repeat or stretch',
      'mana_frame: 9-slice, preserve left/right caps, stretch center only',
      'mana_fill: horizontal repeat or stretch',
    ],
  },
  {
    id: 'wizard-buttons',
    size: '1024x1024',
    prompt: [
      sharedStyle,
      'create a UI atlas of blank wizard menu buttons',
      'include normal, hover, pressed, disabled, and selected states',
      'include small square icon button frames and wider rectangular command button frames',
      'all buttons must be empty with no glyphs and no words',
      'corners should be mildly rounded, under 8 px when scaled down',
      'clear 9-slice safe center areas for text rendered by HTML',
    ].join(', '),
    slices: [
      'button_normal: 9-slice',
      'button_hover: 9-slice',
      'button_pressed: 9-slice',
      'button_disabled: 9-slice',
      'icon_button: 9-slice or fixed square',
    ],
  },
  {
    id: 'spell-icons',
    size: '1024x1024',
    prompt: [
      sharedStyle,
      'create 12 square spell icons in a clean 4 by 3 grid',
      'include firebolt, fireball, ice bolt, frost nova, lightning bolt, chain lightning, shield, heal, teleport, summon, mana surge, and portal',
      'each icon must have a transparent background and a consistent dark metal square frame',
      'icons must read clearly at 48 by 48 pixels',
      'no text and no numerals',
    ].join(', '),
    slices: [
      'grid: 4 columns by 3 rows',
      'slice each icon as a square frame plus icon art',
      'keep alpha around each cell',
    ],
  },
  {
    id: 'panel-borders',
    size: '1024x1024',
    prompt: [
      sharedStyle,
      'create ornate but restrained panel borders for a wizard RPG interface',
      'include one large panel frame, one compact tooltip frame, one inventory slot frame, one alert frame, and four divider ornaments',
      'frames must have transparent centers for live HTML content',
      'include 9-slice-safe corners and edges',
      'make the art quiet enough for repeated gameplay menus',
    ].join(', '),
    slices: [
      'large_panel: 9-slice, transparent center',
      'tooltip: 9-slice, transparent center',
      'inventory_slot: fixed square or 9-slice',
      'alert_frame: 9-slice',
      'dividers: fixed horizontal ornaments',
    ],
  },
]

function toPromptFile(pack) {
  return [
    `# ${pack.id}`,
    '',
    `Size: ${pack.size}`,
    '',
    'Prompt:',
    pack.prompt,
    '',
    'Negative prompt:',
    negativePrompt,
    '',
    'Slicing notes:',
    ...pack.slices.map(slice => `- ${slice}`),
    '',
  ].join('\n')
}

await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ negativePrompt, packs }, null, 2))
await writeFile(
  path.join(outDir, 'all-prompts.md'),
  packs.map(toPromptFile).join('\n---\n\n'),
)

for (const pack of packs) {
  await writeFile(path.join(outDir, `${pack.id}.md`), toPromptFile(pack))
}

console.log(`Wrote ${packs.length} UI texture prompt packs to ${outDir}`)
