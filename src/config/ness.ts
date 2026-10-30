// Nesses (Phase 8): sea monsters, named for a -ness word, whose attacks match the
// name. A kind is data: what it looks like and how many parts it has here, and
// every number in `defaultNessTuning` (so the tuning panel can change it). A new
// Ness is an entry in both, plus code only for a new kind of attack.

export interface NessDef {
  id: string;
  /** "Weak Ness". */
  name: string;
  /** One line: how it fights (the name tells you). */
  blurb: string;
  /** Body color (CSS hex). */
  color: string;
  /** Coils between the head and the tail. */
  coils: number;
}

export const NESS_ORDER = ['weak'] as const;

export const NESS: Record<string, NessDef> = {
  weak: {
    id: 'weak',
    name: 'Weak Ness',
    blurb: 'Small and simple. Rises under you with plenty of warning. Comes in packs.',
    color: '#7fb98a',
    coils: 2,
  },
};

/** What one Ness kind does, in numbers. Meters, seconds, radians per second where noted. */
export function defaultNessKind() {
  return {
    /** Points it costs in a stop's budget. */
    cost: 30,
    /** HP of the head (zero kills it), each coil, and the tail. */
    headHp: 40,
    coilHp: 30,
    tailHp: 24,
    /** Distance between body parts along the spine, m, and the radius of each part (what a shell has to land within). */
    segment: 4.6,
    headRadius: 3.2,
    coilRadius: 2.6,
    tailRadius: 1.9,
    /** Swimming speed, m/s, and how fast it turns, rad/s. */
    speed: 8,
    turnRate: 1.3,
    /** Underwater: it lurks this far from your hull, m, for this long (min..max, s) between rises. */
    lurkRange: 60,
    submergedMin: 5,
    submergedMax: 9,
    /** It commits to rising once it's within this distance of your hull, m. */
    emergeTrigger: 90,
    /** The warning before it rises, s, and the size of the ring that marks where, m. */
    warn: 2.2,
    ringRadius: 11,
    /** Rising under a part: damage as a share of that part's full HP (1 wrecks it), and the damage to each tile and Lee in the ring. */
    emergeDamage: 1.1,
    emergeTileDamage: 40,
    emergeLeeDamage: 14,
    /** Surfaced: seconds before it dives (min..max), how far off your hull it keeps, m, and the share of its head HP lost since rising that makes it dive early. */
    surfacedMin: 8,
    surfacedMax: 12,
    standoff: 12,
    diveHurt: 0.5,
  };
}

export type NessKindTuning = ReturnType<typeof defaultNessKind>;

export function defaultNessTuning() {
  return {
    /** Shared by every kind. */
    common: {
      /** How far from you a Ness starts, m. */
      startRange: 150,
      /** Each level adds this share of the kind's HP (and later its damage). */
      levelScale: 0.25,
      /** Pistols and cannons: damage to a Ness part × this. */
      damageTaken: 1,
      /** Seconds a dead Ness takes to sink away. */
      sinkTime: 2.5,
      /** Seconds a Ness stays hidden behind a diving or rising animation (drawn only). */
      fadeTime: 0.8,
      /** Seconds the ring lingers after it rises (drawn only). */
      ringLinger: 0.4,
    },
    kinds: { weak: defaultNessKind() } as Record<string, NessKindTuning>,
  };
}
