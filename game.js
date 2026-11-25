/* Gulp City — 3D renderer (three.js), HUD, input, menus and online play.
   The simulation lives in sim.js (window.Sim). */
import * as THREE from 'three';

const S = window.Sim;
const { clamp, store, cleanName, N, BLOCK, ROAD, SIDEWALK, WORLD, EAT, TIERS, COLORS, radiusFor, scoreForR, Game, makeBots } = S;
const $ = id => document.getElementById(id);
const PI = Math.PI;

// ================================================================ renderer + scene
const hud = $('hud'), ctx = hud.getContext('2d');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
} catch (e) {
  $('menuErr').textContent = 'Gulp City needs 3D graphics (WebGL), which this browser has turned off.';
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl';
document.body.prepend(renderer.domElement);

let W = 0, H = 0, DPR = 1, clock = 0;
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
  renderer.setPixelRatio(Math.min(1.75, DPR));
  renderer.setSize(W, H);
  hud.width = Math.round(W * DPR); hud.height = Math.round(H * DPR);
  hud.style.width = W + 'px'; hud.style.height = H + 'px';
}
addEventListener('resize', resize); resize();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#231c3a');
scene.add(new THREE.HemisphereLight('#e4ecff', '#6b5f7a', 1.7));
const sun = new THREE.DirectionalLight('#fff1dc', 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.8;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.42, 0.9, 0.52).normalize();

// ================================================================ models
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// box whose side faces tile a texture every tw x th world units
function texBox(w, h, d, tw, th) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / tw, uv.getY(k) * dims[f][1] / th);
  }
  return g;
}
const pyramid = (w, h, d) => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(PI / 4).scale(w, h, d);
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const TEX = {
  tower: canvasTex(32, 32, (x, w, h) => { x.fillStyle = '#56688a'; x.fillRect(6, 7, w - 12, h - 14); x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(6, 7, (w - 12) / 2, h - 14); }),
  sky: canvasTex(32, 32, (x, w, h) => { x.fillStyle = '#3b5079'; x.fillRect(3, 5, w - 6, h - 10); x.fillStyle = 'rgba(190,225,255,.55)'; x.fillRect(3, 5, w - 6, 4); }),
  house: canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#6f8fb0'; x.fillRect(w * .3, h * .22, w * .4, h * .42); x.fillStyle = '#fff'; x.fillRect(w * .48, h * .22, w * .04, h * .42); x.fillRect(w * .3, h * .41, w * .4, h * .04); }),
  shop: canvasTex(128, 64, (x, w, h) => {
    x.fillStyle = '#5f86a8'; x.fillRect(w * .05, h * .42, w * .9, h * .5);
    x.fillStyle = 'rgba(255,255,255,.4)'; for (let i = 0; i < 6; i++) x.fillRect(w * .05 + i * w * .15, h * .42, 3, h * .5);
    x.fillStyle = '#e6e2ee'; x.fillRect(0, h * .26, w, h * .07);
  }),
};

const GLASS = '#2c3550', TIRE = '#22202c';
const wheelGeo = new THREE.CylinderGeometry(3.6, 3.6, 3, 10).rotateX(PI / 2);
function P(geo, color, x = 0, y = 0, z = 0, opt = {}) {
  const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(opt.rx || 0, 0, 0)), new THREE.Vector3(1, 1, 1));
  return { geo, color, local, ...opt };
}
const wheels = (lx, lz) => [P(wheelGeo, TIRE, -lx, 3.6, lz), P(wheelGeo, TIRE, lx, 3.6, lz), P(wheelGeo, TIRE, -lx, 3.6, -lz), P(wheelGeo, TIRE, lx, 3.6, -lz)];
// 'c1' / 'c2' / 'c3' = per-object colour picked by the world generator
const PARTS = {
  person: [P(new THREE.CylinderGeometry(3, 3.6, 8, 8), 'c1', 0, 4), P(new THREE.SphereGeometry(2.9, 10, 8), 'c2', 0, 10.6)],
  cone: [P(new THREE.ConeGeometry(4.6, 11, 10), '#ff8c2e', 0, 5.5), P(new THREE.CylinderGeometry(2.7, 3.3, 2, 10), '#ffffff', 0, 5)],
  hydrant: [P(new THREE.CylinderGeometry(3, 3.4, 9, 10), '#e23d4f', 0, 4.5), P(new THREE.SphereGeometry(3.1, 10, 6), '#ff7a88', 0, 9)],
  trash: [P(new THREE.CylinderGeometry(4.6, 4, 11, 10), '#5d6b7a', 0, 5.5), P(new THREE.CylinderGeometry(5.2, 5.2, 1.6, 10), '#8796a8', 0, 11.6)],
  bush: [P(new THREE.IcosahedronGeometry(9, 0).scale(1, .75, 1), 'c1', 0, 6, 0, { flat: true })],
  bench: [P(box(26, 2, 10), 'c1', 0, 5), P(box(26, 7, 2), 'c2', 0, 9, -4), P(box(2, 5, 8), '#3a3550', -10, 2), P(box(2, 5, 8), '#3a3550', 10, 2)],
  lamp: [P(new THREE.CylinderGeometry(1, 1.4, 34, 6), '#3a3550', 0, 17), P(new THREE.SphereGeometry(3.6, 10, 8), '#fff3b0', 0, 35, 0, { basic: true })],
  tree: [P(new THREE.CylinderGeometry(2, 2.8, 12, 6), '#7a5234', 0, 6), P(new THREE.IcosahedronGeometry(13, 0), 'c1', 0, 22, 0, { flat: true }),
    P(new THREE.IcosahedronGeometry(8, 0), 'c1', 4, 31, 3, { flat: true })],
  car: [P(box(40, 8, 20), 'c1', 0, 7), P(box(22, 7, 17), GLASS, -2, 14), P(box(18, 1.6, 15), 'c1', -2, 18.2), ...wheels(12, 9.5)],
  van: [P(box(50, 18, 24), 'c1', 0, 12), P(box(4, 8, 21), GLASS, 24, 15), ...wheels(16, 11.5)],
  bus: [P(box(86, 22, 28), 'c1', 0, 14), P(box(82, 7, 28.6), GLASS, 0, 18), P(box(87, 2, 26), '#ffffff', 0, 25.5), ...wheels(30, 13.5)],
  kiosk: [P(box(36, 20, 36), 'c2', 0, 10), P(box(38, 3, 38), '#f7f3ea', 0, 21.5), P(pyramid(46, 12, 46), 'c2', 0, 29)],
  fountain: [P(new THREE.CylinderGeometry(34, 36, 8, 24), '#d9d3e8', 0, 4), P(new THREE.CylinderGeometry(29, 29, 1, 24), '#5cc2ff', 0, 8.2),
    P(new THREE.CylinderGeometry(4, 6, 18, 10), '#e9e4f5', 0, 9), P(new THREE.SphereGeometry(6, 12, 8), '#9fdcff', 0, 19)],
  house: [P(texBox(80, 28, 76, 27, 28), 'c2', 0, 14, 0, { tex: 'house' }), P(pyramid(88, 24, 84), 'c1', 0, 40), P(box(12, 16, 1.5), '#6b4a3a', 0, 8, 38.5)],
  shop: [P(texBox(118, 34, 92, 118, 34), 'c2', 0, 17, 0, { tex: 'shop' }), P(box(122, 3, 96), 'c1', 0, 35.5),
    P(box(110, 2, 14), 'c3', 0, 25, 52, { rx: .35 }), P(box(22, 9, 16), '#b9b3c6', 30, 41.5, -20)],
  tower: [P(texBox(150, 110, 150, 15, 11), 'c2', 0, 55, 0, { tex: 'tower' }), P(box(156, 4, 156), 'c1', 0, 112), P(box(50, 14, 40), '#c7c2d4', -20, 121, 10)],
  sky: [P(texBox(190, 170, 190, 13.6, 12), 'c2', 0, 85, 0, { tex: 'sky' }), P(box(194, 4, 194), 'c1', 0, 172),
    P(texBox(130, 40, 130, 13, 12), 'c2', 0, 194, 0, { tex: 'sky' }), P(box(134, 4, 134), 'c1', 0, 216),
    P(new THREE.CylinderGeometry(1.5, 3, 44, 6), '#e6e3ee', 0, 240)],
};

