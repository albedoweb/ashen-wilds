#!/usr/bin/env node
// Gameplay trailer: staged scenes rendered frame by frame (exactly 1/30 s each) in headless Chrome, then ffmpeg.
//   node tools/trailer.mjs [--out promo] [--ffmpeg /path/to/ffmpeg] [--frames dir] [--size 1280x720]
//                          [--dpr 1.5] [--name ashen-wilds-trailer] [--gif] [--only title,wood,nova,ribbon,boss]
// The game runs in film mode (window.game.film/renderFrame): the rAF loop idles, the simulation advances with
// game.stepOnce(action, 2) and the renderer, HUD and CSS animations advance on a virtual clock. Scenes are staged
// by pushing monsters and setting state the way the sim would; no balance numbers change.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(ROOT, 'promo')));
const FFMPEG = arg('--ffmpeg', process.env.FFMPEG || 'ffmpeg');
const [VW, VH] = arg('--size', '1280x720').split('x').map(Number);
const DPR = +arg('--dpr', 1.5); // the page is laid out at size/DPR, so sprites and HUD text come out DPR times larger
const CW = Math.round(VW / DPR), CH = Math.round(VH / DPR);
const NAME = arg('--name', VW === VH ? 'ashen-wilds-trailer-square' : 'ashen-wilds-trailer');
const FRAMES = path.resolve(arg('--frames', path.join(os.tmpdir(), 'aw-trailer-frames')), NAME);
const ONLY = arg('--only', 'wood,nova,ribbon,boss,end'); // the 7-second cut; add 'title' for the title-screen opener
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9800 + Math.floor(Math.random() * 150);
const FPS = 30, TICKS = 60 / FPS;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const INDEX = pathToFileURL(path.join(ROOT, 'index.html')).href;
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-trailer-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', `--window-size=${CW},${CH}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* busy */ } };

// trailer-only styling: hide the hints and texts that do not belong in a trailer, add the black overlay and end card
const STYLE = `
#help, #debug, #coords, #msg, #biome, #pbtn, #atk, #levelUp, #card { display: none !important; }
#title .desc, #title .keys, #title small, #title footer { display: none !important; }
#ribbon { transform: scale(1.6); transform-origin: top right; }
#game { filter: brightness(1.22) contrast(1.06); }
#title .tt { font-size: min(9.4vw, 19vh); }
#title .tag { font-size: min(3.4vw, 5.6vh); max-width: 86vw; }
#tov { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 50; }
#tcard { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 51; pointer-events: none; text-align: center; font-family: Georgia, serif; padding: 0 6vw; }
#tcard h1 { margin: 0; font-weight: normal; font-variant: small-caps; letter-spacing: .14em; font-size: min(12vw, 21vh); color: #f2d6a0; opacity: 0;
  text-shadow: 0 0 18px rgba(255,110,30,.6), 0 0 60px rgba(255,60,10,.4), 0 4px 10px #000; }
#tcard .tg { margin: .7em 0 0; font-style: italic; font-size: min(3.6vw, 6vh); color: #ecdcc0; opacity: 0; text-shadow: 0 2px 8px #000; }
#tcard .url { margin: 1.3em 0 0; font-size: min(2.9vw, 4.8vh); letter-spacing: .06em; color: #ffb070; opacity: 0; text-shadow: 0 0 10px rgba(255,120,40,.5), 0 2px 6px #000; }
#tcard .url b { font-weight: normal; color: #c8b898; }
`;
const SETUP = `(()=>{
  const st = document.createElement('style'); st.textContent = ${JSON.stringify(STYLE)}; document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend', '<div id="tov"></div><div id="tcard"><h1>Ashen Wilds</h1><p class="tg">Every level makes you stronger, and less human.</p><p class="url"><b>Play free in your browser</b><br>albedoweb.github.io/ashen-wilds</p></div>');
  game.film(true);
  window.__T = {
    mon(type, dx, dy, lvl, extra) {
      const S = game.state, H = S.hero, mc = game.config.monsters[type], L = lvl || 1;
      const hp = Math.round(mc.hp * (1 + game.config.monHpPerLevel * (L - 1)));
      const m = { id: S.nextId++, type, x: H.x + dx, y: H.y + dy, level: L, hp, maxHp: hp, dmg: mc.dmg, state: 'chase', stateT: 0, windDur: 0, kx: 0, ky: 0,
        aggroT: S.t, shotCd: 1.5, wAng: 0, wT: 2, burnT: 0, burnDps: 0, strafe: 1, pack: 0, follower: false, summoned: false, face: Math.atan2(-dy, -dx) };
      Object.assign(m, extra || {}); S.monsters.push(m); return m.id;
    },
    ov(a) { document.getElementById('tov').style.opacity = a; },
  };
  return 1;
})()`;

