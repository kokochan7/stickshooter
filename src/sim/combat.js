// Hitboxes, bullet tracing with wall penetration, and damage with armor.
// Follows CS 1.6's FireBullets3 / TraceAttack / TakeDamage closely.
import { U, HITGROUP_MUL, ARMOR_RATIO, ARMOR_BONUS, STAND_HEIGHT, PLAYER_RADIUS } from './constants.js';
import { BULLETS } from './weapons.js';
import { MATERIALS, rayBox } from './world.js';

// Hitboxes in the player's local frame (feet at origin, facing -Z, +X right).
// Slightly fatter than the thin stick limbs so hits feel fair, like CS's boxes.
const STAND_HITBOXES = [
  { group: 'head', sphere: [0, 1.6, -0.01, 0.175] },
  { group: 'chest', min: [-0.2, 1.16, -0.13], max: [0.2, 1.45, 0.13] },
  { group: 'stomach', min: [-0.18, 0.88, -0.12], max: [0.18, 1.16, 0.12] },
  { group: 'arm', min: [-0.27, 1.12, -0.6], max: [0.27, 1.42, -0.13] },
  { group: 'leg', min: [-0.2, 0, -0.14], max: [0.2, 0.88, 0.14] },
];
const DUCK_HITBOXES = [
  { group: 'head', sphere: [0, 1.08, -0.25, 0.175] },
  { group: 'chest', min: [-0.2, 0.68, -0.36], max: [0.2, 0.95, -0.06] },
  { group: 'stomach', min: [-0.18, 0.45, -0.2], max: [0.18, 0.68, 0.08] },
  { group: 'arm', min: [-0.27, 0.7, -0.85], max: [0.27, 0.98, -0.3] },
  { group: 'leg', min: [-0.22, 0, -0.45], max: [0.22, 0.45, 0.2] },
];

export function hitboxesFor(p) {
  return p.ducked || p.duckAmount > 0.5 ? DUCK_HITBOXES : STAND_HITBOXES;
}

// Ray vs one player's hitboxes. Returns { t, group } or null.
export function rayPlayer(p, o, d, maxDist) {
  // Broad phase: the player's bounding box.
  const r = PLAYER_RADIUS + 0.4;
  const bb = rayBox(o[0], o[1], o[2], d[0], d[1], d[2],
    [p.pos[0] - r, p.pos[1] - 0.05, p.pos[2] - r], [p.pos[0] + r, p.pos[1] + STAND_HEIGHT + 0.1, p.pos[2] + r]);
  if (!bb || bb.tEnter > maxDist) return null;

  // Into local space (rotate by -yaw around Y).
  const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
  const rx = o[0] - p.pos[0], ry = o[1] - p.pos[1], rz = o[2] - p.pos[2];
  const lo = [rx * c + rz * s, ry, -rx * s + rz * c];
  const ld = [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];

  let best = null;
  for (const hb of hitboxesFor(p)) {
    let t = null;
    if (hb.sphere) {
      t = raySphere(lo, ld, hb.sphere);
    } else {
      const h = rayBox(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], hb.min, hb.max);
      if (h) t = Math.max(0, h.tEnter);
    }
    if (t !== null && t <= maxDist && (!best || t < best.t)) best = { t, group: hb.group };
  }
  return best;
}

