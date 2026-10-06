# Lee: Ship Combat Prototype

Phase 1 asked: **is it fun to steer a boat with one thumb while it fights automatically, and can you read its damage state on a second panel?** ([`docs/PRD.md`](docs/PRD.md))

Phase 2 puts a crew on the boat: **does deciding where your Lees start make the fight more interesting, and is it fun to watch a self-organizing crew respond while you steer?** ([`docs/PRD_PHASE2.md`](docs/PRD_PHASE2.md))

Phase 3 adds close combat: **is it fun to close the distance and fight up close, and can you follow a fight spread across multiple decks while other boats are still shooting?** ([`docs/PRD_PHASE3.md`](docs/PRD_PHASE3.md))

Phase 4 turns the test bench into the start of a run: **do ship, crew and equipment choices change how the game is played, and do they feel like choosing a style instead of picking the better number?** ([`docs/PRD_PHASE4.md`](docs/PRD_PHASE4.md))

Phase 5 is about operating and reading the game: **can a player with zero naval knowledge understand a fight and steer it with a few taps, without it becoming less of an autobattler?** ([`docs/PRD_PHASE5.md`](docs/PRD_PHASE5.md))

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

## Commands and clarity (Phase 5)

- **Ships are presets.** **Basic Ship** (all-rounder), **Long Distance Relation Ship** (long guns, fast), **Friend Ship** (the boarder: bow gatling, spikes, Swinging Ropes, a big crew) and **Hard Ship** (cannons, carronade, powder store, plating). Each starts with its crew placed and its parts fitted: pick one and you're at the refit, ready to launch. No draft, no starting part.
- **First reward must go on.** Fight 1 is easy and gives the usual reward choice, but the reward isn't auto-equipped: LAUNCH stays locked (and the item glows in cargo) until it's fitted or the recruit is placed. Only the run's first reward is forced.
- **Jobs and the action buttons.** Every Lee has a job: **⏩ SAIL** (oars, sails), **🔫 FIRE** (hull guns first, then anti-crew guns), **⚔️ BOARD** (cross to the target, repel boarders) or **🛠️ FIX** (repair, bail, pump). The four buttons sit on the seam above the close-up. Tap one and the best-fit Lee moves into that job (the biggest gain in skill for the new job over its current one); hold to repeat. A full job shakes. Your placement in refit sets each Lee's starting job.
- **Lees never idle.** A Lee with nothing useful in its own job falls back to repairs, bailing, or its pistol (melee Lees go and repel). A destroyed station doesn't change anyone's job. A Lee sharing a tile with a boarder fights; everyone else keeps working.
- **Pips.** Under each button, one pip per Lee in that job: color = Lee type, fill = HP, number = level, ring = progress on its current action; hollow pips are empty seats (guns, oars, sails). Pips slide between buttons over the time the Lee takes to walk. When a melee approach starts, the **enemy's pips** fade in above the buttons, grouped the same way. HP bars, level pips, progress bars and ghosts are gone from the field; each Lee just has a team ring.
- **Melee is a decision.** The ⚔️ button reads **BOARD** (side on), **RAM** (bow on) or **CHARGE** (when you're already touching). Only ⚔️ Lees cross. Boats are never snapped or pulled together: you sail alongside, and the close-up strip widens gradually as you get near (the ocean view stays zoomed out). A ram still lands without the button if the red X was up long enough; there's no bounce, and the boats stay in close combat until one sails off. While you're close, **⏩ becomes RETREAT**: your boat waits beside the enemy for your boarders to come home, then sails away. The enemy can leave without waiting; your stranded boarders keep fighting and swing home once you're back in reach. **Swinging Ropes** (treasure) add boarding range and swing speed.
- **Steering is taps.** Tap the ocean and the boat sails there, then holds the heading it arrived on. Tap near an enemy and it orbits a point that moves with that boat (if it sinks, you hold your heading). Tap your own boat to **stop** (a stopped boat fixes faster and aims tighter). Tap an enemy to **target** it: the boat turns toward it (around if needed) to board or ram depending on the angle. Dragging previews the path. The camera leads your velocity and keeps nearby enemies in view.
- **Speed** cycles **Pause / 0.5× / 1× / 3×**, remembered separately for sailing and close combat.
- **Refit is one stacked view.** Every deck tile is a stack (Lee → gun or station, with its attachment → floor); the ring just outside the hull is rails and hull modules. Tap a tile: its top thing rises and every valid spot lights up green; tap again for the next layer down. Tap a green spot to preview (stat bars, arcs red → green, what gets displaced), then ✅ to commit. Moving a lower layer carries what's above it (a manned cannon brings its Lee; attachments ride with their gun); same-layer things swap back, or go to cargo if they don't fit. Every deck tile takes a gun; corner guns can be turned to either side. Every non-corner edge has a rail slot and a hull slot. Cargo holds parts, Lees ashore, trinkets and treasures; select something on the boat and tap cargo to stow it. **Auto-equip** fills empty spots from cargo and places Lees ashore, without moving anything already placed. Five **stat bars** (Firepower, Toughness, Speed, Boarding, Repair) preview every change; the full numbers are under **Details**.

## The run (Phase 4)

**Menu → choose a ship → REFIT → FIGHT → results → level-ups → reward → REFIT → …** until your boat sinks or every Lee is dead (**Run Over**: fights survived, final loadout, survivors, and a memorial of the fallen). There's no victory screen: after the temporary encounter list runs out, the last encounter repeats with higher levels and, every other repeat, more crew (`escalation.*`).

- **⚙️** (top left, every screen) opens the system menu: Resume, Restart Run, Main menu, Reset All Saved Data (both destructive ones confirm), and the save and build versions. It pauses a fight while open.
- **Ships** (`config/ships.ts`, numbers in `tuning.ships`): **Basic Ship** (all-rounder, 5 × 3), **Long Distance Relation Ship** (skirmisher, 4 × 3, fast and fragile), **Friend Ship** (the boarder's longship, 7 × 2, 6–12 crew), **Hard Ship** (the gunnery galleon, 6 × 4, slow and tough). Slots are generated from the deck layout (Phase 5): every tile has a **fixture** slot (an edge tile's faces its side; a corner can face either) and a **floor** slot, every gun an **attachment** slot, and every edge a **rail** and a **hull** slot, plus treasure slots. Each ship has a standard fit (enemies, sandbox) and a player preset.
- **Guns carry their own arcs**; the slot sets which way they point. Cannon (70°), Long Gun (35°, far, fast), Carronade (85°, short, hits hard), Swivel (360°, weak, edge or interior), Mortar (180° interior lob with a ×2 splash; turn it with **Rotate**), Gatling (a stream at enemy crew), Scrap Cannon (an 8-pellet shotgun burst: a shaded area marker instead of 8 X's).
- **Stations**: oars (stack speed), sail (turning), lookout (every gunner aims tighter; the lookout is a tall pistol target), bilge pump, powder store (faster reloads; **explodes** if its tile blows out, and chains). (Boarding Hooks are gone in Phase 5; Swinging Ropes, a treasure, took their place.) **Rail items**: spikes (rams, contact damage, landing damage), fence (boarders can't land on that tile; they hack at it if every reachable tile is fenced), boarding planks (faster swings, pistol bonus over there, shootable mid-swing). **Hull modules**, **gun attachments**, **floor upgrades**, **Treasures** (ship-wide) and **Trinkets** (2 per Lee) are as in the PRD; duplicates stack. Every item is data in `config/items.ts`; its numbers are in `tuning.items.<id>`.
- **Tiles are units**: shells wear them down (splash to neighbors); a blown-out tile destroys its fixture for the fight and hurts whoever stands there, but stays walkable.
- **Lee types** (`config/lees.ts`): Hard (melee, Bodyguard trait), Quick (ranged), Deft (maneuvering), Handy (repair), Loud (support, Shouting trait), plus Basic for enemy crews. Each type has its own shirt color; enemies wear a bandana. Same-type Lees are numbered ("Quick Lee #2"); level shows as pips under the feet and a badge on cards.
- **Leveling**: survivors earn XP (survival plus damage, repairs, bailing, Lee damage, kills, time worked). Each level is a 1-of-3 bonus drawn from the type's strengths (**Auto-pick** takes the first). Enemies use the same levels, auto-picked.
- **Permadeath**: a Lee killed in a fight is gone for the run; its trinkets return to cargo.
- **Refit** (between fights): the one stacked view described above (Phase 5 replaced the Deck / Parts / Crew tabs). Tapping a Lee shows its stats after every modifier, trinkets and Release; the sandbox adds a panel for your ship and the encounter builder. Stat bars and Details are computed from a real boat with this crew. Warnings flag missing gunners, a short crew, Lees left ashore, and an empty slot your cargo could fill.
- **Saving**: the run saves locally after every step outside a fight. Reloading mid-fight puts you back at the refit before it. Saves carry a version (`SAVE_VERSION` in `sim/run.ts`); a save from another version, or a broken one, is never loaded: the menu says so and offers a reset.
- **Sandbox** (menu): the old test bench. Any ship, any part (the catalog is unlimited), any Lee type at any level, any encounter (presets or built boat by boat), nothing permanent. The sandbox assists (`global.playerAdvantage`, `playerCrewStats`, `fights.pack*Scaling`) only apply here.

## Playing

| Input | What it does |
|---|---|
| **Refit** (before LAUNCH) | Tap a tile to lift its top thing (tap again for the next layer down), tap a green spot to preview, ✅ to commit. Tap cargo items to place them; tap cargo with something selected to stow it. **Auto-equip**, **LAUNCH**. The ocean shows every gun's arc (red = where the moved gun points now, green = after). |
| Tap the ocean | Sail to that point, then hold the heading you arrived on. |
| Tap near an enemy | Orbit a point that moves with that boat (it sits on your beam, where the guns fire). If it sinks, hold your heading. |
| Tap an enemy hull | Target it: turn toward it and board or ram it, depending on the angle (the ⚔️ button shows which). |
| Tap your own boat | Stop. A stopped boat fixes faster and aims tighter (`jobs.stoppedFix`, `stoppedAim`); a badge on the buttons says so. |
| Drag | The target follows your finger and a dashed line previews the path. Lifting the finger keeps the order. |
| **⏩ 🔫 ⚔️ 🛠️** (on the seam above the close-up) | Move the best-fit Lee into that job; hold to repeat. ⏩ reads RETREAT and ⚔️ reads BOARD / RAM / CHARGE when it applies. Pips under each button are the crew readout. |
| Bottom strip | View only: your boat, bow to the right, and any boat you're close to, framed as it gets closer. Lees have a team ring; a dashed line shows where a walking Lee is headed. |
| **Speed** / **Tune** / **Debug** | Speed cycles Pause / 0.5× / 1× / 3× (separately for sailing and close combat); tuning panel; debug overlay (arcs, ranges, hitboxes, seek points, every shell's landing spot, contacts and jobs). |

**Close combat (Phase 3).**
- *Minimum range.* Every gun has a minimum range as well as a maximum (`guns.minRange` × the gun's own). A boat inside it can't be shelled by that gun: Long Guns and Mortars can't touch you up close; Carronades can.
- *Contact* (Phase 5 replaces Phase 3's docking and links). Nothing snaps or pulls boats together. Two opposing boats within `boarding.range` (+ `rangeSlack` to leave) are in **close combat**: Lees can swing across (⚔️ Lees only), and the strip widens as boats get closer (`layout.closeViewStart`). Hulls that touch are pushed apart (a bump, `attach.bounce`); the boats keep their own steering. After a ram, the RAM autopilot holds the bow in (`attach.holdPush`) until someone sails off.
- *Ramming.* A bow hitting a hull square on (within `ramMaxAngle`) at `ramSpeed` or faster rams: the struck part takes `ramDamage` × closing speed, the rammer's bow `ramSelfDamage` of that, and the two carry on at their averaged velocity (no bounce). A predicted ram shows a red X on the hull where it will land (`ramWarnTime` ahead). **A ram only lands if its X has been up for `ramMinWarning`**; otherwise the contact is a bump. Glancing or slow contact bumps too. After a ram, `ramCooldown` passes before the same pair can ram again. Same-side boats never ram.
- *Firing rules.* Nobody shells a boat with its own side's boarders aboard. Everything else is fair game, including a boat you're touching.
- *Gatling guns* (a part since Phase 4) spray bullets at enemy crew: a hit hurts a Lee, a miss barely scratches the hull, and the scatter grows with distance, so they shred crews up close.
- *Aim.* Enemy gunners lead your velocity and also guess at a random part of your current turn (`guns.turnLead`), so circling steadily isn't safe: change direction to dodge. Shells are slower and scatter more than before. The red X starts large and shrinks onto the impact point (`telegraph.markerStartScale`); its final size is the danger zone, with a faint dashed ring closing in for timing.
- *Pistols and swords.* Every Lee carries a pistol: slow, short-ranged (`pistol.range`), scattering in a disk like cannon spread (÷ pistol accuracy), it only hurts opposing Lees and barely scratches hulls. Shooting never pulls a Lee off its post. Lees on a shared tile with an opposing Lee are **engaged** and sword-fight until the tile is clear: never misses, lowest-HP opponent first (ties by id). An engaged gunner stops loading.
- *Close quarters.* At most `boarding.tileCap` (2) Lees stand on a tile, either side: no blobs, so fights are mostly duels along a front line, and the rest wait or shoot. A Lee under `boarding.retreatAt` (25%) of its HP falls back away from the enemy and uses its pistol instead (boarders swing home); hunters go for the fit ones first. Boarders cross one at a time (`swingInterval`) and only when there's room to land. Lees have more HP (70) and swords are slower, so a boarding fight takes a minute or two rather than seconds.
- *Boarding* (Phase 5). Only Lees in the ⚔️ job cross. They gather at the rail facing the target and swing across (`boarding.swingTime`, one at a time, `swingInterval`), landing on the nearest tile. Across, they hunt the nearest enemy Lee, shooting on the way. They swing home when that deck is clear, when it passes `boarding.evacuateAt` of its sink line, when they're badly hurt, when you RETREAT, or when you move them to another job. If the boats drift out of reach they're **stranded**: they keep fighting and swing home once your boat is back in reach. Enemy Lees on your deck are repelled by ⚔️ Lees and anyone sharing their tile. A boarder whose home boat sinks is lost with it.
- *Crew lost = out.* A boat whose whole crew is dead is out of the fight for all intents and purposes: nobody fires at it, it drifts, and boarders on it come home. Kill or sink every enemy and you win; lose your whole crew and you lose ("Crew lost"), just as if you'd sunk. (This replaces the PRD's §10.1 "derelict must still be sunk" rule.)
- *Enemies* are built from the same content as you (Phase 4): a ship, a loadout, a crew with levels, and an AI profile (`tuning.ai`: **standard** orbits at cannon range, **boarder** comes alongside or rams when it has a clean line onto your hull, and sends `boardShare` of its crew to ⚔️ once it's within `boardAt`, **heavy** holds its broadside at range, **skirmisher** keeps far out).

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
    crew.ts        Lees, jobs, tasks, needs, the crew AI (one AI, every boat), stations, swings, fences
    contact.ts     boats touching: ram warnings, rams (spikes), bumps, close-combat contacts, boarding reach
    helm.ts        the helm: tap orders (point, heading, orbit, stop) and the BOARD/RAM/RETREAT autopilot
    stack.ts       refit as stacks: what's on each spot, where a pick can go, one move (carry, swap, cargo)
    combat.ts      Lee vs Lee: engagement, swords, pistols
    telegraph.ts   general "something lands here in N seconds" system (X's and area markers)
    world.ts       the one world: boats from setups, enemy brains, guns by mode, shells, tiles,
                   explosions, spikes, sinking, stats
    setup.ts       boat setups (build + crew), Auto-arrange, enemies built from encounter data
    levels.ts      XP thresholds, level-up offers and bonuses (player and enemy)
    run.ts         the run: items as instances, equip/cargo, crew, presets, rewards (the first must be
                   placed), Auto-equip, permadeath, encounter escalation, the versioned save
    boatStats.ts   the refit stat bars and Details card, from a real boat
  game/
    BattleScene.ts one Phaser scene, two cameras (ocean + strip) reading the same world
    BoatView.ts    draws a boat: parts, cracks, water, every gun type, stations, rails, plating
    CrewView.ts    draws every shown deck's crew and stations (type shirts, team rings)
    textures.ts    placeholder art + trimming crack art to each part's outline
    Controller.ts  screens and the run/sandbox, the world, saving, live tuning, speed/debug/pause
  ui/              DOM: HUD, action buttons and pips (actionBar.ts), ⚙️ menu and run screens
                   (screens.ts), refit (refit.ts), cards,
                   ship previews, crew debug, result screen, tuning panel, code-drawn crew art
tests/             steering, damage, world rules, crew and jobs, close combat, helm, equipment,
                   refit stacks, the run
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
- **The expanded view scales.** The strip frames the bounding box of every deck in close combat, however many there are.

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

Phase 3 adds tiers: **engaged in melee** (forced: a Lee fights until its tile is clear, no decision), **repel boarders** (70: enemy Lees on your deck; low `boarding.repelHelpPenalty` so ganging up happens) and **board** (35: since Phase 5, ⚔️ Lees only). Once across, a boarder follows fixed rules (hunt the nearest enemy Lee; come home when the deck is clear, it's about to sink, it's badly hurt, or it's called back), so crews don't swing back and forth on marginal score changes.

**Phase 5: jobs.** The ladder now runs inside each Lee's **job**. Every need is tagged with the job it belongs to (guns → 🔫, oars and sails → ⏩, crossing and repelling → ⚔️, repair, bail and pump → 🛠️). Each Lee decides in two greedy passes: first, useful work of its own job (a gun stays "useful" for `jobs.gunStick` seconds after it loses its target, so gunners don't wander off on every turn); then, if there's nothing, a fallback: repair, bail or pump, repel (melee Lees), or stand ready at a station of its own job. A second Lee only helps on a repair or bailing job if its score after `helpPenalty` stays above `helpThreshold`. Home tiles, `homeBonus`, `roleBonus`, `standbyBonus` and `minHomeCrew` are gone: placement in refit only sets the starting job. ⚔️ Lees may also man a crew gun that faces the target. An order (a button tap) picks the Lee with the biggest gain in skill for the new job over its current one: sail = max(rowing, sailing), fire = load × accuracy, board = melee damage × melee rate, fix = the average of repair and bailing. Enemies use the same jobs; their brain re-orders every `jobs.aiOrderInterval` and sends `boardShare` of the crew to ⚔️ as it closes.

**Debug** (Phase 4) adds tag counts and the loadout for each boat, every gun's arc, facing and minimum/maximum range rings, tile durability bars in the strip, and each Lee's stats after every modifier (type, levels, trinkets, treasures, traits, the tile), for enemies as well as yours. It also shows, for each Lee, its task, the one-line reason it chose it (*"abandoned Port cannon 2: offline → Repair Port guns: guns offline, HP 22%"*), and its best few options with scores, plus the boat's needs. Tap the panel header to cycle through your crew and each enemy's. Ocean pips are colored by task in debug, and the strip shows walking paths. Phase 3 adds each boat's mode (orbit, alongside, ram, hold, derelict), its contacts (Phase 5: and each Lee's job), where each Lee is standing (on which deck, mid-swing) and whom it's fighting, and for anyone across, **why it went** (the job, and what it was doing before). The ocean overlay adds minimum-range rings, boarding range, pistol range, and a red line between every pair of sword fighters.

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

## Phase 5 notes

- **Decisions made where the PRD left room** (all tunable or data):
  - Names: the PRD's Kin Ship stays the **Friend Ship**. Internal ids are `basic`, `longdistance`, `friend`, `hard`. Saves from Phase 4 are refused (`SAVE_VERSION` 2) and saved tuning resets (`TUNING_VERSION` 5).
  - Presets are first guesses, not balance. Each ship also keeps a standard fit (`defaults`) used by enemies, the sandbox and tests, so changing a preset doesn't change the enemies.
  - The first fight is a leaky Basic Ship with two cannons and one Basic Lee.
  - The forced equip applies to every run's first reward (not just a first-ever run).
  - Sailors aren't moved to 🔫 on contact: the oars still matter in close combat, and you move them yourself.
  - RETREAT waits beside your boarders' deck until they're home, then sails away from the nearest enemy. While your Lees are aboard an enemy, your guns won't shell it.
  - A stopped boat (below `jobs.stoppedSpeed`) fixes ×1.25 faster and aims ×1.25 tighter (`jobs.stoppedFix`, `stoppedAim`), so stopping is a real choice, not just a brake.
  - Hull slots sit on edges, so a midship part with no edge can't be plated.
  - Stowing a gun leaves its Lee standing on the tile.
  - Stat bars are a share of a fixed scale (`refit.bar*`, a marker shows "full"); a big build can overflow up to 120%.
- **Balance** (`SWEEP_SEEDS=2 SWEEP_FIGHTS=4 npm run sweep`): Basic, Friend and Hard Ships win every fight through fight 4. The Long Distance Relation Ship (the sweep captain just orbits at long-gun range) lost fight 2 on both seeds by timeout and fight 3 once: it probably needs a person kiting, but it's the first thing to look at in playtest.


