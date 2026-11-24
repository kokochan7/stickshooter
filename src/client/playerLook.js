// Classic textured player look (CS 1.6 era): a low-poly shaped body in a
// white suit with a 128px pixel texture (folds, seams, belt, vest, knee
// pads), dark gloves with fingers and boots. Matches the Classic textured
// maps (mapLook.js). Visual only: bones, IK, poses and the sim's hitboxes
// are unchanged. The suit is white so the team tint multiplies through it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _d = new THREE.Vector3();

// Under the game's bright hemisphere + sun a pure white suit blows out to a
// flat shape; this keeps the shading readable while it still reads as white.
export const SUIT_ALBEDO = 0.75;

// ---------- geometry ----------

// A tapered tube along a bone for Limb.set (a unit cylinder spanning
// y -0.5..0.5, scaled by the bone length, with the limb radius set to 1).
// prof: [[s, r], ...], s in metres from the bone's start (it may run past
// 0..L for rounded ends), r the half-width. depth: z radius / x radius.
function tube(prof, L, { depth = 1, sides = 8, rings = 8 } = {}) {
  const curve = new THREE.SplineCurve(prof.map(([s, r]) => new THREE.Vector2(Math.max(0, r), s)));
  const pts = curve.getPoints(rings);
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, sides);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), pos.getY(i) / L - 0.5, pos.getZ(i) * depth);
  g.computeVertexNormals();
  return g;
}

function capsule(a, b, r, seg) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, A.distanceTo(B)), 2, seg);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d.subVectors(B, A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

function merge(list) {
  return mergeGeometries(list.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
    return x;
  }));
}

// Pull box vertices onto a smaller box's surface + r: rounded corners.
function roundBox(g, r) {
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
  return g;
}

// A gloved fist centred on the palm: +y along the forearm (towards the
// knuckles), back of the hand +z, thumb on +x (a right hand; the left one is
// mirrored with scale.x = -1). s = 1 is an adult hand.
function fistGeo(s, seg) {
  const parts = [roundBox(new THREE.BoxGeometry(0.075, 0.075, 0.032, 2, 2, 1), 0.012).translate(0, 0.045, 0)];
  for (let i = 0; i < 4; i++) {
    const x = -0.027 + i * 0.018, l = i === 3 ? 0.024 : 0.03;
    parts.push(capsule([x, 0.08, 0.004], [x, 0.08 + l, -0.002], 0.0098, seg));
    parts.push(capsule([x, 0.08 + l, -0.008], [x, 0.074 + l * 0.5, -0.03], 0.0094, seg));
    parts.push(capsule([x, 0.074 + l * 0.5, -0.03], [x, 0.058, -0.03], 0.009, seg));
  }
  parts.push(capsule([0.036, 0.025, -0.008], [0.04, 0.06, -0.03], 0.011, seg));
  parts.push(capsule([0.04, 0.06, -0.03], [0.012, 0.075, -0.042], 0.0095, seg));
  parts.push(capsule([0, -0.01, 0], [0, 0.02, 0], 0.026, seg));
  return merge(parts).translate(0, -0.045, 0).scale(s, s, s);
}

// A boot, forward is -z, sole at y = -0.042 (the foot joint is 4.5 cm up).
function bootGeo(seg) {
  const body = new THREE.CapsuleGeometry(0.048, 0.13, 3, seg).rotateX(Math.PI / 2).scale(1, 0.8, 1).translate(0, -0.006, -0.045);
  const collar = new THREE.CylinderGeometry(0.042, 0.05, 0.07, seg).translate(0, 0.02, 0.02);
  const g = merge([body, collar]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.04) p.setY(i, -0.042);
  g.computeVertexNormals();
  return g;
}

// ---------- textures ----------

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  return t;
}

function grain(g, S, amt, seed) {
  const r = rnd(seed);
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    const v = (r() - 0.5) * amt;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(x, y, 2, 2);
  }
}

