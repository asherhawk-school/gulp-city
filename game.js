'use strict';
/* Gulp City — steer a sinkhole, swallow the city, outgrow your rivals.
   Modes: vs bots, local split-screen 2P, online (PeerJS, host-authoritative). */
(() => {
// ================================================================ helpers
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const cleanName = (s, d) => String(s || '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || d;

// ================================================================ config
const N = 7, BLOCK = 520, ROAD = 150, SIDEWALK = 26, MID = (N - 1) / 2;
const WORLD = N * BLOCK + (N + 1) * ROAD; // 4840
const START_R = 18, MAX_R = 260, EAT = 0.85, GROW = 2.3;
const radiusFor = s => Math.min(MAX_R, START_R + GROW * Math.sqrt(s));
const scoreForR = R => Math.max(0, ((R - START_R) / GROW) ** 2);
const speedFor = r => 195 + r * 0.35;

const COLORS = ['#ff7ab6', '#7ad7ff', '#ffd35a', '#8affa1', '#c38bff', '#ff9f5a',
  '#5affe7', '#ff5a6e', '#b4ff5a', '#5a8bff', '#ffb4f0', '#f5f5f5'];
const BOT_NAMES = ['Gobbler', 'Sir Slurp', 'Big Dipper', 'Munchkin', 'Void Boi', 'Pothole Pete',
  'Crater Kate', 'Abyss', 'Nom Nom', 'Sinky', 'The Pit', 'Burp', 'Dr. Dig', 'Mx. Hollow'];

// r = swallow size, pts = score, w/d = footprint, h = height
const T = {
  person:   { r: 6,   pts: 1,   kind: 'person' },
  cone:     { r: 6,   pts: 1,   kind: 'cone' },
  hydrant:  { r: 6,   pts: 1,   kind: 'hydrant' },
  trash:    { r: 8,   pts: 2,   kind: 'can' },
  bush:     { r: 11,  pts: 2,   kind: 'bush' },
  bench:    { r: 13,  pts: 3,   kind: 'box', w: 26, d: 10, h: 6 },
  lamp:     { r: 9,   pts: 3,   kind: 'lamp' },
  tree:     { r: 17,  pts: 5,   kind: 'tree' },
  car:      { r: 22,  pts: 10,  kind: 'car', w: 40, d: 20 },
  van:      { r: 27,  pts: 14,  kind: 'car', w: 50, d: 24 },
  kiosk:    { r: 26,  pts: 15,  kind: 'box', w: 42, d: 42, h: 24 },
  fountain: { r: 40,  pts: 30,  kind: 'fountain', w: 70, d: 70 },
  bus:      { r: 44,  pts: 35,  kind: 'car', w: 86, d: 28 },
  house:    { r: 48,  pts: 40,  kind: 'box', w: 80, d: 76, h: 44 },
  shop:     { r: 64,  pts: 70,  kind: 'box', w: 118, d: 92, h: 56 },
  tower:    { r: 92,  pts: 150, kind: 'box', w: 150, d: 150, h: 150 },
  sky:      { r: 122, pts: 300, kind: 'box', w: 190, d: 190, h: 280 },
};
const TIERS = [['Trees', 17], ['Cars', 22], ['Kiosks', 26], ['Fountains', 40], ['Buses', 44],
  ['Houses', 48], ['Shops', 64], ['Towers', 92], ['Skyscrapers', 122]];

const DIFF = {
  easy:   { react: .6,  search: 500,  fear: 100, aware: .45, aggr: .25, speed: .82 },
  normal: { react: .35, search: 750,  fear: 220, aware: .85, aggr: .8,  speed: .94 },
  hard:   { react: .16, search: 1050, fear: 330, aware: 1,   aggr: 1.5, speed: 1 },
};

// ================================================================ world generation
const SHIRTS = ['#ff5a6e', '#2a9df4', '#ffd35a', '#3ecf8e', '#c38bff', '#ff9f5a', '#5affe7', '#ffffff'];
const SKIN = ['#f6d2b4', '#e0a982', '#b97a50', '#8a5636', '#f1c27d'];
const CAR_COLORS = ['#e84a5f', '#2a9df4', '#ffd35a', '#f2f2f2', '#3ecf8e', '#9b59b6', '#ff8c42', '#3a4258'];

function genWorld(seed) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + rnd() * (b - a);
  const pick = a => a[(rnd() * a.length) | 0];
  const objs = [], blocks = [];
  let local = [];

  function style(o) {
    switch (o.type) {
      case 'person': o.c1 = pick(SHIRTS); o.c2 = pick(SKIN); break;
      case 'car': o.c1 = pick(CAR_COLORS); break;
      case 'van': o.c1 = pick(['#f2f2f2', '#c9ccd6', '#6b7a99', '#ffd35a']); break;
      case 'bus': o.c1 = pick(['#ffcc33', '#e84a5f', '#3ecf8e', '#2a9df4']); break;
      case 'tree': case 'bush': o.c1 = pick(['#3fae5a', '#4fbf63', '#2f9a4f', '#5cc46d']); break;
      case 'house': o.c2 = pick(['#f4d6b0', '#f0c2c2', '#cfe3f5', '#e8f0c8', '#f5e6a8']); o.c1 = pick(['#d9534f', '#5b7fd6', '#8a5a44', '#4aa37a', '#b86ad9']); break;
      case 'shop': o.c2 = pick(['#f7b267', '#7ad7ff', '#ff9fb2', '#b8e986', '#e0c3fc']); o.c1 = pick(['#ece6f2', '#dfe3ea', '#f1ead0']); o.c3 = pick(['#e84a5f', '#2a9df4', '#3ecf8e', '#ff8c42']); break;
      case 'kiosk': o.c2 = pick(['#ff7a7a', '#ffd35a', '#7ad7ff', '#c38bff']); o.c1 = '#f7f3ea'; break;
      case 'tower': o.c2 = pick(['#8fa8c8', '#9fb7a8', '#b9a8c8', '#c8b28f', '#a8b4c2']); o.c1 = pick(['#6f7f96', '#7a8a7f', '#857a96', '#8f806a']); break;
      case 'sky': o.c2 = pick(['#6b8fd6', '#5aa6b8', '#8a7fd6', '#4f6f9f']); o.c1 = pick(['#3d4f7a', '#38566a', '#4d4777']); break;
      case 'bench': o.c2 = '#8a5a33'; o.c1 = '#b97a45'; break;
    }
    if (o.c1) o.c1d = shade(o.c1, -0.28);
    if (o.c2) o.wall = shade(o.c2, -0.2);
  }
  function fits(x, y, hw, hd) {
    for (const o of local) if (Math.abs(o.x - x) < o.hw + hw + 4 && Math.abs(o.y - y) < o.hd + hd + 4) return false;
    return true;
  }
  function put(type, x, y, rot = false) {
    const ty = T[type];
    let w = ty.w || ty.r * 1.6, d = ty.d || ty.r * 1.6;
    if (rot) [w, d] = [d, w];
    if (!fits(x, y, w / 2, d / 2)) return null;
    const o = { id: objs.length, type, kind: ty.kind, x, y, w, d, hw: w / 2, hd: d / 2, r: ty.r, pts: ty.pts,
      h: ty.h || 0, rot, alive: true, ph: rnd() * 6.283 };
    style(o);
    objs.push(o); local.push(o);
    return o;
  }
  function scatter(type, n, x0, y0, s) {
    const ty = T[type], m = (ty.w ? Math.max(ty.w, ty.d) / 2 : ty.r) + 2;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 14; k++)
        if (put(type, R(x0 + m, x0 + s - m), R(y0 + m, y0 + s - m), ty.w ? rnd() < .5 : false)) break;
  }

  const inner = SIDEWALK + 8;
  for (let bi = 0; bi < N; bi++) for (let bj = 0; bj < N; bj++) {
    const x0 = ROAD + bi * (BLOCK + ROAD), y0 = ROAD + bj * (BLOCK + ROAD);
    const ring = Math.max(Math.abs(bi - MID), Math.abs(bj - MID));
    const q = rnd();
    const kind = ring === 0 ? 'plaza'
      : ring === 1 ? (q < .5 ? 'downtown' : q < .8 ? 'commercial' : 'park')
      : ring === 2 ? (q < .35 ? 'residential' : q < .65 ? 'commercial' : q < .82 ? 'park' : 'downtown')
      : (q < .6 ? 'residential' : q < .78 ? 'park' : 'commercial');
    blocks.push({ x: x0, y: y0, kind });
    local = [];
    const ix = x0 + inner, iy = y0 + inner, is = BLOCK - inner * 2;

    if (kind === 'residential') {
      const L = is / 3;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const cx = ix + L * (a + .5) + R(-12, 12), cy = iy + L * (b + .5) + R(-12, 12);
        if (rnd() < .85) put('house', cx, cy, rnd() < .3); else put('tree', cx, cy);
      }
      scatter('tree', 6, ix, iy, is); scatter('bush', 8, ix, iy, is); scatter('person', 6, ix, iy, is);
    } else if (kind === 'commercial') {
      const L = is / 2;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const cx = ix + L * (a + .5) + R(-18, 18), cy = iy + L * (b + .5) + R(-18, 18);
        if (rnd() < .75) put('shop', cx, cy, rnd() < .5); else put('kiosk', cx, cy);
      }
      scatter('kiosk', 2, ix, iy, is); scatter('bench', 4, ix, iy, is); scatter('person', 14, ix, iy, is);
      scatter('trash', 3, ix, iy, is); scatter('tree', 3, ix, iy, is); scatter('lamp', 2, ix, iy, is);
    } else if (kind === 'downtown') {
      const L = is / 2; let sky = 1;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const cx = ix + L * (a + .5) + R(-10, 10), cy = iy + L * (b + .5) + R(-10, 10), r = rnd();
        if (sky && r < .3) { put('sky', cx, cy); sky--; }
        else if (r < .7) put('tower', cx, cy);
        else put('shop', cx, cy, rnd() < .5);
      }
      scatter('person', 12, ix, iy, is); scatter('bench', 3, ix, iy, is); scatter('lamp', 3, ix, iy, is);
      scatter('trash', 2, ix, iy, is); scatter('tree', 2, ix, iy, is);
    } else if (kind === 'park') {
      put('fountain', ix + is / 2, iy + is / 2);
      scatter('tree', 16, ix, iy, is); scatter('bush', 12, ix, iy, is); scatter('bench', 6, ix, iy, is);
      scatter('person', 16, ix, iy, is); scatter('lamp', 4, ix, iy, is); scatter('trash', 2, ix, iy, is);
    } else { // central plaza
      put('sky', ix + is / 2, iy + is / 2);
      for (const [fx, fy] of [[60, 60], [is - 60, 60], [60, is - 60], [is - 60, is - 60]]) put('fountain', ix + fx, iy + fy);
      for (const [kx, ky] of [[is / 2, 40], [is / 2, is - 40], [40, is / 2], [is - 40, is / 2]]) put('kiosk', ix + kx, iy + ky);
      scatter('person', 24, ix, iy, is); scatter('bench', 6, ix, iy, is); scatter('lamp', 4, ix, iy, is); scatter('tree', 4, ix, iy, is);
    }
    // sidewalk props
    const sw = SIDEWALK / 2;
    for (let side = 0; side < 4; side++) {
      for (let p = 40; p < BLOCK - 30; p += R(45, 85)) {
        const x = side === 0 || side === 1 ? x0 + p : side === 2 ? x0 + sw : x0 + BLOCK - sw;
        const y = side === 2 || side === 3 ? y0 + p : side === 0 ? y0 + sw : y0 + BLOCK - sw;
        const r = rnd();
        const type = r < .28 ? 'person' : r < .46 ? 'lamp' : r < .56 ? 'hydrant' : r < .66 ? 'trash' : r < .78 ? 'tree' : null;
        if (type) put(type, x, y);
      }
    }
  }

  // vehicles and cones on roads
  local = [];
  const LANE = 34;
  for (const vertical of [false, true]) {
    for (let k = 0; k <= N; k++) {
      const c = ROAD / 2 + k * (BLOCK + ROAD);
      for (let i = 0; i < N; i++) {
        const s0 = ROAD + i * (BLOCK + ROAD);
        for (const lane of [-LANE, LANE]) {
          const n = (rnd() * 3.2) | 0;
          for (let j = 0; j < n; j++) {
            const q = rnd(), type = q < .68 ? 'car' : q < .87 ? 'van' : 'bus';
            const along = R(s0 + 55, s0 + BLOCK - 55);
            if (vertical) put(type, c + lane, along, true); else put(type, along, c + lane, false);
          }
        }
        if (rnd() < .18) {
          const along = R(s0 + 80, s0 + BLOCK - 120), off = rnd() < .5 ? -8 : 8;
          for (let m = 0; m < 4; m++) vertical ? put('cone', c + off, along + m * 16) : put('cone', along + m * 16, c + off);
        }
      }
    }
  }
  return { objs, blocks };
}

