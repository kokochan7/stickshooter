// Third-person stickman: round head, stick limbs posed every frame with a
// procedural walk cycle and two-bone IK so the hands always hold the gun.
import * as THREE from 'three';
import { buildGun } from './gunModels.js';
import { U, FOOTSTEP_TIME } from '../sim/constants.js';

const UP = new THREE.Vector3(0, 1, 0);
const RUN_SPEED = 250 * U;

// Walk-cycle speed in radians per second (π per step), matched to the
// footstep cadence: FOOTSTEP_TIME per step when running.
export function stepRate(speed) {
  return (Math.PI / FOOTSTEP_TIME) * Math.sqrt(Math.min(1.2, speed / RUN_SPEED));
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

let toonGradient = null;
export function toonMaterial(color, opts = {}) {
  if (!toonGradient) {
    const data = new Uint8Array([90, 90, 90, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
    toonGradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    toonGradient.minFilter = THREE.NearestFilter;
    toonGradient.magFilter = THREE.NearestFilter;
    toonGradient.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...opts });
}

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
const sphGeo = new THREE.SphereGeometry(1, 14, 10);
const lowSphGeo = new THREE.SphereGeometry(1, 10, 8);

// Two-bone IK: elbow/knee position for root a, target c, bone lengths l1, l2,
// bending towards pole.
export function solveIK(a, c, l1, l2, pole, out) {
  _d.subVectors(c, a);
  let d = _d.length();
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { _d.multiplyScalar(maxD / d); d = maxD; }
  if (d < 1e-4) { out.copy(a).add(pole); return out; }
  const dir = _d.divideScalar(d);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _p.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(a).addScaledVector(dir, x).addScaledVector(_p, h);
  return out;
}

export class Limb {
  constructor(parent, material, radius, outlineMat, outlineWidth = 0.012) {
    this.mesh = new THREE.Mesh(cylGeo, material);
    this.radius = radius;
    this.ow = outlineWidth;
    parent.add(this.mesh);
    if (outlineMat) {
      this.outline = new THREE.Mesh(cylGeo, outlineMat);
      parent.add(this.outline);
    }
  }
  set(from, to) {
    _a.subVectors(to, from);
    const len = _a.length();
    this.mesh.position.addVectors(from, to).multiplyScalar(0.5);
    if (len > 1e-5) this.mesh.quaternion.setFromUnitVectors(UP, _a.divideScalar(len));
    this.mesh.scale.set(this.radius, len, this.radius);
    if (this.outline) {
      this.outline.position.copy(this.mesh.position);
      this.outline.quaternion.copy(this.mesh.quaternion);
      this.outline.scale.set(this.radius + this.ow, len, this.radius + this.ow);
    }
  }
}

export class Joint {
  constructor(parent, material, radius, outlineMat, outlineWidth = 0.012, geo = lowSphGeo) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.scale.setScalar(radius);
    parent.add(this.mesh);
    if (outlineMat) {
      this.outline = new THREE.Mesh(geo, outlineMat);
      this.outline.scale.setScalar(radius + outlineWidth);
      parent.add(this.outline);
    }
  }
  set(p) {
    this.mesh.position.copy(p);
    if (this.outline) this.outline.position.copy(p);
  }
}

const THIGH = 0.47, SHIN = 0.47, UPPER_ARM = 0.32, FOREARM = 0.32;

export class Stickman {
  constructor({ body = 0xffffff, eyes = 0x111111, outline = 0x1a1a1a, glowEyes = false } = {}) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // tilts when dying
    this.root.add(this.body);

    const mat = toonMaterial(body);
    const outMat = new THREE.MeshBasicMaterial({ color: outline, side: THREE.BackSide });
    this.material = mat;

    this.torso = new Limb(this.body, mat, 0.085, outMat);
    this.neck = new Limb(this.body, mat, 0.05, null);
    this.hip = new Joint(this.body, mat, 0.09, outMat);
    this.chest = new Joint(this.body, mat, 0.09, outMat);
    this.limbs = {};
    for (const s of ['L', 'R']) {
      this.limbs['thigh' + s] = new Limb(this.body, mat, 0.055, outMat);
      this.limbs['shin' + s] = new Limb(this.body, mat, 0.05, outMat);
      this.limbs['upper' + s] = new Limb(this.body, mat, 0.045, outMat);
      this.limbs['fore' + s] = new Limb(this.body, mat, 0.042, outMat);
      this.limbs['knee' + s] = new Joint(this.body, mat, 0.055, null);
      this.limbs['elbow' + s] = new Joint(this.body, mat, 0.045, null);
      this.limbs['hand' + s] = new Joint(this.body, mat, 0.055, outMat);
      this.limbs['foot' + s] = new Joint(this.body, mat, 0.07, outMat);
      this.limbs['foot' + s].mesh.scale.set(0.065, 0.045, 0.1);
      this.limbs['foot' + s].outline.scale.set(0.077, 0.057, 0.112);
      this.limbs['shoulder' + s] = new Joint(this.body, mat, 0.05, null);
    }

    // Head with two tall oval eyes.
    this.head = new THREE.Group();
    this.body.add(this.head);
    const headMesh = new THREE.Mesh(sphGeo, mat);
    headMesh.scale.setScalar(0.17);
    this.head.add(headMesh);
    const headOut = new THREE.Mesh(sphGeo, outMat);
    headOut.scale.setScalar(0.182);
    this.head.add(headOut);
    const eyeMat = glowEyes ? new THREE.MeshBasicMaterial({ color: eyes }) : new THREE.MeshBasicMaterial({ color: eyes });
    for (const x of [-0.058, 0.058]) {
      const eye = new THREE.Mesh(lowSphGeo, eyeMat);
      eye.scale.set(0.026, 0.05, 0.02);
      eye.position.set(x, 0.02, -0.155);
      eye.rotation.y = x * 2.2;
      this.head.add(eye);
    }

    // Aim pivot carries the gun; it pitches with the view.
    this.aim = new THREE.Group();
    this.body.add(this.aim);
    this.gun = null;
    this.gunId = null;

    // Blob shadow.
    this.shadow = null;

    this.walkPhase = 0;
    this.deathT = -1;
    this.deathDir = 1;
    this.kick = 0;
    this.tmp = { hip: new THREE.Vector3(), chest: new THREE.Vector3(), head: new THREE.Vector3() };
    this._v = Array.from({ length: 8 }, () => new THREE.Vector3());
  }

  setWeapon(id) {
    if (this.gunId === id) return;
    if (this.gun) this.aim.remove(this.gun.group);
    this.gunId = id;
    this.gun = id ? buildGun(id) : null;
    if (this.gun) this.aim.add(this.gun.group);
  }

  muzzleWorld(out) {
    if (!this.gun) return out.setFromMatrixPosition(this.head.matrixWorld);
    this.gun.group.updateWorldMatrix(true, false);
    return out.copy(this.gun.muzzle).applyMatrix4(this.gun.group.matrixWorld);
  }

  setVisible(v) { this.root.visible = v; }

  die(sideSign) {
    this.deathT = 0;
    this.deathDir = sideSign;
  }

  revive() {
    this.deathT = -1;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  // s: { x, y, z, yaw, pitch, vx, vz, duck, onGround, reloading, spin }
  update(s, dt) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    // Local velocity for the walk cycle.
    const cy = Math.cos(-s.yaw), sy = Math.sin(-s.yaw);
    const lvx = s.vx * cy + s.vz * sy, lvz = -s.vx * sy + s.vz * cy;
    const speed = Math.hypot(lvx, lvz);
    const duck = s.duck;
    const k = Math.min(1, speed / 5.5);
    const stride = 0.42 * k * (1 - duck * 0.4);
    // One step (half a cycle) per footstep sound at full run, longer and
    // slower steps when walking.
    this.walkPhase += stepRate(speed) * dt;

    const v = this._v;
    const hipY = 0.92 - duck * 0.47 + (s.onGround ? Math.abs(Math.sin(this.walkPhase)) * 0.03 * k : 0);
    const lean = duck * 0.45 + k * 0.08;
    const hip = this.tmp.hip.set(0, hipY, duck * 0.05);
    const chest = this.tmp.chest.set(0, hipY + 0.5 * Math.cos(lean), hip.z - 0.5 * Math.sin(lean));
    this.hip.set(hip);
    this.chest.set(chest);
    this.torso.set(hip, chest);

    // Head follows pitch a bit.
    const head = this.tmp.head.set(0, chest.y + 0.19, chest.z - 0.03 - duck * 0.0);
    this.head.position.copy(head);
    this.head.rotation.x = s.pitch * 0.6;
    _b.set(0, chest.y + 0.04, chest.z);
    this.neck.set(_b, head);

    // Legs.
    const mvx = speed > 0.05 ? lvx / speed : 0, mvz = speed > 0.05 ? lvz / speed : 0;
    for (const [side, sgn, ph] of [['L', -1, 0], ['R', 1, Math.PI]]) {
      const hipJ = v[0].set(sgn * 0.09, hipY, hip.z);
      const foot = v[1];
      if (!s.onGround) {
        foot.set(sgn * 0.11, hipY - 0.62, hip.z - (sgn > 0 ? 0.18 : -0.05));
      } else {
        const phase = this.walkPhase + ph;
        const swing = Math.sin(phase) * stride;
        const lift = Math.max(0, Math.cos(phase)) * 0.12 * k;
        foot.set(sgn * 0.12 + mvx * swing, 0.045 + lift, hip.z + mvz * swing);
        if (duck > 0.5) foot.z += sgn > 0 ? -0.28 * duck : 0.12 * duck;
      }
      const knee = solveIK(hipJ, foot, THIGH, SHIN, v[2].set(sgn * 0.15, 0, -1), v[3]);
      this.limbs['thigh' + side].set(hipJ, knee);
      this.limbs['shin' + side].set(knee, foot);
      this.limbs['knee' + side].set(knee);
      this.limbs['foot' + side].set(foot);
      this.limbs['foot' + side].mesh.position.z -= 0.03;
    }

    // Aim pivot & gun.
    this.kick = Math.max(0, this.kick - dt * 8);
    this.aim.position.set(0, chest.y - 0.04, chest.z);
    this.aim.rotation.set(s.pitch, 0, 0);
    if (this.gun) {
      const hold = this.gun.spec.hold;
      if (hold === 'pistol') this.gun.group.position.set(0.02, 0.02, -0.5 + this.kick * 0.05);
      else if (hold === 'heavy') this.gun.group.position.set(0.12, -0.2, -0.22 + this.kick * 0.03);
      else this.gun.group.position.set(0.09, -0.07, -0.24 + this.kick * 0.05);
      this.gun.group.rotation.x = this.kick * 0.15;
      if (s.reloading) {
        this.gun.group.rotation.x = -0.5;
        this.gun.group.position.y -= 0.08;
      }
      if (this.gun.spin) this.gun.spin.rotation.z += (s.spin ?? 0) * dt * 40;
      this.aim.updateMatrix();
      this.gun.group.updateMatrix();
      // Hand targets in body space.
      const m = this.aim.matrix.clone().multiply(this.gun.group.matrix);
      const handR = v[4].copy(this.gun.grip).applyMatrix4(m);
      const handL = v[5].copy(this.gun.fore).applyMatrix4(m);
      if (s.reloading) handL.set(-0.05, chest.y - 0.25, chest.z - 0.2);
      this.arm('R', 1, chest, handR);
      this.arm('L', -1, chest, handL);
    } else {
      this.arm('R', 1, chest, v[4].set(0.2, chest.y - 0.55, chest.z));
      this.arm('L', -1, chest, v[5].set(-0.2, chest.y - 0.55, chest.z));
    }

    // Death fall.
    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.45);
      const e = t * t * (3 - 2 * t);
      this.body.rotation.x = e * 1.45;
      this.body.rotation.z = e * 0.25 * this.deathDir;
      this.body.position.y = -e * 0.02;
    }
  }

  arm(side, sgn, chest, hand) {
    const v = this._v;
    const shoulder = v[6].set(sgn * 0.17, chest.y - 0.03, chest.z);
    const elbow = solveIK(shoulder, hand, UPPER_ARM, FOREARM, v[7].set(sgn * 0.8, -1, 0.3), _a.clone());
    this.limbs['shoulder' + side].set(shoulder);
    this.limbs['upper' + side].set(shoulder, elbow);
    this.limbs['fore' + side].set(elbow, hand);
    this.limbs['elbow' + side].set(elbow);
    this.limbs['hand' + side].set(hand);
  }
}
