// "Warehouse": hostage rescue at an urban industrial warehouse at dusk. A
// large brick-and-steel warehouse occupies the north-east quadrant; an open
// paved yard and a divided city street lie south of it, and an elevated road
// overpass runs along the west side. Laid out at 78 x 84 m, spread out to
// 109 x 118 m.
//   North  - Red spawns inside the warehouse and guards four hostages in the
//            elevated control office on the north-west side.
//   South  - Blue spawns on the street behind a parked cargo van, where the
//            rescue zone sits.
//   West   - an elevated concrete overpass climbed by a long south ramp,
//            overlooking the street, front yard, and west service alley.
//   East   - a tall metal overlook tower beside the street with a clear view
//            of the yard and warehouse roof.
// Ways into the warehouse:
//   - the east door, off the strip between the warehouse and the map edge
//     (the south wall facing the yard is solid: the garage bay is closed)
//   - the side entry door off the west alley beneath the overpass
//   - the roof, reached by ladder-stairs on either the west or east exterior
//     wall: drop through two skylights onto the warehouse floor, or enter the
//     roof hatch and crawl through the overhead vent duct into the hostage
//     office
// Inside, a main loading floor with stacked crates and a shipping container
// climbs via a back ramp to an upper walkway wrapping the south and west walls
// and leading into the hostage office.
import { mapBuilder, scaleMap, spawnGrid, subtractRects, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0x7e8082, wall: 0x8c5642, wall2: 0xbcb6aa, trim: 0x52575c, roof: 0x4b5258, stone: 0x99958c, step: 0x747a80,
  crate: 0xb67a3e, wood: 0x866547, rail: 0x3b454f, barrel: 0x2e6b88, metal: 0x6f7a84, duct: 0x96a0a8,
  teal: 0x2f8794, orange: 0xd46a31, yellow: 0xdeb03c, red: 0xa8433b, white: 0xe2dfd8, blue: 0x3c5e86,
  dark: 0x34383d, curb: 0xb0aba0, glass: 0x6b8fa3,
});

const XW = -42, X = 36, ZN = -42, ZS = 42;
m.perimeter(XW, ZN, X, ZS, 9, 'wall2');

// ---------- The warehouse (north-east) ----------
const W0 = -6, W1 = 28, N0 = -38, S0 = -4, H = 6.4;
m.wallX(N0, W0, W1, H, 0.35, 'concrete', 'wall'); // solid north wall
m.wallX(S0 - 0.35, W0, W1, H, 0.35, 'concrete', 'wall'); // solid south wall (garage bay closed)
// West wall, open where the hostage office annex joins it (z -35..-23):
// the office's own east wall, door and window stand there instead.
m.wallZ(W0, N0 + 0.35, -34.7, H, 0.35, 'concrete', 'wall');
m.wallZ(W0, -23.3, S0 - 0.35, H, 0.35, 'concrete', 'wall', [[-14, -11.2]]); // west side door
m.box(W0, 0, -34.7, W0 + 0.35, 3.2, -23.3, 'concrete', 'wall'); // the threshold between office and catwalk
m.wallZ(W1 - 0.35, N0 + 0.35, S0 - 0.35, H, 0.35, 'concrete', 'wall', [[-30, -27]]); // east door
m.box(10, 0, S0, 18, 4.2, S0 + 0.12, 'metal', 'trim'); // shut garage door, on the yard side

// Warehouse roof with a vent hatch and two skylights over the main floor.
const HX0 = 8.4, HX1 = 9.8, HZ0 = -20.8, HZ1 = -19.4;
const RY = [H, H + 0.25];
const SKY = [[1, -15, 3.5, -12.5], [16, -24, 18.5, -21.5]];
for (const r of subtractRects([W0, N0 - 0.2, W1, S0 + 0.1], [[HX0, HZ0, HX1, HZ1], ...SKY])) {
  m.box(r[0], RY[0], r[1], r[2], RY[1], r[3], 'metal', 'roof');
}
for (const [x0, z0, x1, z1] of SKY) { // skylight rims
  m.box(x0 - 0.2, RY[1], z0 - 0.2, x1 + 0.2, RY[1] + 0.3, z0, 'metal', 'rail');
  m.box(x0 - 0.2, RY[1], z1, x1 + 0.2, RY[1] + 0.3, z1 + 0.2, 'metal', 'rail');
}
// Roof parapet (with gaps at the west and east roof ladders) and HVAC units.
m.box(W0, RY[1], S0 - 0.3, W1, RY[1] + 0.7, S0, 'concrete', 'wall');
m.box(W0, RY[1], N0 - 0.2, W1, RY[1] + 0.7, N0 + 0.1, 'concrete', 'wall');
m.box(W0, RY[1], N0 + 0.1, W0 + 0.3, RY[1] + 0.7, -9.2, 'concrete', 'wall');
m.box(W0, RY[1], -6.8, W0 + 0.3, RY[1] + 0.7, S0 - 0.3, 'concrete', 'wall');
m.box(W1 - 0.3, RY[1], N0 + 0.1, W1, RY[1] + 0.7, -14.2, 'concrete', 'wall');
m.box(W1 - 0.3, RY[1], -11.8, W1, RY[1] + 0.7, S0 - 0.3, 'concrete', 'wall');
m.box(16, RY[1], -14, 19.2, RY[1] + 1.3, -11.4, 'metal', 'metal');
m.box(2, RY[1], -31, 5.5, RY[1] + 1.4, -28.2, 'metal', 'metal');
m.box(HX0 - 0.3, RY[1], HZ0 - 0.3, HX1 + 0.3, RY[1] + 0.35, HZ0, 'metal', 'duct'); // hatch rim
m.box(HX0 - 0.3, RY[1], HZ1, HX1 + 0.3, RY[1] + 0.35, HZ1 + 0.3, 'metal', 'duct');

