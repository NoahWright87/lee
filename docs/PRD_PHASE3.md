# Lee — Phase 3 PRD: Close Combat & Boarding

> **Status:** Phases 1 and 2 are built. Boats and Lees shoot each other, crews reallocate themselves, and multiple enemy boats are already in the game.
>
> **This document describes the *product* to build on top of Phase 2, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**.
>
> **Baseline:** Everything in the Phase 1 and Phase 2 PRDs still holds unless this document says otherwise. This PRD describes only what changes or gets added.
>
> **Platform:** Mobile web, portrait-first (unchanged).

---

## 1. Context

So far, every fight has been fought at range. Boats circle, cannons fire, and the crew fixes damage. Phase 3 adds the other half of the game: **getting close.**

Boats can now **dock** with each other or **ram**, and **crew can swing across** to fight on the enemy's deck. A boat that's too close can't be shot by cannons, which makes closing in both an attack and a defense. The enemy does all of this too.

### The question this phase answers

> **Is it fun to close the distance and fight up close, and can you follow a fight spread across multiple decks while other boats are still shooting?**

### Hypotheses to test

1. **Minimum cannon range creates a real tradeoff.** Close = safe from cannons but exposed to pistols, rams, and boarders. Far = safe from boarders but exposed to cannons.
2. **Docking and ramming read as deliberate and fair.** Nothing attaches by surprise, and the player can steer away from an attempt.
3. **Boarding as a use for spare crew feels smart.** Lees with nothing useful to do go fight, and the ones who are needed stay put.
4. **The expanded view is readable.** The player can follow who is fighting whom across two or three decks.
5. **Different enemy boats call for different play.** A boarder wants to close in, a heavy cannon boat is best fought up close, and the standard ship is what we already have.
6. **Ramming feels like a satisfying, risky move.**
7. **Disengaging is a decision the player knows when to make.**

### The core design rule (unchanged)

**No dice where the player needs to reason.** Melee never misses. Boarding decisions are rule-driven and deterministic. Pistols are the exception. They're an inaccurate ranged weapon and follow the same accuracy treatment as cannon spread (see §5.1).

---

## 2. What Changes (Summary)

| Area | Before | Phase 3 |
|---|---|---|
| Cannons | Can fire at any boat in arc and range | Have a **minimum range**. Boats that are too close can't be shelled |
| Boats near each other | Pass by, or collide with no consequence | Can **dock** (gently, side to side) or **ram** (bow into hull, with damage), forming an **attachment** |
| Crew combat | None (shells only) | **Pistols** (ranged, hurt Lees only) and **swords** (melee, same tile) |
| Crew AI | Man stations, repair, bail | Adds **swing across to board**, **fight on a shared tile**, **repel boarders**, **swing back** |
| Close-up strip | One deck | **Expands to show attached decks** while any attachment exists |
| Player controls | Steering | Adds a **Disengage button** while attached |
| Enemy boats | One type (what exists today) | **Three types**: boarder, standard, heavy |
| Result screen | Fight and crew stats | Adds boarding, melee, pistol, and ram stats |

---

## 3. Minimum Cannon Range

- Every cannon has a **minimum range** in addition to its maximum. A target closer than the minimum **cannot be fired on**. **(tunable)**
- The minimum is measured to the target boat, not to individual parts. A boat that's too close is untargetable by that cannon as a whole.
- The rule is identical for player and enemy boats.
- **Consequences that should emerge** (not be scripted):
  - A boat hugging yours can't be shelled by you, and can't shell you.
  - A boat that gets inside a big, slow ship's minimum range is safe from that ship's guns.
  - Staying close is how you stop a cannon-heavy boat from hurting you. Close combat is where it is vulnerable, so it's also how you take it on.
- **The minimum range must be visible** in the debug overlay, and ideally as an optional faint ring around a boat while the player is touching the ocean panel.

---

## 4. Attachments: Docking and Ramming

An **attachment** is a physical link between two opposing boats. It's what lets crew cross between them.

### 4.1 Attachments only form between opposing sides

Boats on the same side never dock or ram each other. Only the player's boats and enemy boats attach to each other.

### 4.2 Docking (gentle, automatic)

- When two opposing boats come **close enough** (docking distance, **tunable**), stay within it for a short **grapple time** (**tunable**, around 1–2 seconds), and are **moving slowly relative to each other**, they **ease together and stick**.
- Docking is **automatic**. The player doesn't press a button to dock. The player controls it by steering: approach and linger to dock, or steer away to avoid it.
- **Brushing past isn't docking.** The grapple time and the relative speed requirement keep a quick pass from attaching.
- Docking causes **no damage**. Boats end up **side by side**, close enough for crew to swing across (not overlapping).

