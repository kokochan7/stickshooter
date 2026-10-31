# Stick Shooter design doc

Status: living document. Last updated 2026-10-31.
Live build: <https://stickshooter.kennk.workers.dev> (practice vs bots on "Yard").

This doc records how the game works today, with the real numbers from the
code, and the plan for what comes next: online multiplayer on Cloudflare,
skins and customization, and iOS. When the code and this doc disagree, the
code wins and this doc should be fixed. Weapon numbers live in
`src/sim/weapons.js`, damage rules in `src/sim/combat.js` and
`src/sim/constants.js`.

## 1. Vision

A fast, lightweight 3D stickman shooter that plays in a browser tab. The feel
is inspired by the early Stickman Gun Shooter 3D, but everything you see is
our own: a white stickman, our own low-poly guns, our own maps and UI. Under
the hood the gunplay follows Counter-Strike 1.6, so recoil, armor, headshots
and wallbangs behave the way CS players expect.

Pillars:

1. **Gun feel first.** CS 1.6 damage, spread, recoil and penetration. Crisp
   sound and visual feedback on every shot and hit.
2. **Smooth at high refresh rates.** 120/144 Hz rendering, raw mouse input,
   no hitches. Fixed-rate simulation with interpolation.
3. **Lightweight.** Loads in seconds on a phone connection. No large textures
   or audio files. The whole game is about 155 KB gzipped today.
4. **Fair online play.** The server is authoritative. Hits are judged with lag
   compensation so what you see is what you hit.
5. **Original look.** Readable silhouettes and a bright toy-like world rather
   than realism.

## 2. Where the game is today