// spatial grid for objects
const CELL = 250, GN = Math.ceil(WORLD / CELL);
function buildGrid(objs) {
  const g = Array.from({ length: GN * GN }, () => []);
  for (const o of objs) g[clamp(o.y / CELL | 0, 0, GN - 1) * GN + clamp(o.x / CELL | 0, 0, GN - 1)].push(o);
  return g;
}
function forNear(g, x, y, rad, fn) {
  const x0 = clamp((x - rad) / CELL | 0, 0, GN - 1), x1 = clamp((x + rad) / CELL | 0, 0, GN - 1);
  const y0 = clamp((y - rad) / CELL | 0, 0, GN - 1), y1 = clamp((y + rad) / CELL | 0, 0, GN - 1);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const o of g[cy * GN + cx]) fn(o);
}

// ================================================================ game simulation
function newHole(id, p) {
  return { id, name: p.name, color: p.color, isBot: !!p.isBot, x: WORLD / 2, y: WORLD / 2, tx: WORLD / 2, ty: WORLD / 2,
    vx: 0, vy: 0, ix: 0, iy: 0, score: 0, r: START_R, vr: START_R, alive: true, respawn: 0, inv: 0, kills: 0,
    killer: '', placed: false,
    ai: { t: Math.random() * .3, tx: WORLD / 2, ty: WORLD / 2, mode: 'eat', chase: null, threat: null, wob: Math.random() * 6 } };
}

