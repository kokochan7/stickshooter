import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain } from '../src/sim/bot.js';
import { NavGrid } from '../src/sim/nav.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { FFA_KILL_LIMIT, TEAM_KILL_LIMIT, START_DELAY, DROP_LIFETIME, MATCH_OVER_TIME, TICK_DT } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}
const look = (p, extra = {}) => ({ ...emptyCmd(), yaw: p.yaw, pitch: p.pitch, ...extra });

// Two players facing each other on open ground, a step apart.
function duel(mode = 'ffa', gap = 1.0) {
  const g = new Game(YARD, { seed: 3, mode });
  const a = g.addPlayer({ name: 'A', team: mode === 'teams' ? 'red' : 'ffa' });
  const b = g.addPlayer({ name: 'B', team: mode === 'teams' ? 'blue' : 'ffa' });
  g.spawn(a); g.spawn(b);
  a.pos = [0, 0, 20]; a.prevPos = [...a.pos]; a.yaw = 0; a.pitch = 0;
  b.pos = [0, 0, 20 - gap]; b.prevPos = [...b.pos]; b.yaw = Math.PI; b.pitch = 0; // facing A
  return { g, a, b };
}

test('free for all ends when someone reaches the kill limit, then restarts', () => {
  const { g, a, b } = duel();
  a.kills = FFA_KILL_LIMIT - 1;
  g.kill(b, a, WEAPONS.ak47, false, false);
  assert.equal(g.match.state, 'over');
  assert.equal(g.match.winner, a.id);
  assert.ok(g.frozen(a), 'everyone freezes while the winner is shown');
  run(g, MATCH_OVER_TIME + 0.1);
  assert.equal(g.match.state, 'live');
  assert.equal(a.kills, 0);
  assert.ok(a.alive && b.alive);
  assert.ok(g.frozen(a), 'new match starts with the start freeze');
});

test('teams ends when a team reaches its kill limit', () => {
  const { g, a, b } = duel('teams');
  g.teamKills.red = TEAM_KILL_LIMIT - 1;
  g.kill(b, a, WEAPONS.ak47, false, false);
  assert.equal(g.match.state, 'over');
  assert.equal(g.match.winnerTeam, 'red');
});

test('the start freeze stops movement and damage, then lets go', () => {
  const { g, a, b } = duel();
  g.join(a);
  const start = [...a.pos];
  run(g, START_DELAY - 0.5, (p) => (p === a ? look(p, { fwd: 1 }) : null));
  assert.ok(Math.hypot(a.pos[0] - start[0], a.pos[2] - start[2]) < 0.01, 'frozen players do not move');
  g.damage(a, b, 50, 'chest', a.pos, WEAPONS.ak47, false, [0, 0, 1]);
  assert.equal(a.health, 100, 'frozen players take no damage');
  run(g, 1, (p) => (p === a ? look(p, { fwd: 1 }) : null));
  assert.ok(Math.hypot(a.pos[0] - start[0], a.pos[2] - start[2]) > 0.5, 'moves once the freeze ends');
});

test('dying drops the gun, it can be picked up and it expires', () => {
  const { g, a, b } = duel();
  g.buy(b, 'ak47');
  g.kill(b, a, WEAPONS.usp, false, false);
  assert.equal(g.drops.length, 1);
  assert.equal(g.drops[0].weapon.id, 'ak47');
  run(g, 1);
  assert.ok(g.drops[0].rest, 'the gun lands');
  assert.ok(Math.abs(g.drops[0].pos[1]) < 0.05, 'on the floor');
  // A has no primary, so walking onto it picks it up.
  a.pos = [...g.drops[0].pos]; a.pos[1] = 0;
  run(g, 0.1);
  assert.equal(a.weapons.primary?.id, 'ak47');
  assert.equal(a.active, 'primary');
  // Drop it with G and it lasts DROP_LIFETIME.
  g.handleAction(a, { type: 'drop' });
  assert.equal(a.weapons.primary, null);
  assert.equal(g.drops.length, 1);
  run(g, DROP_LIFETIME + 0.2);
  assert.equal(g.drops.length, 0, 'gone after its lifetime');
});

