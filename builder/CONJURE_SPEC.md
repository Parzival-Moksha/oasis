# ╔═══════════════════════════════════════════════════════════════════╗
# ║  CONJURE — Team Arena Shooter with AI-Crafted Objects           ║
# ║  Vibe Jam 2026 Entry                                            ║
# ║  Deadline: May 1, 2026 @ 13:37 UTC                              ║
# ╚═══════════════════════════════════════════════════════════════════╝

## One-Sentence Pitch
> Conjure ridiculous AI-generated objects to build your team's fortress while gunning down the enemy — reload by doing situps.

## Genre
Shooter / Team Arena / Crafting

## Engine
Three.js (R3F — React Three Fiber) + Colyseus (authoritative multiplayer)

## Stack
| Layer       | Tech                          | Notes                              |
|-------------|-------------------------------|--------------------------------------|
| Client      | Vite + React + R3F + Three.js | No Next.js. Minimal bundle.          |
| State       | Zustand (client only)         | Colyseus handles authoritative state |
| Server      | Node.js + Colyseus            | Authoritative game logic             |
| AI Conjure  | Claude API (Haiku/Sonnet)     | Parameterized geometry generation    |
| Deploy      | VPS (Nürnberg, 4vCPU/8GB)    | Ubuntu, nginx + SSL                  |
| Domain      | TBD (04515.xyz or new)        | Must be instant-load, no login       |

---

## ═══════════════════════════════════════════════════════════════
## 1. CORE LOOP
## ═══════════════════════════════════════════════════════════════

```
SPAWN → SHOOT → EARN XP → LEVEL UP → CHOOSE SKILL → CONJURE/HEAL/DOMINATE → REPEAT
```

Two teams: **Red** vs **Blue**. Symmetrical bases on opposite ends of the map.
Goal: destroy enemy objects, protect your own. Most XP at round end wins.

Round length: **10 minutes**. Scoreboard shows at end. New round auto-starts.

---

## ═══════════════════════════════════════════════════════════════
## 2. PLAYER
## ═══════════════════════════════════════════════════════════════

### 2.1 Stats (Base)
| Stat       | Base Value |
|------------|------------|
| HP         | 100        |
| Move Speed | 6 m/s      |
| Fire Rate  | 3 rps      |
| Magazine   | 20 rounds  |
| Extra Ammo | 0          |
| Mana       | 0 / 20     |
| Max Objects | 1         |

Player spawns with **15 rounds loaded, 0 extra ammo, 0 mana**.

### 2.2 Avatar
VRM models from `/avatars/gallery/` (44 available). Player picks avatar on first join
(simple grid selector, no login). Avatar selection persists via localStorage.

Starter avatars (unlocked at level 0): 8 preselected (e.g., Cookieman, CoolAlien, Mushy,
RippedJimbo, Cyberpal, CoolCow, MushroomFairy, CosmicBot).

Additional avatars unlock every 2 levels. By level 10, ~13 avatars unlocked.
Full roster (44) unlocked at level 20.

### 2.3 Gun
GLTF model: `Gun_Rifle.gltf` from `/models/scifi-essentials/`.
Bone-attached to avatar's right hand. Visible in TPS view.

---

## ═══════════════════════════════════════════════════════════════
## 3. CONTROLS
## ═══════════════════════════════════════════════════════════════

| Key/Input       | Action                                    |
|-----------------|-------------------------------------------|
| WASD            | Move (relative to camera facing)          |
| Mouse Move      | Rotate camera (TPS orbit)                 |
| Left Click      | Shoot                                     |
| Right Click     | Aim Down Sight (ADS)                      |
| Shift           | Sprint (1.5x speed, drains no stamina)    |
| Space           | Jump                                      |
| F               | Situp — reload magazine OR generate ammo  |
| M (hold)        | Channel mana (+1/sec, dance animation)    |
| C               | Open conjure prompt (if mana >= 20)       |
| T               | Team chat                                 |
| Y               | Global chat                               |
| Tab             | Scoreboard overlay                        |
| Esc             | Release pointer lock / menu               |

