// PROTOTYPE: character style lab. Renders stickmen and first-person arms in
// a candidate look inside the real game view (Classic textured maps).
//   /charlab.html?style=sculpt&shot=lineup
// Not part of the game build.
import * as THREE from 'three';
import { GameView } from '../client/scene.js';
import { Stickman } from '../client/stickman.js';
import { World } from '../sim/world.js';
import { getMap } from '../maps/index.js';
import { applyStyle, applyArmStyle, countCost, CHAR_STYLES } from './charstyles.js';

const qs = new URLSearchParams(location.search);
const styleId = qs.get('style') ?? 'current';
const shotId = qs.get('shot') ?? 'lineup';

// Shots in game metres. men: [forward m, right m, team, gun, pose, faceOffset]
// pose: stand | run | duck | dead. gun null = no weapon.
const SHOTS = {
  lineup: { map: 'depot', eye: [6, 1.6, 9], at: [0, 1.0, -12], fps: false, men: [
    [2.7, -0.95, null, 'ak47', 'stand', 0.5], [3.4, 0.15, 'red', 'm4a1', 'run', -0.9], [3.0, 1.2, 'blue', 'awp', 'duck', -0.4],
  ] },
  close: { map: 'depot', eye: [6, 1.25, 9], at: [0, 0.95, -12], fps: false, men: [
    [2.3, -0.25, null, 'm4a1', 'stand', 0.7],
  ] },
  fps: { map: 'depot', eye: [4.5, 1.6, -15.3], at: [-6, 1.35, -39], fps: 'ak47', men: [
    [7.5, -1.6, null, 'm4a1', 'run', 0.2], [11, 1.4, null, 'ak47', 'stand', 0.1], [15, -3.4, null, 'mp5', 'duck', 0.4],
  ] },
  fpsteam: { map: 'dunes', eye: [45, 1.6, 0], at: [19.5, 1.2, 30], fps: 'deagle', team: 'blue', men: [
    [6.5, -1.0, 'red', 'ak47', 'run', 0.3], [10, 1.8, 'red', 'awp', 'stand', 0], [4, 2.6, 'blue', 'm4a1', 'stand', 2.6],
  ] },
  bench: { map: 'depot', eye: [6, 1.6, 9], at: [0, 1.2, -12], fps: 'ak47', bench: 16, men: [] },
};
const shot = SHOTS[shotId];
const map = getMap(qs.get('map') ?? shot.map);
const world = new World(map.boxes);
const canvas = document.getElementById('c');
const view = new GameView(canvas, map, world, { fov: +(qs.get('fov') ?? 74), antialias: true });
document.getElementById('tag').textContent = qs.has('tag') ? CHAR_STYLES[styleId].label : '';

const cam = view.camera;
const eye = new THREE.Vector3(...shot.eye);
const at = new THREE.Vector3(...shot.at);
cam.position.copy(eye);
cam.lookAt(at);
const fwd = new THREE.Vector3().subVectors(at, eye).setY(0).normalize();
const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

const men = [];
function place(f, r, team, gun, pose, faceOff) {
  const man = new Stickman({ body: 0xffffff, eyes: 0x15171a, outline: 0x22252b });
  applyStyle(man, styleId);
  const x = eye.x + fwd.x * f + right.x * r, z = eye.z + fwd.z * f + right.z * r;
  const y = view.groundBelow(x, eye.y + 0.5, z);
  const yaw = Math.atan2(x - eye.x, z - eye.z) + faceOff;
  man.setTeam(team);
  view.scene.add(man.root);
  const shadow = new THREE.Mesh(view.shadowGeo, view.shadowMat);
  shadow.position.set(x, y + 0.01, z);
  view.scene.add(shadow);
  if (pose === 'dead') {
    man.setWeapon(null);
    man.root.position.set(x, y, z); man.root.rotation.y = yaw;
    man.poseDead('back', 2, 1, 0);
  } else {
    man.setWeapon(gun);
    const sp = pose === 'run' ? 5.5 : 0;
    // Run towards the camera's left.
    const vx = -right.x * sp, vz = -right.z * sp;
    const st = { x, y, z, yaw, pitch: pose === 'duck' ? 0.05 : -0.05, vx, vz, duck: pose === 'duck' ? 1 : 0, onGround: true, reloading: false, spin: 0 };
    man.walkPhase = 0.9;
    man.update(st, pose === 'run' ? 0.0 : 0.016);
  }
  men.push(man);
  return man;
}
for (const m of shot.men) place(...m);
if (shot.bench) {
  for (let i = 0; i < shot.bench; i++) {
    const row = Math.floor(i / 4), col = i % 4;
    place(4 + row * 2.5, -3 + col * 2, ['red', 'blue', null][i % 3], ['ak47', 'm4a1', 'awp', 'deagle'][i % 4], i % 3 === 0 ? 'run' : 'stand', 0.3 * i);
  }
}

// First-person arms.
const vm = view.viewModel;
applyArmStyle(vm, styleId);
if (shot.fps) {
  vm.setWeapon(shot.fps);
  vm.setTeam(shot.team ?? null);
  vm.drop.x = 0;
  for (let i = 0; i < 60; i++) vm.update(1 / 60, { mouseDX: 0, mouseDY: 0, speed: 0, onGround: true, reloading: false, spin: 0, visible: true });
  if (qs.has('vmzoom')) {
    const h = new THREE.Vector3();
    vm.rig.updateMatrixWorld(true);
    vm.arms[qs.get('vmzoom') === 'L' ? 'handL' : 'handR'].mesh.getWorldPosition(h);
    vm.camera.fov = 28; vm.camera.updateProjectionMatrix();
    vm.camera.lookAt(h);
    view.scene.visible = true;
  }
} else {
  vm.rig.visible = false;
}

let t = 0;
function loop() {
  view.render();
  requestAnimationFrame(loop);
}
loop();

// Benchmark: n frames, GPU-synced, animating every stickman.
const gl = view.renderer.getContext();
const px = new Uint8Array(4);
window.__bench = (n = 40) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    t += 1 / 120;
    for (const m of men) m.update({ x: m.root.position.x, y: m.root.position.y, z: m.root.position.z, yaw: m.root.rotation.y, pitch: 0, vx: 4, vz: 1, duck: 0, onGround: true, reloading: false, spin: 0 }, 1 / 120);
    if (shot.fps) vm.update(1 / 120, { mouseDX: 1, mouseDY: 0, speed: 4, onGround: true, reloading: false, spin: 0, visible: true });
    view.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const ms = (performance.now() - t0) / n;
  const per = countCost(men[0]?.root ?? new THREE.Group());
  const arms = countCost(vm.rig);
  return { style: styleId, ms, calls: view.renderer.info.render.calls, tris: view.renderer.info.render.triangles, perMan: per, arms };
};
window.__ready = true;
