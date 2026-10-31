# Stick Shooter

A lightweight 3D stickman shooter for the browser. Counter-Strike 1.6 style
gunplay (damage, armor, hitboxes, range falloff, wall penetration, spray
patterns) with an original look: a white stickman, low-poly guns and a
bright toy-like arena.

Two ways to play on one test map, "Yard": **practice** (runs entirely in the
browser, with 0 to 10 bots; 0 by default) and **online** (an early test:
`BOT_FILL` in `src/net/protocol.js` can fill rooms with server bots, and is 0
for now). Both play either **Free for all** (everyone, bots included, fights
everyone; white stickmen) or **Teams** (Red vs Blue, tinted stickmen, each team
spawns on its own side; `M` switches team). Online, FFA is the `public` room and
Teams is `public-teams`.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # sim + netcode tests
npm run dev:server # wrangler dev on :8787: the Worker, rooms and the built game
                   # (npm run dev proxies /api and /ws to it for online play)
npm run build      # production build in dist/
```

## Deploy to Cloudflare

`wrangler.jsonc` deploys the `stickshooter` Worker
(stickshooter.kennk.workers.dev): `dist/` as static assets plus the
multiplayer Worker and its `GameRoom` Durable Object.

```bash
npx wrangler login   # once
npm run deploy       # wrangler builds (npm run build) then deploys
```

`wrangler.jsonc` runs `npm run build` itself before each deploy, so Workers
Builds connected to this repo works with the default `npx wrangler deploy`
deploy command and no build command.

## Online multiplayer

Same Worker, same deploy. `worker/index.js` handles `/api/*` and `/ws/*`;
everything else is the static game.

- **Rooms:** one `GameRoom` Durable Object per room (`worker/room.js`, binding
  `ROOMS`). It runs the same `src/sim` Game as practice mode at 128 Hz, so the
  server decides every hit with the CS 1.6 rules. Bots (the same `BotBrain`)
  keep a room at 6 players until humans fill it; max 10 humans.
- **Routes:** `GET /ws/:room` (WebSocket; the menu's PLAY ONLINE uses `public`),
  `POST /api/rooms` (new random room id), `GET /api/health`.
- **Netcode** (`src/net/`): clients send their inputs every 2 ticks with a
  sequence number; the room sends 32 Hz snapshots + events with the last input
  it used. The client predicts its own movement and replays unacknowledged
  inputs on each snapshot, draws other players 100 ms in the past, and the
  server rewinds other players to what the shooter saw (up to 200 ms) when
  tracing bullets. Messages are JSON for now.
- **Not yet:** local prediction of your own shots (muzzle flash/recoil wait for
  the server), room browser, rounds, binary snapshots.

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
| B | Buy menu (number keys pick a category, then a gun: B 4 3 = M4A1) |
| Tab | Scoreboard |
| M | Switch team (Teams mode) |
| Esc | Pause |

Every key above except Esc can be rebound in Settings → Controls. Settings
also has a crosshair editor (length, gap, thickness, dot, outline, dynamic).

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

**Multiplayer plan** (details in [docs/DESIGN.md](docs/DESIGN.md)): clients send the same `cmd` objects the bots produce;
a Cloudflare Durable Object runs `Game.tick()` for each room and streams
player state + events back. The client already predicts by running the same
sim locally, so the next step is a server, reconciliation and lag
compensation for hit registration.

**iOS plan:** the input layer produces plain `cmd` objects, so a touch
controller (virtual stick + fire/aim buttons) can plug in next to the
keyboard/mouse one. Audio is unlocked on the first tap as iOS requires.