// Overhead vent system: shaft down from the roof hatch into a north-running
// crouch duct, turning west straight into the hostage office ceiling.
const DY = 4.6, DT = 5.9; // duct floor top, ceiling bottom (1.3 m crouch clearance)
const DZN = -28.4, DZS = -27.0; // west branch Z band
m.box(HX0 - 0.1, DY - 0.1, DZN - 0.1, HX1 + 0.1, DY, HZ1 + 0.1, 'metal', 'duct'); // north-south floor
m.box(HX0 - 0.1, DT, DZN - 0.1, HX1 + 0.1, DT + 0.1, HZ0, 'metal', 'duct'); // north-south ceiling
m.box(HX0 - 0.1, DY, DZS, HX0, DT, HZ0, 'metal', 'duct'); // west side (south of branch)
m.box(HX1, DY, DZN - 0.1, HX1 + 0.1, DT, HZ0, 'metal', 'duct'); // east side
m.box(HX0 - 0.1, DY, DZN - 0.1, HX1 + 0.1, DT, DZN, 'metal', 'duct'); // north cap
m.box(HX0 - 0.1, DY, HZ0, HX0, H, HZ1 + 0.1, 'metal', 'duct'); // vertical shaft walls
m.box(HX1, DY, HZ0, HX1 + 0.1, H, HZ1 + 0.1, 'metal', 'duct');
m.box(HX0, DY, HZ1, HX1, H, HZ1 + 0.1, 'metal', 'duct');
// West duct branch extending into the hostage office at x = -11.5..HX0.
m.box(-11.5, DY - 0.1, DZN - 0.1, HX0, DY, DZS + 0.1, 'metal', 'duct');
m.box(-11.5, DT, DZN - 0.1, HX0, DT + 0.1, DZS + 0.1, 'metal', 'duct');
m.box(-11.5, DY, DZN - 0.1, HX0, DT, DZN, 'metal', 'duct');
m.box(-11.5, DY, DZS, HX0, DT, DZS + 0.1, 'metal', 'duct');

// ---------- Elevated hostage office (north-west annex) ----------
// Sits at y = 3.2 m outside the warehouse's north-west wall, connected to the
// upper interior walkway by double doors and a drop opening from the vent.
const OX0 = -16, OX1 = W0, OZ0 = -35, OZ1 = -23, OY = 3.2, OH = 6.2;
m.box(OX0, 0, OZ0, OX1, OY, OZ1, 'concrete', 'stone', { kind: 'block' }); // lower support block
m.box(OX0, OY, OZ0, OX1, OH, OZ0 + 0.3, 'concrete', 'wall'); // north wall
m.box(OX0, OY, OZ1 - 0.3, OX1, OH, OZ1, 'concrete', 'wall'); // south wall
m.box(OX0, OY, OZ0 + 0.3, OX0 + 0.3, OH, OZ1 - 0.3, 'concrete', 'wall'); // west wall
// East wall separating the office from the warehouse (with door at z -31..-28.5 and window).
m.box(W0 - 0.3, OY, OZ0 + 0.3, W0, OH, -31, 'concrete', 'wall2');
m.box(W0 - 0.3, OY, -28.5, W0, OY + 1.1, OZ1 - 0.3, 'concrete', 'wall2'); // window sill
m.box(W0 - 0.3, OY + 2.2, DZS + 0.1, W0, OH, OZ1 - 0.3, 'concrete', 'wall2'); // window header
m.box(W0 - 0.3, DT + 0.1, -28.5, W0, OH, DZS + 0.1, 'concrete', 'wall2'); // over the duct
// Office roof with vent drop opening at x -13..-11.5, z -28.4..-27.0.
for (const r of subtractRects([OX0, OZ0, OX1, OZ1], [[-13, DZN, -11.5, DZS]])) {
  m.box(r[0], OH, r[1], r[2], OH + 0.25, r[3], 'metal', 'roof');
}
m.box(-15.5, OY, -34.5, -13, OY + 0.85, -33.2, 'wood', 'wood'); // control desk
m.crate(-14.6, -24.5, 1.0, OY);

