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
}

/** The kinds, in menu order (one for now). */
export const NESS_ORDER = ['ness'] as const;

export const NESS: Record<string, NessDef> = {
  ness: {
    id: 'ness',
    name: 'Ness',
    blurb: 'A sea monster a little faster than you. It circles, then rises beside your boat, bites, and grabs on.',
    color: '#6fae86',
  },
};

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
    /** Hurt to this share of its HP (or less) and it breaks off: it lets go, dives, and swims away. Past this distance (m) it is gone. */
    fleeAt: 0.5,
    fleeGone: 150,
    /** Seconds to let go of a hull before diving. */
    releaseTime: 1.2,
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
      /** A gun can shoot a Ness this much closer than its ordinary minimum range (× it). */
      minRangeShare: 0.2,
      /** A mortar shell at a deep Ness scatters this much more per unit of depth (an inaccurate answer, not no answer). */
      mortarDeepScatter: 2.5,
      /** Seconds a dead Ness floats before it fades from the sea. */
      corpseTime: 40,
    },
    kinds: { ness: defaultNessKind() } as Record<string, NessKindTuning>,
  };
}
