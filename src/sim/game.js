// Authoritative game state. Everything that decides the outcome of a fight
// lives here and in the other sim/ modules; the client only draws it.
// Online, the same Game runs inside a Cloudflare Durable Object (worker/room.js)
// and clients mirror it from snapshots (src/net/online.js).
import {
  U, TICK_DT, MAX_HEALTH, RESPAWN_TIME, START_MONEY, MAX_MONEY, KILL_REWARD, KILL_STREAK_STEP, KILL_REWARD_MAX,
  FFA_KILL_REWARD, MULTI_KILL_WINDOW,
  TAG_SPEED_MUL, TAG_RECOVER_TIME, STAND_EYE, DUCK_EYE, GRAVITY,
  FFA_KILL_LIMIT, TEAM_KILL_LIMIT, MATCH_OVER_TIME, START_DELAY,
  DROP_LIFETIME, PICKUP_RANGE, TOUCH_RANGE, RECOIL_SCALE, NEVER, WATER_SPEED_MUL,
  NADE_FUSE, NADE_GRAVITY, NADE_PIN_TIME, NADE_SWITCH_TIME, NADE_BOUNCE, NADE_RADIUS,
  PLAYER_RADIUS, STAND_HEIGHT, HITGROUP_MUL, BUY_TIME, SMOKE_GROW, SMOKE_FADE, SMOKE_HEIGHT, SMOKE_MAX_WAIT,
} from './constants.js';
import { WEAPONS, GEAR, AMMO, NADE_SLOTS, teamCanBuy } from './weapons.js';
import { World } from './world.js';
import { movePlayer, aimDir, forwardVec, rightVec, playerBox, hullTouches } from './movement.js';
import { traceBullet, traceMelee, computeDamage, isEnemy } from './combat.js';
import { NavGrid } from './nav.js';
import * as Obj from './objective.js';

const DEG = Math.PI / 180;

// Game modes. In 'ffa' everyone is on team 'ffa' and fights everyone; in
// 'teams' players are 'red' or 'blue' and spawn on their own side of the map.
// Teams on a bomb or hostage map plays objective rounds (objective.js).
export const MODES = ['ffa', 'teams'];
export const TEAMS = ['red', 'blue'];

export function emptyCmd() {
  return {
    fwd: 0, side: 0, jump: false, duck: false, walk: false,
    fire: false, alt: false, reload: false, slot: null, lastWeapon: false,
    yaw: 0, pitch: 0, actions: null, use: false,
  };
}

// What a player takes from the bot they take over.
const TAKEOVER_FIELDS = [
  'pos', 'prevPos', 'vel', 'yaw', 'pitch', 'onGround', 'ducked', 'duckAmount', 'prevDuck', 'stepOffset',
  'stamina', 'health', 'armor', 'helmet', 'defuser', 'active', 'lastActive', 'nextAttack', 'deployEnd',
  'reloading', 'reloadEnd', 'shellNext', 'shotsFired', 'pistolAcc', 'accuracy', 'zoom', 'spin', 'tagMul',
  'swimming', 'waterJump', 'nadePin', 'nadeRedrawAt', 'burstLeft', 'burstNext',
  'blindStart', 'blindHold', 'blindFade', 'blindAlpha',
];

// A grenade comes one at a time (def.clip is how many you can carry).
function makeWeapon(id) {
  const def = WEAPONS[id];
  return { id, clip: def.grenade ? 1 : def.clip, reserve: def.reserve };
}

// Slots in the order the number keys use them: 1 primary, 2 pistol, 3 knife,
// 4 grenades (HE, flash, smoke; 4 again picks the next one). The bomb
// carrier also has the C4, which key 3 swaps to.
export const SLOTS = ['primary', 'secondary', 'melee', 'grenade', 'flash', 'smoke', 'c4'];

export function emptyWeapons() {
  return { primary: null, secondary: null, melee: null, grenade: null, flash: null, smoke: null, c4: null };
}

// The grenade slot key 4 switches to: the next one you carry after the one
// in your hand, or the first one you carry.
export function nextNadeSlot(p) {
  const owned = NADE_SLOTS.filter((s) => p.weapons[s]?.clip > 0);
  if (!owned.length) return null;
  const i = owned.indexOf(p.active);
  return owned[(i + 1) % owned.length];
}

// How white a flashbang has left p's screen at time t, 0..1 (1 = fully
// blind): the hold at full strength, then a linear fade.
export function blindLevel(p, t) {
  if (!p.blindAlpha) return 0;
  const e = t - p.blindStart;
  if (e < 0) return 0;
  if (e <= p.blindHold) return p.blindAlpha;
  return Math.max(0, p.blindAlpha * (1 - (e - p.blindHold) / Math.max(0.01, p.blindFade)));
}

// Small seeded RNG.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-shot random numbers, like CS 1.6's shared_random_seed: seeded by who
// shot and how many shots they've fired, so the server and the shooter's own
// browser (which predicts its shots) agree on exactly where the spread puts
// every bullet and which way the recoil kicks.
export function shotRng(playerId, shotSeed) {
  return mulberry32(Math.imul(playerId | 0, 0x9E3779B1) ^ Math.imul(shotSeed | 0, 0x85EBCA77));
}

export class Game {
  constructor(map, { seed = Date.now(), mode = 'ffa' } = {}) {
    this.mode = MODES.includes(mode) ? mode : 'ffa';
    this.setMap(map);
    this.players = [];
    this.time = 0;
    this.tickCount = 0;
    this.events = [];
    // Set by OnlineSession while it predicts its own gun (see emit, fire).
    this.predicting = false;
    this.replaying = false;
    this.rand = mulberry32(seed >>> 0);
    this.nextId = 1;
    // Optional lag compensation: (shooter) => restore(). The server sets this to
    // rewind other players to what the shooter saw while their bullets trace.
    this.lagComp = null;
    // Guns lying on the ground: { id, weapon: { id, clip, reserve }, pos, vel,
    // yaw, rest, expiresAt, noPickup: { pid, until } }.
    this.drops = [];
    this.nextDropId = 1;
    // Grenades in flight: { id, owner, team, weapon, pos, prevPos, vel, explodeAt, rest, lastBounce }.
    this.nades = [];
    // Smoke clouds: { id, pos, start, end, radius } (meters).
    this.smokes = [];
    this.nextNadeId = 1;
    // 'live' while playing, 'over' while the winner is shown.
    this.match = { state: 'live', endsAt: 0, winner: null, winnerTeam: null, winnerName: '' };
    this.teamKills = { red: 0, blue: 0 };
    // Objective rounds (see objective.js).
    this.round = Obj.emptyRound();
    this.rounds = { red: 0, blue: 0 };
    this.bomb = Obj.emptyBomb();
    this.hostages = [];
    this.plan = 'A';
  }

  // Load a map. Call restartMatch() afterwards to put everyone in it.
  setMap(map) {
    this.map = map;
    this.world = new World(map.boxes);
    this._nav = null;
    this.drops = [];
    this.nades = [];
    this.smokes = [];
    this.objective = Obj.objectiveFor(this.mode, map);
    if (this.round) { this.round = Obj.emptyRound(); this.bomb = Obj.emptyBomb(); this.hostages = []; }
  }

  // Bots and hostages find their way with this; built on first use.
  get nav() {
    if (!this._nav) this._nav = new NavGrid(this.world, this.map.bounds, this.map.water);
    return this._nav;
  }

  // Height of the water surface over (x, z), or null if there's no water.
  waterSurface(x, z) {
    const water = this.map.water;
    if (!water?.length) return null;
    for (const w of water) {
      if (x > w.min[0] && x < w.max[0] && z > w.min[1] && z < w.max[1]) return w.y;
    }
    return null;
  }

  // Is the point (an eye, a grenade) under water?
  underwater(x, y, z) {
    const s = this.waterSurface(x, z);
    return s !== null && y < s;
  }

  // Standing in water (wading is slower and footsteps splash)?
  inWater(p) {
    const water = this.map.water;
    if (!water?.length || p.pos[1] > -0.05) return false;
    for (const w of water) {
      if (p.pos[0] > w.min[0] && p.pos[0] < w.max[0] && p.pos[2] > w.min[1] && p.pos[2] < w.max[1] && p.pos[1] < w.y) return true;
    }
    return false;
  }

  killLimit() {
    return this.mode === 'teams' ? TEAM_KILL_LIMIT : FFA_KILL_LIMIT;
  }

  frozen(p) {
    return p.frozenUntil > this.time;
  }

