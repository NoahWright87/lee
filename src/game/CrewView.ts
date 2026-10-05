// Draws crews and stations in the close-up strip, for every deck it's shown
// (your boat, plus any boat attached to it): station icons (dim when empty),
// Lees of both sides (enemies in a different shirt), a task icon and a
// progress bar over their heads, a ghost on the home tile of any of yours who
// are away, a line to where a walking Lee is headed, swings as an arc across
// the gap, and sword fights as a shared wiggle. Reads world state; never writes it.

import Phaser from 'phaser';
import { gunOnline, isWrecked, type Boat } from '../sim/boat';
import { leeWorldPos } from '../sim/combat';
import { activity, isWet, type Lee } from '../sim/crew';
import { clamp, toWorld, type Vec } from '../sim/math';
import type { World } from '../sim/world';
import { gunIcon, STATION_ICON } from '../ui/crewArt';
import { leeTextureKey } from './textures';

const FIG_W = 1.25;
const FIG_H = 2.05;
const LOST_ANIM = 1.1;
/** Seconds the pistol icon shows after a shot. */
const PISTOL_ICON = 0.45;

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
  private scene: Phaser.Scene;
  private stationIcons = new Map<string, Phaser.GameObjects.Image>();
  private lees = new Map<number, LeeSprites>();
  private objects: Phaser.GameObjects.GameObject[] = [];
  /** Called with each new game object (the scene hides it from the ocean camera). */
  private onCreate: (o: Phaser.GameObjects.GameObject) => void;
  /** World points where a lost Lee hit the water this frame (the scene splashes them). */
  splashes: Vec[] = [];

  constructor(scene: Phaser.Scene, onCreate: (o: Phaser.GameObjects.GameObject) => void) {
    this.scene = scene;
    this.onCreate = onCreate;
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    this.onCreate(o);
    return o;
  }

  private stationIcon(boat: Boat, index: number, icon: string): Phaser.GameObjects.Image {
    const key = `${boat.id}:${index}`;
    let img = this.stationIcons.get(key);
    if (!img) {
      img = this.add(this.scene.add.image(0, 0, `icon:${icon}`).setDepth(14).setDisplaySize(1.25, 1.25));
      this.stationIcons.set(key, img);
    }
    return img;
  }

  private sprites(lee: Lee): LeeSprites {
    let s = this.lees.get(lee.id);
    if (!s) {
      const ghost = this.add(this.scene.add.image(0, 0, 'lee:ghost').setDepth(13).setDisplaySize(FIG_W, FIG_H).setAlpha(0.4));
      const fig = this.add(this.scene.add.image(0, 0, leeTextureKey(this.scene, lee.def.id, lee.side)).setDepth(16).setDisplaySize(FIG_W, FIG_H));
      const icon = this.add(this.scene.add.image(0, 0, 'icon:idle').setDepth(17).setDisplaySize(1.1, 1.1));
      s = { fig, icon, ghost, splashed: false };
      this.lees.set(lee.id, s);
    }
    return s;
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.stationIcons.clear();
    this.lees.clear();
  }

  /**
   * Draw `decks` (yours first). `up` is the strip's screen-up direction in world
   * terms and `facing` the strip camera's heading (figures and icons stay upright).
   */
  update(
    world: World,
    g: Phaser.GameObjects.Graphics,
    px: (n: number) => number,
    decks: Boat[],
    visible: boolean,
    clock: number,
    debug: boolean,
    facing: number,
  ): void {
    const t = world.tuning;
    this.splashes = [];
    for (const o of this.objects) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    if (!visible) return;
    const shown = new Set(decks);
    const deckAlpha = (b: Boat) => 1 - world.sinkAnim(b);
    const W = (b: Boat, p: Vec) => {
      const roll = 1 - 0.35 * world.sinkAnim(b);
      return toWorld({ x: p.x, y: p.y * roll }, b.motion, b.motion.heading);
    };
    const quad = (b: Boat, x0: number, y0: number, x1: number, y1: number) => [W(b, { x: x0, y: y0 }), W(b, { x: x1, y: y0 }), W(b, { x: x1, y: y1 }), W(b, { x: x0, y: y1 })];
    const up = { x: Math.sin(facing), y: -Math.cos(facing) };
    const along = { x: Math.cos(facing), y: Math.sin(facing) };
    // Screen-aligned offset (dx right, dy down on screen) from a world point.
    const S = (p: Vec, dx: number, dy: number) => ({ x: p.x + along.x * dx - up.x * dy, y: p.y + along.y * dx - up.y * dy });
    const sq = (p: Vec, x0: number, y0: number, x1: number, y1: number) => [S(p, x0, y0), S(p, x1, y0), S(p, x1, y1), S(p, x0, y1)];

    for (const boat of decks) {
      const alpha = deckAlpha(boat);
      if (alpha <= 0.01) continue;
      const tiles = boat.grid.tiles;
      // Faint tile outlines so the grid stays legible without competing with the boat.
      g.lineStyle(px(1), COLOR.ink, 0.12 * alpha);
      for (const tile of tiles) g.strokePoints(quad(boat, tile.x0 + 0.08, tile.y0 + 0.08, tile.x1 - 0.08, tile.y1 - 0.08), true);

      // Stations: icon in the corner; an empty station is dim with an empty ring where its Lee would stand.
      for (const tile of tiles) {
        if (!tile.station) continue;
        const img = this.stationIcon(boat, tile.index, tile.station === 'gun' ? gunIcon(tile.fixture?.item) : STATION_ICON[tile.station]);
        const c = W(boat, tile.center);
        const at = S(c, -1.25, 0.95);
        const worker = boat.crew.lees.find((l) => l.alive && l.working && !l.engaged && l.deck === boat && l.task.type === 'station' && l.task.target === tile.index);
        const cannon = boat.guns.find((x) => x.station === tile.index);
        const part = boat.parts[tile.part];
        const offline = cannon ? !gunOnline(boat, cannon, t) : isWrecked(part) || !!tile.fixture?.destroyed;
        img.setVisible(true).setPosition(at.x, at.y).setRotation(facing).setAlpha((worker ? 1 : 0.45) * alpha);
        img.setTint(offline ? COLOR.offline : 0xffffff);
        if (worker) continue;
        const r = 0.62;
        if (offline) {
          g.lineStyle(px(2), COLOR.offline, 0.9 * alpha);
          g.strokeCircle(c.x, c.y, r);
          const a = S(c, -r * 0.7, r * 0.7);
          const b = S(c, r * 0.7, -r * 0.7);
          g.lineBetween(a.x, a.y, b.x, b.y);
          continue;
        }
        g.lineStyle(px(2), COLOR.ink, 0.35 * alpha);
        g.strokeCircle(c.x, c.y, r);
        if (cannon && cannon.load > 0) {
          // A gun left loaded keeps its shot.
          g.lineStyle(px(2), COLOR.barGun, 0.45 * alpha);
          g.beginPath();
          g.arc(c.x, c.y, r, facing - Math.PI / 2, facing - Math.PI / 2 + Math.PI * 2 * cannon.load, false);
          g.strokePath();
        }
      }
    }

    // Who to draw: everyone standing on a shown deck, swinging to or from one, or just lost from one.
    const all = world.allLees();
    const drawn = all.filter((l) => {
      if (l.swing) return shown.has(l.swing.from) || shown.has(l.swing.to);
      if (!shown.has(l.deck)) return false;
      return l.alive || (l.lostAt !== null && world.time - l.lostAt < LOST_ANIM);
    });

    // Spread Lees sharing a tile (up to three a row) so helpers and fighters don't stack; opponents face off.
    const offsets = new Map<number, Vec>();
    const byTile = new Map<string, Lee[]>();
    for (const lee of drawn) {
      if (!lee.alive || lee.swing) continue;
      const k = `${lee.deck.id}:${Math.round(lee.pos.x * 2)},${Math.round(lee.pos.y * 2)}`;
      if (!byTile.has(k)) byTile.set(k, []);
      byTile.get(k)!.push(lee);
    }
    for (const group of byTile.values()) {
      // Friends on the left, foes on the right (by side), stable by id.
      group.sort((a, b) => (a.side === b.side ? a.id - b.id : a.side === 'player' ? -1 : 1));
      const cols = Math.min(group.length, 3);
      const rows = Math.ceil(group.length / cols);
      const gap = group.length > 1 ? 1.0 : 0;
      group.forEach((l, i) => offsets.set(l.id, { x: ((i % cols) - (cols - 1) / 2) * gap, y: (Math.floor(i / cols) - (rows - 1) / 2) * 0.95 }));
    }

    for (const lee of drawn) {
      const s = this.sprites(lee);
      const deck = lee.deck;
      const alpha = lee.swing ? 1 : deckAlpha(deck);
      if (!lee.alive) {
        this.drawLost(lee, s, (p) => W(deck, p), alpha, world.time, facing);
        continue;
      }
      const act = activity(lee);
      const friend = lee.side === 'player';

      // Ghost marker on the home tile while away (yours only).
      if (friend && shown.has(lee.boat)) {
        const home = lee.boat.grid.tiles[lee.home].center;
        const away = lee.swing || deck !== lee.boat || Math.hypot(lee.pos.x - home.x, lee.pos.y - home.y) > 0.6;
        if (away) {
          const gh = W(lee.boat, home);
          s.ghost.setVisible(true).setPosition(gh.x, gh.y).setRotation(facing).setAlpha(0.38 * deckAlpha(lee.boat));
        }
      }

      // Where the figure stands (world), and a hop arc while swinging.
      let base: Vec;
      let lift = 0;
      if (lee.swing) {
        base = leeWorldPos(lee);
        const k = clamp(lee.swing.t / lee.swing.dur, 0, 1);
        lift = 4 * 2.2 * k * (1 - k);
        // The rope: from above the midpoint of the gap.
        const a = toWorld(lee.swing.fromLocal, lee.swing.from.motion, lee.swing.from.motion.heading);
        const b = W(lee.swing.to, lee.swing.to.grid.tiles[lee.swing.toTile].center);
        const anchor = S({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0, -4.5);
        const hand = S(base, 0, -lift - 0.6);
        g.lineStyle(px(1.5), 0xd9c08a, 0.9);
        g.lineBetween(anchor.x, anchor.y, hand.x, hand.y);
        g.lineStyle(px(1), COLOR.claim, 0.4);
        dashed(g, a, b, px(4), px(4));
      } else {
        const o = offsets.get(lee.id) ?? { x: 0, y: 0 };
        base = S(W(deck, lee.pos), o.x, o.y);
      }

      // Claim: a line to where it's headed and a highlighted destination (your crew, on its own deck).
      if (!lee.swing && !lee.working && !lee.engaged && friend && deck === lee.boat && lee.task.type !== 'board') {
        const dest = deck.grid.tiles[lee.dest];
        const b = W(deck, dest.center);
        g.lineStyle(px(1.5), COLOR.claim, 0.55 * alpha);
        dashed(g, base, b, px(5), px(4));
        g.lineStyle(px(2), COLOR.claim, 0.6 * alpha);
        g.strokePoints(quad(deck, dest.x0 + 0.25, dest.y0 + 0.25, dest.x1 - 0.25, dest.y1 - 0.25), true);
      }

      const feet = S(base, 0, FIG_H * 0.45 - lift);

      // Wading.
      if (!lee.swing && isWet(lee, deck, t)) {
        const wob = 1 + 0.08 * Math.sin(clock * 5 + lee.id);
        g.fillStyle(COLOR.wet, 0.75 * alpha);
        g.fillEllipse(feet.x, feet.y, 1.3 * wob, 0.5 * wob);
      }

      // The Lee: wiggles while it works, lunges while it fights, flashes when hurt.
      const busy = lee.working && act !== 'idle';
      let wiggle = busy ? Math.sin(clock * 16 + lee.id * 1.7) * 0.08 : 0;
      let lunge = 0;
      if (lee.engaged) {
        // Both fighters share one rhythm so a fight reads as a fight.
        const beat = Math.sin(clock * 14 + (deck.id + lee.tile) * 2.1);
        wiggle = beat * 0.22;
        lunge = (friend ? 1 : -1) * Math.max(0, beat) * 0.25;
      }
      const bob = act === 'walk' || act === 'board' ? Math.abs(Math.sin(clock * 10 + lee.id)) * 0.12 : 0;
      const fp = S(base, lunge, -bob - lift);
      s.fig.setVisible(true).setPosition(fp.x, fp.y).setRotation(facing + wiggle).setAlpha(alpha);
      if (world.time - lee.hurtAt < 0.25) s.fig.setTintFill(0xff5040);
      else s.fig.clearTint();

      // Task icon over its head, and a bar only where the work has real progress.
      let bar: { frac: number; color: number } | null = null;
      if (lee.working && !lee.engaged && deck === lee.boat) {
        if (act === 'gun') {
          const c = deck.guns.find((x) => x.station === lee.task.target);
          if (c) bar = { frac: c.load, color: COLOR.barGun };
        } else if (act === 'repair') {
          const part = deck.parts[lee.task.target];
          const st = part.layers[part.layers.length - 1];
          bar = { frac: st.hp / Math.max(1e-6, st.maxHp * t.crew.repairCeiling), color: COLOR.barRepair };
        } else if (act === 'bail') {
          const part = deck.parts[lee.task.target];
          bar = { frac: part.capacity > 0 ? part.water / part.capacity : 0, color: COLOR.wet };
        }
      }
      const iconKind = lee.swing?.back ? 'recall' : !lee.engaged && world.time - lee.firedAt < PISTOL_ICON ? 'pistol' : act;
      const ip = S(base, bar ? -0.85 : 0, -1.4 - lift);
      s.icon.setVisible(true).setTexture(`icon:${iconKind}`).setPosition(ip.x, ip.y).setRotation(facing).setAlpha(alpha);
      const x0 = -0.32;
      const x1 = 0.95;
      const y0 = -1.55 - lift;
      const y1 = y0 + 0.3;
      if (bar) {
        g.fillStyle(COLOR.barBg, 0.85 * alpha);
        g.fillPoints(sq(base, x0, y0, x1, y1), true);
        const f = clamp(bar.frac, 0, 1);
        if (f > 0) {
          g.fillStyle(bar.color, alpha);
          g.fillPoints(sq(base, x0, y0, x0 + (x1 - x0) * f, y1), true);
        }
      }
      // Level: small pips under the feet (a bigger one per five levels).
      if (lee.level > 1) {
        const five = Math.floor((lee.level - 1) / 5);
        const ones = (lee.level - 1) % 5;
        const n = five + ones;
        for (let k = 0; k < n; k++) {
          const p = S(base, (k - (n - 1) / 2) * 0.32, FIG_H * 0.5 + 0.18 - lift);
          g.fillStyle(0x000000, 0.7 * alpha);
          g.fillCircle(p.x, p.y, k < five ? 0.17 : 0.12);
          g.fillStyle(friend ? 0xffe08a : 0xffa060, alpha);
          g.fillCircle(p.x, p.y, k < five ? 0.12 : 0.08);
        }
      }
      // HP pip under the bar once hurt.
      if (lee.hp < lee.maxHp) {
        const f = clamp(lee.hp / lee.maxHp, 0, 1);
        g.fillStyle(0x000000, 0.7 * alpha);
        g.fillPoints(sq(base, x0, y1 + 0.04, x1, y1 + 0.16), true);
        g.fillStyle(f > 0.5 ? 0x5fd068 : f > 0.25 ? 0xf2c14e : 0xe8613c, alpha);
        g.fillPoints(sq(base, x0, y1 + 0.04, x0 + (x1 - x0) * f, y1 + 0.16), true);
      }

      if (debug && lee.path.length && !lee.swing) {
        g.lineStyle(px(1.5), friend ? 0x40e0ff : 0xff9040, 0.9);
        let a = base;
        for (const ti of lee.path) {
          const b = W(deck, deck.grid.tiles[ti].center);
          g.lineBetween(a.x, a.y, b.x, b.y);
          a = b;
        }
      }
    }
  }

  /** Fall overboard: slide to the near rail, tumble, splash. */
  private drawLost(lee: Lee, s: LeeSprites, W: (p: Vec) => Vec, alpha: number, time: number, facing: number): void {
    const k = lee.lostAt === null ? 1 : (time - lee.lostAt) / LOST_ANIM;
    if (k >= 1) return;
    const beam = lee.deck.layout.beam / 2 + 1.5;
    const side = lee.pos.y >= 0 ? 1 : -1;
    const out = { x: lee.pos.x, y: lee.pos.y + side * (beam - Math.abs(lee.pos.y)) * Math.min(1, k * 1.4) };
    const p = W(out);
    s.fig.setVisible(true).setPosition(p.x, p.y).setRotation(facing + side * k * 4).setAlpha(alpha * (1 - k));
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
