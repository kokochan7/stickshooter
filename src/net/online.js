// Browser side of online play. The local Game becomes a mirror of the room's
// Durable Object:
// - our own player is predicted: every 128 Hz tick we run Game.moveStep with
//   the cmd we just sent, and when a snapshot arrives we take the server's
//   state and replay the cmds it hasn't consumed yet;
// - everyone else is drawn INTERP_DELAY in the past, interpolated between
//   the two snapshots around that time;
// - our own gun is predicted too (CS 1.6's client weapon prediction): the
//   shot, its tracer and impacts, the recoil and the ammo happen the moment
//   we click, using the same per-shot random seed the server uses, so the
//   spread lands in the same place on both;
// - hits and kills come from server events, so the server decides every hit
//   (with lag compensation, see worker/room.js).
import { SEND_EVERY, INTERP_DELAY, DEFAULT_ROOM, PROTOCOL_VERSION } from './protocol.js';
import { applyObjectiveInfo } from '../sim/objective.js';
import { TICK_DT } from '../sim/constants.js';

const PING_EVERY = 2000;
// Our own events the browser predicts. The server's copies are dropped when
// they match one we already showed.
const PREDICTED = new Set(['shot', 'dry', 'deploy', 'reload', 'reloaded', 'shell', 'zoom']);
// A prediction the server hasn't confirmed after this long never will be.
const PREDICT_EXPIRE = 1500;

