// "Yard": a small test arena. Boxes only (cheap collision and one draw call).
// Materials decide what bullets can punch through:
//   wood     - thin warehouse walls and crates (most guns go through)
//   metal    - container walls are solid; the thin fence sheets can be shot through
//   concrete - thick walls stop everything; the 20 cm lane walls stop all but rifles/AWP
//   grate    - platform railing

const COLORS = {
  concrete: 0xd9d1c1,
  wall: 0xc9bfae,
  wood: 0xc68a4e,
  crate: 0xb8743a,
  metal: 0x8d9aa8,
  grate: 0x5f6b78,
  teal: 0x2f8f9d,
  orange: 0xe0703d,
  yellow: 0xe3b43c,
  red: 0xc94c4c,
  platform: 0xa9a59b,
  step: 0xbdb7aa,
};

const boxes = [];
function box(x0, y0, z0, x1, y1, z1, material, color, extra = {}) {
  boxes.push({
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    material, color: color ?? COLORS[material], ...extra,
  });
}
function crate(x, z, size = 1.2, y = 0) {
  box(x - size / 2, y, z - size / 2, x + size / 2, y + size, z + size / 2, 'wood', COLORS.crate, { kind: 'crate' });
}

// Ground (drawn separately with a tiled texture).
box(-40, -1, -40, 40, 0, 40, 'concrete', COLORS.concrete, { render: false });

// Perimeter.
box(-33, 0, -33, 33, 6, -32, 'concrete', COLORS.wall);
box(-33, 0, 32, 33, 6, 33, 'concrete', COLORS.wall);
box(-33, 0, -32, -32, 6, 32, 'concrete', COLORS.wall);
box(32, 0, -32, 33, 6, 32, 'concrete', COLORS.wall);

// --- North warehouse: thin wooden walls, two doors on the front ---
const WH = 3.4, T = 0.15;
box(-22, 0, -18 - T, -15, WH, -18, 'wood', COLORS.wood);
box(-13, 0, -18 - T, -5, WH, -18, 'wood', COLORS.wood);
box(-3, 0, -18 - T, 2, WH, -18, 'wood', COLORS.wood);
box(-15, 2.4, -18 - T, -13, WH, -18, 'wood', COLORS.wood); // door lintels
box(-5, 2.4, -18 - T, -3, WH, -18, 'wood', COLORS.wood);
box(2 - T, 0, -32, 2, WH, -27, 'wood', COLORS.wood);
box(2 - T, 0, -25, 2, WH, -18, 'wood', COLORS.wood);
box(2 - T, 2.4, -27, 2, WH, -25, 'wood', COLORS.wood);
box(-22, 0, -32, -22 + T, WH, -24, 'wood', COLORS.wood);
box(-22, 0, -22, -22 + T, WH, -18, 'wood', COLORS.wood);
box(-22, 2.4, -24, -22 + T, WH, -22, 'wood', COLORS.wood);
// Inside
crate(-18, -28.5); crate(-16.8, -28.5); crate(-18, -28.5, 1.2, 1.2);
crate(-9, -23); crate(-9, -21.8);
crate(-3, -29); crate(-3, -27.8, 1.0);
box(-14, 0, -26.5, -10, 1.0, -26.0, 'metal', COLORS.metal); // workbench

// --- Center monument ---
box(-2, 0, -2, 2, 2.6, 2, 'concrete', COLORS.wall);
box(-2.6, 0, -2.6, 2.6, 0.4, 2.6, 'concrete', COLORS.step);
crate(4.2, 1.5); crate(-4.0, -1.0); crate(1.0, 4.4, 1.0);

// --- East yard: shipping containers (thick metal) ---
box(18, 0, -14, 20.5, 2.6, -8, 'metal', COLORS.teal, { kind: 'container' });
box(24, 0, -4, 30, 2.6, -1.5, 'metal', COLORS.orange, { kind: 'container' });
box(20, 0, 6, 22.5, 2.6, 12, 'metal', COLORS.yellow, { kind: 'container' });
box(20, 2.6, 6.5, 22.5, 5.2, 12.5, 'metal', COLORS.teal, { kind: 'container' });
box(26, 0, 14, 28.5, 2.6, 20, 'metal', COLORS.red, { kind: 'container' });
crate(16, 2); crate(16, 3.2); crate(26, -20); crate(27.2, -20); crate(26.6, -20, 1.2, 1.2);
// Thin metal fence sheets (rifles punch through)
box(12, 0, -7, 12.06, 2.2, 1, 'metal', COLORS.metal, { kind: 'sheet' });
box(8, 0, 18, 14, 2.2, 18.06, 'metal', COLORS.metal, { kind: 'sheet' });

// --- South platform with stairs ---
const PH = 2.4;
box(-12, 0, 23, 8, PH, 32, 'concrete', COLORS.platform);
for (let i = 0; i < 7; i++) {
  const top = PH - 0.3 * (i + 1);
  box(8 + i * 0.45, 0, 27, 8 + (i + 1) * 0.45, top, 30, 'concrete', COLORS.step);
  box(-12 - (i + 1) * 0.45, 0, 24.5, -12 - i * 0.45, top, 27.5, 'concrete', COLORS.step);
}
// Railing (grate) with a gap in the middle
box(-12, PH, 22.95, -3, PH + 1.0, 23.05, 'grate', COLORS.grate);
box(-1, PH, 22.95, 8, PH + 1.0, 23.05, 'grate', COLORS.grate);
crate(-8, 29); crate(4, 30, 1.0, PH);

// --- West lanes: thin concrete walls (20 cm) ---
box(-26.2, 0, -10, -26, 3, -2, 'concrete', COLORS.wall);
box(-20.2, 0, 2, -20, 3, 10, 'concrete', COLORS.wall);
box(-26.2, 0, 6, -26, 3, 14, 'concrete', COLORS.wall);
crate(-23, -6); crate(-23, 12); crate(-29, 2); crate(-29, 3.2);

// Low cover walls (thick concrete)
box(-9, 0, 13.7, -4, 1.1, 14.3, 'concrete', COLORS.step);
box(4, 0, -12.3, 9, 1.1, -11.7, 'concrete', COLORS.step);
box(-12, 0, -8, -11.4, 1.1, -3, 'concrete', COLORS.step);
crate(8, 10); crate(-7, 6); crate(10, -18); crate(-26, 22); crate(-24.8, 22); crate(24, 26);

// Spawns: face the middle of the map.
const spawnSpots = [
  [-18, 0, -21], [-7, 0, -25], [-28, 0, -28], [28, 0, -28], [28, 0, -9],
  [29, 0, 8], [24, 0, 29], [14, 0, 26], [-2, PH, 28], [-28, 0, 28],
  [-29, 0, 9], [-29, 0, -14], [8, 0, -26], [14, 0, 10], [-15, 0, 18],
];
const spawns = spawnSpots.map(([x, y, z]) => ({ pos: [x, y, z], yaw: Math.atan2(x, z) }));

export const YARD = {
  name: 'Yard',
  boxes,
  spawns,
  bounds: { min: [-32, -32], max: [32, 32] },
  sky: { top: 0x5fa8e8, bottom: 0xcfe6f5 },
  groundColor: COLORS.concrete,
};
