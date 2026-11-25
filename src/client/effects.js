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
const SMOKE_PUFFS = 30;
const MAX_SMOKE = SMOKE_PUFFS * 16;
const MAX_BLAST = 128; // smoke billboards for HE blasts
const MAX_FLAME = 224; // fireball billboards: a blast fills its whole damage radius
const MAX_SCORCH = 6; // HE scorch marks on the floor
const SCORCH_LIFE = 8; // seconds a scorch mark stays
const SCORCH_FADE = 1.5; // ... fading out over the last part of that

// A soft, lumpy round puff for the smoke clouds (and HE fireballs).
function puffTexture(density = 0.45) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 14 + Math.random() * 14;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${density})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const grad = g.createRadialGradient(32, 32, 8, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeSmokeMesh() {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(MAX_SMOKE * 3), size = new Float32Array(MAX_SMOKE), alpha = new Float32Array(MAX_SMOKE);
  const shade = new Float32Array(MAX_SMOKE), rot = new Float32Array(MAX_SMOKE);
  const add = (name, arr, n) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
  add('iPos', pos, 3); add('iSize', size, 1); add('iAlpha', alpha, 1); add('iShade', shade, 1); add('iRot', rot, 1);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puffTexture(0.7) } },
    vertexShader: `
      attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iShade; attribute float iRot;
      varying vec2 vUv; varying float vA; varying float vShade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        float c = cos(iRot), s = sin(iRot);
        mv.xy += mat2(c, s, -s, c) * position.xy * iSize;
        // Puffs right in front of the camera fade out instead of popping.
        vA = iAlpha * clamp((-mv.z - 0.3) / 1.2, 0.0, 1.0);
        vUv = uv; vShade = iShade;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec2 vUv; varying float vA; varying float vShade;
      void main() {
        float a = texture2D(map, vUv).a * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(vShade), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  return { mesh, pos, size, alpha, shade, rot };
}

// Camera-facing colored puffs in one instanced draw call: the HE flash
// (additive, so it glows), and the fireball and dark smoke (normal blending,
// so they read against a bright sky too).
function makeBillboards(max, additive, map = additive ? dotTexture() : puffTexture(0.75)) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(max * 3), size = new Float32Array(max), col = new Float32Array(max * 4), rot = new Float32Array(max);
  const add = (name, arr, n) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
  add('iPos', pos, 3); add('iSize', size, 1); add('iCol', col, 4); add('iRot', rot, 1);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader: `
      attribute vec3 iPos; attribute float iSize; attribute vec4 iCol; attribute float iRot;
      varying vec2 vUv; varying vec4 vCol;
      void main() {
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        float c = cos(iRot), s = sin(iRot);
        mv.xy += mat2(c, s, -s, c) * position.xy * iSize;
        vCol = iCol;
        vCol.a *= clamp((-mv.z - 0.3) / 1.2, 0.0, 1.0);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
      void main() {
        float a = texture2D(map, vUv).a * vCol.a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol.rgb, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = additive ? 3 : 2;
  const list = Array.from({ length: max }, () => ({
    life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, rot: 0, spin: 0, c0: [1, 1, 1], c1: [1, 1, 1], a: 1, fadeIn: 0,
  }));
  return { mesh, pos, size, col, rot, list, next: 0, live: 0 };
}

// Spawn one billboard: it grows from size s0 to s1 and shifts color from c0
// to c1 over its life, fading out at the end (and in over fadeIn seconds).
function billboard(b, x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a, fadeIn = 0) {
  const p = b.list[b.next];
  b.next = (b.next + 1) % b.list.length;
  p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
  p.life = p.max = life; p.s0 = s0; p.s1 = s1; p.c0 = c0; p.c1 = c1; p.a = a; p.fadeIn = fadeIn;
  p.rot = Math.random() * 6.28; p.spin = (Math.random() - 0.5) * 1.2;
  b.live = b.list.length; // the update counts the real number
}

function updateBillboards(b, dt) {
  if (!b.live) return;
  let n = 0;
  const { pos, size, col, rot } = b;
  for (const p of b.list) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) continue;
    const drag = Math.exp(-3 * dt); // same slow-down at any frame rate
    p.vx *= drag; p.vy *= drag; p.vz *= drag;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.rot += p.spin * dt;
    const k = 1 - p.life / p.max; // 0 -> 1 over its life
    const age = p.max - p.life;
    const e = 1 - (1 - k) * (1 - k); // grows fast, then slows
    pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
    size[n] = p.s0 + (p.s1 - p.s0) * e;
    col[n * 4] = p.c0[0] + (p.c1[0] - p.c0[0]) * k;
    col[n * 4 + 1] = p.c0[1] + (p.c1[1] - p.c0[1]) * k;
    col[n * 4 + 2] = p.c0[2] + (p.c1[2] - p.c0[2]) * k;
    col[n * 4 + 3] = p.a * Math.min(1, (1 - k) * 2.5) * (p.fadeIn > 0 ? Math.min(1, age / p.fadeIn) : 1);
    rot[n] = p.rot;
    n++;
  }
  b.live = n;
  const g = b.mesh.geometry;
  g.instanceCount = n;
  b.mesh.visible = n > 0;
  for (const k of ['iPos', 'iSize', 'iCol', 'iRot']) g.attributes[k].needsUpdate = true;
}

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

    // Smoke grenade clouds: camera-facing puffs, all of them one instanced
    // draw call.
    this.smoke = makeSmokeMesh();
    scene.add(this.smoke.mesh);

    // HE blasts: a glow, an orange fireball and the dark smoke after it.
    this.fire = makeBillboards(48, true);
    this.flame = makeBillboards(MAX_FLAME, false, puffTexture(0.95));
    this.flame.mesh.renderOrder = 3;
    this.blastSmoke = makeBillboards(MAX_BLAST, false);
    scene.add(this.fire.mesh, this.flame.mesh, this.blastSmoke.mesh);

    // HE scorch marks: each its own decal so it can fade out on its own.
    const scorchTex = holeTexture();
    this.scorches = Array.from({ length: MAX_SCORCH }, () => {
      const m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({
        map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      m.visible = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      return { mesh: m, life: 0 };
    });
    this.scNext = 0;
  }

  // Draw the smoke clouds. amount(s): how much of cloud s is there, 0..1.
  syncSmokes(smokes, time, amount, height) {
    const { mesh, pos, size, alpha, shade, rot } = this.smoke;
    let n = 0;
    for (const s of smokes) {
      const k = amount(s, time);
      if (k <= 0) continue;
      let seed = s.id * 7919;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const r = s.radius * (0.45 + 0.55 * Math.min(1, k * 1.4));
      const age = time - s.start;
      for (let i = 0; i < SMOKE_PUFFS && n < MAX_SMOKE; i++, n++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.75, h = rnd();
        pos[n * 3] = s.pos[0] + Math.cos(a + age * 0.02) * d * r;
        pos[n * 3 + 1] = s.pos[1] + 0.3 + h * height * 0.75 * Math.min(1, 0.4 + k) + age * 0.01;
        pos[n * 3 + 2] = s.pos[2] + Math.sin(a + age * 0.02) * d * r;
        size[n] = r * (0.9 + rnd() * 0.6);
        // Thick, dark grey like CS 1.6's smoke.
        alpha[n] = 0.97 * Math.min(1, k * 1.3);
        shade[n] = 0.34 + rnd() * 0.12;
        rot[n] = rnd() * 6.28 + age * (rnd() - 0.5) * 0.15;
      }
    }
    const g = mesh.geometry;
    g.instanceCount = n;
    mesh.visible = n > 0;
    for (const k of ['iPos', 'iSize', 'iAlpha', 'iShade', 'iRot']) g.attributes[k].needsUpdate = true;
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

  // A dead stickman vanishes in a soft white puff.
  poof(pos) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.4;
      const g = 0.85 + Math.random() * 0.15;
      this.spawnParticle(pos[0] + (Math.random() - 0.5) * 0.3, pos[1] + (Math.random() - 0.5) * 1.2, pos[2] + (Math.random() - 0.5) * 0.3,
        Math.cos(a) * s, 0.3 + Math.random() * 0.9, Math.sin(a) * s, [g, g, g], 0.45 + Math.random() * 0.35, 0.12 + Math.random() * 0.1, -0.1, 0.6);
    }
  }

  // HE grenade going off, CS 1.6 style: a blinding flash, a fireball that
  // rolls out to the edge of the damage radius (radius, in meters: anyone
  // the fire reaches can be hurt), sparks and debris, a column of dark smoke
  // and a scorch mark on the floor that fades after 8 s. The fire stops at
  // walls, like the damage. Under water it's a burst of bubbles and spray.
  explosion(pos, water = false, radius = 9.85) {
    const [x, y, z] = pos;
    const R = Math.random;
    if (water) {
      for (let i = 0; i < 50; i++) {
        const a = R() * Math.PI * 2, s = 1 + R() * 4;
        this.spawnParticle(x + (R() - 0.5) * 1.2, y + R() * 0.5, z + (R() - 0.5) * 1.2,
          Math.cos(a) * s * 0.6, 3 + R() * 9, Math.sin(a) * s * 0.6, [0.85, 0.93, 1], 0.7 + R() * 0.7, 0.1 + R() * 0.12, 1.2, 0.4);
      }
      return;
    }
    const F = this.fire, L = this.flame, S = this.blastSmoke;
    const cy = y + 0.6;
    // Flash: a wide warm glow that lights up everything around it for a moment.
    billboard(F, x, cy, z, 0, 0, 0, 0.25, radius * 0.6, radius * 1.1, [0.9, 0.6, 0.25], [0.5, 0.2, 0.05], 0.5);
    billboard(F, x, cy, z, 0, 0, 0, 0.12, 2.5, 5, [1, 0.9, 0.6], [1, 0.6, 0.2], 0.8);
    // Core: hot yellow puffs right at the grenade.
    for (let i = 0; i < 14; i++) {
      const h = R();
      billboard(L, x + (R() - 0.5) * 1.2, y + 0.4 + R() * 1.2, z + (R() - 0.5) * 1.2,
        (R() - 0.5) * 3, 1.5 + R() * 2, (R() - 0.5) * 3,
        0.55 + R() * 0.4, 2 + R(), 4.5 + R() * 2.5, [1, 0.8 + h * 0.15, 0.3 + h * 0.25], [0.45, 0.1, 0.03], 0.95);
    }
    // The blast front: flame puffs flung out in every direction over the
    // ground and up, each slowing to a stop at the radius (or at a wall).
    // Velocities are damped by exp(-3t) (updateBillboards), so a puff
    // launched at v travels v/3 * (1 - exp(-3 life)).
    const n = Math.round(Math.min(150, Math.max(40, radius * radius * 0.65)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 * 7.3 + R() * 0.6; // spread round evenly
      // Most of the fire hugs the ground so the footprint reads clearly.
      const e = i % 3 === 0 ? 0.25 + R() * 0.9 : R() * 0.22;
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
      const size = radius * (0.26 + R() * 0.14);
      // Half the puffs make the edge, the rest fill in the middle.
      const edge = i % 2 === 0;
      let reach = edge ? radius * (0.88 + R() * 0.12) - size * 0.35 : radius * (0.15 + Math.sqrt(R()) * 0.6);
      const hit = this.world.raycast?.(x, cy, z, dx, dy, dz, reach + size * 0.35);
      if (hit) reach = Math.max(0.3, hit.t - size * 0.4);
      const life = 0.85 + R() * 0.45;
      const v = (3 * reach) / (1 - Math.exp(-3 * life));
      const h = R();
      billboard(L, x + dx * 0.4, cy + dy * 0.4, z + dz * 0.4, dx * v, dy * v, dz * v,
        life, size * 0.35, size, [1, 0.78 + h * 0.2, 0.3 + h * 0.25], [0.72, 0.16 + h * 0.1, 0.03], 0.92);
      // A hot glow riding along with some of the front.
      if (i % 5 === 0) {
        billboard(F, x + dx * 0.4, cy + dy * 0.4, z + dz * 0.4, dx * v, dy * v, dz * v,
          life * 0.55, size * 0.5, size * 1.2, [0.55, 0.32, 0.08], [0.35, 0.1, 0.02], 0.45);
      }
    }
    // Sparks and debris.
    for (let i = 0; i < 44; i++) {
      const a = R() * Math.PI * 2, s = 6 + R() * 12;
      const spark = i % 3 !== 0;
      this.spawnParticle(x, y + 0.2, z, Math.cos(a) * s, 3 + R() * 9, Math.sin(a) * s,
        spark ? [1, 0.8, 0.35] : [0.25, 0.22, 0.2], 0.6 + R() * 0.7, spark ? 0.04 : 0.06, 1.6);
    }
    // Dark smoke billowing up after the fire.
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2, d = R() * 1.6, g = 0.16 + R() * 0.14;
      billboard(S, x + Math.cos(a) * d, y + 0.5 + R() * 1.5, z + Math.sin(a) * d,
        Math.cos(a) * (0.5 + R() * 1.5), 1.2 + R() * 1.8, Math.sin(a) * (0.5 + R() * 1.5),
        2.6 + R() * 2, 1.6 + R(), 4.5 + R() * 2.5, [g, g, g], [g + 0.2, g + 0.2, g + 0.19], 0.55, 0.15 + R() * 0.25);
    }
    // Scorch mark on whatever is just below.
    const h = this.world.raycast?.(x, y + 0.3, z, 0, -1, 0, 1.2);
    if (h && h.normal[1] > 0.7) this.scorch([x, y + 0.3 - h.t, z], h.normal, 3);
  }

  // A black scorch mark that stays SCORCH_LIFE seconds, then fades away.
  scorch(pos, normal, size) {
    const s = this.scorches[this.scNext];
    this.scNext = (this.scNext + 1) % MAX_SCORCH;
    const n = this._n.set(normal[0], normal[1], normal[2]);
    this._q.setFromUnitVectors(this._z, n);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * Math.PI * 2));
    this._s.set(size, size, size);
    this._v.set(pos[0] + n.x * 0.006, pos[1] + n.y * 0.006, pos[2] + n.z * 0.006);
    s.mesh.matrix.compose(this._v, this._q, this._s);
    s.mesh.matrixWorldNeedsUpdate = true;
    s.mesh.material.opacity = 1;
    s.mesh.visible = true;
    s.life = SCORCH_LIFE;
  }

  // Jumping or falling into water: a ring of spray.
  splash(pos, strength = 1) {
    const R = Math.random;
    const n = Math.round(10 + 14 * strength);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, s = (0.8 + R() * 1.8) * strength;
      this.spawnParticle(pos[0] + Math.cos(a) * 0.3, pos[1], pos[2] + Math.sin(a) * 0.3,
        Math.cos(a) * s, (2 + R() * 3) * Math.min(1.5, strength), Math.sin(a) * s, [0.85, 0.93, 1], 0.45 + R() * 0.35, 0.06 + R() * 0.06, 1.3, 0.1);
    }
  }

  addHole(pos, normal, material, size = material === 'metal' ? 0.05 : 0.07) {
    const i = this.hNext;
    this.hNext = (this.hNext + 1) % MAX_HOLES;
    this.holes.count = Math.max(this.holes.count, i + 1);
    const n = this._n.set(normal[0], normal[1], normal[2]);
    this._q.setFromUnitVectors(this._z, n);
    const rq = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    this._q.multiply(rq);
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

    updateBillboards(this.fire, dt);
    updateBillboards(this.flame, dt);
    updateBillboards(this.blastSmoke, dt);

    for (const s of this.scorches) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.mesh.material.opacity = Math.min(1, s.life / SCORCH_FADE);
    }
  }
}
