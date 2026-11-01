// DOM HUD, buy menu, scoreboard and settings.
import * as THREE from 'three';
import { WEAPONS, SHOP_ORDER, GEAR } from '../sim/weapons.js';
import { buildGun } from './gunModels.js';
import { DEFAULT_BINDS, BIND_LABELS, keyName } from './input.js';

const $ = (id) => document.getElementById(id);

export const DEFAULT_SETTINGS = {
  name: 'Player',
  sensitivity: 3,
  fov: 74,
  volume: 0.6,
  music: 0.5,
  musicMuted: false,
  // Crosshair, CS 1.6 style. Lengths are in screen pixels.
  chSize: 8,
  chGap: 3,
  chThick: 2,
  chDot: false,
  chOutline: true,
  chDynamic: true,
  antialias: true,
  showFps: true,
  bots: 0,
  difficulty: 'normal',
  // Fullscreen during matches, which also lets the game take Ctrl+W, Ctrl+T
  // and the like away from the browser (Keyboard Lock, Chrome and Edge).
  fullscreen: true,
  touchSens: 1, // look speed for touch controls
  mode: 'ffa', // 'ffa' or 'teams', for practice and online
  map: 'yard', // see src/maps/index.js
  version: 5,
};

// Sensitivity uses CS units (0.022 degrees per mouse count per point).
export const SENS_RANGE = [0.5, 10];
// The camera's vertical FOV is 60..80; the slider shows it as 90..110.
export const FOV_RANGE = [60, 80];
export const FOV_SHOWN_OFFSET = 30;

const KEY = 'stickshooter.settings.v1';
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v2 made 0 bots the default; older saves always stored 5.
    if ((saved.version ?? 1) < 2) delete saved.bots;
    // v3 narrowed the sensitivity range and dropped render scale and invert mouse.
    // v4 made the default sensitivity higher (1.5 -> 3).
    if ((saved.version ?? 1) < 4) delete saved.sensitivity;
    // Screen shake (always 100% now) and HUD size are no longer settings.
    delete saved.viewKick;
    delete saved.hudScale;
    delete saved.renderScale;
    delete saved.invertY;
    const s = { ...DEFAULT_SETTINGS, ...saved, version: DEFAULT_SETTINGS.version };
    s.sensitivity = clamp(+s.sensitivity || DEFAULT_SETTINGS.sensitivity, ...SENS_RANGE);
    s.fov = clamp(+s.fov || DEFAULT_SETTINGS.fov, ...FOV_RANGE);
    s.touchSens = clamp(+s.touchSens || DEFAULT_SETTINGS.touchSens, 0.3, 3);
    s.binds = { ...DEFAULT_BINDS, ...(saved.binds ?? {}) };
    delete s.binds.thirdPerson; // third person was removed
    s.bots = clamp(Math.round(+s.bots) || 0, 0, 32);
    if (s.mode !== 'teams') s.mode = 'ffa';
    if (typeof s.map !== 'string') s.map = DEFAULT_SETTINGS.map; // unknown ids fall back in getMap
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS, binds: { ...DEFAULT_BINDS } };
  }
}

