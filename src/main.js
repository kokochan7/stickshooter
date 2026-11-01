// Entry point: wires the sim (src/sim) to rendering, audio, input and UI.
//
// Practice runs the Game locally with bots. Online, the Game is a mirror of a
// server room (src/net/online.js) and only our own movement is simulated here.
//
// Loop: the sim ticks at a fixed 128 Hz; rendering runs at the display rate
// (uncapped requestAnimationFrame, so 120/144 Hz screens get 120/144 FPS) and
// interpolates player positions between ticks. Mouse look is applied every
// frame for the lowest possible input latency.
import * as THREE from 'three';
import { Game, emptyCmd } from './sim/game.js';
import { BotBrain } from './sim/bot.js';
import { WEAPONS } from './sim/weapons.js';
import { runAdmin, MAX_BOTS } from './sim/admin.js';
import {
  TICK_DT, STAND_EYE, DUCK_EYE, U, FOOTSTEP_TIME, FOOTSTEP_MIN_SPEED, FFA_KILL_LIMIT, TEAM_KILL_LIMIT,
  FOOTSTEP_RANGE, ROUND_WIN_LIMIT,
} from './sim/constants.js';
import { canPlant, canDefuse, hostageInReach, siteAt } from './sim/objective.js';
import { MAP_LIST, MAP_TYPE_LABEL, MAPS, getMap } from './maps/index.js';
import { GameView } from './client/scene.js';
import { Audio, RELOAD_SOUNDS, SHELL_SOUNDS, RELOADED_SOUNDS, STEP_SOUNDS } from './client/audio.js';
import { Input, keyName } from './client/input.js';
import { MenuMusic } from './client/music.js';
import { TouchControls, isTouchDevice } from './client/touch.js';
import { Hud, BuyMenu, SettingsPanel, loadSettings, saveSettings, renderGunIcons } from './client/hud.js';
import { OnlineSession, roomUrl, fetchRoomCounts } from './net/online.js';
import { PUBLIC_ROOMS, pickRoom, roomMode } from './net/protocol.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const BOT_NAMES = ['Inkblot', 'Doodle', 'Scribble', 'Smudge', 'Sketch', 'Graphite', 'Charcoal', 'Pencil', 'Eraser', 'Crayon', 'Marker', 'Quill'];

const settings = loadSettings();
const canvas = $('game');
const game = new Game(getMap(settings.map), { mode: settings.mode });
const view = new GameView(canvas, game.map, game.world, settings);
const audio = new Audio();
audio.setVolume(settings.volume);
audio.setSfx(false); // main menu: music only, no background gunfire
const music = new MenuMusic(audio);
music.set({ level: settings.music, muted: settings.musicMuted });
const input = new Input(canvas, settings);
const hud = new Hud();
hud.chSettings = settings;
const { icons, glyphs } = renderGunIcons(view.renderer);
hud.glyphs = glyphs;
const buyMenu = new BuyMenu(icons, (item) => pendingActions.push({ type: 'buy', item }));
const settingsPanel = new SettingsPanel(settings, onSettingChange);
// The camera eases toward the view punch over SHAKE_EASE seconds instead of
// snapping to it, so each shot rolls the view rather than jolting it.
const SHAKE_EASE = 0.035;
let shakeP = 0, shakeY = 0;

// Phones and tablets: on-screen controls, no pointer lock.
const TOUCH = isTouchDevice();
document.body.classList.toggle('touch', TOUCH);
const touch = TOUCH ? new TouchControls(input, settings, {
  buy: () => setBuyMenu(!buyMenu.open),
  drop: () => dropOrPickup(),
  scores: (show) => { if (scoresForced === null) showScoreboard(show); },
  pause: () => pauseGame(),
  knife: () => { input.pending.slot = me?.active === 'melee' ? (me.weapons.primary ? 'primary' : 'secondary') : 'melee'; },
  cycle: () => {
    // primary -> pistol -> knife -> primary, skipping empty slots.
    const order = ['primary', 'secondary', 'melee'];
    const i = order.indexOf(me?.active);
    for (let k = 1; k <= 3; k++) {
      const next = order[(i + k) % 3];
      if (me?.weapons[next]) { input.pending.slot = next; break; }
    }
  },
}) : null;

let me = null;
let net = null; // OnlineSession while playing online
const brains = new Map();
let mode = 'menu'; // menu | playing | paused
let teamMsgUntil = 0; // "You joined ..." banner after switching team
let pendingActions = [];
let acc = 0;
let last = performance.now();
let killInfo = null;
let menuAngle = 0;
let lastCount = null; // countdown number last shown, for its beep
let goUntil = 0; // "GO!" stays up briefly after the countdown
let scoresForced = null; // scoreboard title while it's held open to show the winner
let alertMsg = null; // { html, until }: "BOMB PLANTED" and the like
let nextBeep = 0; // when the planted bomb beeps next (game time)
let spectating = null; // id of the teammate we watch while dead in a round
const timers = [];
const stepState = new Map();

// ---------- Setup ----------

// Bot count: a number box, 0 to MAX_BOTS. Out of range or junk snaps back.
const botsBox = $('m-bots');
botsBox.max = String(MAX_BOTS);
botsBox.value = String(settings.bots);
$('m-diff').value = settings.difficulty;
botsBox.addEventListener('change', () => {
  const n = Math.max(0, Math.min(MAX_BOTS, Math.round(+botsBox.value) || 0));
  botsBox.value = String(n);
  if (n === settings.bots) return;
  settings.bots = n;
  saveSettings(settings);
  onSettingChange('bots');
});
botsBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') botsBox.blur(); });
$('m-diff').addEventListener('change', () => { settings.difficulty = $('m-diff').value; onSettingChange('difficulty'); });

// Practice bots. In FFA everyone (bots included) fights everyone. In Teams the
// bots are dealt Blue first so the player, who joins Red, evens the sides.
function setupBots() {
  for (const id of brains.keys()) { game.removePlayer(id); view.removeView(id); }
  brains.clear();
  game.setMode(settings.mode);
  for (let i = 0; i < settings.bots; i++) addBot(game.mode === 'teams' ? (i % 2 ? 'red' : 'blue') : 'ffa');
  // Start them playing behind the menu (objective rounds need a round going).
  game.restartMatch();
}

// A bot with a name nobody has yet ("Inkblot", then "Inkblot 2" past 12).
function addBot(team = game.defaultTeam()) {
  const used = new Set(game.players.map((p) => p.name));
  const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  let name = pool.find((n) => !used.has(n));
  for (let i = 2; !name; i++) name = pool.map((n) => `${n} ${i}`).find((n) => !used.has(n));
  const p = game.addPlayer({ name, team, isBot: true });
  brains.set(p.id, new BotBrain(game, p, null, settings.difficulty));
  return p;
}

function removeBot() {
  const id = [...brains.keys()].pop();
  if (id == null) return;
  brains.delete(id);
  game.removePlayer(id);
  view.removeView(id);
  stepState.delete(id);
}
setupBots();

function onSettingChange(k) {
  if (k === 'volume') audio.setVolume(settings.volume);
  if (k === 'music') music.set({ level: settings.music });
  if (k === 'binds') renderControls();
  if (k === 'name' && me) me.name = settings.name;
  if (k === 'bots' && !net) setupBots();
  if (k === 'mode' && !net) setupBots();
  if (k === 'difficulty' && !net) for (const b of brains.values()) b.setDifficulty(settings.difficulty);
}

