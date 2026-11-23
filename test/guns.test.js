import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGun, GUN_IDS } from '../src/client/gunModels.js';
import { WEAPONS } from '../src/sim/weapons.js';

function tris(gun) {
  let n = 0;
  gun.group.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count / 3; });
  return n;
}

test('every weapon has a model', () => {
  for (const id of Object.keys(WEAPONS)) assert.ok(GUN_IDS.includes(id), id);
});

test('gun models build with shine and stay light', () => {
  for (const id of GUN_IDS) {
    const full = buildGun(id), lod = buildGun(id, true);
    for (const g of [full, lod]) {
      g.group.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes;
        assert.ok(a.color && a.spec, `${id} has color and spec`);
        for (const v of a.position.array) assert.ok(Number.isFinite(v), `${id} positions are finite`);
      });
    }
    assert.ok(tris(full) < 2500, `${id} first-person model is ${tris(full)} triangles`);
    assert.ok(tris(lod) < tris(full) * 0.8, `${id} third-person model is lighter`);
    assert.ok(full.muzzle.z < 0, `${id} muzzle points forward`);
  }
});

test('Glock-18 and FAMAS switch between their normal mode and a three-round burst', async () => {
  const { Game, emptyCmd } = await import('../src/sim/game.js');
  const { YARD } = await import('../src/maps/yard.js');
  for (const [id, team] of [['glock18', 'red'], ['famas', 'blue']]) {
    const g = new Game(YARD, { seed: 1, mode: 'teams' });
    const a = g.addPlayer({ name: 'A', team });
    g.spawn(a);
    const events = [];
    const emit = g.emit.bind(g);
    g.emit = (e) => { events.push(e); emit(e); };
    const tick = (c = {}) => g.tick(new Map([[a.id, { ...emptyCmd(), yaw: a.yaw, pitch: a.pitch, ...c }]]));
    for (let i = 0; i < 400; i++) tick();
    a.money = 16000;
    g.buy(a, id, true);
    for (let i = 0; i < 200; i++) tick();
    const w = a.weapons[a.active];
    assert.equal(w.id, id);
    tick({ alt: true }); tick();
    assert.equal(w.burst, true, `${id} burst on`);
    assert.ok(events.some((e) => e.type === 'burstMode' && e.on && e.weapon === id));
    const before = w.clip;
    tick({ fire: true }); for (let i = 0; i < 40; i++) tick();
    assert.equal(before - w.clip, 3, `${id} fires three rounds per click`);
    const shots = events.filter((e) => e.type === 'shot');
    assert.ok(shots.length >= 3 && shots.slice(-3).every((e) => e.burst), 'burst shots are marked for their own sound');
    tick({ alt: true }); tick();
    assert.equal(w.burst, false, `${id} back to its normal mode`);
  }
});
