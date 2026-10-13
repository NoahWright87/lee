// Small shared pieces for items and Lees: icons, a one-line item, the four job
// bars, full stats, the level badge. Used by rewards, the refit screen and the
// run summary, so everything reads the same everywhere.

import { ITEMS, type ItemDef } from '../config/items';
import { JOB_INFO, JOBS, LEE_DEFS, LOWER_IS_BETTER, STAT_LABELS, jobSkill, type LeeDef, type LeeStatKey } from '../config/lees';
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

/** An item in a few words: icon, name, what it does, what it costs. */
export function itemLine(def: ItemDef): HTMLDivElement {
  const row = el('div', 'card-row item-line');
  const names = el('div', 'card-names');
  names.append(el('div', 'card-title', def.name));
  if (def.id !== 'ironE') {
    names.append(el('div', 'card-text', def.description));
    if (def.tradeoff) names.append(el('div', 'card-cost', def.tradeoff));
  }
  row.append(itemIcon(def, 'item-icon big'), names);
  return row;
}

/** The four job bars (⏩ 🔫 ⚔️ 🛠️): the skill numbers the action buttons pick Lees by. ×1 is half full. */
export function jobBars(type: string, t: Tuning, mods: StatMods = {}): HTMLDivElement {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  const box = el('div', 'rf-jobbars');
  for (const j of JOBS) {
    const v = jobSkill(j, (k) => baseStat(def, k, t, mods));
    const row = el('div', 'rf-jobbar');
    const track = el('div', 'rf-jtrack');
    const fill = el('div', `rf-jfill${v > 1.05 ? ' up' : v < 0.95 ? ' down' : ''}`);
    fill.style.width = `${Math.min(100, v * 50)}%`;
    track.append(fill);
    row.title = `${JOB_INFO[j].name} ×${v.toFixed(2)}`;
    row.append(el('span', 'rf-jicon', JOB_INFO[j].icon), track);
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

/** The ship's default loadout as icons. */
export function loadoutIcons(items: string[]): HTMLDivElement {
  const box = el('div', 'loadout-icons');
  for (const i of items) box.append(itemIcon(ITEMS[i]));
  return box;
}