### 4.3 Ramming (fast, damaging)

- A **ram** happens when a boat's **bow** hits another boat's hull **head-on at or above a closing-speed threshold** (**tunable**).
- **Damage:** the ramming boat's **bow part** and **the part struck on the other boat** both take damage, scaled by closing speed. **(tunable)**
- After a ram, the two boats are **attached**, nose into hull, and crew can cross, just as in a dock.
- **Ramming is a risk/reward move.** It hurts both boats. Because the cannon minimum range then applies, it can pin an enemy so it can't shoot you, and pistol fire can finish off its crew.
- Slow contact is a dock. Fast bow-first contact is a ram. Fast contact that isn't bow-first (a glancing side-swipe) should **not** attach. A simple bump with a small bounce is fine. **(tunable)**

### 4.4 Telegraphs (hard requirement)

Phase 1's principle holds: **the player should never be surprised by an attachment.**

- A boat attempting to **dock** shows a **progress ring** on the target during grapple time, so the player can see it coming and steer away.
- A boat about to **ram** shows a **red X at the predicted impact point on the hull** (the same visual language as incoming shells: red means "this will hurt you"), with a warning window the player can use to dodge. The warning time is tunable. **(tunable)**
- The player's own ram and dock attempts show an equivalent marker on the target, in a neutral color (not red).

### 4.5 What attached boats do

- **While attached, the boats' own propulsion and steering are overridden.** The attached pair drifts together at a slow speed. Rowing and steering sails have no effect. (This is why rowers and sail hands are the first to go and fight. See §7.)
- Attached boats **keep working otherwise**: crew repair and bail, flooding spreads and sinks, and cannons that have valid targets can fire (see §4.6).
- Steering input does nothing while attached, and the path preview is hidden. **Disengaging restores control.** (See §4.8.)

### 4.6 Firing rules while attached

These are the rules as specified by the designer:

- **Cannons never fire at a boat they're attached to** (and the minimum range would prevent it anyway).
- **A boat doesn't fire on a boat that's attached to its ally.** An enemy boat won't shell *your* boat while your boat is docked to another enemy.
- **Attached boats can fire outward at other boats.** A boat docked to a boat on its left can fire its right-side cannons at a boat to the right.
- **Pistols are unaffected by these rules.** They only hurt Lees on opposing boats (§5.1).

**This has a consequence to be aware of:** because allied boats won't fire on a boat attached to their friend, **docking with one enemy shields you from the others.** That can be a smart tactic (take a weak ship hostage) or an exploit. The first version should follow the specified rule, and the playtest should decide. **See §15, question 1.**

### 4.7 Multiple attachments

- A boat can be attached to **more than one** other boat, for example docked to one on its port side and another on its starboard side.
- At most **one attachment per side** (port, starboard, bow, stern), and a **total cap** on simultaneous attachments per boat (default **2**). **(tunable)**
- All attachment rules apply to each link independently.

### 4.8 Disengaging

- **While a boat is attached, a Disengage button is shown** (see §8). With multiple attachments, there's **one button per attached boat**, placed next to that boat's deck in the expanded view.
- **Pressing it starts a short recall window** (**tunable**, ~2 seconds) in which all boarders from your crew on that boat **swing back** to their home boat. When the window ends, the link breaks and **both boats are pushed apart slightly**, enough that the player can turn and leave. **This push applies after a ram as well.**
- After disengaging from a ram, the player can **turn and ram again** if they want.
- **Enemy boats don't disengage voluntarily** in this phase (see §13).
- Enemy boarders **recall the same way** when a link is about to break, whatever the cause (§4.9), so nobody is stranded.

### 4.9 When a link breaks automatically

- A boat that **sinks** breaks all of its links. Its crew and its boarders get a short evacuation window (§6.4).
- If an attached boat is **destroyed or dissolves**, the other boat is released.
- When a link breaks for any reason, the **recall rule applies**: boarders swing home first, if they can.

---

## 5. Close-Combat Weapons

Both weapons only hurt **Lees**. Neither is a way to sink a boat.

### 5.1 Pistols

