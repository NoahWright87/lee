import { defaultAiProfiles, type AiProfile } from './encounters';
import { defaultItemParams } from './items';
import { defaultTraits, LEE_DEFS, type LeeStats } from './lees';
import { defaultShipStats, type ShipStats } from './ships';

/** Bump when the tuning shape changes incompatibly (saved tuning from another version is dropped). */
export const TUNING_VERSION = 5;

// Every gameplay number lives here. The sim reads from a live Tuning object, so
// most changes apply the next frame. Values marked "next run" in the tuning
// panel (part HP and capacity, cannon count) are read when a fight is built.

export function defaultBoatTuning() {
  return {
    movement: {
      /** Forward speed at full throttle, m/s (× the ship's speed). */
      cruiseSpeed: 12,
      /** Speed while drifting before START, m/s. */
      idleSpeed: 3,
      /** How fast forward speed rises toward cruise, m/s² (× the ship's accel). */
      acceleration: 3,
      /** How fast forward speed above the target bleeds off, 1/s. */
      drag: 0.8,
      /** Max turn rate, deg/s (× the ship's turn). Orbit radius ≈ speed / turn rate. */
      turnRate: 20,
      /** How fast the turn rate can change, deg/s². Lower = lazier rudder. */
      turnAcceleration: 70,
      /** How fast sideways sliding dies out, 1/s. Lower = more drift in turns. */
      lateralDrag: 2.5,
      /** Fraction of cruise speed lost while turning at the max rate. */
      turnSpeedLoss: 0.15,
      /** Orbit radius around a close target, as a multiple of the tightest turn (speed / turn rate). */
      orbitRadiusScale: 1.15,
      /** Bend into an orbit within this many orbit radii of the target. 0 = pure seek (loops through the point). */
      orbitCapture: 2,
    },
    /** Per-part stat blocks (× the ship's hullHp, capacity and leak). Each layout part names one. */
    parts: {
      bow: { hp: 40, waterCapacity: 20, leakMultiplier: 0.6 },
      midship: { hp: 100, waterCapacity: 60, leakMultiplier: 1.6 },
      stern: { hp: 60, waterCapacity: 30, leakMultiplier: 0.9 },
      side: { hp: 30, waterCapacity: 10, leakMultiplier: 0.3 },
    },
    function: {
      /** Guns on a part at or below this HP fraction are offline. */
      gunOfflineAt: 0.4,
      /** Speed/turn multiplier when the engine is wrecked (scales up linearly with engine HP). */
      engineMinFactor: 0.4,
    },
    flooding: {
      /** Water/s entering a fully wrecked part with leak multiplier 1. Inflow = rate × damage fraction × leak multiplier. */
      leakRate: 2.5,
      /** How fast water evens out between neighboring parts, 1/s. */
      spreadRate: 0.8,
      /** Passive bilge: water/s drained from the whole boat. */
      bilgeRate: 0.4,
      /** Sinks when total water ≥ this fraction of total capacity. */
      sinkThreshold: 0.6,
      /** Speed lost at the sink line (0..1). */
      waterSpeedPenalty: 0.5,
      /** Turn rate lost at the sink line (0..1). */
      waterTurnPenalty: 0.5,
      /** Shape of the slowdown curve: 1 = linear, >1 = gentle at first then steep. */
      waterCurveExponent: 1.5,
    },
  };
}

export type BoatTuning = ReturnType<typeof defaultBoatTuning>;
export type PartStatKey = keyof BoatTuning['parts'];

