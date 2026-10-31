import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { computeDamage, traceBullet, isEnemy } from '../src/sim/combat.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { World } from '../src/sim/world.js';
import { U } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';
import { NavGrid } from '../src/sim/nav.js';
import { BotBrain } from '../src/sim/bot.js';

function victim(armor = 0, helmet = false) {
  return { armor, helmet };
}

test('CS 1.6 armor math: AK headshot vs helmet', () => {
  const v = victim(100, true);
  const { damage } = computeDamage(v, 36, 'head', WEAPONS.ak47);
  // 36 * 4 = 144, 77.5% gets through => 111
  assert.equal(damage, 111);
  assert.ok(v.armor < 100);
});

test('no helmet means full headshot damage', () => {
  const { damage } = computeDamage(victim(100, false), 36, 'head', WEAPONS.ak47);
  assert.equal(damage, 144);
});

test('legs are never protected', () => {
  const { damage } = computeDamage(victim(100, true), 36, 'leg', WEAPONS.ak47);
  assert.equal(damage, 27);
});

test('AWP body shot through kevlar still kills (115 * 0.975)', () => {
  const { damage } = computeDamage(victim(100, true), 115, 'chest', WEAPONS.awp);
  assert.ok(damage >= 100, `got ${damage}`);
});

function dummy(x, z) {
  return {
    id: 99, team: 'b', alive: true, pos: [x, 0, z], yaw: 0, ducked: false, duckAmount: 0,
  };
}

test('wall penetration: AK goes through thin wood, not thick concrete', () => {
  const wood = new World([{ min: [-2, 0, -5.1], max: [2, 3, -5], material: 'wood' }]);
  const target = dummy(0, -8);
  const shooter = { team: 'a' };
  let hit = null;
  traceBullet(wood, [target], shooter, [0, 1.25, 0], [0, 0, -1], WEAPONS.ak47, (v, dmg, group) => { hit = { dmg, group }; });
  assert.ok(hit, 'AK should wallbang thin wood');
  assert.ok(hit.dmg < 36 && hit.dmg > 15, `damage after wood ${hit.dmg}`);

  const concrete = new World([{ min: [-2, 0, -6], max: [2, 3, -5], material: 'concrete' }]);
  hit = null;
  traceBullet(concrete, [target], shooter, [0, 1.25, 0], [0, 0, -1], WEAPONS.ak47, () => { hit = true; });
  assert.equal(hit, null);

  const usp = new World([{ min: [-2, 0, -5.4], max: [2, 3, -5], material: 'wood' }]);
  hit = null;
  traceBullet(usp, [target], shooter, [0, 1.25, 0], [0, 0, -1], WEAPONS.usp, () => { hit = true; });
  assert.equal(hit, null, 'USP cannot go through 40 cm of wood');
});

test('range falloff: pistols lose more damage than rifles', () => {
  const empty = new World([]);
  const far = dummy(0, -40);
  const shooter = { team: 'a' };
  let usp = 0, ak = 0;
  traceBullet(empty, [far], shooter, [0, 1.25, 0], [0, 0, -1], WEAPONS.usp, (v, d) => { usp = d; });
  traceBullet(empty, [far], shooter, [0, 1.25, 0], [0, 0, -1], WEAPONS.ak47, (v, d) => { ak = d; });
  assert.ok(usp / 34 < ak / 36);
  assert.ok(Math.abs(ak - 36 * Math.pow(0.98, 40 / (500 * U))) < 0.5);
});

test('hitgroups: head shot registers as head', () => {
  const empty = new World([]);
  const t = dummy(0, -10);
  let group = null;
  traceBullet(empty, [t], { team: 'a' }, [0, 1.6, 0], [0, 0, -1], WEAPONS.ak47, (v, d, g) => { group = g; });
  assert.equal(group, 'head');
  traceBullet(empty, [t], { team: 'a' }, [0, 0.4, 0], [0, 0, -1], WEAPONS.ak47, (v, d, g) => { group = g; });
  assert.equal(group, 'leg');
});

