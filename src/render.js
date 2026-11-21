// Ashen Wilds renderer: canvas drawing only. Reads world data from AW world and state from the sim.
// Entity drawing hooks (drawMonster, drawBoss, drawProjectile, drawSign, drawHeroOverlay, drawFx) are
// properties of AW.render so the UI layer can swap them.
(function (AW) {
'use strict';
const { TILE, CHUNK, CPX, CELL, BIOME, KINDS, hash2, rng, vnoise, mod, lerp } = AW;
let ctx, cv, lctx, light, vignette, hurtVig, SPR, fog, fogRed, world, SEED = 0;
let W = 0, H = 0, SCALE = 2, t = 0, frameNo = 0;
let camX = 0, camY = 0, lastCX = 0, lastCY = 0;
const sparks = [], ripples = [], flakes = [];

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function silhouette(c) {
  const s = canvas(c.width, c.height), g = s.getContext('2d');
  g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, s.width, s.height);
  return s;
}
function mk(w, h, seed, fn, opt) {
  const c = canvas(w, h), g = c.getContext('2d');
  fn(g, rng(seed), w, h, opt || {});
  c.shadow = silhouette(c);
  return c;
}
function set(n, w, h, base, fn, opt) { const a = []; for (let i = 0; i < n; i++) a.push(mk(w, h, base * 977 + i * 31 + 7, fn, opt)); return a; }
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); }

function drawTree(g, r, w, h, o) {
  const bx = w / 2, by = h - 2;
  g.lineCap = 'round';
  const dark = o.dark || '#17120f', hi = o.hi || '#2c231c';
  const leaves = o.leaves && r() < .45;
  // roots
  g.strokeStyle = dark;
  for (let i = 0; i < 3; i++) {
    const s = (i - 1) * (3 + r() * 3);
    g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 2); g.quadraticCurveTo(bx + s * .6, by - 1, bx + s * 1.6, by + .5); g.stroke();
  }
  function br(x, y, a, len, wd, d) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    const mx = (x + x2) / 2 + (r() - .5) * len * .5, my = (y + y2) / 2 + (r() - .5) * len * .3;
    g.strokeStyle = dark; g.lineWidth = wd;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
    if (wd > 1.6) {
      g.strokeStyle = hi; g.lineWidth = Math.max(.7, wd * .3);
      g.beginPath(); g.moveTo(x - wd * .25, y); g.quadraticCurveTo(mx - wd * .25, my, x2 - wd * .25, y2); g.stroke();
    }
    if (d > 0) {
      const n = r() < .35 ? 3 : 2;
      for (let i = 0; i < n; i++) br(x2, y2, a + (r() - .5) * 1.1 + (i - (n - 1) / 2) * .6, len * (.6 + r() * .16), wd * .62, d - 1);
    } else if (leaves) {
      g.fillStyle = r() < .5 ? '#5a1a14' : '#3d1410';
      g.fillRect(Math.round(x2), Math.round(y2), 1 + (r() * 2 | 0), 1);
    }
  }
  br(bx, by - 1, -Math.PI / 2 + (r() - .5) * .35, h * .28 + r() * h * .06, 3.6 + r() * 1.4, 4);
  if (o.ember) { // charred glow cracks
    g.fillStyle = '#7a2a10';
    for (let i = 0; i < 4; i++) g.fillRect(Math.round(bx - 1 + r() * 2), Math.round(by - 4 - r() * 12), 1, 1);
  }
}
function drawPine(g, r, w, h) {
  const bx = w / 2, by = h - 2;
  g.fillStyle = '#140f0c'; g.fillRect(bx - 1.5, by - 8, 3, 8);
  const layers = 5 + (r() * 2 | 0);
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const y = by - 6 - t * (h - 12);
    const hw = (1 - t) * (w / 2 - 2) + 2;
    const lh = (h - 12) / layers * 1.9;
    g.fillStyle = i % 2 ? '#121a15' : '#0f1612';
    const pts = [bx, y - lh];
    const teeth = 5;
    for (let k = 0; k <= teeth; k++) {
      const x = bx + hw - (2 * hw) * (k / teeth);
      pts.push(x, y + (k % 2 ? -1.5 : 1) + (r() - .5));
    }
    poly(g, pts);
    g.fillStyle = '#1c2a20';
    g.fillRect(Math.round(bx - hw * .5), Math.round(y - lh * .35), Math.max(1, Math.round(hw * .4)), 1);
  }
}
function drawRock(g, r, w, h) {
  const cx = w / 2, cy = h - 6, rx = w / 2 - 1.5, ry = h / 2 - 1.5;
  const pts = [], n = 9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, k = .78 + r() * .25;
    pts.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k - (Math.sin(a) < 0 ? ry * .3 : 0));
  }
  g.fillStyle = '#2a292f'; poly(g, pts);
  g.fillStyle = '#3c3b42'; poly(g, pts.map((v, i) => i % 2 ? v - 1.5 : v - .5));
  g.fillStyle = '#504f57';
  g.beginPath(); g.ellipse(cx - rx * .25, cy - ry * .65, rx * .35, ry * .25, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b3a24';
  for (let i = 0; i < 4; i++) g.fillRect(Math.round(cx - rx * .6 + r() * rx), Math.round(cy - ry * .3 + r() * ry * .5), 1 + (r() * 2 | 0), 1);
}
function drawMenhir(g, r, w, h) {
  const bx = w / 2, by = h - 2, hh = h - 4 - r() * 6, lean = (r() - .5) * 3;
  g.fillStyle = '#2f2e35';
  poly(g, [bx - 4, by, bx + 4, by, bx + 3 + lean, by - hh + 3, bx + lean, by - hh, bx - 3 + lean, by - hh + 2]);
  g.fillStyle = '#45444c';
  poly(g, [bx - 4, by, bx - 1, by, bx - 1 + lean, by - hh + 1, bx - 3 + lean, by - hh + 2]);
  g.fillStyle = '#1e2a1c';
  for (let i = 0; i < 5; i++) g.fillRect(Math.round(bx - 3 + r() * 6), Math.round(by - r() * hh * .6), 1, 1);
}
function drawGrave(g, r, w, h) {
  const bx = w / 2, by = h - 2, type = r() * 3 | 0;
  // mound
  g.fillStyle = '#231d1a'; g.beginPath(); g.ellipse(bx, by, 6, 2.2, 0, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(bx, by); g.rotate((r() - .5) * .3);
  if (type === 0) { // headstone
    g.fillStyle = '#4c4a52'; g.beginPath(); g.moveTo(-4, 0); g.lineTo(-4, -9); g.arc(0, -9, 4, Math.PI, 0); g.lineTo(4, 0); g.closePath(); g.fill();
    g.fillStyle = '#5f5d66'; g.fillRect(-4, -9, 1, 9); g.fillRect(-3, -12, 3, 1);
    g.fillStyle = '#2d2c33'; g.fillRect(3, -9, 1, 9); g.fillRect(-.5, -9, 1, 4); g.fillRect(-1.5, -8, 3, 1);
  } else if (type === 1) { // cross
    g.fillStyle = '#4a4850'; g.fillRect(-1, -14, 3, 14); g.fillRect(-4, -11, 9, 3);
    g.fillStyle = '#5f5d66'; g.fillRect(-1, -14, 1, 14); g.fillRect(-4, -11, 9, 1);
  } else { // slab
    g.fillStyle = '#3e3c44'; g.fillRect(-5, -7, 10, 7);
    g.fillStyle = '#55535b'; g.fillRect(-5, -7, 10, 2);
    g.fillStyle = '#2a2930'; g.fillRect(-2, -5, 1, 4); g.fillRect(1, -4, 2, 1);
  }
  g.fillStyle = '#2b3a24';
  for (let i = 0; i < 3; i++) g.fillRect(Math.round(-3 + r() * 6), -Math.round(r() * 5), 1, 1);
  g.restore();
}
function drawBones(g, r, w, h) {
  g.fillStyle = '#b8af9a';
  for (let i = 0; i < 3; i++) {
    const x = 1 + r() * (w - 6), y = 2 + r() * (h - 4);
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI); g.fillRect(0, 0, 4, 1); g.fillRect(-1, -.5, 1, 2); g.fillRect(4, -.5, 1, 2); g.restore();
  }
  if (r() < .7) {
    const x = Math.round(2 + r() * (w - 8)), y = Math.round(1 + r() * (h - 5));
    g.fillStyle = '#cfc6b0'; g.fillRect(x, y, 4, 3); g.fillRect(x + 1, y + 3, 2, 1);
    g.fillStyle = '#0b0909'; g.fillRect(x, y + 1, 1, 1); g.fillRect(x + 2, y + 1, 1, 1);
  }
}
function drawReeds(g, r, w, h) {
  const n = 4 + (r() * 3 | 0);
  for (let i = 0; i < n; i++) {
    const x = 2 + r() * (w - 4), top = 2 + r() * (h * .45), bend = (r() - .5) * 4;
    g.strokeStyle = r() < .5 ? '#3a3d22' : '#2b2f1a'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, h - 1); g.quadraticCurveTo(x, (h + top) / 2, x + bend, top); g.stroke();
    if (r() < .55) { g.fillStyle = '#3a2414'; g.fillRect(Math.round(x + bend - .5), Math.round(top), 2, 3); }
  }
}
function drawThorns(g, r, w, h) {
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = r() < .5 ? '#1f1612' : '#2b1f17';
    const x = 2 + r() * (w - 4), y = h - 1 - r() * 3;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + (r() - .5) * 14, y - r() * h, x + (r() - .5) * 10, y - 2 - r() * (h - 4)); g.stroke();
  }
  g.fillStyle = '#6a1010';
  for (let i = 0; i < 3; i++) if (r() < .6) g.fillRect(Math.round(2 + r() * (w - 4)), Math.round(2 + r() * (h - 5)), 1, 1);
}
function drawStump(g, r, w, h) {
  const bx = w / 2, by = h - 2;
  g.fillStyle = '#140e0b'; g.fillRect(bx - 4, by - 6, 8, 6);
  g.fillRect(bx - 6, by - 1, 3, 1); g.fillRect(bx + 3, by - 1, 3, 1);
  g.fillStyle = '#2e2018'; g.beginPath(); g.ellipse(bx, by - 6, 4, 1.8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a120d'; g.fillRect(bx - 1, by - 6, 2, 1);
  if (r() < .5) { g.fillStyle = '#25190f'; g.fillRect(bx - 3, by - 5, 1, 4); }
}
function drawPillar(g, r, w, h) {
  const bx = w / 2, by = h - 2, ph = 14 + r() * (h - 20);
  g.fillStyle = '#34333a'; g.fillRect(bx - 6, by - 4, 12, 4);
  g.fillStyle = '#46454d'; g.fillRect(bx - 6, by - 4, 12, 1);
  const top = by - 4 - ph;
  g.fillStyle = '#3f3e46';
  const pts = [bx - 4, by - 4, bx + 4, by - 4, bx + 4, top + 2];
  for (let i = 0; i <= 4; i++) pts.push(bx + 4 - i * 2, top + r() * 4);
  pts.push(bx - 4, top + 2);
  poly(g, pts);
  g.fillStyle = '#55545c'; g.fillRect(bx - 4, top + 3, 1, ph - 3);
  g.fillStyle = '#2b2a30'; g.fillRect(bx - 1, top + 4, 1, ph - 4); g.fillRect(bx + 3, top + 3, 1, ph - 3);
  g.fillStyle = '#3a3940';
  for (let i = 0; i < 3; i++) g.fillRect(Math.round(bx - 6 + r() * 12), by - 1, 2, 1);
}
function drawWallH(g, r, w, h) {
  const by = h - 2, hh = 6 + r() * (h - 10);
  const tops = [];
  for (let x = 0; x <= w; x += 2) tops.push(by - hh + (r() < .3 ? r() * 4 : 0));
  g.fillStyle = '#34323a';
  const pts = [0, by];
  for (let i = 0; i < tops.length; i++) pts.push(i * 2, tops[i]);
  pts.push(w, by);
  poly(g, pts);
  g.fillStyle = '#25242b';
  for (let y = by - 4, row = 0; y > by - hh; y -= 4, row++) {
    g.fillRect(0, y, w, 1);
    for (let x = (row % 2) * 4; x < w; x += 8) g.fillRect(x, y, 1, 4);
  }
  g.fillStyle = '#4a4952';
  for (let i = 0; i < tops.length; i++) g.fillRect(i * 2, Math.round(tops[i]), 2, 1);
}
function drawWallV(g, r, w, h) {
  const bx = w / 2, by = h - 2, hh = 10 + r() * (h - 14);
  g.fillStyle = '#2c2b32'; g.fillRect(bx - 3, by - hh, 6, hh);
  g.fillStyle = '#44434b'; g.fillRect(bx - 3, by - hh, 6, 3);
  g.fillStyle = '#222128';
  for (let y = by - hh + 6; y < by; y += 4) g.fillRect(bx - 3, y, 6, 1);
}
function drawObelisk(g, r, w, h, o) {
  const bx = w / 2, by = h - 2;
  if (!o.runesOnly) {
  g.fillStyle = '#26232b'; g.fillRect(bx - 7, by - 4, 14, 4);
  g.fillStyle = '#16131b'; poly(g, [bx - 5, by - 4, bx + 5, by - 4, bx + 3, by - h + 8, bx, by - h + 3, bx - 3, by - h + 8]);
  g.fillStyle = '#2a2631'; poly(g, [bx - 5, by - 4, bx - 2, by - 4, bx - 1, by - h + 6, bx - 3, by - h + 8]);
  }
  g.fillStyle = o.runesOnly ? o.runesOnly : '#b48cff';
  for (let y = by - 12; y > by - h + 12; y -= 5) {
    const k = r() * 3 | 0;
    if (k === 0) { g.fillRect(bx, y, 1, 3); g.fillRect(bx - 1, y + 1, 3, 1); }
    else if (k === 1) { g.fillRect(bx - 1, y, 1, 3); g.fillRect(bx + 1, y, 1, 3); }
    else { g.fillRect(bx - 1, y, 3, 1); g.fillRect(bx, y + 2, 1, 1); }
  }
}

function buildFog() {
  const S = 128, P = 8, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S);
  const pn = (x, y, p, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash2(mod(a, p), mod(b, p), s);
    const a = h(xi, yi), b = h(xi + 1, yi), cc = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = (pn(x / S * P, y / S * P, P, 401) * .65 + pn(x / S * P * 2, y / S * P * 2, P * 2, 402) * .35);
    const a = Math.max(0, n - .45) * 2.2;
    const o = (y * S + x) * 4;
    img.data[o] = 150; img.data[o + 1] = 155; img.data[o + 2] = 170; img.data[o + 3] = Math.min(255, a * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
const FLAME_WARM = ['#c2380e', '#ff8a2a', '#ffe7a0'], FLAME_CRIMSON = ['#6e0612', '#d81a2a', '#ffb0a0'], FLAME_VIOLET = ['#4a1080', '#a050ff', '#f0d0ff'];
function flame(x, y, s, ph, pal, c) {
  c = c || ctx; pal = pal || FLAME_WARM;
  const n = Math.sin(t * 13 + ph) * .5 + Math.sin(t * 7.7 + ph * 2) * .5;
  const sway = Math.sin(t * 5 + ph) * s * .25;
  const tongue = (hw, h, col) => {
    c.fillStyle = col; c.beginPath(); c.moveTo(x - hw, y);
    c.quadraticCurveTo(x - hw * .7, y - h * .55, x + sway, y - h);
    c.quadraticCurveTo(x + hw * .7, y - h * .55, x + hw, y); c.closePath(); c.fill();
  };
  tongue(s, s * 2.4 + n * s * .5, pal[0]);
  tongue(s * .7, s * 1.7 + n * s * .4, pal[1]);
  tongue(s * .35, s * 1 + n * s * .2, pal[2]);
}
function emit(x, y, col, spread) {
  sparks.push({ x: x + (Math.random() - .5) * spread, y, vx: (Math.random() - .5) * 8, vy: -14 - Math.random() * 18, life: .6 + Math.random() * .9, ph: Math.random() * 6, c: col });
}
const DYN = {
  brazier(o, x, y) {
    ctx.fillStyle = '#1d1917'; ctx.fillRect(x - 4, y - 1, 2, 1); ctx.fillRect(x + 2, y - 1, 2, 1);
    ctx.fillRect(x - 3, y - 7, 1, 6); ctx.fillRect(x + 2, y - 7, 1, 6); ctx.fillRect(x - 1, y - 6, 1, 5);
    ctx.fillStyle = '#3a312c'; ctx.beginPath(); ctx.ellipse(x, y - 8, 5, 2.4, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#5a1a0a'; ctx.fillRect(x - 4, y - 9, 8, 1);
    flame(x, y - 8, 3, o.ph);
    if (Math.random() < .08) emit(x, y - 12, '255,160,60', 4);
  },
  candle(o, x, y) {
    ctx.fillStyle = '#c8bfa8'; ctx.fillRect(x - 1, y - 4, 2, 4);
    ctx.fillStyle = '#9e967f'; ctx.fillRect(x, y - 4, 1, 4);
    flame(x, y - 4, 1, o.ph);
  },
  shroom(o, x, y) {
    const pulse = .7 + Math.sin(t * 1.7 + o.ph) * .3;
    const caps = [[0, 0, 3], [-3, 1, 2], [3, 2, 2]];
    for (const [dx, dy, s] of caps) {
      ctx.fillStyle = '#b8c4bc'; ctx.fillRect(x + dx, y + dy - s - 1, 1, s + 1);
      ctx.fillStyle = `rgba(90,230,210,${.55 + pulse * .45})`;
      ctx.beginPath(); ctx.ellipse(x + dx + .5, y + dy - s - 1, s, s * .6, 0, Math.PI, 0); ctx.fill();
    }
  },
  vent(o, x, y) {
    const a = .55 + Math.sin(t * 3 + o.ph) * .25 + Math.sin(t * 11 + o.ph) * .1;
    ctx.fillStyle = '#100c0b';
    for (let i = 0; i < o.pts.length; i += 2) ctx.fillRect(Math.round(x + o.pts[i]) - 1, Math.round(y + o.pts[i + 1]) - 1, 3, 3);
    ctx.fillStyle = `rgba(255,${80 + a * 60 | 0},20,${a})`;
    for (let i = 0; i < o.pts.length; i += 2) ctx.fillRect(Math.round(x + o.pts[i]), Math.round(y + o.pts[i + 1]), 2, 1);
    if (Math.random() < .04) emit(x, y - 1, '255,110,40', 10);
  },
  bonfire(o, x, y) {
    ctx.fillStyle = '#3a3940';
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * 7) - 1, Math.round(y + Math.sin(a) * 3.5) - 1, 3, 2); }
    ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 6, y + 1); ctx.lineTo(x + 5, y - 3); ctx.moveTo(x + 6, y + 1); ctx.lineTo(x - 5, y - 3); ctx.stroke();
    ctx.fillStyle = '#ff6a1a'; ctx.fillRect(x - 3, y - 2, 6, 2);
    flame(x - 2, y - 1, 3, o.ph); flame(x + 2, y - 1, 3, o.ph + 2); flame(x, y - 1, 4, o.ph + 4);
    if (Math.random() < .25) emit(x, y - 8, '255,170,70', 6);
  },
};
function lightFlicker(fl, ph) { return 1 + fl * (Math.sin(t * 8.1 + ph) * .5 + Math.sin(t * 13.7 + ph * 1.7) * .3 + Math.sin(t * 27 + ph * .5) * .2) * .35; }
function wispPos(w) {
  return [w.x + Math.sin(t * .31 + w.ph) * 22 + Math.sin(t * .77 + w.ph * 2) * 7,
          w.y + Math.cos(t * .27 + w.ph * 1.3) * 18 + Math.sin(t * .9 + w.ph) * 5];
}

