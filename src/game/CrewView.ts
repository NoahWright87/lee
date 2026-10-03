// Draws one boat's crew and stations in the close-up strip: station icons
// (dim when empty), Lees with a task icon and a progress bar over their heads,
// a ghost marker on the home tile of anyone away, and a line to where a
// walking Lee is headed. Reads world state; never writes it.

import Phaser from 'phaser';
import { cannonOnline, isWrecked, type Boat } from '../sim/boat';
import { activity, isWet, type Lee } from '../sim/crew';
import { clamp, toWorld, type Vec } from '../sim/math';
import type { World } from '../sim/world';
import { STATION_ICON } from '../ui/crewArt';
import { leeTextureKey } from './textures';

const FIG_W = 1.25;
const FIG_H = 2.05;
const LOST_ANIM = 1.1;

const COLOR = {
  ink: 0xf6e7c1,
  dark: 0x10233a,
  barBg: 0x1a1a1a,
  bar: 0xf6e7c1,
  barGun: 0xffd27a,
  barRepair: 0xff9b5a,
  claim: 0xf6e7c1,
  offline: 0x8a8580,
  wet: 0x3a9cf0,
};

interface LeeSprites {
  fig: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  ghost: Phaser.GameObjects.Image;
  splashed: boolean;
}

export class CrewView {
  readonly boat: Boat;
  private stationIcons = new Map<number, Phaser.GameObjects.Image>();
  private lees = new Map<number, LeeSprites>();
  private objects: Phaser.GameObjects.GameObject[] = [];
  /** World points where a lost Lee hit the water this frame (the scene splashes them). */
  splashes: Vec[] = [];

  constructor(scene: Phaser.Scene, boat: Boat) {
    this.boat = boat;
    for (const tile of boat.grid.tiles) {
      if (!tile.station) continue;
      const img = scene.add.image(0, 0, `icon:${STATION_ICON[tile.station]}`).setDepth(14).setDisplaySize(1.25, 1.25);
      this.stationIcons.set(tile.index, img);
      this.objects.push(img);
    }
    for (const lee of boat.crew.lees) {
      const ghost = scene.add.image(0, 0, 'lee:ghost').setDepth(13).setDisplaySize(FIG_W, FIG_H).setAlpha(0.4);
      const fig = scene.add.image(0, 0, leeTextureKey(scene, lee.def.id)).setDepth(16).setDisplaySize(FIG_W, FIG_H);
      const icon = scene.add.image(0, 0, 'icon:idle').setDepth(17).setDisplaySize(1.1, 1.1);
      this.lees.set(lee.id, { fig, icon, ghost, splashed: false });
      this.objects.push(ghost, fig, icon);
    }
  }

  all(): Phaser.GameObjects.GameObject[] {
    return this.objects;
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }

  update(world: World, g: Phaser.GameObjects.Graphics, px: (n: number) => number, visible: boolean, clock: number, debug: boolean): void {
    const boat = this.boat;
    const m = boat.motion;
    const sink = world.sinkAnim(boat);
    const roll = 1 - 0.35 * sink;
    const alpha = 1 - sink;
    const show = visible && alpha > 0.01;
    const W = (p: Vec) => toWorld({ x: p.x, y: p.y * roll }, m, m.heading);
    const t = world.tuning;
    this.splashes = [];

    for (const o of this.objects) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(show);
    if (!show) return;

    const tiles = boat.grid.tiles;
    const quad = (x0: number, y0: number, x1: number, y1: number) => [W({ x: x0, y: y0 }), W({ x: x1, y: y0 }), W({ x: x1, y: y1 }), W({ x: x0, y: y1 })];

    // Faint tile outlines so the grid stays legible without competing with the boat.
    g.lineStyle(px(1), COLOR.ink, 0.12 * alpha);
    for (const tile of tiles) g.strokePoints(quad(tile.x0 + 0.08, tile.y0 + 0.08, tile.x1 - 0.08, tile.y1 - 0.08), true);

    // Stations: icon in the corner; an empty station is dim with an empty ring where its Lee would stand.
    for (const [index, img] of this.stationIcons) {
      const tile = tiles[index];
      const at = W({ x: tile.center.x - 1.25, y: tile.center.y + 0.95 });
      const worker = boat.crew.lees.find((l) => l.alive && l.working && l.task.type === 'station' && l.task.target === index);
      const cannon = boat.cannons.find((c) => c.station === index);
      const part = boat.parts[tile.part];
      const offline = cannon ? !cannonOnline(boat, cannon, t) : isWrecked(part);
      img.setPosition(at.x, at.y).setRotation(m.heading).setAlpha((worker ? 1 : 0.45) * alpha);
      img.setTint(offline ? COLOR.offline : 0xffffff);
      if (worker) continue;
      const c = W(tile.center);
      const r = 0.62;
      if (offline) {
        g.lineStyle(px(2), COLOR.offline, 0.9 * alpha);
        g.strokeCircle(c.x, c.y, r);
        const a = W({ x: tile.center.x - r * 0.7, y: tile.center.y + r * 0.7 });
        const b = W({ x: tile.center.x + r * 0.7, y: tile.center.y - r * 0.7 });
        g.lineBetween(a.x, a.y, b.x, b.y);
        continue;
      }
      g.lineStyle(px(2), COLOR.ink, 0.35 * alpha);
      g.strokeCircle(c.x, c.y, r);
      if (cannon && cannon.load > 0) {
        // A gun left loaded keeps its shot.
        g.lineStyle(px(2), COLOR.barGun, 0.45 * alpha);
        g.beginPath();
        g.arc(c.x, c.y, r, m.heading - Math.PI / 2, m.heading - Math.PI / 2 + Math.PI * 2 * cannon.load, false);
        g.strokePath();
      }
    }

    // Spread Lees sharing a tile so helpers don't stack exactly.
    const offsets = new Map<number, number>();
    const byTile = new Map<string, Lee[]>();
    for (const lee of boat.crew.lees) {
      if (!lee.alive) continue;
      const k = `${Math.round(lee.pos.x * 2)},${Math.round(lee.pos.y * 2)}`;
      if (!byTile.has(k)) byTile.set(k, []);
      byTile.get(k)!.push(lee);
    }
    for (const group of byTile.values()) group.forEach((l, i) => offsets.set(l.id, (i - (group.length - 1) / 2) * 0.75));

    for (const lee of boat.crew.lees) {
      const s = this.lees.get(lee.id);
      if (!s) continue;
      if (!lee.alive) {
        this.drawLost(lee, s, W, alpha, world.time);
        continue;
      }
      const dx = offsets.get(lee.id) ?? 0;
      const p = { x: lee.pos.x + dx, y: lee.pos.y };
      const act = activity(lee, boat);
      const home = tiles[lee.home].center;
      const away = Math.hypot(lee.pos.x - home.x, lee.pos.y - home.y) > 0.6;

      // Ghost marker on the home tile while away.
      const gh = W(home);
      s.ghost.setVisible(away).setPosition(gh.x, gh.y).setRotation(m.heading).setAlpha(0.38 * alpha);

      // Claim: a line to where it's headed and a highlighted destination.
      if (!lee.working) {
        const dest = tiles[lee.dest];
        const a = W(p);
        const b = W(dest.center);
        g.lineStyle(px(1.5), COLOR.claim, 0.55 * alpha);
        dashed(g, a, b, px(5), px(4));
        g.lineStyle(px(2), COLOR.claim, 0.6 * alpha);
        g.strokePoints(quad(dest.x0 + 0.25, dest.y0 + 0.25, dest.x1 - 0.25, dest.y1 - 0.25), true);
      }

      // Wading.
      if (isWet(lee, boat, t)) {
        const f = W({ x: p.x, y: p.y + FIG_H * 0.45 });
        const wob = 1 + 0.08 * Math.sin(clock * 5 + lee.id);
        g.fillStyle(COLOR.wet, 0.75 * alpha);
        g.fillEllipse(f.x, f.y, 1.3 * wob, 0.5 * wob);
      }

      // The Lee: wiggles while it works, flashes when hurt.
      const busy = lee.working && act !== 'idle';
      const wiggle = busy ? Math.sin(clock * 16 + lee.id * 1.7) * 0.08 : 0;
      const bob = act === 'walk' ? Math.abs(Math.sin(clock * 10 + lee.id)) * 0.12 : 0;
      const fp = W({ x: p.x, y: p.y - bob });
      s.fig.setPosition(fp.x, fp.y).setRotation(m.heading + wiggle).setAlpha(alpha);
      if (world.time - lee.hurtAt < 0.25) s.fig.setTintFill(0xff5040);
      else s.fig.clearTint();

      // Task icon over its head, and a bar only where the work has real progress:
      // a gun loading, a part being patched up to its ceiling, water being bailed
      // down. Oars, sails and the lookout are steady effects, so no bar.
      const x0 = p.x - 0.32;
      const x1 = p.x + 0.95;
      const y0 = p.y - 1.55;
      const y1 = y0 + 0.3;
      let bar: { frac: number; color: number } | null = null;
      if (lee.working) {
        if (act === 'gun') {
          const c = boat.cannons.find((x) => x.station === lee.task.target);
          if (c) bar = { frac: c.load, color: COLOR.barGun };
        } else if (act === 'repair') {
          const part = boat.parts[lee.task.target];
          const st = part.layers[part.layers.length - 1];
          bar = { frac: st.hp / Math.max(1e-6, st.maxHp * t.crew.repairCeiling), color: COLOR.barRepair };
        } else if (act === 'bail') {
          const part = boat.parts[lee.task.target];
          bar = { frac: part.capacity > 0 ? part.water / part.capacity : 0, color: COLOR.wet };
        }
      }
      const ip = W({ x: bar ? p.x - 0.85 : p.x, y: p.y - 1.4 });
      s.icon.setTexture(`icon:${act}`).setPosition(ip.x, ip.y).setRotation(m.heading).setAlpha(alpha);
      if (bar) {
        g.fillStyle(COLOR.barBg, 0.85 * alpha);
        g.fillPoints(quad(x0, y0, x1, y1), true);
        const f = clamp(bar.frac, 0, 1);
        if (f > 0) {
          g.fillStyle(bar.color, alpha);
          g.fillPoints(quad(x0, y0, x0 + (x1 - x0) * f, y1), true);
        }
      }
      // HP pip under the bar once hurt.
      if (lee.hp < lee.maxHp) {
        const f = clamp(lee.hp / lee.maxHp, 0, 1);
        g.fillStyle(0x000000, 0.7 * alpha);
        g.fillPoints(quad(x0, y1 + 0.04, x1, y1 + 0.16), true);
        g.fillStyle(f > 0.5 ? 0x5fd068 : f > 0.25 ? 0xf2c14e : 0xe8613c, alpha);
        g.fillPoints(quad(x0, y1 + 0.04, x0 + (x1 - x0) * f, y1 + 0.16), true);
      }

      if (debug && lee.path.length) {
        g.lineStyle(px(1.5), 0x40e0ff, 0.9);
        let a = W(p);
        for (const ti of lee.path) {
          const b = W(tiles[ti].center);
          g.lineBetween(a.x, a.y, b.x, b.y);
          a = b;
        }
      }
    }
  }

  /** Fall overboard: slide to the near rail, tumble, splash. */
  private drawLost(lee: Lee, s: LeeSprites, W: (p: Vec) => Vec, alpha: number, time: number): void {
    s.ghost.setVisible(false);
    s.icon.setVisible(false);
    const k = lee.lostAt === null ? 1 : (time - lee.lostAt) / LOST_ANIM;
    if (k >= 1) {
      s.fig.setVisible(false);
      return;
    }
    const side = lee.pos.y >= 0 ? 1 : -1;
    const out = { x: lee.pos.x, y: lee.pos.y + side * (6.5 - Math.abs(lee.pos.y)) * Math.min(1, k * 1.4) };
    const p = W(out);
    s.fig.setVisible(true).setPosition(p.x, p.y).setRotation(this.boat.motion.heading + side * k * 4).setAlpha(alpha * (1 - k));
    s.fig.setTintFill(0xffb0a0);
    if (!s.splashed && k > 0.7) {
      s.splashed = true;
      this.splashes.push(p);
    }
  }
}

function dashed(g: Phaser.GameObjects.Graphics, a: Vec, b: Vec, dash: number, gap: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.lineBetween(a.x + ux * d, a.y + uy * d, a.x + ux * e, a.y + uy * e);
  }
}