  addPlayer({ name, team = this.defaultTeam(), isBot = false }) {
    const p = {
      id: this.nextId++, name, team, isBot,
      alive: false, respawnAt: this.time + (isBot ? 0.5 + this.rand() * 1.5 : 0),
      pos: [0, 0, 0], prevPos: [0, 0, 0], vel: [0, 0, 0],
      yaw: 0, pitch: 0, onGround: true, ducked: false, duckAmount: 0, prevDuck: 0,
      stepOffset: 0, stamina: 0, jumpHeld: false,
      health: MAX_HEALTH, armor: 0, helmet: false,
      money: START_MONEY, kills: 0, deaths: 0, headshots: 0,
      weapons: emptyWeapons(), active: 'secondary', lastActive: 'primary',
      nextAttack: 0, deployEnd: 0, reloading: false, reloadEnd: 0, shellNext: 0,
      shotsFired: 0, decreaseShotsAt: 0, delayFire: false, pistolAcc: 0.9, accuracy: 0.2, lastFire: -10,
      punch: [0, 0], prevPunch: [0, 0], recoilDir: 1, shotSeed: 0,
      zoom: 0, resumeZoomAt: 0, resumeZoom: 0,
      spin: 0, fireHeld: false, altHeld: false, reloadHeld: false,
      tagMul: 1, lastHitDir: null, lastAttacker: null, lastHurtTime: -10,
      nextStab: 0, lastMelee: -10, frozenUntil: 0, life: 0,
      task: null, useHeld: false, defuser: false,
      roundKills: 0, multi: 0, lastKillAt: -10, god: false,
      spawnedAt: 0,
      nadePin: 0, nadeLob: false, nadeRedrawAt: 0, swimming: false, waterJump: 0,
      burstLeft: 0, burstNext: 0,
      blindStart: 0, blindHold: 0, blindFade: 0, blindAlpha: 0,
    };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    const p = this.getPlayer(id);
    if (p?.controlling) this.releaseBot(p, true);
    if (p?.controlledBy) { const c = this.getPlayer(p.controlledBy); if (c) c.controlling = null; }
    if (p && this.objective) { Obj.dropBomb(this, p); Obj.releaseHostages(this, p); }
    this.players = this.players.filter((p) => p.id !== id);
  }

  // The team a new player joins: the smaller one in teams, 'ffa' otherwise.
  defaultTeam() {
    if (this.mode !== 'teams') return 'ffa';
    const n = { red: 0, blue: 0 };
    for (const p of this.players) if (p.team in n) n[p.team]++;
    return n.red <= n.blue ? 'red' : 'blue';
  }

  // Switch mode and put everyone on a team that fits it. Bots are dealt out
  // after humans so the humans stay balanced too.
  setMode(mode) {
    this.mode = MODES.includes(mode) ? mode : 'ffa';
    this.objective = Obj.objectiveFor(this.mode, this.map);
    const order = [...this.players.filter((p) => !p.isBot), ...this.players.filter((p) => p.isBot)];
    for (const p of order) p.team = null;
    for (const p of order) p.team = this.defaultTeam();
    this.resetScores();
  }

  // ---------- Match ----------

  resetScores() {
    this.match = { state: 'live', endsAt: 0, winner: null, winnerTeam: null, winnerName: '' };
    this.teamKills = { red: 0, blue: 0 };
    this.rounds = { red: 0, blue: 0 };
    this.round = Obj.emptyRound();
    this.bomb = Obj.emptyBomb();
    this.hostages = [];
    this.drops = [];
    this.nades = [];
    this.smokes = [];
    for (const p of this.players) {
      p.kills = 0; p.deaths = 0; p.headshots = 0; p.money = START_MONEY;
      p.controlling = null; p.controlledBy = null; p.ownMoney = 0;
    }
  }

  // A fresh match: scores reset and everyone respawns, frozen for START_DELAY
  // (or the first round's buy time, in objective rounds).
  restartMatch() {
    this.resetScores();
    this.emit({ type: 'matchStart' });
    if (this.objective) return Obj.startRound(this);
    for (const p of this.players) this.spawn(p);
    for (const p of this.players) p.frozenUntil = this.time + START_DELAY;
  }

  // Someone joining a match in progress spawns right away, frozen for
  // START_DELAY so they get a moment to look around and buy. In objective
  // rounds you wait for the next round unless this one has only just begun.
  join(p) {
    if (this.objective && this.round.state !== 'none') {
      if (!Obj.canSpawnNow(this)) { p.alive = false; p.respawnAt = NEVER; return; }
      this.spawn(p);
      p.frozenUntil = Math.max(this.round.freezeEnd, this.time + (this.round.state === 'freeze' ? 0 : 1));
      return;
    }
    this.spawn(p);
    p.frozenUntil = this.time + START_DELAY;
  }

  endMatch(winner, winnerTeam) {
    this.match = {
      state: 'over', endsAt: this.time + MATCH_OVER_TIME,
      winner: winner?.id ?? null, winnerTeam: winnerTeam ?? null, winnerName: winner?.name ?? '',
    };
    // Everyone stops where they are until the next match.
    for (const p of this.players) p.frozenUntil = this.match.endsAt + 1;
    this.emit({ type: 'matchEnd', winner: this.match.winner, team: winnerTeam ?? null, name: this.match.winnerName });
  }

  // What clients need to show the match state (sent in every snapshot).
  matchInfo() {
    return { ...this.match, teamKills: this.teamKills };
  }

  objectiveInfo() {
    return Obj.objectiveInfo(this);
  }

