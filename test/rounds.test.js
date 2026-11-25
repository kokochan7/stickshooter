// Bot takeover, F1 re-buy, holding the bomb, round limit and drops that stay
// for the round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { MAPS } from '../src/maps/index.js';
import { TICK_DT, ROUND_FREEZE, ROUND_WIN_LIMIT, NEVER, BUY_TIME } from '../src/sim/constants.js';
import { sanitizeCmd } from '../src/net/protocol.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}
const hold = (p, extra = {}) => ({ ...emptyCmd(), yaw: p.yaw, pitch: 0, ...extra });

function teamsGame() {
  const g = new Game(MAPS.canal, { seed: 3, mode: 'teams' });
  const me = g.addPlayer({ name: 'Kenny', team: 'red' });
  const bot = g.addPlayer({ name: 'Bot', team: 'red', isBot: true });
  const enemy = g.addPlayer({ name: 'Enemy', team: 'blue', isBot: true });
  g.restartMatch();
  run(g, ROUND_FREEZE + 0.1);
  return { g, me, bot, enemy };
}

test('team matches are first to 7 rounds', () => {
  assert.equal(ROUND_WIN_LIMIT, 7);
});

test('a dead player takes over a teammate bot with its body, gear and the bomb', () => {
  const { g, me, bot, enemy } = teamsGame();
  // Make sure the bot has the bomb.
  if (g.bomb.carrier !== bot.id) {
    me.weapons.c4 = null;
    g.bomb.carrier = bot.id;
    bot.weapons.c4 = { id: 'c4', clip: 0, reserve: 0 };
  }
  bot.health = 63; bot.armor = 40;
  g.kill(me, enemy, null, false, false);
  assert.ok(!me.alive);
  const deaths = bot.deaths;
  const pos = [...bot.pos];
  assert.ok(!g.canTakeOver(me, enemy), 'not an enemy bot');
  run(g, TICK_DT, (p) => (p === me ? hold(p, { actions: [{ type: 'takeover', id: bot.id }] }) : null));
  assert.ok(me.alive, 'alive again in the bot');
  assert.ok(!bot.alive, 'the bot sits out');
  assert.equal(bot.deaths, deaths, 'not a death for the bot');
  assert.equal(bot.respawnAt, NEVER, 'back next round');
  assert.equal(me.health, 63);
  assert.equal(me.armor, 40);
  assert.ok(Math.hypot(me.pos[0] - pos[0], me.pos[2] - pos[2]) < 0.5, 'where the bot stood');
  assert.equal(g.bomb.carrier, me.id, 'the bomb comes along');
  assert.ok(me.weapons.c4);
});

test('takeover only works for a dead human on the same team in Teams', () => {
  const { g, me, bot } = teamsGame();
  assert.ok(!g.canTakeOver(me, bot), 'you have to be dead');
  const ffa = new Game(MAPS.yard, { seed: 1, mode: 'ffa' });
  const a = ffa.addPlayer({ name: 'A' });
  const b = ffa.addPlayer({ name: 'B', isBot: true });
  ffa.restartMatch();
  run(ffa, 4);
  a.alive = false;
  assert.ok(!ffa.canTakeOver(a, b), 'not in free for all');
});

test('the takeover and rebuy actions survive the wire', () => {
  const c = sanitizeCmd({ actions: [{ type: 'takeover', id: 4 }, { type: 'rebuy', items: ['ak47', 'kevlarHelmet', 5] }], slot: 'c4' });
  assert.deepEqual(c.actions, [{ type: 'takeover', id: 4 }, { type: 'rebuy', items: ['ak47', 'kevlarHelmet'] }]);
  assert.equal(c.slot, 'c4');
});

test('F1 re-buy buys what you lack and skips what you have', () => {
  const g = new Game(MAPS.canal, { seed: 5, mode: 'teams' });
  const p = g.addPlayer({ name: 'P', team: 'blue' });
  g.restartMatch();
  run(g, 0.5);
  p.money = 16000;
  assert.equal(g.rebuy(p, ['m4a1', 'kevlarHelmet', 'hegrenade', 'defuser']), 4);
  assert.equal(p.weapons.primary.id, 'm4a1');
  assert.ok(p.helmet && p.armor === 100 && p.defuser && p.weapons.grenade);
  const money = p.money;
  assert.equal(g.rebuy(p, ['m4a1', 'kevlarHelmet', 'defuser']), 0, 'nothing new to buy');
  assert.equal(p.money, money, 'and nothing spent');
  // Not after the buy time.
  run(g, BUY_TIME + 1);
  p.weapons.primary = null;
  assert.equal(g.rebuy(p, ['m4a1']), 0);
});

