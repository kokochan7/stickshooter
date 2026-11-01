// "Yard": the small deathmatch arena, 56 x 56 m with the north-east and
// south-west corners walled off, so it plays along the diagonal. Red starts
// in the north-west corner and Blue in the south-east corner. The whole map
// is point-symmetric (every piece has a twin turned 180 degrees about the
// center monument), so neither side has a better spawn, building or
// platform. Materials decide what bullets can punch through:
//   wood     - thin warehouse walls and crates (most guns go through)
//   metal    - containers are solid; the thin fence sheets can be shot through
//   concrete - thick walls stop everything; the 20 cm lane walls stop all but rifles/AWP
//   grate    - platform railing
import { mapBuilder, toSpawn } from './builder.js';

const m = mapBuilder({
  ground: 0xd9d1c1, wall: 0xc9bfae, wood: 0xc68a4e, crate: 0xb8743a, metal: 0x8d9aa8, grate: 0x5f6b78,
  teal: 0x2f8f9d, orange: 0xe0703d, yellow: 0xe3b43c, red: 0xc94c4c, platform: 0xa9a59b, step: 0xbdb7aa,
});

const S = 28;
const PH = 2.4; // platform height

// --- One half (Red's, north-west); the other half is this turned 180° ---

// The cut-off north-east corner, in two steps.
m.block(12, -S, S, -21, 6, 'wall'); m.block(20, -21, S, -12, 6, 'wall');

// Red spawn corner cover.
m.crates(-14, -25); m.crate(-25, -13); m.crate(-23.8, -13);

// Warehouse: thin wooden walls.
m.building(-17, -22, -5, -12, 3.4, {
  material: 'wood', col: 'wood', roofCol: 'wall', t: 0.15,
  doors: { s: [[-12, -9.5]], e: [[-19.5, -17]], w: [[-17.5, -15]], n: [[-9, -7]] },
});
m.crate(-14.5, -19.5); m.crate(-13.3, -19.5); m.crate(-14.5, -19.5, 1.2, 1.2); m.crate(-7.5, -14.5);
m.box(-12, 0, -21.2, -8, 1.0, -20.7, 'metal', 'metal'); // workbench

// Platform with stairs on its east side and a railing.
m.box(-26, 0, -2, -19, PH, 8, 'concrete', 'platform');
m.stairs(-19, 2, -15.5, 5, '-x', PH, 7, 'concrete', 'step');
m.box(-19.05, PH, -2, -18.95, PH + 1.0, 2, 'grate', 'grate');
m.box(-19.05, PH, 5, -18.95, PH + 1.0, 8, 'grate', 'grate');
m.crate(-24.5, 6.5, 1.0, PH);

// Containers (thick metal) toward the cut corner.
const cont = (x0, z0, x1, z1, col, y = 0) => m.box(x0, y, z0, x1, y + 2.6, z1, 'metal', col, { kind: 'container' });
cont(3, -25, 5.5, -19, 'teal');
cont(7, -14, 13, -11.5, 'orange'); cont(7, -14, 13, -11.5, 'yellow', 2.6);
m.crate(10, -19); m.crate(16, -9);

// Thin metal fence sheet (rifles punch through) and 20 cm lane walls.
m.box(13, 0, -6, 13.06, 2.2, 1, 'metal', 'metal', { kind: 'sheet' });
m.box(-12.2, 0, 3, -12, 3, 11, 'concrete', 'wall');
m.box(-26, 0, 13, -20, 3, 13.2, 'concrete', 'wall');

// Low cover walls (thick concrete).
m.box(-9, 0, -5.3, -4, 1.1, -4.7, 'concrete', 'step');
m.box(1, 0, -10, 1.6, 1.1, -6, 'concrete', 'step');

// --- Turn the half around the center ---
for (const b of [...m.boxes]) {
  m.boxes.push({ ...b, min: [-b.max[0], b.min[1], -b.max[2]], max: [-b.min[0], b.max[1], -b.min[2]] });
}

// --- The center monument (its own twin) ---
m.perimeter(-S, -S, S, S, 6, 'wall');
m.box(-2, 0, -2, 2, 2.6, 2, 'concrete', 'wall');
m.box(-2.6, 0, -2.6, 2.6, 0.4, 2.6, 'concrete', 'step');
m.crate(4.2, 1.5); m.crate(-4.2, -1.5);

m.finishGround(-S, -S, S, S);

const half = (pts) => pts.flatMap(([x, y, z]) => [[x, y, z], [-x, y, -z]]);

// Free for all spawns: everywhere, in symmetric pairs, facing the middle.
const spawns = half([
  [-23, 0, -23], [-22, 0, -4], [-11, 0, -17], [-2, 0, -24], [8, 0, -22],
  [-7, 0, 8], [-16, 0, 18], [16, 0, -16], [-22.5, PH, 3],
]).map((s) => toSpawn(s));

// Teams: Red in the north-west corner, Blue in the south-east corner.
const redSpots = [[-24, 0, -24], [-21, 0, -25], [-25, 0, -21], [-21, 0, -21], [-18, 0, -25], [-25, 0, -18], [-18, 0, -21], [-21, 0, -18]];
const teamSpawns = {
  red: redSpots.map((s) => toSpawn(s)),
  blue: redSpots.map(([x, y, z]) => toSpawn([-x, y, -z])),
};

export const YARD = {
  id: 'yard',
  name: 'Yard',
  type: 'dm',
  size: 'Small',
  boxes: m.boxes,
  spawns,
  teamSpawns,
  bounds: { min: [-S, -S], max: [S, S] },
  sky: { top: 0x5fa8e8, bottom: 0xcfe6f5 },
  groundColor: m.C.ground,
};
