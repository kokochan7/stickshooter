// First-person arms + gun, drawn in their own scene on top of the world so the
// gun never clips into walls. Springs give the kick, sway and bob their feel.
import * as THREE from 'three';
import { buildGun } from './gunModels.js';
import { toonMaterial, solveIK, Limb, Joint, stepRate, teamColor } from './stickman.js';

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
  knife: new THREE.Vector3(0.19, -0.17, -0.38),
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
    this.armMat = mat;
    this.team = null;
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
    this.bobAmt = 0;
    this.reloadT = -1;
    this.reloadDur = 1;
    this.reloadBlend = 0;
    this.shellReload = null; // { start, each } for shell-by-shell guns
    this.slap = new Spring(260, 16); // mag seated / slide released
    // A shell in the left hand while loading shotguns.
    this.shell = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0xb8322a }));
    this.shell.rotation.x = Math.PI / 2;
    this.shell.visible = false;
    this.rig.add(this.shell);
    this.pumpT = -1;
    this.spin = 0;
    // Knife swing: kind 'slash' | 'stab', t counts up from 0.
    this.meleeT = -1;
    this.meleeKind = 'slash';
    this.meleeDur = 0.3;
    this.slashSide = 1;
    // How much the gun kicks and bobs (the screen-shake setting); 1 = full.
    this.motion = 1;
    this._v = Array.from({ length: 6 }, () => new THREE.Vector3());
    this._m = new THREE.Matrix4();
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // First-person arms match the team color of the body.
  setTeam(team) {
    if (this.team === team) return;
    this.team = team;
    this.armMat.color.setHex(teamColor(team));
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

  // Knife swing. Slashes alternate right-to-left and left-to-right like CS.
  melee(kind) {
    this.meleeKind = kind;
    this.meleeT = 0;
    this.meleeDur = kind === 'stab' ? 0.55 : 0.3;
    if (kind === 'slash') this.slashSide = -this.slashSide;
  }

  fire(kickScale = 1) {
    kickScale *= this.motion;
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

  reload(duration, shellReload = null) {
    this.reloadT = 0;
    this.reloadDur = duration;
    this.shellReload = shellReload;
  }

  land(speed) {
    this.drop.v -= Math.min(2.5, speed * 0.15) * this.motion;
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

    // Walk bob: one dip per footstep, side to side over two.
    const k = onGround ? Math.min(1, speed / 6) : 0;
    this.bobAmt += (k - this.bobAmt) * Math.min(1, dt * 8);
    if (onGround) this.bobT += dt * stepRate(speed);
    const bobX = Math.sin(this.bobT) * 0.012 * this.bobAmt * this.motion;
    const bobY = -Math.abs(Math.sin(this.bobT)) * 0.014 * this.bobAmt * this.motion;

    const kb = this.kickBack.update(dt);
    const kr = this.kickRot.update(dt);
    const ks = this.kickSide.update(dt);
    const drop = this.drop.update(dt);

    // Reload pose (see reloadPose); blended so an interrupted reload eases out.
    if (reloading && this.reloadT >= 0) this.reloadT += dt;
    else this.reloadT = -1;
    this.reloadBlend += ((this.reloadT >= 0 ? 1 : 0) - this.reloadBlend) * Math.min(1, dt * 10);
    const rp = this.reloadPose();
    const slap = this.slap.update(dt);

    const hold = HOLD[this.gun.spec.hold] ?? HOLD.rifle;
    const mp = this.meleePose(dt);
    this.rig.position.set(
      hold.x + sx + bobX + ks * 0.01 + rp.x + mp.x,
      hold.y + sy + bobY - drop * 0.4 + rp.y + slap * 0.01 + mp.y,
      hold.z + kb * 0.04 + rp.z + mp.z,
    );
    this.rig.rotation.set(
      kr * 0.02 + drop * 0.6 + rp.pitch + slap * 0.04 + mp.pitch,
      sx * 2 + ks * 0.01 + rp.yaw + mp.yaw,
      -sx * 1.5 + rp.roll + mp.roll,
    );

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
    if (rp.hand) fore.lerp(rp.hand, rp.handW);
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

  // Reload animation by weapon type, as offsets for the rig plus where the
  // left hand and the magazine are. Times are fractions of the reload:
  //   mag guns: tilt, pull the mag, drop it, bring a new one, seat it (the
  //   mag-in sound plays at 0.6), then rack the bolt / release the slide.
  //   shotguns: roll the gun over and push shells in one at a time, timed to
  //   the sim's shell events.
  reloadPose() {
    const g = this.gun, rp = this._rp ??= { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, hand: new THREE.Vector3(), handW: 0 };
    const b = this.reloadBlend;
    rp.x = rp.y = rp.z = rp.pitch = rp.yaw = rp.roll = 0;
    rp.handW = 0;
    this.shell.visible = false;
    if (g.mag) { g.mag.position.copy(g.magHome); g.mag.rotation.set(0, 0, 0); }
    if (b < 0.001 && this.reloadT < 0) return rp;
    const hold = g.spec.hold;
    const t = this.reloadT >= 0 ? Math.min(1, this.reloadT / this.reloadDur) : 1;

    if (this.shellReload) {
      // Gun rolled over to show the loading port, left hand feeding shells.
      rp.roll = -0.6 * b; rp.pitch = 0.15 * b; rp.yaw = 0.15 * b; rp.y = -0.01 * b; rp.z = -0.07 * b;
      const { start, each } = this.shellReload;
      const el = this.reloadT - start;
      const u = (((el % each) + each) % each) / each; // 0 = shell just went in
      const port = this._v[5].set(0.0, -0.025, -0.08);
      const down = smooth(u / 0.45) * (1 - smooth((u - 0.45) / 0.5));
      rp.hand.copy(port).add(this._v[4].set(-0.02 * down, -0.15 * down, 0.06 * down));
      rp.handW = b;
      if (this.reloadT >= 0 && u > 0.2) {
        this.shell.visible = true;
        this.shell.position.copy(rp.hand).add(this._v[4].set(0.0, 0.02, -0.03));
      }
      return rp;
    }

    // Tilt in and out.
    const tilt = smooth(t / 0.12) * (1 - smooth((t - 0.86) / 0.14));
    // Rolled so the mag well faces the middle of the screen, where the left
    // hand works.
    if (hold === 'heavy') { rp.roll = -0.2 * tilt; rp.y = 0.05 * tilt; rp.x = -0.02 * tilt; }
    else if (hold === 'pistol') { rp.roll = -0.35 * tilt; rp.pitch = 0.3 * tilt; rp.y = 0.03 * tilt; rp.x = -0.02 * tilt; }
    else { rp.roll = -0.5 * tilt; rp.pitch = 0.1 * tilt; rp.yaw = 0.1 * tilt; rp.y = 0.03 * tilt; rp.x = -0.02 * tilt; }
    if (!g.mag) return rp;

    const dir = g.magDir, home = g.magHome;
    const OUT = hold === 'pistol' ? 0.12 : 0.17;
    // Where the old mag goes and the new one comes from: below and behind
    // the gun (a top-loading P90 mag still gets swapped from below).
    const away = dir.y > 0
      ? this._v[5].copy(home).add(this._v[4].set(-0.25, -0.4, 0.15))
      : this._v[5].copy(home).addScaledVector(dir, 0.55).add(this._v[4].set(-0.12, -0.05, 0.15));
    const magPos = g.mag.position;
    if (t < 0.12) {
      magPos.copy(home);
    } else if (t < 0.28) {
      magPos.copy(home).addScaledVector(dir, OUT * smooth((t - 0.12) / 0.16));
    } else if (t < 0.42) {
      const e = smooth((t - 0.28) / 0.14);
      magPos.copy(home).addScaledVector(dir, OUT).lerp(away, e);
      g.mag.rotation.x = e * 0.8;
    } else if (t < 0.55) {
      const e = smooth((t - 0.42) / 0.13);
      magPos.copy(away).lerp(this._v[4].copy(home).addScaledVector(dir, OUT), e);
      g.mag.rotation.x = (1 - e) * 0.8;
    } else if (t < 0.6) {
      magPos.copy(home).addScaledVector(dir, OUT * (1 - smooth((t - 0.55) / 0.05)));
    }
    if (t >= 0.6 && this._slapAt !== this.reloadDur) { this._slapAt = this.reloadDur; this.slap.v += 3; }
    if (t < 0.05) this._slapAt = -1;

    // Left hand: from the handguard to the bottom of the mag and back, or on
    // to the charging handle / slide.
    const magGrip = this._v[3].copy(magPos).addScaledVector(dir, 0.055);
    if (t < 0.6) {
      rp.hand.copy(magGrip);
      rp.handW = smooth(t / 0.1) * b;
    } else if (hold === 'rifle' && this.gunId !== 'awp') {
      // Bolt release: hand to the side of the receiver, slap it forward.
      const handle = this._v[4].set(-0.04, g.muzzle.y - 0.015, -0.03);
      const pull = smooth((t - 0.72) / 0.06) * (1 - smooth((t - 0.8) / 0.03));
      handle.z += pull * 0.05;
      handle.x -= pull * 0.02;
      const toHandle = smooth((t - 0.6) / 0.12);
      rp.hand.copy(magGrip).lerp(handle, toHandle);
      rp.handW = (1 - smooth((t - 0.84) / 0.12)) * b;
      if (t > 0.8 && this._boltAt !== this.reloadDur) { this._boltAt = this.reloadDur; this.slap.v -= 2; }
      if (t < 0.05) this._boltAt = -1;
    } else {
      // Pistol slide release / AWP / minigun: hand straight back.
      rp.hand.copy(magGrip);
      rp.handW = (1 - smooth((t - 0.6) / 0.16)) * b;
      if (hold === 'pistol') rp.z = 0.025 * smooth((t - 0.68) / 0.03) * (1 - smooth((t - 0.71) / 0.1));
    }
    return rp;
  }

  // Knife rest pose (blade tipped up and in) plus the slash / stab motion.
  meleePose(dt) {
    const mp = this._mp ??= { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
    mp.x = mp.y = mp.z = mp.pitch = mp.yaw = mp.roll = 0;
    if (this.gun.spec.hold !== 'knife') { this.meleeT = -1; return mp; }
    mp.pitch = 0.45; mp.yaw = 0.25; mp.roll = -0.35;
    if (this.meleeT < 0) return mp;
    this.meleeT += dt;
    const u = Math.min(1, this.meleeT / this.meleeDur);
    if (u >= 1) { this.meleeT = -1; return mp; }
    if (this.meleeKind === 'slash') {
      // Wind up to one side, sweep across, settle back.
      const s = this.slashSide;
      const sweep = u < 0.15 ? smooth(u / 0.15) : 1 - 2 * smooth((u - 0.15) / 0.45);
      const back = smooth((u - 0.6) / 0.4);
      const a = sweep * (1 - back);
      mp.x += a * 0.12 * s;
      mp.y += Math.abs(a) * 0.02;
      mp.z -= Math.sin(u * Math.PI) * 0.06;
      mp.yaw += a * 0.9 * s;
      mp.roll += a * 0.7 * s - Math.sin(u * Math.PI) * 0.6;
      mp.pitch -= Math.sin(u * Math.PI) * 0.5;
    } else {
      // Pull back, then a hard forward stab, then recover.
      const pull = smooth(u / 0.3) * (1 - smooth((u - 0.3) / 0.12));
      const thrust = smooth((u - 0.3) / 0.12) * (1 - smooth((u - 0.55) / 0.45));
      mp.z += pull * 0.06 - thrust * 0.2;
      mp.y += pull * 0.03 - thrust * 0.01;
      mp.x -= thrust * 0.06;
      mp.pitch += pull * 0.2 - thrust * 0.75;
      mp.yaw -= thrust * 0.2;
    }
    return mp;
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

function smooth(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
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
