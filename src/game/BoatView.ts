// Draws one boat into the world: part sprites, crack overlays, deck water,
// cannon barrels, and hit flashes. Reads Boat state; never writes it.

import Phaser from 'phaser';
import { cannonOnline, structureFraction, type Boat } from '../sim/boat';
import { clamp, lerp, pointInPolygon, polygonBounds, Rng, toWorld, type Vec } from '../sim/math';
import type { World } from '../sim/world';
import { CRACK_STAGES, crackTextureKey, partTextureKey, suppliedArt } from './textures';

/** HP-damage fractions at which each crack stage starts to fade in. */
function crackThreshold(stage: number): number {
  return 0.12 + (stage / CRACK_STAGES) * 0.78;
}

interface PartSprite {
  img: Phaser.GameObjects.Image;
  cracks: Phaser.GameObjects.Image[];
  center: Vec;
  w: number;
  h: number;
  puddles: { p: Vec; r: number }[];
  flash: number;
}

export class BoatView {
  readonly boat: Boat;
  readonly parts: PartSprite[] = [];
  /** Deck graphics in world units (water, barrels, flashes). */
  readonly deck: Phaser.GameObjects.Graphics;
  /** Barrel sprites when cannon art is supplied (otherwise barrels are drawn). */
  private barrels: Phaser.GameObjects.Image[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, boat: Boat) {
    this.boat = boat;
    for (const part of boat.parts) {
      const b = polygonBounds(part.def.polygon);
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const art = suppliedArt(scene, boat.side, part.def);
      const img = scene.add.image(0, 0, art ?? partTextureKey(boat.side, boat.layout, part.def)).setDepth(10);
      if (art && part.def.flipArt) img.setFlipY(true);
      const cracks: Phaser.GameObjects.Image[] = [];
      for (let s = 0; s < CRACK_STAGES; s++) {
        cracks.push(scene.add.image(0, 0, crackTextureKey(boat.layout, part.def, s)).setDepth(11).setAlpha(0));
      }
      this.objects.push(img, ...cracks);
      this.parts.push({
        img,
        cracks,
        center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
        w,
        h,
        puddles: puddleSpots(part.def.polygon, part.def.id),
        flash: 0,
      });
    }
    this.deck = scene.add.graphics().setDepth(12);
    this.objects.push(this.deck);
    if (scene.textures.exists('art:barrel')) {
      for (let i = 0; i < boat.cannons.length; i++) {
        const img = scene.add.image(0, 0, 'art:barrel').setDepth(13);
        this.barrels.push(img);
        this.objects.push(img);
      }
    }
  }