const matCache = new Map();
function material(part, color) {
  const key = (part.tex || (part.basic ? 'basic' : part.flat ? 'flat' : 'lam')) + '|' + color;
  let m = matCache.get(key);
  if (m) return m;
  if (part.basic) m = new THREE.MeshBasicMaterial({ color });
  else if (part.tex) {
    const wall = new THREE.MeshLambertMaterial({ color, map: TEX[part.tex] }), top = new THREE.MeshLambertMaterial({ color });
    m = [wall, wall, top, top, wall, wall];
  } else m = new THREE.MeshLambertMaterial({ color, flatShading: !!part.flat });
  matCache.set(key, m);
  return m;
}
const perObj = p => p.color[0] === 'c';
const yawOf = o => (o.rot ? PI / 2 : 0) + (o.kind === 'car' && o.ph > 3 ? PI : 0);
function buildGroup(o) {
  const grp = new THREE.Group();
  for (const p of PARTS[o.type]) {
    const m = new THREE.Mesh(p.geo, material(p, perObj(p) ? (o[p.color] || '#ffffff') : p.color));
    m.applyMatrix4(p.local); m.castShadow = true; grp.add(m);
  }
  return grp;
}

// ---------- hole pieces (the ground is cut out with the stencil buffer)
const MASK_GEO = new THREE.CircleGeometry(1, 64).rotateX(-PI / 2);
const RIM_GEO = new THREE.RingGeometry(1, 1.1, 64).rotateX(-PI / 2);
const PIT_GEO = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 48, 6, true).translate(0, -.5, 0);
  const pos = g.attributes.position, cols = [], top = new THREE.Color('#3a2d5c'), bot = new THREE.Color('#000000'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { c.copy(top).lerp(bot, Math.min(1, -pos.getY(i) * 2.5)); cols.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
})();
const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
const pitMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
const bottomMat = new THREE.MeshBasicMaterial({ color: '#000000' });
const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
const borderMat = new THREE.MeshLambertMaterial({ color: '#ff7ab6' });
const KIND_COL = { residential: '#a6d98f', park: '#86cf72', commercial: '#eadcbc', downtown: '#cfcadf', plaza: '#ecd6b0' };

const _m = new THREE.Matrix4(), _o = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const pitDepth = r => 60 + r * 2.5;
const easeBack = t => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

