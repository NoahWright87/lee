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
  /** Boat-wide stats: speed, turn, leak, gunRange, gunSpread, gunMinRange, boardRange, swing (swing time ×). */
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

export type StationKind = 'gun' | 'oars' | 'sails' | 'lookout' | 'pump' | 'powder';
export type RailKind = 'spikes' | 'fence' | 'planks' | 'rope' | 'hook' | 'pole';
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
  /** Relative chance of showing up in a shop, a wreck or a reward (0 = never). */
  rewardWeight: number;
  /** Rare: only the trinket dealer and special rewards offer it, never ordinary shops or enemies. */
  rare?: boolean;
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
    description: 'The standard gun: a 70° arc.',
    tradeoff: '',
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
    tradeoff: 'Narrow 35° arc, slow reload, no close shots.',
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
    tradeoff: 'Short range, slow shells, slow reload.',
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
    description: 'Fires all the way around, quickly.',
    tradeoff: 'Weak and scattered.',
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
    description: 'A slow lob with a big splash, 180° arc.',
    tradeoff: 'Easy to dodge; no close shots.',
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
    description: 'Sprays bullets at enemy crew; deadly up close.',
    tradeoff: 'Barely scratches hulls.',
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
    description: 'A shotgun: 8 pellets that shred a crew up close.',
    tradeoff: 'Inaccurate at range; weak on hulls.',
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
    description: 'More speed while manned (sets stack).',
    tradeoff: '',
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
    description: 'More turning while manned.',
    tradeoff: '',
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
    description: 'Every gunner aims better while manned.',
    tradeoff: 'Its Lee is an easy pistol target.',
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
    description: 'Pumps water out fast while manned.',
    tradeoff: 'Idle unless you’re flooding.',
    category: 'station',
    fits: ['edge', 'interior'],
    tags: ['bulwark'],
    params: { rate: 4 },
    effects: [],
    station: 'pump',
    rewardWeight: 1.5,
  },
  {
    id: 'powder',
    name: 'Powder Store',
    icon: '🛢️',
    description: 'Guns reload 20% faster while manned.',
    tradeoff: 'Explodes if its tile is blown out.',
    category: 'station',
    fits: ['interior'],
    tags: ['barrage'],
    params: { reload: 0.8, blast: 1 },
    effects: [],
    station: 'powder',
    volatile: true,
    rewardWeight: 1.5,
  },
  {
    id: 'crowsNest',
    name: "Crow's Nest",
    icon: '🪺',
    description: 'While manned: see enemy parts on the sea map, and gunners aim a little better.',
    tradeoff: 'Less aim than a Lookout; its Lee is an easy pistol target.',
    category: 'station',
    fits: ['interior'],
    tags: ['barrage'],
    // Works like a Lookout in a fight (a weaker one), and reveals parts on the map.
    params: { accuracy: 0.15, exposure: 1.3 },
    effects: [],
    station: 'lookout',
    rewardWeight: 1.2,
  },

  // ------------------------------------------------------------ rail items
  {
    id: 'spikes',
    name: 'Spikes',
    icon: '🔱',
    description: 'Rams hit 50% harder; boats touching it and boarders landing here get hurt.',
    tradeoff: '',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { ramBonus: 0.5, attachedDps: 0.6, landDamage: 8 },
    effects: [],
    rail: 'spikes',
    rewardWeight: 1.5,
  },
  {
    id: 'fence',
    name: 'Fence',
    icon: '🚧',
    description: 'Enemy Lees can’t land on this tile.',
    tradeoff: 'Breaks under fire.',
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
    description: 'Tap to lower onto a hull within 2 m: Lees walk across, faster than swinging, and shoot harder.',
    tradeoff: 'Shootable mid-crossing. An enemy plank on your rail can be destroyed.',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { swing: 1.3, pistolDamage: 1.15 },
    effects: [],
    rail: 'planks',
    rewardWeight: 1.5,
  },

  {
    id: 'hooks',
    name: 'Boarding Hooks',
    icon: '🪝',
    description: 'Tap to throw a hook at your ⚔️ target. A hook that lands is a line that slowly pulls the boats together.',
    tradeoff: 'The throw is telegraphed (steer off to dodge it) and the line can be cut. Cooldown after a cut.',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { range: 1, pull: 1, hp: 1 },
    effects: [],
    rail: 'hook',
    rewardWeight: 1.3,
  },
  {
    id: 'ropes',
    name: 'Swinging Ropes',
    icon: '🪢',
    description: 'Tap to send ⚔️ Lees across one at a time, from 50% farther away and 30% faster than planks.',
    tradeoff: 'One Lee per rope at a time. Cut a rope and the Lee swinging on it falls short.',
    category: 'rail',
    fits: ['rail'],
    tags: ['board'],
    params: { reach: 1.5, swing: 0.7 },
    effects: [],
    rail: 'rope',
    rewardWeight: 1.3,
  },
  {
    id: 'poles',
    name: 'Push Poles',
    icon: '🦯',
    description: 'Tap to shove the boats apart. Cut the lines first, or it only strains against them.',
    tradeoff: 'Short shove, then a cooldown.',
    category: 'rail',
    fits: ['rail'],
    tags: ['bulwark'],
    params: { push: 1 },
    effects: [],
    rail: 'pole',
    rewardWeight: 1,
  },

  // ------------------------------------------------------------ hull modules
  {
    id: 'ironPlating',
    name: 'Iron Plating',
    icon: '🔩',
    description: 'Armor that soaks damage first.',
    tradeoff: '−4% speed.',
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
    tradeoff: '−3% speed.',
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
    tradeoff: '−10% engine HP.',
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
    tradeoff: '−10% HP everywhere.',
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
    description: 'Every gun: +20% range, tighter spread.',
    tradeoff: 'Bigger minimum range.',
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
    description: 'Its gunner takes 40% less damage.',
    tradeoff: 'Arc −30%, slower reload.',
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
    tradeoff: 'Spread +15%.',
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
    description: 'Tile twice as tough; its Lee takes less damage.',
    tradeoff: '−1% speed.',
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
    tradeoff: '',
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
    rare: true,
  },
  {
    id: 'sextant',
    name: 'Sextant',
    icon: '📐',
    description: 'Gun range +10%.',
    tradeoff: '',
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
    tradeoff: '',
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
    tradeoff: '',
    category: 'treasure',
    fits: ['treasure'],
    tags: ['skirmish'],
    params: { turn: 1.1 },
    effects: [fx('boat', 'turn', 'mul')],
    rewardWeight: 1,
  },

  // Between-fight treasures: they do nothing in a fight (the run reads them).
  {
    id: 'ledger',
    name: "Haggler's Ledger",
    icon: '📒',
    description: 'Shop rerolls cost 40% less.',
    tradeoff: 'Nothing in a fight.',
    category: 'treasure',
    fits: ['treasure'],
    tags: [],
    params: { rerollCost: 0.6 },
    effects: [],
    rewardWeight: 0.8,
    rare: true,
  },
  {
    id: 'luckyCoin',
    name: 'Lucky Coin',
    icon: '🪙',
    description: 'Reroll costs climb slower.',
    tradeoff: 'Nothing in a fight.',
    category: 'treasure',
    fits: ['treasure'],
    tags: [],
    params: { rerollRamp: 1.2 },
    effects: [],
    rewardWeight: 0.8,
    rare: true,
  },
  {
    id: 'surgeonKit',
    name: "Ship's Surgeon's Kit",
    icon: '🩹',
    description: 'Lees heal 25% more of their wounds after every fight.',
    tradeoff: 'Nothing in a fight.',
    category: 'treasure',
    fits: ['treasure'],
    tags: ['bulwark'],
    params: { heal: 0.25 },
    effects: [],
    rewardWeight: 0.8,
  },
  {
    id: 'carpenterChest',
    name: "Carpenter's Chest",
    icon: '🪚',
    description: 'The hull repairs 25% more of its damage after every fight.',
    tradeoff: 'Nothing in a fight.',
    category: 'treasure',
    fits: ['treasure'],
    tags: ['bulwark'],
    params: { repair: 0.25 },
    effects: [],
    rewardWeight: 0.8,
  },

  // ------------------------------------------------------------ trinkets
  {
    id: 'cutlass',
    name: 'Cutlass',
    icon: '🗡️',
    description: 'Sword damage +20%.',
    tradeoff: '',
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
    tradeoff: '',
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
    tradeoff: '',
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
    description: 'Spotting +30%. On the sea map: see enemy crews.',
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
