# Lee — Phase 5 PRD: Commands & Clarity

> **Status:** Phases 1–4 are built: steering, ranged and close combat, a crew of self-organizing Lees, four ships with typed slots, equipment, five Lee types, leveling, permadeath, and a temporary run loop.
>
> **This document describes the *product* to build on top of Phase 4, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**. Everything in the Phase 1–4 PRDs still holds unless this document says otherwise.
>
> **Platform:** Mobile web, portrait-first (unchanged).
>
> **Workflow:** One phase per session. Build on `main`, open a PR to `main` (the preview deploy is how it gets validated), and build in the slices of §10 so each can be playtested.

---

## 1. Context

Phase 4 playtesting showed the systems work, but the game is **hard to operate and hard to read**:

- **Refit is clunky.** Too many steps for each change (tabs, modes, select-then-place), too many separate things to manage (eight slot types), and the effect of a change isn't clear (numbers with before→after text).
- **Ships need setup before they play properly.** A fresh run asks you to draft a crew and place a part before you understand any of it.
- **Fights are hard to follow.** Every Lee looks about the same at this size; you can't tell whether your Lees or theirs are dying.
- **Steering is awkward.** Holding a finger down is tiring, and the boat gets lost at the edges of the screen.
- **Melee has nothing to do.** Once boats touch, the player is a spectator.

### The question this phase answers

> **Can a player with zero naval knowledge understand what's happening in a fight, and steer it with a few taps, without the game becoming less of an autobattler?**

### Core design principles

**1. It's still an autobattler.** The player makes *a few meaningful decisions* (heading, where the crew's attention goes, when to commit to melee). Lees still do the work themselves and pick the best tile for their job.

**2. Everything is a button and some pips.** One control pattern for the crew: tap an action, a Lee moves to it. The same buttons are the crew readout.

**3. Keep the important info at the controls; the field is a visual feast.** Health, level, job and progress live in the pips, not floating over the field. The field can get busy (and, later, pretty) without becoming unreadable.

**4. One gesture everywhere in refit.** Tap a thing, the valid places light up, tap a place, tap ✅. Lees, guns, rails and trinkets all move the same way.

**5. Names a non-sailor can remember.** Ships are puns, always named **{Something} Ship**, just like crew are always **{Something} Lee**. (Common game vocabulary is fine: Mortar, Long Gun and Gatling stay.)

### Hypotheses to test

1. The four action buttons make players feel in control of the crew without micromanaging individual Lees.
2. Pips at the controls let players tell who is winning a fight, theirs or ours, at a glance.
3. Tap-to-set-heading plus a velocity-leading camera makes steering comfortable for a whole fight.
4. RAM / BOARD / CHARGE makes melee a decision (when, and with how many) instead of something that just happens.
5. A single tap-to-cycle refit view is faster than Phase 4's tabs, and players discover drilling down on their own.
6. Previewed stat bars and range arcs make the effect of a change obvious before it's committed.
7. Preset ships make a new run playable immediately, with no draft.

---

## 2. What Changes (Summary)

| Area | Phase 4 | Phase 5 |
|---|---|---|
| Ship names | Sloop, Skiff, Friend Ship, Hard Ship | **Basic Ship, Long Distance Relation Ship, Kin Ship, Hard Ship** (§3) |
| Run start | Pick ship → draft crew → pick a starting part | Pick a **preset** ship → fight 1 (very easy) → its reward is your first item, which **must** be equipped (§4) |
| Crew control | Home tiles from refit; DISENGAGE is the only order | Lees have a **job**; four **action buttons** move Lees between jobs (§5) |
| Crew readout | Shirts, level pips and progress bars on the field | **Pips** under each button: type, HP, level, action progress (§6) |
| Enemy crew readout | Field only | **Enemy pips** fade in above the buttons when melee is imminent (§6.4) |
| Melee | Automatic when boats meet | **RAM / BOARD / CHARGE** button, boarding party, RETREAT (§7) |
| Steering | Hold to seek; hold on a hull to come alongside | **Tap to set heading**; tap your boat to stop; tap an enemy to target (§8) |
| Camera | Frames you and every enemy | **Velocity lead**, zooms to fit enemies in range, **smoothly** into the close view as you board (§8.4) |
| Speed | Pause | **Pause / 0.5× / 1× / 3×** (§8.6) |
| Refit | Deck / Parts / Crew tabs, slot-type modes, numeric stat card | **One stacked view**, tap-to-cycle layers, shared cargo, **stat bars with previews**, ✅ on the tapped tile (§9) |

