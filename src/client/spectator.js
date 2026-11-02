// Spectating while you're dead in a round, CS 1.6 style:
//   left click / FIRE    next player
//   right click / SCOPE  previous player
//   jump                 next camera mode: chase cam -> first person -> free roam
// Free roam flies where you look (WASD, crouch to sink, walk to go slow) and
// passes through walls like CS's free look. No DOM or three.js in here, so
// it can be tested in node.

export const SPEC_MODES = ['chase', 'eye', 'free'];
export const SPEC_LABELS = { chase: 'Chase cam', eye: 'First person', free: 'Free roam' };
export const FREE_SPEED = 10; // m/s
export const FREE_SLOW = 3.5; // m/s while holding walk

// Players you can watch: alive and not you. Teammates come first, then
// everyone else, each in join order.
export function spectatable(players, me) {
  const alive = players.filter((p) => p.alive && p !== me);
  const mate = (p) => !!me && me.team !== 'ffa' && p.team === me.team;
  return [...alive.filter(mate), ...alive.filter((p) => !mate(p))];
}

// The next (dir 1) or previous (dir -1) player after `id` in the list,
// wrapping around. If `id` isn't there, start from the front (or the back).
export function cycleTarget(list, id, dir) {
  if (!list.length) return null;
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return dir < 0 ? list[list.length - 1] : list[0];
  return list[(i + dir + list.length) % list.length];
}

// Axis-aligned bounds of a World's boxes, padded, to keep the free cam on the map.
export function worldBounds(world, pad = 4) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of world.boxes) {
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < min[k]) min[k] = b.min[k];
      if (b.max[k] > max[k]) max[k] = b.max[k];
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min: [min[0] - pad, min[1], min[2] - pad], max: [max[0] + pad, max[1] + 12, max[2] + pad] };
}

export class Spectator {
  constructor() {
    this.mode = 'chase';
    this.id = null; // who we're watching
    this.pos = [0, 0, 0]; // free cam position
    this.bounds = null;
  }

  // The player being watched (picking a new one if they died or left), or null.
  target(players, me) {
    const list = spectatable(players, me);
    let t = this.id != null ? list.find((p) => p.id === this.id) : null;
    if (!t) { t = list[0] ?? null; this.id = t?.id ?? null; }
    return t;
  }

  // Click: switch player. From free roam this jumps back to the chase cam.
  cycle(players, me, dir) {
    const t = cycleTarget(spectatable(players, me), this.id, dir);
    this.id = t?.id ?? null;
    if (t && this.mode === 'free') this.mode = 'chase';
    return t;
  }

  // Jump: next camera mode. `from` is where the camera is now, so free roam
  // starts right there instead of snapping somewhere else.
  nextMode(from) {
    this.mode = SPEC_MODES[(SPEC_MODES.indexOf(this.mode) + 1) % SPEC_MODES.length];
    if (this.mode === 'free' && from) this.pos = [from[0], from[1], from[2]];
    return this.mode;
  }

  // Fly the free cam. fwd/side/down are -1..1 like the move keys.
  fly(dt, yaw, pitch, fwd, side, down, slow = false) {
    const speed = (slow ? FREE_SLOW : FREE_SPEED) * dt;
    const cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    // Forward follows the view, pitch included; right stays level.
    let x = -sy * cp * fwd + cy * side;
    let y = Math.sin(pitch) * fwd - down;
    let z = -cy * cp * fwd - sy * side;
    const len = Math.hypot(x, y, z);
    if (len > 1) { x /= len; y /= len; z /= len; }
    const p = this.pos;
    p[0] += x * speed; p[1] += y * speed; p[2] += z * speed;
    const b = this.bounds;
    if (b) for (let k = 0; k < 3; k++) p[k] = Math.min(b.max[k], Math.max(b.min[k], p[k]));
    return p;
  }
}
