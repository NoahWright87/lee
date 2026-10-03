# Lee — Phase 2 PRD: Crew & Stations

> **Status:** Phase 1 (steering, split screen, telegraphed shells, parts, flooding, sinking, tuning panel) is built and playtested. The two-panel layout works as designed.
>
> **This document describes the *product* to build on top of Phase 1, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**.
>
> **Baseline:** Everything in the Phase 1 PRD still holds unless this document says otherwise. This PRD describes only what changes or gets added.
>
> **Platform:** Mobile web, portrait-first (unchanged). Desktop browser works for development (mouse = touch).

---

## 1. Context

Phase 1 answered: *is it fun to steer a boat with one thumb while it fights automatically?* The boat's cannons fired on their own, and nothing aboard could repair, bail, or speed the boat up.

**Phase 2 puts people on the boat.** Cannons, oars, and sails need someone working them. Damage and flooding need someone to fix them. Those people are **Lees**, crew members named after adverbs. In this phase every Lee is a **Basic Lee**, with identical stats. Variety comes later.

### The core idea

**Where you place a Lee sets its preferred role. When things go wrong, it goes where it's needed most.**

- Before the fight, the player places Lees on a deck grid. A Lee standing on a cannon station *prefers* to be a gunner. On an oar station, a rower. On plain deck, damage control.
- During the fight, nobody commands anyone. The crew **reallocates itself automatically**: a gunner whose cannon is destroyed runs to another cannon. Gunners on the wrong side of the boat switch to the side that's facing the enemy. A Lee standing in an undamaged part runs over to repair a part that just got hit.
- The player decides who starts where and steers the boat. The crew handles the rest.

### The question this phase answers

> **Does deciding where your crew starts make the fight more interesting, and is it fun to watch a self-organizing crew respond to the battle while you steer?**

### Hypotheses to test

1. Placing Lees on a deck grid before a fight is an understandable, meaningful decision.
2. **Placement still matters even though the crew reallocates itself.** (The biggest risk to the design. See §5.)
3. The crew's behavior reads as **smart, not erratic**. The player can tell *why* a Lee went where it went.
4. Being **short-staffed creates real dilemmas**: there are more jobs than Lees.
5. Watching the crew work is a **readable spectacle**. A glance at the bottom strip tells you who is doing what.
6. Losing a Lee mid-fight *matters* and is understood after the fact.
7. Enemy crews following the same rules make the enemy feel like a real ship, not a target dummy.

### The core design rule

**No dice.** Crew behavior must be **deterministic and predictable** from stats and rules. If something goes wrong, the player should be able to work out why. The same situation must always produce the same crew response.

---

## 2. What Changes from Phase 1 (Summary)

| Area | Phase 1 | Phase 2 |
|---|---|---|
| Cannons | Fire automatically | Need a **gunner Lee** standing at the cannon station |
| Boat speed and turning | Fixed by boat stats | Depend on **rowers** (speed) and **sail crew** (turning) |
| Water / damage | Only passive bilge removes water | Lees **bail water** and **repair parts** |
| Crew | None | **Basic Lees** on a deck grid, with home roles and dynamic reassignment |
| Targeting | Nearest part of nearest enemy | **Unchanged.** No target settings |
| Pre-fight screen | Frozen scene + START | **Setup mode**: place Lees on the grid, then START |
| Close-up strip | View-only | View-only **during the fight**, interactive **during setup** |
| Enemy | Cannons fire on their own | **Full enemy crew** on the same rules and AI as the player's Lees |
| Result screen | Fight stats | Adds **Lees lost** and **per-Lee stats** |
| Tuning panel | Boat and cannon values | Adds **Lee stats** and **crew AI rules** |

---

## 3. The Deck Grid & Stations

Both boats have a **deck grid**: a set of **tiles** laid over the boat's existing parts. The grid is where Lees stand. The enemy boat has one too (§9).

### 3.1 Grid rules

- The starting player boat has a **5 × 3 grid (15 tiles)**. Grid size is **boat data**, since future boats will differ. **(tunable)**
- Every tile belongs to **exactly one part** (bow, midship, port guns, starboard guns, engine).
- **One Lee per tile at rest.** While moving or working, Lees may overlap visually. They may **pass through** each other (no traffic simulation).
- Adjacency means **orthogonal neighbors** (up, down, left, right). This isn't used by any ability yet, but the grid must support it (see §14).
- Tiles inherit their part's condition. A tile in a flooded part is wet. A tile in a part with an offline cannon is visibly marked.

