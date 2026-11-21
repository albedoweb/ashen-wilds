#!/usr/bin/env node
// Component curves (DESIGN 9.4). node tools/curves.mjs [--n 20] [--set k=v ...] [--bot average]
//  1. TTK per monster type: hero level vs monster level, one monster 50 px away, `average` bot fights.
//  2. Time to die: a passive hero against two same-level monsters (monster dmg vs hero hp).
//  3. Boss fight length: level-6 `rusher` (and `average` start level 6): seconds from boss_awake to victory.
//  4. XP/min curve: minutes spent per level (median of full `average` runs).
import { AW, runOne, median, percentile } from './lib.mjs';

const argv = process.argv.slice(2);
let n = 20, bot = 'average', only = null; const sets = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--n') n = +argv[++i];
  else if (argv[i] === '--bot') bot = argv[++i];
  else if (argv[i] === '--only') only = argv[++i];
  else if (argv[i] === '--noabil') AW.bots.PARAMS.average.ability = 'none';
  else if (argv[i] === '--set') sets.push(argv[++i]);
}
function mkCfg(extra) {
  const cfg = {};
  for (const s of sets) { const k = s.indexOf('='); AW.setConfigPath(cfg, s.slice(0, k), s.slice(k + 1)); }
  for (const [k, v] of Object.entries(extra || {})) AW.setConfigPath(cfg, k, v);
  return cfg;
}
const f1 = v => v == null ? '-' : (Math.round(v * 10) / 10).toString();

function openSpot(game, seed) {
  for (let r = 500; r < 3000; r += 37) for (let a = 0; a < 6.28; a += 0.4) {
    const x = Math.cos(a + seed) * r, y = Math.sin(a + seed) * r;
    let ok = true;
    for (let dx = -20; dx <= 90 && ok; dx += 22) for (let dy = -40; dy <= 40 && ok; dy += 20) if (game.world.blockedAt(x + dx, y + dy, 8) || game.world.waterAt(x + dx, y + dy)) ok = false;
    if (ok && game.world.heatAt(x, y) < 0.3) return [x, y];
  }
  return [0, 8];
}
function spawn(game, type, level, x, y) {
  const S = game.state, mc = game.config.monsters[type], cfg = game.config;
  const hp = Math.round(mc.hp * (1 + cfg.monHpPerLevel * (level - 1)));
  const m = {
    id: S.nextId++, type, x, y, level, hp, maxHp: hp, dmg: mc.dmg * (1 + cfg.monDmgPerLevel * (level - 1)),
    state: 'chase', stateT: 0, windDur: 0, kx: 0, ky: 0, aggroT: S.t, shotCd: 1.5, wAng: 0, wT: 3,
    burnT: 0, burnDps: 0, strafe: 1, pack: 0, follower: false, summoned: false, face: 0,
  };
  S.monsters.push(m); S.stats.byType[type].encounters++;
  return m;
}
const TYPES = ['ghoul', 'hound', 'wraith', 'lurker', 'imp', 'knight', 'cultist'];
const calm = { spawnBase: 0, spawnHeat: 0 };

// ---- 1. TTK
function ttkTrial(type, hl, ml, seed, passive, count) {
  const game = AW.createGame({ seed, config: mkCfg(Object.assign({ startLevel: hl }, calm)) });
  const S = game.state, H = S.hero;
  const [x, y] = openSpot(game, seed); H.x = x; H.y = y; S.respawn = { x, y };
  const ms = []; for (let i = 0; i < count; i++) ms.push(spawn(game, type, ml, x + 110 + i * 14, y + (i % 2 ? 10 : -10)));
  const b = AW.bots.make(bot, { seed });
  const idle = { mx: 0, my: 0, attack: false };
  let t = 0;
  while (t < 60) {
    const obs = game.observe(), ev = game.events();
    game.step(passive ? idle : b.decide(obs, ev), 4); t += 4 / 60;
    if (S.phase !== 'play') return { dead: true, t };
    if (ms.every(m => m.state === 'dead')) return { dead: false, t, hpLeft: H.hp / H.maxHp };
  }
  return { dead: false, t: 60, timeout: true };
}
const on = k => !only || only.includes(k);
if (on('1')) {
console.log('1. TTK (s, median) and hero death %, vs one monster; rows monster type, columns hero lvl/monster lvl  [target 1.5-4]');
const pairs = [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5]];
console.log('type    ' + pairs.map(([h, m]) => `h${h}/m${m}`.padEnd(11)).join(''));
for (const type of TYPES) {
  let line = type.padEnd(8);
  for (const [hl, ml] of pairs) {
    const ts = [], dead = [];
    for (let i = 0; i < n; i++) { const r = ttkTrial(type, hl, ml, 100 + i, false, 1); if (r.dead) dead.push(1); else ts.push(r.t); }
    line += `${f1(median(ts))}${dead.length ? ' d' + Math.round(100 * dead.length / n) + '%' : ''}`.padEnd(11);
  }
  console.log(line);
}

}
// ---- 2. time to die (passive hero)
if (on('2')) {
console.log('\n2. Passive hero vs TWO same-level melee/ranged monsters: seconds to die (median)  [target 8-15 s]');
const lv = [1, 2, 3, 4, 5];
console.log('type    ' + lv.map(l => ('L' + l).padEnd(8)).join(''));
for (const type of TYPES) {
  let line = type.padEnd(8);
  for (const l of lv) {
    const ts = [];
    for (let i = 0; i < Math.min(n, 10); i++) { const r = ttkTrial(type, l, l, 200 + i, true, 2); ts.push(r.t); }
    line += (f1(median(ts)) + (median(ts) >= 59 ? '+' : '')).padEnd(8);
  }
  console.log(line);
}

}
// ---- 3. boss fight length
function bossRuns(name, startLevel) {
  const secs = [], won = [];
  for (let i = 0; i < n; i++) {
    const r = runOne({ bot: name, seed: 1 + i, config: mkCfg({ startLevel }), maxMinutes: 25, stopAfterFirstAttempt: true });
    secs.push(r.firstAttemptSec); won.push(r.firstAttempt === 'won' ? 1 : 0);
  }
  return `${name} startLevel=${startLevel}: first attempt won ${Math.round(100 * won.reduce((a, b) => a + b, 0) / n)}%  awake->end (s) median ${f1(median(secs.filter(v => v != null)))} [p10 ${f1(percentile(secs.filter(v => v != null), .1))} p90 ${f1(percentile(secs.filter(v => v != null), .9))}]`;
}
if (on('3')) {
console.log('\n3. Boss fight length at level 6  [target 45-90 s]');
console.log(' ' + bossRuns('rusher', 6));
console.log(' ' + bossRuns('average', 6));
}

// ---- 4. xp/min
if (on('4')) console.log('\n4. Minutes spent on each level (median over full average runs, 1..' + n + ' seeds)');
if (on('4')) {
  const rows = []; for (let i = 0; i < n; i++) rows.push(runOne({ bot: 'average', seed: 1 + i, config: mkCfg({}), maxMinutes: 25 }));
  let line = '';
  for (let L = 1; L <= 6; L++) {
    const d = rows.map(r => (r.levelMin[L + 1] ?? null) !== null ? r.levelMin[L + 1] - (L === 1 ? 0 : r.levelMin[L] ?? 0) : null).filter(v => v != null);
    line += `L${L}->${L + 1}: ${f1(median(d))} min   `;
  }
  console.log(' ' + line);
}
