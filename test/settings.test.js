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
