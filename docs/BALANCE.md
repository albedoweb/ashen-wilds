# Ashen Wilds: balance log

Method: DESIGN.md section 9. Each accepted change gets an entry: the knob, old -> new value, why, and the
metrics before and after, on the same seed list (`--seed 1 --runs 30`). Workflow and commands: docs/API.md.

## 1. Stage 2 tuning (final state)

Seeds 1..30, 25 min limit, `node tools/sim.mjs --bot <b> --runs 30 --quiet`; component curves: `node tools/curves.mjs --n 20`
(`--noabil` for sustained TTK, `--only 1,2,3,4`). Walk time: about 2 s per 25 game-min.

### Bot fixes (before any number was touched)
- Unstuck: any bot that wants to move but moves < 10 px in 12 decisions walks a random heading for 20 decisions
  (replaces the 14-tick detour, which could not leave concave ruin corners; seed 18 sat 14 min in one corner).
  Rusher has the same. Timeouts 1-5 of 30 per bot -> 0 for average/novice/rusher; 1-2 left (a slow grinder, an expert).
- Expert `ready: 5` with `fallback`: after two deaths at the boss it levels to 6. At level 5 it targets Morhain only
  (does not feed on his summons, which would level it to 6 and turn the walk-home into the new-master ending) and it
  no longer runs to a fire mid-fight when the boss shoots from beyond 90 px. Kiting sidesteps keep closing in.
- `aggression=1` (`--set aggression=1`): pre-ready it engages everything within 260 px; ready bots push on.
- A bot `none` ability mode exists only for curves (`--noabil`).

### Sim/config changes (not balance)
- Hint texts end "from here"; `player.damnation`, `restHealMult`, `lifesteal` in observe; rung-3 whisper;
  `lifesteal[]`/`restHealMult[]` replace `bloodthirstPct`; `xpAfterReady`; `monXpPerLevel` 0.5 -> 0.25.
- No sim.js/world.js bugs found; none of these changes touch mechanics.

### Accepted knob changes (one at a time, same 30 seeds; "before" is the previous row)
| Knob | Old -> new | Why | Effect (average) |
|---|---|---|---|
| monsters.*.hp | ghoul 30/hound 18/wraith 22/lurker 60/imp 20/knight 75/cultist 35 -> 55/32/40/70/36/80/45 | TTK was 1.4-2.7 s and ~0.1 s with abilities; most monsters died in 2 hits | in-run TTK medians 1.9-3.9 s |
| xpBase, xpExp | 25, 1.5 -> 125, 1.1 | L6 at 2.7 min; flatter curve keeps L6->9 reachable for the grinder | L2 0.4->1.3, L6 2.7->7.6, victory 3.7->9.9 min |
| xpAfterReady | (new) 1.0 | 0.5 left the grinder unable to fall in 25 min (0%); 0.8 gave 50%; 1.0 gives 97% | grinder fall 100% of runs by cap 97% |
| monDmgPerLevel | 0.25 -> 0.8 | median deaths 0; deaths now also come from lair monsters (m4-5) | deaths 0 -> 1 [0..1.1] |
| boss.hp | 900 -> 4500 | fight was 4 s at level 6 | average L6 fight 61 s, rusher 44 s |
| boss.boltDmg, ringDmg, novaDmg | 18, 18, 30 -> 16, 16, 32 | survivable for a level-6 melee rusher with lifesteal | rusher L6 wins 75-80% |
| boss.boltCd | 2.2 -> 2.8 | expert walk-home 0-7% -> 33% (2.4: 6-13%, 3.2: 30%); with 2.8 rusher L1 still dies 100% | expert walk-home 33% |
| knight/lurker/cultist hp | 100/90/60 -> 80/70/45 | TTK 6-10 s at level 1 | 3-6 s |
| lifesteal / restHealMult arrays | defaults kept (shape as specified) | not tuned: no knob needed to hit targets | |

