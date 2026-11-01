// "Dunes": bomb defusal in a sandstone desert town. A wide map, 132 m from
// west to east and 72 m deep, tapering at both ends between sandstone
// cliffs. Red starts at the west end, Blue at the east end. Three ways east:
//   North road - open desert with palms and ruins, into the oasis (A)
//   Mid        - a walled street with a gate halfway, with side doors to
//                both sites
//   Tunnel     - a long covered corridor along the south wall, into the
//                pillared hall (B)
//   Site A - an open oasis courtyard with a pool, a footbridge and palms
//   Site B - a pillared hall with doors west (tunnel), north (mid) and east
// The sites sit east of the middle: Blue gets there first, Red walks
// further, but both teams have a long way to go.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xe2cc9a, bed: 0x8d8259,
  wall: 0xd9b77c, wall2: 0xc99d62, roof: 0xb9874c, stone: 0xc2a46e, step: 0xcfb47f,
  crate: 0xa86f3a, wood: 0x8a5a32, bridge: 0x8a5a32, rail: 0x5d3e24, barrel: 0x6d5b4b,
  trunk: 0x7a5534, leaves: 0x5f9a3c, awning: 0xc4473a, cloth: 0x2d6fa3, cliff: 0xb98f5c,
});

const X = 66, Z = 36;
m.perimeter(-X, -Z, X, Z, 8, 'cliff');

// Sandstone cliffs taper both ends of the map.
for (const s of [-1, 1]) {
  m.block(s * 50, -Z, s * X, -14, 9, 'cliff'); m.block(s * 50, 14, s * X, Z, 9, 'cliff');
  m.block(s * 42, -Z, s * 50, -28, 9, 'cliff'); m.block(s * 42, 28, s * 50, Z, 9, 'cliff');
}

// --- Red spawn (west end) ---
m.crates(-56, -11); m.crate(-57, 11); m.barrel(-52, 4); m.barrel(-52.6, 4.6); m.palm(-61, -12); m.palm(-61, 12);
m.crate(-46, -6); m.crate(-46, -4.8); m.box(-44, 0, 7, -43.4, 1.1, 11, 'concrete', 'stone');
m.crates(-38, -24); m.crate(-36, 18); m.box(-38, 0, -2, -37.4, 1.1, 2, 'concrete', 'stone');

// --- North road (to A) ---
m.palm(-24, -31); m.palm(-12, -24); m.palm(-30, -21);
m.wallX(-31, -20, -14, 2.2, 0.5, 'concrete', 'stone'); // ruined wall
m.wallZ(-6, -34, -27, 1.6, 0.5, 'concrete', 'stone');
m.crates(-18, -24); m.crate(-3, -21.5); m.crate(-1.8, -21.5);

// --- North house, between the road and mid ---
m.building(-28, -18, -8, -8, 4, { col: 'wall', doors: { n: [[-20, -17.5]], s: [[-14, -11.5]], e: [[-14.5, -12]] } });
m.crate(-25.5, -15.5); m.box(-20, 0, -12.6, -16, 1, -12, 'wood', 'wood'); m.crate(-10.5, -15.5);

// --- Mid: a walled street with the gate ---
m.wallX(-6.4, -30, 24, 3.5, 0.4, 'concrete', 'wall', [[-20, -17.5], [8, 11]]);
m.wallX(6, -30, 24, 3.5, 0.4, 'concrete', 'wall', [[-11, -8.5], [12, 15]]);
m.wallZ(-8.4, -6, 6, 3.5, 0.4, 'concrete', 'wall', [[-1.5, 1.5]]); // the gate
m.box(-8.4, 2.6, -6, -8, 2.9, 6, 'wood', 'awning'); // gate beam
m.crate(-14, -4); m.crate(-3, 3.8); m.box(4, 0, -1, 4.6, 1.1, 1.5, 'concrete', 'stone'); m.crate(19, -4); m.barrel(-24, 3.5);

