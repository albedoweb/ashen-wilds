# Ashen Wilds: design (demo level)

Design document of the demo. Numbers are the starting values; current values live in src/config.js.

## 1. Story

Her name was Ilse. On the night of the ash moon, **Morhain, the Ashen Saint** came for her. He was
a priest who sold his soul to the Pale Below. He carried her off into the wilds, and no one has
found what is left of her. The hero, called **the Mourner**, has buried everything else, and only
the hate remains. Every step of the hunt costs him a piece of the man he was.

Intro screen (any key or tap starts):

> Her name was Ilse.
> On the night of the ash moon, Morhain, the priest who sold his soul to the Pale Below, came for her
> and carried her into the wilds. No one has found what is left of her.
> You have buried everything else. Only the hate remains.
> Find him. Every step will cost you a piece of the man you were.

Endings (shown after the boss dies):
- humanity > 0: "Morhain is ash. In the chapel lies her veil, nothing more. You fold it with hands
  that are no longer quite yours. Something of the man remains. Perhaps enough to walk home."
- humanity = 0: "Morhain is ash. Her veil lies on the altar. You do not remember why it matters.
  The wilds have a new master, and it wears your face."

### Endings

There are four outcomes. Dying to Morhain is not an ending; the hero rises at the fire.

| Ending | Condition | Text |
|---|---|---|
| **Walk home** | Morhain killed with humanity > 0 (level ≤ 5). Rare, the hard path | the humanity > 0 text above |
| **The new master** | Morhain killed with humanity 0 (level 6 or more) | the humanity = 0 text above |
| **The Fall** | the hero reaches `damnationLevel` (9) while Morhain still lives | see below |

**The Fall (damnation).** Leveling has an upper bound as well as a lower one. Too weak and
Morhain kills you. Grind too long and the Pale Below claims you before you reach him. Whispers
from below warn the player at level 7 and level 8, events `damnation_warning`:
- level 7: "The Pale Below has learned your name."
- level 8: "One more step down and there will be no stairs back."

On reaching `damnationLevel`, the phase becomes `damned` and the event `damnation` fires. The
renderer shows the ground opening and the hero dragged down. The ending text is: "You were strong
enough to kill him long ago. You only had to stop. The Pale Below opens beneath you, and you
recognise it: it has the shape of your hate. Somewhere above, Morhain smiles. He needed a
successor, and you came down every step by yourself."

The twist, hinted but never stated, is that Morhain took Ilse to make a demon out of the man who
loved her. His whisper "I kept her for you" and her voice "Don't stop" both serve the ritual.
Victory at humanity 0 completes his plan too: the "new master" ending is darker than it looks.

## 2. Architecture

The simulation is separate from rendering. It must run in the browser and in Node without a DOM.
All files are classic scripts, not ES modules, because `file://` pages cannot load modules. Each
file extends one global namespace: `(function (AW) { ... })(globalThis.AW = globalThis.AW || {});`.
Node loads them with `createRequire` in this order.

| File | Contents | DOM? |
|---|---|---|
| `src/config.js` | `AW.DEFAULT_CONFIG`: every tunable number in this document | no |
| `src/world.js` | noise, `field()`, deterministic chunk data (objects, wisps, signs, bonfires), lair placement, blocker queries | no |
| `src/sim.js` | `AW.createGame({seed, config})`: the whole game state and fixed-step update | no |
| `src/bots.js` | `AW.bots.novice`, `.average`, `.expert` (parameterised by skill), `.rusher` | no |
| `src/render.js` | canvas drawing: ground, sprites, lighting, effects | yes |
| `src/main.js` | loop, input, HUD/DOM screens, `window.game` API | yes |
| `index.html` | markup, CSS, script tags | yes |
| `tools/sim.mjs` | headless harness: batch runs, metrics, sweeps | Node |
| `tools/llm_play.mjs` | LLM playtester (DeepSeek) over the same API | Node |
| `tools/check.mjs` | automated checks; exits non-zero on failure | Node |
| `docs/API.md` | how an agent plays and tunes the game | |
| `docs/BALANCE.md` | balance log: each change, why, and the measurement before and after | |

World units are pixels. `TILE = 16` and `CHUNK = 16` tiles, so a chunk is 256 px. North is −y. The
simulation advances in fixed ticks of `DT = 1/60` s. Everything in the simulation is
deterministic. The world uses the seed, and all simulation randomness comes from one seeded rng
owned by the game (mulberry32). The same seed, config and action sequence must give an identical
result. Renderer-only effects such as sparks and flakes may use `Math.random`.