### 3.1 Situp Mechanic (F key)
- If magazine < 20: play `situps` animation, 2 sec, refill magazine to 20
- If magazine == 20: play `situps` animation, +1 extra ammo per second (continuous)
- Player can rotate camera with mouse during situps
- Player CANNOT move or shoot during situps
- Press F again or any movement key to cancel

### 3.2 Mana Mechanic (M key, hold)
- Hold M: play random dance animation (from: breakdance, hip-hop, shuffling, twist,
  moonwalk, twerk, capoeira, thriller). Randomized each time.
- Mana increases +1/sec while held. Max 20.
- Player can rotate camera with mouse during dance
- Player CANNOT move or shoot during dance
- Release M to stop. Mana persists until used.

### 3.3 Conjure (C key)
- Only available when mana >= 20
- Opens text input overlay (centered, minimal, translucent)
- Player types prompt + optional name for the object
- On submit: mana → 0, player locked in `ual-spell-shoot` animation
- Object spawns 3m in front of player, piece by piece (streamed geometry)
- VFX: turquoise particles flowing from avatar hands → object. Lightning crackles.
- Sound: mystical conjure SFX
- Duration: 3-5 seconds (while geometry streams in)
- Player can rotate camera during conjure, cannot move/shoot
- LLM names the object if player didn't provide a name

---

## ═══════════════════════════════════════════════════════════════
## 4. SHOOTING
## ═══════════════════════════════════════════════════════════════

### 4.1 Ballistics
- Hitscan (instant ray, no projectile travel time)
- Hip fire: 3° cone randomization
- ADS (right click): 1° cone, player moves at 0.4x speed
- Damage: **10 base** at point blank
- Distance falloff: linear, starts at 20m, reaches 0 at 50m
  - Formula: `damage = 10 * max(0, 1 - max(0, distance - 20) / 30)`
- Fire rate: 3 rounds/sec base
- Muzzle flash VFX (short-lived point light + sprite)
- Tracer: thin turquoise line, 0.1sec lifetime

