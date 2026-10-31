// Bot brain: looks at the game state and produces the same cmd a human client
// would send. Bots never touch game state directly except to buy on spawn.
import { emptyCmd } from './game.js';
import { WEAPONS, weaponValue } from './weapons.js';
import { STAND_EYE, DUCK_EYE } from './constants.js';
import { forwardVec, rightVec } from './movement.js';
import { isEnemy } from './combat.js';
import { siteAt, canPlant, canDefuse, hostageInReach } from './objective.js';

const DEG = Math.PI / 180;

// reaction: seconds before the first shot at a new target. aimError: initial
// miss in degrees, shrinking at errorDecay per second. wobble: an aim drift in
// degrees that never settles, so bots miss at range even when tracking.
// hurtFlinch: degrees of aim knocked off when the bot is hit. lead: how much
// of the target's movement the bot predicts.
export const DIFFICULTY = {
  easy: { reaction: 0.8, aimError: 16, errorDecay: 0.9, wobble: 3.2, hurtFlinch: 8, lead: 0, head: 0.04, turn: 200, spray: 0.1, burst: 0.6 },
  normal: { reaction: 0.55, aimError: 12, errorDecay: 1.5, wobble: 2.0, hurtFlinch: 6, lead: 0.3, head: 0.1, turn: 300, spray: 0.3, burst: 0.8 },
  hard: { reaction: 0.35, aimError: 8, errorDecay: 2.4, wobble: 1.1, hurtFlinch: 4, lead: 0.6, head: 0.22, turn: 460, spray: 0.55, burst: 1.1 },
};