class Game {
  constructor(o) {
    const w = genWorld(o.seed);
    this.seed = o.seed; this.objs = w.objs; this.blocks = w.blocks; this.grid = buildGrid(this.objs);
    this.duration = o.duration; this.timeLeft = o.duration; this.diff = DIFF[o.difficulty] || DIFF.normal;
    this.remote = !!o.remote; this.record = !!o.record;
    this.holes = o.holes.map((p, i) => newHole(i, p));
    this.falling = []; this.feed = []; this.events = []; this.kills = []; this.over = false; this.t = 0;
    if (!this.remote) for (const h of this.holes) this.place(h);
  }
  place(h) {
    let best = null, bestD = -Infinity;
    for (let i = 0; i < 24; i++) {
      const x = 200 + Math.random() * (WORLD - 400), y = 200 + Math.random() * (WORLD - 400);
      let md = Infinity;
      for (const o of this.holes) if (o !== h && o.placed && o.alive) md = Math.min(md, Math.hypot(o.x - x, o.y - y) - o.r * 2);
      if (md > bestD) { bestD = md; best = [x, y]; }
      if (md > 700) break;
    }
    h.x = h.tx = best[0]; h.y = h.ty = best[1]; h.vx = h.vy = 0; h.placed = true; h.vr = h.r;
  }
  step(dt) {
    if (this.over) return;
    this.t += dt; this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; return; }
    for (const h of this.holes) {
      if (!h.alive) {
        h.respawn -= dt;
        if (h.respawn <= 0) { h.alive = true; h.inv = 3; this.place(h); }
        continue;
      }
      if (h.inv > 0) h.inv -= dt;
      if (h.isBot) this.bot(h, dt);
      let ix = h.ix, iy = h.iy; const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
      const sp = speedFor(h.r) * (h.isBot ? this.diff.speed : 1), k = Math.min(1, dt * 9);
      h.vx += (ix * sp - h.vx) * k; h.vy += (iy * sp - h.vy) * k;
      h.x = clamp(h.x + h.vx * dt, 10, WORLD - 10); h.y = clamp(h.y + h.vy * dt, 10, WORLD - 10);
    }
    for (const h of this.holes) {
      if (!h.alive) continue;
      const lim = h.r * EAT;
      forNear(this.grid, h.x, h.y, h.r, o => {
        if (!o.alive || o.r > lim) return;
        const dx = o.x - h.x, dy = o.y - h.y, L = h.r - o.r * .35;
        if (dx * dx + dy * dy < L * L) this.swallow(h, o);
      });
    }
    const hs = this.holes.filter(h => h.alive).sort((a, b) => b.r - a.r);
    for (const a of hs) {
      if (!a.alive) continue;
      for (const b of hs) {
        if (b === a || !b.alive || b.inv > 0 || a.r < b.r * 1.2) continue;
        const L = a.r - b.r * .4;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < L * L) this.eatHole(a, b);
      }
    }
    for (const h of this.holes) h.r = radiusFor(h.score);
  }
  swallow(h, o) {
    o.alive = false; h.score += o.pts;
    this.falling.push({ o, h, t: 0 });
    if (this.record) this.events.push([o.id, h.id]);
    fx.swallow(this, h, o);
  }
  eatHole(a, b) {
    a.score += Math.floor(b.score * .3) + 15; a.kills++;
    b.score = Math.floor(b.score * .6); b.alive = false; b.respawn = 3; b.vx = b.vy = 0;
    if (this.record) this.kills.push([a.id, b.id]);
    this.addKill(a.id, b.id);
  }
  addKill(ai, bi) {
    const a = this.holes[ai], b = this.holes[bi];
    if (!a || !b) return;
    b.killer = a.name; b.respawn = 3;
    this.falling.push({ ghost: { x: b.x, y: b.y, r: b.vr, color: b.color }, h: a, t: 0 });
    this.note({ a, b });
    fx.kill(this, a, b);
  }
  note(item) { item.t = 5; this.feed.push(item); if (this.feed.length > 5) this.feed.shift(); }
  visual(dt) {
    for (const f of this.falling) f.t += dt * 1.7;
    this.falling = this.falling.filter(f => f.t < 1);
    const k = Math.min(1, dt * 14);
    for (const h of this.holes) {
      h.vr += (h.r - h.vr) * Math.min(1, dt * 4);
      if (this.remote) {
        h.x += (h.tx - h.x) * k; h.y += (h.ty - h.y) * k;
        if (!h.alive) h.respawn = Math.max(0, h.respawn - dt);
      }
    }
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter(f => f.t > 0);
  }

  // ---------- bot brain
  bot(h, dt) {
    const ai = h.ai;
    ai.t -= dt;
    if (ai.t <= 0) { ai.t = this.diff.react * (.7 + Math.random() * .6); this.think(h); }
    let dx, dy, m = 1;
    if (ai.mode === 'flee' && ai.threat && ai.threat.alive) {
      dx = h.x - ai.threat.x; dy = h.y - ai.threat.y;
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const E = 350;
      if (h.x < E) dx += (E - h.x) / E * 1.6;
      if (h.x > WORLD - E) dx -= (h.x - WORLD + E) / E * 1.6;
      if (h.y < E) dy += (E - h.y) / E * 1.6;
      if (h.y > WORLD - E) dy -= (h.y - WORLD + E) / E * 1.6;
    } else {
      const c = ai.chase;
      if (c) {
        if (c.alive && c.inv <= 0 && h.r >= c.r * 1.2) { ai.tx = c.x + c.vx * .3; ai.ty = c.y + c.vy * .3; }
        else ai.chase = null;
      }
      dx = ai.tx - h.x; dy = ai.ty - h.y;
      const d = Math.hypot(dx, dy) || 1; m = Math.min(1, d / 30); dx /= d; dy /= d;
    }
    ai.wob += dt * 2;
    dx += Math.cos(ai.wob) * .15; dy += Math.sin(ai.wob * 1.3) * .15;
    const L = Math.hypot(dx, dy) || 1;
    h.ix = dx / L * m; h.iy = dy / L * m;
  }
  think(h) {
    const ai = h.ai, D = this.diff;
    let threat = null, td = Infinity;
    if (h.inv <= 0) for (const o of this.holes) {
      if (o === h || !o.alive || o.r < h.r * 1.2) continue;
      const d = Math.hypot(o.x - h.x, o.y - h.y);
      if (d < o.r + D.fear && d < td) { td = d; threat = o; }
    }
    if (threat && Math.random() < D.aware) { ai.mode = 'flee'; ai.threat = threat; ai.chase = null; return; }
    ai.mode = 'eat'; ai.threat = null;
    let bv = 0, bx = 0, by = 0, chase = null;
    for (const o of this.holes) {
      if (o === h || !o.alive || o.inv > 0 || h.r < o.r * 1.2) continue;
      const d = Math.hypot(o.x - h.x, o.y - h.y);
      if (d > D.search) continue;
      const v = (o.score * .5 + 20) * D.aggr / (d + 60);
      if (v > bv) { bv = v; chase = o; }
    }
    const lim = h.r * EAT, S = D.search;
    forNear(this.grid, h.x, h.y, S, o => {
      if (!o.alive || o.r > lim) return;
      const d = Math.hypot(o.x - h.x, o.y - h.y);
      if (d > S) return;
      const v = o.pts / (d + 50);
      if (v > bv) { bv = v; bx = o.x; by = o.y; chase = null; }
    });
    if (chase) ai.chase = chase;
    else if (bv > 0) { ai.chase = null; ai.tx = bx; ai.ty = by; }
    else {
      ai.chase = null;
      if (Math.hypot(ai.tx - h.x, ai.ty - h.y) < 80) {
        ai.tx = clamp(h.x + (Math.random() - .5) * 1600, 150, WORLD - 150);
        ai.ty = clamp(h.y + (Math.random() - .5) * 1600, 150, WORLD - 150);
      }
    }
  }
}

