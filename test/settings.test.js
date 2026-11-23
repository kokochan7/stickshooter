import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const { loadSettings, DEFAULT_SETTINGS } = await import('../src/client/hud.js');
const KEY = 'stickshooter.settings.v1';

test('fullscreen in matches is off by default', () => {
  store.clear();
  assert.equal(DEFAULT_SETTINGS.fullscreen, false);
  assert.equal(loadSettings().fullscreen, false);
});

test('an old save holding the old default (on) is reset to off', () => {
  store.set(KEY, JSON.stringify({ version: 5, fullscreen: true, fov: 70 }));
  const s = loadSettings();
  assert.equal(s.fullscreen, false);
  assert.equal(s.fov, 70);
});

test('an old save with fullscreen turned off stays off', () => {
  store.set(KEY, JSON.stringify({ version: 5, fullscreen: false }));
  assert.equal(loadSettings().fullscreen, false);
});

test('fullscreen turned on after this change is kept', () => {
  store.set(KEY, JSON.stringify({ version: 6, fullscreen: true }));
  assert.equal(loadSettings().fullscreen, true);
});

test('Shift crouches and C walks by default, with no second crouch key', async () => {
  const { DEFAULT_BINDS, BIND_LABELS } = await import('../src/client/input.js');
  assert.equal(DEFAULT_BINDS.duck, 'ShiftLeft');
  assert.equal(DEFAULT_BINDS.walk, 'KeyC');
  assert.equal('duckAlt' in DEFAULT_BINDS, false);
  assert.equal('duckAlt' in BIND_LABELS, false);
});

test('a save on the old crouch/walk defaults moves to Shift/C', () => {
  store.set(KEY, JSON.stringify({ version: 6, binds: { duck: 'ControlLeft', duckAlt: 'KeyC', walk: 'ShiftLeft', jump: 'KeyF' } }));
  const b = loadSettings().binds;
  assert.equal(b.duck, 'ShiftLeft');
  assert.equal(b.walk, 'KeyC');
  assert.equal(b.jump, 'KeyF');
  assert.equal('duckAlt' in b, false);
});

test('custom crouch/walk keys are kept, and a moved key never doubles up', () => {
  store.set(KEY, JSON.stringify({ version: 6, binds: { duck: 'KeyZ', walk: 'KeyX' } }));
  let b = loadSettings().binds;
  assert.deepEqual([b.duck, b.walk], ['KeyZ', 'KeyX']);
  // Crouch on C by choice: walk stays on Shift rather than sharing C.
  store.set(KEY, JSON.stringify({ version: 6, binds: { duck: 'KeyC', walk: 'ShiftLeft' } }));
  b = loadSettings().binds;
  assert.deepEqual([b.duck, b.walk], ['KeyC', 'ShiftLeft']);
  // Ctrl/Shift chosen after v7 are left alone.
  store.set(KEY, JSON.stringify({ version: 7, binds: { duck: 'ControlLeft', walk: 'ShiftLeft' } }));
  b = loadSettings().binds;
  assert.deepEqual([b.duck, b.walk], ['ControlLeft', 'ShiftLeft']);
});

test('the default crosshair: length 9, gap 3, thickness 2, dot, outline, not dynamic', () => {
  store.clear();
  const s = loadSettings();
  assert.deepEqual([s.chSize, s.chGap, s.chThick, s.chDot, s.chOutline, s.chDynamic], [9, 3, 2, true, true, false]);
});

test('a save still on the old default crosshair gets the new one', () => {
  store.set(KEY, JSON.stringify({ version: 7, chSize: 8, chGap: 3, chThick: 2, chDot: false, chOutline: true, chDynamic: true, fov: 70 }));
  const s = loadSettings();
  assert.deepEqual([s.chSize, s.chGap, s.chThick, s.chDot, s.chOutline, s.chDynamic], [9, 3, 2, true, true, false]);
  assert.equal(s.fov, 70);
});

test('a crosshair the player changed is kept', () => {
  store.set(KEY, JSON.stringify({ version: 7, chSize: 12, chGap: 3, chThick: 2, chDot: false, chOutline: true, chDynamic: true }));
  let s = loadSettings();
  assert.deepEqual([s.chSize, s.chDot, s.chDynamic], [12, false, true]);
  // Picked after v8: left alone even if it matches the old defaults.
  store.set(KEY, JSON.stringify({ version: 8, chSize: 8, chGap: 3, chThick: 2, chDot: false, chOutline: true, chDynamic: true }));
  s = loadSettings();
  assert.deepEqual([s.chSize, s.chDot, s.chDynamic], [8, false, true]);
});
