// Pooled visual effects: tracers, impact particles, bullet holes, brass shells
// and third-person muzzle flashes. Everything is preallocated so firing never
// allocates or adds draw calls.
import * as THREE from 'three';
import { makeFlash } from './viewmodel.js';

const MAT_COLORS = {
  concrete: [0.85, 0.82, 0.76],
  wood: [0.72, 0.5, 0.28],
  metal: [1.0, 0.85, 0.45],
  grate: [1.0, 0.85, 0.45],
  tile: [0.9, 0.9, 0.9],
  blood: [0.75, 0.08, 0.08],
};

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.35, 'rgba(25,22,20,0.95)');
  grad.addColorStop(0.55, 'rgba(60,55,50,0.45)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_PARTICLES = 600;
const MAX_TRACERS = 48;
const MAX_HOLES = 160;
const MAX_SHELLS = 48;
const MAX_FLASHES = 12;

export class Effects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    // Particles: one Points object.
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pm = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTexture() }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          if (t.a < 0.05) discard;
          gl_FragColor = vec4(vColor, t.a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(pg, pm);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, size: 0.05, grav: 1, grow: 0,
    }));
    this.pNext = 0;

    // Tracers: thin stretched boxes moving along the bullet path.
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tg, tm);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, len: 2, active: false });
    }
    this.tNext = 0;

    // Bullet holes: one instanced mesh.
    const hg = new THREE.PlaneGeometry(1, 1);
    const hm = new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.holes = new THREE.InstancedMesh(hg, hm, MAX_HOLES);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    scene.add(this.holes);
    this.hNext = 0;

    // Brass.
    const sg = new THREE.CylinderGeometry(0.006, 0.006, 0.022, 6);
    sg.rotateZ(Math.PI / 2);
    const sm = new THREE.MeshLambertMaterial({ color: 0xd4a640 });
    this.shellMesh = new THREE.InstancedMesh(sg, sm, MAX_SHELLS);
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shellMesh.frustumCulled = false;
    this.shellMesh.count = MAX_SHELLS;
    scene.add(this.shellMesh);
    this.shells = Array.from({ length: MAX_SHELLS }, () => ({
      life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
    }));
    this.sNext = 0;

    // World-space muzzle flashes for other players.
    this.flashes = [];
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = makeFlash(0.32);
      f.visible = false;
      scene.add(f);
      this.flashes.push({ obj: f, t: 0 });
    }
    this.fNext = 0;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
    this.hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_SHELLS; i++) this.shellMesh.setMatrixAt(i, this.hide);
  }

  spawnParticle(x, y, z, vx, vy, vz, col, life, size, grav = 1, grow = 0) {
    const p = this.particles[this.pNext];
    this.pNext = (this.pNext + 1) % MAX_PARTICLES;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.r = col[0]; p.g = col[1]; p.b = col[2];
    p.life = life; p.max = life; p.size = size; p.grav = grav; p.grow = grow;
  }

  impact(pos, normal, material) {
    const col = MAT_COLORS[material] ?? MAT_COLORS.concrete;
    const [nx, ny, nz] = normal;
    const spark = material === 'metal' || material === 'grate';
    // Dust puff.
    for (let i = 0; i < 6; i++) {
      const s = 0.6 + Math.random() * 1.6;
      this.spawnParticle(pos[0] + nx * 0.02, pos[1] + ny * 0.02, pos[2] + nz * 0.02,
        nx * s + (Math.random() - 0.5) * 1.2, ny * s + Math.random() * 0.8, nz * s + (Math.random() - 0.5) * 1.2,
        col, 0.35 + Math.random() * 0.3, 0.05 + Math.random() * 0.05, 0.3, 0.25);
    }
    // Chips / sparks.
    for (let i = 0; i < (spark ? 7 : 4); i++) {
      const s = 2 + Math.random() * 4;
      this.spawnParticle(pos[0], pos[1], pos[2],
        nx * s + (Math.random() - 0.5) * 3, ny * s + Math.random() * 3, nz * s + (Math.random() - 0.5) * 3,
        spark ? [1, 0.85, 0.4] : [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], 0.25 + Math.random() * 0.25, spark ? 0.018 : 0.025, 1.5);
    }
    this.addHole(pos, normal, material);
  }

  blood(pos, dir, headshot) {
    const n = headshot ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const s = 1 + Math.random() * 2.5;
      this.spawnParticle(pos[0], pos[1], pos[2],
        dir[0] * s + (Math.random() - 0.5) * 2, dir[1] * s + Math.random() * 1.5, dir[2] * s + (Math.random() - 0.5) * 2,
        MAT_COLORS.blood, 0.4 + Math.random() * 0.3, 0.035 + Math.random() * 0.03, 1.2);
    }
    for (let i = 0; i < 3; i++) {
      this.spawnParticle(pos[0], pos[1], pos[2], (Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5),
        [0.6, 0.05, 0.05], 0.4, 0.09, 0.1, 0.3);
    }
  }

  addHole(pos, normal, material) {
    const i = this.hNext;
    this.hNext = (this.hNext + 1) % MAX_HOLES;
    this.holes.count = Math.max(this.holes.count, i + 1);
    const n = this._n.set(normal[0], normal[1], normal[2]);
    this._q.setFromUnitVectors(this._z, n);
    const rq = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    this._q.multiply(rq);
    const size = material === 'metal' ? 0.05 : 0.07;
    this._s.set(size, size, size);
    this._v.set(pos[0] + n.x * 0.004, pos[1] + n.y * 0.004, pos[2] + n.z * 0.004);
    this._m.compose(this._v, this._q, this._s);
    this.holes.setMatrixAt(i, this._m);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  tracer(from, to, speed = 450) {
    const tr = this.tracers[this.tNext];
    this.tNext = (this.tNext + 1) % MAX_TRACERS;
    tr.from.copy(from);
    tr.dir.subVectors(to, from);
    tr.dist = tr.dir.length();
    if (tr.dist < 0.5) return;
    tr.dir.divideScalar(tr.dist);
    tr.t = 0;
    tr.speed = speed;
    tr.len = Math.min(3.5, tr.dist * 0.4);
    tr.active = true;
    tr.mesh.visible = true;
    tr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tr.dir);
  }

  muzzleFlash(pos, dir) {
    const f = this.flashes[this.fNext];
    this.fNext = (this.fNext + 1) % MAX_FLASHES;
    f.obj.position.copy(pos);
    f.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    f.obj.rotateZ(Math.random() * Math.PI);
    f.obj.visible = true;
    f.t = 0.05;
  }

  shell(pos, vel) {
    const s = this.shells[this.sNext];
    this.sNext = (this.sNext + 1) % MAX_SHELLS;
    s.pos.copy(pos);
    s.vel.copy(vel);
    s.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    s.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    s.life = 2.5;
    s.bounces = 0;
  }

  update(dt) {
    // Particles.
    let n = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 9.8 * p.grav * dt;
      const drag = Math.max(0, 1 - dt * 2.5);
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.max;
      this.pPos[n * 3] = p.x; this.pPos[n * 3 + 1] = p.y; this.pPos[n * 3 + 2] = p.z;
      this.pCol[n * 3] = p.r; this.pCol[n * 3 + 1] = p.g; this.pCol[n * 3 + 2] = p.b;
      this.pSize[n] = (p.size + p.grow * (1 - k)) * Math.min(1, k * 3);
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;

    // Tracers.
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.t += dt * tr.speed;
      const head = Math.min(tr.dist, tr.t);
      const tail = Math.max(0, tr.t - tr.len);
      if (tail >= tr.dist) { tr.active = false; tr.mesh.visible = false; continue; }
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, tail);
      tr.mesh.scale.set(0.012, 0.012, Math.max(0.01, head - tail));
    }

    // Flashes.
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) f.obj.visible = false;
    }

    // Shells.
    for (let i = 0; i < MAX_SHELLS; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { this.shellMesh.setMatrixAt(i, this.hide); continue; }
      s.vel.y -= 9.8 * dt;
      s.pos.addScaledVector(s.vel, dt);
      // Bounce on whatever is underneath.
      const below = this.world.overlaps(s.pos.x - 0.01, s.pos.y - 0.01, s.pos.z - 0.01, s.pos.x + 0.01, s.pos.y, s.pos.z + 0.01);
      if (below && s.vel.y < 0) {
        s.pos.y = below.max[1] + 0.005;
        s.vel.y *= -0.35; s.vel.x *= 0.5; s.vel.z *= 0.5;
        s.spin.multiplyScalar(0.5);
        if (Math.abs(s.vel.y) < 0.3) { s.vel.y = 0; s.spin.set(0, 0, 0); }
        if (s.bounces++ === 0 && this.onShellBounce) this.onShellBounce(s.pos);
      }
      s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
      this._q.setFromEuler(s.rot);
      this._s.set(1, 1, 1);
      this._m.compose(s.pos, this._q, this._s);
      this.shellMesh.setMatrixAt(i, this._m);
    }
    this.shellMesh.instanceMatrix.needsUpdate = true;
  }
}
