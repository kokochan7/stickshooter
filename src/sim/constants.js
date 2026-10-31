// Shared simulation constants.
// The sim works in meters. Counter-Strike 1.6 values are written in CS "units"
// and converted with U so they can be compared with the original numbers.
// A CS player is 72 units tall; our stickman is 1.8 m, so 1 unit = 2.5 cm.

export const U = 0.025;

// Fixed simulation rate. Rendering runs at the display rate (60/120/144 Hz)
// and interpolates between ticks, so the sim stays deterministic and easy to
// run on a server later.
export const TICK_RATE = 128;
export const TICK_DT = 1 / TICK_RATE;

// Movement (CS 1.6 defaults: sv_gravity 800, sv_accelerate 5, sv_airaccelerate 10,
// sv_friction 4, sv_stopspeed 75..100, jump height 45 units).
export const GRAVITY = 800 * U;
export const JUMP_SPEED = Math.sqrt(2 * 800 * 45) * U;
export const ACCELERATE = 5;
export const AIR_ACCELERATE = 10;
export const AIR_WISH_CAP = 30 * U;
export const FRICTION = 4;
export const STOP_SPEED = 100 * U;
export const DUCK_SPEED_MUL = 0.333;
export const WALK_SPEED_MUL = 0.52;
export const STEP_HEIGHT = 18 * U;
export const DUCK_TIME = 0.2;
// After landing a jump CS slows you down for a moment, which stops bunny hopping
// from being faster than running.
export const LAND_SPEED_MUL = 0.8;
// Footstep cadence at full running speed (seconds per step). CS 1.6 plays a
// step every 300 ms when running and 400 ms when slower; we sit in between,
// which reads closer to how CS sounds in game. The walk cycle and the gun bob
// use the same cadence so legs, camera and sound stay in sync.
export const FOOTSTEP_TIME = 0.38;
// Below this speed (CS units/s) steps are silent, which is why shift-walking
// (250 * 0.52 = 130) and crouching make no noise.
export const FOOTSTEP_MIN_SPEED = 150;
export const JUMP_STAMINA_TIME = 0.5;

// Hull
export const PLAYER_RADIUS = 16 * U;
export const STAND_HEIGHT = 72 * U;
export const DUCK_HEIGHT = 46 * U;
export const STAND_EYE = 1.6;
export const DUCK_EYE = 1.0;

// Combat
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const RESPAWN_TIME = 3;
export const START_MONEY = 16000; // practice mode: everything is affordable
export const MAX_MONEY = 16000;
export const KILL_REWARD = 300;

// Hit group damage multipliers from CS 1.6.
export const HITGROUP_MUL = {
  head: 4,
  chest: 1,
  stomach: 1.25,
  arm: 1,
  leg: 0.75,
};

// Armor: CS 1.6 CBasePlayer::TakeDamage. The weapon's armorRatio scales how
// much damage gets through kevlar.
export const ARMOR_RATIO = 0.5;
export const ARMOR_BONUS = 0.5;

// Being shot slows you down briefly ("tagging").
export const TAG_SPEED_MUL = 0.55;
export const TAG_RECOVER_TIME = 0.6;