  /** All game objects, so the scene can hide them from a camera. */
  all(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  flashPart(index: number): void {
    const p = this.parts[index];
    if (p) p.flash = 1;
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  update(world: World, dt: number): void {
    const boat = this.boat;
    const m = boat.motion;
    const sink = world.sinkAnim(boat);
    // Sinking: roll (squash across the beam), darken, fade under.
    const roll = 1 - 0.35 * sink;
    const alpha = 1 - sink;
    const tint = lerpColor(0xffffff, 0x1d3550, sink);
    const wobble = sink * 0.12 * Math.sin(world.time * 3);
    const heading = m.heading + wobble;

    boat.parts.forEach((part, i) => {
      const v = this.parts[i];
      const c = toWorld({ x: v.center.x, y: v.center.y * roll }, m, heading);
      const frac = structureFraction(part);
      const wreckTint = frac <= 0 ? 0x8a8a8a : 0xffffff;
      v.img.setPosition(c.x, c.y).setRotation(heading).setDisplaySize(v.w, v.h * roll).setAlpha(alpha);
      v.img.setTint(multiplyColor(tint, wreckTint));
      const damage = 1 - frac;
      v.cracks.forEach((img, s) => {
        const a = clamp((damage - crackThreshold(s)) / 0.12, 0, 1);
        img.setPosition(c.x, c.y).setRotation(heading).setDisplaySize(v.w, v.h * roll);
        img.setAlpha(a * alpha).setVisible(a > 0);
      });
      v.flash = Math.max(0, v.flash - dt * 4);
    });

    this.drawDeck(world, heading, roll, alpha);
  }

  private drawDeck(world: World, heading: number, roll: number, alpha: number): void {
    const g = this.deck;
    const boat = this.boat;
    const m = boat.motion;
    g.clear();
    if (alpha <= 0.01) return;
    const W = (p: Vec) => toWorld({ x: p.x, y: p.y * roll }, m, heading);

    // Water on deck: puddles grow with the part's fill level.
    boat.parts.forEach((part, i) => {
      const v = this.parts[i];
      const fill = part.capacity > 0 ? part.water / part.capacity : 0;
      if (fill <= 0.005) return;
      v.puddles.forEach((pd, k) => {
        const grow = clamp((fill - k * 0.12) / 0.45, 0, 1);
        if (grow <= 0) return;
        const r = pd.r * grow * (1 + 0.06 * Math.sin(world.time * 2.2 + k * 1.7 + i));
        const c = W(pd.p);
        g.fillStyle(0x2f86d6, 0.78 * alpha);
        g.fillEllipse(c.x, c.y, r * 2, r * 2 * roll);
        g.fillStyle(0x8fd0ff, 0.45 * alpha);
        g.fillEllipse(c.x - r * 0.2, c.y - r * 0.2, r * 0.9, r * 0.9 * roll);
      });
    });

    // Hit flashes.
    boat.parts.forEach((part, i) => {
      const f = this.parts[i].flash;
      if (f <= 0) return;
      g.fillStyle(0xfff3d6, 0.7 * f * alpha);
      g.fillPoints(part.def.polygon.map(W), true);
    });

    // Cannon barrels with recoil; gatlings as a short barrel cluster that shivers while firing.
    boat.cannons.forEach((c, i) => {
      const online = cannonOnline(boat, c, world.tuning);
      if (c.kind === 'gatling') {
        this.barrels[i]?.setVisible(false);
        const s = c.broadside;
        const firing = world.time - c.lastFired < 0.25 ? Math.sin(world.time * 90) * 0.12 : 0;
        for (const dx of [-0.3, 0, 0.3]) {
          const a = W({ x: c.local.x + dx + firing, y: c.local.y - s * 0.3 });
          const b = W({ x: c.local.x + dx * 0.6 + firing, y: c.local.y + s * 1.6 });
          g.lineStyle(0.22, online ? 0x2a2d31 : 0x6d6862, alpha);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
        const hub = W({ x: c.local.x, y: c.local.y - s * 0.2 });
        g.fillStyle(online ? 0x3a3f45 : 0x6d6862, alpha);
        g.fillCircle(hub.x, hub.y, 0.45);
        return;
      }
      const since = world.time - c.lastFired;
      const recoil = since < 0.45 ? 1 - since / 0.45 : 0;
      const s = c.broadside;
      const inner = c.local.y - s * (0.5 + recoil * 0.7);
      const outer = c.local.y + s * (2.1 - recoil * 0.7);
      const hw = 0.42;
      const img = this.barrels[i];
      if (img) {
        const mid = W({ x: c.local.x, y: (inner + outer) / 2 });
        img.setPosition(mid.x, mid.y).setRotation(heading + (s * Math.PI) / 2);
        img.setDisplaySize(Math.abs(outer - inner), hw * 2).setAlpha(alpha).setTint(online ? 0xffffff : 0x8a8580);
        return;
      }
      const corners = [
        { x: c.local.x - hw, y: inner },
        { x: c.local.x + hw, y: inner },
        { x: c.local.x + hw * 0.85, y: outer },
        { x: c.local.x - hw * 0.85, y: outer },
      ].map(W);
      g.fillStyle(online ? 0x1f2225 : 0x6d6862, alpha);
      g.fillPoints(corners, true);
      g.lineStyle(0.18, online ? 0x000000 : 0x3a3633, alpha);
      g.strokePoints(corners, true);
    });
  }
}

function puddleSpots(poly: readonly Vec[], seed: string): { p: Vec; r: number }[] {
  const b = polygonBounds(poly);
  const rng = new Rng(seed.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const size = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  const out: { p: Vec; r: number }[] = [];
  for (let tries = 0; tries < 200 && out.length < 5; tries++) {
    const p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
    if (!pointInPolygon(p, poly)) continue;
    out.push({ p, r: size * rng.range(0.22, 0.34) });
  }
  return out;
}

export function lerpColor(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

function multiplyColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
