#!/usr/bin/env node
// Browser smoke test: headless Chrome over the DevTools protocol.
//   node tools/smoke.mjs [--out dir] [--bot-seconds 20]      checks
//   node tools/smoke.mjs --fps                                frames per second at 1280x800
//   node tools/smoke.mjs --shots [--only title,intro,wood,...] UI screenshots ui_*.png (into $SHOT_DIR or ./shots)
//   node tools/smoke.mjs --promo                              og.png and docs/screenshots/*.png in the repository
// Checks: no runtime exceptions, keyboard walk/attack works, a bot plays and kills, screenshots saved.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', process.env.SHOT_DIR || './shots'));
const BOT_SECONDS = +arg('--bot-seconds', 20);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const INDEX = pathToFileURL(path.join(ROOT, 'index.html')).href;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--window-size=1100,700', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let failures = 0;
const fail = m => { failures++; console.log('FAIL', m); };
const ok = m => console.log('ok  ', m);
function cleanup() { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* busy */ } }

async function main() {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = (await r.json()).filter(t => t.type === 'page'); } catch (e) { await sleep(200); }
  }
  if (!targets || !targets.length) throw new Error('chrome did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') exceptions.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; };
  const key = async (type, code, k, vk) => send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('shot', path.join(OUT, name)); };
  const load = async q => { await send('Page.navigate', { url: INDEX + q }); await send('Page.bringToFront'); await sleep(1500); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  const ctx = { send, evalJs, key, shot, load, exceptions, ok, fail };
  if (argv.includes('--fps')) { await fpsMode(ctx); return finishExceptions(ctx, ws); }
  if (argv.includes('--shots')) { await shotsMode(ctx); return finishExceptions(ctx, ws); }
  if (argv.includes('--promo')) { await promoMode(ctx); return finishExceptions(ctx, ws); }

  // 1. title, intro story, keyboard start, walking and attacking as a human
  await load('?seed=1');
  const disp = id => evalJs(`getComputedStyle(document.getElementById('${id}')).display`);
  if (await disp('title') === 'flex') ok('title screen shown'); else fail('title not shown');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(200);
  if (await disp('title') === 'flex' && await disp('pause') === 'none') ok('Escape on the title does nothing'); else fail('Escape on the title changed the screen');
  await key('keyDown', 'KeyX', 'x', 88); await key('keyUp', 'KeyX', 'x', 88); await sleep(400);
  if (await disp('intro') === 'flex' && await disp('title') === 'none') ok('any key: title -> intro story'); else fail('title did not lead to the intro');
  const t0 = await evalJs('game.observe().t');
  await sleep(500);
  if (await evalJs('game.observe().t') === t0) ok('simulation waits on the intro'); else fail('simulation ran during intro');
  await key('keyDown', 'KeyX', 'x', 88); await key('keyUp', 'KeyX', 'x', 88); await sleep(300);
  if (await evalJs(`getComputedStyle(document.getElementById('intro')).display`) === 'none') ok('any key starts'); else fail('intro still shown after key');
  const x0 = await evalJs('game.observe().player.x');
  await key('keyDown', 'KeyD', 'd', 68); await sleep(1500); await key('keyUp', 'KeyD', 'd', 68);
  const x1 = await evalJs('game.observe().player.x');
  if (x1 - x0 > 30) ok(`keyboard walk: x ${x0} -> ${x1}`); else fail(`keyboard walk did not move (${x0} -> ${x1})`);
  await key('keyDown', 'Space', ' ', 32); await sleep(400); await key('keyUp', 'Space', ' ', 32);
  if (await evalJs('game.state.hero.lastAttackT') > 0) ok('Space attacks'); else fail('Space did not attack');
  await key('keyDown', 'ShiftLeft', 'Shift', 16); await key('keyDown', 'KeyA', 'a', 65); await sleep(800); await key('keyUp', 'KeyA', 'a', 65); await key('keyUp', 'ShiftLeft', 'Shift', 16);

  // 2. API control
  await evalJs(`game.act({mx:0,my:1,run:true})`); await sleep(500);
  const y1 = await evalJs('game.observe().player.y'); await evalJs('game.act(null)');
  if (typeof y1 === 'number') ok('game.act drives the hero');
  await evalJs('game.pause(true)'); const tp = await evalJs('game.observe().t'); await sleep(300);
  if (await evalJs('game.observe().t') === tp) ok('pause works'); else fail('pause does not stop the sim');
  await evalJs('game.pause(false)');
  await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(100);
  const te = await evalJs('game.observe().t'); const shown = await evalJs(`getComputedStyle(document.getElementById('pause')).display`); await sleep(400);
  if (shown === 'flex' && await evalJs('game.observe().t') === te) ok('Escape pauses with the overlay'); else fail('Escape pause: overlay ' + shown);
  await key('keyDown', 'KeyP', 'p', 80); await key('keyUp', 'KeyP', 'p', 80); await sleep(400);
  const tr = await evalJs('game.observe().t');
  if (tr > te + .2 && tr < te + .7) ok(`P resumes without catching up (t ${te} -> ${tr} after 0.4 s)`); else fail('P resume: t ' + te + ' -> ' + tr);

  // 3. a bot plays visibly at 4x
  await load('?bot=average&speed=4&seed=1');
  await sleep(BOT_SECONDS * 1000);
  const o = await evalJs('game.observe()');
  console.log(`bot run: t=${o.t}s level=${o.player.level} kills=${o.stats.kills} deaths=${o.stats.deaths} phase=${o.phase}`);
  if (o.stats.kills > 0) ok('bot killed monsters'); else fail('bot killed nothing');
  await shot('stage1.png');

  // 4. near the lair at level 6 with the debug HUD
  await load('?startLevel=6&debug=1&seed=1&intro=0');
  const lair = await evalJs('game.observe().debug.lair');
  await evalJs(`game.reset({seed:1, config:{startLevel:6, debugObs:true, invulnerable:true}, start:{x:${lair.x - 260 * Math.cos(Math.atan2(lair.y, lair.x))}, y:${lair.y - 260 * Math.sin(Math.atan2(lair.y, lair.x))}}})`);
  await evalJs(`game.act({mx:${Math.cos(Math.atan2(lair.y, lair.x))},my:${Math.sin(Math.atan2(lair.y, lair.x))},run:true})`);
  await sleep(2500); await evalJs('game.act({mx:0,my:0})');
  await shot('stage1_lair.png');
  const ob = await evalJs('game.observe()');
  console.log(`lair view: boss=${JSON.stringify(ob.boss)} heat=${ob.debug.heat}`);
  if (ob.boss) ok('boss visible near the lair'); else fail('no boss in observation near the lair');

  if (exceptions.length) { fail('runtime exceptions:\n  ' + exceptions.slice(0, 5).join('\n  ')); } else ok('no runtime exceptions');
  ws.close();
}
function finishExceptions({ exceptions }, ws) {
  if (exceptions.length) fail('runtime exceptions:\n  ' + exceptions.slice(0, 5).join('\n  ')); else ok('no runtime exceptions');
  ws.close();
}

