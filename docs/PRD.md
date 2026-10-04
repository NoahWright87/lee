# Lee — Ranged Combat Prototype PRD

> **Status:** Pre-production. This document describes the *product* to build, not the implementation. Engineering decisions (engine, architecture, data formats) are yours. Where a behavior is a hard requirement, it's stated as one. Where it's a guess to be tuned, it's marked **(tunable)**.
>
> **Platform:** Mobile web browser, portrait-first. Desktop browser should work for development (mouse = touch).
>
> **Language preference:** TypeScript, with a technology choice that has a strong public corpus so both humans and AI tools can work in it easily.

---

## 1. Context

**Lee** is a nautical roguelite. The long-term game: you captain a boat crewed by people named after adverbs (Sneaky Lee, Hard Lee, Loud Lee), sail across seas fighting Loch Ness monsters ("Ness") and rival ships, and manage crew and gear between fights. The full game has three layers:

1. **Ranged combat:** steering your boat while crew fire cannons automatically.
2. **Close combat:** boarding, melee, fighting on the decks.
3. **Metagame:** hiring, stations, shops, map, boats.

**This prototype is only layer 1, stripped to the bone.** No crew, no metagame, no boarding. One player boat, one enemy boat, open water.

### The question this prototype answers

> **Is it fun to steer a boat with one thumb while it fights automatically, and can you read the damage state with your eyes on a second panel?**

If the answer is no, nothing built on top of it matters. Everything in this document exists to answer that question honestly and to make the answer easy to tune toward "yes."

### Specific hypotheses to test

1. Steering by "seek this point" (including the natural orbiting it produces) feels good and gives players meaningful control.
2. Telegraphed incoming shots (red X markers) make dodging feel fair and never cheap.
3. A split screen (zoomed-out ocean on top, close-up of your boat on the bottom) is usable on a phone. Specifically: a thumb steering in the top panel plus glances at the bottom panel.
4. Parts-with-HP plus flooding makes a fight change shape as it goes on (the boat gets sluggish, guns go offline, a sinking clock starts).
5. The player-advantage fight feels like a satisfying power fantasy, not a slog.

---

## 2. Screen Layout

The screen is **two panels showing the same game world**. They are two different views of the same underlying data, not two separate scenes. Anything that happens to a boat appears in both views.

### Portrait (primary)

- **Top ~75%: Ocean view.** Zoomed out. Shows both boats, open water, incoming shells, markers, and the steering path preview. This is the only panel that accepts steering input.
- **Bottom ~25%: Close-up strip.** A wide, short strip showing *your boat only*, drawn large and rotated so it lies horizontally with the bow pointing right. This view is **always drawn in the boat's own frame**; it does not rotate as the boat turns. It shows every part clearly, with HP bars, cracks, water level, and cannon state. Nearby water is visible so shells that land just off the hull show their splash here.
- The strip is **view-only** in this prototype. Touching it does nothing, so a resting thumb can't steer by accident.

### Landscape

