// Touch controls for phones and tablets (iPhone Safari first). They feed the
// same Input object the keyboard and mouse use, so the sim sees ordinary cmds.
//
// Layout (landscape):
//   left half   floating move stick: it appears where your thumb lands
//   right half  drag anywhere to look
//   FIRE        hold to shoot; you can keep dragging on it to aim while firing
//   buttons     jump, crouch, reload, scope/stab, weapon switch, drop, buy,
//               scores and pause
// The stick has no analog speed in the sim, so a short push walks (quiet) and
// a full push runs.

const DEG = Math.PI / 180;
const STICK_RADIUS = 56; // px the stick knob can travel
const WALK_BELOW = 0.55; // push less than this and you walk

export function isTouchDevice() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches);
}

const BUTTONS = [
  // [id, label, action, extra class]
  ['fire', 'FIRE', 'fire', 'big'],
  ['jump', 'JUMP', 'jump', ''],
  ['duck', 'DUCK', 'duck', ''],
  ['reload', 'R', 'reload', ''],
  ['alt', 'SCOPE', 'alt', ''],
  ['swap', '⇄', 'lastWeapon', ''],
  ['knife', 'KNIFE', 'melee', ''],
  ['drop', 'G', 'drop', ''],
  ['use', 'USE', 'use', ''],
  ['buy', 'BUY', 'buy', 'top'],
  ['scores', 'TAB', 'scores', 'top'],
  ['pause', 'II', 'pause', 'top'],
];

export class TouchControls {
  // input: Input; actions: { buy, drop, scores(show), pause, knife, cycle }
  constructor(input, settings, actions) {
    this.input = input;
    this.settings = settings;
    this.actions = actions;
    this.stick = null; // { id, x0, y0, x, y }
    this.looks = new Map(); // touch id -> last { x, y }
    this.held = new Set(); // held button actions
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <div class="t-zone t-move"></div>
      <div class="t-zone t-look"></div>
      <div class="t-stick hidden"><div class="t-knob"></div></div>
      ${BUTTONS.map(([id, label, , cls]) => `<button class="t-btn t-${id} ${cls}" data-a="${id}">${label}</button>`).join('')}
      <div class="t-rotate">Turn your phone sideways to play</div>`;
    document.body.append(this.el);
    this.stickEl = this.el.querySelector('.t-stick');
    this.knob = this.el.querySelector('.t-knob');

    const opts = { passive: false };
    this.el.addEventListener('touchstart', (e) => this.start(e), opts);
    this.el.addEventListener('touchmove', (e) => this.move(e), opts);
    this.el.addEventListener('touchend', (e) => this.end(e), opts);
    this.el.addEventListener('touchcancel', (e) => this.end(e), opts);
    // iOS: no double-tap zoom, no long-press menus, no pinch.
    for (const ev of ['gesturestart', 'gesturechange', 'contextmenu']) this.el.addEventListener(ev, (e) => e.preventDefault());
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  reset() {
    this.stick = null;
    this.looks.clear();
    for (const a of this.held) this.release(a);
    this.held.clear();
    this.stickEl.classList.add('hidden');
    for (const b of this.el.querySelectorAll('.t-btn.on')) b.classList.remove('on');
    const t = this.input.touch;
    t.fwd = 0; t.side = 0; t.walk = false; t.fire = false; t.jump = false; t.duck = false; t.use = false;
    this.el.querySelector('.t-duck').classList.remove('lit');
  }

  start(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const btn = t.target.closest?.('.t-btn');
      if (btn) {
        const id = btn.dataset.a;
        btn.classList.add('on');
        this.press(id);
        // Fire doubles as a look pad so you can aim while shooting.
        if (id === 'fire') this.looks.set(t.identifier, { x: t.clientX, y: t.clientY, btn: id });
        else this.looks.set(t.identifier, { x: t.clientX, y: t.clientY, btn: id, still: true });
        continue;
      }
      if (t.target.classList.contains('t-move') && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.stickEl.classList.remove('hidden');
        this.stickEl.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this.knob.style.transform = 'translate(0px, 0px)';
        continue;
      }
      this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        let dx = t.clientX - this.stick.x0, dy = t.clientY - this.stick.y0;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const m = Math.min(1, len / STICK_RADIUS);
        const it = this.input.touch;
        // Dead zone, then 8-way like WASD (the sim's move input is digital).
        if (m < 0.18) { it.fwd = 0; it.side = 0; }
        else {
          const a = Math.atan2(dx, -dy);
          const sector = Math.round(a / (Math.PI / 4));
          const ang = sector * (Math.PI / 4);
          it.fwd = Math.round(Math.cos(ang));
          it.side = Math.round(Math.sin(ang));
        }
        it.walk = m < WALK_BELOW;
        continue;
      }
      const l = this.looks.get(t.identifier);
      if (!l || l.still) continue;
      this.look(t.clientX - l.x, t.clientY - l.y);
      l.x = t.clientX; l.y = t.clientY;
    }
  }

  end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.stickEl.classList.add('hidden');
        const it = this.input.touch;
        it.fwd = 0; it.side = 0; it.walk = false;
        continue;
      }
      const l = this.looks.get(t.identifier);
      if (l?.btn) {
        this.el.querySelector(`.t-btn[data-a="${l.btn}"]`)?.classList.remove('on');
        this.release(l.btn);
      }
      this.looks.delete(t.identifier);
    }
  }

  // Drag in screen points -> view angles. Scales with the zoom like the mouse.
  look(dx, dy) {
    const inp = this.input;
    if (!inp.enabled) return;
    const k = 0.28 * this.settings.touchSens * inp.sensScale * DEG;
    inp.yaw -= dx * k;
    inp.pitch -= dy * k;
    const lim = 89 * DEG;
    inp.pitch = Math.max(-lim, Math.min(lim, inp.pitch));
    inp.frameDX += dx; inp.frameDY += dy;
  }

  press(id) {
    const inp = this.input, p = inp.pending, t = inp.touch;
    switch (id) {
      case 'fire': t.fire = true; p.fire = true; break;
      case 'use': t.use = true; break;
      case 'alt': p.alt = true; break;
      case 'jump': t.jump = true; p.jump = true; break;
      case 'duck': t.duck = !t.duck; break; // crouch toggles: holding a button and moving is awkward
      case 'reload': p.reload = true; break;
      case 'swap': this.actions.cycle(); break;
      case 'knife': this.actions.knife(); break;
      case 'drop': this.actions.drop(); break;
      case 'buy': this.actions.buy(); break;
      case 'scores': this.actions.scores(true); break;
      case 'pause': this.actions.pause(); break;
    }
    this.held.add(id);
    if (id === 'duck') this.el.querySelector('.t-duck').classList.toggle('lit', t.duck);
  }

  release(id) {
    const t = this.input.touch;
    if (id === 'fire') t.fire = false;
    if (id === 'jump') t.jump = false;
    if (id === 'use') t.use = false;
    if (id === 'scores') this.actions.scores(false);
    this.held.delete(id);
  }
}
