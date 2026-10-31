// First-person arms + gun, drawn in their own scene on top of the world so the
// gun never clips into walls. Springs give the kick, sway and bob their feel.
import * as THREE from 'three';
import { buildGun } from './gunModels.js';
import { toonMaterial, solveIK, Limb, Joint } from './stickman.js';

class Spring {
  constructor(stiffness = 180, damping = 18) {
    this.x = 0; this.v = 0; this.k = stiffness; this.c = damping;
  }
  update(dt, target = 0) {
    // Fixed small substeps keep the spring stable at any frame rate.
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

const HOLD = {
  rifle: new THREE.Vector3(0.13, -0.15, -0.44),
  pistol: new THREE.Vector3(0.09, -0.12, -0.5),
  heavy: new THREE.Vector3(0.15, -0.2, -0.4),
};

export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x806a55, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(0.4, 1, 0.5);
    this.scene.add(sun);

    this.rig = new THREE.Group(); // sway/bob/kick are applied here
    this.scene.add(this.rig);
    this.gunHolder = new THREE.Group();
    this.rig.add(this.gunHolder);

    const mat = toonMaterial(0xffffff);
    const out = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide });
    this.arms = {};
    for (const s of ['L', 'R']) {
      this.arms['upper' + s] = new Limb(this.rig, mat, 0.03, out, 0.004);
      this.arms['fore' + s] = new Limb(this.rig, mat, 0.027, out, 0.004);
      this.arms['elbow' + s] = new Joint(this.rig, mat, 0.03, null);
      this.arms['hand' + s] = new Joint(this.rig, mat, 0.036, out, 0.004);
    }

    // Muzzle flash: two crossed additive quads.
    this.flash = makeFlash();
    this.flash.visible = false;
    this.rig.add(this.flash);
    this.flashTime = 0;

    this.gun = null;
    this.gunId = null;
    this.kickBack = new Spring(260, 22);
    this.kickRot = new Spring(220, 20);
    this.kickSide = new Spring(200, 18);
    this.swayX = new Spring(120, 16);
    this.swayY = new Spring(120, 16);
    this.drop = new Spring(90, 14); // deploy / landing
    this.bobT = 0;
    this.reloadT = -1;
    this.reloadDur = 1;
    this.pumpT = -1;
    this.spin = 0;
    this._v = Array.from({ length: 6 }, () => new THREE.Vector3());
    this._m = new THREE.Matrix4();
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setWeapon(id) {
    if (this.gunId === id) return;
    if (this.gun) this.gunHolder.remove(this.gun.group);
    this.gunId = id;
    this.gun = id ? buildGun(id) : null;
    if (this.gun) this.gunHolder.add(this.gun.group);
    this.deploy();
  }

  deploy() {
    this.drop.x = 0.35; this.drop.v = 0;
    this.reloadT = -1;
  }

  fire(kickScale = 1) {
    const heavy = this.gun?.spec.hold === 'heavy';
    this.kickBack.v += (heavy ? 0.6 : 1.4) * kickScale;
    this.kickRot.v += (heavy ? 1.5 : 7) * kickScale;
    this.kickSide.v += (Math.random() - 0.5) * 2 * kickScale;
    this.flashTime = 0.045;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = (heavy ? 0.8 : 1) * (0.8 + Math.random() * 0.4) * (this.gun?.spec.hold === 'pistol' ? 0.7 : 1);
    this.flash.scale.setScalar(s);
    if (this.gun?.spec.pump) this.pumpT = 0.12;
  }

  reload(duration) {
    this.reloadT = 0;
    this.reloadDur = duration;
  }

  land(speed) {
    this.drop.v -= Math.min(2.5, speed * 0.15);
  }

  // look: mouse delta this frame (pixels), move: horizontal speed m/s
  update(dt, { mouseDX, mouseDY, speed, onGround, reloading, spin, visible }) {
    this.rig.visible = visible;
    if (!visible || !this.gun) return;

    // Sway opposite to mouse motion.
    this.swayX.v += -mouseDX * 0.0009;
    this.swayY.v += mouseDY * 0.0009;
    const sx = Math.max(-0.04, Math.min(0.04, this.swayX.update(dt)));
    const sy = Math.max(-0.04, Math.min(0.04, this.swayY.update(dt)));

    // Walk bob.
    const k = onGround ? Math.min(1, speed / 6) : 0;
    this.bobT += dt * (4 + speed * 1.1);
    const bobX = Math.sin(this.bobT) * 0.012 * k;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * k;

    const kb = this.kickBack.update(dt);
    const kr = this.kickRot.update(dt);
    const ks = this.kickSide.update(dt);
    const drop = this.drop.update(dt);

    // Reload: dip and tilt the gun.
    let rl = 0;
    if (reloading && this.reloadT >= 0) {
      this.reloadT += dt;
      const t = Math.min(1, this.reloadT / this.reloadDur);
      rl = Math.sin(Math.min(1, t * 1.1) * Math.PI);
    } else {
      this.reloadT = -1;
    }

    const hold = HOLD[this.gun.spec.hold] ?? HOLD.rifle;
    this.rig.position.set(hold.x + sx + bobX + ks * 0.01, hold.y + sy + bobY - drop * 0.4 - rl * 0.06, hold.z + kb * 0.04);
    this.rig.rotation.set(kr * 0.02 + drop * 0.6 - rl * 0.5, sx * 2 + ks * 0.01, -sx * 1.5 + rl * 0.5);

    if (this.gun.spin) {
      this.spin += dt * spin * 50;
      this.gun.spin.rotation.z = this.spin;
    }

    // Pump-action slide.
    let pump = 0;
    if (this.pumpT > -0.3) {
      this.pumpT -= dt;
      if (this.pumpT < 0) pump = Math.sin(Math.min(1, -this.pumpT / 0.3) * Math.PI) * 0.08;
    }

    // Hands on the gun.
    const grip = this._v[0].copy(this.gun.grip);
    const fore = this._v[1].copy(this.gun.fore);
    fore.z += pump;
    if (reloading && rl > 0.2 && this.gun.spec.hold !== 'pistol') {
      fore.set(-0.02, -0.12 - rl * 0.05, -0.08);
    }
    const shoulderR = this._v[2].set(0.24, -0.4, 0.0).sub(this.rig.position).applyEuler(invEuler(this.rig.rotation));
    const shoulderL = this._v[3].set(-0.2, -0.42, -0.06).sub(this.rig.position).applyEuler(invEuler(this.rig.rotation));
    this.limb('R', shoulderR, grip, new THREE.Vector3(0.6, -1, 0.2));
    this.limb('L', shoulderL, fore, new THREE.Vector3(-0.8, -1, 0));

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    this.flash.position.copy(this.gun.muzzle);
    this.flash.position.z -= 0.04;
  }

  limb(side, shoulder, hand, pole) {
    const elbow = solveIK(shoulder, hand, 0.42, 0.42, pole, this._v[4]);
    this.arms['upper' + side].set(shoulder, elbow);
    this.arms['fore' + side].set(elbow, hand);
    this.arms['elbow' + side].set(elbow);
    this.arms['hand' + side].set(hand);
  }

  // Muzzle and shell-ejection points in view space.
  muzzleView(out) {
    this.rig.updateMatrixWorld(true);
    return out.copy(this.gun.muzzle).applyMatrix4(this.rig.matrixWorld);
  }
  ejectView(out) {
    this.rig.updateMatrixWorld(true);
    return out.copy(this.gun.eject).applyMatrix4(this.rig.matrixWorld);
  }
}

const _ie = new THREE.Euler();
function invEuler(e) {
  // Approximate inverse for small rig rotations.
  return _ie.set(-e.x, -e.y, -e.z, 'ZYX');
}

let flashTex = null;
export function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,220,120,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 32 : 12;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

export function makeFlash(size = 0.16) {
  const mat = new THREE.MeshBasicMaterial({
    map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  g.add(front);
  const side1 = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.6, size * 1.6), mat);
  side1.rotation.x = Math.PI / 2;
  side1.position.z = -size * 0.5;
  g.add(side1);
  const side2 = side1.clone();
  side2.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  g.add(side2);
  return g;
}
