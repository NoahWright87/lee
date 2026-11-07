// Nesses (Phase 8): sea monsters, built to be fought like boats. One plain Ness for
// now; the rest of the roster (special attacks, special slots) builds on this template.
//
// A Ness is an oval BODY that moves like a boat (a little faster than yours), with a
// NECK and HEAD that grow from the middle of one flank and reach out to bite, and a
// HAND slot on each flank that can grab your hull. It swims at a depth (0 surfaced,
// 1 deep) and shows as a shadow under the water that grows darker and smaller as it
// rises. Every number is in `defaultNessKind` so the tuning panel can change it.

export interface NessDef {
  id: string;
  name: string;
  /** One line: how it fights. */
  blurb: string;
  /** Body color (CSS hex). */
  color: string;
  /** How it fights: a biter comes alongside and bites and grabs; a spitter keeps its distance and lobs spit. */
  style: 'biter' | 'spitter';
  /** What its slots hold (a hand on each flank for the plain Ness; the spitter has none). */
  slots: NessSlotDef[];
}

/** The kinds, in menu order. */
export const NESS_ORDER = ['ness', 'shy'] as const;

/** What a slot on a Ness holds (its "edge slots": the places a boat keeps hooks and spikes). */
export type NessSlotType = 'hand' | 'foot';

export interface NessSlotDef {
  id: string;
  type: NessSlotType;
  /** Which flank: -1 port (left), +1 starboard (right). */
  side: -1 | 1;
  /** Where along the body, -0.5 (tail) to +0.5 (nose). */
  along: number;
  /** The item in it ('grab' is the plain hand; later: claws, spikes, a special tail). */
  item: string;
}

/** The plain Ness has one hand per flank. */
export const NESS_SLOTS: NessSlotDef[] = [
  { id: 'hand:port', type: 'hand', side: -1, along: 0.25, item: 'grab' },
  { id: 'hand:starboard', type: 'hand', side: 1, along: 0.25, item: 'grab' },
];

export const NESS: Record<string, NessDef> = {
  ness: {
    id: 'ness',
    name: 'Ness',
    blurb: 'A sea monster a little faster than you. It circles, then rises beside your boat, bites, and grabs on.',
    color: '#6fae86',
    style: 'biter',
    slots: NESS_SLOTS,
  },
  shy: {
    id: 'shy',
    name: 'Shyness',
    blurb: 'Keeps its distance. It circles out of reach, rises on your weakest side, spits a few times (a little damage and a lot of water to bail), and sinks again.',
    color: '#d98fa8',
    style: 'spitter',
    slots: [],
  },
};

