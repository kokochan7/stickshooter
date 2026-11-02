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

test('cover a bot picks really hides it, and its peek spot sees the enemy', () => {
  const g = new Game(YARD, { seed: 2, mode: 'teams' });
  const me = g.addPlayer({ name: 'R', team: 'red', isBot: true });
  const foe = g.addPlayer({ name: 'B', team: 'blue' });
  g.spawn(me); g.spawn(foe);
  const brain = new BotBrain(g, me, null, 'normal');
  brain.think(TICK_DT);
  const nav = g.nav;
  let rand = 7;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  let found = 0, tries = 0;
  for (let i = 0; i < 400 && tries < 60; i++) {
    const [ax, az] = nav.randomOpenPoint(rnd), [bx, bz] = nav.randomOpenPoint(rnd);
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 10 || d > 25 || !nav.isMain(...nav.cellOf(ax, az))) continue;
    place(me, ax, az, 0); me.pos[1] = nav.floorAt(ax, az);
    place(foe, bx, bz, 0); foe.pos[1] = nav.floorAt(bx, bz);
    const ee = g.eyePos(foe);
    if (!g.world.visible(ee[0], ee[1], ee[2], ...g.eyePos(me))) continue;
    tries++;
    const c = brain.findCover(foe, null);
    if (!c) continue;
    found++;
    const fy = nav.floorAt(c.spot[0], c.spot[1]);
    const hideY = c.low ? 1.0 : 1.6;
    assert.ok(!g.world.visible(ee[0], ee[1], ee[2], c.spot[0], fy + hideY, c.spot[1]), 'hidden at the spot');
    if (c.low) assert.ok(g.world.visible(ee[0], ee[1], ee[2], c.spot[0], fy + 1.6, c.spot[1]), 'standing up sees them');
    else assert.ok(g.world.visible(ee[0], ee[1], ee[2], c.peek[0], nav.floorAt(c.peek[0], c.peek[1]) + 1.6, c.peek[1]), 'peek spot sees them');
  }
  assert.ok(found >= 5, `found cover in ${found}/${tries} fights`);
});

test('team strategies change from round to round', async () => {
  const { teamPlan } = await import('../src/sim/botplan.js');
  const { MAPS } = await import('../src/maps/index.js');
  const g = new Game(MAPS.canal, { seed: 1, mode: 'teams' });
  g.addPlayer({ name: 'r', team: 'red', isBot: true });
  g.addPlayer({ name: 'b', team: 'blue', isBot: true });
  g.restartMatch();
  const names = [];
  for (let n = 0; n < 12; n++) {
    g.round.n = 100 + n;
    names.push(teamPlan(g, 'red').name);
    assert.equal(teamPlan(g, 'red').name, names.at(-1), 'a plan lasts the whole round');
  }
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], 'never the same plan twice in a row');
  assert.ok(new Set(names).size >= 3, names.join(','));
});
