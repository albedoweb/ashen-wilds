#!/usr/bin/env node
// LLM playtester. A cheap model picks one macro action about once per game second; the harness executes it
// for 60 ticks. At the end the model writes a short playtest report; the run goes to playtests/<date>-seed<N>.md.
//   node tools/llm_play.mjs --seed 3 --minutes 12 [--provider deepseek|openrouter] [--model M] [--max-cost 0.5]
//        [--price-in 0.30] [--price-out 1.20] [--endpoint URL] [--set k=v] [--dry-run] [--runs N]
//   --runs N plays seeds S..S+N-1 sequentially (one report each + playtests/<date>-summary.md); --max-cost is global.
// The key is read in code (env DEEPSEEK_API_KEY / OPENROUTER_API_KEY, only; no key files); never printed or put in argv.
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { AW, ROOT } from './lib.mjs';

dns.setDefaultResultOrder('ipv4first');

const argv = process.argv.slice(2);
const o = { seed: 1, minutes: 12, provider: 'deepseek', model: null, endpoint: null, maxCost: 0.5, priceIn: 0.30, priceOut: 1.20, dry: false, runs: 1, maxTokens: 300, sets: [], config: null, out: path.join(ROOT, 'playtests') };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], nx = () => argv[++i];
  if (a === '--seed') o.seed = +nx(); else if (a === '--minutes') o.minutes = +nx(); else if (a === '--provider') o.provider = nx();
  else if (a === '--model') o.model = nx(); else if (a === '--endpoint') o.endpoint = nx(); else if (a === '--max-cost') o.maxCost = +nx();
  else if (a === '--price-in') o.priceIn = +nx(); else if (a === '--price-out') o.priceOut = +nx(); else if (a === '--dry-run') o.dry = true; else if (a === '--runs') o.runs = Math.max(1, +nx() || 1);
  else if (a === '--set') o.sets.push(nx()); else if (a === '--config') o.config = nx(); else if (a === '--out') o.out = nx();
  else { console.error('unknown arg ' + a); process.exit(2); }
}
const PROV = {
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', env: 'DEEPSEEK_API_KEY', extra: {} },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek/deepseek-v4-flash', env: 'OPENROUTER_API_KEY', extra: { reasoning: { enabled: false } } },
};
const P = PROV[o.provider];
if (!P) { console.error('unknown provider ' + o.provider); process.exit(2); }
const endpoint = o.endpoint || P.endpoint, model = o.model || P.model;

function readKey() {
  return process.env[P.env] ? process.env[P.env].trim() : null;
}
const KEY = o.dry ? null : readKey();
if (!o.dry && !KEY) { console.error(`no API key: set the ${P.env} environment variable (or use --dry-run)`); process.exit(2); }

// ---------------------------------------------------------------- game
const cfg = o.config ? JSON.parse(fs.readFileSync(o.config, 'utf8')) : {};
for (const s of o.sets) { const k = s.indexOf('='); AW.setConfigPath(cfg, s.slice(0, k), s.slice(k + 1)); }
let game, S;
const DIRS = { E: 0, SE: 1, S: 2, SW: 3, W: 4, NW: 5, N: 6, NE: 7 };
const dirWord = (dx, dy) => AW.compass(dx, dy).dir;
let logLines, recent, mem, metrics;
let spent = 0; // cost of finished runs (the --max-cost cap is global)
const newMetrics = () => ({ levelMin: {}, firstSignMin: null, bossAwakeMin: null, fallbacks: 0, fail: { empty: 0, reasoning_only: 0, bad_json: 0, no_action: 0, api: 0 }, calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, macros: {} });