const PRIMARY_POOL = ['ak47', 'ak47', 'm4a1', 'm4a1', 'famas', 'mp5', 'p90', 'ump45', 'uzi', 'shotgun', 'autoshotgun', 'awp', 'minigun'];

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class BotBrain {
  // nav is optional: bots use the game's (it changes with the map).
  constructor(game, player, nav = null, difficulty = 'normal') {
    this.game = game;
    this.p = player;
    this.skill = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.reset();
  }

  get nav() { return this.game.nav; }

  setDifficulty(d) { this.skill = DIFFICULTY[d] ?? DIFFICULTY.normal; }

  reset() {
    this.yaw = this.p.yaw;
    this.pitch = 0;
    this.path = null;
    this.pathIdx = 0;
    this.repathAt = 0;
    this.target = null;
    this.targetVisible = false;
    this.lastSeenPos = null;
    this.lastSeenTime = -100;
    this.reactionUntil = 0;
    this.aimErr = [0, 0];
    this.nextScan = 0;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.strafeDir = 1;
    this.strafeChangeAt = 0;
    this.stuckTime = 0;
    this.jumpNext = false;
    this.bought = false;
    this.wasAlive = false;
    this.fireToggle = false;
    this.altToggle = false;
    this.aimHead = false;
    this.crouchFire = false;
    this.wobblePhase = [Math.random() * 10, Math.random() * 10];
    this.lastHurtSeen = this.p.lastHurtTime;
    this.dropGoal = null; // id of a gun on the ground worth more than ours
    this.objSpot = null; // where the objective wants us: [x, z]
    this.objSpotKey = '';
    this.objSpotUntil = 0;
    this.useToggle = false;
  }

  think(dt) {
    const g = this.game, p = this.p;
    const cmd = emptyCmd();
    if (!p.alive) {
      if (this.wasAlive) this.reset();
      this.wasAlive = false;
      cmd.yaw = p.yaw; cmd.pitch = p.pitch;
      return cmd;
    }
    // A new life (respawn, or a new match respawning everyone at once).
    if (this.life !== p.life) {
      this.reset();
      this.life = p.life;
      this.wasAlive = true;
      this.yaw = p.yaw; this.pitch = 0;
      this.buyLoadout();
    }
    const t = g.time;
    const eye = g.eyePos(p);
    const def = g.activeDef(p);
    const w = g.activeWeapon(p);

    // --- Perception (10 Hz) ---
    if (t >= this.nextScan) {
      this.nextScan = t + 0.1;
      this.scan(eye);
    }

    let moveDir = null; // world-space [x, z]
    let wantFire = false;

    // Out of ammo: switch to a gun that still has some, or the knife.
    if (w && !def.melee && w.clip === 0 && w.reserve === 0) {
      cmd.slot = ['primary', 'secondary'].find((s) => s !== p.active && weaponValue(p.weapons[s]) > 0) ?? 'melee';
    }
    const tgt = this.target ? g.getPlayer(this.target) : null;

    if (tgt && tgt.alive && this.targetVisible) {
      // --- Combat ---
      const aimY = this.aimHead ? (tgt.ducked ? 0.88 : 1.6) : (tgt.ducked ? 0.6 : 1.1);
      // Lead the target a little based on its velocity.
      const lead = 0.05 * this.skill.lead;
      const ax = tgt.pos[0] + tgt.vel[0] * lead, ay = tgt.pos[1] + aimY, az = tgt.pos[2] + tgt.vel[2] * lead;
      const dx = ax - eye[0], dy = ay - eye[1], dz = az - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      let wantYaw = Math.atan2(-dx, -dz);
      let wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Aim error shrinks the longer we track the target.
      const decay = Math.exp(-this.skill.errorDecay * dt);
      this.aimErr[0] *= decay; this.aimErr[1] *= decay;
      // Getting shot throws the aim off again.
      if (p.lastHurtTime > this.lastHurtSeen) {
        this.lastHurtSeen = p.lastHurtTime;
        const f = this.skill.hurtFlinch;
        this.aimErr[0] += (Math.random() * 2 - 1) * f;
        this.aimErr[1] += (Math.random() * 2 - 1) * f * 0.6;
      }
      // A slow drift that never settles, larger while the bot or target moves.
      const moving = Math.min(1, (Math.hypot(p.vel[0], p.vel[2]) + Math.hypot(tgt.vel[0], tgt.vel[2])) / 4);
      const wob = this.skill.wobble * (0.6 + 0.6 * moving);
      wantYaw += (this.aimErr[0] + wob * Math.sin(t * 1.9 + this.wobblePhase[0])) * DEG;
      wantPitch += (this.aimErr[1] + wob * 0.6 * Math.sin(t * 2.7 + this.wobblePhase[1])) * DEG;
      // Spray control: pull down against recoil.
      wantYaw -= p.punch[1] * DEG * this.skill.spray;
      wantPitch -= p.punch[0] * DEG * this.skill.spray;
      this.turnTowards(wantYaw, wantPitch, dt);

      const err = Math.hypot(wrapAngle(wantYaw - this.yaw), wantPitch - this.pitch);
      const tolerance = Math.atan2(0.35, dist) + 0.01;
      const ready = t >= this.reactionUntil && err < tolerance * 1.5;

      // Scope the AWP at range.
      if (def?.zoomLevels) {
        if (p.zoom === 0 && dist > 6 && !p.resumeZoomAt && t >= p.deployEnd) cmd.alt = this.pressAlt();
        else this.altToggle = false;
      }

      if (def?.melee) {
        wantFire = t >= this.reactionUntil && dist < 1.25;
      } else if (ready && w && w.clip > 0 && !p.reloading) {
        if (def.auto && !def.pellets && !def.zoomLevels) {
          if (t >= this.burstPauseUntil) {
            if (this.burstLeft <= 0) {
              const n = dist > 25 ? 2 + Math.random() * 2 : dist > 12 ? 4 + Math.random() * 4 : 8 + Math.random() * 8;
              this.burstLeft = Math.round(n * this.skill.burst);
            }
            wantFire = true;
          }
        } else {
          wantFire = def.zoomLevels ? (p.zoom > 0 || dist < 6) && err < tolerance : true;
        }
      }

      // Movement in a fight: stop to shoot accurately, strafe in between.
      const close = def?.pellets || def?.id === 'uzi' || def?.id === 'p90';
      if (def?.melee) {
        // Knife: run straight at them, weaving a little.
        const f = forwardVec(this.yaw), r = rightVec(this.yaw);
        const weave = Math.sin(t * 3 + this.wobblePhase[0]) * 0.35;
        moveDir = [f[0] + r[0] * weave, f[2] + r[2] * weave];
      } else if (wantFire) {
        moveDir = null;
        cmd.duck = this.crouchFire && dist > 15;
      } else {
        if (t >= this.strafeChangeAt) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeChangeAt = t + 0.35 + Math.random() * 0.6;
        }
        const r = rightVec(this.yaw);
        moveDir = [r[0] * this.strafeDir, r[2] * this.strafeDir];
        if (close && dist > 8) {
          const f = forwardVec(this.yaw);
          moveDir = [f[0] + r[0] * this.strafeDir * 0.5, f[2] + r[2] * this.strafeDir * 0.5];
        }
      }
    } else {
      // --- Roam / hunt / play the objective ---
      let goal = null;
      const obj = g.objective ? this.objective(cmd) : null;
      if (this.lastSeenPos && t - this.lastSeenTime < (obj?.urgent ? 1.5 : 6)) goal = this.lastSeenPos;
      else if (obj?.hold) { goal = null; moveDir = null; this.path = []; }
      else if (obj?.goal) goal = obj.goal;
      // A better gun on the ground beats hunting.
      const drop = this.dropGoal ? g.drops.find((d) => d.id === this.dropGoal) : null;
      if (this.dropGoal && !drop) { this.dropGoal = null; this.path = null; }
      if (drop) {
        goal = drop.pos;
        const dd = Math.hypot(drop.pos[0] - p.pos[0], drop.pos[2] - p.pos[2]);
        if (g.canPickup(p, drop)) cmd.actions = [{ type: 'pickup', id: drop.id }];
        else if (dd < 3) { moveDir = [(drop.pos[0] - p.pos[0]) / dd, (drop.pos[2] - p.pos[2]) / dd]; this.path = []; }
      }
      if (obj?.hold) {
        // Planting or defusing: stand still with the key held.
      } else if (!moveDir && (!this.path || this.pathIdx >= this.path.length || t >= this.repathAt)) {
        const dest = goal ?? this.nav.randomOpenPoint(Math.random);
        this.path = this.nav.findPath(p.pos[0], p.pos[2], dest[0], dest[2] ?? dest[1]);
        this.pathIdx = 0;
        this.repathAt = t + (drop ? 1 : goal ? 1.5 : 8);
        if (!this.path && goal) this.lastSeenPos = null;
      }
      if (!moveDir && !obj?.hold && this.path && this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const dx = wp[0] - p.pos[0], dz = wp[1] - p.pos[2];
        const d = Math.hypot(dx, dz);
        // Move on to the next waypoint once close, but only if the way there
        // is clear from where we actually stand; otherwise we'd cut the
        // corner into whatever the path was steering around.
        const next = this.path[this.pathIdx + 1];
        if (d < 0.6 && (!next || d < 0.15 || this.nav.walkable(p.pos[0], p.pos[2], next[0], next[1]))) this.pathIdx++;
        else if (d > 0.01) moveDir = [dx / d, dz / d];
      }
      // Look where we walk, or towards the last thing we saw.
      let lookYaw = this.yaw;
      if (goal && t - this.lastSeenTime < 2) {
        lookYaw = Math.atan2(-(goal[0] - p.pos[0]), -(goal[2] - p.pos[2]));
      } else if (moveDir) {
        lookYaw = Math.atan2(-moveDir[0], -moveDir[1]);
      }
      this.turnTowards(lookYaw, 0, dt, 0.5);
      if (w && !p.reloading && w.clip < WEAPONS[w.id].clip * 0.5 && w.reserve > 0) cmd.reload = true;
      this.burstLeft = 0;
      if (def?.zoomLevels && p.zoom > 0) cmd.alt = this.pressAlt();
    }

    // --- Fire control ---
    if (wantFire) {
      if (def.auto && !def.pellets && !def.zoomLevels) {
        cmd.fire = true;
        if (p.fireHeld && p.lastFire >= t - 0.001) {
          this.burstLeft--;
          if (this.burstLeft <= 0) this.burstPauseUntil = t + (0.2 + Math.random() * 0.3) / this.skill.burst;
        }
      } else {
        // Semi-auto: tap.
        this.fireToggle = !this.fireToggle;
        cmd.fire = this.fireToggle;
      }
    }

    // --- Movement to cmd ---
    if (moveDir) {
      const f = forwardVec(this.yaw), r = rightVec(this.yaw);
      cmd.fwd = Math.max(-1, Math.min(1, moveDir[0] * f[0] + moveDir[1] * f[2]));
      cmd.side = Math.max(-1, Math.min(1, moveDir[0] * r[0] + moveDir[1] * r[2]));
      // Stuck detection.
      const speed = Math.hypot(p.vel[0], p.vel[2]);
      if (speed < 0.6) this.stuckTime += dt; else this.stuckTime = 0;
      if (this.stuckTime > 0.7) {
        this.stuckTime = 0;
        this.jumpNext = true;
        this.repathAt = 0;
        this.path = null;
      }
    }
    if (this.jumpNext && p.onGround) { cmd.jump = true; this.jumpNext = false; }

    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    return cmd;
  }

  // What the objective wants from us right now. Returns { goal: [x, y, z] }
  // to walk somewhere, { hold: true } to stand and hold the use key, or null.
  // Sets cmd.use as needed. urgent: drop the hunt sooner to get back to it.
  objective(cmd) {
    const g = this.game, p = this.p, t = g.time;
    if (g.round.state !== 'live' && g.round.state !== 'freeze') return null;
    const b = g.bomb;
    if (g.objective === 'bomb') {
      if (p.team === 'red') {
        if (b.state === 'carried' && b.carrier === p.id) {
          if (canPlant(g, p) || p.task?.kind === 'plant') {
            // Inside the site: walk a bit further in, then plant.
            if (p.task || this.objSpotKey === 'plant-here') { cmd.use = true; return { hold: true }; }
            if (this.objSpotKey !== 'plant') this.pickSpot('plant', g.map.sites[g.plan], 0.25);
            if (Math.hypot(this.objSpot[0] - p.pos[0], this.objSpot[1] - p.pos[2]) < 1.2 && siteAt(g.map, p.pos)) {
              this.objSpotKey = 'plant-here';
              cmd.use = true;
              return { hold: true };
            }
            return { goal: [this.objSpot[0], 0, this.objSpot[1]], urgent: true };
          }
          this.pickSpot('plant', g.map.sites[g.plan], 0.25);
          return { goal: [this.objSpot[0], 0, this.objSpot[1]], urgent: true };
        }
        if (b.state === 'dropped') return { goal: b.pos, urgent: true };
        if (b.state === 'planted') {
          this.pickSpot('guard' + b.site, { min: [b.pos[0] - 7, b.pos[2] - 7], max: [b.pos[0] + 7, b.pos[2] + 7] }, 0, 8);
          return { goal: [this.objSpot[0], 0, this.objSpot[1]] };
        }
        // Escort: head for the planned site with the carrier.
        this.pickSpot('escort' + g.plan, g.map.sites[g.plan], 0.15, 10);
        return { goal: [this.objSpot[0], 0, this.objSpot[1]] };
      }
      // Blue.
      if (b.state === 'planted') {
        if (p.task?.kind === 'defuse' || canDefuse(g, p)) { cmd.use = true; return { hold: true, urgent: true }; }
        return { goal: b.pos, urgent: true };
      }
      // Hold a site until the bomb shows up, half the team on each.
      const site = p.id % 2 ? 'A' : 'B';
      this.pickSpot('hold' + site, g.map.sites[site], 0.2, 12);
      return { goal: [this.objSpot[0], 0, this.objSpot[1]] };
    }
    // Hostage rescue.
    const hs = g.hostages.filter((h) => h.state !== 'rescued');
    if (p.team === 'blue') {
      const mine = hs.filter((h) => h.state === 'follow' && h.leader === p.id);
      const free = hs.filter((h) => h.state === 'idle');
      // Pick up any free hostage within reach on the way.
      const near = hostageInReach(g, p);
      if (near && near.state === 'idle') {
        this.useToggle = !this.useToggle;
        cmd.use = this.useToggle;
      }
      if (free.length && (mine.length < 2 || mine.length + free.length <= 2)) {
        free.sort((a, b2) => Math.hypot(a.pos[0] - p.pos[0], a.pos[2] - p.pos[2]) - Math.hypot(b2.pos[0] - p.pos[0], b2.pos[2] - p.pos[2]));
        return { goal: free[0].pos, urgent: true };
      }
      if (mine.length) {
        // Lead them home, waiting for anyone falling behind.
        const lag = mine.some((h) => Math.hypot(h.pos[0] - p.pos[0], h.pos[2] - p.pos[2]) > 7);
        if (lag) return { hold: true };
        this.pickSpot('rescue', g.map.rescue[0], 0.3, 30);
        return { goal: [this.objSpot[0], 0, this.objSpot[1]], urgent: true };
      }
      // Nothing to do for the hostages: push toward them anyway.
      const h = hs[p.id % Math.max(1, hs.length)];
      return h ? { goal: h.pos } : null;
    }
    // Red: guard the hostages, moving around them now and then.
    const h = hs.find((x) => x.state === 'follow') ?? hs[p.id % Math.max(1, hs.length)];
    if (!h) return null;
    if (h.state === 'follow') return { goal: h.pos, urgent: true };
    this.pickSpot('guard' + h.id, { min: [h.pos[0] - 8, h.pos[2] - 8], max: [h.pos[0] + 8, h.pos[2] + 8] }, 0, 7);
    return { goal: [this.objSpot[0], 0, this.objSpot[1]] };
  }

  // A random reachable spot in a rect (shrunk by `inset` of its size), kept
  // until `key` changes or `keep` seconds pass.
  pickSpot(key, rect, inset = 0, keep = Infinity) {
    const t = this.game.time;
    if (this.objSpotKey === key && this.objSpot && t < this.objSpotUntil) return;
    const nav = this.nav;
    const w = rect.max[0] - rect.min[0], h = rect.max[1] - rect.min[1];
    let spot = null;
    for (let i = 0; i < 20 && !spot; i++) {
      const x = rect.min[0] + w * (inset + Math.random() * (1 - 2 * inset));
      const z = rect.min[1] + h * (inset + Math.random() * (1 - 2 * inset));
      const [ci, cj] = nav.cellOf(x, z);
      if (nav.isMain(ci, cj)) spot = [x, z];
    }
    this.objSpot = spot ?? [(rect.min[0] + rect.max[0]) / 2, (rect.min[1] + rect.max[1]) / 2];
    this.objSpotKey = key;
    this.objSpotUntil = t + keep;
    this.path = null;
  }

  // Alt is edge-triggered, so alternate pressed/released ticks.
  pressAlt() {
    this.altToggle = !this.altToggle;
    return this.altToggle;
  }

  turnTowards(wantYaw, wantPitch, dt, speedMul = 1) {
    const maxTurn = this.skill.turn * DEG * dt * speedMul;
    const dy = wrapAngle(wantYaw - this.yaw);
    const dp = wantPitch - this.pitch;
    // Fast when far off, slowing down near the target.
    const k = Math.min(1, dt * 14);
    this.yaw = wrapAngle(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, dy * k + Math.sign(dy) * Math.min(Math.abs(dy), maxTurn * 0.15))));
    this.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp * k + Math.sign(dp) * Math.min(Math.abs(dp), maxTurn * 0.15)));
  }

  scan(eye) {
    const g = this.game, p = this.p, t = g.time;
    let best = null, bestD = Infinity;
    const f = forwardVec(this.yaw);
    for (const o of g.players) {
      if (!o.alive || !isEnemy(p, o) || g.frozen(o)) continue;
      const dx = o.pos[0] - p.pos[0], dz = o.pos[2] - p.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > 90) continue;
      const inFov = (dx * f[0] + dz * f[2]) / (d || 1) > Math.cos(75 * DEG) || d < 5;
      const recentlyHurtBy = p.lastAttacker === o.id && t - p.lastHurtTime < 1.5;
      const heard = t - o.lastFire < 0.3 && d < 30;
      if (!inFov && !recentlyHurtBy && !heard) continue;
      // Visible if head or chest is in line of sight.
      const oEye = o.ducked ? DUCK_EYE : STAND_EYE;
      const vis = g.world.visible(eye[0], eye[1], eye[2], o.pos[0], o.pos[1] + oEye, o.pos[2]) ||
        g.world.visible(eye[0], eye[1], eye[2], o.pos[0], o.pos[1] + oEye * 0.7, o.pos[2]);
      if (vis && (inFov || recentlyHurtBy)) {
        if (d < bestD) { bestD = d; best = o; }
      } else if ((heard || recentlyHurtBy) && !this.targetVisible) {
        this.lastSeenPos = [...o.pos];
        this.lastSeenTime = t - 1.5;
      }
    }
    if (best) {
      if (this.target !== best.id || !this.targetVisible) {
        this.reactionUntil = t + this.skill.reaction * (0.75 + Math.random() * 0.5);
        const e = this.skill.aimError;
        this.aimErr = [(Math.random() * 2 - 1) * e, (Math.random() * 2 - 1) * e * 0.6];
        this.aimHead = Math.random() < this.skill.head;
        this.crouchFire = Math.random() < 0.3;
      }
      this.target = best.id;
      this.targetVisible = true;
      this.lastSeenPos = [...best.pos];
      this.lastSeenTime = t;
      this.path = null;
    } else {
      this.targetVisible = false;
    }
    const prev = this.dropGoal;
    this.dropGoal = this.pickDrop()?.id ?? null;
    if (this.dropGoal !== prev) this.path = null;
  }

  // The gun on the ground most worth walking to: worth more than what we
  // carry in that slot, and not too far.
  pickDrop() {
    const g = this.game, p = this.p;
    let best = null, bestScore = 0;
    for (const d of g.drops) {
      const slot = WEAPONS[d.weapon.id].slot;
      const gain = weaponValue(d.weapon) - weaponValue(p.weapons[slot]);
      if (gain <= 0 || (d.noPickup.pid === p.id && g.time < d.noPickup.until)) continue;
      const dist = Math.hypot(d.pos[0] - p.pos[0], d.pos[2] - p.pos[2]);
      if (dist > 20 || Math.abs(d.pos[1] - p.pos[1]) > 3) continue;
      const score = gain - dist * 60;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  buyLoadout() {
    const g = this.game, p = this.p;
    p.money = 16000;
    const pick = PRIMARY_POOL[Math.floor(Math.random() * PRIMARY_POOL.length)];
    p.loadout.primary = null;
    g.buy(p, 'kevlarHelmet', true);
    g.buy(p, pick, true);
    if (Math.random() < 0.3) { g.buy(p, 'deagle', true); g.switchTo(p, 'primary', true); }
    if (g.objective === 'bomb' && p.team === 'blue') g.buy(p, 'defuser', true);
  }
}
