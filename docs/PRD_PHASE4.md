# Lee — Phase 4 PRD: Build & Roster

> **Status:** Phases 1–3 are built: ranged combat, crew and stations, close combat and boarding, multiple enemy boat types, and a gatling gun that hurts sailors more than ships. Every fight so far starts with a fixed boat and a fixed crew of Basic Lees.
>
> **This document describes the *product* to build on top of Phase 3, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**.
>
> **Baseline:** Everything in the Phase 1–3 PRDs still holds unless this document says otherwise. This PRD describes only what changes or gets added.
>
> **Platform:** Mobile web, portrait-first (unchanged).

---

## 1. Context

Until now, the game has been a **test bench for a single fight.** Phase 4 turns it into the start of a **run**: you pick a ship, draft a crew, fight a series of battles, and carry your choices from one fight to the next.

This phase introduces:

- **Choosing a ship**, each with different stats and **typed slots**
- **Drafting a crew** from five distinct **Lee types**
- **Equipment**: guns, deck stations, rail items, hull modules, floor upgrades, and more, swapped between fights
- **Trinkets** (worn by Lees) and **Treasures** (held by the ship)
- **Leveling**: crew gain small stat bonuses over a run
- **Permadeath**: a Lee killed in a fight is gone for the rest of the run
- **A minimal, very temporary run loop** so all of the above has somewhere to live
- **A versioned save, and a way to reset it**

The full run structure (sea map, ports, shops, the Punishers, endless mode) is **not** in this phase. This phase builds the pieces that structure will plug into.

### The question this phase answers

> **Do ship, crew, and equipment choices change how the game is played, and do they feel like choosing a style instead of picking the better number?**

### Core design principles

**1. It's about style, not strength.** The goal isn't better versus worse. It's choosing a play style and being rewarded for doing what you chose.
- A range-and-speed build should be able to skirt around and blast enemies.
- A fast, cheap boat with a huge crew should be able to board and overwhelm.
- A heavy gun platform should out-shoot what it can't be boarded by.
- **Every part and ship should have an upside and a cost** (or be situational).

**2. The player and the enemy use the same stuff.** Ships, guns, parts, Lee types, levels, and trinkets are one shared pool. An enemy is a ship with a loadout and a crew, built from the same content the player can use. Enemies scale up through **bigger, higher-leveled crews and better loadouts**, not through hidden stat multipliers. (See §9.) The long-term balance goal is that **the player can ramp up their power just a bit faster than the enemy, and both ramp up in similar ways.**

**3. Don't overthink balance.** The content in this document is test material. It's meant to be wrong in useful ways and tuned from playtesting. What matters is that the *systems* are right and the data is easy to change.

### Hypotheses to test

1. Different ships make the player want to play differently from the first fight.
2. **Typed slots create real build decisions.** Where a gun can go, and which way it faces, matters.
3. Different gun arcs make guns feel different, not just stronger or weaker.
4. The five Lee types change how a crew should be arranged and what it's good at.
5. Equipment swaps produce visibly different fights, not just different numbers.
6. **Permadeath makes Lees matter.** Players notice and care when one dies.
7. Leveling creates attachment to individual Lees, but not so much that losing one feels like losing the run.
8. The draft-and-refit loop is fun on a phone, and doesn't feel like administration.

---

## 2. What Changes (Summary)

| Area | Before | Phase 4 |
|---|---|---|
| Starting a game | Land in a frozen fight | **Menu → choose a ship → draft crew → pick a starting part → fight** |
| Ships | One | **Four**, with different grids, typed slots, and stats |
| Lees | All Basic Lee | **Five drafted types** (melee, ranged, maneuvering, repair, support) plus Basic Lee |
| Gun arcs | Come from the boat's side | **Come from the gun**, aimed by the slot it's mounted in |
| Cannons and stations | Fixed positions | **Typed slots that hold equipment**, swapped between fights |
| Equipment | None | **Guns, stations, rail items, hull modules, floor upgrades, gun attachments** |
| Bonuses | Boat stats only | **Treasures** (ship-wide) and **Trinkets** (per Lee) |
| Tags | None | **Data only.** Every item and Lee type carries tags, with no bonuses yet |
| Crew over time | Reset every fight | **Level up, gain bonuses, and die permanently** |
| Enemies | A few special boat types | **Ships, loadouts, and crews from the same content as the player** |
| Between fights | Setup mode | **Results, level-ups, a reward pick, a refit screen** |
| Saving | None | **A versioned save**, plus a ⚙️ menu with restart and reset |
| Old test bench | The whole game | Becomes **Sandbox mode** |

---

## 3. The Run

### 3.1 Flow

```
MENU
  ├─ New Run ──► Choose Ship ──► Draft Crew ──► Pick Starting Part ──► REFIT
  ├─ Continue (if a run is saved)
  └─ Sandbox (everything unlocked, tuning tools)

REFIT ──► FIGHT ──► RESULTS ──► LEVEL-UPS ──► REWARD PICK ──► REFIT ──► next FIGHT ...
                                                                        │
                                          Boat sinks or crew wiped ──► RUN OVER
```

### 3.2 Menu and the ⚙️ button

- A minimal main menu: **New Run**, **Continue** (only when a saved run exists), and **Sandbox**.
- **A ⚙️ button is visible in a corner of every screen**, including during fights. It opens a **system menu** with:
  - **Resume**
  - **Restart Run** (abandons the current run and returns to Choose Ship)
  - **Reset All Saved Data** (wipes everything stored locally)
  - The **save version and build version** shown in small text (useful for bug reports)
- **Both destructive actions require a confirmation.**
- **Opening the menu during a fight pauses the game.** This is a system menu, not a gameplay pause feature, and nothing else about fights changes. Closing the menu resumes.

### 3.3 The temporary encounter list (very temporary)

For this phase, fights come from a **short, hand-authored list of encounters**, standing in for the future sea map and endless mode. **It will be thrown away.** Nothing built in this phase may assume the list is final or that a run has an ending.