### Final table (30 seeds)
| Metric | Target | Result | |
|---|---|---|---|
| average wins | >= 90% | 100% | met |
| average victory median | 9-14 min | 9.9 [8.4..12.5] | met |
| average deaths | median 1-3, p90 <= 5 | 1 [0..1.1] | met |
| average level at victory | 6 (5-7) | 6 [6..7] | met |
| average L2 / L6 | <= 1.5 / 6-10 min | 1.3 / 7.6 | met |
| first sign | <= 3 min | 0.4 | met |
| novice wins / fall | >= 60% / <= 15% | 100% / 0% (victory 12 min, deaths 3) | met |
| expert victory | >= 6 min | 10.2 (93% win, 2 timeouts) | met |
| expert walk-home | 10-40% | 33.3% | met (very sensitive to boltCd) |
| average walk-home | rarely | 0% | met |
| average fall | <= 5% | 0% | met |
| rusher from L1 | dies 1st attempt >= 90%, awake->death <= 25 s | 100%, 6.4 s | met |
| rusher startLevel=6 | wins 1st attempt >= 60% | 80% | met |
| grinder | falls 100%, median 14-22 min | 96.7% (1 slow run at L8 at 25 min), median 17.9 | missed by 1 run |
| aggression=1 reaches Morhain before L8 | level at victory < 8 | 6 [6..7], victory 9.7 min | met |
| TTK 1.5-4 s (curves, sustained) | | 1.1-2.8 s; knight/cultist at L1 3.8-6.3 s; burst with dash+nova at hero L4+ 0.3-0.8 s | partly missed |
| time to die vs 2 same-level monsters | 8-15 s | 10-17 s at L1, 5-9 s at L3-5 | missed at L3+ |
| boss fight at L6 | 45-90 s | average 61 s; rusher 44 s | met |

Conflicts and trade-offs:
- Time-to-die at levels 3-5 (5-9 s) is below 8 s because `monDmgPerLevel` 0.8 is what produces deaths 1-3 for `average`; at 0.25
  deaths are 0. Recommendation: accept, since the passive test is harsher than play (the hero kills and heals).
- Burst TTK < 1.5 s is the dash + nova opening on cold cooldowns; sustained TTK (`--noabil`) is in range.
- Grinder 100% needs a faster xp tail (xpAfterReady > 1, which reverses the existing brake) or `damnationLevel` 8;
  rejected, because the same brake keeps the aggressive player below level 8. One slow run in 30 is the compromise.
- Walk-home depends strongly on `boss.boltCd`; it trades against the rusher's level-6 win rate and the average bot's deaths.

## 0. Baseline (untuned DESIGN numbers), stage 1

Commands (30 seeds, seed list 1..30, 25 game-minute limit):

    node tools/sim.mjs --bot average --runs 30 --seed 1
    node tools/sim.mjs --bot novice|expert|rusher|grinder --runs 30 --seed 1
    node tools/sim.mjs --bot rusher --runs 30 --seed 1 --set startLevel=6

Rusher rows stop at the first boss attempt (so their outcome column reads "timeout" and the "first boss
attempt" line is the relevant one). The bots are first versions; some misses below may be bot behaviour
(see "Bot notes") and not numbers.

### Summary against the targets

| Metric | Target | average | novice | expert |
|---|---|---|---|---|
| wins within 25 min | avg >= 90%, novice >= 60% | 90% ok | 86.7% ok | 83.3% |
| median time to victory | 9-14 min (expert >= 6) | 4.7 MISSED (too fast) | 4.3 | 3.8 MISSED |
| median deaths | 1-3, p90 <= 5 | 0 [p90 1] MISSED (too easy) | 0 | 0 |
| median level at victory | 6 (5-7) | 6 ok | 6 | 6 |
| level 2 reached | median <= 1.5 min | 0.5 ok | 0.4 | 0.5 |
| level 6 reached | median 6-10 min | 3.8 MISSED (too fast) | 3.3 | 3.7 |
| first sign after camp ribbon | median <= 3 min | 0.4 ok | 0.1 | 0.1 |
| fall (damnation) | avg <= 5%, novice <= 15% | 0% ok | 0% ok | 0% |
| walk-home ending | expert 10-40% | - | - | 3.3% MISSED (low) |
| rusher from level 1 | dies first attempt >= 90%, median awake->death <= 25 s | died 90%, 4.2 s ok | | |
| rusher, startLevel=6 | wins first attempt >= 60% | 93.3% ok | | |
| grinder | falls 100%, median 14-22 min | 93.3% (2 timeouts), median 6.4 min MISSED (too fast) | | |

Main finding: XP comes much too fast (level 6 at ~3.5 min against a 6-10 min target) and the hero is hardly ever
in danger (median 0 deaths, first death mostly at the boss). Component checks to do first (DESIGN 9 point 4):
monster XP per kill, monster damage against the hero, and the boss fight length (the level-6 rusher kills Morhain
in about 25 s of fight; target 45-90 s).

### Bot notes
- 1-5 of 30 runs per bot reach the 25 min limit without finding the lair (timeout); the trail-following and
  spiral logic is first-version and can be improved before drawing conclusions about timing.
- `expert` goes for Morhain at level 5 (`ready: 5` in `AW.bots.PARAMS`); it has the walk-home ending in 1/30.
- Bots decide at 15 Hz (every 4 ticks); reaction delay is simulated with delayed observations.

### Baseline: average

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"won_new_master":27,"timeout":3}
 win 90%  walk_home 0%  fall 0%
 time to victory (min): 4.7 [2.2..10.5] n=27
 time to fall (min):    - [-..-] n=0
 deaths:                0 [0..1] n=30
 level at end:          6 [6..7] n=30
 level 2 reached (min):   0.5 [0.3..1.9] n=30
 level 3 reached (min):   1.2 [0.4..5.3] n=30
 level 4 reached (min):   2.1 [0.7..9.7] n=30
 level 5 reached (min):   2.6 [1.1..13] n=29
 level 6 reached (min):   3.8 [1.8..14.3] n=29
 first sign (min):      0.4 [0.1..6] n=28
 boss awake (min):      4.5 [2.1..10.3] n=27
 boss attempts:         1 [0.9..1] n=30
 first boss attempt: died 0%  won 90%  time awake->death (s): - [-..-] n=0
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      2682    0
   ghoul    184   175   4.31   1.47   34      0
   hound    534   518   5.8    1.33   660     0
   wraith   108   106   1.74   1.59   42      0
   lurker   91    89    2.18   1.78   0       0
   imp      106   105   27.84  2.05   959     1
   knight   41    39    2.89   2.75   282     0
   cultist  302   289   6.73   2.28   1671    5