// Switch the level (practice map pick, or joining an online room that plays
// another map).
function loadMap(id) {
  if (game.map.id === id) return;
  game.setMap(getMap(id));
  view.setMap(game.map, game.world);
  for (const p of game.players) view.removeView(p.id);
  stepState.clear();
}

// ---------- Screens ----------

// Map cards on the menu. Each shows a little two-tone swatch of the map.
const MAP_SWATCH = { yard: ['#d9d1c1', '#8d9aa8'], canal: ['#3f93c4', '#dcb88f'], dunes: ['#e2cc9a', '#c99d62'], harbor: ['#9aa4ad', '#3f93c4'], frost: ['#eef2f6', '#2f6b4a'] };
const mapPick = document.querySelector('.map-pick');
mapPick.innerHTML = MAP_LIST.map((m) => {
  const [a, b] = MAP_SWATCH[m.id] ?? ['#888', '#555'];
  const kind = m.type === 'bomb' ? 'BOMB' : m.type === 'hostage' ? 'HOSTAGE' : 'DM';
  return `<button class="map-btn" data-map="${m.id}" role="radio" style="--sw:${a};--sw2:${b}"><i></i>${m.name.toUpperCase()}<small>${kind}</small></button>`;
}).join('');
function renderMapPick() {
  for (const b of mapPick.querySelectorAll('.map-btn')) {
    const on = b.dataset.map === settings.map;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  const m = getMap(settings.map);
  // The MAP button under PRACTICE shows the current pick.
  const [a, b] = MAP_SWATCH[m.id] ?? ['#888', '#555'];
  $('map-swatch').style.cssText = `--sw:${a};--sw2:${b}`;
  $('map-name').textContent = m.name.toUpperCase();
  $('map-kind').textContent = m.type === 'bomb' ? 'BOMB' : m.type === 'hostage' ? 'HOSTAGE' : 'DM';
  let note;
  if (m.type === 'dm') note = settings.mode === 'teams' ? `<b>${m.name}</b> · Teams: first team to ${TEAM_KILL_LIMIT} kills` : `<b>${m.name}</b> · Free for all: first to ${FFA_KILL_LIMIT} kills`;
  else if (settings.mode !== 'teams') note = `<b>${m.name}</b> · Free for all deathmatch. Pick Teams for ${MAP_TYPE_LABEL[m.type].toLowerCase()}.`;
  else if (m.type === 'bomb') note = `<b>${m.name}</b> · Rounds: Red plants the bomb at A or B, Blue defends`;
  else note = `<b>${m.name}</b> · Rounds: Blue rescues the hostages, Red guards them`;
  $('map-note').innerHTML = note;
  $('maps-note').innerHTML = note;
}
renderMapPick();
mapPick.addEventListener('click', (e) => {
  const b = e.target.closest('.map-btn');
  if (!b || b.dataset.map === settings.map) return;
  settings.map = b.dataset.map;
  saveSettings(settings);
  renderMapPick();
  if (!net) {
    loadMap(settings.map);
    setupBots();
  }
});

// Free for all / Teams, for both practice and online.
function renderModePick() {
  for (const b of document.querySelectorAll('.mode-btn')) {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}
renderModePick();
for (const b of document.querySelectorAll('.mode-btn')) {
  b.addEventListener('click', () => {
    if (settings.mode === b.dataset.mode) return;
    settings.mode = b.dataset.mode;
    saveSettings(settings);
    renderModePick();
    renderMapPick();
    renderControls();
    onSettingChange('mode');
  });
}

// Live player counts on the mode buttons, so it's obvious where people are.
let roomCounts = null;
let roomMaps = {};
function renderRoomCounts() {
  for (const b of document.querySelectorAll('.mode-btn')) {
    const room = PUBLIC_ROOMS[b.dataset.mode];
    const n = roomCounts?.[room];
    let el = b.querySelector('.online-count');
    if (!el) b.append((el = Object.assign(document.createElement('span'), { className: 'online-count' })));
    // Busy rooms say which map they're on (you'll join that map).
    const map = n > 0 && roomMaps[room] ? ` · ${getMap(roomMaps[room]).name}` : '';
    el.textContent = n == null ? '' : `${n} online${map}`;
    el.classList.toggle('live', n > 0);
  }
}
async function refreshRoomCounts() {
  if (net || $('menu').classList.contains('hidden') || document.hidden) return;
  const info = await fetchRoomCounts();
  roomCounts = info?.rooms ?? null;
  roomMaps = info?.maps ?? {};
  renderRoomCounts();
}
refreshRoomCounts();
setInterval(refreshRoomCounts, 5000);

// The in-game hint follows the key binds. (The full list is in Settings > Controls.)
function renderControls() {
  const b = settings.binds;
  const teamHint = settings.mode === 'teams' ? ` &nbsp;·&nbsp; ${keyName(b.switchTeam)} — switch team` : '';
  $('hint').innerHTML = `${keyName(b.buy)} — buy menu &nbsp;·&nbsp; ${keyName(b.primary)}/${keyName(b.secondary)}/${keyName(b.melee)}/${keyName(b.lastWeapon)} — weapons &nbsp;·&nbsp; ${keyName(b.drop)} — drop / pick up${teamHint}`;
}
renderControls();

// Browsers only allow sound after a click or key press, so the menu music
// starts on the first one.
function startAudio() {
  audio.unlock();
  music.start();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, startAudio, { once: true });

function renderMusicToggle() {
  $('music-toggle').classList.toggle('muted', settings.musicMuted);
  $('music-toggle').setAttribute('aria-label', settings.musicMuted ? 'Unmute menu music' : 'Mute menu music');
}
renderMusicToggle();
$('music-toggle').addEventListener('click', () => {
  settings.musicMuted = !settings.musicMuted;
  saveSettings(settings);
  music.set({ muted: settings.musicMuted });
  renderMusicToggle();
});

function showPlaying() {
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('settings').classList.add('hidden');
  hud.show(true);
  if (TOUCH) touch.show(true);
  // Fullscreen first: switching to it cancels a pointer lock in flight.
  else enterMatchScreen().then(() => input.lock());
  input.inMatch = true;
  pausedAt = 0;
  mode = 'playing';
  audio.setSfx(true);
  music.set({ active: false });
}

function startPlaying() {
  startAudio();
  if (net) return showPlaying();
  if (!me) {
    // A fresh match with a short countdown, so it doesn't start the instant
    // you click.
    me = game.addPlayer({ name: settings.name });
    game.restartMatch();
  }
  showPlaying();
}

function clearPlayers() {
  for (const p of [...game.players]) { game.removePlayer(p.id); view.removeView(p.id); }
  brains.clear();
  stepState.clear();
  game.drops = [];
  me = null;
}

function showMenu(status = '') {
  mode = 'menu';
  setConsole(false);
  input.inMatch = false;
  touch?.show(false);
  leaveMatchScreen();
  audio.setSfx(false);
  music.set({ active: true });
  if (buyMenu.open) setBuyMenu(false);
  input.unlock();
  $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  hud.show(false);
  hud.showScores(false);
  $('play-online').disabled = false;
  $('net-status').textContent = status;
  $('net-status').classList.toggle('hidden', !status);
  refreshRoomCounts();
}

// Online: drop the local bots and mirror a server room instead.
// PLAY ONLINE joins your mode's room, unless it's empty and the other mode
// has people, in which case it joins them so nobody ends up alone.
async function goOnline() {
  startAudio();
  $('play-online').disabled = true;
  $('net-status').textContent = 'Connecting…';
  $('net-status').classList.remove('hidden');
  const info = await fetchRoomCounts();
  if (info) { roomCounts = info.rooms; roomMaps = info.maps; }
  renderRoomCounts();
  const room = pickRoom(settings.mode, roomCounts ?? {});
  if (roomMode(room) !== settings.mode) {
    settings.mode = roomMode(room);
    saveSettings(settings);
    renderModePick();
    renderMapPick();
    renderControls();
  }
  clearPlayers();
  acc = 0;
  net = new OnlineSession(game, {
    url: roomUrl(room),
    name: settings.name,
    map: settings.map,
    onMap: (id) => loadMap(getMap(id).id),
    onWelcome: (p) => {
      me = p;
      input.setAngles(me.yaw, 0);
      showPlaying();
    },
    onClose: (reason) => leaveOnline(reason),
    onRemove: (id) => { view.removeView(id); stepState.delete(id); },
    onAdmin: (msg) => onAdminReply(msg),
  });
}

function leaveOnline(status = '') {
  net?.close();
  net = null;
  clearPlayers();
  killInfo = null;
  timers.length = 0;
  hud.ping(null);
  hud.room(null);
  loadMap(settings.map);
  setupBots();
  showMenu(status);
}

$('play').addEventListener('click', startPlaying);
$('play-online').addEventListener('click', goOnline);
$('resume').addEventListener('click', startPlaying);
$('quit').addEventListener('click', () => {
  if (net) return leaveOnline();
  if (me) { game.removePlayer(me.id); view.removeView(me.id); me = null; }
  showMenu();
});
$('open-maps').addEventListener('click', () => $('maps').classList.remove('hidden'));
$('close-maps').addEventListener('click', () => $('maps').classList.add('hidden'));
const openSettings = () => $('settings').classList.remove('hidden');
$('open-settings').addEventListener('click', openSettings);
$('pause-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings').classList.add('hidden'));
canvas.addEventListener('click', () => { if (!TOUCH && mode === 'playing' && !input.locked && !buyMenu.open) input.lock(); });

// Pausing: Esc, losing pointer lock (alt-tab, the browser's own Esc) or the
// touch pause button. Esc again resumes.
let pausedAt = 0;
let resumeOnLock = false;
function pauseGame() {
  if (mode !== 'playing') return;
  mode = 'paused'; // first, so closing the menu doesn't re-lock
  pausedAt = performance.now();
  resumeOnLock = false;
  audio.setSfx(false); // paused means quiet, even online where the match goes on
  if (buyMenu.open) setBuyMenu(false);
  setConsole(false);
  touch?.reset();
  // We release the mouse ourselves, which also lets us take it back on the
  // next Esc without a click (browsers allow that after exitPointerLock).
  input.unlock();
  $('pause').classList.remove('hidden');
}

function resumeByKey() {
  // Ignore the same Esc that paused us (the browser can deliver it twice).
  if (performance.now() - pausedAt < 250) return;
  if (!$('settings').classList.contains('hidden')) {
    if (!settingsPanel.capturing) $('settings').classList.add('hidden');
    return;
  }
  if (TOUCH || input.locked) return startPlaying();
  // Resume once the browser hands the mouse back. If it refuses (it does
  // after you pressed Esc yourself outside fullscreen), RESUME needs a click.
  resumeOnLock = true;
  input.lock();
}

input.on('lock', (locked) => {
  if (!locked && mode === 'playing') pauseGame();
  else if (locked && mode === 'paused' && resumeOnLock) { resumeOnLock = false; startPlaying(); }
});

// ---------- Browser shortcuts during a match ----------
// A page can't stop Ctrl+W / Ctrl+T / Ctrl+N in a normal window. In
// fullscreen, Chrome and Edge let us take the whole keyboard with the
// Keyboard Lock API, so those (and Esc) come to the game instead; holding Esc
// still leaves fullscreen. Elsewhere, closing the tab mid-match at least asks
// first (beforeunload).
let ownFullscreen = false;
async function enterMatchScreen() {
  if (!settings.fullscreen) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
      ownFullscreen = true;
    } catch { /* not allowed here; play windowed */ }
  }
  lockKeys();
}
function lockKeys() {
  if (document.fullscreenElement && navigator.keyboard?.lock) navigator.keyboard.lock().catch(() => {});
}
function leaveMatchScreen() {
  navigator.keyboard?.unlock?.();
  if (ownFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  ownFullscreen = false;
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) { ownFullscreen = false; navigator.keyboard?.unlock?.(); }
  else if (mode !== 'menu') lockKeys();
});
addEventListener('beforeunload', (e) => {
  if (mode === 'menu') return;
  e.preventDefault();
  e.returnValue = '';
});

