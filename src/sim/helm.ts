// The helm: what a boat's steering is set to. A tap sets it and it stays set
// after the finger lifts, so the player's hands are free for the action
// buttons. The same commands steer enemy boarders (BOARD and RAM autopilot).
// Pure functions: they turn a helm into a seek point and a throttle for
// stepMotion, the one movement code every boat shares.

import type { Tuning } from '../config/tuning';
import { motionParams, type Boat } from './boat';
import { clamp, DEG, dist, toLocal, type Vec } from './math';
import { alongsideCommand, type AlongsideSpec } from './steering';

export type Helm =
  /** Not steered yet: hold course. */
  | { kind: 'drift' }
  /** Sail to a point, then hold the heading you arrived on. */
  | { kind: 'point'; p: Vec }
  /** Hold a heading, full speed ahead. */
  | { kind: 'heading'; h: number }
  /** Circle a point that moves with a boat (tap or hold near an enemy). */
  | { kind: 'orbit'; boatId: number; offset: Vec }
  /** Sails down: coast to a stop (the pit stop). */
  | { kind: 'stop' }
  /** BOARD autopilot: come alongside a boat on one of its sides (+1 starboard, -1 port) and match its speed. */
  | { kind: 'board'; boatId: number; side: number }
  /** RAM autopilot: full speed into its side; after impact, hold the nose against its hull. */
  | { kind: 'ram'; boatId: number; hold: boolean }
  /** RETREAT: wait for your boarders to come home, then sail away from the nearest enemy. */
  | { kind: 'retreat' };

export type ManeuverKind = 'board' | 'ram';

export interface HelmCommand {
  target: Vec | null;
  throttle: number;
  orbit: boolean;
  stopped: boolean;
}

/** How far ahead of the boat a held heading's seek point sits, m. */
const AHEAD = 200;

const ahead = (b: Boat, h: number): Vec => ({ x: b.motion.x + Math.cos(h) * AHEAD, y: b.motion.y + Math.sin(h) * AHEAD });

/** Angle between `self`'s heading and `target`'s hull: 0° = parallel, 90° = straight into its side. */
export function hullAngle(self: Boat, target: Boat): number {
  return Math.asin(clamp(Math.abs(Math.sin(self.motion.heading - target.motion.heading)), 0, 1)) / DEG;
}

/**
 * BOARD or RAM for the ⚔️ button, from the angle to the target's hull. On
 * targeting (prev null), whichever is closer: under boardAngle → BOARD. After
 * that, BOARD only turns into RAM once you're nearly perpendicular (ramAngle),
 * and RAM back into BOARD under boardAngle, so the label doesn't flicker.
 */
export function boardOrRam(self: Boat, target: Boat, prev: ManeuverKind | null, t: Tuning): ManeuverKind {
  const a = hullAngle(self, target);
  if (prev === 'board') return a >= t.jobs.ramAngle ? 'ram' : 'board';
  return a < t.jobs.boardAngle ? 'board' : 'ram';
}

/** Which side of `target` to come alongside: the one `self` is already on. */
export function nearSide(self: Boat, target: Boat): number {
  return toLocal(self.motion, target.motion, target.motion.heading).y >= 0 ? 1 : -1;
}

/** The slot beside `target` that `self` steers into. */
export function alongsideSpec(self: Boat, target: Boat, side: number, t: Tuning): AlongsideSpec {
  return { other: target.motion, offset: target.layout.beam / 2 + self.layout.beam / 2 + Math.max(0, t.attach.alongsideGap), side };
}

/** Full speed at the target's predicted position (it's a capsule: any of its side will do). */
export function ramCommand(self: Boat, target: Boat): { target: Vec; throttle: number } {
  const m = self.motion;
  const o = target.motion;
  const speed = Math.max(4, Math.hypot(m.vx, m.vy));
  const tti = clamp(dist(m, o) / speed, 0, 6);
  return { target: { x: o.x + o.vx * tti, y: o.y + o.vy * tti }, throttle: 1 };
}

