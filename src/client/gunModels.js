// Procedural guns. Each gun is one merged mesh with vertex colors and a
// per-vertex shine value (one draw call; the mag and minigun barrels are their
// own meshes so they can move). Parts are side profiles extruded with a small
// chamfer, lathed round parts (barrels, muzzle devices, scopes) and boxes.
// Gun space: barrel along -Z, up is +Y, origin at the grip. Sizes are meters,
// close to the real guns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Finishes: [color, shine]. Shine drives the specular highlight and a faint
// sky reflection, so steel reads as metal and polymer and wood stay matte.
const MATS = {
  poly: [0x25282d, 0.16], // polymer furniture
  black: [0x18191c, 0.12], // grip texture, rubber-ish
  rubber: [0x121315, 0.05],
  steel: [0x2f333a, 0.75], // blued / parkerized steel
  dark: [0x24272d, 0.55], // anodized aluminium
  metal: [0x4a5059, 0.9], // bare machined steel
  silver: [0xa9aeb6, 1.0], // stainless
  chrome: [0xd3d7dd, 1.0],
  bore: [0x060607, 0.0],
  wood: [0x7a4523, 0.32],
  woodL: [0x93552a, 0.32],
  woodD: [0x55301a, 0.25],
  green: [0x4a5b35, 0.22], // AWP stock
  olive: [0x535a32, 0.25],
  tan: [0xb39a6c, 0.45], // P90 mag
  brass: [0xb48a3c, 0.9],
  glass: [0x1d3448, 1.0],
  red: [0xa8322a, 0.5],
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
const _one = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

// Set while building the light third-person version: fewer round segments
// and no chamfers.
let LOD = false;
const seg = (n) => (LOD ? Math.max(6, Math.round(n * 0.5)) : n);

function finish(geo, mat) {
  if (geo.index) geo = geo.toNonIndexed();
  const [hex, shine] = MATS[mat];
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), spec = new Float32Array(n);
  _c.setHex(hex);
  const nor = geo.attributes.normal.array;
  for (let i = 0; i < n; i++) {
    // Faces pointing down are a little darker, like ambient occlusion.
    const s = 0.86 + 0.14 * Math.min(1, nor[i * 3 + 1] + 1);
    col[i * 3] = _c.r * s; col[i * 3 + 1] = _c.g * s; col[i * 3 + 2] = _c.b * s;
    spec[i] = shine;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('spec', new THREE.BufferAttribute(spec, 1));
  return geo;
}

function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _one);
  return geo.applyMatrix4(_m);
}

// Box w,h,d at x,y,z.
function box(w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  return finish(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), mat);
}
// Cylinder along Z (radius r at the front, rb at the back).
function cyl(r, len, x, y, z, mat, segs = 12, rb = r) {
  const g = new THREE.CylinderGeometry(rb, r, len, seg(segs));
  g.rotateX(Math.PI / 2);
  return finish(place(g, x, y, z), mat);
}
// Cylinder across the gun (along X).
function xcyl(r, len, x, y, z, mat, segs = 10) {
  const g = new THREE.CylinderGeometry(r, r, len, seg(segs));
  g.rotateZ(Math.PI / 2);
  return finish(place(g, x, y, z), mat);
}
// Upright cylinder (along Y).
function ycyl(r, h, x, y, z, mat, segs = 10, rt = r) {
  return finish(place(new THREE.CylinderGeometry(rt, r, h, seg(segs)), x, y, z), mat);
}
// Round part turned around an axis along Z at (x, y): pts are [radius, z]
// from front (most negative z) to back.
function lathe(pts, x, y, mat, segs = 14) {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg(segs));
  g.rotateX(Math.PI / 2);
  return finish(place(g, x, y, 0), mat);
}
// Round part turned around the Y axis: pts are [radius, y] from bottom up.
function latheY(pts, x, y, z, mat, segs = 14) {
  const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg(segs));
  return finish(place(g, x, y, z), mat);
}
// Side profile: pts are [z, y] outline points, extruded t wide (centered on
// x) with a small chamfer. holes are more outlines cut through.
function prof(pts, t, mat, { x = 0, holes = [], bevel = 0.0022 } = {}) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const b = LOD ? 0 : Math.min(bevel, t * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
    bevelOffset: -b, bevelSegments: 1, curveSegments: 1,
  });
  g.translate(0, 0, -(t - 2 * b) / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return finish(g, mat);
}
function torus(r, tube, x, y, z, mat, rx = 0, ry = 0) {
  return finish(place(new THREE.TorusGeometry(r, tube, 6, seg(14)), x, y, z, rx, ry, 0), mat);
}

// Rows of thin dark grooves (slide serrations, rail slots, grip lines).
function grooves(n, step, w, h, d, x, y, z, mat = 'bore', axis = 'z') {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (axis === 'z') out.push(box(w, h, d, x, y, z + i * step, mat));
    else out.push(box(w, h, d, x, y + i * step, z, mat));
  }
  return out;
}
// Picatinny rail on top from z0 to z1 (z0 < z1), base at y.
function rail(z0, z1, y, w = 0.021, mat = 'dark') {
  const len = z1 - z0, out = [box(w, 0.007, len, 0, y + 0.0035, (z0 + z1) / 2, mat)];
  const n = Math.floor(len / 0.01);
  for (let i = 0; i < n; i++) out.push(box(w + 0.001, 0.0025, 0.0045, 0, y + 0.006, z0 + 0.007 + i * 0.01, 'bore'));
  return out;
}
// Ring of slots around a muzzle device.
function slots(n, r, x, y, z, len, mat = 'bore') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    out.push(box(0.003, 0.003, len, x + Math.cos(a) * r, y + Math.sin(a) * r, z, mat, 0, 0, a));
  }
  return out;
}
// Muzzle bore: a dark disc just in front of the face.
function bore(r, y, z) {
  return cyl(r, 0.002, 0, y, z, 'bore', 10);
}

// Trigger guard with its opening and a trigger inside. Front at zf, back at
// zb, top at yt (hidden in the frame), bottom at yb.
function guard(zf, zb, yt, yb, mat = 'steel', t = 0.011) {
  const w = 0.0055;
  return [
    prof([[zb, yt], [zb, yb + 0.008], [zb - 0.008, yb], [zf + 0.01, yb], [zf, yb + 0.01], [zf, yt]], t, mat, {
      holes: [[[zb - w, yt - 0.004], [zb - w, yb + 0.01], [zb - 0.011, yb + w], [zf + 0.012, yb + w], [zf + w, yb + 0.012], [zf + w, yt - 0.004]]],
      bevel: 0.0015,
    }),
    prof([[zb - 0.026, yt - 0.003], [zb - 0.021, yt - 0.003], [zb - 0.024, yb + 0.02], [zb - 0.032, yb + 0.012],
      [zb - 0.034, yb + 0.015], [zb - 0.029, yb + 0.022]], 0.006, 'metal', { bevel: 0.001 }),
  ];
}

// A rifle pistol grip, front edge at zf, top at yt, raked back.
function pistolGrip(zf, yt, mat = 'poly', t = 0.03, len = 0.1) {
  const zb = zf + 0.04, k = 0.2;
  return prof([[zf, yt], [zb, yt], [zb + 0.004, yt - 0.012], [zb + len * k, yt - len], [zb + len * k - 0.006, yt - len - 0.006],
    [zf + len * k + 0.002, yt - len - 0.006], [zf + len * k - 0.004, yt - len + 0.012], [zf + len * k * 0.6, yt - len * 0.62],
    [zf + len * k * 0.5 - 0.006, yt - len * 0.5], [zf + len * k * 0.4, yt - len * 0.38], [zf - 0.002, yt - 0.01]], t, mat);
}