test('picking up swaps with the gun in that slot', () => {
  const { g, a } = duel();
  g.buy(a, 'mp5');
  const d = { id: 99, weapon: { id: 'awp', clip: 10, reserve: 30 }, pos: [a.pos[0], 0, a.pos[2] - 0.5], vel: [0, 0, 0], yaw: 0, rest: true, expiresAt: g.time + 5, noPickup: { pid: 0, until: 0 } };
  g.drops.push(d);
  assert.equal(g.pickupTarget(a), d);
  g.handleAction(a, { type: 'pickup', id: 99 });
  assert.equal(a.weapons.primary.id, 'awp');
  assert.ok(g.drops.some((x) => x.weapon.id === 'mp5'), 'the old gun is left on the ground');
});

function knifeDuel(gap, mode = 'ffa') {
  const r = duel(mode, gap);
  r.g.switchTo(r.a, 'melee', true);
  return r;
}
// A swings (fire = slash, alt = stab) with yaw/pitch; B keeps bYaw.
function swing(g, a, kind, { yaw = 0, pitch = -0.4, bYaw = Math.PI } = {}) {
  const aim = (extra) => (p) => (p === a ? { ...emptyCmd(), yaw, pitch, ...extra } : { ...emptyCmd(), yaw: bYaw });
  run(g, 1.2, aim({}));
  run(g, TICK_DT, aim({ [kind]: true }));
}

test('the knife slashes for 30 then 25 and stabs for 80, through kevlar', () => {
  const { g, a, b } = knifeDuel(0.7);
  assert.equal(a.active, 'melee');
  b.armor = 100; b.helmet = true;
  swing(g, a, 'fire');
  assert.equal(b.health, 70, 'first slash');
  const aim = (p) => (p === a ? { ...emptyCmd(), yaw: 0, pitch: -0.4, fire: true } : { ...emptyCmd(), yaw: Math.PI });
  run(g, 0.45, aim);
  assert.equal(b.health, 45, 'quick follow-up slash');
  b.health = 100;
  swing(g, a, 'alt');
  assert.equal(b.health, 20, 'stab');
});

test('any knife hit in the back kills outright, even with armor', () => {
  for (const kind of ['fire', 'alt']) {
    const { g, a, b } = knifeDuel(0.7);
    b.armor = 100; b.helmet = true;
    swing(g, a, kind, { bYaw: 0 }); // B faces away
    assert.ok(!b.alive, `${kind === 'fire' ? 'slash' : 'stab'} in the back`);
  }
  const { g, a, b } = knifeDuel(0.7);
  swing(g, a, 'fire', { bYaw: Math.PI / 2 }); // side on: not a backstab
  assert.equal(b.health, 70);
});

test('the knife reaches 2 m slashing and 1.6 m stabbing, not further', () => {
  for (const [gap, kind, lands] of [[2.1, 'fire', true], [1.7, 'alt', true], [2.9, 'fire', false], [2.4, 'alt', false]]) {
    const { g, a, b } = knifeDuel(gap);
    swing(g, a, kind, { pitch: -0.3 });
    assert.equal(b.health < 100, lands, `${kind === 'fire' ? 'slash' : 'stab'} at ${gap} m`);
  }
});

test('a knife swing a little off the crosshair still connects', () => {
  for (const yaw of [0.45, -0.45]) {
    const { g, a, b } = knifeDuel(1.3);
    swing(g, a, 'fire', { yaw });
    assert.ok(b.health < 100, `slash ${yaw} rad off`);
  }
  const { g, a, b } = knifeDuel(1.3);
  swing(g, a, 'fire', { yaw: 1.0 });
  assert.equal(b.health, 100, 'way off misses');
  // Crouched victim, attacker looking straight ahead.
  const c = knifeDuel(1.0);
  c.b.ducked = true; c.b.duckAmount = 1;
  const aim = (extra) => (p) => (p === c.a ? { ...emptyCmd(), yaw: 0, pitch: 0, ...extra } : { ...emptyCmd(), yaw: Math.PI, duck: true });
  run(c.g, 1.2, aim({}));
  run(c.g, TICK_DT, aim({ fire: true }));
  assert.ok(c.b.health < 100, 'slash over a crouched head still lands');
});

