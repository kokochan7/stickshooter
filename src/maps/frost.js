// "Frost": hostage rescue in a snowy mountain valley. The map is an
// hourglass, 80 m wide at both ends and 108 m long, pinched to 44 m in the
// middle by rock walls. A stream runs across the waist under a log
// footbridge and an old stone bridge, with pines for cover.
//   North - Red spawns behind the lodge and guards four hostages inside
//           (thin wooden walls: most guns shoot through).
//   South - Blue spawns by the cabins, where the rescue zone is, and has to
//           cross the whole valley to the lodge and back.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xeef2f6, bed: 0x6f8592,
  wall: 0x9c6b43, wall2: 0x7f5636, roof: 0x5b6670, stone: 0x9ea4a8, step: 0xb0b6ba,
  crate: 0xa0683a, wood: 0x8a5a32, bridge: 0x7a5032, rail: 0x4a3322, barrel: 0x506470,
  trunk: 0x6b4a30, leaves: 0x2f6b4a, snow: 0xf7fafc, fire: 0x3a3f45, rock: 0x8a9399,
});

const X = 40, Z = 54;
m.perimeter(-X, -Z, X, Z, 8, 'rock');

// Rock walls pinch the valley in the middle, in steps.
for (const s of [-1, 1]) {
  m.block(s * 22, -10, s * X, 10, 10, 'rock');
  m.block(s * 30, -20, s * X, -10, 9, 'rock'); m.block(s * 30, 10, s * X, 20, 9, 'rock');
  m.block(s * 35, -26, s * X, -20, 8, 'rock'); m.block(s * 35, 20, s * X, 26, 8, 'rock');
}

// --- Red spawn: behind the lodge ---
m.pine(-30, -50); m.pine(30, -49); m.crates(-22, -51); m.crate(22, -51.5);

// --- The lodge ---
// Outer walls are wood (bullets go through), with a stone chimney.
m.building(-18, -46, 18, -28, 4.5, {
  material: 'wood', col: 'wall', roofCol: 'roof', t: 0.15,
  doors: { n: [[-8, -5], [5, 8]], s: [[-2, 2], [-14, -11.5], [11.5, 14]], w: [[-38, -35.5]], e: [[-40, -37.5]] },
});
// Rooms: a hall in the middle, a dining room west and a study east.
m.wallZ(-6, -45.85, -28.15, 3, 0.12, 'wood', 'wall2', [[-33, -31]]);
m.wallZ(6, -45.85, -28.15, 3, 0.12, 'wood', 'wall2', [[-38, -36], [-32, -30]]);
m.box(-1.2, 0, -45.85, 1.2, 4.5, -44, 'concrete', 'stone'); // fireplace + chimney
m.box(-0.8, 4.5, -45.6, 0.8, 6.2, -44.3, 'concrete', 'stone');
m.box(-13.5, 0, -38, -10.5, 0.9, -35, 'wood', 'wood'); // dining table
m.crate(-16, -44.5); m.crate(16, -44.5); m.box(10, 0, -45.85, 15, 2, -45.2, 'wood', 'wood'); // bookcase
m.crate(3.5, -31); m.crate(-3.5, -30.5, 1.0);

// --- Lodge grounds ---
m.pine(-28, -36); m.pine(-32, -28, 1.2); m.pine(27, -34); m.pine(31, -29, 1.1);
m.box(-24, 0, -24, -20, 1.0, -23.4, 'wood', 'wood'); // woodpile
m.box(19, 0, -22, 23, 1.0, -21.4, 'wood', 'wood');
m.crate(-9, -21); m.crate(10, -19); m.box(-3, 0, -24, 3, 1.1, -23.4, 'concrete', 'stone'); // low wall
m.pine(-14, -15); m.pine(15, -13, 0.9);

// --- The stream, across the waist ---
m.water(-22, -3, 22, 2);
m.bridge(-14, -3.6, -11, 2.6, 'z'); // log footbridge
m.highBridgeZ(9, 13, -3, 2, 2.5); // old stone bridge
m.box(-4, -0.4, -1, 1, 0.3, 0, 'wood', 'trunk'); // fallen log in the water
m.box(17, -0.4, -1.5, 19, 0.5, 0.5, 'concrete', 'stone'); // boulder
m.crate(-19, -6); m.crate(19, 6);

// --- South woods ---
m.pine(-15, 14); m.pine(-5, 9); m.pine(4, 13, 1.2); m.pine(16, 12); m.pine(-24, 24, 0.9); m.pine(24, 25);
m.box(-4, 0, 20, 2, 1.1, 20.6, 'concrete', 'stone');
m.crates(-28, 30); m.crate(28, 18 + 12); m.pine(-10, 26); m.pine(10, 22, 0.9);

// --- Cabins (Blue side) ---
m.building(-30, 32, -16, 42, 3.6, { material: 'wood', col: 'wall2', t: 0.15, doors: { n: [[-25.5, -23]], e: [[36, 38.5]], s: [[-21, -18.5]] } });
m.building(16, 32, 30, 42, 3.6, { material: 'wood', col: 'wall2', t: 0.15, doors: { n: [[23, 25.5]], w: [[36, 38.5]], s: [[18.5, 21]] } });
m.crate(-27.5, 39.5); m.crate(27.5, 34.5);
m.box(-2, 0, 36, 2, 0.6, 40, 'concrete', 'fire'); // fire pit
m.crate(-8, 43); m.crate(8, 33); m.barrel(-10, 35);

// --- Blue spawn and the rescue zone (south end) ---
m.pine(-32, 50); m.pine(32, 49); m.crates(-22, 51); m.crate(22, 51.5);

const ground = m.finishGround(-X, -Z, X, Z);

const center = [0, 0];
export const FROST = {
  id: 'frost',
  name: 'Frost',
  type: 'hostage',
  size: 'Large',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-12, 0, -50], [12, 0, -50], [-30, 0, -42], [30, 0, -40], [0, 0, -36], [-12, 0, -32],
    [12, 0, -33], [-26, 0, -20], [26, 0, -18], [0, 0, -14], [-18, 0, 5], [0, 0, 7],
    [18, 0, -6], [-34, 0, 32], [-20, 0, 26], [20, 0, 27], [30, 0, 45], [6, 0, 48],
    [-12, 0, 48],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-14, -53, 14, -48, 4, 2, center),
    blue: spawnGrid(-14, 47, 14, 52, 4, 2, center),
  },
  hostages: [[-12, 0, -42], [-14, 0, -32], [12, 0, -41], [13.5, 0, -33]],
  rescue: [{ min: [-16, 44], max: [16, 54] }],
  bounds: { min: [-X, -Z], max: [X, Z] },
  sky: { top: 0x8ea9c4, bottom: 0xe4ebf1 },
  groundColor: m.C.ground,
  ground: 'snow', // footstep surface for open ground
  bedColor: m.C.bed,
};