  // Change sides in teams mode (the Switch team key). A living player is
  // taken out without it counting as a death and respawns with the new team.
  setTeam(p, team) {
    if (this.mode !== 'teams' || !TEAMS.includes(team) || p.team === team) return false;
    if (p.controlling) this.releaseBot(p, true); // the bot carries on in its body
    if (this.objective) { Obj.dropBomb(this, p); Obj.releaseHostages(this, p); p.task = null; }
    p.team = team;
    if (p.alive) {
      p.alive = false;
      p.reloading = false;
      p.zoom = 0;
      p.respawnAt = this.time + 1;
    }
    // Objective rounds: you come back on the new side next round (or right
    // away during the buy time).
    if (this.objective) p.respawnAt = this.round.state === 'freeze' ? this.time : NEVER;
    this.emit({ type: 'team', pid: p.id, team });
    return true;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  // replaying: a browser re-running its own unacknowledged cmds after a
  // snapshot (online). The state catches up, but nothing is shown again.
  emit(e) {
    if (this.replaying) return;
    e.time = this.time;
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- Spawning / buying ----------

  // A spot at or near a spawn point that no other living player stands on.
  // Big teams outnumber a map's spawn points, and stacked players block each
  // other's view (the camera ends up inside a teammate) until they move.
  freeSpot(pos, self) {
    const taken = (x, z) => this.players.some((o) => o !== self && o.alive && Math.hypot(o.pos[0] - x, o.pos[2] - z) < 1.1);
    if (!taken(pos[0], pos[2])) return [...pos];
    const [x0, y, z0] = pos;
    const r = PLAYER_RADIUS;
    for (const ring of [1.3, 2.6, 3.9, 5.2]) {
      const n = Math.round(ring * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * ring, z = z0 + Math.sin(a) * ring;
        if (taken(x, z)) continue;
        if (this.world.overlaps(x - r, y + 0.05, z - r, x + r, y + STAND_HEIGHT, z + r)) continue;
        if (this.waterSurface(x, z) !== null) continue;
        // Raised spawns need a floor under the new spot too.
        if (y > 0.05 && !this.world.overlaps(x - 0.1, y - 0.2, z - 0.1, x + 0.1, y + 0.01, z + 0.1)) continue;
        // Same room: no wall between the spawn point and the spot.
        if (!this.world.visible(x0, y + 1, z0, x, y + 1, z)) continue;
        return [x, y, z];
      }
    }
    return [...pos];
  }

  // Survivors of an objective round keep their guns (with the ammo left in
  // them), grenades, armor, helmet and kit into the next round, like CS 1.6.
  // Anyone who died starts again with a pistol and a knife and buys by hand:
  // a Glock-18 on Red (CS's terrorists), a USP on Blue and in free for all.
  spawn(p) {
    const keepGear = p.alive && !!this.objective && this.round.n > 1;
    const enemies = this.players.filter((o) => o.alive && isEnemy(p, o));
    let best = null, bestScore = -Infinity;
    const pool = (this.mode === 'teams' && this.map.teamSpawns?.[p.team]) || this.map.spawns;
    for (const s of pool) {
      let minD = 60, seen = 0;
      for (const e of enemies) {
        minD = Math.min(minD, Math.hypot(e.pos[0] - s.pos[0], e.pos[2] - s.pos[2]));
        // Avoid spawning in an enemy's line of sight.
        if (this.world.visible(s.pos[0], s.pos[1] + STAND_EYE, s.pos[2], e.pos[0], e.pos[1] + STAND_EYE, e.pos[2])) seen++;
      }
      minD -= seen * 25;
      const blocked = this.players.some((o) => o.alive && Math.hypot(o.pos[0] - s.pos[0], o.pos[2] - s.pos[2]) < 1);
      const score = minD + this.rand() * 12 - (blocked ? 1000 : 0);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    const pos = this.freeSpot(best.pos, p);
    p.pos = pos;
    p.prevPos = [...pos];
    p.vel = [0, 0, 0];
    p.yaw = best.yaw;
    p.pitch = 0;
    p.alive = true;
    p.health = MAX_HEALTH;
    // A new life (and in objective rounds, a new round) restarts the kill
    // money streak and the multi-kill chain.
    p.roundKills = 0;
    p.multi = 0;
    p.ducked = false; p.duckAmount = 0; p.onGround = true;
    if (!keepGear) {
      p.armor = 0; p.helmet = false; p.defuser = false;
      p.weapons = emptyWeapons();
      p.weapons.secondary = makeWeapon(this.mode === 'teams' && p.team === 'red' ? 'glock18' : 'usp');
      p.weapons.melee = makeWeapon('knife');
      p.active = 'secondary';
    } else {
      if (!p.weapons.melee) p.weapons.melee = makeWeapon('knife');
      if (!p.weapons[p.active]) p.active = ['primary', 'secondary', 'melee'].find((s) => p.weapons[s]);
    }
    p.life++;
    p.spawnedAt = this.time;
    p.punch = [0, 0]; p.prevPunch = [0, 0];
    p.zoom = 0; p.spin = 0; p.reloading = false; p.shotsFired = 0;
    p.tagMul = 1;
    p.nadePin = 0; p.nadeRedrawAt = 0; p.swimming = false; p.waterJump = 0;
    p.burstLeft = 0; p.blindAlpha = 0;
    p.task = null;
    p.deployEnd = this.time + 0.3; p.nextAttack = this.time + 0.3; p.nextStab = this.time + 0.3;
    if (this.match.state === 'over') p.frozenUntil = this.match.endsAt + 1;
    this.emit({ type: 'spawn', pid: p.id, yaw: p.yaw }); // yaw: cmds later in the tick overwrite p.yaw
  }

  // When buying closes for this player (game time).
  buyDeadline(p) {
    if (this.objective) return this.round.freezeEnd + BUY_TIME;
    return Math.max(p.frozenUntil, p.spawnedAt) + BUY_TIME;
  }

  // The team whose shop a player uses, or null in free-for-all.
  buyTeam(p) {
    return this.mode === 'teams' ? p.team : null;
  }

  canBuy(p) {
    return p.alive && this.time <= this.buyDeadline(p);
  }

  // The gun N buys ammo for: the one in your hands, or your primary (then
  // pistol) when you hold the knife or a grenade.
  ammoSlot(p) {
    if (p.active === 'primary' || p.active === 'secondary') return p.weapons[p.active] ? p.active : null;
    return p.weapons.primary ? 'primary' : p.weapons.secondary ? 'secondary' : null;
  }

  // Ammo packs (CS 1.6 prices) until the reserve is full or the money runs out.
  buyAmmo(p, slot = this.ammoSlot(p), silent = false) {
    const w = slot && p.weapons[slot];
    const def = w && WEAPONS[w.id];
    const pack = def && AMMO[def.bullet];
    if (!pack) return false;
    const [size, price] = pack;
    const need = Math.ceil((def.reserve - w.reserve) / size);
    const n = Math.min(need, Math.floor(p.money / price));
    if (n <= 0) return false;
    w.reserve = Math.min(def.reserve, w.reserve + n * size);
    p.money -= n * price;
    if (!silent) this.emit({ type: 'buy', pid: p.id, item: 'ammo' });
    return true;
  }

  // silent: bots and tests, which skip the buy time and the buy event.
  buy(p, item, silent = false) {
    if (!p.alive) return false;
    if (!silent && !this.canBuy(p)) return false;
    if (item === 'ammo') return this.buyAmmo(p, undefined, silent);
    if (item === 'defuser') {
      // Defuse kit: Blue only, in bomb rounds.
      if (p.defuser || p.team !== 'blue' || this.objective !== 'bomb' || p.money < GEAR.defuser.price) return false;
      p.money -= GEAR.defuser.price;
      p.defuser = true;
      if (!silent) this.emit({ type: 'buy', pid: p.id, item });
      return true;
    }
    if (GEAR[item]) {
      const g = GEAR[item];
      if (item === 'kevlar' && p.armor >= 100) return false;
      if (item === 'kevlarHelmet' && p.armor >= 100 && p.helmet) return false;
      let price = g.price;
      if (item === 'kevlarHelmet' && p.armor >= 100) price = 350; // helmet only
      if (p.money < price) return false;
      p.money -= price;
      p.armor = 100;
      if (item === 'kevlarHelmet') p.helmet = true;
      if (!silent) this.emit({ type: 'buy', pid: p.id, item });
      return true;
    }
    const def = WEAPONS[item];
    if (!def || def.bomb || def.melee) return false;
    if (!teamCanBuy(item, this.buyTeam(p))) return false;
    const cur = p.weapons[def.slot];
    // Already have it: buying it again buys its ammo, or another grenade
    // up to as many as you can carry (two flashbangs).
    if (cur && cur.id === item && !def.grenade) return this.buyAmmo(p, def.slot, silent);
    if (cur && cur.id === item && cur.clip >= def.clip) return false;
    if (p.money < def.price) return false;
    p.money -= def.price;
    if (cur && cur.id === item) cur.clip++;
    else p.weapons[def.slot] = makeWeapon(item);
    // Buying a gun puts it in your hands; a grenade goes on your belt (4).
    if (!def.grenade) this.switchTo(p, def.slot, true);
    if (!silent) this.emit({ type: 'buy', pid: p.id, item });
    return true;
  }

  // F1: buy again what you bought last time (items in the order they were
  // bought). Skips what you already have, like CS 1.6's rebuy: a gun you're
  // holding, full armor, a grenade on your belt or a kit. Buying a gun
  // again would otherwise buy ammo, and armor twice would cost twice.
  rebuy(p, items) {
    if (!Array.isArray(items) || !p.alive || !this.canBuy(p)) return 0;
    let n = 0;
    for (const item of items) {
      const def = WEAPONS[item];
      const cur = def && p.weapons[def.slot];
      if (cur?.id === item && (!def.grenade || cur.clip >= def.clip)) continue;
      if (item === 'kevlar' && p.armor >= 100) continue;
      if (item === 'kevlarHelmet' && p.armor >= 100 && p.helmet) continue;
      if (this.buy(p, item)) n++;
    }
    return n;
  }

  // Objective rounds: a dead player watching a living bot on their own team
  // takes it over (E while spectating, like CS 1.6). They play its body
  // where it stands, with its health, armor, guns, money and the bomb if it
  // has it. Kills and a death while in control count for the bot, not the
  // player. When the round ends (or the body dies) the bot gets it all
  // back, as it is then, and the player is back to their own score and
  // money, starting over next round like anyone who died.
  canTakeOver(p, bot) {
    return !!bot && !!this.objective && !p.isBot && !p.alive && bot.isBot && bot.alive && !bot.controlledBy &&
      bot.team === p.team && bot !== p && this.match.state === 'live' && !this.frozen(bot);
  }

  // The player whose score a kill or death counts for: the bot when it's
  // being played by someone.
  scorer(p) {
    return (p?.controlling && this.getPlayer(p.controlling)) || p;
  }

  // Give a taken-over bot back. At the end of the round (keepBody) the bot
  // gets the body as it is: alive with its gear, or dead.
  releaseBot(p, keepBody = false) {
    if (!p.controlling) return;
    const bot = this.getPlayer(p.controlling);
    p.controlling = null;
    if (bot) {
      bot.controlledBy = null;
      bot.money = p.money;
      if (keepBody && p.alive) {
        for (const k of TAKEOVER_FIELDS) {
          const v = p[k];
          bot[k] = Array.isArray(v) ? [...v] : v;
        }
        bot.weapons = { ...p.weapons };
        bot.alive = true;
        bot.task = null;
        if (this.objective) {
          if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) this.bomb.carrier = bot.id;
          if (this.bomb.defuser === p.id) this.bomb.defuser = null;
          for (const h of this.hostages) if (h.leader === p.id) h.leader = bot.id;
        }
      }
    }
    p.money = p.ownMoney;
    if (keepBody && p.alive) {
      p.alive = false;
      p.respawnAt = NEVER;
      p.weapons = emptyWeapons();
    }
  }

  takeOver(p, bot) {
    if (!this.canTakeOver(p, bot)) return false;
    for (const k of TAKEOVER_FIELDS) {
      const v = bot[k];
      p[k] = Array.isArray(v) ? [...v] : v;
    }
    p.weapons = { ...bot.weapons };
    p.punch = [0, 0]; p.prevPunch = [0, 0];
    p.task = null;
    p.useHeld = true; // the E that took over doesn't also press use
    p.alive = true;
    p.life++;
    p.spawnedAt = this.time;
    p.frozenUntil = 0;
    p.roundKills = 0;
    p.ownMoney = p.money;
    p.money = bot.money;
    p.controlling = bot.id;
    bot.controlledBy = p.id;
    if (this.objective) {
      const b = this.bomb;
      if (bot.task?.kind === 'defuse' && b.defuser === bot.id) b.defuser = null;
      if (b.state === 'carried' && b.carrier === bot.id) b.carrier = p.id;
      for (const h of this.hostages) if (h.leader === bot.id) h.leader = p.id;
    }
    bot.task = null;
    bot.alive = false;
    bot.reloading = false;
    bot.zoom = 0;
    bot.nadePin = 0;
    bot.weapons = emptyWeapons();
    bot.respawnAt = this.objective ? NEVER : this.time + RESPAWN_TIME;
    this.emit({ type: 'takeover', pid: p.id, bot: bot.id, yaw: p.yaw, pitch: p.pitch });
    return true;
  }

  // ---------- Tick ----------

  // cmds: Map<playerId, cmd>
  tick(cmds) {
    this.time += TICK_DT;
    this.tickCount++;
    const dt = TICK_DT;
    if (this.match.state === 'over' && this.time >= this.match.endsAt) this.restartMatch();
    if (this.objective) Obj.preTick(this);

    for (const p of this.players) {
      p.prevPos[0] = p.pos[0]; p.prevPos[1] = p.pos[1]; p.prevPos[2] = p.pos[2];
      p.prevPunch[0] = p.punch[0]; p.prevPunch[1] = p.punch[1];
      p.prevDuck = p.duckAmount;

      const cmd = cmds.get(p.id) ?? emptyCmd();
      if (!p.alive) {
        // Dead players can still change team, but not buy.
        if (cmd.actions) for (const a of cmd.actions) if (a.type === 'team' || a.type === 'takeover') this.handleAction(p, a);
        if (p.alive) continue; // took over a bot
        if (this.time >= p.respawnAt && (!this.objective || Obj.canSpawnNow(this))) {
          this.spawn(p);
          if (this.objective) p.frozenUntil = this.round.freezeEnd;
        }
        continue;
      }
      if (cmd.actions) for (const a of cmd.actions) this.handleAction(p, a);
      if (this.objective) Obj.playerUse(this, p, this.frozen(p) ? { ...cmd, use: false } : cmd);

      this.moveStep(p, cmd, dt);
      // Frozen (match start / match over): look, switch and buy, but no shooting.
      this.updateWeapon(p, this.frozen(p) ? { ...cmd, fire: false, alt: false } : cmd, dt);
      this.touchDrops(p);
      if (this.objective === 'bomb') Obj.touchBomb(this, p);

      // Fell out of the world.
      if (p.pos[1] < -20) this.kill(p, null, null, false, false);
    }
    this.updateDrops(dt);
    this.updateNades(dt);
    this.updateSmokes();
    if (this.objective) Obj.update(this, dt);
  }

  // Look + movement for one tick. Also used by online clients to predict
  // their own player between server snapshots.
  moveStep(p, cmd, dt = TICK_DT) {
    // Frozen, or busy planting/defusing: you can look around but not move.
    if (this.frozen(p) || p.task) cmd = { ...cmd, fwd: 0, side: 0, jump: false };
    p.yaw = cmd.yaw;
    p.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, cmd.pitch));

    // Recover from being shot.
    if (p.tagMul < 1) p.tagMul = Math.min(1, p.tagMul + dt * (1 - TAG_SPEED_MUL) / TAG_RECOVER_TIME);

    const def = this.activeDef(p);
    let speed = def ? def.speed : 250;
    if (def && def.scopedSpeed && p.zoom > 0) speed = def.scopedSpeed;
    if (def && def.spinUp && p.spin > 0) speed *= 0.85;
    if (this.inWater(p)) speed *= WATER_SPEED_MUL;
    movePlayer(this.world, p, cmd, dt, speed * U, this.waterSurface(p.pos[0], p.pos[2]), this.blockers(p));
    // Smooth stair steps for the camera.
    p.stepOffset *= Math.max(0, 1 - dt * 14);
  }

