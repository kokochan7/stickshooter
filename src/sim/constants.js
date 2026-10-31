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
// Landing slows you down, unless you're holding jump to bunny hop.
export const LAND_SPEED_MUL = 0.8;
// Bunny hopping tops out at this multiple of the weapon's run speed (CS 1.6's
// BUNNYJUMP_MAX_SPEED_FACTOR).
export const BHOP_MAX_SPEED_MUL = 1.7;
// Recoil is CS 1.6's KickBack, scaled down so sprays are easier to hold.
export const RECOIL_SCALE = 0.75;
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
// Kill money. Free for all pays the same for every kill. Teams pays more for
// each kill you get in the same round (in team deathmatch a "round" is one
// life): KILL_REWARD, then + KILL_STREAK_STEP per kill, up to KILL_REWARD_MAX.
export const KILL_REWARD = 500;
export const KILL_STREAK_STEP = 250;
export const KILL_REWARD_MAX = 2500;
export const FFA_KILL_REWARD = 800;
// Kills this close together (seconds) chain into a double kill, triple
// kill and so on, announced by voice.
export const MULTI_KILL_WINDOW = 4;

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

// Match rules. Free for all: first player to FFA_KILL_LIMIT kills wins.
// Teams: first team to TEAM_KILL_LIMIT kills wins. After a win the scoreboard
// stays up for MATCH_OVER_TIME, then a new match starts. Every match start, and
// every join, freezes you for START_DELAY (you can look around and buy, but
// not move, shoot or be hurt) so the game doesn't begin the instant you click.
export const FFA_KILL_LIMIT = 25;
export const TEAM_KILL_LIMIT = 50;
export const MATCH_OVER_TIME = 8;
export const START_DELAY = 3;

// Dropped guns lie on the ground this long before they disappear.
export const DROP_LIFETIME = 10;
// How close you have to be to pick a gun up (meters, from your feet).
export const PICKUP_RANGE = 1.6;
// Walking over a gun picks it up when that slot is empty, like CS.
export const TOUCH_RANGE = 0.8;

// Objective rounds (Teams on a bomb or hostage map), CS 1.6 style: one life
// per round, a short freeze to buy at the start, first team to
// ROUND_WIN_LIMIT rounds wins the match. Red attacks (plants the bomb, guards
// the hostages), Blue defends (defuses, rescues).
export const ROUND_WIN_LIMIT = 8;
export const ROUND_FREEZE = 4;
export const ROUND_END_TIME = 5;
export const ROUND_TIME = { bomb: 115, hostage: 150 };
// Joining this long into a live round still spawns you; later you wait.
export const LATE_JOIN = 20;
// Respawn time used for "not until the next round" (JSON can't carry Infinity).
export const NEVER = 1e9;
// The bomb (CS 1.6: mp_c4timer 35, 3 s to plant, 10 s to defuse, 5 with a kit).
export const BOMB_TIMER = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 10;
export const DEFUSE_KIT_TIME = 5;
export const DEFUSE_RANGE = 1.5; // meters from the bomb
export const BOMB_RADIUS = 20; // meters; damage falls off to 0 here
export const BOMB_DAMAGE = 500;
export const BOMB_PLANT_REWARD = 800;
// Hostages.
export const HOSTAGE_USE_RANGE = 1.9;
export const HOSTAGE_FOLLOW_DIST = 1.7;
export const HOSTAGE_SPEED = 230; // CS units/s
export const HOSTAGE_RESCUE_REWARD = 1000;
// Wading through water slows you down.
export const WATER_SPEED_MUL = 0.78;
// Other players' footsteps fade out completely at this distance (meters).
export const FOOTSTEP_RANGE = 32;
