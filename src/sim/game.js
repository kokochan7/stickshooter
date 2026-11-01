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
} from './constants.js';
import { WEAPONS, GEAR } from './weapons.js';
import { World } from './world.js';
import { movePlayer, aimDir, forwardVec, rightVec } from './movement.js';
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

function makeWeapon(id) {
  const def = WEAPONS[id];
  return { id, clip: def.clip, reserve: def.reserve };
}

// Slots in the order the number keys use them: 1 primary, 2 pistol, 3 knife.
export const SLOTS = ['primary', 'secondary', 'melee'];

// Small seeded RNG so a server and clients could agree on spread later.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(map, { seed = Date.now(), mode = 'ffa' } = {}) {
    this.mode = MODES.includes(mode) ? mode : 'ffa';
    this.setMap(map);
    this.players = [];
    this.time = 0;
    this.tickCount = 0;
    this.events = [];
    this.rand = mulberry32(seed >>> 0);
    this.nextId = 1;
    // Optional lag compensation: (shooter) => restore(). The server sets this to
    // rewind other players to what the shooter saw while their bullets trace.
    this.lagComp = null;
    // Guns lying on the ground: { id, weapon: { id, clip, reserve }, pos, vel,
    // yaw, rest, expiresAt, noPickup: { pid, until } }.
    this.drops = [];
    this.nextDropId = 1;
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
    this.objective = Obj.objectiveFor(this.mode, map);
    if (this.round) { this.round = Obj.emptyRound(); this.bomb = Obj.emptyBomb(); this.hostages = []; }
  }

  // Bots and hostages find their way with this; built on first use.
  get nav() {
    if (!this._nav) this._nav = new NavGrid(this.world, this.map.bounds);
    return this._nav;
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
      weapons: { primary: null, secondary: null, melee: null }, active: 'secondary', lastActive: 'primary',
      loadout: { primary: null, secondary: 'usp', armor: null },
      nextAttack: 0, deployEnd: 0, reloading: false, reloadEnd: 0, shellNext: 0,
      shotsFired: 0, decreaseShotsAt: 0, delayFire: false, pistolAcc: 0.9, accuracy: 0.2, lastFire: -10,
      punch: [0, 0], prevPunch: [0, 0], recoilDir: 1,
      zoom: 0, resumeZoomAt: 0, resumeZoom: 0,
      spin: 0, fireHeld: false, altHeld: false, reloadHeld: false,
      tagMul: 1, lastHitDir: null, lastAttacker: null, lastHurtTime: -10,
      nextStab: 0, lastMelee: -10, frozenUntil: 0, life: 0,
      task: null, useHeld: false, defuser: false,
      roundKills: 0, multi: 0, lastKillAt: -10, god: false,
    };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    const p = this.getPlayer(id);
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
    for (const p of this.players) { p.kills = 0; p.deaths = 0; p.headshots = 0; p.money = START_MONEY; }
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

  emit(e) {
    e.time = this.time;
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- Spawning / buying ----------

  spawn(p) {
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
    p.pos = [...best.pos];
    p.prevPos = [...best.pos];
    p.vel = [0, 0, 0];
    p.yaw = best.yaw;
    p.pitch = 0;
    p.alive = true;
    p.health = MAX_HEALTH;
    // A new life (and in objective rounds, a new round) restarts the kill
    // money streak and the multi-kill chain.
    p.roundKills = 0;
    p.multi = 0;
    p.armor = 0; p.helmet = false;
    p.ducked = false; p.duckAmount = 0; p.onGround = true;
    p.weapons = { primary: null, secondary: makeWeapon('usp'), melee: makeWeapon('knife') };
    p.active = 'secondary';
    p.life++;
    p.punch = [0, 0]; p.prevPunch = [0, 0];
    p.zoom = 0; p.spin = 0; p.reloading = false; p.shotsFired = 0;
    p.tagMul = 1;
    p.task = null; p.defuser = false;
    p.deployEnd = this.time + 0.3; p.nextAttack = this.time + 0.3; p.nextStab = this.time + 0.3;
    if (this.match.state === 'over') p.frozenUntil = this.match.endsAt + 1;

    // Re-buy the last loadout (practice convenience).
    const lo = p.loadout;
    if (lo.secondary && lo.secondary !== 'usp') this.buy(p, lo.secondary, true);
    if (lo.armor) this.buy(p, lo.armor, true);
    if (lo.primary) this.buy(p, lo.primary, true);
    if (lo.defuser) this.buy(p, 'defuser', true);
    this.emit({ type: 'spawn', pid: p.id, yaw: p.yaw }); // yaw: cmds later in the tick overwrite p.yaw
  }

  buy(p, item, silent = false) {
    if (!p.alive) return false;
    if (item === 'defuser') {
      // Defuse kit: Blue only, in bomb rounds.
      if (p.defuser || p.team !== 'blue' || this.objective !== 'bomb' || p.money < GEAR.defuser.price) return false;
      p.money -= GEAR.defuser.price;
      p.defuser = true;
      p.loadout.defuser = true;
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
      p.loadout.armor = item;
      if (!silent) this.emit({ type: 'buy', pid: p.id, item });
      return true;
    }
    const def = WEAPONS[item];
    if (!def) return false;
    const cur = p.weapons[def.slot];
    if (cur && cur.id === item) {
      // Already have it: buying again refills ammo for free-ish.
      cur.reserve = def.reserve;
      return false;
    }
    if (p.money < def.price) return false;
    p.money -= def.price;
    p.weapons[def.slot] = makeWeapon(item);
    p.loadout[def.slot] = item;
    this.switchTo(p, def.slot, true);
    if (!silent) this.emit({ type: 'buy', pid: p.id, item });
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
        if (cmd.actions) for (const a of cmd.actions) if (a.type === 'team') this.handleAction(p, a);
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
    movePlayer(this.world, p, cmd, dt, speed * U);
    // Smooth stair steps for the camera.
    p.stepOffset *= Math.max(0, 1 - dt * 14);
  }

  handleAction(p, a) {
    if (a.type === 'buy') this.buy(p, a.item);
    else if (a.type === 'team') this.setTeam(p, a.team);
    else if (a.type === 'drop') this.dropWeapon(p, p.active, true);
    else if (a.type === 'pickup') this.pickup(p, a.id);
  }

  // ---------- Dropped guns ----------

  // Take the gun out of a slot and put it on the ground. Thrown forward when
  // dropped on purpose (G), or falls where you stood when you die. The knife
  // never drops. Returns the drop or null.
  dropWeapon(p, slot, thrown, { switchAway = true } = {}) {
    const w = p.weapons[slot];
    if (!w || WEAPONS[w.id].melee) return null;
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
      expiresAt: this.time + DROP_LIFETIME, noPickup: { pid: p.id, until: this.time + 0.8 },
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

    // Weapon switching.
    if (cmd.slot && p.weapons[cmd.slot] && cmd.slot !== p.active) this.switchTo(p, cmd.slot);
    if (cmd.lastWeapon && p.weapons[p.lastActive]) this.switchTo(p, p.lastActive);

    const w = this.activeWeapon(p);
    if (!w) return;
    const def = WEAPONS[w.id];
    if (def.melee) { this.updateMelee(p, cmd, def); return; }

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

    // Scope.
    const altPressed = cmd.alt && !p.altHeld;
    p.altHeld = !!cmd.alt;
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

  fire(p, w, def) {
    const t = this.time;
    p.reloading = false;
    w.clip--;

    const state = this.moveState(p, def);
    const spread = this.currentSpread(p, def, state);

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

    // Fire direction = view angles + punch (like GoldSrc).
    const yaw = p.yaw + p.punch[1] * DEG;
    const pitch = p.pitch + p.punch[0] * DEG;
    const fwd = aimDir(yaw, pitch);
    const right = rightVec(yaw);
    const up = cross(right, fwd);
    const origin = this.eyePos(p);

    const pellets = def.pellets ?? 1;
    const ends = [];
    const impacts = [];
    const hitsByVictim = new Map();
    const restore = this.lagComp ? this.lagComp(p) : null;
    for (let i = 0; i < pellets; i++) {
      let x, y;
      if (def.pellets) {
        x = (this.rand() - 0.5 + this.rand() - 0.5) * def.pelletSpread * 2;
        y = (this.rand() - 0.5 + this.rand() - 0.5) * def.pelletSpread * 2;
      } else {
        x = (this.rand() - 0.5 + this.rand() - 0.5) * spread;
        y = (this.rand() - 0.5 + this.rand() - 0.5) * spread;
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

    this.emit({ type: 'shot', pid: p.id, weapon: def.id, origin, dir: fwd, ends, impacts });

    for (const [victim, hits] of hitsByVictim) {
      for (const h of hits) {
        if (!victim.alive) break;
        this.damage(victim, p, h.dmg, h.group, h.point, def, h.wallbang, fwd);
      }
    }

    this.kick(p, def, state);

    // Fire rate: keep the cadence exact across 128 Hz ticks.
    if (t - p.nextAttack > TICK_DT * 1.5) p.nextAttack = t;
    p.nextAttack += def.cycle;

    if (def.zoomLevels && p.zoom > 0) {
      // AWP: drop out of scope while cycling the bolt, then go back in.
      p.resumeZoom = p.zoom;
      p.zoom = 0;
      p.resumeZoomAt = p.nextAttack - 0.05;
    }
  }

  moveState(p, def) {
    const hspeed = Math.hypot(p.vel[0], p.vel[2]) / U;
    if (!p.onGround) return 'air';
    if (hspeed > def.runThreshold) return 'run';
    if (p.ducked) return 'duck';
    return 'stand';
  }

  rifleAccuracy(p, acc) {
    // First shot is the most accurate; it gets worse as the spray goes on.
    const n = p.shotsFired;
    return n === 0 ? Math.min(0.2, acc.offset) : Math.min(acc.max, Math.pow(n, acc.pow) / acc.div + acc.offset);
  }

  nextPistolAcc(p, acc) {
    // Pistol accuracy recovers with time between shots.
    const since = this.time - p.lastFire;
    const a = p.pistolAcc - (acc.window - since) * acc.loss;
    return Math.max(acc.min, Math.min(acc.start, a));
  }

  // Spread (CS 1.6 formulas) the next shot would have. Pure: used by fire()
  // and by the client's dynamic crosshair.
  currentSpread(p, def, state = this.moveState(p, def)) {
    const acc = def.accuracy;
    if (def.pellets) return def.pelletSpread;
    if (acc.type === 'rifle') {
      const s = def.spread[state];
      return s[0] + s[1] * this.rifleAccuracy(p, acc);
    }
    if (acc.type === 'pistol') {
      const s = def.spread[state];
      return s[0] + s[1] * (1 - this.nextPistolAcc(p, acc));
    }
    if (acc.type === 'sniper') {
      const sp = def.sniperSpread;
      const hspeed = Math.hypot(p.vel[0], p.vel[2]) / U;
      let spread;
      if (state === 'air') spread = sp.air;
      else if (hspeed > 140) spread = sp.run;
      else if (hspeed > 10) spread = sp.walk;
      else if (p.ducked) spread = sp.duck;
      else spread = sp.stand;
      return spread + (p.zoom === 0 ? sp.unscoped : 0);
    }
    return 0;
  }

  kick(p, def, state) {
    const k = def.kick;
    // Same pattern shape as CS 1.6, all of it scaled by RECOIL_SCALE.
    const R = RECOIL_SCALE;
    if (k.punch) {
      const range = state === 'air' && k.airPunch ? k.airPunch : k.punch;
      p.punch[0] += (range[0] + this.rand() * (range[1] - range[0])) * R;
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
    if (Math.floor(this.rand() * (dirChange + 1)) === 0) p.recoilDir = -p.recoilDir;
  }

  damage(victim, attacker, raw, group, point, def, wallbang, dir) {
    // Nobody can be hurt while frozen at the start or end of a match, or in
    // admin god mode.
    if (this.frozen(victim) || victim.god) return;
    const { damage, armorHit } = computeDamage(victim, raw, group, def);
    victim.health -= damage;
    victim.tagMul = TAG_SPEED_MUL;
    victim.lastHitDir = dir;
    victim.lastAttacker = attacker?.id ?? null;
    victim.lastHurtTime = this.time;
    // Aim punch: getting shot knocks your view.
    victim.punch[0] += group === 'head' ? 3 : 1.2;
    this.emit({
      type: 'hit', attacker: attacker?.id, victim: victim.id, damage, group, pos: point,
      armorHit, wallbang, weapon: def.id, from: attacker ? [...attacker.pos] : null,
    });
    if (victim.health <= 0) {
      victim.health = 0;
      this.kill(victim, attacker, def, group === 'head', wallbang);
    }
  }

  // cause: 'bomb' for the bomb going off.
  kill(victim, attacker, def, headshot, wallbang, cause = null) {
    victim.alive = false;
    victim.deaths++;
    // Objective rounds: one life per round.
    victim.respawnAt = this.objective ? NEVER : this.time + RESPAWN_TIME;
    victim.reloading = false;
    victim.zoom = 0;
    if (this.objective) {
      if (victim.task?.kind === 'defuse') this.bomb.defuser = null;
      victim.task = null;
      Obj.dropBomb(this, victim);
      Obj.releaseHostages(this, victim);
    }
    let reward = 0, multi = 0;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      if (headshot) attacker.headshots++;
      reward = this.killReward(attacker);
      attacker.roundKills++;
      attacker.money = Math.min(MAX_MONEY, attacker.money + reward);
      if (attacker.team in this.teamKills && this.match.state === 'live') this.teamKills[attacker.team]++;
      multi = attacker.multi = this.time - attacker.lastKillAt <= MULTI_KILL_WINDOW ? attacker.multi + 1 : 1;
      attacker.lastKillAt = this.time;
    }
    this.emit({
      type: 'kill', attacker: attacker?.id ?? null, victim: victim.id, weapon: def?.id ?? null,
      headshot, wallbang, dir: victim.lastHitDir, cause, reward, multi,
    });
    // The body vanishes and its best gun stays on the ground (CS drops the
    // primary, or the pistol if there's no primary).
    const slot = victim.weapons.primary ? 'primary' : victim.weapons.secondary ? 'secondary' : null;
    if (slot) this.dropWeapon(victim, slot, false);

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
