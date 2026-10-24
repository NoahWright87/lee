# Lee — Phase 7 PRD: Close Quarters

> **Status:** Phases 1–6 are built: steering, ranged and close combat, a self-organizing crew of Lees with jobs and action buttons, four preset ships, equipment, leveling, permadeath, and a full run: ports, gold, shops, budget-built enemies, and an endless sea map. Open items are in [`TODO.md`](TODO.md).
>
> **This document describes the *product* to build on top of Phase 6, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**. Everything in the Phase 1–6 PRDs still holds unless this document says otherwise.
>
> **Platform:** Mobile web, portrait-first (unchanged).
>
> **Workflow:** One phase per session. Build on a branch, open a PR to `main` (the preview deploy is how it gets validated), and build in the slices of §13 so each can be playtested.
>
> **What's next:** Phase 8 adds Nesses, the non-boat enemies ([`PRD_PHASE8.md`](PRD_PHASE8.md)). Phase 9 is bosses ([`PRD_PHASE9.md`](PRD_PHASE9.md), still to be planned). Much of this phase is groundwork Nesses need: connections that pull, taps on deck targets, and danger zones on the deck.

---

## 1. Context

At long range the game works: you steer, read the red X's, dodge, and line up your guns. Good piloting is rewarded.

Once two ships meet, it falls apart:

- **Contact is instant.** Get close and the boats are suddenly side by side. There's no moment to react.
- **You lose control.** Once boarded, there's little to do but watch. The job buttons helped, but close combat is underwhelming at best and frustrating at worst.
- **It's unfair.** Once the Friend Ship catches you, you can't get away. If your crew isn't strong, the fight is already lost. **Hard requirement: when you lose, it must be because of what you did, not because the game didn't give you a way out.**
- **Boarding is too safe.** Boarding with a strong crew is a near-guaranteed win. It should be a risky move with a bigger payoff.
- **Everyone is too accurate**, at every range.

### The question this phase answers

> **Is close combat a tense, readable fight you can steer, as much as long range is, without the game getting more complicated?**

### Core design principles

**1. Close combat has stages you can see coming.** Ships drift into close range, get hooked, are slowly pulled together, and only then can Lees cross. Each step can be answered.

**2. You pick the target; the game picks the Lee.** Tapping something on your deck (a rope to cut, a flooded tile) says *what* to do. The existing best-fit logic picks *who* does it, the same way the job buttons do today.

**3. No micromanaging individual shots.** Pistols, swords and close-range guns keep fighting on their own. Your taps are about the big things: lines, crossings, breaking away, who's on which job.

**4. Every way in has a way out.** Hooks can be cut, planks destroyed, ropes cut, boats shoved apart. A fast boarder can still catch you, but you can always fight your way loose, at a cost.

**5. Boarding is a gamble.** It's slower to set up, it exposes your Lees, and it's the only way to win the best spoils.

### Hypotheses to test

1. Pulling boats together slowly (instead of snapping) gives enough time to react, and feels tense instead of unfair.
2. Tapping deck targets (cut this rope, bail here) gives meaningful control without overwhelming the player.
3. Breaking away (cut the lines, mash SAIL, steer off) is a real skill, and losing a grapple feels like your mistake.
4. Making boarding riskier and better paid makes it a decision instead of the default.
5. Crew bars read better than pips, and make crew changes easier to follow.
6. Slowing to 1× as boats close (from whatever speed you sail at) makes close combat playable without making the open sea boring.

---

## 2. What Changes (Summary)