function drawAltar(g, r, w, h) {
  const bx = w / 2, by = h - 2;
  g.fillStyle = '#1b1a20'; g.fillRect(bx - 18, by - 5, 36, 5);
  g.fillStyle = '#2c2b33'; g.fillRect(bx - 16, by - 12, 32, 8);
  g.fillStyle = '#44434b'; g.fillRect(bx - 16, by - 14, 32, 3);
  g.fillStyle = '#26252c'; g.fillRect(bx - 14, by - 10, 1, 5); g.fillRect(bx + 4, by - 11, 1, 6);
  // her veil, folded on the altar
  g.fillStyle = '#d8d4e4'; poly(g, [bx - 9, by - 14, bx + 9, by - 14, bx + 11, by - 11, bx - 2, by - 10, bx - 11, by - 12]);
  g.fillStyle = '#a9a4be'; g.fillRect(bx - 6, by - 13, 9, 1); g.fillRect(bx + 2, by - 12, 7, 1);
  g.fillStyle = '#6a6783'; g.fillRect(bx - 11, by - 12, 3, 1);
}

function buildSprites() {
  SPR = {
    tree: set(10, 56, 64, 1, drawTree, { leaves: true }),
    burnt: set(5, 48, 52, 2, drawTree, { dark: '#0d0a09', hi: '#24130d', ember: true }),
    pine: set(6, 26, 50, 3, drawPine),
    rock: [...set(4, 22, 16, 4, drawRock), ...set(3, 14, 11, 5, drawRock)],
    grave: set(12, 16, 20, 6, drawGrave),
    bones: set(5, 16, 10, 7, drawBones),
    reeds: set(5, 14, 20, 8, drawReeds),
    thorns: set(5, 20, 14, 9, drawThorns),
    stump: set(4, 16, 10, 10, drawStump),
    pillar: set(6, 14, 38, 11, drawPillar),
    wallh: set(6, 16, 22, 12, drawWallH),
    wallv: set(6, 10, 26, 13, drawWallV),
    obelisk: set(3, 16, 52, 14, drawObelisk),
    obeliskRunesV: set(3, 16, 52, 14, drawObelisk, { runesOnly: '#c8a0ff' }),
    obeliskRunesR: set(3, 16, 52, 14, drawObelisk, { runesOnly: '#ff6a2a' }),
    menhir: set(5, 12, 24, 15, drawMenhir),
    altar: set(1, 44, 30, 16, drawAltar),
  };
}

// ---------------------------------------------------------------- ground (canvas per chunk)
const ground = new Map();
function buildGround(cx, cy) {
  const cvs = canvas(CPX, CPX), g = cvs.getContext('2d');
  const N = CPX / CELL;
  const col = new Float32Array(N * N * 3);
  const wet = new Uint8Array(N * N);
  const x0 = cx * CPX, y0 = cy * CPX;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const wx = x0 + i * CELL + CELL / 2, wy = y0 + j * CELL + CELL / 2;
    const tx = wx / TILE, ty = wy / TILE;
    const f = world.field(tx, ty);
    const d = vnoise(tx * .6, ty * .6, SEED + 5), d2 = vnoise(tx * 2.1, ty * 2.1, SEED + 6);
    let r = 25 + d * 10 + d2 * 4, gr = 29 + d * 11 + d2 * 3, b = 20 + d * 5;
    if (d2 > .62) { r += 6; gr += 2; }
    r = lerp(r, 32 + d * 7, f.gw); gr = lerp(gr, 29 + d * 6, f.gw); b = lerp(b, 30 + d * 6, f.gw);
    const ash = 40 + d * 12 + d2 * 5;
    r = lerp(r, ash + 2, f.aw); gr = lerp(gr, ash - 3, f.aw); b = lerp(b, ash - 5, f.aw);
    r = lerp(r, 37 + d * 8, f.rw); gr = lerp(gr, 36 + d * 8, f.rw); b = lerp(b, 41 + d * 8, f.rw);
    r = lerp(r, 22 + d * 6, f.sw); gr = lerp(gr, 28 + d * 8, f.sw); b = lerp(b, 25 + d * 6, f.sw);
    if (f.water) { r = 9 + d * 5; gr = 17 + d * 8; b = 21 + d * 9; wet[j * N + i] = 1; }
    const k = (j * N + i) * 3;
    col[k] = r; col[k + 1] = gr; col[k + 2] = b;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (wet[j * N + i]) continue;
    let near = 0;
    if (i > 0 && wet[j * N + i - 1]) near = 1; if (i < N - 1 && wet[j * N + i + 1]) near = 1;
    if (j > 0 && wet[(j - 1) * N + i]) near = 1; if (j < N - 1 && wet[(j + 1) * N + i]) near = 1;
    if (near) { const k = (j * N + i) * 3; col[k] *= .7; col[k + 1] *= .75; col[k + 2] *= .75; }
  }
  const img = g.createImageData(CPX, CPX), px = img.data;
  for (let y = 0; y < CPX; y++) for (let x = 0; x < CPX; x++) {
    const k = ((y >> 2) * N + (x >> 2)) * 3, o = (y * CPX + x) * 4;
    const jit = (hash2(x0 + x, y0 + y, SEED + 3) - .5) * 6;
    px[o] = col[k] + jit; px[o + 1] = col[k + 1] + jit; px[o + 2] = col[k + 2] + jit; px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const r = rng(Math.floor(hash2(cx, cy, SEED + 98) * 4294967296));
  const fields = world.chunk(cx, cy).fields;
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const f = fields[j * CHUNK + i], X = i * TILE, Y = j * TILE;
    const ty = cy * CHUNK + j;
    if (f.water) {
      if (r() < .25) { g.fillStyle = 'rgba(120,150,160,.10)'; g.fillRect(X + (r() * 12 | 0), Y + (r() * 14 | 0), 3 + (r() * 4 | 0), 1); }
      if (r() < .05) { g.fillStyle = '#1b2c22'; g.beginPath(); g.arc(X + 4 + r() * 8, Y + 4 + r() * 8, 2, .4, Math.PI * 2 - .2); g.lineTo(X + 8, Y + 8); g.fill(); }
      continue;
    }
    if (f.b === 4 && f.rw > .55) {
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.fillRect(X, Y, TILE, 1);
      const off = mod(ty, 2) ? 8 : 0;
      g.fillRect(X + off, Y, 1, TILE);
      if (r() < .06) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(X + 1 + (r() * 4 | 0), Y + 1 + (r() * 4 | 0), 5 + (r() * 6 | 0), 4 + (r() * 6 | 0)); }
      if (r() < .3) { g.fillStyle = '#26331f'; g.fillRect(X + (r() * 14 | 0), Y, 1, 1 + (r() * 2 | 0)); }
      continue;
    }
    if (f.b === 2) {
      const n = r() * 3 | 0;
      for (let k = 0; k < n; k++) { g.fillStyle = r() < .5 ? '#56514d' : '#24201f'; g.fillRect(X + (r() * 15 | 0), Y + (r() * 15 | 0), 1 + (r() * 2 | 0), 1); }
      if (r() < .12) {
        g.fillStyle = '#1a1716'; let x = X + r() * 16, y = Y + r() * 16;
        for (let k = 0; k < 8; k++) { x += (r() - .5) * 3; y += (r() - .3) * 2; g.fillRect(x | 0, y | 0, 1, 1); }
      }
      continue;
    }
    const tufts = f.b === 3 ? (r() * 2 | 0) : (r() * 4 | 0);
    for (let k = 0; k < tufts; k++) {
      const x = X + (r() * 14 | 0) + 1, y = Y + (r() * 13 | 0) + 2;
      g.fillStyle = f.b === 1 ? '#2a3a2a' : (r() < .5 ? '#3a4128' : '#2e3320');
      g.fillRect(x, y - 2, 1, 2); g.fillRect(x - 1, y - 1, 1, 1); g.fillRect(x + 1, y - 1, 1, 1);
    }
    if (r() < .3) { g.fillStyle = r() < .5 ? '#4a2618' : '#3a2a16'; g.fillRect(X + (r() * 15 | 0), Y + (r() * 15 | 0), 1, 1); }
  }
  return { cvs, used: frameNo };
}
function getGround(cx, cy) {
  const key = cx + ',' + cy;
  let c = ground.get(key);
  if (!c) { c = buildGround(cx, cy); ground.set(key, c); }
  c.used = frameNo;
  return c;
}
function evictGround() {
  if (ground.size <= 90) return;
  const arr = [...ground.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < arr.length - 70; i++) ground.delete(arr[i][0]);
}

// ---------------------------------------------------------------- setup
function initFlakes() {
  flakes.length = 0;
  const n = Math.round(W * H / 2200);
  for (let i = 0; i < n; i++) flakes.push({ x: Math.random() * W, y: Math.random() * H, vx: -3 - Math.random() * 6, vy: 4 + Math.random() * 8, s: Math.random() < .2 ? 2 : 1, a: .25 + Math.random() * .5, ph: Math.random() * 6 });
}
function resize() {
  SCALE = Math.max(2, Math.round(Math.min(innerWidth, innerHeight * 1.6) / 640));
  W = Math.ceil(innerWidth / SCALE); H = Math.ceil(innerHeight / SCALE);
  cv.width = W; cv.height = H;
  cv.style.width = W * SCALE + 'px'; cv.style.height = H * SCALE + 'px';
  light.width = W; light.height = H;
  vignette = canvas(W, H);
  const g = vignette.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.hypot(W, H) * .58);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.8)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  hurtVig = canvas(W, H);
  const h2 = hurtVig.getContext('2d');
  const gr2 = h2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.hypot(W, H) * .55);
  gr2.addColorStop(0, 'rgba(120,0,0,0)'); gr2.addColorStop(1, 'rgba(150,0,0,.85)');
  h2.fillStyle = gr2; h2.fillRect(0, 0, W, H);
  initFlakes();
}
function init(canvasEl) {
  cv = canvasEl; ctx = cv.getContext('2d');
  light = canvas(1, 1); lctx = light.getContext('2d');
  buildSprites(); fog = buildFog(); fogRed = tint(fog, 'rgb(120,28,16)'); buildEntitySprites(); resize();
  addEventListener('resize', resize);
}
// bind to a (new) game: drops the ground cache when the seed changes
function setGame(game) {
  if (game !== curGame) { curGame = game; resetFx(); }
  world = game.world;
  if (SEED !== world.seed) ground.clear();
  SEED = world.seed;
  camX = game.state.hero.x - W / 2; camY = game.state.hero.y - 8 - H / 2;
}
function screenToWorld(sx, sy) { return [sx / SCALE + lastCX, sy / SCALE + lastCY]; }

// ================================================================ entity art: pre-rendered pixel sprites
function tint(c, col) {
  const s = canvas(c.width, c.height), g = s.getContext('2d');
  g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, s.width, s.height);
  return s;
}
function mirror(c) {
  const m = canvas(c.width, c.height), g = m.getContext('2d');
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
  m.eyes = (c.eyes || []).map(([x, y]) => [c.width - 1 - x, y]);
  m.tip = c.tip && [c.width - 1 - c.tip[0], c.tip[1]];
  return m;
}
// monster level shows in the eye colour: pale, yellow, amber, red, crimson (index 5: Morhain)
const EYE_LV = ['#c9c1a0', '#ecd46a', '#ff9a30', '#ff4426', '#ff2a78', '#e0b0ff'];