// The buy menu keeps pointer lock and uses a virtual cursor. Releasing and
// re-locking would make Chrome/Edge show "press Esc to show your cursor"
// after every purchase.
const vcursor = $('vcursor');
let hoverEl = null;
input.on('cursor', (c) => {
  vcursor.classList.toggle('hidden', !c);
  if (!c) { hoverEl = null; return; }
  vcursor.style.transform = `translate(${c.x}px, ${c.y}px)`;
  const el = document.elementFromPoint(c.x, c.y);
  if (el && el !== hoverEl) {
    hoverEl = el;
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  }
});
input.on('cursorClick', (c) => {
  const el = document.elementFromPoint(c.x, c.y);
  if (el && el !== vcursor) el.click();
});

function setBuyMenu(open) {
  if (!me || !me.alive) open = false;
  buyMenu.kitAllowed = game.objective === 'bomb' && me?.team === 'blue';
  buyMenu.show(open, me);
  input.menuKeys = open;
  // Without pointer lock the real mouse cursor already works on the menu.
  input.setCursor(open && input.locked);
  if (!open && mode === 'playing' && !TOUCH) input.lock();
}
buyMenu.onClose = () => setBuyMenu(false);

input.on('key', (code) => {
  if (code === 'Escape' && mode === 'paused') return resumeByKey();
  if (mode !== 'playing') return;
  if (code === 'Backquote') return setConsole(!consoleOpen);
  if (consoleOpen) { if (code === 'Escape') setConsole(false); return; }
  const b = settings.binds;
  if (code === b.buy) setBuyMenu(!buyMenu.open);
  else if (code === 'Escape' && buyMenu.open) setBuyMenu(false);
  else if (code === 'Escape') pauseGame();
  else if (buyMenu.open && /^(Digit|Numpad)\d$/.test(code)) buyMenu.key(+code.slice(-1));
  else if (buyMenu.open && code === 'Backspace') buyMenu.key('back');
  else if (code === b.switchTeam) switchTeam();
  else if (code === b.drop && !buyMenu.open) dropOrPickup();
  else if (code === b.scores) showScoreboard(true);
});
input.on('keyup', (code) => {
  if (code === settings.binds.scores && scoresForced === null) showScoreboard(false);
});

function showScoreboard(show, title = '') {
  hud.showScores(show, game.players, me?.id, game.mode, game.objective ? game.rounds : game.teamKills, title);
}

// G: pick up the gun in reach (swapping with yours), or drop the one in hand.
function dropOrPickup() {
  if (!me?.alive) return;
  const d = game.pickupTarget(me, input.yaw);
  pendingActions.push(d ? { type: 'pickup', id: d.id } : { type: 'drop' });
}

// ---------- Multi-kill announcer ----------

