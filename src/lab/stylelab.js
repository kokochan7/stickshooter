// PROTOTYPE: graphics style lab. Renders a map spot in one of several
// candidate looks so they can be compared side by side and benchmarked.
//   /lab.html?map=depot&spot=0&style=pbr
// Not part of the game build.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getMap } from '../maps/index.js';
import { Stickman } from '../client/stickman.js';
import { surfaceTextures, classify, groundSurface, SURFACES } from '../client/surfaces.js';

export const STYLES = {
  current: { label: 'A · Current (flat)' },
  retro: {
    label: 'B · Classic textured',
    tex: { size: 128, posterize: 28, nearest: true, aniso: 1, grain: 0.12 },
    mat: 'lambert', shadows: 0, tone: false, vertexAO: 0.55, bevel: 0.12, bevelW: 0.03,
  },
  stylized: {
    label: 'C · Stylized realistic',
    tex: { size: 256, smooth: true, aniso: 4 },
    mat: 'lambert', shadows: 1024, tone: true, exposure: 1.15, shaderAO: true, bevel: 0.35, bevelW: 0.06,
  },
  pbr: {
    label: 'D · Realistic PBR',
    tex: { size: 512, normal: true, normalStrength: 2.5, aniso: 8 },
    mat: 'standard', shadows: 2048, tone: true, exposure: 1.0, env: true, shaderAO: true, bevel: 0.14, bevelW: 0.025,
  },
  cinematic: {
    label: 'E · Realistic + cinematic',
    tex: { size: 512, normal: true, normalStrength: 2.5, aniso: 8 },
    mat: 'standard', shadows: 4096, tone: true, exposure: 1.0, env: true, shaderAO: true, post: true, bevel: 0.14, bevelW: 0.025,
  },
};

// Camera spots, in the map's unscaled metres (scaled by k below):
// eye, look-at, and stickmen [x, z, yawToCamera?, gun].
const SPOTS = {
  depot: { k: 1.5, spots: [
    { name: 'inside', eye: [3, 1.65, -10.2], at: [-4, 1.3, -26], men: [[0.5, -15, 'ak47'], [-4.5, -20.5, 'm4a1']] },
    { name: 'yard', eye: [4, 1.65, 6], at: [0, 2.6, -8], men: [[2.5, 1, 'ak47'], [-2, -3.5, 'awp']] },
    { name: 'rail', eye: [-41, 1.65, 34], at: [-44, 1.8, 0], men: [[-42, 26, 'm4a1']] },
  ] },
  warehouse: { k: 1.4, spots: [
    { name: 'inside', eye: [16, 1.65, -9], at: [0, 2, -28], men: [[11, -16, 'ak47'], [5, -22, 'm4a1']] },
  ] },
  dunes: { k: 1.5, spots: [
    { name: 'open', eye: [30, 1.65, 0], at: [13, 1, 20], men: [[26, 5, 'ak47'], [20, 11, 'awp']] },
  ] },
};

const qs = new URLSearchParams(location.search);
const mapId = qs.get('map') ?? 'depot';
const styleId = qs.get('style') ?? 'pbr';
const spotIdx = +(qs.get('spot') ?? 0);
const style = STYLES[styleId];
const map = getMap(mapId);
const spotDef = { ...SPOTS[mapId].spots[spotIdx] };
if (qs.has('eye')) { spotDef.eye = qs.get('eye').split(',').map(Number); spotDef.at = qs.get('at').split(',').map(Number); spotDef.men = []; }
const K = SPOTS[mapId].k;
const SUN_DIR = styleId === 'current' ? new THREE.Vector3(0.45, 1, 0.3).normalize() : new THREE.Vector3(0.5, 0.75, 0.32).normalize();

const canvas = document.getElementById('c');
document.getElementById('tag').textContent = qs.has('tag') ? style.label : '';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const W = +(qs.get('w') ?? innerWidth), H = +(qs.get('h') ?? innerHeight);
renderer.setPixelRatio(+(qs.get('dpr') ?? 1));
renderer.setSize(W, H, false);
if (style.tone) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = style.exposure ?? 1;
}
if (style.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, W / H, 0.04, 500);
const eye = new THREE.Vector3(spotDef.eye[0] * K, spotDef.eye[1], spotDef.eye[2] * K);
camera.position.copy(eye);
camera.lookAt(spotDef.at[0] * K, spotDef.at[1], spotDef.at[2] * K);

