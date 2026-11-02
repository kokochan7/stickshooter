// Team strategies for bots. Each side's bots share one plan, picked at random
// at the start of every round (or every 30-60 s when there are no rounds),
// never the same one twice in a row, with its own random timings. The plan
// tells each bot where to go and how hard to push; bot.js carries it out.
//
// Everything is worked out from map.sites, map.teamSpawns and the nav grid,
// so any map gets the same strategies.

// name -> weight. aggr: 0 plays slow from cover, 1 pushes into the open.
export const PLANS = {
  bomb: {
    red: { execute: 3, rush: 2, split: 2, fake: 2, slow: 2, spread: 2 },
    blue: { even: 3, stack: 2, push: 2, retake: 1 },
  },
  hostage: {
    red: { guard: 3, forward: 2, ambush: 2 },
    blue: { rush: 2, split: 3, slow: 2 },
  },
  teams: { hunt: 3, group: 2, hold: 2, push: 2 },
  ffa: { hunt: 3, hold: 2, push: 2 },
};

const AGGR = {
  execute: 0.55, rush: 0.9, split: 0.55, fake: 0.5, slow: 0.25, spread: 0.45,
  even: 0.4, stack: 0.4, push: 0.75, retake: 0.3,
  guard: 0.3, forward: 0.6, ambush: 0.2, split2: 0.55, hunt: 0.5, group: 0.55, hold: 0.2,
};

const plans = new WeakMap(); // game -> { [side]: plan }

function pick(weights, last, rand) {
  const names = Object.keys(weights).filter((n) => n !== last || Object.keys(weights).length === 1);
  let sum = 0;
  for (const n of names) sum += weights[n];
  let r = rand() * sum;
  for (const n of names) if ((r -= weights[n]) < 0) return n;
  return names[names.length - 1];
}

function centroid(pts) {
  let x = 0, z = 0;
  for (const s of pts) { x += s[0]; z += s[2] ?? s[1]; }
  return [x / pts.length, z / pts.length];
}

// Middle of the map between the two bases (or the map's middle).
export function mapMiddle(map) {
  const ts = map.teamSpawns;
  const pos = (s) => s.pos ?? s;
  if (ts?.red?.length && ts?.blue?.length) {
    const a = centroid(ts.red.map(pos)), b = centroid(ts.blue.map(pos));
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  const { min, max } = map.bounds;
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
}

// The plan for `side` ('red', 'blue', or a player id in FFA) right now.
export function teamPlan(g, side, rand = Math.random) {
  let all = plans.get(g);
  if (!all) plans.set(g, (all = {}));
  const cur = all[side];
  const rounds = !!g.objective && g.round.state !== 'none';
  const key = rounds ? 'r' + g.round.n : 'p';
  if (cur && cur.key === key && (rounds || g.time < cur.until) && g.time >= cur.born - 1e-6) return cur;
  const table = rounds ? PLANS[g.objective]?.[side] : PLANS[g.mode === 'teams' ? 'teams' : 'ffa'];
  const name = pick(table ?? PLANS.ffa, cur?.name, rand);
  const start = rounds ? g.round.freezeEnd : g.time;
  const sites = g.map.sites ? Object.keys(g.map.sites) : [];
  const plan = {
    key, name, side, born: g.time,
    until: rounds ? Infinity : g.time + 30 + rand() * 30,
    aggr: AGGR[name] ?? 0.5,
    // Red's target site (bomb), Blue's guess at it (stack), or none.
    site: sites.length ? (side === 'red' && g.plan ? g.plan : sites[Math.floor(rand() * sites.length)]) : null,
    // When the slow / fake plans commit, and how long the pushers stay out.
    goAt: start + (name === 'slow' ? 22 + rand() * 25 : name === 'fake' ? 10 + rand() * 10 : 0),
    pushFor: start + 12 + rand() * 14,
    // A rally point for teams plans, picked by the first bot that asks.
    rally: null,
    // Which side of the map split / flank groups go round: +1 or -1.
    flip: rand() < 0.5 ? 1 : -1,
    called: null, // a site Blue saw Red at
    calledAt: -100,
  };
  all[side] = plan;
  return plan;
}

// For tests and the admin console.
export function clearPlans(g) { plans.delete(g); }
