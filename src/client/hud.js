// DOM HUD, buy menu, scoreboard and settings.
import * as THREE from 'three';
import { WEAPONS, SHOP_ORDER, GEAR, weaponRatings } from '../sim/weapons.js';
import { buildGun } from './gunModels.js';

const $ = (id) => document.getElementById(id);

export const DEFAULT_SETTINGS = {
  name: 'Player',
  sensitivity: 2.0,
  fov: 74,
  renderScale: 1,
  volume: 0.6,
  antialias: true,
  showFps: true,
  invertY: false,
  bots: 0,
  difficulty: 'normal',
  version: 2,
};

const KEY = 'stickshooter.settings.v1';
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v2 made 0 bots the default; older saves always stored 5.
    if ((saved.version ?? 1) < 2) delete saved.bots;
    return { ...DEFAULT_SETTINGS, ...saved, version: DEFAULT_SETTINGS.version };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

// Snapshot each gun model into a PNG for the shop.
export function renderGunIcons(renderer) {
  const icons = {};
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
  for (const id of SHOP_ORDER) {
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
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  return icons;
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.crosshair = $('crosshair');
    this.ch = {
      t: this.crosshair.querySelector('.t'), b: this.crosshair.querySelector('.b'),
      l: this.crosshair.querySelector('.l'), r: this.crosshair.querySelector('.r'),
    };
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
    this.last = {};
    this.fpsAcc = 0; this.fpsFrames = 0;
    setTimeout(() => { $('hint').style.opacity = '0'; }, 12000);
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  set(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    $(id).textContent = value;
  }

  update(dt, { p, def, w, spreadPx, reloadFrac, showFps, scoped }) {
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
    $('helmet').style.display = p.helmet ? '' : 'none';
    $('health').parentElement.classList.toggle('low', p.health <= 25);
    if (def && w) {
      this.set('weapon-name', def.name);
      this.set('clip', String(w.clip));
      this.set('reserve', String(w.reserve));
      $('clip').classList.toggle('low', w.clip <= Math.ceil(def.clip * 0.2));
    }
    const rb = $('reload-bar');
    rb.style.opacity = reloadFrac !== null ? '1' : '0';
    if (reloadFrac !== null) rb.firstElementChild.style.width = `${Math.round(reloadFrac * 100)}%`;

    // Dynamic crosshair.
    const gap = Math.round(3 + spreadPx);
    this.ch.t.style.top = `${-gap - 8}px`;
    this.ch.b.style.top = `${gap}px`;
    this.ch.l.style.left = `${-gap - 8}px`;
    this.ch.r.style.left = `${gap}px`;
    this.crosshair.style.display = scoped || !p.alive || def?.zoomLevels ? 'none' : '';
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

  kill({ attacker, victim, weapon, headshot, wallbang, mine }) {
    const row = document.createElement('div');
    row.className = 'kf' + (mine ? ' me' : '');
    const a = attacker ? `<span class="team-${attacker.team}">${esc(attacker.name)}</span>` : '';
    row.innerHTML = `${a}<span class="w">${weapon ? esc(WEAPONS[weapon].name) : 'fell'}</span>${wallbang ? '<span class="hs">⟂ WALL</span>' : ''}${headshot ? '<span class="hs">◉ HS</span>' : ''}<span class="team-${victim.team}">${esc(victim.name)}</span>`;
    this.killfeed.appendChild(row);
    while (this.killfeed.children.length > 5) this.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  message(html) {
    if (this.last.center === html) return;
    this.last.center = html;
    this.center.innerHTML = html;
  }

  showScores(show, players, meId) {
    this.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((p) => {
      const hs = p.kills ? Math.round((p.headshots / p.kills) * 100) : 0;
      return `<tr class="${p.id === meId ? 'me' : ''} ${p.alive ? '' : 'dead'}"><td>${esc(p.name)}${p.isBot ? ' <small style="opacity:.5">BOT</small>' : ''}</td><td class="num">${p.kills}</td><td class="num">${p.deaths}</td><td class="num">${hs}%</td></tr>`;
    }).join('');
    this.scoreboard.innerHTML = `<table><tr><th>PLAYER</th><th class="num">K</th><th class="num">D</th><th class="num">HS</th></tr>${rows}</table>`;
  }
}

export class BuyMenu {
  constructor(icons, onBuy) {
    this.el = $('buymenu');
    this.grid = $('buy-grid');
    this.icons = icons;
    this.onBuy = onBuy;
    this.open = false;
    $('buy-close').addEventListener('click', () => this.onClose?.());
  }

  render(p) {
    const cats = {};
    for (const id of SHOP_ORDER) (cats[WEAPONS[id].category] ??= []).push(id);
    let html = '';
    for (const [cat, ids] of Object.entries(cats)) {
      html += `<div class="buy-section">${cat.toUpperCase()}</div>`;
      for (const id of ids) {
        const w = WEAPONS[id];
        const r = weaponRatings(w);
        const owned = p.weapons[w.slot]?.id === id;
        const cant = !owned && p.money < w.price;
        const bar = (label, v) => `<span>${label}</span><div class="bar"><i style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></i></div>`;
        html += `<button class="item ${owned ? 'owned' : ''} ${cant ? 'cant' : ''}" data-id="${id}">
          <span class="pr">$${w.price}</span>
          <img src="${this.icons[id]}" alt="" />
          <span class="nm">${w.name}</span>
          <span class="meta">${w.pellets ? `${w.pellets}×${w.damage}` : w.damage} dmg · ${w.clip}/${w.reserve} · ${Math.round(60 / w.cycle)} rpm</span>
          <div class="stats">${bar('DAMAGE', r.damage)}${bar('FIRE RATE', r.fireRate)}${bar('ACCURACY', r.accuracy)}${bar('RANGE', r.range)}${bar('MOBILITY', r.mobility)}</div>
        </button>`;
      }
    }
    html += '<div class="buy-section">GEAR</div>';
    for (const [id, g] of Object.entries(GEAR)) {
      const owned = id === 'kevlar' ? p.armor >= 100 : p.armor >= 100 && p.helmet;
      html += `<button class="item ${owned ? 'owned' : ''} ${p.money < g.price ? 'cant' : ''}" data-id="${id}">
        <span class="pr">$${g.price}</span><span class="nm">${g.name}</span>
        <span class="meta">${id === 'kevlar' ? 'Body armor. Cuts most body damage.' : 'Body armor + helmet. Protects against headshots too.'}</span></button>`;
    }
    this.grid.innerHTML = html;
    $('buy-money').textContent = p.money;
    for (const b of this.grid.querySelectorAll('.item')) {
      b.addEventListener('click', () => this.onBuy(b.dataset.id));
    }
  }

  show(v, p) {
    this.open = v;
    this.el.classList.toggle('hidden', !v);
    if (v && p) this.render(p);
  }
}

export class SettingsPanel {
  constructor(settings, onChange) {
    this.s = settings;
    this.onChange = onChange;
    this.form = $('settings-form');
    const rows = [
      ['name', 'Name', 'text'],
      ['sensitivity', 'Sensitivity', 'range', 0.2, 8, 0.05],
      ['fov', 'Field of view', 'range', 60, 100, 1],
      ['renderScale', 'Render scale', 'range', 0.4, 1, 0.05],
      ['volume', 'Volume', 'range', 0, 1, 0.05],
      ['showFps', 'Show FPS', 'check'],
      ['invertY', 'Invert mouse', 'check'],
      ['antialias', 'Anti-aliasing (reload)', 'check'],
    ];
    this.form.innerHTML = rows.map(([key, label, type, min, max, step]) => {
      if (type === 'range') return `<div class="set-row"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><output>${fmt(settings[key])}</output></div>`;
      if (type === 'check') return `<div class="set-row"><span>${label}</span><input type="checkbox" data-k="${key}" ${settings[key] ? 'checked' : ''}><span></span></div>`;
      return `<div class="set-row"><span>${label}</span><input type="text" maxlength="16" data-k="${key}" value="${esc(settings[key])}"></div>`;
    }).join('');
    for (const inp of this.form.querySelectorAll('input')) {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        if (inp.type === 'checkbox') settings[k] = inp.checked;
        else if (inp.type === 'range') { settings[k] = parseFloat(inp.value); inp.nextElementSibling.textContent = fmt(settings[k]); }
        else settings[k] = inp.value.trim() || 'Player';
        saveSettings(settings);
        this.onChange(k);
      });
    }
  }
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
