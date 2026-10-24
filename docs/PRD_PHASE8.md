# Lee — Phase 8 PRD: Nesses

> **Status:** Phases 1–7 are built. Phase 7 ([`PRD_PHASE7.md`](PRD_PHASE7.md)) gave close combat stages (long → close → melee), lines that pull, tap targets on the deck, deck danger zones, pushes, the speed blend and crew bars. This phase builds on all of it.
>
> **This document describes the *product* to build on top of Phase 7, not the implementation.** Engineering decisions are yours. Hard requirements are stated as such. Guesses to be tuned are marked **(tunable)**. Everything in the earlier PRDs still holds unless this document says otherwise.
>
> **Platform:** Mobile web, portrait-first (unchanged).
>
> **Workflow:** One phase per session. Build on a branch, open a PR to `main`, and build in the slices of §11 so each can be playtested.
>
> **Bosses** (some of which will be Nesses) are Phase 9 ([`PRD_PHASE9.md`](PRD_PHASE9.md)), not this one.

---

## 1. Context

Every enemy so far is a ship. Ships are varied, but they all fight the same way: guns at range, boarding up close. **Nesses** are sea monsters that fight completely differently, so mixing them with ships makes every encounter less predictable.

### Names

**Ness is a pun**, like Lee and Ship. Every Ness is named for a *-ness* word, and **its attacks and abilities match its name** (hard requirement). Lonely Ness (loneliness), Sad Ness (sadness), Mad Ness (madness), Quiet Ness, and so on (§6).

### The question this phase answers

> **Do Nesses make fights feel different, readable and fair, and do they mix well with enemy ships?**

### Core design principles

**1. Everything is telegraphed.** A Ness never hits without warning: a ripple before it surfaces, a rear-back before a bite, the impact zone of a tail slap before it lands. Losing to a Ness is about not reacting, never about not knowing.

**2. Fight it where it is.** Underwater, only certain weapons reach it. Surfaced, it's vulnerable to cannons and pistols. Up against your hull, your Lees fight it from your own deck.

**3. You can't board a Ness.** Melee against a Ness happens on *your* deck.

**4. The name tells you how it fights.**

**5. Same budget, same map.** A Ness has a point cost like a ship, appears on stops like ships (alone, in packs, or with ships), and is shown by the same intel.

### Hypotheses to test

1. Dodging a surfacing Ness (seeing the shadow and ripple, steering off) is as satisfying as dodging shells.
2. Deck attacks (bites, head smashes, tail slaps) give close combat with a Ness the same react-and-punish rhythm.
3. Underwater weapons make loadouts matter differently on Ness-heavy routes.
4. Players can tell Nesses apart by name and behavior after one fight with each.

---

## 2. What a Ness is

- **A body, not a hull.** A Ness has **body parts** (a head, coils, a tail; **(tunable per kind)**), each with HP. **Hard requirement:** reducing the **head** to zero kills it. Other parts can be damaged to weaken or disable an attack (a hurt tail slaps weaker).
- **No crew, no deck.** It can't be boarded or captured.
- **A kind** (Lonely, Sad, Mad...) defines its body, speed, attacks and behavior, as data.
- **A level or size** scales its HP and damage with its budget.
- **States:** submerged, emerging, surfaced, and up close (against your hull) (§3).

---

## 3. States

### 3.1 Submerged

- Shown as a **shadow in the water** that moves.
- **Only underwater weapons hit it** (§5). A cannonball landing on a shadow does nothing: it's too deep.
- The **mortar** can hit it (it lands at a steep angle and explodes).

### 3.2 Emerging

- **Hard requirement: a warning first.** A ripple ring grows where it's about to come up, with a ⚠️, over a warning time like the red X **(tunable)**.
- **If it surfaces under your boat**, the part above it takes **massive** damage. Steering off the ring is the dodge.
- **If it surfaces close to you**, the speed blend drops the game to close-combat speed (Phase 7 §3). The slowdown is part of the drama.

### 3.3 Surfaced

- Vulnerable to **cannons and pistols**, as a ship would be.
- Uses its ranged and melee attacks (§4).
- Dives again after a while, or when hurt **(tunable per kind)**.

### 3.4 Up close