function raySphere(o, d, s) {
  const ox = o[0] - s[0], oy = o[1] - s[1], oz = o[2] - s[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - s[3] * s[3];
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c < 0 ? 0 : null;
  return t;
}

// CS 1.6 armor + hitgroup damage. Mutates the victim, returns damage dealt.
export function computeDamage(victim, rawDamage, group, weapon) {
  let dmg = rawDamage * (HITGROUP_MUL[group] ?? 1);
  let armorHit = false;
  const armorCovers = group !== 'leg' && (group !== 'head' || victim.helmet);
  if (victim.armor > 0 && armorCovers) {
    armorHit = true;
    const ratio = ARMOR_RATIO * weapon.armorRatio;
    let newDmg = dmg * ratio;
    let armorDmg = (dmg - newDmg) * ARMOR_BONUS;
    if (armorDmg > victim.armor) {
      armorDmg = victim.armor * (1 / ARMOR_BONUS);
      newDmg = dmg - armorDmg;
      victim.armor = 0;
    } else {
      victim.armor = Math.max(0, victim.armor - armorDmg);
    }
    dmg = newDmg;
  }
  if (victim.armor <= 0) victim.helmet = false;
  return { damage: Math.max(1, Math.floor(dmg)), armorHit };
}

// Trace one bullet. Calls onHit(victim, damage, group, point, wallbang) for each
// player hit. Returns { end, impacts } for effects. CS units are converted with U.
export function traceBullet(world, players, shooter, origin, dir, weapon, onHit) {
  const bullet = BULLETS[weapon.bullet];
  const maxRange = weapon.range * U;
  const isBuckshot = weapon.bullet === 'buckshot';

  let power = bullet.power;
  let penLeft = weapon.penetration;
  let damage = weapon.damage;
  let travelled = 0;
  let src = [origin[0], origin[1], origin[2]];
  let wallsPassed = 0;
  const impacts = [];
  const alreadyHit = new Set();
  let end = null;

  for (let seg = 0; seg < 8; seg++) {
    const remaining = maxRange - travelled;
    if (remaining <= 0) break;

    // Nearest world hit.
    const wh = world.raycast(src[0], src[1], src[2], dir[0], dir[1], dir[2], remaining);
    const wallT = wh ? wh.t : remaining;

    // Nearest player hit before the wall.
    let ph = null, victim = null;
    for (const p of players) {
      if (p === shooter || !p.alive || alreadyHit.has(p)) continue;
      if (shooter && p.team === shooter.team && p.team !== 'ffa') continue;
      const h = rayPlayer(p, src, dir, wallT);
      if (h && (!ph || h.t < ph.t)) { ph = h; victim = p; }
    }

    if (ph) {
      const dist = travelled + ph.t;
      const point = [src[0] + dir[0] * ph.t, src[1] + dir[1] * ph.t, src[2] + dir[2] * ph.t];
      let dmg;
      if (isBuckshot) {
        // CS 1.6 buckshot: damage falls off linearly with distance.
        dmg = damage * Math.max(0, 1 - dist / maxRange);
      } else {
        dmg = damage * Math.pow(weapon.rangeMod, dist / (500 * U));
      }
      if (dmg > 0) onHit(victim, dmg, ph.group, point, wallsPassed > 0);
      alreadyHit.add(victim);
      if (isBuckshot || penLeft <= 0) { end = point; break; }
      // Bullets keep going through bodies with reduced damage.
      penLeft--;
      damage *= 0.75;
      travelled += ph.t;
      src = point;
      continue;
    }

    if (!wh) { end = [src[0] + dir[0] * remaining, src[1] + dir[1] * remaining, src[2] + dir[2] * remaining]; break; }

    const hitPoint = [src[0] + dir[0] * wh.t, src[1] + dir[1] * wh.t, src[2] + dir[2] * wh.t];
    impacts.push({ pos: hitPoint, normal: wh.normal, material: wh.box.material, exit: false });
    travelled += wh.t;

    const mat = MATERIALS[wh.box.material] ?? MATERIALS.concrete;
    if (penLeft <= 0 || travelled > bullet.penDist * U || power <= 0) { end = hitPoint; break; }
    const maxThickness = power * mat.powerMul * U;
    const thick = world.solidThickness(src[0], src[1], src[2], dir[0], dir[1], dir[2], wh.t, maxThickness);
    if (thick > maxThickness) { end = hitPoint; break; }

    // Punched through.
    penLeft--;
    wallsPassed++;
    damage *= mat.damageMul;
    const exitT = wh.t + thick + 0.002;
    src = [src[0] + dir[0] * exitT, src[1] + dir[1] * exitT, src[2] + dir[2] * exitT];
    travelled += thick;
    impacts.push({ pos: src, normal: dominantAxis(dir), material: wh.box.material, exit: true });
    if (damage < 1) { end = src; break; }
  }
  if (!end) end = src;
  return { end, impacts };
}

function dominantAxis(d) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  if (ax >= ay && ax >= az) return [Math.sign(d[0]), 0, 0];
  if (ay >= az) return [0, Math.sign(d[1]), 0];
  return [0, 0, Math.sign(d[2])];
}
