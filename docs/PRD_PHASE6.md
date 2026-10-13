# Lee — Phase 6 PRD: Ports & the Sea Map

> **Status:** Phases 1–5 are built: steering, ranged and close combat, a self-organizing crew of Lees with jobs and action buttons, four preset ships with stacked slots, equipment, leveling, permadeath, and a temporary run loop (a hand-written encounter list, then crude escalation). Open items from Phase 5 are in [`TODO.md`](TODO.md).
>
> **This document describes the *product* to build on top of Phase 5, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**. Everything in the Phase 1–5 PRDs still holds unless this document says otherwise.
>
> **Platform:** Mobile web, portrait-first (unchanged).
>
> **Workflow:** One phase per session. Build on `main`, open a PR to `main` (the preview deploy is how it gets validated), and build in the slices of §13 so each can be playtested.

---

## 1. Context

Phases 1–5 made fights work and made them readable. What happens *between* fights is still a stand-in: a fixed list of encounters, a 1-of-3 reward after each, and free repairs and healing. There are no choices about **where** to go, **what** to fight, or **what to spend on**.

This phase builds the run structure the earlier PRDs kept deferring: **ports**, **gold**, **shops**, a **sea map** you sail across by picking your battles, and **endless escalation** as a designed system. It replaces the temporary list completely.

### The question this phase answers

> **Does choosing where to sail, what to fight, and what to buy make each run feel like your own story, while keeping the fights the heart of the game?**

### Core design principles

**1. Picking battles is the game between fights.** The map shows what's out there (as much as you can see), and you choose. Risk and reward should be readable at a glance.

**2. Every purchase is a trade-off.** Gold is limited, cargo is limited, and prices differ by port. Buying, selling, saving and healing compete for the same gold.

**3. Procedural, but readable.** Enemies and maps are generated, but an enemy ship's type tells you how it will fight, and a map always has a way through.

**4. Endless, and it ramps.** There is no final port. Each journey is longer, enemies are stronger and more numerous, and prices rise. A run ends when your ship sinks or your crew is gone.

**5. Same short, tap-first UI as Phase 5.** Ports and the map follow the streamlined refit: small cards, short words, one gesture, no scrolling for anything that matters.

### Hypotheses to test

1. Choosing a destination port (by its specialties and the kind of sea in between) is a meaningful decision.
2. Seeing a stop's type, enemy ship and danger lets players pick fights they can win, and taking a risk feels deliberate.
3. Budget-built enemies feel varied but readable: the ship type predicts the fight.
4. A cargo limit and port-dependent prices make selling a real decision, not cleanup.
5. Paid healing and repair make good fighting pay off (less damage = more gold to spend on gear).
6. Sinking a ship versus capturing it is a real tactical choice, because captures yield parts.
7. Difficulty levels and a custom start reuse the same levers without new systems.

---

## 2. What Changes (Summary)

| Area | Phase 5 | Phase 6 |
|---|---|---|
| Run structure | A fixed encounter list, then crude escalation | **Port → sea map → next port**, endless (§3) |
| Where fights come from | Hand-written encounters | **Budget-built enemies** from a chassis and its tags (§6) |
| Choosing fights | None: the next fight is the next fight | **Tap a stop in range** on the sea map; backtrack freely (§4) |
| Rewards | 1-of-3 pick after every fight | **Gold**, **captured parts**, sometimes a **surrendered Lee**; special rewards at hard stops (§7) |
| Between fights | Full repair and heal, free | **Partial** automatic repair and heal; the rest is **paid, in port** (§9) |
| Getting gear and crew | Rewards only | **Port shops**, recruiting, a **shipyard**; prices vary by port (§8) |
| Cargo | Unlimited | **Limited hold**, set by the ship (§10) |
| Money | None | **Gold**, with **bank interest** between ports (§11) |
| Run start | Preset ship → refit → fight 1, first reward forced | Preset ship → **first port** with starting gold; or a **Custom** start (§12) |
| Difficulty | None | **Easy / Normal / Hard** at run start (§12) |
| First-reward rule | Must be equipped before fight 2 | **Removed.** Leaving port with usable cargo warns instead (§8.7) |

---

## 3. The run

**Run = ports joined by journeys.** You start in a port. When you leave, you **choose the next port** from a few options, then sail a **sea map** between the two, stopping wherever you like. Reaching the destination port ends the journey; you shop, heal and choose again.