// ---------- Warehouse interior: catwalks, ramp, cover ----------
// Upper north-and-west walkway at y = 3.2 m linking the back ramp to the
// hostage office and the south catwalk.
m.box(W0 + 0.35, 3.0, -35.2, 22, 3.2, -31.8, 'concrete', 'step'); // north upper deck
// The north half of the west catwalk is solid to the floor, with stairs up
// from the loading floor, so bots (and the hostages they lead) can walk to
// the office door. The rest of the walkway is open underneath.
m.box(W0 + 0.35, 0, -31.8, -2.5, 3.2, -14.6, 'concrete', 'step'); // west catwalk, north half
m.stairs(-2.5, -31.6, 1.5, -29.2, '-x', 3.2, 8, 'concrete', 'step');
m.box(W0 + 0.35, 3.0, -14.6, -2.5, 3.2, -6.2, 'concrete', 'step'); // west catwalk, over the side door
m.box(W0 + 0.35, 3.0, -6.2, 18.5, 3.2, -4.35, 'concrete', 'step'); // south catwalk
m.box(-2.6, 3.2, -22, -2.5, 4.15, -6.2, 'grate', 'rail'); // west catwalk railing
m.box(-2.5, 3.2, -6.3, 18.5, 4.15, -6.2, 'grate', 'rail'); // south catwalk railing
m.box(0, 3.2, -31.9, 14, 4.15, -31.8, 'grate', 'rail'); // north deck railing

// Wide back ramp along the north wall climbing from the warehouse floor (y=0)
// up to the upper deck (y=3.2).
m.stairs(13, -37.6, 22, -35.2, '+x', 3.2, 10, 'concrete', 'step');
m.box(22, 0, -37.6, 25.5, 3.2, -31.8, 'concrete', 'step'); // top landing

// Interior ladder-stairs up to the south catwalk on the east side.
m.stairs(18.5, -6.2, 21.5, -4.35, '-x', 3.2, 9, 'metal', 'rail');

// Interior floor pillars, shipping containers, crates, and barrels.
for (const [x, z] of [[4, -14], [18, -14], [4, -26], [18, -26]]) {
  m.box(x - 0.35, 0, z - 0.35, x + 0.35, H, z + 0.35, 'concrete', 'wall2');
}
m.box(22.5, 0, -23.5, 26.2, 2.8, -15.5, 'metal', 'teal', { kind: 'container' });
m.box(-0.5, 0, -14.5, 5.5, 2.6, -11.5, 'metal', 'orange', { kind: 'container' });
m.crates(1, -21); m.crates(11, -18); m.crates(12, -27);
m.crate(24, -9); m.crate(25.2, -9); m.crate(24.6, -9, 1.0, 1.2);
m.crate(0.5, -34.5); m.crate(7.5, -34.5); m.crate(17, -9);
m.barrel(22, -26); m.barrel(22.6, -26.6); m.barrel(-1.2, -9.5);
m.box(8.5, 0, -24.5, 10.2, 1.2, -22.4, 'metal', 'yellow'); // forklift
m.box(8.5, 1.2, -24.5, 10.2, 2.5, -24.3, 'metal', 'rail');

// ---------- Exterior roof access ladders ----------
// West wall climb (off the front-west crate stack) and east wall climb.
m.stairs(W0 - 2.6, -9.2, W0, -6.8, '+x', 5.8, 14, 'metal', 'rail');
m.stairs(W1, -14.2, W1 + 2.6, -11.8, '-x', 5.8, 14, 'metal', 'rail');

// ---------- West elevated overpass & service alley ----------
// A concrete overpass runs north-south along the west edge at y = 3.2 m,
// climbed by a long paved ramp from the south street.
m.box(-38, 0, -38, -30, 3.2, 10, 'concrete', 'stone', { kind: 'block' }); // overpass deck
m.stairs(-38, 10, -30, 22, '-z', 3.2, 10, 'concrete', 'step'); // south approach ramp
m.box(-30.3, 3.2, -38, -30, 4.1, 10, 'concrete', 'trim'); // east parapet
m.box(-38, 3.2, -38, -37.7, 4.1, 10, 'concrete', 'trim'); // west parapet
m.crates(-34, -4); m.crate(-34, -22); m.barrel(-32, 6);
// Lower west alley cover between the overpass and the warehouse.
m.box(-24, 0, -18, -20.8, 2.6, -10, 'metal', 'blue', { kind: 'container' });
m.crates(-14, -8); m.crate(-21, -28); m.barrel(-19, -3);