const SPECS = {
  usp: () => ({
    parts: [
      // Slide with rear serrations, ejection port and three-dot sights.
      prof([[-0.172, 0.041], [-0.172, 0.071], [-0.164, 0.079], [0.018, 0.079], [0.024, 0.073], [0.024, 0.041]], 0.03, 'steel', { bevel: 0.003 }),
      ...grooves(5, 0.0042, 0.0312, 0.026, 0.0018, 0, 0.06, 0.0),
      box(0.014, 0.003, 0.036, 0.004, 0.079, -0.045, 'metal'),
      box(0.003, 0.013, 0.036, 0.0145, 0.069, -0.045, 'metal'),
      box(0.004, 0.006, 0.006, 0, 0.082, -0.158, 'black'),
      box(0.0065, 0.007, 0.007, 0.0065, 0.082, 0.014, 'black'), box(0.0065, 0.007, 0.007, -0.0065, 0.082, 0.014, 'black'),
      box(0.0018, 0.0018, 0.001, 0, 0.0835, -0.1615, 'chrome'),
      // Barrel face.
      cyl(0.0068, 0.004, 0, 0.058, -0.174, 'metal'), bore(0.0046, 0.058, -0.1765),
      // Polymer frame: dust cover with rail grooves, beavertail, grip.
      prof([[-0.162, 0.042], [0.02, 0.042], [0.032, 0.034], [0.036, 0.026], [0.026, 0.021], [0.028, 0.012], [0.044, -0.086],
        [0.04, -0.092], [-0.002, -0.092], [-0.006, -0.086], [-0.012, -0.06], [-0.019, -0.051], [-0.015, -0.04], [-0.021, -0.027],
        [-0.017, -0.016], [-0.024, 0.006], [-0.03, 0.016], [-0.07, 0.018], [-0.162, 0.024]], 0.028, 'poly', { bevel: 0.003 }),
      box(0.0285, 0.003, 0.08, 0, 0.031, -0.118, 'bore'),
      prof([[0.023, 0.004], [0.038, -0.078], [0.003, -0.083], [-0.009, -0.03], [-0.013, 0.0]], 0.0295, 'black', { bevel: 0.001 }),
      ...guard(-0.078, -0.022, 0.022, -0.006, 'poly', 0.012),
      // Slide stop, decocker.
      box(0.003, 0.005, 0.03, -0.0155, 0.034, -0.03, 'steel'),
      box(0.004, 0.008, 0.01, -0.0165, 0.064, 0.016, 'steel'),
    ],
    mag: [box(0.022, 0.11, 0.03, 0, -0.035, 0.012, 'steel', -0.2), box(0.03, 0.008, 0.046, 0, -0.095, 0.024, 'black', -0.06)],
    magDir: [0, -0.98, 0.2],
    muzzle: [0, 0.058, -0.18], fore: [-0.02, -0.035, 0.01], hold: 'pistol', eject: [0.02, 0.075, -0.045],
  }),
  deagle: () => ({
    parts: [
      // Fixed barrel with its top rib, then the slide behind it.
      prof([[-0.252, 0.044], [-0.252, 0.083], [-0.244, 0.09], [-0.098, 0.09], [-0.098, 0.044]], 0.03, 'silver', { bevel: 0.003 }),
      box(0.012, 0.005, 0.15, 0, 0.0915, -0.172, 'silver'),
      ...grooves(13, 0.011, 0.0125, 0.002, 0.004, 0, 0.0945, -0.237),
      bore(0.0085, 0.065, -0.2535),
      prof([[-0.1, 0.044], [-0.1, 0.085], [-0.092, 0.091], [0.026, 0.091], [0.033, 0.084], [0.033, 0.044]], 0.034, 'silver', { bevel: 0.003 }),
      ...grooves(6, 0.0042, 0.0345, 0.032, 0.0018, 0, 0.065, 0.004, 'steel'),
      box(0.003, 0.016, 0.042, 0.0165, 0.073, -0.052, 'steel'),
      box(0.005, 0.01, 0.008, 0, 0.097, -0.236, 'black'),
      box(0.009, 0.009, 0.008, 0.0075, 0.095, 0.024, 'black'), box(0.009, 0.009, 0.008, -0.0075, 0.095, 0.024, 'black'),
      box(0.012, 0.016, 0.01, 0, 0.082, 0.038, 'steel', 0.4),
      // Frame and grip panels.
      prof([[-0.24, 0.045], [0.03, 0.045], [0.044, 0.036], [0.046, 0.026], [0.034, 0.022], [0.036, 0.008], [0.052, -0.092],
        [0.048, -0.098], [0.0, -0.098], [-0.004, -0.09], [-0.016, 0.004], [-0.026, 0.014], [-0.08, 0.016], [-0.09, 0.024],
        [-0.24, 0.028]], 0.03, 'steel', { bevel: 0.003 }),
      prof([[0.031, 0.008], [0.045, -0.087], [0.004, -0.09], [-0.009, 0.0]], 0.0335, 'black', { bevel: 0.002 }),
      ...grooves(8, -0.01, 0.034, 0.002, 0.03, 0, 0.0, 0.022, 'rubber', 'y'),
      ...guard(-0.088, -0.02, 0.02, -0.008, 'steel', 0.012),
      box(0.004, 0.012, 0.012, -0.0165, 0.036, -0.085, 'metal'),
      box(0.003, 0.006, 0.03, -0.0165, 0.036, -0.03, 'metal'),
    ],
    mag: [box(0.026, 0.11, 0.036, 0, -0.04, 0.02, 'steel', -0.2), box(0.034, 0.008, 0.05, 0, -0.1, 0.03, 'black', -0.1)],
    magDir: [0, -0.98, 0.2],
    muzzle: [0, 0.065, -0.256], fore: [-0.02, -0.04, 0.012], hold: 'pistol', eject: [0.02, 0.08, -0.05],
  }),
  uzi: () => ({
    parts: [
      // Stamped receiver with a ribbed top cover.
      prof([[-0.2, 0.02], [-0.2, 0.082], [-0.192, 0.09], [0.06, 0.09], [0.068, 0.082], [0.068, 0.02]], 0.05, 'steel', { bevel: 0.004 }),
      box(0.0505, 0.004, 0.22, 0, 0.05, -0.07, 'dark'), box(0.0505, 0.004, 0.22, 0, 0.036, -0.07, 'dark'),
      box(0.044, 0.01, 0.24, 0, 0.094, -0.07, 'dark'),
      box(0.004, 0.004, 0.23, 0.012, 0.1, -0.07, 'steel'), box(0.004, 0.004, 0.23, -0.012, 0.1, -0.07, 'steel'),
      box(0.012, 0.012, 0.016, 0, 0.104, -0.13, 'black'),
      // Barrel nut and barrel.
      cyl(0.0085, 0.05, 0, 0.055, -0.225, 'metal'),
      lathe([[0.013, -0.215], [0.018, -0.212], [0.018, -0.2], [0.016, -0.198]], 0, 0.055, 'dark'),
      bore(0.005, 0.055, -0.2505),
      // Sights with protective ears.
      box(0.004, 0.022, 0.008, 0, 0.1, -0.185, 'black'),
      box(0.004, 0.024, 0.012, 0.012, 0.101, -0.185, 'steel'), box(0.004, 0.024, 0.012, -0.012, 0.101, -0.185, 'steel'),
      box(0.004, 0.02, 0.01, 0.01, 0.1, 0.05, 'steel'), box(0.004, 0.02, 0.01, -0.01, 0.1, 0.05, 'steel'),
      // Grip around the magazine, grip safety, guard.
      prof([[-0.04, 0.022], [0.02, 0.022], [0.024, 0.0], [0.02, -0.17], [0.014, -0.18], [-0.032, -0.18], [-0.037, -0.17], [-0.042, 0.0]], 0.034, 'poly', { bevel: 0.003 }),
      ...grooves(5, -0.028, 0.0345, 0.003, 0.05, 0, -0.03, -0.01, 'black', 'y'),
      box(0.012, 0.07, 0.008, 0, -0.04, 0.024, 'steel'),
      ...guard(-0.108, -0.042, 0.024, -0.012, 'steel', 0.01),
      // Folding stock, extended.
      xcyl(0.008, 0.05, 0, 0.035, 0.07, 'metal'),
      box(0.006, 0.008, 0.18, 0.021, 0.035, 0.158, 'steel'), box(0.006, 0.008, 0.18, -0.021, 0.035, 0.158, 'steel'),
      prof([[0.24, 0.072], [0.252, 0.072], [0.256, -0.01], [0.244, -0.012]], 0.05, 'steel', { bevel: 0.003 }),
      box(0.052, 0.07, 0.008, 0, 0.032, 0.258, 'rubber'),
    ],
    mag: [box(0.026, 0.21, 0.034, 0, -0.08, -0.012, 'steel', -0.05), box(0.03, 0.008, 0.04, 0, -0.19, -0.006, 'black')],
    magDir: [0, -1, 0.05],
    muzzle: [0, 0.055, -0.255], fore: [0, 0.03, -0.16], hold: 'rifle', eject: [0.03, 0.08, -0.06],
  }),
  mp5: () => ({
    parts: [
      // Receiver with its pressed ribs, cocking tube and charging handle.
      prof([[-0.21, 0.03], [-0.21, 0.08], [-0.2, 0.09], [0.05, 0.09], [0.06, 0.08], [0.06, 0.03]], 0.044, 'steel', { bevel: 0.006 }),
      box(0.0445, 0.004, 0.2, 0, 0.072, -0.07, 'bore'), box(0.0445, 0.003, 0.2, 0, 0.044, -0.07, 'bore'),
      cyl(0.011, 0.2, 0, 0.086, -0.29, 'steel'),
      box(0.024, 0.006, 0.008, -0.018, 0.086, -0.33, 'black'), cyl(0.006, 0.012, -0.03, 0.086, -0.33, 'black', 8),
      box(0.003, 0.016, 0.04, 0.0225, 0.064, -0.03, 'bore'),
      // Slim handguard.
      prof([[-0.37, 0.034], [-0.37, 0.07], [-0.36, 0.078], [-0.215, 0.078], [-0.21, 0.07], [-0.21, 0.03], [-0.22, 0.022],
        [-0.355, 0.026]], 0.05, 'poly', { bevel: 0.006 }),
      ...grooves(6, 0.024, 0.0505, 0.026, 0.004, 0, 0.05, -0.348, 'black'),
      // Barrel with three-lug thread.
      cyl(0.0095, 0.07, 0, 0.06, -0.405, 'metal'),
      lathe([[0.009, -0.448], [0.0125, -0.446], [0.0125, -0.43], [0.0105, -0.428]], 0, 0.06, 'steel', 12),
      box(0.006, 0.006, 0.012, 0, 0.074, -0.436, 'steel'),
      bore(0.0055, 0.06, -0.4485),
      // Hooded front sight, drum rear sight.
      box(0.012, 0.022, 0.02, 0, 0.098, -0.385, 'steel'),
      torus(0.0125, 0.0028, 0, 0.115, -0.385, 'steel'),
      box(0.003, 0.012, 0.003, 0, 0.113, -0.385, 'black'),
      box(0.02, 0.016, 0.03, 0, 0.096, 0.0, 'steel'), xcyl(0.016, 0.03, 0, 0.11, 0.0, 'steel', 10),
      // Trigger housing, grip, guard, selector.
      prof([[-0.08, 0.033], [0.065, 0.033], [0.065, 0.014], [0.046, 0.008], [-0.07, 0.008], [-0.08, 0.018]], 0.04, 'poly', { bevel: 0.003 }),
      pistolGrip(-0.02, 0.012, 'poly', 0.032, 0.105),
      ...guard(-0.075, -0.018, 0.012, -0.012, 'poly', 0.012),
      box(0.004, 0.006, 0.018, -0.021, 0.022, 0.03, 'metal'),
      // Fixed stock.
      prof([[0.06, 0.04], [0.06, 0.088], [0.2, 0.084], [0.235, 0.1], [0.255, 0.1], [0.255, -0.02], [0.24, -0.02],
        [0.2, 0.03], [0.07, 0.04]], 0.036, 'poly', { bevel: 0.004 }),
      box(0.036, 0.122, 0.01, 0, 0.04, 0.26, 'rubber'),
      box(0.03, 0.03, 0.05, 0, 0.02, -0.19, 'steel'),
    ],
    mag: [prof([[-0.214, 0.03], [-0.172, 0.03], [-0.173, -0.02], [-0.18, -0.07], [-0.193, -0.112], [-0.21, -0.148],
      [-0.25, -0.138], [-0.234, -0.104], [-0.222, -0.064], [-0.216, -0.02]], 0.024, 'steel', { bevel: 0.003 })],
    magDir: [0, -0.96, -0.28],
    muzzle: [0, 0.06, -0.45], fore: [0, 0.015, -0.3], hold: 'rifle', eject: [0.03, 0.07, -0.08],
  }),
  ump45: () => ({
    parts: [
      // Polymer receiver with a top rail.
      prof([[-0.3, 0.032], [-0.3, 0.088], [-0.29, 0.1], [0.05, 0.1], [0.06, 0.09], [0.06, 0.018], [-0.125, 0.018],
        [-0.14, 0.03]], 0.056, 'poly', { bevel: 0.005 }),
      box(0.0565, 0.004, 0.26, 0, 0.06, -0.15, 'black'),
      ...rail(-0.26, 0.04, 0.1),
      box(0.004, 0.02, 0.012, 0, 0.115, -0.25, 'black'),
      prof([[0.01, 0.107], [0.012, 0.13], [0.035, 0.13], [0.04, 0.107]], 0.024, 'dark'),
      box(0.022, 0.008, 0.008, -0.034, 0.08, -0.24, 'black'),
      box(0.003, 0.016, 0.05, 0.0285, 0.066, -0.06, 'bore'),
      // Barrel and flash hider.
      cyl(0.0105, 0.04, 0, 0.06, -0.318, 'metal'),
      lathe([[0.011, -0.352], [0.0135, -0.35], [0.0135, -0.332], [0.011, -0.33]], 0, 0.06, 'steel', 12),
      bore(0.006, 0.06, -0.353),
      // Grip, guard and mag well.
      pistolGrip(-0.02, 0.02, 'poly', 0.034, 0.105),
      ...guard(-0.078, -0.02, 0.02, -0.01, 'poly', 0.013),
      box(0.032, 0.018, 0.07, 0, 0.012, -0.185, 'poly'),
      // Folding skeleton stock, extended.
      prof([[0.06, 0.04], [0.06, 0.09], [0.27, 0.09], [0.285, 0.08], [0.285, -0.03], [0.27, -0.04], [0.24, -0.04], [0.12, 0.04]], 0.03, 'poly', {
        holes: [[[0.09, 0.076], [0.25, 0.076], [0.266, 0.066], [0.266, -0.01], [0.25, -0.022], [0.13, 0.058]]], bevel: 0.003,
      }),
      box(0.032, 0.126, 0.01, 0, 0.025, 0.288, 'rubber'),
    ],
    mag: [prof([[-0.21, 0.03], [-0.152, 0.03], [-0.156, -0.06], [-0.166, -0.125], [-0.222, -0.125], [-0.214, -0.06]], 0.026, 'black', { bevel: 0.003 }),
      box(0.03, 0.008, 0.06, 0, -0.127, -0.194, 'poly')],
    magDir: [0, -1, -0.1],
    muzzle: [0, 0.06, -0.355], fore: [0, 0.012, -0.24], hold: 'rifle', eject: [0.03, 0.08, -0.06],
  }),
  p90: () => ({
    parts: [
      // One-piece shell: front hand loop, thumbhole grip and butt.
      prof([[-0.3, 0.068], [-0.27, 0.085], [0.17, 0.085], [0.2, 0.065], [0.205, -0.06], [0.19, -0.09], [0.15, -0.1],
        [0.04, -0.1], [-0.01, -0.097], [-0.03, -0.1], [-0.13, -0.1], [-0.18, -0.08], [-0.25, -0.02], [-0.3, 0.0]], 0.06, 'poly', {
        holes: [
          [[-0.12, -0.015], [-0.038, -0.015], [-0.032, -0.03], [-0.034, -0.078], [-0.11, -0.078], [-0.135, -0.04]],
          [[0.035, -0.015], [0.13, -0.01], [0.15, -0.03], [0.15, -0.078], [0.035, -0.08]],
        ],
        bevel: 0.008,
      }),
      box(0.0605, 0.003, 0.3, 0, 0.03, -0.06, 'black'),
      prof([[-0.016, -0.012], [0.022, -0.012], [0.026, -0.084], [-0.022, -0.086]], 0.062, 'black', { bevel: 0.004 }),
      // Sight housing over the magazine.
      prof([[-0.18, 0.112], [-0.16, 0.152], [-0.03, 0.152], [-0.01, 0.112]], 0.034, 'black', { bevel: 0.004 }),
      box(0.022, 0.022, 0.002, 0, 0.134, -0.171, 'glass'), box(0.018, 0.016, 0.002, 0, 0.134, -0.009, 'glass'),
      // Barrel and flash hider, charging knob.
      cyl(0.012, 0.03, 0, 0.05, -0.31, 'metal'),
      lathe([[0.011, -0.345], [0.0145, -0.342], [0.0145, -0.32], [0.012, -0.318]], 0, 0.05, 'steel', 12),
      bore(0.006, 0.05, -0.346),
      xcyl(0.006, 0.07, 0, 0.058, -0.24, 'black', 8),
      ...guard(-0.128, -0.04, -0.015, -0.078, 'poly', 0.002),
    ],
    mag: [box(0.052, 0.03, 0.34, 0, 0.1, -0.09, 'tan'), box(0.053, 0.009, 0.3, 0, 0.098, -0.09, 'brass'),
      box(0.044, 0.006, 0.05, 0, 0.115, 0.06, 'black')],
    magDir: [-0.3, 0.9, 0.3],
    muzzle: [0, 0.05, -0.35], fore: [0, -0.03, -0.2], hold: 'rifle', eject: [0, -0.02, 0.1],
  }),
  shotgun: () => ({
    parts: [
      // Receiver with ejection port.
      prof([[-0.17, 0.024], [-0.17, 0.088], [-0.16, 0.095], [0.0, 0.095], [0.012, 0.085], [0.012, 0.02], [-0.17, 0.02]], 0.044, 'steel', { bevel: 0.005 }),
      box(0.003, 0.022, 0.06, 0.0225, 0.07, -0.07, 'bore'),
      box(0.0445, 0.002, 0.16, 0, 0.052, -0.08, 'dark'),
      // Barrel with bead, magazine tube and barrel clamp.
      cyl(0.0155, 0.48, 0, 0.075, -0.41, 'steel', 14),
      bore(0.0115, 0.075, -0.651),
      ycyl(0.0035, 0.008, 0, 0.093, -0.64, 'chrome', 8),
      cyl(0.0125, 0.4, 0, 0.044, -0.37, 'steel', 12),
      lathe([[0.008, -0.585], [0.0135, -0.58], [0.0135, -0.565]], 0, 0.044, 'metal', 12),
      prof([[-0.565, 0.035], [-0.565, 0.088], [-0.548, 0.088], [-0.548, 0.035]], 0.024, 'steel'),
      // Wooden pump with grip grooves.
      prof([[-0.44, 0.022], [-0.44, 0.068], [-0.43, 0.076], [-0.27, 0.076], [-0.26, 0.068], [-0.26, 0.022], [-0.27, 0.014],
        [-0.43, 0.014]], 0.054, 'wood', { bevel: 0.007 }),
      ...grooves(8, 0.02, 0.0545, 0.05, 0.004, 0, 0.045, -0.42, 'woodD'),
      // Stock with a pistol wrist.
      prof([[0.008, 0.03], [0.008, 0.088], [0.04, 0.088], [0.33, 0.07], [0.345, 0.07], [0.345, -0.065], [0.33, -0.065],
        [0.12, -0.005], [0.085, -0.055], [0.06, -0.075], [0.022, -0.07], [0.0, -0.032], [-0.004, 0.0]], 0.042, 'wood', { bevel: 0.006 }),
      box(0.046, 0.14, 0.014, 0, 0.003, 0.352, 'rubber'),
      ...guard(-0.07, -0.008, 0.022, -0.01, 'steel', 0.011),
    ],
    muzzle: [0, 0.075, -0.66], fore: [0, 0.02, -0.35], hold: 'rifle', pump: true, eject: [0.03, 0.07, -0.07],
  }),
  autoshotgun: () => ({
    parts: [
      // Receiver with rail and ghost-ring rear sight.
      prof([[-0.17, 0.024], [-0.17, 0.09], [-0.16, 0.098], [0.02, 0.098], [0.03, 0.09], [0.03, 0.02], [-0.17, 0.02]], 0.046, 'dark', { bevel: 0.005 }),
      box(0.003, 0.024, 0.06, 0.0235, 0.07, -0.08, 'bore'),
      box(0.012, 0.012, 0.02, 0.02, 0.07, -0.06, 'metal'),
      ...rail(-0.15, -0.02, 0.098),
      prof([[-0.02, 0.105], [-0.016, 0.13], [0.008, 0.13], [0.014, 0.105]], 0.026, 'steel'),
      torus(0.007, 0.0022, 0, 0.13, -0.005, 'steel'),
      // Barrel, magazine tube, forend and front sight.
      cyl(0.0155, 0.45, 0, 0.075, -0.395, 'steel', 14),
      bore(0.0115, 0.075, -0.621),
      cyl(0.0135, 0.36, 0, 0.044, -0.35, 'steel', 12),
      lathe([[0.008, -0.545], [0.0145, -0.54], [0.0145, -0.52]], 0, 0.044, 'metal', 12),
      prof([[-0.6, 0.075], [-0.598, 0.105], [-0.585, 0.105], [-0.578, 0.075]], 0.026, 'steel'),
      box(0.004, 0.014, 0.004, 0, 0.1, -0.59, 'red'),
      prof([[-0.4, 0.02], [-0.4, 0.07], [-0.39, 0.078], [-0.2, 0.078], [-0.18, 0.07], [-0.18, 0.02], [-0.19, 0.012], [-0.39, 0.014]], 0.054, 'poly', { bevel: 0.006 }),
      ...grooves(6, 0.03, 0.0545, 0.008, 0.016, 0, 0.05, -0.37, 'black'),
      // Grip, guard and stock.
      pistolGrip(-0.02, 0.022, 'poly', 0.032),
      ...guard(-0.08, -0.02, 0.022, -0.008, 'dark', 0.011),
      cyl(0.016, 0.12, 0, 0.068, 0.09, 'dark', 12),
      prof([[0.08, 0.05], [0.08, 0.092], [0.27, 0.086], [0.285, 0.098], [0.3, 0.098], [0.3, -0.05], [0.285, -0.05],
        [0.22, 0.012], [0.1, 0.04]], 0.04, 'poly', { holes: [[[0.11, 0.076], [0.25, 0.072], [0.25, 0.03], [0.21, 0.03], [0.14, 0.05]]], bevel: 0.004 }),
      box(0.04, 0.15, 0.01, 0, 0.024, 0.305, 'rubber'),
    ],
    muzzle: [0, 0.075, -0.63], fore: [0, 0.02, -0.29], hold: 'rifle', eject: [0.03, 0.07, -0.08],
  }),
  famas: () => ({
    parts: [
      // Bullpup body.
      prof([[-0.335, 0.05], [-0.335, 0.075], [-0.31, 0.082], [0.22, 0.082], [0.245, 0.062], [0.245, -0.075], [0.215, -0.086],
        [0.16, -0.03], [0.05, -0.02], [-0.03, -0.02], [-0.09, -0.025], [-0.12, -0.05], [-0.3, -0.05], [-0.335, -0.02]], 0.058, 'poly', { bevel: 0.006 }),
      box(0.0585, 0.004, 0.42, 0, 0.04, -0.05, 'black'),
      box(0.0585, 0.003, 0.18, 0, -0.03, -0.21, 'black'),
      box(0.03, 0.03, 0.06, 0, 0.06, 0.15, 'black'),
      // Long carry handle with sights, cocking handle under it.
      prof([[-0.27, 0.082], [-0.25, 0.15], [0.1, 0.15], [0.125, 0.082]], 0.024, 'poly', {
        holes: [[[-0.23, 0.09], [-0.215, 0.135], [0.07, 0.135], [0.088, 0.09]]], bevel: 0.004,
      }),
      box(0.004, 0.02, 0.01, 0.009, 0.16, 0.085, 'black'), box(0.004, 0.02, 0.01, -0.009, 0.16, 0.085, 'black'),
      box(0.004, 0.016, 0.006, 0, 0.158, -0.24, 'black'),
      box(0.014, 0.016, 0.014, 0, 0.09, -0.05, 'black'),
      // Barrel, flash hider, folded bipod.
      cyl(0.0105, 0.1, 0, 0.05, -0.385, 'metal'),
      lathe([[0.011, -0.465], [0.0135, -0.462], [0.0135, -0.436], [0.011, -0.433]], 0, 0.05, 'steel', 12),
      ...slots(4, 0.013, 0, 0.05, -0.452, 0.018),
      bore(0.006, 0.05, -0.466),
      box(0.005, 0.008, 0.22, 0.031, 0.02, -0.2, 'steel'), box(0.005, 0.008, 0.22, -0.031, 0.02, -0.2, 'steel'),
      // Grip and the full-hand guard.
      pistolGrip(-0.03, -0.015, 'black', 0.03),
      prof([[-0.035, -0.02], [-0.07, -0.022], [-0.082, -0.06], [-0.075, -0.13], [0.025, -0.13], [0.025, -0.12], [-0.062, -0.12],
        [-0.068, -0.06], [-0.058, -0.032], [-0.035, -0.03]], 0.014, 'poly'),
      prof([[-0.046, -0.025], [-0.04, -0.025], [-0.044, -0.05], [-0.052, -0.058], [-0.054, -0.054], [-0.049, -0.045]], 0.006, 'metal', { bevel: 0.001 }),
    ],
    mag: [prof([[0.09, -0.015], [0.15, -0.015], [0.142, -0.08], [0.13, -0.14], [0.072, -0.14], [0.086, -0.08]], 0.026, 'steel', { bevel: 0.003 })],
    magDir: [0, -0.99, -0.15],
    muzzle: [0, 0.05, -0.47], fore: [0, -0.02, -0.22], hold: 'rifle', eject: [0.03, 0.05, 0.1],
  }),
  ak47: () => ({
    parts: [
      // Stamped receiver, ribbed dust cover, rear sight block.
      prof([[-0.17, 0.028], [-0.17, 0.084], [0.13, 0.084], [0.135, 0.07], [0.135, 0.03], [0.11, 0.018], [0.02, 0.018],
        [-0.02, 0.024], [-0.14, 0.024]], 0.046, 'steel', { bevel: 0.003 }),
      prof([[-0.06, 0.082], [-0.06, 0.094], [-0.05, 0.1], [0.11, 0.1], [0.132, 0.09], [0.132, 0.082]], 0.044, 'steel', { bevel: 0.007 }),
      box(0.012, 0.004, 0.16, 0, 0.101, 0.03, 'dark'),
      box(0.003, 0.03, 0.08, 0.0235, 0.064, -0.02, 'bore'),
      prof([[-0.17, 0.084], [-0.165, 0.104], [-0.125, 0.104], [-0.12, 0.084]], 0.03, 'steel'),
      box(0.02, 0.006, 0.07, 0, 0.106, -0.12, 'steel', -0.04),
      // Charging handle and the long selector lever on the right.
      box(0.018, 0.01, 0.012, 0.031, 0.072, 0.04, 'metal'),
      box(0.003, 0.012, 0.12, 0.0245, 0.063, 0.065, 'metal', 0.06),
      // Wood handguards around the gas tube.
      cyl(0.0105, 0.2, 0, 0.097, -0.27, 'steel', 10),
      prof([[-0.33, 0.088], [-0.32, 0.11], [-0.18, 0.11], [-0.17, 0.088]], 0.036, 'wood', { bevel: 0.007 }),
      prof([[-0.36, 0.04], [-0.36, 0.082], [-0.17, 0.084], [-0.17, 0.028], [-0.19, 0.022], [-0.25, 0.024], [-0.27, 0.03],
        [-0.34, 0.032]], 0.054, 'wood', { bevel: 0.008 }),
      box(0.0545, 0.003, 0.15, 0, 0.06, -0.28, 'woodD'),
      // Barrel, gas block, front sight, cleaning rod, slant brake.
      cyl(0.0095, 0.26, 0, 0.065, -0.49, 'steel', 12),
      box(0.022, 0.045, 0.035, 0, 0.082, -0.378, 'steel'),
      prof([[-0.6, 0.054], [-0.6, 0.08], [-0.588, 0.112], [-0.574, 0.112], [-0.565, 0.08], [-0.55, 0.074], [-0.55, 0.054]], 0.022, 'steel'),
      box(0.003, 0.02, 0.012, 0.009, 0.112, -0.581, 'steel'), box(0.003, 0.02, 0.012, -0.009, 0.112, -0.581, 'steel'),
      box(0.0025, 0.016, 0.0025, 0, 0.116, -0.581, 'black'),
      cyl(0.003, 0.3, 0, 0.044, -0.48, 'metal', 6),
      lathe([[0.011, -0.668], [0.0135, -0.665], [0.0135, -0.625], [0.011, -0.622]], 0, 0.065, 'steel', 12),
      box(0.01, 0.008, 0.012, 0.005, 0.077, -0.66, 'bore', 0, 0, 0.6),
      bore(0.0058, 0.065, -0.6685),
      // Guard, wood grip and stock with butt plate.
      ...guard(-0.1, -0.02, 0.022, -0.006, 'steel', 0.012),
      prof([[-0.01, 0.02], [0.03, 0.02], [0.034, 0.006], [0.06, -0.085], [0.055, -0.092], [0.02, -0.092], [0.016, -0.082],
        [-0.012, 0.0]], 0.03, 'woodL', { bevel: 0.005 }),
      prof([[0.13, 0.034], [0.13, 0.084], [0.16, 0.086], [0.35, 0.062], [0.366, 0.062], [0.366, -0.07], [0.352, -0.073],
        [0.2, 0.0], [0.15, 0.026]], 0.04, 'wood', { bevel: 0.007 }),
      box(0.04, 0.138, 0.008, 0, -0.004, 0.37, 'steel'),
    ],
    mag: [prof([[-0.175, 0.028], [-0.105, 0.028], [-0.106, -0.02], [-0.12, -0.08], [-0.145, -0.13], [-0.175, -0.17],
      [-0.24, -0.14], [-0.208, -0.1], [-0.188, -0.055], [-0.178, -0.01]], 0.028, 'steel', { bevel: 0.003 }),
      box(0.0285, 0.004, 0.05, 0, -0.06, -0.15, 'dark', 0.4)],
    magDir: [0, -0.95, -0.3],
    muzzle: [0, 0.065, -0.67], fore: [0, 0.025, -0.3], hold: 'rifle', eject: [0.03, 0.09, -0.05],
  }),
  m4a1: () => ({
    parts: [
      // Upper with carry handle, ejection port cover and forward assist.
      prof([[-0.17, 0.04], [-0.17, 0.09], [0.08, 0.09], [0.09, 0.082], [0.09, 0.04]], 0.042, 'dark', { bevel: 0.004 }),
      prof([[-0.12, 0.09], [-0.11, 0.128], [0.05, 0.128], [0.068, 0.12], [0.075, 0.09]], 0.026, 'dark', {
        holes: [[[-0.095, 0.096], [-0.09, 0.112], [0.03, 0.112], [0.042, 0.096]]], bevel: 0.003,
      }),
      box(0.012, 0.016, 0.018, 0, 0.136, 0.05, 'dark'),
      xcyl(0.011, 0.03, 0, 0.122, 0.04, 'dark', 10),
      box(0.002, 0.018, 0.052, 0.022, 0.066, -0.02, 'steel'),
      cyl(0.007, 0.02, 0.026, 0.075, 0.05, 'metal', 10),
      box(0.012, 0.008, 0.012, 0, 0.096, 0.088, 'dark'),
      // Lower with mag well, mag release and bolt catch.
      prof([[-0.17, 0.042], [0.09, 0.042], [0.09, 0.01], [0.06, 0.0], [0.02, 0.0], [-0.02, 0.008], [-0.09, 0.008], [-0.1, -0.005],
        [-0.165, -0.005], [-0.17, 0.01]], 0.04, 'dark', { bevel: 0.003 }),
      box(0.005, 0.01, 0.01, 0.022, 0.025, -0.09, 'metal'),
      box(0.004, 0.018, 0.012, -0.022, 0.035, -0.08, 'metal'),
      box(0.003, 0.006, 0.016, -0.0215, 0.028, 0.03, 'metal'),
      // Ribbed round handguard with the delta ring.
      lathe([[0.022, -0.4], [0.0255, -0.396], [0.0255, -0.37], [0.024, -0.365], [0.0255, -0.36], [0.0255, -0.32], [0.024, -0.315],
        [0.0255, -0.31], [0.0255, -0.27], [0.024, -0.265], [0.0255, -0.26], [0.0255, -0.22], [0.024, -0.215], [0.0255, -0.21],
        [0.0255, -0.195], [0.031, -0.19], [0.031, -0.17]], 0, 0.06, 'poly', 14),
      ...grooves(4, 0.05, 0.052, 0.005, 0.016, 0, 0.06, -0.37, 'black'),
      // Barrel, A-frame front sight, flash hider.
      lathe([[0.0085, -0.56], [0.0085, -0.47], [0.011, -0.465], [0.011, -0.4]], 0, 0.06, 'steel', 12),
      prof([[-0.47, 0.045], [-0.47, 0.072], [-0.463, 0.122], [-0.452, 0.122], [-0.442, 0.08], [-0.432, 0.07], [-0.432, 0.045]], 0.024, 'dark', {
        holes: [[[-0.462, 0.084], [-0.458, 0.112], [-0.455, 0.112], [-0.448, 0.084]]],
      }),
      box(0.003, 0.016, 0.012, 0.01, 0.126, -0.457, 'dark'), box(0.003, 0.016, 0.012, -0.01, 0.126, -0.457, 'dark'),
      box(0.0025, 0.012, 0.0025, 0, 0.122, -0.457, 'black'),
      lathe([[0.0105, -0.6], [0.012, -0.597], [0.012, -0.565], [0.009, -0.56]], 0, 0.06, 'steel', 12),
      ...slots(5, 0.0125, 0, 0.06, -0.586, 0.02),
      bore(0.0058, 0.06, -0.601),
      // Grip, guard, buffer tube and collapsible stock.
      pistolGrip(-0.016, 0.008, 'poly', 0.03),
      prof([[-0.09, 0.009], [-0.09, -0.012], [-0.082, -0.018], [-0.016, -0.018], [-0.016, 0.009]], 0.012, 'dark', {
        holes: [[[-0.083, 0.008], [-0.083, -0.008], [-0.077, -0.012], [-0.022, -0.012], [-0.022, 0.008]]],
      }),
      prof([[-0.044, 0.006], [-0.039, 0.006], [-0.042, -0.002], [-0.05, -0.008], [-0.052, -0.005], [-0.047, 0.0]], 0.006, 'metal', { bevel: 0.001 }),
      cyl(0.0165, 0.12, 0, 0.068, 0.15, 'dark', 12),
      prof([[0.14, 0.05], [0.14, 0.095], [0.27, 0.095], [0.28, 0.104], [0.29, 0.104], [0.29, -0.025], [0.275, -0.025], [0.2, 0.03],
        [0.16, 0.04]], 0.04, 'poly', { holes: [[[0.17, 0.05], [0.25, 0.05], [0.25, 0.03], [0.21, 0.04]]], bevel: 0.004 }),
      box(0.04, 0.124, 0.01, 0, 0.04, 0.294, 'rubber'),
    ],
    mag: [prof([[-0.163, 0.0], [-0.104, 0.0], [-0.106, -0.06], [-0.115, -0.122], [-0.176, -0.122], [-0.167, -0.06]], 0.024, 'steel', { bevel: 0.003 }),
      ...grooves(3, -0.03, 0.025, 0.003, 0.05, 0, -0.03, -0.138, 'dark', 'y')],
    magDir: [0, -0.99, -0.12],
    muzzle: [0, 0.06, -0.61], fore: [0, 0.025, -0.3], hold: 'rifle', eject: [0.03, 0.08, -0.03],
  }),
  awp: () => ({
    parts: [
      // Thumbhole stock with cheek piece.
      prof([[-0.43, 0.03], [-0.43, 0.068], [-0.42, 0.076], [0.08, 0.076], [0.12, 0.09], [0.2, 0.116], [0.44, 0.116], [0.47, 0.105],
        [0.475, -0.1], [0.46, -0.11], [0.42, -0.11], [0.24, -0.03], [0.05, -0.105], [0.012, -0.1], [0.0, -0.08], [-0.015, -0.02],
        [-0.02, 0.0], [-0.07, 0.0], [-0.075, 0.008], [-0.15, 0.008], [-0.16, 0.03]], 0.05, 'green', {
        holes: [[[0.04, 0.05], [0.19, 0.072], [0.21, 0.042], [0.21, -0.02], [0.06, -0.085], [0.035, -0.07], [0.03, 0.0]]],
        bevel: 0.008,
      }),
      box(0.0505, 0.004, 0.24, 0, 0.05, -0.28, 'black'),
      box(0.056, 0.22, 0.014, 0, 0.003, 0.48, 'rubber'),
      // Round action, bolt handle, bolt shroud.
      lathe([[0.016, -0.16], [0.021, -0.155], [0.021, 0.1], [0.018, 0.11]], 0, 0.085, 'steel', 14),
      box(0.003, 0.016, 0.06, 0.02, 0.09, -0.02, 'bore'),
      xcyl(0.0045, 0.045, 0.035, 0.08, 0.07, 'metal', 8),
      ycyl(0.009, 0.014, 0.058, 0.08, 0.07, 'metal', 10),
      lathe([[0.012, 0.105], [0.014, 0.11], [0.014, 0.13], [0.008, 0.135]], 0, 0.085, 'steel', 12),
      // Long barrel with muzzle brake.
      lathe([[0.0105, -0.775], [0.0105, -0.7], [0.014, -0.25], [0.016, -0.16]], 0, 0.085, 'dark', 14),
      lathe([[0.015, -0.84], [0.018, -0.835], [0.018, -0.78], [0.0105, -0.775]], 0, 0.085, 'steel', 12),
      box(0.038, 0.008, 0.012, 0, 0.085, -0.81, 'bore'), box(0.038, 0.008, 0.008, 0, 0.085, -0.795, 'bore'),
      bore(0.0062, 0.085, -0.841),
      // Scope, rings and turrets.
      lathe([[0.024, -0.262], [0.031, -0.255], [0.031, -0.205], [0.018, -0.175], [0.0175, 0.06], [0.021, 0.08], [0.023, 0.14],
        [0.02, 0.146]], 0, 0.152, 'black', 16),
      cyl(0.027, 0.002, 0, 0.152, -0.259, 'glass', 14), cyl(0.019, 0.002, 0, 0.152, 0.144, 'glass', 12),
      ycyl(0.011, 0.024, 0, 0.18, -0.05, 'black', 12), xcyl(0.011, 0.024, 0.028, 0.152, -0.05, 'black', 12),
      lathe([[0.0205, -0.13], [0.0205, -0.11]], 0, 0.152, 'steel', 14), lathe([[0.0205, 0.02], [0.0205, 0.04]], 0, 0.152, 'steel', 14),
      box(0.016, 0.03, 0.02, 0, 0.118, -0.12, 'steel'), box(0.016, 0.03, 0.02, 0, 0.118, 0.03, 'steel'),
      // Guard.
      ...guard(-0.07, -0.016, 0.004, -0.03, 'steel', 0.012),
    ],
    mag: [box(0.032, 0.06, 0.07, 0, 0.0, -0.11, 'black'), box(0.036, 0.008, 0.074, 0, -0.03, -0.11, 'steel')],
    magDir: [0, -1, 0],
    muzzle: [0, 0.085, -0.85], fore: [0, 0.02, -0.3], hold: 'rifle', scope: true, eject: [0.03, 0.09, 0.0],
  }),
  minigun: () => {
    const spin = [];
    const R = 0.035;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      spin.push(cyl(0.011, 0.55, Math.cos(a) * R, Math.sin(a) * R, -0.3, 'steel', 8));
      spin.push(cyl(0.0065, 0.002, Math.cos(a) * R, Math.sin(a) * R, -0.576, 'bore', 8));
    }
    spin.push(lathe([[0.05, -0.215], [0.052, -0.21], [0.052, -0.19], [0.05, -0.185]], 0, 0, 'metal', 14));
    spin.push(lathe([[0.05, -0.515], [0.052, -0.51], [0.052, -0.49], [0.05, -0.485]], 0, 0, 'metal', 14));
    spin.push(lathe([[0.048, -0.57], [0.05, -0.565], [0.05, -0.55], [0.048, -0.545]], 0, 0, 'steel', 14));
    spin.push(cyl(0.012, 0.5, 0, 0, -0.3, 'dark', 8));
    return {
      parts: [
        // Rotor housing, motor and feed.
        lathe([[0.056, -0.15], [0.066, -0.14], [0.066, 0.04], [0.06, 0.06], [0.04, 0.07]], 0, 0.05, 'dark', 16),
        ...grooves(4, 0.04, 0.134, 0.004, 0.006, 0, 0.05, -0.12, 'steel'),
        prof([[0.05, -0.01], [0.05, 0.11], [0.2, 0.11], [0.21, 0.1], [0.21, 0.0], [0.2, -0.01]], 0.09, 'steel', { bevel: 0.006 }),
        // Top carry handle (left hand) and rear spade grip.
        box(0.014, 0.05, 0.016, 0, 0.115, -0.06, 'steel'), box(0.014, 0.05, 0.016, 0, 0.115, 0.06, 'steel'),
        cyl(0.012, 0.16, 0, 0.16, 0.0, 'black', 10),
        box(0.034, 0.1, 0.045, 0, -0.04, 0.14, 'black', -0.2),
        ...grooves(4, -0.02, 0.035, 0.003, 0.046, 0, -0.01, 0.135, 'rubber', 'y'),
        box(0.012, 0.02, 0.012, 0, 0.0, 0.1, 'red'),
        // Feed chute from the ammo box.
        box(0.05, 0.03, 0.05, -0.065, 0.02, 0.0, 'olive', 0, 0, 0.5),
        box(0.04, 0.026, 0.04, -0.048, 0.04, -0.02, 'olive', 0, 0, 0.9),
      ],
      mag: [box(0.09, 0.13, 0.15, -0.1, -0.02, 0.06, 'olive'), box(0.094, 0.012, 0.154, -0.1, 0.05, 0.06, 'olive'),
        box(0.02, 0.02, 0.004, -0.1, 0.0, -0.016, 'steel'), box(0.004, 0.06, 0.06, -0.147, -0.02, 0.06, 'black')],
      magDir: [-0.3, -0.95, 0],
      spin, spinCenter: [0, 0.05, -0.12],
      muzzle: [0, 0.05, -0.72], fore: [0, 0.16, 0.0], gripPoint: [0, -0.02, 0.14], hold: 'heavy', eject: [0.06, 0.02, 0.0],
    };
  },
};

