// Objective rounds: bomb defusal and hostage rescue. Active when the game is
// in Teams mode on a map whose type is 'bomb' or 'hostage'.
//
// Red attacks: it gets the bomb and plants it at site A or B, or keeps Blue
// from leading the hostages out. Blue defends the sites and defuses, or
// rescues the hostages. A round ends when a side is wiped out, the bomb goes
// off or is defused, every hostage is rescued, or time runs out (Blue wins a
// bomb round on time, Red wins a hostage round on time).
//
// Like everything in src/sim this has no DOM, so the server runs it too.
import {
  U, ROUND_WIN_LIMIT, ROUND_FREEZE, ROUND_END_TIME, ROUND_TIME, LATE_JOIN, NEVER,
  BOMB_TIMER, PLANT_TIME, DEFUSE_TIME, DEFUSE_KIT_TIME, DEFUSE_RANGE, BOMB_RADIUS, BOMB_DAMAGE,
  BOMB_PLANT_REWARD, HOSTAGE_USE_RANGE, HOSTAGE_FOLLOW_DIST, HOSTAGE_SPEED, HOSTAGE_RESCUE_REWARD,
  MAX_MONEY,
} from './constants.js';
import { movePlayer, forwardVec } from './movement.js';

export const OBJECTIVES = ['bomb', 'hostage'];

export function objectiveFor(mode, map) {
  return mode === 'teams' && OBJECTIVES.includes(map.type) ? map.type : null;
}

function inRect(r, x, z, pad = 0) {
  return x >= r.min[0] - pad && x <= r.max[0] + pad && z >= r.min[1] - pad && z <= r.max[1] + pad;
}

// Which bomb site (if any) a position is in.
export function siteAt(map, pos) {
  for (const [name, r] of Object.entries(map.sites ?? {})) if (inRect(r, pos[0], pos[2])) return name;
  return null;
}

export function inRescueZone(map, pos) {
  return (map.rescue ?? []).some((r) => inRect(r, pos[0], pos[2]));
}

export function emptyRound() {
  return { n: 0, state: 'none', freezeEnd: 0, endsAt: 0, nextAt: 0, winner: null, reason: null };
}

export function emptyBomb() {
  return { state: 'none', carrier: null, pos: null, site: null, explodeAt: 0, defuser: null, defuseEnd: 0 };
}

// ---------- Rounds ----------

export function startRound(g) {
  const r = g.round;
  r.n++;
  r.state = 'freeze';
  r.freezeEnd = g.time + ROUND_FREEZE;
  r.endsAt = r.freezeEnd + ROUND_TIME[g.objective];
  r.nextAt = 0;
  r.winner = null;
  r.reason = null;
  g.drops = [];
  for (const p of g.players) {
    g.spawn(p);
    p.frozenUntil = r.freezeEnd;
  }
  g.bomb = emptyBomb();
  g.hostages = [];
  if (g.objective === 'bomb') {
    // Red's plan for the round, which its bots follow.
    g.plan = g.rand() < 0.5 ? 'A' : 'B';
    giveBomb(g);
  } else {
    g.hostages = (g.map.hostages ?? []).map((pos, i) => newHostage(i + 1, pos));
  }
  g.emit({ type: 'roundStart', n: r.n });
}

// The bomb goes to a random Red player, humans first in line like CS.
function giveBomb(g) {
  const reds = g.players.filter((p) => p.alive && p.team === 'red');
  if (!reds.length) return;
  const humans = reds.filter((p) => !p.isBot);
  const pool = humans.length ? humans : reds;
  const p = pool[Math.floor(g.rand() * pool.length)];
  g.bomb.state = 'carried';
  g.bomb.carrier = p.id;
  g.bomb.pos = [...p.pos];
}

export function endRound(g, winner, reason) {
  const r = g.round;
  if (r.state === 'end') return;
  r.state = 'end';
  r.winner = winner;
  r.reason = reason;
  r.nextAt = g.time + ROUND_END_TIME;
  g.rounds[winner]++;
  for (const p of g.players) p.task = null;
  g.bomb.defuser = null;
  g.emit({ type: 'roundEnd', winner, reason, n: r.n });
  if (g.rounds[winner] >= ROUND_WIN_LIMIT && g.match.state === 'live') {
    r.nextAt = NEVER;
    g.endMatch(null, winner);
  }
}

