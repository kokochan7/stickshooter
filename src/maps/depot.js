// "Depot": hostage rescue at a freight depot at dusk. A big brick warehouse
// fills the north half of the map; an open truck yard and the street lie
// south of it, and a rail yard runs the length of the west side. Laid out
// at 90 x 88 m, spread out to 135 x 132 m.
//   North  - Red spawns in the back lot behind the warehouse and guards four
//            hostages inside it: two in the cold store (north-west corner)
//            and two in the back office (north-east corner).
//   South  - Blue spawns on the street, where the rescue zone is.
//   West   - the rail yard: a raised track bed with a parked train (the
//            high lane) beside a lower service lane with boxcars. It links
//            the street, the yard and Red's lot.
// Ways into the warehouse:
//   - the garage doors in the middle of the south wall (the main push, a
//     long open look across the yard and through the gate to the street),
//     watched from the shipping office's window just inside
//   - the side door off the narrow east alley
//   - the roof, by the fire escape in the west alley or the ladder on the
//     yard side: drop through a skylight onto the floor, or take the hatch
//     and the crawl-through vent that drops into the cold store
//   - the two back doors, by walking round to Red's lot
// Inside, a raised walkway runs along the west wall to the cold store roof.
// Outside is wide open with long sightlines; inside is shelving, crates and
// pillars, close and tight. Bots walk the ground routes; the fire escape
// ends in a ledge you jump onto, so the roof and vent are for players.
import { mapBuilder, scaleMap, spawnGrid, subtractRects, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0x8f8f8a, wall: 0xa4573a, wall2: 0xcfc6b4, trim: 0x6b3a28, roof: 0x4d5359, stone: 0xa9a59b, step: 0x7d8288,
  crate: 0xb8743a, wood: 0x8b6a4a, rail: 0x3e4a55, barrel: 0x2f6f8f, metal: 0x7d8790, duct: 0x9aa3ab,
  teal: 0x2f8f9d, orange: 0xd9692f, yellow: 0xe0b23a, red: 0xb5443c, white: 0xe6e3dc, shelf: 0x3f6aa0, pole: 0x50565c,
  car1: 0x3d5f8a, car2: 0x9a3b34, car3: 0x2f2f33, curb: 0xb7b2a6, booth: 0xd8d2c2,
});

const X = 38, Z = 44, XW = -52; // XW: the west edge, past the rail yard
m.perimeter(XW, -Z, X, Z, 8, 'wall2');

// ---------- The warehouse ----------
const W0 = -26, W1 = 22, N0 = -34, S0 = -8, H = 6;
m.wallX(N0, W0, W1, H, 0.3, 'concrete', 'wall', [[-9, -6], [8, 11]]); // back doors
m.wallX(S0 - 0.3, W0, W1, H, 0.3, 'concrete', 'wall', [[-4, -0.4], [0.4, 4]], 4.2); // two garage bays
m.wallZ(W0, N0 + 0.3, S0 - 0.3, H, 0.3, 'concrete', 'wall');
m.wallZ(W1 - 0.3, N0 + 0.3, S0 - 0.3, H, 0.3, 'concrete', 'wall', [[-22, -19.5]]); // side door
m.box(-4.6, 4.2, S0 - 0.45, 4.6, 4.5, S0 + 0.15, 'metal', 'trim'); // rolled-up garage doors
// Roof, with a hatch over the vent shaft at x -22..-20.6, z -12.6..-11.2,
// and three open skylights you can drop through onto the floor.
const HX0 = -22, HX1 = -20.6, HZ0 = -12.6, HZ1 = -11.2;
const RY = [H, H + 0.25];
const SKY = [[-10, -24, -8, -22], [2, -17, 4, -15], [10, -19, 12, -17]];
for (const r of subtractRects([W0 - 0.2, N0 - 0.2, W1 + 0.2, S0], [[HX0, HZ0, HX1, HZ1], ...SKY])) {
  m.box(r[0], RY[0], r[1], r[2], RY[1], r[3], 'concrete', 'roof');
}
for (const [x0, z0, x1, z1] of SKY) { // skylight frames
  m.box(x0 - 0.2, RY[1], z0 - 0.2, x1 + 0.2, RY[1] + 0.3, z0, 'metal', 'rail');
  m.box(x0 - 0.2, RY[1], z1, x1 + 0.2, RY[1] + 0.3, z1 + 0.2, 'metal', 'rail');
}
// On the roof: a low parapet over the yard (with a gap at the ladder) and AC units.
m.box(W0 - 0.2, RY[1], S0 - 0.3, 17.4, RY[1] + 0.7, S0, 'concrete', 'wall');
m.box(19.6, RY[1], S0 - 0.3, W1 + 0.2, RY[1] + 0.7, S0, 'concrete', 'wall');
m.box(-6, RY[1], -20, -3, RY[1] + 1.4, -17.5, 'metal', 'metal');
m.box(6, RY[1], -26, 9, RY[1] + 1.4, -23.5, 'metal', 'metal');
m.box(12, RY[1], -14, 14, RY[1] + 1.0, -11, 'metal', 'metal');
m.box(HX0 - 0.3, RY[1], HZ0 - 0.3, HX1 + 0.3, RY[1] + 0.35, HZ0, 'metal', 'duct'); // hatch rim
m.box(HX0 - 0.3, RY[1], HZ1, HX1 + 0.3, RY[1] + 0.35, HZ1 + 0.3, 'metal', 'duct');