// Knife: rubber grip with finger grooves, steel guard, clip-point blade with
// a ground edge and a fuller. Not in the shop; drawn in hand and in the kill
// feed only.
SPECS.knife = () => ({
  parts: [
    prof([[-0.058, -0.016], [-0.058, 0.018], [0.05, 0.018], [0.1, 0.016], [0.112, 0.01], [0.112, -0.012], [0.1, -0.018],
      [0.07, -0.014], [0.05, -0.021], [0.03, -0.014], [0.01, -0.021], [-0.01, -0.014], [-0.03, -0.021], [-0.045, -0.014]], 0.026, 'rubber', { bevel: 0.005 }),
    box(0.028, 0.03, 0.008, 0, 0.0, 0.116, 'steel'),
    prof([[-0.066, -0.028], [-0.058, -0.028], [-0.058, 0.034], [-0.066, 0.034]], 0.032, 'steel', { bevel: 0.002 }),
    prof([[-0.062, 0.021], [-0.18, 0.021], [-0.205, 0.017], [-0.245, -0.001], [-0.225, -0.009], [-0.19, -0.014], [-0.1, -0.016],
      [-0.07, -0.014], [-0.062, -0.008]], 0.0055, 'silver', { bevel: 0.0015 }),
    prof([[-0.075, -0.004], [-0.19, -0.004], [-0.236, 0.0], [-0.225, -0.008], [-0.19, -0.013], [-0.1, -0.015], [-0.075, -0.013]], 0.0062, 'chrome', { bevel: 0.0008 }),
    box(0.0058, 0.004, 0.08, 0, 0.012, -0.12, 'steel'),
    box(0.0072, 0.003, 0.12, 0, 0.022, -0.12, 'metal'),
  ],
  muzzle: [0, 0, -0.24], fore: [-0.16, -0.32, 0.12], hold: 'knife', eject: [0, 0, 0],
});

