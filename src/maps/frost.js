// "Frost": hostage rescue at a snowed-in mountain lodge. Red guards four
// hostages inside the lodge (thin wooden walls: most guns shoot through).
// A stream crosses the middle of the map under a log footbridge and an old
// stone bridge, with pines for cover. Blue starts by the cabins in the south,
// where the rescue zone is.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xeef2f6, bed: 0x6f8592,
  wall: 0x9c6b43, wall2: 0x7f5636, roof: 0x5b6670, stone: 0x9ea4a8, step: 0xb0b6ba,
  crate: 0xa0683a, wood: 0x8a5a32, bridge: 0x7a5032, rail: 0x4a3322, barrel: 0x506470,
  trunk: 0x6b4a30, leaves: 0x2f6b4a, snow: 0xf7fafc, fire: 0x3a3f45,
});

const B = 34;
m.perimeter(-B, -B, B, B, 7, 'stone');

// --- The lodge (Red side) ---
// Outer walls are wood (bullets go through), with a stone chimney.
m.building(-16, -30, 16, -12, 4.5, {
  material: 'wood', col: 'wall', roofCol: 'roof', t: 0.15,
  doors: { s: [[-2, 2], [-13, -10.5], [10.5, 13]], w: [[-22, -19.5]], e: [[-25, -22.5]], n: [[-6, -3.5]] },
});
// Rooms: a hall in the middle, a dining room west and a study east.
m.wallZ(-6, -29.85, -12.15, 3, 0.12, 'wood', 'wall2', [[-17, -15]]);
m.wallZ(6, -29.85, -12.15, 3, 0.12, 'wood', 'wall2', [[-22, -20], [-16, -14]]);
m.box(-1.2, 0, -29.85, 1.2, 4.5, -28, 'concrete', 'stone'); // fireplace + chimney
m.box(-0.8, 4.5, -29.6, 0.8, 6.2, -28.3, 'concrete', 'stone');
m.box(-12.5, 0, -22, -9.5, 0.9, -19, 'wood', 'wood'); // dining table
m.crate(-14.5, -28.5); m.crate(14.5, -28.5); m.box(9, 0, -29.85, 14, 2, -29.2, 'wood', 'wood'); // bookcase
m.crate(3.5, -15); m.crate(-3.5, -14.5, 1.0);

// Red spawn: behind the lodge.
m.pine(-24, -30); m.pine(24, -29); m.crates(-20, -32); m.crate(20, -32.5);

// --- Lodge grounds ---
m.pine(-26, -18); m.pine(-28, -10, 1.2); m.pine(25, -16); m.pine(28, -8, 1.1);
m.box(-21, 0, -8, -17, 1.0, -7.4, 'wood', 'wood'); // woodpile
m.box(17, 0, -9, 21, 1.0, -8.4, 'wood', 'wood');
m.crate(-8, -7); m.crate(9, -6); m.box(-3, 0, -9, 3, 1.1, -8.4, 'concrete', 'stone'); // low wall

// --- The stream ---
m.water(-B, -2, B, 2.5);
m.bridge(-14, -2.6, -11, 3.1, 'z'); // log footbridge
m.highBridgeZ(9, 13, -2, 2.5, 2.5); // old stone bridge
m.box(-26, -0.4, -0.5, -21, 0.3, 0.5, 'wood', 'trunk'); // fallen log in the water
m.box(22, -0.4, -1, 24, 0.5, 1, 'concrete', 'stone'); // boulder

// --- South woods ---
m.pine(-24, 9); m.pine(-6, 8); m.pine(4, 11, 1.2); m.pine(22, 9); m.pine(-15, 14, 0.9); m.pine(15, 17);
m.box(-4, 0, 16, 2, 1.1, 16.6, 'concrete', 'stone');
m.crates(-28, 18); m.crate(28, 14);

// --- Cabins (Blue side) ---
m.building(-26, 22, -14, 31, 3.6, { material: 'wood', col: 'wall2', t: 0.15, doors: { n: [[-21.5, -19]], e: [[25, 27.5]] } });
m.building(14, 22, 26, 31, 3.6, { material: 'wood', col: 'wall2', t: 0.15, doors: { n: [[18.5, 21]], w: [[25, 27.5]] } });
m.box(-2, 0, 25, 2, 0.6, 29, 'concrete', 'fire'); // fire pit
m.crate(-8, 30); m.crate(8, 24); m.barrel(-10, 24);

const ground = m.finishGround(-B, -B, B, B);

const center = [0, 0];
export const FROST = {
  id: 'frost',
  name: 'Frost',
  type: 'hostage',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-10, 0, -32], [10, 0, -32], [-28, 0, -24], [28, 0, -22], [0, 0, -20], [-11, 0, -16],
    [11, 0, -18], [-24, 0, -4], [24, 0, -4], [0, 0, -5], [-20, 0, 7], [0, 0, 6],
    [18, 0, 7], [-29, 0, 28], [-20, 0, 18], [20, 0, 19], [29, 0, 29], [6, 0, 32],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-12, -33.5, 12, -31, 4, 1, [0, 0]).concat(spawnGrid(-30, -26, -24, -20, 2, 2, [0, 0])),
    blue: spawnGrid(-10, 26, 10, 33, 4, 2, [0, 0]),
  },
  hostages: [[-10, 0, -26], [-12, 0, -16], [10, 0, -25], [11.5, 0, -17]],
  rescue: [{ min: [-12, 23], max: [12, 34] }],
  bounds: { min: [-B, -B], max: [B, B] },
  sky: { top: 0x8ea9c4, bottom: 0xe4ebf1 },
  groundColor: m.C.ground,
  bedColor: m.C.bed,
};
