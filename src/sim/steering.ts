// "Seek this point" steering, shared by every boat (player, enemy, later Ness)
// and by the path preview. Pure functions on plain data so the preview can run
// the exact same code the real boat runs.

import { clamp, wrapAngle, type Vec } from './math';

/** Fixed simulation step, seconds. The world and the preview both use it. */
export const FIXED_DT = 1 / 60;

export interface MotionState {
  x: number;
  y: number;
  /** Radians, 0 = +x, -PI/2 = north. */
  heading: number;
  vx: number;
  vy: number;
  /** Current turn rate, rad/s (positive = clockwise on screen, toward starboard). */
  omega: number;
  /** Which side the boat keeps a close target on while orbiting: +1 starboard, -1 port, 0 unset. */
  orbitSide: number;
}

export interface MotionParams {
  cruiseSpeed: number;
  acceleration: number;
  drag: number;
  /** rad/s */
  turnRate: number;
  /** rad/s² */
  turnAcceleration: number;
  lateralDrag: number;
  turnSpeedLoss: number;
  /** 0..1 */
  throttle: number;
  /** Orbit radius as a multiple of the tightest turn (speed / turn rate). */
  orbitRadiusScale: number;
  /** Within this many orbit radii of the target, bend into an orbit. 0 = pure seek. */
  orbitCapture: number;
}

export function cloneMotion(m: MotionState): MotionState {
  return { x: m.x, y: m.y, heading: m.heading, vx: m.vx, vy: m.vy, omega: m.omega, orbitSide: m.orbitSide };
}

/**
 * Heading the helm wants. Far from the target: straight at it. Close to it
 * (inside a couple of turning circles), bend toward a circle around it, keeping
 * it on the same side — the orbit. The orbit radius follows speed / turn rate,
 * so a slower or nimbler boat circles tighter.
 * Mutates m.orbitSide (part of the motion state, so the preview tracks it too).
 */
export function desiredHeading(m: MotionState, target: Vec, p: MotionParams): number {
  const bearing = Math.atan2(target.y - m.y, target.x - m.x);
  if (p.orbitCapture <= 0 || p.turnRate <= 0) return bearing;
  const speed = Math.max(Math.hypot(m.vx, m.vy), 0.5);
  const radius = (speed / p.turnRate) * Math.max(0.5, p.orbitRadiusScale);
  const d = Math.hypot(target.x - m.x, target.y - m.y);
  if (d > p.orbitCapture * radius || m.orbitSide === 0) {
    m.orbitSide = wrapAngle(bearing - m.heading) >= 0 ? 1 : -1;
  }
  // 0 offset at the capture edge → 90° (tangent) on the orbit → 180° at the center.
  const t = clamp((p.orbitCapture * radius - d) / ((p.orbitCapture - 1) * radius || radius), 0, 2);
  return bearing - m.orbitSide * t * (Math.PI / 2);
}

/**
 * Turn rate the helm asks for. Bang-bang with a braking curve: turn as hard as
 * allowed, easing off just in time to settle on the wanted heading.
 */
export function desiredOmega(m: MotionState, target: Vec | null, p: MotionParams): number {
  if (!target) return 0;
  const delta = wrapAngle(desiredHeading(m, target, p) - m.heading);
  const brake = Math.sqrt(2 * p.turnAcceleration * Math.abs(delta));
  return Math.sign(delta) * Math.min(p.turnRate, brake);
}

/** Advance one step. Mutates `m`. */
export function stepMotion(m: MotionState, target: Vec | null, p: MotionParams, dt: number): void {
  if (!target) m.orbitSide = 0;
  // Helm: turn rate chases the desired rate, limited by rudder speed.
  const wantOmega = desiredOmega(m, target, p);
  const maxDelta = p.turnAcceleration * dt;
  m.omega += clamp(wantOmega - m.omega, -maxDelta, maxDelta);
  // Damage can lower the turn rate below the current one; respect the new cap.
  m.omega = clamp(m.omega, -Math.max(p.turnRate, 0), Math.max(p.turnRate, 0));
  m.heading = wrapAngle(m.heading + m.omega * dt);

  // Split velocity into forward and sideways (boat frame).
  const fx = Math.cos(m.heading);
  const fy = Math.sin(m.heading);
  let vf = m.vx * fx + m.vy * fy;
  let vl = m.vx * -fy + m.vy * fx;

  // Thrust toward target speed; turning hard costs some speed.
  const turnFrac = p.turnRate > 0 ? Math.min(1, Math.abs(m.omega) / p.turnRate) : 0;
  const targetSpeed = p.cruiseSpeed * p.throttle * (1 - p.turnSpeedLoss * turnFrac);
  if (vf < targetSpeed) {
    vf = Math.min(targetSpeed, vf + p.acceleration * dt);
  } else {
    vf = targetSpeed + (vf - targetSpeed) * Math.exp(-p.drag * dt);
  }
  // Sideways slide (drift) dies out over time.
  vl *= Math.exp(-p.lateralDrag * dt);

  m.vx = fx * vf - fy * vl;
  m.vy = fy * vf + fx * vl;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
}

/**
 * Where the boat will go over `horizon` seconds if the target stays put and
 * nothing else changes. Uses stepMotion, so it can never disagree with the boat.
 */
export function predictPath(
  start: MotionState,
  target: Vec | null,
  p: MotionParams,
  horizon: number,
  sampleEvery = 3,
): Vec[] {
  const m = cloneMotion(start);
  const steps = Math.round(horizon / FIXED_DT);
  const out: Vec[] = [{ x: m.x, y: m.y }];
  for (let i = 1; i <= steps; i++) {
    stepMotion(m, target, p, FIXED_DT);
    if (i % sampleEvery === 0 || i === steps) out.push({ x: m.x, y: m.y });
  }
  return out;
}
