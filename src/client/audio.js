// Procedural sound: every gunshot, reload, knife, footstep and UI sound is
// synthesized into a buffer at startup, so there are no audio files to
// download. (The menu song is the one exception, see music.js.)
//
// The sounds aim for the character of Counter-Strike 1.6 without using any of
// its audio: short, punchy, mid-heavy shots with a gritty saturated edge and a
// roomy slap-back echo, clacky metal reload parts, crisp concrete footsteps and
// a slightly lo-fi finish (everything is rendered at 22 kHz-ish detail like
// GoldSrc's samples, then played back at the device rate).

const SR = 44100;

function rnd() { return Math.random() * 2 - 1; }

// ---------- Small DSP kit (all offline, on Float32Arrays) ----------

// RBJ biquad, applied in place. type: 'lp' | 'hp' | 'bp' | 'peak'.
function biquad(d, type, freq, q = 0.707, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
  const cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
  else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; }
  else { const A = 10 ** (gainDb / 40); b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[i] = y;
  }
  return d;
}

function noise(n) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = rnd();
  return d;
}

// Multiply by an envelope: attack (s), then exponential decay (s), from t0.
function env(d, decay, attack = 0.0005, t0 = 0) {
  for (let i = 0; i < d.length; i++) {
    const t = i / SR - t0;
    d[i] *= t < 0 ? 0 : Math.min(1, t / attack) * Math.exp(-t / decay);
  }
  return d;
}

function mixInto(out, src, gain = 1, offset = 0) {
  const o = Math.floor(offset * SR);
  for (let i = 0; i < src.length && i + o < out.length; i++) if (i + o >= 0) out[i + o] += src[i] * gain;
  return out;
}

// Soft clip: the gritty, slightly overdriven edge of old game samples.
function drive(d, amount) {
  const k = Math.tanh(amount);
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * amount) / k;
  return d;
}

// Sample-and-hold every `step` samples: GoldSrc-style 22 kHz grit.
function lofi(d, step = 2) {
  for (let i = 0; i < d.length; i += step) for (let j = 1; j < step && i + j < d.length; j++) d[i + j] = d[i];
  return biquad(d, 'lp', SR / step * 0.42, 0.6);
}

// Short room: a few discrete slap-back reflections, darker each time.
function room(d, taps) {
  const dry = Float32Array.from(d);
  for (const [delay, gain, cut] of taps) {
    const wet = biquad(Float32Array.from(dry), 'lp', cut, 0.6);
    mixInto(d, wet, gain, delay);
  }
  return d;
}

// Pitch-dropping sine (the low "boom" under a shot or a thud).
function sweep(n, f0, f1, fall, decay, attack = 0.0005) {
  const d = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / fall))) / SR;
    d[i] = Math.sin(ph);
  }
  return env(d, decay, attack);
}

// Struck metal: a handful of inharmonic decaying partials plus a noise tick.
function metal(n, modes, decay, tick = 0.6, t0 = 0) {
  const d = new Float32Array(n);
  const o = Math.floor(t0 * SR);
  for (const [f, a, dk = 1] of modes) {
    const ph = Math.random() * 6.28;
    for (let i = o; i < n; i++) {
      const t = (i - o) / SR;
      d[i] += Math.sin(2 * Math.PI * f * t + ph) * a * Math.exp(-t / (decay * dk));
    }
  }
  const tk = env(biquad(noise(Math.min(n, Math.floor(SR * 0.02))), 'hp', 2500), 0.003);
  mixInto(d, tk, tick, t0);
  return d;
}

function toBuffer(ctx, d, peakTo = 0.9) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  // Trim silence off the end.
  let n = d.length;
  while (n > 1 && Math.abs(d[n - 1]) < peak * 0.002) n--;
  const buf = ctx.createBuffer(1, n, SR);
  const out = buf.getChannelData(0);
  const k = peak > 0 ? peakTo / peak : 0;
  // 3 ms fade at the end so trimmed buffers never click.
  const fade = Math.min(n, Math.floor(SR * 0.003));
  for (let i = 0; i < n; i++) out[i] = d[i] * k * (i > n - fade ? (n - i) / fade : 1);
  return buf;
}