- Every Lee carries a **pistol**.
- **Pistols hurt Lees on opposing boats only.** They never hurt friendly Lees (own crew or allied boats). They do **almost no damage to the boat itself** (a small, tunable value, so shooting a hull isn't useless but isn't a plan).
- **Slow and inaccurate.** Pistols fire at a low rate and don't always hit. Use the **same accuracy treatment as cannon spread**, so the project has one accuracy model. **(tunable)**
- **Short range.** The range must cover the gap between attached boats and extend a little past it. **(tunable)** Pistols work **whether or not a Lee has swung across**: a Lee on its own deck with an enemy deck attached next to it can still shoot at enemy Lees in range.
- **Pistol fire doesn't pull a Lee off its post.** A gunner or rower with an enemy in pistol range can shoot while still doing its job. (See §7.)
- Pistols are what make **ramming a finisher**: pin a wounded boat so its cannons are silent, then shoot its crew.

### 5.2 Swords (melee)

- Lees on a **shared tile with an opposing Lee** fight in melee.
- **Melee does more damage than a pistol and never misses.** **(tunable)**
- Each Lee in melee attacks **one** opposing Lee on its tile. Target selection is **deterministic**: lowest HP first, ties broken by a fixed order (for example a stable Lee ID). Multiple Lees can occupy one tile. More friends on a tile means more damage dealt, so ganging up works.
- A Lee in melee is **engaged**. It stops other tasks until no opposing Lees remain on its tile.

### 5.3 New Lee stats

All Basic Lees use the same values. They must be **editable per Lee**, like the Phase 2 stats.

| Stat | What it affects |
|---|---|
| **Melee damage** | Damage per sword hit |
| **Melee rate** | Sword hits per second |
| **Pistol accuracy** | How often pistol shots hit |
| **Pistol rate** | Shots per second |
| **Swing speed** | How quickly a Lee crosses between boats |

---

## 6. Boarding

### 6.1 Swinging across

- Lees **don't walk across a gangplank.** Boats don't need to line up tile for tile. A Lee **swings** across the gap: it leaps and lands on the other boat after a short swing time (**tunable**). **Swinging is only possible while attached.**
- **Landing tile:** each Lee lands on the tile of the other deck **nearest** to the one it left, based on how the boats are positioned relative to each other. The rule must be **deterministic**, and it must handle decks of different sizes.
- **While swinging, a Lee can't act** (it can't fight or be attacked normally; whether it can be hit in mid-air is **tunable**).

### 6.2 Fighting on the enemy deck

Once on the enemy deck, a boarder:

- **Moves toward the nearest enemy Lee** to fight in melee.
- **Fires its pistol at any enemy Lee in range** while it has no melee target (and while walking).
- **Melees when it shares a tile** with an enemy Lee.
- **Doesn't harm the enemy boat** beyond the negligible pistol damage. Boarders kill crew, which silences cannons and stops repairs and bailing. They aren't saboteurs in this phase.

### 6.3 Defending

- **Enemy Lees on your deck** are a threat to your crew. Your Lees defend (§7).
- A Lee that shares a tile with an enemy Lee **fights back**, even if it's a gunner at its post. It's engaged until the tile is clear.

### 6.4 Swinging back

Boarders **swing back to their home boat** when any of these is true:

- **No enemy Lees remain on the boat they boarded.**
- **The boat they boarded is sinking.** "Sinking" for this purpose starts when water passes an **evacuation threshold** (**tunable**, a fraction of the sinking threshold, around 90%) so Lees have time to get out.
- **The link is about to break** (disengage, §4.8).

After landing on the home boat, a Lee walks back toward its home tile, as in Phase 2.

If **a boarder's home boat sinks while it's on the enemy's deck**, it's lost with the loss of the fight. (Capturing the other boat is a possible future feature, not part of this phase. See §15.)

---

## 7. Crew AI (Additions)

**There is still one crew AI, for both sides, and Phase 2's rules (home role, urgency, stickiness, claims, commitment time, deterministic tie-breaking) all still apply.** Phase 3 adds tasks and urgency tiers.

### 7.1 New tasks

- **Swing across to board** (only while attached)
- **Fight** (melee on a shared tile, or move to engage)
- **Shoot pistol** (secondary action, not a full task)
- **Swing back / recall**

### 7.2 Surplus: who goes to board

The designer's rule: **a Lee goes to board when its station isn't needed.** A Lee is **surplus** when its current task contributes nothing right now:

