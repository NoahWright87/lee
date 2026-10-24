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
    case 'bail':
    case 'repair': {
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
