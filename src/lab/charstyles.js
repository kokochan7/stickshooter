// PROTOTYPE: candidate character looks for the stickman and the first-person
// arms. applyStyle(man, id) / applyArmStyle(viewModel, id) restyle the
// existing rig in place (same bones, IK, poses and hitboxes), swapping the
// cylinder/sphere parts for shaped ones and changing materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { teamColor } from '../client/stickman.js';

export const CHAR_STYLES = {
  current: { label: 'A · Current (toon sticks)' },
  smooth: { label: 'B · Smooth stickman' },
  mannequin: { label: 'C · Art mannequin' },
  classic: { label: 'D · Classic textured' },
  sculpt: { label: 'E · Realistic sculpt' },
};

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _d = new THREE.Vector3();

// ---------- geometry helpers ----------

// A tapered tube along a bone. prof: [[s, rx], ...] with s in metres from
// the bone's start (may run past 0..L for rounded ends), rx its half-width.
// Built for Limb.set (unit cylinder spanning y -0.5..0.5, scaled by length),
// so y is normalised by L; x/z are absolute (the limb radius is set to 1).
// depth: z radius as a fraction of x. sides/rings: tessellation. flat: flat
// shading (the low-poly look).
function tube(prof, L, { depth = 1, sides = 12, rings = 24, flat = false, zOff = null } = {}) {
  const pts = prof.map(([s, r]) => new THREE.Vector2(Math.max(0, r), s));
  const curve = new THREE.SplineCurve(pts);
  const sm = curve.getPoints(rings);
  sm[0].x = 0; sm[sm.length - 1].x = 0;
  const lathe = new THREE.LatheGeometry(sm.map((p) => new THREE.Vector2(p.x, p.y)), sides);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let z = pos.getZ(i) * depth;
    if (zOff) z += zOff(y);
    pos.setXYZ(i, pos.getX(i), y / L - 0.5, z);
  }
  let g = lathe;
  if (flat) { g = g.toNonIndexed(); }
  g.computeVertexNormals();
  return g;
}

function ellipsoid(rx, ry, rz, w = 16, h = 12) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}

// Capsule from a to b (both [x,y,z]), radius r.
function capsule(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 3, seg);
  _d.subVectors(B, A).normalize();
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

function merge(list) {
  const clean = list.map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    return x;
  });
  return mergeGeometries(clean);
}

// A closed fist, +y along the forearm (towards the knuckles), back of the
// hand facing +z, thumb on +x (a right hand; mirror x for the left).
// s: overall scale (1 = an adult hand, about 18 cm long with the fingers).
function fistGeo(s = 1, detail = 'fingers', seg = 6) {
  const parts = [];
  if (detail === 'mitt') {
    parts.push(ellipsoid(0.042, 0.05, 0.03, 12, 8).translate(0, 0.045, 0));
    parts.push(capsule([0.035, 0.02, 0.0], [0.04, 0.06, -0.02], 0.014, seg));
  } else {
    // Palm and back of the hand.
    const palm = new THREE.BoxGeometry(0.075, 0.075, 0.032, 2, 2, 1);
    roundBox(palm, 0.012);
    parts.push(palm.translate(0, 0.045, 0));
    // Four curled fingers: knuckle segment forward, then down under the palm.
    for (let i = 0; i < 4; i++) {
      const x = -0.027 + i * 0.018;
      const lenK = i === 3 ? 0.024 : 0.03;
      parts.push(capsule([x, 0.08, 0.004], [x, 0.08 + lenK, -0.002], 0.0098, seg));
      parts.push(capsule([x, 0.08 + lenK, -0.008], [x, 0.074 + lenK * 0.5, -0.03], 0.0094, seg));
      parts.push(capsule([x, 0.074 + lenK * 0.5, -0.03], [x, 0.058, -0.03], 0.009, seg));
    }
    // Thumb across the front of the fingers.
    parts.push(capsule([0.036, 0.025, -0.008], [0.04, 0.06, -0.03], 0.011, seg));
    parts.push(capsule([0.04, 0.06, -0.03], [0.012, 0.075, -0.042], 0.0095, seg));
    // Wrist.
    parts.push(capsule([0, -0.01, 0], [0, 0.02, 0], 0.026, seg));
  }
  return merge(parts).translate(0, -0.045, 0).scale(s, s, s);
}