| Area | Phase 6 | Phase 7 |
|---|---|---|
| Game speed | Two speeds (sailing, close combat), switched when boats get close | Sailing speed **blends down** to close-combat speed as an enemy comes into pistol range (§3) |
| Ranges | Long range, then contact | **Long range → close range → melee**, each with its own rules (§4) |
| Accuracy | Everyone is very accurate | An accuracy pass; enemies near their allies **hold fire** (§5) |
| Getting into contact | Close enough = in contact, instantly | **Lines** (hooks) slowly pull boats together; Lees cross only by **ropes** and **planks** (§6) |
| Rail gadgets | Passive bonuses | Most are **tapped to use**: throw hooks, swing ropes, lower planks, push off (§7) |
| Commanding crew | Job buttons only | Job buttons plus **tapping targets on the deck view** (§8) |
| Getting away | RETREAT, which rarely works against a faster boarder | **Cut the lines, mash SAIL, steer off**; push off with poles; hooks have a cooldown (§9) |
| Boarding rewards | Capture = crew all dead, one random part | Better spoils for a clean capture; **surrender mid-fight** joins you and fights (§10) |
| Enemy behavior | AI profile by encounter | Profile by **chassis style** for close combat too, with **hesitation** as a difficulty lever (§11) |
| Crew display | Pips under the four buttons | **Crew bars**, one column per Lee, grouped by role (§12) |

---

## 3. Speed

There are two speed settings today: one while sailing and one in close combat. Boats are slow, so players sail at 3×, which makes the instant switch to close combat jarring.

- **The game blends from the sailing speed to the close-combat speed as an enemy comes into close range** (pistol range, §4). It slows gradually over a short distance, not with a snap. **(tunable: start and end distances)**
- **Close-combat speed is 1× by default and is a setting**, like sailing speed today. Someone who finds close combat slow can speed it up. **Hard requirement: both speeds stay player settings.**
- Phase 8 uses the same blend when a Ness surfaces next to you, so the slowdown becomes a dramatic beat.
- The speed button keeps showing which setting it's changing (sailing or close combat).

This isn't slow motion. It's that the open sea runs fast because sailing is slow.

---

## 4. Three ranges

| Range | Distance | What happens | What you do |
|---|---|---|---|
| **Long** | Beyond pistol range | Cannons and long guns; shells with red X's | Steer, dodge, position your guns (unchanged) |
| **Close** | Within pistol range, not yet connected | Pistols and close-range guns (Gatling, Scrap Cannon, Carronade) fire on their own; **hooks are thrown**; other enemy ships mostly hold fire (§5) | Throw or dodge hooks, cut lines, decide whether to board or break away, move Lees between jobs |
| **Melee** | Connected by a plank or rope, or Lees on the other deck | Lees cross; swords (stronger than pistols up close); pistols keep firing | Tap deck targets (§8), choose who crosses, call boarders back, break away (§9) |

- Ranges are about distance and connections, never a mode the game snaps into. You can drift from close back to long range any time you're not held by lines.
- **Ramming stays.** Tapping an enemy ship targets it; the ⚔️ button offers **RAM** when your angle allows (as today), otherwise you just approach. The old BOARD autopilot becomes "approach and come alongside"; it no longer guarantees contact.

---

## 5. Accuracy and holding fire