// HE grenade: round olive body with a band, the fuse on top, the spoon down
// the side and the pin's ring. Held in the right hand.
SPECS.hegrenade = () => ({
  parts: [
    latheY([[0.004, -0.004], [0.018, -0.002], [0.027, 0.01], [0.032, 0.03], [0.031, 0.045], [0.026, 0.06], [0.017, 0.068], [0.012, 0.07]], 0, 0, 0, 'olive', 14),
    latheY([[0.0328, 0.026], [0.0328, 0.038]], 0, 0, 0, 'green', 14),
    ycyl(0.015, 0.022, 0, 0.08, 0, 'metal', 10),
    ycyl(0.011, 0.01, 0, 0.095, 0, 'silver', 10),
    prof([[0.012, 0.096], [0.02, 0.094], [0.032, 0.07], [0.038, 0.04], [0.036, 0.012], [0.031, 0.012], [0.033, 0.04],
      [0.027, 0.068], [0.017, 0.088], [0.012, 0.09]], 0.013, 'metal', { bevel: 0.001 }),
    box(0.02, 0.003, 0.004, 0.014, 0.088, 0, 'silver'),
    torus(0.014, 0.0028, 0.027, 0.088, 0, 'silver', 0, Math.PI / 2),
  ],
  muzzle: [0, 0.05, -0.05], fore: [-0.16, -0.32, 0.12], gripPoint: [0.012, 0.03, 0.03], hold: 'grenade', eject: [0, 0, 0],
  ring: [0.027, 0.088, 0],
});

