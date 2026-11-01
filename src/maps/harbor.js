// "Harbor": hostage rescue on the docks. The map is an L, 88 m along each
// arm, wrapped around a stacked container terminal nobody can get into.
//   North arm - the sea laps its north edge (shallow, with piers). Red
//               spawns at its east end and holds four hostages in the big
//               warehouse next to it.
//   The elbow - an open container yard where the two arms meet, the same
//               walk from either spawn: this is where the teams collide.
//   West arm  - a channel crosses it (footbridge, or a high bridge you can
//               wade under). Blue spawns at its south end, where the
//               rescue zone is, so every hostage has to be walked all the
//               way round the corner.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xbfc3c4, bed: 0x5d6d6e,
  wall: 0xd7d2c6, wall2: 0x9aa4ad, roof: 0x6e7f8c, stone: 0xa8a9a3, step: 0xb3b4ae,
  crate: 0xb8743a, wood: 0x8b6a4a, bridge: 0x7d5c3d, rail: 0x3e4a55, barrel: 0xc9483f,
  teal: 0x2f8f9d, orange: 0xe0703d, yellow: 0xe3b43c, red: 0xc94c4c, blue: 0x3d6f9e, metal: 0x8d9aa8, crane: 0xe3b43c,
});

const B = 44;
const IN = -6; // the inner corner of the L
m.perimeter(-B, -B, B, B, 6, 'wall2');

// --- The container terminal filling the inside of the L ---
const CC = ['teal', 'orange', 'yellow', 'red', 'blue'];
for (let i = 0; i < 5; i++) {
  const a = IN + i * 10, c = CC[i], c2 = CC[(i + 2) % 5];
  m.block(a, IN, a + 10, IN + 3, i % 2 ? 7.8 : 5.2, c, 'metal');
  m.block(IN, a + (i ? 0 : 3), IN + 3, a + 10, i % 2 ? 5.2 : 7.8, c2, 'metal');
}
m.block(IN + 3, IN + 3, B, B, 5.2, 'wall2', 'metal');

// --- The sea along the north edge, with piers ---
m.water(-B, -B, B, -36);
m.bridge(-34, -43, -30, -35.4, 'z');
m.bridge(18, -41, 22, -35.4, 'z');
m.box(-14, -0.4, -42, -9, 0.6, -39, 'wood', 'blue', { kind: 'boat' });
m.box(30, -0.4, -41, 36, 0.6, -38, 'wood', 'red', { kind: 'boat' });

// --- Hostage warehouse (north arm, east) ---
m.building(8, -34, 28, -14, 5, {
  material: 'metal', col: 'wall2', roofCol: 'roof', t: 0.08,
  doors: { n: [[16, 19]], s: [[11, 14], [22, 25]], w: [[-29, -25], [-20, -17]], e: [[-26, -22]] },
});
// Inside: shelving, crates and an office in the corner.
m.box(10, 0, -31, 16, 2.2, -30.2, 'wood', 'wood');
m.box(19, 0, -24.5, 26, 2.2, -23.7, 'wood', 'wood');
m.crates(11, -17); m.crate(25.5, -17); m.crate(24.3, -17); m.crate(17, -21); m.crate(17, -19.8);
m.wallX(-27.3, 21, 28, 2.6, 0.12, 'wood', 'wood', [[22.5, 24.5]]); // office wall
m.wallZ(21, -34, -27.3, 2.6, 0.12, 'wood', 'wood');

// --- Red spawn (north arm, east end) ---
m.crates(40, -32); m.crate(31, -8.5); m.barrel(41, -8); m.barrel(40.4, -8.6); m.crate(30, -34);

// --- Between the warehouse and the elbow ---
const cont = (x0, z0, x1, z1, col, y = 0) => m.box(x0, y, z0, x1, y + 2.6, z1, 'metal', col, { kind: 'container' });
cont(-2, -30, 4, -27.5, 'teal'); cont(0, -16, 2.5, -10, 'orange'); cont(0, -16, 2.5, -10, 'blue', 2.6);
m.crates(5, -22); m.barrel(-3, -20); m.barrel(-2.4, -19.4);
// A dockside crane: legs you can hide behind and a beam overhead.
for (const [x, z] of [[-8, -36], [-2, -36]]) m.box(x - 0.35, 0, z - 0.35, x + 0.35, 11, z + 0.35, 'metal', 'crane');
m.box(-9, 11, -37, -1, 12, -35, 'metal', 'crane');

// --- The elbow: container yard ---
cont(-38, -30, -32, -27.5, 'yellow'); cont(-38, -30, -32, -27.5, 'red', 2.6);
cont(-26, -34, -23.5, -28, 'blue'); cont(-18, -24, -12, -21.5, 'teal');
cont(-30, -18, -27.5, -12, 'orange'); cont(-14, -12, -8, -9.5, 'red');
cont(-40, -8, -34, -5.5, 'teal'); cont(-24, -8, -21.5, -2, 'yellow');
m.crates(-20, -30); m.crate(-34, -20); m.crate(-12, -30); m.crate(-10.8, -30); m.barrel(-24, -14); m.crates(-40, -15);

// --- West arm: the channel ---
m.water(-B, 6, IN, 11);
m.bridge(-38, 5.4, -34, 11.6, 'z');
m.highBridgeZ(-20, -16, 6, 11, 2.5);
m.crate(-28, 3); m.crate(-12, 3.5); m.barrel(-40, 13.5); m.crate(-10, 14);

// --- West arm: dock offices and the Blue side ---
m.building(-44, 18, -30, 28, 3.8, { col: 'wall', doors: { e: [[21, 24]], s: [[-38, -35]] } });
m.crate(-41.5, 20.5); m.crate(-33, 25.5);
cont(-22, 18, -19.5, 24, 'blue'); cont(-14, 24, -8, 26.5, 'orange');
m.box(-28, 0, 31, -22, 1.1, 31.6, 'concrete', 'stone');
m.crates(-12, 33); m.barrel(-40, 32); m.crate(-24, 42.5);

const ground = m.finishGround(-B, -B, B, B);

const center = [-20, -20];
export const HARBOR = {
  id: 'harbor',
  name: 'Harbor',
  type: 'hostage',
  size: 'Medium',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [36, 0, -24], [38, 0, -12], [24, 0, -10], [12, 0, -9], [4, 0, -34], [-4, 0, -24],
    [-14, 0, -33], [-29, 0, -33], [-40, 0, -24], [-22, 0, -24], [-34, 0, -12], [-12, 0, -16],
    [-28, 0, 0], [-12, 0, 0], [-38, 0, 15], [-26, 0, 22], [-12, 0, 20], [-36, 0, 38],
    [-18, 0, 38], [-10, 0, 41],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(33, -28, 42, -12, 2, 4, center),
    blue: spawnGrid(-38, 34, -14, 42, 4, 2, center),
  },
  hostages: [[11, 0, -28.5], [13, 0, -27.5], [23.5, 0, -31], [25.5, 0, -29.5]],
  rescue: [{ min: [-43, 33], max: [-8, 43] }],
  bounds: { min: [-B, -B], max: [B, B] },
  sky: { top: 0x6f9fca, bottom: 0xdbe5ea },
  groundColor: m.C.ground,
  bedColor: m.C.bed,
};
