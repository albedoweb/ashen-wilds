# Ashen Wilds: guide for agents

Spec: `docs/DESIGN.md` (authoritative). Balance log: `docs/BALANCE.md`. No dependencies; Node 24 and a browser.

## Layout
`src/config.js` (all numbers, `AW.DEFAULT_CONFIG`) - `src/world.js` - `src/sim.js` (`AW.createGame`) -
`src/bots.js` - `src/render.js` - `src/main.js`. Classic scripts extending `globalThis.AW`. In Node load them
through `tools/lib.mjs` (`import { AW } from './lib.mjs'`), in the browser through `index.html`.

## Playing in Node
```js
import { AW } from './tools/lib.mjs';
const game = AW.createGame({ seed: 1, config: { startLevel: 6, debugObs: true }, x: 0, y: 8 });
game.step({ mx: 1, my: 0, run: true, attack: false, ability: null }, 4);  // 4 fixed ticks of 1/60 s
const obs = game.observe();      // plain JSON snapshot
const ev = game.events();        // drains new events [{t, type, ...}]
```
Config is deep-merged over the defaults; `game.config` is the live merged object, `game.state` the raw state
(renderer). World generation parameters (lair distance, sign parameters) are read when the game is created.
Everything is deterministic: same seed, config and action sequence give the same result.

### Action
`{ mx, my, run, attack, ability, aimX, aimY }`: `mx,my` in [-1,1]; `ability` is `null|'dash'|'nova'|'wrath'`
(ignored if locked or cooling down); `aimX,aimY` an optional world point (else auto-aim, else facing).

### Observation (`observe()`)
`t`, `phase` (`play`, `dead`, `won`, `damned`), `player` {x,y,hp,maxHp,level,xp,xpNext,rung,humanity,damage,
attackCd,invuln,inWater,biome,abilities{dash,nova,wrath:{unlocked,cd,active}}}, `monsters` within 400 px
{id,type,x,y,hp,maxHp,level,state,dist, plus windT (remaining windup s), reach, ranged, burning}, `projectiles`
{x,y,vx,vy,dmg,dist}, `boss` (null until within 600 px of the lair) {x,y,hp,maxHp,phase,awake,dist,state,windT},
`signs` (undiscovered, within 400 px), `bonfires` (within 600 px), `trail` {dir,dirVec,kind,temp} or null,
`stats` {kills,deaths,signsFound,bossAttempts,distance,damageDealt,damageTaken}, and `debug` {lair,heat}
only when `config.debugObs` is true (skill bots and the LLM player must not use it).

### Events
`levelup, rung, kill (monster, xp), hurt, death, respawn, sign, hint, whisper, warning, bonfire, boss_awake,
boss_phase, damnation_warning, damnation, victory`. Endings: `victory.ending` is `walk_home` (humanity > 0) or
`new_master`; `damnation.ending` is `fall`. After `victory` or `damnation` the simulation stops.
Raw per-monster telemetry (encounters, kills, TTK, damage to the hero, hero deaths) is in
`game.state.stats.byType`.

Testing flags in config: `startLevel`, `startXp`, `invulnerable`, `debugObs`.

## Harness
```
node tools/sim.mjs --bot average --runs 30 --seed 1 --max-minutes 25 [--config f.json] [--set k=v ...] [--json out.json] [--quiet]
node tools/sim.mjs --bot average --runs 30 --seed 1 --sweep monsters.ghoul.hp=20,30,40   # same seeds per value
node tools/sim.mjs --bot rusher --runs 30 --seed 1 --set startLevel=6
```
Bots: `novice`, `average`, `expert` (one policy, three skill settings, see `AW.bots.PARAMS`), `grinder` (fights, never
approaches the lair; should fall at damnationLevel), `rusher` (uses `debug.lair`, stops after its first boss attempt).
Keys in `--set` and `--sweep` are dotted config paths (values parsed as JSON). Output: one row per run (outcome
`won_walk_home | won_new_master | fall | timeout`, time, deaths, level, level-up times, first sign, boss awake,
attempts), then an aggregate (median [p10..p90]), outcome distribution, per-monster-type telemetry and wall time.
`node tools/check.mjs` runs the automated checks (exits non-zero on failure). Simulating 25 game minutes takes about
2 s (budget 15 s).

## Balance workflow
DESIGN section 9: targets first, 30 fixed seeds, one knob at a time with `--sweep`, component curves before
totals, record each accepted change in `docs/BALANCE.md` (knob, old -> new, why, metrics before and after).

## LLM playtester
```
node tools/llm_play.mjs --seed 3 --minutes 12 [--max-cost 0.5] [--provider deepseek|openrouter] [--model M]
                        [--endpoint URL] [--price-in 0.30] [--price-out 1.20] [--set k=v] [--dry-run] [--runs N]
```
`--runs N` plays seeds S..S+N-1 sequentially (one report each plus `playtests/<date>-summary.md`); `--max-cost` is global.
The model picks a macro action (fight, flee, follow_trail, explore <dir>, rest, ability <name>, goto_sign,
goto_bonfire, approach_boss, fight_boss) about once per game second; it runs for 60 ticks. At the end the model writes a playtest report;
output goes to `playtests/<date>-seed<N>.md` (outcome, metrics, tokens and cost, the report, event log).
Provider `deepseek` (default): `https://api.deepseek.com/chat/completions`, model `deepseek-chat` (the v4 model spent its token budget on reasoning and returned empty answers), key from env
`DEEPSEEK_API_KEY`. Provider `openrouter`: model `deepseek/deepseek-v4-flash`,
key from `OPENROUTER_API_KEY`. Keys come only from environment variables, are never printed or put in
argv. Requests prefer IPv4, time out after 30 s, retry once; an empty/unparseable answer repeats the previous action (counted
in the report by kind: empty, reasoning_only, bad_json, no_action). The report ends with 3 ratings (pacing, fairness,
clarity of the trail) stored in the header. The state text never includes `obs.debug`. `--dry-run` replaces the model with a trivial local policy (no key, no network) and writes
`...-dry.md`. Compare with the `average` bot on the same seed.

## Browser (`window.game`)
Open `index.html` (any key starts). Keys: WASD/arrows, Shift run, Space/J or mouse click attack (towards the cursor),
Q dash, E nova, R wrath; touch drag walks. API: `observe()`, `events()`, `act(action|null)` (overrides the keyboard
until `act(null)`), `pause(bool)`, `speed(1..8)`, `stepOnce(action, ticks)` (while paused), `config` (live object,
safe to edit between ticks), `reset({seed, config, start:{x,y}})`.
URL: `?seed=`, `?x=&y=` (start tile), `?bot=average|novice|expert|rusher|grinder` (visible bot, skips the intro),
`?speed=4`, `?debug=1` (lair and heat in the HUD, lair circle), `?cfg=<url-encoded JSON>`, `?startLevel=`, `?startXp=`,
`?invulnerable=1`, `?intro=0`.
Browser smoke test: `node tools/smoke.mjs [--out dir] [--bot-seconds 20]` (headless Chrome over the DevTools protocol;
screenshots `stage1.png`, `stage1_lair.png`).

## Swappable UI pieces
`AW.render.drawMonster/drawBoss/drawProjectile/drawSign/drawHeroOverlay/drawFx` (src/render.js, called through the
`AW.render` object), `updateHud(obs)` and `showScreen()` in src/main.js.