// The vent: a shaft down from the hatch to a crawl duct hanging under the
// roof (crouch to fit), running north to the cold store's roof.
const DY = 3.3, DT = 4.6; // duct floor top, ceiling bottom
const DE = -25; // the duct's open north end, over the cold store
m.box(HX0 - 0.1, DY - 0.1, DE, HX1 + 0.1, DY, HZ1 + 0.1, 'metal', 'duct'); // floor
m.box(HX0 - 0.1, DT, DE, HX1 + 0.1, DT + 0.1, HZ0, 'metal', 'duct'); // ceiling
m.box(HX0 - 0.1, DY, DE, HX0, DT, HZ0, 'metal', 'duct'); // sides
m.box(HX1, DY, DE, HX1 + 0.1, DT, HZ0, 'metal', 'duct');
m.box(HX0 - 0.1, DY, HZ0, HX0, H, HZ1 + 0.1, 'metal', 'duct'); // shaft
m.box(HX1, DY, HZ0, HX1 + 0.1, H, HZ1 + 0.1, 'metal', 'duct');
m.box(HX0, DY, HZ1, HX1, H, HZ1 + 0.1, 'metal', 'duct');

// Cold store (hostages, north-west corner): wooden walls, a roof you can
// stand on, and a vent opening in that roof where the duct comes out.
const CS = { x0: W0 + 0.3, z0: N0 + 0.3, x1: -12, z1: -24 };
m.wallX(CS.z1 - 0.15, CS.x0, CS.x1, 2.8, 0.15, 'wood', 'wall2', [[-17, -14.5]]);
m.wallZ(CS.x1 - 0.15, CS.z0, CS.z1 - 0.15, 2.8, 0.15, 'wood', 'wall2', [[-30, -27.5]]);
const VZ0 = -27.6, VZ1 = -26.2; // opening in the cold store roof, under the duct's end
m.box(CS.x0, 2.8, CS.z0, CS.x1, 3.05, VZ0, 'wood', 'roof');
m.box(CS.x0, 2.8, VZ1, CS.x1, 3.05, CS.z1, 'wood', 'roof');
m.box(CS.x0, 2.8, VZ0, HX0, 3.05, VZ1, 'wood', 'roof');
m.box(HX1, 2.8, VZ0, CS.x1, 3.05, VZ1, 'wood', 'roof');
m.crate(-24.5, -25.6); m.crate(-13.6, -32.4); m.box(-25.7, 0, -33.7, -19, 2, -33, 'wood', 'shelf');

// Back office (hostages, north-east corner).
m.wallX(-26.15, 12, W1 - 0.3, 2.8, 0.15, 'wood', 'wall2', [[14, 16.5]]);
m.wallZ(12, N0 + 0.3, -26.15, 2.8, 0.15, 'wood', 'wall2', [[-31, -28.5]]);
m.box(12, 2.8, N0 + 0.3, W1 - 0.3, 3.05, -26, 'wood', 'roof');
m.box(18, 0, -33.7, 21.6, 0.8, -32.4, 'wood', 'wood'); // desk
m.crate(20.8, -27.2, 1.0);

// The floor: pillars, shelving rows, crates and a container.
for (const [x, z] of [[-6, -15], [6, -15], [-6, -27], [4, -27], [-18, -15], [16, -15]]) {
  m.box(x - 0.3, 0, z - 0.3, x + 0.3, H, z + 0.3, 'concrete', 'wall2');
}
const shelf = (x0, z0, x1, z1) => m.box(x0, 0, z0, x1, 2.6, z1, 'wood', 'shelf');
shelf(-11, -21, -2.5, -20.1); shelf(2.5, -21, 10, -20.1); shelf(-3.5, -30.5, 2.5, -29.6);
shelf(-22, -21, -18, -20.1); shelf(15, -21, 20, -20.1);
m.box(-20, 0, -18.5, -14, 2.6, -16, 'metal', 'teal', { kind: 'container' });
m.crates(-20.5, -9.5); m.crates(9, -11); m.crate(-9, -12.5); m.crate(-7.8, -12.5); m.crate(-8.4, -12.5, 0.9, 1.2);
m.crates(13.5, -23.5); m.crate(-2, -25); m.crate(18.5, -15.5); m.crate(-10, -32.5); m.crate(6.5, -32.5);
m.barrel(12.2, -9.2); m.barrel(12.8, -9.7); m.barrel(-15, -9.3);
m.box(1, 0, -24.5, 2.4, 1.2, -22.6, 'metal', 'yellow'); // forklift
m.box(1, 1.2, -24.5, 2.4, 2.6, -24.3, 'metal', 'rail');

