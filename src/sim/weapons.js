// Weapon table. Numbers follow Counter-Strike 1.6 (damage, range modifier,
// penetration, armor ratio, fire cycle, magazine, move speed, price, spread and
// recoil "KickBack" tables) so the guns feel like CS. Distances are CS units.
//
// spread: per movement state, [a, b] => spread = a + b * acc
//   rifle-style weapons: acc grows with consecutive shots (accuracy curve)
//   pistol-style weapons: acc = 1 - pistolAccuracy (drops with fast tapping)
// kick: KickBack(upBase, latBase, upMod, latMod, upMax, latMax, dirChange)
//   per movement state, or { punch: [min, max] } for a single vertical punch.

export const BULLETS = {
  '9mm': { power: 21, penDist: 800 },
  '45acp': { power: 15, penDist: 500 },
  '50ae': { power: 30, penDist: 1000 },
  '57mm': { power: 30, penDist: 2000 },
  '556': { power: 35, penDist: 4000 },
  '762': { power: 39, penDist: 5000 },
  '338': { power: 45, penDist: 8000 },
  buckshot: { power: 0, penDist: 0 },
};

const W = {};

W.usp = {
  name: 'USP', slot: 'secondary', category: 'Pistols', price: 500,
  damage: 34, rangeMod: 0.79, range: 4096, bullet: '45acp', penetration: 1, armorRatio: 1.0,
  cycle: 0.15, auto: false, clip: 12, reserve: 100, reload: 2.7, deploy: 0.6, speed: 250,
  accuracy: { type: 'pistol', start: 0.92, min: 0.6, window: 0.3, loss: 0.275 },
  spread: { air: [0, 1.2], run: [0, 0.225], duck: [0, 0.08], stand: [0, 0.1] },
  kick: { punch: [2, 2] },
};

W.deagle = {
  name: 'Desert Eagle', slot: 'secondary', category: 'Pistols', price: 650,
  damage: 54, rangeMod: 0.81, range: 4096, bullet: '50ae', penetration: 2, armorRatio: 1.5,
  cycle: 0.225, auto: false, clip: 7, reserve: 35, reload: 2.2, deploy: 0.6, speed: 250,
  accuracy: { type: 'pistol', start: 0.9, min: 0.55, window: 0.4, loss: 0.35 },
  spread: { air: [0, 1.5], run: [0, 0.25], duck: [0, 0.115], stand: [0, 0.13] },
  kick: { punch: [2, 2] },
};

W.uzi = {
  name: 'UZI', slot: 'primary', category: 'SMGs', price: 1250,
  damage: 27, rangeMod: 0.84, range: 4096, bullet: '9mm', penetration: 1, armorRatio: 0.95,
  cycle: 0.07, auto: true, clip: 32, reserve: 128, reload: 2.4, deploy: 0.75, speed: 250,
  accuracy: { type: 'rifle', pow: 3, div: 200, offset: 0.55, max: 1.4 },
  spread: { air: [0, 0.25], run: [0, 0.03], duck: [0, 0.03], stand: [0, 0.03] },
  kick: {
    air: [1.3, 0.55, 0.4, 0.05, 4.75, 3.75, 5],
    run: [0.9, 0.45, 0.25, 0.035, 3.5, 2.75, 7],
    duck: [0.75, 0.4, 0.175, 0.03, 2.75, 2.5, 10],
    stand: [0.775, 0.425, 0.2, 0.03, 3, 2.75, 9],
  },
};

W.mp5 = {
  name: 'MP5', slot: 'primary', category: 'SMGs', price: 1500,
  damage: 26, rangeMod: 0.84, range: 8192, bullet: '9mm', penetration: 1, armorRatio: 1.0,
  cycle: 0.075, auto: true, clip: 30, reserve: 120, reload: 2.63, deploy: 0.75, speed: 250,
  accuracy: { type: 'rifle', pow: 2, div: 220.1, offset: 0.45, max: 0.75 },
  spread: { air: [0, 0.2], run: [0, 0.04], duck: [0, 0.04], stand: [0, 0.04] },
  kick: {
    air: [0.9, 0.475, 0.35, 0.0425, 5, 3, 6],
    run: [0.5, 0.275, 0.2, 0.03, 3, 2, 10],
    duck: [0.225, 0.15, 0.1, 0.015, 2, 1, 10],
    stand: [0.25, 0.175, 0.125, 0.02, 2.25, 1.25, 10],
  },
};

