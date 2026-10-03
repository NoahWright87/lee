# Lee: Ship Combat Prototype

Phase 1 asked: **is it fun to steer a boat with one thumb while it fights automatically, and can you read its damage state on a second panel?** ([`docs/PRD.md`](docs/PRD.md))

Phase 2 puts a crew on the boat: **does deciding where your Lees start make the fight more interesting, and is it fun to watch a self-organizing crew respond while you steer?** ([`docs/PRD_PHASE2.md`](docs/PRD_PHASE2.md))

Phase 3 adds close combat: **is it fun to close the distance and fight up close, and can you follow a fight spread across multiple decks while other boats are still shooting?** ([`docs/PRD_PHASE3.md`](docs/PRD_PHASE3.md))

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
| Touch and hold the ocean (top panel) | The boat seeks that point. A dashed line previews the next few seconds of movement. Faint rings show every boat's **minimum cannon range** while your finger is down. |
| Hold on (or right beside) an enemy hull | **Come alongside** it: the boat steers for the slot beside it and matches its speed. Linger close and slow and you dock (a ring fills over the grapple time). Steer away to break it off. |
| Drag | The target follows your finger. |
| Release | The boat holds its current heading. |
| Hold close to a boat (or any point) | The boat settles into an orbit with that point on its beam, which is where the cannons fire. |
| **Disengage** (beside an attached deck) | Your boarders on that boat swing home during a short recall window ("Casting off…"), then the link breaks and the boats are pushed apart. One button per attached boat; never in the bottom quarter of the screen. |
| Bottom strip | View only during a fight: your boat, bow to the right, with its crew. Every Lee shows a task icon; a bar shows real progress only (a gun loading, a part being patched up, water being bailed down), while rowing, sailing and the lookout are steady effects with no bar; empty stations are dim with an empty ring; a ghost marks the home tile of anyone who's away; a dashed line shows where a walking Lee is headed. |
| **Tune** / **Debug** / **1x 2x** | Tuning panel, debug overlay (arcs, ranges, hitboxes, seek points, every shell's landing spot), and game speed. |

**Close combat (Phase 3).**
- *Minimum range.* Every gun has a minimum range as well as a maximum (`cannons.minRange`, per boat type). A boat inside it can't be shelled by that gun. The Hard Ship's is large (55 m): slip inside it and its broadsides go quiet.
- *Docking.* Two opposing boats within `attach.dockDistance` of each other, slower than `dockRelSpeed` relative to each other, for `grappleTime` seconds, ease side by side and stick. The ring fills while it's happening; red when it's being done to you, cream when you're the one closing in.
- *Ramming.* A bow hitting a hull square on (within `ramMaxAngle`) at `ramSpeed` or faster rams: the struck part takes `ramDamage` × closing speed, the rammer's bow `ramSelfDamage` of that, and the two lock nose-into-hull. A predicted ram shows a red X on the hull where it will land (`ramWarnTime` ahead). **A ram only lands if its X has been up for `ramMinWarning`**; otherwise the contact is a bump. Glancing or slow contact bumps too (`bounce`). Same-side boats never attach.
- *Attached.* Propulsion and steering are overridden: the group drifts together (`driftSpeed`), steering input and the path preview do nothing, and the strip expands (`layout.expandedOceanFraction`) to show your deck plus every attached one, each where it lies (port above, starboard below, a rammer where it hit). Cap: `attach.cap` links per boat, `perSide` per side.
- *Firing rules.* Nobody shells a boat it's attached to, or a boat attached to one of its allies (so an enemy won't shell you while you're docked to its friend). Attached boats still shoot outward at other targets.
- *Pistols and swords.* Every Lee carries a pistol: slow, short-ranged (`pistol.range`), scattering in a disk like cannon spread (÷ pistol accuracy), it only hurts opposing Lees and barely scratches hulls. Shooting never pulls a Lee off its post. Lees on a shared tile with an opposing Lee are **engaged** and sword-fight until the tile is clear: never misses, lowest-HP opponent first (ties by id). An engaged gunner stops loading.
- *Boarding.* While attached to an enemy boat with crew aboard, Lees whose post does nothing right now (a gun with no valid target, oars and sails, an idle lookout, standing by) are **surplus**: they walk to the rail nearest the other boat and swing across (`boarding.swingTime`), landing on the nearest tile. Across, they hunt the nearest enemy Lee, shooting on the way. They swing home when that deck is clear, when it passes `boarding.evacuateAt` of its sink line, or when the link starts to break. Enemy Lees on your deck create a **repel** need (above manning guns). A boarder whose home boat sinks is lost with it.
- *Derelict.* A boat with no living crew floats, floods and drifts but can't fire, row or bail. To win, sink it: disengage and shell it, or let it flood.
- *Enemy types.* **Sloop** (standard: orbits at cannon range), **Friend Ship** (boarder: fast, light, one gun a side, big crew; comes alongside to dock, or rams when it has a clean line onto your hull), **Hard Ship** (heavy: slow, three guns a side with wide arcs, two lookouts, big minimum range). Fights 1, 2 and 3 introduce them one at a time, alone; after that each ship is drawn from `campaign.mix` weights. The **Encounter picker** in the tuning panel spawns any mix.

**Fights and progression.** Win a fight and the next one starts after a short countdown (or tap **Next fight**), with one more enemy ship each time, up to a cap. Sinking ends the run; **Again** starts over from fight 1. The pill at the top shows the fight number and how many ships are left. By default you start every fight with a fully repaired boat.

**Crew.** A cannon only loads and fires with a gunner standing at its station; oars set your speed and sails your turning (empty, they drop to `crew.oarBaseline` / `sailBaseline`, 60%); a lookout lets every gun reach 25% farther (`crew.lookoutRange`); plain deck is damage control (repair and bail). Where you place a Lee sets its *preferred* role. During the fight nobody takes orders: each Lee goes where it's needed most (an open gun facing the enemy, a part that was just hit, rising water) and drifts home when that passes. Shells that land on Lees hurt them; a Lee at 0 HP goes overboard and isn't replaced this fight. The enemy's crew runs on the same AI. The result screen adds Lees lost and a per-Lee breakdown (time by task, time away from home, task switches). **Again** keeps your arrangement; **Rearrange** returns to setup.

Cannons fire when loaded and the target is inside their arc. Enemy shells mark their landing spot with a **red X** and a ring that shrinks until impact. Shells fly to a fixed point and hit whatever is there when they land. The enemy aims where you're going, so turning dodges.

## How the code is laid out

```
src/
  config/
    tuning.ts      every gameplay number (one place; the sliders are built from it)
    boats.ts       boat layouts as data: part shapes, roles, stat blocks, adjacency, deck grid + stations
                   (Sloop, Friend Ship, Hard Ship)
    lees.ts        Lee types as data: name, flavor, art, core stats, affinities, abilities
    crews.ts       which Lee type sails and where (your Auto-arrange order)
    ships.ts       enemy ship types as data: name, layout, crew homes (stats in tuning.ships.<id>)
    art.ts         art manifest (all null = placeholder art drawn in code)
  sim/             pure TypeScript game rules, no Phaser imports, deterministic
    steering.ts    "seek this point" + orbit; shared by player, enemy and path preview
    boat.ts        parts, layered damage, flooding, bilge, derived movement stats (incl. oars/sails)
    grid.ts        deck tiles, stations, neighbors, walking distances and paths
    crew.ts        Lees, tasks, needs, the crew AI (one AI, every boat), walking, work, crew damage,
                   surplus/board/repel needs, swinging between decks, the boarder rules
    attach.ts      links between boats: docking, ramming, bumps, ram/dock warnings, rigid drift, breaking
    combat.ts      Lee vs Lee: engagement, swords (deterministic), pistols (disk scatter)
    telegraph.ts   general "something lands here in N seconds" system (the red X)
    world.ts       the one world: any number of enemies, their brains, cannons, lead targeting,
                   threat budget, shells, sinking, stats, fight setup and carry-over
  game/
    BattleScene.ts one Phaser scene, two cameras (ocean + strip) reading the same world
    BoatView.ts    draws a boat: part sprites, crack overlays, deck water, barrels
    CrewView.ts    draws every shown deck's crew and stations (both sides, team rings, swings, fights)
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

How Phase 3 meets its design-for-later constraints (§14):

- **Attachments are general.** `AttachSystem` links any two things with a motion state, a hull capsule, parts and a deck; it never assumes both ends are ships, so a latching Ness can reuse it (attach, expose its deck tiles, break the same way).
- **Close combat is data.** Swords and pistols read `tuning.melee` / `tuning.pistol` and each Lee's stats (`meleeDamage`, `meleeRate`, `pistolAccuracy`, `pistolRate`, `swingSpeed`); a new weapon is new numbers, not new code.
- **One crew AI, any unit.** Boarding, repelling and recall are needs and rules in the same `stepCrew` for both sides. A Lee good with a sword is drawn to fighting through `WORK_STAT.board/repel = meleeDamage` and `statAffinity`.
- **Boat types are data** (`config/ships.ts` + `tuning.ships.<id>`), including AI preferences (`ai.preferredRange`, `ai.seekAttach`, `ai.ramLine`, `ai.ramRange`).
- **Swinging is general.** Departure and landing tiles are "nearest tile to the other boat / to where it left", so it works between any two decks of any size or shape.
- **Derelict is a state** (`isDerelict`), ready for capture or salvage later.
- **The expanded view scales.** The strip frames the bounding box of every attached deck, however many the cap allows.

## How the crew decides

Every task on a boat has a **need** from the urgency ladder (`ladder` in tuning): flooding emergency (100) → offline guns / damaged engine (80) → an unmanned cannon that can engage (60) → other damage and moderate water (40) → empty oars/sails (30) → empty lookout (15) → a cannon with nothing to shoot (0). Each Lee scores each open task: need, minus walking time × `walkPenalty`, plus `homeBonus` (work done from its home tile), `roleBonus` (the kind of work its home tile sets), `standbyBonus` (a damage-control Lee waiting at home), minus `helpPenalty` per Lee already on a repair/bail job. It switches only when something beats its current task by `stickiness`, holds a new task for at least `commitTime`, and judges guns with `arcLookahead` so crews don't flip sides on every arc crossing. Ties break by score, tier, walking time, Lee id, then task order.

Phase 3 adds tiers: **engaged in melee** (forced: a Lee fights until its tile is clear, no decision), **repel boarders** (70: enemy Lees on your deck; low `boarding.repelHelpPenalty` so ganging up happens) and **board** (35: surplus Lees only, while attached to an enemy boat that has crew aboard). While boarding is open, a post that does nothing right now loses its home and role bonuses and its stickiness, so its Lee is free to go; a gun that can fire, a real repair or bailing job, or a fight keeps its Lee. `boarding.minHomeCrew` (default 0, off) keeps that many aboard. Once across, a boarder follows fixed rules (hunt the nearest enemy Lee; come home when the deck is clear, it's about to sink, or the link breaks), so crews don't swing back and forth on marginal score changes.

**Debug** shows, for each Lee, its task, the one-line reason it chose it (*"abandoned Port cannon 2: offline → Repair Port guns: guns offline, HP 22%"*), and its best few options with scores, plus the boat's needs. Tap the panel header to cycle through your crew and each enemy's. Ocean pips are colored by task in debug, and the strip shows walking paths. Phase 3 adds each boat's mode (orbit, alongside, ram, attached, derelict), its links and grapple/ram timers, where each Lee is standing (on which deck, mid-swing) and whom it's fighting, and for anyone across, **why it went** (*"Port cannon 2: no valid target (attached to Sloop #1) → Board Sloop #1: surplus crew → swing across"*). The ocean overlay adds minimum-range rings, docking distance, pistol range, and a red line between every pair of sword fighters.

## Tuning

- Open **Tune** during a fight or from the result screen. Values save to the browser as you change them.
- Most values take effect immediately. Values marked *(next run)*, including the whole **Parts** folder, crew size and Lee HP, apply on the next fight.
- **Crew:** `player.crew.size` / `ships.<type>.crew.size`, **Lee stats (per type)**, **Crew** (repair/bail/walk rates, mobility baselines, lookout range, repair ceiling, wrecked-repairable, crew hit damage and splash, wet threshold and slowdown), **Crew AI** (stickiness, commitment, lookahead, bonuses and penalties, flooding thresholds) and the **Urgency ladder**. `global.playerCrewStats` multiplies every stat of your Lees (the player-advantage knob for crews); the enemy also sails with fewer hands (4 vs 6) and a faster reload to make up for rarely manning both guns on a broadside.
- **Presets** let you save, load or delete named presets, export the tuning as JSON to your clipboard, import it by pasting, or reset to defaults.
- `playerAdvantage` multiplies the player's HP, divides their reload time and leak multipliers, and multiplies their turn rate by its square root. Each enemy type has its own hull (`ships.<type>.movement`); the Sloop is slower and less agile than you.
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

## Phase 3 tuning notes

- Everything for close combat is in the **Docking & ramming**, **Boarding**, **Pistols** and **Swords (melee)** folders, plus `cannons.minRange` and `ai` per ship type under **Enemy ship types**, and `repelBoarders` / `board` on the **Urgency ladder**.
- Saved Phase 2 tuning loads with its old `enemy` block moved onto the Sloop (`ships.standard`).
- The **Encounter picker** (bottom of the tuning panel) restarts with any mix of ship types, and keeps it for later fights until you press *Back to the campaign*.
