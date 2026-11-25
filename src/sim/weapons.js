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
  '357sig': { power: 25, penDist: 800 },
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

W.glock18 = {
  name: 'Glock-18', slot: 'secondary', category: 'Pistols', price: 400,
  damage: 25, rangeMod: 0.75, range: 8192, bullet: '9mm', penetration: 1, armorRatio: 1.05,
  cycle: 0.15, auto: false, clip: 20, reserve: 120, reload: 2.2, deploy: 0.6, speed: 250,
  accuracy: { type: 'pistol', start: 0.9, min: 0.6, window: 0.325, loss: 0.275 },
  spread: { air: [0, 1.0], run: [0, 0.165], duck: [0, 0.075], stand: [0, 0.1] },
  // Mouse 2 toggles a three-round burst: 0.1 s between the rounds, 0.5 s
  // before the next burst, and looser spread while it's on (CS GLOCK18Fire).
  burst: { shots: 3, gap: 0.1, cycle: 0.5, spread: { air: [0, 1.2], run: [0, 0.185], duck: [0, 0.095], stand: [0, 0.3] } },
  kick: { punch: [2, 2] },
};

W.p228 = {
  name: 'P228', slot: 'secondary', category: 'Pistols', price: 600,
  damage: 32, rangeMod: 0.8, range: 4096, bullet: '357sig', penetration: 1, armorRatio: 1.25,
  cycle: 0.15, auto: false, clip: 13, reserve: 52, reload: 2.7, deploy: 0.6, speed: 250,
  accuracy: { type: 'pistol', start: 0.9, min: 0.6, window: 0.325, loss: 0.3 },
  spread: { air: [0, 1.5], run: [0, 0.255], duck: [0, 0.075], stand: [0, 0.15] },
  kick: { punch: [2, 2] },
};

W.elites = {
  name: 'Dual Berettas', slot: 'secondary', category: 'Pistols', price: 800,
  damage: 36, rangeMod: 0.75, range: 8192, bullet: '9mm', penetration: 1, armorRatio: 1.05,
  cycle: 0.12, auto: false, clip: 30, reserve: 120, reload: 4.5, deploy: 1.1, speed: 250,
  accuracy: { type: 'pistol', start: 0.88, min: 0.55, window: 0.325, loss: 0.275 },
  spread: { air: [0, 1.3], run: [0, 0.175], duck: [0, 0.08], stand: [0, 0.1] },
  kick: { punch: [2, 2] },
  dual: true, // fires the left and right pistol in turn
};

