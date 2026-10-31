// Nesses (Phase 8), drawn in the ocean view: a shadow under the water that
// nobody can hit, the ring that warns where one will rise, and the body (head,
// coils, tail) while it is up. Plain Graphics, sizes that must stay readable on
// screen come in through `px`. Colors are from the kind's definition.

import Phaser from 'phaser';
import { clamp, lerp, type Vec } from '../sim/math';
import { headOf, type Ness } from '../sim/ness';
import type { Telegraph } from '../sim/telegraph';
import type { World } from '../sim/world';

type G = Phaser.GameObjects.Graphics;

const DEEP = 0x061a2c;
const WARN = 0xff2b2b;
const WARN_DARK = 0x3a0000;
const HP_BACK = 0x1a1a1a;
const HP_GOOD = 0x5fd068;
const HP_LOW = 0xe0b13a;
const HP_BAD = 0xd9533a;

const hex = (css: string): number => parseInt(css.replace('#', ''), 16);

function mix(a: number, b: number, k: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(lerp(ar, br, k)) << 16) | (Math.round(lerp(ag, bg, k)) << 8) | Math.round(lerp(ab, bb, k));
}

/** 0 → 1 over `fade` seconds since the Ness last changed state. */
function since(world: World, n: Ness): number {
  return clamp((world.time - n.since) / Math.max(0.05, world.tuning.ness.common.fadeTime), 0, 1);
}

/** How far through its sinking a dead Ness is. */
export function sinkK(world: World, n: Ness): number {
  return n.diedAt === null ? 0 : clamp((world.time - n.diedAt) / Math.max(0.1, world.tuning.ness.common.sinkTime), 0, 1);
}

/** Under the hulls: the dark shape of every Ness that is down (and of one that is rising, growing darker and closer). */
export function drawNessShadows(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const n of world.nesses.list) {
    if (n.state === 'surfaced' || n.state === 'dead') continue;
    const rising = n.state === 'emerging' ? clamp(n.stateT / Math.max(0.1, world.tuning.ness.kinds[n.kind]?.warn ?? 2), 0, 1) : 0;
    const fadeIn = n.state === 'submerged' ? since(world, n) : 1;
    // A Quiet Ness is a faint shadow, unless a Lookout is manned.
    const faint = (world.tuning.ness.kinds[n.kind]?.stealth ?? 0) > 0 && !world.lookoutManned() ? 0.3 : 1;
    const alpha = (0.28 + 0.3 * rising) * (0.4 + 0.6 * fadeIn) * faint;
    const swell = 1 + 0.25 * rising;
    for (let i = n.parts.length - 1; i >= 0; i--) {
      const p = n.parts[i];
      g.fillStyle(DEEP, alpha);
      g.fillCircle(p.pos.x, p.pos.y, p.radius * swell * 1.05);
    }
    // Joints between parts, so the shadow reads as one body.
    g.lineStyle(n.parts[1].radius * 2 * swell, DEEP, alpha);
    for (let i = 1; i < n.parts.length; i++) g.lineBetween(n.parts[i - 1].pos.x, n.parts[i - 1].pos.y, n.parts[i].pos.x, n.parts[i].pos.y);
    // A wake over the head: two ripples that spread and fade.
    const h = headOf(n);
    for (let r = 0; r < 2; r++) {
      const k = (clock * 0.7 + r * 0.5) % 1;
      g.lineStyle(px(1.2), 0xcfeaff, (1 - k) * 0.32);
      g.strokeCircle(h.pos.x, h.pos.y, h.radius * (1.1 + 1.4 * k));
    }
  }
}

