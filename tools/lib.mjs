// Shared helpers for the Node tools: load the game scripts, run one bot game, aggregate.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['config', 'world', 'sim', 'bots']) require(path.join(root, 'src', f + '.js'));
export const AW = globalThis.AW;
export const ROOT = root;

export function percentile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
export const median = a => percentile(a, 0.5);

// Play one game with a bot. Returns a result row plus raw telemetry.
export function runOne({ bot: botName, seed, config = {}, maxMinutes = 25, stopAfterFirstAttempt }) {
  const cfg = JSON.parse(JSON.stringify(config));
  if (botName === 'rusher') cfg.debugObs = true;
  if (stopAfterFirstAttempt === undefined) stopAfterFirstAttempt = botName === 'rusher';
  const game = AW.createGame({ seed, config: cfg });
  const bot = AW.bots.make(botName, { seed, params: cfg.aggression ? { aggression: +cfg.aggression } : undefined });
  const S = game.state;
  const maxTicks = Math.round(maxMinutes * 60 * 60);
  const row = {
    seed, bot: botName, outcome: 'timeout', endMin: null, victoryMin: null, deaths: 0, level: 1,
    levelMin: {}, firstSignMin: null, bossAwakeMin: null, bossAttempts: 0, bossKills: 0,
    firstAttempt: null, firstAttemptSec: null, kills: 0, signs: 0,
  };
  let awakeT = null, attemptOpen = false;
  const every = bot.every || 4;
  let guard = 0;
  while (S.tick < maxTicks && S.phase !== 'won' && S.phase !== 'damned') {
    const obs = game.observe();
    const ev = game.events();
    for (const e of ev) {
      if (e.type === 'levelup') row.levelMin[e.level] = e.t / 60;
      else if (e.type === 'sign' && !e.camp && row.firstSignMin === null) row.firstSignMin = e.t / 60;
      else if (e.type === 'boss_awake') {
        if (row.bossAwakeMin === null) row.bossAwakeMin = e.t / 60;
        if (awakeT === null) { awakeT = e.t; attemptOpen = true; }
      } else if (e.type === 'death' && attemptOpen && row.firstAttempt === null && awakeT !== null) {
        row.firstAttempt = 'died'; row.firstAttemptSec = e.t - awakeT;
      } else if (e.type === 'victory' && row.firstAttempt === null) { row.firstAttempt = 'won'; row.firstAttemptSec = e.t - (awakeT || e.t); }
    }
    if (stopAfterFirstAttempt && row.firstAttempt) break;
    const act = bot.decide(obs, ev);
    game.step(act, every);
    if (++guard > 1e7) break;
  }
  for (const e of game.events()) {
    if (e.type === 'victory' && row.firstAttempt === null) { row.firstAttempt = 'won'; row.firstAttemptSec = e.t - (awakeT || e.t); }
  }
  if (S.phase === 'won') { row.outcome = S.ending === 'walk_home' ? 'won_walk_home' : 'won_new_master'; row.victoryMin = S.t / 60; }
  else if (S.phase === 'damned') { row.outcome = 'fall'; row.endMin = S.t / 60; }
  else row.endMin = S.t / 60;
  row.deaths = S.stats.deaths; row.level = S.hero.level; row.bossAttempts = S.stats.bossAttempts; row.bossKills = S.stats.bossKills;
  row.kills = S.stats.kills; row.signs = S.stats.signsFound; row.simMin = S.t / 60;
  row.byType = S.stats.byType;
  return row;
}

export function aggregate(rows) {
  const pick = f => rows.map(f).filter(v => v !== null && v !== undefined && isFinite(v));
  const stat = a => ({ n: a.length, med: median(a), p10: percentile(a, .1), p90: percentile(a, .9) });
  const outcomes = {};
  for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  const wins = rows.filter(r => r.outcome.startsWith('won')).length;
  const agg = {
    runs: rows.length, outcomes,
    winPct: 100 * wins / rows.length,
    fallPct: 100 * (outcomes.fall || 0) / rows.length,
    walkHomePct: 100 * (outcomes.won_walk_home || 0) / rows.length,
    victoryMin: stat(pick(r => r.victoryMin)),
    fallMin: stat(pick(r => r.outcome === 'fall' ? r.endMin : null)),
    deaths: stat(pick(r => r.deaths)),
    level: stat(pick(r => r.level)),
    levelMin: {},
    firstSignMin: stat(pick(r => r.firstSignMin)),
    bossAwakeMin: stat(pick(r => r.bossAwakeMin)),
    bossAttempts: stat(pick(r => r.bossAttempts)),
    firstAttemptDiedPct: 100 * rows.filter(r => r.firstAttempt === 'died').length / rows.length,
    firstAttemptWonPct: 100 * rows.filter(r => r.firstAttempt === 'won').length / rows.length,
    firstAttemptDeathSec: stat(pick(r => r.firstAttempt === 'died' ? r.firstAttemptSec : null)),
    byType: {},
  };
  for (let L = 2; L <= 6; L++) agg.levelMin[L] = stat(pick(r => r.levelMin[L]));
  const types = new Set(); for (const r of rows) for (const k of Object.keys(r.byType)) types.add(k);
  for (const k of types) {
    const t = { encounters: 0, kills: 0, dmgToHero: 0, deaths: 0, ttks: [] };
    for (const r of rows) { const b = r.byType[k]; if (!b) continue; t.encounters += b.encounters; t.kills += b.kills; t.dmgToHero += b.dmgToHero; t.deaths += b.deaths; t.ttks.push(...b.ttks); }
    t.ttkMed = median(t.ttks); t.ttkMean = t.ttks.length ? t.ttks.reduce((a, b) => a + b, 0) / t.ttks.length : null;
    delete t.ttks; agg.byType[k] = t;
  }
  return agg;
}
