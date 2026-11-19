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
  'packages/oasis-agent-engine/',
  'plugins/oasis/',
  'plugins/oasis-village/',
  'skills/enter-the-oasis/',
  '.claude-plugin/marketplace.json',
  'pnpm-lock.yaml',
  'next.config.mjs',
  'next-env.d.ts',
  'instrumentation.ts',
  'tsconfig.json',
  'tailwind.config.js',
  'postcss.config.js',
  'LICENSE',
  'scripts/oasis.mjs',
  'scripts/slim/seed-first-world.mjs',
  'data/credits.json',
  'data/ground-presets-extras.json',

  // Assets: ours, or under a licence that allows passing them on (each has a line in assetLicences below)
  'public/ui/rail/',
  'public/ui/spellbook/',
  'public/ui/textures-extracted/',
  'public/skies/',
  'public/icons/',
  'public/fonts/',
  'public/lipsync/',
  'public/voice/',
  'public/favicon.svg',
  'public/oasislogo.jpg',
  'public/audio/kenney_interface-sounds/',
  'public/audio/kenney_impact-sounds/',
  'public/audio/kenney-ui/',
  'public/audio/kenney-rpg/',
  'public/audio/kenney_voiceover-pack/',
  'public/audio/kenney_voiceover-pack-fighter/',
  'public/animations/ual/',
  // The first world (Oasis Dusk): its ground, the two textures its crafted things use, five small plants
  'public/ground/gravelly_sand_diff_1k.jpg',
  'public/ground/rock_face_diff_1k.jpg',
  'public/ground/marble_01_diff_1k.jpg',
  'public/models/stylized-nature/grass_common_tall.gltf',
  'public/models/stylized-nature/Grass_Common_Tall.bin',
  'public/models/stylized-nature/grass_common_short.gltf',
  'public/models/stylized-nature/Grass_Common_Short.bin',
  'public/models/stylized-nature/grass_wispy_tall.gltf',
  'public/models/stylized-nature/Grass_Wispy_Tall.bin',
  'public/models/stylized-nature/grass_wispy_short.gltf',
  'public/models/stylized-nature/Grass_Wispy_Short.bin',
  'public/models/stylized-nature/fern_1.gltf',
  'public/models/stylized-nature/Fern_1.bin',
  'public/models/stylized-nature/Textures/Grass.jpg',
  'public/models/stylized-nature/Textures/Leaves.jpg',
]

export const exclude = [
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  'src/test-utils/',
  'packages/oasis-agent-engine/sandbox/',
  // The engine's lab notebook: findings from the owner's machine, not documentation
  'packages/oasis-agent-engine/README.md',
  // The workshop's manifest for the world tools; the cut ships plugins/oasis/mcp/directory.mcp.json as .mcp.json
  'plugins/oasis/.mcp.json',
  // The workshop's two-window launcher for Windows; the cut starts with scripts/oasis.mjs everywhere
  'plugins/oasis/scripts/oasis-launch.ps1',
  '**/*.url',
  'public/ui/spellbook/tiles/_alternates/',
  // The hosted site's marketing pages
  'src/app/landing/',
  'src/app/website/',
  'src/components/site/',
  // Making pictures, video, music, speech and 3D models with AI services: not part of the slim Oasis
  'src/app/api/imagine/',
  'src/app/api/media/image/',
  'src/app/api/media/video/',
  'src/app/api/media/voice/',
  'src/app/api/media/music/',
  'src/app/api/conjure/',
]

/**
 * Avatars in the cut: only files whose own metadata says CC0 (the cut checks it again and refuses otherwise).
 * Their thumbnails come along. The first one is the body a new player starts in.
 */
export const avatars = [
  { file: 'CoolAlien.vrm', licence: 'CC0' },
  { file: 'UnicornPerson.vrm', licence: 'CC0' },
  { file: 'David.vrm', licence: 'CC0' },
  { file: 'Witch.vrm', licence: 'CC0' },
  { file: 'EYEWizard.vrm', licence: 'CC0' },
  { file: 'HodlerKing.vrm', licence: 'CC0' },
  { file: 'CoolGuitar.vrm', licence: 'CC0' },
  { file: 'CuteMoth.vrm', licence: 'CC0' },
  { file: 'CoolCow.vrm', licence: 'CC0' },
  { file: 'Mushy.vrm', licence: 'CC0' },
  { file: 'The_Worm.vrm', licence: 'CC0' },
  { file: 'EYECleric.vrm', licence: 'CC0' },
]

/** The world a new install opens in: a seed of the workshop, with its sky changed to one the cut ships. */
export const firstWorld = { seed: 'prisma/default-worlds/oasis-dusk.world.json', sky: 'oasis_dusk' }