class World3D {
  constructor(g) {
    this.g = g; this.group = new THREE.Group(); scene.add(this.group);
    this.owned = [];
    this.buildGround(g);
    this.buildObjects(g);
    this.holes = g.holes.map(h => this.makeHole(h));
    this.falling = new Map(); this.growing = [];
  }
  dispose() {
    scene.remove(this.group);
    for (const d of this.owned) d.dispose();
  }
  buildGround(g) {
    const pos = [], col = [], nrm = [], c = new THREE.Color();
    const quad = (x0, z0, x1, z1, y, hex) => {
      c.set(hex);
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let i = 0; i < 6; i++) { col.push(c.r, c.g, c.b); nrm.push(0, 1, 0); }
    };
    quad(-9000, -9000, WORLD + 9000, WORLD + 9000, -0.4, '#2b2440');
    quad(0, 0, WORLD, WORLD, 0, '#57546c');
    const LINE = '#d9d6e4';
    for (let k = 0; k <= N; k++) {
      const cc = ROAD / 2 + k * (BLOCK + ROAD);
      for (let i = 0; i < N; i++) {
        const s0 = ROAD + i * (BLOCK + ROAD);
        for (let p = s0 + 40; p < s0 + BLOCK - 40; p += 54) { quad(p, cc - 2, p + 28, cc + 2, .3, LINE); quad(cc - 2, p, cc + 2, p + 28, .3, LINE); }
        for (let j = 0; j < 7; j++) {
          const a = cc - ROAD / 2 + 14 + j * 18;
          quad(s0 + 4, a, s0 + 22, a + 9, .3, LINE); quad(s0 + BLOCK - 22, a, s0 + BLOCK - 4, a + 9, .3, LINE);
          quad(a, s0 + 4, a + 9, s0 + 22, .3, LINE); quad(a, s0 + BLOCK - 22, a + 9, s0 + BLOCK - 4, .3, LINE);
        }
      }
    }
    for (const b of g.blocks) {
      quad(b.x, b.y, b.x + BLOCK, b.y + BLOCK, .6, '#c9c3d6');
      quad(b.x + SIDEWALK, b.y + SIDEWALK, b.x + BLOCK - SIDEWALK, b.y + BLOCK - SIDEWALK, .9, KIND_COL[b.kind]);
      if (b.kind === 'park') {
        quad(b.x + BLOCK / 2 - 14, b.y + SIDEWALK, b.x + BLOCK / 2 + 14, b.y + BLOCK - SIDEWALK, 1.2, '#e8d8b0');
        quad(b.x + SIDEWALK, b.y + BLOCK / 2 - 14, b.x + BLOCK - SIDEWALK, b.y + BLOCK / 2 + 14, 1.2, '#e8d8b0');
      } else if (b.kind === 'plaza' || b.kind === 'downtown') {
        for (let p = 60; p < BLOCK - 30; p += 40) {
          quad(b.x + p - 1, b.y + SIDEWALK, b.x + p + 1, b.y + BLOCK - SIDEWALK, 1.2, '#bdb8cc');
          quad(b.x + SIDEWALK, b.y + p - 1, b.x + BLOCK - SIDEWALK, b.y + p + 1, 1.2, '#bdb8cc');
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true; ground.renderOrder = 1; ground.frustumCulled = false;
    this.group.add(ground); this.owned.push(geo);
    const t = 10, hgt = 14;
    for (const [x, z, w, d] of [[WORLD / 2, -t / 2, WORLD + 2 * t, t], [WORLD / 2, WORLD + t / 2, WORLD + 2 * t, t], [-t / 2, WORLD / 2, t, WORLD], [WORLD + t / 2, WORLD / 2, t, WORLD]]) {
      const bg = box(w, hgt, d), m = new THREE.Mesh(bg, borderMat);
      m.position.set(x, hgt / 2, z); this.group.add(m); this.owned.push(bg);
    }
  }
  buildObjects(g) {
    const byType = {};
    for (const o of g.objs) (byType[o.type] = byType[o.type] || []).push(o);
    this.inst = {};
    const c = new THREE.Color();
    for (const [type, list] of Object.entries(byType)) {
      const meshes = PARTS[type].map(p => {
        const m = new THREE.InstancedMesh(p.geo, material(p, perObj(p) ? '#ffffff' : p.color), list.length);
        m.castShadow = true; m.frustumCulled = false;
        if (perObj(p)) list.forEach((o, i) => m.setColorAt(i, c.set(o[p.color] || '#ffffff')));
        this.group.add(m); this.owned.push(m);
        return m;
      });
      this.inst[type] = meshes;
      list.forEach((o, i) => { o._ti = i; o._vis = o.alive; this.setObj(o, o.alive ? 1 : 0); });
    }
  }
  setObj(o, s) {
    const meshes = this.inst[o.type], parts = PARTS[o.type];
    if (s <= 0) _o.makeScale(0, 0, 0);
    else _o.compose(_p.set(o.x, 0, o.y), _q.setFromAxisAngle(UP, yawOf(o)), _s.set(s, s, s));
    for (let k = 0; k < meshes.length; k++) {
      _m.multiplyMatrices(_o, parts[k].local);
      meshes[k].setMatrixAt(o._ti, _m);
      meshes[k].instanceMatrix.needsUpdate = true;
    }
  }
  makeHole(h) {
    const grp = new THREE.Group();
    const mask = new THREE.Mesh(MASK_GEO, maskMat); mask.renderOrder = -1; mask.position.y = 2;
    const pit = new THREE.Mesh(PIT_GEO, pitMat);
    const bottom = new THREE.Mesh(MASK_GEO, bottomMat);
    const rimMat = new THREE.MeshBasicMaterial({ color: h.color, transparent: true });
    const rim = new THREE.Mesh(RIM_GEO, rimMat); rim.position.y = 1.5; rim.renderOrder = 2;
    for (const m of [mask, pit, bottom, rim]) m.frustumCulled = false;
    grp.add(mask, pit, bottom, rim); this.group.add(grp); this.owned.push(rimMat);
    return { grp, mask, pit, bottom, rim };
  }
  update(dt) {
    const g = this.g;
    for (const o of g.objs) {
      if (o.alive === o._vis) continue;
      o._vis = o.alive;
      if (o.alive) this.growing.push({ o, t: 0 }); else this.setObj(o, 0);
    }
    this.growing = this.growing.filter(e => {
      if (!e.o.alive) return false;
      e.t += dt / .8;
      this.setObj(e.o, e.t >= 1 ? 1 : Math.max(.02, easeBack(e.t)));
      return e.t < 1;
    });
    // falling objects: tip toward the hole and sink into the pit
    const live = new Set(g.falling);
    for (const [f, grp] of this.falling) if (!live.has(f)) { this.group.remove(grp); this.falling.delete(f); }
    for (const f of g.falling) {
      let grp = this.falling.get(f);
      if (!grp) { grp = buildGroup(f.o); this.group.add(grp); this.falling.set(f, grp); }
      const o = f.o, h = f.h, t = f.t, dx = h.x - o.x, dz = h.y - o.y, d = Math.hypot(dx, dz) || 1;
      const pull = Math.min(1, t * 1.8) * .85;
      grp.position.set(o.x + dx * pull, -t * t * pitDepth(h.vr) * 1.15, o.y + dz * pull);
      _q.setFromAxisAngle(_ax.set(dz / d, 0, -dx / d), t * 1.6);
      _q2.setFromAxisAngle(UP, yawOf(o));
      grp.quaternion.multiplyQuaternions(_q, _q2);
    }
    g.holes.forEach((h, i) => {
      const v = this.holes[i];
      if (!v) return;
      v.grp.visible = h.alive;
      if (!h.alive) return;
      const r = h.vr, dep = pitDepth(r);
      v.grp.position.set(h.x, 0, h.y);
      v.mask.scale.set(r, 1, r); v.rim.scale.set(r, 1, r);
      v.pit.scale.set(r, dep, r);
      v.bottom.position.y = -dep; v.bottom.scale.set(r, 1, r);
      v.rim.material.opacity = h.inv > 0 ? .25 + .75 * Math.abs(Math.sin(clock * 9)) : 1;
    });
  }
}

// ================================================================ cameras
const EL = 57 * PI / 180;
function updateCam(v, h, view, dt) {
  const asp = Math.max(1, view.w) / Math.max(1, view.h), span = 560 + h.vr * 7.5;
  const D = span * 1.05 / Math.min(1, asp) ** .75;
  if (!v.cam) v.cam = { x: h.x, z: h.y, D, c: new THREE.PerspectiveCamera(40, asp, 10, 20000) };
  const cm = v.cam, k = Math.min(1, dt * 7);
  if (!Number.isFinite(cm.D + cm.x + cm.z)) { cm.x = h.x; cm.z = h.y; cm.D = D; }
  cm.x += (h.x - cm.x) * k; cm.z += (h.y - cm.z) * k; cm.D += (D - cm.D) * Math.min(1, dt * 2);
  const c = cm.c;
  c.aspect = asp; c.near = Math.max(5, cm.D * .05); c.far = cm.D * 4 + 3000;
  c.position.set(cm.x, cm.D * Math.sin(EL), cm.z + cm.D * Math.cos(EL));
  c.lookAt(cm.x, 0, cm.z);
  c.updateProjectionMatrix();
}
function aimSun(cm) {
  const R = cm.D * .95;
  sun.target.position.set(cm.x, 0, cm.z - cm.D * .15);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 1500);
  const sc = sun.shadow.camera;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 100; sc.far = 3200;
  sc.updateProjectionMatrix(); sun.target.updateMatrixWorld();
}
const _v = new THREE.Vector3();
function project(cam, view, x, y, z) {
  _v.set(x, y, z).project(cam);
  return { x: view.x + (_v.x + 1) / 2 * view.w, y: view.y + (1 - _v.y) / 2 * view.h };
}

// ================================================================ sound
let actx = null, muted = store.get('gc-muted', '0') === '1', lastSfx = 0;
function beep(freq, dur = .09, type = 'sine', vol = .05) {
  if (muted) return;
  const now = performance.now();
  if (now - lastSfx < 35) return;
  lastSfx = now;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * .45, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch { /* audio unavailable */ }
}
const isMine = (g, h) => g === app.game && app.viewers.some(v => v.holeId === h.id);
S.hooks.swallow = (g, h, o) => { if (isMine(g, h)) beep(950 - Math.min(750, o.r * 6), .08 + o.r / 600, 'sine', .045 + o.r / 2500); };
S.hooks.kill = (g, a, b) => {
  if (isMine(g, a)) { lastSfx = 0; beep(520, .25, 'square', .05); }
  else if (isMine(g, b)) { lastSfx = 0; beep(160, .4, 'sawtooth', .05); }
};

// ================================================================ HUD (2D overlay canvas)
function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
function pill(x, y, w, h, r = 10) { ctx.fillStyle = 'rgba(20,14,40,.66)'; rr(x, y, w, h, r); ctx.fill(); }
function fmtTime(s) { s = Math.ceil(s); return `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; }
function fitText(t, maxW) {
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function drawLabels(g, view, cam, me) {
  ctx.save();
  ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  for (const h of g.holes) {
    if (!h.alive) continue;
    const c = project(cam, view, h.x, 0, h.y);
    if (c.x < view.x - 400 || c.x > view.x + view.w + 400 || c.y < view.y - 400 || c.y > view.y + view.h + 400) continue;
    const e = project(cam, view, h.x + h.vr, 0, h.y), n = project(cam, view, h.x, 0, h.y - h.vr), s = project(cam, view, h.x, 0, h.y + h.vr);
    // dashed outline so you can see holes hidden behind buildings
    ctx.globalAlpha = .5; ctx.setLineDash([7, 6]); ctx.lineWidth = 2; ctx.strokeStyle = h.color;
    ctx.beginPath(); ctx.ellipse(c.x, (n.y + s.y) / 2, Math.max(2, Math.abs(e.x - c.x)), Math.max(2, Math.abs(s.y - n.y) / 2), 0, 0, 6.2832); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.font = `800 ${h === me ? 15 : 13}px system-ui, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,14,40,.85)'; ctx.fillStyle = h.color;
    ctx.strokeText(h.name, c.x, n.y - 8); ctx.fillText(h.name, c.x, n.y - 8);
  }
  ctx.restore();
}
function drawMinimap(g, view, me) {
  const Sz = Math.min(140, view.w * .28, view.h * .28), x = view.x + view.w - Sz - 12, y = view.y + view.h - Sz - 12, k = Sz / WORLD;
  pill(x - 4, y - 4, Sz + 8, Sz + 8, 8);
  ctx.fillStyle = '#57546c'; ctx.fillRect(x, y, Sz, Sz);
  for (const b of g.blocks) { ctx.fillStyle = KIND_COL[b.kind]; ctx.fillRect(x + b.x * k, y + b.y * k, BLOCK * k, BLOCK * k); }
  for (const h of g.holes) {
    if (!h.alive) continue;
    ctx.fillStyle = h.color; circle(x + h.x * k, y + h.y * k, Math.max(2.5, h.vr * k));
    if (h === me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + h.x * k, y + h.y * k, Math.max(4, h.vr * k) + 2, 0, 6.2832); ctx.stroke(); }
  }
}
function drawHUD(g, viewers, views) {
  ctx.textBaseline = 'middle';
  const narrow = W < 640;
  const tx = narrow ? 104 : W / 2;
  pill(tx - 48, 10, 96, 38, 19);
  ctx.font = '800 22px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = g.timeLeft <= 10 ? '#ff7a7a' : '#fff'; ctx.fillText(fmtTime(g.timeLeft), tx, 30);
  const sorted = [...g.holes].sort((a, b) => b.score - a.score);
  const mine = viewers.map(v => g.holes[v.holeId]);
  const rows = sorted.slice(0, narrow ? 4 : 6).map(h => ({ h, rank: sorted.indexOf(h) + 1 }));
  for (const h of mine) if (h && !rows.some(r => r.h === h)) rows.push({ h, rank: sorted.indexOf(h) + 1 });
  const lw = narrow ? 160 : 210, lx = W - lw - 10;
  pill(lx, 10, lw, 14 + rows.length * 22, 12);
  rows.forEach((r, i) => {
    const y = 28 + i * 22, me = mine.includes(r.h);
    ctx.fillStyle = r.h.color; circle(lx + 16, y, 5);
    ctx.textAlign = 'left'; ctx.fillStyle = me ? '#fff' : '#c9bff0';
    ctx.font = `${me ? 800 : 600} 13px system-ui, sans-serif`;
    ctx.fillText(fitText(`${r.rank}. ${r.h.name}`, lw - 80), lx + 27, y);
    ctx.textAlign = 'right'; ctx.fillText(r.h.score, lx + lw - 10, y);
  });
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'left';
  let fy = 64;
  for (const f of g.feed) {
    ctx.globalAlpha = Math.min(1, f.t);
    const text = f.text || `${f.a.name} swallowed ${f.b.name}!`;
    const tw = Math.min(ctx.measureText(text).width, narrow ? W - lw - 40 : 360);
    pill(10, fy - 12, tw + 18, 24, 8);
    ctx.fillStyle = f.a ? f.a.color : '#fff'; ctx.fillText(fitText(text, tw), 19, fy);
    fy += 28; ctx.globalAlpha = 1;
  }
  viewers.forEach((v, i) => {
    const view = views[i], h = g.holes[v.holeId];
    if (!h) return;
    const bw = Math.min(210, view.w - Math.min(140, view.w * .28, view.h * .28) - 40), bx = view.x + 12, by = view.y + view.h - 72;
    pill(bx, by, bw, 60, 12);
    ctx.textAlign = 'left'; ctx.font = '800 15px system-ui, sans-serif'; ctx.fillStyle = h.color;
    ctx.fillText(fitText(h.name, bw - 80), bx + 12, by + 17);
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '900 18px system-ui, sans-serif'; ctx.fillText(h.score, bx + bw - 12, by + 17);
    const next = TIERS.find(t => t[1] > h.r * EAT), prevIdx = next ? TIERS.indexOf(next) - 1 : TIERS.length - 1;
    const prevS = prevIdx >= 0 ? scoreForR(TIERS[prevIdx][1] / EAT) : 0, nextS = next ? scoreForR(next[1] / EAT) : 1;
    const frac = next ? clamp((h.score - prevS) / Math.max(1, nextS - prevS), 0, 1) : 1;
    ctx.fillStyle = 'rgba(255,255,255,.15)'; rr(bx + 12, by + 34, bw - 24, 14, 7); ctx.fill();
    ctx.fillStyle = h.color; rr(bx + 12, by + 34, Math.max(14, (bw - 24) * frac), 14, 7); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '800 10px system-ui, sans-serif'; ctx.fillStyle = '#1b1530';
    ctx.fillText(next ? `NEXT: ${next[0].toUpperCase()}` : 'TOP OF THE FOOD CHAIN', bx + bw / 2, by + 41.5);
    drawMinimap(g, view, h);
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    if (!h.alive) {
      pill(cx - 160, cy - 46, 320, 80, 16);
      ctx.fillStyle = '#ff7a7a'; ctx.font = '900 22px system-ui, sans-serif'; ctx.fillText(fitText(`Swallowed by ${h.killer}!`, 300), cx, cy - 18);
      ctx.fillStyle = '#fff'; ctx.font = '700 15px system-ui, sans-serif'; ctx.fillText(`Respawning in ${Math.max(1, Math.ceil(h.respawn))}…`, cx, cy + 12);
    } else if (g.duration - g.timeLeft < 4.5) {
      const msg = 'Swallow things smaller than you. Avoid bigger holes!';
      ctx.font = '800 15px system-ui, sans-serif';
      const tw = Math.min(ctx.measureText(msg).width + 30, view.w - 24), hy = narrow ? view.y + view.h * .66 : view.y + 60;
      pill(cx - tw / 2, hy, tw, 34, 17); ctx.fillStyle = '#ffd35a'; ctx.fillText(fitText(msg, tw - 20), cx, hy + 17);
    }
  });
  if (viewers.length > 1) {
    ctx.fillStyle = '#1b1530';
    if (W >= H) ctx.fillRect(W / 2 - 2, 0, 4, H); else ctx.fillRect(0, H / 2 - 2, W, 4);
  }
  if (joy) {
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 55, 0, 6.2832); ctx.stroke();
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy), m = Math.min(1, 55 / (d || 1));
    ctx.fillStyle = 'rgba(255,255,255,.5)'; circle(joy.ox + dx * m, joy.oy + dy * m, 22);
  }
}

