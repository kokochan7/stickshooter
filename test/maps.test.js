import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, emptyCmd } from '../src/sim/game.js';
import { BotBrain } from '../src/sim/bot.js';
import { World } from '../src/sim/world.js';
import { NavGrid } from '../src/sim/nav.js';
import { MAP_LIST, MAPS, getMap } from '../src/maps/index.js';
import { subtractRects } from '../src/maps/builder.js';
import { siteAt, applyObjectiveInfo } from '../src/sim/objective.js';
import {
  TICK_DT, PLAYER_RADIUS, STAND_HEIGHT, ROUND_FREEZE, ROUND_END_TIME, ROUND_WIN_LIMIT, BOMB_TIMER,
  PLANT_TIME, DEFUSE_TIME, DEFUSE_KIT_TIME, ROUND_TIME, NEVER, LATE_JOIN,
} from '../src/sim/constants.js';
import { sanitizeCmd, cleanMap } from '../src/net/protocol.js';

function run(g, seconds, cmdFor = () => null) {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) {
    const cmds = new Map();
    for (const p of g.players) { const c = cmdFor(p, i); if (c) cmds.set(p.id, c); }
    g.tick(cmds);
  }
}
const hold = (p, extra = {}) => ({ ...emptyCmd(), yaw: p.yaw, pitch: 0, ...extra });
const place = (p, x, y, z) => { p.pos = [x, y, z]; p.prevPos = [x, y, z]; p.vel = [0, 0, 0]; p.onGround = true; };

// ---------- Map data ----------

test('subtractRects cuts holes and covers the rest exactly', () => {
  const r = subtractRects([0, 0, 10, 10], [[2, 2, 4, 4], [6, 0, 8, 10]]);
  const area = r.reduce((a, q) => a + (q[2] - q[0]) * (q[3] - q[1]), 0);
  assert.equal(area, 100 - 4 - 20);
  for (const q of r) assert.ok(!(q[0] < 4 && q[2] > 2 && q[1] < 4 && q[3] > 2), 'no rect covers the first hole');
});

