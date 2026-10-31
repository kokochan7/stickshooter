// Keyboard + mouse input. Produces sim cmds; touch.js feeds the same object
// on phones.
import { emptyCmd } from '../sim/game.js';

const DEG = Math.PI / 180;

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', duck: 'ControlLeft', duckAlt: 'KeyC', walk: 'ShiftLeft',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', melee: 'Digit3', lastWeapon: 'KeyQ',
  drop: 'KeyG', buy: 'KeyB', scores: 'Tab', switchTeam: 'KeyM', use: 'KeyE',
};

// Rebindable actions in the order the Controls tab lists them.
export const BIND_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump', duck: 'Crouch', duckAlt: 'Crouch (alt)', walk: 'Walk',
  reload: 'Reload', primary: 'Primary weapon', secondary: 'Pistol', melee: 'Knife', lastWeapon: 'Last weapon',
  drop: 'Drop / pick up gun', buy: 'Buy menu', scores: 'Scoreboard', switchTeam: 'Switch team',
  use: 'Use (plant, defuse, hostages)',
};

// Short name for a KeyboardEvent.code, for the settings and HUD hints.
export function keyName(code) {
  if (!code) return '—';
  const named = {
    Space: 'Space', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', ShiftLeft: 'Shift', ShiftRight: 'R-Shift',
    AltLeft: 'Alt', AltRight: 'R-Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
    Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter',
  };
  if (named[code]) return named[code];
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

// Keys the browser would act on in the middle of a match.
function blockedShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (/^F([1-9]|10)$/.test(e.code)) return true; // keep F11 (fullscreen) and F12 (dev tools)
  return e.code === 'Backspace' || e.code === 'Quote' || e.code === 'Slash' || e.code === 'Space';
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' && t.type === 'text' || t.tagName === 'TEXTAREA');
}

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
    // Touch controls (touch.js) write here; buildCmd merges it with the keys.
    this.touch = { fwd: 0, side: 0, walk: false, fire: false, jump: false, duck: false, use: false };
    this.inMatch = false; // set by main.js while a match is on screen
    this.menuKeys = false; // number keys go to the buy menu instead of weapon slots
    // While a menu is open we keep pointer lock (re-locking makes the browser
    // show its "press Esc to show your cursor" notice again) and the mouse
    // drives this virtual cursor instead of the aim.
    this.cursor = null; // { x, y } in viewport pixels, or null when off
    this.listeners = {};
    this.binds = settings.binds;

    addEventListener('keydown', (e) => {
      if (e.code === this.binds.scores || e.code === 'Tab' || (e.code === 'Space' && this.locked) || (e.code === 'Backspace' && this.menuKeys)) e.preventDefault();
      // In a match, keep browser shortcuts from firing: Ctrl+S, Ctrl+D, F5,
      // Alt+Left and so on. Crouch is Ctrl, so Ctrl+W/A/S/D happen all the
      // time. Ctrl+W, Ctrl+T and Ctrl+N can't be stopped this way; the
      // Keyboard Lock in fullscreen (main.js) handles those where supported.
      if (this.inMatch && !isTyping(e) && blockedShortcut(e)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = this.binds;
      if (!this.enabled || (this.menuKeys && /^(Digit|Numpad)\d$/.test(e.code))) { this.emit('key', e.code); return; }
      if (e.code === b.reload) this.pending.reload = true;
      if (e.code === b.primary) this.pending.slot = 'primary';
      if (e.code === b.secondary) this.pending.slot = 'secondary';
      if (e.code === b.melee) this.pending.slot = 'melee';
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
      if (this.cursor) {
        if (e.button === 0) this.emit('cursorClick', this.cursor);
        return;
      }
      if (e.button === 0) { this.mouse.left = true; this.pending.fire = true; }
      if (e.button === 2) { this.mouse.right = true; this.pending.alt = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.cursor && this.locked) {
        const c = this.cursor;
        c.x = Math.min(Math.max(c.x + e.movementX, 0), innerWidth - 1);
        c.y = Math.min(Math.max(c.y + e.movementY, 0), innerHeight - 1);
        this.emit('cursor', c);
        return;
      }
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
      if (!this.locked || this.cursor) return;
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

  // Turn the virtual cursor on (starting mid-screen) or off.
  setCursor(on) {
    this.cursor = on ? { x: innerWidth / 2, y: innerHeight / 2 } : null;
    if (on) this.mouse.left = this.mouse.right = false;
    this.emit('cursor', this.cursor);
  }

  async lock() {
    // Already locked: asking again would re-show the browser's notice.
    if (document.pointerLockElement === this.target) return;
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
    const b = this.binds;
    const cmd = emptyCmd();
    if (this.enabled) {
      const t = this.touch;
      cmd.fwd = Math.max(-1, Math.min(1, (this.has(b.forward) ? 1 : 0) - (this.has(b.back) ? 1 : 0) + t.fwd));
      cmd.side = Math.max(-1, Math.min(1, (this.has(b.right) ? 1 : 0) - (this.has(b.left) ? 1 : 0) + t.side));
      // Holding jump keeps bunny hopping.
      cmd.jump = this.has(b.jump) || this.pending.jump || t.jump;
      cmd.duck = this.has(b.duck) || this.has(b.duckAlt) || this.has('ControlRight') || t.duck;
      cmd.walk = this.has(b.walk) || this.has('ShiftRight') || ((t.fwd || t.side) && t.walk);
      // A click shorter than one tick still fires once.
      cmd.fire = this.mouse.left || this.pending.fire || t.fire;
      cmd.alt = this.mouse.right || this.pending.alt;
      cmd.reload = this.pending.reload;
      cmd.slot = this.pending.slot;
      cmd.lastWeapon = this.pending.lastWeapon;
      cmd.use = this.has(b.use) || t.use;
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