// Each creature is drawn with integer rects around the foot anchor (bx, by).
// view: 0 front, 1 back, 2 right (left is mirrored); f: walk frame 0..3; wind: the windup pose.
const CRE = {
  ghoul: { w: 20, h: 22, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const SK = '#aeb59b', SH = '#7b836e', DK = '#3c4236', CL = '#e8e4cc', MO = '#300808';
    const s = [1, 0, -1, 0][f], bob = s === 0 ? -1 : 0;
    if (v === 2) {
      P(bx - 4 + s, by - 4, 2, 4, DK); P(bx - 1 - s, by - 4, 2, 4, DK);
      P(bx - 5 + s, by - 1, 3, 1, DK); P(bx - 2 - s, by - 1, 3, 1, DK);
      if (wind) {
        P(bx - 5, by - 11, 7, 7, SH); P(bx - 4, by - 12, 5, 1, SK); P(bx - 2, by - 9, 1, 1, DK);
        P(bx + 1, by - 13, 4, 4, SK); P(bx + 4, by - 11, 1, 2, SH); eye(bx + 3, by - 12); P(bx + 3, by - 10, 2, 1, MO);
        P(bx - 5, by - 18, 2, 7, SH); P(bx - 7, by - 19, 3, 1, CL); P(bx - 7, by - 20, 1, 1, CL); P(bx - 4, by - 20, 1, 1, CL); tip(bx - 6, by - 20);
        P(bx + 2, by - 8, 2, 4, SH);
      } else {
        P(bx - 5, by - 9 + bob, 8, 5, SH); P(bx - 4, by - 10 + bob, 5, 1, SK); P(bx - 3, by - 11 + bob, 3, 1, SK);
        P(bx - 2, by - 8 + bob, 1, 1, DK); P(bx, by - 8 + bob, 1, 1, DK);
        P(bx + 2, by - 9 + bob, 4, 4, SK); P(bx + 5, by - 7 + bob, 1, 2, SH); eye(bx + 4, by - 8 + bob); P(bx + 4, by - 6 + bob, 2, 1, MO);
        P(bx + 1 + s, by - 6 + bob, 2, 5 - bob, SH); P(bx + 1 + s, by - 1, 3, 1, CL);
      }
      return;
    }
    const back = v === 1;
    P(bx - 3, by - 4 - (s > 0 ? 1 : 0), 2, 4, DK); P(bx + 1, by - 4 - (s < 0 ? 1 : 0), 2, 4, DK);
    if (wind) {
      P(bx - 4, by - 11, 8, 7, SH); P(bx - 3, by - 12, 6, 1, SK);
      if (!back) { P(bx - 2, by - 13, 4, 4, SK); P(bx - 2, by - 10, 4, 1, SH); eye(bx - 2, by - 12); eye(bx + 1, by - 12); P(bx - 1, by - 10, 2, 1, MO); }
      else { P(bx - 3, by - 13, 6, 2, SK); P(bx, by - 11, 1, 6, SK); }
      P(bx - 7, by - 18, 2, 8, SH); P(bx + 5, by - 18, 2, 8, SH);
      P(bx - 8, by - 19, 3, 1, CL); P(bx + 5, by - 19, 3, 1, CL); P(bx - 8, by - 20, 1, 1, CL); P(bx + 7, by - 20, 1, 1, CL); tip(bx + 7, by - 20);
      return;
    }
    P(bx - 4, by - 9 + bob, 8, 6, SH); P(bx - 3, by - 10 + bob, 6, 1, SK); P(bx - 5, by - 8 + bob, 1, 3, SH); P(bx + 4, by - 8 + bob, 1, 3, SH);
    if (!back) {
      P(bx - 2, by - 9 + bob, 4, 4, SK); P(bx - 2, by - 6 + bob, 4, 1, SH); eye(bx - 2, by - 8 + bob); eye(bx + 1, by - 8 + bob); P(bx - 1, by - 6 + bob, 2, 1, MO);
      P(bx - 3, by - 5 + bob, 1, 1, DK); P(bx + 2, by - 5 + bob, 1, 1, DK);
    } else { P(bx - 3, by - 11 + bob, 6, 3, SK); P(bx, by - 8 + bob, 1, 1, DK); P(bx, by - 6 + bob, 1, 1, DK); }
    P(bx - 6, by - 8 + bob, 2, 6 + (s < 0 ? 1 : 0), SH); P(bx + 4, by - 8 + bob, 2, 6 + (s > 0 ? 1 : 0), SH);
    P(bx - 7, by - 2 + bob + (s < 0 ? 1 : 0), 3, 1, CL); P(bx + 4, by - 2 + bob + (s > 0 ? 1 : 0), 3, 1, CL);
  } },
  hound: { w: 30, h: 20, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const BD = '#463a3a', RB = '#8c7468', DK = '#1e1618', MO = '#8a1010', TE = '#e0d8c0';
    const s = [1, 0, -1, 0][f], bob = s === 0 ? -1 : 0, lo = wind ? 1 : 0;
    if (v === 2) {
      for (const [lx, o] of [[bx - 7, s], [bx - 5, -s], [bx + 3, -s], [bx + 5, s]]) { P(lx, by - 5 + lo, 1, 4 - lo, DK); P(lx + o, by - 1, 1, 1, DK); }
      P(bx - 8, by - 9 + bob + lo, 13, 3, BD); P(bx + 1, by - 9 + bob + lo, 4, 4, BD);
      P(bx - 7, by - 10 + bob + lo, 10, 1, RB); P(bx - 6, by - 11 + bob + lo, 1, 1, RB); P(bx - 3, by - 11 + bob + lo, 1, 1, RB); P(bx, by - 11 + bob + lo, 1, 1, RB);
      for (let x = bx - 4; x <= bx + 2; x += 2) P(x, by - 8 + bob + lo, 1, 2, RB);
      P(bx - 10, by - 10 + bob, 2, 1, BD); P(bx - 11, by - 11 + bob, 1, 1, BD); P(bx - 12, by - 12 + bob, 1, 1, BD);
      const hx = bx + 5 + (wind ? 1 : 0), hy = by - 13 + bob + (wind ? 3 : 0);
      P(bx + 4, by - 11 + bob + lo, 2, 3, BD);
      P(hx, hy, 4, 3, BD); P(hx + 4, hy + 1, 4, 2, BD); P(hx, hy - 2, 1, 2, BD); P(hx + 1, hy - 3, 1, 2, BD); P(hx + 4, hy + 1, 3, 1, RB);
      eye(hx + 2, hy + 1);
      if (wind) { P(hx + 4, hy + 3, 4, 1, MO); P(hx + 5, hy + 3, 1, 1, TE); P(hx + 7, hy + 3, 1, 1, TE); tip(hx + 8, hy + 1); }
      return;
    }
    const back = v === 1;
    P(bx - 2, by - 5 - (s > 0 ? 1 : 0), 1, 5, DK); P(bx + 1, by - 5 - (s < 0 ? 1 : 0), 1, 5, DK);
    P(bx - 3, by - 9 + bob, 6, 4, BD); P(bx - 3, by - 8 + bob, 1, 2, RB); P(bx + 2, by - 8 + bob, 1, 2, RB); P(bx - 4, by - 10 + bob, 8, 2, BD);
    if (back) {
      P(bx - 3, by - 13 + bob, 1, 3, BD); P(bx + 2, by - 13 + bob, 1, 3, BD); P(bx - 2, by - 12 + bob, 4, 2, BD);
      P(bx, by - 9 + bob, 1, 4, RB); P(bx, by - 6 + bob, 1, 3, BD); P(bx, by - 4 + bob, 1, 1, RB);
    } else {
      const hy = by - 13 + bob + (wind ? 2 : 0);
      P(bx - 2, hy, 5, 4, BD); P(bx - 1, hy + 4, 3, 2, BD); P(bx, hy + 4, 1, 1, RB); P(bx - 3, hy - 2, 1, 3, BD); P(bx + 3, hy - 2, 1, 3, BD);
      eye(bx - 1, hy + 1); eye(bx + 1, hy + 1);
      if (wind) { P(bx - 1, hy + 6, 3, 1, MO); P(bx - 1, hy + 6, 1, 1, TE); P(bx + 1, hy + 6, 1, 1, TE); tip(bx, hy + 7); }
    }
  } },
  wraith: { w: 22, h: 28, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const L = '#b8cadc', M = '#74889f', D = '#3c4860', V = '#05070c', C = '#e6f4ff';
    const top = by - 24;
    for (let y = 0; y < 16; y++) { const hw = 3 + (y >> 2); P(bx - hw, top + 6 + y, hw, 1, v === 1 ? M : L); P(bx, top + 6 + y, hw, 1, M); }
    for (let k = 0; k < 7; k++) { const len = 1 + ((k * 7 + f * 3) % 4); P(bx - 7 + k * 2 + (f & 1), top + 22, 1, len, k & 1 ? M : D); }
    P(bx - 3, top, 6, 7, M); P(bx - 2, top - 1, 4, 1, M); P(bx - 3, top, 2, 6, L);
    if (v === 0) { P(bx - 2, top + 2, 4, 4, V); eye(bx - 2, top + 3); eye(bx + 1, top + 3); }
    else if (v === 2) { P(bx, top + 2, 3, 4, V); P(bx + 2, top, 2, 2, M); eye(bx + 1, top + 3); }
    if (wind) {
      P(bx - 9, top + 4, 4, 2, M); P(bx + 5, top + 4, 4, 2, M); P(bx - 6, top + 6, 2, 2, M); P(bx + 4, top + 6, 2, 2, M);
      P(bx - 10, top + 2, 1, 2, C); P(bx - 9, top + 1, 1, 1, C); P(bx + 9, top + 2, 1, 2, C); P(bx + 8, top + 1, 1, 1, C); tip(bx + 9, top + 1);
    } else {
      const sw = [0, 1, 0, -1][f];
      P(bx - 6, top + 8 + sw, 2, 6, M); P(bx + 4, top + 8 - sw, 2, 6, M); P(bx - 6, top + 14 + sw, 1, 1, C); P(bx + 5, top + 14 - sw, 1, 1, C);
    }
  } },
  lurker: { w: 30, h: 24, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const B = '#2c3827', M = '#4d6139', D = '#151c13', MW = '#420c0c', T = '#ddd6b6', SL = '#71834c';
    const s = [1, 0, -1, 0][f], bob = s === 0 ? -1 : 0, ex = v === 2 ? 3 : 0;
    const top = by - 13 + bob + (wind ? -2 : 0);
    if (wind) { P(bx - 14, top - 4, 3, 10, B); P(bx + 11, top - 4, 3, 10, B); P(bx - 15, top - 5, 2, 1, T); P(bx + 13, top - 5, 2, 1, T); tip(bx + 13, top - 5); }
    [6, 8, 9, 10, 10, 10, 10, 9, 8].forEach((hw, i) => P(bx - hw, top + i, hw * 2, 1, i < 2 ? M : B));
    P(bx - 10, top + 9, 20, Math.max(1, by - top - 9), D);
    P(bx - 5, top, 3, 1, SL); P(bx + 2, top + 1, 2, 1, SL); P(bx - 7, top + 3, 1, 3, M); P(bx + 7, top + 4, 1, 2, M); P(bx - 2, top + 1, 1, 1, SL);
    if (v !== 1) {
      eye(bx - 4 + ex, top + 2); eye(bx + 3 + ex, top + 2);
      if (wind) { P(bx - 6 + ex, top + 4, 12, 4, MW); for (let k = 0; k < 6; k++) { P(bx - 5 + ex + k * 2, top + 4, 1, 1, T); P(bx - 4 + ex + k * 2, top + 7, 1, 1, T); } }
      else { P(bx - 5 + ex, top + 5, 10, 1, MW); P(bx - 4 + ex, top + 5, 1, 1, T); P(bx + 3 + ex, top + 5, 1, 1, T); }
    } else { P(bx - 1, top + 2, 2, 5, M); }
    if (!wind) { P(bx - 12, top + 4 + (s > 0 ? 1 : 0), 3, by - top - 4, B); P(bx + 9, top + 4 + (s < 0 ? 1 : 0), 3, by - top - 4, B); P(bx - 13, by - 1, 3, 1, T); P(bx + 10, by - 1, 3, 1, T); }
  } },
  imp: { w: 20, h: 20, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const S = '#55180a', C = '#ff7a1e', Y = '#ffd27a', H = '#1c0703', WG = '#33100a';
    const s = [1, 0, -1, 0][f], hop = f % 2 ? -1 : 0, top = by - 12 + hop, wf = [0, -1, -2, -1][f];
    const wings = () => { P(bx - 6, top + 1 + wf, 3, 3, WG); P(bx - 7, top + wf, 1, 2, WG); P(bx + 3, top + 1 + wf, 3, 3, WG); P(bx + 6, top + wf, 1, 2, WG); P(bx - 6, top + 4 + wf, 1, 1, C); P(bx + 5, top + 4 + wf, 1, 1, C); };
    if (v !== 1) wings();
    P(bx - 2, by - 4 - (s > 0 ? 1 : 0), 1, 4, H); P(bx + 1, by - 4 - (s < 0 ? 1 : 0), 1, 4, H);
    P(bx - 2, top + 3, 4, 5, S); P(bx - 1, top + 4, 1, 2, C); P(bx + 1, top + 6, 1, 1, C); P(bx, top + 5, 1, 1, Y);
    P(bx - 2, top, 4, 3, S); P(bx - 3, top - 2, 1, 2, H); P(bx + 2, top - 2, 1, 2, H);
    if (v === 0) { eye(bx - 1, top + 1); eye(bx + 1, top + 1); P(bx - 1, top + 2, 2, 1, C); } else if (v === 2) eye(bx + 1, top + 1);
    P(bx + 2, by - 3, 2, 1, S); P(bx + 4, by - 4, 1, 1, C);
    if (wind) { P(bx - 3, top - 1, 1, 4, S); P(bx + 2, top - 1, 1, 4, S); tip(bx, top - 4); }
    else { P(bx - 3, top + 3, 1, 3, S); P(bx + 2, top + 3, 1, 3, S); tip(bx, top + 4); }
    if (v === 1) wings();
  } },
  knight: { w: 24, h: 34, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const BN = '#d8cfb6', I = '#4c4c56', IH = '#80808c', ID = '#26262d', SH = '#3c2820', EM = '#8e1c14', BL = '#c8c8d4', V = '#080606';
    const s = [1, 0, -1, 0][f], bob = s === 0 ? -1 : 0;
    P(bx - 3, by - 7 - (s > 0 ? 1 : 0), 2, 7, I); P(bx + 1, by - 7 - (s < 0 ? 1 : 0), 2, 7, I);
    P(bx - 2, by - 4 - (s > 0 ? 1 : 0), 1, 2, BN); P(bx + 2, by - 4 - (s < 0 ? 1 : 0), 1, 2, BN);
    P(bx - 4, by - 10 + bob, 8, 3, ID);
    if (v === 2) {
      P(bx - 3, by - 16 + bob, 6, 6, I); P(bx - 3, by - 16 + bob, 1, 6, IH); P(bx - 1, by - 14 + bob, 3, 1, BN); P(bx - 1, by - 12 + bob, 3, 1, BN);
      P(bx - 3, by - 23 + bob, 6, 7, I); P(bx - 3, by - 23 + bob, 6, 1, IH); P(bx - 2, by - 25 + bob, 2, 2, EM);
      P(bx + 1, by - 20 + bob, 3, 1, V); eye(bx + 2, by - 20 + bob); P(bx + 1, by - 18 + bob, 2, 1, BN);
      if (wind) { P(bx - 5, by - 22, 2, 7, BN); P(bx - 6, by - 23, 3, 1, IH); P(bx - 5, by - 31, 1, 8, BL); tip(bx - 5, by - 31); }
      else { P(bx - 5, by - 15 + bob, 2, 6, BN); P(bx - 6, by - 9 + bob, 3, 1, IH); P(bx - 5, by - 8 + bob, 1, 8, BL); tip(bx - 5, by - 1); }
      P(bx + 2, by - 17 + bob, 3, 9, SH); P(bx + 4, by - 17 + bob, 1, 9, IH); P(bx + 2, by - 17 + bob, 3, 1, IH); P(bx + 3, by - 14 + bob, 1, 3, EM);
      return;
    }
    const back = v === 1, sx = back ? -1 : 1;
    P(bx - 4, by - 16 + bob, 8, 6, I); P(bx - 4, by - 16 + bob, 1, 6, IH);
    if (!back) { P(bx - 2, by - 15 + bob, 4, 4, ID); P(bx - 2, by - 14 + bob, 4, 1, BN); P(bx - 2, by - 12 + bob, 4, 1, BN); P(bx, by - 15 + bob, 1, 4, BN); }
    else { P(bx, by - 16 + bob, 1, 6, BN); }
    P(bx - 6, by - 17 + bob, 3, 2, IH); P(bx + 3, by - 17 + bob, 3, 2, IH);
    P(bx - 3, by - 23 + bob, 6, 7, I); P(bx - 3, by - 23 + bob, 6, 1, IH); P(bx - 1, by - 25 + bob, 2, 2, EM);
    if (!back) { P(bx - 2, by - 20 + bob, 4, 1, V); eye(bx - 2, by - 20 + bob); eye(bx + 1, by - 20 + bob); P(bx - 2, by - 18 + bob, 4, 1, BN); P(bx - 1, by - 17 + bob, 1, 1, V); P(bx + 1, by - 17 + bob, 1, 1, V); }
    const shx = bx - sx * 7 - 2;
    P(shx, by - 16 + bob, 5, 8, SH); P(shx, by - 16 + bob, 5, 1, IH); P(shx + (sx > 0 ? 0 : 4), by - 16 + bob, 1, 8, IH); P(shx + 1, by - 8 + bob, 3, 1, SH);
    if (!back) { P(shx + 2, by - 14 + bob, 1, 4, EM); P(shx + 1, by - 13 + bob, 3, 1, EM); }
    const ax = bx + sx * 5 - (sx > 0 ? 1 : 0);
    if (wind) { P(ax, by - 22, 2, 7, BN); P(ax - 1, by - 23, 4, 1, IH); P(ax + (sx > 0 ? 1 : 0), by - 31, 1, 8, BL); tip(ax + (sx > 0 ? 1 : 0), by - 31); }
    else { P(ax, by - 15 + bob, 2, 6, BN); P(ax - 1, by - 9 + bob, 4, 1, IH); P(ax + (sx > 0 ? 1 : 0), by - 8 + bob, 1, 8, BL); tip(ax + 1, by - 1); }
  } },
  cultist: { w: 20, h: 32, draw(A, bx, by, v, f, wind) {
    const { P, eye, tip } = A;
    const R = '#523a37', RS = '#311f1f', RD = '#1c1212', TR = '#9a3220', V = '#060405', ST = '#3e2c1c', CA = '#e0d6bc', SK = '#8e8882';
    const s = [1, 0, -1, 0][f];
    for (let y = 0; y < 16; y++) { const hw = 3 + (y / 4 | 0); P(bx - hw, by - 17 + y, hw, 1, v === 1 ? RS : R); P(bx, by - 17 + y, hw, 1, RS); }
    P(bx - 6 + (s > 0 ? 1 : 0), by - 2, 12, 2, RD); P(bx - 2 + s, by - 1, 2, 1, '#0c0909');
    if (v === 0) { P(bx - 1, by - 16, 1, 14, TR); P(bx - 3, by - 11, 6, 1, TR); }
    P(bx - 3, by - 23, 6, 7, R); P(bx - 2, by - 24, 4, 1, R); P(bx + 1, by - 23, 2, 6, RS);
    if (v === 0) { P(bx - 2, by - 21, 4, 4, V); eye(bx - 2, by - 20); eye(bx + 1, by - 20); }
    else if (v === 2) { P(bx, by - 21, 3, 4, V); eye(bx + 1, by - 20); }
    const sx = v === 1 ? -1 : 1, stx = bx + sx * 6 - (sx < 0 ? 1 : 0);
    if (wind) { P(stx - sx, by - 28, 1, 24, ST); P(stx - sx * 3 - (sx > 0 ? 0 : 2), by - 19, 3, 2, SK); P(stx - sx, by - 30, 1, 2, CA); tip(stx - sx, by - 31); }
    else { P(stx, by - 23, 1, 22, ST); P(stx - sx * 2 - (sx > 0 ? 0 : 1), by - 14, 3, 2, SK); P(stx, by - 25, 1, 2, CA); tip(stx, by - 26); }
    P(bx - sx * 5 - 1, by - 13, 2, 2, SK);
  } },
};
const MSPR = {};
function spriteAPI(g, eyes, tipRef) {
  return {
    P: (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); },
    eye: (x, y) => { eyes.push([x, y]); g.fillStyle = '#000'; g.fillRect(x, y, 1, 1); },
    tip: (x, y) => { tipRef[0] = [x, y]; },
  };
}
function buildCreature(type) {
  const D = CRE[type];
  const one = (v, f, wind) => {
    const c = canvas(D.w, D.h), eyes = [], tp = [null];
    D.draw(spriteAPI(c.getContext('2d'), eyes, tp), D.w >> 1, D.h - 2, v, f, wind);
    c.eyes = eyes; c.tip = tp[0] || [D.w >> 1, 4];
    return c;
  };
  const views = [];
  for (let v = 0; v < 3; v++) { const fr = []; for (let f = 0; f < 4; f++) fr.push(one(v, f, false)); fr.push(one(v, 0, true)); views.push(fr); }
  views.push(views[2].map(mirror));
  for (const fr of views) for (const c of fr) { c.white = tint(c, '#ffffff'); c.hot = tint(c, '#ff3818'); }
  MSPR[type] = views;
}