function note(e) {
  const m = (e.t / 60).toFixed(1) + 'min';
  let s = null;
  switch (e.type) {
    case 'levelup': s = `level ${e.level}`; metrics.levelMin[e.level] = e.t / 60; break;
    case 'rung': s = `rung: ${e.name}`; break;
    case 'death': s = `died (${e.by})`; break;
    case 'respawn': s = 'respawned'; break;
    case 'sign': s = `sign (${e.kind}): ${e.text}`; if (!e.camp && metrics.firstSignMin === null) metrics.firstSignMin = e.t / 60; break;
    case 'hint': s = e.text; break;
    case 'whisper': case 'warning': case 'damnation_warning': case 'boss_phase': s = `"${e.text}"`; break;
    case 'bonfire': s = 'bonfire lit'; break;
    case 'boss_awake': s = 'Morhain wakes'; if (metrics.bossAwakeMin === null) metrics.bossAwakeMin = e.t / 60; break;
    case 'victory': case 'damnation': s = `ENDING ${e.ending}`; break;
  }
  if (s) { logLines.push(`- ${m}: ${s}`); recent.push(s); if (recent.length > 6) recent.shift(); }
}

// ---------------------------------------------------------------- macro actions
function steerTo(p, tx, ty) {
  let dx = tx - p.x, dy = ty - p.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  if (mem.detour > 0) { mem.detour--; const a = Math.atan2(dy, dx) + mem.sign * 1.3; dx = Math.cos(a); dy = Math.sin(a); }
  return [dx, dy];
}
function macroAction(obs, mac) {
  const p = obs.player, act = { mx: 0, my: 0, run: false, attack: false, ability: null };
  const foes = obs.monsters.filter(m => m.state !== 'dead');
  const bossO = obs.boss && obs.boss.awake ? { x: obs.boss.x, y: obs.boss.y, dist: obs.boss.dist } : null;
  let target = foes[0] || null;
  if (bossO && (!target || bossO.dist < target.dist)) target = bossO;
  const go = (tx, ty, run = true) => { const [mx, my] = steerTo(p, tx, ty); act.mx = mx; act.my = my; act.run = run; };
  switch (mac.action) {
    case 'fight':
      if (target) { if (target.dist > 20) go(target.x, target.y); act.attack = target.dist < 34; }
      break;
    case 'flee': {
      const b = obs.bonfires.slice().sort((a, c) => a.dist - c.dist)[0];
      if (b && b.dist > 20) go(b.x, b.y);
      else if (target) { act.mx = (p.x - target.x) / (target.dist || 1); act.my = (p.y - target.y) / (target.dist || 1); act.run = true; }
      break;
    }
    case 'follow_trail':
      if (obs.trail) { act.mx = obs.trail.dirVec.x; act.my = obs.trail.dirVec.y; act.run = true; } else { act.mx = 1; act.run = true; }
      break;
    case 'explore': {
      const k = DIRS[(mac.arg || 'E').toUpperCase()] ?? 0, a = k * Math.PI / 4;
      act.mx = Math.cos(a); act.my = Math.sin(a); act.run = true; break;
    }
    case 'rest': break;
    case 'approach_boss': {
      const B = obs.boss;
      if (B) { if (B.dist > 60) go(B.x, B.y); }
      else if (obs.trail) { act.mx = obs.trail.dirVec.x; act.my = obs.trail.dirVec.y; act.run = true; }
      break;
    }
    case 'fight_boss': {
      const B = obs.boss;
      if (B) { if (B.dist > 55) go(B.x, B.y); act.attack = B.dist < 80; if (B.awake && ['dash', 'nova', 'wrath'].includes(mac.arg)) act.ability = mac.arg; }
      break;
    }
    case 'ability':
      act.ability = ['dash', 'nova', 'wrath'].includes(mac.arg) ? mac.arg : null;
      if (target) { if (target.dist > 20) go(target.x, target.y); act.attack = target.dist < 34; }
      break;
    case 'goto_sign': { const s = obs.signs.slice().sort((a, c) => a.dist - c.dist)[0]; if (s) go(s.x, s.y); break; }
    case 'goto_bonfire': { const b = obs.bonfires.slice().sort((a, c) => a.dist - c.dist)[0]; if (b && b.dist > 20) go(b.x, b.y); break; }
  }
  return act;
}
function runMacro(mac) {
  let first = true;
  for (let i = 0; i < 15 && S.phase !== 'won' && S.phase !== 'damned'; i++) {
    const obs = game.observe();
    mem.pos.push([obs.player.x, obs.player.y]); if (mem.pos.length > 9) mem.pos.shift();
    const act = macroAction(obs, mac);
    if (!first) act.ability = null; first = false;
    if (mem.pos.length === 9 && mem.detour <= 0 && (act.mx || act.my) && Math.hypot(mem.pos[0][0] - obs.player.x, mem.pos[0][1] - obs.player.y) < 8) { mem.detour = 14; mem.sign = Math.random() < .5 ? 1 : -1; mem.pos.length = 0; }
    game.step(act, 4);
    for (const e of game.events()) note(e);
  }
}

