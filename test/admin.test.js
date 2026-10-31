import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { runAdmin, MAX_BOTS } from '../src/sim/admin.js';
import { WEAPONS } from '../src/sim/weapons.js';
import { MAPS } from '../src/maps/index.js';
import {
  KILL_REWARD, KILL_STREAK_STEP, KILL_REWARD_MAX, FFA_KILL_REWARD, MULTI_KILL_WINDOW, MAX_MONEY,
} from '../src/sim/constants.js';

function setup(mode = 'ffa') {
  const g = new Game(MAPS.yard, { seed: 1, mode });
  const me = g.addPlayer({ name: 'Kenny', team: mode === 'teams' ? 'red' : 'ffa' });
  let bots = 0, diff = 'normal', map = null;
  const host = {
    maps: MAPS,
    botCount: () => bots,
    setBots: (n) => (bots = Math.max(0, Math.min(MAX_BOTS, n))),
    setDifficulty: (d) => { diff = d; },
    changeMap: (id) => { map = id; },
  };
  g.restartMatch();
  return { g, me, host, state: () => ({ bots, diff, map }) };
}

test('money adds to you, capped at the max', () => {
  const { g, me, host } = setup();
  me.money = 1000;
  assert.ok(runAdmin(g, host, me, 'money 2500').ok);
  assert.equal(me.money, 3500);
  runAdmin(g, host, me, 'money 999999');
  assert.equal(me.money, MAX_MONEY);
});

test('bot commands go through the host and stop at 32', () => {
  const { g, me, host, state } = setup();
  runAdmin(g, host, me, 'addbot 5');
  assert.equal(state().bots, 5);
  runAdmin(g, host, me, 'removebot 2');
  assert.equal(state().bots, 3);
  runAdmin(g, host, me, 'bots 99');
  assert.equal(state().bots, MAX_BOTS);
  runAdmin(g, host, me, 'removebot all');
  assert.equal(state().bots, 0);
  runAdmin(g, host, me, 'difficulty hard');
  assert.equal(state().diff, 'hard');
  assert.equal(runAdmin(g, host, me, 'difficulty silly').ok, false);
});

test('give, heal, god, slay, map and unknown commands', () => {
  const { g, me, host, state } = setup();
  const other = g.addPlayer({ name: 'Doodle' });
  g.spawn(me); g.spawn(other);
  me.money = 0;
  runAdmin(g, host, me, 'give awp');
  assert.equal(me.weapons.primary.id, 'awp');
  assert.equal(me.money, 0, 'give is free');
  me.health = 5;
  runAdmin(g, host, me, 'heal');
  assert.equal(me.health, 100);
  assert.equal(me.armor, 100);
  runAdmin(g, host, me, 'god');
  me.frozenUntil = 0;
  g.damage(me, other, 400, 'head', me.pos, WEAPONS.awp, false, [0, 0, 1]);
  assert.equal(me.health, 100, 'god mode takes no damage');
  runAdmin(g, host, me, 'slay doo');
  assert.equal(other.alive, false);
  runAdmin(g, host, me, 'map canal');
  assert.equal(state().map, 'canal');
  assert.equal(runAdmin(g, host, me, 'map nowhere').ok, false);
  assert.equal(runAdmin(g, host, me, 'fly').ok, false);
  assert.ok(runAdmin(g, host, me, 'help').lines.length > 5);
});

test('free for all pays the same for every kill', () => {
  const { g, me } = setup();
  me.money = 0;
  for (let i = 0; i < 3; i++) {
    const v = g.addPlayer({ name: 'V' + i });
    g.spawn(v);
    g.kill(v, me, WEAPONS.ak47, false, false);
  }
  assert.equal(me.money, FFA_KILL_REWARD * 3);
});

test('teams pays more for each kill in the same round (life), then resets', () => {
  const { g, me } = setup('teams');
  g.spawn(me);
  me.money = 0;
  const kills = 10;
  let expect = 0;
  for (let i = 0; i < kills; i++) {
    const v = g.addPlayer({ name: 'V' + i, team: 'blue' });
    g.spawn(v);
    g.kill(v, me, WEAPONS.ak47, false, false);
    expect += Math.min(KILL_REWARD_MAX, KILL_REWARD + KILL_STREAK_STEP * i);
  }
  assert.equal(me.money, expect);
  assert.ok(KILL_REWARD + KILL_STREAK_STEP > KILL_REWARD);
  g.spawn(me); // a new life starts the streak over
  assert.equal(g.killReward(me), KILL_REWARD);
});

test('kills close together count as a multi kill', () => {
  const { g, me } = setup();
  g.drainEvents();
  const kill = () => { const v = g.addPlayer({ name: 'V' }); g.spawn(v); g.kill(v, me, WEAPONS.ak47, false, false); };
  kill(); kill(); kill();
  let multis = g.drainEvents().filter((e) => e.type === 'kill').map((e) => e.multi);
  assert.deepEqual(multis, [1, 2, 3]);
  g.time += MULTI_KILL_WINDOW + 0.1;
  kill();
  multis = g.drainEvents().filter((e) => e.type === 'kill').map((e) => e.multi);
  assert.deepEqual(multis, [1]);
});
