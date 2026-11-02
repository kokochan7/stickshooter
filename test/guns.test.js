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
