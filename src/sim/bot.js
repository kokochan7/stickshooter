// Bot brain: looks at the game state and produces the same cmd a human client
// would send. Bots never touch game state directly except to buy on spawn.
import { emptyCmd } from './game.js';
import { WEAPONS, GEAR, weaponValue } from './weapons.js';
import { STAND_EYE, DUCK_EYE } from './constants.js';
import { forwardVec, rightVec } from './movement.js';
import { isEnemy } from './combat.js';
import { siteAt, canPlant, canDefuse, hostageInReach } from './objective.js';
import { teamPlan, mapMiddle } from './botplan.js';

const DEG = Math.PI / 180;

// reaction: seconds before the first shot at a new target. aimError: initial
// miss in degrees, shrinking at errorDecay per second. wobble: an aim drift in
// degrees that never settles, so bots miss at range even when tracking.
// hurtFlinch: degrees of aim knocked off when the bot is hit. lead: how much
// of the target's movement the bot predicts.
// armor: chance a bot buys Kevlar + helmet when it can afford them (Kenny's
// numbers: easy 30%, medium 50%, hard always). escape: chance a bot breaks
// off to cover when it's hurt badly or outnumbered.
export const DIFFICULTY = {
  easy: { reaction: 0.8, aimError: 16, errorDecay: 0.9, wobble: 3.2, hurtFlinch: 8, lead: 0, head: 0.04, turn: 200, spray: 0.1, burst: 0.6, armor: 0.3, escape: 0.2 },
  normal: { reaction: 0.55, aimError: 12, errorDecay: 1.5, wobble: 2.0, hurtFlinch: 6, lead: 0.3, head: 0.1, turn: 300, spray: 0.3, burst: 0.8, armor: 0.5, escape: 0.5 },
  hard: { reaction: 0.35, aimError: 8, errorDecay: 2.4, wobble: 1.1, hurtFlinch: 4, lead: 0.6, head: 0.22, turn: 460, spray: 0.55, burst: 1.1, armor: 1, escape: 0.85 },
};

// Bots in the same game know about each other (as a team would on comms), so
// they can spread out: different roles, routes, targets and spots. Keyed by
// game so the client and the server room never share one.
const registry = new WeakMap();
function brainsOf(game) {
  let m = registry.get(game);
  if (!m) registry.set(game, (m = new Map()));
  return m;
}