// ================================================================ frame rendering
let world = null;
function layoutViews(n) {
  if (n < 2) return [{ x: 0, y: 0, w: W, h: H }];
  if (W >= H) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
  return [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
}
function render(dt) {
  const g = app.game || app.demo;
  if (!world || world.g !== g) { if (world) world.dispose(); world = new World3D(g); }
  world.update(dt);
  const viewers = app.game ? app.viewers : [app.demoV];
  const views = layoutViews(viewers.length);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  renderer.setScissorTest(true);
  viewers.forEach((v, i) => {
    let h;
    if (app.game) h = g.holes[v.holeId];
    else {
      v.sw -= dt;
      if (v.sw <= 0 || !g.holes[v.follow].alive) {
        v.sw = 8;
        const top = [...g.holes].filter(x => x.alive).sort((a, b) => b.score - a.score)[0];
        v.follow = top ? top.id : 0;
      }
      h = g.holes[v.follow];
    }
    const vw = views[i];
    v.view = vw;
    updateCam(v, h, vw, dt);
    aimSun(v.cam);
    renderer.setViewport(vw.x, H - vw.y - vw.h, vw.w, vw.h);
    renderer.setScissor(vw.x, H - vw.y - vw.h, vw.w, vw.h);
    renderer.render(scene, v.cam.c);
    if (app.game) drawLabels(g, vw, v.cam.c, h);
  });
  if (app.game) drawHUD(g, viewers, views);
}

// ================================================================ input
const keys = new Set();
const mouse = { x: 0, y: 0, active: false };
let joy = null;
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (/^(Key[WASD]|Arrow)/.test(e.code)) mouse.active = false;
  if (e.code === 'Escape' && app.state === 'playing') leaveToMenu();
  if (e.code === 'KeyM') { muted = !muted; store.set('gc-muted', muted ? '1' : '0'); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', e => { if (joy && e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; } });
const endJoy = e => { if (joy && e.pointerId === joy.id) joy = null; };
addEventListener('pointerup', endJoy); addEventListener('pointercancel', endJoy);

function keyVec(set) {
  let x = 0, y = 0;
  if (set !== 'arrows') { if (keys.has('KeyA')) x--; if (keys.has('KeyD')) x++; if (keys.has('KeyW')) y--; if (keys.has('KeyS')) y++; }
  if (set !== 'wasd') { if (keys.has('ArrowLeft')) x--; if (keys.has('ArrowRight')) x++; if (keys.has('ArrowUp')) y--; if (keys.has('ArrowDown')) y++; }
  const m = Math.hypot(x, y);
  return m ? { x: x / m, y: y / m } : null;
}
const ZERO = { x: 0, y: 0 };
const ray = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
function readInput(v) {
  if (v.ctrl === 'p1') return keyVec('wasd') || ZERO;
  if (v.ctrl === 'p2') return keyVec('arrows') || ZERO;
  const k = keyVec('both');
  if (k) return k;
  if (joy) {
    const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
    if (d < 6) return ZERO;
    const m = Math.min(1, d / 55);
    return { x: dx / d * m, y: dy / d * m };
  }
  if (mouse.active && v.cam && v.view) {
    const vw = v.view, h = app.game.holes[v.holeId];
    const sc = project(v.cam.c, vw, h.x, 0, h.y), sd = Math.hypot(mouse.x - sc.x, mouse.y - sc.y);
    if (sd < 10) return ZERO;
    ndc.set((mouse.x - vw.x) / vw.w * 2 - 1, -((mouse.y - vw.y) / vw.h * 2 - 1));
    ray.setFromCamera(ndc, v.cam.c);
    if (!ray.ray.intersectPlane(groundPlane, hit)) return ZERO;
    const dx = hit.x - h.x, dy = hit.z - h.y, dd = Math.hypot(dx, dy) || 1, m = Math.min(1, sd / 140);
    return { x: dx / dd * m, y: dy / dd * m };
  }
  return ZERO;
}

// ================================================================ networking (PeerJS)
const PREFIX = 'gulpcity-v1-';
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: 5 }, () => CODE_CH[Math.random() * CODE_CH.length | 0]).join('');
const PEER_OPTS = { debug: 1 };

