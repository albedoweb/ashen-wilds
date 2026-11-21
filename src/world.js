// Ashen Wilds world: noise, biomes, deterministic chunk data, lair, signs, bonfires, blockers.
// No DOM, no canvas. Chunk data is pure: it never changes after generation.
(function (AW) {
'use strict';

function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let t = 0, amp = .5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { t += amp * vnoise(x * f, y * f, s + i * 101); n += amp; amp *= .5; f *= 2; }
  return t / n;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;
const lerp = (a, b, t) => a + (b - a) * t;

const TILE = 16, CHUNK = 16, CPX = TILE * CHUNK, CELL = 4;
const BIOME = ['The Withered Wood', 'The Drowned Fen', 'The Ashen Waste', 'The Barrow Fields', 'The Sunken Ruins'];
const BIOME_KEY = ['wood', 'fen', 'ash', 'barrows', 'ruins'];

// r: collision radius; flat: drawn on the ground layer; tall: casts a long shadow from the torch
const KINDS = {
  tree:    { r: 3, tall: 1 },
  burnt:   { r: 3, tall: 1 },
  pine:    { r: 3, tall: 1 },
  rock:    { r: 5 },
  menhir:  { r: 4, tall: 1 },
  grave:   { r: 4, tall: 1 },
  bones:   { r: 0, flat: 1 },
  reeds:   { r: 0 },
  thorns:  { r: 5 },
  stump:   { r: 4 },
  pillar:  { r: 5, tall: 1 },
  wallh:   { r: 8, tall: 1 },
  wallv:   { r: 7, tall: 1 },
  obelisk: { r: 6, tall: 1, light: [80, [170, 100, 255], .12] },
  brazier: { r: 5, dyn: 'brazier', light: [95, [255, 140, 50], .3] },
  candle:  { r: 0, dyn: 'candle', light: [36, [255, 170, 80], .3] },
  shroom:  { r: 0, dyn: 'shroom', light: [26, [80, 220, 200], .08] },
  vent:    { r: 0, flat: 1, dyn: 'vent', light: [42, [255, 70, 20], .35] },
  bonfire: { r: 7, dyn: 'bonfire', light: [130, [255, 130, 40], .3] },
  altar:   { r: 9, tall: 1, light: [60, [200, 200, 255], .1] },
};
const MAXR = 9;

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
// direction of (dx,dy) as an 8-way word (north is -y) and an exact unit vector
function compass(dx, dy) {
  const d = Math.hypot(dx, dy) || 1;
  const k = mod(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)), 8);
  return { dir: COMPASS[k], dirVec: { x: dx / d, y: dy / d } };
}

const chunkKey = (cx, cy) => cx * 65536 + cy;