function roundBox(g, r) {
  // Pull box vertices towards a smaller box: cheap rounded corners.
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position;
  const hx = (b.max.x - b.min.x) / 2 - r, hy = (b.max.y - b.min.y) / 2 - r, hz = (b.max.z - b.min.z) / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    v.sub(c).setLength(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
}

// A shoe/foot, forward is -z, sole at y = -0.045 (the foot joint is 4.5 cm up).
function footGeo(kind, seg = 10) {
  if (kind === 'round') return ellipsoid(0.06, 0.045, 0.1, 12, 8).translate(0, 0, -0.03);
  const parts = [];
  // Sole/body of the shoe: a squashed tube along z.
  const body = new THREE.CapsuleGeometry(0.048, 0.13, 4, seg);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.8, 1);
  body.translate(0, -0.006, -0.045);
  parts.push(body);
  // Ankle/heel collar.
  parts.push(new THREE.CylinderGeometry(0.042, 0.05, 0.07, seg).translate(0, 0.02, 0.02));
  const g = merge(parts);
  // Flatten the sole.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.04) p.setY(i, -0.042);
  g.computeVertexNormals();
  return g;
}

// ---------- procedural textures ----------

function canvasTex(size, draw, { nearest = false, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; }
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function noise(g, S, amt, seed = 1, cell = 1) {
  const r = rnd(seed);
  for (let y = 0; y < S; y += cell) for (let x = 0; x < S; x += cell) {
    const v = (r() - 0.5) * amt;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(x, y, cell, cell);
  }
}

// Classic (CS 1.6 era) suit textures: 128px, nearest filtered. White base so
// the team tint multiplies through. v runs along the bone (0 = start).
function classicTex(kind) {
  return canvasTex(128, (g, S) => {
    g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, S, S);
    // Fabric: soft vertical folds + grain.
    const r = rnd(kind.length * 7 + 3);
    for (let i = 0; i < 8; i++) {
      const x = r() * S, w = 4 + r() * 10;
      g.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.03})`;
      g.fillRect(x, 0, w, S);
    }
    noise(g, S, 0.08, kind.length * 13 + 1, 2);
    // Seams down the sides (u = 0.25 and 0.75 are the sides of the limb).
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(S * 0.25 - 1, 0, 2, S);
    g.fillRect(S * 0.75 - 1, 0, 2, S);
    const band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, S * (1 - v1), S, S * (v1 - v0)); };
    if (kind === 'torso') {
      // Lathe v: 0 at the bottom (hips). Belt, vest panel and collar.
      band(0.3, 0.37, '#3a3a3c');
      g.fillStyle = '#9a9a96'; g.fillRect(S * 0.46, S * (1 - 0.37), S * 0.08, S * 0.07); // buckle
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(S * 0.34, S * (1 - 0.86), S * 0.32, S * 0.55); // vest front
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(S * 0.34, S * (1 - 0.86), 2, S * 0.55); g.fillRect(S * 0.66, S * (1 - 0.86), 2, S * 0.55);
      for (const u of [0.4, 0.55]) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(S * u, S * (1 - 0.6), S * 0.07, S * 0.1); }
      band(0.9, 0.95, 'rgba(0,0,0,0.15)');
    } else if (kind === 'shin') {
      // Knee pad at the top, boot cuff at the bottom.
      g.fillStyle = '#4a4a4c'; g.fillRect(S * 0.37, 0, S * 0.26, S * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(S * 0.4, S * 0.03, S * 0.2, S * 0.04);
      band(0, 0.14, '#2c2c2e');
    } else if (kind === 'fore') {
      band(0.9, 1, '#2c2c2e'); // glove cuff
      band(0, 0.1, 'rgba(0,0,0,0.2)'); // rolled sleeve
    } else if (kind === 'upper') {
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(S * 0.15, S * 0.25, S * 0.2, S * 0.18); // patch
    } else if (kind === 'thigh') {
      g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(S * 0.14, S * 0.35, S * 0.2, S * 0.22); // pocket
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(S * 0.14, S * 0.35, S * 0.2, 2);
    }
  }, { nearest: true });
}

function plainTex(S, base, amt, seed, nearest = false) {
  return canvasTex(S, (g) => { g.fillStyle = base; g.fillRect(0, 0, S, S); noise(g, S, amt, seed, nearest ? 2 : 1); }, { nearest, repeat: true });
}

// Normal map for the sculpt: fine fabric weave + soft creases (tangent space).
function weaveNormal() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S);
  const r = rnd(42);
  const creases = Array.from({ length: 10 }, () => [r() * S, r() * S, 0.4 + r(), r() * Math.PI]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6) + (r() - 0.5) * 0.15;
    for (const [cx, cy, a, ang] of creases) {
      const dx = x - cx, dy = y - cy;
      const along = dx * Math.cos(ang) + dy * Math.sin(ang), across = -dx * Math.sin(ang) + dy * Math.cos(ang);
      v += a * 2.5 * Math.exp(-(across * across) / 30 - (along * along) / 2500);
    }
    h[y * S + x] = v;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
    const hy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
    const n = new THREE.Vector3(-hx * 0.6, -hy * 0.6, 1).normalize();
    const i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// Soft rim light (back-lit edge) added to a Lambert/Phong/Standard material:
// reads as a rounded, lit form instead of a flat cut-out.
function addRim(mat, strength = 0.35, power = 2.5) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      { vec3 vd = normalize(vViewPosition); float rim = pow(1.0 - clamp(dot(normalize(normal), vd), 0.0, 1.0), ${power.toFixed(2)});
        outgoingLight += rim * ${strength.toFixed(3)} * vec3(1.0, 0.98, 0.95) * (0.4 + 0.6 * diffuseColor.rgb); }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'rim' + strength + power;
  return mat;
}

// ---------- body kits ----------
// Bone lengths from stickman.js / viewmodel.js.
const THIGH = 0.47, SHIN = 0.47, UPPER = 0.32, FORE = 0.32, TORSO = 0.5;
const VM = 0.42; // first-person arm bone length

function kitFor(id) {
  const cache = kitFor.cache ??= {};
  if (cache[id]) return cache[id];
  let k;
  if (id === 'smooth') {
    const o = { sides: 14, rings: 16 };
    k = {
      torso: tube([[-0.07, 0], [-0.04, 0.07], [0.05, 0.088], [0.3, 0.085], [0.45, 0.095], [0.53, 0.07], [0.56, 0]], TORSO, { ...o, depth: 0.85 }),
      neck: tube([[-0.02, 0], [0, 0.045], [0.15, 0.04], [0.17, 0]], 0.15, o),
      thigh: tube([[-0.06, 0], [-0.03, 0.05], [0.02, 0.058], [0.45, 0.047], [0.5, 0]], THIGH, o),
      shin: tube([[-0.04, 0], [0, 0.047], [0.15, 0.048], [0.44, 0.036], [0.47, 0]], SHIN, o),
      upper: tube([[-0.05, 0], [-0.02, 0.046], [0.05, 0.046], [0.3, 0.04], [0.34, 0]], UPPER, o),
      fore: tube([[-0.03, 0], [0, 0.04], [0.1, 0.04], [0.3, 0.034], [0.32, 0]], FORE, o),
      hand: fistGeo(1.05, 'mitt'),
      foot: footGeo('round'),
      head: ellipsoid(0.16, 0.168, 0.158, 24, 18),
      eyes: { x: 0.054, y: 0.02, z: -0.146, s: [0.024, 0.046, 0.018] },
      hideJoints: true,
      vm: {
        upper: tube([[-0.05, 0], [0, 0.034], [0.3, 0.031], [0.44, 0]], VM, o),
        fore: tube([[-0.03, 0], [0, 0.031], [0.3, 0.028], [0.43, 0]], VM, o),
        hand: fistGeo(1.0, 'mitt'),
      },
    };
    const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 40, specular: 0x2a2a2a });
    k.mat = addRim(mat, 0.25);
    k.albedo = 0.75;
  } else if (id === 'mannequin') {
    const o = { sides: 16, rings: 20 };
    k = {
      // Chest block + waist + pelvis as one lathe, wider than deep.
      torso: tube([[-0.13, 0], [-0.1, 0.1], [-0.02, 0.13], [0.08, 0.115], [0.2, 0.105], [0.33, 0.135], [0.43, 0.15], [0.5, 0.13], [0.55, 0.06], [0.565, 0]], TORSO, { ...o, depth: 0.62 }),
      neck: tube([[-0.02, 0], [0, 0.04], [0.15, 0.036], [0.17, 0]], 0.15, o),
      thigh: tube([[-0.02, 0], [0.01, 0.065], [0.12, 0.072], [0.4, 0.046], [0.45, 0.04], [0.47, 0]], THIGH, o),
      shin: tube([[0.0, 0], [0.03, 0.044], [0.15, 0.05], [0.4, 0.032], [0.45, 0.03], [0.47, 0]], SHIN, o),
      upper: tube([[0.0, 0], [0.03, 0.045], [0.08, 0.048], [0.28, 0.035], [0.31, 0.03], [0.32, 0]], UPPER, o),
      fore: tube([[0.0, 0], [0.025, 0.036], [0.08, 0.04], [0.28, 0.027], [0.32, 0]], FORE, o),
      hand: fistGeo(0.95, 'fingers', 5),
      foot: footGeo('shoe', 10),
      head: ellipsoid(0.12, 0.148, 0.13, 24, 18),
      eyes: { x: 0.042, y: 0.022, z: -0.122, s: [0.016, 0.03, 0.012] },
      joints: { knee: 0.048, elbow: 0.038, shoulder: 0.055, hip: 0.0, chest: 0.0, hipBall: 0.06, waist: 0.1 },
      vm: {
        upper: tube([[0, 0], [0.03, 0.05], [0.3, 0.04], [0.42, 0]], VM, o),
        fore: tube([[0, 0], [0.03, 0.04], [0.1, 0.045], [0.36, 0.031], [0.42, 0]], VM, o),
        hand: fistGeo(1.12, 'fingers', 6),
        elbow: 0.044,
      },
    };
    const tex = plainTex(128, '#f4efe6', 0.06, 9);
    k.mat = addRim(new THREE.MeshPhongMaterial({ color: 0xffffff, map: tex, shininess: 18, specular: 0x1c1c1c }), 0.22);
    k.jointMat = addRim(new THREE.MeshPhongMaterial({ color: 0xffffff, map: tex, shininess: 50, specular: 0x333333 }), 0.22);
    k.jointShade = 0.78;
    k.albedo = 0.72;
  } else if (id === 'classic') {
    const o = { sides: 8, rings: 8 };
    k = {
      torso: tube([[-0.12, 0], [-0.1, 0.1], [-0.02, 0.13], [0.1, 0.12], [0.22, 0.12], [0.35, 0.145], [0.44, 0.155], [0.52, 0.12], [0.565, 0]], TORSO, { ...o, sides: 10, depth: 0.62 }),
      neck: tube([[-0.02, 0], [0, 0.042], [0.15, 0.04], [0.17, 0]], 0.15, o),
      thigh: tube([[-0.04, 0], [-0.01, 0.068], [0.12, 0.074], [0.4, 0.05], [0.47, 0.045], [0.5, 0]], THIGH, o),
      shin: tube([[-0.03, 0], [0, 0.048], [0.14, 0.054], [0.4, 0.04], [0.47, 0.045], [0.49, 0]], SHIN, o),
      upper: tube([[-0.05, 0], [-0.01, 0.055], [0.06, 0.055], [0.3, 0.04], [0.34, 0]], UPPER, o),
      fore: tube([[-0.03, 0], [0, 0.042], [0.08, 0.045], [0.29, 0.032], [0.33, 0]], FORE, o),
      hand: fistGeo(1.0, 'fingers', 4),
      foot: footGeo('shoe', 8),
      head: ellipsoid(0.125, 0.15, 0.135, 10, 8),
      eyes: { x: 0.044, y: 0.022, z: -0.124, s: [0.017, 0.032, 0.012] },
      hideJoints: true,
      vm: {
        upper: tube([[-0.05, 0], [0, 0.05], [0.3, 0.042], [0.44, 0]], VM, o),
        fore: tube([[-0.03, 0], [0, 0.044], [0.1, 0.047], [0.36, 0.033], [0.44, 0]], VM, o),
        hand: fistGeo(1.12, 'fingers', 5),
      },
    };
    k.texMats = {};
    for (const part of ['torso', 'thigh', 'shin', 'upper', 'fore']) {
      k.texMats[part] = new THREE.MeshLambertMaterial({ color: 0xffffff, map: classicTex(part) });
    }
    k.mat = k.texMats.upper;
    k.handMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: plainTex(64, '#3a3a3d', 0.15, 5, true) });
    k.footMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: plainTex(64, '#2a2a2c', 0.15, 6, true) });
    k.headMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: plainTex(64, '#f4f4f2', 0.1, 7, true) });
    k.albedo = 0.75;
  } else if (id === 'sculpt') {
    const o = { sides: 24, rings: 40 };
    k = {
      // Pelvis, waist, ribcage and shoulders, wider than deep, chest pushed forward.
      torso: tube([[-0.14, 0], [-0.12, 0.08], [-0.06, 0.125], [0.02, 0.13], [0.12, 0.112], [0.22, 0.118], [0.32, 0.14], [0.42, 0.158], [0.48, 0.15], [0.53, 0.1], [0.56, 0]], TORSO, { ...o, depth: 0.6, zOff: (s) => -0.025 * Math.exp(-((s - 0.36) ** 2) / 0.008) }),
      neck: tube([[-0.04, 0], [0, 0.05], [0.06, 0.042], [0.15, 0.04], [0.17, 0]], 0.15, o),
      // Quads, knee taper, calf, ankle.
      thigh: tube([[-0.06, 0], [-0.03, 0.07], [0.06, 0.08], [0.2, 0.073], [0.36, 0.058], [0.44, 0.047], [0.48, 0.043], [0.5, 0]], THIGH, o),
      shin: tube([[-0.03, 0], [0, 0.045], [0.06, 0.05], [0.14, 0.058], [0.24, 0.048], [0.38, 0.032], [0.45, 0.03], [0.48, 0]], SHIN, o),
      // Deltoid, biceps, elbow; forearm bulge, wrist.
      upper: tube([[-0.06, 0], [-0.04, 0.05], [0.0, 0.058], [0.06, 0.052], [0.15, 0.046], [0.27, 0.038], [0.31, 0.036], [0.34, 0]], UPPER, o),
      fore: tube([[-0.03, 0], [0, 0.038], [0.06, 0.044], [0.14, 0.04], [0.26, 0.029], [0.31, 0.027], [0.33, 0]], FORE, o),
      hand: fistGeo(1.0, 'fingers', 8),
      foot: footGeo('shoe', 14),
      head: headGeo(),
      eyes: { x: 0.04, y: 0.026, z: -0.118, s: [0.015, 0.027, 0.011] },
      hideJoints: true,
      vm: {
        upper: tube([[-0.06, 0], [0, 0.06], [0.1, 0.055], [0.3, 0.042], [0.44, 0]], VM, o),
        fore: tube([[-0.03, 0], [0, 0.042], [0.08, 0.052], [0.18, 0.048], [0.34, 0.034], [0.4, 0.032], [0.43, 0]], VM, o),
        hand: fistGeo(1.12, 'fingers', 10),
      },
    };
    const nrm = weaveNormal();
    k.mat = addRim(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.45, 0.45) }), 0.3);
    k.handMat = addRim(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 }), 0.3);
    k.headMat = k.handMat;
    k.footMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.8 });
    k.tintFeet = false;
    k.tintHands = true;
    k.albedo = 0.68;
  }
  cache[id] = k;
  return k;
}

// Head with a jaw and back of the skull: an ellipsoid pushed into shape.
function headGeo() {
  const g = new THREE.SphereGeometry(1, 32, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Narrower jaw and chin towards the front-bottom.
    const low = Math.max(0, -y);
    x *= 1 - 0.28 * low * low;
    if (z < 0) z *= 1 - 0.12 * low; // chin (front is -z)
    else z *= 1 + 0.08 * Math.max(0, y); // back of the skull
    // Brow ridge and eye sockets.
    if (z < -0.6 && y > -0.1 && y < 0.45) z += 0.04 * Math.exp(-((y - 0.15) ** 2) / 0.02) * (Math.abs(x) > 0.15 ? 1 : 0.2);
    // Nose bump.
    z -= 0.09 * Math.exp(-(x * x) / 0.012 - ((y + 0.05) ** 2) / 0.03) * (z < 0 ? 1 : 0);
    p.setXYZ(i, x * 0.118, y * 0.148, z * 0.132);
  }
  g.computeVertexNormals();
  return g;
}

// Point a fist along its forearm (+y = fore direction) with the palm facing
// `palm` (same space). Back of the hand is local +z, so z = -palm.
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
function orientHand(hand, foreQuat, palm) {
  _y.set(0, 1, 0).applyQuaternion(foreQuat);
  _z.copy(palm).multiplyScalar(-1).addScaledVector(_y, palm.dot(_y)).normalize();
  if (_z.lengthSq() < 1e-6) { hand.quaternion.copy(foreQuat); return; }
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  hand.quaternion.setFromRotationMatrix(_m);
}
const PALM_R = new THREE.Vector3(-1, -0.2, 0).normalize(), PALM_L = new THREE.Vector3(0.3, 1, 0).normalize();
const PALM_DEAD = new THREE.Vector3(0, -1, 0);

function stripOutline(part) {
  if (part.outline) { part.outline.parent?.remove(part.outline); part.outline = null; }
}

// Restyle a third-person Stickman in place.
export function applyStyle(man, id) {
  if (id === 'current') return man;
  const k = kitFor(id);
  const mat = k.mat.clone();
  mat.onBeforeCompile = k.mat.onBeforeCompile; mat.customProgramCacheKey = k.mat.customProgramCacheKey;
  const tinted = [mat];
  const tint = (m) => { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; tinted.push(c); return c; };
  const L = man.limbs;
  const setLimb = (limb, geo, m = mat) => { stripOutline(limb); limb.mesh.geometry = geo; limb.mesh.material = m; limb.radius = 1; };
  let jointTinted = null;
  const jm = () => (jointTinted ??= tint(k.jointMat));
  const pm = (part) => (k.texMats ? tint(k.texMats[part]) : mat);
  const torsoMat = pm('torso');
  setLimb(man.torso, k.torso, torsoMat);
  setLimb(man.neck, k.neck, k.headMat ? tint(k.headMat) : mat);
  const parts = { thigh: pm('thigh'), shin: pm('shin'), upper: pm('upper'), fore: pm('fore') };
  const handMat = k.handMat ? (k.tintHands ? tint(k.handMat) : k.handMat) : mat;
  const footMat = k.footMat ? k.footMat : mat;
  for (const s of ['L', 'R']) {
    for (const p of ['thigh', 'shin', 'upper', 'fore']) setLimb(L[p + s], k[p], parts[p]);
    for (const j of ['knee', 'elbow', 'shoulder']) {
      stripOutline(L[j + s]);
      const r = k.joints?.[j];
      if (r) {
        L[j + s].mesh.geometry = ellipsoid(1, 1, 1, 14, 10);
        L[j + s].mesh.scale.setScalar(r);
        L[j + s].mesh.material = k.jointMat ? jm() : mat;
      } else L[j + s].mesh.visible = false;
    }
    stripOutline(L['hand' + s]);
    L['hand' + s].mesh.geometry = k.hand;
    L['hand' + s].mesh.scale.set(s === 'L' ? -1 : 1, 1, 1);
    L['hand' + s].mesh.material = handMat;
    stripOutline(L['foot' + s]);
    L['foot' + s].mesh.geometry = k.foot;
    L['foot' + s].mesh.scale.set(1, 1, 1);
    L['foot' + s].mesh.material = footMat;
  }
  for (const j of [man.hip, man.chest]) { stripOutline(j); j.mesh.visible = false; }
  // Mannequin: ball joints at the hips and waist.
  const extras = [];
  if (k.joints?.hipBall) {
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(ellipsoid(k.joints.hipBall, k.joints.hipBall, k.joints.hipBall, 14, 10), jm());
      man.body.add(b);
      extras.push(['hip', s, b]);
    }
  }
  // Head.
  const headMesh = man.head.children[0];
  headMesh.geometry = k.head;
  headMesh.scale.setScalar(1);
  headMesh.material = k.headMat ? tint(k.headMat) : mat;
  man.head.remove(man.head.children[1]); // outline shell
  const eyes = man.head.children.slice(1);
  eyes.forEach((e, i) => {
    const sx = i === 0 ? -1 : 1;
    e.position.set(sx * k.eyes.x, k.eyes.y, k.eyes.z);
    e.scale.set(...k.eyes.s);
    e.rotation.y = sx * k.eyes.x * 3.2;
  });

  // Team tint: everything in `tinted` follows the body color; joints a shade darker.
  const jointMat = jointTinted;
  man.material = mat;
  man.team = undefined;
  man.setTeam = function (team) {
    if (this.team === team) return;
    this.team = team;
    const c = new THREE.Color(teamColor(team)).multiplyScalar(k.albedo ?? 1);
    for (const m of tinted) m.color.copy(c);
    if (jointMat) jointMat.color.copy(c).multiplyScalar(k.jointShade ?? 1);
    if (k.tintFeet !== false && footMat !== mat && id !== 'classic' && id !== 'sculpt') footMat.color.copy(c);
  };
  man.setTeam(null);

  // After each pose: orient the hands along the forearms and place extras.
  const after = () => {
    for (const s of ['L', 'R']) {
      const fore = L['fore' + s].mesh, hand = L['hand' + s].mesh;
      orientHand(hand, fore.quaternion, man.deathT >= 0 || !man.gun ? PALM_DEAD : s === 'R' ? PALM_R : PALM_L);
    }
    for (const [kind, s, b] of extras) {
      if (kind === 'hip') b.position.set(s * 0.09, man.tmp.hip.y, man.tmp.hip.z);
    }
  };
  const up = man.update.bind(man), pd = man.poseDead.bind(man);
  man.update = (s, dt) => { up(s, dt); after(); };
  man.poseDead = (...a) => { pd(...a); after(); };
  man.styleId = id;
  return man;
}

// Restyle the first-person arms in place.
export function applyArmStyle(vm, id) {
  if (id === 'current') return vm;
  const k = kitFor(id);
  const v = k.vm;
  const mk = (part) => {
    const base = k.texMats ? k.texMats[part] : k.mat;
    const c = base.clone(); c.onBeforeCompile = base.onBeforeCompile; c.customProgramCacheKey = base.customProgramCacheKey;
    return c;
  };
  const upMat = mk('upper'), foreMat = mk('fore');
  const mkHand = () => { const c = k.handMat.clone(); c.onBeforeCompile = k.handMat.onBeforeCompile; c.customProgramCacheKey = k.handMat.customProgramCacheKey; return c; };
  const handMat = k.handMat ? (k.tintHands ? mkHand() : k.handMat) : upMat;
  for (const s of ['L', 'R']) {
    const A = vm.arms;
    stripOutline(A['upper' + s]); A['upper' + s].mesh.geometry = v.upper; A['upper' + s].mesh.material = upMat; A['upper' + s].radius = 1;
    stripOutline(A['fore' + s]); A['fore' + s].mesh.geometry = v.fore; A['fore' + s].mesh.material = foreMat; A['fore' + s].radius = 1;
    if (v.elbow) {
      A['elbow' + s].mesh.geometry = ellipsoid(1, 1, 1, 14, 10);
      A['elbow' + s].mesh.scale.setScalar(v.elbow);
      A['elbow' + s].mesh.material = k.jointMat.clone();
      A['elbow' + s].mesh.material.color.setScalar(k.jointShade);
    } else A['elbow' + s].mesh.visible = false;
    stripOutline(A['hand' + s]);
    A['hand' + s].mesh.geometry = v.hand;
    A['hand' + s].mesh.scale.set(s === 'L' ? -1 : 1, 1, 1);
    A['hand' + s].mesh.material = handMat;
  }
  vm.armMat = upMat;
  const tinted = [upMat, foreMat];
  if (k.tintHands && handMat !== upMat) tinted.push(handMat);
  vm.team = undefined;
  vm.setTeam = function (team) {
    if (this.team === team) return;
    this.team = team;
    for (const m of tinted) m.color.setHex(teamColor(team)).multiplyScalar(k.albedo ?? 1);
  };
  const lim = vm.limb.bind(vm);
  vm.limb = (side, shoulder, hand, pole) => {
    lim(side, shoulder, hand, pole);
    const fore = vm.arms['fore' + side].mesh, h = vm.arms['hand' + side].mesh;
    orientHand(h, fore.quaternion, side === 'R' ? PALM_R : PALM_L);
  };
  return vm;
}

// Draw calls and triangles for one object tree (visible meshes).
export function countCost(root) {
  let calls = 0, tris = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh) return;
    calls++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { calls, tris: Math.round(tris) };
}
