// Ashen Wilds browser shell: fixed-step loop, input, HUD/DOM screens, window.game API.
// The HUD lives in updateHud(obs) and the screens in showScreen(); messages go through say()/card().
(function (AW) {
'use strict';
const DT = AW.DT, TILE = AW.TILE;
const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };

// ---------------------------------------------------------------- configuration from the URL
function urlConfig() {
  let c = {};
  try { if (params.get('cfg')) c = JSON.parse(params.get('cfg')); } catch (e) { console.warn('bad ?cfg', e); }
  if (params.has('startLevel')) c.startLevel = num('startLevel', 1);
  if (params.has('startXp')) c.startXp = num('startXp', 0);
  if (params.get('invulnerable') === '1') c.invulnerable = true;
  if (params.get('debug') === '1') c.debugObs = true;
  return c;
}
const DEBUG = params.get('debug') === '1';

// ---------------------------------------------------------------- game instance
let game = null, bot = null, botAct = null, tickN = 0;
let acc = 0, apiAction = null, paused = false, speedMul = Math.max(1, Math.min(8, num('speed', 1)));
const apiQueue = [], botQueue = [];
let seed = num('seed', 666);

function makeGame(sd, over, startPos) {
  seed = sd;
  const o = { seed: sd, config: over || {} };
  if (startPos) { if (startPos.x !== undefined) o.x = startPos.x; if (startPos.y !== undefined) o.y = startPos.y; }
  game = AW.createGame(o);
  AW.render.setGame(game);
  tickN = 0; botAct = null; apiQueue.length = 0; botQueue.length = 0;
  const bn = params.get('bot');
  bot = bn ? AW.bots.make(bn, { seed: sd }) : null;
  if (bn === 'rusher') game.config.debugObs = true;
  pendingEnd = null; hudCache = {}; ribbonHintShown = false; ribbon.warmth = -1;
}

// ---------------------------------------------------------------- input
const keys = new Set();
const joy = { active: false, ox: 0, oy: 0, x: 0, y: 0, id: null };
const mouse = { down: false, x: 0, y: 0 };
let pendingAbility = null, pendingTicks = 0, touchAttack = false;
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const ABIL = { KeyQ: 'dash', KeyE: 'nova', KeyR: 'wrath' };
let screenMode = 'none', screenSince = 0;
const queueAbility = ab => { pendingAbility = ab; pendingTicks = 8; };

addEventListener('keydown', e => {
  if (screenMode === 'title') { if (e.code !== 'Escape' && !e.repeat && !e.metaKey && !e.ctrlKey) { showScreen('intro'); keys.clear(); } e.preventDefault(); return; }
  if (screenMode === 'intro') { if (!e.repeat && performance.now() - screenSince > 300) startPlay(); e.preventDefault(); return; }
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && (screenMode === 'none' || screenMode === 'death')) { setPaused(!paused); e.preventDefault(); return; }
  if (paused && screenMode !== 'end') return;
  if (screenMode === 'end') { if (performance.now() - screenSince > 2500 && (e.code === 'Enter' || e.code === 'Space')) beginAgain(); e.preventDefault(); return; }
  keys.add(e.code);
  if (MOVE[e.code] || e.code === 'Space') e.preventDefault();
  if (ABIL[e.code]) queueAbility(ABIL[e.code]);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touchAttack = false; });
addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !document.body.classList.contains('touch')) document.body.classList.add('touch'); }, true);
const stickEl = $('stick'), knobEl = $('knob'), cv = $('game');
for (const id of ['title', 'intro']) $(id).addEventListener('pointerdown', e => {
  e.preventDefault();
  if (screenMode === 'title') showScreen('intro');
  else if (screenMode === 'intro' && performance.now() - screenSince > 300) startPlay();
});
cv.addEventListener('pointerdown', e => {
  if (screenMode === 'intro' || screenMode === 'title') return;
  if (screenMode === 'end') return;
  if (e.pointerType === 'mouse') { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; return; }
  joy.active = true; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
  cv.setPointerCapture(e.pointerId);
  stickEl.style.display = knobEl.style.display = 'block';
  stickEl.style.left = knobEl.style.left = e.clientX + 'px';
  stickEl.style.top = knobEl.style.top = e.clientY + 'px';
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
  if (!joy.active || e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const d = Math.hypot(dx, dy), R = 55;
  if (d > R) { dx = dx / d * R; dy = dy / d * R; }
  joy.x = dx / R; joy.y = dy / R;
  knobEl.style.left = joy.ox + dx + 'px'; knobEl.style.top = joy.oy + dy + 'px';
});
const endPointer = e => {
  if (e.pointerType === 'mouse') { mouse.down = false; return; }
  if (e.pointerId !== joy.id) return;
  joy.active = false; joy.x = joy.y = 0; stickEl.style.display = knobEl.style.display = 'none';
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
// touch buttons: the ability slots double as buttons, plus an attack button
for (const el of document.querySelectorAll('.slot')) el.addEventListener('pointerdown', e => { e.preventDefault(); queueAbility(el.dataset.ab); });
{
  const atk = $('atk');
  atk.addEventListener('pointerdown', e => { e.preventDefault(); touchAttack = true; atk.classList.add('down'); atk.setPointerCapture(e.pointerId); });
  const up = () => { touchAttack = false; atk.classList.remove('down'); };
  atk.addEventListener('pointerup', up); atk.addEventListener('pointercancel', up);
}

function keyboardAction() {
  let ix = 0, iy = 0;
  for (const k of keys) if (MOVE[k]) { ix += MOVE[k][0]; iy += MOVE[k][1]; }
  ix = Math.sign(ix); iy = Math.sign(iy);
  if (joy.active) { ix += joy.x; iy += joy.y; }
  const a = { mx: ix, my: iy, run: keys.has('ShiftLeft') || keys.has('ShiftRight') || (joy.active && Math.hypot(joy.x, joy.y) > .95), attack: keys.has('Space') || keys.has('KeyJ') || touchAttack, ability: null };
  if (mouse.down) {
    a.attack = true;
    const w = AW.render.screenToWorld(mouse.x, mouse.y);
    a.aimX = w[0]; a.aimY = w[1];
  }
  if (pendingTicks > 0) { a.ability = pendingAbility; pendingTicks--; if (!pendingTicks) pendingAbility = null; }
  return a;
}

// ---------------------------------------------------------------- messages
// whispers, signs and hints: one at a time, centred italic, fading
const msgQ = []; let msgBusy = 0, msgTimer = null;
function say(text, cls) {
  if (!text) return;
  if (msgQ.length > 3) msgQ.shift();
  msgQ.push({ text, cls: cls || '' });
  if (!msgBusy) nextMsg();
}
function nextMsg() {
  const el = $('msg'), m = msgQ.shift();
  if (!m) { msgBusy = 0; return; }
  msgBusy = 1; el.textContent = m.text; el.className = m.cls; el.style.opacity = 1;
  const dur = Math.min(9000, 3400 + m.text.length * 45);
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.style.opacity = 0; msgTimer = setTimeout(nextMsg, 850); }, dur);
}
let cardTimer = null;
function card(over, title, text, ominous) {
  const el = $('card');
  el.querySelector('.over').textContent = over || ''; el.querySelector('h2').textContent = title || ''; el.querySelector('p').textContent = text || '';
  el.className = ominous ? 'ominous' : ''; el.style.opacity = 1;
  clearTimeout(cardTimer); cardTimer = setTimeout(() => { el.style.opacity = 0; }, ominous ? 5500 : 6500);
}
let lvlTimer = null;
function levelFlourish(level) {
  const el = $('levelUp'); el.textContent = 'Level ' + level; el.style.opacity = 1;
  clearTimeout(lvlTimer); lvlTimer = setTimeout(() => { el.style.opacity = 0; }, 2400);
}