/**
 * Lines of source the cut changes, because they name an asset the cut does not ship. Each `from` must be
 * found exactly once, or the cut stops: a changed workshop is noticed, not silently shipped broken.
 */
export const transforms = [
  // A new player's body: one the cut ships (the workshop's default is CC BY and stays there).
  { file: 'src/lib/profile-defaults.ts', from: "'/avatars/gallery/VIPE_Hero__2902.vrm'", to: "'/avatars/gallery/CoolAlien.vrm'" },
  // The player's walk, run and sprint: the CC0 animation pack instead of the Mixamo files.
  { file: 'src/lib/forge/animation-library.ts', from: "{ id: 'walk',        filename: 'Unarmed Walk Forward.fbx',        label: 'Walk',       category: 'locomotion' },", to: "{ id: 'walk',        filename: 'ual/UAL1_Standard.glb', glbClipName: 'Walk_Loop', label: 'Walk',       category: 'locomotion' }," },
  { file: 'src/lib/forge/animation-library.ts', from: "{ id: 'run',         filename: 'Medium Run.fbx',                  label: 'Run',           category: 'locomotion' },", to: "{ id: 'run',         filename: 'ual/UAL1_Standard.glb', glbClipName: 'Jog_Fwd_Loop', label: 'Run',           category: 'locomotion' }," },
  { file: 'src/lib/forge/animation-library.ts', from: "{ id: 'sprint',      filename: 'Running.fbx',                     label: 'Sprint',        category: 'locomotion' },", to: "{ id: 'sprint',      filename: 'ual/UAL1_Standard.glb', glbClipName: 'Sprint_Loop', label: 'Sprint',        category: 'locomotion' }," },
]

/**
 * The full edition (`--edition full`): every feature on, and every asset whose licence allows passing it on.
 * Size is no longer the rule (Anthropic's directory, with its 50 MiB, is closed to this plugin anyway);
 * the licence is. What stays out is listed in `fullLeftOut`, with the reason.
 */
export const full = {
  archiveLimitMib: 1500,
  fileLimit: 20000,
  include: [
    'public/models/quaternius-scifi/',
    'public/models/scifi-essentials/',
    'public/models/quaternius-medieval-village/',
    'public/models/quaternius-base-characters/',
    'public/models/cyberpunk/',
    'public/models/stylized-nature/',
    'public/models/fantasy-props/',
    'public/models/scifi-megakit/',
    'public/models/quaternius-animations/',
    'public/models/quaternius-animations-2/',
    'public/models/trains/',
    'public/models/kenney-furniture/',
    'public/models/kenney-animated-characters/',
    'public/hdri/',
    'public/ground/',
    'public/splash/',
    'public/ui/',
    'public/thumbs/',
    'public/portal-thumbs/',
    'prisma/seed-default-worlds.ts',
  ],
  /** Rules of `exclude` that the full edition does not apply: the AI generation routes are back (each needs the user's own key). */
  keep: [
    'src/app/api/imagine/',
    'src/app/api/media/image/',
    'src/app/api/media/video/',
    'src/app/api/media/voice/',
    'src/app/api/media/music/',
    'src/app/api/conjure/',
  ],
  /** Every avatar whose own metadata says CC0. */
  avatars: 'all-cc0',
  /** The worlds a new install has; the first is where it opens. Each is checked: a world that places an unshipped file stops the cut. */
  worlds: [
    { seed: 'prisma/default-worlds/oasis-dusk.world.json' },
    { seed: 'prisma/default-worlds/zen-workshop.world.json' },
    { seed: 'prisma/default-worlds/the-council.world.json' },
    { seed: 'prisma/default-worlds/floating-isle.world.json' },
    { seed: 'prisma/default-worlds/neon-harbor.world.json' },
  ],
}

/** What no edition ships, and why (printed by the cut, written into ASSETS.md). */
export const fullLeftOut = [
  { match: 'public/avatars/', what: 'avatars whose metadata is not CC0', why: 'CC BY for named licensees only, "Other", "Redistribution Prohibited", or made with a 3D generation service' },
  { match: 'public/animations/', what: 'the Mixamo animations (.fbx)', why: 'Adobe allows them inside a product, not as files in a public repository' },
  { match: 'public/models/random-objects/', what: '12 low-poly objects', why: 'source and licence unknown' },
  { match: 'public/models/characters/', what: '4 characters', why: 'source and licence unknown' },
  { match: 'public/models/psx-derelict-furniture/', what: '6 pieces of furniture', why: 'source and licence unknown' },
  { match: 'public/models/highlands-fantasy/', what: '17 buildings', why: 'a free itch.io pack with no licence that allows passing it on' },
  { match: 'public/conjured/', what: 'showcase 3D models made with Meshy and Tripo', why: 'the generation service\'s terms, not checked' },
  { match: 'public/audio/spells/', what: 'Mixkit spell sounds and the owner\'s recordings', why: 'Mixkit forbids passing its files on; the recordings are personal' },
  { match: 'public/audio/bg/', what: 'two music tracks', why: 'source unknown' },
  { match: 'public/audio/04515/', what: 'the hosted site\'s welcome voice', why: 'personal recording' },
  { match: 'public/_quality-check/', what: 'test files of the asset pipeline', why: 'not part of the product' },
  { match: 'public/images/', what: 'uploaded pictures', why: 'the owner\'s own uploads' },
  { match: 'public/generated-images/', what: 'showcase generated pictures', why: 'not part of the product' },
]