  // Boxes of the living players near p that p can't walk through: teammates,
  // enemies and bots alike, like CS 1.6. Someone p is already inside (a spawn
  // stack, a prediction miss online) is left out, so the two can walk apart
  // instead of being shoved. Online, the browser checks against the newest
  // snapshot (collideStates) rather than the 100 ms-old drawn positions, as
  // that's closer to where the server has everyone when our cmd runs.
  blockers(p) {
    const out = [];
    for (const o of this.players) {
      if (o === p) continue;
      const s = this.collideStates?.get(o.id);
      const alive = s ? s.alive : o.alive;
      if (!alive) continue;
      const pos = s ? s.pos : o.pos;
      if (Math.abs(pos[0] - p.pos[0]) > 3 || Math.abs(pos[2] - p.pos[2]) > 3 || Math.abs(pos[1] - p.pos[1]) > 4) continue;
      const b = playerBox(pos, s ? s.ducked : o.ducked);
      if (hullTouches(p, b)) continue;
      out.push(b);
    }
    return out;
  }

  handleAction(p, a) {
    if (a.type === 'buy') this.buy(p, a.item);
    else if (a.type === 'team') this.setTeam(p, a.team);
    else if (a.type === 'drop') {
      if (p.active === 'c4') Obj.dropBomb(this, p, true);
      else this.dropWeapon(p, p.active, true);
    } else if (a.type === 'pickup') this.pickup(p, a.id);
    else if (a.type === 'rebuy') this.rebuy(p, a.items);
    else if (a.type === 'takeover') this.takeOver(p, this.getPlayer(a.id));
  }

  // ---------- Dropped guns ----------

  // Take the gun out of a slot and put it on the ground. Thrown forward when
  // dropped on purpose (G), or falls where you stood when you die. The knife
  // never drops. Returns the drop or null.
  dropWeapon(p, slot, thrown, { switchAway = true } = {}) {
    const w = p.weapons[slot];
    if (!w || WEAPONS[w.id].melee || WEAPONS[w.id].grenade || WEAPONS[w.id].bomb) return null;
    p.weapons[slot] = null;
    let pos, vel;
    if (thrown) {
      const f = aimDir(p.yaw, Math.max(-0.5, Math.min(0.6, p.pitch)));
      const eye = this.eyePos(p);
      pos = [eye[0] + f[0] * 0.45, eye[1] - 0.25 + f[1] * 0.45, eye[2] + f[2] * 0.45];
      vel = [f[0] * 4.5 + p.vel[0], f[1] * 4.5 + 1.6 + p.vel[1] * 0.5, f[2] * 4.5 + p.vel[2]];
    } else {
      pos = [p.pos[0], p.pos[1] + 1.0, p.pos[2]];
      vel = [p.vel[0] * 0.5 + (this.rand() - 0.5), 1, p.vel[2] * 0.5 + (this.rand() - 0.5)];
    }
    const d = {
      id: this.nextDropId++, weapon: w, pos, vel, yaw: p.yaw + (this.rand() - 0.5) * 0.8, rest: false,
      expiresAt: this.objective ? NEVER : this.time + DROP_LIFETIME, noPickup: { pid: p.id, until: this.time + 0.8 },
    };
    this.drops.push(d);
    if (this.drops.length > 32) this.drops.shift();
    if (p.alive && p.active === slot) {
      p.reloading = false; p.zoom = 0; p.resumeZoomAt = 0; p.spin = 0;
      if (switchAway) this.switchTo(p, SLOTS.find((s) => p.weapons[s]) ?? 'melee', true);
    }
    this.emit({ type: 'drop', pid: p.id, weapon: w.id, alive: p.alive });
    return d;
  }

  canPickup(p, d, range = PICKUP_RANGE) {
    if (!p.alive || (d.noPickup.pid === p.id && this.time < d.noPickup.until)) return false;
    const dy = d.pos[1] - p.pos[1];
    return dy > -1 && dy < 2 && Math.hypot(d.pos[0] - p.pos[0], d.pos[2] - p.pos[2]) < range;
  }