W.fiveseven = {
  name: 'Five-SeveN', slot: 'secondary', category: 'Pistols', price: 750,
  damage: 20, rangeMod: 0.885, range: 4096, bullet: '57mm', penetration: 1, armorRatio: 1.5,
  cycle: 0.15, auto: false, clip: 20, reserve: 100, reload: 2.7, deploy: 0.6, speed: 250,
  accuracy: { type: 'pistol', start: 0.92, min: 0.725, window: 0.275, loss: 0.25 },
  spread: { air: [0, 1.5], run: [0, 0.255], duck: [0, 0.075], stand: [0, 0.15] },
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

W.mac10 = {
  name: 'MAC-10', slot: 'primary', category: 'SMGs', price: 1400,
  damage: 29, rangeMod: 0.82, range: 8192, bullet: '45acp', penetration: 1, armorRatio: 0.95,
  cycle: 0.07, auto: true, clip: 30, reserve: 100, reload: 3.15, deploy: 0.75, speed: 250,
  accuracy: { type: 'rifle', pow: 3, div: 200, offset: 0.6, max: 1.65 },
  spread: { air: [0, 0.375], run: [0, 0.03], duck: [0, 0.03], stand: [0, 0.03] },
  kick: {
    air: [1.3, 0.55, 0.4, 0.05, 4.75, 3.75, 5],
    run: [0.9, 0.45, 0.25, 0.035, 3.5, 2.75, 7],
    duck: [0.75, 0.4, 0.175, 0.03, 2.75, 2.5, 10],
    stand: [0.775, 0.425, 0.2, 0.03, 3, 2.75, 9],
  },
};

W.tmp = {
  name: 'TMP', slot: 'primary', category: 'SMGs', price: 1250,
  damage: 20, rangeMod: 0.85, range: 4096, bullet: '9mm', penetration: 1, armorRatio: 1.0,
  cycle: 0.07, auto: true, clip: 30, reserve: 120, reload: 2.12, deploy: 0.75, speed: 250,
  accuracy: { type: 'rifle', pow: 2, div: 200, offset: 0.55, max: 1.4 },
  spread: { air: [0, 0.25], run: [0, 0.03], duck: [0, 0.03], stand: [0, 0.03] },
  kick: {
    air: [1.1, 0.5, 0.35, 0.045, 4.5, 3.5, 6],
    run: [0.8, 0.4, 0.2, 0.03, 3, 2.5, 7],
    duck: [0.7, 0.35, 0.125, 0.025, 2.5, 2, 10],
    stand: [0.725, 0.375, 0.15, 0.025, 2.75, 2.25, 9],
  },
  silenced: true, // quiet, no muzzle flash, heard from much closer
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

W.galil = {
  name: 'Galil', slot: 'primary', category: 'Rifles', price: 2000,
  damage: 30, rangeMod: 0.98, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.55,
  cycle: 0.0875, auto: true, clip: 35, reserve: 90, reload: 2.45, deploy: 0.75, speed: 240,
  accuracy: { type: 'rifle', pow: 3, div: 200, offset: 0.35, max: 1.25 },
  spread: { air: [0.04, 0.3], run: [0.04, 0.07], duck: [0, 0.0375], stand: [0, 0.0375] },
  kick: {
    air: [2, 1, 0.5, 0.35, 9, 6, 5],
    run: [1.2, 0.5, 0.23, 0.15, 5.5, 3.5, 6],
    duck: [0.6, 0.3, 0.2, 0.0125, 4, 2.25, 7],
    stand: [0.65, 0.35, 0.25, 0.015, 3.5, 2.25, 7],
  },
};

W.famas = {
  name: 'FAMAS', slot: 'primary', category: 'Rifles', price: 2250,
  damage: 30, rangeMod: 0.96, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.4,
  cycle: 0.0825, auto: true, clip: 25, reserve: 90, reload: 3.3, deploy: 0.75, speed: 240,
  accuracy: { type: 'rifle', pow: 3, div: 215, offset: 0.3, max: 1 },
  spread: { air: [0.03, 0.3], run: [0.03, 0.07], duck: [0, 0.02], stand: [0, 0.02] },
  // Mouse 2 toggles a three-round burst like CS 1.6 (WPNSTATE_FAMAS_BURST_MODE):
  // 0.05 s between the rounds, 0.55 s before the next burst, and +0.01 spread.
  burst: { shots: 3, gap: 0.05, cycle: 0.55, spread: { air: [0.04, 0.3], run: [0.04, 0.07], duck: [0.01, 0.02], stand: [0.01, 0.02] } },
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

// The two scoped rifles zoom once (CS 55 degree FOV, rifle sight overlay) and
// fire slower while zoomed. The SG 552 also slows you down when zoomed.
W.sg552 = {
  name: 'SG 552', slot: 'primary', category: 'Rifles', price: 3500,
  damage: 33, rangeMod: 0.955, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.4,
  cycle: 0.0825, scopedCycle: 0.135, auto: true, clip: 30, reserve: 90, reload: 3.0, deploy: 0.75, speed: 235,
  scopedSpeed: 200, zoomLevels: [55],
  accuracy: { type: 'rifle', pow: 3, div: 220, offset: 0.3, max: 1 },
  spread: { air: [0.035, 0.45], run: [0.035, 0.075], duck: [0, 0.02], stand: [0, 0.02] },
  kick: {
    air: [1.25, 0.45, 0.22, 0.18, 6, 4, 5],
    run: [1, 0.45, 0.28, 0.04, 4.25, 2.5, 7],
    duck: [0.6, 0.35, 0.2, 0.0125, 3.7, 2, 10],
    stand: [0.625, 0.375, 0.25, 0.0125, 4, 2.25, 9],
  },
};

W.aug = {
  name: 'AUG', slot: 'primary', category: 'Rifles', price: 3500,
  damage: 32, rangeMod: 0.96, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.4,
  cycle: 0.0825, scopedCycle: 0.135, auto: true, clip: 30, reserve: 90, reload: 3.3, deploy: 0.75, speed: 240,
  zoomLevels: [55],
  accuracy: { type: 'rifle', pow: 3, div: 215, offset: 0.3, max: 1 },
  spread: { air: [0.035, 0.4], run: [0.035, 0.07], duck: [0, 0.02], stand: [0, 0.02] },
  kick: {
    air: [1, 0.45, 0.275, 0.05, 4, 2.5, 7],
    run: [1.25, 0.45, 0.22, 0.18, 5.5, 4, 5],
    duck: [0.575, 0.325, 0.2, 0.011, 3.25, 2, 8],
    stand: [0.625, 0.375, 0.25, 0.0125, 3.5, 2.25, 8],
  },
};

W.scout = {
  name: 'Scout', slot: 'primary', category: 'Snipers', price: 2750,
  damage: 75, rangeMod: 0.98, range: 8192, bullet: '762', penetration: 3, armorRatio: 1.7,
  cycle: 1.25, auto: true, clip: 10, reserve: 90, reload: 2.0, deploy: 1.0, speed: 260,
  scopedSpeed: 220, zoomLevels: [40, 15], bolt: true, scope: true,
  accuracy: { type: 'sniper' },
  // CS: in the air 0.2, running (>170) 0.075, crouched 0, else 0.007.
  sniperSpread: { air: 0.2, run: 0.075, runSpeed: 170, duck: 0, stand: 0.007, unscoped: 0.025 },
  kick: { punch: [2, 2] },
};

W.awp = {
  name: 'AWP', slot: 'primary', category: 'Snipers', price: 4750,
  damage: 115, rangeMod: 0.99, range: 8192, bullet: '338', penetration: 3, armorRatio: 1.95,
  cycle: 1.45, auto: true, clip: 10, reserve: 30, reload: 2.5, deploy: 1.1, speed: 210,
  scopedSpeed: 150, zoomLevels: [40, 10], runThreshold: 140, bolt: true, scope: true,
  accuracy: { type: 'sniper' },
  // [air, run (>140), walk (>10), duck, stand], unscoped adds 0.08
  sniperSpread: { air: 0.85, run: 0.25, walk: 0.1, duck: 0, stand: 0.001, unscoped: 0.08 },
  kick: { punch: [2, 2] },
};

// Auto snipers: semi-automatic, two zoom levels, and accuracy that comes
// back with the time since the last shot (CS: G3SG1 0.55 + 0.3 per second,
// SG550 0.65 + 0.35, capped at 0.98). Spread is k * (1 - accuracy) in the
// air, crouched or standing, and a flat 0.15 while moving.
W.g3sg1 = {
  name: 'G3SG1', slot: 'primary', category: 'Snipers', price: 5000,
  damage: 80, rangeMod: 0.98, range: 8192, bullet: '762', penetration: 3, armorRatio: 1.65,
  cycle: 0.25, auto: false, clip: 20, reserve: 90, reload: 3.5, deploy: 1.0, speed: 210,
  scopedSpeed: 150, zoomLevels: [40, 15], scope: true,
  accuracy: { type: 'autosniper', base: 0.55, rate: 0.3 },
  autoSpread: { air: 0.45, run: 0.15, duck: 0.035, stand: 0.055, unscoped: 0.025 },
  kick: { punch: [0.75, 1.75], punchCarry: 0.25, punchSide: 0.75 },
};

W.sg550 = {
  name: 'SG550', slot: 'primary', category: 'Snipers', price: 4200,
  damage: 70, rangeMod: 0.98, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.45,
  cycle: 0.25, auto: false, clip: 30, reserve: 90, reload: 3.35, deploy: 1.0, speed: 210,
  scopedSpeed: 150, zoomLevels: [40, 15], scope: true,
  accuracy: { type: 'autosniper', base: 0.65, rate: 0.35 },
  autoSpread: { air: 0.45, run: 0.15, duck: 0.04, stand: 0.05, unscoped: 0.025 },
  kick: { punch: [0.75, 1.25], punchCarry: 0.25, punchSide: 0.75 },
};

W.m249 = {
  name: 'M249', slot: 'primary', category: 'Heavy', price: 5750,
  damage: 32, rangeMod: 0.97, range: 8192, bullet: '556', penetration: 2, armorRatio: 1.5,
  cycle: 0.1, auto: true, clip: 100, reserve: 200, reload: 4.7, deploy: 1.0, speed: 220,
  accuracy: { type: 'rifle', pow: 3, div: 175, offset: 0.4, max: 0.9 },
  spread: { air: [0.045, 0.5], run: [0.045, 0.095], duck: [0, 0.03], stand: [0, 0.03] },
  kick: {
    air: [1.8, 0.65, 0.45, 0.125, 5, 3.5, 8],
    run: [1.1, 0.5, 0.3, 0.06, 4, 3, 8],
    duck: [0.75, 0.325, 0.25, 0.025, 3.5, 2.5, 9],
    stand: [0.8, 0.35, 0.3, 0.03, 3.75, 3, 9],
  },
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

// Knife, after CS 1.6 (wpn_knife.cpp) but deadlier and easier to land, at
// Kenny's request. Mouse 1 slashes (30 on the first swing, 25 when swinging
// again right away; CS 20/15). Mouse 2 stabs (80; CS 65). The blade goes
// through kevlar (armorRatio 2 cancels the 0.5 armor ratio). Any hit in the
// back, slash or stab, is an instant kill. Reach is measured to the body's
// surface: slash 80 units (2 m), stab 64 (1.6 m), against CS's 48 and 32,
// and a miss within the cone (35 / 30 degrees off the crosshair) still
// connects, since a stickman is thin and easy to whiff. Hitgroup multipliers
// apply like they do for bullets. Always carried, can't be bought or dropped.
W.knife = {
  name: 'Knife', slot: 'melee', category: 'Melee', price: 0,
  damage: 25, range: 80, bullet: null, penetration: 0, armorRatio: 2.0,
  cycle: 0.4, auto: true, clip: 0, reserve: 0, deploy: 0.5, speed: 250,
  accuracy: { type: 'none' }, kick: { punch: [0, 0] },
  melee: {
    backstabCos: 0.5,
    slash: { damage: 25, firstDamage: 30, range: 80, cone: 35, hitCycle: 0.4, missCycle: 0.35, altDelay: 0.5 },
    stab: { damage: 80, range: 64, cone: 30, hitCycle: 1.1, missCycle: 1.0 },
  },
};

// CS 1.6 HE grenade. Bought from the Equipment page, carried in its own slot
// (key 4), one at a time. Damage is 100 at the blast, falling off linearly
// to nothing at 700 units (17.5 m, 2x CS's 350 at Kenny's request); kevlar
// halves it like any chest hit. Thrown harder than CS too (1000 u/s max). It
// doesn't go through walls: you have to be in line of sight of the blast.
// The fuse is 2 s from the throw (CS's is 1.5 s), so it can land and roll
// before it goes off; Kenny found 1.5 s too quick.
W.hegrenade = {
  name: 'HE Grenade', slot: 'grenade', category: 'Grenades', price: 300,
  damage: 100, range: 0, bullet: null, penetration: 0, armorRatio: 1.0,
  cycle: 0.5, auto: false, clip: 1, reserve: 0, deploy: 0.6, speed: 250,
  accuracy: { type: 'none' }, kick: { punch: [0, 0] },
  grenade: { kind: 'he', radius: 394, fuse: 2, maxSpeed: 1000, throwMul: 8, lobMul: 0.5 },
};

// CS 1.6 smoke grenade ($300, carry one). Once it has stopped (and the
// 1.5 s fuse is up) it pours out a cloud that blocks sight, bots' too, for
// about 20 seconds. Bullets still go through it.
W.smokegrenade = {
  name: 'Smoke Grenade', slot: 'smoke', category: 'Grenades', price: 300,
  damage: 0, range: 0, bullet: null, penetration: 0, armorRatio: 1.0,
  cycle: 0.5, auto: false, clip: 1, reserve: 0, deploy: 0.6, speed: 250,
  accuracy: { type: 'none' }, kick: { punch: [0, 0] },
  grenade: { kind: 'smoke', radius: 180, duration: 20, maxSpeed: 1000, throwMul: 8, lobMul: 0.5 },
};

// The C4 bomb. Only the Red player carrying the bomb has it, in its own slot
// (key 5, like CS 1.6). You have to hold it to plant: hold
// E or fire inside a bomb site. Can't be bought; G drops it.
W.c4 = {
  name: 'C4', slot: 'c4', category: 'Bomb', price: 0, bomb: true,
  damage: 0, range: 0, bullet: null, penetration: 0, armorRatio: 1.0,
  cycle: 0.5, auto: false, clip: 0, reserve: 0, deploy: 0.6, speed: 250,
  accuracy: { type: 'none' }, kick: { punch: [0, 0] },
};

for (const [id, w] of Object.entries(W)) {
  w.id = id;
  w.runThreshold ??= 140;
  w.kickScale ??= 1;
}

export const WEAPONS = W;

// Every gun in the shop. The buy menu sorts each page by price.
// Team-only guns in team modes, like CS 1.6's T and CT shops. Free-for-all
// keeps everything open, and anyone can pick up a dropped gun.
export const TEAM_ONLY = {
  glock18: 'red', ak47: 'red', galil: 'red', g3sg1: 'red', sg552: 'red', mac10: 'red',
  usp: 'blue', m4a1: 'blue', famas: 'blue', aug: 'blue', tmp: 'blue', sg550: 'blue', fiveseven: 'blue',
};

// Whether a player on `team` may buy `id`; team is null outside team modes.
export function teamCanBuy(id, team) {
  return !team || !TEAM_ONLY[id] || TEAM_ONLY[id] === team;
}

// Free for all weapon filter (menu dropdown): which guns the match allows.
// Buying, pickups, bots and spawn loadouts all follow it; the knife and armor
// are always allowed. Outside 'all', everyone spawns with the class's starter
// (free), and Grenades only hands out a fresh HE after every throw.
export const WEAPON_FILTERS = {
  all: { label: 'All', cats: null },
  pistol: { label: 'Pistol only', cats: ['Pistols'], start: 'usp' },
  shotgun: { label: 'Shotgun only', cats: ['Shotguns'], start: 'shotgun' },
  smg: { label: 'SMGs only', cats: ['SMGs'], start: 'mp5' },
  rifle: { label: 'Rifle only', cats: ['Rifles'], start: 'galil' },
  sniper: { label: 'Snipers only', cats: ['Snipers'], start: 'scout' },
  grenade: { label: 'Grenades only', cats: ['Grenades'], start: 'hegrenade' },
};

export function cleanWeaponFilter(f) {
  return Object.hasOwn(WEAPON_FILTERS, f) ? f : 'all';
}

// Whether `filter` allows weapon (or gear) `id`.
export function filterAllows(filter, id) {
  const cats = WEAPON_FILTERS[filter]?.cats;
  const def = W[id];
  if (!cats || !def || def.melee || def.bomb) return true;
  return cats.includes(def.category);
}

export const SHOP_ORDER = [
  'glock18', 'usp', 'p228', 'deagle', 'fiveseven', 'elites',
  'shotgun', 'autoshotgun',
  'tmp', 'uzi', 'mac10', 'mp5', 'ump45', 'p90',
  'galil', 'famas', 'ak47', 'scout', 'm4a1', 'sg552', 'aug', 'sg550', 'awp', 'g3sg1',
  'm249', 'minigun',
];

// Grenade slots. Key 4 cycles through the ones you carry (HE, smoke).
export const NADE_SLOTS = ['grenade', 'smoke'];

// Ammo packs per bullet type, CS 1.6 prices: [rounds per pack, price].
export const AMMO = {
  '9mm': [30, 20], '45acp': [12, 25], '50ae': [7, 40], '357sig': [13, 50], '57mm': [50, 50],
  '556': [30, 60], '762': [30, 80], '338': [10, 125], buckshot: [8, 65],
};

export const GEAR = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  kevlarHelmet: { name: 'Kevlar + Helmet', price: 1000 },
  defuser: { name: 'Defuse Kit', price: 200 },
};

// The buy menu's Equipment page, in CS 1.6 order (armor, grenades, kit).
export const EQUIPMENT = ['kevlar', 'kevlarHelmet', 'hegrenade', 'smokegrenade', 'defuser'];

// Rough 0..1 ratings for the shop's stat bars.
export function weaponRatings(w) {
  const dmg = w.pellets ? w.damage * w.pellets : w.damage;
  return {
    damage: Math.min(1, dmg / 180),
    fireRate: Math.min(1, 0.066 / w.cycle),
    accuracy: w.pellets ? 0.15 : w.accuracy.type === 'sniper' || w.accuracy.type === 'autosniper' ? 1 : Math.max(0.1, 1 - (w.spread?.stand?.[1] ?? 0.05) * 6 - (w.kick.stand?.[0] ?? 0.4) * 0.3),
    range: w.pellets ? 0.15 : Math.pow(w.rangeMod, 6),
    mobility: (w.speed - 180) / 70,
  };
}

// What a carried or dropped gun is worth to a bot deciding whether to swap:
// its price, or nothing once it's out of ammo.
export function weaponValue(w) {
  const d = w && W[w.id];
  if (!d || d.melee || d.grenade || d.bomb) return 0;
  return w.clip + w.reserve > 0 ? d.price : 0;
}
