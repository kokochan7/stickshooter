import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { PLAYER_RADIUS, STAND_HEIGHT, START_DELAY, TICK_DT } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}

function pair(mode = 'ffa', gap = 2) {
  const g = new Game(YARD, { seed: 3, mode });
  const team = (t) => (mode === 'teams' ? t : 'ffa');
  const a = g.addPlayer({ name: 'A', team: team('red') });
  const b = g.addPlayer({ name: 'B', team: team(mode === 'teams' ? 'red' : 'blue') });
  g.spawn(a); g.spawn(b);
  run(g, START_DELAY + 0.1);
  a.pos = [0, 0, 20]; a.prevPos = [...a.pos]; a.yaw = 0; a.vel = [0, 0, 0];
  b.pos = [0, 0, 20 - gap]; b.prevPos = [...b.pos]; b.yaw = Math.PI; b.vel = [0, 0, 0];
  return { g, a, b };
}
// yaw 0 walks toward -z, at B.
const walk = (p) => ({ ...emptyCmd(), yaw: 0, pitch: 0, fwd: 1 });

for (const mode of ['ffa', 'teams']) {
  test(`you can't walk through another player (${mode})`, () => {
    const { g, a, b } = pair(mode);
    run(g, 1, (p) => (p === a ? walk(p) : null));
    const gap = a.pos[2] - b.pos[2];
    assert.ok(gap >= 2 * PLAYER_RADIUS - 1e-3, `A stopped at B (gap ${gap.toFixed(3)})`);
    assert.ok(gap < 2 * PLAYER_RADIUS + 0.05, 'and right up against B');
    assert.equal(b.pos[2], 18, 'B was not shoved');
  });
}

test('walking into someone at an angle slides along them', () => {
  const { g, a, b } = pair();
  b.pos = [0.3, 0, 18]; // a bit to the side
  run(g, 1.5, (p) => (p === a ? { ...walk(p), side: -1 } : null)); // forward + left
  assert.ok(a.pos[2] < 17, 'A got past B');
  assert.ok(Math.abs(a.pos[0] - b.pos[0]) >= 2 * PLAYER_RADIUS - 1e-3, 'by going round');
});

test('players stuck inside each other can walk apart', () => {
  const { g, a, b } = pair('ffa', 0.2);
  run(g, 0.5, (p) => (p === a ? { ...emptyCmd(), yaw: Math.PI, fwd: 1 } : null)); // walk away (+z)
  assert.ok(a.pos[2] > 21, 'A walked out');
});

test('dead players are not solid', () => {
  const { g, a, b } = pair();
  g.kill(b, null, null, false, false);
  run(g, 1, (p) => (p === a ? walk(p) : null));
  assert.ok(a.pos[2] < 17, 'A walked over the spot');
});

test('you can stand on someone\'s head', () => {
  const { g, a, b } = pair();
  a.pos = [0, STAND_HEIGHT + 0.5, 18]; a.onGround = false;
  run(g, 0.5);
  assert.ok(Math.abs(a.pos[1] - STAND_HEIGHT) < 1e-3, `A lands on B (y ${a.pos[1].toFixed(3)})`);
  assert.ok(a.onGround);
});

test('online prediction collides against the newest snapshot positions', () => {
  const { g, a, b } = pair();
  // The drawn (interpolated) B is far away; the snapshot has B right ahead.
  b.pos = [0, 0, 5];
  g.collideStates = new Map([[b.id, { alive: true, pos: [0, 0, 18], ducked: false }]]);
  for (let i = 0; i < 128; i++) g.moveStep(a, walk(a));
  assert.ok(a.pos[2] >= 18 + 2 * PLAYER_RADIUS - 1e-3, 'stopped at the snapshot B');
});