/** The standard cannon. Every gun's numbers (tuning.items.<gun>) are multipliers on these. */
export function defaultGunTuning() {
  return {
    /** Seconds for a baseline gunner to load one shot. */
    reloadTime: 3,
    /** Max range, m. */
    range: 130,
    /** Minimum range, m: a boat closer than this (center to muzzle) can't be shelled. */
    minRange: 25,
    /** HP damage per shell to the part it lands on. */
    damage: 10,
    /** Damage to each Lee on the tile a shell lands on. */
    crewDamage: 10,
    /** Fraction of that dealt to Lees on orthogonally neighboring tiles (a splash ×2 gun reaches 2 tiles). */
    crewSplash: 0.25,
    /** Random scatter radius around the aim point for a baseline gunner, m (÷ accuracy and lookout). */
    spread: 2,
    /** Shell flight time = (base + perMeter × distance) ÷ the gun's shell speed (seconds). */
    flightTimeBase: 1.9,
    flightTimePerMeter: 0.011,
    /** A shell lands on a part if within this distance of it, m. */
    impactRadius: 1.2,
    /** Gunners aim at a random point within this distance of a random part's center, m. */
    aimRadius: 3.5,
    /** Lead error: the gunner leads a moving target by the right amount × (1 ± this), so fast or far targets are harder to hit. */
    leadError: 0.2,
    /**
     * Gunners guess at your turn too: each shot follows a random 0..this fraction of the
     * target's current turn rate over the flight time. Changing direction is what dodges.
     */
    turnLead: 0.8,
    /** Water a hit lets into an intact part. */
    hitWater: 1.5,
    /** Water a hit lets in through a part that is already wrecked (it punches through the hull). */
    holeWater: 10,
    /** A bullet or pellet this close to a Lee hits it, m. */
    hitRadius: 0.7,
  };
}