function snapshot(g) {
  const m = { t: 's', tl: Math.round(g.timeLeft * 10) / 10,
    h: g.holes.map(h => [Math.round(h.x), Math.round(h.y), h.score, h.alive ? 1 : 0, h.inv > 0 ? 1 : 0, h.kills]),
    ev: g.events, k: g.kills, rs: g.regrown };
  g.events = []; g.kills = []; g.regrown = [];
  return m;
}
function applySnap(g, d) {
  g.timeLeft = d.tl;
  d.h.forEach((a, i) => {
    const h = g.holes[i]; if (!h) return;
    const was = h.alive;
    h.tx = a[0]; h.ty = a[1]; h.score = a[2]; h.r = radiusFor(h.score); h.alive = !!a[3]; h.inv = a[4] ? 1 : 0; h.kills = a[5];
    if (h.alive && !was) { h.x = h.tx; h.y = h.ty; h.vr = h.r; }
  });
  for (const [oid, hid] of d.ev || []) {
    const o = g.objs[oid], h = g.holes[hid];
    if (o && h && o.alive) { o.alive = false; g.falling.push({ o, h, t: 0 }); S.hooks.swallow(g, h, o); }
  }
  for (const id of d.rs || []) if (g.objs[id]) g.objs[id].alive = true;
  for (const [a, b] of d.k || []) g.addKill(a, b);
}