- Encounters are **data** (see §9 for the shape).
- A starting list of **5 encounters** that escalate gently **(tunable)**, mixing the three archetypes from Phase 3 (boarder, standard, heavy).
- **After the last entry, the run continues indefinitely.** The game repeats the last encounter, adding crew levels (and, past a limit, extra crew) each time. **(tunable)** This is a deliberately crude stand-in for endless mode, and it's enough to test whether the player's power ramps faster than the enemy's.
- **There's no victory screen.** A run ends only when the player loses (§3.5).
- Show a **fight counter** during the run.

### 3.4 Between fights

- The **boat is fully repaired and drained**, and tiles are restored, by default. **(tunable)**
- **Surviving Lees heal to full** by default. **(tunable)** Attrition in this phase comes from Lees dying. A fuller healing economy (an ale bar, healers) belongs to the ports phase.
- XP is awarded and level-ups are resolved (§7).
- The player picks a **reward** (§5.14, §6.5).
- The player can **refit**: swap equipment, rearrange the crew, release Lees (§8.3).

### 3.5 Run end

- **The run ends** when **the player's boat sinks** or **every Lee is dead.**
- **Run Over** shows a summary: fights survived, the ship and its final loadout, the surviving crew, and **a memorial of Lees lost** (type, level, and the fight they fell in).
- Buttons: **New Run** and **Menu**.

### 3.6 Save, versioning, and reset (hard requirements)

- **The run persists locally.** If the player closes the tab or the page reloads, **Continue** resumes the run.
- The save point is **the start of the next fight** (the refit screen). A fight in progress isn't saved. Reloading mid-fight returns the player to the refit screen before that fight.
- **Run state must be serializable and complete:** ship, equipment, cargo, crew (types, levels, stats, bonuses, trinkets, positions), treasures, and encounter progress.
- **Save data is versioned.** Every save carries a **save version number**. Any later change that breaks compatibility **must increment that number.**
- **When the saved version doesn't match the current one** and there's no way to migrate it, the game must **not crash or load corrupt data.** It shows a plain message ("This saved run is from an older version and can't be continued") and offers to **reset**, with an option to cancel.
- **Where a migration is cheap, it's allowed**, but it's never required. A reset is always an acceptable answer.
- The ⚙️ menu's **Reset All Saved Data** (§3.2) must work from any screen, including when the save is invalid.

---

## 4. Ships

The player chooses one ship at the start of a run. Ships are **data**: grid layout, slots, base stats, crew limits, default loadout, and a style blurb.

### 4.1 What a ship defines

