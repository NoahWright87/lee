// Nesses (Phase 8), drawn from the sim: the shadow under the water (the body at depth:
// bigger and lighter when deep, smaller and darker as it rises), the oval body drawn
// on top as it surfaces (and shrinking back into its shadow as it dives), the neck
// and googly-eyed head, the hands, and the ⚠️ where it will break the surface. Plain
// Graphics; sizes that must stay readable on screen come in through `px`.

import Phaser from 'phaser';
import { clamp, lerp, type Vec } from '../sim/math';
import { bodyWorld, handSlotWorld, nessKind, type Ness } from '../sim/ness';
import type { World } from '../sim/world';
import { drawBubble } from './Bubble';

type G = Phaser.GameObjects.Graphics;

const DEEP = 0x061a2c;
const HP_BACK = 0x1a1a1a;
const HP_GOOD = 0x5fd068;
const HP_LOW = 0xe0b13a;
const HP_BAD = 0xd9533a;

const hex = (css: string): number => parseInt(css.replace('#', ''), 16);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mix(a: number, b: number, k: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(lerp(ar, br, k)) << 16) | (Math.round(lerp(ag, bg, k)) << 8) | Math.round(lerp(ab, bb, k));
}

/** The points of an oval (center, half-axes, rotation). */
export function ovalPoints(cx: number, cy: number, a: number, b: number, rot: number, n = 30): Vec[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * a;
    const y = Math.sin(t) * b;
    out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return out;
}

/** How faded a dead one is (1 = fully there). */
function corpse(world: World, n: Ness): number {
  if (n.mode !== 'dead' || n.diedAt === null) return 1;
  const left = world.tuning.ness.common.corpseTime - (world.time - n.diedAt);
  return clamp(left / 4, 0, 1);
}

/**
 * A shadow in the water: an oval that is bigger and lighter the deeper the thing is, and smaller and darker as it nears
 * the surface. A Ness and a sinking depth charge both use it.
 */
export function drawShadow(g: G, at: Vec, a: number, b: number, rot: number, depth: number, fade = 1): void {
  const scale = lerp(0.82, 1.35, depth);
  const alpha = lerp(0.52, 0.16, depth) * fade;
  g.fillStyle(DEEP, alpha);
  g.fillPoints(ovalPoints(at.x, at.y, a * scale, b * scale, rot), true);
  // A softer outer edge, so a deep one reads as a smudge and a shallow one as a solid shape.
  g.fillStyle(DEEP, alpha * 0.45);
  g.fillPoints(ovalPoints(at.x, at.y, a * scale * 1.18, b * scale * 1.22, rot), true);
}

/** Under the hulls: every Ness's shadow, and every sinking depth charge's. */
export function drawNessShadows(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const n of world.nesses.list) {
    if (n.mode === 'gone') continue;
    drawShadow(g, { x: n.motion.x, y: n.motion.y }, n.length / 2, n.beam / 2, n.motion.heading, n.depth, corpse(world, n) * (n.mode === 'dead' ? 0.5 : 1));
    // Ripples where it is just under the surface.
    const near = 1 - smooth(0.1, 0.8, n.depth);
    if (near > 0.05 && n.mode !== 'dead') {
      for (let r = 0; r < 2; r++) {
        const f = (clock * 0.6 + r * 0.5) % 1;
        g.lineStyle(px(1.2), 0xcfeaff, (1 - f) * 0.3 * near);
        g.strokeCircle(n.motion.x, n.motion.y, n.beam * (0.6 + 0.9 * f));
      }
    }
  }
  for (const c of world.charges) drawShadow(g, c.pos, 1.7, 1.7, 0, c.depth, 1);
}

/** The body, neck, head and hands, once it is up (drawn over the hulls). Also the ⚠️ where it will rise. */
export function drawNessBodies(g: G, world: World, px: (n: number) => number, clock: number): void {
  for (const n of world.nesses.list) {
    if (n.mode === 'gone') continue;
    const k = nessKind(world.tuning, n.kind);
    const fade = corpse(world, n);
    // How much of it is above the water: all of it at the surface, a small dark hump just under it, nothing when deep.
    const up = 1 - smooth(0.08, 0.9, n.depth);
    if (up > 0.02 && fade > 0) drawBody(g, world, n, up * fade, px, clock);
    if (n.emergeAt) drawEmergeMark(g, n, px, clock);
    void k;
  }
}