// ---------- Guns ----------

// Per-weapon recipe. All times in seconds, frequencies in Hz.
//   crack: bright supersonic snap (band-passed noise at crackHz)
//   body: the mid "bark" of the report (resonant band at bodyHz, q bodyQ)
//   boom: low pitch-dropping thump (boomHz)
//   drive: saturation, room: slap-back amount, tail: length of the echo
//   mech: action clack mixed in (pistols, shotguns, the AWP bolt is separate)
const GUN_SOUNDS = {
  usp:         { crack: 0.55, crackHz: 3200, crackDecay: 0.012, body: 0.9, bodyHz: 900, bodyQ: 1.4, bodyDecay: 0.045, boom: 0.5, boomHz: 150, drive: 2.2, room: 0.35, tail: 0.22, mech: 0.25 },
  deagle:      { crack: 0.9, crackHz: 2600, crackDecay: 0.02, body: 1.0, bodyHz: 520, bodyQ: 1.1, bodyDecay: 0.09, boom: 1.0, boomHz: 85, drive: 3.4, room: 0.6, tail: 0.5, mech: 0.3 },
  uzi:         { crack: 0.5, crackHz: 3800, crackDecay: 0.008, body: 0.8, bodyHz: 1100, bodyQ: 1.6, bodyDecay: 0.03, boom: 0.35, boomHz: 170, drive: 2.6, room: 0.3, tail: 0.16, mech: 0.15 },
  mp5:         { crack: 0.45, crackHz: 3400, crackDecay: 0.009, body: 0.85, bodyHz: 950, bodyQ: 1.5, bodyDecay: 0.035, boom: 0.4, boomHz: 160, drive: 2.4, room: 0.3, tail: 0.18, mech: 0.12 },
  ump45:       { crack: 0.45, crackHz: 3000, crackDecay: 0.011, body: 0.9, bodyHz: 720, bodyQ: 1.3, bodyDecay: 0.045, boom: 0.55, boomHz: 125, drive: 2.6, room: 0.35, tail: 0.22, mech: 0.12 },
  p90:         { crack: 0.6, crackHz: 4200, crackDecay: 0.008, body: 0.75, bodyHz: 1250, bodyQ: 1.7, bodyDecay: 0.03, boom: 0.35, boomHz: 175, drive: 2.4, room: 0.28, tail: 0.15, mech: 0.1 },
  shotgun:     { crack: 0.8, crackHz: 2200, crackDecay: 0.025, body: 1.0, bodyHz: 380, bodyQ: 0.9, bodyDecay: 0.14, boom: 1.0, boomHz: 68, drive: 3.6, room: 0.7, tail: 0.6, mech: 0 },
  autoshotgun: { crack: 0.8, crackHz: 2400, crackDecay: 0.022, body: 1.0, bodyHz: 420, bodyQ: 0.9, bodyDecay: 0.11, boom: 0.95, boomHz: 74, drive: 3.4, room: 0.6, tail: 0.5, mech: 0.2 },
  famas:       { crack: 0.75, crackHz: 3600, crackDecay: 0.012, body: 0.9, bodyHz: 760, bodyQ: 1.3, bodyDecay: 0.05, boom: 0.6, boomHz: 115, drive: 2.8, room: 0.4, tail: 0.28, mech: 0.08 },
  ak47:        { crack: 0.9, crackHz: 2800, crackDecay: 0.016, body: 1.0, bodyHz: 560, bodyQ: 1.1, bodyDecay: 0.07, boom: 0.9, boomHz: 88, drive: 3.6, room: 0.5, tail: 0.38, mech: 0.08 },
  m4a1:        { crack: 0.8, crackHz: 3300, crackDecay: 0.013, body: 0.95, bodyHz: 680, bodyQ: 1.25, bodyDecay: 0.055, boom: 0.7, boomHz: 105, drive: 3.0, room: 0.45, tail: 0.32, mech: 0.08 },
  awp:         { crack: 1.0, crackHz: 2400, crackDecay: 0.035, body: 1.0, bodyHz: 420, bodyQ: 0.9, bodyDecay: 0.16, boom: 1.0, boomHz: 52, drive: 4.0, room: 0.85, tail: 0.95, mech: 0 },
  minigun:     { crack: 0.45, crackHz: 3400, crackDecay: 0.008, body: 0.85, bodyHz: 820, bodyQ: 1.4, bodyDecay: 0.03, boom: 0.5, boomHz: 120, drive: 3.0, room: 0.25, tail: 0.14, mech: 0 },
};