class HostNet {
  constructor(name) { this.name = name; this.peers = new Map(); this.acc = 0; this.closed = false; this.ready = false; this.open(randCode(), 0); }
  open(code, tries) {
    this.code = code;
    this.peer = new Peer(PREFIX + code, PEER_OPTS);
    this.peer.on('open', () => { this.ready = true; lobbyUI(); });
    this.peer.on('connection', c => {
      c.on('data', d => this.onData(c, d));
      c.on('close', () => this.drop(c));
      c.on('error', () => this.drop(c));
    });
    this.peer.on('error', e => {
      if (this.closed) return;
      if (e.type === 'unavailable-id' && tries < 5) { this.peer.destroy(); this.open(randCode(), tries + 1); }
      else if (e.type === 'peer-unavailable') { /* a client vanished; ignore */ }
      else netError(e);
    });
    this.peer.on('disconnected', () => { if (!this.closed) try { this.peer.reconnect(); } catch { /* ignore */ } });
  }
  onData(c, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') {
      if (app.state !== 'lobby' || this.peers.size >= 11) { c.send({ t: 'busy' }); setTimeout(() => c.close(), 600); return; }
      this.peers.set(c.peer, { conn: c, name: cleanName(d.name, 'Friend'), hole: -1 });
      this.sendLobby();
    } else if (d.t === 'i') {
      const p = this.peers.get(c.peer), g = app.game;
      if (p && g && p.hole >= 0 && g.holes[p.hole]) {
        const h = g.holes[p.hole];
        h.ix = clamp(+d.x || 0, -1, 1); h.iy = clamp(+d.y || 0, -1, 1);
      }
    }
  }
  drop(c) {
    const p = this.peers.get(c.peer);
    if (!p) return;
    this.peers.delete(c.peer);
    if (app.game && p.hole >= 0) {
      const h = app.game.holes[p.hole];
      h.isBot = true; h.name = cleanName(p.name + ' bot', 'Bot');
      app.game.note({ text: `${p.name} left — a bot took over` });
      this.bcast({ t: 'names', n: app.game.holes.map(x => x.name) });
    }
    this.sendLobby();
  }
  players() { return [{ name: this.name, host: true }, ...[...this.peers.values()].map(p => ({ name: p.name }))]; }
  sendLobby() { this.bcast({ t: 'lobby', players: this.players(), info: settingsText() }); if (app.state === 'lobby') lobbyUI(); }
  bcast(m) { for (const p of this.peers.values()) if (p.conn.open) try { p.conn.send(m); } catch { /* ignore */ } }
  start(s) {
    const list = [{ name: this.name }, ...this.peers.values()].map((p, i) => ({ name: p.name, color: COLORS[i % COLORS.length], isBot: false }));
    list.push(...makeBots(s.bots, list.length));
    let i = 1; for (const p of this.peers.values()) p.hole = i++;
    const seed = Math.random() * 1e9 | 0;
    startGame({ seed, duration: s.dur, difficulty: s.diff, holes: list, record: true }, [{ holeId: 0, ctrl: 'any' }], 'host');
    const pos = app.game.holes.map(h => [Math.round(h.x), Math.round(h.y)]);
    for (const p of this.peers.values()) if (p.conn.open) p.conn.send({ t: 'start', seed, dur: s.dur, holes: list, pos, you: p.hole });
  }
  tick(dt) { this.acc += dt; if (this.acc >= .05) { this.acc = 0; this.bcast(snapshot(app.game)); } }
  end() { const m = snapshot(app.game); m.t = 'end'; this.bcast(m); }
  close() { this.closed = true; try { this.peer.destroy(); } catch { /* ignore */ } }
}