  // The drop a G press would pick up: the nearest one in reach, favoring the
  // one you're looking at. Used by the client to choose between pick up and
  // drop, and for the "G Pick up" prompt.
  pickupTarget(p, yaw = p.yaw) {
    let best = null, bestScore = Infinity;
    const f = forwardVec(yaw);
    for (const d of this.drops) {
      if (!this.canPickup(p, d)) continue;
      const dx = d.pos[0] - p.pos[0], dz = d.pos[2] - p.pos[2];
      const dist = Math.hypot(dx, dz);
      const facing = dist > 0.01 ? (dx * f[0] + dz * f[2]) / dist : 1;
      const score = dist - facing * 0.6;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  pickup(p, id) {
    const d = this.drops.find((x) => x.id === id);
    if (!d || !this.canPickup(p, d)) return false;
    this.takeDrop(p, d);
    return true;
  }

  // Swap: what you had in that slot goes on the ground in its place.
  takeDrop(p, d) {
    const slot = WEAPONS[d.weapon.id].slot;
    this.drops = this.drops.filter((x) => x !== d);
    if (p.weapons[slot]) this.dropWeapon(p, slot, true, { switchAway: false });
    p.weapons[slot] = d.weapon;
    this.switchTo(p, slot, true);
    this.emit({ type: 'pickup', pid: p.id, weapon: d.weapon.id });
  }

  // CS: walking over a gun picks it up if that slot is empty.
  touchDrops(p) {
    if (!p.alive || !this.drops.length) return;
    for (const d of this.drops) {
      const slot = WEAPONS[d.weapon.id].slot;
      if (!p.weapons[slot] && this.canPickup(p, d, TOUCH_RANGE)) { this.takeDrop(p, d); return; }
    }
  }

  updateDrops(dt) {
    if (!this.drops.length) return;
    this.drops = this.drops.filter((d) => this.time < d.expiresAt && d.pos[1] > -20);
    for (const d of this.drops) {
      if (d.rest) continue;
      const v = d.vel;
      v[1] -= GRAVITY * dt;
      const sp = Math.hypot(v[0], v[1], v[2]);
      const step = sp * dt;
      if (step < 1e-6) continue;
      const dir = [v[0] / sp, v[1] / sp, v[2] / sp];
      const h = this.world.raycast(d.pos[0], d.pos[1], d.pos[2], dir[0], dir[1], dir[2], step + 0.03);
      if (!h) {
        d.pos[0] += v[0] * dt; d.pos[1] += v[1] * dt; d.pos[2] += v[2] * dt;
        continue;
      }
      const t = Math.max(0, h.t - 0.03);
      d.pos[0] += dir[0] * t; d.pos[1] += dir[1] * t; d.pos[2] += dir[2] * t;
      const n = h.normal;
      if (n[1] > 0.5) {
        // Landed: lie flat on the floor, right at the surface.
        d.pos[0] += dir[0] * (h.t - t); d.pos[1] += dir[1] * (h.t - t); d.pos[2] += dir[2] * (h.t - t);
        d.rest = true;
        d.vel = [0, 0, 0];
      } else {
        // Bounce off walls, losing most of the speed.
        const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        for (let i = 0; i < 3; i++) v[i] = (v[i] - 1.5 * vn * n[i]) * 0.5;
      }
    }
  }

  activeWeapon(p) {
    return p.weapons[p.active];
  }

  activeDef(p) {
    const w = p.weapons[p.active];
    return w ? WEAPONS[w.id] : null;
  }

  eyePos(p) {
    const eye = STAND_EYE + (DUCK_EYE - STAND_EYE) * p.duckAmount;
    return [p.pos[0], p.pos[1] + eye, p.pos[2]];
  }

  switchTo(p, slot, force = false) {
    if (!p.weapons[slot] || (!force && p.active === slot)) return;
    if (p.active !== slot) p.lastActive = p.active;
    p.active = slot;
    const def = WEAPONS[p.weapons[slot].id];
    p.deployEnd = this.time + def.deploy;
    p.nextAttack = Math.max(p.nextAttack, p.deployEnd);
    p.reloading = false;
    p.zoom = 0; p.resumeZoomAt = 0;
    p.shotsFired = 0;
    p.spin = 0;
    p.nadePin = 0; // switching away puts the pin back
    p.nadeRedrawAt = 0;
    p.burstLeft = 0;
    p.accuracy = 0.2;
    p.pistolAcc = def.accuracy.start ?? 0.9;
    this.emit({ type: 'deploy', pid: p.id, weapon: def.id });
  }

  updateWeapon(p, cmd, dt) {
    const t = this.time;

    // View punch decays back to zero (CS DropPunchAngle).
    let len = Math.hypot(p.punch[0], p.punch[1]);
    if (len > 0) {
      const nl = Math.max(0, len - (10 + len * 0.5) * dt);
      p.punch[0] *= nl / len; p.punch[1] *= nl / len;
    }

    // Weapon switching. With the bomb, key 3 takes it out, and again swaps
    // to the knife.
    let slot = cmd.slot;
    if (slot === 'melee' && p.weapons.c4 && p.active !== 'c4') slot = 'c4';
    if (slot === 'nade') slot = nextNadeSlot(p);
    if (slot && p.weapons[slot] && slot !== p.active) this.switchTo(p, slot);
    if (cmd.lastWeapon && p.weapons[p.lastActive]) this.switchTo(p, p.lastActive);

    const w = this.activeWeapon(p);
    if (!w) return;
    const def = WEAPONS[w.id];
    // A browser predicting its own player (online) leaves the knife and
    // grenades to the server; it only predicts guns.
    if ((def.melee || def.grenade) && (this.predicting || this.replaying)) return;
    if (def.bomb) return; // planting is objective.js (playerUse)
    if (def.melee) { this.updateMelee(p, cmd, def); return; }
    if (def.grenade) { this.updateGrenade(p, cmd, def, w); return; }

    // Spray counter decays when the trigger is released (CS ItemPostFrame).
    if (!cmd.fire) {
      if (p.delayFire) {
        p.delayFire = false;
        if (p.shotsFired > 15) p.shotsFired = 15;
        p.decreaseShotsAt = t + 0.4;
      }
      if (p.shotsFired > 0 && t > p.decreaseShotsAt) {
        p.decreaseShotsAt = t + 0.0225;
        p.shotsFired--;
      }
    }

    // Reload progress.
    if (p.reloading) {
      if (def.shellReload) {
        if (cmd.fire && w.clip > 0) {
          p.reloading = false; // fire interrupts shell loading
        } else if (t >= p.shellNext) {
          if (w.clip < def.clip && w.reserve > 0) {
            w.clip++; w.reserve--;
            p.shellNext = t + def.shellReload.each;
            this.emit({ type: 'shell', pid: p.id });
          }
          if (w.clip >= def.clip || w.reserve <= 0) {
            p.reloading = false;
            p.nextAttack = Math.max(p.nextAttack, t + 0.1);
          }
        }
      } else if (t >= p.reloadEnd) {
        const need = def.clip - w.clip;
        const take = Math.min(need, w.reserve);
        w.clip += take; w.reserve -= take;
        p.reloading = false;
        p.shotsFired = 0;
        this.emit({ type: 'reloaded', pid: p.id });
      }
    }

    // Start a reload.
    const reloadPressed = cmd.reload && !p.reloadHeld;
    p.reloadHeld = !!cmd.reload;
    const wantsReload = reloadPressed || (w.clip === 0 && w.reserve > 0 && t >= p.nextAttack);
    if (wantsReload && !p.reloading && w.clip < def.clip && w.reserve > 0 && t >= p.deployEnd && t >= p.nextAttack - 0.05) {
      p.reloading = true;
      p.zoom = 0; p.resumeZoomAt = 0;
      p.spin = 0;
      if (def.shellReload) p.shellNext = t + def.shellReload.start;
      else p.reloadEnd = t + def.reload;
      this.emit({ type: 'reload', pid: p.id, weapon: def.id, duration: def.shellReload ? def.shellReload.start + def.shellReload.each * (def.clip - w.clip) : def.reload });
    }

    // Scope, or the Glock and FAMAS burst switch.
    const altPressed = cmd.alt && !p.altHeld;
    p.altHeld = !!cmd.alt;
    if (def.burst && altPressed && t >= p.deployEnd) {
      w.burst = !w.burst;
      this.emit({ type: 'burstMode', pid: p.id, weapon: def.id, on: w.burst });
    }
    if (def.zoomLevels && altPressed && !p.reloading && t >= p.deployEnd) {
      p.zoom = (p.zoom + 1) % (def.zoomLevels.length + 1);
      p.resumeZoomAt = 0;
      this.emit({ type: 'zoom', pid: p.id, zoom: p.zoom });
    }
    if (p.resumeZoomAt && t >= p.resumeZoomAt) {
      p.zoom = p.resumeZoom; p.resumeZoomAt = 0;
    }

    // Minigun spin.
    if (def.spinUp) {
      if (cmd.fire && !p.reloading && t >= p.deployEnd) p.spin = Math.min(def.spinUp, p.spin + dt);
      else p.spin = Math.max(0, p.spin - dt * 0.6);
    }

    // The rest of a burst fires on its own, one round per gap.
    if (p.burstLeft > 0) {
      p.fireHeld = !!cmd.fire;
      if (t < p.burstNext) return;
      if (w.clip <= 0 || p.reloading) { p.burstLeft = 0; return; }
      p.burstLeft--;
      this.fire(p, w, def, true);
      return;
    }

    // Fire.
    const firePressed = cmd.fire && !p.fireHeld;
    p.fireHeld = !!cmd.fire;
    const trigger = def.auto ? cmd.fire : firePressed;
    if (trigger && t >= p.nextAttack && t >= p.deployEnd && !(p.reloading && !def.shellReload)) {
      if (def.spinUp && p.spin < def.spinUp) return;
      if (w.clip <= 0) {
        if (firePressed || def.auto) {
          this.emit({ type: 'dry', pid: p.id });
          p.nextAttack = t + 0.25;
        }
        return;
      }
      this.fire(p, w, def);
    }
  }

  // Knife: Mouse 2 stabs, Mouse 1 slashes; both repeat while held (CS
  // checks the stab first).
  updateMelee(p, cmd, def) {
    const t = this.time;
    p.fireHeld = !!cmd.fire;
    p.altHeld = !!cmd.alt;
    p.reloading = false;
    if (t < p.deployEnd) return;
    if (cmd.alt && t >= p.nextStab) this.melee(p, def, 'stab');
    else if (cmd.fire && t >= p.nextAttack) this.melee(p, def, 'slash');
  }

  // Grenades, CS style: press fire (or Mouse 2) to pull the pin, let go to
  // throw (Mouse 2 lobs it underhand). Once it's gone your last gun comes
  // back, or the next one of the same kind (a second flashbang).
  updateGrenade(p, cmd, def, w) {
    const t = this.time;
    p.fireHeld = !!cmd.fire;
    p.altHeld = !!cmd.alt;
    p.reloading = false;
    if (p.nadeRedrawAt) {
      // Thrown: wait for the throw to finish.
      if (t < p.nadeRedrawAt) return;
      p.nadeRedrawAt = 0;
      if (w.clip > 0) { this.switchTo(p, p.active, true); return; }
      p.weapons[p.active] = null;
      const back = !NADE_SLOTS.includes(p.lastActive) && p.weapons[p.lastActive] ? p.lastActive : SLOTS.find((s) => p.weapons[s]);
      this.switchTo(p, back ?? 'melee', true);
      return;
    }
    if (w.clip <= 0) return;
    if (t < p.deployEnd) return;
    if (!p.nadePin) {
      if ((cmd.fire || cmd.alt) && t >= p.nextAttack) {
        p.nadePin = t;
        p.nadeLob = !cmd.fire;
        this.emit({ type: 'pin', pid: p.id });
      }
      return;
    }
    if (cmd.fire || cmd.alt) return; // cooking: hold as long as you like
    if (t < p.nadePin + NADE_PIN_TIME) return; // let go early: it leaves once the pin is out
    this.throwGrenade(p, w, def);
  }

  throwGrenade(p, w, def) {
    const t = this.time;
    const g = def.grenade;
    // CS 1.6 CHEGrenade::WeaponIdle: the throw aims 10 degrees above where
    // you look, and the harder you look up the slower it goes.
    let a = -p.pitch / DEG; // CS pitch: negative is up
    a = a < 0 ? -10 + a * (80 / 90) : -10 + a * (100 / 90);
    let speed = Math.min(g.maxSpeed, (90 - a) * g.throwMul) * U;
    if (p.nadeLob) speed *= g.lobMul;
    const dir = aimDir(p.yaw, -a * DEG);
    const eye = this.eyePos(p);
    // Starts 16 units ahead of the eyes, or just short of a wall you're hugging.
    let lead = 16 * U;
    const h = this.world.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], lead + NADE_RADIUS);
    if (h) lead = Math.max(0, h.t - NADE_RADIUS * 2);
    const pos = [eye[0] + dir[0] * lead, eye[1] + dir[1] * lead, eye[2] + dir[2] * lead];
    this.nades.push({
      id: this.nextNadeId++, owner: p.id, team: p.team, weapon: def.id,
      pos, prevPos: [...pos],
      vel: [dir[0] * speed + p.vel[0], dir[1] * speed + p.vel[1], dir[2] * speed + p.vel[2]],
      explodeAt: t + (g.fuse ?? NADE_FUSE), rest: false, lastBounce: -1,
    });
    w.clip--;
    p.nadePin = 0;
    p.lastFire = t;
    p.nextAttack = t + NADE_SWITCH_TIME;
    p.nadeRedrawAt = t + NADE_SWITCH_TIME;
    this.emit({ type: 'throw', pid: p.id, lob: p.nadeLob, weapon: def.id });
  }

