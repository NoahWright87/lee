// Cards: items (parts, Treasures, Trinkets), Lee types and crew members, and
// ships. Used by the draft, the starting part, rewards, the refit screen and
// the run summary, so everything reads the same everywhere.

import { CATEGORY_NAMES, ITEMS, type ItemDef } from '../config/items';
import { LEE_DEFS, LOWER_IS_BETTER, STAT_LABELS, type LeeDef, type LeeStatKey } from '../config/lees';
import { SHIPS, type ShipDef } from '../config/ships';
import { FACING_ARROW, SLOT_TYPES, type Facing } from '../config/slots';
import { TAGS, tagName } from '../config/tags';
import type { Tuning } from '../config/tuning';
import { baseStat } from '../sim/crew';
import type { StatMods } from '../sim/loadout';
import { xpToNext } from '../sim/levels';
import type { CrewMember } from '../sim/run';
import { leeUrl } from './crewArt';
import { el } from './dom';

/** An item's icon: its emoji, or for the Iron E a shiny metal F (no explanation). */
export function itemIcon(def: ItemDef | undefined, cls = 'item-icon'): HTMLSpanElement {
  const s = el('span', `${cls}${def?.id === 'ironE' ? ' iron-e' : ''}`, def?.icon ?? '?');
  if (def) s.title = def.name;
  return s;
}

export function tagChips(tags: readonly string[]): HTMLDivElement {
  const box = el('div', 'tags');
  for (const t of tags) {
    const c = el('span', 'tag', tagName(t));
    const color = (TAGS as Record<string, { color: string }>)[t]?.color;
    if (color) c.style.borderColor = color;
    if (color) c.style.color = color;
    box.append(c);
  }
  return box;
}

/** Full item card: icon, name, kind and slots, what it does, what it costs, flavor, tags. */
export function itemCard(def: ItemDef, extra?: HTMLElement[]): HTMLDivElement {
  const card = el('div', 'card item-card');
  const head = el('div', 'card-row');
  head.append(itemIcon(def, 'item-icon big'));
  const names = el('div', 'card-names');
  names.append(el('div', 'card-title', def.name));
  const slots = def.fits.map((f) => SLOT_TYPES[f].name).join(' or ');
  names.append(el('div', 'card-sub', def.category === 'treasure' || def.category === 'trinket' ? CATEGORY_NAMES[def.category] : `${CATEGORY_NAMES[def.category]} · ${slots} slot`));
  head.append(names);
  card.append(head);
  // The Iron E explains nothing.
  if (def.id !== 'ironE') {
    card.append(el('div', 'card-text', def.description));
    if (def.tradeoff) {
      const cost = el('div', 'card-cost');
      cost.append(el('b', '', 'Cost: '), document.createTextNode(def.tradeoff));
      card.append(cost);
    }
    if (def.flavor) card.append(el('div', 'card-flavor', def.flavor));
  }
  if (def.tags.length) card.append(tagChips(def.tags));
  for (const e of extra ?? []) card.append(e);
  return card;
}

/** Stat groups shown as bars on Lee cards (each averages its stats). */
const GROUPS: [string, LeeStatKey[]][] = [
  ['Gunnery', ['loadSpeed', 'accuracy']],
  ['Sailing', ['rowStrength', 'sailHandling']],
  ['Repairs', ['repairRate', 'bailRate']],
  ['Melee', ['meleeDamage', 'meleeRate']],
  ['Toughness', ['hp']],
  ['Speed', ['walkSpeed', 'swingSpeed']],
];

export function statBars(def: LeeDef, t: Tuning, mods: StatMods = {}): HTMLDivElement {
  const box = el('div', 'stat-bars');
  for (const [name, keys] of GROUPS) {
    const v = keys.reduce((a, k) => a + baseStat(def, k, t, mods), 0) / keys.length;
    const row = el('div', 'stat-bar');
    const bar = el('div', 'sb-bar');
    const fill = el('div', `sb-fill${v > 1.05 ? ' up' : v < 0.95 ? ' down' : ''}`);
    fill.style.width = `${Math.min(100, (v / 2) * 100)}%`;
    bar.append(fill);
    row.append(el('span', 'sb-k', name), bar, el('span', 'sb-v', `×${v.toFixed(2)}`));
    box.append(row);
  }
  return box;
}

