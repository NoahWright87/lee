# TODO: where Phase 5 left off

Phase 5 ("Commands & Clarity", [`PRD_PHASE5.md`](PRD_PHASE5.md)) is built. This file lists what's still open from it and what the next phase could be, so the next PR can start from here. **There is no Phase 6 PRD yet:** pick the next phase (below) and write its PRD first, the same way as Phases 1–5.

## 1. Decide in playtest (Phase 5 open questions)

From PRD §13, plus the calls made while building it. Each one is a default that can change.

- [ ] **Presets and fight 1.** Each ship's crew and loadout (`preset` in `src/config/ships.ts`) and the first encounter ("A leaky Basic Ship" in `src/config/encounters.ts`) are first guesses.
- [ ] **Stat-bar formulas.** `boatBars` in `src/sim/boatStats.ts` and the "full" scale `tuning.refit.bar*`. *Boarding* in particular is made up (melee × boarding range + crew-gun damage + rail items).
- [ ] **Sailors to FIRE on contact.** The PRD (§7.2) asks for sailors to move to 🔫 automatically on contact and back afterwards. **Not built:** oars still matter in close combat here, so you move them yourself. Build it or drop it from the design.
- [ ] **Stopping.** Tapping your own boat gives one bonus pair (`jobs.stoppedFix`, `jobs.stoppedAim`, both ×1.25). Is that reason enough to stop?
- [ ] **Forced first equip.** Applies to the first reward of *every* run, not only a first-ever run.
- [ ] **Names.** The PRD's *Kin Ship* stayed the **Friend Ship** (as asked). Internal ids are `basic`, `longdistance`, `friend`, `hard`.

## 2. Known issues and balance

- [ ] **Slower ships can't catch faster gun ships.** A gun ship keeps its range, so BOARD/RAM from the Hard Ship (and sometimes the Basic Ship) never reaches contact, and you're shelled on the way in. `enemyAI.chasedMaxOffset` = 90 makes a chased enemy hold its broadside (catchable, but every gun bears on you); it's off by default (120) because it halved the Friend Ship's wins against the Hard Ship. Idea to try: a short speed burst when you tap ⚔️.
- [ ] **Long Distance Relation Ship.** In the sweep (`SWEEP_SEEDS=2 SWEEP_FIGHTS=4 npm run sweep`) it loses fight 2 on a 400 s timeout and fight 3 half the time. The sweep captain only orbits, so a person may do better, but it's the first ship to look at.
- [ ] **Boarding with a non-boarder ship** mostly loses against boarder encounters: the enemy sends 70% of its crew against your one or two ⚔️ Lees (`tuning.ai.boarder.boardShare`). Decide whether that's the intended counter or a balance problem.
- [ ] **Midship can't be plated.** Hull slots sit on edges, so a part with no edge tile has no hull slot.
- [ ] **Stowing a gun leaves its Lee standing on the tile** (the Lee isn't sent ashore with it).

## 3. UI leftovers (after the streamlining pass)

- [ ] Ship-choice previews have empty space above and below the hull (`src/ui/shipPreview.ts` bounds).
- [ ] Not streamlined yet: the "crew is full, release someone" screen and **Run Over** (`src/ui/screens.ts`).
- [ ] The sandbox catalog lost its category headers (tabs cover it); add them back if the full list is hard to scan.
- [ ] Dead CSS from the Phase 4 refit: `.setup-tray`, `.setup-below`, `.setup-grid`, `.crew-list`, `.crew-so-far`, `.ship-stats`, `.lee-mini` and the old refit's `.rf-details-btn`, `.rf-hint` (`src/ui/style.css`; `.setup-below` is also in `SCROLLERS` in `src/main.ts`).

## 4. Phase 5's "later" list (PRD §12)

- [ ] Real art (Lee types distinct by more than color).
- [ ] An **AUTO** button that drives the action buttons for you (reuse the enemy brain's `orderEnemyCrew`).
- [ ] A setting to stop lower layers carrying the layers above them in refit.
- [ ] A fifth action button.
- [ ] Picking individual enemy Lees as targets.

## 5. The next phase: candidates

Everything below was ruled out of scope in Phase 4 (§12) and still is. **Recommended next: the run structure** (sea map, ports and shops, currency), because the temporary encounter list has stood in for two phases now and the code was built to be replaced there:

- `encounterFor` / `enemySetups` (`src/sim/run.ts`) are the only things that pick the next fight; a sea map replaces them.
- `rewardOffer` / `takeReward` (`src/sim/run.ts`) are the only reward source; shops and other nodes add sources next to it.
- Which screen comes next lives in `src/game/Controller.ts`, not in `run.ts`.

The full list to pick from:

- [ ] **Sea map**: nodes, routes, route choice. Replaces the temporary encounter list.
- [ ] **Ports and shops**: shopkeepers, currency, interest; buying ships; selling or scrapping items; the healing economy (ale bar, healers, paid repairs).
- [ ] **Endless mode** as a designed system (the escalation after the list is a placeholder) and a **victory condition**.
- [ ] **The Punishers** or another chasing faction.
- [ ] **Sea modifiers** (the "-cy" seas) and sea selection; telegraph warning time is the intended difficulty dial (Phase 1 §13).
- [ ] **Ness monsters** and **boss fights.** Telegraphs are ready for them (Phase 1 §13). Close combat isn't: Phase 3 §14 asked for links that work with a latching Ness, but Phase 5 replaced the link system with `src/sim/contact.ts`, which only knows boats, so a Ness needs that generalized first.
- [ ] **Tag bonuses and synergies** (tags are data only today).
- [ ] **Active abilities** on parts or Lees; **fire and other tile layers** (incendiary guns); **recoil** on very large guns.
- [ ] **Ship upgrades beyond parts** (hull tiers, larger grids).
- [ ] **Meta-progression** across runs (unlocks, achievements).
- [ ] The **Lee Creator** tool; a **pun/naming and lore pass**; a **landscape layout**.
