# Lee: Ranged Combat Prototype

Phase 1 asked: **is it fun to steer a boat with one thumb while it fights automatically, and can you read its damage state on a second panel?** ([`docs/PRD.md`](docs/PRD.md))

Phase 2 puts a crew on the boat: **does deciding where your Lees start make the fight more interesting, and is it fun to watch a self-organizing crew respond while you steer?** ([`docs/PRD_PHASE2.md`](docs/PRD_PHASE2.md))

The earlier grid autobattler lives in [`legacy/`](legacy/). It is not part of the build.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (--host is on, so your phone on the same Wi-Fi can open it)
npm test           # simulation unit tests (vitest)
npm run build      # typecheck + production build to dist/ (what Netlify deploys)
```

Stack: TypeScript, [Phaser 3](https://phaser.io), Vite, lil-gui for the tuning panel, and Vitest.

## Playing

| Input | What it does |
|---|---|
| **Setup mode** (before START) | The bottom panel grows to show your deck grid. Tap a Lee (tray or deck), then a tile, or drag it. Tap another Lee to swap; drop off the deck, or tap the tray, to send one ashore. A **Boat with this crew** panel shows Firepower, Speed, Turning, Gun range and Repairs, and updates as you move people; dragging a Lee over a tile previews the change (striped). While a Lee is selected, every tile shows its role and what moving there would change (*+20% speed*, *−1 gun*, *+33 m range*). The dashed ring on the ocean is your gun range. **Clear all**, **Auto-arrange**, **START**. Your arrangement is saved. |
| Touch and hold the ocean (top panel) | The boat seeks that point. A dashed line previews the next few seconds of movement. |
| Drag | The target follows your finger. |
| Release | The boat holds its current heading. |
| Hold close to a boat (or any point) | The boat settles into an orbit with that point on its beam, which is where the cannons fire. |
| Bottom strip | View only during a fight: your boat, bow to the right, with its crew. Every Lee shows a task icon; a bar shows real progress only (a gun loading, a part being patched up, water being bailed down), while rowing, sailing and the lookout are steady effects with no bar; empty stations are dim with an empty ring; a ghost marks the home tile of anyone who's away; a dashed line shows where a walking Lee is headed. |
| **Tune** / **Debug** / **1x 2x** | Tuning panel, debug overlay (arcs, ranges, hitboxes, seek points, every shell's landing spot), and game speed. |

**Fights and progression.** Win a fight and the next one starts after a short countdown (or tap **Next fight**), with one more enemy ship each time, up to a cap. Sinking ends the run; **Again** starts over from fight 1. The pill at the top shows the fight number and how many ships are left. By default you start every fight with a fully repaired boat.

**Crew.** A cannon only loads and fires with a gunner standing at its station; oars set your speed and sails your turning (empty, they drop to `crew.oarBaseline` / `sailBaseline`, 60%); a lookout lets every gun reach 25% farther (`crew.lookoutRange`); plain deck is damage control (repair and bail). Where you place a Lee sets its *preferred* role. During the fight nobody takes orders: each Lee goes where it's needed most (an open gun facing the enemy, a part that was just hit, rising water) and drifts home when that passes. Shells that land on Lees hurt them; a Lee at 0 HP goes overboard and isn't replaced this fight. The enemy's crew runs on the same AI. The result screen adds Lees lost and a per-Lee breakdown (time by task, time away from home, task switches). **Again** keeps your arrangement; **Rearrange** returns to setup.

Cannons fire when loaded and the target is inside their arc. Enemy shells mark their landing spot with a **red X** and a ring that shrinks until impact. Shells fly to a fixed point and hit whatever is there when they land. The enemy aims where you're going, so turning dodges.

## How the code is laid out

```
src/
  config/
    tuning.ts      every gameplay number (one place; the sliders are built from it)
    boats.ts       boat layouts as data: part shapes, roles, stat blocks, adjacency, deck grid + stations
    lees.ts        Lee types as data: name, flavor, art, core stats, affinities, abilities
    crews.ts       which Lee type sails and where (your Auto-arrange order, the enemy's crew)
    art.ts         art manifest (all null = placeholder art drawn in code)
  sim/             pure TypeScript game rules, no Phaser imports, deterministic
    steering.ts    "seek this point" + orbit; shared by player, enemy and path preview
    boat.ts        parts, layered damage, flooding, bilge, derived movement stats (incl. oars/sails)
    grid.ts        deck tiles, stations, neighbors, walking distances and paths
    crew.ts        Lees, tasks, needs, the crew AI (one AI, every boat), walking, work, crew damage
    telegraph.ts   general "something lands here in N seconds" system (the red X)
    world.ts       the one world: any number of enemies, their brains, cannons, lead targeting,
                   threat budget, shells, sinking, stats, fight setup and carry-over
  game/
    BattleScene.ts one Phaser scene, two cameras (ocean + strip) reading the same world
    BoatView.ts    draws a boat: part sprites, crack overlays, deck water, barrels
    CrewView.ts    draws your crew and stations in the strip (icons, progress bars, ghosts, claims)
    textures.ts    placeholder art + trimming crack art to each part's outline
    Controller.ts  current world, fight number and run progress, live tuning, presets, speed/debug
  ui/              DOM HUD, setup mode (deck grid, tray, info card), crew debug, result screen,
                   tuning panel, rotate overlay, code-drawn crew art
tests/             steering/orbit/preview, damage & flooding, world rules, crew behavior
```

How the code meets the PRD's design-for-later constraints (§13):

- **Two views, one world.** The ocean and strip are two Phaser cameras on the same scene and the same `World`.
- **Shared steering.** `stepMotion` is the only movement code. The enemy feeds it a seek point. The path preview calls `predictPath`, which loops over `stepMotion`, and a test checks that the two match exactly.
- **Parts are data.** Each part's stats come from `tuning.<side>.parts`. Its shape, role and neighbors come from `config/boats.ts`.
- **Layered damage.** Each part has a `layers` stack, with its structure at the bottom. Damage hits the top layer first and carries over to the next. Armor can be added later as extra layers.
- **Reusable telegraphs.** `TelegraphSystem.add(kind, pos, warnTime)` makes a red X for any threat, each with its own warning time.
- **One place for numbers.** All tunables live in `config/tuning.ts`.

How Phase 2 meets its design-for-later constraints (§14):

- **Lees are data.** A Lee type is an entry in `config/lees.ts`; stats live in `tuning.lees.<type>` so they're editable live. The AI reads stats and `affinities`, so a Lee that's good at something is drawn to it with no AI change.
- **Abilities are generic.** `{ trigger, target: 'self' | 'orthogonalNeighbors', stat, multiply }`. Passive ones already apply (a test proves it with a made-up type); event triggers are reserved.
- **Tasks and stations are extensible.** A station is a letter in the grid data plus a ladder tier; a new kind (helm, fire brigade) is a new station kind and tier, not a special case.
- **Tiles hold layers.** Each tile carries a `layers` stack (empty today) for fire, smoke, etc.
- **Grids are boat data**, and **walking is general**: a Lee has an allegiance separate from the deck it stands on, and movement is path-finding on whatever grid it's on.
- **One crew AI.** `stepCrew` runs every boat's crew; nothing in it knows which side it's on.
- **No dice.** Crew decisions are fully deterministic (a test runs the same fight with different random seeds and gets identical crew logs). Shell scatter is the only randomness, as in Phase 1.

## How the crew decides

Every task on a boat has a **need** from the urgency ladder (`ladder` in tuning): flooding emergency (100) → offline guns / damaged engine (80) → an unmanned cannon that can engage (60) → other damage and moderate water (40) → empty oars/sails (30) → empty lookout (15) → a cannon with nothing to shoot (0). Each Lee scores each open task: need, minus walking time × `walkPenalty`, plus `homeBonus` (work done from its home tile), `roleBonus` (the kind of work its home tile sets), `standbyBonus` (a damage-control Lee waiting at home), minus `helpPenalty` per Lee already on a repair/bail job. It switches only when something beats its current task by `stickiness`, holds a new task for at least `commitTime`, and judges guns with `arcLookahead` so crews don't flip sides on every arc crossing. Ties break by score, tier, walking time, Lee id, then task order.

**Debug** shows, for each Lee, its task, the one-line reason it chose it (*"abandoned Port cannon 2: offline → Repair Port guns: guns offline, HP 22%"*), and its best few options with scores, plus the boat's needs. Tap the panel header to cycle through your crew and each enemy's. Ocean pips are colored by task in debug, and the strip shows walking paths.

## Tuning

- Open **Tune** during a fight or from the result screen. Values save to the browser as you change them.
- Most values take effect immediately. Values marked *(next run)*, including the whole **Parts** folder, crew size and Lee HP, apply on the next fight.
- **Crew:** `player.crew.size` / `enemy.crew.size`, **Lee stats (per type)**, **Crew** (repair/bail/walk rates, mobility baselines, lookout range, repair ceiling, wrecked-repairable, crew hit damage and splash, wet threshold and slowdown), **Crew AI** (stickiness, commitment, lookahead, bonuses and penalties, flooding thresholds) and the **Urgency ladder**. `global.playerCrewStats` multiplies every stat of your Lees (the player-advantage knob for crews); the enemy also sails with fewer hands (4 vs 6) and a faster reload to make up for rarely manning both guns on a broadside.
- **Presets** let you save, load or delete named presets, export the tuning as JSON to your clipboard, import it by pasting, or reset to defaults.
- `playerAdvantage` multiplies the player's HP, divides their reload time and leak multipliers, and multiplies their turn rate by its square root. The enemy also starts with a slower, less agile hull (`enemy.movement`).
- **Aiming:** each loaded gun picks the closest enemy boat inside its arc and range, then rolls a random part, a random point within `cannons.aimRadius` of it, and a lead that's off by up to `cannons.leadError` (±10%), so fast or distant targets are harder to hit. Gunner scatter (`cannons.spread` ÷ accuracy) comes on top. Raise `aimRadius` or `leadError` if shots still land too reliably.
- **Holes:** every hit lets `cannons.hitWater` into the part; a hit on a part that's already wrecked punches through and lets in `cannons.holeWater` (spilling into neighboring parts if it's full), so shooting a wrecked part still sinks the ship.
- The dodge window is set by `cannons.flightTimeBase` + `flightTimePerMeter × distance`, with `telegraph.minWarningTime` as the floor for enemy shells. Accuracy comes from lead targeting plus `cannons.spread`, tuned separately for each side.
- Orbiting is controlled by `movement.orbitRadiusScale` and `movement.orbitCapture`. Setting `orbitCapture = 0` gives plain point-seeking, where the boat loops through the point instead of circling it.
- **Several attackers** (**Fights & progression** folder):
  - **Ship count:** `firstFightEnemies`, `enemiesAddedPerFight` and `maxEnemies` set how many ships each fight has.
  - **Threat budget:** `maxIncomingShells` (default 3) caps how many enemy shells, and so how many red X's, can be in the air at once. A loaded enemy gun waits for a free slot, so a pack stays dodgeable.
  - **Pack scaling:** `packHullScaling` and `packReloadScaling` (default 0.8) give each ship in a bigger pack a lighter hull and a slower reload. More ships means more pressure from more directions, but not N times the damage. Set both to 0 for full-strength packs.
  - **Between fights:** `repairBetweenFights` (1 = fresh boat, 0 = keep all damage) and `nextFightDelay`.
  - **Crossfire:** `friendlyFire = 1` lets enemy shells hit other enemies.
  - **Spacing:** each enemy holds its own range (`enemyAI.rangeJitter`) and steers away from packmates closer than `enemyAI.spacing`.
- `input.targetFollowsCamera = 1` keeps the target under a still finger as the camera pans. The preview then becomes approximate, because the target moves with the camera.

## Adding art

Edit `src/config/art.ts` and drop files into `public/art/`. Each slot is optional; an empty one falls back to the placeholder. Part sprites are drawn top-down with the bow pointing right and stretched to fit the part's bounding box. You only supply one generic set of crack images: the game tiles them and trims them to each part's outline. Sizes and conventions are documented in `art.ts`.
