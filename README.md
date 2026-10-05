# Lee: Ship Combat Prototype

Phase 1 asked: **is it fun to steer a boat with one thumb while it fights automatically, and can you read its damage state on a second panel?** ([`docs/PRD.md`](docs/PRD.md))

Phase 2 puts a crew on the boat: **does deciding where your Lees start make the fight more interesting, and is it fun to watch a self-organizing crew respond while you steer?** ([`docs/PRD_PHASE2.md`](docs/PRD_PHASE2.md))

Phase 3 adds close combat: **is it fun to close the distance and fight up close, and can you follow a fight spread across multiple decks while other boats are still shooting?** ([`docs/PRD_PHASE3.md`](docs/PRD_PHASE3.md))

Phase 4 turns the test bench into the start of a run: **do ship, crew and equipment choices change how the game is played, and do they feel like choosing a style instead of picking the better number?** ([`docs/PRD_PHASE4.md`](docs/PRD_PHASE4.md))

Phase 5 (next, not built yet) is about operating and reading the game: **can a player with zero naval knowledge understand a fight and steer it with a few taps, without it becoming less of an autobattler?** ([`docs/PRD_PHASE5.md`](docs/PRD_PHASE5.md))

The earlier grid autobattler lives in [`legacy/`](legacy/). It is not part of the build.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (--host is on, so your phone on the same Wi-Fi can open it)
npm test           # simulation unit tests (vitest)
npm run build      # typecheck + production build to dist/ (what Netlify deploys)
npm run sweep      # tuning tool: a scripted captain sails each ship through the encounter list (slow)
```

Stack: TypeScript, [Phaser 3](https://phaser.io), Vite, lil-gui for the tuning panel, and Vitest.

## The run (Phase 4)

**Menu → choose a ship → draft your crew → pick a starting part → REFIT → FIGHT → results → level-ups → reward → REFIT → …** until your boat sinks or every Lee is dead (**Run Over**: fights survived, final loadout, survivors, and a memorial of the fallen). There's no victory screen: after the temporary encounter list runs out, the last encounter repeats with higher levels and, every other repeat, more crew (`escalation.*`).

- **⚙️** (top left, every screen) opens the system menu: Resume, Restart Run, Main menu, Reset All Saved Data (both destructive ones confirm), and the save and build versions. It pauses a fight while open.
- **Ships** (`config/ships.ts`, numbers in `tuning.ships`): **Sloop** (all-rounder, 5 × 3), **Skiff** (skirmisher, 4 × 3, fast and fragile, stern slots for chasers), **Friend Ship** (the boarder's longship, 7 × 2, 6–12 crew, a bow gatling, hooks and spikes), **Hard Ship** (the gunnery galleon, 6 × 4, slow and tough, cannons, carronades and a powder store). Each has typed slots: **edge** (with a facing: port, starboard, bow, stern), **interior**, **rail**, **hull**, a **floor** slot on every tile, an **attachment** slot on every gun, and treasure slots.
- **Guns carry their own arcs**; the slot sets which way they point. Cannon (70°), Long Gun (35°, far, fast), Carronade (85°, short, hits hard), Swivel (360°, weak, edge or interior), Mortar (180° interior lob with a ×2 splash; turn it with **Rotate**), Gatling (a stream at enemy crew), Scrap Cannon (an 8-pellet shotgun burst: a shaded area marker instead of 8 X's).
- **Stations**: oars (stack speed), sail (turning), lookout (every gunner aims tighter; the lookout is a tall pistol target), bilge pump, boarding hooks (faster grapples and swings), powder store (faster reloads; **explodes** if its tile blows out, and chains). **Rail items**: spikes (rams, attached damage, landing damage, slower cast-off), fence (boarders can't land on that tile; they hack at it if every reachable tile is fenced), boarding planks (faster swings, pistol bonus over there, shootable mid-swing). **Hull modules**, **gun attachments**, **floor upgrades**, **Treasures** (ship-wide) and **Trinkets** (2 per Lee) are as in the PRD. Every item is data in `config/items.ts`; its numbers are in `tuning.items.<id>`.
- **Tiles are units**: shells wear them down (splash to neighbors); a blown-out tile destroys its fixture for the fight and hurts whoever stands there, but stays walkable.
- **Lee types** (`config/lees.ts`): Hard (melee, Bodyguard trait), Quick (ranged), Deft (maneuvering), Handy (repair), Loud (support, Shouting trait), plus Basic for enemy crews. Each type has its own shirt color; enemies wear a bandana. Same-type Lees are numbered ("Quick Lee #2"); level shows as pips under the feet and a badge on cards.
- **Leveling**: survivors earn XP (survival plus damage, repairs, bailing, Lee damage, kills, time worked). Each level is a 1-of-3 bonus drawn from the type's strengths (**Auto-pick** takes the first). Enemies use the same levels, auto-picked.
- **Permadeath**: a Lee killed in a fight is gone for the run; its trinkets return to cargo.
- **Refit** (between fights): tabs **Deck** (place Lees, as before), **Parts** (slots by layer, cargo, equip and unequip, arcs, rotate interior guns, attachments), **Crew** (roster, levels, stats after every modifier, trinkets, Release) and, in the sandbox, **Sandbox** (your ship and the encounter builder). The **stat card** is computed from a real boat with this crew, and shows before → after when you pick up a part. Warnings flag missing gunners, a Lee whose station was removed, a short crew, Lees left ashore, and an empty slot your cargo could fill.
- **Saving**: the run saves locally after every step outside a fight. Reloading mid-fight puts you back at the refit before it. Saves carry a version (`SAVE_VERSION` in `sim/run.ts`); a save from another version, or a broken one, is never loaded: the menu says so and offers a reset.
- **Sandbox** (menu): the old test bench. Any ship, any part (the catalog is unlimited), any Lee type at any level, any encounter (presets or built boat by boat), nothing permanent. The sandbox assists (`global.playerAdvantage`, `playerCrewStats`, `fights.pack*Scaling`) only apply here.

## Playing

| Input | What it does |
|---|---|
| **Refit** (before LAUNCH) | Deck tab: the bottom panel shows your deck grid. Tap a Lee (tray or deck), then a tile, or drag it. Tap another Lee to swap; drop off the deck, or tap the tray, to send one ashore. While a Lee is selected, every tile shows its role and what moving there would change (*+20% speed*, *−1 gun*). The ocean shows every gun's arc from where it's mounted (the selected one bright). **Clear all**, **Auto-arrange** (best-qualified Lee per post), **LAUNCH**. |
| Touch and hold the ocean (top panel) | The boat seeks that point. A dashed line previews the next few seconds of movement. Faint rings show every boat's **minimum cannon range** while your finger is down. |
| Hold on (or right beside) an enemy hull | **Come alongside** it: the boat steers for the slot beside it and matches its speed. Linger close and slow and you dock (a ring fills over the grapple time). Steer away to break it off. |
| Drag | The target follows your finger. |
| Release | The boat holds its current heading. |
| Hold close to a boat (or any point) | The boat settles into an orbit with that point on its beam, which is where the cannons fire. |
| **Disengage** (on the seam above the close-up) | Cast off: your boarders over there fight their way back aboard ("Casting off… 2 still aboard them"), then the link breaks and the boats are pushed apart. Their boarders on your deck don't get a free ride home: they stay and fight. One button per attached boat. |
| **1x / 2x** | Remembered separately for sailing and for close combat (while attached): 2x for the sailing doesn't carry into a boarding fight. |
| Bottom strip | View only during a fight: your boat, bow to the right, with its crew. Every Lee shows a task icon; a bar shows real progress only (a gun loading, a part being patched up, water being bailed down), while rowing, sailing and the lookout are steady effects with no bar; empty stations are dim with an empty ring; a ghost marks the home tile of anyone who's away; a dashed line shows where a walking Lee is headed. |
| **Tune** / **Debug** / **1x 2x** | Tuning panel, debug overlay (arcs, ranges, hitboxes, seek points, every shell's landing spot), and game speed. |

**Close combat (Phase 3).**
- *Minimum range.* Every gun has a minimum range as well as a maximum (`guns.minRange` × the gun's own). A boat inside it can't be shelled by that gun: Long Guns and Mortars can't touch you up close; Carronades can.
- *Docking.* Two opposing boats within `attach.dockDistance` of each other, slower than `dockRelSpeed` relative to each other, for `grappleTime` seconds, ease side by side and stick. The ring fills while it's happening; red when it's being done to you, cream when you're the one closing in.
- *Ramming.* A bow hitting a hull square on (within `ramMaxAngle`) at `ramSpeed` or faster rams: the struck part takes `ramDamage` × closing speed, the rammer's bow `ramSelfDamage` of that, and the two lock nose-into-hull. A predicted ram shows a red X on the hull where it will land (`ramWarnTime` ahead). **A ram only lands if its X has been up for `ramMinWarning`**; otherwise the contact is a bump. Glancing or slow contact bumps too (`bounce`). Same-side boats never attach.
- *Attached.* Propulsion and steering are overridden: the group drifts together (`driftSpeed`), steering input and the path preview do nothing, and the strip expands (`layout.expandedOceanFraction`) to show your deck plus every attached one, each where it lies (port above, starboard below, a rammer where it hit). Cap: `attach.cap` links per boat, `perSide` per side.
- *Firing rules.* Nobody shells a boat it's attached to, or a boat attached to one of its allies (so an enemy won't shell you while you're docked to its friend). Attached boats still shoot outward at other targets.
- *Gatling guns* (a part since Phase 4) spray bullets at enemy crew: a hit hurts a Lee, a miss barely scratches the hull, and the scatter grows with distance, so they shred crews up close. They also fire across at an attached deck.
- *Aim.* Enemy gunners lead your velocity and also guess at a random part of your current turn (`guns.turnLead`), so circling steadily isn't safe: change direction to dodge. Shells are slower and scatter more than before. The red X starts large and shrinks onto the impact point (`telegraph.markerStartScale`); its final size is the danger zone, with a faint dashed ring closing in for timing.
- *Pistols and swords.* Every Lee carries a pistol: slow, short-ranged (`pistol.range`), scattering in a disk like cannon spread (÷ pistol accuracy), it only hurts opposing Lees and barely scratches hulls. Shooting never pulls a Lee off its post. Lees on a shared tile with an opposing Lee are **engaged** and sword-fight until the tile is clear: never misses, lowest-HP opponent first (ties by id). An engaged gunner stops loading.
- *Close quarters.* At most `boarding.tileCap` (2) Lees stand on a tile, either side: no blobs, so fights are mostly duels along a front line, and the rest wait or shoot. A Lee under `boarding.retreatAt` (25%) of its HP falls back away from the enemy and uses its pistol instead (boarders swing home); hunters go for the fit ones first. Boarders cross one at a time (`swingInterval`) and only when there's room to land. Lees have more HP (70) and swords are slower, so a boarding fight takes a minute or two rather than seconds.
- *Boarding.* While attached to an enemy boat with crew aboard, Lees whose post does nothing right now (a gun with no valid target, oars and sails, an idle lookout, standing by) are **surplus**: they walk to the rail nearest the other boat and swing across (`boarding.swingTime`), landing on the nearest tile. Across, they hunt the nearest enemy Lee, shooting on the way. They swing home when that deck is clear, when it passes `boarding.evacuateAt` of its sink line, or when the link starts to break. Enemy Lees on your deck create a **repel** need (above manning guns). A boarder whose home boat sinks is lost with it.
- *Crew lost = out.* A boat whose whole crew is dead is out of the fight for all intents and purposes: nobody fires at it, it drifts, and any boat attached to it is released (after the usual recall window). Kill or sink every enemy and you win; lose your whole crew and you lose ("Crew lost"), just as if you'd sunk. (This replaces the PRD's §10.1 "derelict must still be sunk" rule.)
- *Enemies* are built from the same content as you (Phase 4): a ship, a loadout, a crew with levels, and an AI profile (`tuning.ai`: **standard** orbits at cannon range, **boarder** comes alongside to dock or rams when it has a clean line onto your hull, **heavy** holds its broadside at range, **skirmisher** keeps far out).

**Fights.** Fights come from the temporary encounter list (`config/encounters.ts`), then escalate. After a fight, **Continue** goes to results, level-ups and the reward. The pill at the top shows the fight number and how many ships are left. By default you start every fight with a fully repaired boat and a healed crew (`run.repairBetweenFights`, `run.healBetweenFights`).

**Crew.** A gun only loads and fires with a gunner standing at its station; each manned set of oars adds speed and each manned sail adds turning on top of a baseline (`crew.oarBaseline` / `sailBaseline`, 60%); a manned lookout tightens every gun's spread; plain deck is damage control (repair and bail). Where you place a Lee sets its *preferred* role. During the fight nobody takes orders: each Lee goes where it's needed most (an open gun facing the enemy, a part that was just hit, rising water) and drifts home when that passes. Shells that land on Lees hurt them; a Lee at 0 HP goes overboard and isn't replaced this fight. The enemy's crew runs on the same AI. The result screen adds Lees lost and a per-Lee breakdown (time by task, time away from home, task switches); your arrangement carries into the next refit.

Cannons fire when loaded and the target is inside their arc. Enemy shells mark their landing spot with a **red X** and a ring that shrinks until impact. Shells fly to a fixed point and hit whatever is there when they land. The enemy aims where you're going, so turning dodges.

## How the code is laid out

```
src/
  config/          content as data (names, slots, tags, behaviors), numbers mirrored into tuning
    tuning.ts      every gameplay number (one place; the sliders are built from it)
    boats.ts       hull layouts: part shapes, roles, stat blocks, adjacency, deck grid
    ships.ts       ships: layout, typed slots, default loadout, style, tags (numbers in tuning.ships)
    slots.ts       slot types and facings
    items.ts       guns, stations, rail items, hull modules, attachments, floors, Treasures, Trinkets
    lees.ts        Lee types: stats, traits (generic abilities), tags, level-up weights, colors
    tags.ts        tags (data only: shown and counted, no bonuses yet)
    encounters.ts  AI profiles, archetypes, the temporary encounter list
    art.ts         art manifest (all null = placeholder art drawn in code)
  sim/             pure TypeScript game rules, no Phaser imports, deterministic
    steering.ts    "seek this point" + orbit; shared by player, enemy and path preview
    boat.ts        parts, layered damage (armor), flooding, guns and their live specs, movement
    loadout.ts     slots and builds: what fits where, and folding item effects into boat mods
    grid.ts        deck tiles (fixtures, rails, floors, durability), neighbors, walking distances
    crew.ts        Lees, tasks, needs, the crew AI (one AI, every boat), stations, swings, fences
    attach.ts      links between boats: docking, ramming (spikes), bumps, warnings, drift, breaking
    combat.ts      Lee vs Lee: engagement, swords, pistols
    telegraph.ts   general "something lands here in N seconds" system (X's and area markers)
    world.ts       the one world: boats from setups, enemy brains, guns by mode, shells, tiles,
                   explosions, spikes, sinking, stats
    setup.ts       boat setups (build + crew), Auto-arrange, enemies built from encounter data
    levels.ts      XP thresholds, level-up offers and bonuses (player and enemy)
    run.ts         the run: items as instances, equip/cargo, crew, draft, rewards, permadeath,
                   encounter escalation, the versioned save
    boatStats.ts   the refit stat card, from a real boat
  game/
    BattleScene.ts one Phaser scene, two cameras (ocean + strip) reading the same world
    BoatView.ts    draws a boat: parts, cracks, water, every gun type, stations, rails, plating
    CrewView.ts    draws every shown deck's crew and stations (type shirts, level pips)
    textures.ts    placeholder art + trimming crack art to each part's outline
    Controller.ts  screens and the run/sandbox, the world, saving, live tuning, speed/debug/pause
  ui/              DOM: HUD, ⚙️ menu and run screens (screens.ts), refit (refit.ts), cards,
                   ship previews, crew debug, result screen, tuning panel, code-drawn crew art
tests/             steering, damage, world rules, crew, close combat, equipment, the run
tools/sweep.test.ts  the quick run simulation (npm run sweep)
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
- **Derelict is a state** (`isDerelict`, and `World.isOut` = sinking or crewless), ready for capture or salvage later.
- **The expanded view scales.** The strip frames the bounding box of every attached deck, however many the cap allows.

How Phase 4 meets its design-for-later constraints (§13):

- **The run flow is replaceable.** `sim/run.ts` holds state and pure steps (draft, equip, apply a fight, rewards); which screen comes next lives in the Controller. A sea map replaces `encounterFor` and adds reward sources without touching ships, items, Lees or refit.
- **Everything is data.** Ships, slots, items, Lee types, traits, tags, AI profiles and encounters are entries in `config/`; their numbers are mirrored into tuning (`ships`, `items`, `lees`, `traits`, `ai`), so they're live-editable on the phone. Adding an item of an existing kind is one entry. Slot types are a table; a new layer is a new slot type plus whatever reads it.
- **Player and enemy share content.** `createBoat` takes a build for either side; enemies come from `enemySetup` (encounter data, auto-picked level bonuses). In a run nothing else differs: the old hidden multipliers are sandbox-only assists, and `World` ignores them unless `assists` is on.
- **Guns can grow.** A gun is an item with a mode (shell, lob, stream, burst) and numbers; recoil or special ammo are more numbers on the same item, read in `gunSpec`.
- **Parts can grow; Treasures and Trinkets can get weird.** Effects are generic (`{ scope, stat, op, param }` over boat, part, tile, occupant, gun, crew, wearer); stations, rails and volatile parts are behavior kinds. Active abilities or conditions are new kinds, not rewrites.
- **Tags are general.** Every item, ship and Lee type has tags; `countTags` counts them (debug panel, Crew tab, Run Over).
- **Traits are generic.** Bodyguard and Shouting are the Phase 2 ability mechanism (now multi-stat, strength in `tuning.traits`).
- **Lee identity is stable.** Crew members have a uid, label, level, XP, bonuses, trinkets, fights and kills, which fight Lees carry through `uid`; the memorial reads them.
- **Run state is serializable and versioned**, and refused (not half-loaded) when the version doesn't match.
- **Tiles are units with layers.** Fixture, rails, floor, durability and blow-outs live on the tile; fire or smoke join `layers` later.

## How the crew decides

Every task on a boat has a **need** from the urgency ladder (`ladder` in tuning): flooding emergency (100) → offline guns / damaged engine (80) → an unmanned cannon that can engage (60) → other damage and moderate water (40) → empty oars/sails (30) → empty lookout (15) → a cannon with nothing to shoot (0). Each Lee scores each open task: need, minus walking time × `walkPenalty`, plus `homeBonus` (work done from its home tile), `roleBonus` (the kind of work its home tile sets), `standbyBonus` (a damage-control Lee waiting at home), minus `helpPenalty` per Lee already on a repair/bail job. It switches only when something beats its current task by `stickiness`, holds a new task for at least `commitTime`, and judges guns with `arcLookahead` so crews don't flip sides on every arc crossing. Ties break by score, tier, walking time, Lee id, then task order. A Lee's stat for the work counts too (`crewAI.statAffinity`, capped at `statAffinityCap` away from 1): a tiebreaker that sends the Handy Lee to the repair and the Quick Lee to the gun, without pulling a specialist off its post. Debug reasons say when it tipped a choice (*"Repair Bow: HP 30% [+5 for Repair ×1.80]"*).

Phase 3 adds tiers: **engaged in melee** (forced: a Lee fights until its tile is clear, no decision), **repel boarders** (70: enemy Lees on your deck; low `boarding.repelHelpPenalty` so ganging up happens) and **board** (35: surplus Lees only, while attached to an enemy boat that has crew aboard). While boarding is open, a post that does nothing right now loses its home and role bonuses and its stickiness, so its Lee is free to go; a gun that can fire, a real repair or bailing job, or a fight keeps its Lee. `boarding.minHomeCrew` (default 0, off) keeps that many aboard. Once across, a boarder follows fixed rules (hunt the nearest enemy Lee; come home when the deck is clear, it's about to sink, or the link breaks), so crews don't swing back and forth on marginal score changes.

**Debug** (Phase 4) adds tag counts and the loadout for each boat, every gun's arc, facing and minimum/maximum range rings, tile durability bars in the strip, and each Lee's stats after every modifier (type, levels, trinkets, treasures, traits, the tile), for enemies as well as yours. It also shows, for each Lee, its task, the one-line reason it chose it (*"abandoned Port cannon 2: offline → Repair Port guns: guns offline, HP 22%"*), and its best few options with scores, plus the boat's needs. Tap the panel header to cycle through your crew and each enemy's. Ocean pips are colored by task in debug, and the strip shows walking paths. Phase 3 adds each boat's mode (orbit, alongside, ram, attached, derelict), its links and grapple/ram timers, where each Lee is standing (on which deck, mid-swing) and whom it's fighting, and for anyone across, **why it went** (*"Port cannon 2: no valid target (attached to Sloop #1) → Board Sloop #1: surplus crew → swing across"*). The ocean overlay adds minimum-range rings, docking distance, pistol range, and a red line between every pair of sword fighters.

## Tuning

- Open **Tune** during a fight or from the result screen. Values save to the browser as you change them.
- Most values take effect immediately. Values marked *(next run)*, including the whole **Parts** folder, crew size and Lee HP, apply on the next fight.
- **Crew:** **Lee stats (per type)**, **Crew** (repair/bail/walk rates, mobility baselines, repair ceiling, wrecked-repairable, wet threshold and slowdown), **Crew AI** (stickiness, commitment, lookahead, bonuses and penalties, stat affinity, flooding thresholds) and the **Urgency ladder**. Crew sizes come from the run (or the encounter), not tuning.
- **Presets** let you save, load or delete named presets, export the tuning as JSON to your clipboard, import it by pasting, or reset to defaults.
- **Ships, guns, items** (Phase 4): `boat` is the baseline hull every ship scales; `ships.<id>` its multipliers, crew limits and treasure slots; `guns` the standard cannon (every gun's numbers in `items.<gun>` are multipliers on it, except `arc`, full width in degrees, and `pellets`); `items.<id>` every item's numbers; `tiles` and `explosion` for durability and the Powder Store; `run`, `leveling` and `escalation` for the loop.
- **Sandbox assists** (`global.playerAdvantage`, `global.playerCrewStats`, `fights.packHullScaling`, `fights.packReloadScaling`) default to off and only apply in the sandbox.
- **Aiming:** each loaded gun picks the closest enemy boat inside its arc and range, then rolls a random part, a random point within `guns.aimRadius` of it, and a lead that's off by up to `guns.leadError`, so fast or distant targets are harder to hit. Gunner scatter (`guns.spread` × the gun's spread ÷ accuracy ÷ lookout) comes on top.
- **Holes:** every hit lets `guns.hitWater` into the part; a hit on a part that's already wrecked punches through and lets in `guns.holeWater` (spilling into neighboring parts if it's full), so shooting a wrecked part still sinks the ship. Pellets let in water in proportion to their damage.
- The dodge window is set by (`guns.flightTimeBase` + `flightTimePerMeter × distance`) ÷ the gun's shell speed, with `telegraph.minWarningTime` as the floor for enemy shells.
- Orbiting is controlled by `movement.orbitRadiusScale` and `movement.orbitCapture`. Setting `orbitCapture = 0` gives plain point-seeking, where the boat loops through the point instead of circling it.
- **Several attackers** (**Fights** folder):
  - **Threat budget:** `maxIncomingShells` (default 3) caps how many enemy shells, and so how many red X's, can be in the air at once (a scrap burst counts once). A loaded enemy gun waits for a free slot, so a pack stays dodgeable.
  - **Crossfire:** `friendlyFire = 1` lets enemy shells hit other enemies.
  - **Spacing:** each enemy holds its own range (`enemyAI.rangeJitter`) and steers away from packmates closer than `enemyAI.spacing`.
- `input.targetFollowsCamera = 1` keeps the target under a still finger as the camera pans. The preview then becomes approximate, because the target moves with the camera.

## Adding art

Edit `src/config/art.ts` and drop files into `public/art/`. Each slot is optional; an empty one falls back to the placeholder. Part sprites are drawn top-down with the bow pointing right and stretched to fit the part's bounding box. You only supply one generic set of crack images: the game tiles them and trims them to each part's outline. Sizes and conventions are documented in `art.ts`.

## Phase 3 tuning notes

- Everything for close combat is in the **Docking & ramming**, **Boarding**, **Pistols** and **Swords (melee)** folders, plus each gun's `minRange` under **Items**, the **Enemy AI profiles**, and `repelBoarders` / `board` on the **Urgency ladder**.

## Phase 4 notes

- **Decisions made where the PRD left room** (all tunable or data):
  - Ship names keep the puns where the role matches: the Longship is the **Friend Ship** and the Galleon the **Hard Ship**.
  - Gatlings are a gun part, not on every ship by default. They keep Phase 3's playtested numbers (3 damage a bullet, about 2.5 a second) rather than the PRD's multipliers.
  - Oars and sails **stack**: speed = `oarBaseline` + each manned set's boost (two sets = Phase 2's full speed), capped at `mobilityCap`. The Friend Ship has no interior slots, so no sail; its ship `turn` multiplier makes up for it.
  - The lookout now tightens aim (PRD) instead of extending range; range comes from guns, the Rangefinder and the Sextant.
  - Guns go offline when their hull part drops below `boat.function.gunOfflineAt` **or** their tile blows out.
  - Interior guns with a limited arc (the Mortar) face their slot's default way; **Rotate** turns them.
  - The run also saves after a fight resolves, so a reload can't undo a death. Reloading mid-fight still returns to the refit before it.
  - **Reset All Saved Data** keeps your named tuning presets. Saved tuning from before Phase 4 is dropped (the shape changed); `meta.version` guards it from now on.
  - Defaults for the PRD's open questions: numbered labels ("Quick Lee #2") with no first names; trinkets return to cargo; full repair and heal between fights; unlimited cargo; recruits join at level 1 (`run.recruitLevelPerFight`); the next fight is summarized on the refit screen; the ⚙️ menu pauses; zero Lees ends the run; tiles aren't repaired mid-fight.
- **Balance** (from `npm run sweep`, a scripted captain that never dodges, kites or casts off): fight 1 is comfortable for the gunships; boarding is decided by crew composition (a Hard-heavy crew wins, a crew of Quick Lees loses); the Friend Ship played as a boarder is strong; the Skiff needs a person kiting at range. The early encounters were softened accordingly. Treat these as starting points for playtesting.