// ---------- Sky ----------
const skyTop = new THREE.Color(map.sky.top), skyBottom = new THREE.Color(map.sky.bottom);
const sunCol = new THREE.Color(0xffffff).lerp(skyBottom, styleId === 'current' ? 0 : 0.35);
function makeSky(withSun) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: skyTop }, bottom: { value: skyBottom }, sunDir: { value: SUN_DIR }, sunCol: { value: sunCol }, sun: { value: withSun ? 1 : 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sun; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y * 1.6 + 0.1, 0.0, 1.0);
        vec3 c = mix(bottom, top, sun > 0.5 ? pow(h, 0.7) : h);
        if (sun > 0.5) {
          float s = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
          c = mix(c, bottom * 1.05, pow(1.0 - abs(d.y), 8.0) * 0.5);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
}
const sky = makeSky(styleId !== 'current' && styleId !== 'retro');
scene.add(sky);
scene.fog = styleId === 'pbr' || styleId === 'cinematic'
  ? new THREE.FogExp2(skyBottom.clone(), 0.0065)
  : new THREE.Fog(skyBottom.clone(), 70, 220);

// ---------- Lights ----------
let sun;
if (styleId === 'current' || styleId === 'retro') {
  scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x9a8a72, 1.7));
  sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
} else if (styleId === 'stylized') {
  scene.add(new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color(0xffffff), 0.6), 0x8a7a62, 1.5));
  sun = new THREE.DirectionalLight(sunCol, 2.6);
} else {
  scene.add(new THREE.HemisphereLight(skyTop.clone().lerp(new THREE.Color(0xffffff), 0.5), 0x6a5d4c, 0.55));
  sun = new THREE.DirectionalLight(sunCol, 3.4);
}
sun.position.copy(SUN_DIR).multiplyScalar(80).add(eye);
sun.target.position.copy(eye);
scene.add(sun, sun.target);
if (style.shadows) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(style.shadows, style.shadows);
  const R = 55;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
}

// Image-based light from the sky itself, for metal and glossy surfaces.
if (style.env) {
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky(true));
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(map.groundColor).multiplyScalar(0.5) }));
  gnd.position.y = -2;
  envScene.add(gnd);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.6;
}

// ---------- Map ----------
let genMs = 0, texBytes = 0;
const isTex = !!style.tex;

// The game's current grid texture and vertex-shaded boxes, for style A.
function gridTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 236 + Math.random() * 19;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texBytes += S * S * 4 * 1.33;
  return t;
}

const _c = new THREE.Color();
function boxGeometry(list, surf, mean, aoStrength) {
  const geos = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tile = surf ? SURFACES[surf].tile : 1, boxUV = surf && SURFACES[surf].boxUV;
  for (const b of list) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    // Face-local position in metres + face size, for the edge bevel.
    const fe = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const nx = Math.abs(nrm[i * 3]), ny = Math.abs(nrm[i * 3 + 1]);
      const fw = nx > 0.5 ? d : w, fh = ny > 0.5 ? d : h;
      fe[i * 4] = uv[i * 2] * fw; fe[i * 4 + 1] = uv[i * 2 + 1] * fh; fe[i * 4 + 2] = fw; fe[i * 4 + 3] = fh;
    }
    g.setAttribute('faceEdge', new THREE.BufferAttribute(fe, 4));
    _c.setHex(b.color);
    if (mean) { _c.r = Math.min(3, _c.r / mean.r); _c.g = Math.min(3, _c.g / mean.g); _c.b = Math.min(3, _c.b / mean.b); }
    const tint = 0.96 + rand() * 0.08;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1];
      if (!boxUV) {
        // World-space UVs, `tile` metres per repeat (keeps the texel size
        // the same on every box). Offset per box so tiles don't line up.
        if (Math.abs(nx) > 0.5) { uv[i * 2] = z / tile; uv[i * 2 + 1] = y / tile; }
        else if (Math.abs(ny) > 0.5) { uv[i * 2] = x / tile; uv[i * 2 + 1] = z / tile; }
        else { uv[i * 2] = x / tile; uv[i * 2 + 1] = y / tile; }
      }
      let shade = 1;
      if (aoStrength) {
        shade = ny > 0.5 ? 1.06 : ny < -0.5 ? 0.6 : 0.94;
        if (ny > 0.5) { /* tops stay bright */ }
        else if (y < 0.05) shade *= aoStrength;
        else if (y < 0.4 && ny === 0) shade *= aoStrength + (y / 0.4) * (1 - aoStrength);
      }
      col[i * 3] = _c.r * shade * tint;
      col[i * 3 + 1] = _c.g * shade * tint;
      col[i * 3 + 2] = _c.b * shade * tint;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Sky occlusion: a top-down map of the highest box top per 25 cm cell.