wall 18.1 s for 239.4 game-minutes (1.9 s per 25 game-min)
```

### Baseline: novice

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"won_new_master":26,"timeout":4}
 win 86.7%  walk_home 0%  fall 0%
 time to victory (min): 4.3 [2.1..12.1] n=26
 time to fall (min):    - [-..-] n=0
 deaths:                0 [0..1] n=30
 level at end:          6 [6..7] n=30
 level 2 reached (min):   0.4 [0.2..1] n=29
 level 3 reached (min):   1 [0.5..2.9] n=29
 level 4 reached (min):   1.3 [0.8..4.9] n=29
 level 5 reached (min):   2 [1.1..5.4] n=29
 level 6 reached (min):   3.3 [1.6..11.4] n=29
 first sign (min):      0.1 [0.1..4.7] n=28
 boss awake (min):      4 [2..11.9] n=26
 boss attempts:         1 [0..1] n=30
 first boss attempt: died 3.3%  won 83.3%  time awake->death (s): 10.2 [10.2..10.2] n=1
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      3799    1
   ghoul    238   230   2.57   1.53   88      0
   hound    549   536   6.48   1.65   990     0
   wraith   92    89    2.02   1.7    70      0
   lurker   115   111   2.36   2.2    72      0
   imp      91    86    4.75   1.94   1343    5
   knight   40    40    28.5   2.93   540     0
   cultist  317   300   8.96   2.64   2549    5

wall 19.6 s for 257 game-minutes (1.9 s per 25 game-min)
```

### Baseline: expert

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"won_new_master":24,"timeout":5,"won_walk_home":1}
 win 83.3%  walk_home 3.3%  fall 0%
 time to victory (min): 3.8 [1.9..8.3] n=25
 time to fall (min):    - [-..-] n=0
 deaths:                0 [0..1] n=30
 level at end:          6 [6..7] n=30
 level 2 reached (min):   0.5 [0.3..1.8] n=30
 level 3 reached (min):   0.8 [0.4..2.3] n=30
 level 4 reached (min):   1.5 [0.8..3.3] n=29
 level 5 reached (min):   2.4 [1..4.7] n=29
 level 6 reached (min):   3.7 [1.7..18.7] n=28
 first sign (min):      0.1 [0.1..2.9] n=27
 boss awake (min):      3.6 [1.5..8.1] n=25
 boss attempts:         1 [0..2] n=30
 first boss attempt: died 6.7%  won 76.7%  time awake->death (s): 15.1 [13..17.2] n=2
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      2350    2
   ghoul    171   161   10.12  2.32   0       0
   hound    422   409   8.79   1.63   29      0
   wraith   74    74    2.48   2.41   0       0
   lurker   93    89    5.53   4.72   0       0
   imp      85    83    16.23  2.28   709     2
   knight   37    32    3.6    3.19   68      0
   cultist  270   260   5.74   2.36   654     2