const MULTI_KILLS = [null, null, ['DOUBLE KILL', 'double'], ['TRIPLE KILL', 'triple'], ['MULTI KILL', 'multi'], ['ULTRA KILL', 'ultra'], ['MONSTER KILL', 'monster']];
let announcer = null;
function announceMultiKill(n) {
  const [text, clip] = MULTI_KILLS[Math.min(n, MULTI_KILLS.length - 1)];
  hud.multiKill(text, n);
  // A newer call cuts off the last one (a shotgun double then triple).
  try { announcer?.stop(); } catch { /* already ended */ }
  announcer = audio.play('announce_' + clip, { volume: 1, jitter: 0 });
}

// ---------- Admin console (~) ----------
// Practice: commands run on the local game. Online: they go to the room,
// which runs them only with the right admin password (the ADMIN_KEY secret on
// the Worker). The password is remembered in this browser after a login.

const ADMIN_KEY_STORE = 'stickshooter.adminKey';
const consoleEl = $('console'), consoleLog = $('console-log'), consoleInput = $('console-input');
let consoleOpen = false;
let consoleHello = false;
let pendingAdminKey = null;
const consoleHistory = [];
let historyAt = 0;

function storedAdminKey() {
  try { return localStorage.getItem(ADMIN_KEY_STORE); } catch { return null; }
}
function storeAdminKey(k) {
  try { if (k) localStorage.setItem(ADMIN_KEY_STORE, k); else localStorage.removeItem(ADMIN_KEY_STORE); } catch { /* private mode */ }
}

function consolePrint(lines, cls = '') {
  for (const line of [].concat(lines)) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = line;
    consoleLog.append(d);
  }
  while (consoleLog.childElementCount > 200) consoleLog.firstChild.remove();
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function setConsole(open) {
  if (open && (mode !== 'playing' || TOUCH)) return;
  if (consoleOpen === open) return;
  consoleOpen = open;
  consoleEl.classList.toggle('hidden', !open);
  input.typing = open;
  input.keys.clear();
  input.mouse.left = input.mouse.right = false;
  if (open) {
    if (buyMenu.open) setBuyMenu(false);
    // Keep pointer lock (like the buy menu) so closing doesn't need a click.
    input.setCursor(input.locked);
    consoleInput.value = '';
    consoleInput.focus();
    if (!consoleHello) {
      consoleHello = true;
      consolePrint('Admin console. Type help for commands, ~ or Esc to close.', 'ok');
    }
    if (net && !storedAdminKey()) consolePrint('Online, admin commands need the password: login <password>');
  } else {
    consoleInput.blur();
    input.setCursor(false);
  }
}

// Practice: what the commands can do outside the Game itself.
const practiceHost = {
  maps: MAPS,
  botCount: () => brains.size,
  setBots(n) {
    n = Math.max(0, Math.min(MAX_BOTS, n));
    while (brains.size < n) addBot();
    while (brains.size > n) removeBot();
    settings.bots = n;
    botsBox.value = String(n);
    saveSettings(settings);
    return brains.size;
  },
  setDifficulty(d) {
    settings.difficulty = d;
    $('m-diff').value = d;
    saveSettings(settings);
    for (const b of brains.values()) b.setDifficulty(d);
  },
  changeMap(id) {
    settings.map = id;
    saveSettings(settings);
    loadMap(id);
    setupBots(); // restarts the match on the new map, with us in it
    renderMapPick();
  },
};

function runConsole(line) {
  line = line.trim();
  if (!line) return;
  consolePrint('> ' + line, 'in');
  consoleHistory.push(line);
  historyAt = consoleHistory.length;
  const [word, ...rest] = line.split(/\s+/);
  const cmd = word.toLowerCase();
  if (cmd === 'clear') { consoleLog.textContent = ''; return; }
  if (!net) {
    const res = runAdmin(game, practiceHost, me, line);
    if (res.lines.length) consolePrint(res.lines, res.ok ? '' : 'err');
    return;
  }
  if (cmd === 'login') {
    pendingAdminKey = rest.join(' ');
    if (!pendingAdminKey) return consolePrint('Usage: login <password>', 'err');
    net.send({ t: 'admin', key: pendingAdminKey, login: true });
    return;
  }
  if (cmd === 'logout') { storeAdminKey(null); return consolePrint('Logged out.'); }
  const key = storedAdminKey();
  if (!key) return consolePrint('Admin only. Type: login <password>', 'err');
  net.send({ t: 'admin', key, line });
}

function onAdminReply(msg) {
  if (msg.auth === true && pendingAdminKey) storeAdminKey(pendingAdminKey);
  if (msg.auth === false) storeAdminKey(null);
  pendingAdminKey = null;
  if (msg.lines?.length) consolePrint(msg.lines, msg.ok ? (msg.auth ? 'ok' : '') : 'err');
}

consoleInput.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') { e.preventDefault(); return; } // closes the console instead of typing `
  if (e.key === 'Enter') {
    const line = consoleInput.value;
    consoleInput.value = '';
    runConsole(line);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    historyAt = Math.max(0, Math.min(consoleHistory.length, historyAt + (e.key === 'ArrowUp' ? -1 : 1)));
    consoleInput.value = consoleHistory[historyAt] ?? '';
  }
});

// ---------- Events from the sim ----------

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function viewToWorld(out) {
  // Viewmodel space is camera space.
  return out.applyMatrix4(view.camera.matrixWorld);
}

function isFirstPerson(p) {
  return p === me;
}

// Red <-> Blue. The sim takes us out and respawns us on the other side.
function switchTeam() {
  if (!me || game.mode !== 'teams') return;
  if (buyMenu.open) setBuyMenu(false);
  pendingActions.push({ type: 'team', team: me.team === 'red' ? 'blue' : 'red' });
}