- A **cannon that has no valid target** (the enemy is out of arc, or too close, or it's an attached boat)
- **Oars and sails**, while attached (propulsion and steering are overridden, so there's nothing to do)
- A **lookout** with nothing to spot
- **Idle** at home

A Lee is **not** surplus when:

- It's at a **cannon that can fire at an enemy** (it keeps shooting)
- It's **actively bailing or repairing** something that needs it (it keeps working)
- It's **engaged in melee**

When attached, surplus Lees **swing across and fight.** If no attachment exists, surplus Lees do what they did in Phase 2: they return home, or help where needed.

### 7.3 Default urgency additions (highest first), (tunable)

Phase 2's ladder stands. Phase 3 inserts:

1. **Engaged in melee:** forced; the Lee fights until its tile is clear
2. *(Phase 2: flooding emergency)*
3. *(Phase 2: function-gating damage)*
4. **Repel boarders:** enemy Lees on your deck, and a Lee with spare capacity nearby
5. *(Phase 2: cannons that can engage now)*
6. *(Phase 2: other damage and water)*
7. **Board the attached boat** (surplus Lees only)
8. *(Phase 2: mobility, lookout)*

Mobility and lookout stations rank below boarding **only while attached**, which is when they are useless anyway. Otherwise they follow Phase 2's ladder.

The ladder is a starting point. The requirement is that **the order is explicit, tunable, and visible in debug.**

### 7.4 Required behaviors (examples that must work)

These must emerge without special-casing:

1. **Docked on one side.** A boat docks to an enemy on its port side. Port-side gunners have no valid target (it's attached and too close), so they are surplus and swing across. Starboard-side gunners with a valid target on that side keep shooting.
2. **Rowers and sail hands.** When the boat attaches, rowers and sail hands have nothing to do, and go fight.
3. **Flooding wins.** A Lee actively bailing a dangerous flood keeps bailing and doesn't board.
4. **Enemy boards you.** When the enemy has surplus crew and attaches to you, it sends them over. Your crew near the boarders respond.
5. **Cleared deck.** When the last enemy Lee on a boat dies, your boarders swing home.
6. **Sinking deck.** When the boat they're standing on is about to sink, boarders swing home.
7. **Pistols first.** After a ram, with no one yet across, Lees with spare capacity shoot at enemy Lees in range.
8. **Thrash check.** Lees don't swing across and back repeatedly because of marginal changes. Phase 2's stickiness and commitment rules apply to swinging.

### 7.5 Same AI for both boats

Everything above is true of enemy crews. **Enemy boats board your boat by the same rules**, subject to their boat type (§9).

---

## 8. What the Player Sees

### 8.1 The expanded view

When **any attachment exists**, the **bottom panel expands** to show **your deck plus every attached deck**. When all attachments end, it **returns to the Phase 1/2 strip size.**

- The decks are **arranged in the direction of the attachment** as much as screen space allows. A boat docked to your port side appears above your deck; one on your starboard side appears below (matching the strip's orientation, where port is up). A rammed boat appears in the direction of the ram.
- **Both sides' Lees are clearly distinguishable.** A friend and an enemy must be told apart at strip size (distinct colors or outlines, in addition to any sprite difference). This matters most for Lees on a foreign deck.
- **Your Lees on an enemy deck show a marker at their home tile** (the Phase 2 ghost marker), so you can see who's away.
- **Swinging is a visible animation** (a Lee arcing across the gap), so it's clear where each Lee is going.
- With **more than one attachment**, the panel may need to show three decks. If that doesn't fit, prefer showing **the decks with active fighting** at readable size and shrinking the quiet ones. See §15.
- **The ocean panel continues to run.** The player can still see other boats, incoming shells, and red X telegraphs.

### 8.2 The Disengage button

- A **Disengage** button appears **per attached boat**, beside that boat's deck, whenever an attachment exists.
- It's **large enough to hit with a thumb** while the fight is moving, and must **not** be placed where a resting thumb could press it by accident.

### 8.3 During the fight

- **Steering is disabled while attached**, and the player's input in the ocean panel does nothing (no path preview).
- Crew behavior shows through the Phase 2 task icons and progress bars, plus new icons for **sword**, **pistol**, **swinging**, and **recalling**.
- **Melee should be easy to read:** two Lees on one tile should look like they're fighting (shared wiggle or a small flash on hits), not like two sprites on top of each other.
- **Minimum range rings** can be shown on request (§3).

---

## 9. Enemy Boat Types

Three types, to change how fights play. **Names are placeholders** in the spirit of the game's puns.

| Type | Placeholder name | Role | Crew | Cannons | Speed | Hull |
|---|---|---|---|---|---|---|
| **Boarder** | **Friend Ship** | Closes in to dock or ram, then sends crew over | **Many** | **Few** | Fast | Light |
| **Standard** | *(what exists today)* | Orbits at cannon range | Medium | Medium | Medium | Medium |
| **Heavy** | **Hard Ship** | Big and slow, with a lot of guns. Hard to fight at range, easier up close | Medium to many | **Many** | **Slow** | Heavy |

### 9.1 Boarder

- Prefers to **close to docking distance** and **attach**, or ram if it has a clean line.
- Once attached, its surplus crew swing over by the normal rules.
- With few cannons, it's weak at range. The threat is being boarded, not being shelled.
- Counterplay: sink it before it arrives (it's lightly built), outrun it, or board it first.

### 9.2 Standard

- Behaves as it does today: closes to its preferred range and orbits. It may board only if the situation produces it by the normal rules.

### 9.3 Heavy

- **Many cannons, slow turning, a big deck, a big crew.** Its guns cover wide arcs. At range, it's dangerous.
- **Its minimum range is the answer.** Slipping inside it makes its guns useless, and you can fight it with pistols and a boarding party.
- It stays at range and tries to keep its broadside on the player. Because it's slow, the player can outmaneuver it and dock, which is the intended answer.

### 9.4 Common requirements

- Each type is **data**: grid layout, stations, cannon count, crew count and stats, speed and turn rate, part stats, and AI preferences (preferred range, whether it seeks to attach). Adding a new type shouldn't require code changes.
- **Enemy types share the same crew AI** (§7), and the same steering behavior as the player's boat.
- The **tuning panel needs an encounter picker** so the designer can spawn any mix, for example one Boarder, one Standard, and one Heavy, or two Boarders at once.

---

## 10. End of Fight

### 10.1 Win/lose

Unchanged: a boat sinking is how fights are decided. **Killing all of a boat's crew doesn't sink it.** A boat with no living crew is **derelict**: it can't fire, row, or bail, but it still floats. Its flooding continues, and the passive bilge from Phase 1 still works.

Winning against a derelict boat means sinking it (disengage and shell it, or let it flood). Capturing or salvaging a derelict boat is a likely future feature (§15).

### 10.2 Result screen additions

- **Boardings** (swings across), and time spent on enemy decks
- **Melee:** kills and damage dealt/taken
- **Pistols:** shots fired, hits, damage dealt
- **Rams:** performed, received, and damage
- **Docking time**
- **Disengages**
- **Lees lost**, split by cause (cannon impact, melee, pistol)
- The Phase 2 per-Lee breakdown, extended with time on enemy decks and time engaged in melee

---

## 11. Tuning & Debug (Additions)

Phase 1 and 2's single-source tuning principle applies. New tunables include:

- **Minimum cannon range**
- **Docking distance, grapple time, relative-speed limit**
- **Ram closing-speed threshold, ram damage (both sides), bounce behavior**
- **Telegraph warning times** (ram X, dock ring)
- **Attachment cap and per-side limit**
- **Attached-pair drift speed**
- **Disengage recall window and push-apart distance**
- **Evacuation threshold** (fraction of sinking threshold)
- **Swing time** and whether swinging Lees are hittable
- **Pistol:** damage to Lees, damage to boats, range, rate, accuracy
- **Melee:** damage and rate
- **Urgency ladder additions** and the surplus definition
- **Enemy boat types:** every stat in §9.4
- **Encounter picker** (spawn any mix of enemy boats)

**Debug overlay additions:**

- Attachment links, docking proximity, and grapple-timer state
- **Min-range rings** and pistol range
- **For each Lee: the current task and a one-line reason**, including boarding decisions (for example *"cannon 2 has no valid target: attached to Friend Ship → swinging across"*)
- Melee engagements and target selection
- The same for enemy Lees and boats

**"Why did that Lee swing across?" must always be answerable.**

---

## 12. Success Criteria

The phase is successful if a player can, in 5–10 fights:

1. **Understand docking and ramming without an explanation**, and avoid them when they want to, using the telegraphs.
2. Use closing in **deliberately**, as an attack or a defense.
3. Watch their crew board and **understand who went and why**.
4. **Follow a fight across two decks** without losing track of who is who.
5. Say, after a loss, **what happened** ("they boarded us and killed the gunners," "I rammed and got my bow wrecked," "I should have disengaged").
6. Feel that **the three enemy boat types call for different plans**.
7. Want to hit "Again."

### Playtest questions

- Does the **minimum range** make close combat feel like a real choice?
- Does auto-docking feel **fair**, or does it ever attach when the player didn't want it?
- Is the **expanded view readable** with two attached decks? With three?
- Do the **right Lees** go to board, or does boarding strip crew who were needed?
- Is **ramming** worth its cost?
- Is the **Disengage** button easy to find and press at the right moment?
- Does **being boarded** feel threatening and fun, or just frustrating?
- Does the **human shield effect** (§4.6) become the dominant strategy?
- Are **pistols** useful, or just noise?
- Are melee fights **too fast or too slow** to read?

---

## 13. Explicitly Out of Scope

Do **not** build these now, but don't make decisions that block them:

- **Ness monsters and any non-ship attacker.** (Latching Ness will reuse this attachment system. See §14.)
- **Capturing, salvaging, or taking over derelict boats.**
- **Enemy boats voluntarily disengaging.** They stay attached until the link breaks.
- **Player orders to the crew** beyond the Disengage button. There's no manual "board now" command.
- **Boarders sabotaging boats** (setting fires, smashing parts, opening hull breaches).
- **Fire and other tile layers.**
- **Different Lee types and unique abilities.** All Lees are Basic Lee.
- **New weapon types** (different pistols or swords, cannon variety).
- **Boarding by non-crew units.**
- **Hiring, shops, ports, the map, the run structure.**
- **Landscape layout.**

---

## 14. Design-for-Later Constraints

1. **Attachments are general.** The system should work for any attacker that can link to a boat, so a **latching Ness** can reuse it. A Ness would attach to a boat, expose "tiles" where its crew-equivalents fight, and break the same way. Don't assume both sides of a link are ships.
2. **Close combat is data-driven.** Weapons and their stats (damage, rate, range, accuracy, targets they can hurt) are content, so a new weapon is data, not code.
3. **One crew AI, any unit.** The same AI drives player Lees, enemy Lees, and later monster crews.
4. **Boat types are data** (§9.4). New enemy boats, including later bosses, are content.
5. **Swinging is general.** It should work between any two attached decks, whatever their size or shape.
6. **Lee variety plugs in.** Different Lee types will differ in core stats (including the new close-combat ones) and gain unique abilities. A Lee that's good with swords should be drawn toward boarding by the AI's weighing of stats.
7. **Derelict boats are a state.** Capture or salvage will later hook into it.
8. **The expanded view scales.** It should handle more attached decks than the default cap, even if the cap stays small for now.
9. **All earlier constraints still apply:** two views of one world, shared steering, an accurate path preview, a general telegraph system, data-driven and layered parts, centralized tunables.

---

## 15. Open Questions

1. **The human shield effect (§4.6).** As specified, allied boats won't fire on a boat attached to their friend, so docking with one enemy protects you from the rest, and you can still shoot outward. That could become the dominant strategy. An alternative is a **landing-point rule**: boats hold fire only when a shell would land on a friendly boat, which lets the others shoot at you when they have a clear shot. Start with the specified rule and watch for it in playtests.
2. **Stray shells and friendly boats.** Do shells that land on a friendly boat damage it? How should cannons avoid shooting through allies? (The landing-point rule above would handle this too.)
3. **Boarders whose home boat sinks.** Right now that's a loss. Should surviving boarders ever capture the boat they're standing on?
4. **Recall window.** Is ~2 seconds right? Should enemy boarders also be pushed off, or can they get stranded on your deck if the link breaks quickly?
5. **Dock vs. ram thresholds.** How do we tune the line between a gentle dock, a ram, and a bump so the player always understands which will happen?
6. **Attached boats and steering.** Overriding propulsion while attached keeps things simple. Does it feel bad to lose control entirely, or does it make the Disengage decision more meaningful?
7. **Expanded view with three decks.** What's the best layout on a phone? Do we cap attachments at two to avoid it?
8. **Engaged gunners.** Should a gunner at a post keep loading while it fights, or does it stop? Stopping makes boarders deadlier.
9. **Pistol accuracy model.** Does the pistol use the same spread treatment as cannons, or a simple hit chance?
10. **Whether pistols can hit across the gap without docking.** How close is "in range," and does it happen too often to matter?
11. **Whether idle Lees should be allowed to *refuse* to board** (for example, keep a minimum number of Lees on their home boat). A single tunable "minimum home crew" could prevent a total stripping of the deck. Not required, but worth watching.

---

*End of Phase 3 PRD. As before: tuning feel is the product. When in doubt, make it adjustable and let the playtest decide.*