- **Deck grid** (size and shape, per Phase 2)
- **Slots** of several typed kinds (see §5.1), placed at defined positions. **Edge slots carry a facing** (which edge of the boat they're on)
- **Treasure capacity**: how many Treasures the ship can hold
- **Base stats:** speed, turn rate, hull HP per part, leak resistance, and so on, as multipliers on the Phase 1 baseline
- **Crew limits:** **minimum crew** (how many Lees you draft at the start) and **maximum crew** (how many you can ever carry)
- **Default loadout:** the equipment it starts with
- **Style blurb:** a one-line description of the intended play style
- **Tags** (see §5.10)

**Ships don't define gun arcs or AI behavior.** Arcs come from guns (§5.4), and AI behavior comes from the encounter (§9), since the player and enemies can both use any ship.

### 4.2 The test ships

**Names are placeholders.** A pun pass comes later. Values are starting guesses. **(tunable)**

| Ship | Style | Grid | Crew (min / max) | Stats vs. baseline | Treasures |
|---|---|---|---|---|---|
| **Sloop** | All-rounder. The ship from the earlier phases | 5 × 3 | 4 / 8 | Baseline | 2 |
| **Skiff** | **Skirmisher.** Small, fast, built to outrange | 4 × 3 | 3 / 5 | Speed ×1.35, Turn ×1.3, Hull HP ×0.7, Leak ×1.2 | 1 |
| **Longship** | **Boarder.** Long, narrow, fast, a big open deck, few guns | 7 × 2 | 6 / 12 | Speed ×1.2, Turn ×0.9, Hull HP ×0.8 | 2 |
| **Galleon** | **Gunnery.** Slow, tough, covered in guns | 6 × 4 | 5 / 10 | Speed ×0.65, Turn ×0.6, Hull HP ×1.6 | 3 |

**Slots per ship (counts, not exact positions). (tunable)**

| Ship | Edge slots (by facing) | Interior slots | Rail slots | Hull slots | Default loadout |
|---|---|---|---|---|---|
| **Sloop** | Port 3, Starboard 3, Bow 1, Stern 1 | 3 | 3 | 2 | 4 Cannons (2 per side), 2 Oars, Sail, Lookout. The bow, stern, and one interior slot start empty |
| **Skiff** | Port 2, Starboard 2, Bow 1, Stern 2 | 2 | 2 | 2 | 2 Long Guns (1 per side), 2 Oars, Sail. The bow and stern slots start empty, so rear-facing "chasers" are an option |
| **Longship** | Port 6, Starboard 6, Bow 1, Stern 1 | 0 | 4 | 2 | 1 Gatling (bow, forward-facing), 2 Oars, Boarding Hooks, Spikes (bow). Few ways to hit hard, so the crew does the work |
| **Galleon** | Port 4, Starboard 4, Bow 2, Stern 2 | 4 | 3 | 3 | 4 Cannons, 2 Carronades, 2 Oars, Sail, Powder Store. Plenty of room left over |

- **Every tile also has a floor slot** (§5.1).
- Exact slot positions are up to the designer and engineer. The requirements are that **each ship's grid supports its counts**, that **edge slots have a clear facing**, and that **slots are visibly typed** (§5.12).
- The intent behind each ship:
  - **Skiff:** stay out of reach, win by range and speed (including shooting backward while retreating). Weak if caught.
  - **Longship:** close the gap fast, soften the enemy crew with the gatling, then flood the deck with Lees. Weak at range.
  - **Galleon:** win by firepower. Hard to catch and hard to sink, but slow to react.
  - **Sloop:** do a bit of everything. It's the on-ramp.

### 4.3 Crew limits

- **Minimum crew** applies **only at the start of a run.** If Lees die later and the crew falls below the minimum, the boat still sails, short-handed.
- **Maximum crew** is a hard cap. Recruiting past it requires releasing someone first.
- **Crew can't exceed the number of deck tiles**, so each ship's maximum must fit its grid.

---

## 5. Slots & Equipment

Equipment fills ship slots. **Changing equipment is free between fights** and takes effect at the next fight. Equipment is **data**: the engineer should be able to add a part without code changes.

### 5.1 Slot types

Slots are **typed**, and **each part declares which slot types it fits.** The starting set of slot types is below. **More types will be added later, so adding one must be easy.**

| Slot | Where | Holds | Notes |
|---|---|---|---|
| **Floor** | Every tile | Floor upgrades | Sits **under** whatever else is on the tile |
| **Edge fixture** | A tile on the edge of the boat. **Has a facing:** port, starboard, bow, or stern | Guns that need an edge, and edge stations (oars, hooks) | The facing of the slot sets which way a gun mounted there points |
| **Interior fixture** | A tile that isn't on the edge | Interior stations (sail, lookout, powder store), and turret-style guns | |
| **Rail** | The outer lip of an edge tile | Spikes, fences, boarding planks | Can **coexist** with an edge fixture on the same tile |
| **Hull** | A part of the boat (bow, midship, and so on) | Plating, keel, rudder, and similar modules | |
| **Gun attachment** | Attached to a specific gun | Gun shields and similar | One per gun **(tunable)** |

Plus two that sit outside the grid:

- **Treasure capacity** (ship-wide), holding **Treasures** (§5.8)
- **Trinket slots** (per Lee), holding **Trinkets** (§5.8)

**Some parts fit more than one slot type** (for example a bilge pump that can go on an edge or an interior tile). The part declares what it fits.

### 5.2 Stacking

**Layers on a tile stack independently.** A tile can have a floor upgrade **under** a fixture, with a rail item on its edge, with a Lee standing on it, with a gun attachment on the gun. A reinforced floor tile can sit under a powder store, for example.

- Each layer has its own effect and its own occupant.
- Layers **don't need to know about each other** by default. Interactions between layers are rare and deliberate, as in the earlier tile-layer design.

### 5.3 What every part has

Every part defines at least:

- **Name, icon, one-line description**, and an optional **flavor line** (placeholder is fine)
- **Slot type(s)** it fits
- **Effects** (stat changes or behaviors)
- **A cost or tradeoff** (a downside, or a situational limitation), unless it's deliberately neutral
- **Tags** (§5.10)
- Optionally: its own **durability** and an **on-destroy effect** (see §5.9)

**No part should be strictly better than another part of the same slot type.**

### 5.4 Guns (and arcs)

**A gun's firing arc belongs to the gun, not the ship.** The slot sets **which direction the gun faces**, and the gun sets **how wide its arc is**, how far it reaches, and everything else. This lets guns differ by arc:

- **Weaker guns can fire in a wide arc or all the way around**, which makes them easy to use.
- **Stronger guns have a narrow arc**, which makes them harder to use.
- **A boat with edge slots at the front or back can mount forward- or rear-facing guns**, with the same gun that would face sideways on a side slot.

The Phase 1–3 firing rules still apply otherwise: shells have travel time, land at a fixed point, resolve on arrival, enemy shells show a red X, and the minimum range from Phase 3 applies.

Values are relative to the standard cannon **(all tunable)**.

| Gun | Fits | Arc | Damage to hull | Damage to crew | Reload | Shell speed | Range (min–max) | Spread | Notes | Tags |
|---|---|---|---|---|---|---|---|---|---|---|
| **Cannon** | Edge | 70° | ×1.0 | ×1.0 | ×1.0 | ×1.0 | ×1.0 | ×1.0 | The baseline | None |
| **Long Gun** | Edge | **35°** (very narrow) | ×0.8 | ×0.8 | ×1.5 slower | ×1.6 | ×1.5 (min ×1.5) | ×0.7 tighter | Reaches far, but you have to point the whole boat | Skirmish |
| **Carronade** | Edge | 85° | ×1.8 | ×1.2 | ×1.3 slower | ×0.8 | ×0.6 (min ×0.4) | ×1.3 | Hits hard up close and lets you stay near | Board |
| **Swivel Gun** | Edge or interior | **360°** | ×0.3 | ×0.6 | ×0.5 (fast) | ×1.4 | ×0.8 (min ×0.4) | ×1.5 | Weak, but it can always shoot something | Skirmish |
| **Mortar** | Interior | 180° | ×1.5 | ×1.0 | ×2.0 slower | ×0.5 (a slow, high lob) | ×1.2 (min ×2.0) | ×1.0 | **Large splash radius (×2).** The shell is slow and obvious, so it can be dodged. It can't hit close targets | Barrage |
| **Gatling** | Edge | 90° | ×0.2 | ×2.0 | ×0.17 (about 6× the fire rate) | ×3.0 | ×0.7 (min ×0.3) | ×2.0 | Barely scratches hulls but shreds crew | Board |
| **Scrap Cannon** | Edge | 60° | ×0.12 per pellet | ×0.5 per pellet | ×1.4 slower | ×2.0 | ×1.3 (min ×0.25) | See below | A **big shotgun** (below) | Board |

**Scrap Cannon**

- Fires **a burst of several small, fast pellets** (around eight, **tunable**) in a single shot, meant to **take out crew.**
- **Spread grows with distance.** It can fire from far away, but is **very inaccurate** there, and most pellets miss. **Up close the pellets bunch together and it becomes devastating to crew**, since many pellets hit the same tile and the same Lees.
- It does little damage to hulls per pellet.
- **Telegraph:** a burst of pellets doesn't need a red X per pellet. A **single shaded area marker** showing where the burst will land is enough. (The same approach as the gatling. **Engineer's call.**)