// ---------------------------------------------------------------- world
function createWorld(SEED, cfg) {
  const chunks = new Map();
  let clock = 0;
  const lairAngle = hash2(SEED, 0, 7) * Math.PI * 2;
  const lairDistPx = cfg.lairDistance * TILE;
  const lair = { x: Math.cos(lairAngle) * lairDistPx, y: Math.sin(lairAngle) * lairDistPx, angle: lairAngle };
  const lastFire = { x: lair.x - Math.cos(lairAngle) * cfg.lastFireDist, y: lair.y - Math.sin(lairAngle) * cfg.lastFireDist };
  const camp = { x: 28, y: 18 };

  function field(tx, ty) {
    const m = fbm(tx / 48, ty / 48, SEED + 11, 3);
    const c = fbm(tx / 64, ty / 64, SEED + 23, 3);
    const g = fbm(tx / 20, ty / 20, SEED + 37, 2);
    const r = fbm(tx / 24, ty / 24, SEED + 53, 2);
    const sw = ss(.57, .63, m);
    const aw = ss(.57, .63, c) * (1 - sw);
    const rw = ss(.64, .69, r) * (1 - sw);
    const gw = ss(.62, .67, g) * (1 - sw) * (1 - aw) * (1 - rw);
    let b = 0;
    if (sw > .5) b = 1; else if (rw > .5) b = 4; else if (aw > .5) b = 2; else if (gw > .5) b = 3;
    let water = false;
    if (sw > .3) water = fbm(tx / 7, ty / 7, SEED + 71, 2) > .62 - sw * .12;
    return { sw, aw, gw, rw, b, water };
  }

  // arena objects, assigned to chunks when those are built
  const arena = [];
  for (let k = 0; k < cfg.obeliskCount; k++) {
    const a = k / cfg.obeliskCount * Math.PI * 2 + lairAngle;
    arena.push({ k: 'obelisk', x: lair.x + Math.cos(a) * cfg.obeliskRing, y: lair.y + Math.sin(a) * cfg.obeliskRing, arena: true });
  }
  arena.push({ k: 'altar', x: lair.x, y: lair.y, veil: true, arena: true });
  arena.push({ k: 'bonfire', x: lastFire.x, y: lastFire.y, last: true, arena: true });

  function signKind(dC) {
    const R = cfg.signRanges;
    return dC > R.ribbon ? 'ribbon' : dC > R.circle ? 'circle' : dC > R.crows ? 'crows' : 'blood';
  }
  function signInfo(kind, sx, sy) {
    const c = compass(lair.x - sx, lair.y - sy);
    return { dir: c.dir, dirVec: c.dirVec, text: cfg.signTexts[kind].replace('{dir}', c.dir), temp: cfg.signTemp[kind] };
  }

  function buildChunk(cx, cy) {
    const fields = [];
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) fields.push(field(cx * CHUNK + i + .5, cy * CHUNK + j + .5));
    const r = rng(Math.floor(hash2(cx, cy, SEED + 99) * 4294967296));
    const objs = [], wisps = [];
    const add = (k, x, y) => objs.push({ k, x, y, v: r() * 1e6 | 0, ph: r() * 100, pts: null });
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const f = fields[j * CHUNK + i];
      const tx = cx * CHUNK + i, ty = cy * CHUNK + j;
      const p = r(), jx = (tx + .2 + r() * .6) * TILE, jy = (ty + .2 + r() * .6) * TILE;
      if (Math.abs(tx) < 4 && Math.abs(ty) < 4) continue;          // the camp stays clear
      if (f.water) {
        if ((f.b === 1) && p < .006) wisps.push({ x: jx, y: jy, ph: r() * 100, c: [120, 255, 200] });
        continue;
      }
      const centreX = (tx + .5) * TILE, centreY = (ty + .5) * TILE;
      switch (f.b) {
        case 0: {
          const dens = fbm(tx / 12, ty / 12, SEED + 77, 2);
          const tr = .015 + Math.max(0, dens - .42) * .55;
          if (p < tr) add(r() < .7 ? 'tree' : 'pine', jx, jy);
          else if (p < tr + .03) add('thorns', jx, jy);
          else if (p < tr + .045) add('rock', jx, jy);
          else if (p < tr + .055) add('stump', jx, jy);
          else if (p < tr + .06) add('shroom', jx, jy);
          else if (p < tr + .066) add('bones', jx, jy);
          else if (p < tr + .068) wisps.push({ x: jx, y: jy, ph: r() * 100, c: [255, 210, 120] });
          break;
        }
        case 1:
          if (p < .1) add('reeds', jx, jy);
          else if (p < .125) add('tree', jx, jy);
          else if (p < .14) add('stump', jx, jy);
          else if (p < .152) add('shroom', jx, jy);
          else if (p < .158) wisps.push({ x: jx, y: jy, ph: r() * 100, c: [120, 255, 200] });
          break;
        case 2:
          if (p < .03) add('rock', jx, jy);
          else if (p < .055) add('burnt', jx, jy);
          else if (p < .075) add('stump', jx, jy);
          else if (p < .1) add('bones', jx, jy);
          else if (p < .115) add('vent', jx, jy);
          break;
        case 3:
          if (mod(tx, 2) === 0 && mod(ty, 3) === 0) { if (p < .75) add('grave', centreX + (r() - .5) * 2, centreY); }
          else if (p < .012) add('candle', jx, jy);
          else if (p < .035) add('tree', jx, jy);
          else if (p < .045) add('bones', jx, jy);
          else if (p < .05) wisps.push({ x: jx, y: jy, ph: r() * 100, c: [150, 190, 255] });
          break;
        case 4: {
          const gx = mod(tx, 7), gy = mod(ty, 7);
          const keep = vnoise(tx / 3, ty / 3, SEED + 91) > .4;
          if ((gx === 0 || gy === 0) && keep) {
            if (gx === 0 && gy === 0) add('pillar', centreX, centreY);
            else if (gy === 0) add('wallh', centreX, centreY + 4);
            else add('wallv', centreX, centreY);
          } else if (p < .02) add('pillar', jx, jy);
          else if (p < .05) add('rock', jx, jy);
          else if (p < .056) add('brazier', jx, jy);
          else if (p < .066) add('bones', jx, jy);
          break;
        }
      }
    }
    // landmarks: rare places worth finding
    const lr = r();
    if (lr < .09) {
      const i = 3 + (r() * 10 | 0), j = 3 + (r() * 10 | 0);
      const f = fields[j * CHUNK + i];
      const lx = (cx * CHUNK + i + .5) * TILE, ly = (cy * CHUNK + j + .5) * TILE;
      if (!f.water && Math.hypot(lx, ly) > 120 && Math.hypot(lx - lair.x, ly - lair.y) > cfg.arenaClearRadius + 50) {
        const clear = (rad) => { for (let k = objs.length - 1; k >= 0; k--) if (Math.hypot(objs[k].x - lx, objs[k].y - ly) < rad) objs.splice(k, 1); };
        const kind = r();
        if (kind < .4) { clear(28); add('obelisk', lx, ly); add('candle', lx - 12, ly + 6); add('candle', lx + 11, ly + 7); }
        else if (kind < .8) {
          clear(44); add('bonfire', lx, ly);
          const n = 6 + (r() * 3 | 0);
          for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + r() * .2; add('menhir', lx + Math.cos(a) * 34, ly + Math.sin(a) * 26); }
        } else { clear(26); add('brazier', lx - 14, ly); add('brazier', lx + 14, ly); add('bones', lx, ly + 6); add('grave', lx, ly - 6); }
      }
    }
    if (cx === 0 && cy === 0) { add('bonfire', camp.x, camp.y); objs[objs.length - 1].camp = true; add('rock', 48, 6); add('stump', 14, 34); }
    if (cx === -1 && cy === -1) { add('menhir', -30, -26); }

    // the lair: nothing ordinary inside the clear radius
    const cr = cfg.arenaClearRadius;
    if (Math.abs(cx * CPX + CPX / 2 - lair.x) < CPX / 2 + cr + 8 && Math.abs(cy * CPX + CPX / 2 - lair.y) < CPX / 2 + cr + 8) {
      for (let k = objs.length - 1; k >= 0; k--) if (Math.hypot(objs[k].x - lair.x, objs[k].y - lair.y) < cr) objs.splice(k, 1);
      for (let k = wisps.length - 1; k >= 0; k--) if (Math.hypot(wisps[k].x - lair.x, wisps[k].y - lair.y) < cr) wisps.splice(k, 1);
    }
    for (const a of arena) {
      if (Math.floor(a.x / CPX) === cx && Math.floor(a.y / CPX) === cy) objs.push({ k: a.k, x: a.x, y: a.y, v: 0, ph: 1, pts: null, veil: a.veil, last: a.last, arena: true });
    }
    for (const o of objs) if (o.k === 'vent') {
      const rr = rng(o.v); o.pts = [];
      let x = -6, y = 0;
      for (let k = 0; k < 7; k++) { o.pts.push(x, y); x += 2; y += (rr() - .5) * 3; }
    }
    const bonfires = [], blk = [];
    for (const o of objs) {
      if (o.k === 'bonfire') { o.id = 'b' + Math.round(o.x) + '_' + Math.round(o.y); bonfires.push(o); }
      if (KINDS[o.k].r > 0) { o.r = KINDS[o.k].r; blk.push(o); }
    }

    // signs
    const signs = [];
    const sr = rng(Math.floor(hash2(cx, cy, SEED + 101) * 4294967296));
    const ccx = cx * CPX + CPX / 2, ccy = cy * CPX + CPX / 2;
    const dC = Math.hypot(ccx - lair.x, ccy - lair.y) / CPX;
    const pS = Math.min(cfg.signMaxP, cfg.signK / Math.pow(Math.max(1, dC), cfg.signExp));
    if (sr() < pS) {
      for (let tries = 0; tries < 10; tries++) {
        const i = sr() * CHUNK | 0, j = sr() * CHUNK | 0;
        const tx = cx * CHUNK + i, ty = cy * CHUNK + j;
        const jx = (tx + .2 + sr() * .6) * TILE, jy = (ty + .2 + sr() * .6) * TILE;
        if (fields[j * CHUNK + i].water) continue;
        if (Math.abs(tx) < cfg.campClear && Math.abs(ty) < cfg.campClear) continue;
        if (Math.hypot(jx - lair.x, jy - lair.y) < cfg.arenaRadius) continue;
        const kind = signKind(dC);
        signs.push({ id: 's' + cx + '_' + cy, kind, x: jx, y: jy });
        break;
      }
    }
    if (cx === 0 && cy === 0) signs.push({ id: 'camp', kind: 'ribbon', camp: true, x: camp.x, y: camp.y + cfg.campRibbonDist });
    for (const s of signs) { const inf = signInfo(s.camp ? 'camp' : s.kind, s.x, s.y); s.dir = inf.dir; s.dirVec = inf.dirVec; s.text = inf.text; s.temp = inf.temp; }

    return { cx, cy, objs, wisps, signs, bonfires, blk, fields, cell: new Int16Array((CPX / CELL) * (CPX / CELL)).fill(-1), used: 0 };
  }

  function chunk(cx, cy) {
    const key = chunkKey(cx, cy);
    let c = chunks.get(key);
    if (!c) {
      if (chunks.size > 900) { // evict the oldest 300
        const arr = [...chunks.entries()].sort((a, b) => a[1].used - b[1].used);
        for (let i = 0; i < 300; i++) chunks.delete(arr[i][0]);
      }
      c = buildChunk(cx, cy); chunks.set(key, c);
    }
    c.used = ++clock;
    return c;
  }
  const NC = CPX / CELL;
  // cell value: biome << 1 | water, at 4 px resolution (matches the ground pass)
  function cellAt(x, y) {
    const cx = Math.floor(x / CPX), cy = Math.floor(y / CPX);
    const ch = chunk(cx, cy);
    const i = Math.min(NC - 1, Math.floor((x - cx * CPX) / CELL)), j = Math.min(NC - 1, Math.floor((y - cy * CPX) / CELL));
    let v = ch.cell[j * NC + i];
    if (v < 0) {
      const f = field((cx * CPX + i * CELL + CELL / 2) / TILE, (cy * CPX + j * CELL + CELL / 2) / TILE);
      v = (f.b << 1) | (f.water ? 1 : 0); ch.cell[j * NC + i] = v;
    }
    return v;
  }
  const waterAt = (x, y) => (cellAt(x, y) & 1) === 1;
  const biomeAt = (x, y) => cellAt(x, y) >> 1;

  // push circle e (x,y) with radius rad out of blockers
  function pushOut(e, rad) {
    const m0 = rad + MAXR;
    const x0 = Math.floor((e.x - m0) / CPX), x1 = Math.floor((e.x + m0) / CPX);
    const y0 = Math.floor((e.y - m0) / CPX), y1 = Math.floor((e.y + m0) / CPX);
    for (let pass = 0; pass < 2; pass++)
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const blk = chunk(cx, cy).blk;
        for (let i = 0; i < blk.length; i++) {
          const o = blk[i], ex = e.x - o.x, ey = e.y - o.y, m = o.r + rad, d2 = ex * ex + ey * ey;
          if (d2 < m * m) { const d = Math.sqrt(d2) || .01; e.x = o.x + ex / d * m; e.y = o.y + ey / d * m; }
        }
      }
  }
  function blockedAt(x, y, rad) {
    const m0 = rad + MAXR;
    for (let cy = Math.floor((y - m0) / CPX); cy <= Math.floor((y + m0) / CPX); cy++)
      for (let cx = Math.floor((x - m0) / CPX); cx <= Math.floor((x + m0) / CPX); cx++) {
        const blk = chunk(cx, cy).blk;
        for (const o of blk) { const m = o.r + rad; if ((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y) < m * m) return true; }
      }
    return false;
  }
  // visit chunks overlapping the square [x-rad, x+rad]
  function eachChunk(x, y, rad, fn) {
    for (let cy = Math.floor((y - rad) / CPX); cy <= Math.floor((y + rad) / CPX); cy++)
      for (let cx = Math.floor((x - rad) / CPX); cx <= Math.floor((x + rad) / CPX); cx++) fn(chunk(cx, cy));
  }
  function bonfiresNear(x, y, rad) {
    const out = [];
    eachChunk(x, y, rad, ch => { for (const b of ch.bonfires) { const d = Math.hypot(b.x - x, b.y - y); if (d <= rad) out.push({ b, d }); } });
    return out;
  }
  function signsNear(x, y, rad) {
    const out = [];
    eachChunk(x, y, rad, ch => { for (const s of ch.signs) { const d = Math.hypot(s.x - x, s.y - y); if (d <= rad) out.push({ s, d }); } });
    return out;
  }
  const heatAt = (x, y) => Math.min(1, Math.max(0, 1 - Math.hypot(x - lair.x, y - lair.y) / lairDistPx));

  return { seed: SEED, cfg, lair, lastFire, camp, lairDistPx, field, chunk, cellAt, waterAt, biomeAt, pushOut, blockedAt, eachChunk, bonfiresNear, signsNear, heatAt, compass, signInfo };
}

// worlds are pure functions of (seed, world-relevant config); reuse them across games
const cache = new Map();
function getWorld(seed, cfg) {
  const rel = [cfg.lairDistance, cfg.arenaRadius, cfg.arenaClearRadius, cfg.obeliskRing, cfg.obeliskCount, cfg.lastFireDist,
    cfg.signMaxP, cfg.signK, cfg.signExp, JSON.stringify(cfg.signRanges), cfg.campClear, cfg.campRibbonDist,
    JSON.stringify(cfg.signTexts), JSON.stringify(cfg.signTemp)];
  const key = seed + '|' + JSON.stringify(rel);
  let w = cache.get(key);
  if (!w) {
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    w = createWorld(seed, cfg); cache.set(key, w);
  }
  return w;
}

Object.assign(AW, { hash2, rng, vnoise, fbm, ss, mod, lerp, TILE, CHUNK, CPX, CELL, BIOME, BIOME_KEY, KINDS, COMPASS, compass, createWorld, getWorld });
})(globalThis.AW = globalThis.AW || {});
