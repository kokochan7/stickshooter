// Menu music: an original 150 BPM metal loop (drums, chugging distorted
// guitar, bass and a lead line), rendered once with an OfflineAudioContext
// when audio unlocks. No audio files, and nothing runs per frame: playback is
// a single looping buffer.

const BPM = 150;
const STEP = 60 / BPM / 4; // one 16th note
const BARS = 16;
const LOOP = BARS * 16 * STEP;
const E2 = 82.41;

const hz = (semi, base = E2) => base * Math.pow(2, semi / 12);

// Guitar/bass riff, one 4-bar phrase: [step, semitones above E2, length in
// 16ths, chord]. Short notes are palm-muted chugs; chords are power chords.
const RIFF = [
  // Bar 1: gallop on low E.
  ...[0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s) => [s, 0, 1, s === 0]),
  // Bar 2: gallop, then G and F power chords.
  ...[16, 18, 19, 20, 22, 23].map((s) => [s, 0, 1, false]),
  [24, 3, 3, true], [27, 1, 3, true], [30, 0, 1, false], [31, 0, 1, false],
  // Bar 3: gallop again.
  ...[32, 34, 35, 36, 38, 39, 40, 42, 43, 44, 46, 47].map((s) => [s, 0, 1, s === 32]),
  // Bar 4: walk down from the tritone.
  [48, 6, 4, true], [52, 5, 4, true], [56, 3, 4, true], [60, 1, 2, true], [62, 0, 1, false], [63, 0, 1, false],
];

// Lead line for the second half: [bar (0-7), step, semitones above E4, length].
const E4 = E2 * 4;
const LEAD = [
  [0, 0, 12, 6], [0, 6, 10, 2], [0, 8, 12, 4], [0, 12, 15, 4],
  [1, 0, 13, 8], [1, 8, 12, 4], [1, 12, 10, 4],
  [2, 0, 7, 4], [2, 4, 10, 4], [2, 8, 12, 4], [2, 12, 15, 2], [2, 14, 17, 2],
  [3, 0, 18, 6], [3, 6, 17, 2], [3, 8, 15, 4], [3, 12, 13, 4],
  [4, 0, 12, 6], [4, 6, 10, 2], [4, 8, 12, 4], [4, 12, 15, 4],
  [5, 0, 19, 8], [5, 8, 18, 4], [5, 12, 15, 4],
  [6, 0, 17, 4], [6, 4, 15, 4], [6, 8, 13, 4], [6, 12, 12, 4],
  [7, 0, 13, 4], [7, 4, 12, 4], [7, 8, 12, 8],
];

function distortionCurve(amount) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(g, t, peak, attack, decay, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  if (hold) g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
}

// Render a short mono/stereo clip offline.
function renderClip(sampleRate, seconds, channels, build) {
  const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
  build(ctx, ctx.destination);
  return ctx.startRendering();
}

// Drum one-shots, rendered once and then triggered as plain buffers.
function kick(ctx, dest) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(160, 0);
  o.frequency.exponentialRampToValueAtTime(42, 0.09);
  env(g, 0, 1.1, 0.002, 0.22);
  o.connect(g).connect(dest);
  o.start(0); o.stop(0.3);
  // Beater click.
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
  n.buffer = noiseBuffer(ctx, 0.05); f.type = 'highpass'; f.frequency.value = 2500;
  env(ng, 0, 0.35, 0.001, 0.012);
  n.connect(f).connect(ng).connect(dest);
  n.start(0);
}
function snare(ctx, dest) {
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = noiseBuffer(ctx, 0.3); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6;
  env(g, 0, 0.9, 0.001, 0.16);
  n.connect(f).connect(g).connect(dest);
  n.start(0);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.frequency.setValueAtTime(240, 0); o.frequency.exponentialRampToValueAtTime(170, 0.06);
  env(og, 0, 0.6, 0.001, 0.08);
  o.connect(og).connect(dest);
  o.start(0); o.stop(0.12);
}
function hat(open) {
  return (ctx, dest) => {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noiseBuffer(ctx, 0.3); f.type = 'highpass'; f.frequency.value = 7500;
    env(g, 0, 0.22, 0.001, open ? 0.18 : 0.035);
    n.connect(f).connect(g).connect(dest);
    n.start(0);
  };
}
function crash(ctx, dest) {
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = noiseBuffer(ctx, 1.8); f.type = 'highpass'; f.frequency.value = 4500;
  env(g, 0, 0.42, 0.002, 1.6);
  n.connect(f).connect(g).connect(dest);
  n.start(0);
}

