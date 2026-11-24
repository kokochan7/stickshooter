// Navigation grid + A* for bots (and hostages), with stacked floors.
//
// The map is cut into 0.5 m cells. A cell can hold several floors, one
// above the other: the warehouse floor, the catwalk over it, the vent duct
// above that and the roof on top. A floor is the top of a box with room to
// stand (or, in a duct or under a low ceiling, at least to crouch) above
// it. Each floor is a node of the graph:
//   - a node is blocked if something sits between knee and head height
//     above it (a wall, a crate) within a body's width
//   - you can walk to a neighbor floor at most a stair step higher, drop to
//     any lower one you fit over, and jump up a ledge of up to JUMP_UP
//     (onto a roof from the top of a ladder) if there's head room to jump
//   - low floors (a duct) are crawled crouched, and cost more
//   - a floor that's only in the way of a ledge low enough to jump onto
//     (the roof's edge by the top of a ladder) is a "ledge" node: you can
//     stand there to jump, but not walk from one ledge node to another (or
//     you'd walk through a knee-high wall)
//   - floors over deep water are swum: you climb out onto a bank, but they
//     cost a lot more than walking, so paths cross on bridges
// Positions take an optional height: without one a point means its
// "default" floor, the lowest one in the main walkable area (a bridge deck
// rather than the riverbed under it).

const CELL = 0.5;
const CLEARANCE = 0.45;
const HEADROOM = 1.75; // standing room (STAND_HEIGHT is 1.8; a little slack)
const CROUCH_ROOM = 1.2; // crawling room (DUCK_HEIGHT is 1.15)
const MAX_STEP = 0.46; // a little over STEP_HEIGHT, so 0.45 m ledges count
const JUMP_UP = 0.95; // a ledge you jump onto (a standing jump clears ~1.1 m)
const CLIMB_OUT = 2.3; // how high a swimmer can climb out (movement.js water jump)
const SWIM_COST = 6; // a swum cell costs this many walked ones
const CROUCH_COST = 2.5; // crawling is slow
const JUMP_COST = 3; // a jump costs this many extra cells

// Move kinds (NavGrid.move).
export const NAV_NONE = 0, NAV_WALK = 1, NAV_JUMP = 2;
// Waypoint flags (4th entry of a path point).
export const WP_JUMP = 1, WP_CROUCH = 2;

