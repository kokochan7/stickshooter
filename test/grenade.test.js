import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { WEAPONS, EQUIPMENT } from '../src/sim/weapons.js';
import { TICK_DT, NADE_FUSE, U } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';
import { sanitizeCmd, packNades } from '../src/net/protocol.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}
const look = (p, extra = {}) => ({ ...emptyCmd(), yaw: p.yaw, pitch: p.pitch, ...extra });
const put = (p, x, z, yaw = 0) => { p.pos = [x, 0, z]; p.prevPos = [x, 0, z]; p.vel = [0, 0, 0]; p.yaw = yaw; p.pitch = 0; };

function setup(mode = 'ffa') {
  const g = new Game(YARD, { seed: 9, mode });
  const a = g.addPlayer({ name: 'A', team: mode === 'teams' ? 'red' : 'ffa' });
  const b = g.addPlayer({ name: 'B', team: mode === 'teams' ? 'blue' : 'ffa' });
  g.spawn(a); g.spawn(b);
  put(a, 0, 26); put(b, 0, 22, Math.PI);
  return { g, a, b };
}

// A grenade sitting at (x, z), about to go off.
function blast(g, owner, x, z) {
  const n = { id: 99, owner: owner.id, team: owner.team, weapon: 'hegrenade', pos: [x, 0.06, z], prevPos: [x, 0.06, z], vel: [0, 0, 0], explodeAt: g.time, rest: true, lastBounce: -1 };
  g.nades.push(n);
  g.tick(new Map());
}

test('the HE grenade is bought from Equipment into its own slot without leaving your gun', () => {
  const { g, a } = setup();
  assert.ok(EQUIPMENT.includes('hegrenade'));
  g.buy(a, 'ak47');
  const money = a.money;
  assert.ok(g.buy(a, 'hegrenade'));
  assert.equal(a.money, money - 300, 'costs $300 like CS 1.6');
  assert.equal(a.weapons.grenade.id, 'hegrenade');
  assert.equal(a.active, 'primary', 'still holding the AK');
  assert.ok(!g.buy(a, 'hegrenade'), 'you carry one at a time');
  assert.equal(g.dropWeapon(a, 'grenade', true), null, "G doesn't drop it");
  assert.equal(sanitizeCmd({ slot: 'grenade' }).slot, 'grenade', 'key 4 reaches the server');
});

test('hold fire to pull the pin, let go to throw; it goes off after the fuse and your gun comes back', () => {
  const { g, a } = setup();
  g.buy(a, 'ak47');
  g.buy(a, 'hegrenade');
  run(g, 0.05, (p) => (p === a ? look(p, { slot: 'grenade' }) : null));
  assert.equal(a.active, 'grenade');
  run(g, 0.7, (p) => (p === a ? look(p) : null)); // deploy
  const evs = [];
  const tick = (cmd) => { g.tick(new Map([[a.id, cmd]])); evs.push(...g.drainEvents()); };
  for (let i = 0; i < 0.6 / TICK_DT; i++) tick(look(a, { fire: true }));
  assert.ok(evs.some((e) => e.type === 'pin'), 'pin pulled');
  assert.equal(g.nades.length, 0, 'held: nothing thrown yet');
  tick(look(a));
  assert.ok(evs.some((e) => e.type === 'throw'), 'thrown on release');
  assert.equal(g.nades.length, 1);
  const n = g.nades[0];
  const start = [...n.pos];
  for (let i = 0; i < 0.6 / TICK_DT; i++) tick(look(a));
  assert.ok(n.pos[2] < start[2] - 5, `it flies forward (${n.pos})`);
  assert.equal(a.active, 'primary', 'the AK is back in your hands');
  assert.equal(a.weapons.grenade, null);
  for (let i = 0; i < NADE_FUSE / TICK_DT; i++) tick(look(a));
  assert.ok(evs.some((e) => e.type === 'nadeExplode'), 'it exploded');
  assert.equal(g.nades.length, 0);
});

test('a lob goes about half as far as a full throw', () => {
  const dist = (alt) => {
    const { g, a } = setup();
    put(a, 0, 30);
    g.buy(a, 'hegrenade');
    run(g, 0.05, (p) => (p === a ? look(p, { slot: 'grenade' }) : null));
    run(g, 0.7, (p) => (p === a ? look(p) : null));
    run(g, 0.5, (p) => (p === a ? look(p, alt ? { alt: true } : { fire: true }) : null));
    run(g, TICK_DT, (p) => (p === a ? look(p) : null));
    const n = g.nades[0];
    run(g, 1.2);
    return 30 - n.pos[2];
  };
  const full = dist(false), lob = dist(true);
  assert.ok(lob < full * 0.75 && lob > 1, `lob ${lob.toFixed(1)} m vs throw ${full.toFixed(1)} m`);
});

