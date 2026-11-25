// Procedural, tileable surface textures for the map look (mapLook.js),
// generated at load time so the game ships no image files. Each generator
// returns colour (linear-ish 0..1), height (for the normal map) and
// roughness per pixel. `q` is the style's quality config:
//   q.size    texture size in pixels
//   q.smooth  stylized: fewer, softer octaves and no fine grain
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Periodic value noise on a px x py lattice, sampled at u, v in [0, 1).
function lattice(px, py, r) {
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (u, v) => {
    const x = u * px, y = v * py;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * px + x0], b = g[y0 * px + x1], c = g[y1 * px + x0], d = g[y1 * px + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(seed, px, py, oct, gain = 0.5) {
  const r = rng(seed);
  const ls = [];
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    ls.push([lattice(px << o, py << o, r), amp]);
    tot += amp;
    amp *= gain;
  }
  return (u, v) => {
    let s = 0;
    for (const [f, a] of ls) s += f(u, v) * a;
    return s / tot;
  };
}

const hash2 = (x, y, s = 0) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2246822519, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
let G = 1; // per-pixel grain amount for the current build

// ---------------- Generators ----------------
// Each: (u, v, px, py, ctx) -> writes ctx.c (rgb), ctx.h, ctx.r.

const GEN = {
  concrete(q) {
    const big = fbm(11, 3, 3, q.smooth ? 3 : 5);
    const stain = fbm(12, 10, 2, q.smooth ? 2 : 4);
    const fine = fbm(13, 64, 64, 2);
    return (u, v, x, y, o) => {
      let b = 0.74 + (big(u, v) - 0.5) * 0.24 - Math.max(0, stain(u, v) - 0.55) * 0.35;
      if (!q.smooth) b += (fine(u, v) - 0.5) * 0.08 + (hash2(x, y, 1) - 0.5) * 0.04 * G;
      let h = big(u, v) * 0.4 + (q.smooth ? 0 : fine(u, v) * 0.3);
      // Formwork seams on the tile edge and tie holes.
      const e = Math.min(u, 1 - u, v, 1 - v);
      if (e < 0.004) { b *= 0.72; h -= 0.4; }
      for (const tu of [0.25, 0.75]) for (const tv of [0.25, 0.75]) {
        const d = Math.hypot(u - tu, v - tv);
        if (d < 0.012) { b *= 0.55; h -= 0.5 * (1 - d / 0.012); }
      }
      if (!q.smooth && hash2(x, y, 2) > 0.992) { b *= 0.7; h -= 0.3; }
      o.c[0] = b; o.c[1] = b * 0.985; o.c[2] = b * 0.95;
      o.h = h; o.r = 0.82 + stain(u, v) * 0.15;
    };
  },

  metal(q) {
    const n = fbm(31, 4, 4, q.smooth ? 2 : 4);
    const rust = fbm(32, 5, 5, 4);
    const brush = fbm(33, 128, 2, 2);
    return (u, v, x, y, o) => {
      let b = 0.82 + (n(u, v) - 0.5) * 0.12 + (q.smooth ? 0 : (brush(u, v) - 0.5) * 0.06);
      let r = 0.48 + n(u, v) * 0.15;
      let h = 0.5 + (q.smooth ? 0 : brush(u, v) * 0.05);
      const e = Math.min(v, 1 - v);
      if (e < 0.005) { b *= 0.6; h = 0.2; }
      if (Math.abs(v - 0.5) < 0.004) { b *= 0.8; h = 0.35; }
      const rr = rust(u, v);
      const ru = q.smooth ? 0 : smooth(0.7, 0.78, rr) * 0.8;
      o.c[0] = mix(b, 0.42, ru); o.c[1] = mix(b, 0.26, ru); o.c[2] = mix(b * 0.98, 0.15, ru);
      o.h = h - ru * 0.1; o.r = mix(r, 0.92, ru); o.m = 1 - ru;
    };
  },

  corrugated(q) {
    const streak = fbm(41, 40, 2, 3);
    const n = fbm(42, 6, 6, q.smooth ? 2 : 4);
    return (u, v, x, y, o) => {
      const s = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 12);
      const ridge = q.smooth ? s : Math.pow(s, 0.7);
      let b = 0.72 + ridge * 0.18 + (n(u, v) - 0.5) * 0.1;
      const st = q.smooth ? 0 : smooth(0.5, 0.75, streak(u, v)) * 0.5;
      const dirtB = q.smooth ? 0 : (1 - smooth(0, 0.18, v)) * 0.3;
      b *= 1 - dirtB;
      o.c[0] = mix(b, 0.4, st); o.c[1] = mix(b, 0.25, st); o.c[2] = mix(b, 0.14, st);
      o.h = ridge; o.r = 0.55 + st * 0.3; o.m = 1 - st;
    };
  },

  // Box-local UVs: one crate face is the whole texture.
  crate(q) {
    const grain = fbm(51, 3, 60, q.smooth ? 2 : 4);
    const grainV = fbm(52, 60, 3, q.smooth ? 2 : 4);
    return (u, v, x, y, o) => {
      const F = 0.11;
      const frame = u < F || u > 1 - F || v < F || v > 1 - F;
      const diag = !frame && Math.abs(u - v) < F * 0.75;
      let base, g, h = 0.6, gap = 1;
      if (frame) {
        const vert = (u < F || u > 1 - F) && v > F && v < 1 - F;
        g = vert ? grainV(u, v) : grain(u, v);
        base = 0.62; h = 0.85;
        const e = vert ? Math.min(Math.abs(u - F), Math.abs(u - (1 - F))) : Math.min(Math.abs(v - F), Math.abs(v - (1 - F)));
        if (e < 0.006) { gap = 0.5; h = 0.4; }
      } else if (diag) {
        g = grainV(u * 0.7 + v * 0.7, v - u); base = 0.66; h = 0.8;
        if (Math.abs(Math.abs(u - v) - F * 0.75) < 0.006) { gap = 0.55; h = 0.5; }
      } else {
        const P = 5, pv = (v - F) / (1 - 2 * F) * P, pid = Math.floor(pv), fp = pv - pid;
        g = grain(u + pid * 0.37, v);
        base = 0.56 + hash2(pid, 7, 5) * 0.14;
        if (fp < 0.04 || fp > 0.96) { gap = 0.45; h = 0.3; }
      }
      const rings = q.smooth ? 0 : 0.06 * Math.sin(g * 60);
      let b = (base + (g - 0.5) * (q.smooth ? 0.12 : 0.3) + rings) * gap;
      // Nails at the frame corners.
      for (const a of [F / 2, 1 - F / 2]) for (const c of [F / 2, 1 - F / 2]) if (Math.hypot(u - a, v - c) < 0.012) { b = 0.25; h = 1; }
      o.c[0] = b * 1.12; o.c[1] = b * 0.76; o.c[2] = b * 0.45;
      o.h = h + g * 0.1; o.r = 0.8;
    };
  },

  planks(q) {
    const grain = fbm(61, 40, 3, q.smooth ? 2 : 4);
    return (u, v, x, y, o) => {
      const N = 8, pu = u * N, id = Math.floor(pu), f = pu - id;
      const off = hash2(id, 1, 6);
      const g = grain(u, (v + off) % 1);
      let b = 0.6 + off * 0.18 + (g - 0.5) * (q.smooth ? 0.1 : 0.28) + (q.smooth ? 0 : 0.05 * Math.sin(g * 50));
      let h = 0.7 + g * 0.1;
      if (f < 0.04 || f > 0.96) { b *= 0.35; h = 0.1; }
      // Butt joint somewhere along each board.
      if (Math.abs(((v + off) % 1) - 0.5) < 0.004) { b *= 0.5; h = 0.3; }
      o.c[0] = b * 1.1; o.c[1] = b * 0.8; o.c[2] = b * 0.55;
      o.h = h; o.r = 0.75;
    };
  },

  stone(q) {
    const n = fbm(71, 12, 12, q.smooth ? 2 : 5);
    const big = fbm(72, 3, 3, 3);
    return (u, v, x, y, o) => {
      const R = 4, PER = 3;
      const ry = v * R, row = Math.floor(ry), fy = ry - row;
      const rx = u * PER + (row % 2 ? 0.5 : 0) + hash2(row, 2, 7) * 0.3, col = Math.floor(rx), fx = rx - col;
      const id = hash2(((col % PER) + PER) % PER, row, 8);
      const edge = Math.min(Math.min(fx, 1 - fx) * 3, Math.min(fy, 1 - fy) * 4);
      const nn = n(u, v);
      let b = 0.68 + (id - 0.5) * 0.18 + (nn - 0.5) * (q.smooth ? 0.1 : 0.3) + (big(u, v) - 0.5) * 0.15;
      let h = smooth(0, 0.12, edge) * 0.7 + (q.smooth ? 0 : nn * 0.3);
      if (edge < 0.04) b *= 0.6;
      o.c[0] = b; o.c[1] = b * 0.97; o.c[2] = b * 0.9;
      o.h = h; o.r = 0.9;
    };
  },

  asphalt(q) {
    const big = fbm(81, 4, 4, 4);
    const crack = fbm(82, 6, 6, 5);
    return (u, v, x, y, o) => {
      let b = 0.5 + (big(u, v) - 0.5) * 0.22;
      let h = 0.5;
      if (!q.smooth) {
        const a = hash2(x, y, 9), a2 = hash2(x >> 1, y >> 1, 10);
        b += ((a - 0.5) * 0.12 + (a2 - 0.5) * 0.1) * G;
        h += (a2 - 0.5) * 0.1;
        const c = Math.abs(crack(u, v) - 0.5);
        if (c < 0.0035) { b *= 0.7; h -= 0.3; }
      }
      // Concrete slab joints every half tile.
      const ju = (u * 2) % 1, jv = (v * 2) % 1;
      if (Math.min(ju, 1 - ju, jv, 1 - jv) < 0.004) { b *= 0.6; h -= 0.4; }
      o.c[0] = b; o.c[1] = b * 0.99; o.c[2] = b * 0.96;
      o.h = h; o.r = 0.9;
    };
  },

  paving(q) {
    const n = fbm(91, 8, 8, q.smooth ? 2 : 4);
    const big = fbm(92, 2, 2, 3);
    return (u, v, x, y, o) => {
      const N = 4, pu = u * N, pv = v * N, iu = Math.floor(pu), iv = Math.floor(pv);
      const fu = pu - iu, fv = pv - iv;
      const id = hash2(iu % N, iv % N, 11);
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      let b = 0.76 + (id - 0.5) * 0.1 + (n(u, v) - 0.5) * (q.smooth ? 0.06 : 0.16) + (big(u, v) - 0.5) * 0.12;
      let h = smooth(0, 0.05, edge) * 0.8;
      if (edge < 0.015) b *= 0.62;
      if (!q.smooth) b += (hash2(x, y, 12) - 0.5) * 0.05 * G;
      o.c[0] = b; o.c[1] = b * 0.98; o.c[2] = b * 0.94;
      o.h = h; o.r = 0.85;
    };
  },

  sand(q) {
    const n = fbm(101, 4, 4, 4);
    const w = fbm(102, 3, 3, 3);
    return (u, v, x, y, o) => {
      const rip = 0.5 + 0.5 * Math.sin((v * 16 + w(u, v) * 5) * Math.PI * 2);
      let b = 0.8 + (n(u, v) - 0.5) * 0.18 + rip * 0.05;
      if (!q.smooth) b += (hash2(x, y, 13) - 0.5) * 0.1 * G;
      o.c[0] = b; o.c[1] = b * 0.9; o.c[2] = b * 0.7;
      o.h = rip * 0.6 + n(u, v) * 0.3; o.r = 0.95;
    };
  },

  snow(q) {
    const n = fbm(111, 4, 4, 4);
    return (u, v, x, y, o) => {
      let b = 0.93 + (n(u, v) - 0.5) * 0.1;
      if (!q.smooth && hash2(x, y, 14) > 0.995) b = 1;
      o.c[0] = b * 0.97; o.c[1] = b * 0.985; o.c[2] = b;
      o.h = n(u, v); o.r = 0.65;
    };
  },

  foliage(q) {
    const n = fbm(121, 8, 8, q.smooth ? 3 : 5);
    return (u, v, x, y, o) => {
      const t = n(u, v);
      const leaf = smooth(0.45, 0.6, t);
      const b = 0.45 + leaf * 0.45 + (q.smooth ? 0 : (hash2(x, y, 15) - 0.5) * 0.1 * G);
      o.c[0] = b * 0.8; o.c[1] = b; o.c[2] = b * 0.6;
      o.h = t; o.r = 0.8;
    };
  },

  barrel(q) {
    const n = fbm(131, 4, 4, q.smooth ? 2 : 4);
    const rust = fbm(132, 6, 6, 4);
    return (u, v, x, y, o) => {
      let b = 0.82 + (n(u, v) - 0.5) * 0.1, h = 0.5;
      for (const r of [0.05, 0.33, 0.66, 0.95]) {
        const d = Math.abs(v - r);
        if (d < 0.025) { h = 0.5 + 0.5 * Math.cos((d / 0.025) * Math.PI / 2); b *= 0.9 + h * 0.15; }
      }
      const ru = q.smooth ? 0 : smooth(0.6, 0.72, rust(u, v));
      o.c[0] = mix(b, 0.4, ru); o.c[1] = mix(b, 0.24, ru); o.c[2] = mix(b, 0.14, ru);
      o.h = h; o.r = mix(0.45, 0.9, ru); o.m = 1 - ru;
    };
  },
  // Big, calm brick: fewer, longer bricks, low colour spread, thin dark
  // mortar. Reads as brick from a distance without the busy pattern.
  brick(q) {
    const ROWS = 10, PER = 3;
    const n = fbm(151, 8, 8, q.smooth ? 2 : 4);
    const dirt = fbm(152, 2, 2, 3);
    return (u, v, x, y, o) => {
      const ry = v * ROWS, row = Math.floor(ry), fy = ry - row;
      const rx = u * PER + (row % 2 ? 0.5 : 0), col = Math.floor(rx), fx = rx - col;
      const id = hash2(((col % PER) + PER) % PER, row, 17);
      const edge = Math.min(Math.min(fx, 1 - fx) / 0.03, Math.min(fy, 1 - fy) / 0.08);
      const dd = (dirt(u, v) - 0.5) * 0.12;
      if (edge < 1) {
        const m = 0.5 + dd;
        o.c[0] = m * 1.1; o.c[1] = m * 0.82; o.c[2] = m * 0.66;
        o.h = 0.3 * edge; o.r = 0.95;
      } else {
        const k = 0.93 + id * 0.12;
        const g = (n(u, v) - 0.5) * 0.08;
        o.c[0] = (0.6 + g) * k + dd; o.c[1] = (0.36 + g * 0.7) * k + dd * 0.7; o.c[2] = (0.27 + g * 0.5) * k + dd * 0.6;
        o.h = 0.7 + smooth(1, 2, edge) * 0.2; o.r = 0.85;
      }
    };
  },
};