// One 4-bar phrase of the riff: guitar on channel 0, bass on channel 1. It
// repeats unchanged, so it is rendered once and reused.
function riff(ctx, dest) {
  const merge = ctx.createChannelMerger(2);
  merge.connect(dest);
  const gtrIn = ctx.createGain();
  const drive = ctx.createWaveShaper(); drive.curve = distortionCurve(9);
  const gtrHp = ctx.createBiquadFilter(); gtrHp.type = 'highpass'; gtrHp.frequency.value = 90;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 800; mid.gain.value = -5; mid.Q.value = 1;
  const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3600; cab.Q.value = 0.8;
  gtrIn.connect(drive).connect(gtrHp).connect(mid).connect(cab).connect(merge, 0, 0);
  const bass = ctx.createGain();
  const bassDrive = ctx.createWaveShaper(); bassDrive.curve = distortionCurve(2.5);
  const bassLp = ctx.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 420;
  bass.connect(bassDrive).connect(bassLp).connect(merge, 0, 1);
  for (const [s, semi, len, chord] of RIFF) {
    const t = s * STEP;
    const dur = chord ? len * STEP * 0.95 : STEP * 0.55;
    const f = hz(semi);
    for (const fr of chord ? [f, f * 1.4983, f * 2] : [f, f * 2]) {
      for (const det of [-6, 7]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        env(g, t, chord ? 0.32 : 0.42, 0.003, chord ? 0.08 : 0.06, Math.max(0, dur - 0.06));
        o.connect(g).connect(gtrIn);
        o.start(t); o.stop(t + dur + 0.12);
      }
    }
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f / 2;
    env(g, t, 0.8, 0.003, 0.08, Math.max(0, dur - 0.05));
    o.connect(g).connect(bass);
    o.start(t); o.stop(t + dur + 0.12);
  }
}

