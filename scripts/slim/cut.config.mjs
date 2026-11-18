// What goes into the slim Oasis (scripts/cut-slim.mjs reads this).
//
// The slim Oasis is a cut of this repository, not a fork: the village, the agent engine, the Claude Code
// plugin and a small set of assets that may be redistributed. Paths are tracked files of this repository,
// with forward slashes. A file is taken when an `include` rule matches it and no `exclude` rule does.
// Rules: 'dir/' (everything under it), 'dir/*.ext' style globs (* stays inside one folder, ** crosses folders),
// or an exact path.

/** Size limit of the cut as a .tar.gz, in MiB. Anthropic's directory stops at 50; this leaves room. */
export const ARCHIVE_LIMIT_MIB = 45
/** The directory also refuses 10,000 files or more. */
export const FILE_LIMIT = 9000

export const include = [
  // The app
  'src/',
  'prisma/schema.prisma',
  'prisma/seed-default-worlds.ts',
  'prisma/default-worlds/',
  'packages/oasis-agent-engine/',
  'plugins/oasis/',
  '.claude-plugin/marketplace.json',
  'package.json',
  'pnpm-lock.yaml',
  'next.config.mjs',
  'next-env.d.ts',
  'instrumentation.ts',
  'tsconfig.json',
  'tailwind.config.js',
  'postcss.config.js',
  'vitest.config.ts',
  'LICENSE',
  'scripts/oasis.mjs',
  'scripts/slim/seed-first-world.mjs',
  'data/asset-catalog-extras.json',
  'data/ground-presets-extras.json',

  // Assets: ours, or CC0
  'public/ui/',
  'public/skies/',
  'public/splash/',
  'public/icons/',
  'public/fonts/',
  'public/lipsync/',
  'public/favicon.svg',
  'public/oasislogo.jpg',
  'public/headaudio.mjs',
  'public/headworklet.min.mjs',
  'public/model-en-mixed.bin',
  'public/parameters.mjs',
  'public/training.mjs',
  'public/manifest.webmanifest',
  'public/audio/kenney_interface-sounds/',
  'public/audio/kenney_impact-sounds/',
  'public/audio/kenney-ui/',
  'public/audio/kenney-rpg/',
  'public/animations/ual/UAL1_Standard.glb',
]

export const exclude = [
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  'src/test-utils/',
  'packages/oasis-agent-engine/sandbox/',
  // The workshop's manifest for the world tools; the cut ships plugins/oasis/mcp/directory.mcp.json as .mcp.json
  'plugins/oasis/.mcp.json',
  '**/*.url',
  'public/ui/hud/iterations/',
  'public/ui/spellbook/tiles/_alternates/',
]

/**
 * Avatars in the cut: only files whose own metadata says CC0 (the cut checks it again and refuses otherwise),
 * plus the ones made for the Oasis. Their thumbnails come along.
 */
export const avatars = [
  { file: 'The_Worm.vrm', licence: 'CC0' },
  { file: 'Mushy.vrm', licence: 'CC0' },
  { file: 'Witch.vrm', licence: 'CC0' },
  { file: 'David.vrm', licence: 'CC0' },
  { file: 'CoolCow.vrm', licence: 'CC0' },
  { file: 'CoolAlien.vrm', licence: 'CC0' },
  { file: 'UnicornPerson.vrm', licence: 'CC0' },
  { file: 'Hacker.vrm', licence: 'ours', note: 'Generated for the Oasis' },
]

/** Asset folders and the licence each ships under, for ASSETS.md. `match` is a path prefix. */
export const assetLicences = [
  { match: 'public/ui/', licence: 'Made for the Oasis (generated art); MIT with the code', source: 'the Oasis' },
  { match: 'public/skies/', licence: 'Made for the Oasis (generated panoramas, 2026-11-09); MIT with the code', source: 'the Oasis' },
  { match: 'public/splash/', licence: 'Made for the Oasis (generated art); MIT with the code', source: 'the Oasis' },
  { match: 'public/icons/', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/audio/kenney', licence: 'CC0 1.0', source: 'Kenney (kenney.nl)' },
  { match: 'public/animations/ual/', licence: 'CC0 1.0', source: 'Quaternius, Universal Animation Library (Standard)' },
  { match: 'public/fonts/emoji/', licence: 'SIL Open Font License 1.1 (OFL.txt beside the files)', source: 'Google, Noto Emoji' },
  { match: 'public/fonts/gentilis_', licence: 'SIL Open Font License 1.1', source: 'SIL International, Gentilis (as a three.js typeface file)' },
  { match: 'public/fonts/helvetiker_', licence: 'MgOpen licence (free to use, copy and distribute)', source: 'Magenta Ltd, MgOpen Moderna as "helvetiker" (three.js typeface files)' },
  { match: 'public/fonts/inter-', licence: 'SIL Open Font License 1.1', source: 'Rasmus Andersson, Inter' },
  { match: 'public/lipsync/wlipsync/', licence: 'MIT', source: 'mrxz, wLipSync (browser runtime and starter profile)' },
  { match: 'public/headaudio.mjs', licence: 'MIT', source: 'met4citizen, HeadAudio' },
  { match: 'public/headworklet.min.mjs', licence: 'MIT', source: 'met4citizen, HeadAudio' },
  { match: 'public/model-en-mixed.bin', licence: 'MIT', source: 'met4citizen, HeadAudio (viseme model)' },
  { match: 'public/parameters.mjs', licence: 'MIT', source: 'met4citizen, HeadAudio' },
  { match: 'public/training.mjs', licence: 'MIT', source: 'met4citizen, HeadAudio' },
  { match: 'public/favicon.svg', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/oasislogo.jpg', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/manifest.webmanifest', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
]
