// Boat setups: a build (ship + loadout) plus a crew with homes. Used for the
// player (from the run or sandbox) and for every enemy (from encounter data),
// the same way. Also the one Auto-arrange: posts in priority order, each taken
// by the best-qualified Lee for it.

import { ARCHETYPES, type AiProfile, type EnemySpec } from '../config/encounters';
import { LEE_DEFS, WORK_STAT, type Job } from '../config/lees';
import type { Tuning } from '../config/tuning';
import { createBoat } from './boat';
import { baseStat, STATION_WORK } from './crew';
import { cleanBuild, defaultBuild, trinketMods, type BoatBuild, type StatMods } from './loadout';
import { autoBonuses, bonusMods, combineMods } from './levels';
import { dist } from './math';

/** A Lee to put aboard: its type, home tile (null = ashore / auto), and who it is. */
export interface CrewSpec {
  type: string;
  home: number | null;
  uid?: number;
  label?: string;
  level?: number;
  /** Level bonuses, trinkets and the like, already folded. */
  mods?: StatMods;
  /** Starting job (default: from its tile's station). */
  job?: Job;
}

export interface BoatSetup {
  build: BoatBuild;
  crew: CrewSpec[];
  /** Enemy AI profile (omit for the player). */
  ai?: AiProfile | null;
}

/**
 * Auto-arrange: a home tile for each Lee. Posts in priority order (a gun on
 * each side, oars, one damage-control post, a sail, crew guns, the other guns,
 * more oars and sails, powder, lookout, pump, then more damage
 * control), and each post goes to the unplaced Lee best at its work (ties by
 * crew order).
 */
export function autoArrange(build: BoatBuild, crew: { type: string; mods?: StatMods }[], t: Tuning): (number | null)[] {
  const boat = createBoat(0, 'player', build, t, { x: 0, y: 0 }, 0);
  const tiles = boat.grid.tiles;
  const center = tiles.reduce((a, x) => ({ x: a.x + x.center.x / tiles.length, y: a.y + x.center.y / tiles.length }), { x: 0, y: 0 });
  const plain = tiles.filter((x) => !x.fixture).sort((a, b) => dist(a.center, center) - dist(b.center, center) || a.index - b.index);
  const of = (kind: string) => tiles.filter((x) => x.station === kind);
  // Hull guns alternate sides, bow-most first, so a short crew still covers both broadsides.
  const guns = boat.guns.filter((g) => g.targets === 'hull');
  const bySide = [guns.filter((g) => Math.sin(g.face) < -0.5), guns.filter((g) => Math.sin(g.face) > 0.5), guns.filter((g) => Math.abs(Math.sin(g.face)) <= 0.5)];
  for (const list of bySide) list.sort((a, b) => b.local.x - a.local.x);
  // One gun per side first; the rest after the crew that keeps the boat moving.
  const firstGuns = bySide.filter((l) => l.length).map((l) => l[0].station);
  const moreGuns: number[] = [];
  for (let i = 1; bySide.some((l) => i < l.length); i++) for (const l of bySide) if (l[i]) moreGuns.push(l[i].station);
  const crewGuns = boat.guns.filter((g) => g.targets === 'crew').map((g) => g.station);
  const oars = of('oars').map((x) => x.index);
  const sails = of('sails').map((x) => x.index);
  const posts: number[] = [
    ...firstGuns,
    ...oars.slice(0, 1),
    ...plain.slice(0, 1).map((x) => x.index),
    ...sails.slice(0, 1),
    ...crewGuns,
    ...moreGuns,
    ...oars.slice(1),
    ...sails.slice(1),
    ...of('powder').map((x) => x.index),
    ...of('lookout').map((x) => x.index),
    ...of('pump').map((x) => x.index),
    ...plain.slice(1).map((x) => x.index),
  ];
  // The posts this crew can fill, then the best fits first: each (post, Lee) pair by how good the Lee is at
  // that post's work, ties by post priority and crew order. A Handy Lee ends up repairing, a Quick Lee on a gun.
  const homes: (number | null)[] = crew.map(() => null);
  const open = posts.slice(0, crew.length);
  const pairs: { post: number; rank: number; lee: number; v: number }[] = [];
  open.forEach((post, rank) => {
    const st = tiles[post].station;
    const stat = st ? WORK_STAT[STATION_WORK[st]] : 'repairRate';
    crew.forEach((c, lee) => pairs.push({ post, rank, lee, v: baseStat(LEE_DEFS[c.type] ?? LEE_DEFS.basic, stat, t, c.mods) }));
  });
  pairs.sort((a, b) => b.v - a.v || a.rank - b.rank || a.lee - b.lee);
  const taken = new Set<number>();
  for (const p of pairs) {
    if (homes[p.lee] !== null || taken.has(p.post)) continue;
    homes[p.lee] = p.post;
    taken.add(p.post);
  }
  return homes;
}

/** Build an enemy boat from encounter data: its loadout, its crew at their levels (auto-picked bonuses), auto-arranged. */
export function enemySetup(spec: EnemySpec, t: Tuning, opts: { levelBonus?: number; extraCrew?: number; salt?: number } = {}): BoatSetup {
  const base = defaultBuild(spec.ship);
  for (const [slot, item] of Object.entries(spec.loadout ?? {})) {
    if (item) base.loadout[slot] = item;
    else delete base.loadout[slot];
  }
  base.treasures = [...(spec.treasures ?? [])];
  const build = cleanBuild(base, t);
  const entries = spec.crew.flatMap((c) => Array(Math.max(0, c.count ?? 1)).fill(c) as typeof spec.crew);
  const max = Math.max(0, Math.round(t.ships[build.ship]?.crewMax ?? 99));
  const extra = Math.max(0, Math.round(opts.extraCrew ?? 0));
  for (let i = 0; i < extra && entries.length < max && spec.crew.length; i++) entries.push(spec.crew[i % spec.crew.length]);
  const cap = Math.max(1, Math.round(t.leveling.levelCap));
  const salt = opts.salt ?? 1;
  const counts: Record<string, number> = {};
  const crew: CrewSpec[] = entries.slice(0, max).map((c, i) => {
    const level = Math.min(cap, Math.max(1, (c.level ?? 1) + Math.round(opts.levelBonus ?? 0)));
    const def = LEE_DEFS[c.type] ?? LEE_DEFS.basic;
    counts[def.id] = (counts[def.id] ?? 0) + 1;
    return {
      type: def.id,
      home: null,
      level,
      label: `${def.name} #${counts[def.id]}`,
      mods: combineMods(bonusMods(autoBonuses(def.id, level, salt * 31 + i, t), t), trinketMods(c.trinkets ?? [], t)),
    };
  });
  const homes = autoArrange(build, crew, t);
  crew.forEach((c, i) => (c.home = homes[i]));
  return { build, crew, ai: { ...(t.ai[spec.ai] ?? t.ai.standard) } };
}

/** One enemy boat of a Phase 3 archetype ('standard', 'boarder', 'heavy'), level 1. */
export function archetypeSetup(id: string, t: Tuning, salt = 1): BoatSetup {
  return enemySetup(ARCHETYPES[id] ?? ARCHETYPES.standard, t, { salt });
}

/** A crew of Basic Lees on the given homes (tests, quick setups). */
export function basicCrew(homes: (number | null)[]): CrewSpec[] {
  return homes.map((home) => ({ type: 'basic', home }));
}
