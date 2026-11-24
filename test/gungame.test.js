import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain } from '../src/sim/bot.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { GG_LADDER, GG_LAST, ggWeapon, ggRank } from '../src/sim/gungame.js';
import { TICK_DT, MATCH_OVER_TIME } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';
import { roomMode, pickRoom, packOwn, packOther } from '../src/net/protocol.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}

function setup(n = 2) {
  const g = new Game(YARD, { seed: 7, mode: 'gungame' });
  const ps = Array.from({ length: n }, (_, i) => g.addPlayer({ name: 'P' + i }));
  g.restartMatch();
  return { g, ps };
}

test('the ladder is real guns, ends with HE then the knife', () => {
  for (const id of GG_LADDER) assert.ok(WEAPONS[id], id);
  assert.equal(GG_LADDER.at(-1), 'knife');
  assert.equal(GG_LADDER.at(-2), 'hegrenade');
  assert.ok(!GG_LADDER.includes('flashbang'));
});

test('everyone is free for all and spawns with the first gun, a knife and armor', () => {
  const { g, ps: [a, b] } = setup();
  assert.equal(a.team, 'ffa');
  assert.ok(a.alive);
  assert.equal(a.weapons.secondary.id, GG_LADDER[0]);
  assert.equal(a.weapons.melee.id, 'knife');
  assert.equal(a.weapons.primary, null);
  assert.equal(a.active, 'secondary');
  assert.equal(a.armor, 100);
  assert.ok(a.helmet);
  assert.ok(!g.canBuy(a));
  assert.ok(!g.buy(a, 'ak47', true), 'no buying in gun game');
  assert.equal(b.weapons.primary, null);
});

test('a kill moves you to the next gun and nothing drops', () => {
  const { g, ps: [a, b] } = setup();
  g.kill(b, a, WEAPONS[GG_LADDER[0]], false, false);
  assert.equal(a.ggLevel, 1);
  assert.equal(a.weapons.secondary.id, GG_LADDER[1]);
  assert.equal(g.drops.length, 0);
  // Up to the shotguns: the pistol goes away and the shotgun is in hand.
  a.ggLevel = 5;
  b.alive = true;
  g.kill(b, a, WEAPONS.elites, false, false);
  assert.equal(a.weapons.primary.id, 'shotgun');
  assert.equal(a.weapons.secondary, null);
  assert.equal(a.active, 'primary');
  assert.ok(g.events.some((e) => e.type === 'ggLevel' && e.pid === a.id && e.level === 6));
});

test('the gun reserve never runs out', () => {
  const { g, ps: [a] } = setup(1);
  a.weapons.secondary.reserve = 0;
  run(g, 0.05);
  assert.equal(a.weapons.secondary.reserve, WEAPONS[GG_LADDER[0]].reserve);
});

test('a knife kill steals a level from the victim', () => {
  const { g, ps: [a, b] } = setup();
  a.ggLevel = 3; b.ggLevel = 8;
  g.kill(b, a, WEAPONS.knife, false, false);
  assert.equal(a.ggLevel, 4);
  assert.equal(b.ggLevel, 7);
  // Nobody goes below level 1.
  b.alive = true; b.ggLevel = 0;
  g.kill(b, a, WEAPONS.knife, false, false);
  assert.equal(b.ggLevel, 0);
});

test('the HE level refills the grenade once the last one has gone off', () => {
  const { g, ps: [a] } = setup(1);
  a.ggLevel = GG_LAST - 1;
  g.ggArm(a);
  assert.equal(a.active, 'grenade');
  run(g, 3.5); // past the start freeze
  // Throw: press, hold past the pin, let go.
  run(g, 0.6, (p) => ({ ...emptyCmd(), yaw: p.yaw, pitch: -0.3, fire: true }));
  run(g, 0.2, (p) => ({ ...emptyCmd(), yaw: p.yaw, pitch: -0.3 }));
  assert.equal(g.nades.length, 1, 'thrown');
  run(g, 0.8);
  if (g.nades.length) assert.equal(a.weapons.grenade, null, 'no new grenade while one is in flight');
  run(g, 3);
  assert.equal(g.nades.length, 0);
  assert.equal(a.weapons.grenade?.id, 'hegrenade', 'a new HE after the blast');
});

test('only a knife kill on the last level wins, then a new match resets levels', () => {
  const { g, ps: [a, b] } = setup();
  a.ggLevel = GG_LAST;
  g.ggArm(a);
  assert.equal(a.active, 'melee');
  assert.equal(a.weapons.secondary, null);
  g.kill(b, a, WEAPONS.hegrenade, false, false);
  assert.equal(g.match.state, 'live', 'an HE kill on the knife level does not win');
  b.alive = true;
  g.kill(b, a, WEAPONS.knife, false, false);
  assert.equal(g.match.state, 'over');
  assert.equal(g.match.winner, a.id);
  run(g, MATCH_OVER_TIME + 0.1);
  assert.equal(g.match.state, 'live');
  assert.equal(a.ggLevel, 0);
  assert.equal(a.weapons.secondary.id, GG_LADDER[0]);
});

test('late joiners start at the lowest level in the room', () => {
  const { g, ps: [a, b] } = setup();
  a.ggLevel = 6; b.ggLevel = 4;
  const c = g.addPlayer({ name: 'C' });
  g.join(c);
  assert.equal(c.ggLevel, 4);
  assert.equal(c.weapons[WEAPONS[ggWeapon(4)].slot].id, ggWeapon(4));
});

test('ggRank puts the highest level first', () => {
  const list = [{ ggLevel: 2, kills: 9, deaths: 0 }, { ggLevel: 5, kills: 5, deaths: 3 }, { ggLevel: 5, kills: 6, deaths: 3 }];
  list.sort(ggRank);
  assert.deepEqual(list.map((p) => p.kills), [6, 5, 9]);
});

test('online: the gungame room plays gun game and levels go in snapshots', () => {
  assert.equal(roomMode('public-gungame'), 'gungame');
  assert.equal(pickRoom('gungame', {}), 'public-gungame');
  const { ps: [a] } = setup(1);
  a.ggLevel = 3;
  assert.equal(packOwn(a).ggLevel, 3);
  assert.equal(packOther(a).ggLevel, 3);
});

test('bots fight each other in gun game and climb the ladder', () => {
  const g = new Game(YARD, { seed: 11, mode: 'gungame' });
  const brains = [];
  for (let i = 0; i < 6; i++) {
    const p = g.addPlayer({ name: 'B' + i, isBot: true });
    brains.push(new BotBrain(g, p, null, 'hard'));
  }
  g.restartMatch();
  const n = Math.round(60 / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const b of brains) cmds.set(b.p.id, b.think(TICK_DT));
    g.tick(cmds);
  }
  const top = Math.max(...g.players.map((p) => p.ggLevel));
  assert.ok(top >= 2, `someone climbed (top level ${top})`);
  assert.equal(g.drops.length, 0);
  for (const p of g.players) assert.ok(!p.weapons.primary || p.weapons.primary.id === ggWeapon(p.ggLevel) || !p.alive);
});
