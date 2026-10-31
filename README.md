# Stick Shooter

A lightweight 3D stickman shooter for the browser. Counter-Strike 1.6 style
gunplay (damage, armor, hitboxes, range falloff, wall penetration, spray
patterns) with an original look: a white stickman, low-poly guns and a
bright toy-like arena.

This first build is **practice vs bots** on one test map, "Yard". The code is
split so online multiplayer can be added without rewriting the game rules.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sim tests (damage, armor, wallbangs, movement, bots)
npm run build      # production build in dist/
```

## Deploy to Cloudflare

`wrangler.jsonc` serves `dist/` as static assets on the `stickshooter`
Worker (stickshooter.kennk.workers.dev).

```bash
npx wrangler login   # once
npm run deploy       # wrangler builds (npm run build) then deploys
```

`wrangler.jsonc` runs `npm run build` itself before each deploy, so Workers
Builds connected to this repo works with the default `npx wrangler deploy`
deploy command and no build command.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (raw input, CS-style sensitivity) |
| Mouse 1 / Mouse 2 | Fire / scope (AWP) |
| Space | Jump |
| Ctrl or C | Crouch |
| Shift | Walk (silent footsteps, more accurate) |
| R | Reload |
| 1 / 2 / Q / wheel | Primary / pistol / last weapon |
| B | Shop |
| Tab | Scoreboard |
| V | Third-person view |
| Esc | Pause |

## Weapons

All numbers come from CS 1.6 (prices too). The Mini Gun isn't in CS, so it
uses the M249's numbers with a faster fire rate, a spin-up and a heavier
movement penalty. The UZI uses TMP/MAC-10 style numbers.

| Gun | Dmg | Armor pen. | Range mod | Mag | RPM | Wall pen. | Price |
| --- | --- | --- | --- | --- | --- | --- | --- |
| USP | 34 | 1.0 | 0.79 | 12/100 | 400 | 1 | $500 |
| Desert Eagle | 54 | 1.5 | 0.81 | 7/35 | 267 | 2 | $650 |
| UZI | 27 | 0.95 | 0.84 | 32/128 | 857 | 1 | $1250 |
| MP5 | 26 | 1.0 | 0.84 | 30/120 | 800 | 1 | $1500 |
| UMP45 | 30 | 1.0 | 0.82 | 25/100 | 600 | 1 | $1700 |
| P90 | 21 | 1.5 | 0.885 | 50/100 | 909 | 1 | $2350 |
| Shotgun | 9×20 | 1.0 | linear | 8/32 | 69 | 0 | $1700 |
| Auto Shotgun | 6×20 | 1.0 | linear | 7/32 | 240 | 0 | $3000 |
| FAMAS | 30 | 1.4 | 0.96 | 25/90 | 727 | 2 | $2250 |
| AK47 | 36 | 1.55 | 0.98 | 30/90 | 628 | 2 | $2500 |
| M4A1 | 33 | 1.4 | 0.97 | 30/90 | 686 | 2 | $3100 |
| AWP | 115 | 1.95 | 0.99 | 10/30 | 41 | 3 | $4750 |
| Mini Gun | 30 | 1.5 | 0.97 | 150/300 | 1091 | 2 | $5750 |

How damage works (same as CS 1.6):

- **Hitgroups:** head ×4, chest ×1, stomach ×1.25, arms ×1, legs ×0.75.
- **Armor:** kevlar absorbs part of the hit on body and arms; the gun's armor
  penetration decides how much gets through (AK 77.5%, AWP 97.5%). Head is
  only protected with a helmet. Legs are never protected.
- **Range:** damage × rangeMod^(distance / 500 units). Shotgun pellets lose
  damage linearly up to their max range.
- **Wall penetration:** each surface has a material. Wood is easy to shoot
  through, thin metal sheets take a rifle, the 20 cm lane walls only let
  rifles and the AWP through, and thick concrete and containers stop
  everything. Each wall cuts the damage (wood 60%, concrete 50%, metal 20%).
- **Accuracy:** first shot is accurate; spread grows with spray, moving,
  jumping. Crouching and walking help. Recoil kicks the view (and the
  bullets) up and sideways like CS's KickBack.
- **Movement:** CS pmove: 250 u/s with a knife-speed pistol, slower with
  rifles, ground friction, air strafing, landing slowdown, and slowdown when
  you get shot.

## Code layout

```
src/sim/      Game rules. No DOM or Three.js. Runs in Node (tests) and could
              run on a server unchanged.
  game.js       Game state, fixed 128 Hz tick, weapons, damage, buying, events
  movement.js   CS-style player movement and collision
  combat.js     Hitboxes, bullet tracing, wall penetration, armor
  weapons.js    Weapon table (CS 1.6 numbers)
  world.js      Box collision world and materials
  bot.js/nav.js Bot AI and A* navigation
src/maps/     Map definitions (boxes + spawns)
src/client/   Rendering (Three.js), audio (synthesized), input, HUD
src/main.js   Glue + main loop
```

**Performance:** the sim ticks at a fixed 128 Hz; rendering runs at the
display's refresh rate (120/144 Hz monitors get 120/144 FPS) and interpolates
between ticks. Mouse look is applied every frame. The map is one draw call,
effects are pooled, sounds are generated at startup (no audio downloads), and
the whole game is about 155 KB gzipped.

**Multiplayer plan:** clients send the same `cmd` objects the bots produce;
a Cloudflare Durable Object runs `Game.tick()` for each room and streams
player state + events back. The client already predicts by running the same
sim locally, so the next step is a server, reconciliation and lag
compensation for hit registration.

**iOS plan:** the input layer produces plain `cmd` objects, so a touch
controller (virtual stick + fire/aim buttons) can plug in next to the
keyboard/mouse one. Audio is unlocked on the first tap as iOS requires.
