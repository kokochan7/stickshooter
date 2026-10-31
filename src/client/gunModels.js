// Procedural low-poly guns. Each gun is one merged mesh with vertex colors
// (one draw call). Gun space: barrel along -Z, up is +Y, origin at the grip.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const DARK = 0x2b2f36, BLACK = 0x1c1e22, METAL = 0x4b525c, WOOD = 0x8b5a2b, WOODL = 0xa66a33,
  SILVER = 0xbfc4cc, GREEN = 0x4f6b3c, OLIVE = 0x5b6338, TAN = 0xc7ad7c, GUNMETAL = 0x3a4048;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();

function colorize(geo, hex) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.setHex(hex);
  const pos = geo.attributes.position.array;
  for (let i = 0; i < n; i++) {
    // Slightly darker underside for some shape definition.
    const shade = pos[i * 3 + 1] < 0 ? 0.82 : 1;
    arr[i * 3] = _c.r * shade; arr[i * 3 + 1] = _c.g * shade; arr[i * 3 + 2] = _c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(_m);
  return geo;
}

// Box part: size w,h,d at x,y,z, optional rotation around X.
function B(w, h, d, x, y, z, color, rx = 0, rz = 0) {
  const g = colorize(new THREE.BoxGeometry(w, h, d), color);
  return place(g, x, y, z, rx, 0, rz);
}
// Cylinder along Z.
function C(r, len, x, y, z, color, segs = 8) {
  const g = colorize(new THREE.CylinderGeometry(r, r, len, segs), color);
  g.rotateX(Math.PI / 2);
  return place(g, x, y, z);
}

function grip(z = 0, color = BLACK, angle = -0.25) {
  return B(0.032, 0.1, 0.045, 0, -0.03, z + 0.01, color, angle);
}

