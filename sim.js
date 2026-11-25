'use strict';
/* Gulp City simulation: world generation, holes, bots, regrowth. No rendering here,
   so it runs the same in the browser, on the online host, and in headless tests. */
(() => {
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const cleanName = (s, d) => String(s || '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14) || d;

// ---------------------------------------------------------------- config
const N = 7, BLOCK = 520, ROAD = 150, SIDEWALK = 26, MID = (N - 1) / 2;
const WORLD = N * BLOCK + (N + 1) * ROAD; // 4840
const START_R = 18, MAX_R = 260, EAT = 0.85, GROW = 2.3;
const radiusFor = s => Math.min(MAX_R, START_R + GROW * Math.sqrt(s));
const scoreForR = R => Math.max(0, ((R - START_R) / GROW) ** 2);
const speedFor = r => 195 + r * 0.35;
// seconds until a swallowed object is rebuilt (bigger things take longer)
const regrowDelay = o => 14 + o.r * 0.45 + Math.random() * 8;

const COLORS = ['#ff7ab6', '#7ad7ff', '#ffd35a', '#8affa1', '#c38bff', '#ff9f5a',
  '#5affe7', '#ff5a6e', '#b4ff5a', '#5a8bff', '#ffb4f0', '#f5f5f5'];
const BOT_NAMES = ['Gobbler', 'Sir Slurp', 'Big Dipper', 'Munchkin', 'Void Boi', 'Pothole Pete',
  'Crater Kate', 'Abyss', 'Nom Nom', 'Sinky', 'The Pit', 'Burp', 'Dr. Dig', 'Mx. Hollow'];

// r = swallow size, pts = score, w/d = footprint
const T = {
  person:   { r: 6,   pts: 1,   kind: 'person' },
  cone:     { r: 6,   pts: 1,   kind: 'cone' },
  hydrant:  { r: 6,   pts: 1,   kind: 'hydrant' },
  trash:    { r: 8,   pts: 2,   kind: 'can' },
  bush:     { r: 11,  pts: 2,   kind: 'bush' },
  bench:    { r: 13,  pts: 3,   kind: 'box', w: 26, d: 10 },
  lamp:     { r: 9,   pts: 3,   kind: 'lamp' },
  tree:     { r: 17,  pts: 5,   kind: 'tree' },
  car:      { r: 22,  pts: 10,  kind: 'car', w: 40, d: 20 },
  van:      { r: 27,  pts: 14,  kind: 'car', w: 50, d: 24 },
  kiosk:    { r: 26,  pts: 15,  kind: 'box', w: 42, d: 42 },
  fountain: { r: 40,  pts: 30,  kind: 'fountain', w: 70, d: 70 },
  bus:      { r: 44,  pts: 35,  kind: 'car', w: 86, d: 28 },
  house:    { r: 48,  pts: 40,  kind: 'box', w: 80, d: 76 },
  shop:     { r: 64,  pts: 70,  kind: 'box', w: 118, d: 92 },
  tower:    { r: 92,  pts: 150, kind: 'box', w: 150, d: 150 },
  sky:      { r: 122, pts: 300, kind: 'box', w: 190, d: 190 },
};
const TIERS = [['Trees', 17], ['Cars', 22], ['Kiosks', 26], ['Fountains', 40], ['Buses', 44],
  ['Houses', 48], ['Shops', 64], ['Towers', 92], ['Skyscrapers', 122]];

const DIFF = {
  easy:   { react: .6,  search: 500,  fear: 100, aware: .45, aggr: .25, speed: .82 },
  normal: { react: .35, search: 750,  fear: 220, aware: .85, aggr: .8,  speed: .94 },
  hard:   { react: .16, search: 1050, fear: 330, aware: 1,   aggr: 1.5, speed: 1 },
};

// ---------------------------------------------------------------- world generation
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
      case 'kiosk': o.c2 = pick(['#ff7a7a', '#ffd35a', '#7ad7ff', '#c38bff']); break;
      case 'tower': o.c2 = pick(['#8fa8c8', '#9fb7a8', '#b9a8c8', '#c8b28f', '#a8b4c2']); o.c1 = pick(['#6f7f96', '#7a8a7f', '#857a96', '#8f806a']); break;
      case 'sky': o.c2 = pick(['#6b8fd6', '#5aa6b8', '#8a7fd6', '#4f6f9f']); o.c1 = pick(['#3d4f7a', '#38566a', '#4d4777']); break;
      case 'bench': o.c2 = '#8a5a33'; o.c1 = '#b97a45'; break;
    }
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
      rot, alive: true, ph: rnd() * 6.283 };
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

// ---------------------------------------------------------------- game
const hooks = { swallow() {}, kill() {} };

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
    this.falling = []; this.feed = []; this.events = []; this.kills = []; this.regrown = [];
    this.regrow = []; this.rgT = 0; this.over = false; this.t = 0;
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
    this.rgT -= dt;
    if (this.rgT <= 0) { this.rgT = .25; this.tickRegrow(); }
  }
  // rebuild swallowed objects once their timer is up and no hole is sitting on the spot
  tickRegrow() {
    const keep = [];
    for (const e of this.regrow) {
      if (e.at > this.t) { keep.push(e); continue; }
      const o = e.o;
      if (this.holes.some(h => h.alive && Math.hypot(h.x - o.x, h.y - o.y) < h.r + o.r + 40)) { e.at = this.t + 2; keep.push(e); continue; }
      o.alive = true;
      if (this.record) this.regrown.push(o.id);
    }
    this.regrow = keep;
  }
  swallow(h, o) {
    o.alive = false; h.score += o.pts;
    this.falling.push({ o, h, t: 0 });
    this.regrow.push({ o, at: this.t + regrowDelay(o) });
    if (this.record) this.events.push([o.id, h.id]);
    hooks.swallow(this, h, o);
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
    this.note({ a, b });
    hooks.kill(this, a, b);
  }
  note(item) { item.t = 5; this.feed.push(item); if (this.feed.length > 5) this.feed.shift(); }
  visual(dt) {
    for (const f of this.falling) f.t += dt * 1.15;
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

window.Sim = { clamp, store, cleanName, N, BLOCK, ROAD, SIDEWALK, WORLD, EAT, T, TIERS, COLORS,
  radiusFor, scoreForR, genWorld, Game, makeBots, hooks };
})();