test('running speed caps at the weapon speed (USP 250 u/s)', () => {
  const g = new Game(YARD, { seed: 1 });
  const p = g.addPlayer({ name: 'me', team: 'white' });
  for (let i = 0; i < 5; i++) g.tick(new Map());
  // Open strip of the yard, running towards +X (forward = (-sin yaw, -cos yaw)).
  p.pos = [-10, 0, 19];
  const cmd = { ...emptyCmd(), fwd: 1, yaw: -Math.PI / 2 };
  let maxSpeed = 0;
  for (let i = 0; i < 128; i++) {
    g.tick(new Map([[p.id, cmd]]));
    maxSpeed = Math.max(maxSpeed, Math.hypot(p.vel[0], p.vel[2]));
  }
  assert.ok(Math.abs(maxSpeed / U - 250) < 3, `speed ${maxSpeed / U}`);
});

test('bots play a match without errors and get kills', () => {
  const g = new Game(YARD, { seed: 7 });
  const nav = new NavGrid(g.world, YARD.bounds);
  const brains = [];
  for (let i = 0; i < 6; i++) {
    const p = g.addPlayer({ name: 'bot' + i, team: i % 2 ? 'red' : 'blue', isBot: true });
    brains.push(new BotBrain(g, p, nav, 'hard'));
  }
  for (let i = 0; i < 128 * 60; i++) {
    const cmds = new Map();
    for (const b of brains) cmds.set(b.p.id, b.think(1 / 128));
    g.tick(cmds);
    g.drainEvents();
  }
  const kills = g.players.reduce((s, p) => s + p.kills, 0);
  assert.ok(kills > 0, 'expected some kills in a minute of bot play');
  for (const p of g.players) for (const v of p.pos) assert.ok(Number.isFinite(v));
});

test('free-for-all: bots fight each other, not only the player', () => {
  const g = new Game(YARD, { seed: 3 });
  const nav = new NavGrid(g.world, YARD.bounds);
  const brains = [];
  for (let i = 0; i < 4; i++) {
    const p = g.addPlayer({ name: 'bot' + i, isBot: true });
    assert.equal(p.team, 'ffa');
    brains.push(new BotBrain(g, p, nav, 'hard'));
  }
  let botOnBot = 0;
  for (let i = 0; i < 128 * 60; i++) {
    const cmds = new Map();
    for (const b of brains) cmds.set(b.p.id, b.think(1 / 128));
    g.tick(cmds);
    for (const e of g.drainEvents()) if (e.type === 'kill' && e.attacker && e.attacker !== e.victim) botOnBot++;
  }
  assert.ok(botOnBot > 0, 'expected bots to kill each other in FFA');
});

test('teams: balanced sides, own-side spawns, and switching team', () => {
  const g = new Game(YARD, { seed: 5, mode: 'teams' });
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(g.addPlayer({ name: 'p' + i }));
  assert.deepEqual(ps.map((p) => p.team), ['red', 'blue', 'red', 'blue', 'red', 'blue']);
  g.tick(new Map());
  for (const p of ps) {
    assert.ok(p.alive);
    // Red spawns north (negative z), Blue south.
    assert.ok(p.team === 'red' ? p.pos[2] < -15 : p.pos[2] > 20, `${p.team} spawned at z=${p.pos[2]}`);
  }
  const me = ps[0];
  const deaths = me.deaths;
  g.tick(new Map([[me.id, { ...emptyCmd(), actions: [{ type: 'team', team: 'blue' }] }]]));
  assert.equal(me.team, 'blue');
  assert.equal(me.alive, false);
  assert.equal(me.deaths, deaths, 'switching team is not a death');
  for (let i = 0; i < 128 * 1.2; i++) g.tick(new Map());
  assert.ok(me.alive && me.pos[2] > 20, 'respawned on the Blue side');

  // Teammates' bullets pass through each other.
  const red = ps.filter((p) => p.team === 'red');
  assert.ok(!isEnemy(red[0], red[1]));
  // FFA again: everyone back on 'ffa', and switching team does nothing.
  g.setMode('ffa');
  assert.ok(g.players.every((p) => p.team === 'ffa'));
  assert.equal(g.setTeam(me, 'red'), false);
});

test('team spawn points are clear of walls', () => {
  for (const s of [...YARD.teamSpawns.red, ...YARD.teamSpawns.blue]) {
    const [x, y, z] = s.pos;
    for (const b of YARD.boxes) {
      const inside = x > b.min[0] - 0.4 && x < b.max[0] + 0.4 && z > b.min[2] - 0.4 && z < b.max[2] + 0.4 && y + 0.05 < b.max[1] && y + 1.8 > b.min[1];
      assert.ok(!inside, `spawn ${s.pos} overlaps a box ${b.min}..${b.max}`);
    }
  }
});