// --- South house, between mid and the tunnel ---
m.building(-28, 9, -6, 24, 4, { col: 'wall2', doors: { n: [[-22, -19.5]], s: [[-12, -9.5]] } });
m.crates(-24.5, 20.5); m.crate(-10, 12); m.box(-19, 0, 16, -16, 1.1, 16.6, 'wood', 'wood');

// --- The tunnel to B, along the south wall ---
m.wallX(25.7, -30, 2, 3.2, 0.3, 'concrete', 'wall2', [[-12, -9.5]]);
m.block(-42, 33.6, 2, Z, 3.5, 'wall2');
m.box(-30, 3.2, 25.7, 2, 3.5, 33.6, 'concrete', 'roof');
m.crate(-20, 31.5, 1.0); m.crate(-4, 27.5, 1.0);

// --- Site B: the pillared hall ---
m.building(2, 8, 24, 34, 5, { col: 'wall', t: 0.4, doors: { w: [[27, 31]], n: [[12, 15]], e: [[18, 22]] } });
for (const [x, z] of [[8, 15], [17, 15], [8, 27], [17, 27]]) m.box(x - 0.5, 0, z - 0.5, x + 0.5, 5, z + 0.5, 'concrete', 'stone');
m.crates(12.5, 21); m.crate(5, 11); m.crate(21, 31); m.crate(19.8, 31); m.box(4, 0, 23, 7, 1.1, 23.6, 'wood', 'wood');

// --- Site A: the oasis ---
m.wallZ(0, -Z, -8, 3, 0.4, 'concrete', 'wall2', [[-31, -25]]);
m.water(8, -26, 16, -20);
m.bridge(11, -26.6, 13, -19.4, 'z');
m.palm(6, -28); m.palm(18, -18); m.palm(19, -30);
m.crates(3.5, -12); m.crate(21, -13); m.crate(21, -11.8); m.crates(4, -32.5); m.box(22, 0, -26, 22.6, 1.1, -21, 'concrete', 'stone');

// --- Blue side (east) ---
m.building(30, -26, 42, -14, 4, { col: 'wall2', doors: { w: [[-22, -19.5]], e: [[-20, -17.5]], s: [[35, 37.5]] } });
m.building(30, 14, 42, 26, 4, { col: 'wall2', doors: { w: [[19.5, 22]], e: [[17.5, 20]], n: [[35, 37.5]] } });
m.crate(32.5, -23.5); m.crate(39.5, 23.5); m.crates(36, -4); m.box(34, 0, 3, 38, 1.1, 3.6, 'concrete', 'stone');
m.crates(27, -32); m.crate(27, 31); m.palm(46, -10); m.palm(46, 10);
// Market cloth shades over the Blue spawn (high enough to walk under).
m.box(52, 2.4, -6, 60, 2.55, 6, 'wood', 'cloth');

// --- Blue spawn (east end) ---
m.crates(56, -11); m.crate(57, 11); m.barrel(52, -4); m.barrel(52.6, -4.6);

const ground = m.finishGround(-X, -Z, X, Z);

const center = [0, 0];
export const DUNES = {
  id: 'dunes',
  name: 'Dunes',
  type: 'bomb',
  size: 'Large',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-58, 0, -6], [-58, 0, 6], [-40, 0, -10], [-40, 0, 10], [-26, 0, -27], [-18, 0, -13],
    [-20, 0, 0], [-14, 0, 19], [-20, 0, 29], [-4, 0, -16], [0, 0, 0], [12, 0, -30],
    [18, 0, -12], [12, 0, 18], [20, 0, 12], [36, 0, -20], [36, 0, 0], [36, 0, 20],
    [58, 0, -6], [58, 0, 6],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-62, -8, -55, 8, 2, 4, [0, 0]),
    blue: spawnGrid(55, -8, 62, 8, 2, 4, [0, 0]),
  },
  sites: {
    A: { min: [3, -33], max: [22, -12] },
    B: { min: [4, 10], max: [22, 32] },
  },
  bounds: { min: [-X, -Z], max: [X, Z] },
  sky: { top: 0x6aa9e0, bottom: 0xf3e3c2 },
  groundColor: m.C.ground,
  ground: 'dirt', // footstep surface for open ground
  bedColor: m.C.bed,
};
