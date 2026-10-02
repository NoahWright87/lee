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
    cannons: {
      /** Guns on each broadside cannon section (next run). */
      perSide: 2,
      /** Seconds to load one shot. */
      reloadTime: 3,
      /** Max range, m. */
      range: 130,
      /** Half-width of each gun's firing arc around its beam, degrees. */
      arc: 35,
      /** HP damage per shell. */
      damage: 10,
      /** Random scatter radius around the aim point, m. */
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
  return {
    global: {
      /**
       * Scales the player's HP (×), reload time (÷), leak multipliers (÷) and turn rate
       * (× sqrt). 1 = boats are equal apart from their own tuning.
       */
      playerAdvantage: 1.4,
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
      /** 0 = pick the side needing the smaller turn at the start, 1 = clockwise, -1 = counter-clockwise. */
      orbitDirection: 0,
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
      stripBoatFill: 0.72,
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
