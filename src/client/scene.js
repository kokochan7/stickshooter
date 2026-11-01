// Renderer, map geometry, sky and character views.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Stickman } from './stickman.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { buildGun } from './gunModels.js';
import { WATER_DEPTH } from '../maps/builder.js';

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

// Ripples for the water surface: soft light streaks that scroll slowly.
function waterTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,40,70,0.18)';
  g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    const y = Math.random() * S, x = Math.random() * S, w = 20 + Math.random() * 40;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y - 4, x + w, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ground decal: a painted zone outline with a big label (bomb sites, the
// hostage rescue zone).
function zoneTexture(label, color) {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.setLineDash([46, 26]);
  g.strokeRect(10, 10, W - 20, H - 20);
  g.setLineDash([]);
  g.fillStyle = color;
  g.font = `900 ${label.length > 2 ? 90 : 300}px Inter, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, W / 2, H / 2 + 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
      if (ny > 0.5) { /* floors and tops stay bright */ }
      else if (y < 0.05) shade *= 0.72;
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
    this.scene.fog = new THREE.Fog(0xffffff, 70, 220);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.04, 500);
    this.camera.rotation.order = 'YXZ';

    // Sky dome.
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
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

    this.tex = gridTexture();
    this.waterTex = waterTexture();
    this.mapGroup = null;

    this.effects = new Effects(this.scene, world);
    this.viewModel = new ViewModel(1);

    this.shadowGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.views = new Map();
    this.dropViews = new Map(); // drop id -> gun model lying on the ground
    this.hostageViews = new Map(); // hostage id -> { man, shadow }
    this.bombMesh = buildBomb();
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    this.setMap(map, world);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // Build (or rebuild, when the map changes) the level: merged box mesh,
  // ground, water, sky colors and the painted objective zones.
  setMap(map, world) {
    this.map = map;
    this.world = world;
    this.effects.world = world;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((o) => {
        o.geometry?.dispose();
        if (o.material && o.material.map !== this.tex && o.material.map !== this.waterTex) o.material.map?.dispose();
        o.material?.dispose?.();
      });
    }
    for (const id of [...this.hostageViews.keys()]) this.removeHostage(id);
    const grp = new THREE.Group();
    this.mapGroup = grp;
    this.scene.add(grp);

    const skyBottom = new THREE.Color(map.sky.bottom);
    this.scene.fog.color.copy(skyBottom);
    this.sky.material.uniforms.top.value.setHex(map.sky.top);
    this.sky.material.uniforms.bottom.value.copy(skyBottom);

    const mapMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex });
    grp.add(new THREE.Mesh(buildMapGeometry(map.boxes), mapMat));
    // Maps with water draw their ground as boxes (so the banks show) and the
    // big plane becomes the riverbed.
    const hasWater = map.water?.length > 0;
    // Big enough to reach past the walls of the largest map in every direction.
    const reach = Math.max(...map.bounds.min.map(Math.abs), ...map.bounds.max.map(Math.abs));
    const size = Math.ceil(reach * 2 + 60);
    const groundGeo = new THREE.PlaneGeometry(size, size);
    groundGeo.rotateX(-Math.PI / 2);
    const uv = groundGeo.attributes.uv.array;
    for (let i = 0; i < uv.length; i++) uv[i] *= size;
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: hasWater ? map.bedColor : map.groundColor, map: this.tex }));
    ground.position.y = hasWater ? -WATER_DEPTH : 0;
    grp.add(ground);

    if (hasWater) {
      const geos = map.water.map((w) => {
        const g = new THREE.PlaneGeometry(w.max[0] - w.min[0], w.max[1] - w.min[1]);
        g.rotateX(-Math.PI / 2);
        g.translate((w.min[0] + w.max[0]) / 2, w.y, (w.min[1] + w.max[1]) / 2);
        const u = g.attributes.uv.array, p = g.attributes.position.array;
        for (let i = 0; i < u.length / 2; i++) { u[i * 2] = p[i * 3] / 6; u[i * 2 + 1] = p[i * 3 + 2] / 6; }
        return g;
      });
      this.waterMat = new THREE.MeshLambertMaterial({ color: 0x3f93c4, map: this.waterTex, transparent: true, opacity: 0.72, depthWrite: false });
      const water = new THREE.Mesh(mergeGeometries(geos), this.waterMat);
      water.renderOrder = 1;
      grp.add(water);
    } else {
      this.waterMat = null;
    }

    // Painted zones: bomb sites and hostage rescue areas.
    const decal = (r, label, color) => {
      const w = r.max[0] - r.min[0], d = r.max[1] - r.min[1];
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ map: zoneTexture(label, color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.85 });
      const m = new THREE.Mesh(g, mat);
      m.position.set((r.min[0] + r.max[0]) / 2, this.floorAt((r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2) + 0.02, (r.min[1] + r.max[1]) / 2);
      grp.add(m);
    };
    for (const [name, r] of Object.entries(map.sites ?? {})) decal(r, name, '#e8b020');
    for (const r of map.rescue ?? []) decal(r, 'RESCUE', '#3fbf5f');
  }

  floorAt(x, z) {
    const h = this.world.raycast(x, 30, z, 0, -1, 0, 60);
    return h ? 30 - h.t : 0;
  }

  // Bomb and hostages, every frame.
  syncObjective(game, alpha, dt, hiddenId) {
    const b = game.bomb;
    const m = this.bombMesh;
    if (game.objective === 'bomb' && b.pos && (b.state === 'dropped' || b.state === 'planted' || b.state === 'defused')) {
      m.visible = true;
      m.position.set(b.pos[0], b.pos[1] + 0.01, b.pos[2]);
      // The light blinks faster as the timer runs down.
      const left = b.explodeAt - game.time;
      const rate = b.state === 'planted' ? 1 + 8 * (1 - Math.max(0, left) / 35) : 0;
      m.userData.light.material.color.setHex(b.state === 'planted' && Math.sin(game.time * rate * Math.PI * 2) > 0 ? 0xff2020 : b.state === 'defused' ? 0x20d040 : 0x501010);
    } else {
      m.visible = false;
    }
    // The carrier wears it on their back.
    for (const [id, v] of this.views) v.man.setBackpack?.(game.objective === 'bomb' && b.state === 'carried' && b.carrier === id && id !== hiddenId);

    const seen = new Set();
    for (const h of game.hostages) {
      if (h.state === 'rescued') continue;
      seen.add(h.id);
      let v = this.hostageViews.get(h.id);
      if (!v) {
        const man = new Stickman({ body: 0xf2c94c, eyes: 0x15171a, outline: 0x22252b });
        man.setWeapon(null);
        this.scene.add(man.root);
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        this.scene.add(shadow);
        v = { man, shadow, x: h.pos[0], y: h.pos[1], z: h.pos[2] };
        this.hostageViews.set(h.id, v);
      }
      // Smooth toward the sim position (it moves at 128 Hz locally, 32 Hz online).
      const k = Math.min(1, dt * 18);
      v.x += (h.pos[0] - v.x) * k; v.y += (h.pos[1] - v.y) * k; v.z += (h.pos[2] - v.z) * k;
      if (Math.hypot(h.pos[0] - v.x, h.pos[2] - v.z) > 3) { v.x = h.pos[0]; v.y = h.pos[1]; v.z = h.pos[2]; }
      v.man.update({ x: v.x, y: v.y, z: v.z, yaw: h.yaw, pitch: 0, vx: h.vel[0], vz: h.vel[2], duck: 0, onGround: true, reloading: false, spin: 0 }, dt);
      v.shadow.position.set(v.x, this.groundBelow(v.x, v.y, v.z) + 0.01, v.z);
    }
    for (const id of [...this.hostageViews.keys()]) if (!seen.has(id)) this.removeHostage(id);

    if (this.waterMat) {
      this.waterMat.map.offset.x = (game.time * 0.02) % 1;
      this.waterMat.map.offset.y = (game.time * 0.035) % 1;
    }
  }

  removeHostage(id) {
    const v = this.hostageViews.get(id);
    if (!v) return;
    this.scene.remove(v.man.root);
    this.scene.remove(v.shadow);
    this.hostageViews.delete(id);
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

// The bomb: a little brick of charges with a keypad and a blinking light.
function buildBomb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), new THREE.MeshLambertMaterial({ color: 0x8a6d46 }));
  body.position.y = 0.06;
  g.add(body);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.12), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
  pad.position.set(-0.06, 0.13, 0);
  g.add(pad);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0x501010 }));
  light.position.set(0.1, 0.135, 0.05);
  g.add(light);
  g.userData.light = light;
  return g;
}