The existing look stays the same: biomes, ground, sprites, torch lighting, fog and long shadows.
Object generation moves to `world.js` with its own rng, seeded by `hash2(cx, cy, seed + 99)`. The
ground canvas detail pass moves to `render.js` with a separate rng, seeded by
`hash2(cx, cy, seed + 98)`.

## 3. The hero

| Stat | Start | Per level |
|---|---|---|
| maxHp | 100 | +18 (full heal on level-up) |
| damage | 14 | +4 |
| walk / run speed | 62 / 115 px/s (×0.5 in water) | |
| attack | 120° cone, reach 22 px, cooldown 0.45 s | |

- **Attack aim.** If the action supplies an aim point, use it. Otherwise auto-aim at the nearest
  monster or boss within reach+12. Failing both, aim the way the hero faces. One swing hits every
  enemy in the cone.
- **XP to next level:** `round(xpBase * L^xpExp)`, with `xpBase 25` and `xpExp 1.5`. Max level 10.
- **Regeneration:** after 4 s without taking or dealing damage, regain 2% of maxHp per second.
- **Bonfires** are checkpoints. Coming within 26 px lights one (event `bonfire`, first time only)
  and sets the respawn point. Standing within 40 px heals 25% of maxHp per second. Monsters never
  spawn within 160 px of a bonfire.
- **Death:** event `death`, then 2.5 s later a respawn at the last bonfire with full hp. The hero
  loses `deathXpLoss` (0.5) of the XP gained in the current level, never whole levels. Monsters
  within 300 px of the respawn point are removed.
- Collision radius 4. Blockers are the world objects with r > 0 and the monsters (soft push).

## 4. The dark ladder of revenge

Each rung unlocks at a level. Humanity falls with every rung. The look changes with every rung,
and the renderer draws it.

| Rung | Level | Name | Effect | Humanity | Look |
|---|---|---|---|---|---|
| 0 | 1 | The Mourner | — | 100 | a man in a hood, warm torch |
| 1 | 2 | Bloodthirst | passive: heal 15% of damage dealt | 80 | eyes burn red |
| 2 | 3 | Shadowstep | active (Q): dash 70 px in 0.15 s along move/aim direction; invulnerable during and 0.1 s after; passes through monsters and hits each once for 1× damage; cooldown 3 s | 60 | cloak in tatters, shadow trail |
| 3 | 4 | Hellfire | active (E): nova radius 55, 2.5× damage, knockback 60, burning 3 s at 0.3× damage/s; cooldown 6 s | 40 | torch flame turns crimson |
| 4 | 5 | Dread | passive aura radius 50: enemies inside move 35% slower and take 0.25× damage/s; the hero sees further in the dark | 20 | ashen skin, small horns |
| 5 | 6 | Wrath of the Damned | active (R): 8 s transformation, damage ×2, attack cooldown ×0.6, damage taken ×0.5, drawn 1.3× larger; cooldown 25 s | 0 | horns, shadow wings, glowing veins |

Unlocking a rung sends event `rung` with its name and one line of text, shown big on screen:
- Bloodthirst: "The first kill tasted of iron. You wanted another."
- Shadowstep: "You step through the dark as if it were a door."
- Hellfire: "Your torch no longer burns. It hungers."
- Dread: "They fear you now. Good."
- Wrath: "There is no man left to stop you."

### Healing changes with the descent (decision after the first playtests)

A man heals by rest, a demon by blood. Each rung weakens rest and fire healing and strengthens
lifesteal. By the last rung the fire barely helps, and only killing keeps him alive. Config arrays
indexed by rung 0..5, as starting values for balance tuning:

| Rung | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| `restHealMult` (regeneration and bonfire healing) | 1.0 | 0.85 | 0.7 | 0.5 | 0.3 | 0.15 |
| `lifesteal` (share of damage dealt) | 0 | 0.15 | 0.2 | 0.25 | 0.3 | 0.35 |

Level-up full heal and full hp on respawn stay as they are. The renderer shows the source of
healing: a warm glow at the fire and from rest, red motes flowing from struck enemies for
lifesteal. When the fire heals little, the glow is faint. Hint shown once on reaching rung 3:
"The fire no longer warms you. Only blood does."

## 5. Monsters

Stats are for monster level 1. Per level above 1: hp ×(1 + 0.35·(lvl−1)), damage ×(1 + 0.25·(lvl−1)),
xp ×(1 + 0.5·(lvl−1)).