### 3.2 Station types

A **station** is a tile where standing and working produces an effect. **A station can have at most one Lee working it at a time.** Plain tiles (no station) are where damage-control Lees live.

| Station | What a working Lee does | Notes |
|---|---|---|
| **Cannon** | Operates one cannon: loads over time, then fires | Port cannons fire only to port, starboard only to starboard (as in Phase 1). Uses the Lee's load speed and accuracy |
| **Oars** | Rows to raise the boat's speed | Several oar stations stack |
| **Sails** | Handles sails to improve the boat's turning | |
| **Lookout** | Spots from the mast, improving all gunners' accuracy | A modest effect, **(tunable)**. Lowest-priority station. Can be cut if it doesn't earn its place (see §15) |
| *(plain tile)* | **Damage control**: repair and bail | Not a station. The default role for a Lee on plain deck |

**Mobility station rules.** A boat's speed and turn rate when **fully crewed** match the Phase 1 tuning. With empty oar or sail stations, they drop to a **reduced fraction (tunable, starting around 60%)**, scaling up as stations are manned. This keeps Phase 1's tuning valid as the "fully crewed" case.

### 3.3 Example player layout (illustrative, not binding)

Orientation matches the close-up strip: bow points right, port side is up.

```
          STERN  ◄──────────────────►  BOW

Port       [O*]  [C*]  [ ]  [C*]   [ ]
Centerline [ ]   [ ]   [S*] [ ]    [L*]
Starboard  [O*]  [C*]  [ ]  [C*]   [ ]

C* = Cannon station   O* = Oar station
S* = Sail station     L* = Lookout
[ ] = plain deck tile (damage control)
```

- **8 stations** (4 cannons, 2 oars, 1 sail, 1 lookout) and **15 tiles**.
- The default crew is **6 Lees**, so there are **more jobs than Lees**, and some stations will sit empty. Leaving a station empty is a decision, not a bug.
- The designer and engineer may adjust the layout, as long as it provides stations of every type, plain tiles, and fewer Lees than stations.

### 3.4 Visual requirements

- The grid is **visible in setup mode**, with each station type shown by a distinct **icon** (cannon, oar, sail, spyglass).
- During the fight, tile outlines can fade, but **station icons and part boundaries must remain readable**.
- **Empty stations are visibly empty** (dimmed, with an empty progress ring) so unmanned cannons and oars are obvious.
- Water drawn per part (Phase 1) must still read clearly with Lees on top of it.

---

## 4. Basic Lees

### 4.1 One kind of Lee, for now

- **Every Lee is a Basic Lee.** Same stats, same look, no special ability.
- Name: **Basic Lee**. Placeholder flavor line: *"He basically knew what he was doing."*
- The Lee **data model must allow variety later** (§14): different core stats now, unique abilities and flavor later. In this phase all values are identical, and the Lee's name, flavor text, art, and stats are **content**, not code.
- Each Lee is still an **individual**: its own HP, its own position, its own current task, its own statistics.

### 4.2 Core stats

Every Lee has these stats. For Basic Lee they all sit at a baseline of 1.0. Each must be **editable per Lee in the tuning panel**.

| Stat | What it affects |
|---|---|
| **Load speed** | How fast a cannon loads |
| **Accuracy** | How tight the shell spread is (higher = tighter) |
| **Repair rate** | HP restored per second |
| **Bail rate** | Water removed per second |
| **Row strength** | Contribution when working oars |
| **Sail handling** | Contribution when working sails |
| **Spotting** | Contribution when working the lookout |
| **Walk speed** | Movement across the grid |
| **HP** | How much impact damage a Lee survives |

### 4.3 Flooding affects crew

- A Lee in a part with water above a threshold **works and walks more slowly**. **(tunable)**
- Wet Lees should look it (wading feet, a blue tint at the base of the sprite, or similar).
- This ties flooding to crew, and gives the AI and the player a reason to care *where* water collects.

### 4.4 Lee health and loss

- When a shell lands, **Lees on the struck tile(s) take impact damage**, and Lees on neighboring tiles take reduced splash damage. The shell still damages the part as before. **(tunable: radius, damage fractions)**
- A Lee at 0 HP is **lost**: a short fall-overboard animation with a splash, and the tile is vacated.
- **A lost Lee is not replaced during the fight.** Its station may be taken by another Lee (§5), and its home role is gone.
- **No persistence in this phase.** Everyone returns at full HP at the start of each fight. (Permanent loss belongs to the metagame.)

### 4.5 Art

