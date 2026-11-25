// The map's look: "Stylized realistic" without shadows (Kenny's pick,
// 2026-11-25; it replaced "Classic textured"). Boxes are grouped by surface
// (brick, concrete, metal, crate, ...) and drawn with soft, painted-style
// procedural textures (src/client/surfaces.js). Map palette colours still set each box's overall colour: a box's
// vertex colour is its palette colour divided by its texture's mean.
// Two cheap shader extras per pixel:
//   - a light rim on box edges (worn, rounded edges)
//   - contact darkening at the foot of walls
//   - sky occlusion from a top-down "cover map" (highest box top per 25 cm
//     cell): under a roof the sky light fades and a warm indoor fill takes
//     over, so interiors read as interiors with no light baking.
// No shadow maps, no post-processing: about the same GPU cost as the old
// flat look. Tone mapping (ACES) is set on the renderer in scene.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceTextures, classify, groundSurface, SURFACES } from './surfaces.js';

export const TEX_QUALITY = { size: 256, smooth: true, aniso: 4 };
const BEVEL = 0.35, BEVEL_W = 0.06; // edge rim: brightness, width in metres
const INDOOR_FILL = new THREE.Color(0.95, 0.9, 0.8).multiplyScalar(1.45);
const CELL = 0.25;

const _c = new THREE.Color();

function boxGeometry(list, surf, mean) {
  const geos = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const { tile, boxUV } = SURFACES[surf];
  for (const b of list) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    // Face-local position in metres + face size, for the edge rim.
    const fe = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const nx = Math.abs(nrm[i * 3]), ny = Math.abs(nrm[i * 3 + 1]);
      const fw = nx > 0.5 ? d : w, fh = ny > 0.5 ? d : h;
      fe[i * 4] = uv[i * 2] * fw; fe[i * 4 + 1] = uv[i * 2 + 1] * fh; fe[i * 4 + 2] = fw; fe[i * 4 + 3] = fh;
    }
    g.setAttribute('faceEdge', new THREE.BufferAttribute(fe, 4));
    _c.setHex(b.color);
    _c.r = Math.min(3, _c.r / mean.r); _c.g = Math.min(3, _c.g / mean.g); _c.b = Math.min(3, _c.b / mean.b);
    const tint = 0.96 + rand() * 0.08;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1];
      if (!boxUV) {
        // World-space UVs, `tile` metres per repeat, so texels are the same
        // size on every box. Crates and barrels use per-face UVs instead.
        if (Math.abs(nx) > 0.5) { uv[i * 2] = z / tile; uv[i * 2 + 1] = y / tile; }
        else if (Math.abs(ny) > 0.5) { uv[i * 2] = x / tile; uv[i * 2 + 1] = z / tile; }
        else { uv[i * 2] = x / tile; uv[i * 2 + 1] = y / tile; }
      }
      const shade = 1; // contact shading is per pixel in the shader
      col[i * 3] = _c.r * shade * tint;
      col[i * 3 + 1] = _c.g * shade * tint;
      col[i * 3 + 2] = _c.b * shade * tint;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Highest box top per CELL, over the map bounds (+2 m).