| Type | Name | Biomes | hp | dmg | speed | xp | Behaviour |
|---|---|---|---|---|---|---|---|
| ghoul | Ghoul | wood, barrows, fen | 30 | 8 | 48 | 10 | melee reach 14, windup 0.4 s, cooldown 1.2 s |
| hound | Hollow hound | wood, ash | 18 | 6 | 85 | 7 | melee reach 12, windup 0.25, cd 0.9; spawns in packs of 2–3 |
| wraith | Wraith | barrows, fen, ruins | 22 | 7 | 55 | 12 | floats: ignores blockers and water; a hit heals it by the damage dealt; reach 14, windup 0.35, cd 1.1 |
| lurker | Bog lurker | fen (spawns in water) | 60 | 14 | 30 (60 in water) | 20 | reach 16, windup 0.6, cd 1.8 |
| imp | Cinder imp | ash, ruins | 20 | 9 | 50 | 14 | ranged: keeps 70–110 px away, windup 0.5, fireball every 2.2 s at 110 px/s |
| knight | Bone knight | ruins, barrows | 75 | 16 | 38 | 26 | reach 18, windup 0.7, cd 1.6; armour 3 (flat reduction, min 1); no stagger |
| cultist | Ashen acolyte | any, weight grows with heat | 35 | 10 | 45 | 18 | ranged 120 px, dark bolt every 2.6 s at 95 px/s; 25% chance on death to drop a whisper hint (section 7) |

- **States:** `idle`, `chase`, `windup`, `recover`, `stagger`, `dead`. A monster in `idle`
  wanders. It aggros when the hero is within 140 px (hound 170, wraith 160) and gives up beyond
  500 px.
- **Melee strike:** after the windup, the strike lands only if the hero is still within reach+6
  and is not invulnerable. The windup is the telegraph, and the renderer must show it.
- **Hit reaction:** a hero hit gives a knockback impulse of 40 px/s, a 0.15 s stagger and
  interrupts a windup. Knights and the boss are exempt.
- **Monster level:**
  `1 + round(heat * monsterHeatLevels) + floor(distFromOrigin / monsterLevelDistStep)`, capped at 5,
  with `monsterHeatLevels 3` and `monsterLevelDistStep 1500`.
- **Spawning:** every 1.2 s, if fewer than `spawnBase + heat·spawnHeat` monsters (4 + heat·4) are
  within 450 px, spawn one (a hound pack counts as one). The spawn point is 230–320 px from the
  hero in a random direction. It must be a valid tile: not a blocker, not water (except for
  lurkers, which need water), not near a bonfire, not inside the lair arena. The type comes from
  biome weights, with the cultist weight = `heat * 3`. Monsters farther than 650 px are removed.
  Nothing spawns in the first 8 s.
- **Projectiles:** `{x, y, vx, vy, dmg, r: 3, ttl: 3}`. One hits the hero within 6 px. Blockers do
  not stop them.

## 6. Morhain and his lair

- **Position:** the angle is seeded (`hash2(seed, 0, 7)`), the distance is `lairDistance` (200
  tiles = 3200 px) from the origin. The arena is a circle of radius 180 px around the lair centre.
  World generation places no ordinary objects or landmarks inside a 220 px radius. Instead it
  places 8 obelisks in a ring of radius 150, a central altar (the Black Chapel) with her veil on
  it, and **The Last Fire**, a bonfire 260 px from the centre on the side facing the origin.
- **Heat:** `heat = clamp(1 − distToLair / lairDistancePx, 0, 1)`. It is hidden from the player.
  The renderer uses it for a red tint and fog, and monster levels and spawning use it as well.
- **Whispers:** these events fire once each, the first time the hero comes closer than 2000, 1200,
  700 and 350 px:
  - 2000: "The air tastes of sulfur."
  - 1200: "Chanting rides the wind. Your hands are shaking."
  - 700: "The ground is warm, like skin."
  - 350: "Mourner. I kept her for you." (his voice)
  - Under 700 px at a level below `bossReadyLevel` (6), a warning also fires, once per life:
    "Not yet. Your hatred is too shallow. He would unmake you."
