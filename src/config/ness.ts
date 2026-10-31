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
  /** Its deck attacks, in the order it uses them (it cycles through). */
  attacks: NessAttack[];
  /** How solid it looks when it is up (1 = fully; a Quiet Ness is a little see-through). */
  solid?: number;
}

/**
 * A bite is a circle of tiles; a smash a block of tiles (and leaves its head resting on your deck); a slap a band of tiles that pushes;
 * a drag pulls the Lee standing furthest from the others toward the Ness; rain floods the tiles under a cloud for a while; ink blinds the gunners in it.
 */
export type NessAttack = 'bite' | 'smash' | 'slap' | 'drag' | 'rain' | 'ink';

export const NESS_ORDER = ['weak', 'lonely', 'sad', 'mad', 'quiet', 'dark'] as const;

export const NESS: Record<string, NessDef> = {
  weak: {
    id: 'weak',
    name: 'Weak Ness',
    blurb: 'Small and simple. Rises under you with plenty of warning. Comes in packs.',
    color: '#7fb98a',
    coils: 2,
    attacks: ['bite'],
  },
  mad: {
    id: 'mad',
    name: 'Mad Ness',
    blurb: 'Berserk. Rises fast, then smashes and slaps again and again.',
    color: '#c46a5a',
    coils: 3,
    attacks: ['smash', 'slap', 'smash', 'bite'],
  },
  lonely: {
    id: 'lonely',
    name: 'Lonely Ness',
    blurb: 'Goes for the Lee standing furthest from the others, and drags it away.',
    color: '#8a90cf',
    coils: 3,
    attacks: ['drag', 'bite', 'drag'],
  },
  sad: {
    id: 'sad',
    name: 'Sad Ness',
    blurb: 'Cries a raincloud over your deck. The water comes in; the bailing begins.',
    color: '#5f95cc',
    coils: 3,
    attacks: ['rain', 'bite', 'rain'],
  },
  quiet: {
    id: 'quiet',
    name: 'Quiet Ness',
    blurb: 'A faint shadow and almost no warning, unless a Lookout is manned.',
    color: '#a9b4bd',
    coils: 2,
    attacks: ['bite', 'slap'],
    solid: 0.72,
  },
  dark: {
    id: 'dark',
    name: 'Dark Ness',
    blurb: 'Squirts ink. Gunners in it can’t see, and it hides the warnings under it.',
    color: '#4a3f5e',
    coils: 3,
    attacks: ['ink', 'bite', 'ink', 'slap'],
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
    standoff: 5,
    diveHurt: 0.5,
    /** Its head has to be this close to your hull to attack your deck, m. */
    attackRange: 9,
    /** Seconds before its first attack once it is alongside. */
    firstAttack: 1.5,
    /** Bite: a circle of tiles (radius in tiles) where Lees take damage. Warning s, damage to each Lee and tile, seconds before its next attack. */
    biteWarn: 0.9,
    biteRadius: 1.1,
    biteLeeDamage: 9,
    biteTileDamage: 8,
    biteCooldown: 3.2,
    /** Head smash: the block of tiles nearest it (depth × width in tiles) flashes red, then it smashes down. Lees and tiles in it, and the part below, take heavy damage (part: share of its HP). Its head then rests on your deck, stunned, for this long (s). */
    smashWarn: 1.5,
    smashDepth: 2,
    smashWidth: 3,
    smashLeeDamage: 26,
    smashTileDamage: 34,
    smashPartDamage: 0.3,
    smashStun: 4,
    smashCooldown: 2.5,
    /** Stabbing the stunned head: sword damage × this. */
    stabMul: 3,
    /** Tail slap: a band of tiles flashes blue, then it lands: Lees in it are pushed away `slapPush` tiles and knocked off their posts for `slapStagger` s, a little damage, and water floods the parts it lands on. */
    slapWarn: 1.2,
    slapDepth: 2,
    slapWidth: 6,
    slapLeeDamage: 3,
    slapPush: 2,
    slapStagger: 1.2,
    slapWater: 6,
    slapCooldown: 4,
    /** Drag: the Lee furthest from the others is hauled toward the Ness (tiles), hurt, and knocked down; into the edge of the deck it takes more. */
    dragWarn: 1.3,
    dragPush: 4,
    dragLeeDamage: 6,
    dragStagger: 1.4,
    dragCooldown: 3.5,
    /** Rain: a cloud over a block of tiles (depth × width in tiles; 0 width = the whole side) pours water into the parts under it for this many seconds. */
    rainWarn: 1.6,
    rainDepth: 3,
    rainWidth: 0,
    rainTime: 9,
    rainWater: 1.2,
    rainCooldown: 6,
    /** Ink: a cloud of ink over a block of tiles for a while. Lees in it aim at this share of their usual accuracy, and the warnings under it can't be seen. */
    inkWarn: 1,
    inkDepth: 3,
    inkWidth: 5,
    inkTime: 8,
    inkBlind: 0.35,
    inkCooldown: 4.5,
    /** Harpooned: the line's HP, how fast it strains against it (HP/s, while it wants to dive), how fast the line reels it in (m/s) and the closest it is pulled to your hull (m). */
    tetherHp: 30,
    tetherStrain: 3,
    tetherReel: 2.5,
    tetherClose: 3,
    /** A Hydrophone manned: extra seconds of warning before it rises. */
    hydroExtra: 1,
    /** Quiet: 1 = a faint shadow, and the ring only goes up this many seconds before it rises, unless a Lookout is manned. */
    stealth: 0,
    quietWarn: 0.9,
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
      /** A mortar shell that lands on a shadow hurts it: × the shell's damage. */
      mortarUnderwater: 0.7,
      /** How far from your hull you can see a Ness's shadow, m (a manned Hydrophone ×`hydroSight`). */
      sight: 130,
      hydroSight: 2.2,
      /** Seconds a dead Ness takes to sink away. */
      sinkTime: 2.5,
      /** Seconds a Ness stays hidden behind a diving or rising animation (drawn only). */
      fadeTime: 0.8,
      /** Seconds the ring lingers after it rises (drawn only). */
      ringLinger: 0.4,
    },
    kinds: {
      weak: defaultNessKind(),
      lonely: {
        ...defaultNessKind(),
        cost: 40,
        headHp: 45,
        coilHp: 30,
        tailHp: 24,
        segment: 4.2,
        coilRadius: 2.2,
        speed: 9,
        dragCooldown: 3,
      },
      sad: {
        ...defaultNessKind(),
        cost: 50,
        headHp: 55,
        coilHp: 40,
        tailHp: 30,
        headRadius: 3.5,
        coilRadius: 3,
        speed: 6.5,
        turnRate: 1,
        warn: 2.4,
        surfacedMin: 12,
        surfacedMax: 16,
        biteLeeDamage: 6,
      },
      quiet: {
        ...defaultNessKind(),
        cost: 55,
        headHp: 38,
        coilHp: 28,
        tailHp: 22,
        speed: 9,
        stealth: 1,
        warn: 2.2,
        quietWarn: 0.9,
        surfacedMin: 6,
        surfacedMax: 9,
        slapCooldown: 2.5,
        biteCooldown: 2,
      },
      dark: {
        ...defaultNessKind(),
        cost: 60,
        headHp: 60,
        coilHp: 40,
        tailHp: 30,
        headRadius: 3.6,
        coilRadius: 3,
        speed: 8,
        surfacedMin: 11,
        surfacedMax: 15,
      },
      mad: {
        ...defaultNessKind(),
        cost: 60,
        headHp: 70,
        coilHp: 45,
        tailHp: 36,
        headRadius: 3.8,
        coilRadius: 3.1,
        tailRadius: 2.3,
        speed: 10,
        turnRate: 1.7,
        submergedMin: 3,
        submergedMax: 6,
        warn: 1.6,
        ringRadius: 13,
        surfacedMin: 12,
        surfacedMax: 18,
        smashCooldown: 1.2,
        slapCooldown: 1.2,
        biteCooldown: 1.5,
        diveHurt: 0.7,
      },
    } as Record<string, NessKindTuning>,
  };
}
