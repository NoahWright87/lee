// Close quarters, drawn on top of the boats: hooks in the air, the lines between
// hulls, planks laid across, and the markers of taps waiting for a Lee (a ring
// until someone is on it, then a progress arc). Used by both cameras; sizes
// that must stay readable on screen come in through `px`.

import Phaser from 'phaser';
import type { DeckOrder } from '../sim/orders';
import { railPoint } from '../sim/lines';
import { headOf, tetherAnchor } from '../sim/ness';
import { clamp, dist, lerp, toWorld, type Vec } from '../sim/math';
import type { DeckTarget } from '../sim/targets';
import type { World } from '../sim/world';
import { ZoneSystem, type DangerZone } from '../sim/zones';

const ROPE = 0xd9c08a;
const ENEMY_ROPE = 0xff9a6a;
const MARKER = 0xffd27a;
const HINT = 0x9be9a8;

type G = Phaser.GameObjects.Graphics;

/** Hooks in flight and the lines they leave. */
export function drawLines(g: G, world: World, px: (n: number) => number): void {
  // Lines between hulls: a rope with a little slack that tightens as it reels in.
  for (const line of world.lines.lines) {
    const a = world.lines.anchorWorld(line);
    const b = world.lines.attachWorld(line);
    const len = dist(a, b);
    const slack = clamp((len - line.limit) * -0.1 + 0.4, 0, 1.2);
    const mid = { x: (a.x + b.x) / 2 + (b.y - a.y) * 0.08 * slack, y: (a.y + b.y) / 2 - (b.x - a.x) * 0.08 * slack };
    const color = line.owner.side === 'enemy' ? ENEMY_ROPE : ROPE;
    const worn = 1 - line.hp / Math.max(1e-6, line.maxHp);
    g.lineStyle(px(2.6), 0x000000, 0.35);
    strokeCurve(g, a, mid, b);
    g.lineStyle(px(2), color, 1);
    strokeCurve(g, a, mid, b);
    // A cut in progress shows as fraying: a lighter, thinner middle.
    if (worn > 0.02) {
      g.lineStyle(px(1), 0xffffff, 0.25 + 0.5 * worn);
      strokeCurve(g, a, mid, b);
    }
    g.fillStyle(color, 1);
    g.fillCircle(b.x, b.y, px(3));
  }
  // Hooks in the air: the grapnel on its rope, lifted toward "up" along its arc.
  for (const f of world.lines.flights) {
    const k = clamp(f.elapsed / Math.max(1e-6, f.flight), 0, 1);
    const at = { x: lerp(f.from.x, f.to.x, k), y: lerp(f.from.y, f.to.y, k) };
    const lift = Math.sin(k * Math.PI) * 3;
    const tip = { x: at.x, y: at.y - lift };
    g.lineStyle(px(1.6), f.owner.side === 'enemy' ? ENEMY_ROPE : ROPE, 0.8);
    g.lineBetween(f.from.x, f.from.y, tip.x, tip.y);
    g.fillStyle(0xdfe3e6, 1);
    g.fillCircle(tip.x, tip.y, px(3.5));
    // Where it comes down (only for ones aimed at you; yours show the aim too, fainter).
    const hostile = f.target.side === 'player';
    g.lineStyle(px(1.5), hostile ? 0xff3030 : MARKER, hostile ? 0.9 : 0.45);
    g.strokeCircle(f.to.x, f.to.y, Math.max(1.5, world.tuning.lines.hookCatch) * (1.6 - 0.6 * k));
  }
}