### 5.5 Station modules

Each module creates a **station** that a Lee mans (Phase 2 rules apply: home role, reallocation, urgency). Effects apply while manned.

| Module | Fits | Station effect (while manned) | Tradeoff | Tags |
|---|---|---|---|---|
| **Oars** | Edge | Raises the boat's speed (stacks) | Needs crew while attached or in combat | Skirmish |
| **Sail** | Interior | Raises turn rate | Same as above | Skirmish |
| **Lookout** | Interior | Improves all gunners' accuracy | A Lee here is a tall target, hit by pistols from farther away | Barrage |
| **Bilge Pump** | Edge or interior | Greatly increases water removal | Does nothing if the boat isn't flooding | Bulwark |
| **Boarding Hooks** | Edge | Shortens grapple time and swing time | Does nothing at range | Board |
| **Powder Store** | Interior | Speeds the reload of all cannons | **Volatile:** if its tile is destroyed, it **explodes** (§5.9) | Barrage |

The existing Phase 2 oars, sail, and lookout become modules here, so the Sloop plays like it did before.

### 5.6 Rail items (boarding and ramming)

Rail items sit on the **outer lip of an edge tile** and affect what happens at that edge during close combat (Phase 3). **A rail item covers the edge segment of its own tile.**

**Spikes**

- Sit on an edge. A natural place is the **bow**, for ramming.
- **Ramming:** a ram that makes contact on a spiked edge does **extra damage to the other boat's struck part.**
- **Being boarded:** while another boat is attached along a spiked edge, **the other boat's adjacent part takes slow ongoing damage**, and **opposing Lees who land on a spiked tile take damage on landing.** Friendly Lees aren't hurt.
- **Disengaging takes longer** for any attachment through a spiked edge (the recall window and separation are extended, **tunable**), for both boats. The spikes are stuck in.
- Tradeoff: no effect at range, and a slower escape from your own attachments.
- Tags: Board.

**Fence**

- A **barricade with its own HP.** While it's intact, **enemy Lees can't swing onto that tile's edge segment.**
- **Boarders land on the nearest unblocked tile.** If every tile along the attached side is fenced, they **stop at the fence and hack at it** (melee reaches across the gap for this purpose) **until it breaks, or until they give up** (stickiness and urgency rules from Phase 2 and 3 apply).
- **Pistols fire through a fence, in both directions.** Defenders can shoot boarders held up at the fence. It doesn't block cannon shells.
- **Friendly Lees swing out through it freely.**
- A destroyed fence is gone for the rest of the fight.
- Tradeoff: **each fence covers only one tile's segment**, so fully blocking a side takes several rail slots, and it does nothing to stop a ram.
- Tags: Bulwark.

**Boarding Planks**

- Swing speed +30% and pistol damage +15% for Lees leaving this edge. Tradeoff: slightly more exposed to enemy pistols while swinging **(tunable)**.
- Tags: Board.

### 5.7 Hull modules, gun attachments, and floor upgrades

**Hull modules** attach to a specific part of the boat.

| Hull module | Effect | Tradeoff | Tags |
|---|---|---|---|
| **Iron Plating** | Adds an armor layer to a part, absorbing damage before the part takes any (the layered-part design from Phase 1) | Heavy: lowers speed slightly | Bulwark |
| **Reinforced Keel** | Water leak rate ×0.6 on all parts | Slightly lower top speed | Bulwark |
| **Racing Rudder** | Turn rate +25% | Hull HP −10% on the engine part | Skirmish |
| **Streamlined Hull** | Speed +20% | Hull HP −10% on all parts | Skirmish |
| **Rangefinder** | All guns: range +20% and spread −10% | Raises minimum range by 20% | Skirmish |

**Gun attachments** attach to one gun.