export function defaultTuning() {
  return {
    /** Bumped when the tuning shape changes: older saved tuning is dropped instead of half-merged. */
    meta: { version: TUNING_VERSION },
    global: {
      /**
       * Sandbox assist (1 = off). Scales the player's HP (×), reload time (÷), leak (÷) and
       * turn rate (× sqrt). Ignored in a run: enemies and player follow the same rules there.
       */
      playerAdvantage: 1,
      /** Sandbox assist (1 = off): multiplies every core stat of your Lees. Ignored in a run. */
      playerCrewStats: 1,
      /** Seconds of motion the path preview shows. */
      previewHorizon: 6,
      /** How long the sinking animation takes, s. */
      sinkDuration: 2,
      /** Pause between sinking finishing and the result screen, s. */
      resultDelay: 1,
      /** Enemy shells that miss within this many hull-lengths of you count as dodged. */
      dodgeRadiusHulls: 1.5,
      /** Starting distance north (m) and east (m) of the enemy from the player. */
      enemyStartNorth: 200,
      enemyStartEast: 90,
    },
    /** The baseline hull every ship scales (movement, part blocks, function loss, flooding). */
    boat: defaultBoatTuning(),
    /** Per-ship multipliers on the baseline, crew limits and treasure slots (src/config/ships.ts). */
    ships: defaultShipStats() as Record<string, ShipStats>,
    /** The standard cannon (every gun's numbers are multipliers on these). */
    guns: defaultGunTuning(),
    /** Numbers of every item, Treasure and Trinket (src/config/items.ts). Mostly next fight. */
    items: defaultItemParams(),
    /** Enemy AI profiles, chosen by the encounter (src/config/encounters.ts). */
    ai: defaultAiProfiles() as Record<string, AiProfile>,
    enemyAI: {
      /** Degrees the enemy bends its course per meter it is off its preferred range. */
      rangeCorrection: 1,
      /** How far ahead of itself the enemy places its seek point, m. Bigger = smoother, lazier. */
      lookAhead: 60,
      /** Each ship's preferred range (its AI profile's) is randomly ± this much, so a pack spreads out, m. */
      rangeJitter: 15,
      /** Ships in a pack steer apart when closer than this, m. */
      spacing: 70,
      /** 0 = pick the side needing the smaller turn at the start, 1 = clockwise, -1 = counter-clockwise. */
      orbitDirection: 0,
    },
    fights: {
      /** Sandbox assist (0 = off): each enemy's HP × (ships in the fight)^-this. Ignored in a run. */
      packHullScaling: 0,
      /** Sandbox assist (0 = off): each enemy's reload time × (ships in the fight)^this. Ignored in a run. */
      packReloadScaling: 0,
      /** Angle between neighboring enemy spawn points, degrees. */
      spawnSpread: 28,
      /**
       * Threat budget: most enemy shells in the air at once (0 = no limit). Loaded guns
       * hold fire until a slot frees, so a pack stays dodgeable instead of a wall of X's.
       */
      maxIncomingShells: 3,
      /** 1 = enemy shells can hit other enemies (crossfire), 0 = they pass through. */
      friendlyFire: 1,
    },
    /** Tiles are units: shells damage them, and a blown-out tile loses its fixture. */
    tiles: {
      /** Durability of a tile (× floor upgrades). */
      durability: 30,
      /** Tile damage per point of shell hull damage. */
      hitScale: 1,
      /** Fraction of that dealt to orthogonally neighboring tiles. */
      splash: 0.35,
      /** Damage to each Lee on a tile when it blows out. */
      blowoutLeeDamage: 25,
    },
    /** Volatile parts (the Powder Store) exploding when their tile blows out. Chains. */
    explosion: {
      /** Reach in tiles (Manhattan distance; 1 = the tile and its orthogonal neighbors). */
      radius: 1,
      /** Damage to each tile in reach (can blow out more volatile parts). */
      tileDamage: 40,
      /** Damage to the hull part under each tile in reach. */
      partDamage: 20,
      /** Damage to each Lee in reach. */
      leeDamage: 30,
      /** Water let into each part hit. */
      water: 6,
    },
    /** Ramming and bumping. Boats never lock together: they stay in close combat only while they stay close. */
    attach: {
      /** Gap the BOARD autopilot aims for beside the other hull, m. */
      alongsideGap: 1.2,
      /** Hulls this close (m) are touching: spikes on the touching edge hurt the other boat. */
      touchGap: 1,
      /** Bow-first contact at or above this closing speed is a ram, m/s. */
      ramSpeed: 6,
      /** Damage to the struck part per m/s of closing speed. */
      ramDamage: 3,
      /** The rammer's bow takes this fraction of that. */
      ramSelfDamage: 0.5,
      /** Rams only count within this many degrees of square-on to the hull (else it's a glancing bump). */
      ramMaxAngle: 55,
      /** How far ahead (s) a ram is predicted and shown as an X. */
      ramWarnTime: 1.6,
      /** A ram only lands if its X has been up this long; otherwise the contact is a bump. */
      ramMinWarning: 0.6,
      /** Bounciness of a bump (0 = dead stop along the contact, 1 = elastic). A ram never bounces. */
      bounce: 0.3,
      /** Seconds after a ram before the same boat can ram the same target again. */
      ramCooldown: 3,
      /** RAM autopilot after impact: push this much faster than the target to stay nose-in, m/s. */
      holdPush: 1,
    },
    /** Crossing between decks. Close combat lasts while two hulls stay within boarding range. */
    boarding: {
      /** Hulls this close (m, gap between them) are in close combat: ⚔️ Lees can swing across (× Swinging Ropes). */
      range: 4,
      /** Close combat ends once the gap opens past range + this, m (so it doesn't flicker). */
      rangeSlack: 2,
      /** Seconds a baseline Lee takes to swing across (÷ swing speed). */
      swingTime: 1.6,
      /** 1 = Lees in mid-swing can be shot by pistols. */
      swingHittable: 0,
      /** Boarders leave a deck once its water passes this fraction of the sink line. */
      evacuateAt: 0.9,
      /** Points lost per Lee already fighting a boarder (low, so ganging up happens). */
      repelHelpPenalty: 8,
      /** Most Lees (either side) that can stand on one tile. Swings and moves wait for room. */
      tileCap: 2,
      /** A Lee below this fraction of its HP falls back (boarders swing home) and fights with its pistol instead. */
      retreatAt: 0.25,
      /** Seconds between Lees leaving one boat for the same enemy boat (one at a time over the rail). */
      swingInterval: 0.8,
    },
    /** Jobs and the four action buttons (⏩ SAIL, 🔫 FIRE, ⚔️ BOARD, 🛠️ FIX). */
    jobs: {
      /** A gunner stays on a gun that can't bear for this long before looking elsewhere, s. */
      gunStick: 3,
      /** Holding an action button: first repeat after this long, s... */
      holdDelay: 0.4,
      /** ...then one more Lee every this many seconds. */
      holdRepeat: 0.3,
      /** Stopped (tap your own boat): fixing (repair, bailing, pumping) × this... */
      stoppedFix: 1.25,
      /** ...and gunner aim × this (one bonus pair; they don't stack). */
      stoppedAim: 1.25,
      /** Counts as stopped below this speed, m/s. */
      stoppedSpeed: 1.5,
      /** BOARD → RAM once you're at least this many degrees off parallel to the target's hull... */
      ramAngle: 80,
      /** ...and RAM → BOARD once you're back under this many degrees (also the first pick on targeting). */
      boardAngle: 45,
      /** Enemy AI: seconds between ⚔️ orders while a boarder closes in. */
      aiOrderInterval: 0.6,
    },
    /** Pistols: every Lee carries one. Hurts opposing Lees; barely scratches boats. */
    pistol: {
      /** Damage to a Lee per hit. */
      damage: 4,
      /** Damage to a boat part when a shot lands on the hull instead. */
      boatDamage: 0.3,
      /** Range, m. Covers the gap between attached boats and a little more. */
      range: 16,
      /** Shots per second for a baseline Lee. */
      rate: 0.45,
      /** Scatter radius at the muzzle (÷ pistol accuracy), m. Same disk model as cannon spread. */
      spread: 0.6,
      /** Extra scatter per meter of distance, m. */
      spreadPerMeter: 0.08,
      /** A shot this close to its target Lee hits it, m. */
      hitRadius: 0.7,
    },
    /** Swords: Lees on a shared tile with an opposing Lee fight. Never misses. */
    melee: {
      /** Damage per hit. */
      damage: 4,
      /** Hits per second for a baseline Lee. */
      rate: 0.6,
    },
    /** Core stats per Lee type, live (1 = baseline). `hp` applies next fight. */
    lees: Object.fromEntries(Object.entries(LEE_DEFS).map(([id, d]) => [id, { ...d.stats }])) as Record<string, LeeStats>,
    /** Trait strengths per Lee type (Bodyguard 0.6 = neighbors take 60% damage; Shouting 1.25 = neighbors load 25% faster). */
    traits: defaultTraits(),
    crew: {
      /** HP/s a baseline Lee restores while repairing. */
      repairRate: 3,
      /** Water/s a baseline Lee removes while bailing. */
      bailRate: 1.4,
      /** Baseline walking speed, m/s. */
      walkSpeed: 5,
      /** Baseline Lee HP (next fight). */
      hp: 70,
      /** Speed with no manned oars (each manned set of Oars adds its boost × rowing). */
      oarBaseline: 0.6,
      /** Turn rate with no manned sail (each manned Sail adds its boost × sail handling). */
      sailBaseline: 0.6,
      /** Most a crew can push speed/turning (× the ship's own numbers). */
      mobilityCap: 1.5,
      /** Repairs can only bring a part back to this fraction of its max HP. */
      repairCeiling: 0.6,
      /** 1 = parts at 0 HP can be repaired mid-fight, 0 = wrecked stays wrecked. */
      wreckedRepairable: 0,
      /** A part this full of water (fraction of capacity) slows the Lees in it. */
      wetThreshold: 0.3,
      /** Work and walking speed lost while wet (0..1). */
      wetSlowdown: 0.4,
    },
    /** Crew AI: how each Lee picks its task. Need points; higher wins. */
    crewAI: {
      /** Seconds between crew decisions. */
      thinkInterval: 0.2,
      /** A Lee only switches when another task beats its current one by this many points. */
      stickiness: 20,
      /** After switching, a Lee keeps its new task at least this long, s (unless the task ends). */
      commitTime: 1.5,
      /** Gunners count a cannon as engaging if the enemy is in its arc now or this many seconds ahead. */
      arcLookahead: 1.5,
      /** Points lost per second of walking to reach a task. */
      walkPenalty: 3,
      /** Points lost per Lee already on a repair/bail job (so extra hands help only when nothing else needs them). */
      helpPenalty: 45,
      /** A second Lee only joins a repair/bail job if it still scores above this after the help penalty (a flood does; a scratch doesn't). */
      helpThreshold: 50,
      /** Points per +1.0 of the stat a task uses: within a job, the best-qualified Lee takes the work (a tiebreaker). */
      statAffinity: 8,
      /** The stat term counts at most this far from 1 (so a ×2.0 specialist doesn't abandon its post for its specialty). */
      statAffinityCap: 0.6,
      /** A part this full (fraction) is a flooding emergency. */
      floodPartAt: 0.55,
      /** The whole boat this close to its sink line (0..1) is a flooding emergency. */
      floodSinkAt: 0.5,
      /** A part this full is worth bailing (lower urgency). */
      moderateWaterAt: 0.15,
      /** Bailers stop once a part is this dry. */
      bailStopAt: 0.04,
    },
    /** Urgency ladder: base need points per tier (reorder tiers by changing the numbers). */
    ladder: {
      /** Very high water in a part, or the boat near its sink line → bail. */
      flooding: 100,
      /** Offline guns or a damaged engine → repair. */
      functionDamage: 80,
      /** Enemy Lees on your deck → go fight them. */
      repelBoarders: 70,
      /** An unmanned cannon that has (or is about to have) the enemy in arc and range → man it. */
      engageCannon: 60,
      /** Other damaged parts and moderate water → repair / bail. */
      otherDamage: 40,
      /** ⚔️ Lees: swing across to the target in reach (or gather at the rail facing it). */
      board: 35,
      /** Empty oars or sails → man them. */
      mobility: 30,
      /** Empty support station (lookout, powder store) → man it. */
      lookout: 15,
      /** Cannons with nothing to shoot at. */
      idleCannon: 0,
      /** Extra points within a tier by severity (lowest HP, most water...). */
      severitySpan: 10,
    },
    /** The run between fights (the temporary loop; the sea map replaces it later). */
    run: {
      /** Lee cards per draft round. */
      draftChoices: 3,
      /** Parts offered after the draft (pick one). */
      startPartChoices: 3,
      /** Cards offered after a fight (pick one). */
      rewardChoices: 3,
      /** Chance one of the reward cards is a recruit... */
      recruitChance: 0.45,
      /** ...guaranteed after every Nth fight (0 = never guaranteed). */
      recruitEvery: 3,
      /** Level of a new recruit: 1 + this × fights won (0 = always level 1). */
      recruitLevelPerFight: 0,
      /** Fraction of hull damage and water repaired between fights (1 = fresh boat). */
      repairBetweenFights: 1,
      /** Fraction of lost HP surviving Lees heal between fights (1 = full). */
      healBetweenFights: 1,
      /** Most items in the cargo hold (0 = unlimited). */
      cargoLimit: 0,
      /** Trinket slots per Lee. */
      trinketSlots: 2,
      /** Reward card weights by kind (a recruit is decided first, by recruitChance). */
      weightPart: 5,
      weightTreasure: 1.5,
      weightTrinket: 2.5,
    },
    /** XP and level-ups (the same for enemy Lees, picked automatically). */
    leveling: {
      /** XP for surviving a fight. */
      survivalXp: 40,
      /** XP per point of damage dealt to hulls. */
      xpPerDamage: 0.4,
      /** XP per HP repaired. */
      xpPerRepair: 0.5,
      /** XP per unit of water bailed or pumped. */
      xpPerBail: 1,
      /** XP per point of damage dealt to Lees (swords, pistols, gatlings). */
      xpPerLeeDamage: 0.4,
      /** XP per melee kill. */
      xpPerKill: 12,
      /** XP per second spent working a station or a job. */
      xpPerWorkSecond: 0.15,
      /** XP needed for level 2; each level after needs levelGrowth × the one before. */
      firstLevelXp: 60,
      levelGrowth: 1.4,
      levelCap: 10,
      /** A stat bonus is ×(1 + this). */
      bonusSize: 0.08,
      /** An HP bonus is ×(1 + this). */
      hpBonusSize: 0.1,
      /** Bonuses offered per level-up. */
      choices: 3,
    },
    /** After the temporary encounter list runs out: repeat the last one, harder. */
    escalation: {
      /** Crew levels added per repeat. */
      levelsPerRepeat: 1,
      /** Every Nth repeat adds one more Lee to each enemy boat (up to its ship's max). 0 = never. */
      extraCrewEvery: 2,
    },
    layout: {
      /** Ocean share of the screen in setup mode (the deck grid gets the rest). */
      setupOceanFraction: 0.54,
      /** Smallest tile on screen in setup mode, CSS px (touch target). */
      minTilePx: 46,
      /** Seconds for the panels to slide between setup and fight sizes. */
      panelSlideTime: 0.45,
      /** Ocean share of the screen at boarding range (the close-up grows to show the decks you're fighting). */
      expandedOceanFraction: 0.5,
      /** The close-up starts growing once an enemy hull is this close to yours (pistol and point-blank range), m. */
      closeViewStart: 30,
    },
    telegraph: {
      /** Enemy shells always give at least this much warning, s. */
      minWarningTime: 1.6,
      /** Radius the countdown ring starts at, m. */
      ringStartRadius: 20,
      /** Half-size of the red X at impact, m (the danger zone). */
      markerSize: 4,
      /** The X starts this many times bigger and shrinks onto the impact point. */
      markerStartScale: 2.5,
      /** Seconds for the X to fade in. */
      fadeInTime: 0.12,
      /** Seconds the X lingers after impact. */
      lingerTime: 0.3,
    },
    camera: {
      /** The ocean camera leads you by this many seconds of your velocity. */
      lookAhead: 1,
      /** Enemies within gun range (yours or theirs) are kept in view; they drop out past range × (1 + this). */
      rangeHysteresis: 0.25,
      /** Visible ocean height limits, m. */
      minVisibleHeight: 220,
      maxVisibleHeight: 440,
      /** Extra room around both boats when framing, m. */
      padding: 45,
      /** How quickly the camera catches up, 1/s. */
      smoothing: 1.2,
      /** Fraction of the strip's width the close-up boat fills. */
      stripBoatFill: 0.9,
    },
    input: {
      /** 0 = the target is pinned in the water where you touched (preview stays exact). 1 = target stays under a still finger as the camera moves. */
      targetFollowsCamera: 0,
      /** A tapped point counts as reached within this distance; then the boat holds the heading it arrived on, m. */
      arriveRadius: 20,
      /** Tapping the ocean within this distance of an enemy's hull circles it (the orbit follows the boat), m. */
      orbitGrab: 45,
      /** Tapping within this distance of an enemy's hull (plus a finger's width) targets it for ⚔️; of your own, stops, m. */
      boatGrab: 6,
    },
    visuals: {
      /** Peak height of a shell's arc, m (drawn only). */
      shellArcHeight: 10,
      /** Show the reload ring on cannons in the ocean view. */
      oceanReloadRings: 1,
    },
  };
}

export type Tuning = ReturnType<typeof defaultTuning>;
export type LadderTier = Exclude<keyof Tuning['ladder'], 'severitySpan'>;
export type Side = 'player' | 'enemy';

/** Deep-merge saved values onto defaults, keeping only keys (and types) the defaults know about. */
export function mergeTuning<T>(base: T, saved: unknown): T {
  if (typeof base !== 'object' || base === null || typeof saved !== 'object' || saved === null) {
    return typeof saved === typeof base ? (saved as T) : base;
  }
  const out: Record<string, unknown> = Array.isArray(base) ? [] as unknown as Record<string, unknown> : {};
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    out[k] = k in (saved as Record<string, unknown>) ? mergeTuning(v, (saved as Record<string, unknown>)[k]) : structuredClone(v);
  }
  return out as T;
}
