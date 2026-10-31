// Authoritative game state. Everything that decides the outcome of a fight
// lives here and in the other sim/ modules; the client only draws it.
// Online, the same Game runs inside a Cloudflare Durable Object (worker/room.js)
// and clients mirror it from snapshots (src/net/online.js).
import {
  U, TICK_DT, MAX_HEALTH, RESPAWN_TIME, START_MONEY, MAX_MONEY, KILL_REWARD,
  TAG_SPEED_MUL, TAG_RECOVER_TIME, STAND_EYE, DUCK_EYE,
} from './constants.js';
import { WEAPONS, GEAR } from './weapons.js';
import { World } from './world.js';
import { movePlayer, aimDir, forwardVec, rightVec } from './movement.js';
import { traceBullet, computeDamage, isEnemy } from './combat.js';

const DEG = Math.PI / 180;

// Game modes. In 'ffa' everyone is on team 'ffa' and fights everyone; in
// 'teams' players are 'red' or 'blue' and spawn on their own side of the map.
export const MODES = ['ffa', 'teams'];
export const TEAMS = ['red', 'blue'];

export function emptyCmd() {
  return {
    fwd: 0, side: 0, jump: false, duck: false, walk: false,
    fire: false, alt: false, reload: false, slot: null, lastWeapon: false,
    yaw: 0, pitch: 0, actions: null,
  };
}

function makeWeapon(id) {
  const def = WEAPONS[id];
  return { id, clip: def.clip, reserve: def.reserve };
}

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
    this.map = map;
    this.mode = MODES.includes(mode) ? mode : 'ffa';
    this.world = new World(map.boxes);
    this.players = [];
    this.time = 0;
    this.tickCount = 0;
    this.events = [];
    this.rand = mulberry32(seed >>> 0);
    this.nextId = 1;
    // Optional lag compensation: (shooter) => restore(). The server sets this to
    // rewind other players to what the shooter saw while their bullets trace.
    this.lagComp = null;
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
      weapons: { primary: null, secondary: null }, active: 'secondary', lastActive: 'primary',
      loadout: { primary: null, secondary: 'usp', armor: null },
      nextAttack: 0, deployEnd: 0, reloading: false, reloadEnd: 0, shellNext: 0,
      shotsFired: 0, decreaseShotsAt: 0, delayFire: false, pistolAcc: 0.9, accuracy: 0.2, lastFire: -10,
      punch: [0, 0], prevPunch: [0, 0], recoilDir: 1,
      zoom: 0, resumeZoomAt: 0, resumeZoom: 0,
      spin: 0, fireHeld: false, altHeld: false, reloadHeld: false,
      tagMul: 1, lastHitDir: null, lastAttacker: null, lastHurtTime: -10,
    };
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
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
    const order = [...this.players.filter((p) => !p.isBot), ...this.players.filter((p) => p.isBot)];
    for (const p of order) p.team = null;
    for (const p of order) p.team = this.defaultTeam();
  }

  // Change sides in teams mode (the Switch team key). A living player is
  // taken out without it counting as a death and respawns with the new team.
  setTeam(p, team) {
    if (this.mode !== 'teams' || !TEAMS.includes(team) || p.team === team) return false;
    p.team = team;
    if (p.alive) {
      p.alive = false;
      p.reloading = false;
      p.zoom = 0;
      p.respawnAt = this.time + 1;
    }
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
    p.armor = 0; p.helmet = false;
    p.ducked = false; p.duckAmount = 0; p.onGround = true;
    p.weapons = { primary: null, secondary: makeWeapon('usp') };
    p.active = 'secondary';
    p.punch = [0, 0]; p.prevPunch = [0, 0];
    p.zoom = 0; p.spin = 0; p.reloading = false; p.shotsFired = 0;
    p.tagMul = 1;
    p.deployEnd = this.time + 0.3; p.nextAttack = this.time + 0.3;

    // Re-buy the last loadout (practice convenience).
    const lo = p.loadout;
    if (lo.secondary && lo.secondary !== 'usp') this.buy(p, lo.secondary, true);
    if (lo.armor) this.buy(p, lo.armor, true);
    if (lo.primary) this.buy(p, lo.primary, true);
    this.emit({ type: 'spawn', pid: p.id });
  }

  buy(p, item, silent = false) {
    if (!p.alive) return false;
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

    for (const p of this.players) {
      p.prevPos[0] = p.pos[0]; p.prevPos[1] = p.pos[1]; p.prevPos[2] = p.pos[2];
      p.prevPunch[0] = p.punch[0]; p.prevPunch[1] = p.punch[1];
      p.prevDuck = p.duckAmount;

      const cmd = cmds.get(p.id) ?? emptyCmd();
      if (!p.alive) {
        // Dead players can still change team, but not buy.
        if (cmd.actions) for (const a of cmd.actions) if (a.type === 'team') this.handleAction(p, a);
        if (this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (cmd.actions) for (const a of cmd.actions) this.handleAction(p, a);

      this.moveStep(p, cmd, dt);
      this.updateWeapon(p, cmd, dt);

      // Fell out of the world.
      if (p.pos[1] < -20) this.kill(p, null, null, false, false);
    }
  }

  // Look + movement for one tick. Also used by online clients to predict
  // their own player between server snapshots.
  moveStep(p, cmd, dt = TICK_DT) {
    p.yaw = cmd.yaw;
    p.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, cmd.pitch));

    // Recover from being shot.
    if (p.tagMul < 1) p.tagMul = Math.min(1, p.tagMul + dt * (1 - TAG_SPEED_MUL) / TAG_RECOVER_TIME);

    const def = this.activeDef(p);
    let speed = def ? def.speed : 250;
    if (def && def.scopedSpeed && p.zoom > 0) speed = def.scopedSpeed;
    if (def && def.spinUp && p.spin > 0) speed *= 0.85;
    movePlayer(this.world, p, cmd, dt, speed * U);
    // Smooth stair steps for the camera.
    p.stepOffset *= Math.max(0, 1 - dt * 14);
  }

  handleAction(p, a) {
    if (a.type === 'buy') this.buy(p, a.item);
    else if (a.type === 'team') this.setTeam(p, a.team);
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
    if (k.punch) {
      const range = state === 'air' && k.airPunch ? k.airPunch : k.punch;
      p.punch[0] += range[0] + this.rand() * (range[1] - range[0]);
      return;
    }
    const [upBase, latBase, upMod, latMod, upMax, latMax, dirChange] = k[state];
    const s = def.kickScale;
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

  kill(victim, attacker, def, headshot, wallbang) {
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = this.time + RESPAWN_TIME;
    victim.reloading = false;
    victim.zoom = 0;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      if (headshot) attacker.headshots++;
      attacker.money = Math.min(MAX_MONEY, attacker.money + KILL_REWARD);
    }
    this.emit({
      type: 'kill', attacker: attacker?.id ?? null, victim: victim.id, weapon: def?.id ?? null,
      headshot, wallbang, dir: victim.lastHitDir,
    });
  }

  // Helpers used by bots and the client.
  forward(p) { return forwardVec(p.yaw); }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