function coverMap(map) {
  const x0 = map.bounds.min[0] - 2, z0 = map.bounds.min[1] - 2;
  const W = Math.ceil((map.bounds.max[0] - x0 + 2) / CELL), H = Math.ceil((map.bounds.max[1] - z0 + 2) / CELL);
  const data = new Float32Array(W * H);
  for (const b of map.boxes) {
    if (b.render === false || b.kind === 'ground') continue;
    const i0 = Math.max(0, Math.floor((b.min[0] - x0) / CELL)), i1 = Math.min(W - 1, Math.ceil((b.max[0] - x0) / CELL) - 1);
    const j0 = Math.max(0, Math.floor((b.min[2] - z0) / CELL)), j1 = Math.min(H - 1, Math.ceil((b.max[2] - z0) / CELL) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      if (b.max[1] > data[k]) data[k] = b.max[1];
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, rect: new THREE.Vector4(x0, z0, W * CELL, H * CELL) };
}

function patchShader(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON; attribute vec4 faceEdge; varying vec4 vFE;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal; vFE = faceEdge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; varying vec3 vON; varying vec4 vFE;
        uniform sampler2D coverMap; uniform vec4 coverRect; uniform vec3 indoorFill;
        float coverAt(vec2 p) { return texture2D(coverMap, (p - coverRect.xy) / coverRect.zw).r; }
        // 1 under open sky, 0 under cover; 5 taps soften skylight and door edges.
        float skyVis() {
          vec2 p = vOP.xz + vON.xz * 0.3;
          float y = vOP.y + max(vON.y, 0.0) * 0.05 + 0.3;
          float v = step(coverAt(p), y);
          v += step(coverAt(p + vec2(0.6, 0.0)), y);
          v += step(coverAt(p - vec2(0.6, 0.0)), y);
          v += step(coverAt(p + vec2(0.0, 0.6)), y);
          v += step(coverAt(p - vec2(0.0, 0.6)), y);
          return v / 5.0;
        }
        // How enclosed the area around is (8 taps 2.5 m out), so skylight
        // and doorway patches indoors keep the indoor fill too.
        float enclosed() {
          vec2 p = vOP.xz + vON.xz * 0.3;
          float y = vOP.y + 0.35, e = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            e += 1.0 - step(coverAt(p + vec2(cos(a), sin(a)) * 2.5), y);
          }
          return e / 8.0;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vFE.z > 0.0) {
          float ed = min(min(vFE.x, vFE.z - vFE.x), min(vFE.y, vFE.w - vFE.y));
          diffuseColor.rgb *= 1.0 + ${BEVEL.toFixed(2)} * (1.0 - smoothstep(0.0, ${BEVEL_W.toFixed(3)}, ed));
        }
        if (abs(vON.y) < 0.5) diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.7, vOP.y));`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float sv = skyVis();
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * mix(0.12, 1.0, sv)
          + indoorFill * BRDF_Lambert(diffuseColor.rgb) * max(1.0 - sv, enclosed());`);
  };
  // All map materials share one compiled program.
  mat.customProgramCacheKey = () => 'mapLook';
}

// The textured level: one mesh per surface, plus the big ground plane
// (the riverbed on maps with water). Textures are cached across maps
// (userData.shared) and must not be disposed.
export function buildMapLook(map, { groundY = 0, groundColor = map.groundColor } = {}) {
  const grp = new THREE.Group();
  const cover = coverMap(map);
  const uniforms = { coverMap: { value: cover.tex }, coverRect: { value: cover.rect }, indoorFill: { value: INDOOR_FILL } };
  grp.userData.cover = cover.tex;
  const material = (tx) => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: tx.map });
    patchShader(m, uniforms);
    return m;
  };
  const groups = new Map();
  for (const b of map.boxes) {
    if (b.render === false) continue;
    const s = classify(b, map);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(b);
  }
  const gs = groundSurface(map);
  const tex = (s) => {
    const t = surfaceTextures(s, TEX_QUALITY);
    t.map.userData.shared = true;
    return t;
  };
  for (const [s, list] of groups) {
    const t = tex(s);
    grp.add(new THREE.Mesh(boxGeometry(list, s, t.mean), material(t)));
  }
  const reach = Math.max(...map.bounds.min.map(Math.abs), ...map.bounds.max.map(Math.abs));
  const size = Math.ceil(reach * 2 + 60);
  const tile = SURFACES[gs].tile;
  const gg = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const uv = gg.attributes.uv.array;
  for (let i = 0; i < uv.length; i++) uv[i] *= size / tile;
  const t = tex(gs);
  const gc = new THREE.Color(groundColor), mean = t.mean;
  const m = material(t);
  m.vertexColors = false;
  m.color.setRGB(Math.min(3, gc.r / mean.r), Math.min(3, gc.g / mean.g), Math.min(3, gc.b / mean.b));
  gg.translate(0, groundY, 0); // in the geometry: the shader reads object-space height
  grp.add(new THREE.Mesh(gg, m));
  return grp;
}