test('key 5 takes out the bomb, key 3 is always the knife; G drops the bomb ahead', () => {
  const g = new Game(MAPS.canal, { seed: 7, mode: 'teams' });
  const red = g.addPlayer({ name: 'Red', team: 'red' });
  g.addPlayer({ name: 'Blue', team: 'blue' });
  g.restartMatch();
  assert.equal(g.bomb.carrier, red.id);
  assert.ok(red.weapons.c4, 'the carrier has the C4');
  run(g, TICK_DT, (p) => (p === red ? hold(p, { slot: 'melee' }) : null));
  assert.equal(red.active, 'melee', 'key 3: the knife, even with the bomb');
  run(g, TICK_DT, (p) => (p === red ? hold(p, { slot: 'c4' }) : null));
  assert.equal(red.active, 'c4', 'key 5: the bomb');
  run(g, TICK_DT, (p) => (p === red ? hold(p, { slot: 'melee' }) : null));
  assert.equal(red.active, 'melee');
  run(g, TICK_DT, (p) => (p === red ? hold(p, { slot: 'c4' }) : null));
  assert.equal(red.active, 'c4');
  run(g, ROUND_FREEZE + 0.1);
  run(g, TICK_DT, (p) => (p === red ? hold(p, { actions: [{ type: 'drop' }] }) : null));
  assert.equal(g.bomb.state, 'dropped');
  assert.equal(red.weapons.c4, null);
  assert.notEqual(red.active, 'c4');
  run(g, 0.5);
  assert.equal(g.bomb.state, 'dropped', 'not picked straight back up');
  assert.ok(!g.buy(red, 'c4'), 'the bomb is not for sale');
});

test('in objective rounds a dead player\'s gun stays until the round ends', () => {
  const { g, me, enemy } = teamsGame();
  me.weapons.primary = { id: 'ak47', clip: 30, reserve: 90 };
  g.kill(me, enemy, null, false, false);
  const d = g.drops.find((x) => x.weapon.id === 'ak47');
  assert.ok(d);
  assert.equal(d.expiresAt, NEVER);
  run(g, 15);
  assert.ok(g.drops.includes(d) || g.round.state !== 'live', 'still there 15 s later');
});

test('playing a bot: kills and deaths are the bot\'s, and it gets its body back at round end', () => {
  const { g, me, bot, enemy } = teamsGame();
  const enemy2 = g.addPlayer({ name: 'Enemy 2', team: 'blue', isBot: true });
  enemy2.alive = true; enemy2.pos = [...enemy.pos]; enemy2.prevPos = [...enemy.pos];
  bot.money = 3000; me.money = 800;
  bot.weapons.primary = { id: 'm4a1', clip: 30, reserve: 90 };
  g.kill(me, enemy, null, false, false);
  const myDeaths = me.deaths, botKills = bot.kills;
  assert.ok(g.takeOver(me, bot));
  assert.equal(me.money, 3000, 'you spend the bot\'s money');
  g.kill(enemy2, me, null, true, false);
  assert.equal(me.kills, 0, 'not your kill');
  assert.equal(bot.kills, botKills + 1, 'the bot\'s kill');
  assert.equal(bot.headshots, 1);
  // The round ends with you alive in the bot: the bot keeps the body.
  g.kill(enemy, me, null, false, false);
  const money = me.money;
  run(g, 6);
  assert.equal(g.round.n, 2);
  assert.equal(me.controlling, null);
  assert.equal(bot.money, money, 'the bot gets its money back, kill rewards included');
  assert.equal(me.money, 800, 'your own money again');
  assert.equal(bot.weapons.primary?.id, 'm4a1', 'the bot keeps its gun');
  assert.equal(me.weapons.primary, null, 'you start over with a pistol');
  assert.equal(me.deaths, myDeaths);
});

test('if the bot\'s body dies while you play it, the death is the bot\'s', () => {
  const { g, me, bot, enemy } = teamsGame();
  g.kill(me, enemy, null, false, false);
  const myDeaths = me.deaths, botDeaths = bot.deaths;
  bot.money = 2000; me.money = 500;
  assert.ok(g.takeOver(me, bot));
  g.kill(me, enemy, null, false, false);
  assert.equal(me.deaths, myDeaths);
  assert.equal(bot.deaths, botDeaths + 1);
  assert.equal(me.controlling, null);
  assert.equal(me.money, 500);
  assert.equal(bot.money, 2000);
  assert.ok(!bot.alive);
});

test('planted bomb beeps once at a time, faster as the timer runs out', async () => {
  const { bombBeepInterval } = await import('../src/sim/objective.js');
  const { BOMB_TIMER } = await import('../src/sim/constants.js');
  let prev = Infinity;
  for (let left = BOMB_TIMER; left >= 0; left -= 0.5) {
    const iv = bombBeepInterval(left);
    assert.ok(iv <= prev, `interval grows at ${left}s left`);
    prev = iv;
  }
  assert.ok(bombBeepInterval(BOMB_TIMER) > 1.2, 'slow right after the plant');
  assert.ok(bombBeepInterval(1) < 0.15, 'rapid beeping at the very end');
  // About how many beeps a full timer gives (CS 1.6 is in the same range).
  let n = 0;
  for (let t = 0; t < BOMB_TIMER; t += bombBeepInterval(BOMB_TIMER - t)) n++;
  assert.ok(n > 40 && n < 120, `${n} beeps`);
});
