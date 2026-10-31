// Admin console commands (the ~ key). The same commands run in Practice,
// where they act on the local Game, and online, where the room (worker/room.js)
// runs them for the admin only.
//
// runAdmin(game, host, actor, line) -> { ok, lines: [string] }
//   actor: the player typing (or null)
//   host:  the things only the caller can do, because bots and maps are
//          managed outside the Game:
//            botCount() -> number
//            setBots(n) -> number actually running
//            setDifficulty('easy' | 'normal' | 'hard')
//            changeMap(id)
//            maps: { [id]: map }
import { WEAPONS } from './weapons.js';
import { MAX_MONEY, MAX_ARMOR, MAX_HEALTH } from './constants.js';

export const MAX_BOTS = 32;
const DIFFICULTIES = ['easy', 'normal', 'hard'];

export const ADMIN_HELP = [
  'money <amount> [player|all]   add money (default: you)',
  'addbot [n]                    add n bots (default 1)',
  'removebot [n|all]             remove n bots (default 1)',
  'bots <n>                      set the bot count (0-32)',
  'difficulty <easy|normal|hard> bot skill',
  'give <gun> [player]           e.g. give awp',
  'heal [player|all]             full health and armor',
  'god                           toggle taking no damage',
  'slay <player|bots|all>        kill someone',
  'map <id>                      change map and restart',
  'restart                       restart the match',
  'players                       list everyone',
  'clear                         clear the console',
];

// Players matching a target word: me, all, bots, humans, or a name (prefix ok).
function targets(game, actor, word) {
  const w = (word ?? 'me').toLowerCase();
  if (w === 'me') return actor ? [actor] : [];
  if (w === 'all') return [...game.players];
  if (w === 'bots') return game.players.filter((p) => p.isBot);
  if (w === 'humans') return game.players.filter((p) => !p.isBot);
  const exact = game.players.filter((p) => p.name.toLowerCase() === w);
  if (exact.length) return exact;
  return game.players.filter((p) => p.name.toLowerCase().startsWith(w));
}

function names(list) {
  return list.length > 3 ? `${list.length} players` : list.map((p) => p.name).join(', ');
}

function intArg(s, def) {
  if (s === undefined) return def;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

export function runAdmin(game, host, actor, line) {
  const parts = String(line ?? '').trim().split(/\s+/).filter(Boolean);
  const cmd = (parts.shift() ?? '').toLowerCase();
  const ok = (...lines) => ({ ok: true, lines });
  const fail = (...lines) => ({ ok: false, lines });
  const who = (word) => {
    const list = targets(game, actor, word);
    return list.length ? list : null;
  };

  switch (cmd) {
    case '':
      return ok();
    case 'help':
    case '?':
      return ok(...ADMIN_HELP);

    case 'money':
    case 'cash': {
      const amount = intArg(parts[0], MAX_MONEY);
      if (!Number.isFinite(amount)) return fail('Usage: money <amount> [player|all]');
      const list = who(parts[1]);
      if (!list) return fail(`No player "${parts[1] ?? 'me'}"`);
      for (const p of list) p.money = Math.max(0, Math.min(MAX_MONEY, p.money + amount));
      return ok(`${amount >= 0 ? '+' : ''}$${amount} to ${names(list)}`);
    }

    case 'addbot':
    case 'addbots': {
      const n = intArg(parts[0], 1);
      if (!(n > 0)) return fail('Usage: addbot [n]');
      const now = host.setBots(Math.min(MAX_BOTS, host.botCount() + n));
      return ok(`Bots: ${now}${host.botCount() >= MAX_BOTS ? ` (max ${MAX_BOTS})` : ''}`);
    }
    case 'removebot':
    case 'removebots':
    case 'kickbots': {
      const n = parts[0] === 'all' ? Infinity : intArg(parts[0], 1);
      if (!(n > 0)) return fail('Usage: removebot [n|all]');
      const now = host.setBots(Math.max(0, host.botCount() - n));
      return ok(`Bots: ${now}`);
    }
    case 'bots': {
      const n = intArg(parts[0], NaN);
      if (!Number.isFinite(n)) return ok(`Bots: ${host.botCount()}`);
      return ok(`Bots: ${host.setBots(Math.max(0, Math.min(MAX_BOTS, n)))}`);
    }
    case 'difficulty':
    case 'diff': {
      const d = (parts[0] ?? '').toLowerCase();
      if (!DIFFICULTIES.includes(d)) return fail('Usage: difficulty <easy|normal|hard>');
      host.setDifficulty(d);
      return ok(`Bot difficulty: ${d}`);
    }

    case 'give': {
      const id = (parts[0] ?? '').toLowerCase();
      const def = WEAPONS[id];
      if (!def) return fail(`Guns: ${Object.keys(WEAPONS).join(', ')}`);
      const list = who(parts[1]);
      if (!list) return fail(`No player "${parts[1] ?? 'me'}"`);
      for (const p of list) {
        if (!p.alive) continue;
        // Buy it with borrowed money so the usual rules (slot, switch) apply.
        const money = p.money;
        p.money = Infinity;
        if (!game.buy(p, id)) { const w = p.weapons[def.slot]; if (w) { w.clip = def.clip; w.reserve = def.reserve; } }
        p.money = money;
      }
      return ok(`Gave ${def.name} to ${names(list)}`);
    }
    case 'heal': {
      const list = who(parts[0]);
      if (!list) return fail(`No player "${parts[0] ?? 'me'}"`);
      for (const p of list) if (p.alive) { p.health = MAX_HEALTH; p.armor = MAX_ARMOR; p.helmet = true; }
      return ok(`Healed ${names(list)}`);
    }
    case 'god': {
      const list = who(parts[0]);
      if (!list) return fail(`No player "${parts[0] ?? 'me'}"`);
      const on = !list[0].god;
      for (const p of list) p.god = on;
      return ok(`God mode ${on ? 'ON' : 'OFF'} for ${names(list)}`);
    }
    case 'slay':
    case 'kill': {
      if (!parts[0]) return fail('Usage: slay <player|bots|all>');
      const list = who(parts[0]);
      if (!list) return fail(`No player "${parts[0]}"`);
      for (const p of list) if (p.alive) { p.health = 0; game.kill(p, null, null, false, false); }
      return ok(`Slayed ${names(list)}`);
    }

    case 'map': {
      const id = (parts[0] ?? '').toLowerCase();
      if (!host.maps[id]) return fail(`Maps: ${Object.keys(host.maps).join(', ')}`);
      host.changeMap(id);
      return ok(`Map: ${host.maps[id].name}`);
    }
    case 'restart':
      game.restartMatch();
      return ok('Match restarted');
    case 'players':
    case 'status':
      return ok(...game.players.map((p) => `#${p.id} ${p.name}${p.isBot ? ' (bot)' : ''} · ${p.team} · ${p.kills}/${p.deaths} · $${p.money}${p.god ? ' · god' : ''}`));
  }
  return fail(`Unknown command "${cmd}". Type help.`);
}