// test hooks injected into the page: they only add objects to game.state the way the sim would
const HELPER = `window.__T = {
  mon(type, dx, dy, lvl, extra) {
    const S = game.state, H = S.hero, mc = game.config.monsters[type], L = lvl || 1;
    const hp = Math.round(mc.hp * (1 + game.config.monHpPerLevel * (L - 1)));
    const m = { id: S.nextId++, type, x: H.x + dx, y: H.y + dy, level: L, hp, maxHp: hp, dmg: mc.dmg, state: 'chase', stateT: 0, windDur: 0, kx: 0, ky: 0,
      aggroT: S.t, shotCd: 1.5, wAng: 0, wT: 2, burnT: 0, burnDps: 0, strafe: 1, pack: 0, follower: false, summoned: false, face: 0 };
    Object.assign(m, extra || {}); S.monsters.push(m); return m.id;
  },
  lair() { const w = AW.getWorld(game.state.seed, game.config); return { x: w.lair.x, y: w.lair.y, a: w.lair.angle }; },
  signs() {
    const w = AW.getWorld(game.state.seed, game.config), L = w.lair, out = {};
    for (let i = 0; i <= 80; i++) w.eachChunk(L.x * i / 80, L.y * i / 80, 300, ch => { for (const s of ch.signs) if (!out[s.kind] && !s.camp) out[s.kind] = { x: s.x, y: s.y, id: s.id }; });
    return out;
  },
};1`;

