// Helpers for writing maps out of axis-aligned boxes. Everything stays a box
// so collision, bullets and rendering keep their cheap paths (one merged
// mesh per map). Water is a hole cut in the ground with a riverbed under it
// and a see-through surface drawn on top. It's deep (WATER_DEPTH): you swim
// in it (movement.js) and climb out by swimming into a bank.

export const WATER_DEPTH = 4.4; // riverbed below ground level (doubled from 2.2 at Kenny's request)
export const WATER_LEVEL = -0.1; // water surface

// Cover sizes. A crouched player is 1.15 m tall with eyes at 1.0 m, a
// standing one 1.8 m with eyes at 1.6 m: COVER_H hides a crouched body and
// lets a standing player shoot over.
export const COVER_H = 1.3;
export const COVER_SCALE = 1.25; // crates: the old 1.2 m crate is now 1.5 m
export const TRUNK_R = 0.42; // tree trunks are 0.84 m thick (a body is 0.82 m wide)

// Push a new prop (half size h at x, z) away from one of the same kind and
// height it would overlap, so their faces touch instead (no z-fighting).
function settle(props, kind, x, z, h, y) {
  for (const o of props) {
    if (o.kind !== kind || Math.abs(o.y - y) > 0.02) continue;
    const dx = x - o.x, dz = z - o.z, need = o.h + h + 0.002;
    if (Math.abs(dx) >= need || Math.abs(dz) >= need) continue;
    if (Math.abs(dx) >= Math.abs(dz)) x = o.x + Math.sign(dx || 1) * need;
    else z = o.z + Math.sign(dz) * need;
  }
  return [x, z];
}

