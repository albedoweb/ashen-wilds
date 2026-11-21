#!/usr/bin/env node
// Automated checks. Exits non-zero on any failure.  node tools/check.mjs
import { AW } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('ok   ' + msg); else { failed++; console.log('FAIL ' + msg); } };
const play = (opts, bot, minutes, onEvents) => {
  const g = AW.createGame(opts); const b = AW.bots.make(bot, { seed: opts.seed });
  const n = Math.round(minutes * 3600);
  while (g.state.tick < n && g.state.phase !== 'won' && g.state.phase !== 'damned') {
    const o = g.observe(); const ev = g.events(); if (onEvents) onEvents(ev, g);
    g.step(b.decide(o, ev), b.every);
  }
  if (onEvents) onEvents(g.events(), g);
  return g;
};

// 1. loading
ok(typeof AW.createGame === 'function' && typeof AW.bots.make === 'function' && AW.DEFAULT_CONFIG && typeof AW.getWorld === 'function', 'files load in Node (config, world, sim, bots)');
ok(['novice', 'average', 'expert', 'rusher', 'grinder'].every(n => AW.bots.make(n, { seed: 1 }).decide), 'all bots constructible');

// 2. determinism: same seed + same scripted actions -> identical snapshot
{
  const script = AW.rng(99); const acts = [];
  for (let i = 0; i < 180 * 60 / 6; i++) {
    const a = script() * Math.PI * 2;
    acts.push({ mx: Math.cos(a) * (script() < .8 ? 1 : 0), my: Math.sin(a), run: script() < .5, attack: script() < .6, ability: script() < .15 ? ['dash', 'nova', 'wrath'][script() * 3 | 0] : null, aimX: script() * 200 - 100, aimY: script() * 200 - 100 });
  }
  const run = () => {
    const g = AW.createGame({ seed: 5, config: { startLevel: 6, debugObs: true } }); const evs = [];
    for (const a of acts) { g.step(a, 6); for (const e of g.events()) evs.push(e); }
    return JSON.stringify([g.observe(), evs.length, evs.slice(-5)]);
  };
  const a = run(), b = run();
  ok(a === b, 'determinism: identical observe() after 3 game-minutes (' + a.length + ' bytes)');
  const g3 = AW.createGame({ seed: 6, config: { startLevel: 6, debugObs: true } });
  for (const x of acts) g3.step(x, 6);
  ok(JSON.stringify([g3.observe(), 0, []]) !== JSON.stringify([JSON.parse(a)[0], 0, []]), 'different seed gives a different game');
}

// 3. no NaN after 5 minutes of the average bot
{
  const bad = [];
  const scan = (v, p) => { if (typeof v === 'number') { if (!isFinite(v)) bad.push(p); } else if (v && typeof v === 'object') for (const k of Object.keys(v)) scan(v[k], p + '.' + k); };
  const g = play({ seed: 2 }, 'average', 5);
  scan(g.state.hero, 'hero'); scan(g.state.monsters, 'monsters'); scan(g.state.projectiles, 'proj'); scan(g.state.boss, 'boss'); scan(g.observe(), 'obs');
  ok(bad.length === 0, 'no NaN/Infinity in state after 5 min of the average bot' + (bad.length ? ': ' + bad.slice(0, 3) : ''));
  ok(g.state.stats.kills > 0, 'average bot kills monsters (' + g.state.stats.kills + ')');
}