- **Endless (hard requirement: no final port, no hard-coded run length).** Each journey is a step deeper. Depth drives everything that escalates (§6.4).
- **Escalation by depth:** enemies get bigger budgets (stronger, more numerous ships), journeys get longer (more stops, bigger maps that may scroll), prices rise. **(tunable)**
- **A run ends** when your ship sinks or your whole crew is lost (as today). **Run Over** shows how deep you got, ports visited, gold earned, fights won, and the memorial.
- **Saving:** the run saves at every port, every map stop, and after every fight, including the full map state. The save version is bumped (§17).

---

## 4. The sea map

### 4.1 What it is

A top-down sea between two ports, scattered with **stops**. Your boat sits at one stop. Around it is a **travel radius**; any stop inside it can be reached in one hop. Same idea as FTL's star map.

- **Tap a stop in range** to sail there (a short animation along a dotted route). Stops out of range are visible but not tappable.
- **No steering on the map.** Steering is for fights.
- **Zigzag and backtrack freely.** Cleared stops stay on the map; you can sail through them again. Nothing happens at a cleared stop.
- **There is no pressure to move on in this phase:** visiting every stop is allowed and is the optimal play. (The PUNishers will change that later; §15.)
- **The destination port** is a stop like any other: sail into range, tap it, and you're in port.

### 4.2 Size and scrolling

- **No hard-coded number of stops (hard requirement).** Map length (distance between the ports) and stop count grow with depth. **(tunable)**
- Early maps fit on one screen. Later maps are taller and **scroll vertically**; the start port is at the bottom and the destination at the top. **(tunable)**
- The camera follows your boat on the map; you can drag to look ahead.

### 4.3 Generation (hard requirement: there is always a way through)

1. **Guaranteed route first.** From the start port, place stops one hop at a time at about **90% of the maximum travel radius**, always **toward the destination**, until the destination is within range. This guarantees a path.
2. **Fill in.** Scatter more stops around, each **reachable from at least one other stop**, so the map branches and doesn't feel linear.
3. **Always something near:** no stop is a dead end with nothing else in reach, except where that's the map style's intent (§4.5).

Generation is seeded (the run seed plus the journey), so a map is reproducible and serializable.

### 4.4 Travel radius

- A base radius **(tunable)**. Maps are generated against the **base** radius, so the guaranteed route is always reachable whatever you equip.
- Whether ship speed or items extend the radius is an open question (§16).

### 4.5 Choosing the next port picks the kind of sea

When you leave port you see **2–3 destination ports (tunable)**. Each shows:

- its **name** and its **1–2 specialties** (§8.2),
- which **services** it has (§8.1),
- the **kind of sea** between here and there (its **map style**).

Map styles are data, and combine. First set:

| Style | Effect |
|---|---|
| **Open water** | Default spacing and mix |
| **Crowded lanes** | Smaller, densely packed stops; more fights, each a bit weaker |
| **Wide sea** | Fewer stops, far apart; longer hops |
| **Foggy** | Many stops have the **Fog** modifier (§5.2) |
| **Dangerous** | More hard fights; better pay |
| **Salvage grounds** | More abandoned ships and wrecks |

New styles are new data entries. **(tunable)**

### 4.6 Hard requirement: the map is readable

Each stop shows its **type icon**, a **danger rating** (pips or a skull count) derived from its budget relative to your ship (§6.4), and what you can see of it (§5.3). A cleared stop is visibly cleared.

---

## 5. Stops

### 5.1 Stop types (first set)

