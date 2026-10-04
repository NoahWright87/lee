// Equipment, Treasures and Trinkets are content. An item declares the slot
// types it fits, its tags, its numbers (`params`, mirrored into
// tuning.items.<id> so they're live-tunable) and its effects. Effects are
// generic: "<op> <stat> of <scope> by <param>". Guns, stations and rail items
// also name a behavior kind the sim knows how to run (a new kind is new code;
// a new item of an existing kind is just an entry here).
//
// Every item should have an upside and a cost (or be situational): `tradeoff`
// says what the cost is, in words, on its card.

import type { SlotType } from './slots';
import type { Tag } from './tags';

export type ItemCategory = 'gun' | 'station' | 'rail' | 'hull' | 'attachment' | 'floor' | 'treasure' | 'trinket';

/** Who an effect applies to. */
export type EffectScope =
  /** Boat-wide stats: speed, turn, leak, gunRange, gunSpread, gunMinRange. */
  | 'boat'
  /** Every hull part: hp (×), hpFlat (+). */
  | 'allParts'
  /** The hull part of the item's slot: hp (×), armor (+, an armor layer). */
  | 'part'
  /** The engine part(s): hp (×). */
  | 'engine'
  /** The tile of the item's slot: durability (×). */
  | 'tile'
  /** Any Lee standing on the item's tile: Lee stats. */
  | 'occupant'
  /** The gun this attachment is on: arc, reload, spread (×), gunnerImpact (× impact taken by its gunner). */
  | 'gun'
  /** Every Lee of the boat's crew: Lee stats. */
  | 'crew'
  /** The Lee wearing this trinket: Lee stats. */
  | 'wearer';

export interface EffectDef {
  scope: EffectScope;
  stat: string;
  op: 'mul' | 'add';
  /** Name of the number in the item's params (tuning.items.<id>.<param>). */
  param: string;
}

export type StationKind = 'gun' | 'oars' | 'sails' | 'lookout' | 'pump' | 'hooks' | 'powder';
export type RailKind = 'spikes' | 'fence' | 'planks';
/** How a gun's shot travels and is telegraphed. */
export type GunMode = 'shell' | 'lob' | 'stream' | 'burst';

export interface ItemDef {
  id: string;
  name: string;
  /** Emoji or a short glyph for cards. */
  icon: string;
  description: string;
  flavor?: string;
  tradeoff: string;
  category: ItemCategory;
  fits: SlotType[];
  tags: Tag[];
  params: Record<string, number>;
  effects: EffectDef[];
  gun?: { mode: GunMode; targets: 'hull' | 'crew' };
  station?: Exclude<StationKind, 'gun'>;
  rail?: RailKind;
  /** Explodes when its tile is blown out (tuning.explosion, × params.blast). */
  volatile?: boolean;
  /** Relative chance of showing up as a reward or starting part (0 = never). */
  rewardWeight: number;
}

const fx = (scope: EffectScope, stat: string, op: 'mul' | 'add', param = stat): EffectDef => ({ scope, stat, op, param });

/**
 * Gun numbers are multipliers on tuning.guns (the standard cannon), except
 * `arc` (full width, degrees) and `pellets`. `spreadPerMeter` adds scatter that
 * grows with distance (streams and bursts).
 */
const gunParams = (p: Partial<Record<'arc' | 'damage' | 'crewDamage' | 'reload' | 'shellSpeed' | 'range' | 'minRange' | 'spread' | 'spreadPerMeter' | 'pellets' | 'splash', number>>) => ({
  arc: 70,
  damage: 1,
  crewDamage: 1,
  reload: 1,
  shellSpeed: 1,
  range: 1,
  minRange: 1,
  spread: 1,
  spreadPerMeter: 0,
  pellets: 1,
  splash: 1,
  ...p,
});

