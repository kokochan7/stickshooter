// One Durable Object per room. It runs the same src/sim Game the browser runs
// offline, at the same fixed 128 Hz, and is the authority on every hit.
//
// Each tick it consumes one cmd per human (Quake/CS style cmd queue), lets
// server-side bots think, ticks the Game, and every SNAP_EVERY ticks sends each
// client a snapshot with the last cmd seq it consumed so the client can
// reconcile its prediction.
import { DurableObject } from 'cloudflare:workers';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain } from '../src/sim/bot.js';
import { runAdmin, MAX_BOTS } from '../src/sim/admin.js';
import { TICK_DT, TICK_RATE } from '../src/sim/constants.js';
import { MAPS, getMap, DEFAULT_MAP } from '../src/maps/index.js';
import {
  PROTOCOL_VERSION, SNAP_EVERY, MAX_LAG_COMP, MAX_HUMANS, BOT_FILL,
  packOwn, packOther, packDrops, sanitizeCmd, cleanName, cleanMap, roomMode,
} from '../src/net/protocol.js';

const BOT_NAMES = ['Inkblot', 'Doodle', 'Scribble', 'Smudge', 'Sketch', 'Graphite', 'Charcoal', 'Pencil', 'Eraser', 'Crayon', 'Marker', 'Quill'];
// Wrong admin passwords a connection may try before it's ignored.
const MAX_ADMIN_FAILS = 5;
const MAX_QUEUE = 16; // cmds accepted per client before old ones are dropped
// Client and server clocks drift, so a queue can slowly fill up. Beyond this
// many cmds (~30 ms) we fold the oldest into the next one instead of letting
// the extra latency build up.
const QUEUE_TARGET = 4;
const HISTORY = Math.ceil(MAX_LAG_COMP / TICK_DT) + 2;
const LOOP_MS = 1000 / 64;

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game(getMap(DEFAULT_MAP));
    this.clients = new Map(); // ws -> client
    this.brains = new Map(); // bot id -> BotBrain
    this.history = []; // recent tick states for lag compensation
    this.loop = null;
    // Bot count an admin asked for (null = the usual BOT_FILL), and their skill.
    this.botTarget = null;
    this.difficulty = 'normal';
    this.game.lagComp = (shooter) => this.rewind(shooter);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    // The room's name decides its mode (public = FFA, public-teams = Teams).
    // The socket remembers it in case the object hibernates before hello.
    const room = decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '').toLowerCase();
    const mode = roomMode(room);
    if (!this.humans() && this.game.mode !== mode) this.game.setMode(mode);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ mode });
    if (this.humans() >= MAX_HUMANS) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4001, 'Room is full');
    } else {
      this.clients.set(server, this.newClient());
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  newClient() {
    return { player: null, queue: [], last: emptyCmd(), ack: 0, viewTime: 0, adminFails: 0 };
  }

  // RPC for GET /api/rooms.
  humanCount() { return this.humans(); }
  roomInfo() { return { humans: this.humans(), map: this.game.map.id }; }

  humans() {
    let n = 0;
    for (const c of this.clients.values()) if (c.player) n++;
    return n;
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 16384) return;
    // A socket can outlive our in-memory state if the object hibernated
    // between connecting and saying hello.
    let c = this.clients.get(ws);
    if (!c) this.clients.set(ws, (c = this.newClient()));
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.t === 'hello' && !c.player) {
      // A tab still running an older build can't play with the new one, and
      // would otherwise end up alone; tell it to refresh.
      if (msg.v !== PROTOCOL_VERSION) {
        ws.close(4002, 'A new version is out. Refresh the page to play online.');
        this.clients.delete(ws);
        return;
      }
      const mode = ws.deserializeAttachment()?.mode;
      const first = !this.humans();
      // The first person into an empty room picks the map.
      const map = cleanMap(msg.map, MAPS);
      if (first && map && map !== this.game.map.id) this.game.setMap(MAPS[map]);
      if (mode && first && this.game.mode !== mode) this.game.setMode(mode);
      const p = this.game.addPlayer({ name: cleanName(msg.name) });
      c.player = p;
      this.fillBots();
      // The first person into an empty room starts a fresh match; anyone
      // else joins the one in progress. Either way there's a short countdown.
      if (first) this.game.restartMatch();
      else this.game.join(p);
      ws.send(JSON.stringify({
        t: 'welcome', v: PROTOCOL_VERSION, id: p.id, mode: this.game.mode, map: this.game.map.id, time: this.game.time,
        tickRate: TICK_RATE, snapEvery: SNAP_EVERY,
      }));
      this.start();
    } else if (msg.t === 'cmds' && c.player && Array.isArray(msg.cmds)) {
      const cmds = msg.cmds.slice(-MAX_QUEUE);
      const firstSeq = (msg.seq | 0) - cmds.length + 1;
      cmds.forEach((cmd, i) => {
        const seq = firstSeq + i;
        if (seq > c.ack + c.queue.length) c.queue.push({ seq, cmd: sanitizeCmd(cmd) });
      });
      // A client that falls far behind skips ahead instead of lagging forever.
      while (c.queue.length > MAX_QUEUE) c.ack = c.queue.shift().seq;
      if (Number.isFinite(msg.vt)) c.viewTime = msg.vt;
    } else if (msg.t === 'admin' && c.player) {
      this.admin(ws, c, msg);
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: msg.c, time: this.game.time }));
    }
  }

  // Admin console. Only someone who knows the ADMIN_KEY secret (set on the
  // Worker in Cloudflare) can run commands; everyone else gets a polite no.
  async admin(ws, c, msg) {
    const reply = (ok, lines, extra = {}) => ws.send(JSON.stringify({ t: 'admin', ok, lines, ...extra }));
    const secret = this.env.ADMIN_KEY;
    if (!secret) return reply(false, ['Admin is not set up on this server (no ADMIN_KEY secret).']);
    if (c.adminFails >= MAX_ADMIN_FAILS) return reply(false, ['Too many wrong passwords. Reconnect to try again.']);
    if (typeof msg.key !== 'string' || !(await sameSecret(msg.key, secret))) {
      c.adminFails++;
      return reply(false, ['Not authorized. Type: login <password>'], { auth: false });
    }
    if (msg.login) return reply(true, ['Logged in as admin. Type help for commands.'], { auth: true });
    const res = runAdmin(this.game, this.adminHost(), c.player, String(msg.line ?? '').slice(0, 200));
    reply(res.ok, res.lines, { auth: true });
  }

  adminHost() {
    return {
      maps: MAPS,
      botCount: () => this.brains.size,
      setBots: (n) => {
        this.botTarget = Math.max(0, Math.min(MAX_BOTS, n));
        this.fillBots();
        return this.brains.size;
      },
      setDifficulty: (d) => {
        this.difficulty = d;
        for (const b of this.brains.values()) b.setDifficulty(d);
      },
      changeMap: (id) => {
        const g = this.game;
        g.setMap(MAPS[id]);
        for (const [pid, b] of this.brains) this.brains.set(pid, new BotBrain(g, g.getPlayer(pid), null, this.difficulty));
        this.history = [];
        g.restartMatch();
        const msg = JSON.stringify({ t: 'map', map: id });
        for (const [ws, c] of this.clients) if (c.player) try { ws.send(msg); } catch { /* closed */ }
      },
    };
  }

  webSocketClose(ws) { this.drop(ws); }
  webSocketError(ws) { this.drop(ws); }

  drop(ws) {
    const c = this.clients.get(ws);
    this.clients.delete(ws);
    if (c?.player) this.game.removePlayer(c.player.id);
    this.fillBots();
    if (!this.humans()) this.stop();
  }

  // Keep the room at BOT_FILL players (bots leave as humans join), or at the
  // bot count an admin set. An empty room forgets the admin's count.
  fillBots() {
    const humans = this.humans();
    if (!humans) this.botTarget = null;
    const want = !humans ? 0 : this.botTarget ?? Math.max(0, BOT_FILL - humans);
    while (this.brains.size > want) {
      const id = [...this.brains.keys()].pop();
      this.brains.delete(id);
      this.game.removePlayer(id);
    }
    while (this.brains.size < want) {
      const used = new Set(this.game.players.map((p) => p.name));
      let name = BOT_NAMES.find((n) => !used.has(n));
      for (let i = 2; !name; i++) name = BOT_NAMES.map((n) => `${n} ${i}`).find((n) => !used.has(n));
      const p = this.game.addPlayer({ name, isBot: true });
      this.brains.set(p.id, new BotBrain(this.game, p, null, this.difficulty));
    }
  }

  start() {
    if (this.loop) return;
    this.last = Date.now();
    this.acc = 0;
    // Workers timers are coarse, so each wakeup runs however many 128 Hz ticks
    // are due. The interval also keeps the object awake while people play.
    this.loop = setInterval(() => this.step(), LOOP_MS);
  }

  stop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  step() {
    const now = Date.now();
    this.acc += (now - this.last) / 1000;
    this.last = now;
    let n = 0;
    while (this.acc >= TICK_DT && n++ < 16) {
      this.acc -= TICK_DT;
      this.tick();
    }
    if (this.acc > TICK_DT) this.acc = 0; // overloaded: drop time rather than spiral
  }

  tick() {
    const g = this.game;
    const cmds = new Map();
    for (const c of this.clients.values()) {
      if (!c.player) continue;
      while (c.queue.length > QUEUE_TARGET) {
        const old = c.queue.shift();
        c.ack = old.seq;
        mergePresses(old.cmd, c.queue[0].cmd);
      }
      const next = c.queue.shift();
      if (next) {
        c.ack = next.seq;
        c.last = next.cmd;
        cmds.set(c.player.id, next.cmd);
      } else {
        // Nothing arrived in time: keep holding the same keys, but don't
        // repeat one-shot presses.
        cmds.set(c.player.id, { ...c.last, reload: false, slot: null, lastWeapon: false, actions: null });
      }
    }
    for (const [id, b] of this.brains) cmds.set(id, b.think(TICK_DT));
    g.tick(cmds);
    this.record();

    this.pendingEvents ??= [];
    for (const e of g.drainEvents()) this.pendingEvents.push(e);
    if (g.tickCount % SNAP_EVERY === 0) this.broadcast();
  }

  broadcast() {
    const g = this.game;
    const players = g.players.map(packOther);
    const match = g.matchInfo();
    const drops = packDrops(g.drops);
    const obj = g.objectiveInfo();
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const [ws, c] of this.clients) {
      if (!c.player) continue;
      try {
        ws.send(JSON.stringify({ t: 'snap', time: g.time, ack: c.ack, me: packOwn(c.player), players, events, match, drops, obj }));
      } catch { /* closed; webSocketClose cleans up */ }
    }
  }

  // ---------- Lag compensation ----------

  record() {
    const g = this.game;
    this.history.push({
      time: g.time,
      players: g.players.map((p) => ({ p, pos: [...p.pos], yaw: p.yaw, ducked: p.ducked, duckAmount: p.duckAmount })),
    });
    if (this.history.length > HISTORY) this.history.shift();
  }

  // Move everyone except the shooter back to where the shooter saw them, and
  // return a function that puts them back.
  rewind(shooter) {
    const c = [...this.clients.values()].find((x) => x.player === shooter);
    if (!c || !this.history.length) return null;
    const t = Math.max(this.game.time - MAX_LAG_COMP, Math.min(this.game.time, c.viewTime));
    let snap = this.history[0];
    for (const h of this.history) if (Math.abs(h.time - t) < Math.abs(snap.time - t)) snap = h;
    const saved = [];
    for (const s of snap.players) {
      const p = s.p;
      if (p === shooter || !p.alive) continue;
      saved.push({ p, pos: p.pos, yaw: p.yaw, ducked: p.ducked, duckAmount: p.duckAmount });
      p.pos = s.pos; p.yaw = s.yaw; p.ducked = s.ducked; p.duckAmount = s.duckAmount;
    }
    return () => {
      for (const s of saved) {
        s.p.pos = s.pos; s.p.yaw = s.yaw; s.p.ducked = s.ducked; s.p.duckAmount = s.duckAmount;
      }
    };
  }
}

// Compare a password with the secret without leaking how much of it matched.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(x, y) : equalBytes(new Uint8Array(x), new Uint8Array(y));
}
function equalBytes(x, y) {
  let d = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// Keep one-shot presses from a cmd we're skipping so a click or key tap
// isn't lost.
function mergePresses(from, into) {
  into.fire ||= from.fire;
  into.alt ||= from.alt;
  into.jump ||= from.jump;
  into.reload ||= from.reload;
  into.lastWeapon ||= from.lastWeapon;
  into.use ||= from.use;
  into.slot ??= from.slot;
  if (from.actions) into.actions = [...from.actions, ...(into.actions ?? [])];
}