// A fragment below the cover over it is indoors: the sky and environment
// light fade out there and a dim warm fill takes over. One texture read,
// no baking step, works on every map.
const CELL = 0.25;
const coverX0 = map.bounds.min[0] - 2, coverZ0 = map.bounds.min[1] - 2;
const coverW = Math.ceil((map.bounds.max[0] - coverX0 + 2) / CELL), coverH = Math.ceil((map.bounds.max[1] - coverZ0 + 2) / CELL);
const coverData = new Float32Array(coverW * coverH);
for (const b of map.boxes) {
  if (b.render === false || b.kind === 'ground') continue;
  const i0 = Math.max(0, Math.floor((b.min[0] - coverX0) / CELL)), i1 = Math.min(coverW - 1, Math.ceil((b.max[0] - coverX0) / CELL) - 1);
  const j0 = Math.max(0, Math.floor((b.min[2] - coverZ0) / CELL)), j1 = Math.min(coverH - 1, Math.ceil((b.max[2] - coverZ0) / CELL) - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * coverW + i;
    if (b.max[1] > coverData[k]) coverData[k] = b.max[1];
  }
}
const coverTex = new THREE.DataTexture(coverData, coverW, coverH, THREE.RedFormat, THREE.FloatType);
coverTex.magFilter = coverTex.minFilter = THREE.NearestFilter;
coverTex.needsUpdate = true;
const coverUniforms = {
  coverMap: { value: coverTex },
  coverRect: { value: new THREE.Vector4(coverX0, coverZ0, coverW * CELL, coverH * CELL) },
  indoorFill: { value: new THREE.Color(0.95, 0.9, 0.8).multiplyScalar(styleId === 'retro' ? 1.6 : styleId === 'stylized' ? 1.45 : 1.15) },
};