/** Depth charges sinking (a dark barrel under the surface, a fuse ring that closes on the blast radius), and harpoon lines on Nesses. */
export function drawCharges(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const c of world.charges) {
    const fuse = Math.max(0.1, c.fuse);
    const total = Math.max(0.1, world.tuning.items.depthCharge?.delay ?? 2);
    const k = clamp(1 - fuse / total, 0, 1);
    // Where it will go off: a faint ring.
    g.lineStyle(px(1.3), 0xbfe6ff, 0.28 + 0.3 * k);
    g.strokeCircle(c.pos.x, c.pos.y, c.radius);
    // The barrel sinking: it shrinks and darkens.
    const r = Math.max(px(3), 1.1) * (1 - 0.35 * k);
    g.fillStyle(0x10202e, 0.9 - 0.3 * k);
    g.fillCircle(c.pos.x, c.pos.y, r);
    g.lineStyle(px(1.2), 0x9fb6c8, 0.7);
    g.strokeCircle(c.pos.x, c.pos.y, r);
    if (Math.sin(clock * 24) > 0) {
      g.fillStyle(0xffd24a, 0.9);
      g.fillCircle(c.pos.x + r * 0.6, c.pos.y - r * 0.6, px(1.4));
    }
  }
  for (const n of world.nesses.list) {
    const t = n.tether;
    if (!t) continue;
    const a = tetherAnchor(t);
    const b = headOf(n).pos;
    const len = dist(a, b);
    const slack = clamp((len - t.limit) * -0.1 + 0.3, 0, 1);
    const mid = { x: (a.x + b.x) / 2 + (b.y - a.y) * 0.07 * slack, y: (a.y + b.y) / 2 - (b.x - a.x) * 0.07 * slack };
    g.lineStyle(px(3), 0x000000, 0.35);
    strokeCurve(g, a, mid, b);
    g.lineStyle(px(2.2), ROPE, 1);
    strokeCurve(g, a, mid, b);
    const worn = 1 - t.hp / Math.max(1e-6, t.maxHp);
    if (worn > 0.02) {
      g.lineStyle(px(1), 0xffffff, 0.25 + 0.5 * worn);
      strokeCurve(g, a, mid, b);
    }
    // The barb in its head.
    g.fillStyle(0xdfe3e6, 1);
    g.fillCircle(b.x, b.y, px(3));
  }
}

function strokeCurve(g: G, a: Vec, m: Vec, b: Vec): void {
  const n = 12;
  let prev = { x: a.x, y: a.y };
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * m.x + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * m.y + t * t * b.y;
    g.lineBetween(prev.x, prev.y, x, y);
    prev = { x, y };
  }
}

/** The marker for one tap waiting on, or being worked by, a Lee. */
function orderPos(world: World, o: DeckOrder): Vec | null {
  const boat = o.boat;
  switch (o.kind) {
    case 'throw':
    case 'lower':
    case 'push':
    case 'drop':
    case 'wreckPlank':
      return o.rail ? railPoint(o.rail.boat, o.rail.tile, o.rail.rail) : null;
    case 'cutLine': {
      if (!o.line) return null;
      const a = world.lines.anchorWorld(o.line);
      const b = world.lines.attachWorld(o.line);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    case 'cutRope': {
      const s = o.swinger?.swing;
      if (!s) return null;
      const from = toWorld(s.fromLocal, s.from.motion, s.from.motion.heading);
      const to = toWorld(s.to.grid.tiles[s.toTile].center, s.to.motion, s.to.motion.heading);
      const k = clamp(s.t / Math.max(1e-6, s.dur), 0, 1);
      return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
    }
    case 'stab':
      return o.ness ? headOf(o.ness).pos : null;
    case 'flee': {
      const tile = boat.grid.tiles[o.tile];
      return tile ? toWorld(tile.center, boat.motion, boat.motion.heading) : null;
    }
    case 'bail':
    case 'repair':
    case 'man': {
      // A man order is marked while the Lee walks there; once it's on the station the order just holds it there.
      if (o.kind === 'man' && o.progress >= 1) return null;
      const tile = boat.grid.tiles[o.tile];
      return tile ? toWorld(tile.center, boat.motion, boat.motion.heading) : null;
    }
  }
}

/** Markers for taps: a ring until someone is on it, then a progress arc. */
export function drawOrderMarkers(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const o of world.orders.list) {
    if (o.boat !== world.player) continue;
    const p = orderPos(world, o);
    if (!p) continue;
    const r = px(15);
    const pulse = 0.6 + 0.4 * Math.sin(clock * 7);
    const answered = o.lees.length > 0;
    g.lineStyle(px(2.2), MARKER, answered ? 0.35 : 0.5 + 0.5 * pulse);
    g.strokeCircle(p.x, p.y, r);
    if (answered) {
      g.lineStyle(px(3), MARKER, 1);
      g.beginPath();
      g.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(o.progress, 0.02, 1), false);
      g.strokePath();
    }
  }
  // Boarders sent to a spot on their deck.
  const f = world.player.crew.focus;
  if (f && world.time < f.until) {
    const tile = f.deck.grid.tiles[f.tile];
    if (tile) {
      const p = toWorld(tile.center, f.deck.motion, f.deck.motion.heading);
      g.lineStyle(px(2), 0xff7a5a, 0.55 + 0.4 * Math.sin(clock * 6));
      g.strokeCircle(p.x, p.y, px(13));
      g.lineBetween(p.x - px(18), p.y, p.x + px(18), p.y);
      g.lineBetween(p.x, p.y - px(18), p.x, p.y + px(18));
    }
  }
}