class ClientNet {
  constructor(code, name) {
    this.code = code; this.name = name; this.closed = false; this.players = null; this.info = '';
    this.lastSend = 0; this.lx = 9; this.ly = 9;
    this.peer = new Peer(PEER_OPTS);
    this.timer = setTimeout(() => { if (!this.players && !this.closed) netError({ message: "Couldn't reach that room. Check the code, or ask the host to keep their tab open." }); }, 15000);
    this.peer.on('open', () => {
      this.conn = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn.on('open', () => this.conn.send({ t: 'hello', name }));
      this.conn.on('data', d => this.onData(d));
      this.conn.on('close', () => this.lost());
      this.conn.on('error', () => this.lost());
    });
    this.peer.on('error', e => {
      if (this.closed) return;
      if (e.type === 'peer-unavailable') netError({ message: `No room found with code ${code}.` });
      else netError(e);
    });
  }
  onData(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'lobby':
        this.players = d.players; this.info = d.info || '';
        if (app.state !== 'lobby') { app.game = null; app.state = 'lobby'; showScreen('lobby'); }
        lobbyUI(); break;
      case 'busy': netError({ message: 'That room is mid-round or full. Try again when the round ends.' }); break;
      case 'start':
        startGame({ seed: d.seed, duration: d.dur, holes: d.holes, remote: true }, [{ holeId: d.you, ctrl: 'any' }], 'client');
        app.game.holes.forEach((h, i) => { if (d.pos[i]) { h.x = h.tx = d.pos[i][0]; h.y = h.ty = d.pos[i][1]; } });
        break;
      case 'names': if (app.game) d.n.forEach((n, i) => { if (app.game.holes[i]) app.game.holes[i].name = n; }); break;
      case 's': if (app.game && app.state === 'playing') applySnap(app.game, d); break;
      case 'end': if (app.game) { applySnap(app.game, d); app.game.over = true; showResults(); } break;
    }
  }
  sendInput(inp, now) {
    if (!this.conn || !this.conn.open) return;
    const x = Math.round(inp.x * 100) / 100, y = Math.round(inp.y * 100) / 100;
    if (now - this.lastSend < 50) return;
    if (x === this.lx && y === this.ly && now - this.lastSend < 300) return;
    this.lastSend = now; this.lx = x; this.ly = y;
    this.conn.send({ t: 'i', x, y });
  }
  lost() { if (!this.closed) netError({ message: 'Lost connection to the host.' }); }
  close() { this.closed = true; clearTimeout(this.timer); try { this.peer.destroy(); } catch { /* ignore */ } }
}

function netError(e) {
  const map = {
    'browser-incompatible': "This browser doesn't support online play (WebRTC).",
    network: "Couldn't reach the matchmaking server. Check your internet connection.",
    'server-error': 'The matchmaking server had a problem. Try again in a moment.',
    'socket-error': 'Lost connection to the matchmaking server.',
    'socket-closed': 'Lost connection to the matchmaking server.',
  };
  const msg = e.message && !e.type ? e.message : (map[e.type] || `Online error: ${e.type || e.message || 'unknown'}`);
  leaveToMenu();
  selectTab('online');
  $('menuErr').textContent = msg;
}