- A Ness alongside your hull attacks your deck directly (§4.2).
- It can't be boarded. Your Lees fight it from your own deck with swords and pistols.
- **Latching** (a Ness holding on to your hull with a line it makes itself, pulling or holding your boat) uses Phase 7's lines **(kinds that latch: §6)**. Lines can be cut like hooks.

---

## 4. Attacks

All attacks are data (a shape, a warning time, an effect), and all are telegraphed with the same danger-zone system as shells (Phase 7 §17.3).

### 4.1 Ranged

- **Spit and throw.** Projectiles that behave like cannon shells: an arc, a red X, a hit. Some splash, some do something special (§6).

### 4.2 Up close, on your deck

- **Bite:** a circle on the deck; Lees inside take damage.
- **Head smash:** the Ness rears back and a block of tiles **flashes red** (for example the three columns nearest it). After a short delay, it smashes down: heavy damage to Lees and tiles there.
  - **After a smash, its head rests on your deck, stunned** (💫), for a few seconds **(tunable)**. **Tap the head** to send your Lees to stab it, for bonus damage.
- **Tail slap:** a rectangle of tiles **flashes blue** before it lands. It splashes water into those tiles and **pushes Lees** away from the impact.
  - **It's mostly a debuff:** it knocks Lees off guns and oars, and floods those tiles so the boat gets sluggish. It doesn't hurt much right then, but it leaves you vulnerable when the Ness dives and comes back.
  - Lees pushed into a hard surface take extra damage (Phase 7 §8.4).

### 4.3 Dodging on deck

- **Tap a flashing area's ⚠️** to clear it: the Lees in it step out to the nearest safe tiles. **(Or tap safe tiles to send Lees there; decide in slice 2.)**
- Your crew bars show who's in danger (their border flashes).

---

## 5. Weapons and gear

| Item | Kind | What it hits | Notes |
|---|---|---|---|
| **Depth Charge** | Rail item, used by tapping or auto-fired by 🔫 Lees | Underwater things | Drops astern; sinks and explodes after a delay. The main answer to a shadow |
| **Harpoon Gun** | Gun | Ships and Nesses | Hits and **holds a line**, pulling the target toward you (Phase 7 lines). Drags a Ness into melee range, or a ship into hook range |
| **Mortar** (existing) | Gun | Ships and underwater things | Steep, exploding shot |
| **Hydrophone** (name is a placeholder) | Station | — | While manned, shadows show further out and warnings come earlier |

- **Weapon targets are types** (Phase 7 §17.6): cannons hit hulls and surfaced Nesses; pistols hit Lees and surfaced Nesses; depth charges hit underwater things.
- The budget generator, shops and wrecks include the new items, like every other item.

---

## 6. The Ness roster

**Each Ness's abilities match its name.** First set to build: five or six of these, chosen in slice 3. Names and themes are placeholders except the pun.

| Ness | Theme | Fights by | Difficulty |
|---|---|---|---|
| **Weak Ness** | weakness | Small, simple bites, obvious telegraphs. Comes in packs | Easy |
| **Lonely Ness** | loneliness | Goes for the Lee standing furthest from the others; drags it away (pushes it to the edge) | Easy–mid |
| **Sad Ness** | sadness | Cries a raincloud over your deck: water floods in. Bailing duty | Mid |
| **Mad Ness** | madness | Berserk: fast surfacing, repeated head smashes and tail slaps | Mid–hard |
| **Quiet Ness** | quietness | A faint shadow and a short warning; the full warning only with a Lookout or Hydrophone manned | Mid |
| **Dark Ness** | darkness | Squirts ink: gunners in it lose accuracy, and the zone hides other telegraphs | Mid–hard |
| **Lazy Ness** | laziness | Huge and asleep. Wake it and it hits like a boss; sneak past and it stays down | Hard if woken |
| **Greedy Ness** | greediness | Its bite steals gold or cargo, then it flees. Kill it to get it back, with more | Mid |
| **Busy Ness** | business | Lots of small, quick attacks at once | Mid |
| **Sick Ness** | sickness | Spit that poisons Lees (needs damage over time: later) | Later |

- A Ness's kind is its **headline**, like a ship's chassis: the map and intel always show it.
- **Hard requirement:** each kind fights true to its name.

---

## 7. Budgets, stops and routes