function gunshot(r) {
  const n = Math.floor(SR * (0.12 + r.tail * 1.4));
  const out = new Float32Array(n);
  // 1. Muzzle transient: a 1 ms broadband click that makes it hit hard.
  mixInto(out, env(noise(Math.floor(SR * 0.004)), 0.0008, 0.0001), 1.2);
  // 2. Crack.
  mixInto(out, env(biquad(biquad(noise(Math.floor(SR * 0.08)), 'bp', r.crackHz, 0.9), 'hp', 1200), r.crackDecay, 0.0002), r.crack * 2.2);
  // 3. Body: resonant mid band, the part that gives each gun its voice.
  const body = env(biquad(noise(Math.floor(SR * 0.4)), 'bp', r.bodyHz, r.bodyQ), r.bodyDecay, 0.0006);
  mixInto(out, biquad(body, 'peak', r.bodyHz * 0.5, 1, 4), r.body * 3.2);
  // 4. Boom.
  mixInto(out, sweep(Math.floor(SR * 0.3), r.boomHz * 3, r.boomHz, 0.01, 0.05 + r.boom * 0.04), r.boom * 0.9);
  // 5. Mechanical clack of the action, just after the shot.
  if (r.mech) mixInto(out, metal(Math.floor(SR * 0.06), [[1900, 1], [3150, 0.7], [4700, 0.4]], 0.01, 0.5), r.mech, 0.012);
  drive(out, r.drive);
  // 6. Room: slap-back echoes plus a dark decaying tail.
  room(out, [[0.021, 0.35 * r.room, 4000], [0.047, 0.25 * r.room, 2600], [0.083, 0.18 * r.room, 1800], [0.131, 0.12 * r.room, 1200]]);
  const tail = env(biquad(noise(n), 'lp', 900, 0.7), r.tail * 0.45, 0.02, 0.015);
  mixInto(out, tail, 0.22 * r.room);
  return lofi(out, 2);
}

// ---------- Reload, handling and impacts ----------

// Magazine out: a release click then a sliding metallic clack.
function magOut() {
  const n = Math.floor(SR * 0.22);
  const d = metal(n, [[2300, 0.6], [3700, 0.4]], 0.008, 0.6);
  mixInto(d, env(biquad(noise(Math.floor(SR * 0.08)), 'bp', 1800, 1.5), 0.025, 0.01), 0.35, 0.02);
  mixInto(d, metal(n, [[1150, 1], [2050, 0.8], [3300, 0.5], [5200, 0.25]], 0.03, 0.8), 1, 0.07);
  return lofi(drive(d, 1.6));
}

// Magazine in: slide, then two firm clacks as it seats.
function magIn() {
  const n = Math.floor(SR * 0.25);
  const d = new Float32Array(n);
  mixInto(d, env(biquad(noise(Math.floor(SR * 0.06)), 'bp', 2200, 1.2), 0.02, 0.012), 0.3);
  mixInto(d, metal(n, [[900, 1], [1650, 0.8], [2800, 0.6], [4400, 0.3]], 0.025, 1), 1, 0.04);
  mixInto(d, sweep(Math.floor(SR * 0.08), 260, 130, 0.01, 0.02), 0.6, 0.04);
  mixInto(d, metal(n, [[1300, 0.8], [2400, 0.6], [3900, 0.4]], 0.02, 0.9), 0.85, 0.105);
  return lofi(drive(d, 1.8));
}