// May this dead player spawn right now? Only before a round goes live (or
// just after: joining LATE_JOIN seconds into a round still gets you in).
export function canSpawnNow(g) {
  const r = g.round;
  return r.state === 'freeze' || (r.state === 'live' && g.time - r.freezeEnd < LATE_JOIN);
}

// Round clock, run before the players move.
export function preTick(g) {
  const r = g.round;
  if (r.state === 'freeze' && g.time >= r.freezeEnd) {
    r.state = 'live';
    g.emit({ type: 'roundLive', n: r.n });
  } else if (r.state === 'end' && g.time >= r.nextAt && g.match.state === 'live') {
    startRound(g);
  }
}

// ---------- Per player ----------

// The use key (E): hold to plant or defuse, press to lead a hostage.
export function playerUse(g, p, cmd) {
  const pressed = cmd.use && !p.useHeld;
  p.useHeld = !!cmd.use;
  const live = g.round.state === 'live' && g.match.state === 'live';
  const b = g.bomb;
  if (g.objective === 'bomb') {
    if (p.task) {
      const ok = cmd.use && live && (p.task.kind === 'plant' ? canPlant(g, p) : b.state === 'planted' && b.defuser === p.id && nearBomb(p, b));
      if (!ok) {
        if (p.task.kind === 'defuse' && b.defuser === p.id) b.defuser = null;
        p.task = null;
        g.emit({ type: 'taskCancel', pid: p.id });
      } else if (g.time >= p.task.end) {
        p.task.kind === 'plant' ? plant(g, p) : defuse(g, p);
      }
    } else if (cmd.use && live) {
      if (canPlant(g, p)) {
        p.task = { kind: 'plant', start: g.time, end: g.time + PLANT_TIME };
        g.emit({ type: 'plantStart', pid: p.id });
      } else if (p.team === 'blue' && b.state === 'planted' && !b.defuser && nearBomb(p, b)) {
        const t = p.defuser ? DEFUSE_KIT_TIME : DEFUSE_TIME;
        p.task = { kind: 'defuse', start: g.time, end: g.time + t };
        b.defuser = p.id;
        b.defuseEnd = p.task.end;
        g.emit({ type: 'defuseStart', pid: p.id, kit: !!p.defuser });
      }
    }
  } else if (g.objective === 'hostage' && pressed && g.round.state !== 'end') {
    const h = hostageInReach(g, p);
    if (!h) return;
    if (h.state === 'follow' && h.leader === p.id) {
      h.state = 'idle'; h.leader = null;
      g.emit({ type: 'hostageStop', pid: p.id, id: h.id });
    } else if (p.team === 'blue') {
      h.state = 'follow'; h.leader = p.id; h.path = null; h.repathAt = 0;
      g.emit({ type: 'hostageFollow', pid: p.id, id: h.id });
    }
  }
}

export function canPlant(g, p) {
  return g.bomb.state === 'carried' && g.bomb.carrier === p.id && p.onGround && !!siteAt(g.map, p.pos);
}

function nearBomb(p, b) {
  return b.pos && Math.hypot(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]) < DEFUSE_RANGE && Math.abs(p.pos[1] - b.pos[1]) < 1.6;
}

export function canDefuse(g, p) {
  const b = g.bomb;
  return p.alive && p.team === 'blue' && b.state === 'planted' && (!b.defuser || b.defuser === p.id) && nearBomb(p, b);
}

// The hostage you're looking at and close enough to lead (or let go).
export function hostageInReach(g, p) {
  const f = forwardVec(p.yaw);
  let best = null, bestScore = Infinity;
  for (const h of g.hostages) {
    if (h.state === 'rescued') continue;
    const dx = h.pos[0] - p.pos[0], dz = h.pos[2] - p.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > HOSTAGE_USE_RANGE || Math.abs(h.pos[1] - p.pos[1]) > 1.5) continue;
    const score = d - (d > 0.01 ? (dx * f[0] + dz * f[2]) / d : 1) * 0.8;
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best;
}

function plant(g, p) {
  const b = g.bomb;
  b.state = 'planted';
  b.carrier = null;
  b.pos = [p.pos[0], p.pos[1], p.pos[2]];
  b.site = siteAt(g.map, p.pos);
  b.explodeAt = g.time + BOMB_TIMER;
  b.defuser = null;
  p.task = null;
  p.money = Math.min(MAX_MONEY, p.money + BOMB_PLANT_REWARD);
  g.emit({ type: 'planted', pid: p.id, site: b.site, pos: b.pos });
}

