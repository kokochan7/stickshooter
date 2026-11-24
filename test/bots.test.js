import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain, ROLES } from '../src/sim/bot.js';
import { TICK_DT } from '../src/sim/constants.js';
import { WEAPONS, teamCanBuy } from '../src/sim/weapons.js';
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

// ---------- Buying, the bomb and bunny hops ----------

import { MAPS } from '../src/maps/index.js';
import { ROUND_FREEZE, ROUND_TIME } from '../src/sim/constants.js';

function bot(g, team, difficulty = 'normal') {
  const p = g.addPlayer({ name: team + g.players.length, team, isBot: true });
  return new BotBrain(g, p, null, difficulty);
}

function runBots(g, brains, seconds, until = () => false) {
  for (let i = 0; i < seconds / TICK_DT; i++) {
    const cmds = new Map();
    for (const b of brains) cmds.set(b.p.id, b.think(TICK_DT));
    g.tick(cmds);
    if (until(g)) return true;
  }
  return false;
}

// A seeded random source, so buy tests don't flake.
function seeded(seed) {
  let x = seed * 2654435761 % 4294967296 || 1;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function buyWith(money, { team = 'red', diff = 'normal', seed = 1, objective = null } = {}) {
  const map = objective === 'bomb' ? MAPS.canal : YARD;
  const g = new Game(map, { seed: 1, mode: 'teams' });
  const b = bot(g, team, diff);
  g.spawn(b.p);
  b.p.money = money;
  b.buyLoadout(seeded(seed));
  return b.p;
}

test('rich bots buy to the fullest: Kevlar + helmet, a strong gun and grenades', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 30; seed++) {
      const p = buyWith(9000, { diff, seed });
      assert.ok(p.armor === 100 && p.helmet, `${diff} seed ${seed}: armor`);
      const gun = p.weapons.primary?.id;
      assert.ok(gun && WEAPONS[gun].price >= 2000, `${diff} seed ${seed}: bought ${gun}`);
      assert.ok(p.weapons.grenade?.clip > 0, 'an HE');
      assert.ok(p.money >= 0 && p.money < 9000);
    }
  }
});

test('more money buys stronger guns, more grenades and more armor', () => {
  const avg = (money) => {
    let price = 0, nades = 0, helmets = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const p = buyWith(money, { seed });
      price += p.weapons.primary ? WEAPONS[p.weapons.primary.id].price : 0;
      nades += (p.weapons.grenade?.clip ?? 0) + (p.weapons.smoke?.clip ?? 0);
      helmets += p.helmet ? 1 : 0;
    }
    return { price: price / 200, nades: nades / 200, helmets: helmets / 200 };
  };
  const poor = avg(2000), mid = avg(3500), rich = avg(7000);
  assert.ok(poor.price < mid.price && mid.price < rich.price, `${poor.price} ${mid.price} ${rich.price}`);
  assert.ok(poor.nades < rich.nades, `${poor.nades} ${rich.nades}`);
  assert.ok(poor.helmets < rich.helmets && rich.helmets === 1, `${poor.helmets} ${rich.helmets}`);
});

test('bot buys are random: a lobby of rich bots carries a mix of guns', () => {
  const guns = new Set();
  for (let seed = 1; seed <= 60; seed++) guns.add(buyWith(6000, { seed, team: 'blue' }).weapons.primary?.id);
  assert.ok(guns.size >= 4, [...guns].join(' '));
  assert.ok(guns.has('m4a1'), 'M4s are common');
});

test('a poor bot spends what it has and never goes below zero', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const p = buyWith(800, { seed, diff: 'hard' });
    assert.ok(p.money >= 0 && p.money < 800, `seed ${seed}: $${p.money} left`);
    assert.equal(p.weapons.primary, null, 'no rifle on a pistol round');
  }
  // $700, hard: a vest is the buy.
  const g = new Game(YARD, { seed: 1, mode: 'teams' });
  const b = bot(g, 'red', 'hard');
  g.spawn(b.p);
  b.p.money = 700;
  b.buyLoadout(() => 0.5);
  assert.equal(b.p.armor, 100);
  assert.equal(b.p.helmet, false);
  assert.equal(b.p.money, 50);
});