- Lees are **simple flat images** (the long-term look is minimal stick-figure style). Placeholder art is fine.
- **A progress bar fills over a Lee's head while it works**, and the Lee **wiggles slightly** while it fills. **The same animation serves every task.** A small **task icon** (gun, oar, sail, spyglass, wrench, bucket, walking, idle) says *what* it's doing.

---

## 5. Crew Behavior (The Heart of This Phase)

### 5.1 Home role comes from placement

- **A Lee's home tile is where the player placed it.** The role of that tile is the Lee's **preferred role**:
  - On a cannon station → gunner
  - On an oar, sail, or lookout station → rower, sail hand, or lookout
  - On a plain tile → damage control
- Home role is a **preference, not a lock.** It decides what a Lee does when nothing more urgent needs doing, and where it returns when the emergency passes.

### 5.2 Tasks

Every task a Lee can do is a **task with a target**:

- **Man a station** (cannon, oars, sails, lookout)
- **Repair a part**
- **Bail water from a part**
- **Idle** at home

### 5.3 Need drives reallocation

At all times, every task has a level of **need**. The crew AI continuously asks each Lee: *given what's happening right now, is the best use of me still what I'm doing?*

**Default urgency ladder (highest first), (tunable):**

1. **Flooding emergency:** a part with very high water, or total water close to the sinking threshold → bail
2. **Function-gating damage:** a damaged part whose function is lost or degraded (offline cannon, damaged engine) → repair
3. **Cannons that can engage now:** an unmanned cannon whose arc and range currently cover the enemy → man it
4. **Other damage and water:** damaged parts (lowest HP fraction first), moderate water → repair or bail
5. **Mobility:** an empty oar or sail station → man it
6. **Lookout:** an empty lookout post → man it
7. **Cannons that can't engage now:** cannons with the enemy outside their arc or range → no urgency; don't man them

The ladder is a starting point. The requirement is **that need is explicit, ordered, and tunable.**

### 5.4 How a Lee chooses

These rules govern *how* the AI picks, so behavior reads as sensible and not jittery:

1. **Preference is sticky.** A Lee leaves its current task only when (a) that task has no remaining need, or (b) a different task is **more urgent by a margin (tunable)**. A Lee doing something useful isn't pulled away for a marginal gain.
2. **Distance matters.** Walking time counts against a task. A far-away task is less attractive, and a task the Lee couldn't reach in time to matter (e.g., a cannon whose arc will close before arrival) is ignored.
3. **Claims prevent pile-ons.** Each station and each specific repair/bail target is **claimed by one Lee** (a Lee walking to a task holds its claim). A Lee considers only unclaimed tasks, unless nothing else is available, in which case extra Lees may help on the highest-priority job.
4. **Commitment time.** After switching, a Lee holds its new task for a **minimum time (tunable)**, so it doesn't oscillate while the situation flickers.
5. **Short lookahead for arcs.** Whether a cannon "can engage" accounts for where the enemy is about to be, not just where it is this instant. A short lookahead **(tunable)** keeps gunners from flipping sides every time the enemy crosses an arc boundary.
6. **Return home.** When a Lee's temporary task ends and nothing more urgent exists, it **returns to its home tile** and resumes its preferred role. Home gets a preference bonus when evaluating tasks.
7. **Deterministic tie-breaking.** When two options score equally, pick by a fixed, documented order (for example urgency, then distance, then a stable Lee ID). **There is no randomness anywhere in crew decisions.**

### 5.5 Required behaviors (examples that must work)

These are the behaviors the designer has asked for. The AI must produce them without special-casing:

1. **Cannon destroyed or offline.** The gunner abandons it and runs to another cannon that can engage and isn't manned. If none exists, it becomes damage control until one does.
2. **Enemy on the other side.** A gunner on the starboard cannons, with the enemy to port, runs to a port cannon that's open. As the player circles an enemy, **crews migrate across the deck** to follow the active broadside. Reversing the circle direction swaps which side is busy.
3. **Part hit nearby.** A Lee standing in a healthy part, next to a part that was just hit, runs over and repairs it.
4. **Flooding.** A Lee at a quiet post goes to bail when water becomes dangerous, and returns afterward.
5. **Short-staffed.** With fewer Lees than urgent jobs, the higher-urgency jobs get filled first, and low-urgency stations (lookout, a cannon with no target) stay empty.
6. **Recovery.** When the emergency is over, Lees drift back to their home roles.

### 5.6 Movement