export function mapBuilder(palette = {}) {
  const boxes = [];
  const props = []; // crates and barrels placed so far, for settle()
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

    // Props are sized to hide behind (Kenny: "they look like decorations"):
    // a crate is crouch cover (a crouched body, 1.15 m, fits behind it and
    // a standing player shoots over it), a stack of two is standing cover.
    // Sizes passed in are the old ones and get COVER_SCALE'd. A crate put
    // down next to one it would now overlap is pushed out to touch it, and
    // one stacked on another (y = the lower crate's old top) sits on its new
    // top, so map files keep their old numbers.
    crate(x, z, size = 1.2, y = 0, col = 'crate') {
      const s = size * COVER_SCALE;
      if (y > 0) {
        const under = props.find((o) => o.kind === 'crate' && Math.abs(o.oldTop - y) < 0.02 && Math.abs(o.x - x) < o.h && Math.abs(o.z - z) < o.h);
        const oldTop = y + size;
        if (under) y = under.top;
        [x, z] = settle(props, 'crate', x, z, s / 2, y);
        props.push({ kind: 'crate', x, z, h: s / 2, y, top: y + s, oldTop });
      } else {
        [x, z] = settle(props, 'crate', x, z, s / 2, y);
        props.push({ kind: 'crate', x, z, h: s / 2, y, top: y + s, oldTop: y + size });
      }
      b.box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, 'wood', col, { kind: 'crate' });
    },

    // A stack of crates: big one with a smaller one on top (standing cover).
    crates(x, z) {
      b.crate(x, z, 1.2);
      b.crate(x + 0.1, z - 0.05, 0.9, 1.2);
    },

    // Oil drum: metal, so it stops almost everything. Tall enough to crouch
    // behind; a pair side by side hides a crouched body.
    barrel(x, z, col = 'barrel', y = 0) {
      const h = 0.4;
      [x, z] = settle(props, 'barrel', x, z, h, y);
      props.push({ kind: 'barrel', x, z, h, y });
      b.box(x - h, y, z - h, x + h, y + 1.25, z + h, 'metal', col, { kind: 'barrel' });
    },

    // Waist-high (crouch) cover wall: a run of sandbags or a concrete
    // barrier, `len` long along `axis`, centered on x, z. It stretches with
    // the map like a wall does.
    cover(x, z, len, axis = 'x', { h = COVER_H, t = 0.7, material = 'concrete', col = 'stone' } = {}) {
      if (axis === 'x') b.box(x - len / 2, 0, z - t / 2, x + len / 2, h, z + t / 2, material, col);
      else b.box(x - t / 2, 0, z - len / 2, x + t / 2, h, z + len / 2, material, col);
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

    // Deep water: cuts the ground and records the surface for drawing,
    // swimming and splashes.
    water(x0, z0, x1, z1) {
      holes.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
      waterRects.push({ min: [Math.min(x0, x1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(z0, z1)], y: WATER_LEVEL });
    },

    // Flat footbridge across water, decks sitting a little above the banks.
    // axis: 'x' if the bridge runs along X, 'z' along Z. Railings on both
    // long sides.
    bridge(x0, z0, x1, z1, axis, { material = 'wood', col = 'bridge', rail = 'rail', deck = 0.15 } = {}) {
      b.box(x0, -0.12, z0, x1, deck, z1, material, col, { kind: 'bridge' });
      // Plank side walls a crouched player hides behind while crossing.
      const t = 0.2, h = deck + COVER_H;
      if (axis === 'z') {
        b.box(x0, deck, z0, x0 + t, h, z1, material, rail);
        b.box(x1 - t, deck, z0, x1, h, z1, material, rail);
      } else {
        b.box(x0, deck, z0, x1, h, z0 + t, material, rail);
        b.box(x0, deck, z1 - t, x1, h, z1, material, rail);
      }
    },

    // Arched stone bridge high enough to walk under in the water, with
    // stairs on both ends. Runs along Z from z0 to z1 (deck), stairs extend
    // `run` further on each end.
    highBridgeZ(x0, x1, z0, z1, run = 2.5, { col = 'stone', rail = 'stone', h = 1.8 } = {}) {
      b.box(x0, h - 0.3, z0, x1, h, z1, 'concrete', col, { kind: 'bridge' });
      b.stairs(x0, z0 - run, x1, z0, '+z', h, 5, 'concrete', col);
      b.stairs(x0, z1, x1, z1 + run, '-z', h, 5, 'concrete', col);
      b.box(x0, h, z0, x0 + 0.4, h + COVER_H, z1, 'concrete', rail);
      b.box(x1 - 0.4, h, z0, x1, h + COVER_H, z1, 'concrete', rail);
    },

    // Same, running along X.
    highBridgeX(z0, z1, x0, x1, run = 2.5, { col = 'stone', rail = 'stone', h = 1.8 } = {}) {
      b.box(x0, h - 0.3, z0, x1, h, z1, 'concrete', col, { kind: 'bridge' });
      b.stairs(x0 - run, z0, x0, z1, '+x', h, 5, 'concrete', col);
      b.stairs(x1, z0, x1 + run, z1, '-x', h, 5, 'concrete', col);
      b.box(x0, h, z0, x1, h + COVER_H, z0 + 0.4, 'concrete', rail);
      b.box(x0, h, z1 - 0.4, x1, h + COVER_H, z1, 'concrete', rail);
    },

    // Pine: a trunk thick enough to hide a standing body behind (pistols
    // can't punch through it, rifles barely), and stacked tiers bullets go
    // through. The lowest tier starts above head height so it never snags.
    pine(x, z, s = 1) {
      const r = TRUNK_R * Math.max(0.9, Math.min(1.2, s));
      b.box(x - r, 0, z - r, x + r, 2.4, z + r, 'wood', 'trunk', { kind: 'trunk' });
      b.box(x - 1.3 * s, 2.0, z - 1.3 * s, x + 1.3 * s, 2.0 + 1.0 * s, z + 1.3 * s, 'foliage', 'leaves');
      b.box(x - 0.95 * s, 2.0 + 1.0 * s, z - 0.95 * s, x + 0.95 * s, 2.0 + 2.0 * s, z + 0.95 * s, 'foliage', 'leaves');
      b.box(x - 0.55 * s, 2.0 + 2.0 * s, z - 0.55 * s, x + 0.55 * s, 2.0 + 2.9 * s, z + 0.55 * s, 'foliage', 'leaves');
    },

    // Palm: a tall trunk and a flat crown.
    palm(x, z) {
      b.box(x - TRUNK_R * 0.9, 0, z - TRUNK_R * 0.9, x + TRUNK_R * 0.9, 4.2, z + TRUNK_R * 0.9, 'wood', 'trunk', { kind: 'trunk' });
      b.box(x - 1.6, 4.2, z - 0.4, x + 1.6, 4.5, z + 0.4, 'foliage', 'leaves');
      b.box(x - 0.4, 4.2, z - 1.6, x + 0.4, 4.5, z + 1.6, 'foliage', 'leaves');
    },

    // Solid mass that shapes the playable area (a cliff, a block of houses,
    // stacked containers): nobody gets in, bullets stop on it. Maps aren't
    // all rectangles; these carve the corners and narrows out of the bounds.
    block(x0, z0, x1, z1, h = 8, col = 'wall', material = 'concrete') {
      b.box(x0, 0, z0, x1, h, z1, material, col, { kind: 'block' });
    },

    // The outer walls reach down past the riverbed, so nobody swims under
    // them and drops out of the world where water meets the map edge.
    perimeter(x0, z0, x1, z1, h = 7, col = 'wall') {
      const y0 = -WATER_DEPTH - 0.8;
      b.box(x0 - 1, y0, z0 - 1, x1 + 1, h, z0, 'concrete', col);
      b.box(x0 - 1, y0, z1, x1 + 1, h, z1 + 1, 'concrete', col);
      b.box(x0 - 1, y0, z0, x0, h, z1, 'concrete', col);
      b.box(x1, y0, z0, x1 + 1, h, z1, 'concrete', col);
    },

    // Ground slab with the water holes cut out of it, plus a riverbed under
    // each hole. The ground is drawn as boxes (so the banks show) when there
    // is water, otherwise by the scene's big ground plane.
    finishGround(x0, z0, x1, z1) {
      const render = holes.length > 0;
      for (const r of subtractRects([x0, z0, x1, z1], holes)) {
        b.box(r[0], -WATER_DEPTH - 0.3, r[1], r[2], 0, r[3], 'concrete', 'ground', { render, kind: 'ground' });
      }
      for (const h of holes) b.box(h[0], -WATER_DEPTH - 0.8, h[1], h[2], -WATER_DEPTH, h[3], 'concrete', 'bed', { render: false, kind: 'bed' });
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

// Spread a finished map out horizontally by k (CS 1.6 scale), keeping it
// human-sized: heights never change, and props (crates, barrels, tree
// trunks and leaves, thin fence sheets) keep their size and only move. Walls,
// buildings, stairs, bridges and open ground stretch, so doors, lanes and
// rooms get wider and every walk gets longer by k.
const KEEP_SIZE = new Set(['crate', 'barrel', 'trunk', 'sheet']);
export function scaleMap(map, k) {
  const pt = ([x, z]) => [x * k, z * k];
  const rect = (r) => ({ ...r, min: pt(r.min), max: pt(r.max) });
  const box = (b) => {
    if (!KEEP_SIZE.has(b.kind) && b.material !== 'foliage') {
      return { ...b, min: [b.min[0] * k, b.min[1], b.min[2] * k], max: [b.max[0] * k, b.max[1], b.max[2] * k] };
    }
    const cx = ((b.min[0] + b.max[0]) / 2) * (k - 1), cz = ((b.min[2] + b.max[2]) / 2) * (k - 1);
    return { ...b, min: [b.min[0] + cx, b.min[1], b.min[2] + cz], max: [b.max[0] + cx, b.max[1], b.max[2] + cz] };
  };
  const spawn = (s) => ({ ...s, pos: [s.pos[0] * k, s.pos[1], s.pos[2] * k] });
  const out = {
    ...map,
    boxes: map.boxes.map(box),
    spawns: map.spawns.map(spawn),
    teamSpawns: { red: map.teamSpawns.red.map(spawn), blue: map.teamSpawns.blue.map(spawn) },
    bounds: rect(map.bounds),
  };
  if (map.water) out.water = map.water.map(rect);
  if (map.sites) out.sites = Object.fromEntries(Object.entries(map.sites).map(([n, r]) => [n, rect(r)]));
  if (map.hostages) out.hostages = map.hostages.map(([x, y, z]) => [x * k, y, z * k]);
  if (map.rescue) out.rescue = map.rescue.map(rect);
  return out;
}