// Per-pixel extras for the textured styles: contact darkening at the foot of
// walls, and the indoor lighting from the cover map.
function addShaderAO(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, coverUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON; attribute vec4 faceEdge; varying vec4 vFE;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal; vFE = faceEdge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; varying vec3 vON; varying vec4 vFE;
        uniform sampler2D coverMap; uniform vec4 coverRect; uniform vec3 indoorFill;
        float coverAt(vec2 p) { return texture2D(coverMap, (p - coverRect.xy) / coverRect.zw).r; }
        float skyVis() {
          vec2 p = vOP.xz + vON.xz * 0.3;
          float y = vOP.y + max(vON.y, 0.0) * 0.05;
          float v = 0.0;
          // 5 taps: soft edges at skylights and doorways.
          v += step(coverAt(p), y + 0.3);
          v += step(coverAt(p + vec2(0.6, 0.0)), y + 0.3);
          v += step(coverAt(p - vec2(0.6, 0.0)), y + 0.3);
          v += step(coverAt(p + vec2(0.0, 0.6)), y + 0.3);
          v += step(coverAt(p - vec2(0.0, 0.6)), y + 0.3);
          return v / 5.0;
        }
        // How enclosed the area around is (8 taps 2.5 m out): skylight and
        // doorway patches indoors keep the indoor fill on top of the sky.
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
          // Worn, rounded box edges catch light: a thin bright rim.
          float ed = min(min(vFE.x, vFE.z - vFE.x), min(vFE.y, vFE.w - vFE.y));
          diffuseColor.rgb *= 1.0 + ${(style.bevel ?? 0).toFixed(2)} * (1.0 - smoothstep(0.0, ${(style.bevelW ?? 0.04).toFixed(3)}, ed));
        }
        ${style.vertexAO ? '' : `if (abs(vON.y) < 0.5) diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.7, vOP.y));
        `}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float sv = skyVis();
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * mix(0.12, 1.0, sv) + indoorFill * BRDF_Lambert(diffuseColor.rgb) * max(1.0 - sv, enclosed());
        ${style.mat === 'standard' ? 'reflectedLight.indirectSpecular *= mix(0.15, 1.0, sv);' : ''}`);
  };
}

function material(surf, tx) {
  let m;
  if (style.mat === 'standard') {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx.map, normalMap: tx.normalMap, roughnessMap: tx.roughnessMap, metalnessMap: tx.roughnessMap, roughness: 1, metalness: surf === 'metal' || surf === 'corrugated' || surf === 'barrel' ? 0.55 : 0 });
  } else {
    m = new THREE.MeshLambertMaterial({ vertexColors: true, map: tx.map });
  }
  addShaderAO(m);
  return m;
}

const mapGroup = new THREE.Group();
scene.add(mapGroup);
const visible = map.boxes.filter((b) => b.render !== false);
const reach = Math.max(...map.bounds.min.map(Math.abs), ...map.bounds.max.map(Math.abs));
const gsize = Math.ceil(reach * 2 + 60);
if (!isTex) {
  const tex = gridTexture();
  mapGroup.add(new THREE.Mesh(boxGeometry(visible, null, null, 0.72), new THREE.MeshLambertMaterial({ vertexColors: true, map: tex })));
  const gg = new THREE.PlaneGeometry(gsize, gsize).rotateX(-Math.PI / 2);
  const uv = gg.attributes.uv.array; for (let i = 0; i < uv.length; i++) uv[i] *= gsize;
  mapGroup.add(new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ color: map.groundColor, map: tex })));
} else {
  const groups = new Map();
  for (const b of visible) {
    const s = classify(b, map);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(b);
  }
  const gs = groundSurface(map);
  const used = new Set([...groups.keys(), gs]);
  const txs = {};
  for (const s of used) {
    txs[s] = surfaceTextures(s, style.tex);
    genMs += txs[s].ms;
    texBytes += txs[s].bytes;
  }
  for (const [s, list] of groups) {
    const mesh = new THREE.Mesh(boxGeometry(list, s, txs[s].mean, style.vertexAO), material(s, txs[s]));
    mesh.castShadow = mesh.receiveShadow = true;
    mapGroup.add(mesh);
  }
  if (!map.water?.length) {
    const tile = SURFACES[gs].tile;
    const gg = new THREE.PlaneGeometry(gsize, gsize).rotateX(-Math.PI / 2);
    const uv = gg.attributes.uv.array; for (let i = 0; i < uv.length; i++) uv[i] *= gsize / tile;
    const gc = new THREE.Color(map.groundColor), mean = txs[gs].mean;
    const m = material(gs, txs[gs]);
    m.vertexColors = false;
    m.color = new THREE.Color(Math.min(3, gc.r / mean.r), Math.min(3, gc.g / mean.g), Math.min(3, gc.b / mean.b));
    const ground = new THREE.Mesh(gg, m);
    ground.receiveShadow = true;
    mapGroup.add(ground);
  }
}

// ---------- Stickmen ----------
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
for (const [x, z, gun] of spotDef.men) {
  const man = new Stickman({ body: 0xffffff, eyes: 0x15171a, outline: 0x22252b });
  man.setWeapon(gun);
  const px = x * K, pz = z * K;
  const yaw = Math.atan2(eye.x - px, eye.z - pz) + 0.5;
  man.update({ x: px, y: 0, z: pz, yaw, pitch: 0, vx: 0, vz: 0, duck: 0, onGround: true, reloading: false, spin: 0 }, 0.016);
  man.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(man.root);
  if (!style.shadows) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    s.position.set(px, 0.01, pz);
    scene.add(s);
  }
}

// ---------- Post ----------
let composer = null;
if (style.post) {
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, W, H);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
  ao.blendIntensity = 1.0;
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.25, 0.5, 0.9));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, 1.08);                       // a touch more saturation
        c = c * vec3(1.02, 1.0, 0.97);                  // warm grade
        float v = smoothstep(1.15, 0.35, length(vUv - 0.5) * 1.4);
        gl_FragColor = vec4(c * mix(0.78, 1.0, v), 1.0);
      }`,
  }));
}

function frame() {
  if (composer) composer.render(); else renderer.render(scene, camera);
}
frame();
frame();

// Benchmark: render n frames, forcing the GPU to finish each one.
const gl = renderer.getContext();
const px = new Uint8Array(4);
window.__bench = (n = 30) => {
  frame();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const ms = (performance.now() - t0) / n;
  return { style: styleId, ms, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length, texMB: texBytes / 1048576, genMs };
};
window.__ready = true;