---

## 3. Ships: names and presets

### 3.1 Names (hard requirement: the `{Something} Ship` pattern)

| Old | New | Style |
|---|---|---|
| Sloop | **Basic Ship** | All-rounder, the on-ramp |
| Friend Ship | **Kin Ship** | Lots of Lees: boarding and overwhelming |
| Hard Ship | **Hard Ship** | Tough armor, heavy broadside, slow |
| Skiff | **Long Distance Relation Ship** | Fast and fragile; long guns, keeps its distance |

Display names only. Whether internal ids change is an engineering call (if they do, bump the save version or migrate).

### 3.2 Each ship comes preconfigured

Each ship has a **hand-authored preset**: loadout, crew (types and count), and starting positions. A freshly chosen ship should play reasonably well with zero setup. Presets are content data, not code. Auto-arrange remains the fallback for Lees added later.

Guidelines (all **tunable**; the exact contents are content work):

- **Guns are mostly on one side** (a real broadside), so the player learns to present that side.
- **Somebody is manning the guns, and somebody is sailing.** Not everyone starts on repair.
- **Basic Ship:** a broadside of cannons, oars and a sail, a mixed crew (e.g. Quick, Handy, 2 Basic).
- **Kin Ship:** spikes on the bow, a Gatling facing forward, hooks and planks; Hard Lees plus Basics (e.g. 2 Hard, 1 Deft, 3 Basic).
- **Hard Ship:** plating, a heavy broadside on one side; Quick gunners plus a Handy repairer (e.g. 2 Quick, 1 Handy, 2 Basic).
- **Long Distance Relation Ship:** long guns, oars; a small crew of Deft and Quick Lees (e.g. 1 Deft, 1 Quick, 1 Basic).

---

## 4. Run start