- Lees walk **tile to tile (orthogonally)** at their walk speed, slowed by water.
- **Distance is a real cost.** Placing your Lees near where they're likely to be needed saves time. A Lee who walks across the boat for every job wastes time.
- A Lee in transit contributes nothing.

### 5.7 Readability requirements (hard requirement)

Reallocation only works as a spectacle if the player can follow it:

- **Every Lee always shows a task icon and a progress bar**, so the player can tell what each is doing.
- **When a Lee is away from home, its home tile shows a faint marker** (a ghost outline). The player can see "this one normally works there."
- **Claimed stations show who's headed there**, such as a thin line or a highlighted destination, so two Lees don't appear to be fighting over one spot.
- A player glancing at the strip should be able to answer **within a second or two**: *Who is firing? Who is fixing what? Which station is empty and why?*

### 5.8 Same AI for both boats

**The enemy crew uses the same task system, urgency ladder, and rules.** There is one crew AI. It runs against two boats. (See §9.)

---

## 6. Station & Task Details

### 6.1 Gunners

- A gunner at a cannon station **loads** it over time, shown by the Lee's overhead progress bar.
- When loaded and an enemy part is in the cannon's arc and range, it **fires**. The cannon always targets the **nearest part of the nearest enemy** (Phase 1 behavior). **There are no target settings in this phase.**
- All Phase 1 shell rules still apply: leading the target, a fixed landing point, resolving on arrival, and a red X telegraph for **enemy** shells only.
- Load time comes from load speed. Spread comes from accuracy and from the lookout's spotting bonus.

### 6.2 Repair

- A repairing Lee restores HP to a damaged part at its repair rate.
- Repaired HP lowers the part's cracks and its leak rate. It can bring an offline cannon back online once HP climbs over the offline threshold.
- Repairs have a **ceiling**: a patched part can only be restored to a fraction of its max HP **(tunable, ~60%)**.
- **A wrecked part (0 HP) can't be repaired during the fight.** This makes "stop it reaching zero" the reason to repair. **(tunable; see §15)**
- A part whose function is gone (cannon offline) is repaired first, per the urgency ladder.

### 6.3 Bail

- A bailing Lee removes water from a part at its bail rate.
- Target selection follows the urgency ladder, with ties broken by distance.

### 6.4 Mobility and lookout

- **Oars:** each manned oar station adds to the boat's speed, based on the Lee's row strength.
- **Sails:** a manned sail station adds to the boat's turn rate, based on the Lee's sail handling.
- **Lookout:** a manned post adds an accuracy bonus to every gunner, based on the Lee's spotting. **(tunable, cuttable)**
- When a station is unmanned, its effect falls back to the reduced baseline (§3.2).
- The path preview from Phase 1 must stay **accurate**. It should reflect the boat's *current* speed and turn rate, including crew effects.

---

## 7. Setup Mode (Before the Fight)

The frozen pre-START state from Phase 1 becomes **Setup Mode**.

### 7.1 Layout

- The **bottom panel grows** (around half the screen) so the grid is comfortable to touch, with a **tray of unplaced Lees** nearby. The ocean panel shrinks above it and still shows the frozen scene.
- **Tiles must be comfortable touch targets** (aim for ~44pt or larger). If that isn't achievable at the proposed size, make the panel larger. Don't shrink the tiles.
- Touching the ocean panel still shows the Phase 1 **steering path preview**.
- On **START**, the bottom panel animates back to its Phase 1 strip size and goes **view-only**.

### 7.2 Placing Lees

- **Tap a Lee in the tray, then tap a tile** to place it. **Drag-and-drop** works as an alternative. Both must be supported.
- Tap a placed Lee to **select** it, then tap another tile to **move** it, or tap another Lee to **swap**. A button or drag-off returns it to the tray.
- When a Lee is selected, the grid **highlights valid tiles** and shows **what each tile means for that Lee**: *"Gunner: port cannon 2," "Rower," "Damage control."* The player should never have to guess what a placement does.

### 7.3 Info card

Tapping a Lee shows an **info card**:

- Name and **flavor line**
- Core stats, in a **readable form** (bars or tiers, not raw multipliers)
- **Preferred role** from its current tile
- A note that it will **move to where it's needed** during the fight (a short one-time explanation, so the dynamic behavior isn't a surprise)
- A "Special" slot, **empty for Basic Lee** (reserved for future abilities)

### 7.4 Convenience

- **Clear all** and **Auto-arrange** buttons. Auto-arrange can be a simple reasonable layout.
- The **arrangement persists** between fights.
- **START is always enabled**, even with no crew. If no gunner is on any cannon station, show a brief non-blocking warning.