- **Every Ness kind has a point cost** in the one cost table, plus a cost per level or size. The generator can spend a stop's budget on ships, Nesses, or a mix ("a Mad Ness and a Basic Ship").
- **Map styles weight them.** A new style, **Ness waters**, has many; *Crowded lanes* has few **(tunable per style)**. A **Ness lair** stop type has only Nesses.
- **Danger rating** counts Nesses the same way (budget vs your ship's value).
- **Intel:** the kind is always shown (unless fogged); a Spyglass adds its size or level; a Crow's Nest adds which body parts and attacks it has.

---

## 8. Rewards

- **Gold** by budget, as for ships.
- **No capture.** Nesses can't be captured, so instead: a chance at a **trophy** themed on the Ness (a Lonely Ness's tooth trinket, a Sad Ness tear treasure; **(content to design)**).
- Greedy Ness gives back what it stole, plus extra.

---

## 9. Enemy ships and Nesses together

- Ships and Nesses don't fight each other by default. A Ness surfacing between ships can hit anyone.
- Ships hold fire near a surfaced Ness that's on you, as they do near allies **(tunable)**.

---

## 10. The player's experience (a walkthrough)

1. A shadow approaches your ship. A danger ring shows it's about to surface.
2. You steer away. It surfaces beside you, and the game slows to close-combat speed.
3. It rears its head back. The three columns of your deck nearest it flash red. You tap the ⚠️ and your Lees step out of the zone.
4. It smashes down on the empty tiles. Its head rests on your deck, stunned 💫. You tap it; your Lees run over and stab it.
5. It recovers and rears its tail. The front two rows flash blue. The slap floods those tiles and pushes your Lees off the oars. It dives.
6. You tap the flooded tiles and your best bailers get to work. You mash ⏩ SAIL and steer off.
7. This time you see it coming and steer clear before it arrives. It surfaces out of melee range, and your cannons and pistols hit it.

---

## 11. Build order (slices, each playtested)

1. **A Ness that surfaces and dives** (§2, §3). The body, the shadow, the emerge warning, the under-hull hit, the speed blend, cannons and pistols vs a surfaced Ness, killing the head. One test kind (Weak Ness).
2. **Deck attacks** (§4). Bites, head smash and the stunned head, tail slaps with pushes and water, dodging on deck, crew-bar warnings.
3. **The roster** (§6). Five or six kinds, each true to its name.
4. **Underwater weapons and gear** (§5). Depth charges, the harpoon, the mortar vs shadows, the Hydrophone.
5. **The run** (§7, §8). Point costs, mixed stops, Ness waters, Ness lairs, intel, trophies. The sandbox can place and generate Nesses.

Keep the sweep tool working: its captain should steer off emerge rings and clear deck danger zones.

---

## 12. Tunables (initial guesses)

| Tunable | Initial |
|---|---|
| Emerge warning | ~2 s (Quiet Ness ~1 s, full warning with a Hydrophone) |
| Under-hull emerge damage | about a whole part's HP |
| Surfaced time | ~8–12 s before diving |
| Head smash warning / stun | ~1.5 s / ~4 s |
| Tail slap warning | ~1.2 s |
| Tail slap water | enough to slow the boat noticeably for ~10 s |
| Depth charge delay | ~2 s |
| Harpoon pull | like two hook lines |
| Ness waters share | ~60% of fight budgets on Nesses |

---

## 13. Out of scope (later)

- **Bosses**, including boss Nesses (Phase 9).
- **Overboard** and rescue.
- Damage over time (Sick Ness), status effects.
- Nesses fighting ships.
- Taming or keeping a Ness.

---

## 14. Open questions (decide in playtest)

1. Dodging on deck: a ⚠️ to tap, tapping safe tiles, or both?
2. How long should a Ness stay surfaced? Should damage make it dive sooner?
3. Which five or six kinds first?
4. Should every Ness latch, or only some?
5. Trophies: trinkets, treasures, sell-only loot, or all three?
6. Can you outrun a Ness, or do they always catch up?

---

## 15. Design-for-later constraints

1. **A Ness kind is data**: a body, attacks, behavior, cost. A new Ness is an entry, plus new code only for a new kind of attack.
2. **Attacks are data on the danger-zone system**: a shape, a warning, an effect. Bosses (Phase 9) combine them into phases.
3. **Non-ship enemies are general.** The fight shouldn't assume every enemy is a ship with a crew; bosses may be either, or both.
4. **All earlier constraints still apply.**