// Size the four crosshair lines (and the dot) from the settings. extra is the
// spread gap in pixels added by movement and recoil.
export function styleCrosshair(root, s, extra = 0) {
  const len = s.chSize, th = s.chThick;
  const gap = Math.round(s.chGap + (s.chDynamic ? extra : 0));
  const half = Math.floor(th / 2);
  const q = (c) => root.querySelector(c).style;
  const t = q('.t'), b = q('.b'), l = q('.l'), r = q('.r'), d = q('.dot');
  t.width = b.width = `${th}px`; t.height = b.height = `${len}px`;
  t.left = b.left = `${-half}px`;
  t.top = `${-gap - len}px`; b.top = `${gap + (th % 2)}px`;
  l.height = r.height = `${th}px`; l.width = r.width = `${len}px`;
  l.top = r.top = `${-half}px`;
  l.left = `${-gap - len}px`; r.left = `${gap + (th % 2)}px`;
  d.display = s.chDot ? '' : 'none';
  d.width = d.height = `${th}px`; d.left = d.top = `${-half}px`;
  root.classList.toggle('no-outline', !s.chOutline);
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

// Snapshot each gun model into a PNG for the shop, plus a flat white
// silhouette of it for the kill feed.
export function renderGunIcons(renderer) {
  const icons = {};
  const glyphs = {};
  const W = 256, H = 128;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.3, 1, 1);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 10);
  cam.position.set(2, 0, 0);
  cam.lookAt(0, 0, 0);
  const pixels = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const id of [...SHOP_ORDER, 'knife']) {
    const gun = buildGun(id);
    const box = new THREE.Box3().setFromObject(gun.group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    gun.group.position.sub(center);
    const half = Math.max(size.z / 2 / 0.92, size.y / 0.92);
    cam.left = -half; cam.right = half; cam.top = half / 2; cam.bottom = -half / 2;
    cam.updateProjectionMatrix();
    scene.add(gun.group);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
    scene.remove(gun.group);
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    icons[id] = canvas.toDataURL();
    glyphs[id] = silhouette(canvas, img.data, W, H);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  return { icons, glyphs };
}

// Crop to the gun and fill it white. Drawn 44px tall for 22px on screen.
function silhouette(src, data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return '';
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.height = 44;
  out.width = Math.max(1, Math.round((cw / chh) * 44));
  const g = out.getContext('2d');
  g.drawImage(src, x0, y0, cw, chh, 0, 0, out.width, out.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, out.width, out.height);
  return out.toDataURL();
}

// The HUD is laid out for a 1920x1080 screen. Scale it to the window, and on
// screens wider than 16:9 keep it inside a centered 16:9 area so the corners
// stay in view. The buy menu is scaled to fit the same way.
// The HUD is drawn a bit larger than a plain fit (this used to be the HUD size
// setting's default).
const HUD_SCALE = 1.3;
function fitUi() {
  const w = innerWidth, h = innerHeight;
  const fw = Math.min(w, h * (16 / 9));
  const scale = clamp(Math.min(fw / 1920, h / 1080), 0.5, 2) * HUD_SCALE;
  const frame = $('hud-frame');
  frame.style.width = `${fw / scale}px`;
  frame.style.height = `${h / scale}px`;
  frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
  const buy = Math.min((w * 0.96) / 940, (h * 0.96) / 690, Math.max(1, scale * 1.1));
  document.documentElement.style.setProperty('--buy-scale', String(buy));
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.crosshair = $('crosshair');
    this.chSettings = null;
    this.hitmarker = $('hitmarker');
    this.hitTime = 0;
    this.vignette = $('vignette');
    this.vigTime = 0;
    this.killfeed = $('killfeed');
    this.center = $('center-msg');
    this.scope = $('scope');
    this.indicators = $('dmg-indicators');
    this.scoreboard = $('scoreboard');
    this.fps = $('fps');
    this.net = $('net');
    this.roomInfo = $('room-info');
    this.glyphs = {};
    this.last = {};
    this.fpsAcc = 0; this.fpsFrames = 0;
    setTimeout(() => { $('hint').style.opacity = '0'; }, 12000);
    fitUi();
    addEventListener('resize', fitUi);
  }

  // Shown under the FPS counter while online.
  ping(ms) {
    const v = ms === null ? null : Math.round(ms);
    if (this.last.ping === v) return;
    this.last.ping = v;
    this.net.classList.toggle('hidden', v === null);
    if (v === null) return;
    this.net.textContent = `${v} ms PING`;
    this.net.className = v < 70 ? 'good' : v < 140 ? 'ok' : 'bad';
  }

  // Mode and head count of the online room, above the ping.
  room(mode, players = 0) {
    const text = mode ? `${mode === 'teams' ? 'TEAMS' : 'FFA'} · ${players} ONLINE` : '';
    if (this.last.room === text) return;
    this.last.room = text;
    this.roomInfo.textContent = text;
    this.roomInfo.classList.toggle('hidden', !text);
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    $(id).textContent = value;
  }

  update(dt, { p, def, w, spreadPx, reloadFrac, showFps, scoped, chOffset }) {
    // FPS counter (twice a second).
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps.textContent = showFps ? `${Math.round(this.fpsFrames / this.fpsAcc)} FPS` : '';
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
    if (!p) return;
    this.set('health', String(p.health));
    this.set('armor', String(Math.round(p.armor)));
    this.set('money', String(p.money));
    this.set('score-me', String(p.kills));
    this.set('score-deaths', String(p.deaths));
    this.set('score-hs', `${p.kills ? Math.round((p.headshots / p.kills) * 100) : 0}%`);
    $('helmet').style.display = p.helmet ? '' : 'none';
    $('health').parentElement.classList.toggle('low', p.health <= 25);
    if (def && w) {
      this.set('weapon-name', def.name);
      this.set('clip', String(w.clip));
      this.set('reserve', String(w.reserve));
      $('clip').classList.toggle('low', w.clip <= Math.ceil(def.clip * 0.2));
      $('clip').parentElement.classList.toggle('hidden', !!def.melee);
    }
    const rb = $('reload-bar');
    rb.style.opacity = reloadFrac !== null ? '1' : '0';
    if (reloadFrac !== null) rb.firstElementChild.style.width = `${Math.round(reloadFrac * 100)}%`;

    // Dynamic crosshair (only restyled when the gap changes).
    const cs = this.chSettings;
    if (cs) {
      const key = `${cs.chSize},${cs.chGap},${cs.chThick},${cs.chDot},${cs.chOutline},${cs.chDynamic},${cs.chDynamic ? Math.round(spreadPx) : 0}`;
      if (this.last.ch !== key) { this.last.ch = key; styleCrosshair(this.crosshair, cs, spreadPx); }
    }
    this.crosshair.style.display = scoped || !p.alive || def?.zoomLevels ? 'none' : '';
    // Recoil the camera doesn't show moves the crosshair instead.
    const ox = Math.round(chOffset?.[0] ?? 0), oy = Math.round(chOffset?.[1] ?? 0);
    const chKey = `${ox},${oy}`;
    if (this.last.chOff !== chKey) {
      this.last.chOff = chKey;
      this.crosshair.style.transform = ox || oy ? `translate(${ox}px, ${oy}px)` : '';
    }
    this.scope.classList.toggle('hidden', !scoped);

    if (this.hitTime > 0) {
      this.hitTime -= dt;
      this.hitmarker.style.opacity = String(Math.max(0, this.hitTime / 0.25));
    }
    if (this.vigTime > 0) {
      this.vigTime -= dt;
      if (this.vigTime <= 0) this.vignette.style.opacity = '0';
    }
  }

  hit(kill, head) {
    this.hitTime = kill ? 0.45 : 0.25;
    this.hitmarker.className = kill ? 'kill' : head ? 'head' : '';
    this.hitmarker.style.opacity = '1';
  }

  hurt(angleRad, damage) {
    this.vignette.style.opacity = String(Math.min(0.9, 0.3 + damage / 80));
    this.vigTime = 0.25;
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${angleRad}rad)`;
    this.indicators.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 1100);
  }

  kill({ attacker, victim, weapon, headshot, wallbang, mine, cause }) {
    const row = document.createElement('div');
    row.className = 'kf' + (mine ? ' me' : '');
    const a = attacker ? `<span class="team-${attacker.team}">${esc(attacker.name)}</span>` : '';
    const name = weapon ? WEAPONS[weapon].name : 'Fall';
    const icon = cause === 'bomb' ? BOMB_ICON : weapon && this.glyphs[weapon]
      ? `<img class="w" src="${this.glyphs[weapon]}" alt="${esc(name)}" title="${esc(name)}">`
      : weapon ? `<span class="w-txt">${esc(name)}</span>` : FALL_ICON;
    row.innerHTML = `${a}${icon}${wallbang ? WALL_ICON : ''}${headshot ? HEAD_ICON : ''}<span class="team-${victim.team}">${esc(victim.name)}</span>`;
    this.killfeed.appendChild(row);
    while (this.killfeed.children.length > 5) this.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  // "+$750" next to the money after a kill.
  moneyPop(amount) {
    const el = $('money-pop');
    el.textContent = `+$${amount}`;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  // DOUBLE KILL, TRIPLE KILL... in the middle of the screen.
  multiKill(text, level) {
    const el = $('multikill');
    el.textContent = text;
    el.className = '';
    void el.offsetWidth;
    el.className = `show m${Math.min(6, level)}`;
  }

  message(html) {
    if (this.last.center === html) return;
    this.last.center = html;
    this.center.innerHTML = html;
  }

  // Text under the top bar: what wins the match.
  goal(text) {
    if (this.last.goal === text) return;
    this.last.goal = text;
    $('goal').textContent = text;
  }

  // Round clock under the team scores (objective rounds). cls: '', 'low' or 'bomb'.
  roundTimer(text, cls = '') {
    const key = text + '|' + cls;
    if (this.last.timer === key) return;
    this.last.timer = key;
    const el = $('round-timer');
    el.textContent = text;
    el.className = text ? cls : 'hidden';
  }

  // Planting / defusing progress bar. frac null hides it.
  task(frac, label = '') {
    const el = $('task-bar');
    const on = frac !== null;
    if (this.last.task !== on) { this.last.task = on; el.classList.toggle('hidden', !on); }
    if (!on) return;
    if (this.last.taskLabel !== label) { this.last.taskLabel = label; $('task-label').textContent = label; }
    el.querySelector('i').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }

  // "BOMB" badge above the money while you carry it.
  bombTag(on) {
    if (this.last.bombTag === on) return;
    this.last.bombTag = on;
    $('bomb-tag').classList.toggle('hidden', !on);
  }

  // "G  Pick up AK47" when a gun is in reach.
  prompt(html) {
    if (this.last.prompt === html) return;
    this.last.prompt = html;
    const el = $('prompt');
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
  }

  // Team scores (kills) under the top bar in Teams.
  teamScores(kills, myTeam) {
    const el = $('team-score');
    const teams = myTeam === 'red' || myTeam === 'blue';
    const key = teams ? `${myTeam}:${kills.red}:${kills.blue}` : '';
    if (this.last.teams === key) return;
    this.last.teams = key;
    el.classList.toggle('hidden', !teams);
    if (!teams) return;
    const [, red, blue] = key.split(':');
    el.innerHTML = `<span class="ts red">${red}</span><span class="ts-you team-${myTeam}">${myTeam === 'red' ? 'RED' : 'BLUE'}</span><span class="ts blue">${blue}</span>`;
  }

  // Teams sit side by side; a big FFA splits its ranking into two columns.
  // Rows get denser as columns get longer, and if the board still doesn't fit
  // (huge rooms on short screens) it is scaled down to fit the HUD frame.
  showScores(show, players, meId, mode = 'ffa', kills = { red: 0, blue: 0 }, title = '') {
    const sb = this.scoreboard;
    sb.classList.toggle('hidden', !show);
    if (!show) return;
    const rank = (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name);
    const rows = (list, from = 0) => list.map((p, i) => {
      const hs = p.kills ? Math.round((p.headshots / p.kills) * 100) : 0;
      const cls = `${p.id === meId ? 'me' : ''} ${p.alive ? '' : 'dead'}`;
      return `<tr class="${cls}"><td class="rk">${from + i + 1}</td><td class="nm"><span>${esc(p.name)}</span>${p.isBot ? '<small>BOT</small>' : ''}</td><td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td class="num hs">${hs}%</td></tr>`;
    }).join('');
    const table = (list, from) => `<table><colgroup><col class="c-rk"><col><col class="c-n"><col class="c-n"><col class="c-hs"></colgroup><tr><th class="rk">#</th><th>PLAYER</th><th class="num">K</th><th class="num">D</th><th class="num hs">HS</th></tr>${rows(list, from)}</table>`;
    const teams = mode === 'teams';
    const head = title
      ? `<div class="sb-head">${title}</div>`
      : `<div class="sb-bar"><span>${teams ? 'TEAMS' : 'FREE FOR ALL'}</span><span>${players.length} PLAYER${players.length === 1 ? '' : 'S'}</span></div>`;
    let cols, longest;
    if (teams) {
      const lists = ['red', 'blue'].map((t) => players.filter((p) => p.team === t).sort(rank));
      longest = Math.max(...lists.map((l) => l.length));
      cols = ['red', 'blue'].map((t, i) => {
        const alive = lists[i].filter((p) => p.alive).length;
        return `<div class="sb-col sb-team ${t}"><div class="sb-title"><span>${t === 'red' ? 'RED' : 'BLUE'}<small>${alive}/${lists[i].length} ALIVE</small></span><b>${kills[t]}</b></div>${table(lists[i], 0)}</div>`;
      });
    } else {
      const list = [...players].sort(rank);
      const split = list.length > 12;
      const half = Math.ceil(list.length / 2);
      longest = split ? half : list.length;
      cols = split
        ? [list.slice(0, half), list.slice(half)].map((l, i) => `<div class="sb-col">${table(l, i * half)}</div>`)
        : [`<div class="sb-col">${table(list, 0)}</div>`];
    }
    const density = longest > 16 ? 'tight' : longest > 10 ? 'compact' : '';
    sb.className = `panel ${cols.length > 1 ? 'wide' : ''} ${density}`;
    sb.style.setProperty('--sb-fit', '1');
    sb.innerHTML = `${head}<div class="sb-cols">${cols.join('')}</div>`;
    const room = (sb.parentElement?.clientHeight || 0) - 24;
    if (room > 0 && sb.offsetHeight > room) sb.style.setProperty('--sb-fit', String(room / sb.offsetHeight));
  }
}

