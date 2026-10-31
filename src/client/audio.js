// Procedural sound: every gunshot and UI sound is synthesized into a buffer
// at startup, so there are no audio files to download.

const SR = 44100;

// Per-weapon gunshot recipe.
// crack: sharp high noise, body: mid noise, thump: low sine drop, tail: echo.
const GUN_SOUNDS = {
  usp: { crack: 0.7, crackDecay: 0.018, body: 0.7, bodyDecay: 0.07, cut: 0.25, thump: 0.6, thumpHz: 140, tail: 0.25, tailDecay: 0.25 },
  deagle: { crack: 1.0, crackDecay: 0.025, body: 1.0, bodyDecay: 0.12, cut: 0.18, thump: 1.0, thumpHz: 95, tail: 0.45, tailDecay: 0.45 },
  uzi: { crack: 0.6, crackDecay: 0.012, body: 0.6, bodyDecay: 0.05, cut: 0.3, thump: 0.45, thumpHz: 160, tail: 0.18, tailDecay: 0.18 },
  mp5: { crack: 0.6, crackDecay: 0.014, body: 0.65, bodyDecay: 0.06, cut: 0.28, thump: 0.5, thumpHz: 150, tail: 0.2, tailDecay: 0.2 },
  ump45: { crack: 0.65, crackDecay: 0.016, body: 0.75, bodyDecay: 0.075, cut: 0.22, thump: 0.65, thumpHz: 120, tail: 0.25, tailDecay: 0.25 },
  p90: { crack: 0.65, crackDecay: 0.012, body: 0.6, bodyDecay: 0.05, cut: 0.32, thump: 0.45, thumpHz: 170, tail: 0.18, tailDecay: 0.18 },
  shotgun: { crack: 0.9, crackDecay: 0.03, body: 1.0, bodyDecay: 0.18, cut: 0.12, thump: 1.0, thumpHz: 70, tail: 0.5, tailDecay: 0.6 },
  autoshotgun: { crack: 0.9, crackDecay: 0.028, body: 0.95, bodyDecay: 0.15, cut: 0.13, thump: 0.95, thumpHz: 75, tail: 0.45, tailDecay: 0.5 },
  famas: { crack: 0.8, crackDecay: 0.016, body: 0.75, bodyDecay: 0.07, cut: 0.22, thump: 0.7, thumpHz: 110, tail: 0.3, tailDecay: 0.3 },
  ak47: { crack: 0.95, crackDecay: 0.02, body: 0.9, bodyDecay: 0.09, cut: 0.16, thump: 0.95, thumpHz: 85, tail: 0.38, tailDecay: 0.38 },
  m4a1: { crack: 0.85, crackDecay: 0.017, body: 0.8, bodyDecay: 0.075, cut: 0.2, thump: 0.8, thumpHz: 100, tail: 0.32, tailDecay: 0.32 },
  awp: { crack: 1.0, crackDecay: 0.04, body: 1.0, bodyDecay: 0.25, cut: 0.1, thump: 1.0, thumpHz: 55, tail: 0.7, tailDecay: 0.9 },
  minigun: { crack: 0.5, crackDecay: 0.01, body: 0.6, bodyDecay: 0.04, cut: 0.28, thump: 0.55, thumpHz: 120, tail: 0.15, tailDecay: 0.15 },
};

function rnd() { return Math.random() * 2 - 1; }

function makeBuffer(ctx, seconds, fn) {
  const n = Math.floor(SR * seconds);
  const buf = ctx.createBuffer(1, n, SR);
  const d = buf.getChannelData(0);
  fn(d, n);
  // Normalize.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < n; i++) d[i] = (d[i] / peak) * 0.9;
  return buf;
}

function gunshot(ctx, r) {
  const len = 0.12 + r.tailDecay * 1.6;
  return makeBuffer(ctx, len, (d, n) => {
    let lp = 0, lp2 = 0, hpPrev = 0, hpOut = 0, tail = 0;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const noise = rnd();
      // High crack (one-pole high-pass).
      hpOut = 0.7 * (hpOut + noise - hpPrev);
      hpPrev = noise;
      const crack = hpOut * r.crack * Math.exp(-t / r.crackDecay);
      // Body: low-passed noise.
      lp += (noise - lp) * r.cut;
      const body = lp * r.body * 2.2 * Math.exp(-t / r.bodyDecay);
      // Thump: pitch-dropping sine.
      const f = r.thumpHz * (1 + 2.5 * Math.exp(-t / 0.012));
      phase += (2 * Math.PI * f) / SR;
      const thump = Math.sin(phase) * r.thump * Math.exp(-t / 0.06);
      // Tail: darker noise, slow decay, a bit delayed like an echo.
      lp2 += (noise - lp2) * 0.05;
      tail = lp2 * r.tail * 3 * Math.exp(-Math.max(0, t - 0.03) / r.tailDecay) * Math.min(1, t / 0.03);
      const attack = Math.min(1, t / 0.0008);
      d[i] = (crack + body + thump + tail) * attack;
    }
  });
}