function drawBody(g: G, world: World, n: Ness, alpha: number, px: (n: number) => number, clock: number): void {
  const k = nessKind(world.tuning, n.kind);
  const dead = n.mode === 'dead';
  const base = dead ? mix(hex(n.def.color), 0x8a8a80, 0.55) : hex(n.def.color);
  const scale = lerp(0.55, 1, alpha);
  const m = n.motion;
  const a = (n.length / 2) * scale;
  const b = (n.beam / 2) * scale;
  const rot = m.heading;
  const bob = dead ? 0 : Math.sin(clock * 2 + n.id) * 0.18;
  // The water around it where it breaks the surface.
  g.lineStyle(px(1.3), 0xe6f6ff, 0.4 * alpha);
  g.strokePoints(ovalPoints(m.x, m.y, a * 1.12 + bob, b * 1.18 + bob, rot), true);
  // Hands behind the body (stowed) are tucked at the flanks.
  for (const h of n.hands) if (h.state === 'stowed' || h.state === 'retracting') drawHand(g, n, h, base, alpha, px, k.handRadius);
  // Body: a shadow of it on the water, the oval, a lighter belly, humps along the back and a tail.
  g.fillStyle(0x07121a, 0.3 * alpha);
  g.fillPoints(ovalPoints(m.x + 0.6, m.y + 0.9, a * 1.04, b * 1.04, rot), true);
  const tail = bodyWorld(n, { x: (-n.length / 2) * 1.12 * scale, y: 0 });
  const t1 = bodyWorld(n, { x: (-n.length / 2) * 0.7 * scale, y: b * 0.5 });
  const t2 = bodyWorld(n, { x: (-n.length / 2) * 0.7 * scale, y: -b * 0.5 });
  g.fillStyle(mix(base, 0x000000, 0.18), alpha);
  g.fillTriangle(tail.x, tail.y, t1.x, t1.y, t2.x, t2.y);
  g.fillStyle(mix(base, 0x000000, 0.25), alpha);
  g.fillPoints(ovalPoints(m.x, m.y, a, b, rot), true);
  g.fillStyle(base, alpha);
  g.fillPoints(ovalPoints(m.x, m.y, a * 0.96, b * 0.9, rot), true);
  g.fillStyle(mix(base, 0xffffff, 0.22), 0.7 * alpha);
  g.fillPoints(ovalPoints(m.x - Math.sin(rot) * b * 0.15, m.y + Math.cos(rot) * b * 0.15, a * 0.8, b * 0.55, rot), true);
  for (const f of [-0.42, 0.12, 0.5]) {
    const h = bodyWorld(n, { x: f * n.length * scale, y: 0 });
    g.fillStyle(mix(base, 0x000000, 0.22), 0.9 * alpha);
    g.fillPoints(ovalPoints(h.x, h.y, a * 0.2, b * 0.62, rot), true);
    g.fillStyle(mix(base, 0xffffff, 0.16), 0.6 * alpha);
    g.fillPoints(ovalPoints(h.x - Math.sin(rot) * b * 0.12, h.y + Math.cos(rot) * b * 0.12, a * 0.12, b * 0.34, rot), true);
  }
  // Neck, hands that are out, and the head: only when it is properly up.
  if (alpha > 0.5) {
    drawNeck(g, n, k.neckRadius, k.headRadius, base, alpha, clock, dead, world, px);
    for (const h of n.hands) if (h.state === 'reaching' || h.state === 'holding') drawHand(g, n, h, base, alpha, px, k.handRadius);
  }
}