// Morhain: a tall robed figure, front view; poses idle | fan | ring | summon | nova, two sway frames
const BOSS_POSES = ['idle', 'fan', 'ring', 'summon', 'nova'];
function drawMorhain(A, bx, by, pose, f) {
  const { P, eye, tip } = A;
  const RO = '#16101c', RH = '#2c2338', RD = '#09060c', TR = '#7a6a50', SK = '#d2c9be', SD = '#8a8278', V = '#030204', RED = '#7a1010';
  for (let y = 0; y < 38; y++) {
    const hw = 6 + (y * 6 / 38 | 0), row = by - 40 + y;
    P(bx - hw, row, hw * 2, 1, RO); P(bx - hw, row, 2, 1, RH); P(bx + hw - 1, row, 1, 1, RD);
  }
  for (let k = 0; k < 12; k++) P(bx - 12 + k * 2 + (f & 1), by - 2, 1, 1 + ((k * 5 + f) % 3), RD);
  P(bx - 1, by - 38, 2, 34, TR); P(bx - 4, by - 39, 1, 22, RED); P(bx + 3, by - 39, 1, 22, RED);
  P(bx - 4, by - 18, 1, 2, RED); P(bx + 3, by - 18, 1, 2, RED);
  P(bx - 8, by - 42, 16, 4, RH); P(bx - 7, by - 43, 14, 1, RH); P(bx - 8, by - 39, 16, 1, RD);
  P(bx - 5, by - 51, 10, 10, RO); P(bx - 4, by - 52, 8, 1, RO); P(bx - 5, by - 51, 2, 9, RH);
  P(bx - 3, by - 48, 6, 6, V); P(bx - 2, by - 43, 4, 1, SD);
  eye(bx - 2, by - 46); eye(bx + 1, by - 46);
  const hand = (x, y) => { P(x, y, 2, 2, SK); P(x, y + 2, 1, 2, SD); P(x + 1, y + 2, 1, 1, SD); };
  if (pose === 'idle') {
    P(bx - 9, by - 38, 3, 12, RO); P(bx + 6, by - 38, 3, 12, RO); P(bx - 9, by - 38, 1, 12, RH);
    P(bx - 6, by - 28, 4, 3, RO); P(bx + 2, by - 28, 4, 3, RO); P(bx - 2, by - 28, 4, 2, SK); P(bx - 2, by - 26, 1, 2, SD); P(bx + 1, by - 26, 1, 2, SD);
    tip(bx, by - 28);
  } else if (pose === 'fan') {
    P(bx - 9, by - 38, 3, 12, RO); hand(bx - 9, by - 26);
    P(bx + 6, by - 40, 10, 3, RO); P(bx + 6, by - 40, 10, 1, RH); P(bx + 16, by - 40, 3, 2, SK); P(bx + 19, by - 41, 1, 1, SD); P(bx + 19, by - 39, 1, 1, SD); P(bx + 19, by - 40, 2, 1, SD);
    tip(bx + 20, by - 40);
  } else if (pose === 'ring') {
    for (let k = 0; k < 10; k++) { P(bx - 8 - (k >> 1), by - 40 - k, 3, 2, RO); P(bx + 5 + (k >> 1), by - 40 - k, 3, 2, RO); }
    P(bx - 14, by - 54, 2, 3, SK); P(bx + 12, by - 54, 2, 3, SK); P(bx - 15, by - 56, 1, 2, SD); P(bx + 14, by - 56, 1, 2, SD);
    tip(bx, by - 58);
  } else if (pose === 'summon') {
    P(bx - 15, by - 37, 8, 3, RO); P(bx + 7, by - 37, 8, 3, RO); P(bx - 15, by - 37, 8, 1, RH);
    P(bx - 18, by - 36, 3, 2, SK); P(bx + 15, by - 36, 3, 2, SK); P(bx - 18, by - 34, 1, 2, SD); P(bx + 17, by - 34, 1, 2, SD); P(bx - 16, by - 34, 1, 2, SD); P(bx + 15, by - 34, 1, 2, SD);
    tip(bx, by - 2);
  } else {
    for (let k = 0; k < 12; k++) { P(bx - 7 + (k / 3 | 0), by - 40 - k, 3, 1, RO); P(bx + 4 - (k / 3 | 0), by - 40 - k, 3, 1, RO); }
    P(bx - 3, by - 55, 6, 3, SK); P(bx - 2, by - 57, 1, 2, SD); P(bx + 1, by - 57, 1, 2, SD);
    tip(bx, by - 60);
  }
}
let BSPR = null;
function buildBoss() {
  BSPR = {};
  for (const pose of BOSS_POSES) {
    BSPR[pose] = [];
    for (let f = 0; f < 2; f++) {
      const c = canvas(44, 66), eyes = [], tp = [null];
      drawMorhain(spriteAPI(c.getContext('2d'), eyes, tp), 22, 64, pose, f);
      c.eyes = eyes; c.tip = tp[0];
      const m = mirror(c);
      for (const k of [c, m]) { k.white = tint(k, '#ffffff'); k.hot = tint(k, '#b040ff'); }
      BSPR[pose].push([c, m]);
    }
  }
}

// signs: static parts cached; whatever points at the lair is drawn live along the sign's dirVec
let SIGN = null;
function buildSigns() {
  SIGN = {};
  SIGN.bush = [0, 1].map(i => mk(18, 14, 501 + i * 7, (g, r, w, h) => {
    g.lineWidth = 1;
    for (let k = 0; k < 11; k++) {
      g.strokeStyle = r() < .5 ? '#22180f' : '#30231a';
      const x = 3 + r() * (w - 6), y = h - 1;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - .5) * 10, y - r() * h, x + (r() - .5) * 8, y - 3 - r() * (h - 5)); g.stroke();
    }
    g.fillStyle = '#5a1010'; g.fillRect(5, 5, 1, 1); g.fillRect(12, 7, 1, 1);
  }));
  SIGN.post = mk(8, 30, 511, (g) => {
    g.fillStyle = '#382617'; g.fillRect(3, 2, 2, 27); g.fillStyle = '#4e3824'; g.fillRect(3, 2, 1, 27);
    g.fillStyle = '#211509'; g.fillRect(2, 27, 4, 2);
    g.fillStyle = '#4a0808'; g.fillRect(4, 14, 1, 4); g.fillRect(3, 19, 1, 2);
  });
  SIGN.circle = mk(30, 30, 521, (g, r) => {
    g.fillStyle = 'rgba(14,8,6,.85)'; g.beginPath(); g.arc(15, 15, 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a1810'; g.lineWidth = 1; g.beginPath(); g.arc(15, 15, 10.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(70,30,18,.8)'; g.beginPath(); g.arc(15, 15, 6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#4a2214';
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; g.fillRect(Math.round(15 + Math.cos(a) * 8.3), Math.round(15 + Math.sin(a) * 8.3), 1, r() < .5 ? 2 : 1); }
  });
  SIGN.blood = mk(26, 26, 531, (g, r) => {
    g.strokeStyle = '#5a0606'; g.lineWidth = 1; g.beginPath(); g.arc(13, 13, 8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#6a0808';
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + .3; const x = Math.round(13 + Math.cos(a) * 10.5), y = Math.round(13 + Math.sin(a) * 10.5); g.fillRect(x, y, 1, 2); g.fillRect(x - 1, y, 3, 1); }
    for (let k = 0; k < 7; k++) g.fillRect(Math.round(5 + r() * 16), Math.round(5 + r() * 16), 1, 1);
  });
  SIGN.bloodGlow = tint(SIGN.blood, '#ff3018');
}
// a crow nailed with spread wings; the head and beak point along (ux, uy)
function drawCrow(c, x, y, ux, uy, sq) {
  // top-down crow lying with wings spread across (ux, uy); sq squashes the vertical axis
  sq = sq || 1;
  const px = -uy, py = ux;
  c.fillStyle = '#0c0a0e';
  for (let k = -3; k <= 2; k++) c.fillRect(Math.round(x + ux * k) - 1, Math.round(y + uy * k * sq) - 1, 2, 2);
  for (let k = 1; k <= 6; k++) {
    c.fillStyle = k > 4 ? '#3a3444' : '#120e16';
    const bk = k * .45;
    c.fillRect(Math.round(x + px * k - ux * bk), Math.round(y + (py * k - uy * bk) * sq) - 1, 1, 2);
    c.fillRect(Math.round(x - px * k - ux * bk), Math.round(y + (-py * k - uy * bk) * sq) - 1, 1, 2);
  }
  c.fillStyle = '#0c0a0e'; c.fillRect(Math.round(x + ux * 3) - 1, Math.round(y + uy * 3 * sq) - 1, 3, 3);
  c.fillStyle = '#b0a488'; c.fillRect(Math.round(x + ux * 5), Math.round(y + uy * 5 * sq), 1, 1);
  c.fillStyle = '#a0a0ac'; c.fillRect(Math.round(x), Math.round(y), 1, 1);
}
function drawCrowFront(c, x, y) {
  // a crow nailed to the crossbar, seen from the front, wings drooping out to the sides
  c.fillStyle = '#0d0b10'; c.fillRect(x - 1, y - 2, 2, 5); c.fillRect(x - 1, y - 4, 2, 2);
  c.fillStyle = '#16121a'; c.fillRect(x - 5, y - 2, 4, 1); c.fillRect(x + 1, y - 2, 4, 1); c.fillRect(x - 5, y - 1, 2, 2); c.fillRect(x + 3, y - 1, 2, 2);
  c.fillStyle = '#3a3444'; c.fillRect(x - 6, y, 1, 2); c.fillRect(x + 5, y, 1, 2);
  c.fillStyle = '#9a9070'; c.fillRect(x, y - 3, 1, 1);
  c.fillStyle = '#5a0808'; c.fillRect(x, y + 3, 1, 2);
}