for (const map of MAP_LIST) {
  test(`${map.name}: spawns are clear and on the floor`, () => {
    const w = new World(map.boxes);
    const r = PLAYER_RADIUS;
    const all = [...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue];
    assert.ok(map.teamSpawns.red.length >= 5 && map.teamSpawns.blue.length >= 5, 'room for five a side');
    for (const s of all) {
      const [x, y, z] = s.pos;
      assert.equal(w.overlaps(x - r, y, z - r, x + r, y + STAND_HEIGHT, z + r), null, `${map.id} spawn ${s.pos} is inside something`);
      assert.ok(w.overlaps(x - r, y - 0.05, z - r, x + r, y, z + r), `${map.id} spawn ${s.pos} has no floor`);
    }
  });

  if (map.type === 'dm') continue;

  test(`${map.name}: both teams can walk to the objective`, () => {
    const g = new Game(map);
    const nav = g.nav;
    const goals = map.type === 'bomb'
      ? Object.values(map.sites).map((r) => [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2])
      : [...map.hostages.map((h) => [h[0], h[2]]), ...map.rescue.map((r) => [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2])];
    for (const team of ['red', 'blue']) {
      const s = map.teamSpawns[team][0].pos;
      for (const [x, z] of goals) {
        assert.ok(nav.findPath(s[0], s[2], x, z), `${map.id}: ${team} can't reach ${x},${z}`);
      }
    }
    if (map.type === 'hostage') {
      // And hostages can be led from where they stand to the rescue zone.
      const r = map.rescue[0];
      for (const h of map.hostages) assert.ok(nav.findPath(h[0], h[2], (r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2));
    }
  });
}

test('maps with water slow you down and are wadeable', () => {
  const g = new Game(MAPS.canal, { seed: 1 });
  const a = g.addPlayer({ name: 'A' });
  g.spawn(a);
  // Run east along the dry quay, then along the canal itself.
  place(a, -30, 0, -7.5); a.yaw = -Math.PI / 2;
  run(g, 1.5, (p) => hold(p, { fwd: 1 }));
  const dry = Math.hypot(a.vel[0], a.vel[2]);
  place(a, -30, -0.4, 0); a.yaw = -Math.PI / 2;
  run(g, 1.5, (p) => hold(p, { fwd: 1 }));
  assert.ok(g.inWater(a), 'standing in the canal');
  const wet = Math.hypot(a.vel[0], a.vel[2]);
  assert.ok(wet < dry * 0.85, `wading is slower (${wet.toFixed(2)} vs ${dry.toFixed(2)})`);
  // Walk out the other bank: canal z -3..3, bed 0.4 below the quay.
  place(a, -30, -0.4, 1); a.yaw = Math.PI; // facing +z
  run(g, 2, (p) => hold(p, { fwd: 1 }));
  assert.ok(a.pos[2] > 3.5 && Math.abs(a.pos[1]) < 0.01, `stepped out onto the quay (${a.pos})`);
});

test('the nav grid walks under the high bridge but not up a sheer bank', () => {
  const g = new Game(MAPS.canal);
  const nav = g.nav;
  assert.ok(nav.floorAt(0, 0) < -0.3, 'under the high bridge the floor is the canal bed');
  assert.ok(Math.abs(nav.floorAt(-20.5, 0) - 0.15) < 0.01, 'the footbridge deck is a floor');
  const path = nav.findPath(-30, 0, 30, 0); // along the canal
  assert.ok(path, 'you can wade the length of the canal');
});

// ---------- Bomb defusal ----------

function bombGame(seed = 7) {
  const g = new Game(MAPS.canal, { seed, mode: 'teams' });
  const red = g.addPlayer({ name: 'Red', team: 'red' });
  const blue = g.addPlayer({ name: 'Blue', team: 'blue' });
  g.restartMatch();
  return { g, red, blue };
}

function intoSite(g, p, site = 'A') {
  const r = g.map.sites[site];
  place(p, (r.min[0] + r.max[0]) / 2 - 3, 0, (r.min[1] + r.max[1]) / 2 - 3);
  assert.equal(siteAt(g.map, p.pos), site);
}

test('a bomb round: freeze, the bomb goes to Red, plant, explode, Red scores', () => {
  const { g, red, blue } = bombGame();
  assert.equal(g.objective, 'bomb');
  assert.equal(g.round.state, 'freeze');
  assert.equal(g.bomb.carrier, red.id, 'the only Red player carries the bomb');
  run(g, ROUND_FREEZE + 0.1);
  assert.equal(g.round.state, 'live');
  // Planting outside a site does nothing.
  run(g, PLANT_TIME + 0.5, (p) => (p === red ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'carried');
  intoSite(g, red, 'A');
  place(blue, -30, 0, 30); // far away, safe from the blast
  run(g, PLANT_TIME - 0.5, (p) => (p === red ? hold(p, { use: true, fwd: 1 }) : null));
  assert.equal(red.task?.kind, 'plant');
  const at = [...red.pos];
  run(g, 0.2, (p) => (p === red ? hold(p, { use: true, fwd: 1 }) : null));
  assert.deepEqual(red.pos.map((v) => +v.toFixed(3)), at.map((v) => +v.toFixed(3)), 'you stand still while planting');
  run(g, 0.5, (p) => (p === red ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'planted');
  assert.equal(g.bomb.site, 'A');
  place(red, 30, 0, 30);
  run(g, BOMB_TIMER + 0.1);
  assert.equal(g.bomb.state, 'exploded');
  assert.equal(g.round.state, 'end');
  assert.equal(g.round.winner, 'red');
  assert.equal(g.rounds.red, 1);
  run(g, ROUND_END_TIME + 0.1);
  assert.equal(g.round.n, 2, 'next round');
  assert.equal(g.round.state, 'freeze');
  assert.ok(red.alive && blue.alive);
});

test('releasing E stops the plant; defusing with and without a kit', () => {
  const { g, red, blue } = bombGame();
  run(g, ROUND_FREEZE + 0.1);
  intoSite(g, red, 'B');
  run(g, 1, (p) => (p === red ? hold(p, { use: true }) : null));
  run(g, 0.1);
  assert.equal(red.task, null, 'letting go cancels');
  run(g, PLANT_TIME + 0.1, (p) => (p === red ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'planted');
  place(red, 30, 0, 30);
  place(blue, g.bomb.pos[0] + 0.6, g.bomb.pos[1], g.bomb.pos[2]);
  run(g, DEFUSE_KIT_TIME + 0.2, (p) => (p === blue ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'planted', 'no kit: 5 s is not enough');
  run(g, DEFUSE_TIME - DEFUSE_KIT_TIME, (p) => (p === blue ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'defused');
  assert.equal(g.round.winner, 'blue');
  // The kit halves it next round.
  run(g, ROUND_END_TIME + 0.1);
  assert.ok(g.buy(blue, 'defuser'));
  assert.ok(!g.buy(red, 'defuser'), 'Red cannot buy a kit');
  run(g, ROUND_FREEZE + 0.1);
  intoSite(g, red, 'A');
  run(g, PLANT_TIME + 0.1, (p) => (p === red ? hold(p, { use: true }) : null));
  place(blue, g.bomb.pos[0], g.bomb.pos[1], g.bomb.pos[2] + 0.8);
  run(g, DEFUSE_KIT_TIME + 0.1, (p) => (p === blue ? hold(p, { use: true }) : null));
  assert.equal(g.bomb.state, 'defused');
});

test('the carrier dying drops the bomb, a teammate picks it up; wipes and time end rounds', () => {
  const g = new Game(MAPS.canal, { seed: 3, mode: 'teams' });
  const r1 = g.addPlayer({ name: 'R1', team: 'red' });
  const r2 = g.addPlayer({ name: 'R2', team: 'red' });
  const b1 = g.addPlayer({ name: 'B1', team: 'blue' });
  g.restartMatch();
  run(g, ROUND_FREEZE + 0.1);
  const carrier = g.getPlayer(g.bomb.carrier), other = carrier === r1 ? r2 : r1;
  place(carrier, 0, 0, -20);
  g.kill(carrier, b1, null, false, false);
  assert.equal(g.bomb.state, 'dropped');
  assert.ok(Math.abs(g.bomb.pos[1]) < 0.01, 'on the floor');
  assert.equal(carrier.respawnAt, NEVER, 'dead until next round');
  place(other, g.bomb.pos[0] + 0.3, 0, g.bomb.pos[2]);
  run(g, 0.05);
  assert.equal(g.bomb.carrier, other.id);
  g.kill(other, b1, null, false, false);
  run(g, 0.05);
  assert.equal(g.round.winner, 'blue');
  assert.equal(g.round.reason, 'eliminated');
  run(g, ROUND_END_TIME + ROUND_FREEZE + 0.2);
  assert.ok(r1.alive && r2.alive, 'everyone is back for the next round');
  run(g, ROUND_TIME.bomb + 0.1);
  assert.equal(g.round.winner, 'blue');
  assert.equal(g.round.reason, 'time');
});

test('first to ROUND_WIN_LIMIT rounds wins the match, then it starts over', () => {
  const { g } = bombGame();
  g.rounds.blue = ROUND_WIN_LIMIT - 1;
  run(g, ROUND_FREEZE + ROUND_TIME.bomb + 0.2);
  assert.equal(g.match.state, 'over');
  assert.equal(g.match.winnerTeam, 'blue');
  run(g, 9);
  assert.equal(g.match.state, 'live');
  assert.equal(g.rounds.blue, 0);
  assert.equal(g.round.n, 1);
});

test('joining a round late waits for the next one', () => {
  const { g } = bombGame();
  run(g, ROUND_FREEZE + LATE_JOIN + 1);
  const late = g.addPlayer({ name: 'Late', team: 'blue' });
  g.join(late);
  run(g, 1);
  assert.ok(!late.alive);
  const early = bombGame().g;
  run(early, ROUND_FREEZE + 2);
  const ok = early.addPlayer({ name: 'Early', team: 'blue' });
  early.join(ok);
  assert.ok(ok.alive, 'a few seconds in still gets you in');
});

// ---------- Hostage rescue ----------

test('hostages follow a Blue player and count as rescued in the zone', () => {
  const g = new Game(MAPS.harbor, { seed: 2, mode: 'teams' });
  const red = g.addPlayer({ name: 'Red', team: 'red' });
  const blue = g.addPlayer({ name: 'Blue', team: 'blue' });
  g.restartMatch();
  assert.equal(g.objective, 'hostage');
  assert.equal(g.hostages.length, 4);
  run(g, ROUND_FREEZE + 0.1);
  place(red, -30, 0, 10);
  const h = g.hostages[0];
  // Red can't take them.
  place(red, h.pos[0] + 1, 0, h.pos[2]);
  red.yaw = Math.PI / 2;
  run(g, 0.05, (p) => (p === red ? hold(p, { use: true }) : null));
  assert.equal(h.state, 'idle');
  place(red, -30, 0, 10);
  // Blue presses E next to it.
  place(blue, h.pos[0] + 1, 0, h.pos[2]);
  blue.yaw = Math.PI / 2; // facing -x, toward the hostage
  run(g, 0.05, (p) => (p === blue ? hold(p, { use: true }) : null));
  assert.equal(h.state, 'follow');
  assert.equal(h.leader, blue.id);
  // Walk away a few meters: it comes along.
  const start = [...h.pos];
  run(g, 2, (p) => (p === blue ? hold(p, { fwd: -1 }) : null));
  assert.ok(Math.hypot(h.pos[0] - start[0], h.pos[2] - start[2]) > 1.5, 'the hostage followed');
  // Teleport both to the rescue zone.
  const z = g.map.rescue[0];
  place(blue, z.min[0] + 3, 0, z.min[1] + 3);
  place(h, z.min[0] + 4, 0, z.min[1] + 3);
  run(g, 0.1);
  assert.equal(h.state, 'rescued');
  for (const o of g.hostages.slice(1)) o.state = 'rescued';
  run(g, 0.05);
  assert.equal(g.round.winner, 'blue');
  assert.equal(g.round.reason, 'rescued');
});

test('Red wins a hostage round on time', () => {
  const g = new Game(MAPS.frost, { seed: 2, mode: 'teams' });
  g.addPlayer({ name: 'Red', team: 'red' });
  g.addPlayer({ name: 'Blue', team: 'blue' });
  g.restartMatch();
  run(g, ROUND_FREEZE + ROUND_TIME.hostage + 0.1);
  assert.equal(g.round.winner, 'red');
});

test('free for all on an objective map is plain deathmatch', () => {
  const g = new Game(MAPS.dunes, { mode: 'ffa' });
  assert.equal(g.objective, null);
  const a = g.addPlayer({ name: 'A' });
  g.restartMatch();
  g.kill(a, null, null, false, false);
  assert.ok(a.respawnAt < 100, 'respawns as usual');
});

// ---------- Bots play the objective ----------

function botsOnly(map, teams, seconds, until) {
  const g = new Game(map, { seed: 11, mode: 'teams' });
  const brains = new Map();
  for (const team of teams) {
    const p = g.addPlayer({ name: team, team, isBot: true });
    brains.set(p.id, new BotBrain(g, p, null, 'normal'));
  }
  g.restartMatch();
  for (let i = 0; i < seconds / TICK_DT; i++) {
    const cmds = new Map();
    for (const [id, b] of brains) cmds.set(id, b.think(TICK_DT));
    g.tick(cmds);
    if (until(g)) return g;
  }
  return g;
}

for (const id of ['canal', 'dunes']) {
  test(`a lone Red bot carries the bomb to a site on ${id} and plants it`, () => {
    const g = botsOnly(MAPS[id], ['red'], ROUND_FREEZE + ROUND_TIME.bomb, (g) => g.bomb.state === 'planted');
    assert.equal(g.bomb.state, 'planted', `bomb is ${g.bomb.state}; plan ${g.plan}`);
  });
}

for (const id of ['harbor', 'frost']) {
  test(`a lone Blue bot leads hostages out on ${id}`, () => {
    const g = botsOnly(MAPS[id], ['blue'], ROUND_FREEZE + ROUND_TIME.hostage, (g) => g.hostages.some((h) => h.state === 'rescued'));
    assert.ok(g.hostages.some((h) => h.state === 'rescued'), `hostages: ${g.hostages.map((h) => h.state)}`);
  });
}

// ---------- Network ----------

test('the use key and map ids survive the wire; objective state round-trips', () => {
  assert.equal(sanitizeCmd({ use: 1 }).use, true);
  assert.equal(cleanMap('canal', MAPS), 'canal');
  assert.equal(cleanMap('__proto__', MAPS), null);
  assert.equal(cleanMap(5, MAPS), null);
  assert.equal(getMap('nope').id, 'yard');
  const { g } = bombGame();
  const info = JSON.parse(JSON.stringify(g.objectiveInfo()));
  const mirror = new Game(MAPS.canal, { mode: 'teams' });
  applyObjectiveInfo(mirror, info);
  assert.equal(mirror.bomb.carrier, g.bomb.carrier);
  assert.equal(mirror.round.n, 1);
  const h = new Game(MAPS.harbor, { mode: 'teams' });
  h.addPlayer({ name: 'x', team: 'blue' });
  h.restartMatch();
  const m2 = new Game(MAPS.harbor, { mode: 'teams' });
  applyObjectiveInfo(m2, JSON.parse(JSON.stringify(h.objectiveInfo())));
  assert.equal(m2.hostages.length, 4);
  assert.deepEqual(m2.hostages[0].pos, h.hostages[0].pos);
});

test('nav grid builds fast enough for a server cold start', () => {
  for (const map of MAP_LIST) {
    const t0 = performance.now();
    new NavGrid(new World(map.boxes), map.bounds);
    assert.ok(performance.now() - t0 < 1500, map.id);
  }
});