// ---------------------------------------------------------------- compact state for the model
function stateText(obs) {
  const p = obs.player, ab = p.abilities;
  const L = [];
  L.push(`time ${(obs.t / 60).toFixed(1)} min | HP ${Math.ceil(p.hp)}/${p.maxHp} | level ${p.level} (xp ${p.xp}/${p.xpNext}) | power: ${AW.DEFAULT_CONFIG.rungs[p.rung].name}, humanity ${p.humanity} | ${p.biome}${p.inWater ? ' (in water)' : ''}`);
  L.push('abilities: ' + ['dash', 'nova', 'wrath'].map(k => ab[k].unlocked ? `${k} ${ab[k].active ? 'ACTIVE' : ab[k].cd > 0 ? ab[k].cd.toFixed(0) + 's' : 'ready'}` : `${k} locked`).join(', '));
  if (obs.phase === 'dead') L.push('YOU ARE DEAD, respawning at the last fire');
  const en = obs.monsters.filter(m => m.state !== 'dead').slice(0, 6).map(m => `${m.type} L${m.level} ${Math.round(m.dist)}px ${dirWord(m.x - p.x, m.y - p.y)} ${m.hp}/${m.maxHp}hp${m.state === 'windup' ? ' WINDING UP' : ''}`);
  L.push('enemies: ' + (en.length ? en.join('; ') : 'none'));
  if (obs.boss) L.push(`BOSS Morhain in sight: ${Math.round(obs.boss.dist)}px ${dirWord(obs.boss.x - p.x, obs.boss.y - p.y)}, hp ${obs.boss.hp}/${obs.boss.maxHp}, ${obs.boss.awake ? 'AWAKE phase ' + obs.boss.phase + (obs.boss.state === 'nova' ? ' (casting nova, dash away!)' : '') : 'asleep (he wakes when you come close, about 170px)'}`);
  else L.push('Morhain: not in sight (the lair is far; follow the signs)');
  L.push('trail hint: ' + (obs.trail ? `${obs.trail.dir} (sign said ${obs.trail.temp})` : 'none yet'));
  L.push('warmth (live distance to Morhain): ' + ['cold', 'cool', 'warm', 'hot', 'burning'][obs.player.warmth || 0]);
  const sg = obs.signs.slice().sort((a, b) => a.dist - b.dist).slice(0, 2).map(s => `${s.kind} ${Math.round(s.dist)}px ${dirWord(s.x - p.x, s.y - p.y)}`);
  L.push('unread signs nearby: ' + (sg.length ? sg.join('; ') : 'none'));
  const bf = obs.bonfires.slice().sort((a, b) => a.dist - b.dist).slice(0, 2).map(b => `${Math.round(b.dist)}px ${dirWord(b.x - p.x, b.y - p.y)}${b.lit ? '' : ' (unlit)'}`);
  L.push('bonfires: ' + (bf.length ? bf.join('; ') : 'none near'));
  L.push('recent events: ' + (recent.length ? recent.join(' | ') : 'none'));
  return L.join('\n');
}
// The state text above must never expose obs.debug (lair position, etc.).
const SYSTEM = `You are playtesting a top-down dark-fantasy action game, "Ashen Wilds". You play the Mourner, whose loved one Ilse was carried off by the priest Morhain. Morhain waits at a hidden lair far away. Signs found in the world (ribbons, candle circles, crows, blood) tell which compass direction the lair lies in and get warmer as you get closer. You gain levels and new powers by killing monsters. Being too weak against Morhain is deadly, but grinding forever has a price of its own. You do not know exact numbers; judge from what you see.
Each turn you choose ONE macro action, which runs for one second of game time. Reply with exactly one short JSON object and nothing else, e.g. {"action":"fight","arg":"","why":"short reason"}.
Actions: fight (attack the nearest enemy), flee (run to the nearest bonfire, or away), follow_trail (walk along the latest trail hint), explore (arg is one of N NE E SE S SW W NW), rest (stand still, you heal slowly; bonfires heal fast), ability (arg dash, nova or wrath; used on the nearest enemy), goto_sign (walk to the nearest unread sign), goto_bonfire (run to the nearest bonfire to heal; use it when hurt), approach_boss (walk to Morhain; only works when the BOSS line shows him in sight, which is within about 600px; this is how you wake him), fight_boss (attack Morhain; arg dash, nova or wrath optionally uses an ability on him; keep distance from his nova).
Play to find and defeat Morhain, like a careful but curious human player. When you have levelled enough and his lair is in sight, walk up to him with approach_boss and fight him with fight_boss.`;