W.ump45 = {
  name: 'UMP45', slot: 'primary', category: 'SMGs', price: 1700,
  damage: 30, rangeMod: 0.82, range: 4096, bullet: '45acp', penetration: 1, armorRatio: 1.0,
  cycle: 0.1, auto: true, clip: 25, reserve: 100, reload: 3.5, deploy: 0.75, speed: 250,
  accuracy: { type: 'rifle', pow: 2, div: 210, offset: 0.5, max: 1 },
  spread: { air: [0, 0.24], run: [0, 0.04], duck: [0, 0.04], stand: [0, 0.04] },
  kick: {
    air: [0.125, 0.65, 0.55, 0.0475, 5.5, 4, 10],
    run: [0.55, 0.3, 0.225, 0.03, 3.5, 2.5, 10],
    duck: [0.25, 0.175, 0.125, 0.02, 2.25, 1.25, 10],
    stand: [0.275, 0.2, 0.15, 0.0225, 2.5, 1.5, 10],
  },
};

W.p90 = {
  name: 'P90', slot: 'primary', category: 'SMGs', price: 2350,
  damage: 21, rangeMod: 0.885, range: 8192, bullet: '57mm', penetration: 1, armorRatio: 1.5,
  cycle: 0.066, auto: true, clip: 50, reserve: 100, reload: 3.4, deploy: 0.75, speed: 245,
  runThreshold: 170,
  accuracy: { type: 'rifle', pow: 2, div: 175, offset: 0.45, max: 1 },
  spread: { air: [0, 0.3], run: [0, 0.115], duck: [0, 0.045], stand: [0, 0.045] },
  kick: {
    air: [0.9, 0.45, 0.35, 0.04, 5.25, 3.5, 4],
    run: [0.45, 0.3, 0.2, 0.0275, 4, 2.25, 7],
    duck: [0.275, 0.2, 0.125, 0.02, 3, 1, 9],
    stand: [0.3, 0.225, 0.125, 0.02, 3.25, 1.25, 8],
  },
};

W.shotgun = {
  name: 'Shotgun', slot: 'primary', category: 'Shotguns', price: 1700,
  damage: 20, pellets: 9, range: 3000, bullet: 'buckshot', penetration: 0, armorRatio: 1.0,
  cycle: 0.875, auto: true, clip: 8, reserve: 32, shellReload: { start: 0.45, each: 0.45 },
  deploy: 0.75, speed: 230,
  accuracy: { type: 'none' },
  pelletSpread: 0.0675,
  kick: { punch: [4, 6], airPunch: [8, 11] },
};

W.autoshotgun = {
  name: 'Auto Shotgun', slot: 'primary', category: 'Shotguns', price: 3000,
  damage: 20, pellets: 6, range: 3048, bullet: 'buckshot', penetration: 0, armorRatio: 1.0,
  cycle: 0.25, auto: true, clip: 7, reserve: 32, shellReload: { start: 0.45, each: 0.3 },
  deploy: 0.75, speed: 240,
  accuracy: { type: 'none' },
  pelletSpread: 0.0725,
  kick: { punch: [3, 5], airPunch: [7, 10] },
};

W.famas = {
  name: 'FAMAS', slot: 'primary', category: 'Rifles', price: 2250,
  damage: 30, rangeMod: 0.96, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.4,
  cycle: 0.0825, auto: true, clip: 25, reserve: 90, reload: 3.3, deploy: 0.75, speed: 240,
  accuracy: { type: 'rifle', pow: 3, div: 215, offset: 0.3, max: 1 },
  spread: { air: [0.03, 0.3], run: [0.03, 0.07], duck: [0, 0.02], stand: [0, 0.02] },
  kick: {
    air: [1.25, 0.45, 0.22, 0.18, 5.5, 4, 5],
    run: [1, 0.45, 0.275, 0.05, 4, 2.5, 7],
    duck: [0.575, 0.325, 0.2, 0.011, 3.25, 2, 8],
    stand: [0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8],
  },
};

W.ak47 = {
  name: 'AK47', slot: 'primary', category: 'Rifles', price: 2500,
  damage: 36, rangeMod: 0.98, range: 8192, bullet: '762', penetration: 2, armorRatio: 1.55,
  cycle: 0.0955, auto: true, clip: 30, reserve: 90, reload: 2.45, deploy: 0.75, speed: 221,
  accuracy: { type: 'rifle', pow: 3, div: 200, offset: 0.35, max: 1.25 },
  spread: { air: [0.04, 0.4], run: [0.04, 0.07], duck: [0, 0.0275], stand: [0, 0.0275] },
  kick: {
    air: [2, 1, 0.5, 0.35, 9, 6, 5],
    run: [1.5, 0.45, 0.225, 0.05, 6.5, 2.5, 7],
    duck: [0.9, 0.35, 0.15, 0.025, 5.5, 1.5, 9],
    stand: [1, 0.375, 0.175, 0.0375, 5.75, 1.75, 8],
  },
};

W.m4a1 = {
  name: 'M4A1', slot: 'primary', category: 'Rifles', price: 3100,
  damage: 33, rangeMod: 0.97, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.4,
  cycle: 0.0875, auto: true, clip: 30, reserve: 90, reload: 3.05, deploy: 0.75, speed: 230,
  accuracy: { type: 'rifle', pow: 3, div: 220, offset: 0.3, max: 1 },
  spread: { air: [0.035, 0.4], run: [0.035, 0.07], duck: [0, 0.025], stand: [0, 0.025] },
  kick: {
    air: [1, 0.45, 0.28, 0.045, 3.75, 3, 7],
    run: [1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6],
    duck: [0.6, 0.3, 0.2, 0.0125, 3.25, 2, 7],
    stand: [0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7],
  },
};