---

## 8. The Fight (What's New to See)

Phase 1's fight flow is unchanged. What the player now sees:

- **Lees are visible in the close-up strip**, at readable size, moving, working, getting hurt, and sometimes going overboard.
- **Lees walk visibly** between tiles when changing tasks.
- A Lee **flashes** when hurt.
- **Unmanned stations** are visibly dim.
- **In the ocean view**, the player's Lees may appear as tiny pips or not at all. The strip is where the crew is read.
- **Steering is unchanged.** The player steers; the crew works. **There is no crew command interface in this phase.** Everything the player decides about the crew happens in Setup Mode.
- The boat's **speed and turning visibly change** as rowers and sail hands come and go. A boat that has lost its rowers should feel it.

---

## 9. Enemy Crew

**The enemy boat is a full boat with a full crew, on the same rules as the player.**

- The enemy has its own **deck grid, stations, and Basic Lees**, defined as **data** (layout, crew count, stats). The player doesn't set it up.
- Enemy Lees use **exactly the same crew AI** (§5): home roles, urgency, reallocation. The same code runs against both boats.
- Enemy Lees **take impact damage and can be lost**, just like the player's (§4.4). Killing gunners silences cannons, and the AI will respond by shifting survivors.
- Enemy Lees **repair and bail** as the player's do. (Passive bilge from Phase 1 remains as a boat trait.)
- **The enemy should have fewer or weaker crew than the player**, so the test fight still favors the player. Use a **player-advantage setting** that scales the player's crew size or stats. **(tunable)**
- **Enemy crew must be visible in some form** in the ocean view (small figures or pips on its deck), since their losses and movements are part of the fight. A **debug view** must show enemy Lees' tasks in full. A player-facing close-up of the enemy deck is **out of scope** (it would conflict with touch-to-seek).
- A boat with **no living crew** isn't a loss condition. It's a boat that can't fire, row, or bail. Only flooding sinks a boat, as in Phase 1.

---

## 10. End of Fight

### 10.1 Win/lose

Unchanged: the enemy sinking wins, your boat sinking loses.

### 10.2 Result screen additions

In addition to Phase 1's stats:

- **Lees lost** (both sides)
- **Per-Lee breakdown** (the player's Lees):
  - Gunners: shells fired, shells hit, damage dealt
  - Repair: HP restored
  - Bail: water removed
  - **Time by task:** gunning, rowing, sailing, lookout, repairing, bailing, walking, idle
  - **Time away from home** and **number of task switches**
  - Survived or lost
- **Time away from home, task switches, and idle time are the key diagnostics.** They show whether the crew AI is thrashing, whether placement mattered, and whether some Lees were wasted.

### 10.3 Buttons

- **Again:** instant restart with the **same arrangement**.
- **Rearrange:** returns to Setup Mode with the arrangement preserved.
- **Tune:** opens the tuning panel over the result screen.

---

## 11. Tuning & Debug (Additions)

Phase 1's single-source tuning principle applies. New tunables include:

- **Per-Lee core stats**, editable live (§4.2)
- **Crew size** for each side, and enemy crew layout
- **The urgency ladder**, tier order and weights
- **Stickiness margin, commitment time, arc lookahead, home-return bonus, walk-time penalty**
- **Mobility baselines** (reduced fraction with empty oars/sails) and per-station contribution
- **Lookout bonus**
- **Repair ceiling**, whether wrecked parts are repairable, and offline thresholds
- **Impact radius and damage fractions** for crew hits
- **Flooding's effect on crew** (threshold, slowdown)
- **Player-advantage** (crew size and stats)

**Debug overlay additions (important):**

- For each Lee: **current task, target, and a one-line reason** (for example *"abandoned cannon 2: offline → heading to cannon 4: enemy in arc, unmanned"*)
- The **need score of each task**, so tuning the ladder is visible
- Station claims, walking paths, and home tiles
- The same views for enemy Lees

**"Why did that Lee go there?" must always be answerable.** Being able to answer it is what makes the crew AI tunable.

---

## 12. Success Criteria

The phase is successful if a player can, in 5–10 fights:

1. Place a crew without an explanation, using the highlights and info cards.
2. **Explain why they placed Lees where they did.**
3. **Try different arrangements** between fights because they believe it will change the outcome.
4. Watch the crew shift during a fight and **understand why**, with no "why is he running over there?" moments.
5. Say, after a loss, **what went wrong in terms of the crew** ("my rowers died," "nobody was bailing," "everyone ran to the left"), not just "I got unlucky."
6. Want to hit "Again," or "Rearrange."

### Playtest questions

- **Does home placement matter?** If outcomes are the same regardless of where Lees start, the design has failed. Compare arrangements.
- Does the reallocation read as **intelligent** or **chaotic**? Is anyone thrashing back and forth?
- Is the ghost home marker and task iconography enough to follow what's happening?
- Do short-staffed situations produce tension or frustration?
- Is the setup screen understandable on a phone, with comfortable touch targets?
- Do wet Lees feel like consequence or punishment?
- Does the enemy crew make the enemy feel alive?
- Do oars and sails feel like they matter, or like bookkeeping?
- Is the lookout worth having?

---

## 13. Explicitly Out of Scope

Do **not** build these now, but don't make decisions that block them:

- **Different Lee types and unique abilities.** All Lees are Basic Lee. Stats are data and ready to vary.
- **Target selection** of any kind (per-Lee, per-cannon, fleet-wide, or touch). Cannons target the nearest part of the nearest enemy.
- **A crew command interface during the fight.**
- **Hiring, shops, ports, currency, the map.** The crew is fixed.
- **Lee persistence, leveling, and perks.**
- **Fire, smoke, and other tile layers.**
- **Boarding and close combat.**
- **Ness and any non-ship enemy.**
- **Multiple enemies.**
- **Cannon variety.** One cannon type.
- **A player-facing view of the enemy deck.**
- **A helm station** or any station beyond cannon, oars, sails, and lookout.
- **The Lee Creator tool.**
- **Different boat grids.** One player boat and one enemy boat, each with one grid.
- **Landscape layout and in-fight pause.**

---

## 14. Design-for-Later Constraints

These are requirements on behavior and structure, not implementation prescriptions:

1. **Lees are data.** Stats, name, flavor text, art, and special abilities are content, authored without code changes. A Lee Creator tool will later produce them.
2. **Lee variety plugs into the existing system.** New Lee types will differ in **core stats** first, then gain **unique abilities**, and may have **role affinities** (a Lee that is good at something should be attracted to it). The AI should weigh stats and affinities when choosing tasks, so a new type needs data, not new AI code.
3. **Abilities are expressed generically** (for example "affect orthogonal neighbors," or "trigger on an event"), so new abilities are additions, not rewrites.
4. **Tasks and stations are extensible.** A helm, a fire brigade, or a boarding party should be additions to the task system and the urgency ladder, not special cases.
5. **Tiles are units that hold stacked layers.** Fire, smoke, and other conditions will later sit on tiles alongside the deck and the Lee standing there.
6. **Grids are boat data.** Different boats will have different sizes, shapes, and station counts.
7. **Walking on a deck is general.** Close combat will later send Lees across to another boat's grid, so movement shouldn't assume a Lee can only be on its own boat.
8. **One crew AI, any boat.** The same AI drives the player's and the enemy's crews, and later Ness crews and other ships.
9. **Per-Lee statistics are tracked.** They'll feed future progression and tuning tools.
10. **All Phase 1 constraints still apply:** two views of one world, shared steering, an accurate path preview, a general telegraph system, data-driven and layered parts, centralized tunables.

---

## 15. Open Questions

1. **Does placement matter enough?** If the crew AI is too good at moving Lees to need, home roles stop mattering. If stickiness is too strong, Lees ignore emergencies. This is the main tuning risk.
2. **Wrecked parts:** is "can't be repaired in a fight" the right default?
3. **Home bonus vs. emergency:** how strongly should a Lee prefer its post over an emergency it's well placed to fix?
4. **Lookout:** is accuracy the right effect, or should it do something else, such as extend the enemy's red X warning time? Or should it be cut for this phase?
5. **Mobility fraction:** is ~60% the right baseline for unmanned oars and sails? Is it fun to feel the boat slow when rowers die?
6. **Crew size:** six Lees on eight stations and 15 tiles is a guess. Too many, too few, or about right?
7. **Impact damage on Lees:** direct-hit only, or splash to neighbors? Splash makes clusters risky.
8. **Setup panel size:** how large does the bottom panel need to be for comfortable placement on the smallest supported phone?
9. **Enemy deck visibility:** how do we show enemy crew in the ocean view at that scale without clutter?

---

*End of Phase 2 PRD. As in Phase 1: tuning feel is the product. When in doubt, make it adjustable and let the playtest decide.*
