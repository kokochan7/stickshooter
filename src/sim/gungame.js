// Gun Game, like the classic CS 1.6 GunGame mod: everyone fights everyone,
// nobody buys, and each kill swaps your gun for the next one on the ladder.
// Pistols first, then shotguns, SMGs, rifles, the machine gun, an HE grenade
// and finally the knife. The first knife kill on the last level wins.
//   - A knife kill (on any level) moves you up and the victim down one.
//   - You spawn with the gun for your level, the knife, and kevlar + helmet.
//   - The gun's reserve never runs out, and on the HE level a new grenade
//     comes once the last one has gone off.
//   - Nothing drops on death.

export const GG_LADDER = [
  'glock18', 'usp', 'p228', 'deagle', 'fiveseven', 'elites',
  'shotgun', 'autoshotgun',
  'tmp', 'mac10', 'mp5', 'ump45', 'p90',
  'galil', 'famas', 'ak47', 'scout', 'm4a1', 'sg552', 'aug',
  'm249', 'hegrenade', 'knife',
];

export const GG_LAST = GG_LADDER.length - 1;

// The weapon id for a level (clamped to the ladder).
export function ggWeapon(level) {
  return GG_LADDER[Math.max(0, Math.min(GG_LAST, level | 0))];
}

// Sort order for Gun Game standings: highest level first, then most kills,
// then fewest deaths.
export function ggRank(a, b) {
  return (b.ggLevel ?? 0) - (a.ggLevel ?? 0) || b.kills - a.kills || a.deaths - b.deaths;
}