function click(ctx, freq = 2400, decay = 0.006, len = 0.04) {
  return makeBuffer(ctx, len, (d, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (Math.sin(2 * Math.PI * freq * t) * 0.6 + rnd() * 0.5) * Math.exp(-t / decay);
    }
  });
}

function thud(ctx, freq = 90, decay = 0.05, noiseAmt = 0.4, len = 0.15) {
  return makeBuffer(ctx, len, (d, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      lp += (rnd() - lp) * 0.08;
      d[i] = (Math.sin(2 * Math.PI * freq * t * (1 + Math.exp(-t / 0.01))) + lp * noiseAmt * 3) * Math.exp(-t / decay);
    }
  });
}

// Heel thud plus a short gritty scuff.
function footstep(ctx, freq) {
  return makeBuffer(ctx, 0.16, (d, n) => {
    let lp = 0, bp = 0, hpPrev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const noise = rnd();
      lp += (noise - lp) * 0.06;
      const hp = noise - hpPrev; hpPrev = noise;
      bp += (hp - bp) * 0.35;
      const heel = (Math.sin(2 * Math.PI * freq * t * (1 + 0.6 * Math.exp(-t / 0.008))) * 0.9 + lp * 2.5) * Math.exp(-t / 0.03);
      const scuff = bp * 0.5 * Math.exp(-Math.max(0, t - 0.012) / 0.035) * Math.min(1, t / 0.012);
      d[i] = heel + scuff;
    }
  });
}

function ding(ctx, freq = 1800, decay = 0.12, len = 0.35) {
  return makeBuffer(ctx, len, (d, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t / 0.03) + 0.3 * Math.sin(2 * Math.PI * freq * 5.4 * t)) * Math.exp(-t / decay);
    }
  });
}

function blip(ctx, f1, f2, len = 0.12) {
  return makeBuffer(ctx, len, (d, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = f1 + (f2 - f1) * (t / len);
      ph += (2 * Math.PI * f) / SR;
      d[i] = Math.sign(Math.sin(ph)) * 0.3 * Math.exp(-t / (len * 0.4));
    }
  });
}

// Swish of a blade through the air: band-passed noise whose pitch sweeps up
// and back down. Higher and longer for the "shing" of drawing the knife.
function whoosh(ctx, len, f0, f1, q = 0.12) {
  return makeBuffer(ctx, len, (d, n) => {
    let lp = 0, bp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const f = f0 + (f1 - f0) * Math.sin(t * Math.PI);
      const k = Math.min(0.95, (2 * Math.PI * f) / SR);
      lp += (rnd() - lp) * k;
      bp += (lp - bp) * q * 4;
      d[i] = (lp - bp) * Math.sin(t * Math.PI) ** 1.5;
    }
  });
}

function tone(ctx, freq, len) {
  return makeBuffer(ctx, len, (d, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t)) * Math.min(1, t / 0.004) * Math.exp(-t / (len * 0.45));
    }
  });
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
    const c = this.ctx, b = this.buffers;
    for (const [id, r] of Object.entries(GUN_SOUNDS)) b['shot_' + id] = gunshot(c, r);
    b.dry = click(c, 3200, 0.004, 0.05);
    b.magOut = click(c, 1400, 0.01, 0.06);
    b.magIn = thud(c, 400, 0.02, 1.2, 0.08);
    b.bolt = click(c, 900, 0.02, 0.1);
    b.shell = thud(c, 300, 0.03, 0.8, 0.08);
    b.deploy = click(c, 1100, 0.015, 0.08);
    b.zoom = click(c, 2600, 0.003, 0.03);
    b.hitBody = thud(c, 140, 0.04, 1.0, 0.12);
    b.hitHead = ding(c, 2100, 0.09, 0.3);
    b.hitHelmet = ding(c, 3200, 0.05, 0.2);
    b.killConfirm = blip(c, 900, 1500, 0.12);
    b.hurt = thud(c, 70, 0.08, 0.6, 0.2);
    // Four footstep variants (two per foot) like CS's pl_step1-4.
    [92, 104, 98, 110].forEach((f, i) => { b['step' + i] = footstep(c, f); });
    b.land = thud(c, 80, 0.05, 1.4, 0.14);
    b.buy = blip(c, 700, 1100, 0.1);
    b.knifeSlash = whoosh(c, 0.22, 900, 3200);
    b.knifeStab = whoosh(c, 0.3, 500, 1800);
    b.knifeDeploy = whoosh(c, 0.32, 3500, 9000, 0.3);
    b.knifeHit = thud(c, 120, 0.05, 1.8, 0.16);
    b.knifeWall = ding(c, 2700, 0.035, 0.16);
    b.beep = tone(c, 880, 0.14);
    b.go = tone(c, 1320, 0.3);
    b.win = blip(c, 600, 1400, 0.45);
    b.spin = makeBuffer(c, 0.5, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        ph += (2 * Math.PI * (120 + 500 * (t / 0.5))) / SR;
        d[i] = (Math.sin(ph) * 0.5 + rnd() * 0.2) * Math.min(1, t * 10);
      }
    });
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
