# TODO: where Phase 6 left off

Phase 6 ("Ports & the Sea Map", [`PRD_PHASE6.md`](PRD_PHASE6.md)) is built: gold, budget-built enemies, sink/capture/surrender spoils, ports (shops, specialties, rerolls, tavern, shipwright, shipyard, bank), the cargo limit, paid and free repair and healing, the sea map (guaranteed route, travel radius, stop types, Fog, intel levels, the Crow's Nest, map styles), endless escalation by depth, Easy/Normal/Hard and the Custom start. This file lists what's still open, so the next PR can start from here.

## 0. Decide in playtest (Phase 6 open questions, PRD §16)

Each one is a default that can change (tunable or data).

- [ ] **Travel radius.** Fixed (`map.radius` 30 on a sea 100 wide), × the map style (Wide ×1.3, Crowded ×0.8). Ship speed or items don't extend it yet.
- [ ] **Capture spoils.** One random part from an intact tile (`spoils.captureParts`), undamaged, no pick.
- [ ] **Selling Lees.** Release only.
- [ ] **Cargo.** Basic 6, Long Distance 4, Friend 6, Hard 9 (`ships.<id>.cargo`); treasures and trinkets count like parts, Lees ashore don't.
- [ ] **Recruit pricing.** Point cost × `economy.recruitPrice` (1.5), −20% where the port specializes in the Lee's type or tags. Tavern levels rise with depth.
- [ ] **Map density.** ~8 stops on the first map (`map.stops`), +20% per journey; how full is too full on a phone?
- [ ] **Danger rating.** 1–5 💀, relative to your ship's point value (`budget.dangerPerSkull` 0.3 per skull).
- [ ] **Depth.** Journeys completed + progress across the map (a stop's height between the ports).
- [ ] **Economy numbers** are first guesses: point costs (`config/economy.ts`), `budget.base` 230 × `growth` 1.4 per journey, gold ~10% of a beaten ship's budget, start gold 60, repair `economy.repairCost` 0.35 × chassis cost for a full repair, heal 0.5 × a Lee's cost, bank 10% capped at 60.
- [ ] **Arriving at a fight commits you.** There's no backing out of the refit before it (so Fog can't be peeked). Should there be a "flee" option at a cost?
- [ ] **Free fixing.** 30% of missing hull and HP after every fight or event (+5% repair per Handy Lee aboard). Water never carries.

## 1. Decide in playtest (left from Phase 5)

- [ ] **Presets.** Each ship's crew and loadout (`preset` in `src/config/ships.ts`) are first guesses. (The first fight is now whatever the first map offers, built from `budget.base`.)
- [ ] **Stat-bar formulas.** `boatBars` in `src/sim/boatStats.ts` and the "full" scale `tuning.refit.bar*`. *Boarding* in particular is made up (melee × boarding range + crew-gun damage + rail items).
- [ ] **Sailors to FIRE on contact.** The PRD (§7.2) asks for sailors to move to 🔫 automatically on contact and back afterwards. **Not built:** oars still matter in close combat here, so you move them yourself. Build it or drop it from the design.
- [ ] **Stopping.** Tapping your own boat gives one bonus pair (`jobs.stoppedFix`, `jobs.stoppedAim`, both ×1.25). Is that reason enough to stop?
- [ ] **Names.** The PRD's *Kin Ship* stayed the **Friend Ship** (as asked). Internal ids are `basic`, `longdistance`, `friend`, `hard`.

## 2. Known issues and balance

- [ ] **Sweep (Phase 6).** `npm run sweep` (4 seeds, 3 journeys): the Friend Ship gets furthest (~2.8 journeys); Basic and Hard reach the middle of journey 2; Long Distance loses early. Many losses are 400 s timeouts against skirmishers the scripted captain never catches (see the next item). `SWEEP_LOG=1` prints every fight with the hull, the budget and the enemy.
- [ ] **Generated skirmishers kite.** A generated Long Distance Relation Ship (or a Basic Ship with long guns and the skirmisher AI) holds 150 m; slower ships can't close. `budget.chassisShare` keeps them out of depth-0 fights, but it's the same problem as below.

- [ ] **Slower ships can't catch faster gun ships.** A gun ship keeps its range, so BOARD/RAM from the Hard Ship (and sometimes the Basic Ship) never reaches contact, and you're shelled on the way in. `enemyAI.chasedMaxOffset` = 90 makes a chased enemy hold its broadside (catchable, but every gun bears on you); it's off by default (120) because it halved the Friend Ship's wins against the Hard Ship. Idea to try: a short speed burst when you tap ⚔️.
- [ ] **Long Distance Relation Ship.** In the sweep (`SWEEP_SEEDS=2 SWEEP_FIGHTS=4 npm run sweep`) it loses fight 2 on a 400 s timeout and fight 3 half the time. The sweep captain only orbits, so a person may do better, but it's the first ship to look at.
- [ ] **Boarding with a non-boarder ship** mostly loses against boarder encounters: the enemy sends 70% of its crew against your one or two ⚔️ Lees (`tuning.ai.boarder.boardShare`). Decide whether that's the intended counter or a balance problem.
- [ ] **Midship can't be plated.** Hull slots sit on edges, so a part with no edge tile has no hull slot.
- [ ] **Stowing a gun leaves its Lee standing on the tile** (the Lee isn't sent ashore with it).

## 3. UI leftovers (after the streamlining pass)

- [ ] Ship-choice previews have empty space above and below the hull (`src/ui/shipPreview.ts` bounds).
- [ ] Not streamlined yet: the "crew is full, release someone" screen and **Run Over** (`src/ui/screens.ts`).
- [ ] The sandbox catalog lost its category headers (tabs cover it); add them back if the full list is hard to scan.
- [ ] Dead CSS from the Phase 4 refit: `.setup-tray`, `.setup-below`, `.setup-grid`, `.crew-list`, `.crew-so-far`, `.ship-stats`, `.lee-mini` and the old refit's `.rf-details-btn`, `.rf-hint` (`src/ui/style.css`).

## 4. Phase 5's "later" list (PRD §12)

- [ ] Real art (Lee types distinct by more than color).
- [ ] An **AUTO** button that drives the action buttons for you (reuse the enemy brain's `orderEnemyCrew`).
- [ ] A setting to stop lower layers carrying the layers above them in refit.
- [ ] A fifth action button.
- [ ] Picking individual enemy Lees as targets.

## 5. Phase 6 leftovers

- [ ] **The PUNishers** (PRD §15): the map has a clock (`SeaMap.hops`) and positions for them; nothing chases you yet, so clearing every stop is optimal.
- [ ] **Enemy trinkets.** The generator never buys trinkets for enemy Lees (they'd only show in the debug overlay). Worth adding once intel can show them.
- [ ] **Hull trade-in** is `economy.tradeIn` × the price × how intact the hull is; the shipyard doesn't sell a fitted ship.
- [ ] **Sandbox Generate** uses a random seed each press; there's no "depth" input, only a budget.
- [ ] **Port tabs wrap** on narrow phones when a port has every service (two rows).
- [ ] **No map legend.** Stop icons are explained on the card when tapped; a first-time hint might help.

## 6. The next phase

Still later (PRD_PHASE6 §15): the PUNishers, wages and upkeep, special "-cy" seas, text events, merchant ships and distress calls, Ness and bosses, a victory condition, meta-progression, tag synergies, active abilities, fire and other tile layers, recoil, the Lee Creator, the lore pass (port and item names), owning more than one ship, a landscape layout. **Before Ness:** Phase 3 §14 asked for close-combat links that a latching Ness could reuse, but Phase 5 replaced the link system with `src/sim/contact.ts`, which only knows boats, so it needs generalizing first.
