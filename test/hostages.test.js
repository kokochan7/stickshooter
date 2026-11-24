// Shooting hostages: they can be hit like players, and each one a player
// kills in a round costs more money ($1000, $2000, $3000...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { MAPS } from '../src/maps/index.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { TICK_DT, ROUND_FREEZE, HOSTAGE_KILL_PENALTY } from '../src/sim/constants.js';
import { hostageFine, hurtHostage, objectiveInfo, applyObjectiveInfo } from '../src/sim/objective.js';

function run(g, seconds) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) g.tick(new Map());
}
const place = (p, x, y, z) => { p.pos = [x, y, z]; p.prevPos = [x, y, z]; p.vel = [0, 0, 0]; p.onGround = true; };

function hostageGame() {
  const g = new Game(MAPS.harbor, { seed: 2, mode: 'teams' });
  const red = g.addPlayer({ name: 'Red', team: 'red' });
  const blue = g.addPlayer({ name: 'Blue', team: 'blue' });
  g.restartMatch();
  run(g, ROUND_FREEZE + 0.1);
  return { g, red, blue };
}

// Stand 3 m east of the hostage and aim at its chest.
function aimAt(g, p, h) {
  place(p, h.pos[0] + 3, h.pos[1], h.pos[2]);
  p.punch = [0, 0, 0];
  const eye = g.eyePos(p);
  const dx = h.pos[0] - eye[0], dy = h.pos[1] + 1.3 - eye[1], dz = h.pos[2] - eye[2];
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

test('the fine grows with each hostage killed: $1000, $2000, $3000', () => {
  assert.equal(HOSTAGE_KILL_PENALTY, 1000);
  assert.deepEqual([1, 2, 3, 4].map(hostageFine), [1000, 2000, 3000, 4000]);
});

test('a bullet hurts a hostage, and killing it costs the shooter money', () => {
  const { g, red } = hostageGame();
  const h = g.hostages[0];
  red.money = 5000;
  assert.ok(g.buy(red, 'ak47', true));
  aimAt(g, red, h);
  g.fire(red, red.weapons.primary, WEAPONS.ak47);
  assert.ok(h.health < 100, 'the hostage was hit');
  const events = g.drainEvents();
  assert.ok(events.some((e) => e.type === 'hostageHit' && e.id === h.id));
  // Finish it off.
  for (let i = 0; i < 6 && h.alive; i++) {
    red.punch = [0, 0, 0]; red.accuracy = 0.2; red.shotsFired = 0;
    g.time += 1;
    g.fire(red, red.weapons.primary, WEAPONS.ak47);
  }
  assert.equal(h.state, 'dead');
  assert.equal(h.alive, false);
  assert.equal(red.money, 5000 - WEAPONS.ak47.price - 1000);
  assert.ok(g.drainEvents().some((e) => e.type === 'hostageKilled' && e.pid === red.id && e.fine === 1000));
});

test('each hostage killed in a round costs $1000 more; a new round starts over', () => {
  const { g, red, blue } = hostageGame();
  red.money = 10000;
  blue.money = 10000;
  const ak = WEAPONS.ak47;
  hurtHostage(g, g.hostages[0], red, 500, 'chest', [0, 0, 0], ak);
  assert.equal(red.money, 9000);
  hurtHostage(g, g.hostages[1], red, 500, 'chest', [0, 0, 0], ak);
  assert.equal(red.money, 7000);
  hurtHostage(g, g.hostages[2], red, 500, 'chest', [0, 0, 0], ak);
  assert.equal(red.money, 4000);
  // Blue pays too, counted on its own.
  hurtHostage(g, g.hostages[3], blue, 500, 'chest', [0, 0, 0], ak);
  assert.equal(blue.money, 9000);
  // Money never goes below zero.
  red.money = 500;
  const extra = { ...g.hostages[0], state: 'idle', alive: true, health: 100 };
  hurtHostage(g, extra, red, 500, 'chest', [0, 0, 0], ak);
  assert.equal(red.money, 0);
  // All hostages dead: nothing to rescue, but the round plays on.
  run(g, 0.05);
  assert.equal(g.round.state, 'live');
  // Next round the count resets.
  g.round.endsAt = g.time;
  run(g, 10);
  assert.ok(g.round.n >= 2);
  assert.equal(red.hostageKills, 0);
});

test('dead hostages stop, can\'t be led, and aren\'t hit again', () => {
  const { g, red } = hostageGame();
  const h = g.hostages[0];
  hurtHostage(g, h, red, 500, 'head', [0, 0, 0], WEAPONS.ak47);
  assert.ok(!g.targets().includes(h));
  const money = red.money;
  hurtHostage(g, h, red, 500, 'head', [0, 0, 0], WEAPONS.ak47);
  assert.equal(red.money, money, 'no second fine');
  // The client sees it dead.
  const c = new Game(MAPS.harbor, { mode: 'teams' });
  applyObjectiveInfo(c, objectiveInfo(g));
  assert.equal(c.hostages[0].state, 'dead');
  assert.equal(c.hostages[0].alive, false);
  assert.equal(c.hostages[1].alive, true);
});

test('Blue wins once every living hostage is rescued, even if some died', () => {
  const { g, red } = hostageGame();
  hurtHostage(g, g.hostages[0], red, 500, 'chest', [0, 0, 0], WEAPONS.ak47);
  for (const h of g.hostages.slice(1)) { h.state = 'rescued'; h.alive = false; }
  run(g, 0.05);
  assert.equal(g.round.winner, 'blue');
  assert.equal(g.round.reason, 'rescued');
});