async function renderLoop(sampleRate) {
  const [kickB, snareB, hatB, openHatB, crashB, riffB] = await Promise.all([
    renderClip(sampleRate, 0.3, 1, kick),
    renderClip(sampleRate, 0.3, 1, snare),
    renderClip(sampleRate, 0.1, 1, hat(false)),
    renderClip(sampleRate, 0.3, 1, hat(true)),
    renderClip(sampleRate, 1.8, 1, crash),
    renderClip(sampleRate, 64 * STEP + 0.4, 2, riff),
  ]);

  // A little extra at the end so ringing notes can be folded back to the start.
  const tail = 1.8;
  const ctx = new OfflineAudioContext(2, Math.ceil((LOOP + tail) * sampleRate), sampleRate);
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -14; out.knee.value = 6; out.ratio.value = 6; out.attack.value = 0.003; out.release.value = 0.12;
  out.connect(ctx.destination);

  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(out);
  const hit = (buf, t, v = 1) => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; g.gain.value = v;
    src.connect(g).connect(drums);
    src.start(t);
  };

  // Double-tracked guitar: hard left and a slightly delayed copy hard right.
  const split = ctx.createChannelSplitter(2);
  const gtr = ctx.createGain(); gtr.gain.value = 0.32;
  const panL = ctx.createStereoPanner(); panL.pan.value = -0.7;
  const panR = ctx.createStereoPanner(); panR.pan.value = 0.7;
  const dbl = ctx.createDelay(0.05); dbl.delayTime.value = 0.014;
  split.connect(gtr, 0);
  gtr.connect(panL).connect(out);
  gtr.connect(dbl).connect(panR).connect(out);
  const bass = ctx.createGain(); bass.gain.value = 0.5;
  split.connect(bass, 1);
  bass.connect(out);

  const lead = ctx.createGain(); lead.gain.value = 0.16;
  const leadDrive = ctx.createWaveShaper(); leadDrive.curve = distortionCurve(5);
  const leadLp = ctx.createBiquadFilter(); leadLp.type = 'lowpass'; leadLp.frequency.value = 4200;
  const echo = ctx.createDelay(1); echo.delayTime.value = STEP * 3;
  const echoFb = ctx.createGain(); echoFb.gain.value = 0.3;
  const echoOut = ctx.createGain(); echoOut.gain.value = 0.35;
  lead.connect(leadDrive).connect(leadLp).connect(out);
  leadLp.connect(echo).connect(echoFb).connect(echo);
  echo.connect(echoOut).connect(out);

  const leadNote = (t, semi, len) => {
    const dur = len * STEP;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square';
    const f = hz(semi, E4);
    o.frequency.value = f; o2.frequency.value = f; o2.detune.value = 9;
    // Vibrato that comes in on long notes.
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.5 ? f * 0.012 : 0, t + Math.min(dur, 0.5));
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    env(g, t, 0.7, 0.01, 0.12, Math.max(0, dur - 0.1));
    o.connect(g); o2.connect(g); g.connect(lead);
    for (const n of [o, o2, lfo]) { n.start(t); n.stop(t + dur + 0.2); }
  };

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 16 * STEP;
    const second = bar >= 8;
    const lastOfPhrase = bar % 4 === 3;
    if (bar % 4 === 0) {
      hit(crashB, t0);
      const r = ctx.createBufferSource();
      r.buffer = riffB;
      r.connect(split);
      r.start(t0);
    }
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * STEP;
      if (second) {
        // Double kick 16ths, except in the fill.
        if (!(lastOfPhrase && s >= 12)) hit(kickB, t, s % 4 === 0 ? 1 : 0.75);
      } else if (s % 4 === 0 || s === 10 || (lastOfPhrase && s === 14)) {
        hit(kickB, t);
      }
      if ((s === 4 || s === 12) && !(lastOfPhrase && s >= 12)) hit(snareB, t);
      if (s % 2 === 0) hit(s === 14 && !lastOfPhrase ? openHatB : hatB, t, s % 4 === 0 ? 1 : 0.6);
      // Snare fill into the next phrase.
      if (lastOfPhrase && s >= 12) hit(snareB, t, 0.55 + (s - 12) * 0.15);
    }
  }
  for (const [bar, s, semi, len] of LEAD) leadNote((8 + bar) * 16 * STEP + s * STEP, semi, len);

  const rendered = await ctx.startRendering();
  // Fold the tail onto the start so the loop is seamless, then trim.
  const n = Math.round(LOOP * sampleRate);
  const buf = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate });
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = buf.getChannelData(ch);
    dst.set(src.subarray(0, n));
    for (let i = n; i < src.length; i++) dst[i - n] += src[i];
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(dst[i]));
  }
  if (peak > 0) for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= 0.9 / peak; }
  return buf;
}

export class MenuMusic {
  constructor(audio) {
    this.audio = audio;
    this.gain = null;
    this.src = null;
    this.level = 0.5; // settings.music
    this.muted = false;
    this.active = true; // only plays on the main menu
    this.loading = false;
  }

  // Call after audio.unlock().
  async start() {
    const ctx = this.audio.ctx;
    if (!ctx || this.src || this.loading) return;
    this.loading = true;
    try {
      const buf = await renderLoop(ctx.sampleRate);
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.audio.master);
      this.src = ctx.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = true;
      this.src.connect(this.gain);
      this.src.start();
      this.apply(1.2);
    } catch (e) {
      console.warn('Menu music failed', e);
    }
    this.loading = false;
  }

  set({ level = this.level, muted = this.muted, active = this.active }) {
    this.level = level; this.muted = muted; this.active = active;
    this.apply(active ? 1 : 0.6);
  }

  apply(fade) {
    if (!this.gain) return;
    const ctx = this.audio.ctx;
    const target = this.active && !this.muted ? this.level * 0.7 : 0;
    const g = this.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(target, ctx.currentTime + fade);
  }
}