// Bolt / slide: pulled back with a scrape, then slammed forward.
function bolt() {
  const n = Math.floor(SR * 0.32);
  const d = new Float32Array(n);
  mixInto(d, metal(n, [[1700, 0.7], [2900, 0.5]], 0.01, 0.7), 0.7);
  const scrape = biquad(noise(Math.floor(SR * 0.1)), 'bp', 3000, 2);
  for (let i = 0; i < scrape.length; i++) scrape[i] *= Math.sin((i / scrape.length) * Math.PI);
  mixInto(d, scrape, 0.3, 0.01);
  mixInto(d, metal(n, [[820, 1], [1500, 0.9], [2600, 0.6], [4100, 0.35]], 0.03, 1), 1.1, 0.15);
  mixInto(d, sweep(Math.floor(SR * 0.08), 220, 110, 0.01, 0.025), 0.5, 0.15);
  return lofi(drive(d, 2));
}

// Shotgun shell pushed into the tube.
function shellLoad() {
  const n = Math.floor(SR * 0.12);
  const d = metal(n, [[1450, 1], [2600, 0.6], [3800, 0.3]], 0.018, 0.8);
  mixInto(d, sweep(Math.floor(SR * 0.06), 300, 160, 0.008, 0.015), 0.6);
  return lofi(drive(d, 1.8));
}

// Spent brass hitting concrete: little bright tinks.
function brass() {
  const n = Math.floor(SR * 0.35);
  const d = new Float32Array(n);
  const modes = [[4100, 1], [6900, 0.6], [9300, 0.3]];
  mixInto(d, metal(n, modes, 0.03, 0.3), 1);
  mixInto(d, metal(n, modes.map(([f, a]) => [f * 1.04, a]), 0.02, 0.2), 0.5, 0.09);
  mixInto(d, metal(n, modes.map(([f, a]) => [f * 0.97, a]), 0.012, 0.1), 0.25, 0.16);
  return lofi(d);
}

// Pulling out a gun: a grab rustle and a light clack.
function deploy() {
  const n = Math.floor(SR * 0.2);
  const d = env(biquad(noise(n), 'bp', 1400, 0.8), 0.04, 0.02);
  mixInto(d, metal(n, [[1600, 0.8], [2700, 0.5], [4200, 0.3]], 0.015, 0.6), 0.9, 0.06);
  return lofi(drive(d, 1.5));
}

function dryFire() {
  const n = Math.floor(SR * 0.08);
  return lofi(drive(metal(n, [[2600, 1], [4100, 0.6], [6100, 0.3]], 0.006, 1), 2));
}

function zoomClick() {
  const n = Math.floor(SR * 0.08);
  const d = metal(n, [[3400, 0.6], [5200, 0.4]], 0.004, 0.8);
  mixInto(d, env(biquad(noise(n), 'hp', 4000), 0.012, 0.004), 0.3, 0.01);
  return lofi(d);
}

// Bullet hitting a player: a wet slap (body) or a sharp metallic dink (helmet).
function fleshHit(bright = 1) {
  const n = Math.floor(SR * 0.2);
  const d = env(biquad(noise(n), 'lp', 1800 * bright, 0.9), 0.03, 0.001);
  mixInto(d, sweep(n, 320, 90, 0.012, 0.04), 1.1);
  mixInto(d, env(biquad(noise(Math.floor(SR * 0.03)), 'bp', 2600, 1), 0.006), 0.5);
  return lofi(drive(d, 2.6));
}

function helmetHit() {
  const n = Math.floor(SR * 0.3);
  const d = metal(n, [[2350, 1], [3720, 0.7, 0.7], [5600, 0.5, 0.5], [7900, 0.25, 0.4]], 0.07, 1);
  return lofi(drive(d, 1.8));
}

// Bullet hitting the world: a short ricochet "pt-ziing" and a debris crack.
function ricochet(pitch) {
  const n = Math.floor(SR * 0.32);
  const d = env(biquad(noise(Math.floor(SR * 0.05)), 'bp', 2400, 0.8), 0.008, 0.0003);
  // The whine: a falling, slightly wobbly tone.
  const w = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = pitch * (1 - 0.35 * t / 0.3) * (1 + 0.01 * Math.sin(t * 90));
    ph += (2 * Math.PI * f) / SR;
    w[i] = Math.sin(ph) * Math.min(1, t / 0.01) * Math.exp(-t / 0.08);
  }
  mixInto(d, w, 0.35, 0.006);
  return lofi(d);
}

