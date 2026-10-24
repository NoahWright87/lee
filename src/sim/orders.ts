// Deck orders (Phase 7): a tap on something on a deck says WHAT to do; the
// existing best-fit logic says WHO (the same one the job buttons use).
//
// An order has a target (a line, a plank, a rope with a Lee on it, a hook to
// throw...), a tile on the answering boat's deck where it gets done, and a role
// that decides who answers: cutting and destroying is ⚔️ or 🛠️ (whichever is
// closer and free), throwing, lowering and shoving is whoever is nearest. The
// answering Lee keeps its job and goes back to what it was doing when the
// order is done; repeated taps on the same target send more Lees.
//
// Targets are data (kind, role, work, what it does when done), so Phase 8's
// "flee this danger zone" and "stab the stunned head" are more entries here.

import type { Job } from '../config/lees';
import type { Boat } from './boat';
import { isWounded, leeStat, setDestination, takeOrder, type Lee } from './crew';
import type { Line, RailRef } from './lines';
import { railGap, railPoint } from './lines';
import { dist, toLocal } from './math';
import type { World } from './world';

export type OrderKind = 'throw' | 'lower' | 'push' | 'cutLine' | 'wreckPlank' | 'cutRope';

export type OrderRole = 'cutter' | 'nearest';

export interface DeckOrder {
  id: number;
  /** The boat whose crew answers. */
  boat: Boat;
  kind: OrderKind;
  role: OrderRole;
  /** Where on `boat`'s deck it gets done. */
  tile: number;
  /** What it acts on. */
  rail?: RailRef;
  line?: Line;
  /** cutRope: the Lee swinging on the rope. */
  swinger?: Lee;
  /** Lees wanted on it (repeated taps add more). */
  wanted: number;
  /** Lees assigned (ids). */
  lees: number[];
  /** 0..1, shown as a ring on the target. */
  progress: number;
  since: number;
  /** Seconds of work still to do on a timed order (throw, lower, push, cutRope). */
  left: number;
}

/** Display label for the marker and the debug overlay. */
export const ORDER_LABEL: Record<OrderKind, string> = {
  throw: 'Throw hook',
  lower: 'Lower plank',
  push: 'Shove off',
  cutLine: 'Cut the line',
  wreckPlank: 'Destroy the plank',
  cutRope: 'Cut the rope',
};

/** Jobs that answer a 'cutter' order straight away; anyone else only after a short wait (you're never stuck). */
const CUTTER_JOBS: Job[] = ['board', 'fix'];

export class OrderSystem {
  readonly list: DeckOrder[] = [];
  private nextId = 1;

  of(boat: Boat): DeckOrder[] {
    return this.list.filter((o) => o.boat === boat);
  }

  byId(id: number): DeckOrder | undefined {
    return this.list.find((o) => o.id === id);
  }

  /** The order on this target already (so a second tap adds a Lee instead). */
  find(boat: Boat, kind: OrderKind, target: { rail?: RailRef; line?: Line; swinger?: Lee }): DeckOrder | undefined {
    return this.list.find((o) => o.boat === boat && o.kind === kind && o.rail?.rail === target.rail?.rail && o.line === target.line && o.swinger === target.swinger);
  }

  /** Place an order, or add a Lee to the one already there. */
  place(w: World, order: Omit<DeckOrder, 'id' | 'lees' | 'progress' | 'since' | 'wanted' | 'left'> & { wanted?: number }): DeckOrder {
    const old = this.find(order.boat, order.kind, order);
    const cap = order.kind === 'cutLine' || order.kind === 'wreckPlank' ? 3 : 1;
    if (old) {
      old.wanted = Math.min(cap, old.wanted + (order.wanted ?? 1));
      return old;
    }
    const o: DeckOrder = { ...order, id: this.nextId++, wanted: Math.min(cap, order.wanted ?? 1), lees: [], progress: 0, since: w.time, left: workTime(w, order.kind) };
    this.list.push(o);
    return o;
  }