/** After a ram: keep the nose pressed into the target's hull, a little faster than it moves. */
export function holdCommand(self: Boat, target: Boat, t: Tuning): { target: Vec; throttle: number } {
  const m = self.motion;
  const o = target.motion;
  const fx = Math.cos(m.heading);
  const fy = Math.sin(m.heading);
  const want = o.vx * fx + o.vy * fy + Math.max(0, t.attach.holdPush);
  const cruise = Math.max(0.1, motionParams(self, t).cruiseSpeed);
  return { target: { x: o.x, y: o.y }, throttle: clamp(want / cruise, 0.05, 1) };
}

export interface HelmWorld {
  tuning: Tuning;
  /** A live (not out of the fight) boat by id, or null. */
  live(id: number): Boat | null;
  /** The nearest live enemy of `self`, or null. */
  nearestFoe(self: Boat): Boat | null;
  /** RETREAT: the enemy boat your boarders are still on and can come home from (wait beside it), or null. */
  waitFor(self: Boat): Boat | null;
}

/**
 * Turn a helm into this step's steering. Returns the command and the helm to
 * keep (a point becomes a heading on arrival; a maneuver whose target is gone
 * becomes the heading you're on).
 */
export function steer(self: Boat, helm: Helm, w: HelmWorld): { cmd: HelmCommand; helm: Helm } {
  const t = w.tuning;
  const m = self.motion;
  const hold = (h: Helm = { kind: 'heading', h: m.heading }) => ({ cmd: { target: ahead(self, h.kind === 'heading' ? h.h : m.heading), throttle: 1, orbit: false, stopped: false }, helm: h });
  switch (helm.kind) {
    case 'drift':
      return { cmd: { target: null, throttle: 1, orbit: false, stopped: false }, helm };
    case 'stop':
      return { cmd: { target: null, throttle: 0, orbit: false, stopped: true }, helm };
    case 'heading':
      return hold(helm);
    case 'point': {
      const d = dist(m, helm.p);
      const toward = (helm.p.x - m.x) * m.vx + (helm.p.y - m.y) * m.vy;
      // Arrived (or it's slipped behind us close by): keep going the way we're pointed.
      if (d <= Math.max(1, t.input.arriveRadius) || (toward < 0 && d < 3 * t.input.arriveRadius)) return hold();
      return { cmd: { target: helm.p, throttle: 1, orbit: false, stopped: false }, helm };
    }
    case 'orbit': {
      const b = w.live(helm.boatId);
      if (!b) return hold();
      return { cmd: { target: { x: b.motion.x + helm.offset.x, y: b.motion.y + helm.offset.y }, throttle: 1, orbit: true, stopped: false }, helm };
    }
    case 'board': {
      const b = w.live(helm.boatId);
      if (!b) return hold();
      const c = alongsideCommand(m, alongsideSpec(self, b, helm.side, t), motionParams(self, t));
      return { cmd: { target: c.target, throttle: c.throttle, orbit: false, stopped: false }, helm };
    }
    case 'ram': {
      const b = w.live(helm.boatId);
      if (!b) return hold();
      const c = helm.hold ? holdCommand(self, b, t) : ramCommand(self, b);
      return { cmd: { target: c.target, throttle: c.throttle, orbit: false, stopped: false }, helm };
    }
    case 'retreat': {
      // Nobody gets left behind who could still make it home: stay beside them.
      const wait = w.waitFor(self);
      if (wait) {
        const c = alongsideCommand(m, alongsideSpec(self, wait, nearSide(self, wait), t), motionParams(self, t));
        return { cmd: { target: c.target, throttle: c.throttle, orbit: false, stopped: false }, helm };
      }
      const foe = w.nearestFoe(self);
      if (!foe) return { cmd: { target: ahead(self, m.heading), throttle: 1, orbit: false, stopped: false }, helm };
      const away = Math.atan2(m.y - foe.motion.y, m.x - foe.motion.x);
      return { cmd: { target: ahead(self, away), throttle: 1, orbit: false, stopped: false }, helm };
    }
  }
}
