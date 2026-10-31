// Keyboard + mouse input. Produces sim cmds; a touch input class can produce
// the same shape later for iOS.
import { emptyCmd } from '../sim/game.js';

const DEG = Math.PI / 180;

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', duck: 'ControlLeft', duckAlt: 'KeyC', walk: 'ShiftLeft',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', lastWeapon: 'KeyQ',
  buy: 'KeyB', scores: 'Tab', thirdPerson: 'KeyV',
};

export class Input {
  constructor(target, settings) {
    this.target = target;
    this.settings = settings;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.yaw = 0;
    this.pitch = 0;
    this.frameDX = 0; this.frameDY = 0;
    this.pending = { reload: false, slot: null, lastWeapon: false, jump: false, alt: false, fire: false };
    this.locked = false;
    this.enabled = true;
    this.sensScale = 1;
    this.menuKeys = false; // number keys go to the buy menu instead of weapon slots
    this.listeners = {};

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (e.code === 'Space' && this.locked) || (e.code === 'Backspace' && this.menuKeys)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = DEFAULT_BINDS;
      if (!this.enabled || (this.menuKeys && /^(Digit|Numpad)\d$/.test(e.code))) { this.emit('key', e.code); return; }
      if (e.code === b.reload) this.pending.reload = true;
      if (e.code === b.primary) this.pending.slot = 'primary';
      if (e.code === b.secondary) this.pending.slot = 'secondary';
      if (e.code === b.lastWeapon) this.pending.lastWeapon = true;
      if (e.code === b.jump) this.pending.jump = true;
      this.emit('key', e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.emit('keyup', e.code);
    });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.pending.fire = true; }
      if (e.button === 2) { this.mouse.right = true; this.pending.alt = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.frameDX += e.movementX;
      this.frameDY += e.movementY;
      // CS-style: degrees per count = 0.022 * sensitivity.
      const k = 0.022 * this.settings.sensitivity * this.sensScale * DEG;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k;
      const lim = 89 * DEG;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    });
    target.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.pending.lastWeapon = true;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
      this.emit('lock', this.locked);
    });
  }

  on(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, v) { for (const fn of this.listeners[name] ?? []) fn(v); }

  async lock() {
    try {
      await this.target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { await this.target.requestPointerLock(); } catch { /* user must click again */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setAngles(yaw, pitch) {
    this.yaw = yaw; this.pitch = pitch;
  }

  // Mouse movement since the last frame (for viewmodel sway).
  takeFrameDelta() {
    const d = [this.frameDX, this.frameDY];
    this.frameDX = 0; this.frameDY = 0;
    return d;
  }

  has(code) { return this.keys.has(code); }

  buildCmd() {
    const b = DEFAULT_BINDS;
    const cmd = emptyCmd();
    if (this.enabled) {
      cmd.fwd = (this.has(b.forward) ? 1 : 0) - (this.has(b.back) ? 1 : 0);
      cmd.side = (this.has(b.right) ? 1 : 0) - (this.has(b.left) ? 1 : 0);
      cmd.jump = this.has(b.jump) || this.pending.jump;
      cmd.duck = this.has(b.duck) || this.has(b.duckAlt) || this.has('ControlRight');
      cmd.walk = this.has(b.walk) || this.has('ShiftRight');
      // A click shorter than one tick still fires once.
      cmd.fire = this.mouse.left || this.pending.fire;
      cmd.alt = this.mouse.right || this.pending.alt;
      cmd.reload = this.pending.reload;
      cmd.slot = this.pending.slot;
      cmd.lastWeapon = this.pending.lastWeapon;
    }
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    this.pending.reload = false;
    this.pending.slot = null;
    this.pending.lastWeapon = false;
    this.pending.jump = false;
    this.pending.fire = false;
    this.pending.alt = false;
    return cmd;
  }
}