/** Debug: every tap target as a circle (or segment), faint, so you can see what a finger can hit. */
export function drawTargets(g: G, targets: DeckTarget[], px: (n: number) => number): void {
  for (const t of targets) {
    g.lineStyle(px(1), HINT, 0.6);
    if (t.b) g.lineBetween(t.a.x, t.a.y, t.b.x, t.b.y);
    g.strokeCircle(t.a.x, t.a.y, t.radius);
  }
}

const RED = 0xff2b2b;
const BLUE = 0x3aa0ff;
const RAIN = 0x8fb4de;
const INK = 0x1a0f2a;

function colorOf(kind: string): number {
  return kind === 'slap' ? BLUE : kind === 'rain' ? RAIN : kind === 'ink' ? 0x9a6bd6 : RED;
}

function tileCorners(boat: DangerZone['boat'], i: number): Vec[] {
  const t = boat.grid.tiles[i];
  const m = boat.motion;
  return [
    toWorld({ x: t.x0, y: t.y0 }, m, m.heading),
    toWorld({ x: t.x1, y: t.y0 }, m, m.heading),
    toWorld({ x: t.x1, y: t.y1 }, m, m.heading),
    toWorld({ x: t.x0, y: t.y1 }, m, m.heading),
  ];
}

/**
 * Danger zones on a deck: the tiles flash (red for a bite, smash or drag; blue for a tail slap; grey for rain; purple for ink),
 * fill in as the blow nears, and show a mark in the middle to tap. Rain and ink then hang over the deck for a while; ink is drawn last,
 * over everything, and hides the warnings under it.
 */
