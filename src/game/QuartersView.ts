// Close quarters, drawn on top of the boats: hooks in the air, the lines between
// hulls, planks laid across, and the markers of taps waiting for a Lee (a ring
// until someone is on it, then a progress arc). Used by both cameras; sizes
// that must stay readable on screen come in through `px`.

import Phaser from 'phaser';
import type { DeckOrder } from '../sim/orders';
import { railPoint } from '../sim/lines';
import { clamp, dist, lerp, toWorld, type Vec } from '../sim/math';
import type { DeckTarget } from '../sim/targets';
import type { World } from '../sim/world';
import { zoneCenter, ZoneSystem, type DangerZone } from '../sim/zones';
import { isHeadOpen } from '../sim/ness';
import { drawBubble } from './Bubble';

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
      return o.ness ? o.ness.neck.head : null;
    case 'cutHand':
      return o.hand ? o.hand.pos : null;
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
 * A bite coming: a red rectangle from the head to where it will land, pulsing along the way it will strike, a circle at the
 * tip; the tiles of your deck under it flash (the tip hardest); and a ⚠️ bubble on your boat to tap, so the Lees in it step out.
 * If your boat has moved out from under it, there are no tiles and no bubble: you dodged.
 */
export function drawZones(g: G, world: World, px: (n: number) => number, clock: number, bubbles = true): void {
  for (const z of world.zones.list) {
    const boat = z.boat;
    const k = ZoneSystem.progress(z);
    const shape = z.shape();
    const flash = 0.5 + 0.5 * Math.sin(clock * (8 + 10 * k));
    if (z.impacted) {
      // The bite lands: a white flash on what it hit, fading.
      const f = clamp(z.linger / 0.45, 0, 1);
      for (const i of z.tiles) {
        g.fillStyle(0xffffff, 0.55 * f * (z.weights.get(i) ?? 0));
        g.fillPoints(tileCorners(boat, i), true);
      }
      continue;
    }
    // The rectangle, projected from the head toward where it lands.
    const dx = shape.b.x - shape.a.x;
    const dy = shape.b.y - shape.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const hw = shape.width / 2;
    const rect = [
      { x: shape.a.x - uy * hw, y: shape.a.y + ux * hw },
      { x: shape.b.x - uy * hw, y: shape.b.y + ux * hw },
      { x: shape.b.x + uy * hw, y: shape.b.y - ux * hw },
      { x: shape.a.x + uy * hw, y: shape.a.y - ux * hw },
    ];
    g.fillStyle(RED, 0.1 + 0.2 * k * (0.6 + 0.4 * flash));
    g.fillPoints(rect, true);
    g.lineStyle(px(1.8), RED, 0.5 + 0.45 * flash);
    g.strokePoints(rect, true);
    g.fillStyle(RED, 0.16 + 0.26 * k * (0.6 + 0.4 * flash));
    g.fillCircle(shape.b.x, shape.b.y, shape.tip);
    g.lineStyle(px(2), RED, 0.7 + 0.3 * flash);
    g.strokeCircle(shape.b.x, shape.b.y, shape.tip);
    // Chevrons running along it toward the tip: the way it will strike.
    for (let c = 0; c < 3; c++) {
      const f = (clock * (0.9 + 1.4 * k) + c / 3) % 1;
      const cx = shape.a.x + dx * f;
      const cy = shape.a.y + dy * f;
      const w = hw * 0.8;
      g.lineStyle(px(2.2), 0xffe0d0, (1 - Math.abs(f - 0.5) * 1.2) * 0.8);
      g.lineBetween(cx - uy * w - ux * w * 0.7, cy + ux * w - uy * w * 0.7, cx, cy);
      g.lineBetween(cx + uy * w - ux * w * 0.7, cy - ux * w - uy * w * 0.7, cx, cy);
    }
    // Your deck: the tiles in danger.
    for (const i of z.tiles) {
      const wgt = z.weights.get(i) ?? 0;
      g.fillStyle(RED, (0.1 + 0.32 * k * (0.6 + 0.4 * flash)) * (0.4 + 0.6 * wgt));
      const corners = tileCorners(boat, i);
      g.fillPoints(corners, true);
      g.lineStyle(px(1.8), RED, (0.45 + 0.45 * flash) * (0.4 + 0.6 * wgt));
      g.strokePoints(corners, true);
    }
    // The tappable bubble: only while some of your deck is under it.
    if (bubbles && z.tiles.length && boat === world.player) drawBubble(g, zoneCenter(z), 'warn', px, clock, k);
  }
}

/** Depth charges are drawn as shadows (see NessView); the blast radius of each shows faintly so you can lead a Ness into it. */
export function drawCharges(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const c of world.charges) {
    g.lineStyle(px(1.2), 0xbfe6ff, 0.22 + 0.12 * Math.sin(clock * 6));
    g.strokeCircle(c.pos.x, c.pos.y, c.radius);
    g.lineStyle(px(1), 0xffd24a, 0.35);
    g.strokeCircle(c.pos.x, c.pos.y, c.trigger);
  }
}

/** Bubbles for the other things a tap answers: the head while it is on your boat (hit it), a hand that has your boat (cut it free). */
export function drawNessBubbles(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const n of world.nesses.list) {
    if (isHeadOpen(n)) drawBubble(g, n.neck.head, 'sword', px, clock, null, 0xffb02a);
    for (const h of n.hands) if (h.state === 'holding' && h.boat === world.player) drawBubble(g, h.pos, 'cut', px, clock, null, 0xffb02a);
  }
}
