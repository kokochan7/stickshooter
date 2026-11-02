// Renderer, map geometry, sky and character views.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Stickman } from './stickman.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { buildGun } from './gunModels.js';
import { WATER_DEPTH } from '../maps/builder.js';
import { zoneFloor } from '../sim/world.js';

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

// Ground paint for a zone (bomb sites, the hostage rescue zone), sized to
// the zone so the letter isn't stretched: a black-and-colour hazard stripe
// border, a light wash inside, and the label big in the middle. For a bomb
// site, bomb is { x, z, r, x0, z0 }: the letter goes in a ring of radius ~r
// at (x, z) on the open floor, with a bomb icon and "BOMBSITE".
function zoneTexture(label, color, w, d, bomb) {
  const W = 1024, H = Math.max(256, Math.min(2048, Math.round(W * d / w)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const m = Math.min(W, H);
  // Wash.
  g.globalAlpha = 0.16;
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  // Hazard stripe border.
  const band = Math.round(m * 0.06);
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.rect(band, band, W - band * 2, H - band * 2);
  g.clip('evenodd');
  g.fillStyle = '#16120a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = color;
  const step = band * 1.4;
  for (let x = -H; x < W + H; x += step * 2) {
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + step, 0); g.lineTo(x + step - H, H); g.lineTo(x - H, H);
    g.closePath(); g.fill();
  }
  g.restore();
  // Label.
  const cx = W / 2, cy = H / 2;
  g.fillStyle = color;
  g.strokeStyle = '#16120a';
  g.lineJoin = 'round';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (bomb) {
    // Centred on the open floor (bomb.label) so crates don't cover it.
    const ppm = W / w;
    const lx = (bomb.x - bomb.x0) * ppm, ly = (bomb.z - bomb.z0) * (H / d);
    const R = Math.max(1.6, bomb.r * 0.72) * ppm;
    const ring = (lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(lx, ly, R, 0, Math.PI * 2); g.stroke(); };
    ring(R * 0.13, '#16120a');
    ring(R * 0.07, color);
    g.strokeStyle = '#16120a';
    g.font = `900 ${Math.round(R * 1.35)}px Inter, Arial, sans-serif`;
    g.lineWidth = R * 0.1;
    g.strokeText(label, lx, ly + R * 0.07);
    g.fillText(label, lx, ly + R * 0.07);
    // Bomb icon above the ring.
    const by = ly - R * 1.32, br = R * 0.17;
    g.fillStyle = '#16120a';
    g.beginPath(); g.arc(lx, by, br, 0, Math.PI * 2); g.fill();
    g.fillRect(lx + br * 0.4, by - br * 1.25, br * 0.55, br * 0.6);
    g.lineWidth = br * 0.2;
    g.beginPath(); g.moveTo(lx + br * 0.7, by - br * 1.2); g.quadraticCurveTo(lx + br * 1.4, by - br * 2, lx + br * 1.9, by - br * 1.5); g.stroke();
    g.fillStyle = '#ff5a1f';
    g.beginPath(); g.arc(lx + br * 1.95, by - br * 1.5, br * 0.3, 0, Math.PI * 2); g.fill();
    // BOMBSITE under the ring.
    g.fillStyle = color;
    g.font = `900 ${Math.round(R * 0.3)}px Inter, Arial, sans-serif`;
    g.lineWidth = R * 0.06;
    g.strokeText('BOMBSITE', lx, ly + R * 1.33);
    g.fillText('BOMBSITE', lx, ly + R * 1.33);
  } else {
    g.font = `900 ${Math.round(Math.min(m * 0.3, (W - band * 4) / (label.length * 0.75)))}px Inter, Arial, sans-serif`;
    g.lineWidth = m * 0.025;
    g.strokeText(label, cx, cy);
    g.fillText(label, cx, cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The site letter on all four sides of a sign box, for the sign post.
function signTexture(label, color) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.lineWidth = 16;
  g.strokeStyle = '#16120a';
  g.strokeRect(8, 8, S - 16, S - 16);
  g.fillStyle = '#16120a';
  g.font = '900 190px Inter, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, S / 2, S / 2 + 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Flat quads for a zone's floor cells, with UVs across the whole zone rect.
function zoneGeometry(rect, cells, y) {
  const [x0, z0] = rect.min, [x1, z1] = rect.max;
  const pos = [], uv = [];
  for (const [ax, az, bx, bz] of cells) {
    const u0 = (ax - x0) / (x1 - x0), u1 = (bx - x0) / (x1 - x0);
    const v0 = 1 - (az - z0) / (z1 - z0), v1 = 1 - (bz - z0) / (z1 - z0);
    pos.push(ax, y, az, ax, y, bz, bx, y, bz, ax, y, az, bx, y, bz, bx, y, az);
    uv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
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

// Where a bomb site's sign post stands: the painted floor nearest (cx, cz)
// with a metre clear all round and room above the sign.
function signSpot(world, cells, y, cx, cz) {
  let best = null, bestD = Infinity;
  for (const [ax, az, bx, bz] of cells) {
    for (let x = ax + 0.25; x < bx; x += 0.5) {
      const z = (az + bz) / 2;
      const dd = Math.hypot(x - cx, z - cz);
      if (dd >= bestD) continue;
      if (world.overlaps(x - 1, y + 0.02, z - 1, x + 1, y + 3.2, z + 1)) continue;
      best = [x, z]; bestD = dd;
    }
  }
  return best;
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
    this.nadeViews = new Map(); // grenade id -> model in flight
    this.isUnderwater = false;
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
    if (this.isUnderwater) this.setUnderwater(false);
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
      // Deep water: darker and less see-through. Both sides, so the surface
      // shows from below when you dive.
      this.waterMat = new THREE.MeshLambertMaterial({ color: 0x2f7fb3, map: this.waterTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
      const water = new THREE.Mesh(mergeGeometries(geos), this.waterMat);
      water.renderOrder = 1;
      grp.add(water);
    } else {
      this.waterMat = null;
    }

    // Painted zones: bomb sites and hostage rescue areas, laid on the floor
    // (not on crates, roofs or water inside the zone). Bomb sites also get a
    // sign post with the letter, standing on the floor in the open.
    const decal = (r, label, color, bomb) => {
      const w = r.max[0] - r.min[0], d = r.max[1] - r.min[1];
      const { y, cells, label: at } = zoneFloor(world, r);
      const spot = bomb && { ...at, x0: r.min[0], z0: r.min[1] };
      const mat = new THREE.MeshBasicMaterial({ map: zoneTexture(label, color, w, d, spot), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const m = new THREE.Mesh(zoneGeometry(r, cells, y + 0.01), mat);
      m.renderOrder = 1;
      grp.add(m);
      if (bomb) {
        // The sign stands just past the top of the painted ring.
        const pole = signSpot(world, cells, y, at.x, at.z - Math.max(1.6, at.r * 0.72) * 1.6);
        if (pole) {
          const H = 2.6, S = 0.8;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, H - S, 0.1), new THREE.MeshLambertMaterial({ color: 0x2a2620 }));
          post.position.set(pole[0], y + (H - S) / 2, pole[1]);
          const top = new THREE.MeshLambertMaterial({ color: 0x16120a });
          const side = new THREE.MeshLambertMaterial({ map: signTexture(label, color) });
          const sign = new THREE.Mesh(new THREE.BoxGeometry(S, S, S), [side, side, top, top, side, side]);
          sign.position.set(pole[0], y + H - S / 2, pole[1]);
          grp.add(post, sign);
        }
      }
    };
    for (const [name, r] of Object.entries(map.sites ?? {})) decal(r, name, '#f2b01e', true);
    for (const r of map.rescue ?? []) decal(r, 'RESCUE', '#3fbf5f', false);
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

  // Grenades in flight, spinning. alpha blends the last two sim positions.
  syncNades(nades, alpha, time) {
    const seen = new Set();
    for (const n of nades) {
      seen.add(n.id);
      let g = this.nadeViews.get(n.id);
      if (!g) {
        g = buildGun('hegrenade').group;
        g.scale.setScalar(1.3);
        this.scene.add(g);
        this.nadeViews.set(n.id, g);
      }
      const pp = n.prevPos ?? n.pos;
      g.position.set(pp[0] + (n.pos[0] - pp[0]) * alpha, pp[1] + (n.pos[1] - pp[1]) * alpha - 0.05, pp[2] + (n.pos[2] - pp[2]) * alpha);
      if (!n.rest) g.rotation.set(time * 11 + n.id, time * 3, time * 7);
    }
    for (const [id, g] of this.nadeViews) {
      if (!seen.has(id)) { this.scene.remove(g); this.nadeViews.delete(id); }
    }
  }

  // Eyes under water: close blue fog. Out again: the map's fog.
  setUnderwater(on) {
    if (on === this.isUnderwater) return;
    this.isUnderwater = on;
    const f = this.scene.fog;
    if (on) {
      f.color.setHex(0x1d5f86); f.near = 0.5; f.far = 16;
    } else {
      f.color.setHex(this.map.sky.bottom); f.near = 70; f.far = 220;
    }
    this.sky.visible = !on;
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
