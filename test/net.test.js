import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { isEnemy } from '../src/sim/combat.js';
import { sanitizeCmd, cleanName, packOwn, packOther, packDrops, roomMode, pickRoom } from '../src/net/protocol.js';
import { YARD } from '../src/maps/yard.js';

test('free-for-all players are enemies, teammates are not', () => {
  const a = { team: 'ffa' }, b = { team: 'ffa' }, c = { team: 'white' }, d = { team: 'white' };
  assert.ok(isEnemy(a, b));
  assert.ok(!isEnemy(a, a));
  assert.ok(!isEnemy(c, d));
  assert.ok(isEnemy(c, a));
});

test('sanitizeCmd clamps and drops junk', () => {
  const c = sanitizeCmd({ fwd: 9, side: -3, fire: 1, yaw: NaN, pitch: 5, slot: 'knife', actions: [{ type: 'buy', item: 'awp' }, { type: 'money', amount: 1e9 }], evil: true });
  assert.equal(c.fwd, 1);
  assert.equal(c.side, -1);
  assert.equal(c.fire, true);
  assert.equal(c.yaw, 0);
  assert.ok(c.pitch <= Math.PI / 2);
  assert.equal(c.slot, null);
  assert.deepEqual(c.actions, [{ type: 'buy', item: 'awp' }]);
  assert.equal(c.evil, undefined);
});

test('cleanName strips markup and caps length', () => {
  assert.equal(cleanName('<b>Kenny</b>'), 'bKennyb');
  assert.equal(cleanName(''), 'Player');
  assert.ok(cleanName('x'.repeat(50)).length <= 16);
});

test('snapshots survive JSON and carry what the client needs', () => {
  const g = new Game(YARD, { seed: 1 });
  const p = g.addPlayer({ name: 'A', team: 'ffa' });
  g.spawn(p);
  const own = JSON.parse(JSON.stringify(packOwn(p)));
  assert.deepEqual(own.pos, p.pos);
  assert.equal(own.weapons.secondary.id, 'usp');
  const other = JSON.parse(JSON.stringify(packOther(p)));
  assert.equal(other.weapon, 'usp');
  assert.equal(other.money, undefined, 'others should not see your money');
});

test('lag compensation hook wraps each shot and is undone', () => {
  const g = new Game(YARD, { seed: 2 });
  const a = g.addPlayer({ name: 'A', team: 'ffa' });
  const b = g.addPlayer({ name: 'B', team: 'ffa' });
  g.spawn(a); g.spawn(b);
  // A stands in the open, facing north.
  a.pos = [0, 0, -6]; a.prevPos = [0, 0, -6]; a.yaw = 0;
  // Put B somewhere A can't hit, but "rewind" B into A's sights.
  b.pos = [24, 0, 24];
  let calls = 0;
  g.lagComp = (shooter) => {
    calls++;
    assert.equal(shooter, a);
    const saved = b.pos;
    b.pos = [a.pos[0] - Math.sin(a.yaw) * 2.5, a.pos[1], a.pos[2] - Math.cos(a.yaw) * 2.5]; // right in front
    return () => { b.pos = saved; };
  };
  for (let i = 0; i < 64; i++) g.tick(new Map([[a.id, { ...emptyCmd(), fire: i === 50, yaw: a.yaw, pitch: 0 }]]));
  assert.equal(calls, 1);
  assert.deepEqual(b.pos, [24, 0, 24], 'B is put back after the trace');
  assert.ok(b.health < 100 || !b.alive, 'the rewound B was hit');
});

test('room names pick the mode, and team switches survive sanitizeCmd', () => {
  assert.equal(roomMode('public'), 'ffa');
  assert.equal(roomMode('public-teams'), 'teams');
  assert.equal(roomMode('teamsters'), 'ffa');
  const c = sanitizeCmd({ actions: [{ type: 'team', team: 'blue' }, { type: 'team', team: 'green' }] });
  assert.deepEqual(c.actions, [{ type: 'team', team: 'blue' }]);
  const p = new Game(YARD, { mode: 'teams' }).addPlayer({ name: 'a' });
  assert.equal(packOwn(p).team, 'red');
});

test('pickRoom keeps your mode unless only the other mode has people', () => {
  assert.equal(pickRoom('ffa', {}), 'public');
  assert.equal(pickRoom('teams', {}), 'public-teams');
  assert.equal(pickRoom('ffa', { public: 0, 'public-teams': 2 }), 'public-teams');
  assert.equal(pickRoom('teams', { public: 1, 'public-teams': 0 }), 'public');
  assert.equal(pickRoom('ffa', { public: 1, 'public-teams': 5 }), 'public');
});

test('drop / pickup actions and the knife slot survive sanitizeCmd', () => {
  const c = sanitizeCmd({ slot: 'melee', actions: [{ type: 'drop', extra: 1 }, { type: 'pickup', id: 4 }, { type: 'pickup', id: 'x' }] });
  assert.equal(c.slot, 'melee');
  assert.deepEqual(c.actions, [{ type: 'drop' }, { type: 'pickup', id: 4 }]);
});

test('snapshots carry the match state and the guns on the ground', () => {
  const g = new Game(YARD, { seed: 4 });
  const a = g.addPlayer({ name: 'A' });
  g.spawn(a);
  g.buy(a, 'ak47');
  g.kill(a, null, null, false, false);
  const drops = JSON.parse(JSON.stringify(packDrops(g.drops)));
  assert.equal(drops[0].w, 'ak47');
  assert.equal(drops[0].clip, undefined, 'others do not see the ammo');
  const m = JSON.parse(JSON.stringify(g.matchInfo()));
  assert.equal(m.state, 'live');
  assert.deepEqual(m.teamKills, { red: 0, blue: 0 });
  assert.ok('frozenUntil' in packOwn(a));
});