const list: ItemDef[] = [
  // ------------------------------------------------------------ guns
  {
    id: 'cannon',
    name: 'Cannon',
    icon: '💣',
    description: 'The standard gun. A 70° arc from the slot it sits in.',
    tradeoff: 'None: the baseline everything else is measured against.',
    category: 'gun',
    fits: ['edge'],
    tags: [],
    params: gunParams({}),
    effects: [],
    gun: { mode: 'shell', targets: 'hull' },
    rewardWeight: 3,
  },
  {
    id: 'longGun',
    name: 'Long Gun',
    icon: '🎯',
    description: 'Reaches 50% farther with fast, tight shells.',
    tradeoff: 'Very narrow arc (35°): you point the whole boat. Slow to reload, can’t hit close targets.',
    category: 'gun',
    fits: ['edge'],
    tags: ['skirmish'],
    params: gunParams({ arc: 35, damage: 0.8, crewDamage: 0.8, reload: 1.5, shellSpeed: 1.6, range: 1.5, minRange: 1.5, spread: 0.7 }),
    effects: [],
    gun: { mode: 'shell', targets: 'hull' },
    rewardWeight: 2,
  },
  {
    id: 'carronade',
    name: 'Carronade',
    icon: '💥',
    description: 'Hits hard up close, with a wide 85° arc.',
    tradeoff: 'Short range and slow shells; reloads slower.',
    category: 'gun',
    fits: ['edge'],
    tags: ['board'],
    params: gunParams({ arc: 85, damage: 1.8, crewDamage: 1.2, reload: 1.3, shellSpeed: 0.8, range: 0.6, minRange: 0.4, spread: 1.3 }),
    effects: [],
    gun: { mode: 'shell', targets: 'hull' },
    rewardWeight: 2,
  },
  {
    id: 'swivel',
    name: 'Swivel Gun',
    icon: '🔄',
    description: 'Fires all the way around (360°), quickly. Fits edge or interior.',
    tradeoff: 'Weak against hulls; scattered.',
    category: 'gun',
    fits: ['edge', 'interior'],
    tags: ['skirmish'],
    params: gunParams({ arc: 360, damage: 0.3, crewDamage: 0.6, reload: 0.5, shellSpeed: 1.4, range: 0.8, minRange: 0.4, spread: 1.5 }),
    effects: [],
    gun: { mode: 'shell', targets: 'hull' },
    rewardWeight: 2,
  },
  {
    id: 'mortar',
    name: 'Mortar',
    icon: '☄️',
    description: 'A slow, high lob with a big splash (×2). Interior, 180° arc around its facing.',
    tradeoff: 'The shell is slow and obvious, so it can be dodged. Can’t hit anything close.',
    category: 'gun',
    fits: ['interior'],
    tags: ['barrage'],
    params: gunParams({ arc: 180, damage: 1.5, crewDamage: 1, reload: 2, shellSpeed: 0.5, range: 1.2, minRange: 2, spread: 1, splash: 2 }),
    effects: [],
    gun: { mode: 'lob', targets: 'hull' },
    rewardWeight: 1.5,
  },
  {
    id: 'gatling',
    name: 'Gatling',
    icon: '🌪️',
    description: 'A stream of bullets at enemy crew. Scatter grows with distance: it shreds Lees up close.',
    tradeoff: 'Barely scratches hulls. Only fires when it can see enemy Lees.',
    category: 'gun',
    fits: ['edge'],
    tags: ['board'],
    // Phase 3's playtested gatling: 3 damage a bullet, ~2.5 bullets/s, 110 m.
    params: gunParams({ arc: 120, damage: 0.015, crewDamage: 0.3, reload: 0.13, shellSpeed: 3, range: 0.85, minRange: 0, spread: 0.15, spreadPerMeter: 0.03 }),
    effects: [],
    gun: { mode: 'stream', targets: 'crew' },
    rewardWeight: 1.5,
  },
  {
    id: 'scrap',
    name: 'Scrap Cannon',
    icon: '🧨',
    description: 'A big shotgun: a burst of 8 fast pellets meant for crew. Up close they bunch up and shred a deck.',
    tradeoff: 'Wildly inaccurate at range; little damage to hulls.',
    category: 'gun',
    fits: ['edge'],
    tags: ['board'],
    params: gunParams({ arc: 60, damage: 0.12, crewDamage: 0.5, reload: 1.4, shellSpeed: 2, range: 1.3, minRange: 0.25, spread: 0.3, spreadPerMeter: 0.09, pellets: 8 }),
    effects: [],
    gun: { mode: 'burst', targets: 'hull' },
    rewardWeight: 1.5,
  },

  // ------------------------------------------------------------ stations
  {
    id: 'oars',
    name: 'Oars',
    icon: '🚣',
    description: 'A rowing station: each manned set adds speed (they stack).',
    tradeoff: 'Needs a Lee on it, and does nothing while attached.',
    category: 'station',
    fits: ['edge'],
    tags: ['skirmish'],
    params: { boost: 0.2 },
    effects: [],
    station: 'oars',
    rewardWeight: 2,
  },
  {
    id: 'sail',
    name: 'Sail',
    icon: '⛵',
    description: 'A sail station: adds turning while manned.',
    tradeoff: 'Needs a Lee on it, and does nothing while attached.',
    category: 'station',
    fits: ['interior'],
    tags: ['skirmish'],
    params: { boost: 0.4 },
    effects: [],
    station: 'sails',
    rewardWeight: 2,
  },
  {
    id: 'lookout',
    name: 'Lookout',
    icon: '🔭',
    description: 'While manned, every gunner aims better (less spread).',
    tradeoff: 'A Lee up here is a tall target: pistols reach him from 50% farther.',
    category: 'station',
    fits: ['interior'],
    tags: ['barrage'],
    params: { accuracy: 0.35, exposure: 1.5 },
    effects: [],
    station: 'lookout',
    rewardWeight: 1.5,
  },
  {
    id: 'pump',
    name: 'Bilge Pump',
    icon: '🪣',
    description: 'While manned, pumps water out of the boat far faster than bailing.',
    tradeoff: 'Does nothing if the boat isn’t flooding.',
    category: 'station',
    fits: ['edge', 'interior'],
    tags: ['bulwark'],
    params: { rate: 4 },
    effects: [],
    station: 'pump',
    rewardWeight: 1.5,
  },
  {
    id: 'hooks',
    name: 'Boarding Hooks',
    icon: '🪝',
    description: 'While manned, grappling takes half as long and your Lees swing across 30% faster.',
    tradeoff: 'Does nothing at range.',
    category: 'station',
    fits: ['edge'],
    tags: ['board'],
    params: { grapple: 0.5, swing: 0.7 },
    effects: [],
    station: 'hooks',
    rewardWeight: 1.5,
  },
  {
    id: 'powder',
    name: 'Powder Store',
    icon: '🛢️',
    description: 'While manned, every gun reloads 20% faster.',
    tradeoff: 'Volatile: if its tile is blown out, it explodes and takes the tiles around it with it.',
    category: 'station',
    fits: ['interior'],
    tags: ['barrage'],
    params: { reload: 0.8, blast: 1 },
    effects: [],
    station: 'powder',
    volatile: true,
    rewardWeight: 1.5,
  },

  // ------------------------------------------------------------ rail items
  {
    id: 'spikes',
    name: 'Spikes',
    icon: '🔱',
    description: 'Rams through this edge hit 50% harder. A boat attached here takes slow damage, and enemy Lees landing on this tile get hurt.',
    tradeoff: 'No effect at range. Any attachment through this edge takes longer to cast off, for both boats.',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { ramBonus: 0.5, attachedDps: 0.6, landDamage: 8, disengageExtra: 2 },
    effects: [],
    rail: 'spikes',
    rewardWeight: 1.5,
  },
  {
    id: 'fence',
    name: 'Fence',
    icon: '🚧',
    description: 'A barricade: enemy Lees can’t swing onto this tile while it stands. Pistols fire through it both ways; your Lees swing out freely.',
    tradeoff: 'Covers one tile only, and does nothing against a ram. Gone for the fight once broken.',
    category: 'rail',
    fits: ['rail'],
    tags: ['bulwark'],
    params: { hp: 40 },
    effects: [],
    rail: 'fence',
    rewardWeight: 1.5,
  },
  {
    id: 'planks',
    name: 'Boarding Planks',
    icon: '🪵',
    description: 'Lees leaving from this tile swing 30% faster and hit 15% harder with pistols over there.',
    tradeoff: 'They can be shot while swinging.',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { swing: 1.3, pistolDamage: 1.15 },
    effects: [],
    rail: 'planks',
    rewardWeight: 1.5,
  },

  // ------------------------------------------------------------ hull modules
  {
    id: 'ironPlating',
    name: 'Iron Plating',
    icon: '🔩',
    description: 'An armor layer on this part: it soaks damage before the part takes any.',
    tradeoff: 'Heavy: −4% speed.',
    category: 'hull',
    fits: ['hull'],
    tags: ['bulwark'],
    params: { armor: 35, speed: 0.96 },
    effects: [fx('part', 'armor', 'add'), fx('boat', 'speed', 'mul')],
    rewardWeight: 1.5,
  },
  {
    id: 'keel',
    name: 'Reinforced Keel',
    icon: '⚓',
    description: 'Every part leaks 40% slower.',
    tradeoff: '−3% top speed.',
    category: 'hull',
    fits: ['hull'],
    tags: ['bulwark'],
    params: { leak: 0.6, speed: 0.97 },
    effects: [fx('boat', 'leak', 'mul'), fx('boat', 'speed', 'mul')],
    rewardWeight: 1.5,
  },
  {
    id: 'rudder',
    name: 'Racing Rudder',
    icon: '☸️',
    description: '+25% turn rate.',
    tradeoff: '−10% HP on the engine.',
    category: 'hull',
    fits: ['hull'],
    tags: ['skirmish'],
    params: { turn: 1.25, engineHp: 0.9 },
    effects: [fx('boat', 'turn', 'mul'), fx('engine', 'hp', 'mul', 'engineHp')],
    rewardWeight: 1.5,
  },
  {
    id: 'streamlined',
    name: 'Streamlined Hull',
    icon: '🐬',
    description: '+20% speed.',
    tradeoff: '−10% HP on every part.',
    category: 'hull',
    fits: ['hull'],
    tags: ['skirmish'],
    params: { speed: 1.2, hullHp: 0.9 },
    effects: [fx('boat', 'speed', 'mul'), fx('allParts', 'hp', 'mul', 'hullHp')],
    rewardWeight: 1.5,
  },
  {
    id: 'rangefinder',
    name: 'Rangefinder',
    icon: '🔍',
    description: 'Every gun: +20% range and 10% tighter spread.',
    tradeoff: 'Minimum range is 20% larger too.',
    category: 'hull',
    fits: ['hull'],
    tags: ['skirmish'],
    params: { range: 1.2, spread: 0.9, minRange: 1.2 },
    effects: [fx('boat', 'gunRange', 'mul', 'range'), fx('boat', 'gunSpread', 'mul', 'spread'), fx('boat', 'gunMinRange', 'mul', 'minRange')],
    rewardWeight: 1.5,
  },

  // ------------------------------------------------------------ gun attachments
  {
    id: 'gunShield',
    name: 'Gun Shield',
    icon: '🛡️',
    description: 'Its gunner takes 40% less impact damage.',
    tradeoff: 'The plating blocks the view: arc −30%, reload ×1.1.',
    category: 'attachment',
    fits: ['attachment'],
    tags: ['bulwark'],
    params: { gunnerImpact: 0.6, arc: 0.7, reload: 1.1 },
    effects: [fx('gun', 'gunnerImpact', 'mul'), fx('gun', 'arc', 'mul'), fx('gun', 'reload', 'mul')],
    rewardWeight: 1.2,
  },
  {
    id: 'wideMount',
    name: 'Wide Mount',
    icon: '↔️',
    description: 'Arc +30%.',
    tradeoff: 'Spread ×1.15.',
    category: 'attachment',
    fits: ['attachment'],
    tags: ['barrage'],
    params: { arc: 1.3, spread: 1.15 },
    effects: [fx('gun', 'arc', 'mul'), fx('gun', 'spread', 'mul')],
    rewardWeight: 1.2,
  },

  // ------------------------------------------------------------ floor upgrades
  {
    id: 'reinforcedPlanks',
    name: 'Reinforced Planks',
    icon: '🧱',
    description: 'This tile is twice as hard to blow out, and a Lee standing on it takes 25% less impact damage.',
    tradeoff: '−1% top speed per tile.',
    category: 'floor',
    fits: ['floor'],
    tags: ['bulwark'],
    params: { durability: 2, impact: 0.75, speed: 0.99 },
    effects: [fx('tile', 'durability', 'mul'), fx('occupant', 'impactTaken', 'mul', 'impact'), fx('boat', 'speed', 'mul')],
    rewardWeight: 1.2,
  },
  {
    id: 'grippy',
    name: 'Grippy Boards',
    icon: '👣',
    description: 'Lees cross this tile 25% faster.',
    tradeoff: 'None, but it only helps on busy routes.',
    category: 'floor',
    fits: ['floor'],
    tags: ['skirmish'],
    params: { walk: 1.25 },
    effects: [fx('occupant', 'walkSpeed', 'mul', 'walk')],
    rewardWeight: 1.2,
  },

  // ------------------------------------------------------------ treasures
  {
    id: 'ironE',
    name: 'Iron E',
    icon: 'F',
    description: 'Iron E',
    tradeoff: '',
    category: 'treasure',
    fits: ['treasure'],
    tags: [],
    params: { hpFlat: 10 },
    effects: [fx('allParts', 'hpFlat', 'add')],
    rewardWeight: 1,
  },
  {
    id: 'sextant',
    name: 'Sextant',
    icon: '📐',
    description: 'Gun range +10%.',
    tradeoff: 'Takes a treasure slot.',
    category: 'treasure',
    fits: ['treasure'],
    tags: ['skirmish'],
    params: { range: 1.1 },
    effects: [fx('boat', 'gunRange', 'mul', 'range')],
    rewardWeight: 1,
  },
  {
    id: 'cat',
    name: "Ship's Cat",
    icon: '🐈',
    description: 'All your Lees walk 8% faster.',
    tradeoff: 'Takes a treasure slot.',
    category: 'treasure',
    fits: ['treasure'],
    tags: [],
    params: { walk: 1.08 },
    effects: [fx('crew', 'walkSpeed', 'mul', 'walk')],
    rewardWeight: 1,
  },
  {
    id: 'compass',
    name: 'Brass Compass',
    icon: '🧭',
    description: 'Turn rate +10%.',
    tradeoff: 'Takes a treasure slot.',
    category: 'treasure',
    fits: ['treasure'],
    tags: ['skirmish'],
    params: { turn: 1.1 },
    effects: [fx('boat', 'turn', 'mul')],
    rewardWeight: 1,
  },

  // ------------------------------------------------------------ trinkets
  {
    id: 'cutlass',
    name: 'Cutlass',
    icon: '🗡️',
    description: 'Sword damage +20%.',
    tradeoff: 'Wasted on a gunner.',
    category: 'trinket',
    fits: ['trinket'],
    tags: ['board'],
    params: { melee: 1.2 },
    effects: [fx('wearer', 'meleeDamage', 'mul', 'melee')],
    rewardWeight: 1,
  },
  {
    id: 'woodenLeg',
    name: 'Wooden Leg',
    icon: '🦵',
    description: 'HP +25%.',
    tradeoff: 'Walks 10% slower.',
    category: 'trinket',
    fits: ['trinket'],
    tags: ['bulwark'],
    params: { hp: 1.25, walk: 0.9 },
    effects: [fx('wearer', 'hp', 'mul'), fx('wearer', 'walkSpeed', 'mul', 'walk')],
    rewardWeight: 1,
  },
  {
    id: 'toolBelt',
    name: 'Tool Belt',
    icon: '🧰',
    description: 'Repair and bailing +20%.',
    tradeoff: 'Wasted off damage control.',
    category: 'trinket',
    fits: ['trinket'],
    tags: ['bulwark'],
    params: { repair: 1.2, bail: 1.2 },
    effects: [fx('wearer', 'repairRate', 'mul', 'repair'), fx('wearer', 'bailRate', 'mul', 'bail')],
    rewardWeight: 1,
  },
  {
    id: 'seaLegs',
    name: 'Sea Legs',
    icon: '🌊',
    description: 'Walks 15% faster.',
    tradeoff: 'None.',
    category: 'trinket',
    fits: ['trinket'],
    tags: ['skirmish'],
    params: { walk: 1.15 },
    effects: [fx('wearer', 'walkSpeed', 'mul', 'walk')],
    rewardWeight: 1,
  },
  {
    id: 'spyglassTrinket',
    name: 'Spyglass',
    icon: '🧿',
    description: 'Spotting +30%.',
    tradeoff: 'Sword damage −10%.',
    category: 'trinket',
    fits: ['trinket'],
    tags: ['barrage'],
    params: { spotting: 1.3, melee: 0.9 },
    effects: [fx('wearer', 'spotting', 'mul'), fx('wearer', 'meleeDamage', 'mul', 'melee')],
    rewardWeight: 1,
  },
  {
    id: 'rumFlask',
    name: 'Rum Flask',
    icon: '🍶',
    description: 'HP +15%.',
    tradeoff: 'Accuracy −10%.',
    category: 'trinket',
    fits: ['trinket'],
    tags: [],
    params: { hp: 1.15, accuracy: 0.9 },
    effects: [fx('wearer', 'hp', 'mul'), fx('wearer', 'accuracy', 'mul')],
    rewardWeight: 1,
  },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((d) => [d.id, d]));

export const CATEGORY_NAMES: Record<ItemCategory, string> = {
  gun: 'Gun',
  station: 'Station',
  rail: 'Rail item',
  hull: 'Hull module',
  attachment: 'Gun attachment',
  floor: 'Floor upgrade',
  treasure: 'Treasure',
  trinket: 'Trinket',
};

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Default item numbers (tuning.items is built from this). */
export function defaultItemParams(): Record<string, Record<string, number>> {
  return Object.fromEntries(list.map((d) => [d.id, { ...d.params }]));
}