wall 18.2 s for 253.2 game-minutes (1.8 s per 25 game-min)
```

### Baseline: rusher (from level 1)

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"timeout":30}
 win 0%  walk_home 0%  fall 0%
 time to victory (min): - [-..-] n=0
 time to fall (min):    - [-..-] n=0
 deaths:                1 [1..6] n=30
 level at end:          2 [1..3.1] n=30
 level 2 reached (min):   1.6 [0.4..3.3] n=16
 level 3 reached (min):   4 [2.6..12.7] n=12
 level 4 reached (min):   8.1 [6.7..9.9] n=3
 level 5 reached (min):   17.6 [17.6..17.6] n=1
 level 6 reached (min):   - [-..-] n=0
 first sign (min):      0.5 [0.1..9.3] n=13
 boss awake (min):      0.7 [0.5..9.2] n=27
 boss attempts:         1 [0.9..1] n=30
 first boss attempt: died 90%  won 0%  time awake->death (s): 4.2 [4.1..10.7] n=27
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      3449    26
   ghoul    57    24    6.13   3.9    0       0
   hound    214   117   8.91   3.18   72      1
   wraith   40    30    4.6    3.66   0       0
   lurker   31    11    66.28  8.83   0       0
   imp      42    1     40.5   40.5   3450    24
   knight   19    8     12.92  12.14  60      0
   cultist  107   4     33.29  35.58  6319    34

wall 14.9 s for 177.1 game-minutes (2.1 s per 25 game-min)
```

### Baseline: rusher --set startLevel=6

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"won_new_master":28,"timeout":2}
 win 93.3%  walk_home 0%  fall 0%
 time to victory (min): 1.2 [0.6..11.9] n=28
 time to fall (min):    - [-..-] n=0
 deaths:                0 [0..3.3] n=30
 level at end:          6 [6..6] n=30
 level 2 reached (min):   - [-..-] n=0
 level 3 reached (min):   - [-..-] n=0
 level 4 reached (min):   - [-..-] n=0
 level 5 reached (min):   - [-..-] n=0
 level 6 reached (min):   - [-..-] n=0
 first sign (min):      0.5 [0.1..7.7] n=11
 boss awake (min):      1.1 [0.5..11.8] n=28
 boss attempts:         1 [1..1] n=30
 first boss attempt: died 0%  won 93.3%  time awake->death (s): - [-..-] n=0
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      1527    0
   ghoul    47    20    4.25   2.67   0       0
   hound    182   104   15.14  1.83   0       0
   wraith   47    36    3.11   2.62   0       0
   lurker   26    16    6.91   3.91   0       0
   imp      31    6     42.91  27.22  3292    13
   knight   19    9     7.05   4.63   0       0
   cultist  105   8     33.05  1.31   9159    32

wall 15.7 s for 164.6 game-minutes (2.4 s per 25 game-min)
```

### Baseline: grinder

```
AGGREGATE (median [p10..p90] n)
 runs 30  outcomes {"fall":28,"timeout":2}
 win 0%  walk_home 0%  fall 93.3%
 time to victory (min): - [-..-] n=0
 time to fall (min):    6.4 [4.9..19.1] n=28
 deaths:                0 [0..0] n=30
 level at end:          9 [9..9] n=30
 level 2 reached (min):   0.3 [0.2..0.4] n=30
 level 3 reached (min):   0.5 [0.4..6] n=30
 level 4 reached (min):   0.9 [0.8..6.8] n=30
 level 5 reached (min):   1.6 [1.3..8.3] n=30
 level 6 reached (min):   2.5 [1.8..9.3] n=30
 first sign (min):      2 [0.8..4.3] n=15
 boss awake (min):      - [-..-] n=0
 boss attempts:         0 [0..0] n=30
 first boss attempt: died 0%  won 0%  time awake->death (s): - [-..-] n=0
 per monster type: type encounters kills ttkMean ttkMed dmgToHero heroDeaths
   boss     0     0     -      -      0       0
   ghoul    977   976   3.14   0.83   16      0
   hound    2045  2022  4.35   0.93   356     0
   wraith   486   484   1.1    0.93   21      0
   lurker   557   554   1.41   1.2    0       0
   imp      354   353   5.22   1.63   949     1
   knight   208   206   5.99   1.74   808     0
   cultist  250   250   2.56   1.5    536     0

wall 11.3 s for 313.6 game-minutes (0.9 s per 25 game-min)
```


## First human play observation (no change made)

The first human player: "the hero seems too strong for now — do not change the balance yet, we will play more".
Open question for the next balance round, to be weighed against the LLM playtests and the bots'
deaths median of 1. No numbers changed on this note.