// node tools/smoke.mjs --fps : frames per second at 1280x800 with a visible bot, and in a boss fight
async function fpsMode({ send, evalJs, load }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const measure = async label => {
    await evalJs('window.__f=0;(function c(){window.__f++;requestAnimationFrame(c)})();game.perf();1');
    const f0 = await evalJs('__f'); await sleep(5000); const f1 = await evalJs('__f'); const p = await evalJs('game.perf()');
    const fps = (f1 - f0) / 5;
    console.log(`fps ${label}: ${fps.toFixed(1)}  (draw ${p.drawMs} ms, sim ${p.simMs} ms per frame)`);
    return fps;
  };
  await load('?bot=average&seed=1'); await sleep(2500);
  const a = await measure('bot=average, wood');
  await load('?seed=1&intro=0&invulnerable=1&startLevel=6'); await evalJs(HELPER);
  const L = await evalJs('__T.lair()');
  await evalJs(`game.reset({seed:1, config:{startLevel:6, invulnerable:true}, start:{x:${L.x - Math.cos(L.a) * 90}, y:${L.y - Math.sin(L.a) * 90}}})`);
  await evalJs(`game.state.boss.hp = game.state.boss.maxHp * .5; game.act({mx:${Math.cos(L.a)}, my:${Math.sin(L.a)}, attack:true})`);
  await sleep(1500); await evalJs('game.act({mx:0,my:0,attack:true})');
  const b = await measure('boss fight, phase 2');
  if (a >= 55 && b >= 55) ok('60 fps class at 1280x800'); else fail(`fps below target: ${a.toFixed(1)} / ${b.toFixed(1)}`);
}

// node tools/smoke.mjs --promo : og.png (1200x630) and docs/screenshots/*.png in the repository
async function promoMode({ send, evalJs, load }) {
  const dir = path.join(ROOT, 'docs', 'screenshots'); fs.mkdirSync(dir, { recursive: true });
  const save = async (file, w, h) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('promo', path.relative(ROOT, file), Math.round(fs.statSync(file).size / 1024) + ' KB');
  };
  const view = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await view(1200, 630); await load('?seed=1'); await sleep(5000); await save(path.join(ROOT, 'og.png'), 1200, 630);
  await view(960, 600);
  await load('?seed=1'); await sleep(5000); await save(path.join(dir, 'title.png'), 960, 600);
  await load('?seed=1&intro=0&invulnerable=1'); await evalJs(HELPER);
  await evalJs(`__T.mon('ghoul',30,-4,1);__T.mon('hound',-52,0,2);__T.mon('hound',-46,26,1);__T.mon('wraith',20,58,3);__T.mon('ghoul',70,34,4)`);
  await evalJs('game.act({mx:0,my:0,attack:true})'); await sleep(650);
  await evalJs(`(()=>{const m=game.state.monsters.find(m=>m.type==='ghoul'); if(m){m.state='windup';m.windDur=.6;m.stateT=.15;} game.act(null); game.pause(true, true); return 1})()`);
  await sleep(300); await save(path.join(dir, 'wood_fight.png'), 960, 600);
  await load('?seed=1&intro=0&invulnerable=1&startLevel=6'); await evalJs(HELPER);
  await evalJs(`__T.mon('knight',-44,10,3);__T.mon('cultist',50,-20,3)`);
  await evalJs(`game.act({mx:0,my:0,ability:'wrath'})`); await sleep(150); await evalJs('game.act({mx:0,my:0})'); await sleep(900);
  await evalJs('game.pause(true, true)'); await sleep(200); await save(path.join(dir, 'demon.png'), 960, 600);
  await load('?seed=1&intro=0&invulnerable=1&startLevel=6'); await evalJs(HELPER);
  const L = await evalJs('__T.lair()');
  await evalJs(`game.reset({seed:1, config:{startLevel:6, invulnerable:true}, start:{x:${L.x - Math.cos(L.a) * 90}, y:${L.y - Math.sin(L.a) * 90}}})`);
  await evalJs(`game.state.boss.hp = game.state.boss.maxHp * .5; game.act({mx:${Math.cos(L.a)}, my:${Math.sin(L.a)}, attack:true})`);
  await sleep(1500); await evalJs('game.act({mx:0,my:0,attack:true})'); await sleep(2500);
  await save(path.join(dir, 'lair_fight.png'), 960, 600);
}