// { rooms: { [room]: humans }, maps: { [room]: map id } } for the quick play
// rooms, or null if the server can't say.
export async function fetchRoomCounts() {
  try {
    const res = await fetch('/api/rooms', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return { rooms: j.rooms ?? {}, maps: j.maps ?? {} };
  } catch {
    return null;
  }
}

export function roomUrl(room = DEFAULT_ROOM) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/${encodeURIComponent(room)}`;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class OnlineSession {
  // onMap(mapId) runs before onWelcome when the room plays another map.
  // onAdmin({ ok, lines, auth }) gets admin console replies.
  constructor(game, { url, name, map, onWelcome, onClose, onRemove, onMap, onAdmin }) {
    this.game = game;
    this.onMap = onMap;
    this.onAdmin = onAdmin;
    this.onWelcome = onWelcome;
    this.onClose = onClose;
    this.onRemove = onRemove; // (playerId) => void, to drop its view
    this.myId = null;
    this.me = null;
    this.seq = 0;
    this.pending = []; // cmds sent but not yet consumed by the server
    this.outbox = [];
    this.snaps = []; // { time, players: Map<id, state> } for interpolation
    this.events = [];
    this.offset = null; // server time - local time
    this.rtt = 0;
    this.closed = false;
    // Server time our newest cmd will run at (our own gun's clock).
    this.predTime = 0;
    this.predicted = []; // { type, weapon, at } shown locally, not yet confirmed

    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION, name, map });
    this.ws.onmessage = (e) => this.receive(JSON.parse(e.data));
    this.ws.onclose = (e) => this.finish(e.reason || (this.myId ? 'Disconnected' : 'Could not reach the server'));
    this.pinger = setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_EVERY);
  }

  get ready() { return this.me !== null; }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    this.ws.onclose = null;
    this.ws.close();
  }

  finish(reason) {
    if (this.closed) return;
    this.close();
    this.onClose?.(reason);
  }

  // Our best guess of the server's clock right now.
  serverTime() {
    return performance.now() / 1000 + (this.offset ?? 0);
  }

  viewTime() {
    return this.serverTime() - INTERP_DELAY;
  }

  receive(msg) {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.id;
        this.onMap?.(msg.map);
        this.game.setMode(msg.mode ?? 'ffa');
        this.syncClock(msg.time);
        break;
      case 'snap':
        this.applySnapshot(msg);
        break;
      case 'map':
        // An admin changed the map; the room restarts the match on it.
        this.onMap?.(msg.map);
        this.snaps = [];
        break;
      case 'admin':
        this.onAdmin?.(msg);
        break;
      case 'pong':
        this.rtt = performance.now() - msg.c;
        break;
      case 'full':
        this.finish('That room is full');
        break;
    }
  }

  syncClock(serverTime) {
    const sample = serverTime - performance.now() / 1000;
    // Snapshots arrive late by a varying amount, so trust the earliest-looking
    // (largest) offset and drift slowly when the network gets better/worse.
    if (this.offset === null || Math.abs(sample - this.offset) > 0.5) this.offset = sample;
    else this.offset = sample > this.offset ? sample : lerp(this.offset, sample, 0.02);
  }

  mirror(state) {
    // Mirror players use the server's id; addPlayer just gives us a fully
    // formed player object to fill in.
    const p = this.game.addPlayer({ name: state.name, team: state.team, isBot: state.isBot });
    p.id = state.id;
    return p;
  }

  applySnapshot(msg) {
    const g = this.game;
    this.syncClock(msg.time);

    // Roster: add newcomers, drop leavers.
    const seen = new Set();
    for (const s of msg.players) {
      seen.add(s.id);
      if (!g.getPlayer(s.id)) this.mirror(s);
    }
    for (const p of [...g.players]) {
      if (!seen.has(p.id)) { g.removePlayer(p.id); this.onRemove?.(p.id); }
    }

    // Others: everything but position comes straight from the snapshot.
    const states = new Map();
    for (const s of msg.players) {
      states.set(s.id, s);
      if (s.id === this.myId) continue;
      const p = g.getPlayer(s.id);
      p.name = s.name; p.team = s.team; p.alive = s.alive; p.health = s.health;
      p.kills = s.kills; p.deaths = s.deaths; p.headshots = s.headshots;
      p.onGround = s.onGround; p.ducked = s.ducked; p.reloading = s.reloading; p.zoom = s.zoom; p.spin = s.spin;
      p.active = s.active; p.swimming = s.swimming;
      p.weapons = { primary: null, secondary: null, melee: null, grenade: null, [s.active]: s.weapon ? { id: s.weapon, clip: 0, reserve: 0 } : null };
    }
    if (msg.match) {
      const { teamKills, ...match } = msg.match;
      g.match = match;
      g.teamKills = teamKills;
    }
    if ('obj' in msg) applyObjectiveInfo(g, msg.obj);
    if (msg.drops) {
      g.drops = msg.drops.map((d) => ({
        id: d.id, weapon: { id: d.w, clip: 0, reserve: 0 }, pos: d.pos, yaw: d.yaw, expiresAt: d.exp,
        rest: true, vel: [0, 0, 0], noPickup: { pid: 0, until: 0 },
      }));
    }
    if (msg.nades) {
      // Drawn from the snapshot and carried forward between them (stepNades).
      const old = new Map(g.nades.map((n) => [n.id, n]));
      g.nades = msg.nades.map((n) => {
        const o = old.get(n.id);
        return { id: n.id, pos: [...n.pos], prevPos: o ? o.pos : [...n.pos], vel: [...n.vel], rest: n.rest };
      });
    }
    this.snaps.push({ time: msg.time, players: states });
    while (this.snaps.length > 2 && this.snaps[1].time < this.viewTime() - 0.5) this.snaps.shift();

    // Us: take the server's word, then replay what it hasn't seen yet.
    const me = g.getPlayer(this.myId);
    if (me) {
      const wasReady = this.me !== null;
      this.me = me;
      Object.assign(me, msg.me);
      this.pending = this.pending.filter((c) => c.seq > msg.ack);
      // The snapshot is the state right after the acked cmd ran at msg.time;
      // each later cmd runs one tick after the one before it.
      let t = msg.time;
      for (const c of this.pending) {
        t += TICK_DT;
        if (!me.alive) continue;
        g.moveStep(me, c.cmd);
        this.stepWeapon(me, c.cmd, t, false);
      }
      this.predTime = t;
      if (!wasReady) {
        me.prevPos = [...me.pos];
        this.onWelcome?.(me);
      }
    }

    const now = performance.now();
    this.predicted = this.predicted.filter((x) => now - x.at < PREDICT_EXPIRE);
    for (const e of msg.events) {
      if (e.pid === this.myId && PREDICTED.has(e.type)) {
        const i = this.predicted.findIndex((x) => x.type === e.type && x.weapon === e.weapon);
        if (i >= 0) { this.predicted.splice(i, 1); continue; }
      }
      this.events.push(e);
    }
  }

  // Run our gun for one cmd at server time t. live: a new cmd, so show what
  // happens (shots, sounds); otherwise we're replaying after a snapshot and
  // only the state needs to catch up.
  stepWeapon(me, cmd, t, live) {
    const g = this.game;
    const saved = g.time;
    g.time = t;
    g.predicting = true;
    g.replaying = !live;
    const n = g.events.length;
    g.updateWeapon(me, g.frozen(me) ? { ...cmd, fire: false, alt: false } : cmd, TICK_DT);
    g.predicting = g.replaying = false;
    g.time = saved;
    if (!live) return;
    const now = performance.now();
    for (const e of g.events.splice(n)) {
      if (!PREDICTED.has(e.type)) continue;
      this.predicted.push({ type: e.type, weapon: e.weapon, at: now });
      this.events.push(e);
    }
  }

  // One 128 Hz client tick: predict ourselves and queue the cmd for the server.
  tick(cmd) {
    const me = this.me;
    if (!me) return;
    const seq = ++this.seq;
    // What we're looking at as we make this cmd; the server rewinds everyone
    // to it when this cmd fires.
    cmd.vt = this.viewTime();
    this.pending.push({ seq, cmd });
    this.outbox.push(cmd);
    me.prevPos[0] = me.pos[0]; me.prevPos[1] = me.pos[1]; me.prevPos[2] = me.pos[2];
    me.prevPunch[0] = me.punch[0]; me.prevPunch[1] = me.punch[1];
    me.prevDuck = me.duckAmount;
    this.predTime += TICK_DT;
    if (me.alive) {
      this.game.moveStep(me, cmd);
      this.stepWeapon(me, cmd, this.predTime, true);
    }
    if (this.outbox.length >= SEND_EVERY) {
      this.send({ t: 'cmds', seq, vt: this.viewTime(), cmds: this.outbox });
      this.outbox = [];
    }
    if (this.pending.length > 256) this.pending.splice(0, this.pending.length - 256);
  }

  // Place remote players at viewTime(). Call once per rendered frame.
  interpolate() {
    const snaps = this.snaps;
    if (!snaps.length) return;
    const t = this.viewTime();
    let a = snaps[0], b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].time <= t) a = snaps[i];
      if (snaps[i].time >= t) { b = snaps[i]; break; }
      b = snaps[i];
    }
    const f = b.time > a.time ? Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time))) : 1;
    for (const p of this.game.players) {
      if (p.id === this.myId) continue;
      const sa = a.players.get(p.id) ?? b.players.get(p.id);
      const sb = b.players.get(p.id) ?? sa;
      if (!sa) continue;
      // Don't slide someone across the map when they respawn.
      const k = sa.alive === sb.alive ? f : 1;
      const pos = [lerp(sa.pos[0], sb.pos[0], k), lerp(sa.pos[1], sb.pos[1], k), lerp(sa.pos[2], sb.pos[2], k)];
      p.pos = pos;
      p.prevPos = pos;
      p.vel = [lerp(sa.vel[0], sb.vel[0], k), lerp(sa.vel[1], sb.vel[1], k), lerp(sa.vel[2], sb.vel[2], k)];
      p.yaw = lerpAngle(sa.yaw, sb.yaw, k);
      p.pitch = lerp(sa.pitch, sb.pitch, k);
      p.duckAmount = lerp(sa.duckAmount, sb.duckAmount, k);
      p.prevDuck = p.duckAmount;
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