  // Grenades fly with low gravity, bounce off walls and floors, roll to a
  // stop, and go off when the fuse runs out.
  updateNades(dt) {
    if (!this.nades.length) return;
    const g = GRAVITY * NADE_GRAVITY;
    for (const n of this.nades) {
      n.prevPos[0] = n.pos[0]; n.prevPos[1] = n.pos[1]; n.prevPos[2] = n.pos[2];
      if (this.time >= n.explodeAt && this.readyToPop(n)) { n.done = true; this.explodeNade(n); continue; }
      if (n.rest) continue;
      const v = n.vel;
      v[1] -= g * dt;
      // Water slows it right down; it sinks to the bottom.
      if (this.underwater(n.pos[0], n.pos[1], n.pos[2])) {
        const k = Math.max(0, 1 - dt * 4);
        v[0] *= k; v[1] *= k; v[2] *= k;
      }
      let left = dt;
      for (let i = 0; i < 3 && left > 1e-6; i++) {
        const sp = Math.hypot(v[0], v[1], v[2]);
        if (sp < 1e-4) break;
        const dir = [v[0] / sp, v[1] / sp, v[2] / sp];
        const step = sp * left;
        const h = this.world.raycast(n.pos[0], n.pos[1], n.pos[2], dir[0], dir[1], dir[2], step + NADE_RADIUS);
        if (!h) { n.pos[0] += v[0] * left; n.pos[1] += v[1] * left; n.pos[2] += v[2] * left; break; }
        const go = Math.max(0, h.t - NADE_RADIUS);
        n.pos[0] += dir[0] * go; n.pos[1] += dir[1] * go; n.pos[2] += dir[2] * go;
        left -= go / sp;
        const nn = h.normal;
        const vn = v[0] * nn[0] + v[1] * nn[1] + v[2] * nn[2];
        if (vn >= 0) break;
        // Bounce: reflect, lose energy, and drag along the surface.
        for (let k = 0; k < 3; k++) v[k] = (v[k] - (1 + NADE_BOUNCE) * vn * nn[k]) * 0.8;
        if (-vn > 1.5 && this.time - n.lastBounce > 0.08) {
          n.lastBounce = this.time;
          this.emit({ type: 'nadeBounce', id: n.id, pos: [...n.pos], weapon: n.weapon });
        }
        if (nn[1] > 0.7 && Math.hypot(v[0], v[1], v[2]) < 0.6) { v[0] = v[1] = v[2] = 0; n.rest = true; break; }
      }
      // Rolling along a floor slows it down.
      if (!n.rest && this.world.overlaps(n.pos[0] - 0.01, n.pos[1] - NADE_RADIUS - 0.02, n.pos[2] - 0.01, n.pos[0] + 0.01, n.pos[1], n.pos[2] + 0.01)) {
        const k = Math.max(0, 1 - dt * 3);
        v[0] *= k; v[2] *= k;
        if (Math.abs(v[1]) < 0.3) v[1] = Math.max(0, v[1]);
        if (Math.hypot(v[0], v[2]) < 0.15 && Math.abs(v[1]) < 0.3) { v[0] = v[1] = v[2] = 0; n.rest = true; }
      }
      if (n.pos[1] < -20) n.done = true;
    }
    this.nades = this.nades.filter((n) => !n.done);
  }

  // A smoke grenade waits until it has stopped rolling (or a few seconds
  // more at most); the others go off when the fuse runs out.
  readyToPop(n) {
    if (WEAPONS[n.weapon]?.grenade.kind !== 'smoke') return true;
    return n.rest || Math.hypot(n.vel[0], n.vel[1], n.vel[2]) < 0.4 || this.time >= n.explodeAt + SMOKE_MAX_WAIT;
  }

  // How much of a smoke cloud is there at time t: grows in over SMOKE_GROW,
  // thins out over the last SMOKE_FADE seconds. 0..1.
  smokeAmount(s, t = this.time) {
    if (t < s.start || t >= s.end) return 0;
    return Math.min(1, (t - s.start) / SMOKE_GROW, (s.end - t) / SMOKE_FADE);
  }

  updateSmokes() {
    if (this.smokes.length) this.smokes = this.smokes.filter((s) => this.time < s.end);
  }

