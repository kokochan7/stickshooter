// Static collision world made of axis-aligned boxes. Pure data + math, no
// rendering, so the same code can run on a server.

// How each surface treats bullets (CS 1.6 FireBullets3 texture types).
// powerMul scales the bullet's penetration power, damageMul scales damage after
// passing through.
export const MATERIALS = {
  concrete: { powerMul: 0.25, damageMul: 0.5 },
  wood: { powerMul: 1.0, damageMul: 0.6 },
  metal: { powerMul: 0.15, damageMul: 0.2 },
  grate: { powerMul: 0.5, damageMul: 0.4 },
  tile: { powerMul: 0.65, damageMul: 0.2 },
  foliage: { powerMul: 4, damageMul: 0.9 }, // pine and palm leaves
};

const EPS = 1e-4;

export class World {
  constructor(boxes) {
    // box: { min: [x,y,z], max: [x,y,z], material, color, render }
    this.boxes = boxes.map((b, i) => ({ ...b, id: i }));
  }

  // Any box overlapping the AABB [min, max]?
  overlaps(minX, minY, minZ, maxX, maxY, maxZ) {
    for (const b of this.boxes) {
      if (minX < b.max[0] - EPS && maxX > b.min[0] + EPS &&
          minY < b.max[1] - EPS && maxY > b.min[1] + EPS &&
          minZ < b.max[2] - EPS && maxZ > b.min[2] + EPS) return b;
    }
    return null;
  }

  // All boxes overlapping the AABB.
  overlapping(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    out.length = 0;
    for (const b of this.boxes) {
      if (minX < b.max[0] - EPS && maxX > b.min[0] + EPS &&
          minY < b.max[1] - EPS && maxY > b.min[1] + EPS &&
          minZ < b.max[2] - EPS && maxZ > b.min[2] + EPS) out.push(b);
    }
    return out;
  }

  pointInside(x, y, z) {
    const out = [];
    for (const b of this.boxes) {
      if (x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]) out.push(b);
    }
    return out;
  }

  // Nearest box hit along a ray. Returns { t, box, normal } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignore = null) {
    let best = null;
    for (const b of this.boxes) {
      if (b === ignore) continue;
      const h = rayBox(ox, oy, oz, dx, dy, dz, b.min, b.max);
      if (h && h.tEnter >= 0 && h.tEnter <= maxDist && (!best || h.tEnter < best.t)) {
        best = { t: h.tEnter, tExit: h.tExit, box: b, normal: h.normal };
      }
    }
    return best;
  }

  // Starting at a point just inside solid, walk along the ray until we are out
  // of every box (handles walls built from several touching boxes).
  // Returns the distance travelled through solid.
  solidThickness(ox, oy, oz, dx, dy, dz, tStart, maxThickness) {
    let t = tStart;
    for (let iter = 0; iter < 8; iter++) {
      const px = ox + dx * (t + EPS * 10), py = oy + dy * (t + EPS * 10), pz = oz + dz * (t + EPS * 10);
      const inside = this.pointInside(px, py, pz);
      if (inside.length === 0) return t - tStart;
      let exit = t;
      for (const b of inside) {
        const h = rayBox(ox, oy, oz, dx, dy, dz, b.min, b.max);
        if (h && h.tExit > exit) exit = h.tExit;
      }
      if (exit <= t + EPS) return t - tStart;
      t = exit;
      if (t - tStart > maxThickness) return Infinity;
    }
    return t - tStart;
  }

  // Line of sight between two points.
  visible(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len);
  }
}

// Slab test. Returns tEnter/tExit and the entry face normal.
export function rayBox(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (min[a] - o[a]) * inv;
    let t2 = (max[a] - o[a]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const normal = [0, 0, 0];
  if (axis >= 0) normal[axis] = sign;
  return { tEnter: tmin, tExit: tmax, normal };
}
