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

test('the knife slashes for 20 then 15, and stabs hit 3x from behind', () => {
  const { g, a, b } = duel('ffa', 0.7);
  g.switchTo(a, 'melee', true);
  assert.equal(a.active, 'melee');
  // A aims at B's chest; B keeps facing A until the stab test.
  let bYaw = Math.PI;
  const aim = (extra) => (p) => (p === a ? { ...emptyCmd(), yaw: 0, pitch: -0.4, ...extra } : { ...emptyCmd(), yaw: bYaw });
  run(g, 1.2, aim({}));
  run(g, TICK_DT, aim({ fire: true }));
  assert.equal(b.health, 80, 'first slash');
  run(g, 0.45, aim({ fire: true }));
  assert.equal(b.health, 65, 'quick follow-up slash');
  // Stab from behind: B turns away.
  b.health = 100; bYaw = 0;
  run(g, 1.2, aim({}));
  run(g, TICK_DT, aim({ alt: true }));
  assert.ok(!b.alive, 'a backstab (65 x 3) kills');
  assert.equal(g.drops.length, 1, 'and drops the USP');
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