test('Blue bots on bomb maps buy a kit when they have money', () => {
  for (let seed = 1; seed <= 20; seed++) {
    assert.ok(buyWith(6000, { team: 'blue', seed, objective: 'bomb' }).defuser, `seed ${seed}`);
  }
});

test('Red bots carry the bomb in, plant it, and hold posts that can see it', () => {
  const g = new Game(MAPS.canal, { seed: 11, mode: 'teams' });
  const brains = [bot(g, 'red'), bot(g, 'red'), bot(g, 'red')];
  g.restartMatch();
  assert.ok(runBots(g, brains, ROUND_FREEZE + ROUND_TIME.bomb, (g) => g.bomb.state === 'planted'), `bomb is ${g.bomb.state}`);
  runBots(g, brains, 31); // on a CS-sized map the flank can be a long walk away when the bomb goes down,
  // and bots shift-walk and stop to check angles on the way in
  const b = g.bomb;
  let watching = 0;
  for (const br of brains) {
    const p = br.p;
    assert.ok(Math.hypot(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]) < 17, `${br.role} stayed near the bomb`);
    if (g.world.visible(p.pos[0], p.pos[1] + 1.0, p.pos[2], b.pos[0], b.pos[1] + 0.3, b.pos[2])) watching++;
  }
  assert.ok(watching >= 2, `${watching}/3 can see the bomb`);
  // Someone starts defusing: they all come back for it.
  const blue = g.addPlayer({ name: 'B', team: 'blue' });
  blue.alive = true;
  b.defuser = blue.id;
  for (const br of brains) {
    const obj = br.objective(emptyCmd());
    assert.deepEqual(obj.goal, b.pos);
    assert.ok(obj.urgent);
  }
});

test('only the nearest two go back for a dropped bomb', () => {
  const g = new Game(MAPS.canal, { seed: 3, mode: 'teams' });
  const brains = [bot(g, 'red'), bot(g, 'red'), bot(g, 'red'), bot(g, 'red')];
  g.restartMatch();
  runBots(g, brains, ROUND_FREEZE + 1);
  const carrier = g.getPlayer(g.bomb.carrier);
  g.bomb.state = 'dropped'; g.bomb.carrier = null; g.bomb.pos = [...carrier.pos];
  const going = brains.filter((b) => { const o = b.objective(emptyCmd()); return o?.goal === g.bomb.pos; });
  assert.equal(going.length, 2);
});

test('bots each have their own idea of the best route', async () => {
  const { MAPS } = await import('../src/maps/index.js');
  const g = new Game(MAPS.canal, { mode: 'teams' });
  const nav = g.nav;
  const a = MAPS.canal.teamSpawns.red[0].pos, b = MAPS.canal.teamSpawns.blue[0].pos;
  const routes = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const path = nav.findPath(a[0], a[2], b[0], b[2], { seed, amt: 0.5 });
    assert.ok(path, 'a route exists');
    routes.add(path.map(([x, z]) => `${x.toFixed(0)},${z.toFixed(0)}`).join(' '));
  }
  assert.ok(routes.size >= 3, `${routes.size} different routes out of 6`);
});

test('bots ease into turns instead of snapping', () => {
  const g = new Game(YARD, { seed: 1, mode: 'teams' });
  const p = g.addPlayer({ name: 'r', team: 'red', isBot: true });
  const b = new BotBrain(g, p, null, 'normal');
  b.steer([1, 0], TICK_DT);
  const d = b.steer([0, 1], TICK_DT); // a 90 degree turn
  const turned = Math.atan2(d[1], d[0]);
  assert.ok(turned > 0 && turned < 0.1, `turned ${turned.toFixed(3)} rad in one tick`);
});