// ---------- Front yard & central street building ----------
// Open paved yard south of the warehouse with containers and crates, split
// from the south street by a standalone mid-street building.
m.box(-14, 0, 1, -8, 2.6, 4.2, 'metal', 'teal', { kind: 'container' });
m.box(22, 0, 2, 25.2, 2.6, 10, 'metal', 'orange', { kind: 'container' });
m.crates(-3, 2); m.crate(6, 5); m.crate(7.2, 5); m.barrel(19, 1); m.barrel(19.6, 1.6);
m.box(-1, 0, 10, 4, 1.0, 10.6, 'concrete', 'stone'); // low concrete barrier
m.box(14, 0, 10, 19, 1.0, 10.6, 'concrete', 'stone');

// Standalone concrete building in the middle of the front approach.
m.block(-12, 14, 8, 24, 6.8, 'wall2');
m.box(-12.2, 6.8, 13.8, 8.2, 7.2, 24.2, 'concrete', 'roof');

// ---------- East high overlook tower ----------
// Elevated concrete platform on the east side of the street, climbed by a
// steep ladder-stair run on its south face.
m.box(25, 0, 14, 34, 5.4, 24, 'concrete', 'stone', { kind: 'block' });
m.box(25, 5.4, 14, 25.35, 6.4, 24, 'concrete', 'trim'); // west cover parapet
m.box(25, 5.4, 14, 34, 6.4, 14.35, 'concrete', 'trim'); // north cover parapet
m.stairs(29.5, 24, 32, 28, '-z', 5.4, 13, 'metal', 'rail');

// ---------- South street, cargo van & Blue spawn ----------
m.box(XW, 0, 40.5, X, 0.25, ZS, 'concrete', 'curb'); // south sidewalk
// Parked cargo van near the east side of Blue spawn (canvas box + cab).
m.box(15.5, 0, 29, 21.5, 2.8, 32.6, 'metal', 'white', { kind: 'container' }); // cargo body
m.box(13.2, 0, 29.2, 15.5, 2.1, 32.4, 'metal', 'blue'); // cab
m.box(-24, 0, 30, -19.5, 1.5, 32.2, 'metal', 'red'); // parked car
m.box(-36, 0, 31, -31.5, 1.5, 33.2, 'metal', 'dark'); // parked car
m.crates(-16, 26); m.crate(6, 30); m.barrel(25, 33); m.barrel(25.6, 33.6);
for (const [x, z] of [[-26, 26], [11, 26], [28, 36], [-26, 36]]) {
  m.box(x - 0.15, 0, z - 0.15, x + 0.15, 6.5, z + 0.15, 'metal', 'trim'); // street lamps
}

const ground = m.finishGround(XW, ZN, X, ZS);

const center = [0, 0];
export const WAREHOUSE = scaleMap({
  id: 'warehouse',
  name: 'Warehouse',
  type: 'hostage',
  size: 'Huge',
  boxes: m.boxes,
  water: m.waterRects,
  groundBoxes: ground,
  spawns: [
    [2, 0, -29], [16, 0, -29], [24, 3.2, -34], [8, 0, -10], [18, 0, -10], [-2, 0, -20],
    [10, 3.2, -33.5], [-4, 3.2, -16], [10, 3.2, -5.2], [-10, 3.2, -26],
    [-18, 0, -20], [-26, 0, -8], [-34, 3.2, -14], [-34, 3.2, 2],
    [-18, 0, 8], [10, 0, 4], [18, 0, 8], [28, 0, 6], [29, 5.4, 19],
    [-22, 0, 20], [14, 0, 20], [-14, 0, 35], [2, 0, 35], [22, 0, 36],
  ].map((s) => toSpawn(s, center)),
  teamSpawns: {
    red: spawnGrid(4, -31, 20, -28, 4, 2, center),
    blue: spawnGrid(-14, 34, 14, 38, 4, 2, center),
  },
  hostages: [[-13.5, 3.2, -31], [-11.5, 3.2, -31], [-9.5, 3.2, -26], [-12.5, 3.2, -26]],
  rescue: [{ min: [-14, 33], max: [12, 40] }],
  bounds: { min: [XW, ZN], max: [X, ZS] },
  sky: { top: 0x354463, bottom: 0xe6a672 },
  groundColor: m.C.ground,
  bedColor: m.C.ground,
}, 1.4);