/** Every stat after modifiers, compactly (crew cards, debug). */
export function fullStats(def: LeeDef, t: Tuning, mods: StatMods = {}): HTMLDivElement {
  const box = el('div', 'full-stats');
  for (const k of Object.keys(STAT_LABELS) as LeeStatKey[]) {
    const v = baseStat(def, k, t, mods);
    const good = LOWER_IS_BETTER.has(k) ? v < 0.999 : v > 1.001;
    const bad = LOWER_IS_BETTER.has(k) ? v > 1.001 : v < 0.999;
    const row = el('div', `fs${good ? ' up' : bad ? ' down' : ''}`);
    row.append(el('span', '', STAT_LABELS[k]), el('b', '', `×${v.toFixed(2)}`));
    box.append(row);
  }
  return box;
}

/** A Lee type's card (draft, recruit). */
export function leeTypeCard(type: string, t: Tuning, level = 1, extra?: HTMLElement[]): HTMLDivElement {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  const card = el('div', 'card lee-type-card');
  const head = el('div', 'card-row');
  const img = el('img', 'card-figure');
  img.src = leeUrl(def.art, def.color);
  const names = el('div', 'card-names');
  names.append(el('div', 'card-title', def.name), el('div', 'card-sub', `${def.role}${level > 1 ? ` · level ${level}` : ''}`));
  head.append(img, names);
  card.append(head, el('div', 'card-flavor', def.flavor), statBars(def, t));
  if (def.trait) {
    const tr = el('div', 'card-trait');
    tr.append(el('b', '', `${def.trait.name}: `), document.createTextNode(def.trait.text));
    card.append(tr);
  }
  if (def.tags.length) card.append(tagChips(def.tags));
  for (const e of extra ?? []) card.append(e);
  return card;
}

/** "Lv 3" badge plus a thin XP bar. */
export function levelBadge(m: CrewMember, t: Tuning): HTMLDivElement {
  const box = el('div', 'level-box');
  box.append(el('span', 'level-badge', `Lv ${m.level}`));
  const cap = Math.round(t.leveling.levelCap);
  const bar = el('div', 'xp-bar');
  const fill = el('div', 'xp-fill');
  fill.style.width = m.level >= cap ? '100%' : `${Math.min(100, (100 * m.xp) / xpToNext(m.level, t))}%`;
  bar.append(fill);
  bar.title = m.level >= cap ? 'Max level' : `${Math.round(m.xp)} / ${xpToNext(m.level, t)} XP`;
  box.append(bar);
  return box;
}

/** Figure image for a crew member (type shirt). */
export function memberFigure(type: string, cls = 'card-figure'): HTMLImageElement {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  const img = el('img', cls);
  img.src = leeUrl(def.art, def.color);
  img.draggable = false;
  return img;
}

/** Slot counts by type, with facings for edge slots: "Edge ↑3 ↓3 →1 ←1 · Interior 3 · ...". */
export function slotSummary(ship: ShipDef): string {
  const parts: string[] = [];
  const edges = ship.slots.filter((s) => s.type === 'edge');
  if (edges.length) {
    const by: Partial<Record<Facing, number>> = {};
    for (const s of edges) by[s.facing!] = (by[s.facing!] ?? 0) + 1;
    parts.push(`${SLOT_TYPES.edge.glyph} Edge ${(['port', 'starboard', 'bow', 'stern'] as Facing[]).filter((f) => by[f]).map((f) => `${FACING_ARROW[f]}${by[f]}`).join(' ')}`);
  }
  for (const type of ['interior', 'rail', 'hull'] as const) {
    const n = ship.slots.filter((s) => s.type === type).length;
    parts.push(`${SLOT_TYPES[type].glyph} ${SLOT_TYPES[type].name} ${n}`);
  }
  return parts.join(' · ');
}

/** The ship's default loadout as icons. */
export function loadoutIcons(items: string[]): HTMLDivElement {
  const box = el('div', 'loadout-icons');
  for (const i of items) box.append(itemIcon(ITEMS[i]));
  return box;
}

export function shipName(id: string): string {
  return SHIPS[id]?.name ?? id;
}