const SPECS = {
  usp: () => ({
    parts: [
      B(0.034, 0.038, 0.19, 0, 0.055, -0.07, DARK),
      B(0.03, 0.024, 0.16, 0, 0.026, -0.06, BLACK),
      B(0.032, 0.105, 0.048, 0, -0.03, 0.005, BLACK, -0.25),
      B(0.008, 0.006, 0.05, 0, 0.0, -0.045, BLACK),
      C(0.008, 0.012, 0, 0.058, -0.168, METAL),
      B(0.006, 0.01, 0.008, 0, 0.078, -0.155, BLACK),
      B(0.02, 0.01, 0.008, 0, 0.078, 0.015, BLACK),
    ],
    mag: [B(0.024, 0.1, 0.036, 0, -0.04, 0.008, METAL, -0.25)], magDir: [0, -0.97, 0.25],
    muzzle: [0, 0.058, -0.18], fore: [-0.02, -0.035, 0.01], hold: 'pistol', eject: [0.02, 0.06, -0.04],
  }),
  deagle: () => ({
    parts: [
      B(0.04, 0.05, 0.26, 0, 0.062, -0.09, SILVER),
      B(0.034, 0.03, 0.2, 0, 0.025, -0.08, GUNMETAL),
      C(0.012, 0.02, 0, 0.065, -0.225, METAL),
      B(0.036, 0.11, 0.052, 0, -0.032, 0.005, BLACK, -0.2),
      B(0.008, 0.006, 0.05, 0, -0.002, -0.05, BLACK),
      B(0.008, 0.012, 0.01, 0, 0.093, -0.205, BLACK),
      B(0.026, 0.012, 0.01, 0, 0.093, 0.02, BLACK),
    ],
    mag: [B(0.028, 0.105, 0.04, 0, -0.04, 0.008, METAL, -0.2)], magDir: [0, -0.98, 0.2],
    muzzle: [0, 0.065, -0.24], fore: [-0.02, -0.04, 0.012], hold: 'pistol', eject: [0.02, 0.07, -0.06],
  }),
  uzi: () => ({
    parts: [
      B(0.05, 0.075, 0.24, 0, 0.05, -0.08, DARK),
      B(0.046, 0.016, 0.2, 0, 0.094, -0.08, METAL),
      C(0.01, 0.06, 0, 0.055, -0.225, METAL),
      B(0.034, 0.2, 0.044, 0, -0.06, -0.01, BLACK, -0.05),
      B(0.01, 0.01, 0.18, 0.02, 0.035, 0.11, METAL),
      B(0.01, 0.01, 0.18, -0.02, 0.035, 0.11, METAL),
      B(0.05, 0.05, 0.012, 0, 0.03, 0.2, METAL),
    ],
    mag: [B(0.028, 0.2, 0.036, 0, -0.07, -0.01, METAL, -0.05)], magDir: [0, -1, 0.05],
    muzzle: [0, 0.055, -0.26], fore: [0, 0.03, -0.16], hold: 'rifle', eject: [0.03, 0.08, -0.06],
  }),
  mp5: () => ({
    parts: [
      B(0.05, 0.065, 0.3, 0, 0.06, -0.1, DARK),
      B(0.058, 0.056, 0.14, 0, 0.046, -0.3, BLACK),
      C(0.012, 0.08, 0, 0.06, -0.41, METAL),
      B(0.01, 0.035, 0.01, 0, 0.1, -0.37, BLACK),
      C(0.02, 0.03, 0, 0.105, 0.0, BLACK),
      grip(),
      B(0.036, 0.055, 0.2, 0, 0.046, 0.14, BLACK),
      B(0.04, 0.11, 0.022, 0, 0.03, 0.245, BLACK),
    ],
    mag: [B(0.028, 0.17, 0.05, 0, -0.05, -0.19, BLACK, 0.28)], magDir: [0, -0.96, -0.28],
    muzzle: [0, 0.06, -0.45], fore: [0, 0.015, -0.3], hold: 'rifle', eject: [0.03, 0.07, -0.08],
  }),
  ump45: () => ({
    parts: [
      B(0.056, 0.08, 0.34, 0, 0.06, -0.1, GUNMETAL),
      B(0.03, 0.012, 0.3, 0, 0.106, -0.1, BLACK),
      C(0.013, 0.06, 0, 0.06, -0.3, METAL),
      grip(),
      B(0.03, 0.05, 0.22, 0, 0.05, 0.17, BLACK),
      B(0.036, 0.1, 0.025, 0, 0.03, 0.28, BLACK),
    ],
    mag: [B(0.03, 0.16, 0.055, 0, -0.05, -0.18, BLACK, 0.1)], magDir: [0, -1, -0.1],
    muzzle: [0, 0.06, -0.335], fore: [0, 0.012, -0.24], hold: 'rifle', eject: [0.03, 0.08, -0.06],
  }),
  p90: () => ({
    parts: [
      B(0.06, 0.1, 0.46, 0, 0.035, -0.06, BLACK),
      B(0.062, 0.07, 0.07, 0, 0.03, -0.31, DARK),
      C(0.012, 0.05, 0, 0.05, -0.37, METAL),
      B(0.03, 0.035, 0.08, 0, 0.13, -0.08, DARK),
      B(0.034, 0.09, 0.04, 0, -0.05, 0.0, BLACK, -0.15),
      B(0.034, 0.03, 0.12, 0, -0.08, -0.05, BLACK),
    ],
    mag: [B(0.05, 0.03, 0.32, 0, 0.1, -0.12, TAN)], magDir: [-0.3, 0.9, 0.3],
    muzzle: [0, 0.05, -0.4], fore: [0, -0.03, -0.2], hold: 'rifle', eject: [0, -0.02, 0.1],
  }),
  shotgun: () => ({
    parts: [
      B(0.05, 0.07, 0.2, 0, 0.05, -0.05, DARK),
      C(0.016, 0.5, 0, 0.075, -0.4, METAL),
      C(0.013, 0.4, 0, 0.044, -0.35, DARK),
      B(0.052, 0.046, 0.16, 0, 0.044, -0.32, WOOD),
      B(0.04, 0.08, 0.3, 0, 0.015, 0.18, WOOD, -0.12),
      B(0.034, 0.06, 0.06, 0, -0.01, 0.03, WOOD, -0.4),
      B(0.006, 0.01, 0.006, 0, 0.095, -0.64, SILVER),
    ],
    muzzle: [0, 0.075, -0.66], fore: [0, 0.02, -0.32], hold: 'rifle', pump: true, eject: [0.03, 0.06, -0.08],
  }),
  autoshotgun: () => ({
    parts: [
      B(0.052, 0.075, 0.24, 0, 0.05, -0.06, BLACK),
      B(0.03, 0.012, 0.22, 0, 0.094, -0.06, METAL),
      C(0.016, 0.44, 0, 0.075, -0.4, DARK),
      C(0.014, 0.36, 0, 0.044, -0.34, BLACK),
      B(0.052, 0.05, 0.14, 0, 0.046, -0.28, DARK),
      grip(),
      B(0.03, 0.05, 0.24, 0, 0.04, 0.17, BLACK),
      B(0.04, 0.11, 0.025, 0, 0.02, 0.29, BLACK),
    ],
    muzzle: [0, 0.075, -0.62], fore: [0, 0.02, -0.28], hold: 'rifle', eject: [0.03, 0.07, -0.08],
  }),
  famas: () => ({
    parts: [
      B(0.055, 0.1, 0.55, 0, 0.03, -0.03, GUNMETAL),
      B(0.024, 0.02, 0.36, 0, 0.14, -0.08, BLACK),
      B(0.024, 0.06, 0.02, 0, 0.1, -0.25, BLACK),
      B(0.024, 0.06, 0.02, 0, 0.1, 0.09, BLACK),
      C(0.012, 0.14, 0, 0.05, -0.37, METAL),
      grip(-0.02),
      B(0.05, 0.05, 0.2, 0, -0.03, -0.2, DARK),
    ],
    mag: [B(0.03, 0.13, 0.06, 0, -0.07, 0.12, BLACK, 0.15)], magDir: [0, -0.99, -0.15],
    muzzle: [0, 0.05, -0.45], fore: [0, -0.01, -0.22], hold: 'rifle', eject: [0.03, 0.05, 0.1],
  }),
  ak47: () => ({
    parts: [
      B(0.05, 0.07, 0.3, 0, 0.055, -0.05, METAL),
      B(0.046, 0.022, 0.26, 0, 0.096, -0.05, DARK),
      B(0.056, 0.05, 0.18, 0, 0.05, -0.3, WOOD),
      B(0.04, 0.03, 0.16, 0, 0.092, -0.3, WOOD),
      C(0.011, 0.26, 0, 0.065, -0.5, DARK),
      B(0.01, 0.045, 0.012, 0, 0.09, -0.58, DARK),
      C(0.015, 0.04, 0, 0.065, -0.64, DARK),
      B(0.042, 0.085, 0.28, 0, 0.02, 0.22, WOOD, -0.1),
      grip(0, WOODL),
    ],
    mag: [B(0.03, 0.12, 0.06, 0, -0.025, -0.15, DARK, 0.22), B(0.03, 0.1, 0.06, 0, -0.12, -0.19, DARK, 0.5)], magDir: [0, -0.95, -0.3],
    muzzle: [0, 0.065, -0.67], fore: [0, 0.025, -0.3], hold: 'rifle', eject: [0.03, 0.09, -0.08],
  }),
  m4a1: () => ({
    parts: [
      B(0.048, 0.075, 0.28, 0, 0.055, -0.05, BLACK),
      B(0.02, 0.04, 0.14, 0, 0.11, -0.05, BLACK),
      C(0.027, 0.2, 0, 0.06, -0.29, BLACK),
      C(0.009, 0.2, 0, 0.06, -0.47, DARK),
      B(0.01, 0.06, 0.015, 0, 0.1, -0.39, BLACK),
      C(0.012, 0.04, 0, 0.06, -0.585, DARK),
      grip(),
      C(0.017, 0.12, 0, 0.06, 0.13, BLACK),
      B(0.04, 0.075, 0.14, 0, 0.04, 0.21, BLACK),
    ],
    mag: [B(0.028, 0.15, 0.065, 0, -0.04, -0.14, DARK, 0.12)], magDir: [0, -0.99, -0.12],
    muzzle: [0, 0.06, -0.61], fore: [0, 0.025, -0.3], hold: 'rifle', eject: [0.03, 0.08, -0.06],
  }),
  awp: () => ({
    parts: [
      B(0.056, 0.075, 0.5, 0, 0.05, -0.05, GREEN),
      B(0.046, 0.12, 0.3, 0, 0.02, 0.32, GREEN),
      B(0.03, 0.03, 0.18, 0, 0.1, 0.3, GREEN),
      C(0.012, 0.45, 0, 0.065, -0.52, DARK),
      C(0.018, 0.05, 0, 0.065, -0.77, DARK),
      C(0.024, 0.3, 0, 0.14, -0.05, BLACK, 10),
      C(0.032, 0.06, 0, 0.14, -0.22, BLACK, 10),
      C(0.03, 0.05, 0, 0.14, 0.12, BLACK, 10),
      B(0.02, 0.05, 0.02, 0, 0.105, -0.13, BLACK),
      B(0.02, 0.05, 0.02, 0, 0.105, 0.04, BLACK),
      B(0.05, 0.012, 0.012, 0.045, 0.07, 0.06, METAL),
      grip(0, GREEN),
    ],
    mag: [B(0.034, 0.06, 0.07, 0, -0.01, -0.13, BLACK)], magDir: [0, -1, 0],
    muzzle: [0, 0.065, -0.8], fore: [0, 0.0, -0.32], hold: 'rifle', scope: true, eject: [0.03, 0.08, 0.04],
  }),
  minigun: () => {
    const spin = [];
    const R = 0.035;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      spin.push(C(0.011, 0.55, Math.cos(a) * R, Math.sin(a) * R, -0.3, DARK, 6));
    }
    spin.push(C(0.052, 0.025, 0, 0, -0.2, GUNMETAL, 10));
    spin.push(C(0.052, 0.025, 0, 0, -0.5, GUNMETAL, 10));
    return {
      parts: [
        C(0.065, 0.24, 0, 0.05, -0.02, DARK, 10),
        B(0.09, 0.09, 0.14, 0, 0.05, 0.14, BLACK),
        B(0.024, 0.07, 0.2, 0, 0.14, 0.02, GUNMETAL),
          B(0.034, 0.1, 0.045, 0, -0.04, 0.14, BLACK, -0.2),
      ],
      mag: [B(0.09, 0.13, 0.15, -0.1, -0.02, 0.06, OLIVE)], magDir: [-0.3, -0.95, 0],
      spin, spinCenter: [0, 0.05, -0.12],
      muzzle: [0, 0.05, -0.72], fore: [0, 0.16, 0.0], gripPoint: [0, -0.02, 0.14], hold: 'heavy', eject: [0.06, 0.02, 0.0],
    };
  },
};

let sharedMaterial = null;
export function gunMaterial() {
  sharedMaterial ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return sharedMaterial;
}

const geoCache = new Map();

// Returns { group, spin, mag, magHome, magDir, muzzle, fore, grip, eject, spec }
export function buildGun(id) {
  let cached = geoCache.get(id);
  if (!cached) {
    const spec = SPECS[id]();
    const geo = mergeGeometries(spec.parts.map((g) => g.toNonIndexed()));
    const spinGeo = spec.spin ? mergeGeometries(spec.spin.map((g) => g.toNonIndexed())) : null;
    const magGeo = spec.mag ? mergeGeometries(spec.mag.map((g) => g.toNonIndexed())) : null;
    let magCenter = null;
    if (magGeo) {
      magGeo.computeBoundingBox();
      magCenter = magGeo.boundingBox.getCenter(new THREE.Vector3());
    }
    cached = { spec, geo, spinGeo, magGeo, magCenter };
    geoCache.set(id, cached);
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