// ---------------------------------------------------------------- screens
function showScreen(mode) {
  screenMode = mode; screenSince = performance.now();
  $('title').style.display = mode === 'title' ? 'flex' : 'none';
  $('intro').style.display = mode === 'intro' ? 'flex' : 'none';
  const d = $('death');
  if (mode === 'death') { d.style.display = 'flex'; requestAnimationFrame(() => d.classList.add('on')); } else { d.classList.remove('on'); d.style.display = 'none'; }
  const e = $('end');
  if (mode === 'end') { e.style.display = 'flex'; requestAnimationFrame(() => e.classList.add('on')); setTimeout(() => $('again').focus(), 2500); } else { e.classList.remove('on'); e.style.display = 'none'; }
  const hide = mode === 'intro' || mode === 'end' || mode === 'title';
  for (const id of ['hud', 'slots', 'boss', 'frame', 'biome', 'coords', 'atk', 'msg', 'card', 'levelUp', 'help', 'ribbon', 'pbtn']) $(id).style.visibility = hide ? 'hidden' : '';
}
function buildIntro() {
  const cfg = game.config;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = cfg.introText.map((s, i) => `<p style="animation-delay:${(1 + i * 2.1).toFixed(1)}s">${esc(s)}</p>`).join('');
  $('intro').innerHTML = lines + `<small style="animation-delay:${(1.6 + cfg.introText.length * 2.1).toFixed(1)}s,${(3.2 + cfg.introText.length * 2.1).toFixed(1)}s">press any key to begin</small>`;
}
// title decorations: an ember-and-ribbon pixel ornament and rising embers
{
  const g = document.querySelector('#title .orn').getContext('2d');
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  for (let x = 0; x < 9; x++) px(x, 1, x < 3 ? '#3a1810' : '#7a3018');
  for (let x = 13; x < 22; x++) px(x, 1, x > 18 ? '#3a1810' : '#7a3018');
  px(10, 0, '#ff8a2a'); px(11, 0, '#ffe7a0'); px(10, 1, '#c2380e'); px(11, 1, '#ff8a2a'); px(10, 2, '#4474d8'); px(11, 2, '#8eb2ff');
  const box = document.querySelector('#title .embers');
  for (let i = 0; i < 26; i++) {
    const e = document.createElement('i');
    e.style.left = (Math.random() * 100).toFixed(1) + '%';
    e.style.setProperty('--dx', ((Math.random() - .5) * 120).toFixed(0) + 'px');
    e.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + 's';
    e.style.animationDelay = (-Math.random() * 14).toFixed(1) + 's';
    if (Math.random() < .4) { e.style.width = e.style.height = '2px'; }
    box.appendChild(e);
  }
}
let started = false;
function startPlay() {
  started = true; showScreen('none');
  $('help').style.opacity = .85;
  setTimeout(() => { $('help').style.opacity = 0; }, 9000);
}
const ENDINGS = { walk_home: 'Walk home', new_master: 'The new master', fall: 'The Fall' };
let pendingEnd = null;
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function showEnding(ending, text) {
  const S = game.state, H = S.hero;
  $('end').className = 'screen ' + ending;
  $('endTitle').textContent = ENDINGS[ending] || ending;
  $('endText').textContent = text || '';
  const st = [['time', fmtTime(S.t)], ['kills', S.stats.kills], ['deaths', S.stats.deaths], ['level', H.level], ['humanity', H.humanity]];
  $('endStats').innerHTML = st.map(([k, v]) => `<div>${v}<span>${k}</span></div>`).join('');
  showScreen('end');
}
// pause: freezes the simulation; the fixed-step accumulator is dropped so nothing catches up afterwards
function setPaused(b, quiet) {
  paused = !!b; acc = 0;
  document.body.classList.toggle('paused', paused && !quiet);
  keys.clear(); mouse.down = false; touchAttack = false; pendingTicks = 0;
  const el = $('pause');
  if (paused && !quiet) {
    const o = game.observe(), tr = o.trail, w = WARM[o.player.warmth || 0];
    $('pauseTrail').innerHTML = tr ? `The last sign pointed <em>${tr.dir}</em> from where it lay. The trail feels <em style="color:${w.col}">${w.word}</em>.` : 'No trace of her yet. Search for a sign.';
    el.style.display = 'flex';
  } else el.style.display = 'none';
}
function beginAgain() {
  const sd = (Math.random() * 1e6) | 0;
  makeGame(sd, urlConfig());
  msgQ.length = 0; $('msg').style.opacity = 0; $('card').style.opacity = 0;
  startPlay();
}
$('again').addEventListener('click', beginAgain);
$('pbtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (screenMode === 'none' || screenMode === 'death') setPaused(!paused); });
$('pause').addEventListener('pointerdown', e => { e.preventDefault(); setPaused(false); });

function handleEvents(ev) {
  AW.render.onEvents(ev);
  const falling = ev.some(e => e.type === 'damnation');
  for (const e of ev) {
    if (falling && (e.type === 'levelup' || e.type === 'rung')) continue;
    switch (e.type) {
      case 'rung': if (e.text) card('the descent', e.name, e.text); unlockFlash(e.rung); break;
      case 'whisper': say(e.text, e.voice === 'morhain' ? 'voice' : ''); break;
      case 'warning': say(e.text, 'warn'); break;
      case 'sign': case 'hint':
        say(e.text);
        if (!ribbonHintShown) { ribbonHintShown = true; say('Follow the ribbon. Her trail grows warmer as you near him.', 'ribbon'); }
        break;
      case 'damnation_warning': card('', 'The Pale Below', e.text, true); pulseHeart(); break;
      case 'boss_phase': card('', '', e.text, true); break;
      case 'levelup': levelFlourish(e.level); break;
      case 'death': if (screenMode === 'none') showScreen('death'); break;
      case 'respawn': if (screenMode === 'death') showScreen('none'); break;
      case 'victory': pendingEnd = { at: performance.now() + 3600, ending: e.ending, text: e.text }; break;
      case 'damnation': pendingEnd = { at: performance.now() + 5200, ending: e.ending || 'fall', text: e.text }; break;
    }
  }
}

// ---------------------------------------------------------------- HUD pieces drawn in tiny canvases
const HEART = ['..XXX...XXX..', '.XXXXX.XXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', '.XXXXXXXXXXX.', '..XXXXXXXXX..', '...XXXXXXX...', '....XXXXX....', '.....XXX.....', '......X......'];
const RUNG_CRACKS = [[], [[6, 2], [6, 3], [5, 4]], [[5, 5], [6, 6], [6, 7]], [[3, 1], [3, 2], [2, 3], [2, 4]], [[9, 1], [9, 2], [10, 3], [9, 4], [8, 5]], [[7, 7], [7, 8], [6, 9], [4, 6], [4, 7]]];
// the damnation fissure: it spreads cell by cell as XP climbs toward damnationLevel
const DAMN_PATH = [[6, 1], [6, 2], [5, 3], [6, 4], [7, 5], [6, 6], [5, 7], [6, 8], [6, 9], [6, 10], [4, 4], [3, 5], [2, 4], [1, 3], [8, 3], [9, 4], [10, 4], [11, 3], [8, 7], [9, 6], [3, 6], [4, 8]];
function drawHeart(rung, humanity, damn, t) {
  const g = $('heart').getContext('2d');
  g.clearRect(0, 0, 13, 11);
  const k = humanity / 100;
  const r = Math.round(40 + 152 * k), gg = Math.round(24 + 24 * k), b = Math.round(30 + 28 * k);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 13; x++) if (HEART[y][x] === 'X') {
    const shade = (x + y < 6) ? 1.25 : (x > 8 && y > 4) ? .75 : 1;
    g.fillStyle = `rgb(${Math.min(255, r * shade) | 0},${Math.min(255, gg * shade) | 0},${Math.min(255, b * shade) | 0})`; g.fillRect(x, y, 1, 1);
  }
  if (humanity > 0) { g.fillStyle = 'rgba(255,220,210,.55)'; g.fillRect(2, 2, 1, 1); g.fillRect(3, 1, 1, 1); }
  g.fillStyle = rung >= 5 ? '#3a0606' : '#0a0405';
  for (let i = 1; i <= rung && i < RUNG_CRACKS.length; i++) for (const [x, y] of RUNG_CRACKS[i]) g.fillRect(x, y, 1, 1);
  if (damn > 0) {
    const n = Math.max(1, Math.round(damn * DAMN_PATH.length));
    for (let i = 0; i < n; i++) { const [x, y] = DAMN_PATH[i]; g.fillStyle = i === n - 1 ? '#ffd080' : '#ff3a14'; g.fillRect(x, y, 1, 1); }
  }
}
const ICONS = {
  dash: ['............', '........ss..', '.......ssss.', '.vv.....ss..', 'vvvv...ssss.', '.....ssssss.', '.vvvv.ssss..', '......ssss..', '..vvv.s..s..', '......s..s..', '.....ss..ss.', '............'],
  nova: ['....rrrr....', '..rr.yy.rr..', '.r..y..y..r.', '.r.y....y.r.', 'r.y......y.r', 'r.y..oo..y.r', 'r.y..oo..y.r', 'r.y......y.r', '.r.y....y.r.', '.r..y..y..r.', '..rr.yy.rr..', '....rrrr....'],
  wrath: ['h..........h', 'h..........h', '.h........h.', '.hh.dddd.hh.', '..hddddddh..', '...dddddd...', '...dyddyd...', '...dddddd...', '....dddd....', '....d..d....', '.....dd.....', '............'],
};
const ICOL = { s: '#b490e0', v: '#5a3a8a', r: '#c0281a', y: '#ff9a3a', o: '#ffe8b0', h: '#e0d6c4', d: '#7a1414' };
for (const el of document.querySelectorAll('.slot')) {
  const g = el.querySelector('canvas').getContext('2d'), pat = ICONS[el.dataset.ab];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const ch = pat[y][x]; if (ch !== '.') { g.fillStyle = ch === 'y' && el.dataset.ab === 'wrath' ? '#ff2a1a' : ICOL[ch]; g.fillRect(x, y, 1, 1); } }
}
function unlockFlash(rung) {
  const ab = rung === 2 ? 'dash' : rung === 3 ? 'nova' : rung === 5 ? 'wrath' : null;
  if (!ab) return;
  const el = document.querySelector(`.slot[data-ab="${ab}"]`);
  el.classList.remove('unlocked'); void el.offsetWidth; el.classList.add('unlocked');
}
function pulseHeart() { const el = $('heartBox'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

// ---------------------------------------------------------------- HUD
// Ilse's ribbon: streams along the latest hint's fixed dirVec; glow and word follow the live warmth
const WARM = [
  { word: 'cold', col: '#7aa8ff', rgb: '110,160,255' }, { word: 'cool', col: '#b8c8d8', rgb: '190,205,220' },
  { word: 'warm', col: '#ffb060', rgb: '255,170,80' }, { word: 'hot', col: '#ff6a2a', rgb: '255,100,40' },
  { word: 'burning', col: '#ff2a2a', rgb: '255,30,30' },
];
let ribbonHintShown = false;
const ribbon = { warmth: -1, flareAt: 0 };
function drawRibbon(tr, warmth) {
  const box = $('ribbon');
  if (!tr) { if (box.classList.contains('show')) box.classList.remove('show'); return; }
  if (!box.classList.contains('show')) box.classList.add('show');
  const now = performance.now();
  if (warmth !== ribbon.warmth) {
    if (ribbon.warmth >= 0) { ribbon.flareAt = now; box.classList.remove('flare'); void box.offsetWidth; box.classList.add('flare'); }
    ribbon.warmth = warmth;
    const W = WARM[warmth] || WARM[0];
    const lab = $('ribbonWord'); lab.textContent = W.word; lab.style.color = W.col;
  }
  const W = WARM[warmth] || WARM[0], g = $('ribbonCv').getContext('2d'), S = 36, T = now / 1000;
  const flare = Math.max(0, 1 - (now - ribbon.flareAt) / 1400);
  g.clearRect(0, 0, S, S);
  const gr = g.createRadialGradient(18, 18, 0, 18, 18, 18);
  gr.addColorStop(0, `rgba(${W.rgb},${.32 + .1 * Math.sin(T * 2.5) + flare * .5})`); gr.addColorStop(1, `rgba(${W.rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const d = tr.dirVec, len = Math.hypot(d.x, d.y) || 1, ux = d.x / len, uy = d.y / len, px = -uy, py = ux;
  const kx = 18 - ux * 9, ky = 18 - uy * 9;
  for (let i = 1; i <= 19; i++) {
    const wv = Math.sin(T * 6 - i * .55) * Math.min(i, 9) * .17;
    const x = kx + ux * i + px * wv, y = ky + uy * i + py * wv;
    g.fillStyle = '#2a50b0'; g.fillRect(Math.round(x + px), Math.round(y + py), 1, 1);
    g.fillStyle = i % 4 === 0 ? '#b8d0ff' : '#5a8ae8'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.fillStyle = '#1d3f8a'; g.fillRect(Math.round(kx) - 1, Math.round(ky) - 1, 3, 3);
  g.fillStyle = '#8ab0ff'; g.fillRect(Math.round(kx), Math.round(ky) - 1, 1, 1);
}
let hudCache = {};
const set = (key, v, fn) => { if (hudCache[key] !== v) { hudCache[key] = v; fn(v); } };
const TEMP_COL = { cold: '#9ab4d8', cool: '#c8c0a8', warm: '#e8a860', burning: '#ff5a3a' };
const AB_CD = { dash: c => c.dash.cd, nova: c => c.nova.cd, wrath: c => c.wrath.cd };
function damnationOf(p, cfg) {
  if (typeof p.damnation === 'number') return p.damnation;
  const ready = cfg.bossReadyLevel, span = cfg.damnationLevel - ready;
  if (p.level < ready || span <= 0) return 0;
  const frac = p.xpNext ? Math.min(1, p.xp / p.xpNext) : 0;
  return Math.max(0, Math.min(1, (p.level - ready + frac) / span));
}
function updateHud(obs) {
  const p = obs.player, ab = p.abilities, cfg = game.config;
  const rungs = cfg.rungs, damn = damnationOf(p, cfg);
  set('rung', p.rung + '|' + p.humanity, () => {
    $('rungName').textContent = rungs[p.rung].name;
    $('hum').textContent = 'humanity ' + p.humanity;
  });
  set('heart', p.rung + '|' + p.humanity + '|' + Math.round(damn * DAMN_PATH.length), () => drawHeart(p.rung, p.humanity, damn));
  set('warn', p.level >= cfg.bossReadyLevel && obs.phase !== 'won' ? 1 : 0, v => $('heartBox').classList.toggle('warn', !!v && p.level >= (cfg.damnationWarnLevels ? cfg.damnationWarnLevels[0] : 7)));
  set('hp', Math.ceil(p.hp) + '/' + p.maxHp, () => {
    const f = Math.max(0, p.hp / p.maxHp) * 100 + '%';
    $('hpBar').querySelector('i').style.width = f; $('hpBar').querySelector('u').style.width = f;
    $('hpBar').querySelector('span').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
  });
  set('lvl', p.level, v => { $('lvl').textContent = 'Lv ' + v; });
  set('xp', Math.round((p.xpNext ? p.xp / p.xpNext : 1) * 200), () => { $('xpBar').querySelector('i').style.width = (p.xpNext ? Math.min(100, p.xp / p.xpNext * 100) : 100) + '%'; });
  set('xpDamn', p.level >= cfg.bossReadyLevel, v => $('xpBar').classList.toggle('damn', v));
  drawRibbon(obs.trail, obs.player.warmth || 0);
  for (const el of document.querySelectorAll('.slot')) {
    const k = el.dataset.ab, a = ab[k], max = AB_CD[k](cfg);
    const state = !a.unlocked ? 'locked' : a.active ? 'active' : a.cd > 0 ? 'cool' : 'ready';
    set('s_' + k, state, s => { el.classList.toggle('locked', s === 'locked'); el.classList.toggle('active', s === 'active'); el.classList.toggle('ready', s === 'ready'); });
    const pc = a.unlocked && a.cd > 0 && !a.active ? Math.min(1, a.cd / max) : 0;
    set('p_' + k, Math.round(pc * 60), () => el.querySelector('.sweep').style.setProperty('--p', pc.toFixed(3)));
    set('c_' + k, a.unlocked && a.cd > 0 && !a.active ? Math.ceil(a.cd) : 0, v => { el.querySelector('.cdt').textContent = v ? v : ''; });
  }
  const B = obs.boss, won = obs.phase === 'won';
  const showBoss = !!B && (B.awake || (won && AW.render.victT < 3));
  set('boss', showBoss, v => $('boss').classList.toggle('show', v));
  if (B) set('bossHp', B.hp + '/' + B.maxHp, () => {
    const f = Math.max(0, B.hp / B.maxHp) * 100 + '%';
    $('bossBar').querySelector('i').style.width = f; $('bossBar').querySelector('u').style.width = f;
  });
  set('bossMarks', cfg.boss.phase2At + '|' + cfg.boss.phase3At, () => {
    for (const m of $('bossBar').querySelectorAll('b')) m.remove();
    for (const at of [cfg.boss.phase2At, cfg.boss.phase3At]) { const m = document.createElement('b'); m.style.left = at * 100 + '%'; $('bossBar').appendChild(m); }
  });
  const warnL = cfg.damnationWarnLevels || [7, 8];
  set('frame', obs.phase === 'play' || obs.phase === 'dead' ? (p.level >= warnL[1] ? 'l8' : p.level >= warnL[0] ? 'l7' : '') : '', v => { $('frame').className = v; });
  const L = game.world && game.world.lair;
  const place = L && Math.hypot(p.x - L.x, p.y - L.y) < cfg.arenaRadius + 20 ? 'The Black Chapel' : p.biome;
  if (updateHud.b !== place) { updateHud.b = place; const b = $('biome'); b.textContent = place; b.style.opacity = 1; clearTimeout(updateHud.f); updateHud.f = setTimeout(() => { b.style.opacity = 0; }, 3800); }
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  set('coords', `${Math.abs(tx)}${tx < 0 ? 'W' : 'E'} · ${Math.abs(ty)}${ty <= 0 ? 'N' : 'S'}  ·  ${Math.floor(obs.stats.distance / TILE)} paces  ·  seed ${seed}`, v => { $('coords').textContent = v; });
  if (DEBUG && obs.debug) $('debug').textContent = `[debug] lair ${obs.debug.lair.x | 0},${obs.debug.lair.y | 0}  heat ${obs.debug.heat}  boss ${obs.boss ? obs.boss.hp + '/' + obs.boss.maxHp : '-'}  t ${obs.t}  dmn ${damn.toFixed(2)}`;
}

// ---------------------------------------------------------------- loop
function tickOnce() {
  let act;
  if (apiAction) act = apiAction;
  else if (bot) {
    if (tickN % (bot.every || 4) === 0) { botAct = bot.decide(game.observe(), botQueue.splice(0)); }
    act = botAct;
  } else act = keyboardAction();
  game.step(act, 1); tickN++;
  const ev = game.events();
  if (ev.length) {
    handleEvents(ev);
    for (const e of ev) { apiQueue.push(e); if (bot) botQueue.push(e); }
    if (apiQueue.length > 5000) apiQueue.splice(0, apiQueue.length - 5000);
  }
}
let last = performance.now(), frameN = 0;
const perf = { frames: 0, drawMs: 0, simMs: 0 };
function frame(now) {
  requestAnimationFrame(frame); // first, so a renderer error cannot stop the loop
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;
  const t0 = performance.now();
  if (started && !paused) {
    acc += dt * speedMul;
    let n = 0; const cap = Math.ceil(speedMul * 4) + 4;
    while (acc >= DT && n < cap) { tickOnce(); acc -= DT; n++; }
    if (acc > DT * cap) acc = 0;
  }
  const t1 = performance.now();
  AW.render.draw(game, dt, { debug: DEBUG });
  perf.frames++; perf.simMs += t1 - t0; perf.drawMs += performance.now() - t1;
  if (++frameN % 5 === 0) updateHud(game.observe());
  if (pendingEnd && now >= pendingEnd.at) { const e = pendingEnd; pendingEnd = null; showEnding(e.ending, e.text); }
}

// ---------------------------------------------------------------- window.game API
function normAction(a) { return a ? Object.assign({ mx: 0, my: 0 }, a) : null; }
window.game = {
  observe: () => game.observe(),
  events: () => apiQueue.splice(0),
  act: a => { apiAction = normAction(a); },
  // pause(bool, quiet): the same pause as Escape/P; quiet = true skips the overlay (tests, screenshots)
  pause: (b, quiet) => setPaused(b === undefined ? true : !!b, quiet),
  speed: n => { if (n !== undefined) speedMul = Math.max(1, Math.min(8, +n || 1)); return speedMul; },
  stepOnce: (a, ticks) => { const n = ticks === undefined ? 1 : ticks; for (let i = 0; i < n; i++) { game.step(normAction(a) || { mx: 0, my: 0 }, 1); const ev = game.events(); if (ev.length) { handleEvents(ev); apiQueue.push(...ev); } } return game.observe(); },
  get config() { return game.config; },
  get state() { return game.state; },
  // rendering statistics since the last call: frames, mean draw and sim milliseconds per frame
  perf: () => { const r = { frames: perf.frames, drawMs: perf.frames ? +(perf.drawMs / perf.frames).toFixed(3) : 0, simMs: perf.frames ? +(perf.simMs / perf.frames).toFixed(3) : 0 }; perf.frames = perf.drawMs = perf.simMs = 0; return r; },
  reset: o => {
    o = o || {};
    makeGame(o.seed !== undefined ? o.seed : seed, Object.assign(urlConfig(), o.config || {}), o.start);
    if (started) showScreen('none');
  },
};

// ---------------------------------------------------------------- boot
{
  const sx = parseFloat(params.get('x')), sy = parseFloat(params.get('y'));
  const start = {};
  if (Number.isFinite(sx)) start.x = sx * TILE;
  if (Number.isFinite(sy)) start.y = sy * TILE;
  makeGame(seed, urlConfig(), start);
  AW.render.init(cv);
  AW.render.setGame(game);
  buildIntro();
  if (params.get('bot') || params.get('intro') === '0') { started = true; showScreen('none'); $('help').style.opacity = .85; setTimeout(() => { $('help').style.opacity = 0; }, 4000); }
  else showScreen(params.get('title') === '0' ? 'intro' : 'title');
  requestAnimationFrame(frame);
}
})(globalThis.AW = globalThis.AW || {});