| Stop | What happens |
|---|---|
| **Fight** | One or more enemy ships, built to the stop's budget (§6). Pays gold and spoils (§7) |
| **Hard fight** | A bigger budget (about one tier up). Pays more, and offers a **special reward** (§7.3) |
| **Abandoned ship** | No fight. Salvage it for gold |
| **Wreck** | No fight. Pick one of a few parts floating in the wreckage |
| **Cove** | No fight. Calm water: a free partial heal and repair |
| **Castaway** | No fight. A lone Lee on a rock joins your crew (if there's room) |
| **Port** | The destination (§8) |

**Adding stop types must be cheap (hard requirement).** A stop type is data: an icon, a weight per map style, and what it does (a fight with a budget multiplier, a reward table, a heal). New types later (merchant ships at sea, distress calls, events with choices) shouldn't need a rewrite.

### 5.2 Modifiers

A stop can carry **modifiers**. They're data and stack. First (and only, this phase):

- **Fog:** you can't see what the stop is until you arrive. It shows as a fog icon with no type, danger or preview.

Later modifiers (storms, night, currents) plug into the same slot.

### 5.3 What you can see

What you see of a stop depends on what you own (hard requirement: this is a system, not a special case):

| You have | You see |
|---|---|
| Nothing | Stop type, danger rating, the enemy's **ship type** (chassis) |
| A **Spyglass** (trinket, worn by any Lee) | + the enemy's **crew size and levels** |
| A **Crow's Nest** (station, manned) | + the enemy's **parts** |

- Fog (§5.2) hides everything, whatever you own.
- The **Crow's Nest** is a new station. It's also useful in fights: while manned, gunners aim slightly better, **less than the Lookout** (it does double duty). **(tunable)**
- Each piece of intel is a separate reveal level so later items (a better scope, a spy in port) can add or change them.

### 5.4 Leaving a stop

After a fight or event you're back on the map at that stop. Refit is available from the map at any time (§10), not only in port.

---

## 6. Enemies: budget-built ships

The temporary encounter list goes away. Every enemy ship is **built from a budget**.

### 6.1 How a ship is built

1. **Pick a chassis.** One of the ships (Basic, Long Distance Relation, Friend, Hard, and any added later). Each chassis has **tags** (Skirmish, Board, Barrage, Bulwark) and a cost.
2. **Spend the rest of the budget** on crew (by Lee type and level) and parts, **weighted toward the chassis's tags**. Each pick nudges the weights toward the tags it carries, so a ship that starts leaning one way **piles into that playstyle**.
3. **Pick an AI profile** from the result (a Board-heavy ship gets the boarder AI, a Skirmish ship the skirmisher, and so on).

Everything has a **point cost**: each chassis, each Lee by type and level, each part. Costs are data and also drive shop prices (§8.4). **(tunable)**

### 6.2 Readability (hard requirement)

The chassis is the headline: you always see it (§5.3), and it predicts the fight. A Friend Ship will try to board you, a Long Distance Relation Ship will keep its distance. Generated ships must stay true to their chassis's style.

### 6.3 Several ships

A budget can buy **more than one ship** once it's large enough. A stop's budget is split across ships with a minimum per ship, so packs appear deeper in the run. **(tunable)**

### 6.4 The budget

- **Budget = base × growth^depth × stop multiplier × difficulty**, with some randomness. Depth = journeys completed plus progress through the current map. **(tunable, all)**
- **Danger rating** on the map compares the stop's budget to your own ship's value (the same point costs applied to your ship and crew), so "dangerous" means dangerous **for you**.

### 6.5 The sandbox

The sandbox encounter builder adds a **"Generate"** option: pick a budget (and optionally a chassis) and build an enemy the same way.

---

## 7. Rewards and spoils

Regular fights no longer offer a 1-of-3 pick.

### 7.1 Gold

Every won fight pays gold, scaled by the stop's budget. **(tunable)**

### 7.2 Sink or capture (a tactical choice)

How a fight ends changes the spoils:

- **Sunk:** gold only. The parts go down with it.
- **Captured** (its crew is all dead or gone, and it's still afloat): gold, plus **one random part** from a tile that wasn't blown out. More capture spoils (two parts, a pick) are tunable. **(tunable)**
- **Surrender:** sometimes the **last enemy Lee standing surrenders** and offers to join your crew (accept or refuse). Chance by difficulty. **(tunable)**
- An **abandoned ship** stop (§5.1) is salvaged for gold.

### 7.3 Special rewards

**Hard fights** (and later special stops) add a pick of something rarer: a rare trinket or treasure, a high-level Lee, a part you can't buy in ordinary shops. **(tunable)**

### 7.4 XP and leveling

Unchanged from Phase 4: survivors earn XP, level-ups are 1-of-3.

---

## 8. Ports

### 8.1 Services

A port is a screen with **services**. **Repair** and **healing are always available**; the others vary by port.

| Service | What it does |
|---|---|
| **Shipwright** (always) | Repair the hull for gold |
| **Tavern** (always) | Heal Lees for gold; **recruit** Lees (a few for hire, random types and levels) |
| **Shop** | Buy parts, trinkets and treasures; sell anything |
| **Specialty shop** | A shop whose stock leans hard on the port's specialty (§8.2) |
| **Trinket dealer** (rare) | Rare, stranger trinkets and treasures at high prices |
| **Shipyard** | Buy a new chassis (§8.5) |
| **Bank** | Interest on gold carried to the next port (§11) |

Which services a port has is generated. Ports show their services before you choose them (§4.5).

### 8.2 Specialties (shopkeepers)

Each port has **1–2 specialties**: tags like Barrage (a gunsmith port), Board (a boarders' den), Skirmish, Bulwark, or a Lee type (a port full of Hard Lees). Specialties:

- **bias the port's stock** toward items and Lees with those tags,
- **change prices** for those tags (§8.4),
- are **visible when choosing the destination** (§4.5).

**Your own build biases the odds:** ports offered as destinations lean toward the tags your ship and crew already carry, so a boarding build sees more boarders' dens. **(tunable)**

### 8.3 Rerolls

Each shop can be **rerolled** for gold, getting more expensive each time in that port. **(tunable)** Some items change rerolls (a cheaper base cost or a slower ramp): first set in §8.6.

### 8.4 Prices (hard requirement: prices differ by port)

- **Buy price** = the item's point cost × a gold rate × depth inflation × the port's modifier for its tags.
- **Sell price** is a share of the buy price **(about 40%, tunable)**, **higher at a port that specializes in it** and lower elsewhere.
- The same item can be worth noticeably more at the right port, which is a reason to carry it there (§10).

### 8.5 The shipyard

- You **buy a chassis**: an empty hull. You own one ship at a time.
- When you buy one, your **crew and gear go into storage at the port**, and you place them on the new chassis in refit. Anything you can't fit (cargo limit) must be sold or left behind before you sail.
- The old hull is **traded in** for some gold. **(tunable)**
- The reason to upgrade: **size and slot count**, **cargo space**, **crew limits**, and different **base stats**.

### 8.6 New items this phase (first set)

| Item | Kind | Effect |
|---|---|---|
| **Crow's Nest** | Station | Reveals enemy parts on the map (§5.3); gunners aim slightly better while manned |
| **Haggler's Ledger** | Treasure | Shop rerolls cost less |
| **Lucky Coin** | Treasure | Reroll costs ramp slower |
| **Ship's Surgeon's Kit** | Treasure | More automatic healing after fights (§9) |
| **Carpenter's Chest** | Treasure | More automatic repair after fights (§9) |

The Spyglass trinket gains the map reveal (§5.3). Names are placeholders for the lore pass.

### 8.7 Leaving port (hard requirement)

Before you sail, if **cargo holds something that fits an empty slot** or **a Lee is ashore**, a warning offers **Auto-equip** or **Leave anyway**. (This replaces Phase 5's forced first equip.)

---

## 9. Repair and healing

- **After every fight and event**, the hull is **partly repaired** and Lees **partly healed**, automatically. **(tunable)**
- Items and crew can raise it: Handy Lees, the new treasures (§8.6), and later more.
- The rest is **paid**: the Shipwright and the Tavern in port, or a Cove stop on the map.
- **Difficulty sets the levers** (§12.1): how much is free, and what the rest costs.

---

## 10. Cargo

- The hold has a **limited number of slots**, set by the ship. Bigger chassis hold more. **(tunable)**
- Lees ashore don't use cargo slots, but count toward the crew limit as now.
- In port, overflow sits on the dock while you shop. **You can't sail with more than the hold allows:** sell, equip or leave it behind first.
- **Refit is available anywhere**: in port and on the map between stops. Buying and selling only happen in port.

---

## 11. Gold and the bank

- **Gold** is the one currency. Shown at all times on the map and in port.
- **The bank** is automatic: when you leave a port that **has a bank**, the gold you carry earns **interest** paid when you reach the next port, **capped**. **(tunable)** Gold earned during the journey is added on arrival without interest.
- A port without a bank pays no interest for that journey, another reason to weigh destinations.
- **Wages** for crew are **not** in this phase (§15).

---

## 12. Run start and difficulty

### 12.1 Difficulty (Easy / Normal / Hard)

Chosen at run start. It only moves levers this phase already has:

| Lever | Easy → Hard |
|---|---|
| Free repair and healing after fights | More → less |
| Repair and healing prices | Lower → higher |
| Enemy budget growth per depth | Slower → faster |
| Surrender chance | Higher → lower |
| Starting gold | More → less |

All values **(tunable)**, and each difficulty is a data entry, so more can be added.

### 12.2 Preset start (default)

Pick a preset ship (as in Phase 5), crewed and fitted. You start **in the first port** with a little starting gold, so your first decisions are what to buy and where to sail.

### 12.3 Custom start

A second option on the ship screen: start in a **fully stocked port** (every service, a wide stock) with **no ship** and a **larger starting budget**. Buy a chassis, recruit a crew and buy parts, then sail. Same shops, same prices, same systems, just a different starting state. **(tunable starting budget)**

---

## 13. Build order (slices, each playtested)

1. **Gold and budget-built enemies** (§6, §7). Point costs, the generator, gold, sink/capture/surrender spoils, the sandbox "Generate", danger rating. The temporary list's escalation becomes "budget by fight number" until the map exists.
   *Done when:* generated enemies look and fight like their chassis, deeper fights are harder, and capturing pays differently from sinking. The sweep tool runs on generated enemies.
2. **Ports** (§8, §9, §10, §11). The port screen and its services, buying and selling with port prices, rerolls, recruiting, paid healing and repair, partial auto repair/heal, the cargo limit, the bank, the leaving-port warning. Ports appear every few fights until the map exists.
   *Done when:* a run alternates fights and ports, gold is tight, and selling is a decision.
3. **The sea map** (§3, §4, §5). Generation with the guaranteed route, travel radius, tap-to-sail, backtracking, stop types, Fog, intel levels and the Crow's Nest, choosing the next port and its map style, scrolling maps.
   *Done when:* a run is port → map → port, endless, and picking a route feels like a choice.
4. **Shipyard, difficulty and Custom start** (§8.5, §12). Buying a chassis with storage, trade-in, the three difficulties, the Custom start.
   *Done when:* a player can upgrade mid-run, and a Custom run can be built from nothing.

Keep the sweep tool working; extend it to sail a simple route through generated maps.

---

## 14. Tunables (initial guesses)

| Tunable | Initial |
|---|---|
| Travel radius | fits ~3–5 stops in reach on an open-water map |
| Guaranteed-route hop length | 90% of the radius |
| Stops per journey | ~8 at depth 1, growing ~20% per journey |
| Destination ports offered | 3 |
| Enemy budget | base × ~1.15^depth × stop multiplier |
| Hard fight multiplier | ~1.5× (about one tier up) |
| Minimum budget per enemy ship | enough for a crewed Basic Ship |
| Gold per fight | ~10% of the stop's budget |
| Capture spoils | 1 random part from an intact tile |
| Surrender chance | ~20% (Normal) |
| Auto repair / heal after a fight | ~30% / ~30% of what's missing (Normal) |
| Sell price | ~40% of buy; ~60% at a matching specialty port |
| Specialty price change | −20% to buy, +50% to sell for matching tags |
| Reroll cost | starts low, ×1.5 per reroll in the same port |
| Bank interest | ~10%, capped |
| Depth price inflation | ~5% per journey |
| Cargo slots | ~6 on the Basic Ship, more on bigger chassis |
| Chassis trade-in | ~50% of its price |
| Starting gold | small (preset), large (Custom) |

All go in the tuning panel. Point costs and port, stop, map-style and difficulty definitions are data (`config/`).

---

## 15. Out of scope (later)

- **The PUNishers:** a faction that chases you from port to port, stronger than the current map (1–2 tiers up) with little or no reward. This is what will discourage clearing every stop and backtracking. Add more limits only if needed after that.
- **Wages and upkeep** for crew (a reason to let Lees go), and a full economy and balance pass.
- **Special seas** (the "-cy" sea modifiers) beyond the map styles and Fog here.
- **Events with choices** (text events), merchant ships at sea, distress calls.
- **Ness monsters, bosses**, a victory condition.
- **Meta-progression** across runs.
- **The lore and naming pass** (port names, the new item names).
- Owning more than one ship at a time; fleets.

---

## 16. Open questions (decide in playtest)

1. **Travel radius:** fixed, or extended by ship speed or items (faster ships hop farther)?
2. **Capture spoils:** one random part, or a pick? Should captured parts arrive damaged?
3. **Selling Lees:** can you sell a Lee (to another crew) or only release them? (Wages, later, would make this matter.)
4. **Cargo:** how many slots per chassis, and do treasures and trinkets in the hold count the same as parts?
5. **Recruit pricing:** by type and level only, or do specialties change it like items?
6. **Map density:** how many stops feel "full" on a phone screen before it reads as clutter?
7. **Danger rating:** a number, pips, or skulls? Relative to your ship (as specified) or absolute?
8. **Depth:** journeys completed only, or also progress through the current map?

---

## 17. Design-for-later constraints

1. **The PUNishers plug in.** The map needs a notion of **time** (hops taken) and positions that something can move across, so a chasing faction can be added without rewriting the map.
2. **Stops, modifiers, map styles, port services, specialties and difficulties are data.** Adding one is an entry, not code.
3. **Intel is levels, not flags.** New items or services can grant reveal levels (§5.3).
4. **One point-cost table** prices enemies, shops, trade-ins and danger ratings, so balance changes in one place.
5. **The economy can grow.** Wages, loans, taxes or a second currency should be addable without restructuring gold.
6. **Player and enemy still share content** (Phase 4): anything an enemy can be built with, a shop can sell, and the reverse.
7. **Run state stays serializable and versioned**, including the map, ports, shop stock and the bank.
8. **All earlier constraints still apply.**