// Kill feed marks, drawn as tiny SVGs in the same flat white as the gun glyphs.
const HEAD_ICON = '<svg class="kf-ic hs" viewBox="0 0 24 24" aria-label="Headshot"><circle cx="12" cy="10" r="7"/><path d="M8 17h8v4H8z"/><circle cx="9.3" cy="10" r="1.8" class="cut"/><circle cx="14.7" cy="10" r="1.8" class="cut"/></svg>';
const WALL_ICON = '<svg class="kf-ic" viewBox="0 0 24 24" aria-label="Through a wall"><path d="M3 4h7v4H3zM12 4h9v4h-9zM3 10h4v4H3zM9 10h7v4H9zM18 10h3v4h-3zM3 16h7v4H3zM12 16h9v4h-9z"/><path d="M0 12h24" class="shot"/></svg>';
const BOMB_ICON = '<svg class="kf-ic bomb" viewBox="0 0 24 24" aria-label="Bomb"><path d="M12 2l2.2 5.3L20 6l-3 5 5 2-5.5 2.2L18 21l-6-3.5L6 21l1.5-5.8L2 13l5-2-3-5 5.8 1.3z"/></svg>';
const FALL_ICON = '<svg class="kf-ic" viewBox="0 0 24 24" aria-label="Fell"><path d="M12 3v13M6 11l6 6 6-6M4 21h16"/></svg>';