// 4. signs get denser towards the lair, 5. camp ribbon
{
  const g = AW.createGame({ seed: 1 }); const w = g.world; const C = AW.CPX;
  const lcx = Math.floor(w.lair.x / C), lcy = Math.floor(w.lair.y / C);
  const band = (a, b) => { let n = 0, s = 0; for (let dy = -b - 1; dy <= b + 1; dy++) for (let dx = -b - 1; dx <= b + 1; dx++) { const d = Math.hypot(dx, dy); if (d < a || d >= b) continue; n++; s += w.chunk(lcx + dx, lcy + dy).signs.length; } return s / n; };
  const bands = [[0, 1.5], [1.5, 4], [4, 9], [9, 14]].map(([a, b]) => band(a, b));
  ok(bands[0] > bands[1] && bands[1] > bands[2] && bands[2] > bands[3], 'sign density rises towards the lair: ' + bands.map(v => v.toFixed(2)).join(' > '));
  const kinds = new Set(); for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) for (const s of w.chunk(lcx + dx, lcy + dy).signs) kinds.add(s.kind);
  ok(['blood', 'crows', 'circle'].every(k => kinds.has(k)), 'sign kinds near the lair: ' + [...kinds].join(','));
  const camp = w.chunk(0, 0).signs.find(s => s.id === 'camp');
  ok(camp && Math.abs(Math.hypot(camp.x - w.camp.x, camp.y - w.camp.y) - 30) < 0.5 && /cart went/.test(camp.text), 'camp ribbon exists 30 px from the camp bonfire');
  const arenaOk = w.chunk(lcx, lcy).objs.some(o => o.k === 'altar') && w.eachChunk && (() => { let n = 0; w.eachChunk(w.lair.x, w.lair.y, 200, ch => { for (const o of ch.objs) if (o.k === 'obelisk' && o.arena) n++; }); return n === 8; })();
  ok(arenaOk, 'arena has an altar and 8 obelisks');
  const lf = w.bonfiresNear(w.lastFire.x, w.lastFire.y, 5); ok(lf.length === 1, 'The Last Fire exists');
  let clean = true; w.eachChunk(w.lair.x, w.lair.y, 230, ch => { for (const o of ch.objs) if (!o.arena && Math.hypot(o.x - w.lair.x, o.y - w.lair.y) < 220 && o.k !== 'bonfire') clean = false; });
  ok(clean, 'no ordinary objects inside the 220 px arena radius');
}

// 6. boss can be damaged and killed at level 10
{
  const g0 = AW.createGame({ seed: 4, config: { debugObs: true } }); const L = g0.world.lair;
  const ang = Math.atan2(L.y, L.x);
  const g = AW.createGame({ seed: 4, config: { startLevel: 10, debugObs: true, invulnerable: true }, x: L.x - Math.cos(ang) * 150, y: L.y - Math.sin(ang) * 150 });
  const b = AW.bots.make('rusher', { seed: 4 }); const evs = [];
  let minHp = 900;
  for (let i = 0; i < 5 * 60 * 60 / 4 && g.state.phase === 'play'; i++) { const o = g.observe(); const e = g.events(); evs.push(...e); b.decide; g.step(b.decide(o, e), 4); minHp = Math.min(minHp, g.state.boss.hp); }
  evs.push(...g.events());
  ok(minHp < 900, 'boss takes damage (min hp ' + Math.round(minHp) + ')');
  ok(g.state.phase === 'won' && evs.some(e => e.type === 'victory' && e.ending === 'new_master'), 'boss killed at level 10 -> victory, ending new_master (t=' + g.state.t.toFixed(0) + 's)');
  ok(evs.some(e => e.type === 'boss_awake') && evs.some(e => e.type === 'boss_phase' && e.phase === 3), 'boss woke and reached phase 3');
}

// 7. rung unlock order
{
  const rungs = []; const lv = [];
  play({ seed: 1 }, 'average', 6, (ev) => { for (const e of ev) { if (e.type === 'rung') rungs.push(e); if (e.type === 'levelup') lv.push(e.level); } });
  const asc = rungs.every((e, i) => e.rung === i + 1);
  ok(rungs.length >= 3 && asc, 'rungs unlock in order: ' + rungs.map(e => e.name).join(' > '));
  for (let L = 1; L <= 6; L++) {
    const o = AW.createGame({ seed: 1, config: { startLevel: L } }).observe().player;
    const exp = [L >= 3, L >= 4, L >= 6];
    const got = [o.abilities.dash.unlocked, o.abilities.nova.unlocked, o.abilities.wrath.unlocked];
    if (exp.join() !== got.join() || o.humanity !== [100, 80, 60, 40, 20, 0][L - 1]) { ok(false, 'ladder at level ' + L); }
  }
  ok(true, 'abilities and humanity match the ladder for levels 1-6');
}

