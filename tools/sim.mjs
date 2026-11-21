#!/usr/bin/env node
// Headless harness. node tools/sim.mjs --bot average --runs 30 --seed 1 --max-minutes 25
//   [--config f.json] [--set k=v ...] [--sweep key=a,b,c] [--json out.json] [--quiet]
import fs from 'node:fs';
import { AW, runOne, aggregate } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = { bot: 'average', runs: 30, seed: 1, maxMinutes: 25, sets: [], json: null, config: null, sweep: null, quiet: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const nx = () => argv[++i];
  if (a === '--bot') opt.bot = nx();
  else if (a === '--runs') opt.runs = +nx();
  else if (a === '--seed') opt.seed = +nx();
  else if (a === '--max-minutes') opt.maxMinutes = +nx();
  else if (a === '--config') opt.config = nx();
  else if (a === '--set') opt.sets.push(nx());
  else if (a === '--sweep') opt.sweep = nx();
  else if (a === '--json') opt.json = nx();
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '--help') { console.log('see docs/API.md'); process.exit(0); }
  else { console.error('unknown arg ' + a); process.exit(2); }
}

function baseConfig() {
  const cfg = opt.config ? JSON.parse(fs.readFileSync(opt.config, 'utf8')) : {};
  for (const s of opt.sets) { const k = s.indexOf('='); AW.setConfigPath(cfg, s.slice(0, k), s.slice(k + 1)); }
  return cfg;
}
const f1 = v => v === null || v === undefined ? '-' : (Math.round(v * 10) / 10).toString();
const f2 = v => v === null || v === undefined ? '-' : (Math.round(v * 100) / 100).toString();

function runBatch(config) {
  const rows = []; const t0 = process.hrtime.bigint();
  for (let i = 0; i < opt.runs; i++) {
    const w0 = process.hrtime.bigint();
    const r = runOne({ bot: opt.bot, seed: opt.seed + i, config, maxMinutes: opt.maxMinutes });
    r.wallMs = Number(process.hrtime.bigint() - w0) / 1e6;
    rows.push(r);
  }
  return { rows, wallMs: Number(process.hrtime.bigint() - t0) / 1e6 };
}
function printRows(rows) {
  console.log('seed  outcome          end/win(min) deaths lvl  L2   L3   L4   L5   L6   1stSign awake att  1stAtt      kills wall(ms)');
  for (const r of rows) {
    const lm = L => f1(r.levelMin[L]).padEnd(4);
    console.log(String(r.seed).padEnd(5), r.outcome.padEnd(16), f1(r.victoryMin ?? r.endMin).padEnd(12), String(r.deaths).padEnd(6), String(r.level).padEnd(4),
      lm(2), lm(3), lm(4), lm(5), lm(6), f1(r.firstSignMin).padEnd(7), f1(r.bossAwakeMin).padEnd(6), String(r.bossAttempts).padEnd(4),
      ((r.firstAttempt || '-') + (r.firstAttemptSec != null ? ' ' + f1(r.firstAttemptSec) + 's' : '')).padEnd(11), String(r.kills).padEnd(5), Math.round(r.wallMs));
  }
}
const S3 = s => `${f1(s.med)} [${f1(s.p10)}..${f1(s.p90)}] n=${s.n}`;
function printAgg(a) {
  console.log('\nAGGREGATE (median [p10..p90] n)');
  console.log(' runs', a.runs, ' outcomes', JSON.stringify(a.outcomes));
  console.log(` win ${f1(a.winPct)}%  walk_home ${f1(a.walkHomePct)}%  fall ${f1(a.fallPct)}%`);
  console.log(' time to victory (min):', S3(a.victoryMin));
  console.log(' time to fall (min):   ', S3(a.fallMin));
  console.log(' deaths:               ', S3(a.deaths));
  console.log(' level at end:         ', S3(a.level));
  for (let L = 2; L <= 6; L++) console.log(` level ${L} reached (min):`.padEnd(25), S3(a.levelMin[L]));
  console.log(' first sign (min):     ', S3(a.firstSignMin));
  console.log(' boss awake (min):     ', S3(a.bossAwakeMin));
  console.log(' boss attempts:        ', S3(a.bossAttempts));
  console.log(` first boss attempt: died ${f1(a.firstAttemptDiedPct)}%  won ${f1(a.firstAttemptWonPct)}%  time awake->death (s): ${S3(a.firstAttemptDeathSec)}`);
  console.log(' per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths');
  for (const [k, t] of Object.entries(a.byType)) console.log('  ', k.padEnd(8), String(t.encounters).padEnd(5), String(t.kills).padEnd(5), f2(t.ttkMean).padEnd(6), f2(t.ttkMed).padEnd(6), String(Math.round(t.dmgToHero)).padEnd(7), t.deaths);
}

const t0 = Date.now();
const out = { options: opt, results: [] };
if (opt.sweep) {
  const eq = opt.sweep.indexOf('=');
  const key = opt.sweep.slice(0, eq), vals = opt.sweep.slice(eq + 1).split(',');
  console.log(`SWEEP ${key} over [${vals.join(', ')}], bot ${opt.bot}, ${opt.runs} seeds from ${opt.seed}`);
  console.log('value'.padEnd(10), 'win%  walk%  fall%  victoryMin(med) deaths(med) level(med) L6(med)  awake(med)  1stDied%  wall(s)');
  for (const v of vals) {
    const cfg = baseConfig(); AW.setConfigPath(cfg, key, v);
    const { rows, wallMs } = runBatch(cfg); const a = aggregate(rows);
    out.results.push({ value: v, agg: a, rows });
    console.log(String(v).padEnd(10), f1(a.winPct).padEnd(5), f1(a.walkHomePct).padEnd(6), f1(a.fallPct).padEnd(6), f1(a.victoryMin.med).padEnd(15), f1(a.deaths.med).padEnd(12), f1(a.level.med).padEnd(10), f1(a.levelMin[6].med).padEnd(8), f1(a.bossAwakeMin.med).padEnd(11), f1(a.firstAttemptDiedPct).padEnd(9), f1(wallMs / 1000));
  }
} else {
  const cfg = baseConfig();
  const { rows, wallMs } = runBatch(cfg);
  const a = aggregate(rows);
  if (!opt.quiet) printRows(rows);
  printAgg(a);
  const simMin = rows.reduce((s, r) => s + r.simMin, 0);
  console.log(`\nwall ${f1(wallMs / 1000)} s for ${f1(simMin)} game-minutes (${f1(wallMs / 1000 / simMin * 25)} s per 25 game-min)`);
  out.results.push({ agg: a, rows });
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(out, null, 1));