// CS 1.6 style buy menu: number keys pick a category, then a weapon.
// B 4 3 buys an M4A1, the same muscle memory as CS.
const BUY_PAGES = [
  { label: 'Handguns', title: 'Buy Handguns (Secondary Weapon)', cats: ['Pistols'] },
  { label: 'Shotguns', title: 'Buy Shotguns (Primary Weapon)', cats: ['Shotguns'] },
  { label: 'Sub-Machine Guns', title: 'Buy Sub-Machine Guns (Primary Weapon)', cats: ['SMGs'] },
  { label: 'Rifles', title: 'Buy Rifles (Primary Weapon)', cats: ['Rifles', 'Snipers'] },
  { label: 'Machine Guns', title: 'Buy Machine Guns (Primary Weapon)', cats: ['Heavy'] },
  { label: 'Equipment', title: 'Buy Equipment', gear: true },
].map((pg) => ({
  ...pg,
  items: pg.gear ? Object.keys(GEAR) : SHOP_ORDER.filter((id) => pg.cats.includes(WEAPONS[id].category)).sort((a, b) => WEAPONS[a].price - WEAPONS[b].price),
}));

const PEN_NAMES = ['None', 'Light', 'Medium', 'Heavy'];

export class BuyMenu {
  constructor(icons, onBuy) {
    this.el = $('buymenu');
    this.list = $('buy-list');
    this.info = $('buy-info');
    this.icons = icons;
    this.onBuy = onBuy;
    this.open = false;
    this.page = null; // index into BUY_PAGES, or null for the category list
    this.sel = 0;
    this.p = null;
    this.list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      // Stop here: key() rebuilds the rows, so the detached target would look
      // like a click outside the card to the handler below.
      e.stopPropagation();
      if (b) this.key(+b.dataset.n);
    });
    // A click anywhere outside the menu closes it.
    this.el.addEventListener('click', (e) => {
      if (this.open && !e.target.closest('.buy-card')) this.onClose?.();
    });
    this.list.addEventListener('pointerover', (e) => {
      const b = e.target.closest('button[data-n]');
      const n = b ? +b.dataset.n : 0;
      if (n > 0 && n - 1 !== this.sel) { this.sel = n - 1; this.render(this.p, false); }
    });
  }

  // A number key (0-9) or 'back'. Returns true if the key was used.
  key(n) {
    if (n === 'back') {
      if (this.page === null) this.onClose?.();
      else { this.sel = this.page; this.page = null; this.render(this.p); }
      return true;
    }
    if (n === 0) { this.onClose?.(); return true; }
    if (this.page === null) {
      if (n > BUY_PAGES.length) return false;
      this.page = n - 1;
      this.sel = 0;
      this.render(this.p);
      return true;
    }
    const id = BUY_PAGES[this.page].items[n - 1];
    if (!id) return false;
    const state = this.itemState(id);
    if (state.cant) {
      // Not enough money: flash the row instead of closing.
      const row = this.list.querySelector(`[data-n="${n}"]`);
      row?.classList.remove('deny');
      void row?.offsetWidth;
      row?.classList.add('deny');
      this.sel = n - 1;
      this.render(this.p, false);
      return true;
    }
    this.onBuy(id);
    this.onClose?.();
    return true;
  }

  itemState(id) {
    const p = this.p;
    if (id === 'defuser') {
      const owned = !!p.defuser;
      return { owned, price: GEAR.defuser.price, cant: !owned && (!this.kitAllowed || p.money < GEAR.defuser.price) };
    }
    if (GEAR[id]) {
      const owned = id === 'kevlar' ? p.armor >= 100 : p.armor >= 100 && p.helmet;
      const price = id === 'kevlarHelmet' && p.armor >= 100 && !p.helmet ? 350 : GEAR[id].price;
      return { owned, price, cant: !owned && p.money < price };
    }
    const w = WEAPONS[id];
    const owned = p.weapons[w.slot]?.id === id;
    return { owned, price: w.price, cant: !owned && p.money < w.price };
  }

  render(p, rebuildList = true) {
    this.p = p;
    if (!p) return;
    $('buy-money').textContent = p.money;
    const pg = this.page === null ? null : BUY_PAGES[this.page];
    $('buy-title').textContent = pg ? pg.title : 'Buy Menu';
    let rows = '';
    if (!pg) {
      BUY_PAGES.forEach((c, i) => {
        rows += `<button class="buy-row ${i === this.sel ? 'sel' : ''}" data-n="${i + 1}"><b>${i + 1}</b> ${c.label}</button>`;
      });
    } else {
      pg.items.forEach((id, i) => {
        const st = this.itemState(id);
        const name = (WEAPONS[id] ?? GEAR[id]).name;
        rows += `<button class="buy-row ${i === this.sel ? 'sel' : ''} ${st.cant ? 'cant' : ''} ${st.owned ? 'owned' : ''}" data-n="${i + 1}"><b>${i + 1}</b> ${name}<span class="pr">${st.owned ? 'OWNED' : `$${st.price}`}</span></button>`;
      });
    }
    if (rebuildList) {
      this.list.innerHTML = `<div class="buy-rows">${rows}</div><button class="buy-row cancel" data-n="0"><b>0</b> Cancel</button>`;
    } else {
      this.list.querySelectorAll('.buy-row[data-n]').forEach((b) => b.classList.toggle('sel', +b.dataset.n === this.sel + 1));
    }
    this.info.innerHTML = pg ? this.itemInfo(pg.items[this.sel]) : this.pageInfo(BUY_PAGES[this.sel]);
  }

  pageInfo(c) {
    const rows = c.items.map((id) => {
      const it = WEAPONS[id] ?? GEAR[id];
      return `<div class="kv"><span>${it.name}</span><span>$${it.price}</span></div>`;
    }).join('');
    const pic = c.gear ? '' : `<div class="buy-pic"><img src="${this.icons[c.items[c.items.length - 1]]}" alt=""></div>`;
    return `${pic}<div class="buy-stats">${rows}</div><p class="buy-tip">Press a number to open a category. Backspace goes back, 0 or B closes.</p>`;
  }

  itemInfo(id) {
    if (id === 'defuser') {
      const kv = [
        ['Price', `$${GEAR.defuser.price}`],
        ['Defuse time', '5 seconds instead of 10'],
        ['Who', 'Blue team, bomb defusal rounds'],
      ];
      return `<div class="buy-pic gear">${KIT_ART}</div>${statsHtml(kv)}`;
    }
    if (GEAR[id]) {
      const st = this.itemState(id);
      const kv = [
        ['Price', `$${st.price}`],
        ['Armor', '100 points'],
        ['Protects', id === 'kevlar' ? 'Chest, stomach and arms' : 'Chest, stomach, arms and head'],
        ['Damage absorbed', 'About half of each hit, more vs. weak guns'],
      ];
      if (id === 'kevlarHelmet' && st.price === 350) kv.push(['Note', 'You have a vest, so this is the helmet only']);
      return `<div class="buy-pic gear">${id === 'kevlar' ? VEST_ART : VEST_ART + HELMET_ART}</div>${statsHtml(kv)}`;
    }
    const w = WEAPONS[id];
    const st = this.itemState(id);
    const mode = w.accuracy.type === 'sniper' ? 'Bolt action' : w.pellets ? (w.cycle > 0.5 ? 'Pump action' : 'Semi-automatic') : w.auto ? 'Automatic' : 'Semi-automatic';
    const kv = [
      ['Price', `$${w.price}${st.owned ? ' (owned, buy again to refill ammo)' : ''}`],
      ['Slot', w.slot === 'primary' ? 'Primary' : 'Secondary'],
      ['Damage', w.pellets ? `${w.pellets} pellets × ${w.damage}` : `${w.damage} per bullet`],
      ['Armor Penetration', `${Math.round(Math.min(1, w.armorRatio * 0.5) * 100)}%`],
      ['Clip Capacity', `${w.clip} / ${w.reserve} rounds`],
      ['Rate of Fire', `${Math.round(60 / w.cycle)} RPM`],
      ['Fire Mode', mode],
      ['Wall Penetration', PEN_NAMES[w.penetration] ?? 'Heavy'],
      ['Move Speed', `${Math.round((w.speed / 250) * 100)}%`],
    ];
    return `<div class="buy-pic"><img src="${this.icons[id]}" alt=""></div>${statsHtml(kv)}`;
  }

  show(v, p) {
    this.open = v;
    this.el.classList.toggle('hidden', !v);
    if (v) { this.page = null; this.sel = 0; this.render(p); }
  }
}

