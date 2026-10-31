// Helpers for writing maps out of axis-aligned boxes. Everything stays a box
// so collision, bullets and rendering keep their cheap paths (one merged
// mesh per map). Water is a hole cut in the ground with a riverbed under it
// and a see-through surface drawn on top; it's shallow (WATER_DEPTH) so you
// can wade in and step back out anywhere.

export const WATER_DEPTH = 0.4; // riverbed below ground level (under STEP_HEIGHT)
export const WATER_LEVEL = -0.1; // water surface

export function mapBuilder(palette = {}) {
  const boxes = [];
  const holes = []; // water rects cut out of the ground: [x0, z0, x1, z1]
  const waterRects = []; // { min: [x, z], max: [x, z], y }
  const C = palette;

  const color = (c, mat) => (typeof c === 'number' ? c : C[c] ?? C[mat] ?? 0xcccccc);

  const b = {
    boxes, waterRects, C,

    box(x0, y0, z0, x1, y1, z1, material, col, extra = {}) {
      boxes.push({
        min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
        max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
        material, color: color(col, material), ...extra,
      });
    },

    crate(x, z, size = 1.2, y = 0, col = 'crate') {
      b.box(x - size / 2, y, z - size / 2, x + size / 2, y + size, z + size / 2, 'wood', col, { kind: 'crate' });
    },

    // A stack of crates: big one with a smaller one on top.
    crates(x, z) {
      b.crate(x, z, 1.2);
      b.crate(x + 0.1, z - 0.05, 0.9, 1.2);
    },

    barrel(x, z, col = 'barrel') {
      b.box(x - 0.32, 0, z - 0.32, x + 0.32, 1.0, z + 0.32, 'metal', col, { kind: 'barrel' });
    },

    // Wall along X at depth z..z+t, from x0 to x1, with door gaps [[a, b], ...].
    // Gaps get a lintel when the wall is taller than a door.
    wallX(z, x0, x1, h, t, material, col, gaps = [], door = 2.4) {
      let x = x0;
      for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (g0 > x) b.box(x, 0, z, g0, h, z + t, material, col);
        if (h > door + 0.2) b.box(g0, door, z, g1, h, z + t, material, col);
        x = g1;
      }
      if (x < x1) b.box(x, 0, z, x1, h, z + t, material, col);
    },

    // Wall along Z at x..x+t.
    wallZ(x, z0, z1, h, t, material, col, gaps = [], door = 2.4) {
      let z = z0;
      for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (g0 > z) b.box(x, 0, z, x + t, h, g0, material, col);
        if (h > door + 0.2) b.box(x, door, g0, x + t, h, g1, material, col);
        z = g1;
      }
      if (z < z1) b.box(x, 0, z, x + t, h, z1, material, col);
    },

    // A building: four walls (inside the rect) with doors per side, and an
    // optional roof. doors: { n: [[x0, x1]], s: [...], w: [[z0, z1]], e: [...] }.
    building(x0, z0, x1, z1, h, { material = 'concrete', col = 'wall', t = 0.3, doors = {}, roof = true, roofCol = 'roof', door = 2.4 } = {}) {
      b.wallX(z0, x0, x1, h, t, material, col, doors.n ?? [], door);
      b.wallX(z1 - t, x0, x1, h, t, material, col, doors.s ?? [], door);
      b.wallZ(x0, z0 + t, z1 - t, h, t, material, col, doors.w ?? [], door);
      b.wallZ(x1 - t, z0 + t, z1 - t, h, t, material, col, doors.e ?? [], door);
      if (roof) b.box(x0 - 0.2, h, z0 - 0.2, x1 + 0.2, h + 0.25, z1 + 0.2, material, roofCol);
    },

    // Stairs climbing from y0 to y1 across a rect, rising towards dir
    // ('+x', '-x', '+z', '-z'). Solid blocks from the ground, CS style.
    stairs(x0, z0, x1, z1, dir, y1, steps, material = 'concrete', col = 'step', y0 = 0) {
      for (let i = 0; i < steps; i++) {
        const top = y0 + ((y1 - y0) * (i + 1)) / steps;
        const f0 = i / steps, f1 = (i + 1) / steps;
        let a, c;
        if (dir === '+x') { a = [x0 + (x1 - x0) * f0, z0]; c = [x0 + (x1 - x0) * f1, z1]; }
        else if (dir === '-x') { a = [x1 - (x1 - x0) * f1, z0]; c = [x1 - (x1 - x0) * f0, z1]; }
        else if (dir === '+z') { a = [x0, z0 + (z1 - z0) * f0]; c = [x1, z0 + (z1 - z0) * f1]; }
        else { a = [x0, z1 - (z1 - z0) * f1]; c = [x1, z1 - (z1 - z0) * f0]; }
        b.box(a[0], Math.min(0, y0), a[1], c[0], top, c[1], material, col);
      }
    },

    // Shallow water: cuts the ground and records the surface for drawing,
    // splashing footsteps and wading speed.
    water(x0, z0, x1, z1) {
      holes.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
      waterRects.push({ min: [Math.min(x0, x1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(z0, z1)], y: WATER_LEVEL });
    },

    // Flat footbridge across water, decks sitting a little above the banks.
    // axis: 'x' if the bridge runs along X, 'z' along Z. Railings on both
    // long sides.
    bridge(x0, z0, x1, z1, axis, { material = 'wood', col = 'bridge', rail = 'rail', deck = 0.15 } = {}) {
      b.box(x0, -0.12, z0, x1, deck, z1, material, col, { kind: 'bridge' });
      const t = 0.08;
      if (axis === 'z') {
        b.box(x0, deck, z0, x0 + t, deck + 1.0, z1, 'grate', rail);
        b.box(x1 - t, deck, z0, x1, deck + 1.0, z1, 'grate', rail);
      } else {
        b.box(x0, deck, z0, x1, deck + 1.0, z0 + t, 'grate', rail);
        b.box(x0, deck, z1 - t, x1, deck + 1.0, z1, 'grate', rail);
      }
    },

    // Arched stone bridge high enough to walk under in the water, with
    // stairs on both ends. Runs along Z from z0 to z1 (deck), stairs extend
    // `run` further on each end.
    highBridgeZ(x0, x1, z0, z1, run = 2.5, { col = 'stone', rail = 'stone', h = 1.8 } = {}) {
      b.box(x0, h - 0.3, z0, x1, h, z1, 'concrete', col, { kind: 'bridge' });
      b.stairs(x0, z0 - run, x1, z0, '+z', h, 5, 'concrete', col);
      b.stairs(x0, z1, x1, z1 + run, '-z', h, 5, 'concrete', col);
      b.box(x0, h, z0, x0 + 0.3, h + 0.9, z1, 'concrete', rail);
      b.box(x1 - 0.3, h, z0, x1, h + 0.9, z1, 'concrete', rail);
    },

    // Same, running along X.
    highBridgeX(z0, z1, x0, x1, run = 2.5, { col = 'stone', rail = 'stone', h = 1.8 } = {}) {
      b.box(x0, h - 0.3, z0, x1, h, z1, 'concrete', col, { kind: 'bridge' });
      b.stairs(x0 - run, z0, x0, z1, '+x', h, 5, 'concrete', col);
      b.stairs(x1, z0, x1 + run, z1, '-x', h, 5, 'concrete', col);
      b.box(x0, h, z0, x1, h + 0.9, z0 + 0.3, 'concrete', rail);
      b.box(x0, h, z1 - 0.3, x1, h + 0.9, z1, 'concrete', rail);
    },

    // Pine: a trunk you can hide behind, and stacked tiers bullets go
    // through. The lowest tier starts above head height so it never snags.
    pine(x, z, s = 1) {
      b.box(x - 0.18, 0, z - 0.18, x + 0.18, 2.4, z + 0.18, 'wood', 'trunk', { kind: 'trunk' });
      b.box(x - 1.3 * s, 2.0, z - 1.3 * s, x + 1.3 * s, 2.0 + 1.0 * s, z + 1.3 * s, 'foliage', 'leaves');
      b.box(x - 0.95 * s, 2.0 + 1.0 * s, z - 0.95 * s, x + 0.95 * s, 2.0 + 2.0 * s, z + 0.95 * s, 'foliage', 'leaves');
      b.box(x - 0.55 * s, 2.0 + 2.0 * s, z - 0.55 * s, x + 0.55 * s, 2.0 + 2.9 * s, z + 0.55 * s, 'foliage', 'leaves');
    },

    // Palm: a tall trunk and a flat crown.
    palm(x, z) {
      b.box(x - 0.16, 0, z - 0.16, x + 0.16, 4.2, z + 0.16, 'wood', 'trunk', { kind: 'trunk' });
      b.box(x - 1.6, 4.2, z - 0.4, x + 1.6, 4.5, z + 0.4, 'foliage', 'leaves');
      b.box(x - 0.4, 4.2, z - 1.6, x + 0.4, 4.5, z + 1.6, 'foliage', 'leaves');
    },

    perimeter(x0, z0, x1, z1, h = 7, col = 'wall') {
      b.box(x0 - 1, 0, z0 - 1, x1 + 1, h, z0, 'concrete', col);
      b.box(x0 - 1, 0, z1, x1 + 1, h, z1 + 1, 'concrete', col);
      b.box(x0 - 1, 0, z0, x0, h, z1, 'concrete', col);
      b.box(x1, 0, z0, x1 + 1, h, z1, 'concrete', col);
    },

    // Ground slab with the water holes cut out of it, plus a riverbed under
    // each hole. The ground is drawn as boxes (so the banks show) when there
    // is water, otherwise by the scene's big ground plane.
    finishGround(x0, z0, x1, z1) {
      const render = holes.length > 0;
      for (const r of subtractRects([x0, z0, x1, z1], holes)) {
        b.box(r[0], -1, r[1], r[2], 0, r[3], 'concrete', 'ground', { render, kind: 'ground' });
      }
      for (const h of holes) b.box(h[0], -1.2, h[1], h[2], -WATER_DEPTH, h[3], 'concrete', 'bed', { render: false, kind: 'bed' });
      return render;
    },
  };
  return b;
}