  remove(w: World, o: DeckOrder): void {
    const i = this.list.indexOf(o);
    if (i >= 0) this.list.splice(i, 1);
    for (const id of o.lees) {
      const lee = w.findLee(id)?.lee;
      if (lee && lee.order === o.id) {
        lee.order = null;
        lee.boat.crew.thinkIn = 0;
      }
    }
    o.lees = [];
  }

  /** Is this order's target still there, still worth doing? */
  private valid(w: World, o: DeckOrder): boolean {
    const t = w.tuning;
    if (o.boat.sinkingSince !== null) return false;
    switch (o.kind) {
      case 'throw': {
        const r = o.rail!;
        const target = w.boardTargetOf(o.boat);
        return !r.rail.destroyed && !r.rail.out && !!target && !w.isOut(target);
      }
      case 'lower':
        return !o.rail!.rail.destroyed && !o.rail!.rail.lowered && w.boats.some((b) => b !== o.boat && b.side !== o.boat.side && !w.isSinking(b) && railGap(o.boat, o.rail!.tile, b, o.rail!.rail) <= t.lines.plankReach);
      case 'push':
        return !o.rail!.rail.destroyed && o.rail!.rail.readyAt <= w.time;
      case 'cutLine':
        return w.lines.lines.includes(o.line!);
      case 'wreckPlank':
        return !o.rail!.rail.destroyed && o.rail!.rail.lowered;
      case 'cutRope': {
        const s = o.swinger!.swing;
        return !!s && !s.cut && s.via !== null && o.swinger!.alive;
      }
    }
  }

  /** Where on `boat`'s deck a Lee has to stand for this order (re-evaluated as boats move). */
  private tileFor(w: World, o: DeckOrder): number {
    const boat = o.boat;
    const nearest = (world: { x: number; y: number }): number => {
      const l = toLocal(world, boat.motion, boat.motion.heading);
      let best = 0;
      let bestD = Infinity;
      for (const tile of boat.grid.tiles) {
        const d = dist(l, tile.center);
        if (d < bestD - 1e-9) {
          bestD = d;
          best = tile.index;
        }
      }
      return best;
    };
    switch (o.kind) {
      case 'throw':
      case 'lower':
      case 'push':
        return o.rail!.tile.index;
      case 'cutLine':
        return o.line!.owner === boat ? o.line!.ref.tile.index : nearest(w.lines.attachWorld(o.line!));
      case 'wreckPlank':
        return nearest(railPoint(o.rail!.boat, o.rail!.tile, o.rail!.rail));
      case 'cutRope': {
        const s = o.swinger!.swing;
        return s ? s.toTile : o.tile;
      }
    }
  }

  /** Who could answer this order, best first. */
  private candidates(w: World, o: DeckOrder, now: number): Lee[] {
    const boat = o.boat;
    const waited = now - o.since;
    const out: { lee: Lee; cost: number }[] = [];
    for (const lee of boat.crew.lees) {
      if (!lee.alive || lee.swing || lee.deck !== boat || lee.engaged || lee.retreating || lee.order !== null) continue;
      if (isWounded(lee, w.tuning) && w.liveFoesAboard(boat)) continue;
      const cutter = CUTTER_JOBS.includes(lee.job);
      if (o.role === 'cutter' && !cutter && waited < w.tuning.lines.answerFallback) continue;
      // Walking time to the tile, with a little extra for pulling a Lee off a post.
      const walk = (dist(lee.pos, boat.grid.tiles[o.tile].center) + boat.grid.dist[lee.tile][o.tile]) / Math.max(0.1, w.tuning.crew.walkSpeed * leeStat(lee, 'walkSpeed', boat, w.tuning));
      const post = lee.task.type === 'station' && lee.working ? 0.6 : 0;
      out.push({ lee, cost: walk + post + (o.role === 'cutter' && !cutter ? 5 : 0) });
    }
    out.sort((a, b) => a.cost - b.cost || a.lee.id - b.lee.id);
    return out.map((x) => x.lee);
  }