// ================================================================ app / UI
const app = { state: 'menu', mode: null, game: null, viewers: [], net: null, demo: null, demoV: null, demoAge: 0 };
function makeDemo() {
  app.demo = new Game({ seed: Math.random() * 1e9 | 0, duration: 1e9, difficulty: 'normal', holes: makeBots(8, 0) });
  app.demoV = { follow: 0, sw: 0, cam: null }; app.demoAge = 0;
}
function showScreen(id) {
  for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
  $('quitBtn').classList.toggle('hidden', app.state !== 'playing');
}
function settings() {
  return { name1: cleanName($('name1').value, 'Player'), name2: cleanName($('name2').value, 'Player 2'),
    bots: +$('bots').value, diff: $('diff').value, dur: +$('dur').value };
}
function settingsText() {
  const s = settings();
  return `${s.bots} bot${s.bots === 1 ? '' : 's'} · ${s.diff[0].toUpperCase() + s.diff.slice(1)} · ${s.dur / 60} min`;
}
function startGame(opts, viewers, mode) {
  app.game = new Game(opts);
  app.viewers = viewers.map(v => ({ ...v, cam: null }));
  app.mode = mode; app.state = 'playing';
  showScreen(null);
  $('menuErr').textContent = '';
}
function startLocal(two) {
  const s = settings();
  const humans = two ? [s.name1, s.name2] : [s.name1];
  const list = humans.map((n, i) => ({ name: n, color: COLORS[i], isBot: false }));
  list.push(...makeBots(s.bots, list.length));
  startGame({ seed: Math.random() * 1e9 | 0, duration: s.dur, difficulty: s.diff, holes: list },
    humans.map((_, i) => ({ holeId: i, ctrl: two ? (i ? 'p2' : 'p1') : 'any' })), two ? 'local' : 'solo');
}
function endRound() {
  app.state = 'results';
  if (app.mode === 'host') app.net.end();
  showResults();
}
function showResults() {
  app.state = 'results'; showScreen('results');
  const g = app.game, sorted = [...g.holes].sort((a, b) => b.score - a.score), mine = app.viewers.map(v => v.holeId);
  const win = sorted[0];
  $('winnerTitle').textContent = mine.includes(win.id) ? (app.viewers.length > 1 ? `${win.name} wins! 🏆` : 'You win! 🏆') : `${win.name} wins!`;
  const ol = $('resultList'); ol.innerHTML = '';
  sorted.forEach((h, i) => {
    const li = document.createElement('li');
    if (mine.includes(h.id)) li.className = 'me';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = h.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = h.name;
    if (h.isBot) { const t = document.createElement('span'); t.className = 'tagb'; t.textContent = 'BOT'; nm.append(' ', t); }
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = `${h.score}${h.kills ? ` · ${h.kills} ✦` : ''}`;
    li.append(rank, sw, nm, sc); ol.append(li);
  });
  const client = app.mode === 'client';
  $('againBtn').classList.toggle('hidden', client);
  $('againBtn').textContent = app.mode === 'host' ? 'Back to lobby' : 'Play again';
  $('resultsHint').textContent = client ? 'Waiting for the host to start the next round…' : (sorted.some(h => h.kills) ? '✦ = holes swallowed' : '');
}
function leaveToMenu() {
  if (app.net) { app.net.close(); app.net = null; }
  app.game = null; app.viewers = []; app.mode = null; app.state = 'menu';
  showScreen('menu');
}
function lobbyUI() {
  const n = app.net; if (!n) return;
  const host = app.mode === 'host';
  $('lobbyTitle').textContent = host ? 'Your room' : 'Joined room';
  $('roomCode').textContent = n.code;
  const players = host ? n.players() : (n.players || []);
  $('lobbyStatus').textContent = host
    ? (n.ready ? `Share the code or link, then start. ${settingsText()}. Keep this tab open while hosting.` : 'Opening room…')
    : (n.players ? `Waiting for the host to start… ${n.info}` : 'Connecting…');
  const ul = $('playerList'); ul.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = COLORS[i % COLORS.length];
    const nm = document.createElement('span'); nm.textContent = p.name; nm.style.flex = '1';
    li.append(sw, nm);
    if (p.host) { const t = document.createElement('span'); t.className = 'tagb'; t.textContent = 'HOST'; li.append(t); }
    ul.append(li);
  });
  $('lobbyStart').classList.toggle('hidden', !host);
  $('lobbyStart').disabled = !n.ready;
}
const inviteLink = code => `${location.origin}${location.pathname}?join=${code}`;
function selectTab(mode) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.querySelectorAll('.mode-panel').forEach(p => p.classList.toggle('hidden', p.dataset.for !== mode));
  document.body.classList.toggle('mode-local', mode === 'local');
  store.set('gc-tab', mode);
}
function peerAvailable() {
  if (typeof Peer === 'undefined') { $('menuErr').textContent = "Online play couldn't load (PeerJS blocked or offline)."; return false; }
  return true;
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { selectTab(t.dataset.mode); $('menuErr').textContent = ''; }));
for (const id of ['name1', 'name2', 'bots', 'diff', 'dur']) {
  const el = $(id), saved = store.get('gc-' + id, null);
  if (saved !== null) el.value = saved;
  el.addEventListener('input', () => { store.set('gc-' + id, el.value); $('botsVal').textContent = $('bots').value; });
}
$('botsVal').textContent = $('bots').value;
$('startSolo').addEventListener('click', () => startLocal(false));
$('startLocal').addEventListener('click', () => startLocal(true));
$('hostBtn').addEventListener('click', () => {
  if (!peerAvailable()) return;
  app.mode = 'host'; app.state = 'lobby'; app.net = new HostNet(settings().name1);
  showScreen('lobby'); lobbyUI();
});
function join() {
  const code = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) { $('menuErr').textContent = 'Room codes are 5 characters.'; return; }
  if (!peerAvailable()) return;
  app.mode = 'client'; app.state = 'lobby'; app.net = new ClientNet(code, settings().name1);
  showScreen('lobby'); lobbyUI();
}
$('joinBtn').addEventListener('click', join);
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
$('lobbyStart').addEventListener('click', () => { if (app.mode === 'host' && app.net.ready) app.net.start(settings()); });
$('lobbyLeave').addEventListener('click', leaveToMenu);
$('copyLink').addEventListener('click', async () => {
  const link = inviteLink(app.net.code);
  try { await navigator.clipboard.writeText(link); $('copyLink').textContent = 'Copied!'; }
  catch { prompt('Copy this invite link:', link); }
  setTimeout(() => { $('copyLink').textContent = 'Copy invite link'; }, 1500);
});
$('againBtn').addEventListener('click', () => {
  if (app.mode === 'host') { app.game = null; app.state = 'lobby'; showScreen('lobby'); app.net.sendLobby(); }
  else startLocal(app.mode === 'local');
});
$('menuBtn').addEventListener('click', leaveToMenu);
$('quitBtn').addEventListener('click', leaveToMenu);

const params = new URLSearchParams(location.search);
if (params.get('join')) { selectTab('online'); $('joinCode').value = params.get('join').toUpperCase().slice(0, 5); }
else selectTab(store.get('gc-tab', 'solo'));

// ================================================================ main loop
window.GulpCity = { app, startLocal, render }; // debugging handle
makeDemo();
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; clock += dt;
  const g = app.game;
  if (g && app.state === 'playing') {
    for (const v of app.viewers) {
      const inp = readInput(v);
      if (app.mode === 'client') app.net.sendInput(inp, now);
      else { const h = g.holes[v.holeId]; h.ix = inp.x; h.iy = inp.y; }
    }
    if (app.mode !== 'client') {
      g.step(dt);
      if (app.mode === 'host') app.net.tick(dt);
      if (g.over) endRound();
    } else g.timeLeft = Math.max(0, g.timeLeft - dt);
  } else if (!g) {
    app.demo.step(dt); app.demoAge += dt;
    if (app.demoAge > 180) makeDemo();
  }
  (app.game || app.demo).visual(dt);
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