function handleEvent(e) {
  const p = e.pid ? game.getPlayer(e.pid) : null;
  switch (e.type) {
    case 'shot': {
      const def = WEAPONS[e.weapon];
      const vol = def.id === 'awp' ? 1 : 0.8;
      let muzzle;
      if (isFirstPerson(p)) {
        view.viewModel.fire(def.pellets ? 1.6 : def.id === 'awp' || def.id === 'deagle' ? 1.4 : 1);
        audio.play('shot_' + def.id, { volume: vol });
        view.camera.updateMatrixWorld();
        muzzle = viewToWorld(view.viewModel.muzzleView(_v));
        const ej = viewToWorld(view.viewModel.ejectView(_v2));
        if (!def.pellets || def.id === 'autoshotgun') {
          const q = view.camera.quaternion;
          const vel = _v3.set(1.6 + Math.random(), 1.4 + Math.random(), 0.4).applyQuaternion(q);
          vel.x += me.vel[0]; vel.z += me.vel[2];
          view.effects.shell(ej, vel);
        }
      } else {
        const v = view.views.get(p.id);
        if (!v) break;
        v.man.kick = 1;
        muzzle = v.man.muzzleWorld(_v);
        view.effects.muzzleFlash(muzzle, _v2.set(e.dir[0], e.dir[1], e.dir[2]));
        audio.play('shot_' + def.id, { pos: e.origin, volume: vol });
      }
      const tracerChance = def.pellets ? 0.35 : isFirstPerson(p) ? 0.5 : 0.8;
      for (const end of e.ends) {
        if (Math.random() < tracerChance) view.effects.tracer(muzzle, _v3.set(end[0], end[1], end[2]));
      }
      for (const im of e.impacts) view.effects.impact(im.pos, im.normal, im.material);
      bulletSounds(e);
      break;
    }
    case 'hit': {
      const victim = game.getPlayer(e.victim);
      const dir = e.from ? norm([e.pos[0] - e.from[0], e.pos[1] - e.from[1] - 1.5, e.pos[2] - e.from[2]]) : [0, 0, 0];
      view.effects.blood(e.pos, dir, e.group === 'head');
      if (me && e.attacker === me.id && e.victim !== me.id) {
        const killed = victim && victim.health <= 0;
        hud.hit(killed, e.group === 'head');
        audio.play(hitSound(e), { volume: e.group === 'head' ? 0.7 : 0.6 });
      }
      if (me && e.victim === me.id) {
        audio.play('hurt', { volume: 0.8 });
        if (e.from) {
          const ang = Math.atan2(-(e.from[0] - me.pos[0]), -(e.from[2] - me.pos[2])) - input.yaw;
          hud.hurt(-ang, e.damage);
        }
      } else if (victim) {
        audio.play(hitSound(e), { pos: e.pos, volume: 0.5 });
      }
      break;
    }
    case 'kill': {
      const attacker = e.attacker ? game.getPlayer(e.attacker) : null;
      const victim = game.getPlayer(e.victim);
      if (!victim) break;
      hud.kill({ attacker, victim, weapon: e.weapon, headshot: e.headshot, wallbang: e.wallbang, cause: e.cause, mine: me && (e.attacker === me.id || e.victim === me.id) });
      // The stickman vanishes in a puff; its gun is left on the ground.
      if (victim !== me && victim.pos[1] > -10) view.effects.poof([victim.pos[0], victim.pos[1] + 1.0, victim.pos[2]]);
      if (me && e.attacker === me.id && e.victim !== me.id) {
        audio.play('killConfirm', { volume: 0.5 });
        if (e.reward) hud.moneyPop(e.reward);
        if (e.multi >= 2) announceMultiKill(e.multi);
      }
      if (me && e.victim === me.id) {
        killInfo = { attacker: e.attacker, weapon: e.weapon, headshot: e.headshot, wallbang: e.wallbang, pos: [...me.pos], time: game.time };
        if (buyMenu.open) setBuyMenu(false);
      }
      break;
    }
    case 'reload': {
      if (isFirstPerson(p)) {
        const def = WEAPONS[e.weapon];
        view.viewModel.reload(e.duration, def.shellReload ?? null);
        if (!def.shellReload) {
          // Sounds follow the viewmodel animation: mag out, mag in, bolt/slide,
          // each gun with its own recorded parts.
          const parts = RELOAD_SOUNDS[def.id] ?? [[0.14, 'magOut', 0.6], [0.6, 'magIn', 0.65]];
          parts.forEach(([f, name, volume], i) => {
            const alt = i === 0 ? 'magOut' : /clipin|boxin/.test(name) ? 'magIn' : 'bolt';
            timers.push({ t: game.time + e.duration * f, fn: () => { if (me?.reloading) audio.play(name, { volume, alt }); } });
          });
        }
      } else if (p) {
        const first = RELOAD_SOUNDS[e.weapon]?.[0]?.[1] ?? 'magOut';
        audio.play(first, { pos: p.pos, volume: 0.45, alt: 'magOut' });
      }
      break;
    }
    case 'reloaded':
      if (isFirstPerson(p)) {
        const id = game.activeDef(p)?.id;
        if (RELOADED_SOUNDS[id]) audio.play(RELOADED_SOUNDS[id], { volume: 0.55, alt: 'bolt' });
      }
      break;
    case 'shell':
      if (p === me) audio.play(SHELL_SOUNDS[game.activeDef(p)?.id] ?? 'shell', { volume: 0.55, alt: 'shell' });
      break;
    case 'deploy':
      if (p === me) {
        view.viewModel.deploy();
        if (e.weapon === 'knife') audio.play('knifeDeploy', { volume: 0.35 });
        else audio.play('deploy', { volume: 0.4 });
      }
      break;
    case 'melee': {
      const sound = e.hit === 'flesh' ? 'knifeHit' : e.hit === 'wall' ? 'knifeWall' : null;
      const swing = e.kind === 'stab' ? 'knifeStab' : 'knifeSlash';
      if (p === me) {
        view.viewModel.melee(e.kind);
        audio.play(swing, { volume: 0.55 });
        if (sound) audio.play(sound, { volume: 0.7 });
      } else if (p) {
        const v = view.views.get(p.id);
        if (v) v.man.kick = 1;
        audio.play(swing, { pos: p.pos, volume: 0.5 });
        if (sound) audio.play(sound, { pos: e.pos ?? p.pos, volume: 0.6 });
      }
      if (e.hit === 'wall' && e.pos) view.effects.impact(e.pos, e.normal, e.material);
      break;
    }
    case 'pickup':
      if (p === me) audio.play('magIn', { volume: 0.6 });
      break;
    case 'drop':
      if (p === me && e.alive) audio.play('magOut', { volume: 0.5 });
      break;
    case 'matchEnd':
      audio.play('win', { volume: 0.6 });
      break;
    case 'dry':
      if (p === me) audio.play(game.activeDef(p)?.slot === 'secondary' ? 'dryPistol' : 'dryRifle', { volume: 0.7 });
      break;
    case 'zoom':
      if (p === me) audio.play('zoom', { volume: 0.6 });
      break;
    case 'buy':
      if (p === me) { audio.play('buy', { volume: 0.4 }); if (buyMenu.open) buyMenu.render(me); }
      break;
    case 'team':
      if (p === me) { killInfo = null; teamMsgUntil = performance.now() + 2500; }
      break;
    case 'spawn': {
      const v = view.views.get(p.id);
      if (v) v.man.revive();
      if (p === me) { input.setAngles(me.yaw, 0); killInfo = null; }
      break;
    }
    // ----- Objective rounds -----
    case 'roundStart':
      alertMsg = null;
      if (buyMenu.open) buyMenu.render(me);
      break;
    case 'roundLive':
      audio.play('go', { volume: 0.45 });
      break;
    case 'roundEnd':
      audio.play(me && e.winner === me.team ? 'win' : 'alert', { volume: 0.6 });
      break;
    case 'plantStart':
    case 'defuseStart': {
      // Keypad presses while arming; a pliers click to start defusing.
      if (!p) break;
      const pos = p === me ? null : p.pos;
      if (e.type === 'plantStart') {
        for (let i = 0; i < 5; i++) timers.push({ t: game.time + 0.15 + i * 0.5, fn: () => { if (p.task?.kind === 'plant' || p === me && me.task) audio.play('keypad' + (i % 3), { pos, volume: 0.5 }); } });
      } else {
        audio.play('magOut', { pos, volume: 0.5 });
      }
      break;
    }
    case 'planted':
      alertMsg = { html: `<span class="alert">BOMB PLANTED${e.site ? ` AT ${e.site}` : ''}</span>`, until: performance.now() + 2500 };
      audio.play('alert', { volume: 0.6 });
      nextBeep = 0;
      break;
    case 'defused':
      alertMsg = { html: '<span class="alert good">BOMB DEFUSED</span>', until: performance.now() + 2500 };
      audio.play('defused', { pos: e.pos, volume: 0.9 });
      break;
    case 'explode':
      audio.play('explode', { volume: 1, jitter: 0 });
      view.effects.poof([e.pos[0], e.pos[1] + 1, e.pos[2]]);
      for (let i = 0; i < 8; i++) view.effects.poof([e.pos[0] + (Math.random() - 0.5) * 6, e.pos[1] + 0.5 + Math.random() * 3, e.pos[2] + (Math.random() - 0.5) * 6]);
      if (me?.alive) { const d = Math.hypot(me.pos[0] - e.pos[0], me.pos[2] - e.pos[2]); shakeP += Math.max(0, 0.12 - d * 0.003); }
      break;
    case 'bombDrop':
      if (me?.team === 'red') alertMsg = { html: '<span class="alert">THE BOMB WAS DROPPED</span>', until: performance.now() + 2000 };
      break;
    case 'bombPickup':
      if (p === me) { audio.play('magIn', { volume: 0.6 }); alertMsg = { html: '<span class="alert good">YOU PICKED UP THE BOMB</span>', until: performance.now() + 1800 }; }
      break;
    case 'hostageFollow':
    case 'hostageStop':
      if (p === me) audio.play(e.type === 'hostageFollow' ? 'buy' : 'dry', { volume: 0.5 });
      break;
    case 'rescued':
      audio.play('rescue', { volume: 0.6 });
      alertMsg = { html: '<span class="alert good">HOSTAGE RESCUED</span>', until: performance.now() + 1500 };
      break;
  }
}


