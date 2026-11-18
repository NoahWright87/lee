// The standard "tap this" mark: a white bubble with an icon in it, pulsing, with a
// ring closing in as time runs out. Used for anything the player can answer with a
// tap (a bite to step out of, a head to hit, a hand to cut free). Plain Graphics;
// `px` turns CSS pixels into world meters for the camera drawing it.

import Phaser from 'phaser';
import { clamp, type Vec } from '../sim/math';

type G = Phaser.GameObjects.Graphics;

export type BubbleIcon = 'warn' | 'sword' | 'cut';

const INK = 0x2a1208;

/** A bubble at `at`, `size` CSS px across, `urgency` 0 → 1 closing the timing ring (null = no ring). */
export function drawBubble(g: G, at: Vec, icon: BubbleIcon, px: (n: number) => number, clock: number, urgency: number | null = null, tint = 0xff3b2a): void {
  const r = px(15);
  const pulse = 1 + 0.08 * Math.sin(clock * 9);
  const R = r * pulse;
  // Shadow and body.
  g.fillStyle(0x000000, 0.28);
  g.fillCircle(at.x + px(1.5), at.y + px(2), R);
  g.fillStyle(0xfff8ee, 0.97);
  g.fillCircle(at.x, at.y, R);
  g.lineStyle(px(2.4), tint, 1);
  g.strokeCircle(at.x, at.y, R);
  // A little tail pointing down, like a speech bubble.
  g.fillStyle(0xfff8ee, 0.97);
  g.fillTriangle(at.x - px(4), at.y + R - px(1), at.x + px(4), at.y + R - px(1), at.x, at.y + R + px(6));
  g.lineStyle(px(2), tint, 1);
  g.lineBetween(at.x - px(4), at.y + R - px(0.5), at.x, at.y + R + px(6));
  g.lineBetween(at.x + px(4), at.y + R - px(0.5), at.x, at.y + R + px(6));
  const s = R * 0.55;
  switch (icon) {
    case 'warn':
      g.fillStyle(0xffd24a, 1);
      g.fillTriangle(at.x, at.y - s, at.x - s * 1.05, at.y + s * 0.8, at.x + s * 1.05, at.y + s * 0.8);
      g.lineStyle(px(1.4), INK, 1);
      g.strokeTriangle(at.x, at.y - s, at.x - s * 1.05, at.y + s * 0.8, at.x + s * 1.05, at.y + s * 0.8);
      g.lineStyle(px(2), INK, 1);
      g.lineBetween(at.x, at.y - s * 0.35, at.x, at.y + s * 0.2);
      g.fillStyle(INK, 1);
      g.fillCircle(at.x, at.y + s * 0.5, px(1.2));
      break;
    case 'sword':
      g.lineStyle(px(2.6), INK, 1);
      g.lineBetween(at.x - s * 0.9, at.y + s * 0.9, at.x + s * 0.9, at.y - s * 0.9);
      g.lineBetween(at.x + s * 0.9, at.y + s * 0.9, at.x - s * 0.9, at.y - s * 0.9);
      g.lineStyle(px(2.2), 0xb9bec4, 1);
      g.lineBetween(at.x - s * 0.8, at.y + s * 0.8, at.x + s * 0.8, at.y - s * 0.8);
      g.lineBetween(at.x + s * 0.8, at.y + s * 0.8, at.x - s * 0.8, at.y - s * 0.8);
      break;
    case 'cut':
      g.lineStyle(px(2.4), INK, 1);
      g.lineBetween(at.x - s, at.y - s * 0.6, at.x + s, at.y + s * 0.6);
      g.lineBetween(at.x - s, at.y + s * 0.6, at.x + s, at.y - s * 0.6);
      g.strokeCircle(at.x - s * 0.9, at.y - s * 0.75, s * 0.28);
      g.strokeCircle(at.x - s * 0.9, at.y + s * 0.75, s * 0.28);
      break;
  }
  // A ring closing in on the bubble: the time left.
  if (urgency !== null) {
    g.lineStyle(px(1.6), tint, 0.7);
    g.strokeCircle(at.x, at.y, R + px(3) + px(14) * (1 - clamp(urgency, 0, 1)));
  }
}
