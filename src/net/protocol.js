// Wire protocol shared by the Durable Object (worker/room.js) and the browser
// (src/net/online.js). JSON for now; a binary encoding can replace pack/unpack
// later without touching either side's game logic.
//
// client -> server
//   { t: 'hello', v, name }                    v = PROTOCOL_VERSION; the room's mode comes from its name (see roomMode)
//   { t: 'cmds', seq, vt, cmds: [cmd, ...] }   seq = seq of the LAST cmd in the batch,
//                                               vt = server time the client is viewing others at
//   { t: 'ping', c }
// server -> client
//   { t: 'welcome', id, mode, time, tickRate, snapEvery }
//   { t: 'snap', time, ack, me, players: [...], events: [...] }
//   { t: 'pong', c, time }
//   { t: 'full' }  room is full
//   (an outdated client is closed with code 4002 and a "refresh" reason)

export const PROTOCOL_VERSION = 2;
export const SNAP_EVERY = 4; // ticks per snapshot: 128 Hz sim -> 32 Hz snapshots
export const SEND_EVERY = 2; // client sends a cmd batch every 2 ticks (64 Hz)
export const INTERP_DELAY = 0.1; // remote players are drawn 100 ms in the past
export const MAX_LAG_COMP = 0.2; // the server rewinds at most 200 ms
export const MAX_HUMANS = 10;
export const BOT_FILL = 0; // bots keep the room at this many players until humans fill it (0 = no bots)
export const DEFAULT_ROOM = 'public';
export const TEAMS_ROOM = 'public-teams';

// A room plays Teams when its name ends in "teams"; every other room is FFA.
export function roomMode(room) {
  return /(^|-)teams$/.test(room) ? 'teams' : 'ffa';
}

// The quick play rooms PLAY ONLINE picks from, by mode.
export const PUBLIC_ROOMS = { ffa: DEFAULT_ROOM, teams: TEAMS_ROOM };

// PLAY ONLINE should put everyone together, so when the room for your mode is
// empty but the other mode has people, join them instead of sitting alone.
// counts = { [room]: humans }, as GET /api/rooms returns it.
export function pickRoom(mode, counts = {}) {
  const mine = PUBLIC_ROOMS[mode] ?? DEFAULT_ROOM;
  if (counts[mine] > 0) return mine;
  let best = mine;
  for (const room of Object.values(PUBLIC_ROOMS)) if ((counts[room] ?? 0) > (counts[best] ?? 0)) best = room;
  return best;
}

// Everything the owning client needs to predict and draw itself.
const OWN = [
  'team', 'alive', 'respawnAt', 'pos', 'vel', 'yaw', 'pitch', 'onGround', 'ducked', 'duckAmount',
  'stamina', 'jumpHeld', 'tagMul', 'health', 'armor', 'helmet', 'money', 'kills', 'deaths', 'headshots',
  'weapons', 'active', 'lastActive', 'nextAttack', 'deployEnd', 'reloading', 'reloadEnd',
  'shotsFired', 'pistolAcc', 'accuracy', 'lastFire', 'punch', 'zoom', 'spin', 'landSpeed',
];
// What other clients need to draw, interpolate and list someone.
const OTHER = [
  'id', 'name', 'team', 'isBot', 'alive', 'pos', 'vel', 'yaw', 'pitch', 'onGround', 'ducked', 'duckAmount',
  'health', 'kills', 'deaths', 'headshots', 'active', 'reloading', 'zoom', 'spin',
];

function pick(p, keys) {
  const o = {};
  for (const k of keys) o[k] = p[k];
  return o;
}

export function packOwn(p) { return pick(p, OWN); }

export function packOther(p) {
  const o = pick(p, OTHER);
  // Others only need the active gun's id to draw it.
  const w = p.weapons[p.active];
  o.weapon = w ? w.id : null;
  return o;
}

// Cmd fields the server accepts; anything else a client sends is dropped.
export function sanitizeCmd(c) {
  const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  const slot = c.slot === 'primary' || c.slot === 'secondary' ? c.slot : null;
  let actions = null;
  if (Array.isArray(c.actions)) {
    actions = c.actions.slice(0, 4)
      .filter((a) => a && ((a.type === 'buy' && typeof a.item === 'string') || (a.type === 'team' && (a.team === 'red' || a.team === 'blue'))))
      .map((a) => (a.type === 'buy' ? { type: 'buy', item: a.item.slice(0, 24) } : { type: 'team', team: a.team }));
    if (!actions.length) actions = null;
  }
  return {
    fwd: Math.sign(num(c.fwd, -1, 1)), side: Math.sign(num(c.side, -1, 1)),
    jump: !!c.jump, duck: !!c.duck, walk: !!c.walk, fire: !!c.fire, alt: !!c.alt,
    reload: !!c.reload, slot, lastWeapon: !!c.lastWeapon,
    yaw: num(c.yaw, -1e6, 1e6), pitch: num(c.pitch, -Math.PI / 2, Math.PI / 2), actions,
  };
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return s || 'Player';
}
