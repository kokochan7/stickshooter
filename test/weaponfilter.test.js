import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { BotBrain } from '../src/sim/bot.js';
import { WEAPONS, WEAPON_FILTERS, filterAllows, cleanWeaponFilter } from '../src/sim/weapons.js';
import { YARD } from '../src/maps/yard.js';

const CAT = { pistol: 'Pistols', shotgun: 'Shotguns', smg: 'SMGs', rifle: 'Rifles', sniper: 'Snipers', grenade: 'Grenades' };

test('the menu offers All plus the six weapon classes, All first', () => {
  assert.deepEqual(Object.values(WEAPON_FILTERS).map((f) => f.label),
    ['All', 'Pistol only', 'Shotgun only', 'SMGs only', 'Rifle only', 'Snipers only', 'Grenades only']);
  assert.equal(cleanWeaponFilter('nope'), 'all');
  assert.equal(cleanWeaponFilter(undefined), 'all');
  assert.equal(cleanWeaponFilter('sniper'), 'sniper');
});

test('each filter allows only its class, plus the knife', () => {
  for (const [f, cat] of Object.entries(CAT)) {
    for (const [id, def] of Object.entries(WEAPONS)) {
      const want = def.melee || def.bomb || def.category === cat;
      assert.equal(filterAllows(f, id), !!want, `${f}: ${id}`);
    }
    assert.ok(filterAllows(f, 'kevlarHelmet'), 'armor is always allowed');
  }
  for (const id of Object.keys(WEAPONS)) assert.ok(filterAllows('all', id));
});

test('filtered free for all spawns with the class starter and buys only that class', () => {
  for (const f of Object.keys(CAT)) {
    const g = new Game(YARD, { seed: 1, mode: 'ffa', weaponFilter: f });
    const p = g.addPlayer({ name: 'P' });
    g.spawn(p);
    const start = WEAPON_FILTERS[f].start;
    const slot = WEAPONS[start].slot;
    assert.equal(p.weapons[slot]?.id, start, `${f} starter`);
    assert.equal(p.active, slot);
    assert.equal(p.weapons.melee?.id, 'knife');
    for (const s of ['primary', 'secondary', 'grenade', 'smoke']) {
      const w = p.weapons[s];
      if (w) assert.equal(WEAPONS[w.id].category, CAT[f], `${f}: ${s} holds ${w.id}`);
    }
    p.money = 16000;
    assert.equal(g.buy(p, 'ak47', true), f === 'rifle', `${f}: AK47`);
    assert.equal(g.buy(p, 'deagle', true), f === 'pistol', `${f}: Deagle`);
    assert.equal(g.buy(p, 'awp', true), f === 'sniper', `${f}: AWP`);
    assert.ok(!g.buy(p, 'm249', true), 'machine guns are only in All');
    assert.ok(g.buy(p, 'kevlarHelmet', true), 'armor');
  }
});

test('Teams ignores the filter, and All keeps the usual USP start', () => {
  const g = new Game(YARD, { seed: 1, mode: 'teams', weaponFilter: 'sniper' });
  const p = g.addPlayer({ name: 'P' });
  g.spawn(p);
  assert.equal(g.weaponRule(), 'all');
  assert.ok(p.weapons.secondary && !p.weapons.primary);
  const h = new Game(YARD, { seed: 1, mode: 'ffa' });
  const q = h.addPlayer({ name: 'Q' });
  h.spawn(q);
  assert.equal(q.weapons.secondary.id, 'usp');
});

test('guns outside the filter on the ground cannot be picked up', () => {
  const g = new Game(YARD, { seed: 1, mode: 'ffa', weaponFilter: 'pistol' });
  const p = g.addPlayer({ name: 'P' });
  g.spawn(p);
  const drop = (id) => ({ id: g.nextDropId++, weapon: { id, clip: 30, reserve: 90 }, pos: [...p.pos], vel: [0, 0, 0], yaw: 0, rest: true, expiresAt: 1e9, noPickup: { pid: -1, until: 0 } });
  assert.ok(!g.canPickup(p, drop('ak47')));
  assert.ok(g.canPickup(p, drop('deagle')));
});

test('Grenades only: the HE comes back after every throw', () => {
  const g = new Game(YARD, { seed: 1, mode: 'ffa', weaponFilter: 'grenade' });
  const p = g.addPlayer({ name: 'P' });
  g.spawn(p);
  const w = p.weapons.grenade;
  for (let i = 0; i < 3; i++) g.throwGrenade(p, w, WEAPONS.hegrenade);
  assert.equal(g.nades.length, 3);
  assert.equal(w.clip, 1);
  // Not in other filters.
  const h = new Game(YARD, { seed: 1, mode: 'ffa' });
  const q = h.addPlayer({ name: 'Q' });
  h.spawn(q);
  q.money = 1000;
  h.buy(q, 'hegrenade', true);
  h.throwGrenade(q, q.weapons.grenade, WEAPONS.hegrenade);
  assert.equal(q.weapons.grenade.clip, 0);
});

test('bots buy within the filter, and upgrade the starter when rich', () => {
  for (const f of Object.keys(CAT)) {
    for (let s = 1; s <= 20; s++) {
      const g = new Game(YARD, { seed: s, mode: 'ffa', weaponFilter: f });
      const p = g.addPlayer({ name: 'B', isBot: true });
      const b = new BotBrain(g, p, null, 'normal');
      g.spawn(p);
      p.money = s % 2 ? 16000 : 800;
      let x = s;
      b.buyLoadout(() => ((x = (x * 9301 + 49297) % 233280) / 233280));
      for (const slot of ['primary', 'secondary', 'grenade', 'smoke']) {
        const w = p.weapons[slot];
        if (w) assert.equal(WEAPONS[w.id].category, CAT[f], `${f} seed ${s}: ${slot} ${w.id}`);
      }
    }
  }
  // A rich bot in Rifle only trades the free Galil for something better.
  let upgraded = 0;
  for (let s = 1; s <= 20; s++) {
    const g = new Game(YARD, { seed: s, mode: 'ffa', weaponFilter: 'rifle' });
    const p = g.addPlayer({ name: 'B', isBot: true });
    const b = new BotBrain(g, p, null, 'hard');
    g.spawn(p);
    p.money = 16000;
    let x = s;
    b.buyLoadout(() => ((x = (x * 9301 + 49297) % 233280) / 233280));
    if (p.weapons.primary.id !== 'galil') upgraded++;
  }
  assert.ok(upgraded >= 15, `upgraded ${upgraded}/20`);
});
