import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain, ROLES } from '../src/sim/bot.js';
import { TICK_DT } from '../src/sim/constants.js';
import { YARD } from '../src/maps/yard.js';

function place(p, x, z, yaw) {
  p.pos = [x, 0, z]; p.prevPos = [...p.pos]; p.vel = [0, 0, 0]; p.yaw = yaw; p.pitch = 0;
}

test('a team of bots gets a mix of roles', () => {
  const g = new Game(YARD, { seed: 5, mode: 'teams' });
  const brains = [];
  for (let i = 0; i < ROLES.length; i++) {
    const p = g.addPlayer({ name: 'r' + i, team: 'red', isBot: true });
    const b = new BotBrain(g, p, null, 'normal');
    g.spawn(p);
    b.think(TICK_DT); // first think of a life deals the role
    brains.push(b);
  }
  assert.deepEqual(brains.map((b) => b.role).sort(), [...ROLES].sort());
});

test('two bots facing two enemies split their fire', () => {
  let split = 0;
  for (let trial = 0; trial < 10; trial++) {
    const g = new Game(YARD, { seed: trial, mode: 'teams' });
    const [a, b] = ['A', 'B'].map((n) => g.addPlayer({ name: n, team: 'red', isBot: true }));
    const [x, y] = ['X', 'Y'].map((n) => g.addPlayer({ name: n, team: 'blue' }));
    for (const p of [a, b, x, y]) g.spawn(p);
    place(a, -1, 20, 0); place(b, 1, 20, 0);
    place(x, -3, 12, Math.PI); place(y, 3, 12, Math.PI);
    const ba = new BotBrain(g, a, null, 'normal'), bb = new BotBrain(g, b, null, 'normal');
    for (let i = 0; i < 40; i++) {
      const cmds = new Map([[a.id, ba.think(TICK_DT)], [b.id, bb.think(TICK_DT)]]);
      for (const p of [x, y]) cmds.set(p.id, { ...emptyCmd(), yaw: p.yaw, pitch: 0 });
      g.tick(cmds);
    }
    assert.ok(ba.targetVisible && bb.targetVisible, 'both see an enemy');
    if (ba.target !== bb.target) split++;
  }
  assert.ok(split >= 7, `bots split targets in ${split}/10 trials`);
});

test('bots pick roam spots away from each other', () => {
  const g = new Game(YARD, { seed: 9, mode: 'teams' });
  const brains = [];
  for (let i = 0; i < 4; i++) {
    const p = g.addPlayer({ name: 'r' + i, team: 'red', isBot: true });
    g.spawn(p);
    const b = new BotBrain(g, p, null, 'normal');
    b.think(TICK_DT);
    b.roamGoal = b.pickRoamGoal();
    brains.push(b);
  }
  let min = Infinity;
  for (const a of brains) for (const b of brains) {
    if (a !== b) min = Math.min(min, Math.hypot(a.roamGoal[0] - b.roamGoal[0], a.roamGoal[2] - b.roamGoal[2]));
  }
  assert.ok(min > 4, `closest two roam spots are ${min.toFixed(1)} m apart`);
});