- **Accuracy pass (hard requirement: noticeably less accurate at range).** More scatter with distance, worse leading of a moving target, and much worse when the *shooter's own boat* is turning hard **(all tunable)**. Dodging must stay the main defense, but a shell shouldn't track you perfectly.
- **Enemies near their allies hold fire.** An enemy gunner whose shot could land near a friendly ship fires much less often, or not at all **(tunable)**. Friendly fire is already on; this makes the AI respect it.
- The effect is intended: **getting close to one enemy shelters you from the rest of a pack.** That's a tactic with its own risk, since now you're within hook range.
- Your own gunners follow the same rule (they won't fire into a ship your boarders are on).

---

## 6. Connections: hooks, ropes and planks

The old instant contact goes away. Boats are connected by **lines** you can see, and they come together slowly.

### 6.1 Hooks (lines that pull)

- A ship with **Boarding Hooks** (a rail item) can **throw** them at a ship in close range. A throw is **telegraphed**: the hook arcs across, and it lands after a short delay. Steering away before it lands dodges it **(tunable range and flight time)**.
- A hook that lands is a **line** between the two hulls. Lines **pull the boats together slowly**.
  - **More lines pull faster.**
  - **Bigger boats are harder to pull** (each ship has a mass or size, **tunable per ship**).
  - A boat sailing away drags against the lines; with enough rowing it can slow the pull, but it can't escape while lines hold.
- **Hard requirement:** contact must take long enough after the first hook to react. The tension of "here they come, CUT THE ROPES!" is the point. **(tunable: pull speed per line)**
- **Lines can be cut** (§8): a Lee walks to the rail and hacks at it. Each line has a little HP **(tunable)**.
- **Hooks have a cooldown** once their line is cut or breaks **(tunable)**, so a cut line buys real time.

### 6.2 Crossing needs a way across

**Lees cross only by ropes or planks.** Being close is no longer enough.

- **Swinging Ropes** become a **rail item** (they're a treasure today). Tap them to send ⚔️ Lees across, one at a time, at the speed they swing now. Each rope is one lane. Ropes need the boats within swing range. Ropes can be cut (the Lee mid-swing falls short: extra damage, back on their own deck, §8.4).
- **Boarding Planks** (a rail item already): tap to **lower** them once the hulls are close enough. A plank lets several Lees walk across, faster than swinging. An enemy plank on your rail can be **destroyed** by tapping it.
- A boat with neither can still be boarded, but can't board anyone.
- The enemy uses the same items and rules.

### 6.3 Pushing off

- **Push Poles** (new rail item) shove the boats apart when tapped (needs the lines cut first, or it only strains against them).
- Without poles, breaking away is all rowing and steering (§9).

### 6.4 Passive items stay passive

Not every rail or hull item is tapped. **Iron Plating, Spikes, a Fence and the like work on their own**, as now. Only things that are *used* (hooks, ropes, planks, poles) are tap targets.

---

## 7. What can be tapped on deck

The deck view (bottom of the screen) becomes a place where you command, as well as watch.

| Tap | What happens |
|---|---|
| Your **Boarding Hooks**, with an enemy in reach | Throw a hook at the ⚔️ target |
| Your **ropes** / **planks** | Send ⚔️ Lees across / lower the plank |
| Your **push poles** | Shove off |
| An **enemy line** on your rail | Cut it |
| An **enemy plank** on your rail | Destroy it |
| An **enemy rope** with a Lee swinging on it | Cut it (they fall short) |
| A **flooded tile** | Bail there first |
| A **damaged** part or tile | Repair it first |
| An **enemy deck tile** where your boarders are | Your boarders head there (the part of their deck you want to take: their gunners, their powder store) |

- **Tapping your own boat at the top of the screen still means stop**, as now. Tapping your boat in the deck view (the bottom) is always a command. No separate stop button is needed.
- Tap targets are generous, as everywhere on phones.
- **Sandbox and debug** show the tap targets and who answered.

---

## 8. You pick the target; the game picks the Lee

### 8.1 Who answers a tap

The best-fit logic the job buttons use already picks which Lee changes job. A tap reuses it: the target is chosen by you, the Lee by the game.

- Each target has a role: cutting lines and destroying planks is ⚔️ or 🛠️ (whichever is closer and free), bailing and repairing is 🛠️, crossing is ⚔️, throwing hooks and pushing off is whoever's nearest.
- The answering Lee keeps its job and comes back to it when done (it isn't reassigned), unless the target needs a job change (crossing makes it ⚔️).
- Repeated taps on the same target send more Lees, like holding a job button.

### 8.2 Feedback

- The tapped target shows a marker until someone is on it, and a progress ring while it's being done.
- The answering Lee's bar is highlighted while it's on an order (§12).

### 8.3 Enemies do it too

The enemy AI cuts your lines, lowers planks and sends boarders by the same rules, with **hesitation** (§11).

### 8.4 Hitting hard things

When something pushes a Lee into a hard surface (a fall short from a cut rope, a knock into the rail), it takes **extra damage**. There's no overboard yet. This is shared with Phase 8, whose tail slaps push Lees around.

---

## 9. Breaking away

**Hard requirement: there is always a way out, and it's a skill.**

1. **Cut every line** (tap them, or let the 🛠️ and ⚔️ Lees do it).
2. **Mash ⏩ SAIL** to put Lees on the oars and sails.
3. **Tap the open ocean** (top screen) to steer away.
4. If you have push poles, **tap them** to shove off.

- **The enemy can't re-hook right away** (the cooldown, §6.1). It can chase, but if you've thinned its crew or it's slower, it may not catch you.
- **Lees left on the other deck keep fighting.** You can sail back to pick them up: within swing range, they come home on your ropes or theirs. If one of theirs is left on your deck, he fights on (and is probably doomed).
- **Maneuvering stays one job.** ⏩ SAIL already mans both oars (speed) and sails (turning); mashing it is how you break away.
- RETREAT stays as the label on ⏩ while you're connected or have boarders out, but it doesn't cut loose on its own anymore. You have to cut the lines.

---

## 10. Boarding: risk and reward

### 10.1 Risk

- Crossing is slow and exposed: one Lee at a time on a rope, a few on a plank. Ropes can be cut under them.
- Boarders can be stranded if the lines are cut and the boats drift apart.
- Defenders on their own deck fight with swords and pistols, and the enemy can send its whole crew back to repel you.

### 10.2 Reward

- **A clean capture pays better.** If your boarders kill the crew and the ship is left afloat, you can take **a whole working part of your choice** from its intact tiles (a working cannon, a sail), not just a random one. **(tunable: one pick from the intact parts)**
- **Surrender in the middle of a fight.** When you're clearly winning (their crew down to one, or badly outnumbered **(tunable)**), their last Lee may throw down its sword and **join you right there**. It comes home with your boarders and fights for you against any other ships in the fight.
- Sinking is still gold only.

---

## 11. Enemy behavior by style

Ships already have tags and styles. These now drive close combat, too:

| Style | Close-combat behavior |
|---|---|
| **Boarder** (Friend Ship, Board tags) | Rushes in, throws hooks early, lowers planks, sends most of its crew across |
| **Heavy** (Hard Ship, Barrage) | Keeps its distance and bombards; **cuts your lines quickly** and resists boarding |
| **Skirmisher** (Long Distance, Skirmish) | Keeps away; breaks off at the first hook |
| **Standard** | Fights where it is; boards if it's winning |

- **Hesitation is a lever.** Every enemy decision in close combat (throw a hook, cut a line, cross, run) waits a short, random delay **(tunable)**. Less hesitation = harder. **Difficulty sets it** (Easy hesitates more).
- AI profiles stay data: hesitation, hook range, how much of the crew crosses, when to break off.

---

## 12. Crew bars (replacing pips)

### 12.1 Layout

- For each role, a **square-ish icon** (⏩ 🔫 ⚔️ 🛠️), lined up down one side of the screen.
- Beside each icon, **one column per Lee** in that role.
- The width per role is capped: more Lees in a role means **skinnier columns** that still fit.
- Under the columns, **one small portrait (or symbol) per Lee type**, under the group of that type. Six Quick Lees on the guns are six bars with one Quick Lee symbol under them.
- **Tapping a role icon** does what tapping a job button does now: the game picks a Lee and moves them.
- The action buttons may move to the sides of the screen to make room. **Where exactly is for playtesting**: buttons and bars must stay thumb-reachable and mustn't get in the way of taps on the deck view **(implementation's call, then playtest)**.

### 12.2 A bar

- **Height = HP**, colored by Lee type.
- **Damage flashes red**, then the red part drains away, to draw your eye.
- **Up/down chevrons** (or + / −) above a bar show buffs and debuffs.
- **A highlighted border** while the Lee is on an order (§8.2).
- When a Lee changes role (a button, a tap on deck), **its bar slides** from one row to the other over the time it walks there, as pips do now.
- On death, a short effect, and the column closes.

### 12.3 Later

The bars have room for more: armor shaded on top, damage over time as a band, status effects on the border. **Decide those when the systems that need them exist** (Phase 8 and later).

### 12.4 Enemies

The engaged enemy's bars appear when close combat starts, as enemy pips do today (one ship, only then).

---

## 13. Build order (slices, each playtested)

1. **Speed blend and accuracy** (§3, §5). The blend to close-combat speed, the accuracy pass, enemies holding fire near allies.
   *Done when:* sailing at 3× slides into close combat at 1× with no snap, and you can stay alive in a pack by closing on one ship.
2. **Lines and crossings** (§6). Hooks thrown and dodged, lines that pull by count and mass, cutting, cooldowns, ropes and planks as the only way across, push poles. The enemy uses them by style (§11).
   *Done when:* the Friend Ship takes several seconds to haul you in, and cutting its lines in time gets you away.
3. **Deck taps** (§7, §8). Tap targets, best-fit answering, feedback, hitting hard things.
   *Done when:* in a boarding fight you're busy and making choices, not watching.
4. **Breaking away and boarding rewards** (§9, §10). Stranded Lees, picking them up, the capture pick, mid-fight surrender. Rebalance the Friend Ship and the boarding presets.
   *Done when:* boarding is a risk you take on purpose, and getting caught is survivable if you react.
5. **Crew bars** (§12). Replace the pips; find the button layout.
   *Done when:* you can tell at a glance who's where and who's hurt, and moving Lees is easy to follow.

Keep the sweep tool working; teach its captain to cut lines and break away, and to board with the Friend Ship.

---

## 14. Tunables (initial guesses)

| Tunable | Initial |
|---|---|
| Speed blend | starts at ~1.5× pistol range, reaches close-combat speed at pistol range |
| Close-combat speed default | 1× |
| Hook range | ~pistol range |
| Hook flight time | ~1 s (telegraphed) |
| Pull speed | ~0.5 m/s per line on a Basic Ship, ÷ the heavier boat's mass |
| Line HP | ~2 s of hacking for a baseline Lee |
| Hook cooldown | ~12 s after its line is cut |
| Plank reach | hulls within ~2 m |
| Rope swing range | as today's boarding range |
| Push poles | separate at ~3 m/s for 1 s |
| Hold-fire radius | shots that would land within ~30 m of an ally |
| Enemy hesitation | 0.5–1.5 s (Normal), more on Easy, less on Hard |
| Capture pick | one intact part, your choice |
| Mid-fight surrender | last Lee standing, or outnumbered 3:1, ~30% |
| Bonus damage for hitting a hard surface | ~10 |

All go in the tuning panel.

---

## 15. Out of scope (later)

- **Nesses** and everything about them (Phase 8).
- **Bosses** (Phase 9).
- **Overboard**, man-overboard rescue.
- **Multiple ships** (keeping a captured ship).
- Armor, damage over time and status effects on the crew bars (§12.3).
- Picking individual enemy Lees as targets.
- Dodging individual pistol shots or volleys (**no**: too much micromanagement).

---

## 16. Open questions (decide in playtest)

1. Who cuts lines: ⚔️, 🛠️, or whoever is nearest?
2. Do ropes stay a treasure as well as becoming a rail item, or only a rail item?
3. Should a boat without ropes or planks be able to board at all (e.g. a slow climb across once the hulls touch)?
4. How much should heavy ships resist boarding: faster cutting, or more mass?
5. Where do the role buttons and crew bars fit best on a phone?
6. Should a cut rope with a Lee on it drop the Lee in the water (later: overboard) instead of back on deck?
7. How long can stranded boarders hold out, and does a captured-by-your-boarders ship count as captured if you've sailed away?

---

## 17. Design-for-later constraints

1. **Connections are general.** A line joins any two things that can be pulled (a boat, and in Phase 8 a Ness that latches or a harpoon that hits one). Pulling uses each end's mass.
2. **Deck tap targets are data**: a target type, the role that answers it, and what it does. Phase 8 adds "flee this danger zone" and "stab the stunned head".
3. **Deck danger zones.** Anything that marks tiles on a deck ahead of an attack (shells today, Ness bites and slaps next) uses one system, with a warning time, like the red X.
4. **Pushes** (a Lee moved by a force, hitting things) are general, for tail slaps and waves.
5. **The speed blend takes any trigger.** An enemy in pistol range is the first; a surfacing Ness is the next.
6. **Weapon targets are a type** (hulls, crews, and in Phase 8, underwater things). A gun says what it can hit.
7. **All earlier constraints still apply.**