// ---------------------------------------------------------------- model calls
const redact = t => String(t).split(KEY || '\u0000').join('***');
async function chat(messages, maxTokens) {
  const body = { model, messages, max_tokens: maxTokens, temperature: 0.7, ...P.extra };
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' ' + redact((await r.text()).slice(0, 200))); continue; }
      const j = await r.json();
      const u = j.usage || {};
      metrics.calls++; metrics.tokensIn += u.prompt_tokens || 0; metrics.tokensOut += u.completion_tokens || 0;
      metrics.cost = metrics.tokensIn * o.priceIn / 1e6 + metrics.tokensOut * o.priceOut / 1e6;
      const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
      return { content: msg.content || '', reasoning: !!(msg.reasoning_content || msg.reasoning), finish: j.choices && j.choices[0] && j.choices[0].finish_reason };
    } catch (e) { lastErr = e; }
  }
  throw new Error('model call failed: ' + redact(lastErr && lastErr.message));
}
const MACROS = ['fight', 'flee', 'follow_trail', 'explore', 'rest', 'ability', 'goto_sign', 'goto_bonfire', 'approach_boss', 'fight_boss'];
// returns { mac } or { fail: kind }
function parseMacro(r) {
  const text = r.content;
  if (!text || !text.trim()) return { fail: r.reasoning ? 'reasoning_only' : 'empty' };
  const m = text.match(/\{[\s\S]*?\}/);
  let sawJson = false;
  if (m) { sawJson = true; try { const j = JSON.parse(m[0]); if (MACROS.includes(j.action)) return { mac: { action: j.action, arg: String(j.arg || '') } }; } catch (e) { sawJson = false; } }
  const lower = text.toLowerCase();
  for (const a of MACROS.slice().sort((x, y) => y.length - x.length)) if (lower.includes(a)) { const arg = (lower.match(/\b(dash|nova|wrath)\b/) || lower.match(/"arg"\s*:\s*"(\w+)"/) || [])[1] || ''; return { mac: { action: a, arg } }; }
  return { fail: sawJson ? 'no_action' : 'bad_json' };
}
// trivial local policy for --dry-run
function dryPolicy(obs) {
  const p = obs.player, near = obs.monsters.filter(m => m.state !== 'dead' && m.dist < 110);
  if (obs.phase === 'dead') return { action: 'rest', arg: '' };
  if (obs.boss && p.level >= 8) return obs.boss.dist < 90 ? { action: 'fight_boss', arg: 'nova' } : { action: 'approach_boss', arg: '' };
  if (near.length) return { action: p.abilities.nova.unlocked && p.abilities.nova.cd <= 0 && near.length > 1 ? 'ability' : 'fight', arg: 'nova' };
  if (p.hp < p.maxHp * 0.4) return { action: 'rest', arg: '' };
  if (obs.signs.length) return { action: 'goto_sign', arg: '' };
  return obs.trail ? { action: 'follow_trail', arg: '' } : { action: 'explore', arg: 'NE' };
}

