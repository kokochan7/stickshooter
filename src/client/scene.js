// Renderer, map geometry, sky and character views.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Stickman } from './stickman.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { buildGun } from './gunModels.js';

function gridTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  // Soft noise.
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 236 + Math.random() * 19;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  // Panel lines.
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeStyle = 'rgba(0,0,0,0.06)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 0); g.lineTo(S / 2, S);
  g.moveTo(0, S / 2); g.lineTo(S, S / 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _c = new THREE.Color();

function buildMapGeometry(boxes) {
  const geos = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const b of boxes) {
    if (b.render === false) continue;
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array, uv = g.attributes.uv.array;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.setHex(b.color);
    const tint = 0.96 + rand() * 0.08;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1];
      // World-space UVs: 1 texture tile per meter.
      if (Math.abs(nx) > 0.5) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
      else if (Math.abs(ny) > 0.5) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
      else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
      // Fake ambient occlusion near the floor + face shading.
      let shade = ny > 0.5 ? 1.06 : ny < -0.5 ? 0.6 : 0.94;
      if (y < 0.05) shade *= 0.72;
      else if (y < 0.4 && ny === 0) shade *= 0.72 + (y / 0.4) * 0.28;
      col[i * 3] = _c.r * shade * tint;
      col[i * 3 + 1] = _c.g * shade * tint;
      col[i * 3 + 2] = _c.b * shade * tint;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

export class GameView {
  constructor(canvas, map, world, settings) {
    this.settings = settings;
    this.map = map;
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const skyBottom = new THREE.Color(map.sky.bottom);
    this.scene.fog = new THREE.Fog(skyBottom, 70, 220);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.04, 500);
    this.camera.rotation.order = 'YXZ';

    // Sky dome.
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(map.sky.top) }, bottom: { value: skyBottom } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.1, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), skyMat);
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x9a8a72, 1.7));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    sun.position.set(0.45, 1, 0.3);
    this.scene.add(sun);

    // Map.
    const tex = gridTexture();
    const mapMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    this.mapMesh = new THREE.Mesh(buildMapGeometry(map.boxes), mapMat);
    this.scene.add(this.mapMesh);
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    groundGeo.rotateX(-Math.PI / 2);
    const uv = groundGeo.attributes.uv.array;
    for (let i = 0; i < uv.length; i++) uv[i] *= 160;
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: map.groundColor, map: tex }));
    this.scene.add(ground);

    this.effects = new Effects(this.scene, world);
    this.viewModel = new ViewModel(1);

    this.shadowGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.views = new Map();
    this.dropViews = new Map(); // drop id -> gun model lying on the ground

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    this.effects.points.material.uniforms.scale.value = (h * ratio) / (2 * Math.tan(fovRad / 2));
  }

  setFov(fov) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    const fovRad = (fov * Math.PI) / 180;
    this.effects.points.material.uniforms.scale.value = (this.renderer.domElement.height) / (2 * Math.tan(fovRad / 2));
  }

  viewFor(p) {
    let v = this.views.get(p.id);
    if (!v) {
      // White stickman until skins arrive; Teams mode tints it (setTeam).
      const man = new Stickman({ body: 0xffffff, eyes: 0x15171a, outline: 0x22252b });
      man.setTeam(p.team);
      this.scene.add(man.root);
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      this.scene.add(shadow);
      v = { man, shadow, wasAlive: false };
      this.views.set(p.id, v);
    }
    return v;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.man.root);
    this.scene.remove(v.shadow);
    this.views.delete(id);
  }

  // Guns on the ground: lying on their side, spinning while they fall, and
  // blinking for the last two seconds before they vanish.
  syncDrops(drops, time) {
    const seen = new Set();
    for (const d of drops) {
      seen.add(d.id);
      let g = this.dropViews.get(d.id);
      if (!g) {
        g = buildGun(d.weapon.id).group;
        g.rotation.order = 'YXZ';
        this.scene.add(g);
        this.dropViews.set(d.id, g);
      }
      g.position.set(d.pos[0], d.pos[1] + 0.03, d.pos[2]);
      g.rotation.set(d.rest ? 0 : time * 9, d.yaw, Math.PI / 2);
      const left = d.expiresAt - time;
      g.visible = left > 2 || Math.floor(left * 8) % 2 === 0;
    }
    for (const [id, g] of this.dropViews) {
      if (!seen.has(id)) { this.scene.remove(g); this.dropViews.delete(id); }
    }
  }

  groundBelow(x, y, z) {
    const h = this.world.raycast(x, y + 0.2, z, 0, -1, 0, 30);
    return h ? y + 0.2 - h.t : 0;
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.viewModel.rig.visible) {
      r.clearDepth();
      r.render(this.viewModel.scene, this.viewModel.camera);
    }
  }
}