// Raised walkway along the inside of the west wall: stairs up by the garage
// end, a railing, and a hop up onto the cold store's roof at the far end.
m.box(W0 + 0.3, 0, -23.85, -23, 2.4, -15, 'concrete', 'step');
m.stairs(W0 + 0.3, -15, -23, -10, '-z', 2.4, 6, 'concrete', 'step'); // foot clear of the wall
m.box(-23.1, 2.4, -23.85, -23, 3.4, -15, 'grate', 'rail');

// Shipping office by the garage doors, in the south-east corner: wooden
// walls, a door to the floor and a window looking at the garage bays.
m.wallX(-13, 14, W1 - 0.3, 2.8, 0.15, 'wood', 'wall2', [[18, 20]]);
m.wallZ(14, -13, S0 - 0.3, 1.1, 0.15, 'wood', 'wall2'); // window: sill, frame and header
m.box(14, 1.1, -13, 14.15, 2.8, -12, 'wood', 'wall2');
m.box(14, 1.1, -9.3, 14.15, 2.8, S0 - 0.3, 'wood', 'wall2');
m.box(14, 2.1, -12, 14.15, 2.8, -9.3, 'wood', 'wall2');
m.box(14, 2.8, -13, W1 - 0.3, 3.05, S0 - 0.3, 'wood', 'roof');
m.box(19.5, 0, -10, 21.6, 0.8, -8.4, 'wood', 'wood'); // desk
m.crate(15, -9, 0.9);

// ---------- Red's back lot (north) ----------
m.crates(-30, -40); m.crate(24, -41); m.crate(25.2, -41); m.barrel(33, -38); m.barrel(33.6, -38.6);
m.box(-4, 0, -36.5, 4, 1.0, -35.9, 'concrete', 'stone'); // loading dock step-wall
m.box(14, 0, -42.5, 20, 2.8, -40, 'metal', 'red', { kind: 'container' });

// ---------- West alley: the fire escape ----------
m.stairs(-29, -16, -26, -4, '-z', 5.4, 12, 'concrete', 'step'); // 0.45 m steps
m.box(-29, 0, -19, -26, 5.4, -16, 'concrete', 'step'); // landing, a jump below the roof
m.box(-29.2, 5.4, -19.2, -29, 6.4, -16, 'grate', 'rail'); // railing round the landing
m.box(-29.2, 5.4, -19.2, -26, 6.4, -19, 'grate', 'rail');
m.crates(-34, -24); m.crate(-35, -12); m.barrel(-36.5, -30); m.crate(-31, 0);

// ---------- West rail yard ----------
// A raised track bed along the far west edge with a train parked on it
// (the high lane, long looks north-south), a lower service lane with loose
// boxcars beside it, and a wall to the alleys with four openings.
m.wallZ(-38.4, -Z, Z, 3.2, 0.4, 'concrete', 'wall2', [[-42, -38], [-7, -3], [15, 19], [32, 37]]);
m.box(XW, 0, -38, -46, 2.0, 24, 'concrete', 'stone', { kind: 'block' }); // track bed
m.stairs(-50.5, -42, -47.5, -38, '+z', 2.0, 5, 'concrete', 'step');
m.stairs(-50.5, 24, -47.5, 28, '-z', 2.0, 5, 'concrete', 'step');
m.stairs(-46, -10, -43.5, -6, '-x', 2.0, 5, 'concrete', 'step');
for (const z of [-36, -24.5, -2, 10]) { // the train, with gaps between cars
  m.box(-50.6, 2.0, z, -47.6, 5.4, z + 10, 'metal', z === -2 ? 'teal' : 'red', { kind: 'container' });
}
for (const z0 of [-26.4, 8.4]) m.box(-50.2, 2.0, z0, -48, 2.6, z0 + 1.6, 'metal', 'rail'); // couplers
m.box(-45, 0, -30, -42.4, 3.2, -22, 'metal', 'orange', { kind: 'container' });
m.box(-45, 0, 2, -42.4, 3.2, 12, 'metal', 'yellow', { kind: 'container' });
m.crates(-41, -14); m.crate(-40.5, 20); m.barrel(-44, -40); m.barrel(-43.4, -40.6); m.crates(-44, 32);

// ---------- East alley: narrow, to the side door ----------
m.block(30, -34, X, -6, 7, 'wall2');
m.crate(28.2, -16); m.barrel(27.8, -25); m.barrel(28.4, -25.6); m.crate(24, -30);