function drawNeck(g: G, n: Ness, neckR: number, headR: number, base: number, alpha: number, clock: number, dead: boolean, world: World, px: (n: number) => number): void {
  const pts = n.neck.pts;
  if (pts.length < 2) return;
  const segs = pts.length - 1;
  // Joints, thickest at the body and thinning toward the head.
  for (let i = 0; i < segs; i++) {
    const r = lerp(neckR * 1.15, neckR * 0.8, i / segs);
    g.lineStyle(r * 2, mix(base, 0x000000, 0.2), alpha);
    g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
  for (let i = 0; i < segs; i++) {
    const r = lerp(neckR * 1.15, neckR * 0.8, i / segs);
    g.lineStyle(r * 1.5, base, alpha);
    g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    g.fillStyle(base, alpha);
    g.fillCircle(pts[i].x, pts[i].y, r * 0.95);
  }
  // The head: a circle with a snout toward where it looks, and googly eyes.
  const head = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  let dx = head.x - prev.x;
  let dy = head.y - prev.y;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const windup = n.neck.state === 'windup';
  const flush = windup ? 0.35 + 0.25 * Math.sin(clock * 18) : 0;
  const headCol = mix(mix(base, 0xffffff, 0.08), 0xff3a2a, Math.max(0, flush));
  const R = headR * (windup ? 1.12 : 1);
  g.fillStyle(0x07121a, 0.3 * alpha);
  g.fillCircle(head.x + 0.5, head.y + 0.7, R * 1.05);
  g.fillStyle(mix(headCol, 0x000000, 0.22), alpha);
  g.fillCircle(head.x, head.y, R);
  g.fillStyle(headCol, alpha);
  g.fillCircle(head.x, head.y, R * 0.9);
  // Snout.
  g.fillStyle(mix(headCol, 0xffffff, 0.12), alpha);
  g.fillCircle(head.x + dx * R * 0.75, head.y + dy * R * 0.75, R * 0.5);
  // Eyes: googly, looking at your boat; crossed out when it is dead.
  const me = world.player.motion;
  let lx = me.x - head.x;
  let ly = me.y - head.y;
  const ll = Math.hypot(lx, ly) || 1;
  lx /= ll;
  ly /= ll;
  const px2 = -dy;
  const py2 = dx;
  for (const side of [-1, 1]) {
    const ex = head.x + dx * R * 0.1 + px2 * side * R * 0.5;
    const ey = head.y + dy * R * 0.1 + py2 * side * R * 0.5;
    if (dead) {
      const q = R * 0.28;
      g.lineStyle(px(1.8), 0x10131a, alpha);
      g.lineBetween(ex - q, ey - q, ex + q, ey + q);
      g.lineBetween(ex - q, ey + q, ex + q, ey - q);
      continue;
    }
    g.fillStyle(0xfdfdf2, alpha);
    g.fillCircle(ex, ey, R * 0.34);
    g.fillStyle(0x10131a, alpha);
    g.fillCircle(ex + lx * R * 0.14, ey + ly * R * 0.14, R * 0.17);
  }
}

function drawHand(g: G, n: Ness, h: Ness['hands'][number], base: number, alpha: number, px: (n: number) => number, radius: number): void {
  const slot = handSlotWorld(n, h);
  const out = h.slot.side;
  const rope = h.state === 'reaching' || h.state === 'holding';
  if (rope) {
    g.lineStyle(radius * 0.7, mix(base, 0x000000, 0.2), alpha);
    g.lineBetween(slot.x, slot.y, h.pos.x, h.pos.y);
    g.lineStyle(radius * 0.45, base, alpha);
    g.lineBetween(slot.x, slot.y, h.pos.x, h.pos.y);
  }
  const at = rope ? h.pos : slot;
  const flat = h.state === 'holding';
  g.fillStyle(mix(base, 0x000000, 0.2), alpha);
  g.fillCircle(at.x, at.y, radius * 1.1);
  g.fillStyle(mix(base, 0xffffff, 0.1), alpha);
  g.fillCircle(at.x, at.y, radius * 0.85);
  // Claws: three little fingers spread outward (clutching when it holds).
  const ang = n.motion.heading + out * (Math.PI / 2);
  for (const f of [-0.6, 0, 0.6]) {
    const aa = ang + f * (flat ? 0.5 : 1);
    g.lineStyle(px(1.8), mix(base, 0x000000, 0.35), alpha);
    g.lineBetween(at.x, at.y, at.x + Math.cos(aa) * radius * 1.8, at.y + Math.sin(aa) * radius * 1.8);
  }
  // A holding hand shows what is left of it.
  if (h.state === 'holding') {
    const w = px(26);
    const frac = clamp(h.hp / Math.max(1, h.maxHp), 0, 1);
    g.fillStyle(HP_BACK, 0.7 * alpha);
    g.fillRect(at.x - w / 2 - px(1), at.y - radius * 2.4 - px(1), w + px(2), px(5));
    g.fillStyle(frac > 0.5 ? HP_GOOD : frac > 0.25 ? HP_LOW : HP_BAD, alpha);
    g.fillRect(at.x - w / 2, at.y - radius * 2.4, w * frac, px(3));
  }
}

/** An HP bar over every live Ness at any depth (a diving or fleeing one too), kept upright on the screen: `up` is the screen's "up" in world terms. */
export function drawNessHealth(g: G, world: World, px: (n: number) => number, up: Vec = { x: 0, y: -1 }): void {
  const right = { x: -up.y, y: up.x };
  for (const n of world.nesses.list) {
    if (n.mode === 'gone' || n.mode === 'dead') continue;
    const w = px(44);
    const hgt = px(5);
    const frac = clamp(n.hp / Math.max(1, n.maxHp), 0, 1);
    const lift = n.beam / 2 + px(16);
    const c = { x: n.motion.x + up.x * lift, y: n.motion.y + up.y * lift };
    const alpha = lerp(1, 0.6, smooth(0.3, 1, n.depth));
    const quad = (x0: number, x1: number, y0: number, y1: number) => [
      { x: c.x + right.x * x0 + up.x * y0, y: c.y + right.y * x0 + up.y * y0 },
      { x: c.x + right.x * x1 + up.x * y0, y: c.y + right.y * x1 + up.y * y0 },
      { x: c.x + right.x * x1 + up.x * y1, y: c.y + right.y * x1 + up.y * y1 },
      { x: c.x + right.x * x0 + up.x * y1, y: c.y + right.y * x0 + up.y * y1 },
    ];
    g.fillStyle(HP_BACK, 0.75 * alpha);
    g.fillPoints(quad(-w / 2 - px(1), w / 2 + px(1), -px(1), hgt + px(1)), true);
    if (frac > 0) {
      g.fillStyle(frac > 0.5 ? HP_GOOD : frac > 0.25 ? HP_LOW : HP_BAD, alpha);
      g.fillPoints(quad(-w / 2, -w / 2 + w * frac, 0, hgt), true);
    }
  }
}

/** The ⚠️ where it will break the surface (on the shadow if it is still, ahead of it if it is moving). */
function drawEmergeMark(g: G, n: Ness, px: (n: number) => number, clock: number): void {
  if (!n.emergeAt) return;
  drawBubble(g, n.emergeAt, 'warn', px, clock, null, 0xffb02a);
}