// projectiles, number font, light sprites
let PSPR = null, DIGITS = null;
function disc(r, cols) {
  const S = r * 2 + 3, c = canvas(S, S), g = c.getContext('2d'), m = S / 2;
  cols.forEach((col, i) => { const rr = r * (1 - i / cols.length) + .3; g.fillStyle = col; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x + .5 - m, y + .5 - m) <= rr) g.fillRect(x, y, 1, 1); });
  return c;
}
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
function buildDigits(col) {
  const c = canvas(50, 7), g = c.getContext('2d');
  for (let pass = 0; pass < 2; pass++) for (let d = 0; d < 10; d++) for (let i = 0; i < 15; i++) {
    if (DIG[d][i] !== '1') continue;
    const x = d * 5 + 1 + i % 3, y = 1 + (i / 3 | 0);
    if (pass === 0) { g.fillStyle = 'rgba(0,0,0,.85)'; g.fillRect(x - 1, y - 1, 3, 3); } else { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}
let HOLE = null; const GLOW = new Map();
function buildLights() {
  HOLE = canvas(128, 128);
  const g = HOLE.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.35, 'rgba(0,0,0,.85)'); gr.addColorStop(.7, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}
function glowSpr(c) {
  const k = (c[0] << 16) | (c[1] << 8) | c[2];
  let s = GLOW.get(k);
  if (!s) {
    s = canvas(64, 64); const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32 * .8);
    gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},.22)`); gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); GLOW.set(k, s);
  }
  return s;
}
let heroCv, hctx, heroTint, htctx, arenaDecal = null, arenaGlow = null;
const trailPool = [];
function buildEntitySprites() {
  for (const k in CRE) buildCreature(k);
  buildBoss(); buildSigns(); buildLights();
  PSPR = {
    fire: disc(3, ['#c2380e', '#ff8a2a', '#ffe7a0']),
    bolt: disc(3, ['#2a0a44', '#9a40e0', '#e8c8ff']),
    boss: disc(4, ['#1a0428', '#7a20c0', '#c890ff', '#fff0ff']),
  };
  DIGITS = { deal: buildDigits('#f4ead2'), big: buildDigits('#ffd27a'), hurt: buildDigits('#ff4a3a') };
  heroCv = canvas(64, 64); hctx = heroCv.getContext('2d');
  heroTint = canvas(64, 64); htctx = heroTint.getContext('2d');
  for (let i = 0; i < 12; i++) trailPool.push(canvas(64, 64));
}
function buildArena() {
  const R = curCfg.arenaRadius + 8, S = R * 2, a0 = world.lair.angle || 0;
  const draw = (g, glow) => {
    g.lineCap = 'round';
    g.strokeStyle = glow ? 'rgba(255,80,24,.9)' : 'rgba(10,4,3,.75)'; g.lineWidth = glow ? 1 : 5;
    g.beginPath(); g.arc(R, R, curCfg.arenaRadius - 2, 0, Math.PI * 2); g.stroke();
    g.lineWidth = glow ? 1 : 2; g.strokeStyle = glow ? 'rgba(255,90,30,.7)' : 'rgba(26,10,6,.8)';
    g.beginPath(); g.arc(R, R, curCfg.obeliskRing, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(R, R, 36, 0, Math.PI * 2); g.stroke();
    const n = curCfg.obeliskCount, pts = [];
    for (let k = 0; k < n; k++) { const a = a0 + k / n * Math.PI * 2; pts.push([R + Math.cos(a) * curCfg.obeliskRing, R + Math.sin(a) * curCfg.obeliskRing]); }
    g.lineWidth = glow ? 1 : 1.5; g.strokeStyle = glow ? 'rgba(255,70,20,.55)' : 'rgba(30,12,8,.75)';
    g.beginPath(); for (let k = 0; k < n; k++) { const p = pts[k], q = pts[(k + 3) % n]; g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); } g.stroke();
    const r = rng(77);
    g.fillStyle = glow ? 'rgba(255,110,40,.8)' : 'rgba(40,14,8,.9)';
    for (let k = 0; k < 48; k++) {
      const a = k / 48 * Math.PI * 2, rr = curCfg.arenaRadius - 10;
      const x = Math.round(R + Math.cos(a) * rr), y = Math.round(R + Math.sin(a) * rr), t2 = r() * 3 | 0;
      if (t2 === 0) { g.fillRect(x, y - 1, 1, 3); g.fillRect(x - 1, y, 3, 1); } else if (t2 === 1) { g.fillRect(x - 1, y - 1, 1, 3); g.fillRect(x + 1, y - 1, 1, 3); } else { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y + 2, 1, 1); }
    }
  };
  arenaDecal = canvas(S, S); draw(arenaDecal.getContext('2d'), false);
  arenaGlow = canvas(S, S); draw(arenaGlow.getContext('2d'), true);
  arenaDecal.lair = world.lair;
}

// ================================================================ per-game render state
let curGame = null, curCfg = null, curS = null, curHero = null, frameDt = 0;
const RS = new Map(), parts = [], ghosts = [], nums = [], decals = [], afterimgs = [];
const seenFx = new WeakSet();
let projPrev = new Map(), hurtT = 0, shake = 0, lvlT = 0, rungT = 0, deadT = 0, spawnT = 0, fall = null, vict = null, wrathK = 0, lastHeroHp = null, restGlow = 0;
const bossR = { hp: null, flash: 0, x: null, y: null, acc: 0, accT: 0 };
function resetFx() {
  RS.clear(); parts.length = ghosts.length = nums.length = decals.length = afterimgs.length = 0; projPrev = new Map();
  hurtT = shake = lvlT = rungT = deadT = spawnT = wrathK = restGlow = 0; fall = vict = null; lastHeroHp = null;
  bossR.hp = null; bossR.x = null; bossR.acc = bossR.accT = 0; arenaDecal = null;
}
// particles: world coordinates; add = additive; home = flies into the hero (lifesteal motes)
function part(x, y, vx, vy, life, c, o) {
  if (parts.length > 900) return;
  parts.push({ x, y, vx, vy, life, max: life, c, s: (o && o.s) || 1, g: (o && o.g) || 0, add: !!(o && o.add), drag: (o && o.drag) || 0, home: !!(o && o.home) });
}
function numAt(x, y, v, kind) { if (v < .5) return; nums.push({ x: x + (Math.random() - .5) * 6, y, v: Math.round(v), life: .85, kind: kind || 'deal' }); }
function ashBurst(x, y, w, h, n, ember) {
  for (let i = 0; i < n; i++) {
    const g = Math.random();
    part(x + (Math.random() - .5) * w, y - Math.random() * h, (Math.random() - .5) * 14, -6 - Math.random() * 18, .7 + Math.random() * .8,
      g < .5 ? '110,104,98' : g < .85 ? '48,42,40' : (ember || '255,120,50'), { add: g >= .85, drag: 1.5 });
  }
}
// lifesteal: red motes flow from the struck enemy into the hero, more as the rung deepens
function bloodMotes(x, y, dmg) {
  const H = curHero, ls = curCfg && curCfg.lifesteal ? (Array.isArray(curCfg.lifesteal) ? curCfg.lifesteal[H.rung] : 0) : 0;
  if (!ls || !H) return;
  const n = Math.min(10, Math.round(dmg * ls * 1.2 + ls * 8));
  for (let i = 0; i < n; i++) part(x + (Math.random() - .5) * 8, y - 4 - Math.random() * 8, (Math.random() - .5) * 40, -10 - Math.random() * 30, 1.2, Math.random() < .6 ? '255,30,30' : '170,0,10', { add: true, home: true, s: Math.random() < .3 ? 2 : 1 });
}
function onEvents(evs) {
  if (!curHero) return;
  for (const e of evs) {
    switch (e.type) {
      case 'kill': {
        const r = RS.get(e.id);
        if (r) {
          if (r.spr) ghosts.push({ spr: r.spr, x: r.x, y: r.y, life: .75, max: .75, alpha: r.alpha || 1 });
          ashBurst(r.x, r.y - 2, 10, r.spr ? r.spr.height * .7 : 12, 22);
          const last = r.hp + r.acc;
          if (last > .5) { numAt(r.x, r.y - (r.spr ? r.spr.height - 2 : 16), last, last >= 30 ? 'big' : 'deal'); bloodMotes(r.x, r.y, last); }
          RS.delete(e.id);
        }
        break;
      }
      case 'hurt': hurtT = Math.min(.45, .16 + e.dmg / 70); shake = Math.max(shake, Math.min(2.5, e.dmg / 9)); numAt(curHero.x, curHero.y - 24, e.dmg, 'hurt'); break;
      case 'levelup': lvlT = 1.5; for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28; part(curHero.x + Math.cos(a) * 8, curHero.y - 4 + Math.sin(a) * 3, Math.cos(a) * 10, -14 - Math.random() * 26, 1 + Math.random() * .6, '255,200,120', { add: true }); } break;
      case 'rung': rungT = 2.2; shake = Math.max(shake, 1.5); for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, d = 30 + Math.random() * 30; part(curHero.x + Math.cos(a) * d, curHero.y - 8 + Math.sin(a) * d * .6, -Math.cos(a) * d * 1.4, -Math.sin(a) * d * .9, .7, '30,8,16', { drag: .5 }); } break;
      case 'sign': for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28; part(e.x, e.y - 4, Math.cos(a) * 16, Math.sin(a) * 10 - 8, .8, '255,230,190', { add: true }); } break;
      case 'bonfire': for (let i = 0; i < 30; i++) part(e.x + (Math.random() - .5) * 10, e.y - 6, (Math.random() - .5) * 20, -20 - Math.random() * 40, 1 + Math.random(), '255,170,70', { add: true }); break;
      case 'boss_awake': shake = Math.max(shake, 2.5); break;
      case 'boss_phase': shake = Math.max(shake, 3); break;
      case 'respawn': spawnT = 1; break;
    }
  }
}

// ================================================================ entity drawing (swappable through AW.render)
function viewOf(ang) { const c = Math.cos(ang), s = Math.sin(ang); return Math.abs(c) > Math.abs(s) * 1.1 ? (c > 0 ? 2 : 3) : (s < 0 ? 1 : 0); }
function star(c, x, y, r, col, a) {
  c.fillStyle = `rgba(${col},${a})`;
  c.fillRect(Math.round(x) - r, Math.round(y), r * 2 + 1, 1); c.fillRect(Math.round(x), Math.round(y) - r, 1, r * 2 + 1);
  c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(Math.round(x), Math.round(y), 1, 1);
}
let eyeList = [], glintList = [], postAdd = [];
function hpBar(c, x, y, w, frac, col) {
  c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(Math.round(x - w / 2) - 1, Math.round(y) - 1, w + 2, 3);
  c.fillStyle = col || '#b02a2a'; c.fillRect(Math.round(x - w / 2), Math.round(y), Math.max(0, Math.round(w * frac)), 1);
}
function drawMonster(c, m, x, y, T) {
  let r = RS.get(m.id);
  if (!r) {
    r = { t0: T, x: m.x, y: m.y, hp: m.hp, walk: 0, flash: 0, acc: 0, accT: 0, spr: null, alpha: 1 };
    RS.set(m.id, r);
    if (m.summoned) for (let i = 0; i < 12; i++) part(m.x + (Math.random() - .5) * 12, m.y, (Math.random() - .5) * 10, -8 - Math.random() * 14, .9, '120,50,180', { add: true });
  }
  const dx = m.x - r.x, dy = m.y - r.y, mv = Math.hypot(dx, dy);
  r.walk += mv; r.x = m.x; r.y = m.y; r.seen = T;
  const dh = r.hp - m.hp;
  if (dh > .01) { r.acc += dh; if (dh >= 2) { r.flash = .13; bloodMotes(m.x, m.y, dh); } }
  r.hp = m.hp; r.accT += frameDt; r.flash = Math.max(0, r.flash - frameDt);
  const sprs = MSPR[m.type] || MSPR.ghoul;
  const moving = mv > .04;
  const view = viewOf(m.state === 'idle' && moving ? Math.atan2(dy, dx) : m.face);
  const wind = m.state === 'windup';
  const fi = wind ? 4 : moving ? ((r.walk / 3.2 | 0) % 4) : (m.type === 'wraith' ? ((T * 4 + m.id) | 0) % 4 : 1);
  const spr = sprs[view][fi];
  r.spr = spr;
  const w = spr.width, h = spr.height;
  let yy = y, alpha = 1, vis = h;
  if (m.type === 'wraith') { yy = y - 3 - Math.round(Math.sin(T * 3 + m.id) * 1.5); alpha = .62 + .14 * Math.sin(T * 17 + m.id * 3) + (Math.random() < .03 ? -.3 : 0); }
  const age = T - r.t0;
  if (m.type === 'lurker') {
    if (age < .9) { vis = Math.max(1, Math.round(h * Math.min(1, age / .9))); if (Math.random() < .5) part(m.x + (Math.random() - .5) * 18, m.y, (Math.random() - .5) * 16, -10 - Math.random() * 12, .5, '120,150,160', { g: 60 }); }
    else if (world.waterAt(m.x, m.y)) vis = h - 4;
  } else if (m.summoned && age < .7) vis = Math.max(1, Math.round(h * age / .7));
  r.alpha = alpha;
  const ox = Math.round(x - (w >> 1)), top = Math.round(yy + 2 - vis);
  c.fillStyle = m.type === 'wraith' ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.45)';
  c.beginPath(); c.ellipse(x, y, Math.max(4, w * .28), 2.2, 0, 0, Math.PI * 2); c.fill();
  if (vis < h && m.type === 'lurker') { c.strokeStyle = 'rgba(150,180,190,.35)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, 11 + Math.sin(T * 3), 3, 0, 0, Math.PI * 2); c.stroke(); }
  const blit = (img, a) => { if (a <= 0) return; c.globalAlpha = Math.min(1, a); c.drawImage(img, 0, 0, w, vis, ox, top, w, vis); };
  blit(spr, alpha);
  let k = 0;
  if (wind && m.windDur) {
    k = Math.max(0, Math.min(1, 1 - m.stateT / m.windDur));
    const strobe = k > .6 && ((T * 22) | 0) % 2 ? 1 : .55;
    blit(spr.hot, (.14 + .42 * k) * strobe * alpha);
  }
  if (r.flash > 0) blit(spr.white, Math.min(1, r.flash / .13) * .9);
  c.globalAlpha = 1;
  const tx = ox + spr.tip[0], ty = top + spr.tip[1];
  if (wind && k > .5 && vis === h) star(c, tx, ty, k > .8 ? 2 : 1, '255,230,200', .5 + k * .5);
  if (m.type === 'cultist' && vis === h) flame(tx + .5, ty + 1, wind ? 1.3 + k : 1, m.id, wind ? FLAME_VIOLET : FLAME_WARM);
  if (m.type === 'imp' && wind) { const s = PSPR.fire, sc = .4 + k * .8; c.drawImage(s, Math.round(tx - s.width * sc / 2), Math.round(ty - s.height * sc / 2), Math.round(s.width * sc), Math.round(s.height * sc)); }
  if (m.burnT > 0) {
    flame(x - 2, yy - 3, 1.3, m.id, FLAME_CRIMSON); flame(x + 2, yy - h * .4, 1.1, m.id + 2, FLAME_CRIMSON);
    if (Math.random() < .25) part(m.x + (Math.random() - .5) * 8, m.y - h * .5, 0, -18, .5, '255,80,40', { add: true });
  }
  const lv = Math.max(1, Math.min(5, m.level | 0));
  for (const e of spr.eyes) if (e[1] < vis) eyeList.push(ox + e[0], top + e[1], lv - 1);
  if (r.acc >= 1 && (r.accT > .3 || r.acc >= 5)) { numAt(m.x, m.y - h + 2, r.acc, r.acc >= 30 ? 'big' : 'deal'); r.acc = 0; r.accT = 0; }
  if (m.hp < m.maxHp) hpBar(c, x, top - 3, 12, m.hp / m.maxHp);
}
function bossPose(B) {
  if (vict) return 'idle';
  if (B.state === 'nova') return 'nova';
  if (!B.awake) return 'idle';
  if (B.phase >= 2 && B.ringT < .5) return 'ring';
  if (B.boltT < .45) return 'fan';
  if (B.phase >= 2 && B.summonT < .7) return 'summon';
  return 'idle';
}
function drawBoss(c, B, x, y, T) {
  if (bossR.hp === null) bossR.hp = B.hp;
  const dh = bossR.hp - B.hp;
  if (dh >= 2) { bossR.flash = .12; bloodMotes(B.x, B.y - 20, dh); }
  if (dh > .01) bossR.acc += dh;
  if (dh < -50) bossR.acc = 0; // reset to full
  bossR.hp = B.hp; bossR.flash = Math.max(0, bossR.flash - frameDt); bossR.accT += frameDt;
  if (bossR.acc >= 1 && (bossR.accT > .3 || bossR.acc >= 5)) { numAt(B.x, B.y - 60, bossR.acc, bossR.acc >= 30 ? 'big' : 'deal'); bossR.acc = 0; bossR.accT = 0; }
  if (bossR.x !== null && Math.hypot(B.x - bossR.x, B.y - bossR.y) > 30) for (let i = 0; i < 30; i++) part(bossR.x + (Math.random() - .5) * 18, bossR.y - Math.random() * 44, (Math.random() - .5) * 20, -6 - Math.random() * 10, .9 + Math.random() * .5, Math.random() < .7 ? '40,30,50' : '150,80,220', { drag: 1 });
  bossR.x = B.x; bossR.y = B.y;
  const pose = bossPose(B);
  const fi = ((T * 1.5) | 0) % 2;
  const spr = BSPR[pose][fi][pose === 'fan' && curHero.x < B.x ? 1 : 0];
  const hover = B.awake ? 5 + Math.sin(T * 1.6) * 2 : 12 + Math.sin(T * .8) * 1.5;
  const w = spr.width, h = spr.height;
  let alpha = B.awake ? 1 : .55, vis = h;
  if (vict) { const kd = Math.min(1, vict.t / 2.6); vis = Math.round(h * (1 - kd)); if (vis > 0) ashBurst(B.x, B.y - hover - (h - vis) + 4, 26, 4, 3, '200,120,255'); }
  c.fillStyle = `rgba(0,0,0,${.5 * alpha})`; c.beginPath(); c.ellipse(x, y, 13 - hover * .2, 3.5, 0, 0, Math.PI * 2); c.fill();
  if (vis <= 0) return;
  const ox = Math.round(x - w / 2), oy = Math.round(y - h + 2 - hover);
  const blit = (img, a) => { if (a <= 0) return; c.globalAlpha = Math.min(1, a); c.drawImage(img, 0, 0, w, vis, ox, oy, w, vis); };
  const crownY = oy + 9, crownOn = !vict || vict.t < .4;
  const spikes = front => {
    for (let i = 0; i < 9; i++) {
      const a = T * .7 + i / 9 * Math.PI * 2, sn = Math.sin(a);
      if ((sn > 0) !== front) continue;
      const px = Math.round(x + Math.cos(a) * 9), py = Math.round(crownY + sn * 2.5);
      c.fillStyle = front ? '#a69c92' : '#5a524c'; c.fillRect(px, py - 1, 1, 4);
      c.fillStyle = front ? '#ff6a2a' : '#8a3010'; c.fillRect(px, py + 3, 1, 1);
    }
  };
  if (crownOn) { c.globalAlpha = alpha; spikes(false); }
  blit(spr, alpha);
  if (B.state === 'nova' && B.windDur) { const k = 1 - B.stateT / B.windDur; blit(spr.hot, (.2 + .5 * k) * (((T * 20) | 0) % 2 ? 1 : .6)); }
  if (bossR.flash > 0) blit(spr.white, bossR.flash / .12);
  c.globalAlpha = alpha;
  if (crownOn) { spikes(true); c.strokeStyle = 'rgba(150,140,130,.6)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, crownY + 1, 9, 2.5, 0, 0, Math.PI * 2); c.stroke(); }
  c.globalAlpha = 1;
  for (let i = 0; i < 7; i++) {
    const a = T * (.8 + i * .07) + i * 1.7, rr = 12 + (i % 3) * 4;
    c.fillStyle = i % 3 ? 'rgba(140,132,124,.7)' : 'rgba(255,110,50,.8)';
    c.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(oy + 26 + Math.sin(a) * rr * .35 + Math.sin(T * 2 + i) * 3), 1, 1);
  }
  const tx = ox + spr.tip[0], ty = oy + spr.tip[1];
  if (B.awake && !vict) {
    if (pose === 'nova') { const k = 1 - B.stateT / (B.windDur || 1), s = PSPR.boss, sc = .6 + k * 1.4; c.drawImage(s, Math.round(tx - s.width * sc / 2), Math.round(ty - s.height * sc / 2), Math.round(s.width * sc), Math.round(s.height * sc)); }
    else if (pose === 'fan' || pose === 'ring') { const s = PSPR.boss; c.drawImage(s, Math.round(tx - s.width / 2), Math.round(ty - s.height / 2)); }
    else if (pose === 'summon' && Math.random() < .6) part(B.x + (Math.random() - .5) * 60, B.y + (Math.random() - .5) * 20, 0, -12, .6, '140,60,220', { add: true });
    for (const e of spr.eyes) eyeList.push(ox + e[0], oy + e[1], 5);
    if (B.nearT > curCfg.boss.teleTime - .6) for (let i = 0; i < 2; i++) part(B.x + (Math.random() - .5) * 24, B.y - Math.random() * 40, 0, -6, .5, '30,22,40', {});
  }
}
function drawProjectile(c, p, x, y, T) {
  const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
  const boss = p.src === 'boss', fire = p.src === 'imp';
  const tc = fire ? '255,110,30' : boss ? '170,80,255' : '140,50,200';
  for (let i = 1; i <= 5; i++) { c.fillStyle = `rgba(${tc},${.55 - i * .1})`; c.fillRect(Math.round(x - ux * i * 2.2), Math.round(y - uy * i * 2.2), i < 3 ? 2 : 1, i < 3 ? 2 : 1); }
  const s = fire ? PSPR.fire : boss ? PSPR.boss : PSPR.bolt;
  c.drawImage(s, Math.round(x - s.width / 2), Math.round(y - s.height / 2));
  if (Math.random() < .25) part(p.x, p.y, (Math.random() - .5) * 6, -6, .4, fire ? '255,140,50' : '160,80,255', { add: true });
}
const SIGN_GLINT = { ribbon: '170,200,255', circle: '255,200,150', crows: '230,220,210', blood: '255,120,100' };
function signDir(s) {
  if (s.dirVec) return s.dirVec;
  const dx = world.lair.x - s.x, dy = world.lair.y - s.y, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}
function drawSign(c, s, x, y, T) {
  const found = !!(curS && curS.discovered[s.id]);
  const dv = signDir(s), ux = dv.x, uy = dv.y;
  c.globalAlpha = found ? .5 : 1;
  const ph = Math.abs(s.x * 7 + s.y * 13) % 6.28;
  if (s.kind === 'ribbon') {
    const b = SIGN.bush[Math.abs(s.x | 0) % 2];
    c.drawImage(b, Math.round(x - b.width / 2), Math.round(y - b.height + 2));
    // the strip streams from a thorn toward the lair, fluttering
    const kx = Math.round(x + 1), ky = Math.round(y - 8);
    c.fillStyle = '#1d3f8a'; c.fillRect(kx - 1, ky - 1, 3, 2);
    for (let i = 1; i <= 11; i++) {
      const wv = Math.sin(T * 7 + i * .9 + ph) * (i * .17), bx2 = kx + ux * i * 1.3 - uy * wv, by2 = ky + uy * i * 1.3 + ux * wv;
      c.fillStyle = '#2f58b8'; c.fillRect(Math.round(bx2 - uy), Math.round(by2 + ux * .5 + 1), 1, 1);
      c.fillStyle = i % 3 === 0 ? '#a8c4ff' : '#5a88e8'; c.fillRect(Math.round(bx2), Math.round(by2), 1, 2);
    }
  } else if (s.kind === 'circle') {
    c.drawImage(SIGN.circle, Math.round(x - 15), Math.round(y - 15));
    // the sigils: a burnt arrow-rune across the circle, pointing at the lair
    c.fillStyle = found ? '#4a1e12' : '#8a3a1a';
    for (let i = -8; i <= 9; i++) c.fillRect(Math.round(x + ux * i), Math.round(y + uy * i), 1, 1);
    const tx = x + ux * 11, ty = y + uy * 11, px = -uy, py = ux;
    c.fillStyle = found ? '#5a2414' : '#c8501e';
    c.fillRect(Math.round(tx), Math.round(ty), 1, 1);
    for (let i = 1; i <= 5; i++) { c.fillRect(Math.round(tx - ux * i + px * i * .75), Math.round(ty - uy * i + py * i * .75), 1, 1); c.fillRect(Math.round(tx - ux * i - px * i * .75), Math.round(ty - uy * i - py * i * .75), 1, 1); }
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + .4, cx2 = Math.round(x + Math.cos(a) * 12), cy2 = Math.round(y + Math.sin(a) * 12);
      c.fillStyle = '#c8bfa6'; c.fillRect(cx2, cy2 - 2 - (k % 2), 1, 2 + (k % 2)); c.fillStyle = '#16100c'; c.fillRect(cx2, cy2 - 3 - (k % 2), 1, 1);
      if (!found && k % 3 === 0) { const e = .5 + .5 * Math.sin(T * 5 + k); c.fillStyle = `rgba(255,${120 + e * 80 | 0},40,${.5 + e * .5})`; c.fillRect(cx2, cy2 - 3 - (k % 2), 1, 1); if (Math.random() < .02) part(s.x + Math.cos(a) * 12, s.y + Math.sin(a) * 12 - 4, 0, -8, 1.2, '90,86,84', {}); }
    }
  } else if (s.kind === 'crows') {
    // two crows nailed to the crossbar; a third is nailed to the ground, wings spread and beak toward the lair,
    // at the end of a trail of black feathers and blood
    c.fillStyle = '#2a1a10';
    for (let i = 3; i <= 13; i += 2) { c.fillRect(Math.round(x + ux * i), Math.round(y + uy * i), 1, 1); }
    c.fillStyle = '#5a0808';
    for (let i = 4; i <= 13; i += 3) c.fillRect(Math.round(x + ux * i - uy), Math.round(y + uy * i + ux), 1, 1);
    drawCrow(c, x + ux * 17, y + uy * 17, ux, uy, 1);
    c.drawImage(SIGN.post, Math.round(x - 4), Math.round(y - 28));
    c.fillStyle = '#33231a'; c.fillRect(Math.round(x - 9), Math.round(y - 22), 18, 2); c.fillStyle = '#4a3424'; c.fillRect(Math.round(x - 9), Math.round(y - 22), 18, 1);
    drawCrowFront(c, Math.round(x - 6), Math.round(y - 21)); drawCrowFront(c, Math.round(x + 6), Math.round(y - 21));
  } else {
    // blood sigil with a smear dragged toward the lair
    c.drawImage(SIGN.blood, Math.round(x - 13), Math.round(y - 13));
    c.fillStyle = '#700808';
    for (let i = 4; i <= 22; i++) { const wd = i < 14 ? 2 : 1; c.fillRect(Math.round(x + ux * i - (wd > 1 ? .5 : 0)), Math.round(y + uy * i - (wd > 1 ? .5 : 0)), wd, wd); }
    if (!found) postAdd.push(s, x, y, ux, uy, ph);
  }
  c.globalAlpha = 1;
  if (!found) glintList.push(x, s.kind === 'circle' || s.kind === 'blood' ? y : y - (s.kind === 'crows' ? 24 : 9), ph, SIGN_GLINT[s.kind]);
}
function drawHeroOverlay(c, hero, x, y, S, T) {
  if (hero.wrathT > 0 && S.phase === 'play') {
    for (let i = 0; i < 2; i++) if (Math.random() < .6) part(hero.x + (Math.random() - .5) * 16, hero.y - Math.random() * 24, (Math.random() - .5) * 6, -16 - Math.random() * 14, .5, Math.random() < .5 ? '255,40,20' : '60,0,8', { add: Math.random() < .5 });
  }
}
function drawFx(c, f, x, y) {
  const k = f.t / f.dur, H = curHero, wr = H && H.wrathT > 0;
  const first = !seenFx.has(f); if (first) seenFx.add(f);
  if (f.type === 'swing') {
    const col = wr ? '255,50,30' : H && H.rung >= 3 ? '255,130,100' : '255,240,220';
    const a0 = f.a - 1.05, sw = 2.1 * Math.min(1, k * 1.7 + .15), R0 = 17 * (wr ? 1.25 : 1);
    c.lineWidth = 3; c.strokeStyle = `rgba(${col},${.3 * (1 - k)})`; c.beginPath(); c.arc(x, y - 6, R0 - 1, a0, a0 + sw); c.stroke();
    c.lineWidth = 1; c.strokeStyle = `rgba(${col},${.95 * (1 - k)})`; c.beginPath(); c.arc(x, y - 6, R0 + 1, a0 + sw * .3, a0 + sw); c.stroke();
    c.strokeStyle = `rgba(${col},${.45 * (1 - k)})`; c.beginPath(); c.arc(x, y - 6, R0 - 4, a0 + sw * .5, a0 + sw); c.stroke();
    const ta = a0 + sw; c.fillStyle = `rgba(255,255,255,${1 - k})`; c.fillRect(Math.round(x + Math.cos(ta) * (R0 + 1)) - 1, Math.round(y - 6 + Math.sin(ta) * (R0 + 1)) - 1, 2, 2);
  } else if (f.type === 'nova') {
    if (first) { decals.push({ x: f.x, y: f.y, r: f.r, life: 2.5, max: 2.5, kind: 'scorch' }); shake = Math.max(shake, 2); for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, sp = 40 + Math.random() * 60; part(f.x + Math.cos(a) * 6, f.y - 4 + Math.sin(a) * 4, Math.cos(a) * sp, Math.sin(a) * sp * .7 - 10, .6 + Math.random() * .4, Math.random() < .5 ? '255,60,30' : '255,160,60', { add: true, drag: 2.5 }); } }
    const e = 1 - Math.pow(1 - k, 3), r = f.r * e;
    c.lineWidth = 3; c.strokeStyle = `rgba(200,20,20,${(1 - k) * .8})`; c.beginPath(); c.arc(x, y - 3, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.strokeStyle = `rgba(255,200,140,${1 - k})`; c.beginPath(); c.arc(x, y - 3, r, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + k; flame(x + Math.cos(a) * r, y - 2 + Math.sin(a) * r, 1.8 * (1 - k) + .3, i, FLAME_CRIMSON); }
  } else if (f.type === 'bossnova') {
    if (first) { decals.push({ x: f.x, y: f.y, r: f.r, life: 2, max: 2, kind: 'void' }); shake = Math.max(shake, 3); for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28; part(f.x + Math.cos(a) * 10, f.y + Math.sin(a) * 6, Math.cos(a) * 70, Math.sin(a) * 50, .5, '180,80,255', { add: true, drag: 3 }); } }
    const r = f.r * (.4 + k * .6);
    c.lineWidth = 4; c.strokeStyle = `rgba(90,20,140,${(1 - k) * .7})`; c.beginPath(); c.arc(x, y - 3, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.strokeStyle = `rgba(240,200,255,${1 - k})`; c.beginPath(); c.arc(x, y - 3, r, 0, Math.PI * 2); c.stroke();
  } else if (f.type === 'dash') {
    const len = 70 * Math.min(1, k * 3);
    c.lineCap = 'round';
    c.lineWidth = 5; c.strokeStyle = `rgba(30,8,40,${.45 * (1 - k)})`; c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + Math.cos(f.a) * len, y - 7 + Math.sin(f.a) * len); c.stroke();
    c.lineWidth = 1; c.strokeStyle = `rgba(160,90,220,${.6 * (1 - k)})`; c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + Math.cos(f.a) * len, y - 7 + Math.sin(f.a) * len); c.stroke();
    c.lineCap = 'butt';
  } else if (f.type === 'wrath') {
    if (first) { shake = Math.max(shake, 3); for (let i = 0; i < 50; i++) { const a = Math.random() * 6.28; part(f.x, f.y - 10, Math.cos(a) * 80, Math.sin(a) * 60, .7, i % 2 ? '255,30,20' : '40,0,6', { add: i % 2 === 1, drag: 2.5 }); } }
    c.lineWidth = 3; c.strokeStyle = `rgba(255,30,20,${1 - k})`; c.beginPath(); c.arc(x, y - 10, 10 + k * 50, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.strokeStyle = `rgba(20,0,0,${1 - k})`; c.beginPath(); c.arc(x, y - 10, 6 + k * 40, 0, Math.PI * 2); c.stroke();
  } else if (f.type === 'tele') {
    if (first) for (let i = 0; i < 30; i++) part(f.x + (Math.random() - .5) * 20, f.y - Math.random() * 44, (Math.random() - .5) * 20, -8 - Math.random() * 10, .9, Math.random() < .6 ? '40,30,50' : '170,90,255', { drag: 1 });
    c.fillStyle = `rgba(200,120,255,${(1 - k) * .5})`; c.beginPath(); c.ellipse(x, y, 16 * (1 - k) + 2, 5 * (1 - k) + 1, 0, 0, Math.PI * 2); c.fill();
  }
}

// ================================================================ the hero, drawn into a small canvas each frame
function heroLook(H) {
  const r = H.rung;
  return {
    cloak: r >= 5 ? '#170f18' : r >= 3 ? '#221a29' : '#2b2333', edge: r >= 4 ? '#30263c' : '#463950', scarf: r >= 3 ? '#701414' : '#5a1e1e',
    eye: r >= 1 ? '#ff2a2a' : '#ffcf7a', skin: r >= 4 ? '#8e8a86' : '#b08868', tatter: r >= 2, horns: r >= 5 ? 2 : r >= 4 ? 1 : 0,
    wings: r >= 5, veins: r >= 5, flame: r >= 3 ? FLAME_CRIMSON : FLAME_WARM,
  };
}
function drawWings(g, x, top, spread, T) {
  const WC = '#120912', WE = '#4a1828';
  if (!spread) {
    const fl = Math.round(Math.sin(T * 2) * .6);
    for (const s of [-1, 1]) {
      const b = s < 0 ? x - 7 : x + 5;
      g.fillStyle = WC; g.fillRect(b, top - 16 + fl, 2, 10); g.fillRect(s < 0 ? x - 8 : x + 7, top - 19 + fl, 1, 8);
      g.fillStyle = WE; g.fillRect(s < 0 ? x - 8 : x + 7, top - 19 + fl, 1, 1); g.fillRect(b + (s < 0 ? 0 : 1), top - 7 + fl, 1, 1);
    }
    return;
  }
  const fl = Math.round(Math.sin(T * 7) * 2.5);
  for (const s of [-1, 1]) {
    g.fillStyle = WC;
    poly(g, [x + s * 2, top - 14, x + s * 17, top - 23 + fl, x + s * 15, top - 13 + fl, x + s * 12, top - 15 + fl, x + s * 11, top - 8 + fl, x + s * 8, top - 11 + fl, x + s * 5, top - 5]);
    g.strokeStyle = WE; g.lineWidth = 1; g.beginPath();
    g.moveTo(x + s * 3, top - 14); g.lineTo(x + s * 17, top - 23 + fl); g.moveTo(x + s * 9, top - 18 + fl * .5); g.lineTo(x + s * 12, top - 15 + fl); g.moveTo(x + s * 6, top - 16); g.lineTo(x + s * 8, top - 11 + fl);
    g.stroke();
  }
}
function drawHero(g, x, y, H, T, L, wrath) {
  const face = H.face, side = face === 2 ? -1 : 1;
  const step = H.moving ? Math.sin(H.walk) : 0;
  const bob = H.moving ? Math.round(Math.abs(step)) : 0;
  const top = y - bob;
  const P = (a, b, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(a), Math.round(b), w, h); };
  if (L.wings) drawWings(g, x, top, wrath, T);
  const torch = () => {
    P(x + side * 4 - (side < 0 ? 1 : 0), top - 12, 2, 4, L.cloak);
    P(x + side * 5, top - 9, 1, 1, L.skin);
    P(x + side * 6, top - 15, 1, 7, '#5a3a22'); P(x + side * 6, top - 16, 2, 2, '#2a1a10');
    flame(x + side * 6 + .5, top - 15, wrath ? 2.2 : 1.7, 1.3, L.flame, g);
  };
  if (face === 1) torch();
  P(x - 3, y - 4 - (step > 0 ? 1 : 0), 2, 4, '#100c10'); P(x + 1, y - 4 - (step < 0 ? 1 : 0), 2, 4, '#100c10');
  if (face !== 1) { P(x - side * 3, top - 19, 1, 4, '#6d6c78'); P(x - side * 3 - 1, top - 16, 3, 1, '#3a2a1a'); }
  g.fillStyle = L.cloak; poly(g, [x - 3, top - 13, x + 3, top - 13, x + 5, y - 3, x + 3, y - 2, x, y - 3, x - 3, y - 2, x - 5, y - 3]);
  P(side > 0 ? x + 3 : x - 4, top - 12, 1, 8, L.edge);
  if (L.tatter) {
    g.clearRect(x - 4, y - 3, 1, 1); g.clearRect(x, y - 3, 1, 1); g.clearRect(x + 4, y - 4, 1, 1);
    const sw = H.moving ? Math.round(Math.sin(H.walk * .5 + 1)) : 0;
    P(x - 5 - sw, y - 3, 1, 2, L.cloak); P(x + 4 - sw, y - 3, 1, 2, L.cloak); P(x - 2 - sw, y - 2, 1, 2, L.cloak); P(x + 2, y - 5, 1, 1, L.edge); P(x - 4, y - 6, 1, 1, L.edge);
  }
  P(x - 3, top - 12, 6, 1, L.scarf);
  g.fillStyle = L.cloak; g.beginPath(); g.arc(x, top - 15, 4, 0, Math.PI * 2); g.fill();
  P(x - 1, top - 20, 2, 2, L.cloak);
  if (L.horns === 1) { P(x - 3, top - 20, 1, 2, '#a89c88'); P(x + 2, top - 20, 1, 2, '#a89c88'); P(x - 3, top - 21, 1, 1, '#d8cfbe'); P(x + 2, top - 21, 1, 1, '#d8cfbe'); }
  else if (L.horns === 2) {
    for (const [dx, dy, c] of [[-4, -18, '#6e6252'], [-4, -19, '#8a7e6c'], [-5, -20, '#8a7e6c'], [-5, -21, '#a89c88'], [-5, -22, '#c8bfae'], [-4, -23, '#e4dccc']]) { P(x + dx, top + dy, 1, 1, c); P(x - dx - 1, top + dy, 1, 1, c); }
  }
  if (face === 0) {
    g.fillStyle = '#07050a'; g.beginPath(); g.ellipse(x, top - 14.5, 2.6, 2.2, 0, 0, Math.PI * 2); g.fill();
    if (H.rung >= 4) P(x - 1, top - 13, 2, 1, L.skin);
    P(x - 2, top - 15, 1, 1, L.eye); P(x + 1, top - 15, 1, 1, L.eye);
  } else if (face === 2 || face === 3) {
    g.fillStyle = '#07050a'; g.beginPath(); g.ellipse(x + side * 2, top - 14.5, 1.8, 2, 0, 0, Math.PI * 2); g.fill();
    if (H.rung >= 4) P(x + side * 2 + (side > 0 ? 0 : -1), top - 13, 1, 1, L.skin);
    P(x + side * 2 + (side > 0 ? 0 : -1), top - 15, 1, 1, L.eye);
  } else {
    P(x - 1, top - 17, 2, 5, H.rung >= 3 ? '#2a2034' : '#3a2f42');
    P(x - 3, top - 19, 1, 6, '#6d6c78');
  }
  if (L.veins) {
    const a = .45 + .4 * Math.sin(T * 3.1);
    g.fillStyle = `rgba(255,50,30,${a})`;
    if (face !== 1) { g.fillRect(x - 2, top - 10, 1, 1); g.fillRect(x - 1, top - 9, 1, 2); g.fillRect(x, top - 7, 1, 1); g.fillRect(x + 1, top - 6, 1, 2); g.fillRect(x + side * 5, top - 9, 1, 1); }
    else { g.fillRect(x - 1, top - 11, 1, 3); g.fillRect(x, top - 8, 1, 2); g.fillRect(x + 1, top - 6, 1, 1); }
  }
  if (face !== 1) torch();
  return [x + side * 6.5, top - 17];
}
const HAX = 32, HAY = 56;
function snapshot(src, col) {
  const c = trailPool.length ? trailPool.pop() : canvas(64, 64), g = c.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, 64, 64); g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = col; g.fillRect(0, 0, 64, 64); g.globalCompositeOperation = 'source-over';
  return c;
}

// ================================================================ frame
const TORCH_COL = [[255, 150, 70], [255, 135, 62], [255, 118, 58], [255, 62, 42], [240, 44, 38], [222, 28, 32]];
function makeFall(H) {
  const cracks = [];
  for (let i = 0; i < 11; i++) {
    let a = i / 11 * Math.PI * 2 + Math.random() * .4, x = 0, y = 0;
    const len = 34 + Math.random() * 70, n = 8, pts = [[0, 0]];
    for (let k = 0; k < n; k++) { a += (Math.random() - .5) * .7; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y]); }
    cracks.push(pts);
  }
  const hands = [];
  for (let i = 0; i < 7; i++) hands.push({ a: i / 7 * Math.PI * 2 + Math.random() * .5, d: Math.random() * .4, h: 7 + Math.random() * 5 });
  return { x: H.x, y: H.y, t: 0, cracks, hands };
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function strokeCrack(c, pts, k, ox, oy) {
  const n = pts.length - 1, upto = k * n;
  c.beginPath(); c.moveTo(ox, oy);
  for (let i = 1; i <= n; i++) {
    if (i <= upto) c.lineTo(ox + pts[i][0], oy + pts[i][1]);
    else { const f = upto - (i - 1); if (f > 0) c.lineTo(ox + pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, oy + pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f); break; }
  }
  c.stroke();
}
function drawTelegraphs(S, cfg, CX, CY) {
  const slack = cfg.strikeSlack || 6;
  for (const m of S.monsters) {
    if (m.state !== 'windup' || !m.windDur) continue;
    const x = m.x - CX, y = m.y - CY;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    const mc = cfg.monsters[m.type] || {}, k = clamp01(1 - m.stateT / m.windDur);
    if (mc.ranged) {
      const dx = S.hero.x - m.x, dy = S.hero.y - m.y, d = Math.hypot(dx, dy) || 1;
      ctx.fillStyle = m.type === 'imp' ? `rgba(255,120,40,${.15 + .4 * k})` : `rgba(190,90,255,${.15 + .4 * k})`;
      for (let i = 8; i < Math.min(d, 140) * k; i += 4) ctx.fillRect(Math.round(x + dx / d * i), Math.round(y - 6 + dy / d * i), 1, 1);
    } else {
      const R = (mc.reach || 14) + slack;
      ctx.strokeStyle = `rgba(255,60,30,${.22 + .4 * k})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,40,20,${.08 + .16 * k})`; ctx.beginPath(); ctx.arc(x, y, R * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  const B = S.boss;
  if (!B.awake || vict || S.phase !== 'play') return;
  const x = B.x - CX, y = B.y - CY, bc = cfg.boss;
  if (B.state === 'nova' && B.windDur) {
    const k = clamp01(1 - B.stateT / B.windDur);
    ctx.strokeStyle = `rgba(220,80,255,${.35 + .5 * k})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, bc.novaR, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(160,30,200,${.1 + .2 * k})`; ctx.beginPath(); ctx.arc(x, y, bc.novaR * k, 0, Math.PI * 2); ctx.fill();
  } else if (B.boltT < .45) {
    const k = 1 - B.boltT / .45, ang = Math.atan2(S.hero.y - B.y, S.hero.x - B.x), sp = bc.boltSpreadDeg * Math.PI / 180, n = bc.boltCount;
    ctx.fillStyle = `rgba(200,120,255,${.12 + .35 * k})`;
    for (let j = 0; j < n; j++) { const a = ang - sp / 2 + sp * (n > 1 ? j / (n - 1) : .5); for (let i = 14; i < 70; i += 4) ctx.fillRect(Math.round(x + Math.cos(a) * i), Math.round(y - 10 + Math.sin(a) * i), 1, 1); }
  }
  if (B.phase >= 2 && B.ringT < .5 && B.state !== 'nova') {
    const k = 1 - B.ringT / .5;
    ctx.fillStyle = `rgba(200,120,255,${.2 + .5 * k})`;
    for (let j = 0; j < bc.ringCount; j++) { const a = j / bc.ringCount * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * (16 + k * 10)), Math.round(y - 10 + Math.sin(a) * (16 + k * 10)), 2, 2); }
  }
}
function drawHeroEntity(px, py, S, cfg, CX, CY) {
  const Hh = S.hero, L = heroLook(Hh), alive = S.phase !== 'dead';
  hctx.clearRect(0, 0, 64, 64);
  const tp = drawHero(hctx, HAX, HAY, Hh, t, L, Hh.wrathT > 0 && alive);
  if (hurtT > 0 && alive) { hctx.globalCompositeOperation = 'source-atop'; hctx.fillStyle = `rgba(255,${hurtT > .25 ? 255 : 60},${hurtT > .25 ? 255 : 40},${Math.min(.85, hurtT * 3)})`; hctx.fillRect(0, 0, 64, 64); hctx.globalCompositeOperation = 'source-over'; }
  const sc = 1 + (((cfg.wrath && cfg.wrath.scale) || 1.3) - 1) * wrathK;
  if (Hh.dashT > 0 && S.phase === 'play') afterimgs.push({ c: snapshot(heroCv, 'rgba(34,8,52,.92)'), x: Hh.x, y: Hh.y, life: .32, max: .32, sc });
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(px, py, 6 * sc, 2.2 * sc, 0, 0, Math.PI * 2); ctx.fill();
  for (const a of afterimgs) {
    ctx.globalAlpha = .55 * a.life / a.max;
    const ax = Math.round(a.x - CX), ay = Math.round(a.y - CY);
    ctx.drawImage(a.c, ax - HAX * a.sc, ay - HAY * a.sc, 64 * a.sc, 64 * a.sc);
  }
  ctx.globalAlpha = 1;
  let torch = [px + (tp[0] - HAX) * sc, py + (tp[1] - HAY) * sc];
  ctx.save();
  ctx.translate(px, py);
  if (S.phase === 'dead') {
    const side = Hh.face === 2 ? -1 : 1, k = Math.min(1, deadT * 3.2);
    ctx.rotate(k * k * Math.PI / 2 * side); ctx.globalAlpha = 1 - Math.max(0, deadT - 1.6) * .5;
    torch = [px + side * 11, py - 1];
  }
  if (spawnT > 0) ctx.globalAlpha = 1 - spawnT;
  if (fall) {
    const sink = Math.pow(clamp01((fall.t - 1.2) / 2.2), 1.6) * 40;
    ctx.beginPath(); ctx.rect(-40, -80, 80, 81); ctx.clip();
    ctx.translate(Math.sin(fall.t * 30) * clamp01(fall.t - 1) * .8, sink);
    torch = [torch[0], torch[1] + sink];
  }
  if (sc !== 1) ctx.scale(sc, sc);
  if (wrathK > .05 && alive) {
    htctx.globalCompositeOperation = 'source-over'; htctx.clearRect(0, 0, 64, 64); htctx.drawImage(heroCv, 0, 0);
    htctx.globalCompositeOperation = 'source-in'; htctx.fillStyle = '#ff2010'; htctx.fillRect(0, 0, 64, 64);
    ctx.globalAlpha = (.3 + .2 * Math.sin(t * 12)) * wrathK;
    ctx.drawImage(heroTint, -HAX - 1, -HAY); ctx.drawImage(heroTint, -HAX + 1, -HAY); ctx.drawImage(heroTint, -HAX, -HAY - 1); ctx.drawImage(heroTint, -HAX, -HAY + 1);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(heroCv, -HAX, -HAY);
  ctx.restore();
  if (fall && fall.t > 1) {
    // hands of the Pale Below close over him
    const k = clamp01((fall.t - 1) / .7);
    ctx.fillStyle = '#040203';
    for (const h of fall.hands) {
      const r = 10 + h.d * 6, hx = px + Math.cos(h.a) * r, hy = py + Math.sin(h.a) * r * .45;
      const hh = h.h * k * (1 - clamp01((fall.t - 3.2) / .8));
      for (let f = -1; f <= 1; f++) { ctx.fillRect(Math.round(hx + f * 2 - Math.cos(h.a) * hh * .25), Math.round(hy - hh + Math.abs(f)), 1, Math.max(0, Math.round(hh - Math.abs(f)))); }
      ctx.fillRect(Math.round(hx - 2), Math.round(hy - 2), 5, 3);
    }
  }
  return torch;
}
function draw(game, dt, ui) {
  ui = ui || {};
  const S = game.state, hero = S.hero, cfg = game.config;
  if (game !== curGame || world !== game.world) setGame(game);
  dt = Math.max(0, dt || 0);
  curCfg = cfg; curS = S; curHero = hero; frameDt = dt;
  frameNo++; t += dt;
  hurtT = Math.max(0, hurtT - dt); lvlT = Math.max(0, lvlT - dt); rungT = Math.max(0, rungT - dt); spawnT = Math.max(0, spawnT - dt * 1.4);
  if (S.phase === 'dead') deadT += dt; else deadT = 0;
  if (S.phase === 'damned') { if (!fall) fall = makeFall(hero); fall.t += dt; }
  if (S.phase === 'won') { if (!vict) { vict = { t: 0 }; shake = 4; } vict.t += dt; }
  wrathK += ((hero.wrathT > 0 && S.phase !== 'dead' ? 1 : 0) - wrathK) * Math.min(1, dt * 8);
  shake = Math.max(0, shake - dt * 6);
  // healing sources: rest and fire give a warm glow scaled by restHealMult
  if (lastHeroHp !== null && S.phase === 'play') {
    const dhp = hero.hp - lastHeroHp, rm = Array.isArray(cfg.restHealMult) ? cfg.restHealMult[hero.rung] : 1;
    const resting = dhp > 0 && hero.sinceCombat > .6 && lvlT <= 0 && spawnT <= 0 && hero.hp < hero.maxHp;
    restGlow += ((resting ? rm : 0) - restGlow) * Math.min(1, dt * 3);
    if (resting && Math.random() < .25 + rm * .6) part(hero.x + (Math.random() - .5) * 14, hero.y - Math.random() * 6, (Math.random() - .5) * 4, -10 - Math.random() * 12, .9, rm > .4 ? '255,190,110' : '200,150,110', { add: true });
  } else restGlow = Math.max(0, restGlow - dt);
  lastHeroHp = hero.hp;

  camX += (hero.x - W / 2 - camX) * Math.min(1, dt * 7);
  camY += (hero.y - 8 - H / 2 - camY) * Math.min(1, dt * 7);
  const sh = shake + (fall && fall.t < 3.4 ? Math.min(2, fall.t * 1.2) : 0);
  const CX = Math.round(camX + (sh ? (Math.random() - .5) * sh * 2 : 0)), CY = Math.round(camY + (sh ? (Math.random() - .5) * sh * 2 : 0));
  lastCX = Math.round(camX); lastCY = Math.round(camY);

  // particles
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life -= dt;
    if (s.life <= 0) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt + Math.sin(t * 6 + s.ph) * .15; s.y += s.vy * dt; s.vy -= 6 * dt;
  }
  {
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) continue;
      if (p.home) {
        const dx = hero.x - p.x, dy = hero.y - 10 - p.y, d = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, dt * (3 + (p.max - p.life) * 8));
        p.vx += (dx / d * 160 - p.vx) * pull; p.vy += (dy / d * 160 - p.vy) * pull;
        if (d < 5) continue;
      } else if (p.drag) { const f = 1 / (1 + p.drag * dt); p.vx *= f; p.vy *= f; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      parts[w++] = p;
    }
    parts.length = w;
  }
  for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].a += dt; if (ripples[i].a > 1) ripples.splice(i, 1); }
  if (hero.inWater && hero.moving) { draw.rt = (draw.rt || 0) - dt; if (draw.rt <= 0) { draw.rt = .28; ripples.push({ x: hero.x, y: hero.y, a: 0 }); } }
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
  for (let i = afterimgs.length - 1; i >= 0; i--) { const a = afterimgs[i]; a.life -= dt; if (a.life <= 0) { trailPool.push(a.c); afterimgs.splice(i, 1); } }
  for (let i = decals.length - 1; i >= 0; i--) { decals[i].life -= dt; if (decals[i].life <= 0) decals.splice(i, 1); }
  for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; n.life -= dt; n.y -= 18 * dt; if (n.life <= 0) nums.splice(i, 1); }
  if (frameNo % 60 === 0) for (const [id, r] of RS) if (t - r.seen > 3) RS.delete(id);
  // projectile impacts: a projectile that vanished before its time ran out hit something
  {
    const now = new Map();
    for (const p of S.projectiles) now.set(p, p.ttl);
    for (const [p, v] of projPrev) if (!now.has(p) && v[3] > .06) {
      const col = v[2] === 'imp' ? '255,140,50' : '180,90,255';
      for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28; part(v[0], v[1], Math.cos(a) * 30, Math.sin(a) * 22 - 8, .35, col, { add: true, drag: 3 }); }
      decals.push({ x: v[0], y: v[1], r: 5, life: .25, max: .25, kind: v[2] === 'imp' ? 'puffF' : 'puffV' });
    }
    projPrev.clear();
    for (const p of S.projectiles) projPrev.set(p, [p.x, p.y, p.src, p.ttl]);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#050407'; ctx.fillRect(0, 0, W, H);

  const c0x = Math.floor(CX / CPX), c1x = Math.floor((CX + W) / CPX);
  const c0y = Math.floor(CY / CPX), c1y = Math.floor((CY + H) / CPX);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) ctx.drawImage(getGround(cx, cy).cvs, cx * CPX - CX, cy * CPX - CY);
  let built = 0;
  for (let cy = c0y - 2; cy <= c1y + 2 && !built; cy++) for (let cx = c0x - 2; cx <= c1x + 2; cx++) {
    if (!ground.has(cx + ',' + cy)) { getGround(cx, cy); built = 1; break; }
  }
  evictGround();

  // the lair's sigil circle
  const lair = world.lair, lx = Math.round(lair.x - CX), ly = Math.round(lair.y - CY), AR = cfg.arenaRadius + 8;
  const lairOn = lx > -AR && lx < W + AR && ly > -AR && ly < H + AR;
  if (lairOn) { if (!arenaDecal || arenaDecal.lair !== lair) buildArena(); ctx.drawImage(arenaDecal, lx - AR, ly - AR); }
  for (const d of decals) {
    const x = d.x - CX, y = d.y - CY, k = d.life / d.max;
    if (d.kind === 'scorch') { ctx.fillStyle = `rgba(8,2,2,${.4 * k})`; ctx.beginPath(); ctx.arc(x, y, d.r * .9, 0, Math.PI * 2); ctx.fill(); }
    else if (d.kind === 'void') { ctx.fillStyle = `rgba(20,0,30,${.45 * k})`; ctx.beginPath(); ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fill(); }
  }

  const list = [], lights = [], flats = [], wispList = [];
  eyeList.length = 0; glintList.length = 0; postAdd.length = 0;
  const px = Math.round(hero.x - CX), py = Math.round(hero.y - CY);
  for (let cy = c0y - 1; cy <= c1y + 1; cy++) for (let cx = c0x - 1; cx <= c1x + 1; cx++) {
    const ch = world.chunk(cx, cy);
    for (const o of ch.objs) {
      const sx = Math.round(o.x - CX), sy = Math.round(o.y - CY);
      if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 80) continue;
      const K = KINDS[o.k];
      if (K.light) lights.push([sx, sy - (o.k === 'vent' ? 0 : o.k === 'obelisk' ? 24 : 6), K.light[0] * lightFlicker(K.light[2], o.ph), K.light[1], o.k === 'obelisk' ? .4 : o.k === 'altar' ? .6 : 1]);
      if (K.flat) flats.push([o, sx, sy]); else list.push([o, sx, sy]);
    }
    for (const w of ch.wisps) {
      const [wx, wy] = wispPos(w); const sx = wx - CX, sy = wy - CY;
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      wispList.push([sx, sy, w]);
      lights.push([sx, sy - 6, 34 * (1 + Math.sin(t * 2 + w.ph) * .1), w.c]);
    }
    for (const s of ch.signs) {
      const sx = Math.round(s.x - CX), sy = Math.round(s.y - CY);
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 40) continue;
      if (s.kind === 'circle' || s.kind === 'blood') flats.push([{ ent: 'sign', s }, sx, sy]); else list.push([{ ent: 'sign', s }, sx, sy]);
      if (s.kind === 'blood' && !S.discovered[s.id]) lights.push([sx, sy, 18, [200, 20, 10]]);
    }
  }
  for (const m of S.monsters) {
    const sx = Math.round(m.x - CX), sy = Math.round(m.y - CY);
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 40) continue;
    list.push([{ ent: 'monster', m }, sx, sy]);
    if (m.type === 'imp') lights.push([sx, sy - 8, 30 * lightFlicker(.4, m.id), [255, 110, 40]]);
    else if (m.type === 'cultist') lights.push([sx + 6, sy - 25, m.state === 'windup' ? 32 : 20, m.state === 'windup' ? [180, 90, 255] : [255, 150, 70]]);
    else if (m.type === 'wraith') lights.push([sx, sy - 14, 18, [140, 180, 230]]);
  }
  const B = S.boss;
  { const sx = Math.round(B.x - CX), sy = Math.round(B.y - CY); if (sx > -50 && sx < W + 50 && sy > -50 && sy < H + 80) { list.push([{ ent: 'boss', B }, sx, sy + 1]); if (!vict || vict.t < 2) lights.push([sx, sy - 30, B.awake ? 70 : 50, [160, 80, 255], .6]); } }
  if (vict) lights.push([lx, ly - 8, 60 + 70 * clamp01(vict.t / 2.5), [230, 220, 255]]);
  if (S.phase !== 'won' && S.phase !== 'damned') for (const p of S.projectiles) {
    const sx = Math.round(p.x - CX), sy = Math.round(p.y - CY);
    if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
    list.push([{ ent: 'proj', p }, sx, sy + 8]);
    lights.push([sx, sy, p.src === 'boss' ? 26 : 24, p.src === 'imp' ? [255, 120, 40] : [170, 90, 255], p.src === 'boss' ? .45 : .8]);
  }

  ctx.strokeStyle = 'rgba(160,190,200,.35)'; ctx.lineWidth = 1;
  for (const r of ripples) {
    ctx.globalAlpha = 1 - r.a; ctx.beginPath(); ctx.ellipse(Math.round(r.x - CX), Math.round(r.y - CY), 2 + r.a * 9, 1 + r.a * 4, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const R = AW.render;
  for (const [o, sx, sy] of flats) {
    if (o.ent === 'sign') { R.drawSign(ctx, o.s, sx, sy, t); continue; }
    if (KINDS[o.k].dyn) DYN[KINDS[o.k].dyn](o, sx, sy);
    else { const s = SPR[o.k][o.v % SPR[o.k].length]; ctx.drawImage(s, Math.round(sx - s.width / 2), Math.round(sy - s.height / 2)); }
  }
  drawTelegraphs(S, cfg, CX, CY);
  if (hero.rung >= 4 && S.phase === 'play') { // Dread: a slow ripple on the ground
    const rad = (cfg.dread && cfg.dread.radius) || 50;
    for (let i = 0; i < 2; i++) {
      const k = (t * .55 + i * .5) % 1;
      ctx.strokeStyle = `rgba(120,90,150,${.2 * (1 - k)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(px, py, rad * k, rad * k * .8, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (fall) {
    const fx = Math.round(fall.x - CX), fy = Math.round(fall.y - CY), k = clamp01(fall.t / 1.5);
    ctx.strokeStyle = '#040203'; ctx.lineWidth = 2;
    for (const c of fall.cracks) strokeCrack(ctx, c, k, fx, fy);
    const pr = 18 * Math.pow(clamp01((fall.t - .6) / 1.3), .7);
    if (pr > 0) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(fx, fy, pr, pr * .5, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  const tlx = px + (hero.face === 2 ? -6 : 6), tly = py - 16;
  for (const [o, sx, sy] of list) {
    if (o.ent) continue;
    const K = KINDS[o.k];
    if (K.dyn) continue;
    const s = SPR[o.k][o.v % SPR[o.k].length];
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, sy, Math.max(3, s.width * .22), 2.2, 0, 0, Math.PI * 2); ctx.fill();
    if (!K.tall) continue;
    const dx = sx - tlx, dy = sy - (tly + 16), d = Math.hypot(dx, dy);
    if (d > 150 || d < 4) continue;
    const ux = dx / d, uy = dy / d, k = .5 + d / 120;
    ctx.globalAlpha = .55 * (1 - d / 150);
    ctx.setTransform(-uy, ux, -ux * k, -uy * k, sx, sy);
    ctx.drawImage(s.shadow, -s.width / 2, -s.height + 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.globalAlpha = 1;

  list.push([{ ent: 'hero' }, px, py]);
  list.sort((a, b) => a[2] - b[2]);
  let torchPos = [px, py - 16];
  for (const [o, sx, sy] of list) {
    if (o.ent) {
      if (o.ent === 'hero') { torchPos = drawHeroEntity(px, py, S, cfg, CX, CY); R.drawHeroOverlay(ctx, hero, px, py, S, t); }
      else if (o.ent === 'monster') R.drawMonster(ctx, o.m, sx, sy, t);
      else if (o.ent === 'boss') R.drawBoss(ctx, o.B, sx, sy - 1, t, S);
      else if (o.ent === 'proj') R.drawProjectile(ctx, o.p, sx, sy - 8, t);
      else if (o.ent === 'sign') R.drawSign(ctx, o.s, sx, sy, t);
      continue;
    }
    const K = KINDS[o.k];
    if (K.dyn) { DYN[K.dyn](o, sx, sy); continue; }
    const s = SPR[o.k][o.v % SPR[o.k].length];
    ctx.drawImage(s, Math.round(sx - s.width / 2), Math.round(sy - s.height + 2));
    if (o.k === 'obelisk') { // runes pulse with heat: violet far away, ember red near the lair
      const hO = world.heatAt(o.x, o.y), pulse = .45 + .55 * Math.sin(t * (1.2 + hO * 3) + (o.x + o.y) * .01);
      const v = o.v % SPR.obeliskRunesV.length;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, pulse * (1 - hO) * .7); ctx.drawImage(SPR.obeliskRunesV[v], Math.round(sx - s.width / 2), Math.round(sy - s.height + 2));
      ctx.globalAlpha = Math.max(0, pulse * hO); ctx.drawImage(SPR.obeliskRunesR[v], Math.round(sx - s.width / 2), Math.round(sy - s.height + 2));
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  for (const g of ghosts) {
    const k = g.life / g.max, s = g.spr, vis = Math.max(1, Math.round(s.height * k));
    ctx.globalAlpha = g.alpha * (.4 + .6 * k);
    ctx.drawImage(s.white ? s : s, 0, s.height - vis, s.width, vis, Math.round(g.x - CX - (s.width >> 1)), Math.round(g.y - CY + 2 - vis), s.width, vis);
  }
  ctx.globalAlpha = 1;
  for (const f of S.fx) {
    R.drawFx(ctx, f, Math.round(f.x - CX), Math.round(f.y - CY));
    if (f.type === 'nova') lights.push([f.x - CX, f.y - CY, 100 * (1 - f.t / f.dur), [255, 60, 30]]);
    else if (f.type === 'bossnova') lights.push([f.x - CX, f.y - CY, 90 * (1 - f.t / f.dur), [180, 80, 255]]);
    else if (f.type === 'wrath') lights.push([f.x - CX, f.y - CY - 10, 110 * (1 - f.t / f.dur), [255, 30, 20]]);
  }
  for (const p of parts) {
    if (p.add) continue;
    ctx.fillStyle = `rgba(${p.c},${Math.min(1, p.life / p.max * 1.6)})`;
    ctx.fillRect(Math.round(p.x - CX), Math.round(p.y - CY), p.s, p.s);
  }
  for (const s of sparks) {
    ctx.fillStyle = `rgba(${s.c},${Math.min(1, s.life * 1.5)})`;
    ctx.fillRect(Math.round(s.x - CX), Math.round(s.y - CY), 1, 1);
  }
  for (const [sx, sy, w] of wispList) {
    const a = .7 + Math.sin(t * 3 + w.ph) * .3;
    ctx.fillStyle = `rgba(${w.c},${a})`;
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy - 6) - 1, 2, 2);
    ctx.fillStyle = `rgba(${w.c},${a * .35})`;
    ctx.fillRect(Math.round(sx) - 2, Math.round(sy - 6), 4, 1); ctx.fillRect(Math.round(sx), Math.round(sy - 6) - 2, 1, 4);
  }

  // fog: grey far away, reddening toward the lair
  const heat = world.heatAt(hero.x, hero.y), h2 = heat * heat;
  ctx.imageSmoothingEnabled = true;
  const FS = 512;
  for (let layer = 0; layer < 2; layer++) {
    const ox = mod(-(CX * (1 + layer * .15) + t * (6 + layer * 5)), FS), oy = mod(-(CY * (1 + layer * .15) + t * (2 + layer * 2)), FS);
    const base = layer ? .16 : .22;
    const ga = base * (1 - .7 * h2), ra = base * h2 * .6;
    for (let y = oy - FS; y < H; y += FS) for (let x = ox - FS; x < W; x += FS) {
      if (ga > .01) { ctx.globalAlpha = ga; ctx.drawImage(fog, x, y, FS, FS); }
      if (ra > .01) { ctx.globalAlpha = ra; ctx.drawImage(fogRed, x, y, FS, FS); }
    }
  }
  ctx.globalAlpha = 1;

  // lights
  const tf = lightFlicker(.25, 0), rung = Math.min(5, hero.rung | 0);
  let torchR = 108 * (hero.rung >= 4 ? cfg.dread.torchMul : 1) * (1 + wrathK * .1);
  if (S.phase === 'dead') torchR *= Math.max(.45, 1 - deadT * .3);
  lights.push([torchPos[0], torchPos[1], torchR * tf, wrathK > .5 ? [255, 36, 26] : TORCH_COL[rung], 1 - wrathK * .35]);
  if (lvlT > 0) lights.push([px, py - 10, 70 * lvlT / 1.5, [255, 200, 120]]);
  if (restGlow > .02) lights.push([px, py - 8, 30 * restGlow, [255, 170, 90]]);
  if (wrathK > .05) lights.push([px, py - 12, 50 * wrathK, [255, 20, 10], .35]);
  if (fall) lights.push([Math.round(fall.x - CX), Math.round(fall.y - CY), 30 + 110 * clamp01(fall.t / 2), [255, 40, 16]]);
  let dA = .84 - rung * .022;
  if (fall && fall.t > 2.6) dA = Math.min(.97, dA + (fall.t - 2.6) * .1);
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, W, H);
  lctx.fillStyle = `rgba(${5 + 22 * h2 | 0},4,${12 - 6 * h2 | 0},${dA})`; lctx.fillRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.imageSmoothingEnabled = true;
  for (const L of lights) lctx.drawImage(HOLE, L[0] - L[2], L[1] - L[2], L[2] * 2, L[2] * 2);
  ctx.drawImage(light, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) { if (L[4] === 0) continue; ctx.globalAlpha = L[4] || 1; ctx.drawImage(glowSpr(L[3]), L[0] - L[2], L[1] - L[2], L[2] * 2, L[2] * 2); }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  for (const p of parts) {
    if (!p.add) continue;
    ctx.fillStyle = `rgba(${p.c},${Math.min(1, p.life / p.max * 1.6)})`;
    ctx.fillRect(Math.round(p.x - CX), Math.round(p.y - CY), p.s, p.s);
  }
  // signs, sigils and the arena glow faintly through the dark
  for (let i = 0; i < postAdd.length; i += 6) {
    ctx.globalAlpha = .3 + .25 * Math.sin(t * 2.2 + postAdd[i + 5]);
    ctx.drawImage(SIGN.bloodGlow, Math.round(postAdd[i + 1] - 13), Math.round(postAdd[i + 2] - 13));
  }
  if (lairOn && arenaGlow) { ctx.globalAlpha = .12 + .09 * Math.sin(t * 1.4); ctx.drawImage(arenaGlow, lx - AR, ly - AR); }
  ctx.globalAlpha = 1;
  if (fall) {
    const fx = Math.round(fall.x - CX), fy = Math.round(fall.y - CY), k = clamp01(fall.t / 1.5);
    ctx.strokeStyle = `rgba(255,70,20,${.6 + .3 * Math.sin(t * 9)})`; ctx.lineWidth = 1;
    for (const c of fall.cracks) strokeCrack(ctx, c, k, fx, fy);
    const pr = 18 * Math.pow(clamp01((fall.t - .6) / 1.3), .7);
    if (pr > 0) { ctx.strokeStyle = 'rgba(255,60,20,.8)'; ctx.beginPath(); ctx.ellipse(fx, fy, pr, pr * .5, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (Math.random() < .7) part(fall.x + (Math.random() - .5) * pr * 2, fall.y, (Math.random() - .5) * 10, -20 - Math.random() * 30, .8, '255,70,20', { add: true });
  }
  const embersBiome = world.biomeAt(hero.x, hero.y) === 2, heatE = Math.pow(heat, 1.6) * .9;
  const dcx = CX - (draw.pcx ?? CX), dcy = CY - (draw.pcy ?? CY);
  draw.pcx = CX; draw.pcy = CY;
  for (const f of flakes) {
    if (f.hk === undefined) f.hk = Math.random();
    f.x = mod(f.x + f.vx * dt + Math.sin(t + f.ph) * .15 - dcx, W);
    f.y = mod(f.y + f.vy * dt - dcy, H);
    const ember = embersBiome || f.hk < heatE;
    ctx.fillStyle = ember ? `rgba(255,${90 + (f.ph * 20 | 0)},30,${f.a * (.6 + Math.sin(t * 4 + f.ph) * .4)})` : `rgba(150,145,140,${f.a * .35})`;
    ctx.fillRect(Math.round(f.x), Math.round(f.y), f.s, 1);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(vignette, 0, 0);
  if (heat > 0.02) { ctx.fillStyle = `rgba(120,10,6,${h2 * .16})`; ctx.fillRect(0, 0, W, H); }
  if (hurtT > 0) { ctx.globalAlpha = Math.min(1, hurtT * 2.2); ctx.drawImage(hurtVig, 0, 0); ctx.globalAlpha = 1; }
  // eyes in the dark, sign glints, numbers
  for (let i = 0; i < eyeList.length; i += 3) {
    const lv = eyeList[i + 2], col = EYE_LV[lv];
    if (lv >= 3) { ctx.globalAlpha = .3; ctx.fillStyle = col; ctx.fillRect(eyeList[i] - 1, eyeList[i + 1], 3, 1); ctx.fillRect(eyeList[i], eyeList[i + 1] - 1, 1, 3); ctx.globalAlpha = 1; }
    ctx.fillStyle = col; ctx.fillRect(eyeList[i], eyeList[i + 1], 1, 1);
  }
  for (let i = 0; i < glintList.length; i += 4) {
    const u = (t * .42 + glintList[i + 2] / 6.28) % 1;
    if (u < .14) star(ctx, glintList[i], glintList[i + 1], 2, glintList[i + 3], Math.sin(u / .14 * Math.PI) * .9);
    else { ctx.fillStyle = `rgba(${glintList[i + 3]},.35)`; ctx.fillRect(Math.round(glintList[i]), Math.round(glintList[i + 1]), 1, 1); }
  }
  for (const n of nums) {
    const dg = DIGITS[n.kind] || DIGITS.deal, s = String(n.v), w = s.length * 4 + 1;
    let x = Math.round(n.x - CX - w / 2); const y = Math.round(n.y - CY);
    ctx.globalAlpha = Math.min(1, n.life * 3);
    for (let i = 0; i < s.length; i++, x += 4) { const d = s.charCodeAt(i) - 48; ctx.drawImage(dg, d * 5, 0, 5, 7, x, y, 5, 7); }
  }
  ctx.globalAlpha = 1;
  if (fall && fall.t > 3.2) { ctx.fillStyle = `rgba(0,0,0,${clamp01((fall.t - 3.2) / 1.6)})`; ctx.fillRect(0, 0, W, H); }
  if (ui.debug) {
    ctx.strokeStyle = 'rgba(255,60,60,.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lx, ly, cfg.arenaRadius, 0, Math.PI * 2); ctx.stroke();
    const dx = lair.x - hero.x, dy = lair.y - hero.y, dl = Math.hypot(dx, dy) || 1;
    ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + dx / dl * 40, py - 8 + dy / dl * 40); ctx.stroke();
  }
}

// a sheet of every creature sprite, for review (not used in play)
function spriteSheet() {
  const S = 3, types = Object.keys(MSPR), c = canvas(1280, 800), g = c.getContext('2d');
  g.imageSmoothingEnabled = false; g.fillStyle = '#3a3640'; g.fillRect(0, 0, 1280, 800);
  types.forEach((ty, i) => {
    const ox = (i % 2) * 640 + 8, oy = (i >> 1) * 112 + 6;
    let col = 0;
    for (let v = 0; v < 4; v++) for (const f of [0, 4]) {
      const sp = MSPR[ty][v][f];
      g.drawImage(sp, ox + col * 78, oy, sp.width * S * .85 | 0, sp.height * S * .85 | 0);
      for (const [ex, ey] of sp.eyes) { g.fillStyle = EYE_LV[2]; g.fillRect(ox + col * 78 + ex * S * .85, oy + ey * S * .85, 2, 2); }
      col++;
    }
  });
  BOSS_POSES.forEach((p, i) => { const sp = BSPR[p][0][0]; g.drawImage(sp, 20 + i * 150, 460, sp.width * S, sp.height * S); });
  return c;
}

AW.render = {
  init, resize, setGame, draw, screenToWorld, onEvents, spriteSheet,
  drawMonster, drawBoss, drawProjectile, drawSign, drawHeroOverlay, drawFx,
  get scale() { return SCALE; }, get fallT() { return fall ? fall.t : 0; }, get victT() { return vict ? vict.t : 0; },
};
})(globalThis.AW = globalThis.AW || {});