1. **Choose a ship.** It comes with its preset (§3.2). **No crew draft, no starting-part screen**: both are removed.
2. **Fight 1 is pathetically easy.** Its job is to teach steering and the buttons.
3. **Fight 1's reward is your first item.** It goes into cargo.
4. **You can't start fight 2 until it's equipped.** Start is disabled; the item glows in cargo. Tapping it lights up the valid spots in green: that teaches the refit gesture with no tutorial text. (Hard requirement for the first run's first reward; afterwards rewards behave as in Phase 4.)
5. From there, the Phase 4 loop (results → level-ups → reward → refit → next fight) continues unchanged.

---

## 5. Crew jobs and the action buttons

### 5.1 Jobs replace home tiles in combat

Every Lee has a **job**, which is one of the four actions. A Lee picks **which tile** to work on live, based on its job and what's needed. Refit placement sets each Lee's **starting job and starting tile**; it no longer pins them.

| Button | Job | Uses | Picks its tile by |
|---|---|---|---|
| ⏩ **SAIL** / RETREAT | Sail | Oars, sails | Current station priority (oars stack speed; a sail adds turning) |
| 🔫 **FIRE** | Fire | Hull guns, powder store, lookout; anti-crew guns when no ⚔️ Lee is using them (§7.3) | The guns **closest to / able to bear on** the enemy first |
| ⚔️ **RAM / BOARD / CHARGE** | Board | Hooks and anti-crew guns on the side facing the target, then the rail on that side (§7.3) | The side facing the ⚔️ target |
| 🛠️ **FIX** | Fix | Repairs, pump, bailing | The **most broken** thing or **most flooded** tile first |

**Hard requirement: stickiness.** Lees must not thrash. A gunner stays on their gun until it has been unable to bear for a while **(tunable, ~3 s)**, or a better gun is worth the walk. A fixer keeps working on its job until it's done. Turning the boat must not send the whole gun crew running back and forth across the deck.

### 5.2 Tapping a button

Each tap moves **one** Lee into that job:

- **Best fit by largest difference.** Pick the Lee (not already in that job) with the largest *(skill at the new job − skill at their current job)*. A Lee who's bad at sailing and good at cannons moves to FIRE even if they're the only sailor. Tapping SAIL next pulls the best sailor who is worst at what they're doing now.
- Ties go to the shortest walk, then to the biggest group.
- **No free seat, no move.** If the job has no unmanned station (every gun is manned), the tap does nothing and the button shows that it's full (a small shake **(tunable)**). FIX and ⚔️ have no seat limit.
- **Holding a button repeats.** After ~0.4 s, one more Lee every ~0.3 s **(tunable)**, with an arc filling around the finger.

### 5.3 Idle fallback (hard requirement: Lees never just stand there)

A Lee whose station is unusable (sails while stopped, a gun with nothing in arc, nothing to board) falls back, in order:

1. **Fix** something broken.
2. **Bail** a flooded tile.
3. **Pistols** at any enemy Lee in range.
4. Stand ready at the station.

Their job doesn't change, and their pip stays under their button. They return to the station as soon as it's usable.

### 5.4 Boarders on your deck

Anyone on a deck with enemy Lees fights by their strengths: **melee-focused Lees charge, ranged-focused Lees shoot pistols from a tile or more away.** FIRE means "stay on our boat"; it doesn't mean ignore boarders. With nothing to shoot with guns, FIRE Lees use pistols.

### 5.5 Enemies use the same rules (hard requirement)

Enemy crews have jobs and change them through the same four actions, with the same best-fit rule. AI profiles express **when** they shift Lees (e.g. a boarder AI moves Lees to ⚔️ as it closes). This keeps enemies explainable and makes their intent readable from their pips (§6.4).

---

## 6. Pips

### 6.1 Layout

The buttons sit **at the seam between the ocean view and the deck view**, so they block neither. Under each button is a row of **pips**, one per Lee in that job.

### 6.2 A pip

- **Color = Lee type** (the same color as that Lee's figure on the field).
- **Fill = HP:** the filled part of the circle is solid type color; the empty part is the same color at **25% opacity**.
- **Number in the center = level.**
- **Ring = progress on the current action**, if it has progress (reload, repair, bailing, swinging over). It's the same progress bar that sits over stations today, **moved off the field**. The ring shows only while the Lee is working.
- **Hollow pips = empty seats** (e.g. FIRE shows `●●○○` for two manned guns out of four). This applies to SAIL and FIRE.
- On death, the pip plays a short death effect and is removed.

Real art will come later and will make types distinct by more than color.

### 6.3 Pips move like Lees

When a Lee changes job, its pip **slides from one button to the other over the time the Lee takes to walk there**, mirroring the movement on deck. A Lee who's walking is visibly "in transit", not already working.

### 6.4 Enemy pips

When a **RAM or BOARD approach is underway** (by either side) and melee is imminent, the **engaged enemy ship's** pips **fade in above the buttons**, grouped by the same four actions. They fade out when contact ends. Only that ship's pips appear, and only then. You can see how they're assigned, their HP and their levels, the same as your own. Their Lees moving to ⚔️ is the telegraph that a boarding attempt is coming.

### 6.5 What leaves the field

Progress bars over stations move to the pips. The field keeps the Lee figures (type color, team marking) and the action.

---

## 7. Melee: RAM, BOARD, CHARGE and RETREAT

### 7.1 The ⚔️ button

- **Greyed out** when no enemy is targeted and in range.
- **Tap an enemy ship** to target it (§8.2). The ⚔️ button activates and shows **BOARD** or **RAM** depending on your angle:
  - Angle = between your heading and the target's hull: **0° = parallel**, **90° = straight into its side**.
  - **On targeting:** whichever is closer: **< 45° → BOARD, ≥ 45° → RAM**.
  - **BOARD → RAM** only once you're nearly perpendicular (**≥ ~80°**, tunable).
  - **RAM → BOARD** only once you're back under **45°** (tunable).
  - The gap between the two thresholds stops the label flickering.
- **Tap ⚔️ to start the maneuver** (autopilot):
  - **RAM:** full speed into the target's side (existing ram behavior).
  - **BOARD:** guide the ship alongside the target for boarding (existing come-alongside behavior).
- **Each tap also sends one Lee to the boarding party**, and further taps add more (best fit for boarding, as in §5.2).
- **Tapping the ocean to set a heading cancels the maneuver.** The boarding party stays gathered.
- **Once in contact**, the label becomes **CHARGE**: ⚔️ Lees go over to the enemy deck, or fight the boarders on your own deck if that's where the enemies are. More taps send more Lees.

### 7.2 ⏩ becomes RETREAT

SAIL and RETREAT never make sense at the same time, so they share a button. While in melee contact (grappled, docked, or being boarded):

- ⏩ shows **RETREAT**. Tapping it cuts loose, calls every Lee back to their job (the old DISENGAGE), raises sails, and **steers away from the nearest enemy** until you tap a heading.
- **Sailors move to FIRE automatically on contact** (sails are useless while grappled). **This is remembered and reversed**: when contact ends, they return to SAIL on their own.

The separate DISENGAGE button is removed.

### 7.3 The boarding party gathers on the target's side

⚔️ Lees move to the side facing the target **before** contact. There they man the **hooks** and **anti-crew guns** (Gatling and other crew-targeting weapons) on that side. Anyone left over stands at the rail behind them, so a big Kin Ship crew doesn't pile up uselessly.

Anti-crew guns are manned by ⚔️ Lees when they're on the side facing the target, and otherwise by FIRE Lees when there's no hull target, so they're never dead weight.

---

## 8. Steering, camera and speed

### 8.1 Tap to set a heading (hard requirement)

- **Tapping the ocean sets a heading:** the direction **from your boat** (not from the screen center) to the tap. The boat turns toward it and goes **full speed ahead**, and keeps going after you lift your finger. It's the same as holding your finger there, without holding.
- Holding and dragging still works and updates the heading continuously.
- A **heading indicator** (arrow or wake line from the bow) shows the current heading.

### 8.2 Taps on things

- **Tap your own boat: stop.** Sails come down, the boat coasts to a stop, and idle sailors fall back to fixing and bailing (§5.3). Tap the ocean again to go full speed.
- **Tap an enemy ship: target it** for ⚔️ (§7.1). This doesn't change your heading. Ranged guns keep choosing their own targets as now.
- Tap targets on boats must be **generous** for phones.

### 8.3 Stopped

While stopped, **fixing and aim are +25%** **(tunable, one bonus pair, don't stack more)**. A stopped ship is a sitting duck; that's the trade-off. It's a pit stop: sail away, stop to patch up, sail on. Show a clear "stopped" indicator.

### 8.4 Camera (one continuous rule)

- **Mostly centered on you, leading in the direction you're moving** (look-ahead **tunable**).
- **Zooms out to keep enemies within gun range in view**, smoothed and with hysteresis so it doesn't pump in and out.
- **Smoothly tightens into the close view as you approach the ⚔️ target**, until you're fully in boarding view. **No sudden mode switch**: you see the enemy ship up close while you're shooting their Lees and taking pistol fire.
- **Off-screen enemy arrows** at the screen edge for enemies outside the view.
- Refit camera is unchanged.

### 8.5 Field readability

- Team must be readable at a glance on the field (the enemy bandana plus a stronger team marking, e.g. a colored base ring) **(implementation's call)**.
- Lee type colors on the field must match their pips.

### 8.6 Speed control

One button cycling **Pause → 0.5× → 1× → 3×**. It replaces the current pause button. Speeds other than 1× are just more or fewer fixed sim steps per frame.

---

## 9. Refit: one stacked view

### 9.1 Layout

No more Deck / Parts / Crew tabs. One view: **the boat**, its **outside ring** (the tiles just outside the hull), **stat bars**, and **cargo** at the bottom. Sandbox-only tools (encounter builder, etc.) stay available in sandbox mode, out of the main flow.

### 9.2 What lives on a tile (the stack)

| Tile | Layers, top to bottom |
|---|---|
| **Inner** tile (on the boat) | **Lee** → **Station** (gun or station, with its gun attachment) → **Floor** |
| **Outer** tile (just outside the hull) | **Accoutrement** (spikes, fence, planks, other rail items) → **Hull** module |

- Rail items stick out past the hull already, so **tapping just outside the boat** is how you reach them. Players already try to tap the spikes.
- **Hull modules** (plating, keel, rudder, …) belong to a hull section; tapping any outer tile of that section selects that section's module and highlights the section.
- **Outside corner tiles** touch two edges: leave them empty (no slot) unless a ship defines one.
- **Treasures** (ship-wide) sit in their own small row; **trinkets** are on Lees (§9.5).

### 9.3 Tap to cycle

- **Tap a tile:** select its **top** thing. It **rises slightly and comes to the front**, and every valid destination **lights up green**.
- **Tap the same tile again:** select the **next layer down** (rises, valid spots light).
- **Tap again after the last layer:** deselect.
- **Tap a valid destination:** preview (§9.4).
- **Tap a tile that isn't a valid destination but has things on it:** select its top thing instead.
- **Tap nothing:** deselect.
- **Moving a lower layer carries everything above it.** Moving a manned cannon brings its Lee. (A setting to turn this off can come later.)

### 9.4 Preview and ✅ (hard requirement)

Tapping a valid destination doesn't move anything yet:

- A **✅ appears on the tapped tile**. **Tap it (that is, tap the same spot again) to commit.** Fast players just double-tap.
- **Stat bars preview the change:** green segments added, red segments removed.
- **Gun ranges preview:** the moved gun's **old arc in red**, **new arc in green**; every other gun's arc stays visible in **grey**.
- Anything displaced is labeled (e.g. "Plating → cargo").
- **Swap:** if the destination holds a same-layer thing that can go back to the source, they swap; otherwise the displaced thing goes to cargo.
- Tapping elsewhere instead cancels the preview, following the rules of §9.3.

On commit, the bars **animate slowly enough to notice** (**tunable**, ~0.6 s).

### 9.5 Cargo (shared inventory)

- One shared cargo for **everything**: parts, Lees ashore, trinkets, treasures.
- Tabs: **All** (first and default), then one per kind (Lees, Guns, Stations, Deck, Hull, Trinkets, Treasures).
- **Tap a cargo item:** its valid spots light up green; then it's the same preview-and-✅ flow.
- **Trinkets:** the Lees who can wear one light up.
- **Stowing:** select something on the boat, then tap cargo.

### 9.6 Stat bars

Five bars, normalized across ships: **Firepower, Toughness, Speed, Boarding, Repair** **(tunable formulas)**. The detailed numbers from Phase 4's stat card stay available behind a "details" toggle.

---

## 10. Build order (slices, each playtested)

1. **Jobs, buttons and pips** (§5, §6, §7.2, §8.6). Jobs replace homes in combat, best-fit moves, stickiness, idle fallback, the four buttons at the seam, pips with HP/level/progress, sliding pips, enemy jobs, RETREAT replacing DISENGAGE, speed button.
   *Done when:* in a fight you can read your crew entirely from the pips, shift Lees between SAIL and FIRE with taps, and gunners don't thrash when you turn.
2. **Steering, camera and melee** (§7.1, §7.3, §8.1–8.5, §6.4). Tap-to-heading, stop, targeting, the ⚔️ button with the angle rule, boarding party, the continuous camera, off-screen arrows, enemy pips.
   *Done when:* a whole fight can be played with taps only, and boarding feels like a decision.
3. **Refit and run start** (§3, §4, §9). Names, ship presets, no draft, forced first equip, one stacked view, tap-to-cycle, preview with ✅, range arcs, shared cargo, stat bars.
   *Done when:* a new player can choose a ship, win fight 1, and equip the reward with no explanation.

Keep the sweep tool (`npm run sweep`) working so balance can be rechecked after each slice.

---

## 11. Tunables (initial guesses)

| Tunable | Initial |
|---|---|
| BOARD→RAM threshold | ~80° |
| RAM→BOARD threshold | 45° |
| Gunner stickiness (time unable to bear before switching) | ~3 s |
| Button hold: delay / repeat | 0.4 s / 0.3 s |
| Stopped bonus | +25% fixing, +25% aim |
| Camera look-ahead | ~1 s of velocity |
| Camera zoom smoothing / hysteresis | implementation's call |
| Pip empty-HP opacity | 25% |
| Stat-bar animation | ~0.6 s |
| Ship presets and fight 1 contents | §3.2, §4 |

All of these go in the tuning panel, as in earlier phases.

---

## 12. Out of scope (later)

- Real art (types will become distinct by more than color).
- An **AUTO** button that drives the action buttons for you (it would reuse the enemy AI).
- A setting to stop lower layers carrying the layers above them.
- A fifth action button.
- Picking individual enemy Lees as targets.
- Sea map, ports, shops, endless mode (still the Phase 4 temporary encounter list).

---

## 13. Open questions (decide in playtest)

- Exact preset loadouts and crews per ship, and the contents of fight 1.
- Stat-bar formulas (what "Boarding" sums up, how bars normalize across ships).
- Whether the automatic sailors-to-FIRE shift on contact feels right, or should be opt-in.
- Whether one stopped bonus pair is enough of a reason to stop.