// Suit texture per body part. u runs around the limb (0.25 / 0.75 are its
// sides), v along it from the bone's start.
function suitTex(kind) {
  return canvasTex(128, (g, S) => {
    g.fillStyle = '#f2f2f0';
    g.fillRect(0, 0, S, S);
    const r = rnd(kind.length * 7 + 3);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.03})`;
      g.fillRect(r() * S, 0, 4 + r() * 10, S);
    }
    grain(g, S, 0.08, kind.length * 13 + 1);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(S * 0.25 - 1, 0, 2, S);
    g.fillRect(S * 0.75 - 1, 0, 2, S);
    const band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, S * (1 - v1), S, S * (v1 - v0)); };
    if (kind === 'torso') {
      band(0.3, 0.37, '#3a3a3c'); // belt
      g.fillStyle = '#9a9a96'; g.fillRect(S * 0.46, S * 0.63, S * 0.08, S * 0.07); // buckle
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(S * 0.34, S * 0.14, S * 0.32, S * 0.55); // vest front
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(S * 0.34, S * 0.14, 2, S * 0.55); g.fillRect(S * 0.66, S * 0.14, 2, S * 0.55);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (const u of [0.4, 0.55]) g.fillRect(S * u, S * 0.4, S * 0.07, S * 0.1); // pouches
      band(0.9, 0.95, 'rgba(0,0,0,0.15)'); // collar
    } else if (kind === 'shin') {
      g.fillStyle = '#4a4a4c'; g.fillRect(S * 0.37, 0, S * 0.26, S * 0.2); // knee pad
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(S * 0.4, S * 0.03, S * 0.2, S * 0.04);
      band(0, 0.14, '#2c2c2e'); // boot top
    } else if (kind === 'fore') {
      band(0.9, 1, '#2c2c2e'); // glove cuff
      band(0, 0.1, 'rgba(0,0,0,0.2)'); // rolled sleeve
    } else if (kind === 'upper') {
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(S * 0.15, S * 0.25, S * 0.2, S * 0.18); // patch
    } else if (kind === 'thigh') {
      g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(S * 0.14, S * 0.35, S * 0.2, S * 0.22); // pocket
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(S * 0.14, S * 0.35, S * 0.2, 2);
    }
  });
}

function plainTex(base, amt, seed) {
  return canvasTex(64, (g, S) => { g.fillStyle = base; g.fillRect(0, 0, S, S); grain(g, S, amt, seed); });
}

// ---------- the kit (built once, shared by every player) ----------

const THIGH = 0.47, SHIN = 0.47, UPPER = 0.32, FORE = 0.32, TORSO = 0.5, VM = 0.42;
let kit = null;
export function playerKit() {
  if (kit) return kit;
  kit = {
    // Pelvis, waist, chest and shoulders in one piece, wider than deep.
    torso: tube([[-0.12, 0], [-0.1, 0.1], [-0.02, 0.13], [0.1, 0.12], [0.22, 0.12], [0.35, 0.145], [0.44, 0.155], [0.52, 0.12], [0.565, 0]], TORSO, { sides: 10, depth: 0.62 }),
    neck: tube([[-0.02, 0], [0, 0.042], [0.15, 0.04], [0.17, 0]], 0.15),
    thigh: tube([[-0.04, 0], [-0.01, 0.068], [0.12, 0.074], [0.4, 0.05], [0.47, 0.045], [0.5, 0]], THIGH),
    shin: tube([[-0.03, 0], [0, 0.048], [0.14, 0.054], [0.4, 0.04], [0.47, 0.045], [0.49, 0]], SHIN),
    upper: tube([[-0.05, 0], [-0.01, 0.055], [0.06, 0.055], [0.3, 0.04], [0.34, 0]], UPPER),
    fore: tube([[-0.03, 0], [0, 0.042], [0.08, 0.045], [0.29, 0.032], [0.33, 0]], FORE),
    hand: fistGeo(1.0, 4),
    foot: bootGeo(8),
    head: new THREE.SphereGeometry(1, 10, 8).scale(0.125, 0.15, 0.135),
    eyes: { x: 0.044, y: 0.022, z: -0.124, s: [0.017, 0.032, 0.012] },
    // First-person arms (longer bones in view space).
    vmUpper: tube([[-0.05, 0], [0, 0.05], [0.3, 0.042], [0.44, 0]], VM),
    vmFore: tube([[-0.03, 0], [0, 0.044], [0.1, 0.047], [0.36, 0.033], [0.44, 0]], VM),
    vmHand: fistGeo(1.12, 5),
    tex: {},
  };
  for (const part of ['torso', 'thigh', 'shin', 'upper', 'fore']) kit.tex[part] = suitTex(part);
  kit.tex.head = plainTex('#f4f4f2', 0.1, 7);
  kit.gloveMat = new THREE.MeshLambertMaterial({ map: plainTex('#3a3a3d', 0.15, 5) });
  kit.bootMat = new THREE.MeshLambertMaterial({ map: plainTex('#2a2a2c', 0.15, 6) });
  return kit;
}

// One tintable suit material per body part, for one player.
export function suitMaterials(parts) {
  const k = playerKit();
  return Object.fromEntries(parts.map((p) => [p, new THREE.MeshLambertMaterial({ map: k.tex[p] })]));
}

export function tintSuit(mats, hex) {
  const c = new THREE.Color(hex).multiplyScalar(SUIT_ALBEDO);
  for (const m of Object.values(mats)) m.color.copy(c);
}

// Point a fist along its forearm with the palm facing `palm` (same space).
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
export function orientHand(hand, foreQuat, palm) {
  _y.set(0, 1, 0).applyQuaternion(foreQuat);
  _z.copy(palm).multiplyScalar(-1).addScaledVector(_y, palm.dot(_y));
  if (_z.lengthSq() < 1e-6) { hand.quaternion.copy(foreQuat); return; }
  _z.normalize();
  _x.crossVectors(_y, _z);
  hand.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}
// Palms: right hand on the grip faces left, left hand under the handguard faces up.
export const PALM_R = new THREE.Vector3(-1, -0.2, 0).normalize();
export const PALM_L = new THREE.Vector3(0.3, 1, 0).normalize();
export const PALM_DOWN = new THREE.Vector3(0, -1, 0);
