// Smooth stickman player look: the stick figure's build with smooth tapered
// limbs, a shaped torso, mitten hands and rounded feet, soft Phong shading
// with a rim light and no black outline. Visual only: bones, IK, poses and
// the sim's hitboxes are unchanged. One tintable material per player, so the
// team color (or the hostage yellow) covers the whole body.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _d = new THREE.Vector3();

// Under the game's bright hemisphere + sun a pure white body blows out to a
// flat shape; this keeps the shading readable while it still reads as white.
export const SUIT_ALBEDO = 0.75;

// ---------- geometry ----------

// A tapered tube along a bone for Limb.set (a unit cylinder spanning
// y -0.5..0.5, scaled by the bone length, with the limb radius set to 1).
// prof: [[s, r], ...], s in metres from the bone's start (it may run past
// 0..L for rounded ends), r the half-width. depth: z radius / x radius.
function tube(prof, L, { depth = 1, sides = 14, rings = 16 } = {}) {
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

// A mitten hand centred on the palm: +y along the forearm, back of the hand
// +z, thumb on +x (a right hand; the left one is mirrored with scale.x = -1).
function mittGeo(s) {
  const palm = new THREE.SphereGeometry(1, 12, 8).scale(0.042, 0.05, 0.03);
  const thumb = capsule([0.035, -0.025, 0], [0.04, 0.015, -0.02], 0.014, 6);
  return merge([palm, thumb]).scale(s, s, s);
}

// ---------- the kit (built once, shared by every player) ----------

const THIGH = 0.47, SHIN = 0.47, UPPER = 0.32, FORE = 0.32, TORSO = 0.5, VM = 0.42;
let kit = null;
export function playerKit() {
  if (kit) return kit;
  kit = {
    torso: tube([[-0.07, 0], [-0.04, 0.07], [0.05, 0.088], [0.3, 0.085], [0.45, 0.095], [0.53, 0.07], [0.56, 0]], TORSO, { depth: 0.85 }),
    neck: tube([[-0.02, 0], [0, 0.045], [0.15, 0.04], [0.17, 0]], 0.15),
    thigh: tube([[-0.06, 0], [-0.03, 0.05], [0.02, 0.058], [0.45, 0.047], [0.5, 0]], THIGH),
    shin: tube([[-0.04, 0], [0, 0.047], [0.15, 0.048], [0.44, 0.036], [0.47, 0]], SHIN),
    upper: tube([[-0.05, 0], [-0.02, 0.046], [0.05, 0.046], [0.3, 0.04], [0.34, 0]], UPPER),
    fore: tube([[-0.03, 0], [0, 0.04], [0.1, 0.04], [0.3, 0.034], [0.32, 0]], FORE),
    hand: mittGeo(1.05),
    // Rounded foot, forward is -z (the foot joint is 4.5 cm up).
    foot: new THREE.SphereGeometry(1, 12, 8).scale(0.06, 0.045, 0.1).translate(0, 0, -0.03),
    head: new THREE.SphereGeometry(1, 24, 18).scale(0.16, 0.168, 0.158),
    eyes: { x: 0.054, y: 0.02, z: -0.146, s: [0.024, 0.046, 0.018] },
    // First-person arms (longer bones in view space).
    vmUpper: tube([[-0.05, 0], [0, 0.034], [0.3, 0.031], [0.44, 0]], VM),
    vmFore: tube([[-0.03, 0], [0, 0.031], [0.3, 0.028], [0.43, 0]], VM),
    vmHand: mittGeo(1.0),
  };
  return kit;
}

// Soft rim light (a lit edge facing away from the camera) so the body reads
// as a rounded form instead of a flat cut-out.
function rimMaterial() {
  const m = new THREE.MeshPhongMaterial({ shininess: 40, specular: 0x2a2a2a });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      { float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
        outgoingLight += rim * 0.25 * vec3(1.0, 0.98, 0.95) * (0.4 + 0.6 * diffuseColor.rgb); }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'player-rim';
  return m;
}

// The player's body material, under every part name asked for (one shared
// material, so a team tint covers the whole body).
export function suitMaterials(parts) {
  const m = rimMaterial();
  return Object.fromEntries(parts.map((p) => [p, m]));
}

export function tintSuit(mats, hex) {
  const c = new THREE.Color(hex).multiplyScalar(SUIT_ALBEDO);
  for (const m of new Set(Object.values(mats))) m.color.copy(c);
}

// Point a hand along its forearm with the palm facing `palm` (same space).
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