// Metres per texture repeat, and whether the UVs are per box face (0..1).
export const SURFACES = {
  concrete: { tile: 3 },
  brick: { tile: 2.4 },
  metal: { tile: 2 },
  corrugated: { tile: 2.4 },
  crate: { tile: 1, boxUV: true },
  planks: { tile: 2 },
  stone: { tile: 2.4 },
  asphalt: { tile: 6 },
  paving: { tile: 4 },
  sand: { tile: 5 },
  snow: { tile: 5 },
  foliage: { tile: 2 },
  barrel: { tile: 1, boxUV: true },
};

const _cache = new Map();

// Build the textures for one surface at a style's quality. Returns
// { map, normalMap, roughnessMap, mean: THREE.Color (linear), ms }.
export function surfaceTextures(name, q) {
  const key = `${name}|${q.size}|${q.grain}|${q.smooth}|${q.posterize ?? 0}|${q.normal}|${q.nearest}`;
  if (_cache.has(key)) return _cache.get(key);
  const t0 = performance.now();
  const S = q.size;
  G = q.grain ?? 1;
  const f = GEN[name](q);
  const col = new Uint8ClampedArray(S * S * 4);
  const hgt = new Float32Array(S * S);
  const rgh = new Uint8ClampedArray(S * S * 4);
  const o = { c: [0, 0, 0], h: 0, r: 0, m: 0 };
  let sr = 0, sg = 0, sb = 0;
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      o.m = 0;
      // v runs up the texture (world y up on walls).
      f((x + 0.5) / S, 1 - (y + 0.5) / S, x, y, o);
      let r = clamp01(o.c[0]), g = clamp01(o.c[1]), b = clamp01(o.c[2]);
      if (q.posterize) {
        const L = q.posterize;
        r = Math.round(r * L) / L; g = Math.round(g * L) / L; b = Math.round(b * L) / L;
      }
      const i = y * S + x;
      col[i * 4] = r * 255; col[i * 4 + 1] = g * 255; col[i * 4 + 2] = b * 255; col[i * 4 + 3] = 255;
      sr += toLin(r); sg += toLin(g); sb += toLin(b);
      hgt[i] = o.h;
      rgh[i * 4] = 255; rgh[i * 4 + 1] = clamp01(o.r) * 255; rgh[i * 4 + 2] = clamp01(o.m) * 255; rgh[i * 4 + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = q.nearest ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
    t.magFilter = q.nearest ? THREE.NearestFilter : THREE.LinearFilter;
    t.anisotropy = q.aniso ?? 4;
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const out = { map: mk(new Uint8Array(col.buffer), true), mean: new THREE.Color(sr / (S * S), sg / (S * S), sb / (S * S)) };
  if (q.normal) {
    const nrm = new Uint8Array(S * S * 4);
    const k = (q.normalStrength ?? 3) * (S / 256);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const at = (xx, yy) => hgt[((yy + S) % S) * S + ((xx + S) % S)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * k;
        const dy = (at(x, y - 1) - at(x, y + 1)) * k; // texture v is flipped vs rows
        const l = Math.hypot(dx, dy, 1);
        const i = (y * S + x) * 4;
        nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
        nrm[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
        nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
        nrm[i + 3] = 255;
      }
    }
    out.normalMap = mk(nrm, false);
    out.roughnessMap = mk(new Uint8Array(rgh.buffer), false);
  }
  out.ms = performance.now() - t0;
  out.bytes = S * S * 4 * (q.normal ? 3 : 1) * 1.33;
  _cache.set(key, out);
  return out;
}

// Which surface a map box gets.
export function classify(b, map) {
  if (b.kind === 'crate') return 'crate';
  if (b.kind === 'barrel') return 'barrel';
  if (b.kind === 'container') return 'corrugated';
  if (b.kind === 'ground') return groundSurface(map);
  const m = b.material;
  const c = new THREE.Color(b.color);
  const hsl = {};
  c.getHSL(hsl);
  if (m === 'foliage' || m === 'leaves' || (hsl.h > 0.2 && hsl.h < 0.45 && hsl.s > 0.25)) return 'foliage';
  if (m === 'wood') return 'planks';
  if (m === 'metal' || m === 'grate' || m === 'duct') return 'metal';
  if (m === 'stone' || m === 'rock' || m === 'cliff') return 'stone';
  if (m === 'snow' || m === 'ice') return 'snow';
  if (m === 'sand' || m === 'dirt') return groundSurface(map);
  if (m === 'concrete') {
    // Reddish-brown walls read as brick.
    if (hsl.h < 0.08 && hsl.s > 0.3 && hsl.l < 0.55 && hsl.l > 0.2) return 'brick';
    return 'concrete';
  }
  return 'concrete';
}

export function groundSurface(map) {
  switch (map.id) {
    case 'dunes': return 'sand';
    case 'frost': return 'snow';
    case 'depot': case 'warehouse': return 'asphalt';
    default: return 'paving';
  }
}
