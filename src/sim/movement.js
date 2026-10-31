// Player movement modelled on the GoldSrc/CS 1.6 pmove code: ground friction,
// ground/air acceleration (air strafing works), jumping, ducking and stepping.
import {
  GRAVITY, JUMP_SPEED, ACCELERATE, AIR_ACCELERATE, AIR_WISH_CAP, FRICTION, STOP_SPEED,
  DUCK_SPEED_MUL, WALK_SPEED_MUL, STEP_HEIGHT, PLAYER_RADIUS, STAND_HEIGHT, DUCK_HEIGHT,
  DUCK_TIME, LAND_SPEED_MUL, JUMP_STAMINA_TIME, BHOP_MAX_SPEED_MUL,
} from './constants.js';

export function forwardVec(yaw) {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}
export function rightVec(yaw) {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}

// Full 3D aim direction from yaw/pitch (radians). Pitch > 0 looks up.
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function hullHeight(p) {
  return p.ducked ? DUCK_HEIGHT : STAND_HEIGHT;
}

function hullOverlaps(world, x, y, z, h) {
  const r = PLAYER_RADIUS;
  return world.overlaps(x - r, y, z - r, x + r, y + h, z + r);
}

// Move along one axis and push out of anything we hit.
function moveAxis(world, p, axis, delta, h, scratch) {
  if (delta === 0) return false;
  const pos = p.pos;
  pos[axis] += delta;
  const r = PLAYER_RADIUS;
  const hits = world.overlapping(pos[0] - r, pos[1], pos[2] - r, pos[0] + r, pos[1] + h, pos[2] + r, scratch);
  if (hits.length === 0) return false;
  for (const b of hits) {
    if (axis === 1) {
      if (delta > 0) pos[1] = Math.min(pos[1], b.min[1] - h);
      else pos[1] = Math.max(pos[1], b.max[1]);
    } else {
      if (delta > 0) pos[axis] = Math.min(pos[axis], b.min[axis] - r);
      else pos[axis] = Math.max(pos[axis], b.max[axis] + r);
    }
  }
  return true;
}

const scratch = [];

function slideMove(world, p, dx, dy, dz) {
  const h = hullHeight(p);
  const hitY = moveAxis(world, p, 1, dy, h, scratch);
  const hitX = moveAxis(world, p, 0, dx, h, scratch);
  const hitZ = moveAxis(world, p, 2, dz, h, scratch);
  return { hitX, hitY, hitZ };
}

function accelerate(vel, wishdir, wishspeed, accel, dt, capSpeed = wishspeed) {
  const current = vel[0] * wishdir[0] + vel[2] * wishdir[2];
  const addspeed = Math.min(wishspeed, capSpeed) - current;
  if (addspeed <= 0) return;
  let accelspeed = accel * dt * wishspeed;
  if (accelspeed > addspeed) accelspeed = addspeed;
  vel[0] += accelspeed * wishdir[0];
  vel[2] += accelspeed * wishdir[2];
}

function friction(vel, dt) {
  const speed = Math.hypot(vel[0], vel[2]);
  if (speed < 0.001) { vel[0] = 0; vel[2] = 0; return; }
  const control = speed < STOP_SPEED ? STOP_SPEED : speed;
  const drop = control * FRICTION * dt;
  const newspeed = Math.max(0, speed - drop) / speed;
  vel[0] *= newspeed;
  vel[2] *= newspeed;
}

// Like CS's PM_PreventMegaBunnyJumping, hopping can't take you past
// BHOP_MAX_SPEED_MUL x your weapon's run speed. CS 1.6 knocks you down hard
// when you pass it; we just hold you at the cap, which feels smoother.
function capBhopSpeed(vel, maxSpeed) {
  const cap = maxSpeed * BHOP_MAX_SPEED_MUL;
  const spd = Math.hypot(vel[0], vel[2]);
  if (spd > cap) { vel[0] *= cap / spd; vel[2] *= cap / spd; }
}