function makeBots(n, off) {
  const names = [...BOT_NAMES].sort(() => Math.random() - .5);
  return Array.from({ length: n }, (_, i) => ({ name: names[i % names.length], color: COLORS[(off + i) % COLORS.length], isBot: true }));
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
const fx = {
  swallow(g, h, o) { if (isMine(g, h)) beep(950 - Math.min(750, o.r * 6), .08 + o.r / 600, 'sine', .045 + o.r / 2500); },
  kill(g, a, b) {
    if (isMine(g, a)) { lastSfx = 0; beep(520, .25, 'square', .05); }
    else if (isMine(g, b)) { lastSfx = 0; beep(160, .4, 'sawtooth', .05); }
  },
};

// ================================================================ rendering
const cv = $('game'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, clock = 0;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
addEventListener('resize', resize); resize();

const KIND_COL = { residential: '#a6d98f', park: '#86cf72', commercial: '#eadcbc', downtown: '#cfcadf', plaza: '#ecd6b0' };
function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill(); }

function drawGround(g, X0, X1, Y0, Y1) {
  ctx.fillStyle = '#55526a'; ctx.fillRect(0, 0, WORLD, WORLD);
  // lane dashes + crosswalks, segment by segment so the pattern stays fixed in the world
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let k = 0; k <= N; k++) {
    const c = ROAD / 2 + k * (BLOCK + ROAD);
    for (let i = 0; i < N; i++) {
      const s0 = ROAD + i * (BLOCK + ROAD);
      if (c > Y0 - ROAD && c < Y1 + ROAD && s0 < X1 && s0 + BLOCK > X0) {
        for (let p = s0 + 40; p < s0 + BLOCK - 40; p += 54) ctx.fillRect(p, c - 2, 28, 4);
        for (let j = 0; j < 7; j++) { ctx.fillRect(s0 + 4, c - ROAD / 2 + 14 + j * 18, 18, 9); ctx.fillRect(s0 + BLOCK - 22, c - ROAD / 2 + 14 + j * 18, 18, 9); }
      }
      if (c > X0 - ROAD && c < X1 + ROAD && s0 < Y1 && s0 + BLOCK > Y0) {
        for (let p = s0 + 40; p < s0 + BLOCK - 40; p += 54) ctx.fillRect(c - 2, p, 4, 28);
        for (let j = 0; j < 7; j++) { ctx.fillRect(c - ROAD / 2 + 14 + j * 18, s0 + 4, 9, 18); ctx.fillRect(c - ROAD / 2 + 14 + j * 18, s0 + BLOCK - 22, 9, 18); }
      }
    }
  }
  for (const b of g.blocks) {
    if (b.x > X1 || b.x + BLOCK < X0 || b.y > Y1 || b.y + BLOCK < Y0) continue;
    ctx.fillStyle = '#c9c3d6'; rr(b.x, b.y, BLOCK, BLOCK, 22); ctx.fill();
    ctx.fillStyle = KIND_COL[b.kind]; rr(b.x + SIDEWALK, b.y + SIDEWALK, BLOCK - 2 * SIDEWALK, BLOCK - 2 * SIDEWALK, 12); ctx.fill();
    if (b.kind === 'park') {
      ctx.fillStyle = '#e8d8b0';
      ctx.fillRect(b.x + BLOCK / 2 - 14, b.y + SIDEWALK, 28, BLOCK - 2 * SIDEWALK);
      ctx.fillRect(b.x + SIDEWALK, b.y + BLOCK / 2 - 14, BLOCK - 2 * SIDEWALK, 28);
    } else if (b.kind === 'plaza' || b.kind === 'downtown') {
      ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let p = 60; p < BLOCK - 30; p += 40) {
        ctx.moveTo(b.x + p, b.y + SIDEWALK); ctx.lineTo(b.x + p, b.y + BLOCK - SIDEWALK);
        ctx.moveTo(b.x + SIDEWALK, b.y + p); ctx.lineTo(b.x + BLOCK - SIDEWALK, b.y + p);
      }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#ff7ab6'; ctx.lineWidth = 10; ctx.strokeRect(-5, -5, WORLD + 10, WORLD + 10);
}

function drawHole(h) {
  const r = h.vr;
  ctx.save();
  if (h.inv > 0) ctx.globalAlpha = .55 + .45 * Math.sin(clock * 18);
  const gr = ctx.createRadialGradient(h.x, h.y - r * .15, r * .1, h.x, h.y, r);
  gr.addColorStop(0, '#000'); gr.addColorStop(.7, '#07040f'); gr.addColorStop(.92, '#1d1533'); gr.addColorStop(1, '#3a2d5c');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 6.2832); ctx.fill();
  ctx.lineWidth = Math.max(2.5, r * .07); ctx.strokeStyle = h.color; ctx.stroke();
  ctx.restore();
}
function drawHoleOverlay(h, s, mine) {
  ctx.save();
  ctx.globalAlpha = .4; ctx.setLineDash([10 / s, 8 / s]); ctx.lineWidth = 2 / s; ctx.strokeStyle = h.color;
  ctx.beginPath(); ctx.arc(h.x, h.y, h.vr, 0, 6.2832); ctx.stroke();
  ctx.restore();
  const fs = (mine ? 15 : 13) / s;
  ctx.font = `800 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 4 / s; ctx.strokeStyle = 'rgba(20,14,40,.85)'; ctx.fillStyle = h.color; ctx.lineJoin = 'round';
  const y = h.y - h.vr - 8 / s;
  ctx.strokeText(h.name, h.x, y); ctx.fillText(h.name, h.x, y);
}
function drawFalling(f) {
  const h = f.h, t = f.t, e = t * t;
  ctx.save();
  if (f.ghost) {
    const gh = f.ghost;
    ctx.globalAlpha = 1 - t; ctx.strokeStyle = gh.color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(gh.x + (h.x - gh.x) * e, gh.y + (h.y - gh.y) * e, Math.max(1, gh.r * (1 - t)), 0, 6.2832); ctx.stroke();
    ctx.restore(); return;
  }
  ctx.beginPath(); ctx.arc(h.x, h.y, h.vr * .97, 0, 6.2832); ctx.clip();
  const o = f.o, x = o.x + (h.x - o.x) * e, y = o.y + (h.y - o.y) * e + t * h.vr * .25;
  ctx.globalAlpha = 1 - t * .85;
  ctx.translate(x, y); ctx.rotate(t * (o.ph > 3 ? 1.3 : -1.3)); const sc = 1 - t * .75; ctx.scale(sc, sc); ctx.translate(-o.x, -o.y);
  drawObj(o);
  ctx.restore();
}

function drawObj(o) {
  const x = o.x, y = o.y;
  switch (o.kind) {
    case 'person': {
      const b = Math.abs(Math.sin(clock * 5 + o.ph)) * 1.6;
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(x, y + 1, 5, 2.5);
      ctx.fillStyle = o.c1; circle(x, y - 4 - b, 4.2);
      ctx.fillStyle = o.c2; circle(x, y - 9.5 - b, 3);
      break;
    }
    case 'cone':
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(x + 1, y + 2, 6, 2.5);
      ctx.fillStyle = '#ff8c2e'; ctx.beginPath(); ctx.moveTo(x - 5.5, y + 2); ctx.lineTo(x + 5.5, y + 2); ctx.lineTo(x, y - 11); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 2.8, y - 5, 5.6, 2.2);
      break;
    case 'hydrant':
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(x + 1, y + 1, 5, 2.5);
      ctx.fillStyle = '#e23d4f'; rr(x - 3.5, y - 10, 7, 11, 2); ctx.fill();
      ctx.fillStyle = '#ff7a88'; circle(x, y - 10, 3.5);
      break;
    case 'can':
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(x + 2, y + 1, 7, 3);
      ctx.fillStyle = '#5d6b7a'; ctx.fillRect(x - 5, y - 12, 10, 12);
      ctx.fillStyle = '#8796a8'; ellipse(x, y - 12, 5, 2.2);
      break;
    case 'bush':
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ellipse(x + 3, y + 3, 11, 5);
      ctx.fillStyle = o.c1d; circle(x - 4, y - 3, 7); circle(x + 5, y - 2, 7);
      ctx.fillStyle = o.c1; circle(x, y - 6, 7.5);
      break;
    case 'lamp':
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ellipse(x + 8, y + 2, 10, 2.5);
      ctx.strokeStyle = '#3a3550'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,170,.25)'; circle(x, y - 36, 8);
      ctx.fillStyle = '#fff3b0'; circle(x, y - 36, 4);
      break;
    case 'tree':
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ellipse(x + 6, y + 2, 15, 6);
      ctx.fillStyle = '#7a5234'; ctx.fillRect(x - 2.5, y - 12, 5, 12);
      ctx.fillStyle = o.c1d; circle(x, y - 18, 15);
      ctx.fillStyle = o.c1; circle(x - 3, y - 21, 11);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; circle(x - 6, y - 25, 4.5);
      break;
    case 'car': drawVehicle(o); break;
    case 'fountain': {
      ctx.fillStyle = 'rgba(0,0,0,.15)'; ellipse(x + 4, y + 5, 35, 30);
      ctx.fillStyle = '#d9d3e8'; circle(x, y, 34);
      ctx.fillStyle = '#b4abcb'; circle(x, y, 29);
      ctx.fillStyle = '#5cc2ff'; circle(x, y, 26);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { const rr2 = (clock * 14 + o.ph * 5 + i * 13) % 26; ctx.beginPath(); ctx.arc(x, y, rr2, 0, 6.2832); ctx.stroke(); }
      ctx.fillStyle = '#e9e4f5'; circle(x, y - 3, 7);
      ctx.fillStyle = '#ffffff'; circle(x, y - 6, 3);
      break;
    }
    case 'box': drawBox(o); break;
  }
}
function drawVehicle(o) {
  const x0 = o.x - o.hw, y0 = o.y - o.hd, w = o.w, d = o.d, Hh = o.type === 'bus' ? 12 : 7;
  ctx.fillStyle = 'rgba(0,0,0,.22)'; rr(x0 + 4, y0 + 3, w, d, 6); ctx.fill();
  ctx.fillStyle = o.c1d; rr(x0, y0 - Hh, w, d + Hh, 6); ctx.fill();
  ctx.fillStyle = o.c1; rr(x0, y0 - Hh, w, d, 6); ctx.fill();
  ctx.fillStyle = 'rgba(30,40,70,.75)';
  const fwd = o.ph > 3 ? 1 : -1;
  if (o.type === 'bus') {
    if (!o.rot) { for (let p = x0 + 8; p < x0 + w - 10; p += 13) ctx.fillRect(p, y0 + d - Hh + 2, 9, Hh - 5); }
    else { for (let p = y0 - Hh + 8; p < y0 + d - Hh - 6; p += 13) ctx.fillRect(x0 + 3, p, w - 6, 3); ctx.fillRect(x0 + 3, y0 + d - Hh + 2, w - 6, Hh - 5); }
    ctx.fillStyle = 'rgba(255,255,255,.35)'; !o.rot ? ctx.fillRect(x0 + 6, y0 - Hh + d / 2 - 2, w - 12, 4) : ctx.fillRect(x0 + w / 2 - 2, y0 - Hh + 6, 4, d - 12);
  } else if (!o.rot) {
    const cx = o.x + fwd * w * .08;
    ctx.fillRect(cx - w * .24, y0 - Hh + 3, w * .48, d - 6);
    ctx.fillStyle = o.c1; ctx.fillRect(cx - w * .14, y0 - Hh + 4, w * .28, d - 8);
    ctx.fillStyle = o.c1d; ctx.fillRect(x0 + 4, y0 + d - Hh + 2, 6, Hh - 3); ctx.fillRect(x0 + w - 10, y0 + d - Hh + 2, 6, Hh - 3);
  } else {
    const cy = o.y - Hh + fwd * d * .08;
    ctx.fillRect(x0 + 3, cy - d * .24, w - 6, d * .48);
    ctx.fillStyle = o.c1; ctx.fillRect(x0 + 4, cy - d * .14, w - 8, d * .28);
    ctx.fillStyle = 'rgba(30,40,70,.75)'; ctx.fillRect(x0 + 3, y0 + d - Hh + 2, w - 6, Hh - 4);
  }
}
function drawBox(o) {
  const Hh = o.h * .45, x0 = o.x - o.hw, y0 = o.y - o.hd, w = o.w, d = o.d, t = o.type;
  ctx.fillStyle = 'rgba(30,15,50,.2)';
  ctx.beginPath(); ctx.moveTo(x0 + w, y0 - Hh * .2); ctx.lineTo(x0 + w + Hh * .55, y0 + Hh * .25); ctx.lineTo(x0 + w + Hh * .55, y0 + d + Hh * .25);
  ctx.lineTo(x0 + Hh * .55, y0 + d + Hh * .25); ctx.lineTo(x0, y0 + d); ctx.fill();
  ctx.fillStyle = o.wall; ctx.fillRect(x0, y0 - Hh, w, d + Hh);
  const wy = y0 + d - Hh; // top of the visible front wall
  if (t === 'house') {
    ctx.fillStyle = '#6b4a3a'; ctx.fillRect(o.x - 6, y0 + d - 15, 12, 15);
    ctx.fillStyle = '#cfeaff'; ctx.fillRect(x0 + 10, wy + 4, 14, 8); ctx.fillRect(x0 + w - 24, wy + 4, 14, 8);
  } else if (t === 'shop') {
    ctx.fillStyle = '#cfeaff'; ctx.fillRect(x0 + 8, wy + 10, w - 16, Hh - 12);
    for (let p = 0, i = 0; p < w; p += 12, i++) { ctx.fillStyle = i % 2 ? '#fff' : o.c3; ctx.fillRect(x0 + p, wy, Math.min(12, w - p), 8); }
  } else if (t === 'tower' || t === 'sky') {
    ctx.fillStyle = t === 'sky' ? 'rgba(200,230,255,.8)' : 'rgba(255,245,215,.75)';
    for (let yy = wy + 6; yy < y0 + d - 8; yy += 11)
      for (let xx = x0 + 7; xx < x0 + w - 10; xx += 14) ctx.fillRect(xx, yy, 8, 6);
    ctx.fillStyle = '#2c2840'; ctx.fillRect(o.x - 9, y0 + d - 13, 18, 13);
  } else if (t === 'kiosk') {
    for (let p = 0, i = 0; p < w; p += 7, i++) { ctx.fillStyle = i % 2 ? '#fff' : o.c2; ctx.fillRect(x0 + p, wy, Math.min(7, w - p), 6); }
  }
  ctx.fillStyle = o.c1; ctx.fillRect(x0, y0 - Hh, w, d);
  if (t === 'house') {
    ctx.fillStyle = o.c1d;
    if (w >= d) ctx.fillRect(x0, y0 - Hh + d / 2, w, d / 2); else ctx.fillRect(x0 + w / 2, y0 - Hh, w / 2, d);
  } else if (t === 'shop') {
    ctx.fillStyle = '#b9b3c6'; ctx.fillRect(x0 + 12, y0 - Hh + 12, 16, 12); ctx.fillRect(x0 + w - 30, y0 - Hh + d - 26, 18, 14);
  } else if (t === 'tower' || t === 'sky') {
    ctx.strokeStyle = o.c1d; ctx.lineWidth = 6; ctx.strokeRect(x0 + 3, y0 - Hh + 3, w - 6, d - 6);
    if (t === 'sky') {
      ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(o.x, o.y - Hh, 30, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = '#ffd35a'; ctx.fillRect(o.x - 10, o.y - Hh - 3, 20, 6);
    } else { ctx.fillStyle = '#c7c2d4'; ctx.fillRect(o.x - 20, o.y - Hh - 14, 40, 28); }
  } else if (t === 'kiosk') {
    ctx.fillStyle = o.c2; ctx.fillRect(x0, y0 - Hh, w / 4, d); ctx.fillRect(x0 + w / 2, y0 - Hh, w / 4, d);
  }
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0 - Hh, w, d + Hh);
  ctx.beginPath(); ctx.moveTo(x0, y0 - Hh + d); ctx.lineTo(x0 + w, y0 - Hh + d); ctx.stroke();
}

const visList = [];
function renderView(g, view, cam, me) {
  ctx.save();
  ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
  ctx.fillStyle = '#231c3a'; ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.translate(view.x + view.w / 2, view.y + view.h / 2); ctx.scale(cam.s, cam.s); ctx.translate(-cam.x, -cam.y);
  const hw = view.w / 2 / cam.s, hh = view.h / 2 / cam.s;
  const X0 = cam.x - hw, X1 = cam.x + hw, Y0 = cam.y - hh, Y1 = cam.y + hh;
  drawGround(g, X0, X1, Y0, Y1);
  for (const h of g.holes) if (h.alive && h.x + h.vr > X0 && h.x - h.vr < X1 && h.y + h.vr > Y0 && h.y - h.vr < Y1) drawHole(h);
  for (const f of g.falling) drawFalling(f);
  visList.length = 0;
  const cx0 = clamp((X0 - 130) / CELL | 0, 0, GN - 1), cx1 = clamp((X1 + 130) / CELL | 0, 0, GN - 1);
  const cy0 = clamp((Y0 - 130) / CELL | 0, 0, GN - 1), cy1 = clamp((Y1 + 260) / CELL | 0, 0, GN - 1);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++)
    for (const o of g.grid[cy * GN + cx]) if (o.alive) visList.push(o);
  visList.sort((a, b) => (a.y + a.hd) - (b.y + b.hd));
  for (const o of visList) drawObj(o);
  for (const h of g.holes) if (h.alive) drawHoleOverlay(h, cam.s, h === me);
  ctx.restore();
}

// ---------- HUD
function pill(x, y, w, h, r = 10) { ctx.fillStyle = 'rgba(20,14,40,.66)'; rr(x, y, w, h, r); ctx.fill(); }
function fmtTime(s) { s = Math.ceil(s); return `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; }
function fitText(t, maxW) {
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function drawMinimap(g, view, me) {
  const S = Math.min(140, view.w * .28, view.h * .28), x = view.x + view.w - S - 12, y = view.y + view.h - S - 12, k = S / WORLD;
  pill(x - 4, y - 4, S + 8, S + 8, 8);
  ctx.fillStyle = '#55526a'; ctx.fillRect(x, y, S, S);
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
  // timer
  const tx = narrow ? 104 : W / 2;
  pill(tx - 48, 10, 96, 38, 19);
  ctx.font = '800 22px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = g.timeLeft <= 10 ? '#ff7a7a' : '#fff'; ctx.fillText(fmtTime(g.timeLeft), tx, 30);
  // leaderboard
  const sorted = [...g.holes].sort((a, b) => b.score - a.score);
  const mine = viewers.map(v => g.holes[v.holeId]);
  const rows = sorted.slice(0, narrow ? 4 : 6).map(h => ({ h, rank: sorted.indexOf(h) + 1 }));
  for (const h of mine) if (h && !rows.some(r => r.h === h)) rows.push({ h, rank: sorted.indexOf(h) + 1 });
  const lw = narrow ? 160 : 210, lx = W - lw - 10;
  pill(lx, 10, lw, 14 + rows.length * 22, 12);
  ctx.font = '700 13px system-ui, sans-serif';
  rows.forEach((r, i) => {
    const y = 28 + i * 22, me = mine.includes(r.h);
    ctx.fillStyle = r.h.color; circle(lx + 16, y, 5);
    ctx.textAlign = 'left'; ctx.fillStyle = me ? '#fff' : '#c9bff0';
    ctx.font = `${me ? 800 : 600} 13px system-ui, sans-serif`;
    ctx.fillText(fitText(`${r.rank}. ${r.h.name}`, lw - 80), lx + 27, y);
    ctx.textAlign = 'right'; ctx.fillText(r.h.score, lx + lw - 10, y);
  });
  // feed
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'left';
  let fy = 64 + (narrow ? 0 : 0);
  for (const f of g.feed) {
    ctx.globalAlpha = Math.min(1, f.t);
    const text = f.text || `${f.a.name} swallowed ${f.b.name}!`;
    const tw = Math.min(ctx.measureText(text).width, narrow ? W - lw - 40 : 360);
    pill(10, fy - 12, tw + 18, 24, 8);
    ctx.fillStyle = f.a ? f.a.color : '#fff'; ctx.fillText(fitText(text, tw), 19, fy);
    fy += 28; ctx.globalAlpha = 1;
  }
  // per-viewer panels
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
      const tw = Math.min(ctx.measureText(msg).width + 30, view.w - 24);
      const hy = narrow ? view.y + view.h * .66 : view.y + 60;
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

function layoutViews(n) {
  if (n < 2) return [{ x: 0, y: 0, w: W, h: H }];
  if (W >= H) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
  return [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
}
function updateCam(v, h, view, dt) {
  const ts = Math.min(view.w, view.h) / (520 + h.vr * 7);
  if (!v.cam) v.cam = { x: h.x, y: h.y, s: ts };
  const k = Math.min(1, dt * 8);
  v.cam.x += (h.x - v.cam.x) * k; v.cam.y += (h.y - v.cam.y) * k;
  v.cam.s += (ts - v.cam.s) * Math.min(1, dt * 2);
}
function render(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = app.game || app.demo;
  const viewers = app.game ? app.viewers : [app.demoV];
  const views = layoutViews(viewers.length);
  viewers.forEach((v, i) => {
    let h;
    if (app.game) h = g.holes[v.holeId];
    else {
      v.sw -= dt;
      if (v.sw <= 0 || !g.holes[v.follow].alive) { v.sw = 8; v.follow = [...g.holes].filter(x => x.alive).sort((a, b) => b.score - a.score)[0]?.id ?? 0; }
      h = g.holes[v.follow];
    }
    v.view = views[i];
    updateCam(v, h, views[i], dt);
    renderView(g, views[i], v.cam, h);
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
cv.addEventListener('pointerdown', e => {
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
    const h = app.game.holes[v.holeId];
    const sx = v.view.x + v.view.w / 2 + (h.x - v.cam.x) * v.cam.s, sy = v.view.y + v.view.h / 2 + (h.y - v.cam.y) * v.cam.s;
    const dx = mouse.x - sx, dy = mouse.y - sy, d = Math.hypot(dx, dy);
    if (d < 10) return ZERO;
    const m = Math.min(1, d / 140);
    return { x: dx / d * m, y: dy / d * m };
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
    ev: g.events, k: g.kills };
  g.events = []; g.kills = [];
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
    if (o && h && o.alive) { o.alive = false; g.falling.push({ o, h, t: 0 }); fx.swallow(g, h, o); }
  }
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

// ---------- wire up menu
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
window.GulpCity = { app, Game, genWorld, makeBots, startLocal, render }; // debugging handle
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
    if (app.demoAge > 120) makeDemo();
  }
  (app.game || app.demo).visual(dt);
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