### 4.2 Hit Feedback
- **On hit enemy**: red hit marker crosshair flash, damage number floats up
- **On hit object**: orange hit marker, damage number
- **On kill**: skull icon flash + kill feed message
- **On being hit**: play `ual-hit-chest` animation (blend, don't interrupt movement),
  screen edge flash red on damage side
- **On death**: play `ual-death` animation, 5 sec respawn timer, camera orbits body,
  then `ual-lay-to-idle` at spawn base

### 4.3 HP/Damage Visuals
- HP < 30: red vignette pulsing at screen edges. Intensity = `(30 - hp) / 30`.
  Pulse rate increases as HP drops.
- Blood burst particle effect on avatar when hit (red particles, 0.3sec)

---

## ═══════════════════════════════════════════════════════════════
## 5. XP & LEVELING
## ═══════════════════════════════════════════════════════════════

### 5.1 XP Sources
| Action          | XP                                          |
|-----------------|---------------------------------------------|
| Damage dealt    | 1 XP per 1 damage (after distance falloff)  |
| Kill enemy      | +100 XP                                     |
| Destroy object  | +200 XP                                     |
| Conjure object  | 100 base + humor bonus (0-100, LLM-judged)  |

### 5.2 Level Curve
```
XP to reach level N = floor(100 × N^1.8)
```

| Level | Total XP Needed | Cumulative |
|-------|-----------------|------------|
| 1     | 100             | 100        |
| 2     | 348             | 448        |
| 3     | 693             | 1,141      |
| 4     | 1,117           | 2,258      |
| 5     | 1,610           | 3,868      |
| 10    | 6,310           | ~25,000    |
| 15    | 13,860          | ~80,000    |
| 20    | 24,025          | ~180,000   |

### 5.3 Skill Points
Each level = **1 skill point**. Allocated freely into any of 6 specializations.

---

## ═══════════════════════════════════════════════════════════════
## 6. SKILL TREE
## ═══════════════════════════════════════════════════════════════

6 specializations, each with 5 max ranks. Linear progression within each.
Player chooses where to put each point. No respec (decisions matter).

| Spec         | Per Rank         | At Max (5)        | Notes                        |
|--------------|------------------|-------------------|------------------------------|
| **Gunner**   | +20% fire rate   | 2x fire rate      | 3 → 6 rps                   |
| **Tank**     | +20 HP           | 200 HP total      | Doubles survivability        |
| **Crafter**  | +1 object slot   | 6 objects max      | + polynomial HP boost below  |
| **Healer**   | +2 HP/s allies   | 10 HP/s allies     | Self-heal at 50% rate        |
| **Runner**   | +20% move speed  | 2x speed (12 m/s) | Affects base speed only      |
| **Marksman** | −0.4° cone       | 1° hip / 0° ADS   | ADS becomes laser-accurate   |

### 6.1 Crafter HP Scaling
Object HP scales polynomially with Crafter rank:

| Crafter Rank | Max Objects | Object HP                  |
|--------------|-------------|----------------------------|
| 0 (base)     | 1           | 200                        |
| 1            | 2           | 400  (200 + 200×1.0)       |
| 2            | 3           | 680  (200 + 200×2^1.4)     |
| 3            | 4           | 1,040 (200 + 200×3^1.4)    |
| 4            | 5           | 1,480 (200 + 200×4^1.4)    |
| 5            | 6           | 1,990 (200 + 200×5^1.4)    |

Formula: `objectHP = 200 + floor(200 × rank^1.4)`

### 6.2 Healer Mechanic
- Healing is **proximity-based**: 8m radius
- Play `praying` animation while healing (hold H key? or auto when near damaged ally)
- Heals all allies + allied objects in range
- Self-heal at 50% effectiveness (rank 5: 5 HP/s self, 10 HP/s allies)
- VFX: green/turquoise glow particles rising from healer
- Cannot shoot or move while healing (channeled)
- Press H to toggle heal mode when Healer rank >= 1

### 6.3 Level-Up Flow
- XP bar at bottom of screen fills up
- On level up: golden flash VFX, sound effect, "LEVEL UP!" text
- Skill allocation popup (6 icons, click to allocate). Can dismiss and allocate later
  via Tab menu. Point persists until spent.

---

## ═══════════════════════════════════════════════════════════════
## 7. CONJURED OBJECTS (THE HOOK)
## ═══════════════════════════════════════════════════════════════

### 7.1 What Gets Conjured
- **NO GLBs.** Pure Three.js parameterized geometry.
- LLM receives the prompt and returns a JSON scene description:
  ```json
  {
    "name": "Wobbly Toilet Tower",
    "humor_score": 78,
    "parts": [
      { "type": "box", "size": [2, 3, 2], "position": [0, 1.5, 0], "color": "#8B4513" },
      { "type": "cylinder", "radius": 0.8, "height": 1, "position": [0, 3.5, 0], "color": "#FFFFFF" },
      { "type": "sphere", "radius": 0.3, "position": [0.5, 4.2, 0], "color": "#FFD700" }
    ]
  }
  ```
- Available primitives: box, sphere, cylinder, cone, torus, plane
- Each part has: type, dimensions, position (relative to object center), rotation, color
- Max 12 parts per object (keeps it lightweight)
- Objects are grouped as a single entity for collision/HP tracking

### 7.2 Object Properties
- HP: based on Crafter rank (see 6.1)
- Collision: axis-aligned bounding box, blocks player movement + bullets
- Team-colored outline glow (red/blue) so you can tell whose it is
- Damage visual: parts detach/fall off as HP decreases (at 75%, 50%, 25%)
- Destruction: explosion particle effect + parts scatter with physics, fade out

### 7.3 Humor Scoring
The same LLM call that generates the geometry also scores humor (0-100).
- Score is shown briefly when object spawns: "😂 78/100 — Wobbly Toilet Tower"
- Bonus XP = humor_score (so 0-100 XP bonus on top of base 100)
- Leaderboard tracks "Funniest Object" per round

### 7.4 Streaming Construction VFX
Objects appear piece-by-piece over 3-5 seconds:
1. Turquoise wireframe outline appears first
2. Each part materializes with a flash (bottom to top)
3. Particles stream from player hands to the forming object
4. Final flash when complete, object becomes solid + collidable
5. Name tag appears floating above object

---

## ═══════════════════════════════════════════════════════════════
## 8. MAP
## ═══════════════════════════════════════════════════════════════

### 8.1 Layout
```
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   [RED BASE]          NEUTRAL ZONE         [BLUE BASE] ║
║   ┌──────┐                                 ┌──────┐    ║
║   │SPAWN │    ░░░ OPEN ARENA ░░░           │SPAWN │    ║
║   │POINT │                                 │POINT │    ║
║   └──────┘                                 └──────┘    ║
║                                                        ║
║                    [EXIT PORTAL]                        ║
╚════════════════════════════════════════════════════════╝
```

- Map size: 200m × 200m (walled, no escape)
- Flat terrain with slight elevation changes (hills, ramps)
- Symmetrical: mirrored along center axis
- Walls: invisible force-field with subtle grid shader
- Bases: 30m × 30m safe zones where players can't be damaged (spawn protection, 3 sec)
- Center: open arena, some procedural cover (low walls, pillars)
- Ground: textured grid, team colors fade from bases toward center

### 8.2 Lighting
- Directional sun (warm white)
- Ambient: low, moody
- Team bases glow their respective color
- Conjured objects emit faint light of team color
- No baked lighting — everything dynamic

### 8.3 Skybox
- Dark sci-fi sky with stars. Subtle nebula. NOT distracting.
- Could use a simple gradient shader: dark blue → black with star particles

---

## ═══════════════════════════════════════════════════════════════
## 9. UI / HUD
## ═══════════════════════════════════════════════════════════════

All UI is HTML overlay (CSS), not in WebGL. Minimal, clean, semi-transparent.

### 9.1 HUD Elements
```
┌─────────────────────────────────────────────────────────┐
│  [Kill Feed]                              [Minimap?]    │
│                                                         │
│                                                         │
│                    +  (crosshair)                        │
│                                                         │
│                                                         │
│  AMMO: 15/20 +0    ████████░░ HP: 73/100               │
│  MANA: ████░░░░░░░░ 8/20     XP: ████░░ Lv.3          │
│  Objects: 1/2       [RED: 2,450] vs [BLUE: 3,120]      │
└─────────────────────────────────────────────────────────┘
```

- **Top-left**: Kill feed (last 5 kills, fades after 5 sec)
- **Bottom-left**: Ammo (magazine/max + extra rounds)
- **Bottom-center**: HP bar (red when low), Mana bar (turquoise), XP bar
- **Bottom-right**: Team scores, object count
- **Center**: crosshair (simple dot + lines, flares on hit)
- **Tab hold**: full scoreboard (all players, K/D/A, objects, level)

### 9.2 Chat
- Team chat (T): only your team sees it. Colored team prefix.
- Global chat (Y): everyone sees it. White text.
- Rate limit: 1 message per 2 seconds per player
- Max length: 140 characters
- Displayed bottom-left, fades after 8 seconds
- Profanity filter: none (it's a vibe jam, keep it real)

---

## ═══════════════════════════════════════════════════════════════
## 10. MULTIPLAYER ARCHITECTURE
## ═══════════════════════════════════════════════════════════════

### 10.1 Colyseus Server
- **Authoritative**: all game logic on server. Client is dumb renderer.
- Room: "arena" — one room per match, max 20 players (10v10)
- Tick rate: 20 Hz (server processes inputs, broadcasts state)
- Client interpolation: 60 Hz (smooth between server ticks)
- Client-side prediction for movement (reconcile with server)

### 10.2 State Schema (Colyseus)
```typescript
class Player {
  id: string
  username: string
  team: "red" | "blue"
  avatar: string           // VRM filename
  x: number; y: number; z: number
  rotY: number             // Y-axis rotation
  hp: number
  maxHp: number
  ammo: number
  extraAmmo: number
  mana: number
  xp: number
  level: number
  kills: number
  deaths: number
  animation: string        // current animation state
  skills: { gunner: number, tank: number, crafter: number, healer: number, runner: number, marksman: number }
  objectCount: number
  maxObjects: number
  alive: boolean
}

class ConjuredObject {
  id: string
  ownerId: string
  team: "red" | "blue"
  name: string
  hp: number
  maxHp: number
  x: number; y: number; z: number
  parts: string            // JSON-encoded geometry description
  humorScore: number
  createdAt: number
}

class ArenaState {
  players: MapSchema<Player>
  objects: MapSchema<ConjuredObject>
  redScore: number
  blueScore: number
  roundTimeLeft: number    // seconds
  roundNumber: number
}
```

### 10.3 Client → Server Messages
| Message        | Payload                     | Rate Limit    |
|----------------|-----------------------------|---------------|
| `move`         | { dx, dz, sprint, jump }    | Every frame   |
| `rotate`       | { rotY }                    | Every frame   |
| `shoot`        | { }                         | Fire rate     |
| `ads`          | { active: boolean }         | On change     |
| `situp`        | { start: boolean }          | On change     |
| `dance`        | { start: boolean }          | On change     |
| `conjure`      | { prompt, name? }           | 1 per 10 sec  |
| `allocate`     | { skill: string }           | On level up   |
| `heal`         | { start: boolean }          | On change     |
| `chat`         | { text, channel }           | 1 per 2 sec   |

### 10.4 Server → Client Broadcasts
- Full state patch every tick (Colyseus handles delta compression)
- `kill` event (killer, victim, weapon)
- `objectDestroyed` event (object name, destroyer)
- `conjureResult` event (object geometry + humor score)
- `levelUp` event (player, newLevel)
- `roundEnd` event (scores, MVP)

### 10.5 Anti-Cheat
- **Server authoritative**: client never decides damage, HP, XP, or position
- Server validates movement speed (max delta per tick based on Runner rank)
- Server validates fire rate (max based on Gunner rank)
- Server validates conjure cooldown + mana
- Rate-limited inputs (excess inputs dropped silently)
- No client-side HP/ammo/mana state is trusted. Ever.

---

## ═══════════════════════════════════════════════════════════════
## 11. BOTS
## ═══════════════════════════════════════════════════════════════

Simple state-machine bots for low-pop servers (< 6 real players).

States: `patrol → chase → shoot → retreat → heal`
- Patrol: walk random waypoints
- Chase: move toward nearest enemy if in 40m range
- Shoot: stop, face enemy, fire (with randomized cone like a bad player)
- Retreat: if HP < 30, run toward base
- Heal: at base, wait until HP full, then patrol

Bots do NOT conjure (keeps it simple). They have [BOT] prefix in names.
Fill to 6 players minimum (3v3). As real players join, bots leave.

---

## ═══════════════════════════════════════════════════════════════
## 12. VIBEVERSE PORTAL
## ═══════════════════════════════════════════════════════════════

### 12.1 Exit Portal
- Located at map edge (center-north)
- Visual: torus ring geometry + glowing particles (green/turquoise)
- Label: "VIBEVERSE PORTAL" floating text
- On enter: redirect to `https://jam.pieter.com/portal/2026` with query params:
  ```
  ?username=X&color=red|blue&speed=6&ref=CONJURE_DOMAIN
  ```

### 12.2 Start Portal (incoming players)
- If URL has `?portal=true`: spawn red entry portal at player's spawn point
- Player appears walking out of the portal
- Portal links back to `?ref=` URL (the game they came from)
- On enter start portal: redirect back with all query params preserved

### 12.3 Vibe Jam Widget
Add to HTML `<head>`:
```html
<script async src="https://jam.pieter.com/2026/widget.js"></script>
```

---

## ═══════════════════════════════════════════════════════════════
## 13. LEADERBOARD
## ═══════════════════════════════════════════════════════════════

### 13.1 In-Round (Tab key)
| Column         | Description                    |
|----------------|--------------------------------|
| Player         | Username + avatar thumbnail    |
| Level          | Current level                  |
| K / D          | Kills / Deaths                 |
| Damage         | Total damage dealt             |
| Objects        | Objects currently alive        |
| Funniest       | Highest humor-scored object    |

### 13.2 End-of-Round
- MVP: highest XP earned this round
- Funniest Conjurer: highest cumulative humor score
- Longest-Surviving Object: name + duration + creator

---

## ═══════════════════════════════════════════════════════════════
## 14. SOUND DESIGN
## ═══════════════════════════════════════════════════════════════

All sounds procedurally generated or from free SFX libraries. NO large audio files.

| Event            | Sound                                        |
|------------------|----------------------------------------------|
| Shoot            | Short punchy "pew" — synth generated         |
| Hit enemy        | Meaty thwack                                 |
| Hit object       | Metallic clang                               |
| Kill             | Deep boom + kill confirmed chime             |
| Death            | Low thud + flatline                          |
| Conjure start    | Rising mystical hum                          |
| Conjure complete | Magical "ding" + sparkle                     |
| Level up         | Triumphant fanfare (short, 1 sec)            |
| Situp            | Grunt                                        |
| Dance/Mana       | Music snippet matching dance animation       |
| Heal             | Soft chime loop                              |
| Low HP           | Heartbeat, increasing tempo                  |
| Portal           | Whooshing hum                                |

---

## ═══════════════════════════════════════════════════════════════
## 15. VFX
## ═══════════════════════════════════════════════════════════════

| Effect              | Implementation                                    |
|---------------------|---------------------------------------------------|
| Muzzle flash        | PointLight flash + billboard sprite, 0.05sec       |
| Tracer              | Thin line (BufferGeometry), turquoise, 0.1sec fade |
| Blood burst         | Red particle burst on hit, 0.3sec                  |
| Object damage       | Parts detach at 75/50/25% HP thresholds            |
| Object destruction  | Parts scatter outward with gravity, fade out 2sec  |
| Conjure stream      | Particles flow from player → object position       |
| Conjure lightning   | Thin branching lines, turquoise, flicker           |
| Conjure wireframe   | Object outline appears before solid fill           |
| Heal aura           | Green rising particles around healer, 8m radius    |
| Low HP vignette     | Red screen-edge overlay, pulsing                   |
| Level up            | Golden ring expands from player, sparkle particles |
| Portal              | Torus + orbiting particles (from gist)             |
| Spawn protection    | Faint shield shimmer for 3sec after respawn        |

---

## ═══════════════════════════════════════════════════════════════
## 16. PERFORMANCE BUDGET
## ═══════════════════════════════════════════════════════════════

This is CRITICAL for the jam. "No loading screens" means:

- **Initial bundle**: < 500KB gzipped (Vite + Three.js + Colyseus client)
- **VRM avatars**: load on demand, ~2-5MB each. Show capsule placeholder until loaded.
- **Gun model**: < 100KB GLTF, preloaded
- **Animations**: UAL GLB bundle (~3MB for UAL1 + UAL2). Load async, use basic anims first.
- **No textures on map** — procedural materials (shaders, vertex colors)
- **Conjured objects**: pure geometry, no textures, < 1KB per object
- **Target**: playable within 3 seconds on broadband. Full avatars within 10 seconds.
- **FPS**: uncapped. Target 60+ on mid-range hardware.

### Loading Strategy
1. **Instant** (0-1sec): scene, map geometry, HUD, capsule players, connect to server
2. **Background** (1-5sec): UAL animation pack, gun model
3. **On demand** (per player): VRM avatars load as players join/enter view
4. **On conjure**: geometry is instant (primitive composition), name appears on creation

---

## ═══════════════════════════════════════════════════════════════
## 17. ANIMATIONS (ASSET INVENTORY)
## ═══════════════════════════════════════════════════════════════

All from existing Oasis animation library. Copy FBX + UAL GLBs to new repo.

| Game Action     | Animation ID          | Source File                |
|-----------------|-----------------------|----------------------------|
| Idle            | `ual-idle`            | UAL1_Standard.glb          |
| Walk            | `ual-walk`            | UAL1_Standard.glb          |
| Run             | `ual-jog`             | UAL1_Standard.glb          |
| Sprint          | `ual-sprint`          | UAL1_Standard.glb          |
| Gun idle        | `ual-pistol-idle`     | UAL1_Standard.glb          |
| ADS             | `ual-pistol-aim`      | UAL1_Standard.glb          |
| Shoot           | `ual-pistol-shoot`    | UAL1_Standard.glb          |
| Situp (reload)  | `situps`              | Situps.fbx                 |
| Dance (mana)    | `breakdance` / `hip-hop` / `shuffling` / `twist` / `moonwalk` / `twerk` / `capoeira` / `thriller` | Various FBX |
| Conjure cast    | `ual-spell-shoot`     | UAL1_Standard.glb          |
| Conjure channel | `ual-spell-idle`      | UAL1_Standard.glb          |
| Heal (pray)     | `praying`             | Praying.fbx                |
| Hit reaction    | `ual-hit-chest`       | UAL1_Standard.glb          |
| Death           | `ual-death`           | UAL1_Standard.glb          |
| Get up (respawn)| `ual-lay-to-idle`     | UAL2_Standard.glb          |
| Jump            | `jump`                | Jump.fbx                   |
| Crouch          | `ual-crouch-idle`     | UAL1_Standard.glb          |

---

## ═══════════════════════════════════════════════════════════════
## 18. REPO STRUCTURE
## ═══════════════════════════════════════════════════════════════

```
af_conjure/
├── client/                    # Vite + React + R3F
│   ├── src/
│   │   ├── main.tsx          # Entry point
│   │   ├── App.tsx           # Game shell
│   │   ├── components/
│   │   │   ├── Arena.tsx     # Main 3F Canvas + scene
│   │   │   ├── Player.tsx    # Local player controller
│   │   │   ├── RemotePlayer.tsx  # Other players (interpolated)
│   │   │   ├── ConjuredObject.tsx
│   │   │   ├── Gun.tsx       # Bone-attached weapon
│   │   │   ├── HUD.tsx       # HP, ammo, mana, XP overlay
│   │   │   ├── Scoreboard.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── SkillTree.tsx
│   │   │   ├── AvatarPicker.tsx
│   │   │   ├── Portal.tsx
│   │   │   ├── Map.tsx       # Ground, walls, bases
│   │   │   └── VFX/
│   │   │       ├── MuzzleFlash.tsx
│   │   │       ├── BloodBurst.tsx
│   │   │       ├── ConjureStream.tsx
│   │   │       ├── HealAura.tsx
│   │   │       ├── LowHPVignette.tsx
│   │   │       └── LevelUpRing.tsx
│   │   ├── hooks/
│   │   │   ├── useGameState.ts    # Colyseus room state
│   │   │   ├── useInput.ts        # Keyboard/mouse input
│   │   │   ├── useAudio.ts        # Sound manager
│   │   │   └── useAnimations.ts   # Animation state machine
│   │   ├── lib/
│   │   │   ├── network.ts         # Colyseus client wrapper
│   │   │   ├── interpolation.ts   # Client-side prediction
│   │   │   └── geometry.ts        # Parameterized object builder
│   │   └── store/
│   │       └── gameStore.ts       # Zustand (local UI state only)
│   ├── public/
│   │   ├── avatars/              # VRM files (copied from oasis)
│   │   ├── animations/           # FBX + UAL GLBs
│   │   └── models/               # Gun GLTF
│   └── index.html
├── server/                    # Colyseus game server
│   ├── src/
│   │   ├── index.ts          # Server entry
│   │   ├── ArenaRoom.ts      # Main game room
│   │   ├── state/
│   │   │   └── ArenaState.ts # Colyseus schema
│   │   ├── systems/
│   │   │   ├── combat.ts     # Damage, death, respawn
│   │   │   ├── movement.ts   # Position validation
│   │   │   ├── skills.ts     # Skill point allocation
│   │   │   ├── conjure.ts    # AI conjure pipeline
│   │   │   ├── healing.ts    # Heal system
│   │   │   ├── xp.ts         # XP + leveling
│   │   │   └── bots.ts       # Bot AI
│   │   └── utils/
│   │       └── physics.ts    # AABB collision
│   └── package.json
├── shared/                    # Shared types between client/server
│   └── types.ts
├── package.json               # Monorepo root
└── CONJURE_SPEC.md           # This file
```

---

## ═══════════════════════════════════════════════════════════════
## 19. BUILD PLAN (4 WEEKS)
## ═══════════════════════════════════════════════════════════════

### Week 1: Core Shooter (Apr 3-9)
- [ ] Scaffold Vite + R3F client, Colyseus server, monorepo
- [ ] Basic 3D scene: flat map, walls, team bases, skybox
- [ ] Player controller: WASD, mouse look, TPS camera
- [ ] Shooting: hitscan, damage falloff, muzzle flash, tracer
- [ ] Multiplayer: Colyseus room, player sync, interpolation
- [ ] HP system: damage, death, respawn at base
- [ ] Basic HUD: HP bar, ammo counter, crosshair
- [ ] Deploy to Nürnberg VPS (nginx + SSL)

### Week 2: Core Mechanics (Apr 10-16)
- [ ] Situp reload + ammo generation
- [ ] Mana system (dance animations)
- [ ] Conjure pipeline (LLM → parameterized geometry)
- [ ] Conjure VFX (streaming construction, particles, lightning)
- [ ] XP + leveling system
- [ ] Skill tree UI + all 6 specializations
- [ ] Object HP, damage visualization, destruction
- [ ] Avatar selection (VRM picker on join)
- [ ] Gun model bone-attachment

### Week 3: Polish (Apr 17-23)
- [ ] All VFX (blood burst, heal aura, low HP vignette, level up ring)
- [ ] Sound design (procedural + free SFX)
- [ ] Chat system (team + global)
- [ ] Scoreboard (in-round + end-of-round)
- [ ] Bots (state machine AI)
- [ ] Kill feed
- [ ] Portal system (vibeverse entry/exit)
- [ ] Performance optimization pass

### Week 4: Final Polish (Apr 24-30)
- [ ] Stress test with 20 players
- [ ] Anti-cheat hardening
- [ ] Domain setup + SSL
- [ ] Screenshot for submission
- [ ] Balance tuning (damage, XP, skill values)
- [ ] Bug fixes
- [ ] Submit form by Apr 30

---

## ═══════════════════════════════════════════════════════════════
## 20. AGENT GAME API (v2 — POST-JAM)
## ═══════════════════════════════════════════════════════════════

MCP server exposing game actions for AI agents to play:

```typescript
// Tools an agent would have:
get_game_state()     // → all player positions, HP, objects, scores
move(direction)      // → move player
shoot(targetId)      // → fire at target
conjure(prompt)      // → create object
use_skill(skill)     // → allocate skill point
chat(message)        // → send chat message
get_leaderboard()    // → current standings
```

Haiku at ~2-3 decisions/sec. Slow but functional. "AI agents can play our AI-built game."
This is a week 4 stretch goal or post-jam feature.

---

## ═══════════════════════════════════════════════════════════════
## FORM ANSWERS (PRE-FILLED)
## ═══════════════════════════════════════════════════════════════

- **X username**: @[YOUR_HANDLE]
- **Name of the game**: CONJURE
- **Game URL**: https://[TBD]
- **Pitch**: Conjure ridiculous AI-generated objects to build your team's fortress while gunning down the enemy — reload by doing situps.
- **Genre**: Shooter
- **Portal**: Yes
- **90% AI code**: Yes
- **Web accessible, no login**: Yes
- **Mobile ready**: No
- **Multiplayer**: Yes
- **No loading screens**: Yes
- **Engine**: ThreeJS
- **Inspiration**: What if Fortnite's building mechanic was replaced by AI that generates whatever stupid thing you type?

---

*ॐ conjure or die ॐ*