function impactHard() {
  const n = Math.floor(SR * 0.12);
  const d = env(biquad(noise(n), 'bp', 1900, 0.7), 0.015, 0.0003);
  mixInto(d, sweep(n, 400, 150, 0.006, 0.015), 0.5);
  return lofi(drive(d, 2.4));
}

// ---------- Footsteps and movement ----------

// Concrete step: a crisp gritty heel tick, a soft body, and the toe a moment
// later. Four variants like CS's pl_step1-4.
function footstep(v) {
  const n = Math.floor(SR * 0.18);
  const d = new Float32Array(n);
  const grit = (len, hz, q, dk) => env(biquad(biquad(noise(Math.floor(SR * len)), 'bp', hz, q), 'hp', 600), dk, 0.0008);
  mixInto(d, grit(0.06, 1700 + v * 180, 0.9, 0.012), 1);
  mixInto(d, sweep(Math.floor(SR * 0.08), 260 + v * 15, 110 + v * 6, 0.01, 0.018), 0.55);
  mixInto(d, grit(0.05, 2600 + v * 220, 1.1, 0.008), 0.55, 0.028 + v * 0.004);
  return lofi(drive(d, 1.8));
}

// Landing from a jump: heavier scuff plus a gear rattle.
function land() {
  const n = Math.floor(SR * 0.22);
  const d = env(biquad(noise(n), 'bp', 1200, 0.7), 0.03, 0.001);
  mixInto(d, sweep(n, 200, 70, 0.012, 0.05), 1.1);
  mixInto(d, metal(n, [[2900, 0.4], [4300, 0.3]], 0.012, 0.3), 0.3, 0.02);
  return lofi(drive(d, 2.2));
}

function hurt() {
  const n = Math.floor(SR * 0.25);
  const d = env(biquad(noise(n), 'lp', 1100, 0.8), 0.05, 0.001);
  mixInto(d, sweep(n, 180, 60, 0.02, 0.07), 1.3);
  return lofi(drive(d, 3));
}

// ---------- Knife ----------

// Swish through the air: band-passed noise whose pitch sweeps up and down.
function whoosh(len, f0, f1, q = 2) {
  const n = Math.floor(SR * len);
  const d = noise(n);
  // Time-varying band-pass, done in short blocks.
  const out = new Float32Array(n);
  const block = 256;
  let s1 = 0, s2 = 0;
  for (let b = 0; b < n; b += block) {
    const t = b / n;
    const f = f0 + (f1 - f0) * Math.sin(t * Math.PI);
    // Chamberlin state-variable filter, stable for these ranges.
    const F = 2 * Math.sin((Math.PI * Math.min(f, 9000)) / SR), Q = 1 / q;
    for (let i = b; i < Math.min(n, b + block); i++) {
      const hp = d[i] - s2 - Q * s1;
      s1 += F * hp; s2 += F * s1;
      out[i] = s1 * Math.sin((i / n) * Math.PI) ** 1.6;
    }
  }
  return lofi(out);
}

// Drawing the knife: a bright metal "shing" ringing off the sheath.
function knifeDeploy() {
  const n = Math.floor(SR * 0.45);
  const d = whoosh(0.18, 3000, 7000, 3);
  const out = new Float32Array(n);
  mixInto(out, d, 0.6);
  mixInto(out, metal(n, [[3950, 1], [5480, 0.7, 0.8], [7300, 0.5, 0.6], [9100, 0.3, 0.5]], 0.11, 0.4), 0.8, 0.08);
  return lofi(out);
}

// Blade hitting a wall: a clang with a gritty scrape.
function knifeWall() {
  const n = Math.floor(SR * 0.4);
  const d = metal(n, [[1850, 1], [2950, 0.8, 0.7], [4300, 0.6, 0.5], [6200, 0.35, 0.4]], 0.09, 1);
  mixInto(d, env(biquad(noise(Math.floor(SR * 0.12)), 'bp', 3500, 1.5), 0.04, 0.002), 0.4);
  return lofi(drive(d, 2));
}