  /** Validate, assign Lees, walk them there, and do the work. Run after the crew step. */
  step(w: World, dt: number): void {
    const t = w.tuning;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if (!this.valid(w, o)) {
        this.remove(w, o);
        continue;
      }
      o.tile = this.tileFor(w, o);
      // Drop Lees that can't carry on (dead, caught in a fight, swinging).
      o.lees = o.lees.filter((id) => {
        const lee = w.findLee(id)?.lee;
        const ok = !!lee && lee.alive && !lee.swing && lee.deck === o.boat && !lee.engaged && lee.order === o.id;
        if (!ok && lee && lee.order === o.id) lee.order = null;
        return ok;
      });
      // Send more.
      if (o.lees.length < o.wanted) {
        const free = this.candidates(w, o, w.time);
        for (const lee of free) {
          if (o.lees.length >= o.wanted) break;
          o.lees.push(lee.id);
          takeOrder(lee, o.id, o.tile, `${ORDER_LABEL[o.kind]}: tapped`, w.time);
          w.events.push({ type: 'order', boatId: o.boat.id, leeId: lee.id, job: lee.job });
        }
      }
      // Walk and work.
      const here: Lee[] = [];
      for (const id of o.lees) {
        const lee = w.findLee(id)!.lee;
        if (lee.dest !== o.tile) setDestination(lee, o.tile, o.boat);
        if (lee.working && lee.tile === o.tile && !lee.path.length) here.push(lee);
      }
      if (!here.length) continue;
      switch (o.kind) {
        case 'cutLine': {
          const line = o.line!;
          for (const lee of here) line.hp -= dt * hackRate(lee, w);
          lee_stats(here, dt);
          o.progress = 1 - Math.max(0, line.hp) / Math.max(1e-6, line.maxHp);
          if (line.hp <= 0) {
            w.cutLine(line, 'hacked');
            this.remove(w, o);
          }
          break;
        }
        case 'wreckPlank': {
          const rail = o.rail!.rail;
          for (const lee of here) rail.hp -= dt * hackRate(lee, w);
          lee_stats(here, dt);
          o.progress = 1 - Math.max(0, rail.hp) / Math.max(1e-6, rail.maxHp);
          if (rail.hp <= 0) {
            rail.hp = 0;
            rail.destroyed = true;
            rail.lowered = false;
            w.events.push({ type: 'plank', boatId: o.rail!.boat.id, tile: o.rail!.tile.index, down: false, destroyed: true });
            this.remove(w, o);
          }
          break;
        }
        case 'cutRope': {
          o.left -= dt * here.length;
          o.progress = 1 - Math.max(0, o.left) / Math.max(1e-6, t.lines.ropeCutTime);
          if (o.left <= 0) {
            w.cutRope(o.swinger!);
            this.remove(w, o);
          }
          break;
        }
        case 'throw':
        case 'lower':
        case 'push': {
          o.left -= dt;
          o.progress = 1 - Math.max(0, o.left) / Math.max(1e-6, t.lines.workTime);
          if (o.left <= 0) {
            w.doRail(o);
            this.remove(w, o);
          }
          break;
        }
      }
    }
  }
}

function workTime(w: World, kind: OrderKind): number {
  switch (kind) {
    case 'cutRope':
      return w.tuning.lines.ropeCutTime;
    case 'throw':
    case 'lower':
    case 'push':
      return w.tuning.lines.workTime;
    default:
      return 0;
  }
}

/** Hacking damage per second of this Lee (sword damage × rate). */
function hackRate(lee: Lee, w: World): number {
  const t = w.tuning;
  return Math.max(0, t.melee.damage) * Math.max(0, t.melee.rate) * leeStat(lee, 'meleeDamage', lee.boat, t) * leeStat(lee, 'meleeRate', lee.boat, t);
}

function lee_stats(lees: Lee[], dt: number): void {
  for (const l of lees) l.stats.time.melee += dt;
}
