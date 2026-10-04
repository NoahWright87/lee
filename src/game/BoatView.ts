// Draws one boat into the world: part sprites, crack overlays, deck water,
// its equipment (every gun type its own barrel, station markers, plating,
// rail items, floor upgrades), blown-out tiles, and hit flashes. Drawn in
// world space, so both views show it. Reads Boat state; never writes it.

import Phaser from 'phaser';
import { FACING_ANGLE } from '../config/slots';
import { gunOnline, structureFraction, type Boat, type GunState } from '../sim/boat';
import type { Tile } from '../sim/grid';
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
      for (let i = 0; i < boat.guns.length; i++) {
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

    this.drawEquipment(g, W, alpha);

    // Guns: each type its own barrel, pointing the way its slot faces; recoil after a shot.
    boat.guns.forEach((c, i) => this.drawGun(world, g, W, c, i, heading, alpha));
  }

  /** Floors, plating, stations, rails and blown-out tiles. */
  private drawEquipment(g: Phaser.GameObjects.Graphics, W: (p: Vec) => Vec, alpha: number): void {
    const boat = this.boat;
    // Plating: a thick iron rim around its part.
    boat.parts.forEach((part) => {
      if (part.layers.length < 2) return;
      const armor = part.layers[0];
      g.lineStyle(0.45, 0x8e979f, (armor.hp > 0 ? 0.95 : 0.35) * alpha);
      g.strokePoints(part.def.polygon.map(W), true);
    });
    for (const tile of boat.grid.tiles) {
      const q = (x0: number, y0: number, x1: number, y1: number) => [W({ x: x0, y: y0 }), W({ x: x1, y: y0 }), W({ x: x1, y: y1 }), W({ x: x0, y: y1 })];
      if (tile.floor === 'reinforcedPlanks') {
        g.fillStyle(0x6b4a2a, 0.35 * alpha);
        g.fillPoints(q(tile.x0 + 0.15, tile.y0 + 0.15, tile.x1 - 0.15, tile.y1 - 0.15), true);
        g.lineStyle(0.12, 0x3a2614, 0.6 * alpha);
        for (let x = tile.x0 + 0.6; x < tile.x1 - 0.3; x += 0.8) {
          const a = W({ x, y: tile.y0 + 0.2 });
          const b = W({ x, y: tile.y1 - 0.2 });
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      } else if (tile.floor === 'grippy') {
        g.fillStyle(0x2a2a2a, 0.45 * alpha);
        for (let x = tile.x0 + 0.5; x < tile.x1 - 0.2; x += 0.7) {
          for (let y = tile.y0 + 0.5; y < tile.y1 - 0.2; y += 0.7) {
            const p = W({ x, y });
            g.fillCircle(p.x, p.y, 0.09);
          }
        }
      }
      if (tile.blown) {
        const c = W(tile.center);
        g.fillStyle(0x1a1008, 0.75 * alpha);
        g.fillCircle(c.x, c.y, Math.min(tile.x1 - tile.x0, tile.y1 - tile.y0) * 0.42);
        g.fillStyle(0x3a2412, 0.6 * alpha);
        g.fillCircle(c.x + 0.3, c.y - 0.2, Math.min(tile.x1 - tile.x0, tile.y1 - tile.y0) * 0.22);
      }
      this.drawStation(g, W, tile, alpha);
      for (const r of tile.rails) this.drawRail(g, W, tile, r.kind, r.facing, r.destroyed, alpha);
    }
  }

  /** A small marker for a station's module (the strip adds its icon on top). */
  private drawStation(g: Phaser.GameObjects.Graphics, W: (p: Vec) => Vec, tile: Tile, alpha: number): void {
    const st = tile.station;
    if (!st || st === 'gun') return;
    const dead = tile.fixture?.destroyed;
    const c = tile.center;
    const ink = dead ? 0x6d6862 : 0x2b1a0e;
    switch (st) {
      case 'oars': {
        // Two oar shafts sticking out past the rail on the slot's side.
        const f = tile.edges.find((e) => e === 'port' || e === 'starboard') ?? tile.edges[0] ?? 'port';
        const a = FACING_ANGLE[f];
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        for (const off of [-0.9, 0.9]) {
          const from = W({ x: c.x + off - dx * 0.6, y: c.y - dy * 0.6 });
          const to = W({ x: c.x + off * 1.6 + dx * 3.2, y: c.y + dy * 3.2 });
          g.lineStyle(0.22, dead ? 0x6d6862 : 0x7a5530, alpha);
          g.lineBetween(from.x, from.y, to.x, to.y);
        }
        break;
      }
      case 'sails': {
        const m = W(c);
        g.fillStyle(0xe8dcc0, 0.85 * alpha);
        g.fillPoints([W({ x: c.x + 0.2, y: c.y - 1.3 }), W({ x: c.x + 1.4, y: c.y }), W({ x: c.x + 0.2, y: c.y + 1.3 })], true);
        g.fillStyle(ink, alpha);
        g.fillCircle(m.x, m.y, 0.35);
        break;
      }
      case 'lookout': {
        const m = W(c);
        g.lineStyle(0.18, ink, alpha);
        g.strokeCircle(m.x, m.y, 0.75);
        g.fillStyle(ink, alpha);
        g.fillCircle(m.x, m.y, 0.25);
        break;
      }
      case 'pump': {
        const m = W(c);
        g.fillStyle(dead ? 0x6d6862 : 0x355d7a, alpha);
        g.fillRect(m.x - 0.45, m.y - 0.45, 0.9, 0.9);
        break;
      }
      case 'hooks': {
        const f = tile.edges[0] ?? 'port';
        const a = FACING_ANGLE[f];
        const tip = W({ x: c.x + Math.cos(a) * 1.4, y: c.y + Math.sin(a) * 1.4 });
        const m = W(c);
        g.lineStyle(0.16, ink, alpha);
        g.lineBetween(m.x, m.y, tip.x, tip.y);
        g.strokeCircle(tip.x, tip.y, 0.3);
        break;
      }
      case 'powder': {
        const m = W(c);
        g.fillStyle(dead ? 0x3a2a20 : 0xa0302a, alpha);
        g.fillCircle(m.x, m.y, 0.7);
        g.lineStyle(0.14, 0x1a0e06, alpha);
        g.strokeCircle(m.x, m.y, 0.7);
        g.lineBetween(m.x - 0.7, m.y, m.x + 0.7, m.y);
        break;
      }
      default:
        break;
    }
  }

  /** A rail item along the outer edge of its tile. */
  private drawRail(g: Phaser.GameObjects.Graphics, W: (p: Vec) => Vec, tile: Tile, kind: string, facing: keyof typeof FACING_ANGLE, destroyed: boolean, alpha: number): void {
    // The edge segment: along the tile's side that faces `facing`.
    const a = FACING_ANGLE[facing];
    const nx = Math.round(Math.cos(a));
    const ny = Math.round(Math.sin(a));
    const ex = nx > 0 ? tile.x1 : nx < 0 ? tile.x0 : 0;
    const ey = ny > 0 ? tile.y1 : ny < 0 ? tile.y0 : 0;
    const p0 = nx !== 0 ? { x: ex, y: tile.y0 + 0.2 } : { x: tile.x0 + 0.2, y: ey };
    const p1 = nx !== 0 ? { x: ex, y: tile.y1 - 0.2 } : { x: tile.x1 - 0.2, y: ey };
    const n = 5;
    if (kind === 'spikes') {
      g.fillStyle(destroyed ? 0x5a5550 : 0xb8bec4, alpha);
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const b0 = { x: p0.x + (p1.x - p0.x) * t0, y: p0.y + (p1.y - p0.y) * t0 };
        const b1 = { x: p0.x + (p1.x - p0.x) * t1, y: p0.y + (p1.y - p0.y) * t1 };
        const tip = { x: (b0.x + b1.x) / 2 + nx * 0.9, y: (b0.y + b1.y) / 2 + ny * 0.9 };
        const pts = [W(b0), W(tip), W(b1)];
        g.fillTriangle(pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y);
      }
    } else if (kind === 'fence') {
      if (destroyed) return;
      const a0 = W({ x: p0.x - nx * 0.3, y: p0.y - ny * 0.3 });
      const a1 = W({ x: p1.x - nx * 0.3, y: p1.y - ny * 0.3 });
      g.lineStyle(0.3, 0x8a6a3a, alpha);
      g.lineBetween(a0.x, a0.y, a1.x, a1.y);
      g.fillStyle(0x5a3a1a, alpha);
      for (let i = 0; i <= n; i++) {
        const p = W({ x: p0.x + (p1.x - p0.x) * (i / n) - nx * 0.3, y: p0.y + (p1.y - p0.y) * (i / n) - ny * 0.3 });
        g.fillCircle(p.x, p.y, 0.2);
      }
    } else if (kind === 'planks') {
      const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const along = { x: (p1.x - p0.x) / 2, y: (p1.y - p0.y) / 2 };
      const half = Math.hypot(along.x, along.y) || 1;
      const ax = (along.x / half) * 0.5;
      const ay = (along.y / half) * 0.5;
      const pts = [
        W({ x: m.x - ax, y: m.y - ay }),
        W({ x: m.x + ax, y: m.y + ay }),
        W({ x: m.x + ax + nx * 1.8, y: m.y + ay + ny * 1.8 }),
        W({ x: m.x - ax + nx * 1.8, y: m.y - ay + ny * 1.8 }),
      ];
      g.fillStyle(destroyed ? 0x5a5550 : 0xb08a58, alpha);
      g.fillPoints(pts, true);
    }
  }

  /** One gun, drawn by type: the shape of its barrel says what it is. */
  private drawGun(world: World, g: Phaser.GameObjects.Graphics, W: (p: Vec) => Vec, c: GunState, i: number, heading: number, alpha: number): void {
    const boat = this.boat;
    const online = gunOnline(boat, c, world.tuning);
    // Turret guns that fire all the way around point at the nearest target.
    let face = c.face;
    if (c.item === 'swivel') {
      const muzzle = toWorld(c.local, boat.motion, boat.motion.heading);
      let best = Infinity;
      for (const t of world.gunTargets(boat)) {
        const d = Math.hypot(t.motion.x - muzzle.x, t.motion.y - muzzle.y);
        if (d < best) {
          best = d;
          face = Math.atan2(t.motion.y - muzzle.y, t.motion.x - muzzle.x) - boat.motion.heading;
        }
      }
    }
    const dx = Math.cos(face);
    const dy = Math.sin(face);
    const px = -dy;
    const py = dx;
    const since = world.time - c.lastFired;
    const recoil = since < 0.45 ? 1 - since / 0.45 : 0;
    const at = (along: number, across: number) => W({ x: c.local.x + dx * along + px * across, y: c.local.y + dy * along + py * across });
    const dim = 0x6d6862;
    if (c.item === 'gatling') {
      this.barrels[i]?.setVisible(false);
      const shiver = since < 0.25 ? Math.sin(world.time * 90) * 0.12 : 0;
      for (const off of [-0.3, 0, 0.3]) {
        const a = at(-1.6, off + shiver);
        const b = at(0.3, off * 0.6 + shiver);
        g.lineStyle(0.22, online ? 0x2a2d31 : dim, alpha);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      const hub = at(-1.7, 0);
      g.fillStyle(online ? 0x3a3f45 : dim, alpha);
      g.fillCircle(hub.x, hub.y, 0.45);
      return;
    }
    if (c.item === 'mortar') {
      this.barrels[i]?.setVisible(false);
      const m = W(c.local);
      g.fillStyle(online ? 0x2a2a2a : dim, alpha);
      g.fillCircle(m.x, m.y, 0.95 - recoil * 0.15);
      g.fillStyle(0x0a0a0a, alpha);
      g.fillCircle(m.x, m.y, 0.5);
      // A tick showing which half it covers.
      const tip = at(1.3, 0);
      g.lineStyle(0.18, online ? 0x2a2a2a : dim, alpha);
      g.lineBetween(m.x, m.y, tip.x, tip.y);
      return;
    }
    // Barrel guns: [length, breech half-width, muzzle half-width, color].
    const shape: Record<string, [number, number, number, number]> = {
      cannon: [2.6, 0.42, 0.36, 0x1f2225],
      longGun: [3.8, 0.3, 0.24, 0x23364a],
      carronade: [1.8, 0.62, 0.55, 0x3a2416],
      swivel: [1.5, 0.2, 0.18, 0x5a524a],
      scrap: [2.4, 0.32, 0.72, 0x4a3a28],
    };
    const [len, wBack, wFront, color] = shape[c.item] ?? shape.cannon;
    const outer = 0.2 - recoil * 0.7;
    const inner = outer - len;
    const img = this.barrels[i];
    if (img && c.item === 'cannon') {
      const mid = at((inner + outer) / 2, 0);
      img.setVisible(true).setPosition(mid.x, mid.y).setRotation(heading + face);
      img.setDisplaySize(len, wBack * 2).setAlpha(alpha).setTint(online ? 0xffffff : 0x8a8580);
      return;
    }
    img?.setVisible(false);
    const corners = [at(inner, -wBack), at(outer, -wFront), at(outer, wFront), at(inner, wBack)];
    g.fillStyle(online ? color : dim, alpha);
    g.fillPoints(corners, true);
    g.lineStyle(0.16, online ? 0x000000 : 0x3a3633, alpha);
    g.strokePoints(corners, true);
    if (c.item === 'swivel') {
      const post = W(c.local);
      g.fillStyle(online ? 0x3a332c : dim, alpha);
      g.fillCircle(post.x, post.y, 0.4);
    }
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
