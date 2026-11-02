// Navigation grid + A* for bots (and hostages).
//
// Each cell gets a floor height: the lowest surface under it with standing
// room above (the inside of a building rather than its roof, the top of a
// platform or a stair). Over deep water it's a bridge deck if there is one,
// not the riverbed. A cell is blocked
// if something sits between knee and head height above its floor, and you
// can only move to a neighbor whose floor is at most a stair step higher
// (dropping down is fine). Cells over deep water are swum: you can climb out
// of them onto a bank, but they cost a lot more than walking, so paths cross
// on bridges where there are any.

const CELL = 0.5;
const CLEARANCE = 0.45;
const HEADROOM = 1.75;
const MAX_STEP = 0.46; // a little over STEP_HEIGHT, so 0.45 m ledges count
const CLIMB_OUT = 2.3; // how high a swimmer can climb out (movement.js water jump)
const SWIM_COST = 6; // a swum cell costs this many walked ones

export class NavGrid {
  constructor(world, bounds, water = []) {
    this.min = bounds.min;
    this.w = Math.ceil((bounds.max[0] - bounds.min[0]) / CELL);
    this.h = Math.ceil((bounds.max[1] - bounds.min[1]) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    this.floor = new Float32Array(this.w * this.h);
    this.swim = new Uint8Array(this.w * this.h); // 1 = deep water you swim through
    this.surf = new Float32Array(this.w * this.h); // water surface over swum cells
    // A* gives up after this many steps. Big maps need room for a path from
    // one end to the other (a few times the cells on the way).
    this.maxIter = Math.max(20000, this.w * this.h);
    const column = [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.cellCenter(i, j);
        const k = j * this.w + i;
        // Boxes in this cell's column, lowest top first.
        column.length = 0;
        for (const b of world.boxes) {
          if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]) column.push(b);
        }
        column.sort((a, b) => a.max[1] - b.max[1]);
        // Over deep water the riverbed is only a floor if nothing better is
        // there: a footbridge or a high bridge's deck you'd walk on instead.
        let surf = null;
        for (const wr of water ?? []) {
          if (x > wr.min[0] && x < wr.max[0] && z > wr.min[1] && z < wr.max[1]) surf = wr.y;
        }
        let floor = null;
        for (const c of column) {
          const top = c.max[1];
          if (column.some((o) => o.max[1] > top + 1e-3 && o.min[1] < top + HEADROOM)) continue;
          if (floor === null) floor = top;
          if (surf === null || top > surf - 1) { floor = top; break; }
        }
        if (floor === null) { this.blocked[k] = 1; this.floor[k] = -100; continue; }
        this.floor[k] = floor;
        if (surf !== null && floor < surf - 1) { this.swim[k] = 1; this.surf[k] = surf; }
        const r = CLEARANCE;
        // Anything between knee and head height above the floor blocks
        // walking. A swimmer's head is above the water, so in deep water
        // only what sticks out of it (a boat, a rock) is in the way; the
        // bank itself is something you climb onto.
        if (this.swim[k]) {
          if (world.overlaps(x - r, surf + 0.15, z - r, x + r, surf + 1.0, z + r)) this.blocked[k] = 1;
        } else if (world.overlaps(x - r, floor + 0.47, z - r, x + r, floor + 1.7, z + r)) this.blocked[k] = 1;
      }
    }
    // Connected areas (moving both ways). Crate tops, the fountain rim and
    // the like are little islands you can stand on but not walk to; bots
    // should only ever be sent to the main area.
    this.region = new Int32Array(this.w * this.h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let k0 = 0; k0 < this.region.length; k0++) {
      if (this.blocked[k0] || this.region[k0] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      this.region[k0] = id;
      stack.push(k0);
      while (stack.length) {
        const c = stack.pop();
        size++;
        const ci = c % this.w, cj = (c / this.w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (this.isBlocked(ni, nj)) continue;
          const n = nj * this.w + ni;
          if (this.region[n] >= 0 || Math.abs(this.floor[n] - this.floor[c]) > MAX_STEP) continue;
          this.region[n] = id;
          stack.push(n);
        }
      }
      sizes.push(size);
    }
    this.main = sizes.indexOf(Math.max(...sizes));
    this.open = [];
    for (let k = 0; k < this.blocked.length; k++) if (this.region[k] === this.main) this.open.push(k);
  }

  // A cell in the main walkable area (not a crate top or a sealed room)?
  isMain(i, j) {
    return !this.isBlocked(i, j) && this.region[j * this.w + i] === this.main;
  }

  // Can you walk from cell a to its neighbor b (by index)?
  canStep(a, b) {
    const up = this.floor[b] - this.floor[a];
    if (up <= MAX_STEP) return true;
    // A swimmer floats with their feet about 1.5 m under the surface and
    // climbs out from there, however deep the water is.
    return this.swim[a] === 1 && this.floor[b] - (this.surf[a] - 1.5) <= CLIMB_OUT;
  }

  isSwim(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.swim[j * this.w + i] === 1;
  }

  floorAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.floor[j * this.w + i];
  }

  cellCenter(i, j) {
    return [this.min[0] + (i + 0.5) * CELL, this.min[1] + (j + 0.5) * CELL];
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.min[0]) / CELL);
    const j = Math.floor((z - this.min[1]) / CELL);
    return [Math.max(0, Math.min(this.w - 1, i)), Math.max(0, Math.min(this.h - 1, j))];
  }

  isBlocked(i, j) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.blocked[j * this.w + i] === 1;
  }

  randomOpenPoint(rand) {
    const k = this.open[Math.floor(rand() * this.open.length)];
    return this.cellCenter(k % this.w, Math.floor(k / this.w));
  }

  // Nearest open cell; mainOnly: nearest cell of the main area (for goals,
  // so a target on top of a crate becomes the floor next to it).
  nearestOpen(i, j, mainOnly = false) {
    const ok = (a, b) => (mainOnly ? this.isMain(a, b) : !this.isBlocked(a, b));
    if (ok(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (ok(i + di, j + dj)) return [i + di, j + dj];
      }
    }
    return null;
  }

  // Straight walk between two points without touching a blocked cell (or
  // wading into deep water)?
  walkable(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (CELL * 0.5));
    let prev = -1;
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.isBlocked(i, j)) return false;
      const k = j * this.w + i;
      if (prev >= 0 && k !== prev && !this.canStep(prev, k)) return false;
      // A straight line never jumps into the water: A* decides when a swim
      // is worth it.
      if (prev >= 0 && k !== prev && this.swim[k] && !this.swim[prev]) return false;
      prev = k;
    }
    return true;
  }

  // A* from world point a to b. Returns a list of [x, z] waypoints or null.
  findPath(ax, az, bx, bz) {
    // Standing in a blocked cell (hugging a wall): step out into the main
    // area, not onto whatever roof or ledge happens to be nearest.
    const c0 = this.cellOf(ax, az);
    const s0 = this.isBlocked(...c0) ? this.nearestOpen(...c0, true) ?? this.nearestOpen(...c0) : c0;
    const g0 = this.nearestOpen(...this.cellOf(bx, bz), true);
    if (!s0 || !g0) return null;
    const W = this.w, N = this.w * this.h;
    const start = s0[1] * W + s0[0], goal = g0[1] * W + g0[0];
    // Search buffers are kept between calls and stamped per search instead of
    // being allocated and cleared: big maps have ~100k cells and 128 bots
    // path a lot.
    if (!this.search) this.search = { gScore: new Float32Array(N), came: new Int32Array(N), seen: new Uint32Array(N), stamp: 0, heap: new MinHeap(N) };
    const S = this.search;
    if (++S.stamp >= 0x7fffffff) { S.seen.fill(0); S.stamp = 1; }
    const { gScore, came, seen } = S;
    const stamp = S.stamp, closedMark = (stamp | 0x80000000) >>> 0; // never equals a live stamp below 2^31
    const heap = S.heap;
    heap.clear();
    const blocked = this.blocked, floor = this.floor, swim = this.swim, H = this.h;
    const free = (i, j) => i >= 0 && j >= 0 && i < W && j < H && blocked[j * W + i] !== 1;
    const step = (from, to) => { const up = floor[to] - floor[from]; return up <= MAX_STEP || (swim[from] === 1 && up <= CLIMB_OUT); };
    const gi = g0[0], gj = g0[1];
    // Octile distance, weighted a little: a tight estimate keeps A* from
    // flooding big open maps. Paths get string-pulled afterwards anyway.
    const est = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (dx + dz - 0.5858 * Math.min(dx, dz)) * 1.2; };
    gScore[start] = 0; came[start] = -1; seen[start] = stamp;
    heap.push(start, est(s0[0], s0[1]));
    let found = false, iter = 0;
    while (heap.size && iter++ < this.maxIter) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (seen[cur] === closedMark) continue;
      seen[cur] = closedMark;
      const ci = cur % W, cj = (cur / W) | 0;
      const gc = gScore[cur];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!free(ni, nj)) continue;
        if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue;
        const n = nj * W + ni;
        if (seen[n] === closedMark) continue;
        if (!step(cur, n)) continue;
        if (di && dj && (!step(cur, cj * W + ci + di) || !step(cur, (cj + dj) * W + ci))) continue;
        const g = gc + (di && dj ? 1.4142 : 1) * (swim[n] ? SWIM_COST : 1);
        if (seen[n] !== stamp || g < gScore[n]) {
          seen[n] = stamp;
          gScore[n] = g;
          came[n] = cur;
          heap.push(n, g + est(ni, nj));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.cellCenter(c % W, (c / W) | 0));
    // String-pull: skip waypoints we can walk past directly.
    const out = [];
    let anchor = [ax, az];
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) {
        if (this.walkable(anchor[0], anchor[1], pts[m][0], pts[m][1])) { far = m; break; }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    return out;
  }
}

// Binary min-heap on typed arrays (grows as needed); duplicates are allowed
// and skipped by the caller once a cell is closed.
class MinHeap {
  constructor(cap = 1024) { this.items = new Int32Array(cap); this.prio = new Float32Array(cap); this.size = 0; }
  clear() { this.size = 0; }
  push(item, p) {
    if (this.size === this.items.length) {
      const a = new Int32Array(this.size * 2); a.set(this.items); this.items = a;
      const q = new Float32Array(this.size * 2); q.set(this.prio); this.prio = q;
    }
    const a = this.items, q = this.prio;
    let i = this.size++;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (q[par] <= p) break;
      a[i] = a[par]; q[i] = q[par];
      i = par;
    }
    a[i] = item; q[i] = p;
  }
  pop() {
    const a = this.items, q = this.prio;
    const top = a[0];
    const n = --this.size;
    if (n > 0) {
      const item = a[n], p = q[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && q[r] < q[l] ? r : l;
        if (q[m] >= p) break;
        a[i] = a[m]; q[i] = q[m];
        i = m;
      }
      a[i] = item; q[i] = p;
    }
    return top;
  }
}