// Bullet hitting a player: helmet dink, kevlar thud, headshot or flesh.
function hitSound(e) {
  if (e.group === 'head') return e.armorHit ? 'hitHelmet' : 'hitHead';
  return e.armorHit ? 'hitKevlar' : 'hitBody';
}

// Where bullets land: a ricochet off concrete or metal, CS style. Throttled
// so a spray from one gun doesn't turn into noise.
let lastRic = 0;
function bulletSounds(e) {
  const now = performance.now();
  const im = e.impacts[e.impacts.length - 1];
  if (!im || now - lastRic < 45) return;
  lastRic = now;
  const metal = im.material === 'metal' || im.material === 'grate';
  audio.play(metal ? 'ricMetal' : 'ricConcrete', { pos: im.pos, volume: 0.4, jitter: 0.06 });
}

// What's underfoot: the material of the box we stand on, or the map's ground.
const _under = [];
function surfaceUnder(p) {
  if (game.inWater(p)) return 'water';
  _under.length = 0;
  const [x, y, z] = p.pos;
  game.world.overlapping(x - 0.05, y - 0.06, z - 0.05, x + 0.05, y + 0.01, z + 0.05, _under);
  const box = _under.find((b) => b.kind !== 'ground');
  return box?.material ?? game.map.ground ?? 'concrete';
}

function stepSound(p) {
  const s = surfaceUnder(p);
  return s === 'water' ? 'splash' : STEP_SOUNDS[s] ?? 'step';
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------- Per-frame view update ----------

function lerp(a, b, t) { return a + (b - a) * t; }

function footsteps(p, dt, x, z) {
  let s = stepState.get(p.id);
  if (!s) { s = { timer: 0, foot: 0, x, z, air: false }; stepState.set(p.id, s); }
  const moved = Math.hypot(x - s.x, z - s.z);
  s.x = x; s.z = z;
  if (!p.alive) { s.air = false; return; }
  const speed = Math.hypot(p.vel[0], p.vel[2]) / U;
  // CS-style: a step every FOOTSTEP_TIME while running; walking (shift) and
  // crouching are silent. The first step after starting to run is immediate.
  if (p.onGround && speed > FOOTSTEP_MIN_SPEED && moved < 1) {
    s.timer -= dt;
    if (s.timer <= 0) {
      s.timer += FOOTSTEP_TIME;
      if (s.timer < 0) s.timer = FOOTSTEP_TIME;
      const name = stepSound(p);
      // Your own steps are soft. Other players' steps are loud up close and
      // fade out completely by FOOTSTEP_RANGE, so you can tell how near they are.
      if (p === me) audio.play(name, { volume: 0.16, jitter: 0.05 });
      else audio.play(name, { pos: p.pos, volume: 0.5, jitter: 0.05, range: FOOTSTEP_RANGE });
    }
  } else {
    s.timer = Math.min(s.timer, 0.05);
  }
  if (!p.onGround) s.air = true;
  else if (s.air) {
    s.air = false;
    const ls = p.landSpeed ?? 0;
    if (ls > 3) {
      // CS plays a firm footstep on landing.
      if (p === me) { audio.play(stepSound(p), { volume: 0.4 }); view.viewModel.land(ls); }
      else audio.play(stepSound(p), { pos: p.pos, volume: 0.6, range: FOOTSTEP_RANGE });
    }
  }
}

function updateView(dt, alpha) {
  // Characters.
  for (const p of game.players) {
    const v = view.viewFor(p);
    const x = lerp(p.prevPos[0], p.pos[0], alpha);
    const y = lerp(p.prevPos[1], p.pos[1], alpha);
    const z = lerp(p.prevPos[2], p.pos[2], alpha);
    footsteps(p, dt, x, z);
    v.man.setTeam(p.team);
    const visible = p.alive && p !== me;
    v.man.setVisible(visible);
    v.shadow.visible = visible;
    if (!visible) continue;
    const w = p.weapons[p.active];
    v.man.setWeapon(w ? w.id : null);
    const yaw = p === me ? input.yaw : p.yaw;
    const pitch = p === me ? input.pitch : p.pitch;
    v.man.update({
      x, y, z, yaw, pitch, vx: p.vel[0], vz: p.vel[2],
      duck: lerp(p.prevDuck, p.duckAmount, alpha), onGround: p.onGround, reloading: p.reloading, spin: p.spin,
    }, dt);
    v.shadow.position.set(x, view.groundBelow(x, y, z) + 0.01, z);
  }
  view.syncDrops(game.drops, game.time);
  view.syncObjective(game, alpha, dt, me?.alive ? me.id : null);
  bombBeeps();

  // Camera.
  const cam = view.camera;
  let fov = settings.fov;
  let showVm = false;
  let punchP = 0, punchY = 0;
  if (!(me && me.alive)) { shakeP = 0; shakeY = 0; }
  if (me && me.alive && mode !== 'menu') {
    const duck = lerp(me.prevDuck, me.duckAmount, alpha);
    const eye = STAND_EYE + (DUCK_EYE - STAND_EYE) * duck;
    const px = lerp(me.prevPos[0], me.pos[0], alpha);
    const py = lerp(me.prevPos[1], me.pos[1], alpha) - me.stepOffset + eye;
    const pz = lerp(me.prevPos[2], me.pos[2], alpha);
    punchP = lerp(me.prevPunch[0], me.punch[0], alpha) * DEG;
    punchY = lerp(me.prevPunch[1], me.punch[1], alpha) * DEG;
    const ease = 1 - Math.exp(-dt / SHAKE_EASE);
    shakeP += (punchP - shakeP) * ease;
    shakeY += (punchY - shakeY) * ease;
    cam.rotation.set(input.pitch + shakeP, input.yaw + shakeY, 0);
    cam.position.set(px, py, pz);
    const def = game.activeDef(me);
    if (def?.zoomLevels && me.zoom > 0) {
      // CS zoom FOVs are horizontal at 4:3; convert to vertical.
      const h = def.zoomLevels[me.zoom - 1] * DEG;
      fov = (2 * Math.atan(Math.tan(h / 2) * 0.75)) / DEG;
    }
    showVm = me.zoom === 0;
    audio.setListener(px, py, pz, input.yaw);
  } else if (me && !me.alive && mode !== 'menu' && spectateTarget()) {
    // Objective rounds: watch a teammate over the shoulder until next round.
    const t = spectateTarget();
    const tx = lerp(t.prevPos[0], t.pos[0], alpha), ty = lerp(t.prevPos[1], t.pos[1], alpha) + 1.55, tz = lerp(t.prevPos[2], t.pos[2], alpha);
    const f = [-Math.sin(t.yaw), -Math.cos(t.yaw)];
    // Pull back 2.6 m, less if a wall is in the way.
    const bx = -f[0], bz = -f[1], by = 0.35;
    const len = Math.hypot(bx, by, bz);
    const hit = game.world.raycast(tx, ty, tz, bx / len, by / len, bz / len, 2.6);
    const back = hit ? Math.max(0.3, hit.t - 0.25) : 2.6;
    cam.position.set(tx + (bx / len) * back, ty + (by / len) * back, tz + (bz / len) * back);
    cam.rotation.set(t.pitch * 0.6 - 0.12, t.yaw, 0);
    audio.setListener(tx, ty, tz, t.yaw);
  } else if (me && !me.alive && mode !== 'menu') {
    // Death cam: rise above the body and look at the killer.
    const k = killInfo;
    const base = k?.pos ?? me.pos;
    const killer = k?.attacker ? game.getPlayer(k.attacker) : null;
    cam.position.set(base[0], base[1] + 3.2, base[2]);
    const target = killer && killer.alive ? _v.set(killer.pos[0], killer.pos[1] + 1.2, killer.pos[2]) : _v.set(base[0], base[1], base[2] - 0.01);
    const dx = target.x - cam.position.x, dy = target.y - cam.position.y, dz = target.z - cam.position.z;
    cam.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
    audio.setListener(base[0], base[1] + 1.6, base[2], cam.rotation.y);
  } else {
    // Menu: slow orbit over the map.
    menuAngle += dt * 0.06;
    cam.position.set(Math.sin(menuAngle) * 34, 16, Math.cos(menuAngle) * 34);
    cam.rotation.set(-0.42, menuAngle, 0);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, menuAngle);
  }
  view.setFov(fov);
  input.sensScale = fov / settings.fov;

  // Viewmodel.
  const [mdx, mdy] = input.takeFrameDelta();
  if (me && me.alive) {
    const w = me.weapons[me.active];
    view.viewModel.setWeapon(w ? w.id : null);
    view.viewModel.setTeam(me.team);
  }
  view.viewModel.update(dt, {
    mouseDX: mdx, mouseDY: mdy, speed: me ? Math.hypot(me.vel[0], me.vel[2]) : 0, onGround: me?.onGround ?? true,
    reloading: me?.reloading ?? false, spin: me?.spin ?? 0, visible: showVm,
  });
  view.effects.update(dt);

  // HUD.
  if (me && mode !== 'menu') {
    const def = game.activeDef(me);
    const w = game.activeWeapon(me);
    let spreadPx = 0;
    if (def) {
      const s = game.currentSpread(me, def);
      const h = innerHeight;
      spreadPx = Math.min(80, (s * 0.5 * (h / 2)) / Math.tan((fov * DEG) / 2)) + Math.hypot(me.punch[0], me.punch[1]) * 1.5;
    }
    let reloadFrac = null;
    if (me.reloading && def && !def.shellReload) reloadFrac = 1 - (me.reloadEnd - game.time) / def.reload;
    // The part of the recoil the camera isn't showing (screen shake setting)
    // moves the crosshair, so it still marks where the next bullet goes.
    const f = (innerHeight / 2) / Math.tan((fov * DEG) / 2);
    const chOffset = me.alive ? [-Math.tan(punchY - shakeY) * f, -Math.tan(punchP - shakeP) * f] : null;
    hud.update(dt, { p: me, def, w, spreadPx, reloadFrac, showFps: settings.showFps, scoped: me.alive && me.zoom > 0, chOffset });
    hud.teamScores(game.objective ? game.rounds : game.teamKills, game.mode === 'teams' ? me.team : null);
    hud.goal(goalText());
    hud.message(centerMessage());
    hud.prompt(pickupPrompt() || objectivePrompt());
    roundHud();
  } else {
    hud.update(dt, { p: null, showFps: settings.showFps });
    hud.roundTimer('');
    hud.task(null);
    hud.bombTag(false);
  }
}

