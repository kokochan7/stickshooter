import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spectator, spectatable, cycleTarget, worldBounds, FREE_SPEED } from '../src/client/spectator.js';
import { Game } from '../src/sim/game.js';
import { MAPS } from '../src/maps/index.js';

const P = (id, team, alive = true) => ({ id, team, alive });

test('teammates come first, dead players and you are left out', () => {
  const me = P(1, 'red', false);
  const list = spectatable([me, P(2, 'blue'), P(3, 'red'), P(4, 'red', false), P(5, 'blue'), P(6, 'red')], me);
  assert.deepEqual(list.map((p) => p.id), [3, 6, 2, 5]);
});

test('free for all lists everyone alive in join order', () => {
  const me = P(1, 'ffa', false);
  assert.deepEqual(spectatable([P(2, 'ffa'), me, P(3, 'ffa')], me).map((p) => p.id), [2, 3]);
});

test('cycling wraps both ways', () => {
  const list = [P(1, 'red'), P(2, 'red'), P(3, 'red')];
  assert.equal(cycleTarget(list, 3, 1).id, 1);
  assert.equal(cycleTarget(list, 1, -1).id, 3);
  assert.equal(cycleTarget(list, 2, 1).id, 3);
  assert.equal(cycleTarget(list, 99, 1).id, 1);
  assert.equal(cycleTarget(list, 99, -1).id, 3);
  assert.equal(cycleTarget([], 1, 1), null);
});

test('the watched player is replaced when they die', () => {
  const me = P(1, 'red', false), a = P(2, 'red'), b = P(3, 'red');
  const s = new Spectator();
  assert.equal(s.target([me, a, b], me), a);
  s.cycle([me, a, b], me, 1);
  assert.equal(s.id, 3);
  b.alive = false;
  assert.equal(s.target([me, a, b], me), a);
  a.alive = false;
  assert.equal(s.target([me, a, b], me), null);
});

test('jump cycles chase -> first person -> free roam, and clicking leaves free roam', () => {
  const me = P(1, 'red', false), a = P(2, 'red');
  const s = new Spectator();
  assert.equal(s.mode, 'chase');
  assert.equal(s.nextMode(), 'eye');
  assert.equal(s.nextMode([4, 5, 6]), 'free');
  assert.deepEqual(s.pos, [4, 5, 6]);
  s.cycle([me, a], me, 1);
  assert.equal(s.mode, 'chase');
  s.mode = 'free';
  s.cycle([me], me, 1); // nobody to watch: stay in free roam
  assert.equal(s.mode, 'free');
  s.mode = 'free';
  assert.equal(s.nextMode(), 'chase');
});

test('free cam flies where you look and stays on the map', () => {
  const s = new Spectator();
  s.pos = [0, 2, 0];
  s.fly(1, 0, 0, 1, 0, 0); // yaw 0 looks down -z
  assert.ok(Math.abs(s.pos[2] + FREE_SPEED) < 1e-9 && Math.abs(s.pos[0]) < 1e-9);
  s.pos = [0, 2, 0];
  s.fly(1, Math.PI / 2, 0, 0, 1, 0); // facing -x, strafing right goes -z
  assert.ok(Math.abs(s.pos[2] + FREE_SPEED) < 1e-9);
  s.pos = [0, 2, 0];
  s.fly(1, 0, Math.PI / 2, 1, 0, 0); // looking straight up
  assert.ok(Math.abs(s.pos[1] - (2 + FREE_SPEED)) < 1e-9);
  // Diagonals aren't faster.
  s.pos = [0, 0, 0];
  s.fly(1, 0, 0, 1, 1, 0);
  assert.ok(Math.abs(Math.hypot(...s.pos) - FREE_SPEED) < 1e-9);

  const g = new Game(MAPS.yard, { seed: 1 });
  s.bounds = worldBounds(g.world);
  s.pos = [0, 2, 0];
  for (let i = 0; i < 100; i++) s.fly(1, 0, 0, 1, 0, 0);
  assert.equal(s.pos[2], s.bounds.min[2]);
});