- **Boss:** Morhain. hp 900, armour 2, speed 40, no stagger. He stays within 200 px of the centre.
  He wakes when the hero comes within 170 px (event `boss_awake`). He resets to full hp 5 s after
  the hero dies or moves more than 400 px from the centre.
  - Phase 1 (hp > 60%): every 2.2 s, a fan of 5 dark bolts (spread 50°, 120 px/s, 18 dmg). If the
    hero stays within 40 px for more than 1.5 s, he teleports to a random point 120 px from the
    hero, inside the arena.
  - Phase 2 (60–25%): adds a ring of 12 bolts every 4 s, and every 9 s summons 2 level-3 ghouls.
  - Phase 3 (< 25%): speed ×1.4, all cooldowns ×0.75. Event `boss_phase` with the text
    "Ilse's voice, from inside him: 'Don't stop.'"
  - Melee nova: if the hero is within 30 px, a windup of 0.8 s, then 30 dmg in radius 45.
- **Victory:** boss hp reaches 0. The phase becomes `won`, event `victory`, the timer stops, and
  the ending appears according to humanity.
- **Design intent:** a hero at level 2–3 who rushes the lair dies in about 20 s. A hero at level 6
  with the abilities usually wins.

## 7. Signs: the hot-and-cold trail

Signs are world objects created in `world.js`, deterministically per chunk. For the distance `dC`
in chunks from the chunk centre to the lair:
`p = min(signMaxP, signK / max(1, dC)^signExp)`, with `signMaxP 0.8`, `signK 1.6`, `signExp 1.3`.
If `rng < p`, one sign goes on a random non-water tile, outside the origin clearing (4 tiles) and
outside the arena. So signs are very rare far away and come thick near the lair.

| Kind | Range | Text (dir = 8-way compass word from the sign to the lair) |
|---|---|---|
| ribbon | dC > 9 | "A strip of her blue ribbon, caught on a thorn. The wind tore it from the {dir}." |
| circle | 4 < dC ≤ 9 | "A ritual circle of burnt candles. The ash smells of her perfume, and of sulfur. The sigils point {dir}." |
| crows | 1.5 < dC ≤ 4 | "Crows nailed to a post, wings spread toward the {dir}. He is not far." |
| blood | dC ≤ 1.5 | "Fresh blood in his sigils, still warm. He is very near, to the {dir}." |

- A guaranteed first ribbon lies 30 px from the camp bonfire, with this text: "Her ribbon. The
  last thing you found of her, the night they took her. You know which way the cart went: {dir}."
- A sign is discovered within 22 px: event `sign` with `{kind, text, dir, dirVec}` and `signXp`
  (8) XP, once per sign id. The HUD keeps the latest hint: "Trail: north-east (cold)". The
  temperature word comes from the kind: ribbon cold, circle cool, crows warm, blood burning.
- A cultist's whisper drop counts as a hint without a world object: "The acolyte gurgles: 'He
  waits to the {dir}.'"

### Amendment after the first LLM playtest

The DeepSeek playtest on seed 1 read the signs near the lair as contradictory. The directions were
correct, but 8-way words change from sign to sign when the lair is close. It also called
damnation "a hidden threshold". Decisions:

- **Directions are always relative to the sign.** Every hint text ends with "from here". The
  `crows` and `blood` signs also give a rough distance: "a few hundred paces" for crows and "close
  enough to hear him breathe" for blood. One pace is one tile, but the text stays vague. The
  renderer draws the sign itself pointing at the lair: crows' wings and the blood smear show the
  exact direction. A player who looks at a sign sees the true direction, while the words stay
  coarse.
- **Cultist whispers** use the same "from here" form.
- **Corruption is visible.** From `bossReadyLevel` onward, the HUD shows a damnation meter: the XP
  progress toward `damnationLevel`, drawn as a crack spreading across the humanity heart. The
  warnings at levels 7 and 8 also pulse the meter. `observe().player` gains `damnation` (0..1).
- **No runaway XP near the lair.** Monster XP scales at most ×(1 + 0.25·(lvl−1)), and XP gained at
  or above `bossReadyLevel` is multiplied by `xpAfterReady` (0.5). Balance tuning covers both.
  New target: an aggressive fighter who walks to the lair killing everything on the way reaches
  Morhain before level 8 (`average` with `--set aggression=1` in the harness).

### Amendment after the first human playtest

The first human player found the camp ribbon, then wandered in the dark. They could not tell whether they were
getting closer, and the word "cold" meant nothing to them, because it showed the kind of the last
sign and never changed. Decisions:

- **Ilse's ribbon, a small HUD indicator** in a corner. A pixel ribbon streams in the direction of
  the latest hint's `dirVec`: a fixed world direction, the one the sign gave, never the live lair
  direction. Its glow and a one-word label change **live** with the distance to the lair, in five
  steps: cold (blue) → cool → warm → hot → burning (crimson). The steps are set by `warmthSteps`,
  in px from the lair, starting values 2600 / 1800 / 1000 / 450. When the step changes, the ribbon
  flares briefly and the word changes, so walking the wrong way is visible within a few hundred
  paces. Before the first sign the ribbon is not shown.
- `observe().player.warmth` gives the step as 0..4 (0 = cold). It is a coarse public signal, not
  `debug`. Bots may use it. The LLM playtester shows it as the word.
- After the first sign, one centred line, shown once: "Follow the ribbon. Her trail grows warmer
  as you near him."
- **Pause:** Escape or P toggles pause. It shows a dark overlay with "Paused", the controls list
  and the current trail, and it freezes the simulation. Taps on a pause button also work.

## 8. Agent API

### Action
`{ mx, my, run, attack, ability, aimX, aimY }`:
- `mx`, `my`: movement in [−1, 1], normalised if longer than 1.
- `run`: boolean.
- `attack`: boolean, swings when the cooldown allows.
- `ability`: `null`, `'dash'`, `'nova'` or `'wrath'`; ignored if locked or on cooldown.
- `aimX`, `aimY`: optional world point.

### Game object
`AW.createGame({seed, config})` returns a game object:
- `step(action, ticks = 1)` advances `ticks` fixed steps with that action.
- `observe()` returns a plain JSON snapshot, listed below.
- `events()` drains and returns new events: `[{t, type, ...}]`. Types: `levelup`, `rung`, `kill`,
  `hurt`, `death`, `respawn`, `sign`, `hint`, `whisper`, `warning`, `bonfire`, `boss_awake`,
  `boss_phase`, `victory`.
- `state` is the raw state, read by the renderer.

The `observe()` snapshot contains:
- `t` and `phase` (`play`, `dead` or `won`)
- `player` with: `x`, `y`, `hp`, `maxHp`, `level`, `xp`, `xpNext`, `rung`, `humanity`, `damage`,
  `attackCd`, `invuln`, `inWater`, `biome` (name), and `abilities` (`{dash|nova|wrath: {unlocked,
  cd, active}}`)
- `monsters` within 400 px: `[{id, type, x, y, hp, maxHp, level, state, dist}]`
- `projectiles` within 400 px
- `boss`: `null` until the hero is within 600 px of the lair, then
  `{x, y, hp, maxHp, phase, awake, dist}`
- `signs` (undiscovered ones within 400 px: `{id, x, y, kind, dist}`) and `bonfires` within 600 px
  (`{x, y, lit, dist}`)
- `trail`: `{dir, dirVec, kind, temp}` of the latest hint, or null
- `stats`: `{kills, deaths, signsFound, bossAttempts, distance, damageDealt, damageTaken}`
- `debug`: `{lair: {x, y}, heat}`, only when `config.debugObs` is true. Skill bots and the LLM
  playtester must not use `debug`. The `rusher` bot may.

### Browser
`window.game` exposes:
- `observe()` and `events()`
- `act(action | null)`: the action overrides the keyboard until `act(null)`
- `pause(bool)`, `speed(n)` (1–8× simulation speed) and `stepOnce(action, ticks)` while paused
- `config`, a live object that is safe to edit between ticks
- `reset({seed, config})`

URL parameters: `?seed=`, `?x=&y=` (start position in tiles), `?bot=average` (a bot plays visibly),
`?speed=`, `?debug=1` (shows lair position and heat in the HUD), `?cfg=<url-encoded JSON overrides>`.
Settings for testing: `startLevel`, `invulnerable`, `debugObs`.

### Harness
`node tools/sim.mjs --bot average --runs 30 --seed 1 --max-minutes 25 [--config f.json] [--set k=v ...] [--json out.json]`
runs headless and prints one row per run and an aggregate (median, p10, p90). Each row has:
outcome, time to victory, deaths, level at victory, the time each level 2..6 was reached, time to
first sign (excluding the camp ribbon), time to boss awake, boss attempts and kills. It also
reports per-monster-type telemetry for the balance method in section 9: encounters, time to kill
(TTK), damage dealt to the hero, and hero deaths caused. Simulating 25 game minutes must take under
15 s of wall time.

`--sweep key=a,b,c` reruns the same seeds for each value and prints one aggregate row per value.
Comparisons always use the same seed list (common random numbers), so a difference comes from the
change and not from luck.

