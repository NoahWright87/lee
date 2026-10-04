import { LEE_DEFS, type LeeStats } from './lees';

// Every gameplay number lives here. The sim reads from a live Tuning object, so
// most changes apply the next frame. Values marked "next run" in the tuning
// panel (part HP and capacity, cannon count) are read when a fight is built.

export function defaultBoatTuning() {
  return {
    movement: {
      /** Forward speed at full throttle, m/s. */
      cruiseSpeed: 12,
      /** Speed while drifting before START, m/s. */
      idleSpeed: 3,
      /** How fast forward speed rises toward cruise, m/s². */
      acceleration: 3,
      /** How fast forward speed above the target bleeds off, 1/s. */
      drag: 0.8,
      /** Max turn rate, deg/s. Orbit radius ≈ speed / turn rate. */
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
    parts: {
      bow: { hp: 40, waterCapacity: 20, leakMultiplier: 0.6 },
      midship: { hp: 100, waterCapacity: 60, leakMultiplier: 1.6 },
      stern: { hp: 60, waterCapacity: 30, leakMultiplier: 0.9 },
      cannon: { hp: 30, waterCapacity: 10, leakMultiplier: 0.3 },
    },
    crew: {
      /** Lees aboard (next fight). Yours fill the setup tray; an enemy type's homes come from src/config/ships.ts. */
      size: 6,
    },
    cannons: {
      /** Seconds for a baseline gunner to load one shot. */
      reloadTime: 3,
      /** Max range, m. */
      range: 130,
      /** Minimum range, m (this ship's guns): a boat closer than this (center to muzzle) can't be shelled by them. */
      minRange: 25,
      /** Half-width of each gun's firing arc around its beam, degrees. */
      arc: 35,
      /** HP damage per shell. */
      damage: 10,
      /** Random scatter radius around the aim point for a baseline gunner, m (÷ accuracy and lookout). */
      spread: 2,
      /** Shell flight time = base + perMeter * distance (seconds). */
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
       * target's current turn rate over the flight time. Circling steadily stops being safe;
       * changing direction (zigzagging) is what dodges.
       */
      turnLead: 0.8,
      /** Water a hit lets into an intact part. */
      hitWater: 1.5,
      /** Water a hit lets in through a part that is already wrecked (it punches through the hull). */
      holeWater: 10,
    },
    /** Gatling guns (G stations, between the cannons): bullets at cannon range that hurt Lees, barely boats. */
    gatling: {
      /** Bullets per second for a baseline gunner (× load speed). */
      rate: 2.5,
      /** Range, m (no minimum). */
      range: 110,
      /** Half-width of its swivel arc around the beam, degrees. */
      arc: 60,
      /** Damage to a Lee per hit. */
      damage: 3,
      /** Damage to a boat part when a bullet hits the hull instead. */
      boatDamage: 0.15,
      /** Scatter radius at the muzzle (÷ gunner accuracy), m... */
      spread: 0.3,
      /** ...plus this much per meter of distance. Close in, it shreds; at range, it sprays. */
      spreadPerMeter: 0.03,
      /** A bullet this close to its target Lee hits it, m. */
      hitRadius: 0.7,
    },
    function: {
      /** A cannon section at or below this HP fraction is offline. */
      cannonOfflineAt: 0.4,
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

/** AI preferences for an enemy ship type. */
export function defaultShipAI() {
  return {
    /** Distance this type tries to keep from you while orbiting, m. */
    preferredRange: 85,
    /** 0 = orbit at preferredRange (cannon boat), 1 = close in to dock or ram, then board. */
    seekAttach: 0,
    /** Boarders ram when their heading is within this many degrees of a clean line onto your hull. */
    ramLine: 20,
    /** ...and you are closer than this, m. */
    ramRange: 70,
  };
}

/** An enemy ship type's tuning: a full boat block plus its AI. */
export function defaultShipTuning() {
  return { ...defaultBoatTuning(), ai: defaultShipAI() };
}

export type ShipTuning = ReturnType<typeof defaultShipTuning>;

export function defaultTuning() {
  const player = defaultBoatTuning();

  // Standard (Sloop): what Phase 2 called "the enemy". Orbits at cannon range.
  const standard = defaultShipTuning();
  standard.cannons.spread = 2.5;
  // The enemy is a slower, clumsier hull. playerAdvantage stacks on top of this.
  standard.movement.cruiseSpeed = 10;
  standard.movement.turnRate = 18;
  // Fewer hands than you: the test fight should still favor the player. Its guns
  // load faster to make up for rarely having more than one manned on a broadside.
  standard.crew.size = 4;
  standard.cannons.reloadTime = 2.2;

  // Boarder (Friend Ship): fast, light, few guns, a big crew. Wants to close in.
  const boarder = defaultShipTuning();
  Object.assign(boarder.movement, { cruiseSpeed: 13.5, turnRate: 24, acceleration: 3.5 });
  boarder.parts = {
    bow: { hp: 34, waterCapacity: 14, leakMultiplier: 0.7 },
    midship: { hp: 60, waterCapacity: 36, leakMultiplier: 1.8 },
    stern: { hp: 40, waterCapacity: 20, leakMultiplier: 1 },
    cannon: { hp: 22, waterCapacity: 8, leakMultiplier: 0.4 },
  };
  Object.assign(boarder.cannons, { reloadTime: 2.6, range: 110, minRange: 25, spread: 3 });
  boarder.crew.size = 6;
  Object.assign(boarder.ai, { preferredRange: 30, seekAttach: 1 });

  // Heavy (Hard Ship): big, slow, many guns with wide arcs. Weak inside its minimum range.
  const heavy = defaultShipTuning();
  Object.assign(heavy.movement, { cruiseSpeed: 7, turnRate: 10, turnAcceleration: 35, acceleration: 1.6 });
  heavy.parts = {
    bow: { hp: 70, waterCapacity: 30, leakMultiplier: 0.5 },
    midship: { hp: 170, waterCapacity: 110, leakMultiplier: 1.3 },
    stern: { hp: 100, waterCapacity: 45, leakMultiplier: 0.8 },
    cannon: { hp: 50, waterCapacity: 16, leakMultiplier: 0.25 },
  };
  // Wide minimum range: get in close and its broadsides can't touch you, while your own guns still can.
  Object.assign(heavy.cannons, { reloadTime: 4.2, range: 150, minRange: 75, arc: 45, spread: 3, damage: 8 });
  heavy.crew.size = 6;
  Object.assign(heavy.ai, { preferredRange: 105 });

  return {
    global: {
      /**
       * Scales the player's HP (×), reload time (÷), leak multipliers (÷) and turn rate
       * (× sqrt). 1 = boats are equal apart from their own tuning.
       */
      playerAdvantage: 1.4,
      /** Multiplies every core stat of your Lees (1 = same Lees as the enemy). */
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
    player,
    /** Enemy ship types (see src/config/ships.ts): boat stats, crew size and AI per type. */
    ships: { standard, boarder, heavy } as Record<string, ShipTuning>,
    enemyAI: {
      /** Degrees the enemy bends its course per meter it is off its preferred range. */
      rangeCorrection: 1,
      /** How far ahead of itself the enemy places its seek point, m. Bigger = smoother, lazier. */
      lookAhead: 60,
      /** Each ship's preferred range (its type's ai.preferredRange) is randomly ± this much, so a pack spreads out, m. */
      rangeJitter: 15,
      /** Ships in a pack steer apart when closer than this, m. */
      spacing: 70,
      /** 0 = pick the side needing the smaller turn at the start, 1 = clockwise, -1 = counter-clockwise. */
      orbitDirection: 0,
    },
    campaign: {
      /** Enemy ships in the first fight. */
      firstFightEnemies: 1,
      /** Ships added per fight won (fractions accumulate: 0.5 = one more every other fight). */
      enemiesAddedPerFight: 1,
      /** Most enemy ships in one fight. */
      maxEnemies: 5,
      /**
       * Each enemy's HP × (ships in the fight)^-this. 0 = every ship full strength;
       * 0.8 = two ships at 57% each, three at 42%, five at 28%.
       */
      packHullScaling: 0.8,
      /** Each enemy's reload time × (ships in the fight)^this. 0.8 = two ships reload 74% slower each, three 141%. */
      packReloadScaling: 0.8,
      /** Angle between neighboring enemy spawn points, degrees. */
      spawnSpread: 28,
      /** Fraction of your damage and water repaired between fights (1 = fresh boat each fight). */
      repairBetweenFights: 1,
      /** Seconds before the next fight starts on its own after a win. 0 = wait for a tap. */
      nextFightDelay: 4,
      /**
       * Threat budget: most enemy shells in the air at once (0 = no limit). Loaded guns
       * hold fire until a slot frees, so a pack stays dodgeable instead of a wall of X's.
       */
      maxIncomingShells: 3,
      /** 1 = enemy shells can hit other enemies (crossfire), 0 = they pass through. */
      friendlyFire: 1,
      /** 1 = fights 1-3 introduce one ship type each, alone (Sloop, Friend Ship, Hard Ship). 0 = mix from fight 1. */
      introFights: 1,
      /** Weights for drawing each ship's type after the intro fights (0 = never). */
      mix: { standard: 2, boarder: 1, heavy: 1 } as Record<string, number>,
    },
    /** Docking, ramming and the links they form. */
    attach: {
      /** Hulls this close (m, gap between them) can start grappling. */
      dockDistance: 5,
      /** Seconds two boats must stay close and slow before they stick. */
      grappleTime: 1.5,
      /** Grappling only counts while the boats move slower than this relative to each other, m/s. */
      dockRelSpeed: 4.5,
      /** Seconds for docked boats to ease side by side. */
      dockEaseTime: 0.7,
      /** Gap between docked hulls, m (close enough to swing across, not overlapping). */
      dockGap: 1.2,
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
      /** Bounciness of a bump (0 = dead stop along the contact, 1 = elastic). */
      bounce: 0.3,
      /** Most links one boat can have at once. */
      cap: 2,
      /** Most links per side (port, starboard, bow, stern). */
      perSide: 1,
      /** Speed an attached pair drifts at, m/s. */
      driftSpeed: 1.2,
      /** How fast an attached pair slows to its drift speed, 1/s. */
      driftDecay: 0.9,
      /** Seconds between pressing Disengage (or a sinking) and the link breaking: boarders swing home meanwhile. */
      recallWindow: 2,
      /** Speed each boat is pushed apart with when a link breaks, m/s. */
      pushSpeed: 3,
      /** Seconds after a link breaks before the same two boats can dock again. */
      redockDelay: 3,
      /** Holding your finger within this many meters of an enemy hull steers you alongside it instead of orbiting. */
      alongsideGrab: 6,
    },
    /** Crossing between attached decks. */
    boarding: {
      /** Seconds a baseline Lee takes to swing across (÷ swing speed). */
      swingTime: 1.6,
      /** 1 = Lees in mid-swing can be shot by pistols. */
      swingHittable: 0,
      /** Boarders leave a deck once its water passes this fraction of the sink line. */
      evacuateAt: 0.9,
      /** Always keep at least this many of a crew aboard its own boat (0 = off). */
      minHomeCrew: 0,
      /** Points lost per Lee already fighting a boarder (low, so ganging up happens). */
      repelHelpPenalty: 8,
      /** Most Lees (either side) that can stand on one tile. Swings and moves wait for room. */
      tileCap: 2,
      /** A Lee below this fraction of its HP falls back (boarders swing home) and fights with its pistol instead. */
      retreatAt: 0.25,
      /** Seconds between Lees leaving one boat for the same enemy boat (one at a time over the rail). */
      swingInterval: 0.8,
      /** Casting off (Disengage) takes at least this long, s... */
      castOffMin: 1,
      /** ...and at most this long: anyone of yours still over there by then is left behind. */
      castOffTimeout: 8,
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
    crew: {
      /** HP/s a baseline Lee restores while repairing. */
      repairRate: 3,
      /** Water/s a baseline Lee removes while bailing. */
      bailRate: 1.4,
      /** Baseline walking speed, m/s. */
      walkSpeed: 5,
      /** Baseline Lee HP (next fight). */
      hp: 70,
      /** Speed with every oar station empty, as a fraction of fully crewed. */
      oarBaseline: 0.6,
      /** Turn rate with every sail station empty, as a fraction of fully crewed. */
      sailBaseline: 0.6,
      /** Most a crew can push speed/turning past "fully crewed" (stronger Lees later). */
      mobilityCap: 1.5,
      /** Cannon range bonus per manned lookout at baseline spotting (0.25 = guns reach 25% farther). */
      lookoutRange: 0.25,
      /** Repairs can only bring a part back to this fraction of its max HP. */
      repairCeiling: 0.6,
      /** 1 = parts at 0 HP can be repaired mid-fight, 0 = wrecked stays wrecked. */
      wreckedRepairable: 0,
      /** Damage to each Lee on the tile a shell hits. */
      hitDamage: 10,
      /** Fraction of that dealt to Lees on orthogonally neighboring tiles. 0 = direct hits only. */
      splashFraction: 0.25,
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
      /** Bonus for tasks worked from the Lee's home tile. */
      homeBonus: 15,
      /** Bonus for the kind of work the Lee's home tile sets (gunner → guns, damage control → repair/bail). */
      roleBonus: 25,
      /** Bonus for a damage-control Lee standing by at home (so it waits there instead of drifting to low-tier stations). */
      standbyBonus: 20,
      /** Points lost per second of walking to reach a task. */
      walkPenalty: 3,
      /** Points lost per Lee already on a repair/bail job (so extra hands help only when nothing else needs them). */
      helpPenalty: 45,
      /** Points per +1.0 of the stat a task uses (role affinity for stronger Lees). */
      statAffinity: 10,
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
      /** Swing across to an attached enemy boat (surplus Lees only). */
      board: 35,
      /** Empty oars or sails → man them. */
      mobility: 30,
      /** Empty lookout → man it. */
      lookout: 15,
      /** Cannons with nothing to shoot at. */
      idleCannon: 0,
      /** Extra points within a tier by severity (lowest HP, most water...). */
      severitySpan: 10,
    },
    layout: {
      /** Ocean share of the screen in setup mode (the deck grid gets the rest). */
      setupOceanFraction: 0.5,
      /** Smallest tile on screen in setup mode, CSS px (touch target). */
      minTilePx: 46,
      /** Seconds for the panels to slide between setup and fight sizes. */
      panelSlideTime: 0.45,
      /** Ocean share of the screen while you're attached (the strip expands to show every attached deck). */
      expandedOceanFraction: 0.5,
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
      /** Where the ocean camera centers between you (0) and the enemy (1). */
      enemyBias: 0.35,
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