export function drawZones(g: G, world: World, px: (n: number) => number, clock: number): void {
  const inked = new Map<DangerZone['boat'], Set<number>>();
  for (const z of world.zones.lingering()) {
    if (z.kind !== 'ink') continue;
    if (!inked.has(z.boat)) inked.set(z.boat, new Set());
    for (const i of z.tiles) inked.get(z.boat)!.add(i);
  }
  for (const z of world.zones.list) {
    if (z.kind === 'ink' && z.impacted) continue; // drawn in the last pass
    const boat = z.boat;
    const k = ZoneSystem.progress(z);
    const color = colorOf(z.kind);
    const flash = 0.5 + 0.5 * Math.sin(clock * (8 + 10 * k));
    // Hidden under ink: a faint outline, no mark.
    const hidden = !z.impacted && z.tiles.every((i) => inked.get(boat)?.has(i));
    let cx = 0;
    let cy = 0;
    for (const i of z.tiles) {
      const corners = tileCorners(boat, i);
      const t = boat.grid.tiles[i];
      const c = toWorld(t.center, boat.motion, boat.motion.heading);
      cx += c.x;
      cy += c.y;
      if (z.impacted && z.lasting > 0 && z.kind === 'rain') {
        // A raincloud over the tile: grey-blue, and streaks falling.
        g.fillStyle(0x6d86a6, 0.34);
        g.fillPoints(corners, true);
        g.lineStyle(px(1), 0xcfe6ff, 0.55);
        for (let d = 0; d < 3; d++) {
          const f = (clock * 1.6 + d / 3 + i * 0.17) % 1;
          const a = toWorld({ x: lerp(t.x0, t.x1, 0.2 + 0.3 * d), y: lerp(t.y0, t.y1, f) }, boat.motion, boat.motion.heading);
          const b = toWorld({ x: lerp(t.x0, t.x1, 0.2 + 0.3 * d), y: lerp(t.y0, t.y1, Math.min(1, f + 0.18)) }, boat.motion, boat.motion.heading);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
        continue;
      }
      if (z.impacted) {
        // The blow: a white flash that fades with the linger.
        g.fillStyle(0xffffff, 0.55 * clamp(z.linger / 0.45, 0, 1));
      } else {
        g.fillStyle(color, (hidden ? 0.05 : 0.14) + (hidden ? 0.05 : 0.3) * k * (0.6 + 0.4 * flash));
      }
      g.fillPoints(corners, true);
      if (!z.impacted) {
        g.lineStyle(px(1.8), color, hidden ? 0.2 : 0.55 + 0.4 * flash);
        g.strokePoints(corners, true);
      }
    }
    if (z.impacted || hidden) continue;
    // The mark to tap, sized for a finger.
    const n = Math.max(1, z.tiles.length);
    const x = cx / n;
    const y = cy / n;
    const r = Math.max(px(11), 0.9);
    if (z.kind === 'slap') {
      g.fillStyle(0xcfe8ff, 0.95);
      g.fillTriangle(x, y - r, x - r * 0.75, y + r * 0.15, x + r * 0.75, y + r * 0.15);
      g.fillCircle(x, y + r * 0.2, r * 0.75);
      g.lineStyle(px(1.4), 0x0b3a72, 1);
      g.strokeCircle(x, y + r * 0.2, r * 0.75);
    } else if (z.kind === 'rain') {
      // A cloud with drops.
      g.fillStyle(0xd7e4f4, 0.95);
      g.fillCircle(x - r * 0.45, y, r * 0.55);
      g.fillCircle(x + r * 0.2, y - r * 0.2, r * 0.7);
      g.fillCircle(x + r * 0.7, y + r * 0.05, r * 0.5);
      g.fillStyle(0x4f7fb8, 0.95);
      for (const dx of [-0.5, 0, 0.5]) g.fillCircle(x + r * dx, y + r * (0.8 + 0.2 * Math.sin(clock * 6 + dx * 9)), px(1.6));
    } else if (z.kind === 'ink') {
      g.fillStyle(0x2a1745, 0.95);
      g.fillCircle(x, y, r * 0.9);
      g.lineStyle(px(1.6), 0xc6a2ff, 1);
      g.strokeCircle(x, y, r * 0.9);
      g.fillStyle(0xc6a2ff, 1);
      g.fillCircle(x - r * 0.3, y - r * 0.2, r * 0.2);
      g.fillCircle(x + r * 0.35, y + r * 0.25, r * 0.28);
    } else {
      g.fillStyle(0xffd24a, 1);
      g.fillTriangle(x, y - r, x - r * 1.05, y + r * 0.8, x + r * 1.05, y + r * 0.8);
      g.lineStyle(px(1.6), 0x3a0000, 1);
      g.strokeTriangle(x, y - r, x - r * 1.05, y + r * 0.8, x + r * 1.05, y + r * 0.8);
      g.lineStyle(px(2.2), 0x3a0000, 1);
      g.lineBetween(x, y - r * 0.4, x, y + r * 0.2);
      g.fillStyle(0x3a0000, 1);
      g.fillCircle(x, y + r * 0.5, px(1.3));
    }
    // A thin ring closing in: time left.
    g.lineStyle(px(1.4), color, 0.6);
    g.strokeCircle(x, y, r * (1.2 + 1.6 * (1 - k)));
  }
  // Ink on top of everything.
  for (const z of world.zones.lingering()) {
    if (z.kind !== 'ink') continue;
    const fade = clamp(z.lasting / 1.2, 0, 1);
    for (const i of z.tiles) {
      const corners = tileCorners(z.boat, i);
      g.fillStyle(INK, 0.86 * fade);
      g.fillPoints(corners, true);
      const t = z.boat.grid.tiles[i];
      const c = toWorld(t.center, z.boat.motion, z.boat.motion.heading);
      g.lineStyle(px(1.2), 0x6b4a9a, 0.5 * fade);
      g.strokeCircle(c.x + Math.sin(clock * 1.3 + i) * 0.3, c.y + Math.cos(clock * 1.1 + i) * 0.3, Math.min(z.boat.grid.tileW, z.boat.grid.tileH) * (0.25 + 0.1 * Math.sin(clock + i)));
    }
  }
}