// Blade into a body: a meaty stab.
function knifeHit() {
  const n = Math.floor(SR * 0.25);
  const d = env(biquad(noise(n), 'lp', 1400, 1), 0.045, 0.002);
  mixInto(d, sweep(n, 240, 80, 0.015, 0.06), 1);
  mixInto(d, env(biquad(noise(Math.floor(SR * 0.06)), 'bp', 900, 2), 0.02, 0.004), 0.6, 0.01);
  return lofi(drive(d, 3));
}

// ---------- UI ----------

function ding(freq = 1800, decay = 0.12, len = 0.35) {
  const n = Math.floor(SR * len);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t / 0.03) + 0.3 * Math.sin(2 * Math.PI * freq * 5.4 * t)) * Math.exp(-t / decay);
  }
  return d;
}

function blip(f1, f2, len = 0.12) {
  const n = Math.floor(SR * len);
  const d = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (f1 + (f2 - f1) * (t / len))) / SR;
    d[i] = Math.sign(Math.sin(ph)) * 0.3 * Math.exp(-t / (len * 0.4));
  }
  return biquad(d, 'lp', 5000);
}

function tone(freq, len) {
  const n = Math.floor(SR * len);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t)) * Math.min(1, t / 0.004) * Math.exp(-t / (len * 0.45));
  }
  return d;
}

// Every buffer the game plays, by name.
export function buildAll() {
  const b = {};
  for (const [id, r] of Object.entries(GUN_SOUNDS)) b['shot_' + id] = gunshot(r);
  b.dry = dryFire();
  b.magOut = magOut();
  b.magIn = magIn();
  b.bolt = bolt();
  b.shell = shellLoad();
  b.brass = brass();
  b.deploy = deploy();
  b.zoom = zoomClick();
  b.hitBody = fleshHit();
  b.hitHead = fleshHit(1.6);
  b.hitHelmet = helmetHit();
  b.ric0 = ricochet(2900);
  b.ric1 = ricochet(3600);
  b.ric2 = ricochet(2300);
  b.impact = impactHard();
  b.killConfirm = blip(900, 1500, 0.12);
  b.hurt = hurt();
  for (let i = 0; i < 4; i++) b['step' + i] = footstep(i);
  b.land = land();
  b.buy = blip(700, 1100, 0.1);
  b.knifeSlash = whoosh(0.22, 700, 2600);
  b.knifeStab = whoosh(0.3, 400, 1500, 1.6);
  b.knifeDeploy = knifeDeploy();
  b.knifeHit = knifeHit();
  b.knifeWall = knifeWall();
  b.beep = tone(880, 0.14);
  b.go = tone(1320, 0.3);
  b.win = blip(600, 1400, 0.45);
  return b;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.6;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.sfxOn = true; // off on the main menu and while paused
    this.sfx = null; // game sounds go through this gain, so pausing can cut them at once
  }

  // Game sounds on or off. Off also silences sounds already playing.
  setSfx(on) {
    this.sfxOn = on;
    if (!this.sfx) return;
    const g = this.sfx.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 1 : 0, now + 0.05);
  }

  // Must be called from a user gesture (iOS requirement).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // Gentle compressor so stacked shots don't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.sfxOn ? 1 : 0;
      this.sfx.connect(this.master);
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  build() {
    for (const [name, d] of Object.entries(buildAll())) this.buffers[name] = toBuffer(this.ctx, d);
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  // pos: world position or null for 2D (local player) sounds.
  play(name, { pos = null, volume = 1, rate = 1, jitter = 0.04 } = {}) {
    if (!this.ctx || !this.sfxOn || !this.buffers[name]) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = c.createGain();
    let gain = volume;
    let node = src.connect(g);
    if (pos) {
      const L = this.listener;
      const dx = pos[0] - L.x, dz = pos[2] - L.z;
      const dist = Math.hypot(dx, pos[1] - L.y, dz);
      gain *= 1 / (1 + dist * 0.07);
      if (c.createStereoPanner) {
        // Right vector of the listener.
        const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
        const pan = dist > 0.01 ? (dx * rx + dz * rz) / Math.hypot(dx, dz || 1e-6) : 0;
        const p = c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
        node = node.connect(p);
      }
      if (dist > 25) {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(900, 9000 - dist * 90);
        node = node.connect(lp);
      }
    }
    g.gain.value = gain;
    node.connect(this.sfx);
    src.start();
  }
}
