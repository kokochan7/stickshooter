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

// The lowest surface at (x, z) a player could stand on: the top of a box
// with headroom above it. Crate tops and roofs sit above the real floor, so
// the lowest one is the floor. null if there's nothing under the spot.
export function floorUnder(world, x, z, headroom = 1.0) {
  const d = 0.01;
  let best = null;
  for (const b of world.overlapping(x - d, -50, z - d, x + d, 50, z + d)) {
    const top = b.max[1];
    if (best !== null && top >= best) continue;
    if (world.overlaps(x - d, top + 0.01, z - d, x + d, top + headroom, z + d)) continue;
    best = top;
  }
  return best;
}

// Where a painted zone (a bomb site, a rescue area) goes: the floor height
// most of the rect stands on, and the cells (cell x cell meters) at that
// height, merged into runs along x: [[x0, z0, x1, z1], ...]. Cells under
// walls or crates, over water or on a raised step are left out, so the paint
// lies on the floor instead of floating over it. label: the middle of the
// biggest open patch of floor near the zone's middle, and how far it's clear
// all round (r, capped at maxR), so the big letter isn't hidden under a crate.
export function zoneFloor(world, rect, cell = 0.5, maxR = 4) {
  const [x0, z0] = rect.min, [x1, z1] = rect.max;
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
  const cw = (x1 - x0) / nx, cd = (z1 - z0) / nz;
  const ys = [];
  const count = new Map();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const y = floorUnder(world, x0 + (i + 0.5) * cw, z0 + (j + 0.5) * cd);
      ys.push(y);
      if (y === null) continue;
      const k = Math.round(y * 100);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let mode = 0, n = -1;
  for (const [k, c] of count) if (c > n) { n = c; mode = k; }
  const y = mode / 100;
  const onFloor = (k) => ys[k] !== null && Math.abs(ys[k] - y) < 0.02;
  const cells = [];
  for (let j = 0; j < nz; j++) {
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const on = i < nx && onFloor(j * nx + i);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        cells.push([x0 + start * cw, z0 + j * cd, x0 + i * cw, z0 + (j + 1) * cd]);
        start = -1;
      }
    }
  }

  // Open floor: painted, with nothing standing on it up to chest height.
  const blocked = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + (i + 0.5) * cw, z = z0 + (j + 0.5) * cd;
      if (!onFloor(k) || world.overlaps(x - cw / 2, y + 0.02, z - cd / 2, x + cw / 2, y + 1.2, z + cd / 2)) blocked.push([x, z]);
    }
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let label = { x: cx, z: cz, r: 0 }, best = -Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cw, z = z0 + (j + 0.5) * cd;
      // Clear radius: to the nearest blocked cell or the zone's edge.
      let r = Math.min(maxR, x - x0, x1 - x, z - z0, z1 - z);
      for (const [bx, bz] of blocked) {
        const d = Math.hypot(bx - x, bz - z) - cell * 0.5;
        if (d < r) { r = d; if (r <= 0) break; }
      }
      const score = r - Math.hypot(x - cx, z - cz) * 0.15;
      if (r > 0 && score > best) { best = score; label = { x, z, r }; }
    }
  }
  return { y, cells, label };
}