## 9. Balance method

The method is simulation first, then human-like playtests, measured against fixed targets.

1. **Targets first** (table below). A change is accepted only if it moves a measured metric
   toward its target and does not push another metric out of range.
2. **Skill-bracketed bots.** The bots are `novice`, `average` and `expert`, three settings of one
   policy:
   - reaction delay: 0.45 / 0.25 / 0.1 s
   - aim error: 25° / 12° / 4°
   - dodges telegraphs: never / 40% / 85%
   - kites ranged enemies: no / sometimes / yes
   - ability use: when ready / when ready and an enemy is near / with timing (nova into groups,
     wrath on the boss)

   All three use only `observe()` and `events()`. They follow the trail hint, explore in a
   widening spiral without a hint, rest under 35% hp when no enemy is within 150 px, and after a
   `warning` stay in the warm zone until `bossReadyLevel`. The targets are for `average`. `novice`
   and `expert` bound the experience. A demo should be finishable by a novice and not trivial for
   an expert.
3. **Monte Carlo on fixed seeds.** Use 30 seeds per measurement and the same seeds before and
   after a change. Report medians and p10/p90, not single runs.
4. **Component curves before totals.** Check the time to kill each monster type at the levels
   where it appears (target 1.5–4 s for normal monsters at the matching hero level). Check the
   hero's time to die against two same-level monsters (target 8–15 s), the XP-per-minute curve,
   and the boss fight length at level 6 (target 45–90 s). Fix the component that is out of range;
   do not compensate elsewhere.
5. **One knob at a time**, with sweeps. Record each accepted change in `docs/BALANCE.md`: the
   knob, old → new value, why, and the metrics before and after.
6. **LLM playtests (DeepSeek)** after the numbers pass. `tools/llm_play.mjs` lets a cheap model
   play through the same API. The model chooses a macro action about once per second of game time,
   and the harness executes it for 60 ticks. The macro actions are: fight the nearest enemy, flee
   toward a bonfire, follow the trail, explore in a direction, rest, use an ability, and walk to a
   sign or bonfire. The model sees a compact text state: hp, level, nearby enemies with distance
   and direction, the trail, and recent events. At the end it writes a short playtest report:
   moments that were boring, unfair or confusing, and whether the signs made sense. Its runs are a
   check that the scripted bots do not flatter the numbers. Its outcomes are logged next to the
   `average` bot's outcomes on the same seeds. Typical budget: a few cents per run, with a hard cap
   of `--max-cost` (default $0.50, estimated from the returned token usage at $0.30 / $1.20 per 1M
   input / output tokens unless `--price-in` / `--price-out` say otherwise). The default provider is
   DeepSeek directly: model `deepseek-v4-flash`, OpenAI-compatible endpoint
   `https://api.deepseek.com/chat/completions`, key from `DEEPSEEK_API_KEY`. `--provider openrouter` uses `https://openrouter.ai/api/v1/chat/completions`,
   model `deepseek/deepseek-v4-flash` (with `"reasoning": {"enabled": false}`), key from
   `OPENROUTER_API_KEY`. Keys come only from environment variables and are never printed, logged
   or passed in argv. Requests prefer IPv4, time out after 30 s and are retried once. Decisions use
   max_tokens 300 and the final report 1500; an empty or unparseable answer falls back to the previous
   macro action and is counted in the report. `--model` and `--endpoint` override the provider defaults.

### Targets (`average` bot, 30 seeds)

| Metric | Target |
|---|---|
| wins within 25 min | ≥ 90% (novice ≥ 60%) |
| median time to victory | 9–14 min (expert ≥ 6 min) |
| median deaths | 1–3, p90 ≤ 5 |
| median level at victory | 6 (range 5–7) |
| level 2 reached | median ≤ 1.5 min |
| level 6 reached | median 6–10 min |
| first sign after the camp ribbon | median ≤ 3 min |
| `rusher` from level 1 (beelines to the lair) | dies on its first boss attempt in ≥ 90% of runs; median time from boss awake to death ≤ 25 s |
| `rusher --set startLevel=6` | wins on its first attempt in ≥ 60% of runs |
| damnation (The Fall) | `average` ≤ 5% of runs; `novice` ≤ 15%; a `grinder` bot (fights without approaching the lair) falls in 100% of runs, median 14–22 min |
| Walk-home ending | `expert` reaches it in 10–40% of runs (killing Morhain at level 5); `average` rarely |