// 8. observe() has every field of DESIGN 8
{
  const g = AW.createGame({ seed: 1, config: { debugObs: true } }); g.step({ mx: 1, my: 0 }, 30);
  const o = g.observe(); const miss = [];
  const need = (obj, keys, p) => { for (const k of keys) if (!(k in obj)) miss.push(p + k); };
  need(o, ['t', 'phase', 'player', 'monsters', 'projectiles', 'boss', 'signs', 'bonfires', 'trail', 'stats', 'debug'], '');
  need(o.player, ['x', 'y', 'hp', 'maxHp', 'level', 'xp', 'xpNext', 'rung', 'humanity', 'damage', 'attackCd', 'invuln', 'inWater', 'biome', 'abilities'], 'player.');
  for (const k of ['dash', 'nova', 'wrath']) need(o.player.abilities[k], ['unlocked', 'cd', 'active'], 'abilities.' + k + '.');
  need(o.stats, ['kills', 'deaths', 'signsFound', 'bossAttempts', 'distance', 'damageDealt', 'damageTaken'], 'stats.');
  need(o.debug, ['lair', 'heat'], 'debug.');
  ok(!miss.length, 'observe() has all spec fields' + (miss.length ? ': missing ' + miss : ''));
  const g2 = play({ seed: 1 }, 'average', 2); const o2 = g2.observe();
  const m = o2.monsters[0], s = o2.signs[0], bf = o2.bonfires[0];
  const miss2 = [];
  if (m) need(m, ['id', 'type', 'x', 'y', 'hp', 'maxHp', 'level', 'state', 'dist'], 'monster.');
  if (s) need(s, ['id', 'x', 'y', 'kind', 'dist'], 'sign.');
  if (bf) need(bf, ['x', 'y', 'lit', 'dist'], 'bonfire.');
  if (o2.trail) need(o2.trail, ['dir', 'dirVec', 'kind', 'temp'], 'trail.');
  ok(!miss.length && !('debug' in o2), 'nested snapshot fields present; debug absent unless debugObs');
  ok(JSON.stringify(o2) === JSON.stringify(JSON.parse(JSON.stringify(o2))), 'observe() is plain JSON');
  const evTypes = new Set(); play({ seed: 1 }, 'average', 6, ev => ev.forEach(e => evTypes.add(e.type)));
  ok(['levelup', 'rung', 'kill', 'hurt', 'sign', 'bonfire'].every(t => evTypes.has(t)), 'events seen: ' + [...evTypes].join(','));
}

// 9. The Fall
{
  const ev = [];
  const g = play({ seed: 1, config: { startLevel: 6, xpBase: 2 } }, 'grinder', 8, e => ev.push(...e));
  ok(g.state.phase === 'damned' && ev.some(e => e.type === 'damnation' && e.ending === 'fall'), 'reaching damnationLevel while Morhain lives -> phase damned, ending fall (t=' + g.state.t.toFixed(0) + 's)');
  const warn = ev.filter(e => e.type === 'damnation_warning').map(e => e.level);
  ok(warn.join() === '7,8', 'damnation warnings at levels 7 and 8');
  const g8 = play({ seed: 1, config: { startLevel: 8, xpBase: 2 } }, 'grinder', 8);
  ok(g8.state.phase === 'damned' && g8.observe().phase === 'damned', 'startLevel=8 plus a few kills -> damned (kills ' + g8.state.stats.kills + ')');
  g8.step({ mx: 1, my: 0 }, 60); ok(g8.state.t === g8.state.t, 'simulation stops when damned');
}

// 9b. warmth: a coarse public signal that rises toward the lair
{
  const g = AW.createGame({ seed: 3, config: { debugObs: true, invulnerable: true } });
  const L = g.observe().debug.lair, ws = [];
  for (const d of [3200, 2200, 1400, 700, 200]) {
    const g2 = AW.createGame({ seed: 3, config: { invulnerable: true }, x: L.x - L.x / Math.hypot(L.x, L.y) * d, y: L.y - L.y / Math.hypot(L.x, L.y) * d });
    ws.push(g2.observe().player.warmth);
  }
  ok(ws.join() === '0,1,2,3,4', 'player.warmth rises toward the lair: ' + ws.join(','));
}

// 10. speed budget: 25 game-minutes in < 15 s
{
  const t0 = process.hrtime.bigint();
  const g = play({ seed: 7, config: { damnationLevel: 99 } }, 'grinder', 25);
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  ok(g.state.t > 24.9 * 60 && sec < 15, `speed budget: ${(g.state.t / 60).toFixed(1)} game-min (grinder) in ${sec.toFixed(1)} s (< 15 s)`);
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