// ---------- Objective rounds: HUD, spectating, bomb beeps ----------

function clock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function roundHud() {
  if (!game.objective) { hud.roundTimer(''); hud.task(null); hud.bombTag(false); return; }
  const r = game.round, b = game.bomb, t = game.time;
  if (b.state === 'planted') hud.roundTimer('BOMB', 'bomb');
  else if (r.state === 'freeze') hud.roundTimer(clock(r.endsAt - r.freezeEnd));
  else if (r.state === 'live') hud.roundTimer(clock(r.endsAt - t), r.endsAt - t < 15 ? 'low' : '');
  else hud.roundTimer(clock(0));
  hud.bombTag(me.alive && b.state === 'carried' && b.carrier === me.id);
  const task = me.alive ? me.task : null;
  if (task) hud.task((t - task.start) / (task.end - task.start), task.kind === 'plant' ? 'PLANTING THE BOMB' : me.defuser ? 'DEFUSING (KIT)' : 'DEFUSING');
  else hud.task(null);
}

// While dead in a round: the teammate to watch (or anyone, once the team
// is wiped out). Starts two seconds after you die.
function spectateTarget() {
  if (!game.objective || !me || me.alive) { spectating = null; return null; }
  if (killInfo && game.time - (killInfo.time ?? 0) < 2) return null;
  let t = spectating ? game.getPlayer(spectating) : null;
  if (!t || !t.alive) {
    t = game.players.find((p) => p.alive && p.team === me.team && p !== me) ?? game.players.find((p) => p.alive && p !== me) ?? null;
    spectating = t?.id ?? null;
  }
  return t;
}

// The planted bomb beeps faster and faster, like the real thing.
function bombBeeps() {
  const b = game.bomb;
  if (mode === 'menu' || game.objective !== 'bomb' || b.state !== 'planted') return;
  if (game.time < nextBeep) return;
  const left = Math.max(0, b.explodeAt - game.time);
  nextBeep = game.time + 0.1 + 0.9 * Math.min(1, left / 35);
  audio.play('bombBeep', { pos: b.pos, volume: 0.55, jitter: 0 });
}

// "Hold E to plant" and friends.
function objectivePrompt() {
  if (!game.objective || !me.alive || buyMenu.open) return '';
  const k = `<kbd>${keyName(settings.binds.use)}</kbd>`;
  const b = game.bomb;
  if (game.objective === 'bomb') {
    if (me.task) return '';
    if (canPlant(game, me)) return `Hold ${k} to plant the bomb`;
    if (b.state === 'carried' && b.carrier === me.id) return siteAt(game.map, me.pos) ? '' : `<small style="opacity:.75">You have the bomb: plant it at site A or B</small>`;
    if (canDefuse(game, me)) return `Hold ${k} to defuse${me.defuser ? ' (kit)' : ''}`;
    return '';
  }
  const h = hostageInReach(game, me);
  if (!h) return '';
  if (h.state === 'follow' && h.leader === me.id) return `${k} Tell the hostage to wait`;
  if (me.team === 'blue' && h.state !== 'rescued') return `${k} Lead the hostage`;
  return '';
}