// The roof ladder: a steep run of narrow rungs up the yard side of the
// warehouse, ending a hop below the roof.
m.stairs(17.6, -8, 19.4, -4.6, '-z', 5.6, 14, 'metal', 'rail');

// ---------- The yard ----------
// A parked truck and trailer, containers, barriers and crate stacks: cover
// on a wide open lot with long looks to the garage doors.
m.box(-20, 0, 4, -17.4, 3.4, 16, 'metal', 'white', { kind: 'container' }); // trailer
m.box(-20, 0, 16.3, -17.4, 2.8, 19, 'metal', 'red'); // cab
m.box(8, 0, 1, 14, 2.6, 3.6, 'metal', 'teal', { kind: 'container' });
m.box(19, 0, 10, 21.6, 2.6, 16, 'metal', 'orange', { kind: 'container' });
m.box(19, 2.6, 10, 21.6, 5.2, 16, 'metal', 'yellow', { kind: 'container' });
m.box(-31, 0, 8, -28.4, 2.6, 14, 'metal', 'orange', { kind: 'container' });
m.box(-6, 0, 7, -2, 1.0, 7.6, 'concrete', 'stone'); m.box(3, 0, 15, 7, 1.0, 15.6, 'concrete', 'stone');
m.box(-12, 0, 21, -8, 1.0, 21.6, 'concrete', 'stone'); m.box(10, 0, 22, 14, 1.0, 22.6, 'concrete', 'stone');
m.crates(-10, -3); m.crate(7, -3.5); m.crate(8.2, -3.5); m.crates(30, 2); m.crate(-35, 20); m.crates(-25, 24);
m.crate(28, 18); m.barrel(-4, 18); m.barrel(-3.4, 18.6);
for (const [x, z] of [[-14, 2], [16, 6], [-36, -2], [26, 24]]) m.box(x - 0.15, 0, z - 0.15, x + 0.15, 6.5, z + 0.15, 'metal', 'pole');
// Gatehouse by the east gate.
m.building(22, 20, 26, 25, 2.8, { col: 'booth', t: 0.2, doors: { w: [[21.5, 23.5]], s: [[23, 25]] } });

// The fence wall between the yard and the street, with three gates.
m.wallX(28, XW, X, 2.4, 0.4, 'concrete', 'wall2', [[-46, -40], [-34, -30], [-6, 6], [30, 34]]);
for (const x of [-6.4, 6, -34.4, -30, 29.6, 34]) m.box(x, 2.4, 27.9, x + 0.4, 3.0, 28.5, 'concrete', 'trim');

// ---------- The street (south) ----------
m.box(-38, 0, 29.8, -18, 0.2, 31, 'concrete', 'curb'); m.box(18, 0, 29.8, X, 0.2, 31, 'concrete', 'curb');
m.box(-31, 0, 32, -27, 1.4, 34, 'metal', 'car1'); m.box(21, 0, 32, 25.5, 1.4, 34, 'metal', 'car2');
m.box(30, 0, 39, 34.5, 1.4, 41, 'metal', 'car3'); m.box(-36, 0, 40, -33, 2.4, 41, 'grate', 'rail'); // bus stop
m.crate(-22, 42.5); m.barrel(18, 42); m.barrel(18.6, 42.6);

const ground = m.finishGround(XW, -Z, X, Z);

const center = [0, 0];
// Laid out in meters at the original size, then spread out to CS 1.6 scale.
export const DEPOT = scaleMap({
  id: 'depot',
  name: 'Depot',
  type: 'hostage',
  size: 'Huge',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [-20, 0, -40], [6, 0, -40], [30, 0, -42], [-34, 0, -32], [26, 0, -36], [-8, 0, -26],
    [8, 0, -17], [-14, 0, -12], [18, 0, -19], [-32, 0, -18], [26, 0, -10], [0, 0, -2],
    [-24, 0, 0], [24, 0, 4], [-8, 0, 12], [12, 0, 10], [-30, 0, 22], [2, 0, 24],
    [-24, 0, 36], [8, 0, 36], [32, 0, 34], [-42, 0, -34], [-41, 0, -4], [-42, 0, 24], [-49, 2, -8],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(-14, -43, 10, -38, 4, 2, center),
    blue: spawnGrid(-14, 38, 14, 43, 4, 2, center),
  },
  hostages: [[-23.5, 0, -31], [-16.5, 0, -31.5], [17, 0, -30.5], [19.5, 0, -28.5]],
  rescue: [{ min: [-16, 36], max: [16, 44] }],
  bounds: { min: [XW, -Z], max: [X, Z] },
  sky: { top: 0x3b4a70, bottom: 0xf0b07a },
  groundColor: m.C.ground,
  bedColor: m.C.ground,
}, 1.5);
