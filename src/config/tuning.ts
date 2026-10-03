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
      /** Lees aboard (next fight). Yours fill the setup tray; the enemy's come from src/config/crews.ts. */
      size: 6,
    },
    cannons: {
      /** Seconds for a baseline gunner to load one shot. */
      reloadTime: 3,
      /** Max range, m. */
      range: 130,
      /** Half-width of each gun's firing arc around its beam, degrees. */
      arc: 35,
      /** HP damage per shell. */
      damage: 10,
      /** Random scatter radius around the aim point for a baseline gunner, m (÷ accuracy and lookout). */
      spread: 2,
      /** Shell flight time = base + perMeter * distance (seconds). */
      flightTimeBase: 1.4,
      flightTimePerMeter: 0.006,
      /** A shell lands on a part if within this distance of it, m. */
      impactRadius: 1.2,
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

export function defaultTuning() {
  const player = defaultBoatTuning();
  const enemy = defaultBoatTuning();
  enemy.cannons.spread = 1.5;
  // The enemy is a slower, clumsier hull. playerAdvantage stacks on top of this.
  enemy.movement.cruiseSpeed = 10;
  enemy.movement.turnRate = 18;
  // Fewer hands than you: the test fight should still favor the player. Its guns
  // load faster to make up for rarely having more than one manned on a broadside.
  enemy.crew.size = 4;
  enemy.cannons.reloadTime = 2.2;
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
    enemy,
    enemyAI: {
      /** Distance the enemy tries to keep from you, m. */
      preferredRange: 85,
      /** Degrees the enemy bends its course per meter it is off its preferred range. */
      rangeCorrection: 1,
      /** How far ahead of itself the enemy places its seek point, m. Bigger = smoother, lazier. */
      lookAhead: 60,
      /** Each ship's preferred range is randomly ± this much, so a pack spreads out, m. */
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
      hp: 40,
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
      /** An unmanned cannon that has (or is about to have) the enemy in arc and range → man it. */
      engageCannon: 60,
      /** Other damaged parts and moderate water → repair / bail. */
      otherDamage: 40,
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
    },
    telegraph: {
      /** Enemy shells always give at least this much warning, s. */
      minWarningTime: 1.2,
      /** Radius the countdown ring starts at, m. */
      ringStartRadius: 20,
      /** Half-size of the red X, m. */
      markerSize: 5,
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