// cmd: { fwd, side, jump, duck, walk, yaw, pitch }
// maxSpeed: meters/second, from the held weapon.
export function movePlayer(world, p, cmd, dt, maxSpeed) {
  const vel = p.vel;

  // --- Duck ---
  const wantDuck = !!cmd.duck;
  if (wantDuck) {
    if (!p.onGround) {
      // Duck-jump: tuck legs instantly in the air.
      if (!p.ducked) { p.ducked = true; p.pos[1] += STAND_HEIGHT - DUCK_HEIGHT; p.duckAmount = 1;
        if (hullOverlaps(world, p.pos[0], p.pos[1], p.pos[2], DUCK_HEIGHT)) { p.pos[1] -= STAND_HEIGHT - DUCK_HEIGHT; }
      }
    } else {
      p.duckAmount = Math.min(1, p.duckAmount + dt / DUCK_TIME);
      if (p.duckAmount >= 1) p.ducked = true;
    }
  } else if (p.ducked || p.duckAmount > 0) {
    if (p.ducked) {
      // Stand up only if there is room.
      if (p.onGround) {
        if (!hullOverlaps(world, p.pos[0], p.pos[1], p.pos[2], STAND_HEIGHT)) { p.ducked = false; }
      } else {
        const drop = STAND_HEIGHT - DUCK_HEIGHT;
        if (!hullOverlaps(world, p.pos[0], p.pos[1] - drop, p.pos[2], STAND_HEIGHT)) {
          p.ducked = false; p.pos[1] -= drop; p.duckAmount = 0;
        } else if (!hullOverlaps(world, p.pos[0], p.pos[1], p.pos[2], STAND_HEIGHT)) {
          p.ducked = false;
        }
      }
    }
    if (!p.ducked) p.duckAmount = Math.max(0, p.duckAmount - dt / DUCK_TIME);
  }

  // --- Wish direction ---
  const f = forwardVec(cmd.yaw), r = rightVec(cmd.yaw);
  let wx = f[0] * cmd.fwd + r[0] * cmd.side;
  let wz = f[2] * cmd.fwd + r[2] * cmd.side;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) { wx /= wl; wz /= wl; }
  const wishdir = [wx, 0, wz];

  let speedMul = 1;
  if (p.ducked || p.duckAmount > 0.5) speedMul *= DUCK_SPEED_MUL;
  else if (cmd.walk) speedMul *= WALK_SPEED_MUL;
  speedMul *= p.tagMul ?? 1;
  const wishspeed = wl > 1e-6 ? maxSpeed * speedMul : 0;

  p.stamina = Math.max(0, (p.stamina ?? 0) - dt);

  // --- Jump ---
  // Holding jump hops again the moment you land (auto bunny hop), so a fresh
  // press isn't needed. Jumping on the landing tick skips ground friction,
  // which is what lets air strafing build speed.
  const jumpPressed = !!cmd.jump;
  p.jumpHeld = !!cmd.jump;
  if (p.onGround && jumpPressed) capBhopSpeed(vel, maxSpeed);
  if (p.onGround && jumpPressed && !p.ducked) {
    // Jumping again right after landing gives a lower jump.
    const mul = p.stamina > 0 ? 0.8 : 1;
    vel[1] = JUMP_SPEED * mul;
    p.onGround = false;
    p.stamina = JUMP_STAMINA_TIME;
    p.justJumped = true;
  } else if (p.onGround && jumpPressed && p.ducked) {
    vel[1] = JUMP_SPEED * 0.9;
    p.onGround = false;
    p.justJumped = true;
  }

  if (p.onGround) {
    friction(vel, dt);
    accelerate(vel, wishdir, wishspeed, ACCELERATE, dt);
  } else {
    accelerate(vel, wishdir, wishspeed, AIR_ACCELERATE, dt, AIR_WISH_CAP);
  }

  // Gravity (half before, half after, like pmove).
  vel[1] -= GRAVITY * dt * 0.5;

  const wasOnGround = p.onGround;
  const x0 = p.pos[0], y0 = p.pos[1], z0 = p.pos[2];
  const dx = vel[0] * dt, dy = vel[1] * dt, dz = vel[2] * dt;
  const hit = slideMove(world, p, dx, dy, dz);

  // Step up stairs / small ledges when walking into them.
  if (wasOnGround && (hit.hitX || hit.hitZ)) {
    const flatDist = Math.hypot(p.pos[0] - x0, p.pos[2] - z0);
    const save = [p.pos[0], p.pos[1], p.pos[2]];
    const h = hullHeight(p);
    if (!hullOverlaps(world, x0, y0 + STEP_HEIGHT, z0, h)) {
      p.pos[0] = x0; p.pos[1] = y0 + STEP_HEIGHT; p.pos[2] = z0;
      moveAxis(world, p, 0, dx, h, scratch);
      moveAxis(world, p, 2, dz, h, scratch);
      moveAxis(world, p, 1, -STEP_HEIGHT - 0.01, h, scratch);
      const stepDist = Math.hypot(p.pos[0] - x0, p.pos[2] - z0);
      if (stepDist > flatDist + 1e-4 && p.pos[1] >= y0 - 1e-4) {
        p.stepOffset = (p.stepOffset ?? 0) + (p.pos[1] - y0);
        hit.hitX = false; hit.hitZ = false;
      } else {
        p.pos[0] = save[0]; p.pos[1] = save[1]; p.pos[2] = save[2];
      }
    }
  }
  if (hit.hitX) vel[0] = 0;
  if (hit.hitZ) vel[2] = 0;

  vel[1] -= GRAVITY * dt * 0.5;

  // --- Ground check ---
  if (vel[1] <= 0.001) {
    const r = PLAYER_RADIUS;
    let ground = null;
    for (const b of world.overlapping(p.pos[0] - r, p.pos[1] - 0.03, p.pos[2] - r, p.pos[0] + r, p.pos[1] + 0.01, p.pos[2] + r, scratch)) {
      if (!ground || b.max[1] > ground.max[1]) ground = b;
    }
    if (ground) {
      if (!wasOnGround) {
        p.landSpeed = -vel[1];
        // Landing slowdown, unless jump is held: then we hop straight away.
        if (!cmd.jump) { vel[0] *= LAND_SPEED_MUL; vel[2] *= LAND_SPEED_MUL; }
      }
      // Snap down onto the ground (also walks down stairs smoothly).
      if (wasOnGround && ground.max[1] < p.pos[1] && p.pos[1] - ground.max[1] < STEP_HEIGHT + 0.01) {
        p.stepOffset = (p.stepOffset ?? 0) - (p.pos[1] - ground.max[1]);
        p.pos[1] = ground.max[1];
      }
      p.onGround = true;
      vel[1] = 0;
    } else if (wasOnGround && !p.justJumped) {
      // Walking off a stair edge: stick to the ground if it is just below.
      let top = -Infinity;
      for (const b of world.overlapping(p.pos[0] - r, p.pos[1] - STEP_HEIGHT - 0.01, p.pos[2] - r, p.pos[0] + r, p.pos[1], p.pos[2] + r, scratch)) {
        if (b.max[1] <= p.pos[1] + 1e-4) top = Math.max(top, b.max[1]);
      }
      if (top > -Infinity) {
        p.stepOffset = (p.stepOffset ?? 0) - (p.pos[1] - top);
        p.pos[1] = top;
        p.onGround = true;
        vel[1] = 0;
      } else {
        p.onGround = false;
      }
    } else {
      p.onGround = false;
    }
  } else {
    p.onGround = false;
    if (hit.hitY) vel[1] = 0; // bonked head
  }
  if (hit.hitY && vel[1] > 0) vel[1] = 0;
  p.justJumped = false;
}