// Each bot plays a role, dealt out so a team gets a mix:
//   rush    - takes the short way, chases noise, roams far
//   support - plays near the middle of the pack, trades kills
//   flank   - takes long detours to hit enemies from the side
//   anchor  - holds an angle for a while, rarely chases sounds
//   lurk    - goes where its team isn't, takes side routes
export const ROLES = ['rush', 'flank', 'anchor', 'support', 'lurk'];
const ROLE = {
  rush: { curiosity: 0.9, detour: 0, hold: [0, 1], crouch: 0.15, chase: 7 },
  flank: { curiosity: 0.6, detour: 0.85, hold: [0.5, 2], crouch: 0.3, chase: 6 },
  anchor: { curiosity: 0.25, detour: 0.2, hold: [4, 9], crouch: 0.55, chase: 3 },
  support: { curiosity: 0.55, detour: 0.3, hold: [1, 3], crouch: 0.3, chase: 5 },
  lurk: { curiosity: 0.35, detour: 0.7, hold: [2, 5], crouch: 0.4, chase: 4 },
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
    this.role = null;
    this.roleTeam = null;
    this.style = ROLE.support;
    // Personal quirks that last for the whole game: how quickly this bot
    // looks around, and a bias per enemy so two bots that see the same pair
    // of enemies don't always pick the same one.
    this.scanEvery = 0.085 + Math.random() * 0.05;
    this.bias = Math.random() * 1000;
    this.mood = 0;
    brainsOf(game).set(player.id, this);
    this.reset();
  }

  // Other bots on our side that are alive (in FFA: every other bot, used only
  // for spreading out, never for holding fire).
  allies() {
    const g = this.game, out = [];
    for (const b of brainsOf(g).values()) {
      if (b === this || !b.p.alive || g.getPlayer(b.p.id) !== b.p) continue;
      if (g.mode === 'ffa' || b.p.team === this.p.team) out.push(b);
    }
    return out;
  }

  // Take the role our team has least of (ties broken at random).
  pickRole() {
    const counts = Object.fromEntries(ROLES.map((r) => [r, 0]));
    const g = this.game;
    for (const b of brainsOf(g).values()) {
      if (b === this || g.getPlayer(b.p.id) !== b.p || !b.role) continue;
      if (g.mode === 'ffa' || b.p.team === this.p.team) counts[b.role]++;
    }
    const min = Math.min(...Object.values(counts));
    const opts = ROLES.filter((r) => counts[r] === min);
    this.role = opts[Math.floor(Math.random() * opts.length)];
    this.roleTeam = this.p.team;
    this.style = ROLE[this.role];
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
    this.via = null; // detour point on the way to `viaFor`
    this.viaFor = null;
    this.goalKey = null; // the goal the current path leads to
    this.roamGoal = null;
    this.holdUntil = 0; // anchoring at a roam spot until then
    this.holdYaw = 0;
    this.investigating = false;
    this.ignoreNoiseUntil = 0;
    this.hostageGoal = null;
    this.cover = null; // { spot, peek, low, enemy, phase, ... }
    this.coverSearchAt = 0;
    this.decideAt = 0;
    this.engagedWith = null;
    this.engageRoll = 0;
    this.pushing = false;
    this.rotateRoll = Math.random();
    this.escapeUntil = 0;
    this.escapeCheckAt = 0;
    this.enemiesSeen = 0;
    this.guardDuck = false;
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
      if (!this.role || this.roleTeam !== p.team) this.pickRole();
      this.mood = (Math.random() - 0.5) * 0.3;
      this.buyLoadout();
    }
    const t = g.time;
    const eye = g.eyePos(p);
    const def = g.activeDef(p);
    const w = g.activeWeapon(p);

    // --- Perception (10 Hz) ---
    if (t >= this.nextScan) {
      this.nextScan = t + this.scanEvery;
      this.scan(eye);
    }

    let moveDir = null; // world-space [x, z]
    let wantFire = false;
    let fightDist = Infinity;

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
      fightDist = dist;
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

      // Cover or open ground? Push in the open only when there's an opening;
      // otherwise find something to hide behind and peek from it.
      if (t >= this.decideAt || this.engagedWith !== tgt.id) {
        if (this.engagedWith !== tgt.id) {
          this.engagedWith = tgt.id; this.engageRoll = Math.random(); this.pushing = false;
        }
        this.decideAt = t + 0.4;
        if (!this.pushing && this.seesOpening(tgt, dist, def)) { this.pushing = true; this.cover = null; }
      }
      if (this.cover && (this.cover.enemy !== tgt.id || t >= this.cover.until)) this.cover = null;
      if (!this.pushing && !this.cover && t >= this.coverSearchAt) {
        this.coverSearchAt = t + 1 + Math.random() * 0.6;
        this.cover = this.findCover(tgt, def);
      }

      // A sticky spot: hurt badly, or more than one of them on us. Some bots
      // (more of them the harder they are) break off to cover,
      // or just back away, instead of trading shots they'll lose.
      const sticky = !def?.melee && dist > 5 && (p.health < 30 || (this.enemiesSeen >= 2 && p.health < 50));
      if (this.escapeUntil && t >= this.escapeUntil) this.escapeUntil = 0;
      if (sticky && !this.escapeUntil && t >= this.escapeCheckAt) {
        this.escapeCheckAt = t + 2;
        if (Math.random() < this.skill.escape) {
          this.pushing = false;
          if (!this.cover) { this.cover = this.findCover(tgt, def); this.coverSearchAt = t + 1; }
          this.escapeUntil = t + (this.cover ? 2.5 : 1.6);
          this.escapeCheckAt = t + 7; // one break-off, then fight it out
        }
      }

      // Movement in a fight: stop to shoot accurately, strafe in between.
      const close = def?.pellets || def?.id === 'uzi' || def?.id === 'p90';
      if (this.cover) {
        const cm = this.coverStep(cmd, true, w, def);
        moveDir = cm.moveDir;
        cmd.duck = cm.duck;
        if (!cm.fireOk) wantFire = false;
        if (this.escapeUntil && this.cover?.phase === 'move' && moveDir) cmd.duck = false;
      } else if (this.escapeUntil) {
        // Nowhere to hide: back away at an angle, out of their aim.
        if (t >= this.strafeChangeAt) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeChangeAt = t + 0.6 + Math.random() * 0.6;
        }
        const f = forwardVec(this.yaw), r = rightVec(this.yaw);
        moveDir = this.spreadOut([-f[0] * 0.6 + r[0] * this.strafeDir, -f[2] * 0.6 + r[2] * this.strafeDir], 3.5, 1.2);
        const n = Math.hypot(moveDir[0], moveDir[1]) || 1;
        moveDir = [moveDir[0] / n, moveDir[1] / n];
        wantFire = false;
      } else if (def?.melee) {
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
        if ((close || this.pushing) && dist > 8) {
          const f = forwardVec(this.yaw);
          moveDir = [f[0] + r[0] * this.strafeDir * 0.5, f[2] + r[2] * this.strafeDir * 0.5];
        }
        // Don't fight shoulder to shoulder: one grenade, one spray.
        moveDir = this.spreadOut(moveDir, 3.5, 1.2);
      }
    } else if (this.holdCover(cmd, w, def, dt)) {
      // Behind cover, waiting to peek the enemy we just lost sight of.
    } else {
      // --- Roam / hunt / play the objective ---
      let goal = null;
      const obj = g.objective ? this.objective(cmd) : null;
      const chase = obj?.urgent ? 1.5 : this.style.chase;
      // Guarding a planted bomb: don't chase anyone far from it.
      const tether = obj?.tether;
      const chaseOk = !tether || (this.lastSeenPos && Math.hypot(this.lastSeenPos[0] - tether.pos[0], this.lastSeenPos[2] - tether.pos[2]) < tether.r);
      if (this.lastSeenPos && t - this.lastSeenTime < chase && chaseOk) goal = this.lastSeenPos;
      else if (obj?.hold || obj?.idle) { goal = null; moveDir = null; this.path = []; }
      else if (obj?.goal) goal = obj.goal;
      if (goal !== this.lastSeenPos) this.investigating = false;
      // Nothing to do: wander somewhere of our own, and maybe hold it a while.
      let roaming = false;
      if (!goal && !obj?.hold && !obj?.idle) {
        if (t < this.holdUntil) {
          this.path = [];
          moveDir = null;
        } else {
          if (!this.roamGoal) { this.roamGoal = this.pickRoamGoal(); this.path = null; }
          goal = this.roamGoal;
          roaming = true;
          if (Math.hypot(goal[0] - p.pos[0], goal[2] - p.pos[2]) < 1.5) {
            const [a, b] = this.style.hold;
            const holdMul = this.plan().name === 'hold' ? 2 : this.plan().name === 'push' ? 0.4 : 1;
            this.holdUntil = t + (a + Math.random() * (b - a)) * holdMul;
            this.holdYaw = this.yaw + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.6);
            this.roamGoal = null;
            goal = null;
            this.path = [];
          }
        }
      } else {
        this.roamGoal = null;
        this.holdUntil = 0;
      }
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
      } else if (goal && !moveDir && (!this.path || this.pathIdx >= this.path.length || t >= this.repathAt)) {
        this.path = this.routeTo(goal, drop ? false : obj?.detour ?? !obj?.urgent);
        this.pathIdx = 0;
        this.repathAt = t + (drop ? 1 : roaming ? 8 : 1.5);
        if (!this.path) {
          if (goal === this.lastSeenPos) this.lastSeenPos = null;
          if (roaming) this.roamGoal = null;
        }
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
        else if (d > 0.01) moveDir = this.spreadOut([dx / d, dz / d], 2.2, 0.6);
        // Reached the detour point: next repath goes straight to the goal.
        if (this.via && Math.hypot(this.via[0] - p.pos[0], this.via[1] - p.pos[2]) < 2) this.via = 'done';
      }
      // Look where we walk, or towards the last thing we saw.
      let lookYaw = this.yaw;
      if (t < this.holdUntil) {
        // Holding: sweep slowly across the angle we picked.
        lookYaw = this.holdYaw + Math.sin(t * 0.7 + this.wobblePhase[0]) * 0.5;
      } else if (goal && t - this.lastSeenTime < 2) {
        lookYaw = Math.atan2(-(goal[0] - p.pos[0]), -(goal[2] - p.pos[2]));
      } else if (obj?.look && !moveDir) {
        // In position: watch the bomb (or the carrier's way ahead).
        lookYaw = Math.atan2(-(obj.look[0] - p.pos[0]), -(obj.look[1] - p.pos[2])) + Math.sin(t * 0.6 + this.wobblePhase[0]) * 0.35;
        if (obj.duck && !p.reloading) cmd.duck = true;
      } else if (moveDir) {
        lookYaw = Math.atan2(-moveDir[0], -moveDir[1]);
      }
      this.turnTowards(lookYaw, 0, dt, 0.5);
      if (w && !p.reloading && w.clip < WEAPONS[w.id].clip * 0.5 && w.reserve > 0) cmd.reload = true;
      this.burstLeft = 0;
      if (def?.zoomLevels && p.zoom > 0) cmd.alt = this.pressAlt();
    }

    // In the air a gun is wildly inaccurate (CS air spread): hold fire until
    // we land, unless they're right in front of us.
    if (wantFire && !p.onGround && !p.swimming && !def?.melee && fightDist > 4) wantFire = false;

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
        this.repathAt = 0;
        this.path = null;
        // Players are solid: if someone is in the way, step round them
        // rather than hopping into their back.
        const g = this.game;
        const blocker = g.players.some((o) => o !== p && o.alive && Math.hypot(o.pos[0] - p.pos[0], o.pos[2] - p.pos[2]) < 1.3);
        if (blocker) { this.sidestepUntil = g.time + 0.6; this.sidestepDir = g.rand() < 0.5 ? -1 : 1; }
        else this.jumpNext = true;
      }
      if (this.sidestepUntil > this.game.time) { cmd.side = this.sidestepDir; cmd.fwd *= 0.3; }
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
    const plan = this.plan();
    const b = g.bomb;
    const sites = Object.keys(g.map.sites ?? {});
    const [idx, n] = this.teamIndex();
    const late = g.round.endsAt - t < 35; // no time left for slow plans
    const waiting = !late && t < plan.goAt; // slow / fake plans before they commit
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
          // Slow and fake plans: the bomb waits in the middle until the call.
          if (waiting) return { goal: this.spotGoal('mid', this.midRect(8), 0, 10) };
          this.pickSpot('plant', g.map.sites[g.plan], 0.25);
          return { goal: [this.objSpot[0], 0, this.objSpot[1]], urgent: plan.name === 'rush' || late };
        }
        // Dropped bomb: the two of us nearest go and get it, the rest carry on.
        if (b.state === 'dropped' && this.nearestTo(b.pos) < 2) return { goal: b.pos, urgent: true };
        if (b.state === 'planted') return this.postPlant(b);
        const site = g.map.sites[g.plan];
        const other = sites.find((k) => k !== g.plan);
        // Someone else has the bomb: the bot nearest to them sticks close
        // and covers them on the way in (not on split or spread plays,
        // where everyone takes their own way).
        const carrier = b.state === 'carried' ? g.getPlayer(b.carrier) : null;
        if (carrier?.alive && !siteAt(g.map, carrier.pos) && plan.name !== 'split' && plan.name !== 'spread' &&
          this.role !== 'lurk' && this.nearestTo(carrier.pos, (a) => a.p !== carrier && a.role !== 'lurk') === 0) {
          const f = forwardVec(carrier.yaw);
          const d = Math.hypot(carrier.pos[0] - p.pos[0], carrier.pos[2] - p.pos[2]);
          if (d < 3.5) return { goal: null, idle: true, look: [carrier.pos[0] + f[0] * 20, carrier.pos[2] + f[2] * 20] };
          return { goal: [carrier.pos[0] - f[0] * 2.5, 0, carrier.pos[2] - f[2] * 2.5], urgent: d > 12, detour: false, escort: true };
        }
        switch (plan.name) {
          case 'rush':
            return { goal: this.spotGoal('rush' + g.plan, site, 0.15, 6), urgent: true, detour: false };
          case 'split':
            // Two groups, each round its own side, meeting on the site.
            return { goal: this.spotGoal('split' + g.plan, site, 0.15, 10), detour: idx % 2 ? plan.flip : -plan.flip };
          case 'fake':
            if (waiting && other) return { goal: this.spotGoal('fake' + other, g.map.sites[other], 0.15, 8), detour: false };
            return { goal: this.spotGoal('hit' + g.plan, site, 0.15, 10), urgent: true, detour: false };
          case 'slow':
            if (waiting) return { goal: this.spotGoal('mid', this.midRect(14), 0, 9) };
            return { goal: this.spotGoal('hit' + g.plan, site, 0.15, 10) };
          case 'spread':
            // Lurkers hang around the other site for a while to catch
            // rotators; everyone else takes their own way in.
            if (this.role === 'lurk' && other && t < g.round.freezeEnd + 35) {
              return { goal: this.spotGoal('lurk' + other, g.map.sites[other], 0.2, 12) };
            }
            return { goal: this.spotGoal('escort' + g.plan, site, 0.15, 10) };
          default: // execute: everyone onto the site together, detours by role
            return { goal: this.spotGoal('escort' + g.plan, site, 0.15, 10) };
        }
      }
      // Blue.
      if (b.state === 'planted') {
        if (p.task?.kind === 'defuse' || canDefuse(g, p)) { cmd.use = true; return { hold: true, urgent: true }; }
        return { goal: b.pos, urgent: true };
      }
      // Someone called where Red is: most of the other site rotates over.
      if (plan.called && t - plan.calledAt < 20 && this.role !== 'anchor' && this.rotateRoll < 0.75) {
        return { goal: this.spotGoal('rotate' + plan.called, g.map.sites[plan.called], 0.2, 10), urgent: true, detour: false };
      }
      let site = sites[idx % sites.length];
      switch (plan.name) {
        case 'stack': {
          const heavy = Math.ceil(n * 0.65);
          site = idx < heavy ? plan.site : sites.find((k) => k !== plan.site) ?? plan.site;
          break;
        }
        case 'push':
          // One or two go to meet them in the middle, then fall back.
          if (idx < (n >= 4 ? 2 : 1) && t < plan.pushFor) return { goal: this.spotGoal('push', this.midRect(12), 0, 8) };
          break;
        case 'retake':
          // One on each site; the rest wait in between to retake.
          if (idx >= sites.length) return { goal: this.spotGoal('between', this.betweenRect(), 0, 10) };
          break;
        default: // even
          if (this.role === 'rush' && n >= 3) return null;
      }
      return { goal: this.spotGoal('hold' + site, g.map.sites[site], 0.2, 12) };
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
      if (mine.length) {
        // Lead them home, waiting for anyone falling behind.
        if (free.length && mine.length < 2 && near) return { goal: free[0].pos, urgent: true };
        const lag = mine.some((h) => Math.hypot(h.pos[0] - p.pos[0], h.pos[2] - p.pos[2]) > 7);
        if (lag) return { hold: true };
        this.pickSpot('rescue', g.map.rescue[0], 0.3, 30);
        return { goal: [this.objSpot[0], 0, this.objSpot[1]], urgent: true };
      }
      if (plan.name === 'slow' && waiting) {
        this.hostageGoal = null;
        return { goal: this.spotGoal('mid', this.midRect(14), 0, 9) };
      }
      if (free.length) {
        // Go for the nearest hostage nobody else on the team is going for.
        const taken = new Set(this.allies().map((b) => b.hostageGoal));
        const dist = (h) => Math.hypot(h.pos[0] - p.pos[0], h.pos[2] - p.pos[2]) + (taken.has(h.id) ? 25 : 0);
        free.sort((a, b2) => dist(a) - dist(b2));
        this.hostageGoal = free[0].id;
        if (plan.name === 'split') return { goal: free[0].pos, detour: idx % 2 ? plan.flip : -plan.flip };
        return { goal: free[0].pos, urgent: true };
      }
      this.hostageGoal = null;
      // Nothing to do for the hostages: push toward them anyway.
      const h = hs[idx % Math.max(1, hs.length)];
      return h ? { goal: h.pos } : null;
    }
    // Red: guard the hostages, one or two of us on each, moving around them
    // now and then. A rusher with enough teammates goes hunting instead.
    const follow = hs.find((x) => x.state === 'follow');
    if (follow) return { goal: follow.pos, urgent: true };
    if (plan.name === 'forward' && idx % 2 && n >= 2) return { goal: this.spotGoal('fwd', this.midRect(14), 0, 10) };
    if (plan.name === 'guard' && this.role === 'rush' && n >= 3) return null;
    const h = hs[idx % Math.max(1, hs.length)];
    if (!h) return null;
    const r = plan.name === 'ambush' ? 4 : 8;
    return { goal: this.spotGoal('guard' + h.id, { min: [h.pos[0] - r, h.pos[2] - r], max: [h.pos[0] + r, h.pos[2] + r] }, 0, 7) };
  }

  // pickSpot, as a goal for the path finder.
  spotGoal(key, rect, inset, keep) {
    this.pickSpot(key, rect, inset, keep);
    return [this.objSpot[0], 0, this.objSpot[1]];
  }

  // A square of half-size r around the middle of the map.
  midRect(r) {
    const [x, z] = mapMiddle(this.game.map);
    return { min: [x - r, z - r], max: [x + r, z + r] };
  }

  // Halfway between the bomb sites and Blue's base: where retakers wait.
  betweenRect() {
    const m = this.game.map;
    const rects = Object.values(m.sites);
    let x = 0, z = 0;
    for (const r of rects) { x += (r.min[0] + r.max[0]) / 2; z += (r.min[1] + r.max[1]) / 2; }
    x /= rects.length; z /= rects.length;
    const bs = m.teamSpawns?.blue;
    if (bs?.length) {
      let bx = 0, bz = 0;
      for (const s of bs) { bx += (s.pos ?? s)[0]; bz += (s.pos ?? s)[2]; }
      x = (x + bx / bs.length) / 2; z = (z + bz / bs.length) / 2;
    }
    return { min: [x - 6, z - 6], max: [x + 6, z + 6] };
  }

  // How keen this bot is to fight in the open: the team plan, the role, and
  // a mood rolled each life.
  aggression() {
    const plan = this.plan();
    const role = { rush: 0.25, flank: 0.05, anchor: -0.25, support: 0, lurk: -0.1 }[this.role] ?? 0;
    return Math.max(0, Math.min(1, plan.aggr + role + this.mood));
  }

  plan() {
    const g = this.game;
    return teamPlan(g, g.mode === 'teams' ? this.p.team : this.p.id);
  }

  // Is there a reason to fight this enemy in the open instead of from cover?
  seesOpening(tgt, dist, def) {
    const p = this.p;
    if (def?.melee || dist < 4.5) return true;
    if (tgt.health <= 30 || tgt.reloading) return true;
    // Looking the other way.
    const of = forwardVec(tgt.yaw);
    const dx = p.pos[0] - tgt.pos[0], dz = p.pos[2] - tgt.pos[2];
    if ((dx * of[0] + dz * of[2]) / (Math.hypot(dx, dz) || 1) < 0.3) return true;
    // Two or more of us already on it, and we're healthy.
    let on = 0;
    for (const b of this.allies()) if (b.targetVisible && b.target === tgt.id) on++;
    if (on >= 2 && p.health > 50 && this.game.mode !== 'ffa') return true;
    // Close-range guns want to close the gap.
    if ((def?.pellets || def?.id === 'uzi' || def?.id === 'p90') && dist < 12) return this.engageRoll < 0.7;
    // Otherwise it's down to temperament, rolled once per fight.
    return this.engageRoll < this.aggression() * 0.45;
  }

  // Somewhere close, walkable in a straight line, that `tgt` can't see:
  // either low cover (crouch to hide, stand to shoot) or full cover with a
  // peek spot a step to the side. Null if there's nothing near.
  findCover(tgt, def) {
    const g = this.game, p = this.p, nav = this.nav, world = g.world;
    const ex = tgt.pos[0], ey = tgt.pos[1] + (tgt.ducked ? DUCK_EYE : STAND_EYE), ez = tgt.pos[2];
    const d0 = Math.hypot(ex - p.pos[0], ez - p.pos[2]) || 1;
    const ux = (ex - p.pos[0]) / d0, uz = (ez - p.pos[2]) / d0;
    const taken = this.allies().map((b) => b.cover?.spot).filter(Boolean);
    const seen = (x, y, z) => world.visible(ex, ey, ez, x, y, z);
    let best = null, bestScore = -Infinity;
    const a0 = Math.random() * Math.PI * 2;
    for (const r of [1, 2, 3.2, 4.6, 6]) {
      for (let k = 0; k < 12; k++) {
        const a = a0 + (k * Math.PI) / 6;
        const [ci, cj] = nav.cellOf(p.pos[0] + Math.cos(a) * r, p.pos[2] + Math.sin(a) * r);
        if (!nav.isMain(ci, cj)) continue;
        const [x, z] = nav.cellCenter(ci, cj);
        const fy = nav.floorAt(x, z);
        if (Math.abs(fy - p.pos[1]) > 1.5 || !nav.walkable(p.pos[0], p.pos[2], x, z)) continue;
        const de = Math.hypot(ex - x, ez - z);
        if (de < 6) continue;
        const standSeen = seen(x, fy + STAND_EYE, z);
        let low = false, peek = null;
        if (standSeen) {
          // Low cover: ducked head and body hidden.
          if (seen(x, fy + DUCK_EYE, z) || seen(x, fy + 0.6, z)) continue;
          low = true;
        } else {
          if (seen(x, fy + 1.1, z)) continue;
          // Full cover: a step to either side should see them.
          const vx = (ex - x) / de, vz = (ez - z) / de;
          const side = Math.random() < 0.5 ? 1 : -1;
          for (const sgn of [side, -side]) {
            for (const step of [0.9, 1.5]) {
              const qx = x - vz * sgn * step, qz = z + vx * sgn * step;
              const [qi, qj] = nav.cellOf(qx, qz);
              if (!nav.isMain(qi, qj) || !nav.walkable(x, z, qx, qz)) continue;
              if (seen(qx, nav.floorAt(qx, qz) + STAND_EYE, qz)) { peek = [qx, qz]; break; }
            }
            if (peek) break;
          }
          if (!peek) continue;
        }
        let score = -r - Math.max(0, Math.cos(a) * ux + Math.sin(a) * uz) * r * 0.8;
        if (!low) score += 0.6;
        // Snipers like it far, shotguns like it close.
        if (def?.zoomLevels) score += Math.min(de, 40) * 0.05;
        if (def?.pellets) score -= de * 0.1;
        for (const o of taken) if (Math.hypot(o[0] - x, o[1] - z) < 2.5) score -= 6;
        if (score > bestScore) { bestScore = score; best = { spot: [x, z], peek, low }; }
      }
    }
    if (!best) return null;
    const t = g.time;
    return {
      ...best, enemy: tgt.id, phase: 'move', phaseUntil: t + 3,
      until: t + 7 + Math.random() * 6, peeks: 0, maxPeeks: 2 + Math.floor(Math.random() * 3),
      hurtAt: p.lastHurtTime,
    };
  }

  // One tick of the hide / peek cycle. Returns { moveDir, duck, fireOk }.
  coverStep(cmd, visible, w, def) {
    const c = this.cover, p = this.p, t = this.game.time;
    const goTo = (pt, near) => {
      const dx = pt[0] - p.pos[0], dz = pt[1] - p.pos[2], d = Math.hypot(dx, dz);
      return d > near ? [dx / d, dz / d] : null;
    };
    const hide = () => {
      c.phase = 'hide';
      c.phaseUntil = t + 0.5 + Math.random() * (1.4 - this.aggression());
      c.hurtAt = p.lastHurtTime;
      if (++c.peeks >= c.maxPeeks) c.until = Math.min(c.until, t + 0.3);
    };
    if (c.phase === 'move') {
      const dir = goTo(c.spot, 0.3);
      if (!dir || t >= c.phaseUntil) { c.phase = 'hide'; c.phaseUntil = t + 0.3 + Math.random() * 0.8; }
      // Duck behind low cover as we get there; shoot only if it's right here.
      const near = Math.hypot(c.spot[0] - p.pos[0], c.spot[1] - p.pos[2]);
      return { moveDir: dir, duck: c.low && near < 1, fireOk: near < 0.6 && !c.low };
    }
    if (c.phase === 'hide') {
      // Still in their sight while hiding (they moved, or the cover was
      // worse than it looked): this spot is no good, find another.
      const at = Math.hypot(c.spot[0] - p.pos[0], c.spot[1] - p.pos[2]) < 0.5 && (!c.low || p.ducked);
      if (visible && at) {
        c.exposedSince ??= t;
        if (t - c.exposedSince > 0.25) { this.cover = null; this.coverSearchAt = 0; return { moveDir: null, duck: false, fireOk: true }; }
      } else c.exposedSince = null;
      if (w && !def?.melee && !p.reloading && w.clip < WEAPONS[w.id].clip * 0.6 && w.reserve > 0) cmd.reload = true;
      if (t >= c.phaseUntil && !p.reloading) {
        c.phase = 'peek';
        c.phaseUntil = t + 0.8 + Math.random() * 1.2 + this.aggression() * 0.8;
        c.hurtAt = p.lastHurtTime;
      }
      return { moveDir: goTo(c.spot, 0.25), duck: c.low, fireOk: false };
    }
    // Peek: stand up, or step out to the side.
    const hurt = p.lastHurtTime > c.hurtAt && p.health < 70;
    if (hurt || t >= c.phaseUntil || (w && !def?.melee && w.clip === 0)) {
      hide();
      return { moveDir: goTo(c.spot, 0.25), duck: c.low, fireOk: false };
    }
    if (!visible && t > c.phaseUntil - 0.4) c.until = Math.min(c.until, t + 1.5); // nobody there any more
    const dir = c.low ? null : goTo(c.peek, 0.2);
    return { moveDir: dir, duck: false, fireOk: !dir || visible };
  }

  // Lost sight of the enemy while using cover: keep the cycle going for a
  // while, watching where they were. False when there's no cover to work, or
  // the objective needs us now.
  holdCover(cmd, w, def, dt) {
    const g = this.game, p = this.p, t = g.time;
    const c = this.cover;
    if (!c) return false;
    const urgent = p.task || (g.objective === 'bomb' && g.bomb.state === 'planted' && p.team === 'blue') ||
      (g.objective === 'bomb' && g.bomb.carrier === p.id && canPlant(g, p)) ||
      (g.objective === 'hostage' && g.hostages.some((h) => h.state === 'follow' && h.leader === p.id));
    const enemy = g.getPlayer(c.enemy);
    if (urgent || t >= c.until || !enemy?.alive || t - this.lastSeenTime > 5) { this.cover = null; return false; }
    const cm = this.coverStep(cmd, false, w, def);
    cmd.duck = cm.duck;
    if (cm.moveDir) {
      const f = forwardVec(this.yaw), r = rightVec(this.yaw);
      cmd.fwd = Math.max(-1, Math.min(1, cm.moveDir[0] * f[0] + cm.moveDir[1] * f[2]));
      cmd.side = Math.max(-1, Math.min(1, cm.moveDir[0] * r[0] + cm.moveDir[1] * r[2]));
    }
    const lp = this.lastSeenPos ?? enemy.pos;
    const eye = g.eyePos(p);
    const dx = lp[0] - eye[0], dz = lp[2] - eye[2];
    this.turnTowards(Math.atan2(-dx, -dz), Math.atan2(lp[1] + 1.4 - eye[1], Math.hypot(dx, dz)), dt);
    this.burstLeft = 0;
    return true;
  }

  // Our place among the team's bots (by id) and how many there are, so jobs
  // can be dealt out evenly whatever the ids are.
  teamIndex() {
    const ids = [this.p.id, ...this.allies().map((b) => b.p.id)].sort((a, b) => a - b);
    return [ids.indexOf(this.p.id), ids.length];
  }

  // How many of our team's bots (passing `filter`) are closer to pos than we
  // are. 0 means we're the nearest.
  nearestTo(pos, filter = null) {
    const p = this.p;
    const d0 = Math.hypot(pos[0] - p.pos[0], pos[2] - p.pos[2]);
    let n = 0;
    for (const a of this.allies()) {
      if (filter && !filter(a)) continue;
      if (Math.hypot(pos[0] - a.p.pos[0], pos[2] - a.p.pos[2]) < d0) n++;
    }
    return n;
  }

  // Red after the plant: take a post that can see the bomb, ideally with a
  // wall or a crate beside it, and hold it, watching the bomb. Anchors and
  // lurkers watch from further back. When someone starts defusing, everyone
  // in earshot runs back to stop them.
  postPlant(b) {
    const g = this.game, p = this.p;
    const defuser = b.defuser != null ? g.getPlayer(b.defuser) : null;
    if (defuser?.alive && Math.hypot(b.pos[0] - p.pos[0], b.pos[2] - p.pos[2]) < 45) {
      return { goal: b.pos, urgent: true };
    }
    const key = 'post' + b.site + ':' + b.pos[0].toFixed(1);
    if (this.objSpotKey !== key || !this.objSpot) this.pickGuardSpot(b, key);
    return {
      goal: [this.objSpot[0], 0, this.objSpot[1]],
      look: [b.pos[0], b.pos[2]],
      duck: this.guardDuck,
      tether: { pos: b.pos, r: 18 },
    };
  }

  pickGuardSpot(b, key) {
    const g = this.game, nav = this.nav, world = g.world;
    const far = this.role === 'anchor' || this.role === 'lurk';
    const [r0, r1] = far ? [7, 15] : [3.5, 9];
    const bx = b.pos[0], by = b.pos[1] + 0.3, bz = b.pos[2];
    const taken = this.allies().filter((a) => a.objSpotKey === key && a.objSpot).map((a) => a.objSpot);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      const [ci, cj] = nav.cellOf(x, z);
      if (!nav.isMain(ci, cj)) continue;
      const fy = nav.floorAt(x, z);
      if (Math.abs(fy - b.pos[1]) > 3) continue;
      // Must see the bomb even crouched, so a defuser can't hide from us.
      if (!world.visible(x, fy + DUCK_EYE, z, bx, by, bz)) continue;
      // Something solid close by on a side or two: a spot to play off,
      // not the middle of open ground (and not a closed-in corner).
      let walls = 0;
      for (let k = 0; k < 8; k++) {
        const ka = (k * Math.PI) / 4;
        if (!world.visible(x, fy + 1.1, z, x + Math.cos(ka) * 1.6, fy + 1.1, z + Math.sin(ka) * 1.6)) walls++;
      }
      let score = Math.min(walls, 3) * 2 - Math.max(0, walls - 4) * 2 + Math.random() * 2;
      for (const o of taken) if (Math.hypot(o[0] - x, o[1] - z) < 4) score -= 8;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    if (best) {
      this.objSpot = best; this.objSpotKey = key; this.objSpotUntil = Infinity; this.path = null;
    } else {
      const r = far ? 12 : 7;
      this.pickSpot(key, { min: [bx - r, bz - r], max: [bx + r, bz + r] });
    }
    this.guardDuck = Math.random() < this.style.crouch;
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
    const allies = this.allies();
    let best = null, bestScore = Infinity;
    let noise = null, noiseD = Infinity;
    let seen = 0;
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
        seen++;
        // Score in metres: the nearest enemy wins unless someone else is
        // shooting us, we're already on someone, or our team already has
        // that one covered.
        let score = d;
        if (recentlyHurtBy) score -= 15;
        if (this.target === o.id && this.targetVisible) score -= 6;
        // Is it looking at us? Then it's the bigger threat.
        const of = forwardVec(o.yaw);
        if (-(dx * of[0] + dz * of[2]) / (d || 1) > 0.9) score -= 4;
        let on = 0;
        for (const b of allies) if (b.target === o.id && b.targetVisible) on++;
        score += on * (g.mode === 'ffa' ? 5 : 9);
        // A per-bot, per-enemy preference that doesn't flicker.
        score += ((Math.sin(this.bias + o.id * 12.9898) * 43758.5453) % 1 + 1) % 1 * 6;
        if (score < bestScore) { bestScore = score; best = o; }
      } else if ((heard || recentlyHurtBy) && !this.targetVisible && d < noiseD) {
        noise = o; noiseD = d;
      }
    }
    // A shot we heard: not every bot comes running. Close noise and being
    // shot always count; otherwise it depends on the role and on how many of
    // our team are already heading over there.
    if (noise && !best && t >= this.ignoreNoiseUntil) {
      const hurt = p.lastAttacker === noise.id && t - p.lastHurtTime < 1.5;
      let crowd = 0;
      for (const b of allies) {
        const s = b.investigating && b.lastSeenPos;
        if (s && Math.hypot(s[0] - noise.pos[0], s[2] - noise.pos[2]) < 10) crowd++;
      }
      const go = hurt || noiseD < 8 || (crowd < 2 && Math.random() < this.style.curiosity);
      if (go) {
        // Come at it from our own angle, not the exact spot.
        const off = noiseD > 10 ? 2 + Math.random() * 4 : 0;
        const a = Math.random() * Math.PI * 2;
        this.lastSeenPos = [noise.pos[0] + Math.cos(a) * off, noise.pos[1], noise.pos[2] + Math.sin(a) * off];
        this.lastSeenTime = t - 1.5;
        this.investigating = true;
      } else {
        // Decided to stay put: don't reconsider every scan.
        this.ignoreNoiseUntil = t + 2 + Math.random() * 2;
      }
    }
    this.enemiesSeen = seen;
    if (best) {
      if (this.target !== best.id || !this.targetVisible) {
        this.reactionUntil = t + this.skill.reaction * (0.75 + Math.random() * 0.5);
        const e = this.skill.aimError;
        this.aimErr = [(Math.random() * 2 - 1) * e, (Math.random() * 2 - 1) * e * 0.6];
        this.aimHead = Math.random() < this.skill.head;
        this.crouchFire = Math.random() < this.style.crouch;
      }
      this.target = best.id;
      this.targetVisible = true;
      // Defending a bomb site: call out where Red is.
      if (g.objective === 'bomb' && p.team === 'blue' && g.bomb.state !== 'planted' && g.round.state === 'live') {
        for (const [k, r] of Object.entries(g.map.sites)) {
          if (best.pos[0] > r.min[0] - 8 && best.pos[0] < r.max[0] + 8 && best.pos[2] > r.min[1] - 8 && best.pos[2] < r.max[1] + 8) {
            const plan = this.plan();
            if (plan.called !== k || t - plan.calledAt > 5) { plan.called = k; plan.calledAt = t; }
          }
        }
      }
      this.lastSeenPos = [...best.pos];
      this.lastSeenTime = t;
      this.investigating = false;
      this.path = null;
    } else {
      this.targetVisible = false;
    }
    const prev = this.dropGoal;
    this.dropGoal = this.pickDrop()?.id ?? null;
    if (this.dropGoal !== prev) this.path = null;
  }

  // Where an ally is heading, as [x, z].
  static heading(b) {
    if (b.roamGoal) return [b.roamGoal[0], b.roamGoal[2]];
    if (b.objSpot) return b.objSpot;
    if (b.viaFor) return b.viaFor;
    return [b.p.pos[0], b.p.pos[2]];
  }

  // Somewhere to wander to when there's nothing else to do: a few random
  // spots, scored by the role. Everyone prefers spots their team isn't
  // already heading for.
  pickRoamGoal() {
    const nav = this.nav, p = this.p, g = this.game;
    const heads = this.allies().map(BotBrain.heading);
    // The team plan pulls the choice somewhere: a rally point to move as a
    // loose group, the enemy's side of the map, or close to where we are.
    const plan = this.plan();
    let pull = null, pullW = 0;
    if (plan.name === 'group') {
      if (!plan.rally || g.time > plan.rallyUntil) {
        plan.rally = nav.randomOpenPoint(Math.random);
        plan.rallyUntil = g.time + 15 + Math.random() * 15;
      }
      pull = plan.rally; pullW = 1.2;
    } else if (plan.name === 'push' && g.mode === 'teams') {
      const es = g.map.teamSpawns?.[p.team === 'red' ? 'blue' : 'red'];
      if (es?.length) { const s = es[Math.floor(Math.random() * es.length)].pos; pull = [s[0], s[2]]; pullW = 0.8; }
    } else if (plan.name === 'hold') {
      pull = [p.pos[0], p.pos[2]]; pullW = 1;
    }
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const [x, z] = nav.randomOpenPoint(Math.random);
      const [ci, cj] = nav.cellOf(x, z);
      if (!nav.isMain(ci, cj)) continue;
      const self = Math.hypot(x - p.pos[0], z - p.pos[2]);
      let apart = 40;
      for (const h of heads) apart = Math.min(apart, Math.hypot(x - h[0], z - h[1]));
      let score = Math.min(apart, 25) * (this.role === 'lurk' ? 2 : 1);
      if (this.role === 'rush') score += Math.min(self, 40) * 0.6;
      else if (this.role === 'anchor') score -= Math.max(0, self - 20) * 0.8;
      if (pull) score -= Math.max(0, Math.hypot(x - pull[0], z - pull[1]) - 8) * pullW;
      score += Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = [x, 0, z]; }
    }
    return best ?? [...p.pos];
  }

  // A path to goal ([x, y, z]); flankers and lurkers go round by a detour
  // point, kept for as long as the goal stays roughly the same.
  // detour: true lets the role decide, false never, +1 / -1 always, on that
  // side of the straight line.
  routeTo(goal, detour) {
    const nav = this.nav, p = this.p;
    const gx = goal[0], gz = goal[2] ?? goal[1];
    if (!this.viaFor || Math.hypot(this.viaFor[0] - gx, this.viaFor[1] - gz) > 6) {
      this.viaFor = [gx, gz];
      this.via = detour ? this.pickVia(gx, gz, detour === true ? 0 : detour) : null;
    }
    if (Array.isArray(this.via)) {
      const a = nav.findPath(p.pos[0], p.pos[2], this.via[0], this.via[1]);
      const b = a && nav.findPath(this.via[0], this.via[1], gx, gz);
      if (a && b) return a.concat(b);
      this.via = null;
    }
    return nav.findPath(p.pos[0], p.pos[2], gx, gz);
  }

  // A point off to one side of the straight line to (gx, gz), not too far
  // out of the way, and away from the detours our team is already taking.
  pickVia(gx, gz, sideSign = 0) {
    if (!sideSign && Math.random() >= this.style.detour) return null;
    const nav = this.nav, p = this.p;
    const ax = p.pos[0], az = p.pos[2];
    const L = Math.hypot(gx - ax, gz - az);
    if (L < 14) return null;
    const others = this.allies().map((b) => (Array.isArray(b.via) ? b.via : null)).filter(Boolean);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const [x, z] = nav.randomOpenPoint(Math.random);
      const [ci, cj] = nav.cellOf(x, z);
      if (!nav.isMain(ci, cj)) continue;
      const detour = (Math.hypot(x - ax, z - az) + Math.hypot(gx - x, gz - z)) / L;
      if (detour < 1.12 || detour > 1.7) continue;
      const cross = ((gx - ax) * (z - az) - (gz - az) * (x - ax)) / L;
      if (sideSign && Math.sign(cross) !== sideSign) continue;
      const side = Math.abs(cross);
      if (side < L * 0.2) continue;
      let apart = 20;
      for (const o of others) apart = Math.min(apart, Math.hypot(x - o[0], z - o[1]));
      const score = side + apart - detour * 8;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    return best;
  }

  // Steer dir ([x, z]) away from friendlies closer than radius (in FFA, from
  // anyone but our target).
  spreadOut(dir, radius, weight) {
    const g = this.game, p = this.p;
    let px = 0, pz = 0;
    for (const o of g.players) {
      if (o === p || !o.alive || o.id === this.target) continue;
      if (g.mode !== 'ffa' && isEnemy(p, o)) continue;
      const dx = p.pos[0] - o.pos[0], dz = p.pos[2] - o.pos[2];
      const d = Math.hypot(dx, dz);
      if (d >= radius || Math.abs(o.pos[1] - p.pos[1]) > 2) continue;
      const k = (1 - d / radius) / (d || 0.01);
      px += dx * k; pz += dz * k;
    }
    if (!px && !pz) return dir;
    const x = dir[0] + px * weight, z = dir[1] + pz * weight;
    const n = Math.hypot(x, z);
    return n > 1e-3 ? [x / n, z / n] : dir;
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

  // Spend our own money, like a player: a gun first (one that still leaves
  // enough for armor, if we're buying armor), then Kevlar + helmet (or just
  // the vest, if that's all we can afford), then a kit on Blue. Whether a bot
  // bothers with armor at all is rolled each life by difficulty.
  buyLoadout(rand = Math.random) {
    const g = this.game, p = this.p;
    const wantArmor = rand() < this.skill.armor;
    const armorCost = p.armor >= 100 ? (p.helmet ? 0 : 350) : GEAR.kevlarHelmet.price;
    let boughtGun = false;
    // A bot that survived the last round keeps its gun, like everyone else.
    if (!p.weapons.primary) {
      const budget = p.money - (wantArmor ? armorCost : 0);
      let pick = PRIMARY_POOL[Math.floor(rand() * PRIMARY_POOL.length)];
      if (WEAPONS[pick].price > budget) {
        // Can't have that one: the best we can afford that leaves armor money,
        // or failing that anything we can afford at all.
        let ok = PRIMARY_POOL.filter((id) => WEAPONS[id].price <= budget);
        if (!ok.length && !wantArmor) ok = PRIMARY_POOL.filter((id) => WEAPONS[id].price <= p.money);
        pick = ok.length ? ok[Math.floor(rand() * ok.length)] : null;
      }
      if (pick) boughtGun = g.buy(p, pick, true);
    }
    else if (p.weapons.primary) g.buyAmmo(p, 'primary', true); // kept gun: top up its ammo
    if (wantArmor && !g.buy(p, 'kevlarHelmet', true) && p.armor < 100) g.buy(p, 'kevlar', true);
    if (g.objective === 'bomb' && p.team === 'blue') g.buy(p, 'defuser', true);
    if (boughtGun && p.weapons.secondary?.id !== 'deagle' && rand() < 0.3 && p.money >= WEAPONS.deagle.price + 500) {
      g.buy(p, 'deagle', true);
      g.switchTo(p, 'primary', true);
    }
  }
}