W.awp = {
  name: 'AWP', slot: 'primary', category: 'Snipers', price: 4750,
  damage: 115, rangeMod: 0.99, range: 8192, bullet: '338', penetration: 3, armorRatio: 1.95,
  cycle: 1.45, auto: true, clip: 10, reserve: 30, reload: 2.5, deploy: 1.1, speed: 210,
  scopedSpeed: 150, zoomLevels: [40, 10], runThreshold: 140,
  accuracy: { type: 'sniper' },
  // [air, run (>140), walk (>10), duck, stand], unscoped adds 0.08
  sniperSpread: { air: 0.85, run: 0.25, walk: 0.1, duck: 0, stand: 0.001, unscoped: 0.08 },
  kick: { punch: [2, 2] },
};

W.minigun = {
  name: 'Mini Gun', slot: 'primary', category: 'Heavy', price: 5750,
  // Not in CS 1.6. Built from the M249's numbers with a faster cycle,
  // a spin-up before it fires, and a heavier movement penalty.
  damage: 30, rangeMod: 0.97, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.5,
  cycle: 0.055, auto: true, clip: 150, reserve: 300, reload: 5.0, deploy: 1.2, speed: 190,
  spinUp: 0.45,
  accuracy: { type: 'rifle', pow: 3, div: 175, offset: 0.4, max: 0.9 },
  spread: { air: [0.05, 0.5], run: [0.045, 0.1], duck: [0, 0.03], stand: [0, 0.035] },
  kickScale: 0.55,
  kick: {
    air: [1.8, 0.65, 0.45, 0.125, 5, 3.5, 8],
    run: [1.1, 0.5, 0.3, 0.06, 4, 3, 8],
    duck: [0.75, 0.325, 0.25, 0.025, 3.5, 2.5, 9],
    stand: [0.8, 0.35, 0.3, 0.03, 3.75, 3, 9],
  },
};

// CS 1.6 knife (wpn_knife.cpp). Mouse 1 slashes (20 on the first swing, 15
// when swinging again right away, 48 units of reach). Mouse 2 stabs (65, 32
// units of reach, x3 from behind). Hitgroup multipliers and armor apply like
// they do for bullets. Always carried, can't be bought or dropped.
W.knife = {
  name: 'Knife', slot: 'melee', category: 'Melee', price: 0,
  damage: 15, range: 48, bullet: null, penetration: 0, armorRatio: 1.0,
  cycle: 0.4, auto: true, clip: 0, reserve: 0, deploy: 0.5, speed: 250,
  accuracy: { type: 'none' }, kick: { punch: [0, 0] },
  melee: {
    slash: { damage: 15, firstDamage: 20, range: 48, hitCycle: 0.4, missCycle: 0.35, altDelay: 0.5 },
    stab: { damage: 65, range: 32, hitCycle: 1.1, missCycle: 1.0, backstabMul: 3 },
  },
};

for (const [id, w] of Object.entries(W)) {
  w.id = id;
  w.runThreshold ??= 140;
  w.kickScale ??= 1;
}

export const WEAPONS = W;

// Order shown in the shop, matching the reference list.
export const SHOP_ORDER = [
  'usp', 'uzi', 'deagle', 'mp5', 'shotgun', 'autoshotgun', 'ump45',
  'famas', 'p90', 'ak47', 'm4a1', 'awp', 'minigun',
];

export const GEAR = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  kevlarHelmet: { name: 'Kevlar + Helmet', price: 1000 },
  defuser: { name: 'Defuse Kit', price: 200 },
};

// Rough 0..1 ratings for the shop's stat bars.
export function weaponRatings(w) {
  const dmg = w.pellets ? w.damage * w.pellets : w.damage;
  return {
    damage: Math.min(1, dmg / 180),
    fireRate: Math.min(1, 0.066 / w.cycle),
    accuracy: w.pellets ? 0.15 : w.accuracy.type === 'sniper' ? 1 : Math.max(0.1, 1 - (w.spread?.stand?.[1] ?? 0.05) * 6 - (w.kick.stand?.[0] ?? 0.4) * 0.3),
    range: w.pellets ? 0.15 : Math.pow(w.rangeMod, 6),
    mobility: (w.speed - 180) / 70,
  };
}

// What a carried or dropped gun is worth to a bot deciding whether to swap:
// its price, or nothing once it's out of ammo.
export function weaponValue(w) {
  const d = w && W[w.id];
  if (!d || d.melee) return 0;
  return w.clip + w.reserve > 0 ? d.price : 0;
}
