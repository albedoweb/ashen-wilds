// Scripted players. A bot is AW.bots.make(name, {seed}) -> { name, every, decide(obs, events) -> action }.
// Skill bots (novice/average/expert/grinder) use only observe() and events(). rusher may use obs.debug.
(function (AW) {
'use strict';
const TAU = Math.PI * 2;
const DT = 1 / 60;

// one parameterised policy. delay: reaction (s); aimErr: degrees; dodge: chance to dodge a telegraph;
// kite: chance per decision to sidestep incoming bolts; ability: 'ready' | 'near' | 'timing';
// ready: level at which the bot goes for Morhain (the warning keeps weaker bots farming)
const PARAMS = {
  novice:  { delay: 0.45, aimErr: 25, dodge: 0,    kite: 0,   ability: 'ready',  ready: 6 },
  average: { delay: 0.25, aimErr: 12, dodge: 0.4,  kite: 0.5, ability: 'near',   ready: 6 },
  expert:  { delay: 0.10, aimErr: 4,  dodge: 0.85, kite: 1,   ability: 'timing', ready: 5, fallback: true },
};
PARAMS.grinder = Object.assign({}, PARAMS.average);

const EVERY = 4; // ticks per decision (15 Hz)

function makeSkill(name, opts) {
  const P = Object.assign({}, PARAMS[name], opts.params || {});
  const grinder = name === 'grinder';
  const rnd = AW.rng(((opts.seed | 0) * 2654435761 + 12345) >>> 0);
  const dd = Math.max(0, Math.round(P.delay / (EVERY * DT)));
  const hist = [];
  const mem = {
    hints: [], warnPos: null, warned: false, resting: false, wp: null, wpT: 0, dodge: {}, kiteCoin: {},
    bossSeen: false, bossDeaths: 0, pos: [], esc: 0, escA: 0, detour: 0, detourSign: 1, spiralK: 0, lastAct: null, level: 1,
  };

  function steer(p, tx, ty) {
    let dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (mem.detour > 0) {
      mem.detour--;
      const a = Math.atan2(dy, dx) + mem.detourSign * 1.3;
      dx = Math.cos(a); dy = Math.sin(a);
    }
    return [dx, dy];
  }
  function wanderAround(p, cx, cy, R) {
    mem.wpT--;
    if (!mem.wp || mem.wpT <= 0 || Math.hypot(mem.wp[0] - p.x, mem.wp[1] - p.y) < 30) {
      const a = rnd() * TAU, r = 60 + rnd() * R;
      mem.wp = [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; mem.wpT = 150;
    }
    return mem.wp;
  }
  // estimate the lair from the sign rays; null if no hint
  function lairEstimate(p) {
    const hs = mem.hints;
    if (!hs.length) return null;
    const a = hs[hs.length - 1];
    for (let i = hs.length - 2; i >= Math.max(0, hs.length - 6); i--) {
      const b = hs[i];
      const cr = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(cr) < 0.2) continue;
      // a.p + s*a.d = b.p + u*b.d
      const rx = b.x - a.x, ry = b.y - a.y;
      const s = (rx * b.dy - ry * b.dx) / cr;
      if (s > 0 && s < 6000) return [a.x + a.dx * s, a.y + a.dy * s];
    }
    return [a.x + a.dx * 600, a.y + a.dy * 600];
  }
  function nearestBonfire(obs, maxD) {
    let best = null;
    for (const b of obs.bonfires) if (b.dist <= maxD && (!best || b.dist < best.dist)) best = b;
    return best;
  }

  function decide0(obs, events) {
    const p = obs.player;
    // ---- memory from events
    for (const e of events || []) {
      if (e.type === 'sign' || e.type === 'hint') mem.hints.push({ x: e.x !== undefined ? e.x : p.x, y: e.y !== undefined ? e.y : p.y, dx: e.dirVec.x, dy: e.dirVec.y });
      else if (e.type === 'warning') { mem.warned = true; mem.warnPos = [p.x, p.y]; }
      else if (e.type === 'death' && mem.bossSeen) mem.bossDeaths++;
      else if (e.type === 'respawn') { mem.resting = false; mem.dodge = {}; }
    }
    hist.push(obs); if (hist.length > dd + 1) hist.shift();
    const d = hist[0]; // delayed perception of the world
    const act = { mx: 0, my: 0, run: false, attack: false, ability: null };
    if (obs.phase !== 'play') return act;

    // ---- enemies as perceived
    const bossO = d.boss;
    mem.bossSeen = !!(obs.boss && obs.boss.awake);
    const readyLvl = P.fallback && mem.bossDeaths >= 2 ? 6 : P.ready; // expert: after two deaths at the boss, level up first
    const ready = p.level >= readyLvl;
    const foes = [];
    for (const m of d.monsters) foes.push({ id: m.id, x: m.x, y: m.y, dist: Math.hypot(m.x - p.x, m.y - p.y), state: m.state, windT: m.windT, reach: m.reach, ranged: m.ranged, type: m.type, boss: false });
    if (bossO && bossO.awake && !grinder) {
      const bd = Math.hypot(bossO.x - p.x, bossO.y - p.y);
      foes.push({ id: -1, x: bossO.x, y: bossO.y, dist: bd, state: bossO.state === 'nova' ? 'windup' : 'chase', windT: bossO.windT, reach: 45, ranged: false, type: 'boss', boss: true });
    }
    foes.sort((a, b) => a.dist - b.dist);
    const nearest = foes[0];
    const engageR = grinder || (P.aggression && !ready) ? 260 : (ready ? 90 : 170); // a bot that is ready pushes on to Morhain
    const inFight = foes.some(f => f.dist <= (f.ranged ? engageR + 40 : engageR));

    // ---- resting
    if (mem.resting && p.hp >= p.maxHp * 0.8) mem.resting = false;
    if (!mem.resting && p.hp < p.maxHp * 0.35 && !(nearest && nearest.dist < 150)) mem.resting = true;
    if (mem.resting && !(nearest && nearest.dist < 150)) {
      const b = nearestBonfire(obs, 450);
      if (b && b.dist > 20) { const [mx, my] = steer(p, b.x, b.y); act.mx = mx; act.my = my; act.run = true; }
      mem.lastAct = act; return act;
    }
    if (ready && !grinder && !inFight && !(bossO && bossO.awake) && p.hp < p.maxHp * 0.7) { // top up before Morhain when a fire is near
      const b = nearestBonfire(obs, 400);
      if (b && b.dist > 20) { const [mx, my] = steer(p, b.x, b.y); act.mx = mx; act.my = my; act.run = true; mem.lastAct = act; return act; }
    }

    // ---- fight
    if (inFight) {
      let t = foes.find(f => f.dist <= (f.ranged ? engageR + 40 : engageR));
      // walk-home attempt (expert at level 5): stay on Morhain, do not feed on his summons
      const bf = P.fallback && p.level < 6 ? foes.find(f => f.boss && f.dist <= 200) : null;
      if (bf) t = bf;
      const ux = (t.x - p.x) / (t.dist || 1), uy = (t.y - p.y) / (t.dist || 1);
      let mx = ux, my = uy;
      // telegraph dodge
      let dodging = false;
      for (const f of foes) {
        if (f.state === 'windup' && !f.ranged && f.dist <= f.reach + 16) {
          if (mem.dodge[f.id] === undefined) mem.dodge[f.id] = rnd() < P.dodge;
          if (mem.dodge[f.id]) {
            dodging = true;
            const fx = (p.x - f.x) / (f.dist || 1), fy = (p.y - f.y) / (f.dist || 1);
            mx = fx; my = fy;
          }
        }
      }
      for (const k of Object.keys(mem.dodge)) { const f = foes.find(q => String(q.id) === k); if (!f || f.state !== 'windup') delete mem.dodge[k]; }
      // incoming bolts
      let sidestep = false;
      if (!dodging && P.kite > 0) {
        for (const pr of d.projectiles) {
          const vx = pr.vx, vy = pr.vy, v2 = vx * vx + vy * vy || 1;
          const rx = pr.x - p.x, ry = pr.y - p.y;
          const tt = -(rx * vx + ry * vy) / v2;
          if (tt < 0 || tt > 1.1) continue;
          const cx = rx + vx * tt, cy = ry + vy * tt;
          if (Math.hypot(cx, cy) < 14 && rnd() < P.kite) {
            const vl = Math.sqrt(v2);
            let nx = -vy / vl, ny = vx / vl;
            if (nx * cx + ny * cy > 0) { nx = -nx; ny = -ny; }
            mx = nx * 0.75 + ux * 0.45; my = ny * 0.75 + uy * 0.45; sidestep = true; break; // sidestep while still closing in
          }
        }
      }
      if (!dodging && !sidestep) {
        // keep closing to melee range; ranged foes are chased straight
        const stop = t.boss ? 24 : 20;
        if (t.dist <= stop) { mx = 0; my = 0; }
      }
      act.mx = mx; act.my = my; act.run = dodging || sidestep || t.dist > 40;
      if (!dodging) {
        const err = (rnd() * 2 - 1) * P.aimErr * Math.PI / 180;
        const a = Math.atan2(t.y - p.y, t.x - p.x) + err;
        act.attack = t.dist <= 30;
        act.aimX = p.x + Math.cos(a) * 40; act.aimY = p.y + Math.sin(a) * 40;
      }
      // abilities
      const ab = p.abilities;
      const near = (r) => foes.filter(f => f.dist <= r).length;
      if (P.ability === 'ready') {
        if (ab.wrath.unlocked && ab.wrath.cd <= 0) act.ability = 'wrath';
        else if (ab.nova.unlocked && ab.nova.cd <= 0 && near(70) > 0) act.ability = 'nova';
        else if (ab.dash.unlocked && ab.dash.cd <= 0 && t.dist < 120) act.ability = 'dash';
      } else if (P.ability === 'near') {
        if (ab.wrath.unlocked && ab.wrath.cd <= 0 && near(90) > 0 && (t.boss || near(120) >= 2)) act.ability = 'wrath';
        else if (ab.nova.unlocked && ab.nova.cd <= 0 && near(55) > 0) act.ability = 'nova';
        else if (ab.dash.unlocked && ab.dash.cd <= 0 && t.dist > 30 && t.dist < 110) act.ability = 'dash';
      } else if (P.ability !== 'none') { // timing
        if (ab.wrath.unlocked && ab.wrath.cd <= 0 && t.boss && t.dist < 110) act.ability = 'wrath';
        else if (ab.nova.unlocked && ab.nova.cd <= 0 && (near(55) >= 2 || (t.boss && t.dist < 55) || foes.some(f => f.type === 'knight' && f.dist < 55))) act.ability = 'nova';
        else if (ab.dash.unlocked && ab.dash.cd <= 0 && (dodging && t.windT < 0.3 || (t.ranged && t.dist > 60 && t.dist < 120))) act.ability = 'dash';
      }
      mem.lastAct = act; return act;
    }

    // ---- travel
    let tx, ty;
    if (grinder) {
      const w = wanderAround(p, 0, 0, 500); tx = w[0]; ty = w[1];
    } else if (mem.warned && !ready) {
      const wp = mem.warnPos || [p.x, p.y];
      const w = wanderAround(p, wp[0], wp[1], 220); tx = w[0]; ty = w[1];
    } else {
      // go to a visible unread sign first, else follow the trail
      let sign = null;
      for (const s of d.signs) if (s.dist < 350 && (!sign || s.dist < sign.dist)) sign = s;
      if (sign) { tx = sign.x; ty = sign.y; }
      else {
        const est = lairEstimate(p);
        if (est) { tx = est[0]; ty = est[1]; }
        else { // widening spiral
          mem.wpT--;
          if (!mem.wp || mem.wpT <= 0 || Math.hypot(mem.wp[0] - p.x, mem.wp[1] - p.y) < 30) {
            mem.spiralK++; const a = mem.spiralK * 0.7, r = 120 + mem.spiralK * 60;
            mem.wp = [Math.cos(a) * r, Math.sin(a) * r]; mem.wpT = 300;
          }
          tx = mem.wp[0]; ty = mem.wp[1];
        }
      }
      // at the arena: walk onto Morhain
      if (bossO && ready) { tx = bossO.x; ty = bossO.y; }
    }
    const [mx, my] = steer(p, tx, ty);
    act.mx = mx; act.my = my; act.run = true;
    mem.lastAct = act; return act;
  }
  // unstuck: if the hero wanted to move but barely did, walk a random heading for ~1.5 s (keeps attacking)
  function decide(obs, events) {
    const p = obs.player;
    const act = decide0(obs, events);
    if (obs.phase !== 'play') return act;
    if (mem.esc > 0) {
      mem.esc--;
      act.mx = Math.cos(mem.escA); act.my = Math.sin(mem.escA); act.run = true;
      if (!act.attack) act.ability = null;
      mem.lastAct = act; return act;
    }
    mem.pos.push([p.x, p.y]); if (mem.pos.length > 12) mem.pos.shift();
    if (mem.pos.length === 12 && (act.mx || act.my)) {
      const q = mem.pos[0];
      if (Math.hypot(q[0] - p.x, q[1] - p.y) < 10) {
        const h = Math.atan2(act.my, act.mx);
        mem.escA = h + Math.PI + (rnd() * 2 - 1) * 1.4; mem.esc = 20; mem.pos.length = 0;
      }
    }
    mem.lastAct = act; return act;
  }
  return { name, every: EVERY, decide, params: P };
}

function makeRusher(opts) {
  const mem = { pos: [], esc: 0, escA: 0, detour: 0, sign: 1 };
  const rnd = AW.rng(((opts.seed | 0) + 77) >>> 0);
  function decide(obs, events) {
    const p = obs.player;
    const act = { mx: 0, my: 0, run: true, attack: false, ability: null };
    if (obs.phase !== 'play') return act;
    const lair = obs.debug && obs.debug.lair ? obs.debug.lair : { x: 0, y: 0 };
    let tx = lair.x, ty = lair.y;
    const boss = obs.boss;
    if (boss && boss.awake) { tx = boss.x; ty = boss.y; }
    let dx = tx - p.x, dy = ty - p.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    if (mem.esc > 0) { mem.esc--; dx = Math.cos(mem.escA); dy = Math.sin(mem.escA); }
    else {
      mem.pos.push([p.x, p.y]); if (mem.pos.length > 12) mem.pos.shift();
      if (mem.pos.length === 12 && Math.hypot(mem.pos[0][0] - p.x, mem.pos[0][1] - p.y) < 10 && !(boss && boss.awake && boss.dist < 40)) {
        mem.escA = Math.atan2(dy, dx) + Math.PI + (rnd() * 2 - 1) * 1.4; mem.esc = 20; mem.pos.length = 0;
      }
    }
    act.mx = dx; act.my = dy;
    if (boss && boss.awake && boss.dist < 24) { act.mx = 0; act.my = 0; }
    let blocking = null;
    for (const m of obs.monsters) if (m.dist < 30 && (!blocking || m.dist < blocking.dist)) blocking = m;
    act.attack = !!blocking || !!(boss && boss.dist < 40);
    const ab = p.abilities;
    const bossNear = boss && boss.awake && boss.dist < 110;
    if (ab.wrath.unlocked && ab.wrath.cd <= 0 && bossNear) act.ability = 'wrath';
    else if (ab.nova.unlocked && ab.nova.cd <= 0 && (blocking && blocking.dist < 50 || boss && boss.dist < 55)) act.ability = 'nova';
    else if (ab.dash.unlocked && ab.dash.cd <= 0 && (blocking && blocking.dist < 40)) act.ability = 'dash';
    return act;
  }
  return { name: 'rusher', every: EVERY, decide, usesDebug: true };
}

AW.bots = {
  names: ['novice', 'average', 'expert', 'grinder', 'rusher'],
  EVERY,
  PARAMS,
  make(name, opts) {
    opts = opts || {};
    if (name === 'rusher') return makeRusher(opts);
    if (!PARAMS[name]) throw new Error('unknown bot ' + name);
    return makeSkill(name, opts);
  },
};
})(globalThis.AW = globalThis.AW || {});
