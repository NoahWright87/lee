// Levels: XP thresholds, level-up bonus offers and what chosen bonuses do.
// The same system for player and enemy Lees (enemies auto-pick). Deterministic:
// a Lee's offers depend only on its type, level, identity and the run seed.

import { LEE_DEFS, type LeeStatKey } from '../config/lees';
import type { Tuning } from '../config/tuning';
import type { StatMods } from './loadout';
import { Rng } from './math';

/** One chosen level-up bonus: +bonusSize to a stat, or +hpBonusSize HP. */
export type BonusKey = LeeStatKey | 'hpBonus';

/** XP needed to go from `level` to the next. */
export function xpToNext(level: number, t: Tuning): number {
  const L = t.leveling;
  return Math.max(1, Math.round(L.firstLevelXp * Math.pow(Math.max(1, L.levelGrowth), Math.max(0, level - 1))));
}

/** What a set of chosen bonuses does to a Lee's stats. */
export function bonusMods(bonuses: readonly BonusKey[], t: Tuning): StatMods {
  const out: Record<string, number> = {};
  for (const b of bonuses) {
    if (b === 'hpBonus') out.hp = (out.hp ?? 1) * (1 + t.leveling.hpBonusSize);
    else out[b] = (out[b] ?? 1) * (1 + t.leveling.bonusSize);
  }
  return out as StatMods;
}

/** Multiply stat mods together. */
export function combineMods(...all: (StatMods | undefined)[]): StatMods {
  const out: Record<string, number> = {};
  for (const m of all) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number') out[k] = (out[k] ?? 1) * v;
  }
  return out as StatMods;
}

/**
 * The bonuses offered when a Lee reaches `level`: `choices` distinct ones drawn
 * by the type's weights (strengths most often, anything sometimes), highest
 * weight first (that's the Auto-pick).
 */
export function bonusOffers(type: string, level: number, salt: number, t: Tuning): BonusKey[] {
  const def = LEE_DEFS[type] ?? LEE_DEFS.basic;
  const pool = Object.entries(def.levelWeights).filter(([, w]) => (w ?? 0) > 0) as [BonusKey, number][];
  const rng = new Rng(((salt * 7919) ^ (level * 104729) ^ hash(type)) >>> 0);
  const out: [BonusKey, number][] = [];
  const n = Math.max(1, Math.min(pool.length, Math.round(t.leveling.choices)));
  const left = [...pool];
  while (out.length < n && left.length) {
    const total = left.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    let pick = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= left[i][1];
      if (r < 0) {
        pick = i;
        break;
      }
    }
    out.push(left[pick]);
    left.splice(pick, 1);
  }
  return out.sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Auto-picked bonuses for a Lee at `level` (levels 2..level), as enemies and Auto-pick get them. */
export function autoBonuses(type: string, level: number, salt: number, t: Tuning): BonusKey[] {
  const out: BonusKey[] = [];
  const cap = Math.max(1, Math.round(t.leveling.levelCap));
  for (let l = 2; l <= Math.min(level, cap); l++) out.push(bonusOffers(type, l, salt, t)[0]);
  return out;
}

export function bonusLabel(b: BonusKey, t: Tuning, labels: Record<string, string>): string {
  if (b === 'hpBonus') return `+${Math.round(t.leveling.hpBonusSize * 100)}% HP`;
  return `+${Math.round(t.leveling.bonusSize * 100)}% ${labels[b] ?? b}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