function defuse(g, p) {
  const b = g.bomb;
  b.state = 'defused';
  b.defuser = null;
  p.task = null;
  g.emit({ type: 'defused', pid: p.id, pos: b.pos });
  endRound(g, 'blue', 'defused');
}

// The carrier walking over a dropped bomb, or any Red player.
export function touchBomb(g, p) {
  const b = g.bomb;
  if (b.state !== 'dropped' || p.team !== 'red') return;
  if (Math.hypot(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]) < 0.9 && Math.abs(p.pos[1] - b.pos[1]) < 1.6) {
    b.state = 'carried';
    b.carrier = p.id;
    g.emit({ type: 'bombPickup', pid: p.id });
  }
}

// Called when the carrier dies, leaves or changes team.
export function dropBomb(g, p) {
  const b = g.bomb;
  if (b.state !== 'carried' || b.carrier !== p.id) return;
  b.state = 'dropped';
  b.carrier = null;
  // Rest it on whatever is under the carrier's feet.
  const h = g.world.raycast(p.pos[0], p.pos[1] + 0.5, p.pos[2], 0, -1, 0, 40);
  b.pos = [p.pos[0], h ? p.pos[1] + 0.5 - h.t : p.pos[1], p.pos[2]];
  g.emit({ type: 'bombDrop', pid: p.id, pos: b.pos });
}

// A player who leaves or dies lets go of the hostages following them.
export function releaseHostages(g, p) {
  for (const h of g.hostages) if (h.leader === p.id && h.state === 'follow') { h.state = 'idle'; h.leader = null; }
}

// ---------- After everyone moved ----------

export function update(g, dt) {
  const b = g.bomb;
  if (b.state === 'carried') {
    const c = g.getPlayer(b.carrier);
    if (c) b.pos = [c.pos[0], c.pos[1], c.pos[2]];
  }
  if (b.state === 'planted' && g.time >= b.explodeAt) explode(g);
  for (const h of g.hostages) updateHostage(g, h, dt);
  if (g.round.state === 'live') checkWin(g);
}

function explode(g) {
  const b = g.bomb;
  b.state = 'exploded';
  b.defuser = null;
  g.emit({ type: 'explode', pos: b.pos });
  for (const p of g.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.pos[0] - b.pos[0], p.pos[1] + 1 - b.pos[1], p.pos[2] - b.pos[2]);
    if (d >= BOMB_RADIUS) continue;
    const dmg = BOMB_DAMAGE * (1 - d / BOMB_RADIUS) ** 2;
    // Armor takes the edge off like a body shot would.
    const absorbed = p.armor > 0 ? Math.min(p.armor * 2, dmg * 0.5) : 0;
    p.armor = Math.max(0, p.armor - absorbed / 2);
    const taken = Math.floor(dmg - absorbed);
    if (taken < 1) continue;
    p.health -= taken;
    p.lastHurtTime = g.time;
    p.lastHitDir = null;
    g.emit({ type: 'hit', attacker: null, victim: p.id, damage: taken, group: 'chest', pos: [p.pos[0], p.pos[1] + 1.2, p.pos[2]], armorHit: absorbed > 0, wallbang: false, weapon: null, from: b.pos });
    if (p.health <= 0) { p.health = 0; g.kill(p, null, null, false, false, 'bomb'); }
  }
  if (g.round.state === 'live') endRound(g, 'red', 'bomb');
}

function checkWin(g) {
  const count = { red: 0, blue: 0 }, alive = { red: 0, blue: 0 };
  for (const p of g.players) {
    if (!(p.team in count)) continue;
    count[p.team]++;
    if (p.alive) alive[p.team]++;
  }
  const both = count.red > 0 && count.blue > 0;
  if (g.objective === 'bomb') {
    const planted = g.bomb.state === 'planted';
    if (!planted && g.time >= g.round.endsAt) return endRound(g, 'blue', 'time');
    if (both && alive.blue === 0) return endRound(g, 'red', 'eliminated');
    if (both && alive.red === 0 && !planted) return endRound(g, 'blue', 'eliminated');
  } else {
    const left = g.hostages.filter((h) => h.state !== 'rescued');
    if (g.hostages.length && !left.length) return endRound(g, 'blue', 'rescued');
    if (g.time >= g.round.endsAt) return endRound(g, 'red', 'time');
    if (both && alive.blue === 0) return endRound(g, 'red', 'eliminated');
    if (both && alive.red === 0) return endRound(g, 'blue', 'eliminated');
  }
}

// ---------- Hostages ----------