// What wins the match, under the top bar.
function goalText() {
  if (game.objective) {
    const n = `ROUND ${game.round.n} · FIRST TO ${ROUND_WIN_LIMIT} ROUNDS`;
    if (game.objective === 'bomb') {
      const b = game.bomb;
      if (b.state === 'planted') return me.team === 'blue' ? `${n} · DEFUSE THE BOMB AT ${b.site}` : `${n} · GUARD THE BOMB AT ${b.site}`;
      return me.team === 'red' ? `${n} · PLANT THE BOMB AT A OR B` : `${n} · DEFEND SITES A AND B`;
    }
    const left = game.hostages.filter((h) => h.state !== 'rescued').length;
    return me.team === 'blue' ? `${n} · RESCUE THE HOSTAGES (${left} LEFT)` : `${n} · GUARD THE HOSTAGES (${left} LEFT)`;
  }
  if (game.mode === 'teams') return `FIRST TEAM TO ${TEAM_KILL_LIMIT} KILLS`;
  let lead = null;
  for (const p of game.players) if (!lead || p.kills > lead.kills) lead = p;
  const leader = lead && lead.kills > 0 ? ` · LEADER ${lead === me ? 'YOU' : lead.name.toUpperCase()} ${lead.kills}` : '';
  return `FIRST TO ${FFA_KILL_LIMIT} KILLS${leader}`;
}

// Big text in the middle: the winner, the start countdown, or how you died.
function centerMessage() {
  const t = game.time, m = game.match;
  if (m.state === 'over') {
    // The winner goes on top of the final scoreboard, which stays up until
    // the next match.
    const secs = Math.max(0, Math.ceil(m.endsAt - t));
    const who = m.winnerTeam
      ? `<span class="win team-${m.winnerTeam}">${m.winnerTeam === 'red' ? 'RED' : 'BLUE'} TEAM WINS</span>`
      : `<span class="win">${m.winner === me.id ? 'YOU WIN!' : `${escapeHtml(m.winnerName).toUpperCase()} WINS`}</span>`;
    const title = `${who}<small>Next match in ${secs}</small>`;
    if (scoresForced !== title) { scoresForced = title; showScoreboard(true, title); }
    return '';
  }
  if (scoresForced !== null) { scoresForced = null; showScoreboard(false); }
  const r = game.round;
  if (game.objective && r.state === 'end') {
    const reasons = {
      bomb: 'The bomb exploded', defused: 'The bomb was defused', eliminated: 'Enemy team eliminated',
      time: game.objective === 'bomb' ? 'The bomb was never planted' : 'The hostages were not rescued', rescued: 'All hostages rescued',
    };
    const w = r.winner === 'red' ? 'RED' : 'BLUE';
    return `<span class="round-win team-${r.winner}">${w} WINS THE ROUND</span><small>${reasons[r.reason] ?? ''} · ${game.rounds.red} - ${game.rounds.blue}</small>`;
  }
  if (alertMsg && performance.now() < alertMsg.until) return alertMsg.html;
  if (me.alive && game.frozen(me)) {
    const n = Math.max(1, Math.ceil(me.frozenUntil - t));
    if (n !== lastCount) { lastCount = n; audio.play('beep', { volume: 0.5 }); }
    const what = game.objective ? `Round ${r.n} · ${me.team === 'red' ? 'Red' : 'Blue'} team · buy now (${keyName(settings.binds.buy)})` : 'Get ready';
    return `<span class="count">${n}</span><small>${what}</small>`;
  }
  if (lastCount !== null) {
    lastCount = null;
    if (me.alive) { goUntil = performance.now() + 700; audio.play('go', { volume: 0.55 }); }
  }
  if (performance.now() < goUntil) return '<span class="count go">GO!</span>';
  if (performance.now() < teamMsgUntil) {
    return `<span class="team-${me.team}">You joined ${me.team === 'red' ? 'Red' : 'Blue'} team</span>`;
  }
  if (!me.alive && game.objective) {
    const t2 = spectateTarget();
    const watch = t2 ? ` · watching ${escapeHtml(t2.name)}` : '';
    const k = killInfo;
    const killer = k?.attacker ? game.getPlayer(k.attacker) : null;
    if (killer && game.time - (k.time ?? 0) < 2) return `Killed by ${escapeHtml(killer.name)}<small>You're out until the next round</small>`;
    return `<small>You're out until the next round${watch}</small>`;
  }
  if (!me.alive) {
    const k = killInfo;
    const killer = k?.attacker ? game.getPlayer(k.attacker) : null;
    const secs = Math.max(0, Math.ceil(me.respawnAt - t));
    const how = k?.weapon ? `${WEAPONS[k.weapon].name}${k.headshot ? ' · headshot' : ''}${k.wallbang ? ' · through the wall' : ''}` : '';
    return killer ? `Killed by ${escapeHtml(killer.name)}<small>${how} · respawning in ${secs}</small>` : `<small>Respawning in ${secs}</small>`;
  }
  return '';
}

// "G  Pick up AK47" when a gun on the ground is in reach.
function pickupPrompt() {
  if (!me.alive || buyMenu.open) return '';
  const d = game.pickupTarget(me, input.yaw);
  if (!d) return '';
  const def = WEAPONS[d.weapon.id];
  const cur = me.weapons[def.slot];
  const swap = cur ? ` <small style="opacity:.6">(drops your ${WEAPONS[cur.id].name})</small>` : '';
  return `<kbd>${keyName(settings.binds.drop)}</kbd> Pick up ${def.name}${swap}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- Main loop ----------

// Online: same 128 Hz cmd cadence as practice, but the cmds go to the server
// and only our own movement is predicted locally. The server keeps running
// while we're paused, so we keep sending (empty) cmds.
function netFrame(dt) {
  if (net.ready) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK_DT) {
      const cmd = mode === 'playing' ? input.buildCmd() : { ...emptyCmd(), yaw: input.yaw, pitch: input.pitch };
      if (pendingActions.length) { cmd.actions = pendingActions; pendingActions = []; }
      net.tick(cmd);
      acc -= TICK_DT;
      if (++steps >= 24) { acc = 0; break; }
    }
  }
  net.interpolate();
  game.time = net.serverTime();
  for (const e of net.drainEvents()) handleEvent(e);
  for (let i = timers.length - 1; i >= 0; i--) if (game.time >= timers[i].t) { timers[i].fn(); timers.splice(i, 1); }
  if (net?.ready) {
    hud.ping(net.rtt);
    hud.room(game.mode, game.players.filter((p) => !p.isBot).length);
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (net) {
    netFrame(dt);
  } else if (mode !== 'paused') {
    acc += dt;
    let steps = 0;
    while (acc >= TICK_DT) {
      const cmds = new Map();
      if (me) {
        const cmd = mode === 'playing' ? input.buildCmd() : { ...emptyCmd(), yaw: input.yaw, pitch: input.pitch };
        if (pendingActions.length) { cmd.actions = pendingActions; pendingActions = []; }
        cmds.set(me.id, cmd);
      }
      for (const [id, b] of brains) cmds.set(id, b.think(TICK_DT));
      game.tick(cmds);
      for (const e of game.drainEvents()) handleEvent(e);
      for (let i = timers.length - 1; i >= 0; i--) if (game.time >= timers[i].t) { timers[i].fn(); timers.splice(i, 1); }
      acc -= TICK_DT;
      if (++steps >= 24) { acc = 0; break; } // tab was in background
    }
  }
  updateView(dt, Math.min(1, acc / TICK_DT));
  view.render();
  requestAnimationFrame(frame);
}

$('loading').classList.add('hidden');
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.stickshooter = { game, view, settings, input, hud, music, audio, get me() { return me; }, get net() { return net; } };
