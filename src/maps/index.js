// Every map, in the order the menu lists them.
//   type 'dm'      - deathmatch only (Free for all, Teams to a kill limit)
//   type 'bomb'    - Teams plays bomb defusal rounds: Red plants at A or B
//   type 'hostage' - Teams plays hostage rescue rounds: Blue rescues
// Free for all is plain deathmatch on every map.
import { YARD } from './yard.js';
import { CANAL } from './canal.js';
import { DUNES } from './dunes.js';
import { HARBOR } from './harbor.js';
import { FROST } from './frost.js';

export const MAP_LIST = [YARD, CANAL, DUNES, HARBOR, FROST];
export const MAPS = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));
export const DEFAULT_MAP = 'yard';

export function getMap(id) {
  return MAPS[id] ?? MAPS[DEFAULT_MAP];
}

export const MAP_TYPE_LABEL = { dm: 'Deathmatch', bomb: 'Bomb defusal', hostage: 'Hostage rescue' };