// Phong with the shine attribute as specular strength, plus a cheap sky
// reflection on shiny parts so metal reads as metal without an env map.
let sharedMaterial = null;
export function gunMaterial() {
  if (sharedMaterial) return sharedMaterial;
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 42, specular: 0x9a9a9a });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float spec;\nvarying float vSpec;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpec = spec;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSpec;')
      .replace('#include <specularmap_fragment>', 'float specularStrength = vSpec;')
      .replace('#include <opaque_fragment>', `{
        vec3 vdir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        vec3 rw = inverseTransformDirection(reflect(-vdir, normal), viewMatrix);
        float fr = 0.3 + 0.7 * pow(1.0 - saturate(dot(normal, vdir)), 2.0);
        outgoingLight += vSpec * fr * 0.2 * mix(vec3(0.16, 0.14, 0.12), vec3(0.85, 0.9, 1.0), smoothstep(-0.25, 0.7, rw.y));
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'gun-shine-1';
  sharedMaterial = m;
  return m;
}

const geoCache = new Map();
// Third-person guns skip parts too small to see at a distance (grooves,
// pins, sight dots), which roughly halves their triangles.
function bigEnough(g) {
  g.computeBoundingBox();
  const s = g.boundingBox.getSize(_p);
  const d = [s.x, s.y, s.z].sort((a, b) => a - b);
  return d[1] >= 0.008;
}
function merge(parts, lod) {
  const list = lod ? parts.filter(bigEnough) : parts;
  return mergeGeometries(list.length ? list : parts);
}

// Returns { group, spin, mag, magHome, magDir, muzzle, fore, grip, eject, spec }.
// lod: true builds the lighter third-person version.
export function buildGun(id, lod = false) {
  const key = lod ? id + ':lod' : id;
  let cached = geoCache.get(key);
  if (!cached) {
    LOD = lod;
    const spec = SPECS[id]();
    LOD = false;
    const geo = merge(spec.parts, lod);
    const spinGeo = spec.spin ? merge(spec.spin, lod) : null;
    const magGeo = spec.mag ? merge(spec.mag, lod) : null;
    let magCenter = null;
    if (magGeo) {
      magGeo.computeBoundingBox();
      magCenter = magGeo.boundingBox.getCenter(new THREE.Vector3());
    }
    cached = { spec, geo, spinGeo, magGeo, magCenter };
    geoCache.set(key, cached);
  }
  const { spec, geo, spinGeo, magGeo, magCenter } = cached;
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, gunMaterial());
  group.add(mesh);
  let spin = null;
  if (spinGeo) {
    spin = new THREE.Mesh(spinGeo, gunMaterial());
    spin.position.set(...spec.spinCenter);
    group.add(spin);
  }
  // The magazine is its own mesh under a pivot at its center, so the reload
  // animation can pull it out.
  let mag = null;
  if (magGeo) {
    mag = new THREE.Group();
    mag.position.copy(magCenter);
    const m = new THREE.Mesh(magGeo, gunMaterial());
    m.position.copy(magCenter).negate();
    mag.add(m);
    group.add(mag);
  }
  return {
    group, spin, spec, mag,
    magHome: magCenter ? magCenter.clone() : null,
    magDir: spec.magDir ? new THREE.Vector3(...spec.magDir).normalize() : null,
    muzzle: new THREE.Vector3(...spec.muzzle),
    fore: new THREE.Vector3(...spec.fore),
    grip: new THREE.Vector3(...(spec.gripPoint ?? [0, -0.01, 0.0])),
    eject: new THREE.Vector3(...(spec.eject ?? [0.03, 0.07, -0.05])),
  };
}

export const GUN_IDS = Object.keys(SPECS);