/** What one Ness kind does, in numbers. Meters, seconds, degrees per second where noted. */
export function defaultNessKind() {
  return {
    /** Points it costs in a stop's budget (each level above 1 adds `levelCost` of this), and how often the generator picks it. */
    cost: 130,
    weight: 1,
    /** The oval body: length, beam (m), mass (for pulling and bumping; a Basic Ship is about 1), and the HP pool the whole Ness shares. */
    length: 24,
    beam: 10,
    mass: 1.4,
    hp: 300,
    /** Shots on its head hurt this many times as much. */
    headMul: 2,
    /** Speed: × your boat's top speed (10–20% faster), at least this many m/s; turn rate, deg/s. */
    speedMul: 1.15,
    /** On its run in to attack it is this much faster again (it "approaches quickly"). */
    chargeMul: 1.35,
    minSpeed: 5,
    turnRate: 16,
    /** Circling: it keeps this far from you (m), the radius wobbles by this much, it circles this long before an attack (s, min..max), and how deep it swims (0 surface, 1 deep). */
    circleRange: 75,
    circleWobble: 18,
    circleMin: 7,
    circleMax: 11,
    circleDepth: 0.85,
    /** Rising: it starts when this close to its slot beside your boat (m), shallow at first (shadow smaller and darker), then breaks the surface over `emergeTime` s. */
    approachFrom: 55,
    shallowDepth: 0.4,
    emergeTime: 2.2,
    /** Diving: seconds from the surface to deep. */
    diveTime: 3.2,
    /** Depth bands: at or below `surfacedMax` it is on the surface (cannons and pistols hit it); to `shallowMax` it is shallow (cannons still do; a depth charge too); deeper only mortars and depth charges reach. */
    surfacedMax: 0.15,
    shallowMax: 0.6,
    /** Beside your boat: the gap between hulls (m), and how far its nose (where the neck grows from) sits ahead of your boat's middle (m): the rest of it lies back along your stern. */
    standoff: 3.5,
    noseAhead: 3,
    /** Neck: it grows from the nose (the skinny end of the oval, centered). Segments, each this long (m), so it reaches about segments × length from the nose; it can bite within this cone ahead of the nose (degrees, total); head size. */
    neckSegments: 3,
    neckLength: 3.6,
    neckCone: 170,
    neckRadius: 1.5,
    headRadius: 2.1,
    /** A bite: seconds before the first one once alongside, the warning (the head rears back, a red rectangle shows), the strike (fast), how long the head stays on your boat (the window to hit it), the retreat, and the pause after. */
    biteFirst: 1.4,
    biteWarn: 1.7,
    biteStrike: 0.22,
    biteHold: 2.2,
    biteRetract: 0.8,
    biteCooldown: 2,
    /** The bite's rectangle (width, m), the full-damage circle at its end (radius, m), the share of damage along the neck, and damage to each Lee and tile at the tip, to the part under it (share of its HP), and the water it lets in. */
    biteWidth: 3,
    biteTipRadius: 2.6,
    biteNeckShare: 0.25,
    biteLeeDamage: 20,
    biteTileDamage: 26,
    bitePartDamage: 0.1,
    biteWater: 1,
    /** Bites per pass: after this many (without a hand holding) it withdraws, dives and circles again. */
    bitesPerPass: 3,
    /** Hands: HP each, how far they reach (m), the flight (s), how close to your hull a throw must land to catch, how fast the line reels in (m/s), the closest it pulls the hulls (m), the pause between throws (s), and seconds alongside before the first. */
    handHp: 28,
    handReach: 14,
    handFlight: 0.8,
    handCatch: 3,
    handReel: 1.6,
    handClose: 2,
    handCooldown: 5,
    handFirst: 2.5,
    handRadius: 1.4,
    /** Hurt to this share of its HP (or less) and it breaks off: it lets go, dives and swims away for `fleeTime` s, then comes back (still hurt). It does this up to `fleeMax` times, each at this share of the last (50%, then 25%); after that it fights on to the end. */
    fleeAt: 0.5,
    fleeTime: 9,
    fleeMax: 2,
    /** Seconds to let go of a hull before diving. */
    releaseTime: 1.2,
    /**
     * Restlessness: a Ness that has gone `restlessTime` s (see `common`) without being hurt is fully restless and gets bolder, so a stalemate breaks.
     * At full: it circles for this share of the time (× `circleMin/Max`), charges this much faster (× `chargeMul`), and bites this many more times a pass.
     */
    restCircle: 0.4,
    restChargeMul: 1.25,
    restBites: 2,
    /** (Spitters, at full restlessness.) The share of its range it settles at (instead of `spitNear`..`spitFar`), the share of its dive-when-close range that is left, the share of its reload left, and how much it still cares to keep to your weak side (1 = fully). */
    restSpitRange: 0.55,
    restSpitThreat: 0.3,
    restSpitReload: 0.8,
    restSpitCover: 0,
    /**
     * Spitting (the spitting kinds only; 0 range = doesn't spit). It keeps `spitNear`..`spitFar` of its range (m) from your boat, on the side with the fewest
     * manned guns, surfaces, and then spits like a cannon: any time your boat is in range, one glob every `spitReload` × a cannon's reload (a little slower,
     * since a neck swings through a wide arc), the head rearing for `biteWarn` s first. A glob flies as long as a cannon ball (`spitShellSpeed` × a cannon's) with
     * its red X up for that time, lands within `spitSpread` m (+ `spitSpreadPerM` per m), and does `spitDamage` × a cannon ball to the part it hits and
     * `spitCrewDamage` × to the Lees there, but lets in `spitWater` units of water (a cannon hit is ~1.5): bail it, or sail slowly.
     * It stays up until it feels threatened, but never before one shot: your hull within `spitThreat` of its range, or its HP at or below `spitDiveHp` of full.
     * Then it dives and circles again. (It also gives up a pass that has had no shot in `spitMaxUp` s.)
     */
    spitRange: 0,
    spitNear: 0.7,
    spitFar: 0.9,
    spitFirst: 0.3,
    spitReload: 1.25,
    spitShellSpeed: 1,
    spitSpread: 1.5,
    spitSpreadPerM: 0.03,
    spitDamage: 0.5,
    spitCrewDamage: 0.4,
    spitWater: 8,
    spitSplash: 1,
    spitThreat: 0.35,
    spitDiveHp: 0.7,
    spitMaxUp: 12,
    spitRadius: 1.8,
  };
}

export type NessKindTuning = ReturnType<typeof defaultNessKind>;

export function defaultNessTuning() {
  return {
    /** Shared by every kind. */
    common: {
      /** How far from you a Ness starts, m. */
      startRange: 150,
      /** Each level adds this share of the kind's HP. */
      levelScale: 0.25,
      /** Each level adds this share of the kind's cost to its price in a stop's budget. */
      levelCost: 0.6,
      /** Most Nesses the generator puts in one fight. */
      maxPerFight: 3,
      /** Pistols and cannons: damage to a Ness × this. */
      damageTaken: 1,
      /** Your Lees take pot shots at any Ness that is up (or shallow) within this many m of them (a sea monster is a big target: a pistol's own range is much shorter). */
      pistolRange: 55,
      /** Seconds without taking damage for a Ness to reach full restlessness (see each kind's `rest*`): the longer a fight goes without it being hurt, the bolder it gets. */
      restlessTime: 30,
      /** A gun can shoot a Ness this much closer than its ordinary minimum range (× it). */
      minRangeShare: 0.2,
      /** A mortar shell at a deep Ness scatters this much more per unit of depth (an inaccurate answer, not no answer). */
      mortarDeepScatter: 2.5,
      /** Seconds a dead Ness floats before it fades from the sea. */
      corpseTime: 40,
    },
    kinds: {
      ness: defaultNessKind(),
      // Shyness: smaller, fragile (it only has the moments it is up to be shot), quick, and it spits from afar.
      shy: {
        ...defaultNessKind(),
        cost: 90,
        weight: 1,
        length: 18,
        beam: 8,
        mass: 1,
        hp: 45,
        speedMul: 1.2,
        chargeMul: 1.25,
        turnRate: 20,
        circleRange: 112,
        circleWobble: 8,
        circleMin: 2,
        circleMax: 4,
        emergeTime: 1.6,
        diveTime: 2.5,
        approachFrom: 70,
        headRadius: 1.8,
        neckLength: 3,
        biteWarn: 0.8,
        biteStrike: 0.2,
        biteHold: 0.25,
        biteRetract: 0.6,
        fleeMax: 1,
        spitRange: 100,
      },
    } as Record<string, NessKindTuning>,
  };
}