The first build (PR #1) is a complete single-player loop:

- One map, **Yard**: a warehouse with thin wooden walls, a center monument,
  a container yard, a raised platform with railing, and concrete lanes.
- Bots with A* navigation that buy guns, fight and respawn.
- 13 guns, a shop (`B`), kevlar and kevlar + helmet.
- Practice economy: everyone starts with $16,000 (the CS cap), +$300 per
  kill, respawn after 3 seconds with your last loadout re-bought.
- HUD: health, armor, ammo, dynamic crosshair, kill feed, hit markers,
  scoreboard (`Tab`, split by team in Teams mode). First person only.
- Modes: Free for all (team `ffa`, white stickmen) and Teams (Red vs Blue,
  tinted stickmen, `map.teamSpawns` per side, `M` switches team without
  counting a death). Menu music is a streamed mp3 (`public/audio`).
- Synthesized audio (no downloads), pooled effects (tracers, impacts,
  muzzle flash, shell casings).
- Deployed as static assets on the `stickshooter` Cloudflare Worker.

The player stickman is white with no headband or vest. Skins come later
(see section 7).

### Maps and objective rounds (PR #12)

- `src/maps/index.js` lists the maps. `type` is `dm`, `bomb` or `hostage`.
  New maps are written with `src/maps/builder.js` (walls with doors,
  buildings, stairs, crates, pines, palms, water, footbridges and high
  bridges you can wade under). Water is a hole in the ground with a riverbed
  0.4 m down, so you can always step out; wading is 0.78x speed.
- Teams on a `bomb`/`hostage` map turns on `src/sim/objective.js`: rounds
  (4 s buy freeze, 1:55 bomb / 2:30 hostage, 5 s round end, first to 8),
  one life per round (late joiners within 20 s still spawn), spectating a
  teammate while dead. Bomb: given to a random Red human (else bot), E held
  3 s inside site A/B plants it, 35 s timer, Blue defuses in 10 s (5 s with
  the $200 kit), blast is 500 damage falling off to 0 at 20 m. Hostages:
  Blue presses E to lead one (they path-find with the nav grid), leading it
  into the rescue zone rescues it; all rescued wins, time out is a Red win.
  Hostages can't be shot yet.
- The nav grid now stores a floor height per cell (lowest surface with
  headroom) and only lets bots step up 0.46 m, so bots use stairs and
  bridges, wade through water, and never target crate tops.
- Snapshots carry `obj` (round, rounds, bomb, hostages). `hello` carries the
  map the client wants; the first human in an empty room sets it, and
  `welcome` tells the client which map the room plays. Protocol v5.

## 3. Architecture

```
src/sim/      Game rules. No DOM, no Three.js. Runs in the browser, in Node
              (tests) and, next, inside a Durable Object.
  game.js       Game state, fixed 128 Hz tick, weapons, buying, events
  movement.js   GoldSrc/CS 1.6 pmove: friction, accel, air strafe, duck, steps
  combat.js     Hitboxes, bullet tracing, wall penetration, armor
  weapons.js    Weapon table (CS 1.6 numbers)
  world.js      Box collision world and bullet materials
  bot.js/nav.js Bot AI and A* navigation
src/maps/     Map definitions (boxes + spawns)
src/client/   Rendering (Three.js), audio, input, HUD, viewmodel
src/main.js   Glue and main loop
```

**Simulation loop.** `Game.tick(cmds)` advances the world by exactly
`1/128` s. It takes a `Map<playerId, cmd>` and emits events (`shot`, `hit`,
`kill`, `spawn`, `reload`, ...). Everything that decides a fight happens in
the tick; the client only draws the result.

**Commands.** Humans and bots produce the same `cmd` object:

```js
{ fwd, side, jump, duck, walk, fire, alt, reload, slot, lastWeapon,
  yaw, pitch, actions }   // actions: e.g. buy requests
```

This is the seam multiplayer plugs into: the network layer only needs to
move cmds up and state down.

**Rendering.** `requestAnimationFrame` runs uncapped, so a 120 Hz screen gets
120 FPS. Each frame runs as many 128 Hz ticks as time allows, then renders with
`alpha = leftover / TICK_DT`, interpolating position, duck amount and view
punch between the previous and current tick. Mouse look is applied every
frame, not every tick, so aiming never feels tied to the tick rate. The whole
map is one merged draw call.

**Units.** The sim works in meters. CS values are written in CS units and
converted with `U = 0.025` (a CS player is 72 units tall and our stickman is
1.8 m, so 1 unit = 2.5 cm). Distances below are given in both.

**Randomness.** Spread and recoil use a seeded `mulberry32` RNG owned by
`Game`, so a server and client could agree on spread later (see 6.6).

## 4. Movement

Modelled on the GoldSrc/CS 1.6 player movement code (`movement.js`).

| Setting | Value | CS 1.6 equivalent |
| --- | --- | --- |
| Gravity | 800 u/s² (20 m/s²) | `sv_gravity 800` |
| Jump height | 45 u (1.125 m) | standard jump |
| Ground accelerate | 5 | `sv_accelerate 5` |
| Air accelerate | 10, wish speed capped at 30 u/s | `sv_airaccelerate 10` |
| Friction | 4 | `sv_friction 4` |
| Stop speed | 100 u/s | `sv_stopspeed` |
| Step height | 18 u | stairs and small ledges |
| Hull | 32 u wide, 72 u standing, 46 u crouched | same |
| Eye height | 1.6 m standing, 1.0 m crouched | |
| Crouch speed | ×0.333 | duck speed |
| Walk (Shift) speed | ×0.52, silent footsteps | walk |
| Landing slowdown | ×0.8, 0.5 s jump stamina | stops bunny hops outpacing running |
| Footsteps | one every 0.38 s above 150 u/s, silent below | CS plays one every 0.3–0.4 s; walk cycle and gun bob share the cadence |
| Tagging (being shot) | ×0.55, recovers over 0.6 s | flinch slowdown |

Max run speed depends on the gun you hold (table in 5.1): 250 u/s with a
pistol or most SMGs, down to 190 u/s with the Mini Gun.

## 5. Gunplay

### 5.1 Weapon table

All 13 starter guns, with CS 1.6 numbers. Prices are CS prices. RPM is
`60 / cycle`. "Hold" means holding the trigger keeps firing at the cycle rate
(shotguns pump, the AWP re-chambers). Reload for shotguns is a start time plus
time per shell.

| Gun | Slot | Price | Damage | Mag / reserve | RPM | Fire | Reload (s) | Draw (s) | Speed (u/s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| USP | Pistol | $500 | 34 | 12 / 100 | 400 | Semi | 2.7 | 0.6 | 250 |
| Desert Eagle | Pistol | $650 | 54 | 7 / 35 | 267 | Semi | 2.2 | 0.6 | 250 |
| UZI | SMG | $1,250 | 27 | 32 / 128 | 857 | Auto | 2.4 | 0.75 | 250 |
| MP5 | SMG | $1,500 | 26 | 30 / 120 | 800 | Auto | 2.63 | 0.75 | 250 |
| UMP45 | SMG | $1,700 | 30 | 25 / 100 | 600 | Auto | 3.5 | 0.75 | 250 |
| P90 | SMG | $2,350 | 21 | 50 / 100 | 909 | Auto | 3.4 | 0.75 | 245 |
| Shotgun | Shotgun | $1,700 | 9 × 20 | 8 / 32 | 69 | Hold | 0.45 + 0.45/shell | 0.75 | 230 |
| Auto Shotgun | Shotgun | $3,000 | 6 × 20 | 7 / 32 | 240 | Auto | 0.45 + 0.3/shell | 0.75 | 240 |
| FAMAS | Rifle | $2,250 | 30 | 25 / 90 | 727 | Auto | 3.3 | 0.75 | 240 |
| AK47 | Rifle | $2,500 | 36 | 30 / 90 | 628 | Auto | 2.45 | 0.75 | 221 |
| M4A1 | Rifle | $3,100 | 33 | 30 / 90 | 686 | Auto | 3.05 | 0.75 | 230 |
| AWP | Sniper | $4,750 | 115 | 10 / 30 | 41 | Hold | 2.5 | 1.1 | 210 (150 scoped) |
| Mini Gun | Heavy | $5,750 | 30 | 150 / 300 | 1,091 | Auto, 0.45 s spin-up | 5.0 | 1.2 | 190 (×0.85 while spinning) |

Notes on the non-CS guns:

- **UZI** uses TMP/MAC-10 style numbers (CS 1.6 has no UZI).
- **Mini Gun** is built from the M249: same 5.56 bullet, damage and
  penetration, but a faster cycle (0.055 s), a 0.45 s spin-up before the
  first shot, a 150-round belt, heavier movement penalty and recoil scaled to
  55%.
- **Shotgun** is the M3, **Auto Shotgun** is the XM1014.

Gear:

| Item | Price | Effect |
| --- | --- | --- |
| Kevlar Vest | $650 | 100 armor on chest, stomach and arms |
| Kevlar + Helmet | $1,000 ($350 if you already have full kevlar) | Also protects the head |

### 5.2 Hitboxes and hitgroup multipliers

Each player has five hit groups, as boxes (and a sphere for the head) in the
player's local frame. They're a little fatter than the thin stick limbs so
hits feel fair, like CS's boxes. Crouching swaps to a crouched set.

| Hit group | Shape (standing) | Multiplier |
| --- | --- | --- |
| Head | sphere, r = 0.175 m at 1.6 m | ×4 |
| Chest | 0.40 × 0.29 × 0.26 m box, 1.16 to 1.45 m | ×1 |
| Stomach | 0.36 × 0.28 × 0.24 m box, 0.88 to 1.16 m | ×1.25 |
| Arms | box out in front of the chest (gun arms) | ×1 |
| Legs | 0.40 × 0.88 × 0.28 m box, 0 to 0.88 m | ×0.75 |

A bullet first tests the player's bounding box (broad phase), then each
hitbox; the nearest hit wins.

### 5.3 Armor

Same as CS 1.6 `CBasePlayer::TakeDamage`:

```
covered    = group is chest, stomach or arm, or group is head and victim has a helmet
through    = 0.5 × weapon.armorRatio            (fraction of damage that reaches health)
health dmg = dmg × through
armor dmg  = (dmg − health dmg) × 0.5
if armor dmg > armor left: the armor breaks, and the part it couldn't absorb goes to health
```

Legs are never protected. Losing all armor also removes the helmet. Damage is
floored and is at least 1.

| Gun | Armor ratio | Damage through kevlar |
| --- | --- | --- |
| UZI | 0.95 | 47.5% |
| USP, MP5, UMP45, shotguns | 1.0 | 50% |
| FAMAS, M4A1 | 1.4 | 70% |
| Desert Eagle, P90, Mini Gun | 1.5 | 75% |
| AK47 | 1.55 | 77.5% |
| AWP | 1.95 | 97.5% |

### 5.4 Damage per hit and shots to kill (point blank)

Computed with the real `computeDamage` from `combat.js`, full 100 health,
100 armor where armored. "Armored" means kevlar + helmet. Shotgun numbers are
per pellet.

| Gun | Unarmored head / chest / stomach / arm / leg | Armored head / chest / stomach / arm / leg | Body shots to kill (unarmored / armored) | Headshots to kill (helmet) |
| --- | --- | --- | --- | --- |
| USP | 136 / 34 / 42 / 34 / 25 | 68 / 17 / 21 / 17 / 25 | 3 / 6 | 2 |
| Desert Eagle | 216 / 54 / 67 / 54 / 40 | 162 / 40 / 50 / 40 / 40 | 2 / 3 | 1 |
| UZI | 108 / 27 / 33 / 27 / 20 | 51 / 12 / 16 / 12 / 20 | 4 / 9 | 2 |
| MP5 | 104 / 26 / 32 / 26 / 19 | 52 / 13 / 16 / 13 / 19 | 4 / 8 | 2 |
| UMP45 | 120 / 30 / 37 / 30 / 22 | 60 / 15 / 18 / 15 / 22 | 4 / 7 | 2 |
| P90 | 84 / 21 / 26 / 21 / 15 | 63 / 15 / 19 / 15 / 15 | 5 / 7 | 2 |
| Shotgun (per pellet) | 80 / 20 / 25 / 20 / 15 | 40 / 10 / 12 / 10 / 15 | 5 / 10 pellets | 3 pellets |
| Auto Shotgun (per pellet) | 80 / 20 / 25 / 20 / 15 | 40 / 10 / 12 / 10 / 15 | 5 / 10 pellets | 3 pellets |
| FAMAS | 120 / 30 / 37 / 30 / 22 | 84 / 21 / 26 / 21 / 22 | 4 / 5 | 2 |
| AK47 | 144 / 36 / 45 / 36 / 27 | 111 / 27 / 34 / 27 / 27 | 3 / 4 | 1 |
| M4A1 | 132 / 33 / 41 / 33 / 24 | 92 / 23 / 28 / 23 / 24 | 4 / 5 | 2 |
| AWP | 460 / 115 / 143 / 115 / 86 | 448 / 112 / 140 / 112 / 86 | 1 / 1 | 1 |
| Mini Gun | 120 / 30 / 37 / 30 / 22 | 90 / 22 / 28 / 22 / 22 | 4 / 5 | 2 |

The CS landmarks hold: the AK and Deagle one-tap a helmeted head, the M4A1
doesn't, and the AWP kills with any chest or stomach shot even through
kevlar (a leg shot does 86).

### 5.5 Range falloff

Bullets: `damage × rangeMod ^ (distance / 500 units)`, the CS 1.6 formula.
Shotgun pellets lose damage linearly to zero at their max range (3000 u for
the Shotgun, 3048 u for the Auto Shotgun). Every gun also has a hard max
range (4096 u for the USP, Deagle, UZI and UMP45, 8192 u for the rest).

Raw damage (before hitgroup and armor) by distance:

| Gun | Range mod | 0 | 500 u (12.5 m) | 1000 u (25 m) | 2000 u (50 m) | 4000 u (100 m) |
| --- | --- | --- | --- | --- | --- | --- |
| USP | 0.79 | 34 | 26.9 | 21.2 | 13.2 | 5.2 |
| Desert Eagle | 0.81 | 54 | 43.7 | 35.4 | 23.2 | 10.0 |
| UZI | 0.84 | 27 | 22.7 | 19.1 | 13.4 | 6.7 |
| MP5 | 0.84 | 26 | 21.8 | 18.3 | 12.9 | 6.4 |
| UMP45 | 0.82 | 30 | 24.6 | 20.2 | 13.6 | 6.1 |
| P90 | 0.885 | 21 | 18.6 | 16.4 | 12.9 | 7.9 |
| Shotgun (pellet) | linear | 20 | 16.7 | 13.3 | 6.7 | 0 |
| Auto Shotgun (pellet) | linear | 20 | 16.7 | 13.4 | 6.9 | 0 |
| FAMAS | 0.96 | 30 | 28.8 | 27.6 | 25.5 | 21.6 |
| AK47 | 0.98 | 36 | 35.3 | 34.6 | 33.2 | 30.6 |
| M4A1 | 0.97 | 33 | 32.0 | 31.0 | 29.2 | 25.9 |
| AWP | 0.99 | 115 | 113.8 | 112.7 | 110.5 | 106.1 |
| Mini Gun | 0.97 | 30 | 29.1 | 28.2 | 26.6 | 23.5 |

Yard is about 60 m across, so most fights happen in the 0 to 25 m columns.

### 5.6 Wall penetration (wallbangs)

Follows CS 1.6 `FireBullets3`. Each gun has a **penetration count** (how
many surfaces or bodies a bullet may pass through) and a **bullet type**
with a penetration power and a max penetration distance.

| Bullet | Guns | Power | Max pen. distance |
| --- | --- | --- | --- |
| .45 ACP | USP, UMP45 | 15 | 500 u (12.5 m) |
| 9 mm | UZI, MP5 | 21 | 800 u (20 m) |
| .50 AE | Desert Eagle | 30 | 1000 u (25 m) |
| 5.7 mm | P90 | 30 | 2000 u (50 m) |
| 5.56 mm | FAMAS, M4A1, Mini Gun | 35 | 4000 u (100 m) |
| 7.62 mm | AK47 | 39 | 5000 u (125 m) |
| .338 | AWP | 45 | 8000 u (200 m) |
| Buckshot | Shotguns | 0 | never penetrates |

Each surface has a material. The thickest wall a bullet can pass through is
`power × material.powerMul` units, and passing through multiplies the
remaining damage by `material.damageMul`.

| Material | powerMul | Damage kept | Used on Yard for |
| --- | --- | --- | --- |
| Wood | 1.0 | 60% | warehouse walls, crates |
| Grate | 0.5 | 40% | platform railing |
| Tile | 0.65 | 20% | (not used yet) |
| Concrete | 0.25 | 50% | 20 cm lane walls, thick cover walls |
| Metal | 0.15 | 20% | containers (thick), fence sheets (thin) |

Thickest wall each gun can shoot through (cm), from the code:

| Gun | Pen. count | Concrete | Wood | Metal | Grate | Tile |
| --- | --- | --- | --- | --- | --- | --- |
| USP, UMP45 | 1 | 9.4 | 37.5 | 5.6 | 18.8 | 24.4 |
| UZI, MP5 | 1 | 13.1 | 52.5 | 7.9 | 26.3 | 34.1 |
| Desert Eagle | 2 | 18.8 | 75.0 | 11.3 | 37.5 | 48.8 |
| P90 | 1 | 18.8 | 75.0 | 11.3 | 37.5 | 48.8 |
| FAMAS, M4A1, Mini Gun | 2 | 21.9 | 87.5 | 13.1 | 43.8 | 56.9 |
| AK47 | 2 | 24.4 | 97.5 | 14.6 | 48.8 | 63.4 |
| AWP | 3 | 28.1 | 112.5 | 16.9 | 56.3 | 73.1 |
| Shotguns | 0 | — | — | — | — | — |

Rules that go with it:

- A bullet stops at a wall if it has no penetration count left, the wall is
  thicker than the limit, or it has already travelled past the bullet's max
  penetration distance.
- Passing through a **player** also uses one penetration count and keeps 75%
  of the damage, so a rifle can hit two enemies lined up.
- Each player is hit at most once per bullet. Teammates are skipped (except
  in free-for-all).
- A hit after a wall is flagged as a wallbang for the kill feed.
- On Yard, the 20 cm lane walls let only the FAMAS, M4A1, AK47, Mini Gun and
  AWP through, which is the intent: pistols and SMGs need an open angle.

### 5.7 Accuracy and spread

Spread is the CS formula `spread = a + b × acc`, with `(a, b)` picked by
movement state: **air**, **run** (horizontal speed above 140 u/s, 170 for
the P90), **duck**, **stand**.

- **Rifles and SMGs** (`type: rifle`): `acc` grows with consecutive shots,
  `acc = shots^pow / div + offset`, capped at `max`. Shots fired decays
  when you stop firing, so tapping and bursting stay accurate.
- **Pistols** (`type: pistol`): `acc = 1 − pistolAccuracy`. Accuracy starts
  at `start`, drops by `loss` when you fire faster than `window`, and
  recovers with time between shots, down to a floor of `min`.
- **AWP** (`type: sniper`): fixed spread by state: air 0.85, run 0.25,
  walk (above 10 u/s) 0.1, duck 0, stand 0.001, plus 0.08 when not scoped. Two
  zoom levels (40° and 10° FOV). Scope comes off after a shot and returns
  after the bolt cycles.
- **Shotguns**: no accuracy state, fixed pellet cone (0.0675 Shotgun, 0.0725
  Auto Shotgun).

| Gun | Accuracy curve (pow, div, offset, max) | Stand | Duck | Run | Air |
| --- | --- | --- | --- | --- | --- |
| USP | pistol (0.92 start, 0.6 min) | 0.1 | 0.08 | 0.225 | 1.2 |
| Desert Eagle | pistol (0.9 start, 0.55 min) | 0.13 | 0.115 | 0.25 | 1.5 |
| UZI | 3, 200, 0.55, 1.4 | 0.03 | 0.03 | 0.03 | 0.25 |
| MP5 | 2, 220.1, 0.45, 0.75 | 0.04 | 0.04 | 0.04 | 0.2 |
| UMP45 | 2, 210, 0.5, 1 | 0.04 | 0.04 | 0.04 | 0.24 |
| P90 | 2, 175, 0.45, 1 | 0.045 | 0.045 | 0.115 | 0.3 |
| FAMAS | 3, 215, 0.3, 1 | 0.02 | 0.02 | 0.03 + 0.07 | 0.03 + 0.3 |
| AK47 | 3, 200, 0.35, 1.25 | 0.0275 | 0.0275 | 0.04 + 0.07 | 0.04 + 0.4 |
| M4A1 | 3, 220, 0.3, 1 | 0.025 | 0.025 | 0.035 + 0.07 | 0.035 + 0.4 |
| Mini Gun | 3, 175, 0.4, 0.9 | 0.035 | 0.03 | 0.045 + 0.1 | 0.05 + 0.5 |

(Stand/duck/run/air columns show `b`, or `a + b` where `a` isn't zero.)

### 5.8 Recoil

Recoil is a view punch, as in GoldSrc: the bullet direction is the view
angle plus the current punch, so recoil moves both the crosshair and where
bullets land. The punch decays back to zero over time (`DropPunchAngle`).

- **Automatic guns** use CS `KickBack(upBase, latBase, upMod, latMod,
  upMax, latMax, dirChange)` per movement state. The first shot kicks
  `upBase`, later shots kick `shots × upMod + upBase`, up to `upMax`, while
  sideways kick drifts in one direction and flips with a 1 in `dirChange`
  chance per shot. That gives the familiar "up, then wander left and right"
  spray.
- **Pistols and the AWP** use a single vertical punch (2°).
- **Shotguns** punch 4 to 6° (Shotgun) or 3 to 5° (Auto Shotgun), and
  roughly double that in the air.

Standing kick values (`upBase, latBase, upMod, latMod, upMax, latMax,
dirChange`):

| Gun | Stand KickBack |
| --- | --- |
| UZI | 0.775, 0.425, 0.2, 0.03, 3, 2.75, 9 |
| MP5 | 0.25, 0.175, 0.125, 0.02, 2.25, 1.25, 10 |
| UMP45 | 0.275, 0.2, 0.15, 0.0225, 2.5, 1.5, 10 |
| P90 | 0.3, 0.225, 0.125, 0.02, 3.25, 1.25, 8 |
| FAMAS | 0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8 |
| AK47 | 1, 0.375, 0.175, 0.0375, 5.75, 1.75, 8 |
| M4A1 | 0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7 |
| Mini Gun (×0.55) | 0.8, 0.35, 0.3, 0.03, 3.75, 3, 9 |

Air, run and duck values are in `weapons.js`.

### 5.9 Feel and feedback

Not CS numbers, but part of why shots feel good: muzzle flash and a short
viewmodel kick on every shot, tracers, material-specific impact puffs and
decals, ejected shells, synthesized per-gun sounds, a hit marker and a
distinct headshot sound, a dynamic crosshair that opens with spread and
recoil, and a damage-direction indicator. Online play must keep all of these
instant on the shooter's screen (see 6.3).

**Recoil and screen shake** (Settings > General, `viewKick` "Screen shake %",
default 100%). Recoil is CS 1.6's KickBack pattern scaled by `RECOIL_SCALE`
(0.75, constants.js), so sprays climb and wander like CS but less. The camera
eases toward the view punch over ~35 ms (`SHAKE_EASE` in main.js) instead of
snapping, so each shot rolls the view rather than jolting it. Below 100% the
camera shows that share of the punch and the crosshair moves by the rest, so
it always marks where the next bullet lands. The viewmodel's kick, bob and
landing dip scale with it (35% to 100%).

**Bunny hopping.** Holding jump jumps again on the landing tick, which skips
friction and the landing slowdown, so air strafing builds speed. Takeoff speed
is capped at 1.7x the weapon's run speed (`BHOP_MAX_SPEED_MUL`, CS's
`BUNNYJUMP_MAX_SPEED_FACTOR`), held at the cap rather than CS's hard knockdown.

**Pause and browser shortcuts.** Esc pauses and Esc resumes. In a match the
game takes Ctrl/Alt combos, F1-F10, Backspace and friends away from the
browser. Ctrl+W/T/N can only be captured in fullscreen through the Keyboard
Lock API (Chrome/Edge), so matches go fullscreen by default (setting
`fullscreen`); elsewhere closing the tab mid-match asks first (beforeunload).

**Touch controls** (src/client/touch.js, phones/tablets): floating move stick
on the left (short push walks), drag on the right to look (`touchSens`),
FIRE doubles as a look pad, plus jump, crouch toggle, reload, scope, weapon
cycle, knife, drop, buy, scores and pause.

**Sounds** are all synthesized at startup in audio.js (no files, no Valve
audio): layered shots (transient, crack, resonant body, boom, action clack,
saturation, slap-back room, 22 kHz-style grit), metal-modal reload parts,
brass, impacts and ricochets, concrete footsteps, knife. The menu song is the
only audio file.

### 5.10 Knife

Slot 3, always carried, never dropped or bought. CS 1.6 `wpn_knife` numbers:

| | Damage | Reach | Next attack (hit / miss) |
|---|---|---|---|
| Slash (Mouse 1) | 20 first swing, 15 in a quick combo | 48 u | 0.4 / 0.35 s (stab 0.5 s) |
| Stab (Mouse 2) | 65, x3 from behind (195) | 32 u | 1.1 / 1.0 s |

Hitgroup multipliers and armor (armorRatio 1.0) apply as for bullets. The
trace is a center ray plus a small fan standing in for CS's hull trace. A
backstab is when the attacker is within ~37 degrees of directly behind the
victim (CS: dot of line of sight and victim forward > 0.8).

### 5.11 Dropped guns

When you die your stickman vanishes in a puff and your primary (or pistol, if
no primary) is left on the ground for 10 s (`DROP_LIFETIME`); it blinks for
the last 2 s. `G` picks up the gun in reach (1.6 m), swapping it for what you
carry in that slot, or throws your current gun if there's nothing to pick up.
Walking over a gun picks it up when that slot is empty, like CS. Bots walk to
a gun within 20 m when it's worth more (price, 0 if out of ammo) than the one
in that slot, and switch to another gun or the knife when they run dry.

## 6. Multiplayer plan (Cloudflare Workers + Durable Objects)

> Status: v1 is being built now in a separate branch. Sections 6.2 to 6.5
> and 6.7 describe what v1 does. Anything marked **later** is planned but not
> in v1.

### 6.1 Goals

- Server-authoritative: the server decides every hit, kill and purchase.
- Playable at up to ~150 ms ping, comfortable under 80 ms.
- Same rules online and offline: the server runs the unchanged `src/sim`.
- Cheap to run: idle rooms cost nothing.
- Practice vs bots stays fully offline and local.

### 6.2 Topology

```
Browser ──HTTPS──▶ Worker "stickshooter"   static assets (the game)
   │                    │                   Worker code runs first only for /api/* and /ws/*
   │                    ├─ GET  /api/health
   │                    ├─ GET  /api/rooms        humans in each quick play room
   │                    ├─ POST /api/rooms        returns a new random room id
   └──WebSocket──▶      └─ GET  /ws/:roomId  ──▶  Durable Object GameRoom (one per room)
                                                    runs Game.tick() + server bots
```

- The `stickshooter` Worker keeps serving `dist/` as static assets and gains
  a `main` script for `/api/*` and `/ws/*`.
- **One Durable Object per room**: class `GameRoom`, binding `ROOMS`,
  SQLite-backed (works on the Workers free plan). A room is addressed by
  `idFromName(roomId)`, so everyone who joins the same room id lands on the
  same object. Cloudflare places the object near the first player to join.
- **Quick play** joins `public` (FFA) or `public-teams` (Teams), following the
  menu's mode switch. The menu shows each room's live head count
  (`GET /api/rooms`, which asks each room's DO over RPC), and if your mode's
  room is empty while the other has people, PLAY ONLINE joins them instead
  (`pickRoom`), so two people clicking PLAY ONLINE always meet. A private room
  is a `POST /api/rooms` id shared as a link.
- **Versioning:** `hello` carries `PROTOCOL_VERSION`; a tab running an older
  build is closed with code 4002 and told to refresh.
- WebSockets use the Hibernation API (`ctx.acceptWebSocket`). The tick loop
  keeps the object awake while anyone is connected and stops when the room
  empties, so empty rooms cost nothing.
- **Room size:** up to 10 humans. Server-side bots (`BotBrain`, the same
  `bot.js`) fill the room up to 6 players total and leave as humans join.
- **Mode:** from the room name (`roomMode` in protocol.js): `public` is
  free-for-all (team `ffa`), `public-teams` is Red vs Blue. New players and
  bots join the smaller team; a `team` cmd action switches sides.
- **Later:** a room list / matchmaking registry (a small DO or KV that rooms
  report their player count to), so quick play can spread players over
  several rooms instead of one `public` room.

### 6.3 Netcode model

The classic Quake/Source model, which is what CS players are used to.

**Client to server (input).** The client builds one `cmd` per 128 Hz tick and
sends them every 2 ticks (64 messages per second). Each message is a batch of
per-tick cmds with sequence numbers. Mouse angles are absolute yaw/pitch, so
a lost cmd never accumulates aim error.

**Server tick.** The server runs `Game.tick()` at 128 Hz and consumes one cmd
per player per tick. If a player's queue runs dry, it repeats their last held
inputs.

**Server to client (state).** A snapshot every 4 ticks (32 Hz) carries every
player's state (position, velocity, view angles, duck, alive, health, armor,
active weapon, and ammo/money for your own player), the events since the
last snapshot (`shot`, `hit`, `kill`, `spawn`, `reload`, ...), and the last
cmd sequence number the server consumed for that client (the ack).

**Prediction and reconciliation (your own player).** The client predicts its
own movement with the same `movePlayer` the server uses, so movement responds
instantly. When a snapshot arrives, the client resets its player to the
server state for the acked sequence and replays every unacked cmd. Because
both sides run the same movement code at the same 128 Hz, corrections are
normally zero. Small errors should be smoothed over ~100 ms rather than
snapped.

**Interpolation (everyone else).** Remote players are drawn about 100 ms
behind (roughly three snapshot intervals), interpolating between the two
snapshots around that time, which keeps them smooth through jitter and the
odd lost packet.

**Shooting.** In v1, shots, hits and kills come from the server's events, so
there's one round trip between clicking and seeing your tracer. **Later:**
predict your own shots locally (muzzle flash, sound, recoil, tracer and
impacts at once, as offline), while damage, hit markers and kills still wait
for the server. This matters for gun feel and should come soon after v1
(see 6.6 for making predicted tracers match).

### 6.4 Tick and snapshot rates

| | v1 | Why |
| --- | --- | --- |
| Client sim | 128 Hz | unchanged from offline |
| Server sim | 128 Hz | same as the client, so CS timing (fire cycles, recoil decay, movement) is exact and prediction matches |
| Cmd messages | 64 per second, 2 cmds each | halves message count without losing input resolution |
| Snapshots | 32 Hz (every 4 ticks) | ~31 ms between updates is plenty with 100 ms interpolation |

Rendering still runs at the display rate (120/144 FPS) with interpolation.
A 10-player `Game.tick()` costs well under 1 ms in Node today, so 128 Hz fits
a Durable Object. Bullet tracing is the expensive part and scales with shots
fired, not players. If CPU becomes a problem, dropping the server to 64 Hz is
a constant change, but the client would have to match.

### 6.5 Lag compensation (in v1)

Hit registration is judged on the server **as the shooter saw it**:

1. The server keeps a short history of every player's position and duck
   state per tick.
2. When it processes a player's shot, it works out the shooter's view time:
   their latency plus the client's interpolation delay, capped at 200 ms.
3. It rewinds every other player's position and duck state to that time,
   runs the normal `traceBullet` for that shooter, then restores them. The
   world itself is static, so only players move.
4. Because of the 200 ms cap, players with very high ping have to lead their
   shots, which stops them hitting people far around corners.

The known trade-off (the same as CS): a defender can occasionally be hit
just after reaching cover, because on the shooter's screen they were still
in the open.

### 6.6 Spread and recoil online (later)

The server rolls spread with its own seeded RNG, so the client's predicted
tracers can differ slightly from where the server's bullet went. Two
options:

- **Shared seed (preferred).** Send a per-player seed when the player joins
  and derive each shot's spread from `(seed, cmd sequence)`. Client and server
  then pick the same spread, and predicted tracers match the real ones.
  Needs a small change: per-player RNG instead of one `Game.rand`.
- **Server only.** Simpler, but tracers can disagree with hits.

Recoil (view punch) is deterministic given shots fired and movement state,
except the KickBack direction flip, which uses the same RNG and is covered
by the shared seed.

### 6.7 Protocol and bandwidth

- v1 uses **JSON** messages.
- **Later:** move snapshots to a **binary** format (`ArrayBuffer` with quantized
  positions: 16-bit per axis at 1 cm, angles in 16 bits) once the protocol
  settles. That makes a 10-player snapshot about 200 bytes, around 6 KB/s
  per client at 32 Hz.
- The exact message names and fields are defined by the backend code; the
  shape is: join (name) → welcome (your player id, room state, tick rate);
  batched cmds up; snapshots (state + events + ack) down; a ping for RTT.
- **Later:** a version check on join, so a client with an old build reloads
  instead of desyncing against a newer server sim.

### 6.8 Anti-cheat basics

The server owns health, money, ammo, fire rate and hit detection, so most
classic cheats (infinite ammo, speed, damage) can't work. On top of that:
clamp cmd values, reject more cmds than ticks, rate-limit buys and chat, cap
lag compensation at 200 ms, and only send other players' ammo and money to
spectators. Aimbots and wallhacks can't be fully stopped in a browser game;
later options are server-side visibility culling (don't send players you
can't see) and stat-based flagging.

### 6.9 Modes

1. **Practice** (today): offline vs bots, $16,000.
2. **Free-for-all deathmatch** (done): respawns, first to 25 kills wins
   (`FFA_KILL_LIMIT`).
3. **Team deathmatch** (done, practice and online): Red vs Blue, own-side
   spawns, `M` to switch team, first team to 50 kills wins (`TEAM_KILL_LIMIT`).

Both modes: the winner and final scoreboard show for 8 s
(`MATCH_OVER_TIME`) with everyone frozen, then a new match starts. Every
match start, and every join (PRACTICE, PLAY ONLINE, or joining a room in
progress), freezes you for 3 s (`START_DELAY`) with a 3-2-1 countdown: you
can look around and buy but not move, shoot or be hurt. The first person
into an empty online room starts a fresh match. Snapshots carry the match
state and the guns on the ground (protocol v3).
4. **Round-based (CS style)**: buy time, round money, bomb or elimination
   rounds. Needs a round-state machine in `game.js` and a CS-style economy
   (round win/loss money, kill rewards per weapon class).

### 6.10 Milestones

1. **v1 (in progress):** `GameRoom` DO runs `Game.tick()` at 128 Hz with
   server bots; clients join `public` or a private room, predict their own
   movement, interpolate others, and hits use lag compensation.
2. Local shot prediction (instant tracers and effects) and a shared spread
   seed.
3. Names, scoreboard and chat polish; reconnect handling; version check.
4. Room list and quick-join across several rooms.
5. Binary snapshots and bandwidth tuning.
6. Team deathmatch, then round-based mode.

## 7. Roadmap beyond multiplayer

### 7.1 Skins and customization

The stickman stays white by default. Customization is cosmetic only and
never changes hitboxes or gameplay.

- **Stickman:** body color, head accessories (hats, masks, headbands as
  optional items), outfits as simple overlays on the limbs, kill-effect
  trails.
- **Guns:** color/finish skins per gun (the low-poly models are vertex
  colored, so a skin can be a palette swap with no textures to download),
  stickers later.
- **Data model:** a `cosmetics` object per player (`{ body, head, outfit,
  skins: { ak47: 'id', ... } }`), sent once on join, never per snapshot.
- **Storage:** start with `localStorage`. With accounts, move to D1 (player
  profile, owned items) behind the Worker.
- **Unlocks:** earned by play (kills, wins, levels) first. Any shop would come
  much later and must stay cosmetic.

### 7.2 iOS and mobile

Phase 1, mobile web (Safari on iPhone and iPad):

- A touch input class that produces the same `cmd` object as the
  keyboard/mouse one: left virtual stick for movement, drag anywhere on the
  right half to aim, buttons for fire, scope, jump, crouch, reload and weapon
  switch. Optional auto-fire when the crosshair is on an enemy, a common
  mobile shooter assist (offline only, or as a server-validated setting).
- Pointer Lock isn't available on iOS, so touch aim uses touch deltas with
  its own sensitivity setting.
- Audio is unlocked on the first tap, as iOS requires.
- Performance: cap pixel ratio at 2, a "low" quality preset (no shadows,
  fewer effects), and 60 FPS on devices without ProMotion (120 Hz on
  ProMotion iPhones and iPads).
- Respect safe areas (notch, home bar) in the HUD.

Phase 2, an App Store app: wrap the web build with Capacitor (or a
`WKWebView` shell) so the same code ships as a native app with haptics and
a home-screen icon. A PWA manifest can come first so players can "Add to Home
Screen" right away.

### 7.3 More content

- **Maps:** more box-built maps in `src/maps/`, each with its own palette and
  a mix of wallbang materials. Ideas: a rooftop map with long AWP sightlines,
  a small indoor map for SMGs and shotguns, a dust-style three-lane map for
  round mode.
- **Weapons:** knife (melee, fastest run speed), grenades (HE, flash,
  smoke), more pistols (Glock with burst, P228, Five-SeveN), Scout, M249.
- **Settings:** quality presets. (Key rebinding, crosshair editor,
  sensitivity, FOV and volume shipped in PRs #5 and #6.)

## 8. Performance budget

| Target | Budget |
| --- | --- |
| Download (gzipped) | under 300 KB for game code; maps and cosmetics as small data, no large textures |
| Desktop frame time | under 4 ms CPU so 144 Hz holds on mid-range laptops |
| Mobile | 60 FPS on a 3-year-old iPhone at the low preset |
| Draw calls | map in 1 call; players and guns merged per player |
| Server | under 1 ms CPU per tick for a 10-player room |
| Bandwidth | under 10 KB/s down, under 3 KB/s up per player |

Rules that keep it that way: no per-frame allocations in the hot loop, pool
every effect, generate sounds at startup, keep all game rules in `src/sim`
so they can be tested in Node.

## 9. Testing

`npm test` runs the sim tests in Node (`test/sim.test.js`): armor math (AK
headshot vs helmet, no-helmet headshots, legs never protected, AWP through
kevlar), wall penetration (AK through thin wood, not thick concrete), range
falloff (pistols lose more than rifles), hitgroup detection, max run speed,
and a full bot match. New gameplay rules should come with a sim test, and
the tables in this doc can be regenerated from the code.

For multiplayer, add: a headless two-client test against the DO in
`wrangler dev` (or Miniflare), a prediction test (client and server end in
the same state after the same cmds), and a lag compensation test (a shot at
a rewound target hits, the same shot without rewind misses).

## 10. Open questions

1. After free-for-all, which comes first: team deathmatch or round-based?
2. Accounts: anonymous names only at first, or sign-in for saving cosmetics?
3. Mobile aim assist: allowed online, or only vs bots?
4. Room size: keep 10 humans, or allow larger FFA rooms?
