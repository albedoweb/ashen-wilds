// Ashen Wilds simulation: fixed-step, deterministic, DOM-free.
// createGame({seed, config}) -> { step, observe, events, state, config, world }
(function (AW) {
'use strict';
const DT = 1 / 60;
const { TILE, CPX, BIOME } = AW;
const TAU = Math.PI * 2;
const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const r2 = v => Math.round(v * 100) / 100;

function createGame(opts) {
  opts = opts || {};
  const seed = (fin(opts.seed, 666)) | 0;
  const cfg = AW.mergeConfig(AW.DEFAULT_CONFIG, opts.config || {});
  const world = AW.getWorld(seed, cfg);
  const rand = AW.rng((seed ^ 0x5bd1e995) >>> 0);
  const lair = world.lair;
  const types = Object.keys(cfg.monsters);

  const emptyType = () => ({ encounters: 0, kills: 0, ttkSum: 0, ttks: [], dmgToHero: 0, deaths: 0 });
  const S = {
    seed, cfg, tick: 0, t: 0, phase: 'play',
    hero: null, monsters: [], projectiles: [], boss: null, fx: [],
    ev: [], nextId: 1,
    discovered: {}, lit: {}, whispered: [false, false, false, false], damnWarned: {}, warned: false,
    trail: null, respawn: { x: 0, y: 8 }, deathTimer: 0, spawnT: 0,
    bossReset: { t: 0, forced: false },
    stats: { kills: 0, deaths: 0, signsFound: 0, bossAttempts: 0, bossKills: 0, distance: 0, damageDealt: 0, damageTaken: 0, byType: { boss: emptyType() } },
    ending: null,
  };
  for (const k of types) S.stats.byType[k] = emptyType();
  const stats = S.stats;

  // ---------------------------------------------------------- hero helpers
  const maxHpFor = L => cfg.hpBase + cfg.hpPerLevel * (L - 1);
  const dmgFor = L => cfg.dmgBase + cfg.dmgPerLevel * (L - 1);
  const xpNext = L => Math.round(cfg.xpBase * Math.pow(L, cfg.xpExp));
  const rungFor = L => { let r = 0; for (let i = 0; i < cfg.rungs.length; i++) if (L >= cfg.rungs[i].level) r = i; return r; };
  const emit = (type, o) => { const e = { t: r2(S.t), type }; if (o) Object.assign(e, o); S.ev.push(e); };

  const startL = Math.max(1, Math.min(cfg.maxLevel, Math.round(cfg.startLevel)));
  const H = S.hero = {
    x: 0, y: 8, hp: 1, maxHp: maxHpFor(startL), level: startL, xp: Math.max(0, cfg.startXp || 0), damage: dmgFor(startL),
    rung: rungFor(startL), humanity: 100, attackCd: 0, invuln: 0, face: 0, fx: 0, fy: 1, walk: 0, moving: false,
    inWater: false, sinceCombat: 99, dashT: 0, dashVx: 0, dashVy: 0, dashHit: [], wrathT: 0,
    cd: { dash: 0, nova: 0, wrath: 0 }, aim: Math.PI / 2, lastAttackT: -9,
  };
  H.hp = H.maxHp; H.humanity = cfg.rungs[H.rung].humanity;
  if (opts.x !== undefined) H.x = opts.x;
  if (opts.y !== undefined) H.y = opts.y;
  S.respawn = { x: H.x, y: H.y };

  const wrathOn = () => H.wrathT > 0;
  const heroDamage = () => H.damage * (wrathOn() ? cfg.wrath.dmgMul : 1);

  function damnationProgress() {
    if (H.level < cfg.bossReadyLevel) return 0;
    const span = cfg.damnationLevel - cfg.bossReadyLevel;
    const frac = H.level >= cfg.maxLevel ? 1 : H.xp / xpNext(H.level);
    return Math.min(1, Math.max(0, (H.level - cfg.bossReadyLevel + frac) / span));
  }
  function gainXp(n) {
    if (H.level >= cfg.maxLevel || S.phase !== 'play') return;
    if (H.level >= cfg.bossReadyLevel) n *= cfg.xpAfterReady;
    H.xp += n;
    while (H.level < cfg.maxLevel && H.xp >= xpNext(H.level)) {
      H.xp -= xpNext(H.level);
      H.level++;
      H.maxHp = maxHpFor(H.level); H.hp = H.maxHp; H.damage = dmgFor(H.level);
      emit('levelup', { level: H.level });
      const rg = rungFor(H.level);
      if (rg !== H.rung) {
        H.rung = rg; H.humanity = cfg.rungs[rg].humanity;
        if (rg === 3) emit('whisper', { text: cfg.fireWhisperText, voice: null, fire: true });
        emit('rung', { rung: rg, name: cfg.rungs[rg].name, text: cfg.rungs[rg].text, humanity: H.humanity });
      }
      const wi = cfg.damnationWarnLevels.indexOf(H.level);
      if (wi >= 0 && !S.damnWarned[H.level]) { S.damnWarned[H.level] = true; emit('damnation_warning', { level: H.level, text: cfg.damnationWarnTexts[wi] }); }
      if (H.level >= cfg.damnationLevel && S.phase === 'play') {
        S.phase = 'damned'; S.ending = 'fall';
        emit('damnation', { ending: 'fall', text: cfg.endingFall, level: H.level, humanity: H.humanity });
        return;
      }
    }
    if (H.level >= cfg.maxLevel) H.xp = 0;
  }

  function healHero(a) { H.hp = Math.min(H.maxHp, H.hp + a); }

  function hurtHero(dmg, src) {
    if (S.phase !== 'play' || H.invuln > 0 || cfg.invulnerable) return false;
    if (wrathOn()) dmg *= cfg.wrath.takenMul;
    dmg = Math.min(dmg, H.hp);
    H.hp -= dmg; H.sinceCombat = 0;
    stats.damageTaken += dmg; stats.byType[src].dmgToHero += dmg;
    emit('hurt', { dmg: r2(dmg), src });
    if (H.hp <= 0.0001) heroDie(src);
    return true;
  }
  function heroDie(src) {
    H.hp = 0; S.phase = 'dead'; S.deathTimer = cfg.respawnDelay;
    stats.deaths++; stats.byType[src].deaths++;
    H.xp = Math.floor(H.xp * (1 - cfg.deathXpLoss));
    H.wrathT = 0; H.dashT = 0; H.moving = false;
    if (S.boss.awake && !S.bossReset.t) { S.bossReset.t = cfg.boss.resetDelay; S.bossReset.forced = true; }
    emit('death', { by: src, level: H.level });
  }
  function heroRespawn() {
    H.x = S.respawn.x; H.y = S.respawn.y + 14; H.hp = H.maxHp; H.invuln = 0; H.sinceCombat = 99;
    S.phase = 'play'; S.warned = false; S.projectiles.length = 0;
    S.monsters = S.monsters.filter(m => Math.hypot(m.x - H.x, m.y - H.y) > cfg.respawnClearR);
    emit('respawn', { x: H.x, y: H.y });
  }

  // ---------------------------------------------------------- damage to enemies
  function lifeSteal(applied) { if (applied > 0) healHero(applied * cfg.lifesteal[H.rung]); }

  function killMonster(m) {
    m.state = 'dead'; m.hp = 0;
    const tp = stats.byType[m.type], mc = cfg.monsters[m.type];
    stats.kills++; tp.kills++;
    if (m.aggroT >= 0) { const tt = S.t - m.aggroT; tp.ttkSum += tt; if (tp.ttks.length < 400) tp.ttks.push(r2(tt)); }
    const xp = Math.round(mc.xp * (1 + cfg.monXpPerLevel * (m.level - 1)));
    emit('kill', { monster: m.type, id: m.id, level: m.level, xp });
    if (mc.dropChance && rand() < mc.dropChance) {
      const c = AW.compass(lair.x - m.x, lair.y - m.y);
      setTrail({ dir: c.dir, dirVec: c.dirVec, kind: 'whisper', temp: cfg.signTemp.whisper });
      emit('hint', { dir: c.dir, dirVec: c.dirVec, text: cfg.whisperHintText.replace('{dir}', c.dir), x: m.x, y: m.y });
    }
    gainXp(xp);
  }
  function aggro(m) {
    if (m.aggroT < 0) { m.aggroT = S.t; stats.byType[m.type].encounters++; }
    if (m.state === 'idle') m.state = 'chase';
  }
  // kind 'hit': armour + reaction. 'dot': direct hp loss
  function damageMonster(m, raw, kind, fromX, fromY, knock) {
    if (m.state === 'dead') return 0;
    const mc = cfg.monsters[m.type];
    let d = raw;
    if (kind === 'hit' && mc.armour) d = Math.max(1, raw - mc.armour);
    d = Math.min(d, m.hp);
    m.hp -= d; stats.damageDealt += d; H.sinceCombat = 0;
    if (kind === 'hit') {
      aggro(m);
      if (!mc.noStagger) {
        const dx = m.x - fromX, dy = m.y - fromY, dd = Math.hypot(dx, dy) || 1;
        const k = knock || cfg.hitKnock;
        m.kx += dx / dd * k; m.ky += dy / dd * k;
        m.state = 'stagger'; m.stateT = cfg.hitStagger;
      }
      lifeSteal(d);
    } else if (m.state === 'idle') aggro(m);
    if (m.hp <= 0.0001) killMonster(m);
    return d;
  }
  function damageBoss(raw, kind) {
    const B = S.boss;
    if (B.hp <= 0) return 0;
    let d = raw;
    if (kind === 'hit') d = Math.max(1, raw - cfg.boss.armour);
    d = Math.min(d, B.hp);
    B.hp -= d; stats.damageDealt += d; H.sinceCombat = 0;
    if (kind === 'hit') lifeSteal(d);
    const ratio = B.hp / B.maxHp;
    const ph = ratio > cfg.boss.phase2At ? 1 : ratio > cfg.boss.phase3At ? 2 : 3;
    if (B.hp <= 0.0001) { bossVictory(); return d; }
    if (ph > B.phase) {
      B.phase = ph;
      emit('boss_phase', { phase: ph, text: ph === 3 ? cfg.boss.phase3Text : cfg.boss.phase2Text });
    }
    return d;
  }
  function bossVictory() {
    const B = S.boss; B.hp = 0;
    S.phase = 'won'; stats.bossKills++;
    const walk = H.humanity > 0;
    S.ending = walk ? 'walk_home' : 'new_master';
    emit('victory', { ending: S.ending, text: walk ? cfg.endingWalkHome : cfg.endingNewMaster, humanity: H.humanity, level: H.level });
  }

  function setTrail(t) { S.trail = t; }

  // ---------------------------------------------------------- monsters
  function monLevel(x, y) {
    const heat = world.heatAt(x, y);
    return Math.max(1, Math.min(cfg.monsterMaxLevel, 1 + Math.round(heat * cfg.monsterHeatLevels) + Math.floor(Math.hypot(x, y) / cfg.monsterLevelDistStep)));
  }
  function makeMonster(type, x, y, level, extra) {
    const mc = cfg.monsters[type];
    const hp = Math.round(mc.hp * (1 + cfg.monHpPerLevel * (level - 1)));
    const m = {
      id: S.nextId++, type, x, y, level, hp, maxHp: hp, dmg: mc.dmg * (1 + cfg.monDmgPerLevel * (level - 1)),
      state: 'idle', stateT: 0, windDur: 0, kx: 0, ky: 0, aggroT: -1, shotCd: 1 + rand(), wAng: rand() * TAU, wT: 1 + rand() * 3,
      burnT: 0, burnDps: 0, strafe: rand() < .5 ? 1 : -1, pack: 0, follower: false, summoned: false, face: 0,
    };
    if (extra) Object.assign(m, extra);
    S.monsters.push(m);
    return m;
  }

  function shoot(x, y, ang, speed, dmg, src) {
    S.projectiles.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, r: cfg.projR, ttl: cfg.projTtl, src });
  }

  function moveMon(m, vx, vy, mc) {
    const nx = m.x + (vx + m.kx) * DT, ny = m.y + (vy + m.ky) * DT;
    if (mc.float) { m.x = nx; m.y = ny; }
    else {
      const wOk = !!mc.water;
      if (wOk || !world.waterAt(nx, ny)) { m.x = nx; m.y = ny; }
      else if (!world.waterAt(nx, m.y)) m.x = nx;
      else if (!world.waterAt(m.x, ny)) m.y = ny;
      world.pushOut(m, cfg.monsterR - 1);
    }
    m.kx *= cfg.kbDecay; m.ky *= cfg.kbDecay;
  }

  function monsterTick(m, alive) {
    const mc = cfg.monsters[m.type];
    const dx = H.x - m.x, dy = H.y - m.y;
    const hd = alive ? Math.hypot(dx, dy) : 1e9;
    const ux = hd < 1e8 ? dx / (hd || 1) : 0, uy = hd < 1e8 ? dy / (hd || 1) : 0;
    // status effects
    if (m.burnT > 0) { m.burnT -= DT; damageMonster(m, m.burnDps * DT, 'dot'); if (m.state === 'dead') return; }
    let slow = 1;
    if (alive && H.rung >= 4 && hd <= cfg.dread.radius) {
      slow = 1 - cfg.dread.slow;
      damageMonster(m, heroDamage() * cfg.dread.dpsMul * DT, 'dot');
      if (m.state === 'dead') return;
    }
    const aggroR = mc.aggro || cfg.aggroDefault;
    m.face = Math.atan2(uy, ux);
    switch (m.state) {
      case 'stagger':
        m.stateT -= DT; moveMon(m, 0, 0, mc);
        if (m.stateT <= 0) m.state = hd < cfg.giveUpDist ? 'chase' : 'idle';
        break;
      case 'windup': {
        m.stateT -= DT; moveMon(m, 0, 0, mc);
        if (m.stateT <= 0) {
          if (mc.ranged) {
            shoot(m.x, m.y, alive ? Math.atan2(dy, dx) : m.face, mc.projSpeed, m.dmg, m.type);
            m.shotCd = mc.cd; m.state = 'recover'; m.stateT = cfg.rangedRecover;
          } else {
            if (alive && hd <= mc.reach + cfg.strikeSlack) {
              if (hurtHero(m.dmg, m.type) && mc.lifesteal) m.hp = Math.min(m.maxHp, m.hp + m.dmg);
            }
            m.state = 'recover'; m.stateT = mc.cd;
          }
        }
        break;
      }
      case 'recover':
        m.stateT -= DT; if (mc.ranged) m.shotCd -= DT;
        moveMon(m, 0, 0, mc);
        if (m.stateT <= 0) m.state = alive && hd < cfg.giveUpDist ? 'chase' : 'idle';
        break;
      case 'idle': {
        m.wT -= DT;
        if (m.wT <= 0) { m.wAng = rand() * TAU; m.wT = 2 + rand() * 3; m.wMove = rand() < .6; }
        const sp = m.wMove ? mc.speed * .4 * slow : 0;
        moveMon(m, Math.cos(m.wAng) * sp, Math.sin(m.wAng) * sp, mc);
        if (hd < aggroR) aggro(m);
        break;
      }
      case 'chase': {
        if (hd > cfg.giveUpDist) { m.state = 'idle'; break; }
        let sp = mc.speed;
        if (mc.water) sp = world.waterAt(m.x, m.y) ? mc.speedWater : mc.speed;
        sp *= slow;
        if (mc.ranged) {
          m.shotCd -= DT;
          let vx = 0, vy = 0;
          if (hd > mc.keepMax) { vx = ux * sp; vy = uy * sp; }
          else if (hd < mc.keepMin) { vx = -ux * sp; vy = -uy * sp; }
          else { vx = -uy * m.strafe * sp * .5; vy = ux * m.strafe * sp * .5; }
          moveMon(m, vx, vy, mc);
          if (m.shotCd <= 0 && hd <= mc.shootRange) { m.state = 'windup'; m.stateT = m.windDur = mc.windup; }
        } else {
          if (hd <= mc.reach) { m.state = 'windup'; m.stateT = m.windDur = mc.windup; moveMon(m, 0, 0, mc); }
          else moveMon(m, ux * sp, uy * sp, mc);
        }
        break;
      }
    }
  }

  function separateMonsters() {
    const ms = S.monsters, R = cfg.monsterR * 1.6;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (b.state === 'dead') continue;
        const dx = b.x - a.x; if (dx > R || dx < -R) continue;
        const dy = b.y - a.y; if (dy > R || dy < -R) continue;
        const d = Math.hypot(dx, dy);
        if (d < R) {
          const p = (R - d) * .25, nx = d > .01 ? dx / d : 1, ny = d > .01 ? dy / d : 0;
          a.x -= nx * p; a.y -= ny * p; b.x += nx * p; b.y += ny * p;
        }
      }
    }
  }
  function pushHeroOut() {
    if (S.phase !== 'play' || H.dashT > 0) return;
    const R = cfg.heroR + cfg.monsterR;
    for (const m of S.monsters) {
      if (m.state === 'dead') continue;
      const dx = m.x - H.x, dy = m.y - H.y;
      if (dx > R || dx < -R || dy > R || dy < -R) continue;
      const d = Math.hypot(dx, dy);
      if (d < R) {
        const p = R - d, nx = d > .01 ? dx / d : 1, ny = d > .01 ? dy / d : 0;
        m.x += nx * p * .6; m.y += ny * p * .6; H.x -= nx * p * .4; H.y -= ny * p * .4;
      }
    }
    const B = S.boss;
    if (B.hp > 0 && (B.awake || true)) {
      const Rb = cfg.heroR + cfg.boss.r, dx = B.x - H.x, dy = B.y - H.y, d = Math.hypot(dx, dy);
      if (d < Rb && H.dashT <= 0) { const p = Rb - d, nx = d > .01 ? dx / d : 1, ny = d > .01 ? dy / d : 0; H.x -= nx * p; H.y -= ny * p; }
    }
    world.pushOut(H, cfg.heroR);
  }

  // ---------------------------------------------------------- spawner
  function spawnTick() {
    S.spawnT -= DT;
    if (S.spawnT > 0) return;
    S.spawnT += cfg.spawnInterval;
    if (S.t < cfg.spawnDelay || S.phase !== 'play') return;
    const heat = world.heatAt(H.x, H.y);
    let count = 0;
    for (const m of S.monsters) if (m.state !== 'dead' && !m.follower && Math.hypot(m.x - H.x, m.y - H.y) < cfg.spawnCountR) count++;
    if (count >= cfg.spawnBase + heat * cfg.spawnHeat) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = rand() * TAU, d = cfg.spawnMin + rand() * (cfg.spawnMax - cfg.spawnMin);
      const x = H.x + Math.cos(a) * d, y = H.y + Math.sin(a) * d;
      if (Math.hypot(x - lair.x, y - lair.y) < cfg.arenaRadius) continue;
      const cell = world.cellAt(x, y), water = (cell & 1) === 1, biome = cell >> 1;
      if (world.bonfiresNear(x, y, cfg.bonfireSafeR).length) continue;
      if (world.blockedAt(x, y, cfg.monsterR)) continue;
      let type = null;
      if (water) { if (biome !== 1) continue; type = 'lurker'; }
      else {
        let tot = 0; const w = [];
        for (const k of types) {
          const mc = cfg.monsters[k]; let wt = 0;
          if (mc.water) wt = 0;
          else if (mc.anyBiome) wt = heat * cfg.cultistHeatWeight;
          else if (mc.biomes.indexOf(biome) >= 0) wt = 1;
          w.push(wt); tot += wt;
        }
        if (tot <= 0) continue;
        let q = rand() * tot;
        for (let i = 0; i < types.length; i++) { q -= w[i]; if (q <= 0 && w[i] > 0) { type = types[i]; break; } }
        if (!type) continue;
      }
      const lvl = monLevel(x, y), mc = cfg.monsters[type];
      if (mc.packMin) {
        const n = mc.packMin + Math.floor(rand() * (mc.packMax - mc.packMin + 1));
        const pid = S.nextId;
        for (let i = 0; i < n; i++) {
          const m = makeMonster(type, x + (rand() - .5) * 28, y + (rand() - .5) * 28, lvl, { pack: pid, follower: i > 0 });
          world.pushOut(m, cfg.monsterR);
        }
      } else makeMonster(type, x, y, lvl);
      return;
    }
  }

  // ---------------------------------------------------------- boss
  const B = S.boss = {
    x: lair.x, y: lair.y, hp: cfg.boss.hp, maxHp: cfg.boss.hp, phase: 1, awake: false, state: 'sleep', stateT: 0,
    boltT: 1, ringT: 2, summonT: 5, novaCd: 0, nearT: 0, vx: 0, vy: 0, face: 0, windDur: 0,
  };
  function bossResetNow() {
    B.hp = B.maxHp; B.phase = 1; B.awake = false; B.state = 'sleep'; B.x = lair.x; B.y = lair.y;
    B.boltT = 1; B.ringT = 2; B.summonT = 5; B.novaCd = 0; B.nearT = 0; B.stateT = 0;
    S.bossReset.t = 0; S.bossReset.forced = false;
    S.monsters = S.monsters.filter(m => !m.summoned);
    S.projectiles = S.projectiles.filter(p => p.src !== 'boss');
  }
  function bossTick() {
    const bc = cfg.boss, alive = S.phase === 'play';
    const hdx = H.x - B.x, hdy = H.y - B.y, hd = Math.hypot(hdx, hdy);
    const dl = Math.hypot(H.x - lair.x, H.y - lair.y);
    if (!B.awake) {
      if (alive && dl <= bc.wakeDist) {
        B.awake = true; B.state = 'idle'; stats.bossAttempts++; B.nearT = 0;
        emit('boss_awake', { attempt: stats.bossAttempts });
      }
      return;
    }
    // reset rules
    const R = S.bossReset;
    if (!R.t) { if (alive && dl > bc.resetDist) { R.t = bc.resetDelay; R.forced = false; } }
    else {
      if (!R.forced && alive && dl <= bc.resetDist) R.t = 0;
      else { R.t -= DT; if (R.t <= 0) { bossResetNow(); return; } }
    }
    if (!alive) return;
    const cm = B.phase === 3 ? bc.phase3CdMul : 1;
    let sp = bc.speed * (B.phase === 3 ? bc.phase3SpeedMul : 1);
    if (H.rung >= 4 && hd <= cfg.dread.radius) {
      sp *= 1 - cfg.dread.slow;
      damageBoss(heroDamage() * cfg.dread.dpsMul * DT, 'dot');
      if (S.phase !== 'play') return;
    }
    if (B.burnT > 0) { B.burnT -= DT; damageBoss(B.burnDps * DT, 'dot'); if (S.phase !== 'play') return; }
    const ang = Math.atan2(hdy, hdx); B.face = ang;
    B.novaCd -= DT;
    if (B.state === 'nova') {
      B.stateT -= DT;
      if (B.stateT <= 0) {
        if (hd <= bc.novaR) hurtHero(bc.novaDmg, 'boss');
        S.fx.push({ type: 'bossnova', x: B.x, y: B.y, t: 0, dur: .4, r: bc.novaR });
        B.state = 'idle'; B.novaCd = bc.novaCd * cm;
      }
      return;
    }
    // movement: approach hero, stay within the leash
    if (hd > 24) { B.x += hdx / hd * sp * DT; B.y += hdy / hd * sp * DT; }
    const lx = B.x - lair.x, ly = B.y - lair.y, ld = Math.hypot(lx, ly);
    if (ld > bc.leash) { B.x = lair.x + lx / ld * bc.leash; B.y = lair.y + ly / ld * bc.leash; }
    // teleport when the hero clings to him
    if (hd < bc.teleNear) {
      B.nearT += DT;
      if (B.nearT > bc.teleTime) {
        B.nearT = 0;
        for (let k = 0; k < 12; k++) {
          const a = rand() * TAU, tx = H.x + Math.cos(a) * bc.teleDist, ty = H.y + Math.sin(a) * bc.teleDist;
          if (Math.hypot(tx - lair.x, ty - lair.y) < cfg.arenaRadius) { B.x = tx; B.y = ty; S.fx.push({ type: 'tele', x: tx, y: ty, t: 0, dur: .5 }); break; }
        }
      }
    } else B.nearT = 0;
    // nova
    if (hd <= bc.novaNear && B.novaCd <= 0) { B.state = 'nova'; B.stateT = B.windDur = bc.novaWindup; return; }
    // bolts
    B.boltT -= DT;
    if (B.boltT <= 0) {
      B.boltT = bc.boltCd * cm;
      const spread = bc.boltSpreadDeg * Math.PI / 180;
      for (let i = 0; i < bc.boltCount; i++) shoot(B.x, B.y, ang - spread / 2 + spread * (bc.boltCount > 1 ? i / (bc.boltCount - 1) : .5), bc.boltSpeed, bc.boltDmg, 'boss');
    }
    if (B.phase >= 2) {
      B.ringT -= DT;
      if (B.ringT <= 0) {
        B.ringT = bc.ringCd * cm;
        const off = rand() * TAU;
        for (let i = 0; i < bc.ringCount; i++) shoot(B.x, B.y, off + i / bc.ringCount * TAU, bc.boltSpeed, bc.ringDmg, 'boss');
      }
      B.summonT -= DT;
      if (B.summonT <= 0) {
        B.summonT = bc.summonCd * cm;
        for (let i = 0; i < bc.summonCount; i++) {
          const a = rand() * TAU;
          const m = makeMonster('ghoul', B.x + Math.cos(a) * 36, B.y + Math.sin(a) * 36, bc.summonLevel, { summoned: true });
          aggro(m); m.state = 'chase';
        }
      }
    }
  }

  // ---------------------------------------------------------- projectiles
  function projectileTick() {
    const ps = S.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx * DT; p.y += p.vy * DT; p.ttl -= DT;
      let remove = p.ttl <= 0;
      if (!remove && S.phase === 'play') {
        const dx = p.x - H.x, dy = p.y - H.y;
        if (dx * dx + dy * dy < cfg.projHitR * cfg.projHitR && H.invuln <= 0) { hurtHero(p.dmg, p.src); remove = true; }
      }
      if (remove) { ps[i] = ps[ps.length - 1]; ps.pop(); }
    }
    // order of removal swaps; keep deterministic (it is)
  }

  // ---------------------------------------------------------- hero update
  function heroTick(a) {
    H.attackCd = Math.max(0, H.attackCd - DT);
    H.invuln = Math.max(0, H.invuln - DT);
    H.sinceCombat += DT;
    for (const k in H.cd) H.cd[k] = Math.max(0, H.cd[k] - DT);
    if (H.wrathT > 0) H.wrathT = Math.max(0, H.wrathT - DT);

    let mx = fin(a.mx, 0), my = fin(a.my, 0);
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const hasAim = fin(a.aimX, null) !== null && fin(a.aimY, null) !== null;
    const aimAng = hasAim ? Math.atan2(a.aimY - H.y, a.aimX - H.x) : null;
    H.inWater = world.waterAt(H.x, H.y);

    // abilities
    const ab = a.ability;
    if (ab === 'dash' && H.rung >= 2 && H.cd.dash <= 0 && H.dashT <= 0) {
      let dx = mx, dy = my;
      if (Math.hypot(dx, dy) < .1) { if (aimAng !== null) { dx = Math.cos(aimAng); dy = Math.sin(aimAng); } else { dx = H.fx; dy = H.fy; } }
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const c = cfg.dash;
      H.dashT = c.time; H.dashVx = dx * c.dist / c.time; H.dashVy = dy * c.dist / c.time; H.dashHit = [];
      H.cd.dash = c.cd; H.invuln = Math.max(H.invuln, c.time + c.invulnAfter);
      H.fx = dx; H.fy = dy;
      S.fx.push({ type: 'dash', x: H.x, y: H.y, a: Math.atan2(dy, dx), t: 0, dur: .3 });
    } else if (ab === 'nova' && H.rung >= 3 && H.cd.nova <= 0) {
      const c = cfg.nova; H.cd.nova = c.cd;
      const dmg = heroDamage() * c.dmgMul;
      for (const m of S.monsters) {
        if (m.state === 'dead') continue;
        if (Math.hypot(m.x - H.x, m.y - H.y) <= c.radius + cfg.monsterR) {
          const mm = m;
          damageMonster(mm, dmg, 'hit', H.x, H.y, c.knock);
          if (mm.state !== 'dead') { mm.burnT = c.burnTime; mm.burnDps = heroDamage() * c.burnDmgMul; }
        }
      }
      if (B.hp > 0 && Math.hypot(B.x - H.x, B.y - H.y) <= c.radius + cfg.boss.r) {
        damageBoss(dmg, 'hit'); if (B.hp > 0) { B.burnT = c.burnTime; B.burnDps = heroDamage() * c.burnDmgMul; }
      }
      S.fx.push({ type: 'nova', x: H.x, y: H.y, t: 0, dur: .45, r: c.radius });
    } else if (ab === 'wrath' && H.rung >= 5 && H.cd.wrath <= 0) {
      H.wrathT = cfg.wrath.dur; H.cd.wrath = cfg.wrath.cd;
      S.fx.push({ type: 'wrath', x: H.x, y: H.y, t: 0, dur: .6 });
    }
    if (S.phase !== 'play') return;

    // movement
    if (H.dashT > 0) {
      const step = Math.min(DT, H.dashT);
      const ox = H.x, oy = H.y;
      H.x += H.dashVx * step; H.y += H.dashVy * step;
      world.pushOut(H, cfg.heroR);
      H.dashT -= DT;
      stats.distance += Math.hypot(H.x - ox, H.y - oy);
      for (const m of S.monsters) {
        if (m.state === 'dead' || H.dashHit.indexOf(m.id) >= 0) continue;
        if (Math.hypot(m.x - H.x, m.y - H.y) <= cfg.dash.hitR) {
          H.dashHit.push(m.id); damageMonster(m, heroDamage() * cfg.dash.dmgMul, 'hit', H.x - H.dashVx * .01, H.y - H.dashVy * .01);
        }
      }
      if (B.hp > 0 && H.dashHit.indexOf(-1) < 0 && Math.hypot(B.x - H.x, B.y - H.y) <= cfg.dash.hitR + cfg.boss.r) {
        H.dashHit.push(-1); damageBoss(heroDamage() * cfg.dash.dmgMul, 'hit');
      }
      H.moving = true; H.walk += DT * 15;
      return;
    }
    H.moving = ml > .15;
    if (H.moving) {
      const run = !!a.run;
      const speed = (run ? cfg.runSpeed : cfg.walkSpeed) * (H.inWater ? cfg.waterSpeedMul : 1);
      const ox = H.x, oy = H.y;
      H.x += mx * speed * DT; H.y += my * speed * DT;
      world.pushOut(H, cfg.heroR);
      stats.distance += Math.hypot(H.x - ox, H.y - oy);
      H.walk += DT * (run ? 15 : 10) * (H.inWater ? .6 : 1);
      const fl = Math.hypot(mx, my) || 1; H.fx = mx / fl; H.fy = my / fl;
      if (Math.abs(mx) > Math.abs(my) * 1.1) H.face = mx < 0 ? 2 : 3; else H.face = my < 0 ? 1 : 0;
    }

    // attack
    if (a.attack && H.attackCd <= 0) {
      const reach = cfg.attackReach, mr = cfg.monsterR;
      let ang = null;
      if (aimAng !== null) ang = aimAng;
      else {
        let best = null, bd = 1e9;
        for (const m of S.monsters) {
          if (m.state === 'dead') continue;
          const d = Math.hypot(m.x - H.x, m.y - H.y) - mr;
          if (d <= reach + cfg.autoAimExtra && d < bd) { bd = d; best = m; }
        }
        if (B.hp > 0 && B.awake) { const d = Math.hypot(B.x - H.x, B.y - H.y) - cfg.boss.r; if (d <= reach + cfg.autoAimExtra && d < bd) { bd = d; best = B; } }
        ang = best ? Math.atan2(best.y - H.y, best.x - H.x) : Math.atan2(H.fy, H.fx);
      }
      H.aim = ang; H.fx = Math.cos(ang); H.fy = Math.sin(ang);
      if (Math.abs(H.fx) > Math.abs(H.fy) * 1.1) H.face = H.fx < 0 ? 2 : 3; else H.face = H.fy < 0 ? 1 : 0;
      H.attackCd = cfg.attackCd * (wrathOn() ? cfg.wrath.cdMul : 1);
      H.lastAttackT = S.t;
      const half = cfg.attackArcDeg * Math.PI / 360;
      const dmg = heroDamage();
      for (const m of S.monsters) {
        if (m.state === 'dead') continue;
        const dx = m.x - H.x, dy = m.y - H.y, d = Math.hypot(dx, dy);
        if (d > reach + mr) continue;
        if (d > 3 && Math.abs(angDiff(Math.atan2(dy, dx), ang)) > half) continue;
        damageMonster(m, dmg, 'hit', H.x, H.y);
      }
      if (B.hp > 0) {
        const dx = B.x - H.x, dy = B.y - H.y, d = Math.hypot(dx, dy);
        if (d <= reach + cfg.boss.r && (d <= 3 || Math.abs(angDiff(Math.atan2(dy, dx), ang)) <= half)) damageBoss(dmg, 'hit');
      }
      S.fx.push({ type: 'swing', x: H.x, y: H.y, a: ang, t: 0, dur: .18 });
    }
  }

  // ---------------------------------------------------------- world interactions
  function worldTick() {
    // bonfires
    world.eachChunk(H.x, H.y, 60, ch => {
      for (const b of ch.bonfires) {
        const d = Math.hypot(b.x - H.x, b.y - H.y);
        if (d < cfg.bonfireLightR) {
          S.respawn = { x: b.x, y: b.y };
          if (!S.lit[b.id]) { S.lit[b.id] = true; emit('bonfire', { id: b.id, x: b.x, y: b.y, last: !!b.last }); }
        }
        if (d < cfg.bonfireHealR) healHero(H.maxHp * cfg.bonfireHealPct * cfg.restHealMult[H.rung] * DT);
      }
      for (const s of ch.signs) {
        if (S.discovered[s.id]) continue;
        if (Math.hypot(s.x - H.x, s.y - H.y) < cfg.signR) {
          S.discovered[s.id] = true; stats.signsFound++;
          setTrail({ dir: s.dir, dirVec: s.dirVec, kind: s.kind, temp: s.temp });
          emit('sign', { id: s.id, kind: s.kind, camp: !!s.camp, text: s.text, dir: s.dir, dirVec: s.dirVec, x: s.x, y: s.y });
          gainXp(cfg.signXp);
        }
      }
    });
    // whispers
    const dl = Math.hypot(H.x - lair.x, H.y - lair.y);
    for (let i = 0; i < cfg.whisperDists.length; i++) {
      if (!S.whispered[i] && dl < cfg.whisperDists[i]) { S.whispered[i] = true; emit('whisper', { text: cfg.whisperTexts[i], dist: cfg.whisperDists[i], voice: i === 3 ? 'morhain' : null }); }
    }
    if (!S.warned && dl < cfg.warnDist && H.level < cfg.bossReadyLevel) { S.warned = true; emit('warning', { text: cfg.warningText }); }
    // regeneration
    if (H.sinceCombat > cfg.regenDelay) healHero(H.maxHp * cfg.regenPct * cfg.restHealMult[H.rung] * DT);
  }

  // ---------------------------------------------------------- main tick
  function tick(a) {
    if (S.phase === 'won' || S.phase === 'damned') return;
    S.tick++; S.t = S.tick * DT;
    for (let i = S.fx.length - 1; i >= 0; i--) { S.fx[i].t += DT; if (S.fx[i].t >= S.fx[i].dur) S.fx.splice(i, 1); }
    const alive = S.phase === 'play';
    if (alive) heroTick(a);
    if (S.phase === 'won' || S.phase === 'damned') return;
    const ms = S.monsters;
    const aliveNow = S.phase === 'play';
    for (let i = 0; i < ms.length; i++) { if (ms[i].state !== 'dead') monsterTick(ms[i], aliveNow); if (S.phase === 'won' || S.phase === 'damned') return; }
    let w = 0;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.state === 'dead') continue;
      if (Math.hypot(m.x - H.x, m.y - H.y) > cfg.despawnDist && aliveNow && !m.summoned) continue;
      ms[w++] = m;
    }
    ms.length = w;
    separateMonsters();
    bossTick();
    if (S.phase === 'won') return;
    projectileTick();
    pushHeroOut();
    if (S.phase === 'play') { worldTick(); spawnTick(); }
    if (S.phase === 'dead') { S.deathTimer -= DT; if (S.deathTimer <= 0) heroRespawn(); }
  }

  const IDLE = { mx: 0, my: 0 };
  function step(action, ticks) {
    const a = action || IDLE; const n = ticks === undefined ? 1 : ticks;
    for (let i = 0; i < n; i++) { tick(a); if (S.phase === 'won' || S.phase === 'damned') break; }
  }
  function events() { const e = S.ev; S.ev = []; return e; }

  // ---------------------------------------------------------- observation
  // coarse public distance signal: 0 cold .. 4 burning, by cfg.warmthSteps (px from the lair)
  function warmthOf(d) { let w = 0; for (const s of cfg.warmthSteps || []) if (d < s) w++; return w; }
  function observe() {
    const R = 400;
    const monsters = [];
    for (const m of S.monsters) {
      if (m.state === 'dead') continue;
      const d = Math.hypot(m.x - H.x, m.y - H.y);
      if (d > R) continue;
      const mc = cfg.monsters[m.type];
      monsters.push({ id: m.id, type: m.type, x: r2(m.x), y: r2(m.y), hp: Math.round(m.hp * 10) / 10, maxHp: m.maxHp, level: m.level, state: m.state, dist: r2(d),
        windT: m.state === 'windup' ? r2(m.stateT) : 0, reach: mc.reach || 0, ranged: !!mc.ranged, burning: m.burnT > 0 });
    }
    monsters.sort((p, q) => p.dist - q.dist || p.id - q.id);
    const projectiles = [];
    for (const p of S.projectiles) {
      const d = Math.hypot(p.x - H.x, p.y - H.y);
      if (d <= R) projectiles.push({ x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), dmg: r2(p.dmg), dist: r2(d) });
    }
    const dl = Math.hypot(H.x - lair.x, H.y - lair.y);
    const boss = dl <= 600 ? { x: r2(B.x), y: r2(B.y), hp: Math.round(B.hp), maxHp: B.maxHp, phase: B.phase, awake: B.awake, dist: r2(Math.hypot(B.x - H.x, B.y - H.y)), state: B.state, windT: B.state === 'nova' ? r2(B.stateT) : 0 } : null;
    const signs = world.signsNear(H.x, H.y, R).filter(o => !S.discovered[o.s.id]).map(o => ({ id: o.s.id, x: r2(o.s.x), y: r2(o.s.y), kind: o.s.kind, dist: r2(o.d) }));
    const bonfires = world.bonfiresNear(H.x, H.y, 600).map(o => ({ x: r2(o.b.x), y: r2(o.b.y), lit: !!S.lit[o.b.id], dist: r2(o.d) }));
    const ability = (k, unlocked, active) => ({ unlocked, cd: r2(H.cd[k]), active });
    const obs = {
      t: r2(S.t), phase: S.phase,
      player: {
        x: r2(H.x), y: r2(H.y), hp: r2(H.hp), maxHp: H.maxHp, level: H.level, xp: Math.round(H.xp), xpNext: H.level >= cfg.maxLevel ? 0 : xpNext(H.level),
        rung: H.rung, humanity: H.humanity, damage: H.damage, attackCd: r2(H.attackCd), invuln: r2(H.invuln), inWater: H.inWater,
        biome: BIOME[world.biomeAt(H.x, H.y)],
        warmth: warmthOf(Math.hypot(H.x - lair.x, H.y - lair.y)),
        damnation: r2(damnationProgress()), restHealMult: cfg.restHealMult[H.rung], lifesteal: cfg.lifesteal[H.rung],
        abilities: {
          dash: ability('dash', H.rung >= 2, H.dashT > 0),
          nova: ability('nova', H.rung >= 3, false),
          wrath: ability('wrath', H.rung >= 5, H.wrathT > 0),
        },
      },
      monsters, projectiles, boss, signs, bonfires,
      trail: S.trail ? { dir: S.trail.dir, dirVec: S.trail.dirVec, kind: S.trail.kind, temp: S.trail.temp } : null,
      stats: { kills: stats.kills, deaths: stats.deaths, signsFound: stats.signsFound, bossAttempts: stats.bossAttempts, distance: Math.round(stats.distance), damageDealt: Math.round(stats.damageDealt), damageTaken: Math.round(stats.damageTaken) },
    };
    if (cfg.debugObs) obs.debug = { lair: { x: r2(lair.x), y: r2(lair.y) }, heat: r2(world.heatAt(H.x, H.y)) };
    return obs;
  }

  return { step, observe, events, state: S, config: cfg, world, DT };
}

AW.DT = DT;
AW.createGame = createGame;
})(globalThis.AW = globalThis.AW || {});
