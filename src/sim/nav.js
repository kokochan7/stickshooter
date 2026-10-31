// Navigation grid + A* for bots (and hostages).
//
// Each cell gets a floor height: the lowest surface under it with standing
// room above (so the ground under a high bridge, the inside of a building
// rather than its roof, the top of a platform or a stair). A cell is blocked
// if something sits between knee and head height above its floor, and you
// can only move to a neighbor whose floor is at most a stair step higher
// (dropping down is fine).

const CELL = 0.5;
const CLEARANCE = 0.45;
const HEADROOM = 1.75;
const MAX_STEP = 0.46; // a little over STEP_HEIGHT, so 0.45 m ledges count

export class NavGrid {
  constructor(world, bounds) {
    this.min = bounds.min;
    this.w = Math.ceil((bounds.max[0] - bounds.min[0]) / CELL);
    this.h = Math.ceil((bounds.max[1] - bounds.min[1]) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    this.floor = new Float32Array(this.w * this.h);
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
        let floor = null;
        for (const c of column) {
          const top = c.max[1];
          if (!column.some((o) => o.max[1] > top + 1e-3 && o.min[1] < top + HEADROOM)) { floor = top; break; }
        }
        if (floor === null) { this.blocked[k] = 1; this.floor[k] = -100; continue; }
        this.floor[k] = floor;
        const r = CLEARANCE;
        // Anything between knee and head height above the floor blocks walking.
        if (world.overlaps(x - r, floor + 0.47, z - r, x + r, floor + 1.7, z + r)) this.blocked[k] = 1;
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
    return this.floor[b] - this.floor[a] <= MAX_STEP;
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

  // Straight walk between two points without touching a blocked cell?
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
    const W = this.w;
    const start = s0[1] * W + s0[0], goal = g0[1] * W + g0[0];
    const gScore = new Float32Array(this.w * this.h).fill(Infinity);
    const came = new Int32Array(this.w * this.h).fill(-1);
    const closed = new Uint8Array(this.w * this.h);
    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, 0);
    const gi = g0[0], gj = g0[1];
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % W, cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (this.isBlocked(ni, nj)) continue;
        if (di && dj && (this.isBlocked(ci + di, cj) || this.isBlocked(ci, cj + dj))) continue;
        const n = nj * W + ni;
        if (!this.canStep(cur, n)) continue;
        if (di && dj && (!this.canStep(cur, cj * W + ci + di) || !this.canStep(cur, (cj + dj) * W + ci))) continue;
        if (closed[n]) continue;
        const g = gScore[cur] + (di && dj ? 1.4142 : 1);
        if (g < gScore[n]) {
          gScore[n] = g;
          came[n] = cur;
          const h = Math.hypot(ni - gi, nj - gj);
          heap.push(n, g + h);
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

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const a = this.items, q = this.prio;
    a.push(item); q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (q[par] <= q[i]) break;
      [a[par], a[i]] = [a[i], a[par]]; [q[par], q[i]] = [q[i], q[par]];
      i = par;
    }
  }
  pop() {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastI = a.pop(), lastP = q.pop();
    if (a.length) {
      a[0] = lastI; q[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [q[m], q[i]] = [q[i], q[m]];
        i = m;
      }
    }
    return top;
  }
}