/** The body, once it is up. Each part tints red as it is hurt; a head bar shows what is left. */
export function drawNessBodies(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const n of world.nesses.list) {
    const sink = sinkK(world, n);
    const up = n.state === 'surfaced' ? since(world, n) : n.state === 'dead' ? 1 - sink : 0;
    if (up <= 0) continue;
    const base = hex(n.def.color);
    const bob = Math.sin(clock * 2.2 + n.id) * 0.25;
    const a = clamp(up * 1.4, 0, 1) * (n.def.solid ?? 1);
    // Water around the body where it breaks the surface.
    for (const p of n.parts) {
      g.lineStyle(px(1.2), 0xe6f6ff, 0.35 * a);
      g.strokeCircle(p.pos.x, p.pos.y, (p.radius + 0.8 + bob) * (0.6 + 0.4 * up));
    }
    const color = (hp: number, max: number) => mix(0xb3402e, base, clamp(max > 0 ? hp / max : 0, 0, 1) * 0.8 + 0.2);
    // Joints first, tail to head, so the head sits on top.
    for (let i = n.parts.length - 1; i >= 1; i--) {
      const a0 = n.parts[i];
      const a1 = n.parts[i - 1];
      g.lineStyle(Math.min(a0.radius, a1.radius) * 2 * (0.6 + 0.4 * up), color(a0.hp, a0.maxHp), 0.95 * a);
      g.lineBetween(a0.pos.x, a0.pos.y, a1.pos.x, a1.pos.y);
    }
    for (let i = n.parts.length - 1; i >= 0; i--) {
      const p = n.parts[i];
      // Rearing back for a blow: the head swells and flushes red; a tail slap lifts the tail.
      const rearing = p.role === 'head' ? n.rear : n.act?.kind === 'slap' && p.role === 'tail' ? n.rear : 0;
      const r = p.radius * (0.6 + 0.4 * up) * (1 + 0.3 * rearing);
      const c = mix(color(p.hp, p.maxHp), n.act?.kind === 'slap' ? 0x3aa0ff : 0xff3a2a, 0.55 * rearing * (0.5 + 0.5 * Math.sin(clock * 16)));
      g.fillStyle(0x07121a, 0.35 * a);
      g.fillCircle(p.pos.x + 0.5, p.pos.y + 0.7, r * 1.05);
      g.fillStyle(c, 0.97 * a);
      g.fillCircle(p.pos.x, p.pos.y, r);
      g.fillStyle(0xffffff, 0.18 * a);
      g.fillCircle(p.pos.x - r * 0.25, p.pos.y - r * 0.3, r * 0.5);
      // A part that is out (zero HP) is dark.
      if (p.hp <= 0 && p.role !== 'head') {
        g.fillStyle(0x1a0f0f, 0.55 * a);
        g.fillCircle(p.pos.x, p.pos.y, r);
      }
    }
    // Head: eyes toward where it is looking.
    const h = headOf(n);
    const f = { x: Math.cos(n.heading), y: Math.sin(n.heading) };
    const s = { x: -f.y, y: f.x };
    const stunned = n.stunUntil !== null;
    for (const side of stunned ? [] : [-1, 1]) {
      const ex = h.pos.x + f.x * h.radius * 0.45 + s.x * side * h.radius * 0.5;
      const ey = h.pos.y + f.y * h.radius * 0.45 + s.y * side * h.radius * 0.5;
      g.fillStyle(0xfdfdf2, a);
      g.fillCircle(ex, ey, h.radius * 0.26);
      g.fillStyle(0x10131a, a);
      g.fillCircle(ex + f.x * h.radius * 0.1, ey + f.y * h.radius * 0.1, h.radius * 0.13);
    }
    if (stunned) {
      // Eyes crossed out, and stars circling its head.
      for (const side of [-1, 1]) {
        const ex = h.pos.x + f.x * h.radius * 0.45 + s.x * side * h.radius * 0.5;
        const ey = h.pos.y + f.y * h.radius * 0.45 + s.y * side * h.radius * 0.5;
        const q = h.radius * 0.22;
        g.lineStyle(px(1.8), 0x10131a, a);
        g.lineBetween(ex - q, ey - q, ex + q, ey + q);
        g.lineBetween(ex - q, ey + q, ex + q, ey - q);
      }
      for (let i = 0; i < 3; i++) {
        const ang = clock * 3 + (i * Math.PI * 2) / 3;
        const sx = h.pos.x + Math.cos(ang) * h.radius * 1.5;
        const sy = h.pos.y + Math.sin(ang) * h.radius * 0.8 - h.radius * 0.9;
        g.fillStyle(0xffe45a, a);
        g.fillCircle(sx, sy, Math.max(px(2.4), h.radius * 0.18));
        g.lineStyle(px(1), 0xfff6b0, a);
        g.strokeCircle(sx, sy, Math.max(px(3.6), h.radius * 0.3));
      }
    }
    if (n.state === 'surfaced') drawHealth(g, n, h.pos, h.radius, px, a);
  }
}

function drawHealth(g: G, n: Ness, at: Vec, radius: number, px: (n: number) => number, a: number): void {
  const h = headOf(n);
  const w = px(38);
  const hgt = px(5);
  const x = at.x - w / 2;
  const y = at.y - radius - px(13);
  g.fillStyle(HP_BACK, 0.7 * a);
  g.fillRect(x - px(1), y - px(1), w + px(2), hgt + px(2));
  const frac = clamp(h.hp / Math.max(1, h.maxHp), 0, 1);
  g.fillStyle(frac > 0.5 ? HP_GOOD : frac > 0.25 ? HP_LOW : HP_BAD, a);
  g.fillRect(x, y, w * frac, hgt);
}

/** The ring where a Ness is about to rise: a warning mark in the middle, ripples spreading, the ring filling in as the time runs out. */
export function drawEmergeRing(g: G, t: Telegraph, k: number, a: number, px: (n: number) => number, clock: number): void {
  const r = Math.max(t.size, px(10));
  const { x, y } = t.pos;
  if (t.impacted) {
    // It has broken the surface: the ring bursts outward and fades.
    const burst = clamp(1 - t.linger / 0.4, 0, 1);
    g.lineStyle(px(2.4), 0xe6f6ff, 0.7 * a * (1 - burst));
    g.strokeCircle(x, y, r * (1 + 0.5 * burst));
    return;
  }
  g.fillStyle(WARN, (0.08 + 0.2 * k) * a);
  g.fillCircle(x, y, r);
  g.lineStyle(px(2.2), WARN, (0.55 + 0.4 * k) * a);
  g.strokeCircle(x, y, r);
  // Ripples spreading from the middle out to the ring.
  for (let i = 0; i < 3; i++) {
    const f = (clock * 0.9 + i / 3) % 1;
    g.lineStyle(px(1.3), 0xffb0a0, (1 - f) * 0.5 * a);
    g.strokeCircle(x, y, r * f);
  }
  // The closing ring: timing, as the red X has.
  g.lineStyle(px(1.2), WARN, 0.45 * a);
  g.strokeCircle(x, y, lerp(r * 1.9, r, k));
  // ⚠ in the middle.
  const s = Math.max(px(9), r * 0.3);
  g.fillStyle(0xffd24a, a);
  g.fillTriangle(x, y - s, x - s * 0.95, y + s * 0.7, x + s * 0.95, y + s * 0.7);
  g.lineStyle(px(1.2), WARN_DARK, a);
  g.strokeTriangle(x, y - s, x - s * 0.95, y + s * 0.7, x + s * 0.95, y + s * 0.7);
  g.lineStyle(px(2), WARN_DARK, a);
  g.lineBetween(x, y - s * 0.4, x, y + s * 0.15);
  g.fillStyle(WARN_DARK, a);
  g.fillCircle(x, y + s * 0.42, px(1.2));
}