function newHostage(id, pos) {
  return {
    id, pos: [...pos], prevPos: [...pos], vel: [0, 0, 0], yaw: Math.PI * 2 * ((id * 0.37) % 1),
    state: 'idle', leader: null, onGround: true, ducked: false, duckAmount: 0, stamina: 0,
    path: null, pathIdx: 0, repathAt: 0, stuck: 0,
  };
}

const STOP = { fwd: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0 };

function updateHostage(g, h, dt) {
  h.prevPos[0] = h.pos[0]; h.prevPos[1] = h.pos[1]; h.prevPos[2] = h.pos[2];
  if (h.state === 'rescued') return;
  const leader = h.state === 'follow' ? g.getPlayer(h.leader) : null;
  if (h.state === 'follow' && (!leader || !leader.alive)) { h.state = 'idle'; h.leader = null; }
  let cmd = { ...STOP, yaw: h.yaw };
  if (leader && leader.alive) {
    const dx = leader.pos[0] - h.pos[0], dz = leader.pos[2] - h.pos[2];
    const dist = Math.hypot(dx, dz);
    if (dist > HOSTAGE_FOLLOW_DIST) {
      let tx = leader.pos[0], tz = leader.pos[2];
      const nav = g.nav;
      if (!nav.walkable(h.pos[0], h.pos[2], tx, tz)) {
        if (!h.path || g.time >= h.repathAt || h.pathIdx >= h.path.length) {
          h.path = nav.findPath(h.pos[0], h.pos[2], tx, tz);
          h.pathIdx = 0;
          h.repathAt = g.time + 0.5;
        }
        while (h.path && h.pathIdx < h.path.length && Math.hypot(h.path[h.pathIdx][0] - h.pos[0], h.path[h.pathIdx][1] - h.pos[2]) < 0.5) h.pathIdx++;
        if (h.path && h.pathIdx < h.path.length) [tx, tz] = h.path[h.pathIdx];
      } else {
        h.path = null;
      }
      h.yaw = Math.atan2(-(tx - h.pos[0]), -(tz - h.pos[2]));
      cmd = { ...STOP, fwd: 1, yaw: h.yaw, walk: dist < HOSTAGE_FOLLOW_DIST + 1 };
      // Hop over whatever we're stuck on.
      if (Math.hypot(h.vel[0], h.vel[2]) < 0.5) h.stuck += dt; else h.stuck = 0;
      if (h.stuck > 0.8 && h.onGround) { cmd.jump = true; h.stuck = 0; h.repathAt = 0; }
    } else {
      h.yaw = Math.atan2(-dx, -dz);
      cmd.yaw = h.yaw;
    }
  }
  if (h.state === 'follow' || !h.onGround || Math.hypot(h.vel[0], h.vel[2]) > 0.01) {
    movePlayer(g.world, h, cmd, dt, HOSTAGE_SPEED * U);
  }
  if (h.state === 'follow' && inRescueZone(g.map, h.pos)) {
    h.state = 'rescued';
    if (leader) leader.money = Math.min(MAX_MONEY, leader.money + HOSTAGE_RESCUE_REWARD);
    g.emit({ type: 'rescued', pid: h.leader, id: h.id });
    h.leader = null;
  }
}

// ---------- Network ----------

// What clients need to draw the objective (sent with every snapshot).
export function objectiveInfo(g) {
  if (!g.objective) return null;
  const b = g.bomb;
  return {
    kind: g.objective,
    round: g.round,
    rounds: g.rounds,
    bomb: { state: b.state, carrier: b.carrier, pos: b.pos, site: b.site, explodeAt: b.explodeAt, defuser: b.defuser, defuseEnd: b.defuseEnd },
    hostages: g.hostages.map((h) => ({ id: h.id, pos: h.pos, yaw: h.yaw, state: h.state, leader: h.leader, vel: h.vel })),
  };
}

// The client side of objectiveInfo.
export function applyObjectiveInfo(g, o) {
  if (!o) return;
  g.round = o.round;
  g.rounds = o.rounds;
  g.bomb = o.bomb;
  const old = new Map(g.hostages.map((h) => [h.id, h]));
  g.hostages = o.hostages.map((s) => {
    const h = old.get(s.id) ?? newHostage(s.id, s.pos);
    h.prevPos = h.pos;
    h.pos = s.pos; h.yaw = s.yaw; h.state = s.state; h.leader = s.leader; h.vel = s.vel;
    return h;
  });
}