// Rect minus a set of rects, as a list of non-overlapping rects (cut into a
// grid at every hole edge, then merged along rows).
export function subtractRects(outer, holes) {
  const xs = new Set([outer[0], outer[2]]), zs = new Set([outer[1], outer[3]]);
  for (const h of holes) {
    if (h[0] > outer[0] && h[0] < outer[2]) xs.add(h[0]);
    if (h[2] > outer[0] && h[2] < outer[2]) xs.add(h[2]);
    if (h[1] > outer[1] && h[1] < outer[3]) zs.add(h[1]);
    if (h[3] > outer[1] && h[3] < outer[3]) zs.add(h[3]);
  }
  const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < Z.length - 1; j++) {
    let run = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      const inHole = holes.some((h) => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3]);
      if (!inHole) {
        if (run) run[2] = X[i + 1];
        else run = [X[i], Z[j], X[i + 1], Z[j + 1]];
      } else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out;
}

export const toSpawn = ([x, y, z], face = [0, 0]) => ({ pos: [x, y, z], yaw: Math.atan2(x - face[0], z - face[1]) });

// Spawns on a grid inside a rect, all facing `face`.
export function spawnGrid(x0, z0, x1, z1, cols, rows, face, y = 0) {
  const out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / cols, z = z0 + ((z1 - z0) * (j + 0.5)) / rows;
    out.push(toSpawn([x, y, z], face));
  }
  return out;
}
