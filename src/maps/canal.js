// "Canal": bomb defusal in a sunny canal town. A long map, 60 m wide and
// 128 m from end to end, with the two spawns at opposite ends:
//   Red  - the north yard, behind an old town of two houses and three lanes
//   Blue - the south street, behind two shops
// The canal crosses the north half. Red has three ways over it (the west
// footbridge, the high stone bridge in the middle, the east footbridge) or
// can wade it anywhere. Past the canal the two bomb sites sit either side of
// a market street, closer to Blue (so defenders get there first, as in CS)
// but far enough that both teams have to walk:
//   Site B - a walled courtyard with a well, west
//   Site A - a plaza with a fountain, east
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xd3c6a9, bed: 0x7d7a5e,
  wall: 0xeadfc6, wall2: 0xdcb88f, roof: 0xb85b3c, stone: 0xb4a688, step: 0xc6b99d,
  crate: 0xb8743a, wood: 0xa86b3c, bridge: 0x9a6a3f, rail: 0x5b4632, barrel: 0x4f7380,
  awning: 0x2f8f9d, awning2: 0xd9563e, boat: 0x3d6f9e, metal: 0x8d9aa8, house: 0xe6c9a0,
});

const W = 30, L = 64;
m.perimeter(-W, -L, W, L, 7, 'wall2');

// Both spawn streets are narrower than the town: rows of houses close in
// their sides.
m.block(-W, -L, -24, -48, 7, 'house'); m.block(24, -L, W, -48, 7, 'house');
m.block(-W, 48, -24, L, 7, 'house'); m.block(24, 48, W, L, 7, 'house');

// --- Red spawn yard (north end) ---
m.crates(-17, -58); m.crate(17, -60); m.barrel(-21, -51); m.barrel(20.5, -52.5);
m.crate(-1.5, -50, 1.0); m.crate(4, -63); m.box(-8, 0, -52.4, -4, 1.1, -51.8, 'concrete', 'stone');

// --- Old town (Red side): two houses and three lanes ---
const H = 4.2;
m.building(-18, -44, -5, -26, H, { col: 'wall', doors: { n: [[-14, -11.5]], e: [[-38, -35.5]], s: [[-13, -10.5]], w: [[-32, -29.5]] } });
m.building(5, -44, 18, -26, H, { col: 'wall2', doors: { n: [[11.5, 14]], w: [[-32, -29.5]], s: [[10.5, 13]], e: [[-38, -35.5]] } });
// Inside the houses.
m.crate(-15.5, -41.5); m.crate(-14.3, -41.5); m.box(-12, 0, -35.3, -8, 1, -34.7, 'wood', 'wood'); m.crate(-7.5, -28.5);
m.crates(15.5, -41.5); m.box(8, 0, -35.3, 12, 1, -34.7, 'wood', 'wood'); m.crate(7.5, -28.5); m.crate(8.7, -28.5);
// West lane, mid lane and east lane cover.
m.crate(-26, -40); m.box(-29, 0, -33, -27, 1.1, -32.4, 'concrete', 'stone'); m.crates(-21, -28);
m.box(-3.4, 0, -40, -2.8, 1.1, -36, 'concrete', 'stone'); m.box(2.8, 0, -33, 3.4, 1.1, -29, 'concrete', 'stone'); m.crate(0, -45.5);
m.crate(26, -38); m.box(27, 0, -30, 29, 1.1, -29.4, 'concrete', 'stone'); m.crates(21.5, -44);

// --- The canal ---
m.water(-W, -16, W, -10);
m.bridge(-24, -16.6, -20, -9.4, 'z');
m.highBridgeZ(-2, 2, -16, -10, 2.5);
m.bridge(20, -16.6, 24, -9.4, 'z');
// Moored boats: cover for anyone wading.
m.box(8, -0.4, -14.6, 13, 0.55, -12.6, 'wood', 'boat');
m.box(-13, -0.4, -13.4, -9, 0.55, -11.6, 'wood', 'boat');
// Bollards and crates along both quays.
for (const x of [-28, -14, 9, 27]) m.box(x - 0.25, 0, -16.8, x + 0.25, 0.7, -16.3, 'metal', 'metal');
for (const x of [-27, -8, 14, 28]) m.box(x - 0.25, 0, -9.7, x + 0.25, 0.7, -9.2, 'metal', 'metal');
m.crates(-27, -19.5); m.crate(-12, -19); m.crate(-10.8, -19); m.barrel(6, -19.5); m.barrel(6.8, -18.9); m.crates(27, -20);
m.crate(-6, -6.5); m.barrel(8, -6.5); m.crate(26.5, -6); m.crate(-26.5, -6.5);