test('bots only buy their own team guns in team modes', () => {
  for (const team of ['red', 'blue']) {
    for (let i = 0; i < 40; i++) {
      const g = new Game(YARD, { seed: i, mode: 'teams' });
      const p = g.addPlayer({ name: 'b', team, isBot: true });
      const b = new BotBrain(g, p, null, 'hard');
      g.spawn(p);
      p.money = 16000;
      b.buyLoadout(() => (i + 0.5) / 40);
      for (const s of ['primary', 'secondary']) {
        const id = p.weapons[s]?.id;
        assert.ok(!id || teamCanBuy(id, team), `${team} bot has ${id}`);
      }
    }
  }
});

test('a Red team takes different ways to the site: straight, left and right', () => {
  const g = new Game(MAPS.canal, { seed: 4, mode: 'teams' });
  const brains = [bot(g, 'red'), bot(g, 'red'), bot(g, 'red')];
  g.restartMatch();
  runBots(g, brains, ROUND_FREEZE + 0.5);
  const lanes = brains.map((b) => b.lane());
  assert.deepEqual([...lanes].map(String).sort(), ['-1', '1', 'false'], lanes.join(' '));
  // On an execute, everyone not escorting the bomb goes in by their own lane.
  const plan = brains[0].plan();
  plan.name = 'execute'; plan.goAt = 0;
  for (const b of brains) {
    const obj = b.objective(emptyCmd());
    if (obj?.goal && !obj.escort && b.p.id !== g.bomb.carrier) assert.equal(obj.detour, b.lane());
  }
});

test('far out, a bot stops before it shoots and taps instead of spraying', async () => {
  const { rangeAim } = await import('../src/sim/bot.js');
  assert.equal(rangeAim(10), 1);
  assert.ok(rangeAim(40) < 0.5);
  const g = new Game(YARD, { seed: 2, mode: 'ffa' });
  const a = g.addPlayer({ name: 'A', team: 'red', isBot: true });
  const x = g.addPlayer({ name: 'X', team: 'blue' });
  g.spawn(a); g.spawn(x);
  // Find an open lane 35 m long.
  let lane = null;
  for (let tx = -30; tx <= 30 && !lane; tx++) {
    for (const tz of [-20, -10, 0, 10, 20]) {
      if (g.world.visible(tx, 1.6, tz - 17.5, tx, 1.6, tz + 17.5) && g.world.visible(tx, 0.3, tz - 17.5, tx, 0.3, tz + 17.5)) { lane = [tx, tz]; break; }
    }
  }
  assert.ok(lane, 'an open lane');
  place(a, lane[0], lane[1] - 17.5, Math.PI); place(x, lane[0], lane[1] + 17.5, 0);
  a.frozenUntil = 0; x.frozenUntil = 0;
  const b = new BotBrain(g, a, null, 'hard');
  b.buyLoadout = () => {};
  a.money = 16000; g.buy(a, 'ak47', true);
  let movingShots = 0, longestBurst = 0, burst = 0;
  for (let i = 0; i < 3 / TICK_DT; i++) {
    x.health = 100;
    // Keep shoving the bot sideways at a run, like it just strafed.
    if (i % 64 === 0) a.vel[0] = 5;
    const fast = Math.hypot(a.vel[0], a.vel[2]) / 0.025 > 140;
    const cmd = b.think(TICK_DT);
    if (cmd.fire && fast) movingShots++;
    const c0 = a.weapons.primary.clip;
    g.tick(new Map([[a.id, cmd], [x.id, { ...emptyCmd(), yaw: 0, pitch: 0 }]]));
    if (a.weapons.primary.clip < c0) longestBurst = Math.max(longestBurst, ++burst);
    else if (!cmd.fire) burst = 0;
  }
  assert.equal(movingShots, 0, 'never fires at a run at 35 m');
  assert.ok(longestBurst > 0 && longestBurst <= 3, `burst of ${longestBurst}`);
});