- If the device is in landscape and the available space is insufficient for the layout, **show a full-screen "Rotate your phone to portrait" overlay** and pause the game. (A CSS/orientation-based overlay is fine. Locking orientation is not required and often isn't possible on mobile browsers.)
- Landscape layouts (the same two panels side by side) are explicitly **out of scope** for now. We may revisit once portrait feels right.

---

## 3. What You See on Landing

No title screen. No menu. You land directly on the battle, in a frozen pre-fight state.

- **Ocean:** dark blue water with a subtle wave texture. The texture must scroll relative to the boat's movement. With no landmarks, it is the *only* thing that makes speed and motion readable.
- **Your boat:** slightly below center, bow up, drifting at idle. It's built of visible **parts** (see §5), each with an HP indicator. Cannon barrels are visible on both sides, so the broadside concept reads before anything happens.
- **The enemy boat:** off to one side, roughly a screen-height away. Same visual style, same part structure, same HP indicators, so you can see up front that it has parts you could focus. It is *not* moving yet.
- **Both boats are facing north** (up) at the start.
- **Close-up strip:** your boat, large, horizontal.
- **START button:** large, floating at the bottom of the ocean panel (just above the strip).
- **Speed toggle:** small, in a top corner. Options: 1x / 2x.
- **Everything is frozen** until START is pressed. Touching the ocean during this state is allowed and shows the steering path preview (§4), so the player can experiment with how the boat will respond before committing.

### Explicitly not present

Lees, any grid, items, shops, maps, a title screen, win-screen cosmetics, sound design beyond placeholder.

---

## 4. Controls & Steering

### Core input: "seek this point"

- **Touch and hold anywhere in the ocean panel** → the boat tries to turn toward and move toward that point, limited by its turn rate.
- **Drag** → the target follows the finger.
- **Release** → the boat keeps its current heading and continues. (There's no auto-stop and no auto-return. This is the default; tunable if it feels bad.)
- **It's a direction/point to seek, not a destination to arrive at.** There is no "arrive and stop" behavior.

### The orbit behavior is a feature

If the target point is inside the boat's turning circle, the boat **cannot reach it** and will settle into a loop around it. This is intentional. It lets a player park a finger on an enemy and have their boat circle it, which naturally keeps the enemy on the boat's side (broadside) where the cannons are.

The orbit radius should naturally depend on speed and turn rate. A slower boat circles tighter; a faster one circles wider. This is how "distance control" works in this game (no separate distance slider).

### Boat movement feel

- **Momentum:** the boat should feel like a boat. It has velocity, carries momentum, and drifts slightly through turns. It should not move like a car on rails. **(tunable: turn rate, acceleration, drag, sideways drift)**
- **Throttle:** constant forward speed for this prototype. Three-notch speed control (idle / half / full) is a likely addition later; not required now.
- **Starting state:** when the fight begins, the boat eases from idle up to cruise speed and sails straight until the player touches the screen.

### Path preview (important feature)

While a finger is down in the ocean panel, show a **dashed line indicating what the boat will actually do** if the finger stays there.

- The line must be **accurate**. It must come from the same movement behavior the real boat uses, not an approximation. If the boat would overshoot and loop, the line shows the overshoot and loop.
- It extends **past the finger** over a fixed time horizon **(tunable, ~4-6 seconds)**, not just to the finger. Far from the boat, this reads as a curve through the finger. Close to the boat, where it can't make the turn, it naturally shows the circular loop. No special-casing should be needed.
- It updates once the finger settles (or at a throttled rate while dragging). It does not need to update every frame.
- **Visual style:** animated marching dashes moving along the path in the direction of travel, evoking a treasure-map route line. The far end should fade, to suggest less certainty, keeping the near-term path prominent.
- The preview assumes the player's current throttle and does not simulate the enemy.
- The preview is also visible **before START** (while frozen).

A small ring/reticle may appear under the finger. The path preview is the primary feedback.

---

## 5. Boats

Both boats follow the same rules. The player boat is simply stronger.

### 5.1 Boats are made of parts

A boat is a set of **parts** arranged along the hull. For this prototype, each boat has roughly **4-6 parts**, for example:

| Part | Role |
|---|---|
| **Bow** | Forward section. Low HP, takes little water. |
| **Cannon sections** (port and starboard, possibly multiple) | Hold the guns. Low HP, little water, but a damaged cannon section **goes offline** (see below). |
| **Midship** | The big middle. High HP, high water capacity, high leak rate when damaged. |
| **Engine / stern** | Drives the boat. When damaged, speed and turn rate suffer. |

The exact count and arrangement are up to the engineer and artist; the requirement is that **parts have different stats and different roles**.

### 5.2 Part stats

Every part has, at minimum:

- **HP**
- **Water capacity**
- **Leak multiplier:** how aggressively it floods per unit of damage
- **Function:** what it does when healthy and what is lost when damaged (e.g., cannon fires; engine provides speed)

Different parts should deliberately differ. As a guide:

- Midship: lots of HP, but floods fast when hurt. Hitting the middle won't instantly kill a boat, but it's the fastest route to sinking it.
- Cannon section: little HP, little flooding, but disabling it silences that gun.
- Engine: moderate HP; damage cripples speed and turning.

### 5.3 Damage visuals

- Each part is a **sprite**.
- As HP drops, **crack/hole overlays** fade in over the sprite, in roughly 3-4 stages. More damage means more cracks and holes.
- **Small wood-chip particles** on hits for punch.
- A part at **zero HP** is "wrecked": fully cracked, leaking at its maximum rate, non-functional. It does *not* explode into line debris.
- Placeholder art is fine for the prototype. Distinct silhouettes per part type matter more than polish.

### 5.3a Layered parts (design-for-later requirement)

Later, parts will gain **armor/plating layers** that absorb damage before the part beneath takes any. The prototype does not include armor. However, **damage should be structured so that a part can have an ordered stack of layers**, each with its own HP, where damage hits the top layer first. In this prototype every part has exactly one layer, and adding armor later must not require reworking the damage model.

### 5.4 Player advantage

The player boat should be **meaningfully stronger across the board** than the enemy: more HP, faster reload, sturdier hull, better turning. The test fight is meant to feel good to win while still being capable of losing. A single **player-advantage setting** that scales the relevant stats is ideal for tuning. **(tunable)**

---

## 6. Cannons & Shells

Weapons are automatic in this prototype. There are no crew yet; each boat's cannons run themselves.

### 6.1 Firing behavior

- Each working cannon **loads** over time, shown as a **small circular progress ring** filling above the cannon.
- When loaded and a target is available (inside the cannon's firing arc and range), it **fires automatically**.
- **Broadside cannons** fire only to their own side. Lining up a side-on shot is the core skill. The firing arcs should be clearly defined and visible to the engineer/designer (a debug overlay is useful).
- In this prototype, a boat's cannons **auto-target the nearest part of the nearest enemy**. Choosing a specific target part is out of scope (see §12).

### 6.2 Shells are real projectiles with travel time

**This is a hard requirement.** Shells are **not hitscan**. Dodging only exists if shells take time to arrive.

- When a shell is fired, its **landing point is computed immediately**. Shooters **lead their target** using the target's current velocity. A boat holding a steady course gets hit; a boat that's turning evades.
- The shell flies to that fixed point and **resolves on arrival**: when it lands, it damages whichever boat part is *at that spot at that moment*. If nothing is there, it **splashes** in the water.
- Consequence: a boat that changes course after a shell is fired can avoid it. That's the whole point.
- Shells should be **visible in flight** (a dot or ball arcing toward its target).
- **Shell flight time is the key tunable.** It defines the dodge window: the time between a shot being fired and landing. If the boat can't move a hull-width in that time, the shot is effectively unavoidable regardless of accuracy. Starting guess: **~2 seconds. (tunable)**

### 6.3 Telegraphing: the red X

**This is a hard requirement and a core design pillar: dodging must never feel cheap.**

- When an **enemy** shell is fired, a **red X appears immediately on the water at its landing point.**
- A **thin ring around the X shrinks** toward it as the shell approaches, showing time to impact.
- The red X **means "this will hurt you" and nothing else.** It is exclusive to threats. Do not reuse it for any other purpose.
- **The player's own shells do not get markers by default.** Information that doesn't drive a decision is clutter. *Optional:* the slowest/heaviest player shells (e.g., mortar-type) may show a faint cool-colored ghost marker. Not required for the prototype.
- Your own shells' outcomes are communicated through the hit/splash animation itself.

### 6.4 Accuracy

- Enemy accuracy comes primarily from **lead-targeting** (above). Constant-velocity targets are hit; turning ones aren't. This makes accuracy depend on the player's behavior and not on random miss rolls.
- Add a **small random spread** on top as an additional tuning knob. **(tunable)**
- Tuning note: the enemy should be either very accurate or fairly inaccurate, not in between. Mid-accuracy tends to feel like random chance. Flight time and spread together determine how dodgeable things are.
- The enemy's accuracy and the player's should be independently tunable.

---

## 7. Damage, Flooding & Sinking

Damage is a clock. Combat should change shape as it goes on.

### 7.1 Flooding

- When a part is damaged, it **takes on water** at a rate based on **how damaged it is × its leak multiplier**.
- **Water visibly accumulates**: blue circles/puddles drawn on the deck of the affected part, scaled to its water level. Visible in both the ocean view and the close-up strip.
- **Water spreads to adjacent parts over time**, evening out between neighbors. This is the same behavior as oxygen spreading in FTL.
- Each part has a **water capacity**.

### 7.2 Water slows the boat

- As the boat's **total water level rises, its speed and turning ability degrade**. This gives escalating pressure and a *visible warning* before sinking, rather than a sudden death.
- The degradation curve should be **configurable**. **(tunable)**

### 7.3 Passive bilge

- A boat **passively drains water at a small, configurable rate**, standing in for crew that will bail later. It can be set to zero for testing.
- It remains a valid concept after crew exist (as a boat trait or upgrade), so build it as a boat-level stat, not a hack.

### 7.4 Sinking

- A boat **sinks when its total water passes a threshold fraction of its total capacity**. **(tunable)**
- A boat with a wrecked engine is crippled but still floats. A boat with silenced cannons is harmless but still floats. **Only flooding sinks a boat.**
- This means "disable the guns first" and "go for the hull" are genuinely different strategies, even though target selection isn't player-controlled yet.

### 7.5 Sinking presentation

- The boat stops accepting input / steering and settles.
- The sprite **tilts, darkens, and slides under** over ~2 seconds, with bubbles and foam spreading on the surface.
- **Shells pass through a sinking boat** and don't affect the result.

### 7.6 Part function loss

- **Cannon part damaged past a threshold** → that cannon is offline until repaired. (Repair will come with crew later; in this prototype it stays offline.)
- **Engine damaged** → speed and turn rate scaled down in proportion.
- **Part wrecked** → fully non-functional.

---

## 8. Enemy Behavior

The enemy is intentionally simple. It's a target dummy that fights back, not an AI showcase.

- It **starts awake**, facing north (same as the player), so both boats must first turn around to engage. That opening gives a few seconds where both boats come about and tests turn rates on both sides.
- It uses the **same steering behavior the player boat uses** ("seek this point"), with the target being *a spot where it's broadside to you at its preferred range*, then orbiting slowly. One steering implementation, shared by both boats.
- It fires using the same cannon rules as the player.
- It does not retreat, repair, or use tactics beyond maintaining range and facing.

---

## 9. End of Fight

### 9.1 Win/Lose

- **Victory:** the enemy boat sinks.
- **Defeat:** your boat sinks.
- If both would sink at once, the one that crossed its threshold first loses.

### 9.2 Result screen

About a second after sinking finishes, an overlay slides in over the ocean panel (**the close-up strip stays visible**):

- **Header:** "Victory" or "Sunk" (plain styling; polish later)
- **Stats:**
  - Time elapsed
  - Shells fired / shells hit
  - Damage dealt / damage taken
  - **Shells dodged** (enemy shells that landed within a few hull-lengths of your boat without hitting). **This is the key diagnostic stat.** It measures whether the X telegraph is working.
  - **Water taken**
- **Two buttons:**
  - **Again:** restarts instantly with the current config.
  - **Tune:** opens the tuning panel (§10) over the result screen. Changes apply on the next run.

**The loop of fight → lose → nudge a slider → retry should take under ~10 seconds.** This loop matters more than the result screen's polish.

---

## 10. Tuning & Debug

Tuning is a first-class feature, not an afterthought. The designer will be tuning on a phone, so rebuilding for every tweak is not acceptable.

### 10.1 Single source of tunable values

**Every gameplay number lives in one place** and is adjustable without touching game logic. This includes (non-exhaustive):

- **Boats (both, independently):** max speed, acceleration, drag, turn rate, sideways drift, HP per part, water capacity, leak multipliers, passive bilge rate, sink threshold, water-slowdown curve
- **Cannons:** reload time, range, firing arc, damage, shell speed/flight time, accuracy spread
- **Enemy:** preferred range, orbit behavior
- **Global:** player-advantage multiplier, path preview horizon
- **Telegraph:** X ring shrink timing, grace period

### 10.2 On-screen debug panel

- A **live slider panel** accessible on the phone in the running game (via the "Tune" button and ideally a corner toggle during play).
- Changes take effect **immediately or on next run** (immediately preferred where safe).
- A **debug overlay toggle** that shows firing arcs, ranges, target points, and part hitboxes.
- A way to **save/restore a tuning preset** is a nice-to-have.

### 10.3 Game speed

- **1x / 2x** toggle. No in-fight pause in this prototype (pausing adds cross-panel state complexity; revisit later).

---

## 11. Success Criteria

The prototype is successful if a player can, in 5-10 fights:

1. Steer confidently with one thumb and understand what the boat will do (path preview helps).
2. Read incoming fire and dodge it, and feel losses were their fault, not the game's.
3. Glance at the close-up strip and understand their boat's damage and flooding state without confusion.
4. Notice the fight changing shape as parts break and water rises.
5. Want to hit "Again."

### Playtest questions to answer

- Is the two-panel layout usable with a real thumb, or does the thumb cover the action / fight with the strip?
- Does the orbit behavior feel like a feature or a frustration?
- Is the X telegraph readable at a glance on a small screen?
- Is the flight time long enough to dodge and short enough to be tense?
- Does flooding feel like escalating pressure, or like a slow unavoidable death?
- Is the player boat strong enough to feel good, weak enough to be at risk?

---

## 12. Explicitly Out of Scope

Do **not** build these now, but don't make decisions that block them:

- **Lees / crew.** No crew, stations, repair, or bailing. (Future: crew operate cannons and repair parts, and their stats affect load time and accuracy.)
- **Targeting specific enemy parts.** Tap-to-target conflicts with touch-to-seek and needs its own interaction design. Auto-target for now.
- **Boarding / close combat** (grapples, ramming-to-board).
- **Multiple enemies**, Ness monsters, or any non-ship enemy. (Future: Ness emerge from the water with a red-X telegraph, using the same system.)
- **Armor/plating** (structure for it is required in §5.3a; the content is not).
- **Items, upgrades, shops, ports, map, sea selection, boat selection.**
- **Weapon variety** (mortars, scatter shot, incendiary). One cannon type.
- **Fire** as a hazard.
- **In-fight pause.**
- **Landscape layout.**
- **Audio** beyond optional placeholders.

---

## 13. Design-for-Later Constraints

These are architectural *requirements on behavior*, not implementation prescriptions:

1. **Two views, one world.** The ocean view and close-up strip must read the same game state. They are different presentations of the same data.
2. **Shared steering for player and enemy.** One steering behavior, two users. It will later be shared by Ness and other ships.
3. **Path preview uses the real movement behavior.** It must never drift from what the boat actually does.
4. **Parts are data-driven.** A part's HP, water capacity, leak rate, and function come from data, so new boats and parts are content, not code.
5. **Damage supports layered parts** (§5.3a).
6. **Telegraphs are a general system.** The red X for shells should be reusable for any future incoming threat (Ness emerging, bombs, etc.) with a configurable warning time. Warning time is the main difficulty dial for future "seas" (e.g., faster telegraphs for an "Urgency" sea).
7. **Tunables are centralized** (§10).

---

## 14. Open Questions

1. **Release behavior:** when the finger lifts, should the boat continue straight (current default) or something else?
2. **Throttle:** constant speed for now. Is a three-notch control needed in the first playtest?
3. **Close-up strip legibility:** if a thumb in the top panel makes the glance-down model unworkable, what's the fallback? (e.g., a compact damage summary overlaid on the ocean view)
4. **Sprite pipeline:** what's the placeholder-art approach? Distinct per-part sprites plus 3-4 crack overlays is the main asset cost.
5. **Water spread tuning:** how fast should it equalize relative to leak rate?
6. **How many cannons per side** gives a fight with enough shells to dodge without becoming bullet-hell?

---

*End of PRD. Tuning feel is the product here. When in doubt, make it adjustable and let the playtest decide.*