export class NavGrid {
  constructor(world, bounds, water = []) {
    this.min = bounds.min;
    this.w = Math.ceil((bounds.max[0] - bounds.min[0]) / CELL);
    this.h = Math.ceil((bounds.max[1] - bounds.min[1]) / CELL);
    const nc = this.w * this.h;
    this.first = new Int32Array(nc); // cell -> its first node
    this.count = new Uint8Array(nc); // cell -> how many floors it has
    const F = [], C = [], B = [], SW = [], SU = [], CR = [], LG = [], OT = [], CELLS = [];
    const hits = [];
    const column = [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        // Sampled a hair off the cell's center, so a center that lands exactly
        // on the line between two boxes (two stair steps) still sees one.
        let [x, z] = this.cellCenter(i, j);
        x += 0.0013; z += 0.0017;
        const k = j * this.w + i;
        column.length = 0;
        for (const b of world.boxes) {
          if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]) column.push(b);
        }
        column.sort((a, b) => a.max[1] - b.max[1]);
        let surf = null;
        for (const wr of water ?? []) {
          if (x > wr.min[0] && x < wr.max[0] && z > wr.min[1] && z < wr.max[1]) surf = wr.y;
        }
        this.first[k] = F.length;
        let last = -Infinity;
        for (const c of column) {
          const top = c.max[1];
          if (top < last + 1e-3) continue; // same floor as the last one
          // Inside something solid?
          if (column.some((o) => o.min[1] < top - 1e-3 && o.max[1] > top + 1e-3)) continue;
          let ceil = 1e9;
          for (const o of column) if (o.min[1] > top - 1e-3 && o.max[1] > top + 1e-3 && o.min[1] < ceil) ceil = o.min[1];
          if (ceil - top < CROUCH_ROOM) continue;
          last = top;
          const crouch = ceil - top < HEADROOM;
          const swim = surf !== null && top < surf - 1;
          const r = CLEARANCE;
          let blocked, ledge = false;
          if (swim) blocked = !!world.overlaps(x - r, surf + 0.15, z - r, x + r, surf + 1.0, z + r);
          else {
            world.overlapping(x - r, top + 0.47, z - r, x + r, top + (crouch ? 1.1 : 1.7), z + r, hits);
            blocked = hits.length > 0;
            if (blocked && !crouch && hits.every((o) => o.max[1] <= top + JUMP_UP)) { blocked = false; ledge = true; }
          }
          // How high it's clear above this floor across a whole body's width:
          // you can only drop in from above that (through a skylight, not
          // past its edge where the roof would catch you).
          let open = 1e9;
          if (!swim) {
            world.overlapping(x - r, top + 0.47, z - r, x + r, top + 1000, z + r, hits);
            for (const o of hits) if (o.min[1] >= top + 0.47 - 1e-3 && o.min[1] < open) open = o.min[1];
          }
          OT.push(open);
          F.push(top); C.push(ceil); B.push(blocked ? 1 : 0); SW.push(swim ? 1 : 0); SU.push(swim ? surf : 0); CR.push(crouch ? 1 : 0); LG.push(ledge ? 1 : 0); CELLS.push(k);
          if (F.length - this.first[k] >= 255) break;
        }
        this.count[k] = F.length - this.first[k];
      }
    }
    this.n = F.length;
    this.floor = Float32Array.from(F);
    this.ceil = Float32Array.from(C);
    this.blockedNode = Uint8Array.from(B);
    this.swim = Uint8Array.from(SW);
    this.surf = Float32Array.from(SU);
    this.crouch = Uint8Array.from(CR);
    this.ledge = Uint8Array.from(LG);
    this.openTop = Float32Array.from(OT);
    this.cellIdx = Int32Array.from(CELLS);
    // A* gives up after this many steps. Big maps need room for a path from
    // one end to the other (a few times the nodes on the way).
    this.maxIter = Math.max(20000, this.n);

    // Connected areas, counting a move only if it works both ways (a
    // ledge you can jump up and drop down counts; a one-way drop doesn't;
    // nor does climbing in and out of water, so the water is never a goal).
    // Crate tops, the fountain rim and the like are little islands; bots
    // should only ever be sent to the main area.
    this.region = new Int32Array(this.n).fill(-1);
    const sizes = [];
    const stack = [];
    for (let a0 = 0; a0 < this.n; a0++) {
      if (this.blockedNode[a0] || this.region[a0] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      this.region[a0] = id;
      stack.push(a0);
      while (stack.length) {
        const a = stack.pop();
        size++;
        const k = this.cellIdx[a];
        const ci = k % this.w, cj = (k / this.w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
          const k2 = nj * this.w + ni;
          for (let b = this.first[k2], e = b + this.count[k2]; b < e; b++) {
            if (this.region[b] >= 0 || this.blockedNode[b]) continue;
            if (this.swim[a] !== this.swim[b] && Math.abs(this.floor[b] - this.floor[a]) > MAX_STEP) continue;
            if (!this.move(a, b) || !this.move(b, a)) continue;
            this.region[b] = id;
            stack.push(b);
          }
        }
      }
      sizes.push(size);
    }
    this.main = sizes.length ? sizes.indexOf(Math.max(...sizes)) : -1;
    this.open = [];
    for (let a = 0; a < this.n; a++) if (this.region[a] === this.main && !this.ledge[a]) this.open.push(a);
    // Each cell's default floor: the lowest dry one in the main area, else
    // the lowest dry open one, else whatever there is.
    this.def = new Int32Array(nc).fill(-1);
    for (let k = 0; k < nc; k++) {
      let best = -1, rank = 9;
      for (let a = this.first[k], e = a + this.count[k]; a < e; a++) {
        const r = (this.region[a] === this.main ? 0 : 2) + (this.blockedNode[a] || this.ledge[a] ? 4 : 0) + (this.swim[a] ? 1 : 0);
        if (r < rank) { rank = r; best = a; }
      }
      this.def[k] = best;
    }
    // Per-cell views kept for old callers: the default floor's values.
    this.blocked = new Uint8Array(nc);
    for (let k = 0; k < nc; k++) {
      let open = false;
      for (let a = this.first[k], e = a + this.count[k]; a < e; a++) if (!this.blockedNode[a]) open = true;
      this.blocked[k] = open ? 0 : 1;
    }
  }

  // How you get from node a to node b in a neighboring cell: NAV_WALK
  // (walk, step up, drop down, swim, climb out), NAV_JUMP, or NAV_NONE.
  move(a, b) {
    const fa = this.floor[a], fb = this.floor[b], up = fb - fa;
    if (up > MAX_STEP) {
      // A swimmer floats with their feet about 1.5 m under the surface and
      // climbs out from there, however deep the water is.
      if (this.swim[a]) return fb - (this.surf[a] - 1.5) <= CLIMB_OUT ? NAV_WALK : NAV_NONE;
      if (up > JUMP_UP || this.crouch[a] || this.crouch[b] || this.swim[b]) return NAV_NONE;
      return this.ceil[a] >= fb + HEADROOM ? NAV_JUMP : NAV_NONE;
    }
    // Dropping down: you have to fit over whatever is above the lower floor
    // (not through a catwalk or a roof to the floor under it).
    if (up < -MAX_STEP && (this.ceil[b] < fa + 1.15 || this.openTop[b] < fa + 1)) return NAV_NONE;
    if (this.ledge[a] && this.ledge[b] && Math.abs(up) <= MAX_STEP) return NAV_NONE;
    return NAV_WALK;
  }

  // ---------- Lookups ----------

  cellCenter(i, j) {
    return [this.min[0] + (i + 0.5) * CELL, this.min[1] + (j + 0.5) * CELL];
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.min[0]) / CELL);
    const j = Math.floor((z - this.min[1]) / CELL);
    return [Math.max(0, Math.min(this.w - 1, i)), Math.max(0, Math.min(this.h - 1, j))];
  }

  nodeCenter(a) {
    const k = this.cellIdx[a];
    return this.cellCenter(k % this.w, (k / this.w) | 0);
  }

  // The node for a point: the floor you'd be standing on at height y (the
  // highest one at most a little above y), or the default floor.
  nodeAt(x, z, y) {
    const [i, j] = this.cellOf(x, z);
    return this.nodeInCell(j * this.w + i, y);
  }

  nodeInCell(k, y) {
    if (y === undefined || y === null) return this.def[k];
    let best = -1;
    const e = this.first[k] + this.count[k];
    for (let a = this.first[k]; a < e; a++) if (this.floor[a] <= y + 0.6) best = a;
    return best >= 0 ? best : this.count[k] ? this.first[k] : -1;
  }

  isBlocked(i, j) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.blocked[j * this.w + i] === 1;
  }

  // A cell (or, with y, the floor at that height) in the main walkable area
  // (not a crate top or a sealed room)?
  isMain(i, j, y) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    const k = j * this.w + i;
    if (y !== undefined) { const a = this.nodeInCell(k, y); return a >= 0 && !this.blockedNode[a] && this.region[a] === this.main; }
    for (let a = this.first[k], e = a + this.count[k]; a < e; a++) if (!this.blockedNode[a] && this.region[a] === this.main) return true;
    return false;
  }

  isSwim(x, z, y) {
    const a = this.nodeAt(x, z, y);
    return a >= 0 && this.swim[a] === 1;
  }

  floorAt(x, z, y) {
    const a = this.nodeAt(x, z, y);
    return a >= 0 ? this.floor[a] : -100;
  }

  // Crouch-height floor (a duct) at this point?
  crouchAt(x, z, y) {
    const a = this.nodeAt(x, z, y);
    return a >= 0 && this.crouch[a] === 1;
  }

  // Every open floor in the main area at (x, z), lowest first.
  floorsAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    const k = j * this.w + i, out = [];
    for (let a = this.first[k], e = a + this.count[k]; a < e; a++) {
      if (!this.blockedNode[a] && this.region[a] === this.main) out.push(this.floor[a]);
    }
    return out;
  }

  // [x, z, y] of a random floor in the main area.
  randomOpenPoint(rand) {
    const a = this.open[Math.floor(rand() * this.open.length)];
    const [x, z] = this.nodeCenter(a);
    return [x, z, this.floor[a]];
  }

  // Nearest open node to cell (i, j); mainOnly: of the main area (for
  // goals, so a target on top of a crate becomes the floor next to it). y
  // picks between floors stacked in the same cell.
  nearestOpen(i, j, mainOnly = false, y) {
    const ok = (a) => a >= 0 && !this.blockedNode[a] && !this.ledge[a] && (!mainOnly || this.region[a] === this.main);
    const pick = (ci, cj) => {
      if (ci < 0 || cj < 0 || ci >= this.w || cj >= this.h) return -1;
      const k = cj * this.w + ci;
      const a = this.nodeInCell(k, y);
      if (ok(a)) return a;
      let best = -1, bd = Infinity;
      for (let b = this.first[k], e = b + this.count[k]; b < e; b++) {
        if (!ok(b)) continue;
        const d = y === undefined || y === null ? (this.swim[b] ? 50 : 0) + this.floor[b] : Math.abs(this.floor[b] - y);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    };
    let a = pick(i, j);
    if (a >= 0) return a;
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        a = pick(i + di, j + dj);
        if (a >= 0) return a;
      }
    }
    return -1;
  }

  // ---------- Straight lines ----------

  // Straight walk between two points without touching a blocked floor,
  // jumping, or wading into deep water? ay: the height we start at (picks
  // the floor in a stack). Walking can step up, step down and drop.
  walkable(ax, az, bx, bz, ay) {
    return this.walkNode(ax, az, bx, bz, this.nodeAt(ax, az, ay)) >= 0;
  }

  // The node a straight walk from node a0 at (ax, az) ends on, or -1.
  walkNode(ax, az, bx, bz, a0) {
    if (a0 < 0) return -1;
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (CELL * 0.5));
    let cur = a0;
    if (this.blockedNode[cur]) return -1;
    let prevCell = this.cellIdx[cur];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      const k = j * this.w + i;
      if (k === prevCell) continue;
      // The floor we walk onto: the one we can reach closest in height.
      let next = -1, nd = Infinity;
      for (let b = this.first[k], e = b + this.count[k]; b < e; b++) {
        if (this.blockedNode[b] || this.ledge[b] || this.move(cur, b) !== NAV_WALK) continue;
        // A straight line never jumps into the water: A* decides when a
        // swim is worth it.
        if (this.swim[b] && !this.swim[cur]) continue;
        const dd = Math.abs(this.floor[b] - this.floor[cur]);
        if (dd < nd) { nd = dd; next = b; }
      }
      if (next < 0) return -1;
      cur = next;
      prevCell = k;
    }
    return cur;
  }

  // ---------- A* ----------

  // A* from world point a to b. Returns a list of [x, z, y, flags]
  // waypoints (flags: WP_JUMP = jump up to reach it, WP_CROUCH = crouch on
  // the way to it) or null.
  // noise (optional): { seed, amt } adds up to amt extra cost per step in
  // patches about 3 m across, different for every seed, so each bot has its
  // own idea of the best way and two bots rarely walk the same line.
  // opts: { ay, by } heights of the two ends (pick floors in a stack);
  // walkOnly: no jumps and no crawling (hostages, and whoever leads them).
  findPath(ax, az, bx, bz, noise = null, opts = {}) {
    const { ay, by, walkOnly = false } = opts;
    // Standing in a blocked spot (hugging a wall): step out into the main
    // area, not onto whatever roof or ledge happens to be nearest.
    const c0 = this.cellOf(ax, az);
    let start = this.nodeAt(ax, az, ay);
    if (start < 0 || this.blockedNode[start]) {
      start = this.nearestOpen(c0[0], c0[1], true, ay);
      if (start < 0) start = this.nearestOpen(c0[0], c0[1], false, ay);
    }
    const g0 = this.cellOf(bx, bz);
    const goal = this.nearestOpen(g0[0], g0[1], true, by);
    if (start < 0 || goal < 0) return null;
    const W = this.w, N = this.n;
    // Search buffers are kept between calls and stamped per search instead of
    // being allocated and cleared: big maps have ~100k nodes and 128 bots
    // path a lot.
    if (!this.search) this.search = { gScore: new Float32Array(N), came: new Int32Array(N), seen: new Uint32Array(N), stamp: 0, heap: new MinHeap(N) };
    const S = this.search;
    if (++S.stamp >= 0x7fffffff) { S.seen.fill(0); S.stamp = 1; }
    const { gScore, came, seen } = S;
    const stamp = S.stamp, closedMark = (stamp | 0x80000000) >>> 0; // never equals a live stamp below 2^31
    const heap = S.heap;
    heap.clear();
    const blocked = this.blockedNode, swim = this.swim, crouch = this.crouch, first = this.first, count = this.count, cellIdx = this.cellIdx;
    const H = this.h;
    const gk = cellIdx[goal], gi = gk % W, gj = (gk / W) | 0;
    // Octile distance, weighted a little: a tight estimate keeps A* from
    // flooding big open maps. Paths get string-pulled afterwards anyway.
    const est = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (dx + dz - 0.5858 * Math.min(dx, dz)) * 1.2; };
    // Any walkable floor in cell k reachable from node a?
    const via = (a, k) => {
      for (let m = first[k], e = m + count[k]; m < e; m++) if (!blocked[m] && this.move(a, m) === NAV_WALK) return true;
      return false;
    };
    const sk = cellIdx[start];
    gScore[start] = 0; came[start] = -1; seen[start] = stamp;
    heap.push(start, est(sk % W, (sk / W) | 0));
    let found = false, iter = 0;
    while (heap.size && iter++ < this.maxIter) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (seen[cur] === closedMark) continue;
      seen[cur] = closedMark;
      const ck = cellIdx[cur], ci = ck % W, cj = (ck / W) | 0;
      const gc = gScore[cur];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni;
        const diag = di && dj;
        if (diag && (!via(cur, cj * W + ci + di) || !via(cur, (cj + dj) * W + ci))) continue;
        for (let n = first[nk], e = n + count[nk]; n < e; n++) {
          if (blocked[n] || seen[n] === closedMark) continue;
          const mv = this.move(cur, n);
          if (!mv) continue;
          if (mv === NAV_JUMP && (diag || walkOnly)) continue;
          if (walkOnly && crouch[n]) continue;
          let c = (swim[n] ? SWIM_COST : crouch[n] ? CROUCH_COST : 1) + (noise ? noise.amt * patchNoise(ni, nj, noise.seed) : 0);
          if (diag) c *= 1.4142;
          if (mv === NAV_JUMP) c += JUMP_COST;
          const g = gc + c;
          if (seen[n] !== stamp || g < gScore[n]) {
            seen[n] = stamp;
            gScore[n] = g;
            came[n] = cur;
            heap.push(n, g + est(ni, nj));
          }
        }
      }
    }
    if (!found) return null;
    const nodes = [];
    for (let c = goal; c !== -1; c = came[c]) nodes.push(c);
    nodes.reverse();
    // String-pull: skip waypoints we can walk past directly, but never past
    // a jump (the point we jump up to is kept) or into or out of a crawl.
    const out = [];
    let anchorX = ax, anchorZ = az, anchorNode = start;
    let k = 1;
    if (nodes.length === 1) {
      const [x, z] = this.nodeCenter(goal);
      return [[x, z, this.floor[goal], crouch[goal] ? WP_CROUCH : 0]];
    }
    while (k < nodes.length) {
      // The furthest node we can reach in a straight walk without passing a
      // jump or a change between crawling and walking.
      let limit = k;
      while (limit + 1 < nodes.length && this.move(nodes[limit], nodes[limit + 1]) === NAV_WALK &&
        crouch[nodes[limit + 1]] === crouch[nodes[k]] && this.move(nodes[k - 1], nodes[k]) === NAV_WALK) limit++;
      let far = k;
      if (this.move(nodes[k - 1], nodes[k]) === NAV_WALK) {
        for (let m = limit; m > k; m--) {
          const [mx, mz] = this.nodeCenter(nodes[m]);
          if (this.walkNode(anchorX, anchorZ, mx, mz, anchorNode) === nodes[m]) { far = m; break; }
        }
      }
      const node = nodes[far];
      const [x, z] = this.nodeCenter(node);
      let flags = crouch[node] ? WP_CROUCH : 0;
      if (this.move(nodes[far - 1], node) === NAV_JUMP) flags |= WP_JUMP;
      out.push([x, z, this.floor[node], flags]);
      anchorX = x; anchorZ = z; anchorNode = node;
      k = far + 1;
    }
    return out;
  }
}

// 0..1, constant over 6-cell (3 m) patches, from a seed.
function patchNoise(i, j, seed) {
  let h = (Math.floor(i / 6) * 374761393 + Math.floor(j / 6) * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Binary min-heap on typed arrays (grows as needed); duplicates are allowed
// and skipped by the caller once a node is closed.
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