const KIT_ART = '<svg viewBox="0 0 64 64"><path d="M14 18h36v30H14z"/><path d="M22 10h20v8H22z" opacity=".7"/><path d="M24 26h16v4H24zM24 34h10v4H24z" fill="#1b1f27"/></svg>';
const VEST_ART = '<svg viewBox="0 0 64 64"><path d="M20 8h8l4 6 4-6h8l8 10-6 6v32H18V24l-6-6z"/></svg>';
const HELMET_ART = '<svg viewBox="0 0 64 64"><path d="M10 40c0-14 10-24 22-24s22 10 22 24v4H10z"/><path d="M6 44h52v6H6z"/></svg>';

function statsHtml(kv) {
  return `<div class="buy-stats">${kv.map(([k, v]) => `<div class="kv"><span>${k}</span><span>: ${v}</span></div>`).join('')}</div>`;
}

export class SettingsPanel {
  constructor(settings, onChange) {
    this.s = settings;
    this.onChange = onChange;
    this.form = $('settings-form');
    this.capturing = null; // bind action waiting for a key
    // [key, label, type, min, max, step, shown offset]
    const tabs = {
      general: [
        ['name', 'Name', 'text'],
        ['sensitivity', 'Sensitivity', 'range', ...SENS_RANGE, 0.05],
        ['fov', 'Field of view', 'range', ...FOV_RANGE, 1, FOV_SHOWN_OFFSET],
        ['volume', 'Volume', 'range', 0, 1, 0.05],
        ['music', 'Menu music', 'range', 0, 1, 0.05],
        ['touchSens', 'Touch look speed', 'range', 0.3, 3, 0.05],
        ['fullscreen', 'Fullscreen in matches (blocks Ctrl+W)', 'check'],
        ['showFps', 'Show FPS', 'check'],
        ['antialias', 'Anti-aliasing (reload)', 'check'],
      ],
      crosshair: [
        ['chSize', 'Length', 'range', 1, 20, 1],
        ['chGap', 'Gap', 'range', 0, 16, 1],
        ['chThick', 'Thickness', 'range', 1, 6, 1],
        ['chDot', 'Center dot', 'check'],
        ['chOutline', 'Outline', 'check'],
        ['chDynamic', 'Dynamic', 'check'],
      ],
    };
    const row = ([key, label, type, min, max, step, off = 0]) => {
      if (type === 'range') return `<div class="set-row"><span>${label}</span><input type="range" data-k="${key}" data-off="${off}" min="${min + off}" max="${max + off}" step="${step}" value="${settings[key] + off}"><output>${fmt(settings[key] + off)}</output></div>`;
      if (type === 'check') return `<div class="set-row"><span>${label}</span><input type="checkbox" data-k="${key}" ${settings[key] ? 'checked' : ''}><span></span></div>`;
      return `<div class="set-row"><span>${label}</span><input type="text" maxlength="16" data-k="${key}" value="${esc(settings[key])}"></div>`;
    };
    this.form.innerHTML = `
      <div class="set-tabs">
        <button data-tab="general" class="on">GENERAL</button><button data-tab="crosshair">CROSSHAIR</button><button data-tab="controls">CONTROLS</button>
      </div>
      <div class="set-page" data-page="general">${tabs.general.map(row).join('')}</div>
      <div class="set-page hidden" data-page="crosshair">
        <div class="ch-preview"><div class="ch-root"><i class="ch t"></i><i class="ch b"></i><i class="ch l"></i><i class="ch r"></i><i class="ch dot"></i></div></div>
        ${tabs.crosshair.map(row).join('')}
        <button class="btn small" data-reset="crosshair">RESET CROSSHAIR</button>
      </div>
      <div class="set-page hidden" data-page="controls">
        <div class="binds">${Object.entries(BIND_LABELS).map(([a, label]) => `<div class="bind-row"><span>${label}</span><button class="bind" data-bind="${a}"></button></div>`).join('')}</div>
        <p class="set-note">Click a key, then press the new one. Esc cancels. Mouse 1 fires and Mouse 2 scopes.</p>
        <button class="btn small" data-reset="binds">RESET KEYS</button>
      </div>`;
    this.preview = this.form.querySelector('.ch-root');

    for (const b of this.form.querySelectorAll('.set-tabs button')) {
      b.addEventListener('click', () => this.tab(b.dataset.tab));
    }
    for (const inp of this.form.querySelectorAll('input')) {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        if (inp.type === 'checkbox') settings[k] = inp.checked;
        else if (inp.type === 'range') {
          const shown = parseFloat(inp.value);
          settings[k] = shown - +inp.dataset.off;
          inp.nextElementSibling.textContent = fmt(shown);
        } else settings[k] = inp.value.trim() || 'Player';
        this.changed(k);
      });
    }
    for (const b of this.form.querySelectorAll('.bind')) {
      b.addEventListener('click', () => this.capture(b.dataset.bind));
    }
    this.form.querySelector('[data-reset="binds"]').addEventListener('click', () => {
      Object.assign(settings.binds, DEFAULT_BINDS);
      this.changed('binds');
    });
    this.form.querySelector('[data-reset="crosshair"]').addEventListener('click', () => {
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (k.startsWith('ch')) settings[k] = DEFAULT_SETTINGS[k];
      for (const inp of this.form.querySelectorAll('[data-page="crosshair"] input')) {
        const k = inp.dataset.k;
        if (inp.type === 'checkbox') inp.checked = settings[k];
        else { inp.value = settings[k]; inp.nextElementSibling.textContent = fmt(settings[k]); }
      }
      this.changed('crosshair');
    });

    // Capture phase on window so the game's own key handlers never see the
    // key being bound.
    addEventListener('keydown', (e) => {
      if (!this.capturing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code !== 'Escape') this.bind(this.capturing, e.code);
      this.capturing = null;
      this.renderBinds();
    }, true);
    this.renderBinds();
    styleCrosshair(this.preview, settings);
  }

  tab(name) {
    this.capturing = null;
    this.renderBinds();
    for (const b of this.form.querySelectorAll('.set-tabs button')) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of this.form.querySelectorAll('.set-page')) p.classList.toggle('hidden', p.dataset.page !== name);
  }

  capture(action) {
    this.capturing = this.capturing === action ? null : action;
    this.renderBinds();
  }

  // A key can only do one thing: the action that had it takes our old key.
  bind(action, code) {
    const b = this.s.binds;
    const prev = b[action];
    for (const [a, c] of Object.entries(b)) if (a !== action && c === code) b[a] = prev;
    b[action] = code;
    this.changed('binds');
  }

  renderBinds() {
    for (const el of this.form.querySelectorAll('.bind')) {
      const a = el.dataset.bind;
      const waiting = this.capturing === a;
      el.textContent = waiting ? 'Press a key…' : keyName(this.s.binds[a]);
      el.classList.toggle('waiting', waiting);
      el.classList.toggle('changed', this.s.binds[a] !== DEFAULT_BINDS[a]);
    }
  }

  changed(k) {
    saveSettings(this.s);
    if (k === 'binds') this.renderBinds();
    styleCrosshair(this.preview, this.s);
    this.onChange(k);
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