// --- Site B courtyard (west) ---
m.wallX(-1, -W, -12, 3, 0.4, 'concrete', 'wall2', [[-25, -19.5]]);
m.wallZ(-12.4, -0.6, 24, 3, 0.4, 'concrete', 'wall2', [[8, 11.5]]);
m.wallX(24, -W, -12, 3, 0.4, 'concrete', 'wall2', [[-20, -16.5]]);
m.box(-22, 0, 10, -20, 1.0, 12, 'concrete', 'stone'); // the well
m.box(-21.6, 1.0, 10.4, -20.4, 2.2, 11.6, 'concrete', 'stone');
m.crates(-27, 4); m.crate(-25.8, 4); m.crate(-27.5, 19.5); m.crate(-15.5, 4.5);
m.box(-17, 0, 16.5, -14.6, 1.1, 18, 'wood', 'wood'); // cart
m.box(-27, 0, 13, -26.4, 1.1, 17, 'concrete', 'stone');

// --- Market street (middle) ---
const stall = (x, z, col) => {
  m.box(x - 1.4, 0, z - 0.4, x + 1.4, 1.0, z + 0.4, 'wood', 'wood');
  m.box(x - 1.6, 2.3, z - 1.2, x + 1.6, 2.45, z + 0.6, 'wood', col);
};
stall(-7, 4, 'awning'); stall(7, 9, 'awning2'); stall(-7, 15, 'awning2'); stall(6.5, 20, 'awning');
m.crate(-2.5, 7); m.barrel(2.5, 13); m.barrel(3.1, 13.6); m.crate(0, 22.5, 1.0);

// --- Site A plaza (east) ---
m.wallX(-1, 12.4, W, 3, 0.4, 'concrete', 'wall2', [[17, 23]]);
m.wallZ(12, -0.6, 24, 3, 0.4, 'concrete', 'wall2', [[13, 16.5]]);
m.wallX(24, 12, W, 3, 0.4, 'concrete', 'wall2', [[22, 25.5]]);
m.box(19, 0, 9, 23, 0.7, 13, 'concrete', 'stone'); // fountain basin
m.box(20.6, 0.7, 10.6, 21.4, 2.0, 11.4, 'concrete', 'stone');
m.crates(27.5, 3.5); m.crate(27.5, 4.7); m.crate(15, 20.5); m.crates(27, 20); m.crate(15.5, 3.5);
m.box(26.4, 0, 9, 27, 1.1, 13, 'concrete', 'stone');

// --- Blue side: two shops between the sites and the spawn ---
m.building(-26, 30, -14, 42, 3.8, { col: 'house', doors: { n: [[-21.5, -19]], s: [[-19, -16.5]], e: [[34, 36.5]] } });
m.building(14, 30, 26, 42, 3.8, { col: 'house', doors: { n: [[19, 21.5]], s: [[16.5, 19]], w: [[34, 36.5]] } });
m.crate(-23.5, 39.5); m.crate(-16.5, 32.5); m.crates(23.5, 32.5); m.crate(16.5, 39.5);
// The square between them.
m.box(-3, 0, 33, 3, 1.1, 33.6, 'concrete', 'stone'); m.crate(-6.5, 38); m.crate(6.5, 29); m.barrel(-9, 44); m.barrel(9.5, 44.5);
m.crates(-28, 27); m.crate(28, 27); m.crates(-28, 45); m.crate(28, 45.5);

// --- Blue spawn street (south end) ---
m.crates(-17, 58); m.crate(17, 60); m.barrel(-21, 51); m.barrel(20.5, 52.5); m.crate(1.5, 50, 1.0); m.crate(-4, 63);

const ground = m.finishGround(-W, -L, W, L);

const center = [0, 0];
export const CANAL = {
  id: 'canal',
  name: 'Canal',
  type: 'bomb',
  size: 'Large',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-12, 0, -58], [12, 0, -55], [-26, 0, -44], [26, 0, -42], [0, 0, -38], [-11, 0, -31],
    [11, 0, -38], [-24, 0, -22], [24, 0, -22], [0, 0, -5], [-22, 0, 6], [-18, 0, 20],
    [22, 0, 17], [17, 0, 6], [0, 0, 17], [-20, 0, 36], [20, 0, 37], [0, 0, 40],
    [-12, 0, 56], [12, 0, 58],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-10, -62, 10, -55, 4, 2, [0, 0]),
    blue: spawnGrid(-10, 55, 10, 62, 4, 2, [0, 0]),
  },
  sites: {
    A: { min: [14, 1], max: [28, 22] },
    B: { min: [-28, 1], max: [-14, 22] },
  },
  bounds: { min: [-W, -L], max: [W, L] },
  sky: { top: 0x4f9de0, bottom: 0xd6ecf7 },
  groundColor: m.C.ground,
  ground: 'dirt', // footstep surface for open ground
  bedColor: m.C.bed,
};
