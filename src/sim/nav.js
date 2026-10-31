// Ground-level navigation grid + A* for bots.

const CELL = 0.5;
const CLEARANCE = 0.45;

export class NavGrid {
  constructor(world, bounds) {
    this.min = bounds.min;
    this.w = Math.ceil((bounds.max[0] - bounds.min[0]) / CELL);
    this.h = Math.ceil((bounds.max[1] - bounds.min[1]) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.cellCenter(i, j);
        const r = CLEARANCE;
        // Anything between knee and head height blocks walking.
        if (world.overlaps(x - r, 0.35, z - r, x + r, 1.7, z + r)) this.blocked[j * this.w + i] = 1;
      }
    }
    this.open = [];
    for (let k = 0; k < this.blocked.length; k++) if (!this.blocked[k]) this.open.push(k);
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

  nearestOpen(i, j) {
    if (!this.isBlocked(i, j)) return [i, j];
    for (let r = 1; r < 8; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (!this.isBlocked(i + di, j + dj)) return [i + di, j + dj];
      }
    }
    return null;
  }

  // Straight walk between two points without touching a blocked cell?
  walkable(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.isBlocked(i, j)) return false;
    }
    return true;
  }

  // A* from world point a to b. Returns a list of [x, z] waypoints or null.
  findPath(ax, az, bx, bz) {
    const s0 = this.nearestOpen(...this.cellOf(ax, az));
    const g0 = this.nearestOpen(...this.cellOf(bx, bz));
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