  // Does smoke block the line from a to b? The cloud is a squashed sphere
  // (SMOKE_HEIGHT tall), thick enough to hide behind once it's mostly in.
  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      const k = this.smokeAmount(s);
      if (k < 0.35) continue;
      const r = s.radius * Math.min(1, 0.5 + k);
      const sy = (r * 2) / SMOKE_HEIGHT; // scale y so the cloud is a sphere
      const cx = s.pos[0], cy = s.pos[1] + SMOKE_HEIGHT * 0.4, cz = s.pos[2];
      const dx = bx - ax, dy = (by - ay) * sy, dz = bz - az;
      const fx = ax - cx, fy = (ay - cy) * sy, fz = az - cz;
      const a = dx * dx + dy * dy + dz * dz;
      if (a < 1e-9) continue;
      const tt = Math.max(0, Math.min(1, -(fx * dx + fy * dy + fz * dz) / a));
      const qx = fx + dx * tt, qy = fy + dy * tt, qz = fz + dz * tt;
      if (qx * qx + qy * qy + qz * qz < r * r * 0.8) return true;
    }
    return false;
  }

  // CS 1.6 RadiusDamage: full damage at the blast, falling off linearly to
  // nothing at the radius, only to players the blast can see. Hurts enemies
  // and the thrower, not teammates.
  explodeNade(n) {
    const def = WEAPONS[n.weapon];
    const kind = def.grenade.kind;
    if (kind === 'flash') { this.popFlash(n, def); return; }
    if (kind === 'smoke') { this.popSmoke(n, def); return; }
    const owner = this.getPlayer(n.owner) ?? null;
    const src = [n.pos[0], n.pos[1] + 0.12, n.pos[2]];
    this.emit({ type: 'nadeExplode', pid: n.owner, pos: src, water: this.underwater(src[0], src[1], src[2]) });
    const radius = def.grenade.radius;
    for (const v of this.players) {
      if (!v.alive) continue;
      if (v.id !== n.owner && v.team === n.team && v.team !== 'ffa') continue;
      const mid = [v.pos[0], v.pos[1] + (v.ducked ? 0.6 : 0.9), v.pos[2]];
      const head = this.eyePos(v);
      const dist = Math.hypot(mid[0] - src[0], mid[1] - src[1], mid[2] - src[2]);
      const dmg = def.damage * (1 - dist / U / radius);
      if (dmg <= 0) continue;
      const w = this.world;
      if (!w.visible(src[0], src[1], src[2], mid[0], mid[1], mid[2]) && !w.visible(src[0], src[1], src[2], head[0], head[1], head[2])) continue;
      const d = dist > 1e-3 ? [(mid[0] - src[0]) / dist, (mid[1] - src[1]) / dist, (mid[2] - src[2]) / dist] : [0, 1, 0];
      this.damage(v, owner, dmg, 'chest', mid, def, false, d, src);
    }
  }

  // CS 1.6 RadiusFlash: everyone who can see the bang goes white, more so
  // the closer they are and the more directly they're looking at it.
  popFlash(n, def) {
    const g = def.grenade;
    const src = [n.pos[0], n.pos[1] + 0.1, n.pos[2]];
    const water = this.underwater(src[0], src[1], src[2]);
    this.emit({ type: 'flashPop', pid: n.owner, pos: src, water });
    if (water) return; // a flashbang under water is just a dull thud
    for (const v of this.players) {
      if (!v.alive) continue;
      const eye = this.eyePos(v);
      const dx = src[0] - eye[0], dy = src[1] - eye[1], dz = src[2] - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      const strength = g.strength * (1 - dist / U / g.radius);
      if (strength <= 0) continue;
      if (!this.world.visible(src[0], src[1], src[2], eye[0], eye[1], eye[2])) continue;
      if (this.smokeBlocks(src[0], src[1], src[2], eye[0], eye[1], eye[2])) continue;
      const f = aimDir(v.yaw, v.pitch);
      const dot = dist > 1e-3 ? (dx * f[0] + dy * f[1] + dz * f[2]) / dist : 1;
      let hold, fade, alpha;
      if (dot >= 0.55) { hold = strength / 1.5; fade = strength * 3; alpha = 1; }
      else if (dot >= 0.15) { hold = strength / 3.5; fade = strength * 1.75; alpha = 0.8; }
      else { hold = strength / 4.5; fade = strength; alpha = 0.8; }
      // A weaker flash doesn't cut short a stronger one still on screen.
      if (alpha < blindLevel(v, this.time)) continue;
      v.blindStart = this.time; v.blindHold = hold; v.blindFade = fade; v.blindAlpha = alpha;
      this.emit({ type: 'blind', pid: v.id, by: n.owner, hold, fade, alpha });
    }
  }

  popSmoke(n, def) {
    const g = def.grenade;
    const pos = [n.pos[0], n.pos[1] - 0.05, n.pos[2]];
    const s = { id: n.id, pos, start: this.time, end: this.time + g.duration, radius: g.radius * U };
    this.smokes.push(s);
    if (this.smokes.length > 16) this.smokes.shift();
    this.emit({ type: 'smokePop', pid: n.owner, pos, id: s.id });
  }

  melee(p, def, kind) {
    const t = this.time;
    const m = def.melee[kind];
    const yaw = p.yaw + p.punch[1] * DEG;
    const fwd = aimDir(yaw, p.pitch + p.punch[0] * DEG);
    const right = rightVec(yaw);
    const up = cross(right, fwd);
    const origin = this.eyePos(p);
    const restore = this.lagComp ? this.lagComp(p) : null;
    const res = traceMelee(this.world, this.players, p, origin, fwd, right, up, m.range);
    if (restore) restore();

    const hit = !!res;
    let dmg = 0, backstab = false;
    if (res?.victim) {
      // CS: a slash after a pause hits harder than one in a quick combo.
      dmg = kind === 'slash' && p.nextAttack + 0.4 < t ? m.firstDamage : m.damage;
      if (kind === 'stab') {
        const v = res.victim, vf = forwardVec(v.yaw);
        const lx = v.pos[0] - p.pos[0], lz = v.pos[2] - p.pos[2], l = Math.hypot(lx, lz) || 1;
        if ((lx * vf[0] + lz * vf[2]) / l > 0.8) { dmg *= m.backstabMul; backstab = true; }
      }
    }
    this.emit({
      type: 'melee', pid: p.id, kind, hit: res?.victim ? 'flesh' : res?.wall ? 'wall' : null, backstab,
      pos: res?.victim ? res.point : res?.wall?.pos ?? null, normal: res?.wall?.normal ?? null, material: res?.wall?.material ?? null,
    });
    if (res?.victim) this.damage(res.victim, p, dmg, res.group, res.point, def, false, fwd);

    if (kind === 'slash') {
      p.nextAttack = t + (hit ? m.hitCycle : m.missCycle);
      p.nextStab = Math.max(p.nextStab, t + m.altDelay);
    } else {
      p.nextAttack = p.nextStab = t + (hit ? m.hitCycle : m.missCycle);
    }
    p.lastFire = t;
    p.lastMelee = t;
  }

  // burstShot: a follow-up round of a burst (the trigger isn't pulled).
  fire(p, w, def, burstShot = false) {
    const t = this.time;
    p.reloading = false;
    w.clip--;

    const state = this.moveState(p, def);
    const spread = this.currentSpread(p, def, state);
    if (def.burst && w.burst && !burstShot) p.burstLeft = Math.min(def.burst.shots - 1, w.clip);

    // Update the accuracy state for the next shot.
    const acc = def.accuracy;
    if (acc.type === 'rifle') {
      p.delayFire = true;
      p.accuracy = this.rifleAccuracy(p, acc);
    } else if (acc.type === 'pistol') {
      p.pistolAcc = this.nextPistolAcc(p, acc);
    }
    p.shotsFired++;
    p.lastFire = t;
    const rand = shotRng(p.id, p.shotSeed++);

    // Fire direction = view angles + punch (like GoldSrc).
    const yaw = p.yaw + p.punch[1] * DEG;
    const pitch = p.pitch + p.punch[0] * DEG;
    const fwd = aimDir(yaw, pitch);
    const right = rightVec(yaw);
    const up = cross(right, fwd);
    const origin = this.eyePos(p);

    if (this.replaying) {
      this.kick(p, def, state, rand);
      this.afterShot(p, def);
      return;
    }

    const pellets = def.pellets ?? 1;
    const ends = [];
    const impacts = [];
    const hitsByVictim = new Map();
    // Predicting (online, our own shot): others are already drawn where we
    // saw them, so there's nothing to rewind.
    const restore = this.lagComp && !this.predicting ? this.lagComp(p) : null;
    for (let i = 0; i < pellets; i++) {
      let x, y;
      if (def.pellets) {
        x = (rand() - 0.5 + rand() - 0.5) * def.pelletSpread * 2;
        y = (rand() - 0.5 + rand() - 0.5) * def.pelletSpread * 2;
      } else {
        x = (rand() - 0.5 + rand() - 0.5) * spread;
        y = (rand() - 0.5 + rand() - 0.5) * spread;
      }
      const d = norm([fwd[0] + x * right[0] + y * up[0], fwd[1] + x * right[1] + y * up[1], fwd[2] + x * right[2] + y * up[2]]);
      const res = traceBullet(this.world, this.players, p, origin, d, def, (victim, dmg, group, point, wallbang) => {
        const hits = hitsByVictim.get(victim) ?? [];
        hits.push({ dmg, group, point, wallbang });
        hitsByVictim.set(victim, hits);
      });
      ends.push(res.end);
      for (const im of res.impacts) impacts.push(im);
    }
    if (restore) restore();

    this.emit({ type: 'shot', pid: p.id, weapon: def.id, origin, dir: fwd, ends, impacts, side: def.dual ? p.shotSeed & 1 : undefined, burst: w?.burst ? true : undefined });

    // Only the server (or practice) decides hits.
    if (!this.predicting) {
      for (const [victim, hits] of hitsByVictim) {
        for (const h of hits) {
          if (!victim.alive) break;
          this.damage(victim, p, h.dmg, h.group, h.point, def, h.wallbang, fwd);
        }
      }
    }

    this.kick(p, def, state, rand);
    this.afterShot(p, def);
  }

  afterShot(p, def) {
    const t = this.time;
    const w = p.weapons[p.active];
    if (def.burst && w?.burst) {
      // Mid-burst: the next round comes after the gap; after the last one
      // the gun waits out the burst cycle.
      if (p.burstLeft > 0) { p.burstNext = t + def.burst.gap; p.nextAttack = t + def.burst.gap; }
      else p.nextAttack = t + def.burst.cycle;
      return;
    }
    // Fire rate: keep the cadence exact across 128 Hz ticks.
    if (t - p.nextAttack > TICK_DT * 1.5) p.nextAttack = t;
    p.nextAttack += def.scopedCycle && p.zoom > 0 ? def.scopedCycle : def.cycle;

    if (def.bolt && p.zoom > 0) {
      // AWP, Scout: drop out of scope while cycling the bolt, then go back in.
      p.resumeZoom = p.zoom;
      p.zoom = 0;
      p.resumeZoomAt = p.nextAttack - 0.05;
    }
  }

  moveState(p, def) {
    const hspeed = Math.hypot(p.vel[0], p.vel[2]) / U;
    if (p.swimming) return 'run'; // treading water: shaky, but not a jump
    if (!p.onGround) return 'air';
    if (hspeed > def.runThreshold) return 'run';
    if (p.ducked) return 'duck';
    return 'stand';
  }

  rifleAccuracy(p, acc) {
    // First shot is the most accurate; it gets worse as the spray goes on.
    // CS 1.6 divides whole numbers here (shots^3 / 200 for the AK), which
    // rounds down: the first few bullets of a burst stay just as tight, then
    // the spread jumps. Only the MP5 divides by 220.1 and grows smoothly.
    const n = p.shotsFired;
    if (n === 0) return Math.min(0.2, acc.offset);
    const q = Math.pow(n, acc.pow) / acc.div;
    return Math.min(acc.max, (Number.isInteger(acc.div) ? Math.floor(q) : q) + acc.offset);
  }

  nextPistolAcc(p, acc, now = this.time) {
    // Pistol accuracy recovers with time between shots.
    const since = now - p.lastFire;
    const a = p.pistolAcc - (acc.window - since) * acc.loss;
    return Math.max(acc.min, Math.min(acc.start, a));
  }

  // Spread (CS 1.6 formulas) the next shot would have. Pure: used by fire()
  // and by the client's dynamic crosshair.
  // now: the clock p's gun runs on (online, our own gun runs ahead of the
  // server's clock; see OnlineSession.predTime).
  currentSpread(p, def, state = this.moveState(p, def), now = this.time) {
    const acc = def.accuracy;
    if (def.pellets) return def.pelletSpread;
    if (acc.type === 'rifle') {
      const w = p.weapons[p.active];
      const s = (def.burst && w?.burst ? def.burst.spread : def.spread)[state];
      return s[0] + s[1] * this.rifleAccuracy(p, acc);
    }
    if (acc.type === 'pistol') {
      const w = p.weapons[p.active];
      const s = (def.burst && w?.burst ? def.burst.spread : def.spread)[state];
      return s[0] + s[1] * (1 - this.nextPistolAcc(p, acc, now));
    }
    if (acc.type === 'sniper') {
      const sp = def.sniperSpread;
      const hspeed = Math.hypot(p.vel[0], p.vel[2]) / U;
      let spread;
      if (state === 'air') spread = sp.air;
      else if (hspeed > (sp.runSpeed ?? 140)) spread = sp.run;
      else if (sp.walk !== undefined && hspeed > 10) spread = sp.walk;
      else if (p.ducked) spread = sp.duck;
      else spread = sp.stand;
      return spread + (p.zoom === 0 ? sp.unscoped : 0);
    }
    if (acc.type === 'autosniper') {
      const sp = def.autoSpread;
      const a = Math.min(0.98, acc.base + acc.rate * (now - p.lastFire));
      const hspeed = Math.hypot(p.vel[0], p.vel[2]) / U;
      let spread;
      if (state === 'air') spread = sp.air * (1 - a);
      else if (hspeed > 10) spread = sp.run;
      else if (p.ducked) spread = sp.duck * (1 - a);
      else spread = sp.stand * (1 - a);
      return spread + (p.zoom === 0 ? sp.unscoped : 0);
    }
    return 0;
  }

  kick(p, def, state, rand = this.rand) {
    const k = def.kick;
    // Same pattern shape as CS 1.6, all of it scaled by RECOIL_SCALE.
    const R = RECOIL_SCALE;
    if (k.punch) {
      const range = state === 'air' && k.airPunch ? k.airPunch : k.punch;
      // Auto snipers: part of the punch still on screen adds to the next
      // one, and it kicks a little to either side (CS G3SG1/SG550).
      const carry = k.punchCarry ? p.punch[0] * k.punchCarry : 0;
      p.punch[0] += (range[0] + rand() * (range[1] - range[0])) * R + carry;
      if (k.punchSide) p.punch[1] += (rand() * 2 - 1) * k.punchSide * R;
      return;
    }
    let [upBase, latBase, upMod, latMod, upMax, latMax, dirChange] = k[state];
    upMax *= R; latMax *= R;
    const s = def.kickScale * R;
    let front, side;
    if (p.shotsFired === 1) { front = upBase; side = latBase; }
    else { front = p.shotsFired * upMod + upBase; side = p.shotsFired * latMod + latBase; }
    front *= s; side *= s;
    p.punch[0] += front;
    if (p.punch[0] > upMax) p.punch[0] = upMax;
    if (p.recoilDir > 0) {
      p.punch[1] += side;
      if (p.punch[1] > latMax) p.punch[1] = latMax;
    } else {
      p.punch[1] -= side;
      if (p.punch[1] < -latMax) p.punch[1] = -latMax;
    }
    if (Math.floor(rand() * (dirChange + 1)) === 0) p.recoilDir = -p.recoilDir;
  }

  // from: where the damage came from, for the hurt indicator (the attacker,
  // or a grenade's blast).
  damage(victim, attacker, raw, group, point, def, wallbang, dir, from = null) {
    // Nobody can be hurt while frozen at the start or end of a match, or in
    // admin god mode.
    if (this.frozen(victim) || victim.god) return;
    const { damage, armorHit } = computeDamage(victim, raw, group, def);
    victim.health -= damage;
    victim.tagMul = TAG_SPEED_MUL;
    victim.lastHitDir = dir;
    victim.lastAttacker = attacker?.id ?? null;
    victim.lastHurtTime = this.time;
    // Aim punch, CS 1.6 CBasePlayer::TraceAttack: a hit to the head or body
    // snaps your view up (0.5 or 0.1 degrees per point of damage, capped at 12
    // and 4). It replaces the current punch rather than adding to it, so
    // taking several hits doesn't keep shoving your aim higher. Arms and legs
    // don't flinch, and neither does a grenade blast.
    const hitDmg = raw * (HITGROUP_MUL[group] ?? 1);
    if (def.grenade) { /* blasts don't flinch your aim */ }
    else if (group === 'head') victim.punch[0] = Math.min(12, hitDmg * 0.5);
    else if (group === 'chest' || group === 'stomach') victim.punch[0] = Math.min(4, hitDmg * 0.1);
    this.emit({
      type: 'hit', attacker: attacker?.id, victim: victim.id, damage, group, pos: point,
      armorHit, wallbang, weapon: def.id, from: from ? [...from] : attacker ? [...attacker.pos] : null,
    });
    if (victim.health <= 0) {
      victim.health = 0;
      this.kill(victim, attacker, def, group === 'head', wallbang);
    }
  }

  // cause: 'bomb' for the bomb going off.
  kill(victim, attacker, def, headshot, wallbang, cause = null) {
    victim.alive = false;
    // Someone playing a bot: the death is the bot's.
    this.scorer(victim).deaths++;
    // Objective rounds: one life per round.
    victim.respawnAt = this.objective ? NEVER : this.time + RESPAWN_TIME;
    victim.reloading = false;
    victim.zoom = 0;
    victim.nadePin = 0;
    victim.nadeRedrawAt = 0;
    victim.burstLeft = 0;
    victim.blindAlpha = 0;
    victim.swimming = false;
    if (this.objective) {
      if (victim.task?.kind === 'defuse') this.bomb.defuser = null;
      victim.task = null;
      Obj.dropBomb(this, victim);
      Obj.releaseHostages(this, victim);
    }
    let reward = 0, multi = 0;
    const credit = this.scorer(attacker);
    if (attacker && attacker !== victim) {
      credit.kills++;
      if (headshot) credit.headshots++;
      reward = this.killReward(attacker);
      attacker.roundKills++;
      attacker.money = Math.min(MAX_MONEY, attacker.money + reward);
      if (attacker.team in this.teamKills && this.match.state === 'live') this.teamKills[attacker.team]++;
      multi = attacker.multi = this.time - attacker.lastKillAt <= MULTI_KILL_WINDOW ? attacker.multi + 1 : 1;
      attacker.lastKillAt = this.time;
    }
    this.emit({
      type: 'kill', attacker: attacker?.id ?? null, victim: victim.id, weapon: def?.id ?? null,
      as: credit && credit !== attacker ? credit.id : null, victimAs: victim.controlling ?? null,
      headshot, wallbang, dir: victim.lastHitDir, cause, reward, multi,
    });
    // The body vanishes and its best gun stays on the ground (CS drops the
    // primary, or the pistol if there's no primary).
    const slot = victim.weapons.primary ? 'primary' : victim.weapons.secondary ? 'secondary' : null;
    if (slot) this.dropWeapon(victim, slot, false);
    // The bot's body died: it stays dead, and gets its money back.
    if (victim.controlling) this.releaseBot(victim);

    if (attacker && attacker !== victim && this.match.state === 'live' && !this.objective) {
      if (this.mode === 'teams') {
        if (this.teamKills[attacker.team] >= TEAM_KILL_LIMIT) this.endMatch(null, attacker.team);
      } else if (attacker.kills >= FFA_KILL_LIMIT) {
        this.endMatch(attacker, null);
      }
    }
  }

  // Money for p's next kill: flat in free for all; in teams it grows with each
  // kill p has made this round (this life, in team deathmatch).
  killReward(p) {
    if (this.mode !== 'teams') return FFA_KILL_REWARD;
    return Math.min(KILL_REWARD_MAX, KILL_REWARD + KILL_STREAK_STEP * p.roundKills);
  }

  // Helpers used by bots and the client.
  forward(p) { return forwardVec(p.yaw); }

  // Headshot kills as a share of all kills, 0-100.
  static hsPercent(p) {
    return p.kills ? Math.round((p.headshots / p.kills) * 100) : 0;
  }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