test('bots pick up a better gun lying nearby', () => {
  const g = new Game(YARD, { seed: 5 });
  const nav = new NavGrid(g.world, YARD.bounds);
  const bot = g.addPlayer({ name: 'Bot', isBot: true });
  const brain = new BotBrain(g, bot, nav, 'normal');
  g.spawn(bot);
  brain.think(TICK_DT); // buys its loadout
  bot.weapons.primary = { id: 'uzi', clip: 32, reserve: 100 };
  g.switchTo(bot, 'primary', true);
  const x = bot.pos[0], z = bot.pos[2];
  g.drops.push({ id: 7, weapon: { id: 'minigun', clip: 150, reserve: 300 }, pos: [x + 2, 0, z], vel: [0, 0, 0], yaw: 0, rest: true, expiresAt: g.time + 9, noPickup: { pid: 0, until: 0 } });
  for (let i = 0; i < 128 * 5 && bot.weapons.primary.id !== 'minigun'; i++) g.tick(new Map([[bot.id, brain.think(TICK_DT)]]));
  assert.equal(bot.weapons.primary.id, 'minigun');
});

test('N buys ammo packs at CS 1.6 prices, only as far as the money and the reserve go', () => {
  const { g, a } = duel();
  a.money = 16000;
  assert.ok(g.buy(a, 'ak47'));
  const ak = a.weapons.primary;
  assert.ok(!g.buy(a, 'ammo'), 'a full reserve buys nothing');
  ak.reserve = 25;
  let money = a.money;
  assert.ok(g.buy(a, 'ammo'));
  assert.equal(ak.reserve, 90, 'filled, never past the max');
  assert.equal(money - a.money, 3 * 80, 'three 7.62 packs at $80');
  // Not enough money: as many packs as you can afford.
  ak.reserve = 0;
  a.money = 170;
  assert.ok(g.buy(a, 'ammo'));
  assert.equal(ak.reserve, 60);
  assert.equal(a.money, 10);
  // Holding the knife buys for the primary; holding the pistol buys for it.
  a.money = 16000;
  ak.reserve = 0;
  g.switchTo(a, 'melee', true);
  g.buy(a, 'ammo');
  assert.equal(ak.reserve, 90);
  g.switchTo(a, 'secondary', true);
  a.weapons.secondary.reserve = 0;
  money = a.money;
  g.buy(a, 'ammo');
  assert.equal(a.weapons.secondary.reserve, 100);
  assert.equal(money - a.money, 9 * 25, '.45 ACP packs of 12 at $25');
  // Buying the gun you hold again now pays for its ammo instead of refilling free.
  ak.reserve = 30;
  money = a.money;
  g.buy(a, 'ak47');
  assert.equal(ak.reserve, 90);
  assert.equal(money - a.money, 2 * 80);
});

test('buying closes 10 seconds after you spawn (or after the start freeze)', () => {
  const g = new Game(YARD, { seed: 3, mode: 'ffa' });
  const a = g.addPlayer({ name: 'A' });
  g.restartMatch();
  a.money = 16000;
  run(g, START_DELAY + 9.5);
  assert.ok(g.buy(a, 'mp5'), 'still open 9.5 s after the freeze');
  run(g, 1);
  assert.ok(!g.canBuy(a));
  assert.ok(!g.buy(a, 'ak47'));
  assert.ok(!g.buy(a, 'ammo'));
  // Bots and other silent buys skip the clock.
  assert.ok(g.buy(a, 'ak47', true));
  // A new life opens it again.
  a.alive = false;
  g.spawn(a);
  assert.ok(g.canBuy(a));
});

test('team modes: each side starts with its pistol and only buys its own team guns', () => {
  const { g, a, b } = duel('teams');
  assert.equal(a.weapons.secondary.id, 'glock18'); // Red
  assert.equal(b.weapons.secondary.id, 'usp'); // Blue
  a.money = b.money = 16000;
  for (const id of ['m4a1', 'famas', 'aug', 'tmp', 'sg550', 'fiveseven']) assert.equal(g.buy(a, id), false, `Red can't buy ${id}`);
  for (const id of ['ak47', 'galil', 'sg552', 'g3sg1', 'mac10']) assert.equal(g.buy(b, id), false, `Blue can't buy ${id}`);
  assert.ok(g.buy(a, 'ak47'));
  assert.ok(g.buy(b, 'm4a1'));
  assert.ok(g.buy(a, 'awp') && g.buy(b, 'deagle'), 'shared guns stay open to both');
  // Free-for-all keeps every gun open.
  const f = duel('ffa');
  f.a.money = 16000;
  assert.ok(f.g.buy(f.a, 'm4a1') && f.g.buy(f.a, 'ak47'));
});
