// "Dunes": bomb defusal in a sandstone desert town.
//   Site B - a pillared hall in the west, reached from Red's side through
//            a long covered tunnel, from mid through a side door, and from
//            Blue's side through the south door
//   Site A - an open oasis courtyard in the east with a pool, a footbridge
//            and palms; Red reaches it down the long east street
// Mid is a walled street with a gate in the middle, linking the two.
import { mapBuilder, spawnGrid, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xe2cc9a, bed: 0x8d8259,
  wall: 0xd9b77c, wall2: 0xc99d62, roof: 0xb9874c, stone: 0xc2a46e, step: 0xcfb47f,
  crate: 0xa86f3a, wood: 0x8a5a32, bridge: 0x8a5a32, rail: 0x5d3e24, barrel: 0x6d5b4b,
  trunk: 0x7a5534, leaves: 0x5f9a3c, awning: 0xc4473a, cloth: 0x2d6fa3,
});

const B = 34;
m.perimeter(-B, -B, B, B, 7, 'wall2');

// --- Red side (north) ---
// Houses around Red spawn.
m.building(-B, -B, -20, -22, 4, { col: 'wall', doors: { e: [[-29, -26.5]], s: [[-26, -23.5]] } });
m.building(20, -B, B, -22, 4, { col: 'wall', doors: { w: [[-29, -26.5]], s: [[23.5, 26]] } });
m.crates(-12, -30); m.crate(12, -29); m.barrel(-6, -24); m.barrel(7, -24.5);

// The B tunnel: a covered corridor from Red's side down to the hall.
m.wallZ(-27.3, -22, 4, 3, 0.3, 'concrete', 'wall2');
m.wallZ(-22, -22, 4, 3, 0.3, 'concrete', 'wall2', [[-14, -11.5]]);
m.box(-27.5, 3, -22, -21.8, 3.3, 4, 'concrete', 'roof');
m.crate(-24.5, -9, 1.0);
// Upper west street (outside the tunnel, toward mid).
m.building(-19, -18, -10, -6, 4, { col: 'wall2', doors: { w: [[-14, -11.5]], s: [[-15.5, -13]], e: [[-16, -13.5]] } });
m.crate(-17.5, -16.5); m.crate(-11.5, -7.5);

// --- Mid: a walled street with the gate ---
m.wallZ(-6, -18, 16, 3.5, 0.4, 'concrete', 'wall', [[-16, -13.5], [6, 8.5]]);
m.wallZ(5.6, -18, 16, 3.5, 0.4, 'concrete', 'wall', [[-10, -7.5], [9, 11.5]]);
m.wallX(-1.2, -5.6, 5.6, 3.5, 0.4, 'concrete', 'wall', [[-1.5, 1.5]]); // the gate
m.crate(-3.8, -4); m.crate(3.8, 2.5); m.box(-1, 0, 8, 1, 1.1, 8.5, 'concrete', 'stone');
m.box(-5.6, 2.6, -1.2, 5.6, 2.9, -0.8, 'wood', 'awning'); // gate beam

// --- East street: Red's long way to A ---
m.building(10, -18, 19, -4, 4, { col: 'wall2', doors: { w: [[-10, -7.5]], s: [[13, 15.5]], e: [[-14, -11.5]] } });
m.crates(25, -14); m.crate(22, -6); m.box(26, 0, -1.5, 31, 1.1, -0.9, 'concrete', 'stone');
m.palm(30, -18);

// --- Site B: the pillared hall ---
m.building(-B, 4, -14, 22, 5, { col: 'wall', t: 0.4, doors: { n: [[-27, -22.3]], e: [[8, 11]], s: [[-20, -17]] } });
for (const [x, z] of [[-28, 9], [-20, 9], [-28, 17], [-20, 17]]) m.box(x - 0.5, 0, z - 0.5, x + 0.5, 5, z + 0.5, 'concrete', 'stone');
m.crates(-24, 13); m.crate(-16.5, 6.5); m.crate(-31.5, 19.5); m.crate(-30.3, 19.5); m.box(-19, 0, 19.5, -16, 1.1, 20.1, 'wood', 'wood');

// --- Site A: the oasis ---
m.water(20, 10, 27, 15);
m.bridge(22.5, 9.4, 24.5, 15.6, 'z');
m.palm(18.5, 9); m.palm(28.5, 16.5); m.palm(29, 8.5);
m.wallX(4, 14, B, 3, 0.4, 'concrete', 'wall2', [[18, 25]]);
m.crates(31, 6.5); m.crate(16, 19); m.crate(16, 20.2); m.crates(30, 20.5); m.box(14, 0, 12, 14.6, 1.1, 16, 'concrete', 'stone');

// --- Blue side (south) ---
m.building(-10, 18, 0, 26, 3.6, { col: 'wall2', doors: { n: [[-6, -3.5]], s: [[-4, -1.5]], e: [[20, 22.5]] } });
m.crate(4, 21); m.crate(4, 22.2); m.barrel(9, 25); m.crates(-26, 29); m.crate(25, 28); m.palm(-12, 31); m.palm(14, 31);
// Market cloth shades over the Blue spawn street (high enough to walk under).
m.box(-6, 2.4, 27.5, 6, 2.55, 30.5, 'wood', 'cloth');

const ground = m.finishGround(-B, -B, B, B);

const center = [0, 0];
export const DUNES = {
  id: 'dunes',
  name: 'Dunes',
  type: 'bomb',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-14, 0, -26], [14, 0, -26], [0, 0, -30], [-24.5, 0, -14], [-15, 0, -12], [0, 0, -10],
    [0, 0, 5], [25, 0, -9], [30, 0, 0], [-24, 0, 8], [-17, 0, 15], [-30, 0, 12],
    [17, 0, 7], [30, 0, 12], [22, 0, 20], [-5, 0, 22], [12, 0, 25], [-20, 0, 29],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-8, -32, 8, -26, 4, 2, [0, 0]),
    blue: spawnGrid(-8, 28, 10, 33, 4, 2, [0, 0]),
  },
  sites: {
    A: { min: [15, 6], max: [32, 22] },
    B: { min: [-32, 6], max: [-16, 20] },
  },
  bounds: { min: [-B, -B], max: [B, B] },
  sky: { top: 0x6aa9e0, bottom: 0xf3e3c2 },
  groundColor: m.C.ground,
  bedColor: m.C.bed,
};
