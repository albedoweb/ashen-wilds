// Ashen Wilds: every tunable number (DESIGN.md sections 1, 3-8). Classic script, no DOM.
(function (AW) {
'use strict';
const C = {
  // ---- testing flags
  startLevel: 1,          // hero starts at this level (rung unlocked silently)
  startXp: 0,             // xp already gained inside the start level (tests)
  invulnerable: false,    // hero takes no damage
  debugObs: false,        // observe().debug = {lair, heat}

  // ---- hero (section 3)
  hpBase: 100, hpPerLevel: 18,
  dmgBase: 14, dmgPerLevel: 4,
  walkSpeed: 62, runSpeed: 115, waterSpeedMul: 0.5,   // px/s
  attackArcDeg: 120, attackReach: 22, attackCd: 0.45, autoAimExtra: 12,
  xpBase: 125, xpExp: 1.1, maxLevel: 10,               // xpNext = round(xpBase * L^xpExp)
  regenDelay: 4, regenPct: 0.02,                      // after 4 s quiet: 2% maxHp / s
  bonfireLightR: 26, bonfireHealR: 40, bonfireHealPct: 0.25, bonfireSafeR: 160,
  respawnDelay: 2.5, deathXpLoss: 0.5, respawnClearR: 300,
  heroR: 4, monsterR: 6, kbDecay: 0.88,

  // ---- ladder (section 4)
  rungs: [
    { level: 1, name: 'The Mourner', humanity: 100, text: '' },
    { level: 2, name: 'Bloodthirst', humanity: 80, text: 'The first kill tasted of iron. You wanted another.' },
    { level: 3, name: 'Shadowstep', humanity: 60, text: 'You step through the dark as if it were a door.' },
    { level: 4, name: 'Hellfire', humanity: 40, text: 'Your torch no longer burns. It hungers.' },
    { level: 5, name: 'Dread', humanity: 20, text: 'They fear you now. Good.' },
    { level: 6, name: 'Wrath of the Damned', humanity: 0, text: 'There is no man left to stop you.' },
  ],
  xpAfterReady: 1.0,        // xp multiplier at/above bossReadyLevel (no runaway xp near the lair)
  restHealMult: [1, 0.85, 0.7, 0.5, 0.3, 0.15],   // by rung: passive regen AND bonfire healing
  lifesteal: [0, 0.15, 0.2, 0.25, 0.3, 0.35],      // by rung: share of damage dealt
  fireWhisperText: 'The fire no longer warms you. Only blood does.',
  dash: { dist: 70, time: 0.15, invulnAfter: 0.1, cd: 3, dmgMul: 1, hitR: 12 },
  nova: { radius: 55, dmgMul: 2.5, knock: 60, burnTime: 3, burnDmgMul: 0.3, cd: 6 },
  dread: { radius: 50, slow: 0.35, dpsMul: 0.25, torchMul: 1.25 },
  wrath: { dur: 8, dmgMul: 2, cdMul: 0.6, takenMul: 0.5, scale: 1.3, cd: 25 },

  // ---- monsters (section 5). biomes: 0 wood, 1 fen, 2 ash, 3 barrows, 4 ruins
  monsters: {
    ghoul:   { name: 'Ghoul', hp: 55, dmg: 8, speed: 48, xp: 10, reach: 14, windup: 0.4, cd: 1.2, biomes: [0, 3, 1] },
    hound:   { name: 'Hollow hound', hp: 32, dmg: 6, speed: 85, xp: 7, reach: 12, windup: 0.25, cd: 0.9, aggro: 170, biomes: [0, 2], packMin: 2, packMax: 3 },
    wraith:  { name: 'Wraith', hp: 40, dmg: 7, speed: 55, xp: 12, reach: 14, windup: 0.35, cd: 1.1, aggro: 160, float: true, lifesteal: true, biomes: [3, 1, 4] },
    lurker:  { name: 'Bog lurker', hp: 70, dmg: 14, speed: 30, speedWater: 60, xp: 20, reach: 16, windup: 0.6, cd: 1.8, water: true, biomes: [1] },
    imp:     { name: 'Cinder imp', hp: 36, dmg: 9, speed: 50, xp: 14, ranged: true, keepMin: 70, keepMax: 110, shootRange: 130, windup: 0.5, cd: 2.2, projSpeed: 110, biomes: [2, 4] },
    knight:  { name: 'Bone knight', hp: 80, dmg: 16, speed: 38, xp: 26, reach: 18, windup: 0.7, cd: 1.6, armour: 3, noStagger: true, biomes: [4, 3] },
    cultist: { name: 'Ashen acolyte', hp: 45, dmg: 10, speed: 45, xp: 18, ranged: true, keepMin: 80, keepMax: 120, shootRange: 130, windup: 0.5, cd: 2.6, projSpeed: 95, anyBiome: true, dropChance: 0.25 },
  },
  monHpPerLevel: 0.35, monDmgPerLevel: 0.8, monXpPerLevel: 0.25,
  aggroDefault: 140, giveUpDist: 500,
  hitKnock: 40, hitStagger: 0.15, strikeSlack: 6, rangedRecover: 0.3,
  monsterHeatLevels: 3, monsterLevelDistStep: 1500, monsterMaxLevel: 5,
  spawnInterval: 1.2, spawnBase: 4, spawnHeat: 4, spawnCountR: 450,
  spawnMin: 230, spawnMax: 320, despawnDist: 650, spawnDelay: 8, cultistHeatWeight: 3,
  projR: 3, projTtl: 3, projHitR: 6,

  // ---- lair and boss (section 6)
  lairDistance: 200,        // tiles
  arenaRadius: 180, arenaClearRadius: 220, obeliskRing: 150, obeliskCount: 8, lastFireDist: 260,
  whisperDists: [2000, 1200, 700, 350],
  whisperTexts: ['The air tastes of sulfur.', 'Chanting rides the wind. Your hands are shaking.', 'The ground is warm, like skin.', 'Mourner. I kept her for you.'],
  warnDist: 700, bossReadyLevel: 6,
  warningText: 'Not yet. Your hatred is too shallow. He would unmake you.',
  boss: {
    hp: 4500, armour: 2, speed: 40, r: 14, leash: 200, wakeDist: 170, resetDelay: 5, resetDist: 400,
    phase2At: 0.6, phase3At: 0.25, phase3SpeedMul: 1.4, phase3CdMul: 0.75,
    boltCd: 2.8, boltCount: 5, boltSpreadDeg: 50, boltSpeed: 120, boltDmg: 16,
    ringCd: 4, ringCount: 12, ringDmg: 16,
    summonCd: 9, summonCount: 2, summonLevel: 3,
    teleNear: 40, teleTime: 1.5, teleDist: 120,
    novaNear: 30, novaWindup: 0.8, novaDmg: 32, novaR: 45, novaCd: 3,
    phase2Text: 'The chanting rises. The ground answers.',
    phase3Text: "Ilse's voice, from inside him: 'Don't stop.'",
  },

  // ---- signs (section 7)
  signMaxP: 0.8, signK: 1.6, signExp: 1.3,
  signRanges: { ribbon: 9, circle: 4, crows: 1.5 },  // chunk distances: dC > 9 ribbon, > 4 circle, > 1.5 crows, else blood
  signR: 22, signXp: 8, campClear: 4, campRibbonDist: 30,
  signTexts: {
    ribbon: 'A strip of her blue ribbon, caught on a thorn. The wind tore it from the {dir} from here.',
    circle: 'A ritual circle of burnt candles. The ash smells of her perfume, and of sulfur. The sigils point {dir} from here.',
    crows: 'Crows nailed to a post, wings spread toward the {dir} from here. He is a few hundred paces away.',
    blood: 'Fresh blood in his sigils, still warm. He is very near, to the {dir} from here, close enough to hear him breathe.',
    camp: 'Her ribbon. The last thing you found of her, the night they took her. You know which way the cart went: {dir} from here.',
  },
  signTemp: { ribbon: 'cold', circle: 'cool', crows: 'warm', blood: 'burning', camp: 'cold', whisper: 'warm' },
  whisperHintText: "The acolyte gurgles: 'He waits to the {dir} from here.'",

  // ---- endings (section 1)
  warmthSteps: [2600, 1800, 1000, 450],  // px from the lair: warmth 1..4 inside each step (0 = cold), observe().player.warmth
  damnationLevel: 9,
  damnationWarnLevels: [7, 8],
  damnationWarnTexts: ['The Pale Below has learned your name.', 'One more step down and there will be no stairs back.'],
  endingWalkHome: 'Morhain is ash. In the chapel lies her veil, nothing more. You fold it with hands that are no longer quite yours. Something of the man remains. Perhaps enough to walk home.',
  endingNewMaster: 'Morhain is ash. Her veil lies on the altar. You do not remember why it matters. The wilds have a new master, and it wears your face.',
  endingFall: 'You were strong enough to kill him long ago. You only had to stop. The Pale Below opens beneath you, and you recognise it: it has the shape of your hate. Somewhere above, Morhain smiles. He needed a successor, and you came down every step by yourself.',
  introText: [
    'Her name was Ilse.',
    'On the night of the ash moon, Morhain, the priest who sold his soul to the Pale Below, came for her and carried her into the wilds. No one has found what is left of her.',
    'You have buried everything else. Only the hate remains.',
    'Find him. Every step will cost you a piece of the man you were.',
  ],
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
// deep merge: plain objects merge, arrays and scalars replace
function merge(dst, src) {
  for (const k of Object.keys(src || {})) {
    if (isObj(src[k]) && isObj(dst[k])) merge(dst[k], src[k]);
    else dst[k] = (isObj(src[k]) || Array.isArray(src[k])) ? clone(src[k]) : src[k];
  }
  return dst;
}
AW.DEFAULT_CONFIG = C;
AW.mergeConfig = (base, over) => merge(clone(base), over || {});
// setConfigPath(cfg, 'monsters.ghoul.hp', '40'); value parsed as JSON when possible
AW.setConfigPath = (cfg, path, val) => {
  let v = val;
  if (typeof val === 'string') { try { v = JSON.parse(val); } catch (e) { v = val; } }
  const ks = path.split('.'); let o = cfg;
  for (let i = 0; i < ks.length - 1; i++) { if (!isObj(o[ks[i]])) o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = v; return cfg;
};
})(globalThis.AW = globalThis.AW || {});
