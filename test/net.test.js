import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { isEnemy } from '../src/sim/combat.js';
import { sanitizeCmd, cleanName, packOwn, packOther } from '../src/net/protocol.js';
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
  // Put B somewhere A can't hit, but "rewind" B into A's sights.
  b.pos = [40, 0, 40];
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
  assert.deepEqual(b.pos, [40, 0, 40], 'B is put back after the trace');
  assert.ok(b.health < 100 || !b.alive, 'the rewound B was hit');
});
