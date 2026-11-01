// "Canal": bomb defusal in a sunny canal town. A canal splits the map east
// to west. Red comes from the north and has three ways across: the west
// footbridge, the high stone bridge in the middle (or wade under it), and
// the east footbridge. Blue starts south, close to both bomb sites:
//   Site B - a walled courtyard with a well, west
//   Site A - a plaza with a fountain, east
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xd3c6a9, bed: 0x7d7a5e,
  wall: 0xeadfc6, wall2: 0xdcb88f, roof: 0xb85b3c, stone: 0xb4a688, step: 0xc6b99d,
  crate: 0xb8743a, wood: 0xa86b3c, bridge: 0x9a6a3f, rail: 0x5b4632, barrel: 0x4f7380,
  awning: 0x2f8f9d, awning2: 0xd9563e, boat: 0x3d6f9e, metal: 0x8d9aa8,
});

const B = 34;
m.perimeter(-B, -B, B, B, 7, 'wall2');

// --- The canal ---
m.water(-B, -3, B, 3);
m.bridge(-22.5, -3.6, -18.5, 3.6, 'z');
m.highBridgeZ(-2, 2, -3, 3, 2.5);
m.bridge(18.5, -3.6, 22.5, 3.6, 'z');
// Moored boats: cover for anyone wading.
m.box(8, -0.4, -1.6, 13, 0.55, 0.4, 'wood', 'boat');
m.box(-13, -0.4, 0.2, -9, 0.55, 2, 'wood', 'boat');
// Bollards and crates along both quays.
for (const x of [-30, -14, 9, 28]) m.box(x - 0.25, 0, -3.8, x + 0.25, 0.7, -3.3, 'metal', 'metal');
for (const x of [-28, -8, 14, 30]) m.box(x - 0.25, 0, 3.3, x + 0.25, 0.7, 3.8, 'metal', 'metal');
m.crates(-27, -6); m.crate(-12, -5); m.crate(-10.8, -5); m.barrel(6, -6); m.barrel(6.8, -5.4);
m.crates(27, -6.5); m.crate(13, -7); m.crate(-6, 5.5); m.barrel(8, 5.5); m.crate(27, 5.5);

// --- North (Red side): four blocks with lanes between them ---
const H = 4.2;
m.building(-B, -24, -24, -10, H, { col: 'wall', doors: { e: [[-19, -16.5]], s: [[-30, -27.5]] } });
m.building(-17, -22, -6, -10, H, { col: 'wall2', doors: { w: [[-17, -14.5]], e: [[-19, -16.5]], s: [[-13, -10.5]] } });
m.building(6, -22, 17, -10, H, { col: 'wall2', doors: { w: [[-19, -16.5]], e: [[-17, -14.5]], s: [[10.5, 13]] } });
m.building(24, -24, B, -10, H, { col: 'wall', doors: { w: [[-17, -14.5]], s: [[27.5, 30]] } });
// Inside the blocks.
m.crate(-30, -21); m.crate(-28.8, -21); m.crate(-14.5, -20); m.crate(-8, -12.5); m.box(-12, 0, -16.2, -9, 1, -15.6, 'wood', 'wood');
m.crate(14.5, -20); m.crate(8, -12.5); m.box(9, 0, -16.2, 12, 1, -15.6, 'wood', 'wood'); m.crates(30, -21);
// Lane cover.
m.crate(-20.5, -14); m.box(-23, 0, -9, -21, 1.1, -8.4, 'concrete', 'stone');
m.crate(20.5, -15); m.box(21, 0, -9, 23, 1.1, -8.4, 'concrete', 'stone');
m.box(-3.5, 0, -15, -2.9, 1.1, -12, 'concrete', 'stone'); m.box(2.9, 0, -19, 3.5, 1.1, -16, 'concrete', 'stone');
// Red spawn yard.
m.crates(-14, -29); m.crate(15, -30); m.barrel(-20, -31); m.barrel(21, -27); m.crate(-1, -25.5, 1.0);

// --- South (Blue side) ---
// Site B courtyard (west).
m.wallX(8, -B, -12, 3, 0.4, 'concrete', 'wall2', [[-23, -18]]);
m.wallZ(-12.4, 8.4, 24, 3, 0.4, 'concrete', 'wall2', [[14, 17.5]]);
m.wallX(24, -B, -12, 3, 0.4, 'concrete', 'wall2', [[-18, -14.5]]);
m.box(-22.5, 0, 15, -20.5, 1.0, 17, 'concrete', 'stone'); // the well
m.box(-22.1, 1.0, 15.4, -20.9, 2.2, 16.6, 'concrete', 'stone');
m.crates(-29, 12); m.crate(-27.8, 12); m.crate(-30, 20.5); m.crate(-16, 11);
m.box(-17, 0, 19.5, -14.6, 1.1, 21, 'wood', 'wood'); // cart
// Market street (middle).
const stall = (x, z, col) => {
  m.box(x - 1.4, 0, z - 0.4, x + 1.4, 1.0, z + 0.4, 'wood', 'wood');
  m.box(x - 1.6, 2.3, z - 1.2, x + 1.6, 2.45, z + 0.6, 'wood', col);
};
stall(-7.5, 12, 'awning'); stall(7.5, 16, 'awning2'); stall(-7.5, 20, 'awning2'); stall(6.5, 9.5, 'awning');
m.crate(-2.5, 14); m.barrel(2.5, 19); m.barrel(3.1, 19.6);
// Site A plaza (east).
m.wallX(8, 12.4, B, 3, 0.4, 'concrete', 'wall2', [[18, 25]]);
m.wallZ(12, 8.4, 24, 3, 0.4, 'concrete', 'wall2', [[14, 17.5]]);
m.wallX(24, 12, B, 3, 0.4, 'concrete', 'wall2', [[14.5, 18]]);
m.box(21, 0, 14, 25, 0.7, 18, 'concrete', 'stone'); // fountain basin
m.box(22.6, 0.7, 15.6, 23.4, 2.0, 16.4, 'concrete', 'stone');
m.crates(30, 11); m.crate(30, 12.2); m.crate(16, 21); m.crates(29, 21); m.crate(16.5, 11);
// Blue spawn street.
m.crates(-26, 29); m.crate(25, 29); m.crate(-5, 26.5, 1.0); m.barrel(13, 31); m.barrel(-14, 31.5);

const ground = m.finishGround(-B, -B, B, B);

const center = [0, 0];
export const CANAL = {
  id: 'canal',
  name: 'Canal',
  type: 'bomb',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-20, 0, -28], [-5, 0, -31], [5, 0, -31], [20, 0, -28], [-29, 0, -6], [29, 0, -6],
    [-28, 0, -17], [28, 0, -17], [0, 0, -12], [-24, 0, 16], [-15, 0, 22], [27, 0, 16],
    [16, 0, 14], [0, 0, 22], [-20, 0, 30], [20, 0, 30], [0, 0, 6], [-8, 0, 16],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-8, -33, 8, -27, 4, 2, [0, 0]),
    blue: spawnGrid(-8, 27, 8, 33, 4, 2, [0, 0]),
  },
  sites: {
    A: { min: [15, 10], max: [31, 22] },
    B: { min: [-31, 10], max: [-15, 22] },
  },
  bounds: { min: [-B, -B], max: [B, B] },
  sky: { top: 0x4f9de0, bottom: 0xd6ecf7 },
  groundColor: m.C.ground,
  ground: 'dirt', // footstep surface for open ground
  bedColor: m.C.bed,
};