test('blast damage: CS 1.6 falloff, kevlar halves it, nothing past the 13 m radius', () => {
  const { g, a, b } = setup();
  put(b, 0, 10);
  blast(g, a, 0, 10.5);
  const close = 100 - b.health;
  assert.ok(close > 85 && close <= 100, `point blank does ${close}`);

  const s = setup();
  put(s.b, 0, 10);
  s.b.armor = 100;
  blast(s.g, s.a, 0, 10.5);
  const armored = 100 - s.b.health;
  assert.ok(Math.abs(armored - close / 2) <= 1.5, `kevlar: ${armored} vs ${close}`);
  assert.ok(s.b.armor < 100, 'and the vest takes some');

  const m = setup();
  put(m.b, 0, 10);
  blast(m.g, m.a, 0, 10 + 5); // 5 m away
  const mid = 100 - m.b.health;
  const want = 100 * (1 - Math.hypot(5, 0.78) / U / WEAPONS.hegrenade.grenade.radius);
  assert.ok(Math.abs(mid - want) < 2, `at 5 m: ${mid} (want ~${want.toFixed(0)})`);

  const f = setup();
  put(f.b, 0, 10);
  blast(f.g, f.a, 0, 10 + 14);
  assert.equal(f.b.health, 100, 'out of range');
});

test('walls stop the blast, teammates are safe, and you can blow yourself up', () => {
  // Yard: a wall along X = -12.2..-12, z 3..11, 3 m tall.
  const w = setup();
  put(w.b, -13, 7);
  blast(w.g, w.a, -11, 7);
  assert.equal(w.b.health, 100, 'behind the wall');

  const t = setup('teams');
  const mate = t.g.addPlayer({ name: 'C', team: 'red' });
  t.g.spawn(mate);
  put(mate, 0, 10); put(t.b, 2, 10);
  put(t.a, 30, -20);
  blast(t.g, t.a, 1, 10);
  assert.equal(mate.health, 100, 'teammate unhurt');
  assert.ok(t.b.health < 100, 'enemy hurt');

  const s = setup();
  put(s.a, 0, 10);
  const kills = s.a.kills;
  blast(s.g, s.a, 0, 10.3);
  assert.ok(s.a.health < 20, `own grenade at your feet (${s.a.health})`);
  assert.equal(s.a.kills, kills);
});

test('a grenade kill is credited to the thrower with the grenade', () => {
  const { g, a, b } = setup();
  put(b, 0, 10);
  b.health = 20;
  blast(g, a, 0, 10.5);
  const kill = g.drainEvents().find((e) => e.type === 'kill');
  assert.ok(!b.alive);
  assert.equal(kill.attacker, a.id);
  assert.equal(kill.weapon, 'hegrenade');
  assert.equal(a.kills, 1);
});

test('grenades bounce off walls and come to rest', () => {
  const { g, a } = setup();
  // Thrown straight at the yard's west wall (x = -12) from 3 m away.
  g.nades.push({ id: 1, owner: a.id, team: a.team, weapon: 'hegrenade', pos: [-9, 1.2, 7], prevPos: [-9, 1.2, 7], vel: [-12, 0, 0], explodeAt: g.time + 5, rest: false, lastBounce: -1 });
  const evs = [];
  for (let i = 0; i < 1.5 / TICK_DT; i++) { g.tick(new Map()); evs.push(...g.drainEvents()); }
  const n = g.nades[0];
  assert.ok(evs.some((e) => e.type === 'nadeBounce'), 'bounced');
  assert.ok(n.pos[0] > -12, `stayed on this side (${n.pos})`);
  run(g, 3);
  assert.ok(n.rest, 'stopped');
  assert.ok(Math.abs(n.pos[1] - 0.06) < 0.05, `on the floor (${n.pos[1]})`);
  assert.equal(packNades(g.nades)[0].id, 1);
});

test('nothing is rebought on respawn: a new life starts with a USP and a knife', () => {
  const { g, a } = setup();
  g.buy(a, 'hegrenade');
  g.buy(a, 'ak47');
  g.buy(a, 'kevlarHelmet');
  const money = a.money;
  a.alive = false;
  g.spawn(a);
  assert.equal(a.weapons.grenade, null);
  assert.equal(a.weapons.primary, null);
  assert.equal(a.weapons.secondary.id, 'usp');
  assert.equal(a.weapons.melee.id, 'knife');
  assert.equal(a.armor, 0);
  assert.equal(a.helmet, false);
  assert.equal(a.money, money, 'and no money is spent');
  assert.equal(a.active, 'secondary');
});

test('the grenade costs and does what CS 1.6 says', () => {
  const he = WEAPONS.hegrenade;
  assert.equal(he.price, 300);
  assert.equal(he.damage, 100);
  assert.equal(he.grenade.radius, 525);
  assert.equal(he.slot, 'grenade');
});
