// Online gun prediction: the browser fires its own shots right away and must
// land them exactly where the server does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { RECOIL_SCALE } from '../src/sim/constants.js';
import { OnlineSession } from '../src/net/online.js';
import { packOwn, packOther, sanitizeCmd } from '../src/net/protocol.js';
import { YARD } from '../src/maps/yard.js';

const json = (x) => JSON.parse(JSON.stringify(x));
// Sessions ping on a timer; close them all so the test run can exit.
const sessions = [];
after(() => { for (const n of sessions) n.close(); });

function setup(gun = 'ak47') {
  const server = new Game(YARD, { seed: 1 });
  const a = server.addPlayer({ name: 'A' });
  const b = server.addPlayer({ name: 'B' });
  server.spawn(a); server.spawn(b);
  a.pos = [0, 0, -6]; a.vel = [0, 0, 0]; a.yaw = 0; a.pitch = 0; a.frozenUntil = 0;
  b.pos = [0, 0, -16]; b.yaw = Math.PI; b.frozenUntil = 0; b.health = 1e6;
  server.buy(a, gun, true);
  a.deployEnd = a.nextAttack = 0;
  server.drainEvents();

  const sent = [];
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 1; }
    send(m) { sent.push(JSON.parse(m)); }
    close() {}
  };
  const client = new Game(YARD, { seed: 99 });
  const net = new OnlineSession(client, { url: 'ws://test', name: 'A' });
  sessions.push(net);
  net.receive({ t: 'welcome', id: a.id, mode: 'ffa', map: 'yard', time: server.time });
  const snap = (ack, events) => json({
    t: 'snap', time: server.time, ack, me: packOwn(a), players: server.players.map(packOther),
    events, match: server.matchInfo(), drops: [], nades: [], obj: null,
  });
  net.receive(snap(0, []));
  net.interpolate();
  return { server, a, b, net, snap };
}

// Runs fire for ticks [from, to) with the server LAG ticks behind the client.
function play({ server, a, net, snap }, { ticks = 220, from = 10, to = 150, lag = 12, yaw = (i) => 0, fire = (i) => i >= from && i < to }) {
  const inFlight = [];
  const serverShots = [];
  const clientShots = [];
  let ack = 0, events = [];
  for (let i = 0; i < ticks; i++) {
    const cmd = { ...emptyCmd(), fire: fire(i), yaw: yaw(i), pitch: 0 };
    net.tick(cmd);
    inFlight.push({ seq: net.seq, cmd: sanitizeCmd(json(cmd)) });
    if (inFlight.length > lag) {
      const c = inFlight.shift();
      server.tick(new Map([[a.id, c.cmd]]));
      ack = c.seq;
      for (const e of server.drainEvents()) { events.push(e); if (e.type === 'shot') serverShots.push(e); }
    }
    if (i % 4 === 3) { net.receive(snap(ack, events)); events = []; }
    net.interpolate();
    for (const e of net.drainEvents()) if (e.type === 'shot') clientShots.push(e);
  }
  return { serverShots, clientShots };
}

test('predicted shots go exactly where the server puts them', () => {
  const s = setup();
  const { serverShots, clientShots } = play(s, { yaw: (i) => Math.sin(i / 9) * 0.05 });
  assert.ok(serverShots.length >= 10, `server fired ${serverShots.length}`);
  assert.equal(clientShots.length, serverShots.length, 'one predicted shot per real shot, and the server copies are dropped');
  for (let i = 0; i < serverShots.length; i++) {
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(clientShots[i].ends[0][k] - serverShots[i].ends[0][k]) < 1e-6, `shot ${i} lands in the same spot`);
    }
  }
  assert.equal(s.net.me.weapons.primary.clip, s.a.weapons.primary.clip);
  assert.ok(Math.abs(s.net.me.punch[0] - s.a.punch[0]) < 1e-9, 'recoil matches the server');
});

test('tapping a pistol predicts one shot per click, no extras', () => {
  const s = setup('deagle');
  const { serverShots, clientShots } = play(s, { lag: 9, fire: (i) => i > 5 && i % 33 < 2 });
  assert.ok(serverShots.length >= 5, `server fired ${serverShots.length}`);
  assert.equal(clientShots.length, serverShots.length);
  for (let i = 0; i < serverShots.length; i++) assert.deepEqual(clientShots[i].ends, serverShots[i].ends);
});

test('prediction never deals damage; only the server does', () => {
  const s = setup();
  const before = s.net.game.getPlayer(s.b.id).health;
  play(s, {});
  assert.equal(s.net.game.getPlayer(s.b.id).health, s.b.health, 'client health comes from the server');
  assert.ok(s.b.health < 1e6, 'the server registered hits');
  assert.ok(before >= 0);
});

test('cmds carry the view time the server lag compensates to', () => {
  const s = setup();
  s.net.tick({ ...emptyCmd(), yaw: 0, pitch: 0 });
  s.net.tick({ ...emptyCmd(), yaw: 0, pitch: 0 });
  const c = sanitizeCmd(json(s.net.pending.at(-1).cmd));
  assert.ok(Number.isFinite(c.vt));
  assert.equal(sanitizeCmd({}).vt, null);
});

test('CS 1.6 rounds the spray accuracy down: the first AK bullets stay tight', () => {
  const g = new Game(YARD, { seed: 3 });
  const p = g.addPlayer({ name: 'p' });
  const acc = (n) => { p.shotsFired = n; return g.rifleAccuracy(p, WEAPONS.ak47.accuracy); };
  assert.equal(acc(0), 0.2);
  for (let n = 1; n <= 5; n++) assert.equal(acc(n), 0.35, `shot ${n + 1}`);
  assert.equal(acc(6), 1.25);
  // The MP5 divides by 220.1 and grows smoothly.
  p.shotsFired = 3;
  assert.ok(Math.abs(g.rifleAccuracy(p, WEAPONS.mp5.accuracy) - (9 / 220.1 + 0.45)) < 1e-12);
});

test('getting shot flinches your aim like CS 1.6, without stacking', () => {
  const g = new Game(YARD, { seed: 5 });
  const v = g.addPlayer({ name: 'v' });
  g.spawn(v); v.frozenUntil = 0; v.health = 1e6;
  v.punch = [0, 0];
  g.damage(v, null, 36, 'chest', [0, 1, 0], WEAPONS.ak47, false, [0, 0, -1]);
  assert.ok(Math.abs(v.punch[0] - 3.6) < 1e-9);
  g.damage(v, null, 36, 'chest', [0, 1, 0], WEAPONS.ak47, false, [0, 0, -1]);
  assert.ok(Math.abs(v.punch[0] - 3.6) < 1e-9, 'a second hit does not add to it');
  g.damage(v, null, 100, 'stomach', [0, 1, 0], WEAPONS.awp, false, [0, 0, -1]);
  assert.equal(v.punch[0], 4, 'capped at 4 degrees for the body');
  v.punch = [0, 0];
  g.damage(v, null, 36, 'leg', [0, 1, 0], WEAPONS.ak47, false, [0, 0, -1]);
  assert.equal(v.punch[0], 0, 'leg hits do not flinch');
  assert.ok(RECOIL_SCALE > 0);
});