let frameNo = 0;
async function main() {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = (await r.json()).filter(t => t.type === 'page'); } catch (e) { await sleep(200); }
  }
  if (!targets || !targets.length) throw new Error('chrome did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + expr.slice(0, 80)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: CW, height: CH, deviceScaleFactor: DPR, mobile: false });
  const load = async q => { await send('Page.navigate', { url: INDEX + q }); await sleep(1400); await js(SETUP); };
  // one frame: optional sim step with an action, staging code, then render and capture
  const frame = async (action, pre) => {
    const a = action === null ? '' : `game.stepOnce(${JSON.stringify(action || { mx: 0, my: 0 })}, ${TICKS});`;
    await js(`{${pre || ''}};${a};game.renderFrame(${1 / FPS});1`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(FRAMES, `f${String(frameNo++).padStart(5, '0')}.png`), Buffer.from(r.data, 'base64'));
  };
  const fadeIn = (f, n) => `__T.ov(${f < n ? (1 - (f + 1) / (n + 1)).toFixed(3) : 0})`;
  const want = n => ONLY.split(',').includes(n);
  const lair = await (async () => { await load('?seed=1'); return js('({x: AW.getWorld(1, game.config).lair.x, y: AW.getWorld(1, game.config).lair.y})'); })();

  // 1. title: "Ashen Wilds" glows in over the living world, embers rise (36 frames)
  if (want('title')) {
    await load('?seed=1');
    await js(`(()=>{for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; a.pause();
      if (t && t.classList && t.classList.contains('tt')) a.currentTime = a.animationName === 'titleIn' ? 1150 : 0;
      else if (t && t.classList && (t.classList.contains('tag') || t.classList.contains('orn'))) a.currentTime = 900; } return 1})()`);
    for (let f = 0; f < 36; f++) await frame(null, fadeIn(f, 6));
  }
  // 2. the Mourner in the dark wood: ghouls and hounds rush in, telegraphs, swings, ash (66 frames)
  if (want('wood')) {
    await load('?seed=1&intro=0&invulnerable=1&x=27&y=15');
    await js(`__T.mon('ghoul',46,-14,1,{hp:14});__T.mon('ghoul',44,26,2,{hp:20});__T.mon('hound',-58,4,1,{hp:12});__T.mon('hound',-54,30,1,{hp:12});__T.mon('hound',-66,-18,2,{hp:20});1`);
    for (let f = 0; f < 48; f++) await frame({ mx: 0, my: 0, attack: f >= 6 }, fadeIn(f, 2));
  }
  // 3. level-up -> rung card "Hellfire" -> nova through a group; the torch turns crimson (54 frames)
  if (want('nova')) {
    await load('?seed=1&intro=0&invulnerable=1&startLevel=3&x=27&y=15');
    await js(`(()=>{const H=game.state.hero; H.xp=game.observe().player.xpNext-1; H.face=3;
      __T.mon('ghoul',15,0,1,{hp:1}); __T.mon('ghoul',-40,-14,2); __T.mon('hound',-30,34,2); __T.mon('ghoul',36,38,2); __T.mon('hound',44,-26,2); __T.mon('ghoul',-6,-46,2); return 1})()`);
    for (let f = 0; f < 42; f++) await frame({ mx: 0, my: 0, attack: f < 3, ability: f === 9 ? 'nova' : null });
  }
  // 4. near the lair: Ilse's ribbon flares from hot to burning, red heat, crows on a post (36 frames)
  if (want('ribbon')) {
    const sx = -156, sy = 2728, dx = lair.x - sx, dy = lair.y - sy, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const hx = sx + ux * 22 + uy * 24, hy = sy + uy * 22 - ux * 24;
    await load('?seed=1&intro=0&invulnerable=1&startLevel=5');
    await js(`game.reset({seed:1, config:{startLevel:5, invulnerable:true}, start:{x:${hx}, y:${hy}}}); game.film(true);
      game.state.trail = {dir:'south', dirVec:{x:${ux},y:${uy}}, kind:'crows', temp:'warm'}; 1`);
    for (let f = 0; f < 24; f++) await frame({ mx: ux, my: uy, run: false });
  }
  // 5. Morhain: bolt fan, the hero in Wrath with wings, boss bar dropping into phase 3 (72 frames)
  // 6. end card over the darkened fight (36 frames)
  if (want('boss')) {
    // Morhain stands on the right; the demon starts ~170 px away on the left, a little lower, shadow-steps twice through his
    // bolt fan and ring, lands beside him and strikes with blade and nova
    await load('?seed=1&intro=0&invulnerable=1&startLevel=6');
    const bx = lair.x + 75, by = lair.y + 22, hx0 = bx - 172, hy0 = by + 34;
    await js(`game.reset({seed:1, config:{startLevel:6, invulnerable:true}, start:{x:${hx0}, y:${hy0}}}); game.film(true);
      (()=>{const B=game.state.boss; B.x=${bx}; B.y=${by}; B.awake=true; B.state='idle'; B.phase=2; B.hp=B.maxHp*.42; B.boltT=.25; B.ringT=.7; B.summonT=99; B.novaCd=99; return 1})()`);
    const DASH1 = 16, DASH2 = 23;
    for (let f = 0; f < 54; f++) {
      const ab = f === 0 ? "'wrath'" : (f === DASH1 || f === DASH2) ? "'dash'" : f === 31 ? "'nova'" : 'null';
      const act = `(()=>{const B=game.state.boss,H=game.state.hero,dx=B.x-H.x,dy=B.y-H.y,d=Math.hypot(dx,dy)||1;
        if (${f === DASH1 || f === DASH2}) H.cd.dash=0;
        const go = ${f === DASH1 || f === DASH2};
        return {mx: go ? dx/d : 0, my: go ? dy/d : 0, attack:${f >= DASH2 + 3}, ability:${ab}, aimX:B.x, aimY:B.y}})()`;
      await js(`(()=>{const B=game.state.boss; B.x=${bx}; B.y=${by}; B.vx=B.vy=0; game.stepOnce(${act}, ${TICKS}); B.x=${bx}; B.y=${by}; B.novaCd=99; game.renderFrame(${1 / FPS}); return 1})()`);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(FRAMES, `f${String(frameNo++).padStart(5, '0')}.png`), Buffer.from(r.data, 'base64'));
    }
    if (want('end')) {
      await js("document.getElementById('card').style.opacity=0;1");
      for (let f = 0; f < 42; f++) {
        const k = x => Math.max(0, Math.min(1, x)).toFixed(3), pop = x => (1 + .14 * (1 - Math.max(0, Math.min(1, x))) ** 2).toFixed(3);
        await frame({ mx: 0, my: 0 }, `__T.ov(${k(f / 5 * .82)});
          const c=document.getElementById('tcard'), h=c.querySelector('h1'); h.style.opacity=${k((f - 3) / 4)}; h.style.transform='scale(${pop((f - 3) / 6)})';
          c.querySelector('.tg').style.opacity=${k((f - 9) / 4)}; c.querySelector('.url').style.opacity=${k((f - 14) / 4)}`);
      }
    }
  }
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 5).join('\n  '));
  ws.close();
  return errors.length;
}

let bad = 0;
try { bad = await main(); } catch (e) { console.log(e.stack || String(e)); bad = 1; }
cleanup();
console.log(`${frameNo} frames (${(frameNo / FPS).toFixed(2)} s) in ${FRAMES}`);
if (!bad && frameNo) {
  const mp4 = path.join(OUT, NAME + '.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), mp4]);
  console.log('wrote', mp4, (fs.statSync(mp4).size / 1048576).toFixed(2) + ' MB');
  if (argv.includes('--gif')) {
    const gif = path.join(OUT, NAME + '.gif');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp4, '-vf',
      'fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', gif]);
    console.log('wrote', gif, (fs.statSync(gif).size / 1048576).toFixed(2) + ' MB');
  }
}
process.exit(bad ? 1 : 0);