// ---------------------------------------------------------------- one run
async function playSeed(seed) {
  game = AW.createGame({ seed, config: cfg }); S = game.state;
  logLines = []; recent = []; mem = { pos: [], detour: 0, sign: 1 }; metrics = newMetrics();
  const maxTicks = Math.round(o.minutes * 3600);
  let last = { action: 'explore', arg: 'E' }; const history = [];
  let stopReason = 'time';
  while (S.tick < maxTicks && S.phase !== 'won' && S.phase !== 'damned') {
    const obs = game.observe();
    let mac;
    if (o.dry) mac = dryPolicy(obs);
    else {
      if (spent + metrics.cost >= o.maxCost) { stopReason = 'cost cap'; break; }
      const user = stateText(obs) + '\nrecent actions: ' + (history.slice(-5).join(', ') || 'none') + '\nYour next action (JSON only):';
      const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
      let res;
      try { res = parseMacro(await chat(msgs, o.maxTokens)); } catch (e) { console.error(e.message); metrics.fail.api++; stopReason = 'api error'; break; }
      mac = res.mac;
      if (!mac) { metrics.fallbacks++; metrics.fail[res.fail]++; mac = last; }
    }
    last = mac; history.push(mac.action + (mac.arg ? ':' + mac.arg : ''));
    metrics.macros[mac.action] = (metrics.macros[mac.action] || 0) + 1;
    runMacro(mac);
    if (S.tick % 3600 < 60) process.stderr.write(`t=${(S.t / 60).toFixed(1)}min lvl ${S.hero.level} cost $${(spent + metrics.cost).toFixed(3)}\r`);
  }
  for (const e of game.events()) note(e);

  const st = S.stats;
  const outcome = S.phase === 'won' ? (S.ending === 'walk_home' ? 'won (walk home)' : 'won (the new master)') : S.phase === 'damned' ? 'fell (damnation)' : `unfinished (${stopReason})`;
  let report = '(dry run: no model report)', ratings = null;
  if (!o.dry) {
    if (spent + metrics.cost < o.maxCost) {
      const summary = `Outcome: ${outcome}. Game time ${(S.t / 60).toFixed(1)} min, final level ${S.hero.level}, kills ${st.kills}, deaths ${st.deaths}, signs read ${st.signsFound}, boss attempts ${st.bossAttempts}.\nKey events:\n` + logLines.slice(-60).join('\n');
      try {
        const r = await chat([{ role: 'system', content: SYSTEM.split('\n')[0] }, { role: 'user', content: `${summary}\n\nWrite a short playtest report (under 250 words) as the player: moments that were boring, unfair or confusing; whether the signs made sense and pointed the way; whether the difficulty and levelling felt right; one concrete suggestion. Plain text.\nThen, on the very last line, give ratings from 1 (bad) to 5 (good) as JSON only: {"pacing":N,"fairness":N,"clarity_of_trail":N}` }], 1500);
        report = r.content || '(the model returned an empty report)';
        const rm = report.match(/\{[^{}]*"pacing"[^{}]*\}/);
        if (rm) { try { const j = JSON.parse(rm[0]); ratings = { pacing: +j.pacing, fairness: +j.fairness, clarity_of_trail: +j.clarity_of_trail }; report = report.replace(rm[0], '').trim(); } catch (e) { /* none */ } }
      } catch (e) { report = '(report call failed: ' + e.message + ')'; }
    } else report = '(cost cap reached before the report)';
  }
  spent += metrics.cost;
  const decisions = Math.max(1, Object.values(metrics.macros).reduce((a, b) => a + b, 0));
  const fbRate = o.dry ? 0 : metrics.fallbacks / decisions;
  fs.mkdirSync(o.out, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(o.out, `${date}-seed${seed}${o.dry ? '-dry' : ''}.md`);
  const lm = Object.entries(metrics.levelMin).map(([l, m]) => `L${l} ${m.toFixed(1)}`).join(', ') || '-';
  const rt = ratings ? `pacing ${ratings.pacing}, fairness ${ratings.fairness}, clarity of the trail ${ratings.clarity_of_trail} (1-5)` : '-';
  const fk = Object.entries(metrics.fail).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ') || 'none';
  const md = `# Playtest: seed ${seed}${o.dry ? ' (dry run)' : ''}

- Date: ${date}
- Player: ${o.dry ? 'local trivial policy (no model)' : `${model} via ${o.provider}`}
- Outcome: **${outcome}**
- Ratings: ${rt}
- Ratings JSON: ${ratings ? JSON.stringify(ratings) : 'null'}
- Game time: ${(S.t / 60).toFixed(1)} min of ${o.minutes} allowed
- Level reached: ${S.hero.level} (${lm} min)
- Kills ${st.kills}, deaths ${st.deaths}, signs read ${st.signsFound}, first sign ${metrics.firstSignMin === null ? '-' : metrics.firstSignMin.toFixed(1) + ' min'}, Morhain awake ${metrics.bossAwakeMin === null ? '-' : metrics.bossAwakeMin.toFixed(1) + ' min'}, boss attempts ${st.bossAttempts}
- Model calls ${metrics.calls}, tokens in/out ${metrics.tokensIn}/${metrics.tokensOut}, estimated cost $${metrics.cost.toFixed(4)} (cap $${o.maxCost} total; $${o.priceIn}/$${o.priceOut} per 1M)
- Unparseable or empty answers replaced by the previous action: ${metrics.fallbacks} (${(fbRate * 100).toFixed(1)}%; kinds: ${fk})
- Macro use: ${Object.entries(metrics.macros).map(([k, v]) => k + ' ' + v).join(', ')}
- Compare with the \`average\` bot on the same seed: \`node tools/sim.mjs --bot average --runs 1 --seed ${seed}\`

## The player's report

${report}

## Event log

${logLines.slice(0, 200).join('\n')}
`;
  fs.writeFileSync(file, md);
  console.log(`\nseed ${seed}: ${outcome}; level ${S.hero.level}; calls ${metrics.calls}; cost $${metrics.cost.toFixed(4)}; fallbacks ${metrics.fallbacks} (${(fbRate * 100).toFixed(1)}%; ${fk})\nreport: ${file}`);
  return { seed, outcome, level: S.hero.level, minutes: S.t / 60, cost: metrics.cost, calls: metrics.calls, fbRate, fk, ratings, stopReason };
}

const results = [];
for (let i = 0; i < o.runs; i++) {
  if (!o.dry && spent >= o.maxCost) { console.log('global cost cap reached; stopping before seed ' + (o.seed + i)); break; }
  results.push(await playSeed(o.seed + i));
}
if (o.runs > 1 && results.length) {
  const date = new Date().toISOString().slice(0, 10);
  const f = path.join(o.out, `${date}-summary${o.dry ? '-dry' : ''}.md`);
  const rows = results.map(r => `| ${r.seed} | ${r.outcome} | ${r.level} | ${r.minutes.toFixed(1)} | $${r.cost.toFixed(4)} | ${r.calls} | ${(r.fbRate * 100).toFixed(1)}% | ${r.ratings ? `${r.ratings.pacing}/${r.ratings.fairness}/${r.ratings.clarity_of_trail}` : '-'} |`);
  fs.writeFileSync(f, `# LLM playtest summary ${date}\n\n- Model: ${o.dry ? 'dry run' : model + ' via ' + o.provider}; seeds ${o.seed}..${o.seed + results.length - 1}; total cost $${spent.toFixed(4)} (cap $${o.maxCost})\n\n| seed | outcome | level | game min | cost | calls | fallback | ratings pacing/fairness/trail |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
  console.log('summary: ' + f);
}