| Attachment | Effect | Tradeoff | Tags |
|---|---|---|---|
| **Gun Shield** | The gunner takes 40% less impact damage. **Plating around the gun narrows its aim arc** (it blocks the gunner's view) | **Arc −30%**, and reload ×1.1 slower | Bulwark |
| **Wide Mount** | Arc +30% | Spread ×1.15 | Barrage |

**Floor upgrades** go **under** whatever else is on a tile.

| Floor upgrade | Effect | Tradeoff | Tags |
|---|---|---|---|
| **Reinforced Planks** | The tile's durability ×2, and a Lee standing there takes 25% less impact damage | Slightly lowers top speed per tile used | Bulwark |
| **Grippy Boards** | Lees cross this tile 25% faster | None, but it's only useful on busy routes | Skirmish |

### 5.8 Treasures and Trinkets

Both are **simple stat bonuses for now.** Names, lore, and stranger effects come later.

- **Treasures** belong to the **ship** and apply to the **whole ship.** A ship holds a limited number (§4.2). **There are no trinket slots on the ship.**
- **Trinkets** are **equipped by Lees.** **Each Lee has 2 trinket slots.** **(tunable, 2–3)** Trinkets change **that Lee's stats.**
- When a Lee **dies or is released, its trinkets return to cargo.** **(see §14)**
- Both can carry tags (§5.10).

**Test Treasures:**

| Treasure | Effect | Notes |
|---|---|---|
| **Iron E** | A flat bonus to hull HP | **A joke item.** Its icon is a shiny metal letter **F**, and its description contains **no explanation**, only the name |
| **Sextant** | Gun range +10% | Skirmish |
| **Ship's Cat** | All Lees walk 8% faster | None |
| **Brass Compass** | Turn rate +10% | Skirmish |

**Test Trinkets:**

| Trinket | Effect | Tradeoff |
|---|---|---|
| **Cutlass** | Melee damage +20% | None, but it's wasted on a gunner |
| **Wooden Leg** | HP +25% | Walk speed −10% |
| **Tool Belt** | Repair and bail rates +20% | None, but it's wasted off damage control |
| **Sea Legs** | Walk speed +15% | None |
| **Spyglass** | Spotting +30% | Melee −10% |
| **Rum Flask** | HP +15% | Accuracy −10% |

### 5.9 Tile durability and volatile parts

**Tiles are damageable.** This is a small step toward the "tile is a unit" design.

- **Every tile has a durability** **(tunable)**. When a shell lands, the **struck tile takes damage** (as well as the part and any Lees there, per Phase 2), and **neighboring tiles take reduced splash damage.**
- **A tile at zero durability is blown out.** Its **fixture is destroyed** (the gun or station on it stops working for the rest of the fight), and **a Lee standing there takes a heavy hit.** The tile **stays walkable.** Repair crew (Phase 2) repair **parts**, not tiles. Tiles are fully restored between fights.
- **Floor upgrades** (§5.7) raise a tile's durability.
- **Volatile parts** explode when destroyed. The **Powder Store** is the first one: **if its tile is destroyed, it explodes**, damaging the tiles, parts, and Lees around it (the same tile and its orthogonal neighbors **(tunable)**). This is **in addition to** the Lee on the tile being hurt. **Explosions can chain** if more volatile parts are nearby.
- Parts can optionally define their own **durability** and **on-destroy effect** as data, so more volatile (or otherwise reactive) parts can be added later without code changes.
- **This is the risk that makes the Powder Store interesting.** It speeds up every cannon, and it's a bomb.

### 5.10 Tags (data only)

- **Every part, Treasure, Trinket, ship, and Lee type can carry tags.** The starting set: **Skirmish**, **Board**, **Barrage**, **Bulwark**. **More will be added.**
- **Tags have no gameplay effect in this phase.** No synergy bonuses. They exist so later features can use them, for example:
  - tags influencing what appears in shops
  - each Lee carrying a tag giving a small global bonus
  - other tag-based rewards or restrictions
  Those features are **not designed or built here.**
- **Tags must be visible** on item and Lee cards (as small labels).
- **The game must be able to count tags** across a boat and its crew, and show the counts in the **debug overlay.** The tag system must be **data-driven** (adding a tag shouldn't need code).

### 5.11 Derived boat stats

- The refit screen shows a **stat card** for the boat: speed, turn rate, hull HP, flood resistance, effective gun range and arc coverage, estimated damage to hulls and to crew, crew count and capacity.
- **The card must be computed from the real game data**, not maintained separately, so it can't drift from actual behavior.
- When the player picks up or hovers over a part, the card shows **what would change** (a before/after for each affected stat).

### 5.12 Visual requirements

- **Equipped parts must be visible on the boat** in both views, even with placeholder art: different gun types have different barrels or icons, plating shows on its part, stations show their module icon, spikes and fences show on the edge.
- **Slots are visibly typed** on the refit screen (a distinct icon per slot type, with a facing arrow on edge slots). **Empty slots are obvious.**
- **A gun's arc is shown** as a wedge or fan **when the gun is selected or hovered on the refit screen**, so the player can see where it can fire from the slot it's in. Arcs are also available in the fight debug overlay.
- A gun's **projectiles look different by type** (a mortar lob, a gatling stream, a scrap burst), so the player can read what's shooting at them. Red X telegraphs still apply to enemy shells. **Streams and bursts may use an area marker instead of per-projectile Xs.** **(Engineer's call.)**

### 5.13 Changing equipment

- **Equip:** pick a part from cargo or from the boat, then pick a compatible slot.
- Only **compatible** slot types accept a part. Incompatible slots should be visibly dimmed when a part is selected.
- **If an equipment change removes a station** from a tile where a Lee is standing, that Lee's home role becomes damage control. The screen should **flag the affected Lee**, so it's not a silent change.
- **If a gun moves to a different facing**, the arc preview updates immediately.

### 5.14 Getting equipment

- **Starting loadout:** each ship's default (§4.2), plus **one starting part chosen from 3 offered** after the crew draft, so the player begins to steer their build immediately.
- **Rewards:** after most fights, the player picks **one of three reward cards**, which may be parts, Treasures, Trinkets, or a recruit (§6.5). Draws are weighted **(tunable)**.
- **Cargo:** items that aren't equipped go in the **cargo hold** and can be swapped in later. The hold is **unlimited** for now. **(tunable; see §14)**
- **Sandbox mode** unlocks every part with no rewards needed.

---

## 6. Lee Types & Crew

### 6.1 Types

Until now, every Lee was a Basic Lee. Phase 4 introduces **five types** with **very distinct roles**, to keep the proof of concept simple. **Names and values are placeholders**, and this isn't the final roster. **(All tunable.)**

| Type | Role | Stats vs. baseline | Trait | Tags |
|---|---|---|---|---|
| **Hard Lee** | **Melee** | HP ×1.8, Melee damage ×1.4, Melee rate ×1.2, Walk ×0.9, Load ×0.7, Accuracy ×0.7 | **Bodyguard:** adjacent Lees take 40% less impact and pistol damage. *"He hardly noticed the cannonball."* | Board |
| **Quick Lee** | **Ranged** | Load ×1.5, Pistol rate ×1.3, Accuracy ×0.7, HP ×0.8, Melee ×0.7 | None. *"He quickly loaded the cannon and forgot to aim."* | Barrage |
| **Deft Lee** | **Maneuvering** | Sail ×2.0, Row ×1.5, Walk ×1.3, Swing speed ×1.2, HP ×0.8, Load ×0.7 | None. *"He deftly steered around the rock, and into another."* | Skirmish |
| **Handy Lee** | **Repair** | Repair ×1.8, Bail ×1.5, Walk ×1.1, HP ×0.9, Load ×0.6, Melee ×0.6 | None. *"He handily patched the hole with his hat."* | Bulwark |
| **Loud Lee** | **Support** | Spotting ×1.3, Walk ×0.9, HP ×0.9, other stats ×1.0 | **Shouting:** adjacent gunners load 25% faster. *"He loudly reminded everyone which cannon to fire."* | Barrage |

- **Basic Lee stays in the data** (all stats ×1.0, no trait, no tags, *"He basically knew what he was doing."*) as a neutral reference and for enemy crews. **It isn't offered in the draft.**
- Placeholder names use the earlier design's example Lees. Replace them freely.

### 6.2 Types are data

- A type is **content**: name, art, flavor line, stat multipliers, trait, tags, and a draft weight (equal for now). A future Lee Creator tool will author these, so the data format should be clean and editable.
- **Traits are expressed through a generic ability mechanism** (such as "affect orthogonal neighbors" or "ignore a damage category"), so new traits are data and not code.
- **Individual Lees keep their own identity** (HP, position, level, bonuses, trinkets). When several Lees share a type, each needs a **visible way to tell them apart** (a number, color, or level badge). Whether they should have individual names is an open question (§14).

### 6.3 Crew AI uses stats (update to Phase 2/3)

The crew AI must **weigh a Lee's relevant stats** when choosing among otherwise-equal Lees for a task. The best qualified Lee takes it:

- A Handy Lee is the one who goes to repair or bail.
- A Quick Lee takes a gun that can engage.
- A Hard Lee is first to swing across.
- A Deft Lee takes the sail or the oars.

Placement still sets a Lee's **home role** (Phase 2), and urgency still decides emergencies. Stats act as a tiebreaker or weight, **not a replacement**, so the player's placement still matters. The debug reason strings should show when stats influenced a choice.

### 6.4 Drafting a starting crew

After choosing a ship, the player **drafts Lees one at a time** until they reach the ship's **minimum crew**:

- Each round shows **three Lee cards** (distinct types). The player picks **one.**
- The same type may be picked more than once across rounds.
- Cards show the type's name, role, flavor line, **stat bars**, trait, and tags.
- There's **no reroll** in this phase.

### 6.5 Recruiting between fights

- Recruits appear as **one of the three reward cards** after a fight, **some of the time.** **(tunable;** for example, guaranteed at certain fights, otherwise a chance.)
- A recruit card shows a **specific Lee**: type, level, stats, trait. New recruits join at **level 1** by default. **(tunable)**
- **Accepting** adds the Lee to the crew. If the crew is at **maximum**, the player must **release** a Lee first (prompted).
- **Declining** means picking a different card.

### 6.6 Releasing Lees

- On the refit screen, the player can **release** a Lee, removing them from the crew for good. It requires a **confirmation.** Its trinkets return to cargo.

---

## 7. Leveling & Permadeath

### 7.1 Experience

- Lees earn **XP after each fight**, if they **survive.** (A dead Lee earns nothing.)
- XP is made of a **flat survival amount** plus a **contribution bonus** based on the stats the game already tracks per Lee (damage dealt, HP repaired, water bailed, melee kills, time spent working). The weights are **tunable.**
- XP thresholds per level are **tunable.** A starting guess: the first level-up after about one or two fights, with later levels taking progressively longer. **Level cap: 10** for testing. **(tunable)**

### 7.2 Level-up bonuses

- When a Lee levels up, the player **chooses 1 of 3 small bonuses** (for example, +8% to a stat, or +10% HP). **(tunable)**
- The three options are **drawn from the Lee's type**, weighted toward its strengths but not exclusively. A Quick Lee will often be offered a load bonus, but sometimes something unexpected. This way, two Quick Lees can diverge into different Lees by the end of a run.
- **No Lee ever loses stats.** Bonuses stack.
- An **"Auto-pick"** button chooses the type-weighted default.
- Level-ups are resolved **right after the fight**, on their own screen (§8.4), one Lee at a time.
- **The same level system is used for enemy Lees** (§9), with bonuses applied automatically.

### 7.3 Showing levels

- A Lee's **level is visible** at a glance (a small badge or pips), including in the close-up strip, **without cluttering** the sprite.
- The info card shows the full stats, type, trait, tags, level, XP progress, chosen bonuses, and trinkets.

### 7.4 Permadeath

- **A Lee killed in a fight is gone for the rest of the run.** There's no revival. Its level and bonuses are lost. Its trinkets return to cargo.
- This makes **levels valuable**, and makes a veteran Lee a real loss. That's intended.
- **Memorial lines** (optional, low priority): on the results screen, each lost Lee gets a short punny line along the lines of *"Quick Lee quickly met his end."* Use the Lee's adverb.
- **The run ends if all Lees are lost** (§3.5). There's no emergency recruit.

---

## 8. Screens

All screens are **portrait and thumb-friendly**, and assume a phone. **The ⚙️ button appears on every screen.**

### 8.1 Choose Ship

- A **carousel or list** of the four ships.
- Each shows its sprite, **name**, **style blurb**, **stat summary**, **slot icons** (counts per type, with facings), treasure capacity, crew min/max, and tags.
- A **Select** button. No locked ships in this phase.

### 8.2 Draft Crew

- Described in §6.4: three cards at a time, tap to pick, with a counter showing progress toward the minimum.
- After the crew is drafted, a **Pick a Starting Part** screen offers three parts (one pick).

### 8.3 Refit & Crew screen

This replaces and extends the Phase 2/3 setup mode. It's the player's home between fights.

- **Three views** (tabs or a swipe): **Deck**, **Parts**, **Crew.**
  - **Deck:** the Phase 2 grid. Place and move Lees, with the same highlights and info cards, showing station types and slots.
  - **Parts:** the boat's slots (by type and facing), **Treasures**, and the cargo hold. Equip and unequip. Shows the stat card, with the before/after preview, and gun arcs when a gun is selected.
  - **Crew:** the roster, with each Lee's type, level, stats, trait, tags, XP, and **trinket slots.** Equip trinkets here. A **Release** button.
- **Always visible:** a **Launch** button to start the next fight, and a summary of the next fight if known **(tunable)**.
- **Touch targets** follow the Phase 2 requirement (comfortable on the smallest supported phone).
- **Warnings** (non-blocking): no gunners on a gun, a Lee's station was removed, crew below the minimum, an empty gun slot that could take a gun.

### 8.4 Results & Level-ups

- The fight's **result** with the Phase 2/3 stats.
- **Lees lost** (with memorial lines), **XP gained**, and then **level-up choices** for each Lee that leveled, one at a time.
- Then the **Reward Pick.**

### 8.5 Reward Pick

- **Three cards.** The player picks one (a part, Treasure, Trinket, or a recruit).
- Item cards show the slot type(s), effect, tradeoff, and tags. Recruit cards show the Lee.
- At least **one card is not a recruit.**

### 8.6 Run Over

- Described in §3.5.

---

## 9. Enemies Use the Same Stuff

**An enemy is built from the same content the player uses.** There are no special enemy-only ships, parts, or Lee types.

### 9.1 What an encounter defines

An **encounter** is **data**. For each enemy boat it specifies:

- **A ship** (from the shared ship pool)
- **A loadout** (guns, stations, rail items, hull modules, treasures, using the same slot rules)
- **A crew:** Lee types, **levels**, and optionally trinkets
- **An AI profile:** preferred range and whether it seeks to attach. **This belongs to the encounter, not the ship**, because the player could use the same ship.

The three enemy archetypes from Phase 3 become **encounter archetypes** built this way:

| Archetype | Built from | AI profile |
|---|---|---|
| **Boarder** | A Longship-style ship, few guns, a large crew with Hard Lees | Closes to dock or ram, then boards |
| **Standard** | A Sloop-style ship, a balanced crew | Closes to cannon range and orbits |
| **Heavy** | A Galleon-style ship, many guns | Holds range with its broadside, and is slow to turn |

### 9.2 How enemies get stronger

- **Mostly through crew:** more Lees, and **higher-leveled** Lees, using the same level system as the player (§7). Enemy level-ups are applied automatically with type-weighted choices.
- **Through loadout:** better or more specialized equipment, from the same pool.
- **Through bigger ships** over time, drawn from the same pool.
- **Not through hidden stat multipliers** on hulls or damage.
- **Every enemy stat should be explainable** from its ship, loadout, and crew. The debug overlay shows the same stat breakdown for enemy Lees and boats as it does for the player's.

### 9.3 Balance goal

- The player and enemy **ramp up in similar ways.** The **target** is that **the player ramps up just a bit faster than the enemy**, so a run has a natural arc: comfortable, then tense, then eventually overwhelming. **(tunable)**
- The pace of the enemy ramp is a set of **knobs** in the encounter data and the temporary list (§3.3), compared against the player's typical XP and reward flow. Sandbox tools (§10) should make that comparison easy.
- This phase doesn't need to hit the target. It needs to **make it tunable.**

### 9.4 Parity with the player

- The player can use **any ship** (§4.2) and any part. Later, they'll buy the ships and parts enemies use. **Nothing in the content model should treat "player" and "enemy" content differently.**
- Enemies don't need to follow the player's reward rules. They just need valid loadouts and crews.

---

## 10. Tuning & Debug

Phase 1–3's tuning principle applies. New tunables include:

- **Every ship, part, Treasure, Trinket, Lee type, and slot layout** (all of §4–§6)
- **Gun arcs, spreads, pellet counts, and ranges** (per gun)
- **Tile durability, blow-out effects, and explosion radius**
- **Spikes (damage, disengage penalty) and fence HP**
- **XP weights, level thresholds, level cap, and bonus sizes**
- **Draft weights, reward weights, and recruit frequency**
- **The temporary encounter list and the escalation rule** after its last entry
- **Between-fight recovery** (hull and Lee healing fractions)
- **Cargo hold limit**
- **Save version number**

**Sandbox mode (important):**

- Everything is unlocked: **any ship, any part, any Lee type, any level, any encounter.**
- The **encounter builder:** assemble any enemy from a ship, a loadout, and a crew with levels. This is also how new encounters get tested.
- A **"free refit"**, so parts and crew can be changed at will before a fight.
- **Live editing** of the data tables on the phone, as in earlier tuning panels.
- **Quick run simulation** (optional): the ability to fast-forward through a run to compare player and enemy ramp speed.

**Debug overlay additions:**

- **Tag counts** across the boat and crew
- Each gun's **arc, facing, and range rings**
- **Tile durability**
- For each Lee: the **stats after all modifiers** (type, level bonuses, trinkets, treasures, traits), so it's always possible to see why a Lee behaves the way it does
- The crew AI's reasoning, including how a Lee's stats influenced a choice
- The same stat breakdown for enemies

---

## 11. Success Criteria

The phase is successful if a player can, over 3–5 runs:

1. **Choose a ship because of how they want to play**, and describe the style in a sentence ("I'm a skirmisher," "I board everything").
2. **Make slot decisions that matter**: put guns where their arcs make sense, try rear-facing or forward-facing guns, and notice when a gun is hard to use.
3. See a **different fight** from a different build, not just different numbers.
4. **Care about individual Lees**, and feel a loss when a veteran dies, without feeling the run is lost.
5. Understand **why they lost** in terms of their build ("I had no answer to boarders," "my guns couldn't reach them," "the powder store blew").
6. Not find a **dominant** ship, part, or Lee type that's right for every run.
7. Use the refit screen on a phone **without frustration.**
8. Want to start **another run.**
9. **Reset or restart cleanly** with the ⚙️ menu, and never get stuck on a bad save.

### Playtest questions

- Do the four ships feel different from the first fight?
- Do gun arcs change how people play, or do they just look at the numbers?
- Are the typed slots **understandable**, or confusing? Do players find rear- and forward-facing guns?
- Do the five Lees feel distinct? Does anyone draft the same type every time?
- Are any parts **obviously the best** or **never worth taking**?
- Does the Powder Store feel like a risk worth taking?
- Do spikes and fences change how boarding feels?
- Does leveling add attachment, or just bookkeeping? Do people use Auto-pick?
- Is permadeath too harsh with full healing between fights, or not harsh enough?
- Is the refit screen usable on a phone?
- Does the endless escalation after the temporary list feel like it ramps at a sensible rate, and does the player stay slightly ahead?
- Is "enemies use the same stuff" **noticeable**? Do enemy crews feel like real crews?

---

## 12. Explicitly Out of Scope

Do **not** build these now, but don't make decisions that block them:

- **Tag bonuses and synergies.** Tags are data only.
- **The sea map, nodes, routes, and route choice.** (The temporary list stands in.)
- **Endless mode as a designed system.** (The escalation rule after the list is a crude placeholder.)
- **Ports, shops, shopkeepers, currency, and interest.**
- **Buying ships** (the player can choose from the pool at the start, but there's no purchasing).
- **Healing economy** (the ale bar, healers, paid repairs).
- **The Punishers** and any chasing faction.
- **Sea modifiers** (the "-cy" seas) and sea selection.
- **Boss fights.**
- **Ness monsters.**
- **Meta-progression** across runs (unlocks, achievements).
- **Recoil.** Very large guns that push the ship are a possible later feature (see §13).
- **Ship upgrades beyond parts** (hull tiers, larger grids).
- **Active abilities** on parts or Lees.
- **Selling or scrapping items.**
- **Fire and other tile layers**, including incendiary guns.
- **The Lee Creator tool.**
- **A pun/naming and lore pass** on ships, parts, Treasures, and Trinkets.
- **A victory condition.**
- **Landscape layout.**

---

## 13. Design-for-Later Constraints

1. **The run flow is replaceable.** The temporary list is a stand-in. The sea map, ports, shops, and endless mode should be able to **replace it and add reward sources** without changing ships, parts, Lees, or the refit screen.
2. **Everything is data.** Ships, parts, slot types, Lee types, tags, traits, encounters, and reward tables are content. Adding any of them shouldn't need code.
3. **Player and enemy share content.** Whatever the player can use, an enemy can use, and the reverse. This will matter when the player can buy enemy ships.
4. **Slot types are extensible**, including slots with facings, stacking layers, and new layers beyond floor, fixture, and rail.
5. **Guns can grow.** Gun data should be able to carry **recoil** (a force that pushes the boat when fired) for very large cannons, along with other future properties, such as fire effects or special ammo, without a rewrite.
6. **Parts can grow.** Parts should be able to gain **active abilities**, **drawbacks**, or **conditions** later. The data model shouldn't assume parts are only passive stat changes.
7. **Tags are general.** Anything can carry tags, and tags can drive shops, Lee bonuses, restrictions, and rewards later. The counting and display systems must already work.
8. **Treasures and Trinkets can get weird.** Their effects should be expressed generically, so later items can do more than add a stat.
9. **Traits are generic.** New Lee traits and abilities are data, expressed through a shared mechanism.
10. **Lee identity is stable.** Lees have persistent identity, history, and per-Lee stats, which the memorial, a future Lee Creator, and any later progression will build on.
11. **Run state is serializable and versioned** (§3.6). Breaking changes increment the version.
12. **Tiles are units with layers.** Tile durability, volatile parts, and floor upgrades are the start of the tile-layer system. Fire, smoke, water, and other conditions will later join it.
13. **All earlier constraints still apply:** two views of one world, shared steering, an accurate path preview, a general telegraph system, data-driven and layered parts, one crew AI for any unit, general attachments, and centralized tunables.

---

## 14. Open Questions

1. **Individual Lee names.** With permadeath and leveling, players will attach to specific Lees. Should each get a distinct name (such as a first name or a numbered label), or is "Quick Lee" enough?
2. **Trinkets on death.** Returning a dead Lee's trinkets to cargo softens permadeath. Should they be lost with the Lee instead, to make losses sting more?
3. **Healing between fights.** Full healing makes only permadeath count as attrition. Is that enough pressure for a first pass, or should some damage carry over?
4. **Cargo hold limit.** Unlimited is simplest. Does an unlimited hold make the reward picks feel weightless?
5. **Level-up pacing.** Is "1 of 3 per level" fun for crews of 8–12 Lees, or too many choices?
6. **Recruit level.** Should recruits scale with run progress, so a late recruit isn't useless next to veterans?
7. **Crew size limits.** Are the minimums and maximums right? Does the Longship's 12-person crew fit its grid and make boarding fun?
8. **Slot clarity.** Are four slot layers (floor, fixture, rail, gun attachment) plus hull too many for a phone screen? Which could be combined?
9. **Fence coverage.** A fence blocks only one tile's segment, so fully blocking a side takes several rail slots. Is that the right cost?
10. **Tile durability.** Is a blown-out tile too punishing for a gun on an edge? Should repair crew be able to fix tiles in a fight?
11. **Scrap Cannon and gatling telegraphs.** What's the best way to telegraph a burst or stream without cluttering the screen?
12. **Starting part pick.** Does picking 1 of 3 parts at the start steer players enough, or should it be more guided?
13. **Running out of crew.** Ending the run at zero Lees is simple. Does it feel unfair if the boat is still afloat?
14. **Showing the next fight.** Should the player see the enemy composition before launching? It adds strategy, but can make rearranging a chore.
15. **The gear menu pausing fights.** It's a system menu, but it lets players pause. Is that okay?

---

*End of Phase 4 PRD. As before: tuning feel is the product. The content here is test material, and the systems are the point. When in doubt, make it data and let the playtest decide.*