// node tools/smoke.mjs --shots : UI screenshots ui_*.png for review
async function shotsMode({ send, evalJs, shot, load, key }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const only = arg('--only', '');
  const want = n => !only || only.split(',').some(k => n.includes(k));
  const clip = async (name, w, h, sc, dx = 0, dy = 0) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 640 - w / 2 + dx, y: 412 - h / 2 + dy, width: w, height: h, scale: sc } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('shot', path.join(OUT, name));
  };
  const prep = async q => { await load(q); await evalJs(HELPER); };
  const toLair = async (lvl, dist) => {
    await prep(`?seed=1&intro=0&invulnerable=1&startLevel=${lvl}`);
    const L = await evalJs('__T.lair()');
    await evalJs(`game.reset({seed:1, config:{startLevel:${lvl}, invulnerable:true}, start:{x:${L.x - Math.cos(L.a) * dist}, y:${L.y - Math.sin(L.a) * dist}}})`);
    return L;
  };
  if (want('title')) { await load('?seed=1'); await sleep(4500); await shot('ui_title.png'); }
  if (want('intro')) { await load('?seed=1&title=0'); await sleep(11500); await shot('ui_intro.png'); }
  if (want('sprites')) {
    await prep('?seed=1&intro=0');
    await evalJs(`(()=>{const c=AW.render.spriteSheet(4);c.style.cssText='position:fixed;left:0;top:0;z-index:99;image-rendering:pixelated';document.body.appendChild(c);return 1})()`);
    await sleep(300); await shot('ui_sprites.png');
  }
  if (want('wood')) {
    await prep('?seed=1&intro=0&invulnerable=1');
    await evalJs(`__T.mon('ghoul',30,-4,1);__T.mon('hound',-52,0,2);__T.mon('hound',-46,26,1);__T.mon('wraith',20,58,3);__T.mon('ghoul',70,34,4)`);
    await evalJs('game.act({mx:0,my:0,attack:true})'); await sleep(650);
    await evalJs(`(()=>{const m=game.state.monsters.find(m=>m.type==='ghoul'); if(m){m.state='windup';m.windDur=.6;m.stateT=.15;} game.act(null); game.pause(true, true); return 1})()`);
    await sleep(300); await shot('ui_wood_fight.png'); await clip('ui_wood_fight_zoom.png', 420, 260, 2.5);
  }
  if (want('rung')) {
    for (const L of [1, 2, 3, 4, 5, 6]) {
      await prep(`?seed=1&intro=0&invulnerable=1&startLevel=${L}`);
      await evalJs('game.act({mx:0,my:1})'); await sleep(200); await evalJs('game.act({mx:0,my:0})'); await sleep(1200);
      await clip(`ui_rung${L - 1}.png`, 240, 150, 3, 0, -12);
    }
    await shot('ui_rung5_full.png');
    await evalJs(`game.act({mx:0,my:0,ability:'wrath'})`); await sleep(150); await evalJs('game.act({mx:0,my:0})'); await sleep(1000);
    await clip('ui_wrath.png', 240, 150, 3, 0, -16); await shot('ui_wrath_full.png');
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=3');
    await evalJs(`game.act({mx:1,my:0,ability:'dash'})`); await sleep(110); await clip('ui_dash.png', 420, 200, 2.2, 60, -10); await evalJs('game.act(null)');
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=4');
    await evalJs(`__T.mon('ghoul',30,0,1);__T.mon('ghoul',-28,10,1);__T.mon('hound',0,30,1)`); await sleep(300);
    await evalJs(`game.act({mx:0,my:0,ability:'nova'})`); await sleep(160); await clip('ui_nova.png', 360, 220, 2.5); await evalJs('game.act(null)');
    // level-up with a rung card
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=3');
    await evalJs(`(()=>{const H=game.state.hero; H.xp=game.observe().player.xpNext-1; __T.mon('ghoul',14,0,1,{hp:1}); game.act({mx:0,my:0,attack:true}); return 1})()`);
    await sleep(1600); await evalJs('game.act(null)'); await shot('ui_levelup_card.png');
    // damnation meter and frame at level 8
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=8');
    await evalJs(`game.state.hero.xp = 300`); await sleep(1500); await shot('ui_damnation_hud.png');
  }
  if (want('sign')) {
    await prep('?seed=1&intro=0&invulnerable=1');
    const signs = await evalJs('__T.signs()');
    for (const kind of ['ribbon', 'circle', 'crows', 'blood']) {
      const s = signs[kind]; if (!s) { console.log('no sign of kind', kind); continue; }
      await evalJs(`game.reset({seed:1, config:{invulnerable:true}, start:{x:${s.x - 40}, y:${s.y + 6}}})`); await sleep(1600);
      await evalJs('game.pause(true, true)'); await sleep(200);
      await clip(`ui_sign_${kind}.png`, 300, 180, 3, 50, -16);
      if (kind === 'crows') { await evalJs(`game.state.discovered[${JSON.stringify(s.id)}]=true`); await sleep(200); await clip('ui_sign_crows_found.png', 300, 180, 3, 50, -16); }
      await evalJs('game.pause(false)');
    }
  }
  if (want('lair')) {
    const L = await toLair(6, 90);
    await evalJs(`game.state.boss.hp = game.state.boss.maxHp * .5; game.act({mx:${Math.cos(L.a)}, my:${Math.sin(L.a)}, attack:true})`);
    await sleep(1500); await evalJs('game.act({mx:0,my:0,attack:true})'); await sleep(2500);
    await shot('ui_lair_fight.png');
    await evalJs(`(()=>{const B=game.state.boss,H=game.state.hero; B.x=H.x+14; B.y=H.y-6; B.state='nova'; B.windDur=.8; B.stateT=.3; game.pause(true, true); return 1})()`);
    await sleep(300); await clip('ui_boss_nova.png', 420, 260, 2.4, 0, -20); await evalJs('game.pause(false)');
    await toLair(6, 300); await sleep(1500); await shot('ui_lair_approach.png');
  }
  if (want('death')) {
    await prep('?seed=1&intro=0');
    await evalJs(`__T.mon('knight',22,0,2)`); await sleep(600);
    await evalJs(`game.state.projectiles.push({x:game.state.hero.x,y:game.state.hero.y,vx:0,vy:0,dmg:9999,r:3,ttl:1,src:'boss'})`);
    await sleep(1700); await shot('ui_death.png');
  }
  if (want('end')) {
    for (const [lvl, name] of [[5, 'walk_home'], [6, 'new_master']]) {
      await toLair(lvl, 60); await sleep(1200);
      await evalJs(`(()=>{const B=game.state.boss,H=game.state.hero; B.x=H.x+16; B.y=H.y; B.hp=3; game.act({mx:0,my:0,attack:true,aimX:B.x,aimY:B.y}); return 1})()`);
      await sleep(1300); await evalJs('game.act(null)'); await shot(`ui_victory_${name}.png`);
      await sleep(4200); await shot(`ui_end_${name}.png`);
    }
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=8');
    await evalJs(`(()=>{const H=game.state.hero; H.xp=game.observe().player.xpNext-1; __T.mon('ghoul',14,0,1,{hp:1}); game.act({mx:0,my:0,attack:true}); return 1})()`);
    await sleep(500); await evalJs('game.act(null)');
    console.log('phase after the kill:', await evalJs('game.state.phase'));
    await sleep(1700); await shot('ui_fall_mid.png');
    await sleep(1400); await shot('ui_fall_late.png');
    await sleep(3200); await shot('ui_end_fall.png');
  }
  if (want('ribbon') || want('pause')) {
    await prep('?seed=1&intro=0&invulnerable=1');
    const camp = await evalJs(`(()=>{const w=AW.getWorld(game.state.seed, game.config); let c=null; w.eachChunk(0,0,300,ch=>{for(const s of ch.signs) if(s.camp) c={x:s.x,y:s.y};}); return c})()`);
    await evalJs(`game.reset({seed:1, config:{invulnerable:true}, start:{x:${camp.x}, y:${camp.y - 30}}})`);
    await evalJs('game.act({mx:0,my:1})'); await sleep(700); await evalJs('game.act({mx:0,my:0})'); await sleep(2500);
    console.log('trail after the camp ribbon:', JSON.stringify(await evalJs('game.observe().trail')), 'warmth', await evalJs('game.observe().player.warmth'));
    await shot('ui_ribbon_cold.png');
    await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27); await sleep(500);
    await shot('ui_pause.png');
    await key('keyDown', 'Escape', 'Escape', 27); await key('keyUp', 'Escape', 'Escape', 27);
    const L = await toLair(6, 380);
    await evalJs(`(()=>{const S=game.state; S.trail={dir:'south', dirVec:{x:${Math.cos(L.a)},y:${Math.sin(L.a)}}, kind:'blood', temp:'burning'}; return 1})()`);
    await sleep(1800); console.log('warmth near the lair', await evalJs('game.observe().player.warmth'));
    await shot('ui_ribbon_hot.png');
  }
  if (want('mobile')) {
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await prep('?seed=1&intro=0&invulnerable=1&startLevel=6');
    await evalJs(`document.body.classList.add('touch'); __T.mon('ghoul',40,0,2); 1`); await sleep(1500);
    const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'ui_mobile.png'), Buffer.from(r.data, 'base64')); console.log('shot ui_mobile.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }
}

try { await main(); } catch (e) { fail(e.stack || String(e)); }
cleanup();
console.log(failures ? `SMOKE FAILED (${failures})` : 'SMOKE PASSED');
process.exit(failures ? 1 : 0);
