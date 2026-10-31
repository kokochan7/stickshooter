// "Harbor": hostage rescue on the docks. The sea laps the north edge, with
// piers running out over the shallows. Red holds four hostages in the big
// warehouse by the water. Blue starts in the south-east and has to bring the
// hostages back to the rescue zone at its spawn. A channel cuts the east
// side, crossed by a footbridge and a high bridge you can wade under.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xbfc3c4, bed: 0x5d6d6e,
  wall: 0xd7d2c6, wall2: 0x9aa4ad, roof: 0x6e7f8c, stone: 0xa8a9a3, step: 0xb3b4ae,
  crate: 0xb8743a, wood: 0x8b6a4a, bridge: 0x7d5c3d, rail: 0x3e4a55, barrel: 0xc9483f,
  teal: 0x2f8f9d, orange: 0xe0703d, yellow: 0xe3b43c, red: 0xc94c4c, blue: 0x3d6f9e, metal: 0x8d9aa8, crane: 0xe3b43c,
});

const B = 34;
m.perimeter(-B, -B, B, B, 6, 'wall2');

// --- The sea along the north edge, with piers ---
m.water(-B, -B, B, -24);
m.bridge(-24, -33, -20, -24, 'z', { deck: 0.15 });
m.bridge(4, -31, 8, -24, 'z', { deck: 0.15 });
m.box(-16, -0.4, -31, -11, 0.6, -28, 'wood', 'blue', { kind: 'boat' });
m.box(14, -0.4, -30, 20, 0.6, -27, 'wood', 'red', { kind: 'boat' });

// --- Hostage warehouse ---
m.building(-14, -22, 10, -6, 5, {
  material: 'metal', col: 'wall2', roofCol: 'roof', t: 0.08,
  doors: { n: [[-4, 0]], s: [[-10, -7], [3, 6]], w: [[-16, -13]], e: [[-12, -9]] },
});
// Inside: shelving, crates and an office in the corner.
m.box(-11, 0, -19, -3, 2.2, -18.2, 'wood', 'wood');
m.box(1, 0, -19, 7, 2.2, -18.2, 'wood', 'wood');
m.crates(-11, -10); m.crate(6.5, -9); m.crate(7.7, -9); m.crate(-2, -13); m.crate(-0.8, -13);
m.wallX(-14.3, 3, 10, 2.6, 0.12, 'wood', 'wood', [[4, 6]]); // office wall
m.wallZ(3, -22, -14.3, 2.6, 0.12, 'wood', 'wood');

// --- Red spawn (north-west yard) ---
m.crates(-28, -14); m.crate(-20, -20); m.barrel(-30, -20); m.barrel(-29.4, -19.4);

// --- Container yard (middle) ---
const cont = (x0, z0, x1, z1, col, y = 0) => m.box(x0, y, z0, x1, y + 2.6, z1, 'metal', col, { kind: 'container' });
cont(-26, -2, -20, 0.5, 'teal'); cont(-26, -2, -20, 0.5, 'orange', 2.6);
cont(-14, 2, -11.5, 8, 'red'); cont(-6, -2, 0, 0.5, 'yellow'); cont(3, 4, 5.5, 10, 'blue');
cont(-22, 10, -16, 12.5, 'orange'); cont(-4, 12, 2, 14.5, 'teal'); cont(-4, 12, 2, 14.5, 'red', 2.6);
cont(-30, 16, -27.5, 22, 'yellow'); cont(-12, 18, -6, 20.5, 'blue');
m.crate(-8, 6); m.crate(7, 0); m.crate(-18, 4); m.crates(-26, 6); m.barrel(-2, 4); m.barrel(-1.4, 4.6);
// A dockside crane: legs you can hide behind and a beam overhead.
for (const [x, z] of [[-2, -26], [4, -26]]) m.box(x - 0.35, 0, z - 0.35, x + 0.35, 11, z + 0.35, 'metal', 'crane');
m.box(-3, 11, -27, 5, 12, -25, 'metal', 'crane');

// --- The channel (east) ---
m.water(18, -24, 23, 14);
m.bridge(17.4, -16, 23.6, -12, 'x');
m.highBridgeX(2, 6, 18, 23, 2.5);
m.bridge(17.4, 10, 23.6, 14, 'x');
// East bank warehouses and crates.
m.building(26, -20, B, -8, 4, { col: 'wall', doors: { w: [[-16, -12]], s: [[28, 31]] } });
m.crates(28, -4); m.crate(30, 6); m.crate(25.5, 8); m.barrel(31, -2);
m.crate(13, -10); m.crate(13, -8.8); m.box(11, 0, -2, 11.6, 1.1, 3, 'concrete', 'stone');

// --- Blue side (south) and the rescue zone ---
m.building(-B, 24, -18, B, 3.8, { col: 'wall', doors: { e: [[27, 30]], n: [[-26, -23]] } });
m.box(8, 0, 20, 14, 1.1, 20.6, 'concrete', 'stone');
m.crates(-8, 26); m.crate(4, 27); m.barrel(16, 25); m.crate(30, 20); m.crate(28.8, 20);

const ground = m.finishGround(-B, -B, B, B);

const center = [0, 0];
export const HARBOR = {
  id: 'harbor',
  name: 'Harbor',
  type: 'hostage',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-28, 0, -18], [-18, 0, -14], [-5, 0, -9], [-8, 0, -16], [0, 0, -3], [-28, 0, 4],
    [-10, 0, 12], [8, 0, 16], [14, 0, 6], [28, 0, -12], [29, 0, 2], [26, 0, 16],
    [-24, 0, 18], [-14, 0, 28], [4, 0, 30], [20, 0, 28], [13, 0, -20], [-6, 0, 6],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-32, -20, -22, -10, 3, 3, [0, 0]),
    blue: spawnGrid(14, 26, 30, 32, 4, 2, [0, 0]),
  },
  hostages: [[-8, 0, -15.5], [-6.5, 0, -16.5], [5, 0, -16], [6.5, 0, -16.8]],
  rescue: [{ min: [12, 24], max: [32, 33] }],
  bounds: { min: [-B, -B], max: [B, B] },
  sky: { top: 0x6f9fca, bottom: 0xdbe5ea },
  groundColor: m.C.ground,
  bedColor: m.C.bed,
};