/** Asset folders and the licence each ships under, for ASSETS.md. `match` is a path prefix. */
export const assetLicences = [
  { match: 'public/ui/', licence: 'Made for the Oasis (generated art); MIT with the code', source: 'the Oasis' },
  { match: 'public/skies/', licence: 'Made for the Oasis (generated panoramas, 2026-11-09); MIT with the code', source: 'the Oasis' },
  { match: 'public/icons/', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/audio/kenney', licence: 'CC0 1.0', source: 'Kenney (kenney.nl)' },
  { match: 'public/animations/ual/', licence: 'CC0 1.0', source: 'Quaternius, Universal Animation Library (Standard)' },
  { match: 'public/fonts/emoji/', licence: 'SIL Open Font License 1.1 (OFL.txt beside the files)', source: 'Google, Noto Emoji' },
  { match: 'public/fonts/gentilis_', licence: 'SIL Open Font License 1.1', source: 'SIL International, Gentilis (as a three.js typeface file)' },
  { match: 'public/fonts/helvetiker_', licence: 'MgOpen licence (free to use, copy and distribute)', source: 'Magenta Ltd, MgOpen Moderna as "helvetiker" (three.js typeface files)' },
  { match: 'public/fonts/inter-', licence: 'SIL Open Font License 1.1', source: 'Rasmus Andersson, Inter' },
  { match: 'public/lipsync/wlipsync/', licence: 'MIT', source: 'mrxz, wLipSync (browser runtime and starter profile)' },
  { match: 'public/voice/', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/ground/sbs1/', licence: 'CC0 1.0', source: 'Screaming Brain Studios, Tiny Texture Pack' },
  { match: 'public/ground/sbs2/', licence: 'CC0 1.0', source: 'Screaming Brain Studios, Tiny Texture Pack 2' },
  { match: 'public/ground/', licence: 'CC0 1.0', source: 'Poly Haven (polyhaven.com)' },
  { match: 'public/hdri/', licence: 'CC0 1.0', source: 'Poly Haven (polyhaven.com) and ambientCG night skies' },
  { match: 'public/models/stylized-nature/', licence: 'CC0 1.0', source: 'Quaternius, Stylized Nature MegaKit' },
  { match: 'public/models/quaternius-scifi/', licence: 'CC0 1.0', source: 'Quaternius, Sci-Fi Essentials Kit' },
  { match: 'public/models/scifi-essentials/', licence: 'CC0 1.0', source: 'Quaternius, Sci-Fi Essentials Kit' },
  { match: 'public/models/scifi-megakit/', licence: 'CC0 1.0', source: 'Quaternius, Modular Sci-Fi MegaKit' },
  { match: 'public/models/quaternius-medieval-village/', licence: 'CC0 1.0', source: 'Quaternius, Medieval Village MegaKit' },
  { match: 'public/models/quaternius-base-characters/', licence: 'CC0 1.0', source: 'Quaternius, Ultimate Modular Characters' },
  { match: 'public/models/quaternius-animations', licence: 'CC0 1.0', source: 'Quaternius, Universal Animation Library' },
  { match: 'public/models/cyberpunk/', licence: 'CC0 1.0', source: 'Quaternius, Cyberpunk Game Kit' },
  { match: 'public/models/fantasy-props/', licence: 'CC0 1.0', source: 'Quaternius, Fantasy RPG Pack' },
  { match: 'public/models/trains/', licence: 'CC0 1.0', source: 'Quaternius, Train Pack' },
  { match: 'public/models/kenney-', licence: 'CC0 1.0', source: 'Kenney (kenney.nl)' },
  { match: 'public/splash/', licence: 'Made for the Oasis (generated art); MIT with the code', source: 'the Oasis' },
  { match: 'public/thumbs/', licence: 'Made for the Oasis (pictures of the models above); MIT with the code', source: 'the Oasis' },
  { match: 'public/portal-thumbs/', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/favicon.svg', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
  { match: 'public/oasislogo.jpg', licence: 'Made for the Oasis; MIT with the code', source: 'the Oasis' },
]
