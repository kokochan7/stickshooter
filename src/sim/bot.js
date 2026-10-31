// Bot brain: looks at the game state and produces the same cmd a human client
// would send. Bots never touch game state directly except to buy on spawn.
import { emptyCmd } from './game.js';
import { WEAPONS } from './weapons.js';
import { STAND_EYE, DUCK_EYE } from './constants.js';
import { forwardVec, rightVec } from './movement.js';
import { isEnemy } from './combat.js';

const DEG = Math.PI / 180;

export const DIFFICULTY = {
  easy: { reaction: 0.5, aimError: 9, errorDecay: 1.8, head: 0.1, turn: 280, spray: 0.3, burst: 0.7 },
  normal: { reaction: 0.36, aimError: 7, errorDecay: 3.0, head: 0.2, turn: 420, spray: 0.55, burst: 1 },
  hard: { reaction: 0.2, aimError: 3.5, errorDecay: 5.5, head: 0.45, turn: 700, spray: 0.85, burst: 1.3 },
};

const PRIMARY_POOL = ['ak47', 'ak47', 'm4a1', 'm4a1', 'famas', 'mp5', 'p90', 'ump45', 'uzi', 'shotgun', 'autoshotgun', 'awp', 'minigun'];

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class BotBrain {
  constructor(game, player, nav, difficulty = 'normal') {
    this.game = game;
    this.p = player;
    this.nav = nav;
    this.skill = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.reset();
  }

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
    if (!this.wasAlive) {
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
    const tgt = this.target ? g.getPlayer(this.target) : null;

    if (tgt && tgt.alive && this.targetVisible) {
      // --- Combat ---
      const aimY = this.aimHead ? (tgt.ducked ? 0.88 : 1.6) : (tgt.ducked ? 0.6 : 1.25);
      // Lead the target a little based on its velocity.
      const ax = tgt.pos[0] + tgt.vel[0] * 0.05, ay = tgt.pos[1] + aimY, az = tgt.pos[2] + tgt.vel[2] * 0.05;
      const dx = ax - eye[0], dy = ay - eye[1], dz = az - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      let wantYaw = Math.atan2(-dx, -dz);
      let wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Aim error shrinks the longer we track the target.
      const decay = Math.exp(-this.skill.errorDecay * dt);
      this.aimErr[0] *= decay; this.aimErr[1] *= decay;
      wantYaw += this.aimErr[0] * DEG;
      wantPitch += this.aimErr[1] * DEG;
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

      if (ready && w && w.clip > 0 && !p.reloading) {
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
      if (wantFire) {
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
      // --- Roam / hunt ---
      let goal = null;
      if (this.lastSeenPos && t - this.lastSeenTime < 6) goal = this.lastSeenPos;
      if (!this.path || this.pathIdx >= this.path.length || t >= this.repathAt) {
        const dest = goal ?? this.nav.randomOpenPoint(Math.random);
        this.path = this.nav.findPath(p.pos[0], p.pos[2], dest[0], dest[2] ?? dest[1]);
        this.pathIdx = 0;
        this.repathAt = t + (goal ? 1.5 : 8);
        if (!this.path && goal) this.lastSeenPos = null;
      }
      if (this.path && this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const dx = wp[0] - p.pos[0], dz = wp[1] - p.pos[2];
        const d = Math.hypot(dx, dz);
        if (d < 0.6) this.pathIdx++;
        else moveDir = [dx / d, dz / d];
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
      if (!o.alive || !isEnemy(p, o)) continue;
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
  }

  buyLoadout() {
    const g = this.game, p = this.p;
    p.money = 16000;
    const pick = PRIMARY_POOL[Math.floor(Math.random() * PRIMARY_POOL.length)];
    p.loadout.primary = null;
    g.buy(p, 'kevlarHelmet', true);
    g.buy(p, pick, true);
    if (Math.random() < 0.3) { g.buy(p, 'deagle', true); g.switchTo(p, 'primary', true); }
  }
}
