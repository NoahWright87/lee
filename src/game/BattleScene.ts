// One scene, one world, two cameras:
//  - ocean camera (top ~75%): zoomed out, frames both boats, takes steering input
//  - strip camera (bottom ~25%): your boat, large, always bow-right
// Overlays that must stay a readable size on screen (HP pips, X markers, the
// path preview) are drawn per camera with sizes divided by that camera's zoom.

import Phaser from 'phaser';
import { SLOOP } from '../config/boats';
import {
  boatTuning,
  cannonOnline,
  motionParams,
  sinkProgress,
  structureFraction,
  type Boat,
} from '../sim/boat';
import { clamp, DEG, dist, lerp, rotate, toWorld, type Vec } from '../sim/math';
import { FIXED_DT, predictPath } from '../sim/steering';
import { TelegraphSystem } from '../sim/telegraph';
import type { World, WorldEvent } from '../sim/world';
import { BoatView, lerpColor } from './BoatView';
import type { Controller } from './Controller';
import {
  buildCrackTextures,
  buildParticleTextures,
  buildPartTextures,
  buildWaterTexture,
  preloadArt,
} from './textures';

/** Fraction of the screen height given to the ocean view. */
export const OCEAN_FRACTION = 0.75;
const WATER_TILE_M = 48;
/** Height of the HUD's top bar, CSS px. The ocean camera frames boats below it. */
const TOP_INSET_CSS = 52;

const COLOR = {
  threat: 0xff2b2b,
  threatDark: 0x3a0000,
  path: 0xf6e7c1,
  pathDark: 0x3b2a14,
  hpGood: 0x5fd068,
  hpMid: 0xf2c14e,
  hpBad: 0xe8613c,
  wrecked: 0x444444,
  water: 0x3a9cf0,
  reload: 0xf6e7c1,
  offline: 0x8a8580,
  debug: 0x40e0ff,
  enemyArrow: 0xffa040,
};

interface Ring {
  x: number;
  y: number;
  t: number;
  dur: number;
  r: number;
  color: number;
}

export class BattleScene extends Phaser.Scene {
  private ctl!: Controller;
  private dpr = 1;
  private oceanCam!: Phaser.Cameras.Scene2D.Camera;
  private stripCam!: Phaser.Cameras.Scene2D.Camera;
  private waterOcean!: Phaser.GameObjects.TileSprite;
  private waterStrip!: Phaser.GameObjects.TileSprite;
  private gOcean!: Phaser.GameObjects.Graphics;
  private gStrip!: Phaser.GameObjects.Graphics;
  private views: BoatView[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  private spray!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bubbles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private rings: Ring[] = [];
  private acc = 0;
  private runId = -1;
  private lastPhase = '';
  private cam = { x: 0, y: 0, zoom: 1 };
  private snapCamera = true;
  private pointerId: number | null = null;
  private pointerScreen: Vec | null = null;
  private clock = 0;

  constructor() {
    super('battle');
  }

  init(data: { controller: Controller }): void {
    this.ctl = data.controller;
  }

  preload(): void {
    preloadArt(this);
  }

  create(): void {
    this.dpr = this.game.registry.get('dpr') ?? 1;
    buildWaterTexture(this);
    buildParticleTextures(this);
    for (const side of ['player', 'enemy'] as const) buildPartTextures(this, SLOOP, side);
    buildCrackTextures(this, SLOOP);

    this.oceanCam = this.cameras.main;
    this.oceanCam.setBackgroundColor('#0d2c4d');
    this.stripCam = this.cameras.add(0, 0, 10, 10, false, 'strip');
    this.stripCam.setBackgroundColor('#0d2c4d');
    // World units are meters; pixel rounding would snap sprites to whole meters.
    this.oceanCam.setRoundPixels(false);
    this.stripCam.setRoundPixels(false);

    this.waterOcean = this.add.tileSprite(0, 0, 10, 10, 'water').setOrigin(0, 0).setDepth(0);
    this.waterStrip = this.add.tileSprite(0, 0, 10, 10, 'water').setOrigin(0, 0).setDepth(0);
    this.waterOcean.setTileScale(WATER_TILE_M / 256);
    this.waterStrip.setTileScale(WATER_TILE_M / 256);
    this.onlyOcean(this.waterOcean);
    this.onlyStrip(this.waterStrip);

    this.gOcean = this.add.graphics().setDepth(40);
    this.gStrip = this.add.graphics().setDepth(40);
    this.onlyOcean(this.gOcean);
    this.onlyStrip(this.gStrip);

    this.chips = this.add.particles(0, 0, 'chip', {
      emitting: false,
      speed: { min: 4, max: 14 },
      lifespan: { min: 350, max: 750 },
      scale: { start: 0.16, end: 0.08 },
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 },
    }).setDepth(30);
    this.spray = this.add.particles(0, 0, 'dot', {
      emitting: false,
      speed: { min: 2, max: 8 },
      lifespan: { min: 300, max: 600 },
      scale: { start: 0.09, end: 0.02 },
      alpha: { start: 0.9, end: 0 },
      tint: 0xd8f0ff,
    }).setDepth(30);
    this.smoke = this.add.particles(0, 0, 'dot', {
      emitting: false,
      speed: { min: 1, max: 4 },
      lifespan: { min: 500, max: 1000 },
      scale: { start: 0.12, end: 0.35 },
      alpha: { start: 0.55, end: 0 },
      tint: 0xbfbab0,
    }).setDepth(31);
    this.bubbles = this.add.particles(0, 0, 'dot', {
      emitting: false,
      speed: { min: 0.5, max: 3 },
      lifespan: { min: 600, max: 1400 },
      scale: { start: 0.05, end: 0.14 },
      alpha: { start: 0.8, end: 0 },
      tint: 0xe6f6ff,
    }).setDepth(9);

    this.setupInput();
    this.scale.on('resize', () => this.layout());
    this.layout();
  }

  private onlyOcean(o: Phaser.GameObjects.GameObject): void {
    this.stripCam.ignore(o);
  }

  private onlyStrip(o: Phaser.GameObjects.GameObject): void {
    this.oceanCam.ignore(o);
  }

  private get W(): number {
    return this.scale.width;
  }

  private get oceanH(): number {
    return Math.round(this.scale.height * OCEAN_FRACTION);
  }

  private layout(): void {
    const W = this.W;
    const H = this.scale.height;
    this.oceanCam.setViewport(0, 0, W, this.oceanH);
    this.stripCam.setViewport(0, this.oceanH, W, H - this.oceanH);
    this.snapCamera = true;
  }

  // ------------------------------------------------------------ input

  private setupInput(): void {
    const inOcean = (p: Phaser.Input.Pointer) => p.y < this.oceanH;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.pointerId !== null || !inOcean(p) || this.ctl.blocked) return;
      this.pointerId = p.id;
      this.pointerScreen = { x: p.x, y: p.y };
      this.aimAt(this.pointerScreen);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.pointerId) return;
      this.pointerScreen = { x: p.x, y: clamp(p.y, 0, this.oceanH) };
      this.aimAt(this.pointerScreen);
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.pointerId) return;
      this.pointerId = null;
      this.pointerScreen = null;
      this.ctl.world.player.target = null;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  private aimAt(screen: Vec): void {
    const w = this.oceanCam.getWorldPoint(screen.x, screen.y);
    this.ctl.world.player.target = { x: w.x, y: w.y };
  }

  // ------------------------------------------------------------ frame

  update(_time: number, deltaMs: number): void {
    const ctl = this.ctl;
    const world = ctl.world;
    if (this.runId !== ctl.runId) this.rebuild();

    const dt = Math.min(deltaMs / 1000, 0.1);
    this.clock += dt;
    if (!ctl.blocked && world.phase !== 'ready') {
      this.acc += dt * ctl.speed;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 12) {
        world.step(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
    }
    if (world.phase !== this.lastPhase) {
      this.lastPhase = world.phase;
      ctl.notify();
    }

    if (this.pointerScreen && ctl.tuning.input.targetFollowsCamera) this.aimAt(this.pointerScreen);
    if (this.pointerId === null && world.player.target) world.player.target = null;

    this.handleEvents(world.drainEvents());
    this.updateCameras(dt);
    for (const v of this.views) v.update(world, dt);
    this.emitSinkingBubbles(world);
    this.rings = this.rings.filter((r) => this.clock - r.t < r.dur);

    this.drawOcean(world);
    this.drawStrip(world);
    ctl.frame();
  }

  private rebuild(): void {
    this.runId = this.ctl.runId;
    for (const v of this.views) v.destroy();
    for (const t of this.labels) t.destroy();
    this.views = [];
    this.labels = [];
    this.rings = [];
    this.acc = 0;
    this.lastPhase = '';
    this.pointerId = null;
    this.pointerScreen = null;
    this.snapCamera = true;
    for (const e of [this.chips, this.spray, this.smoke, this.bubbles]) e.killAll();

    for (const boat of this.ctl.world.boats) {
      const view = new BoatView(this, boat);
      // The strip shows your boat only.
      if (boat.side !== 'player') for (const o of view.all()) this.onlyOcean(o);
      this.views.push(view);
    }
    for (const part of this.ctl.world.player.parts) {
      const t = this.add
        .text(0, 0, part.def.label.toUpperCase(), {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 5,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(45)
        .setAlpha(0.85);
      this.onlyStrip(t);
      this.labels.push(t);
    }
  }

  private viewFor(boatId: number): BoatView | undefined {
    return this.views.find((v) => v.boat.id === boatId);
  }

  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const dir = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x) / DEG;
          this.smoke.setEmitterAngle({ min: dir - 25, max: dir + 25 });
          this.smoke.explode(6, e.from.x, e.from.y);
          break;
        }
        case 'hit':
          this.chips.explode(14, e.pos.x, e.pos.y);
          this.viewFor(e.boatId)?.flashPart(e.part);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.35, r: 4, color: 0xffd28a });
          break;
        case 'splash':
          this.spray.explode(12, e.pos.x, e.pos.y);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.7, r: 5, color: 0xe0f4ff });
          break;
        case 'sinking': {
          const b = this.ctl.world.boats.find((x) => x.id === e.boatId);
          if (b) this.rings.push({ x: b.motion.x, y: b.motion.y, t: this.clock, dur: 2.5, r: 26, color: 0xe0f4ff });
          break;
        }
        default:
          break;
      }
    }
  }

  private emitSinkingBubbles(world: World): void {
    for (const b of world.boats) {
      if (b.sinkingSince === null) continue;
      const age = world.time - b.sinkingSince;
      if (age > world.tuning.global.sinkDuration + 1.5) continue;
      if (Math.random() < 0.6) {
        const p = toWorld(
          { x: (Math.random() - 0.5) * b.layout.length, y: (Math.random() - 0.5) * b.layout.beam },
          b.motion,
          b.motion.heading,
        );
        this.bubbles.explode(2, p.x, p.y);
      }
    }
  }

  // ------------------------------------------------------------ cameras

  private updateCameras(dt: number): void {
    const world = this.ctl.world;
    const t = this.ctl.tuning.camera;
    const p = world.player.motion;
    // Frame you plus every enemy still on the water (sinking ones until they're under).
    const others = world.enemies.filter((e) => world.sinkAnim(e) < 1).map((e) => e.motion);
    const focus = others.length ? others : world.enemies.map((e) => e.motion);
    const mean = focus.reduce((a, m) => ({ x: a.x + m.x / focus.length, y: a.y + m.y / focus.length }), { x: 0, y: 0 });
    const bias = clamp(t.enemyBias, 0, 1);
    const cx = lerp(p.x, mean.x, bias);
    const cy = lerp(p.y, mean.y, bias);
    const W = this.W;
    // Keep the top bar (buttons) clear: frame the boats in the area below it.
    const inset = TOP_INSET_CSS * this.dpr;
    const H = this.oceanH - inset;
    let dx = Math.abs(p.x - cx);
    let dy = Math.abs(p.y - cy);
    for (const m of others) {
      dx = Math.max(dx, Math.abs(m.x - cx));
      dy = Math.max(dy, Math.abs(m.y - cy));
    }
    const needH = Math.max(2 * (dy + t.padding), 2 * (dx + t.padding) * (H / W));
    const visH = clamp(needH, t.minVisibleHeight, Math.max(t.minVisibleHeight, t.maxVisibleHeight));
    const zoom = H / visH;
    if (this.snapCamera) {
      this.cam = { x: cx, y: cy, zoom };
      this.snapCamera = false;
    } else {
      const k = 1 - Math.exp(-Math.max(0.01, t.smoothing) * dt);
      this.cam.x += (cx - this.cam.x) * k;
      this.cam.y += (cy - this.cam.y) * k;
      this.cam.zoom = Math.exp(lerp(Math.log(this.cam.zoom), Math.log(zoom), k));
    }
    const shiftY = inset / 2 / this.cam.zoom;
    this.oceanCam.setZoom(this.cam.zoom);
    this.oceanCam.centerOn(this.cam.x, this.cam.y - shiftY);
    this.coverWithWater(this.waterOcean, this.cam.x, this.cam.y - shiftY, W / this.cam.zoom, this.oceanH / this.cam.zoom);

    // Strip: player boat, bow right, centered.
    const SH = this.scale.height - this.oceanH;
    const L = world.player.layout.length;
    const B = world.player.layout.beam;
    const sz = Math.min((W * clamp(t.stripBoatFill, 0.2, 1)) / L, (SH * 0.62) / B);
    this.stripCam.setZoom(sz);
    this.stripCam.setRotation(-p.heading);
    this.stripCam.centerOn(p.x, p.y);
    const diag = Math.hypot(W, SH) / sz;
    this.coverWithWater(this.waterStrip, p.x, p.y, diag, diag);
  }

  /** Position a world-anchored tiled water sprite to cover a view (snapped to the tile grid so waves stay put). */
  private coverWithWater(sprite: Phaser.GameObjects.TileSprite, cx: number, cy: number, w: number, h: number): void {
    const x0 = Math.floor((cx - w / 2) / WATER_TILE_M) * WATER_TILE_M - WATER_TILE_M;
    const y0 = Math.floor((cy - h / 2) / WATER_TILE_M) * WATER_TILE_M - WATER_TILE_M;
    const x1 = Math.ceil((cx + w / 2) / WATER_TILE_M) * WATER_TILE_M + WATER_TILE_M;
    const y1 = Math.ceil((cy + h / 2) / WATER_TILE_M) * WATER_TILE_M + WATER_TILE_M;
    sprite.setPosition(x0, y0);
    sprite.setSize(x1 - x0, y1 - y0);
    sprite.setTilePosition(0, 0);
  }

  // ------------------------------------------------------------ ocean overlay

  /** World units per screen CSS pixel for a camera. */
  private px(cam: Phaser.Cameras.Scene2D.Camera, cssPx: number): number {
    return (cssPx * this.dpr) / cam.zoom;
  }

  private drawOcean(world: World): void {
    const g = this.gOcean;
    const cam = this.oceanCam;
    const px = (n: number) => this.px(cam, n);
    g.clear();

    this.drawRings(g, px);
    if (this.ctl.debug) this.drawDebug(g, world, px);

    // Path preview (also before START).
    const player = world.player;
    if (this.pointerId !== null && player.target && player.sinkingSince === null) {
      const pts = predictPath(
        player.motion,
        player.target,
        motionParams(player, world.tuning),
        Math.max(0.5, world.tuning.global.previewHorizon),
      );
      this.drawMarchingPath(g, pts, px);
      g.lineStyle(px(2), COLOR.path, 0.7);
      g.strokeCircle(player.target.x, player.target.y, px(14));
      g.fillStyle(COLOR.path, 0.8);
      g.fillCircle(player.target.x, player.target.y, px(2.5));
    }

    // Shells in flight: ball above its shadow.
    const arcH = world.tuning.visuals.shellArcHeight;
    for (const s of world.shells) {
      const k = clamp(s.elapsed / s.flightTime, 0, 1);
      const gx = lerp(s.from.x, s.to.x, k);
      const gy = lerp(s.from.y, s.to.y, k);
      const h = 4 * arcH * k * (1 - k);
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(gx, gy, Math.max(0.5, px(2)));
      g.fillStyle(0x15171a, 1);
      g.fillCircle(gx, gy - h, Math.max(0.7, px(3)));
      g.fillStyle(0x9aa3ad, 1);
      g.fillCircle(gx - px(0.8), gy - h - px(0.8), Math.max(0.2, px(1)));
    }

    this.drawTelegraphs(g, world, px);

    for (const b of world.boats) {
      if (b.sinkingSince !== null && world.sinkAnim(b) >= 1) continue;
      if (world.tuning.visuals.oceanReloadRings) this.drawReloadRings(g, world, b, px, 3);
      this.drawBoatPips(g, world, b, px);
    }
    for (const e of world.enemies) this.drawEnemyArrow(g, e);
  }

  private drawRings(g: Phaser.GameObjects.Graphics, px: (n: number) => number): void {
    for (const r of this.rings) {
      const k = clamp((this.clock - r.t) / r.dur, 0, 1);
      g.lineStyle(Math.max(px(1.5), 0.15), r.color, (1 - k) * 0.9);
      g.strokeCircle(r.x, r.y, r.r * (0.3 + 0.7 * Math.sqrt(k)));
    }
  }

  /** Treasure-map route: marching dashes, fading toward the end. */
  private drawMarchingPath(g: Phaser.GameObjects.Graphics, pts: Vec[], px: (n: number) => number): void {
    const dash = px(12);
    const gap = px(9);
    const period = dash + gap;
    const offset = ((this.clock * px(28)) % period + period) % period;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    if (total <= 0) return;

    const segs: { a: Vec; b: Vec; alpha: number }[] = [];
    let walked = 0;
    let dashStart = offset - period; // dash phase marches forward along the path
    const pointAt = (d: number): Vec => {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = dist(pts[i - 1], pts[i]);
        if (acc + l >= d) {
          const t = l > 0 ? (d - acc) / l : 0;
          return { x: lerp(pts[i - 1].x, pts[i].x, t), y: lerp(pts[i - 1].y, pts[i].y, t) };
        }
        acc += l;
      }
      return pts[pts.length - 1];
    };
    while (dashStart < total) {
      const s = Math.max(0, dashStart);
      const e = Math.min(total, dashStart + dash);
      if (e > s) {
        // Subdivide so dashes follow curves.
        const n = Math.max(1, Math.ceil((e - s) / px(4)));
        for (let i = 0; i < n; i++) {
          const d0 = s + ((e - s) * i) / n;
          const d1 = s + ((e - s) * (i + 1)) / n;
          segs.push({ a: pointAt(d0), b: pointAt(d1), alpha: 1 - 0.8 * Math.pow(d0 / total, 1.5) });
        }
      }
      dashStart += period;
      walked++;
      if (walked > 2000) break;
    }
    for (const pass of [0, 1]) {
      for (const s of segs) {
        if (pass === 0) g.lineStyle(px(7), COLOR.pathDark, 0.6 * s.alpha);
        else g.lineStyle(px(4), COLOR.path, s.alpha);
        g.lineBetween(s.a.x, s.a.y, s.b.x, s.b.y);
      }
    }
  }

  private drawTelegraphs(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    const tt = world.tuning.telegraph;
    for (const t of world.telegraphs.list) {
      const k = TelegraphSystem.progress(t);
      const fadeIn = clamp(t.elapsed / Math.max(0.01, tt.fadeInTime), 0, 1);
      const fadeOut = t.impacted ? clamp(t.linger / Math.max(0.01, tt.lingerTime), 0, 1) : 1;
      const a = fadeIn * fadeOut;
      const s = Math.max(tt.markerSize, px(8));
      const { x, y } = t.pos;
      // Countdown ring shrinks onto the X.
      if (!t.impacted) {
        const r = lerp(Math.max(tt.ringStartRadius, px(30)), s * 1.15, k);
        g.lineStyle(px(4), COLOR.threatDark, 0.45 * a);
        g.strokeCircle(x, y, r);
        g.lineStyle(px(2), COLOR.threat, 0.9 * a);
        g.strokeCircle(x, y, r);
      }
      const pulse = t.impacted ? 1.25 : 1 + 0.08 * Math.sin(this.clock * 20) * k;
      const ss = s * pulse;
      g.lineStyle(px(6), COLOR.threatDark, 0.6 * a);
      g.lineBetween(x - ss, y - ss, x + ss, y + ss);
      g.lineBetween(x - ss, y + ss, x + ss, y - ss);
      g.lineStyle(px(3.5), COLOR.threat, a);
      g.lineBetween(x - ss, y - ss, x + ss, y + ss);
      g.lineBetween(x - ss, y + ss, x + ss, y - ss);
    }
  }

  /** Loading rings beside each gun. Offline guns show a grey slashed ring. */
  private drawReloadRings(
    g: Phaser.GameObjects.Graphics,
    world: World,
    b: Boat,
    px: (n: number) => number,
    radiusPx: number,
  ): void {
    const r = px(radiusPx);
    for (const c of b.cannons) {
      const pos = toWorld({ x: c.local.x, y: c.local.y + c.broadside * 2.6 }, b.motion, b.motion.heading);
      const off = toWorld({ x: 0, y: c.broadside * (r * 1.2) }, { x: 0, y: 0 }, b.motion.heading);
      const x = pos.x + off.x;
      const y = pos.y + off.y;
      if (!cannonOnline(b, c, world.tuning)) {
        g.lineStyle(px(1.5), COLOR.offline, 0.9);
        g.strokeCircle(x, y, r);
        g.lineBetween(x - r * 0.7, y + r * 0.7, x + r * 0.7, y - r * 0.7);
        continue;
      }
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(x, y, r * 1.15);
      g.lineStyle(px(1.8), COLOR.reload, c.load >= 1 ? 1 : 0.95);
      g.beginPath();
      g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.load, false);
      g.strokePath();
      if (c.load >= 1) {
        g.fillStyle(COLOR.reload, 1);
        g.fillCircle(x, y, r * 0.45);
      }
    }
  }

  /** Screen-aligned HP segments (one per part) and a water bar above a boat. */
  private drawBoatPips(g: Phaser.GameObjects.Graphics, world: World, b: Boat, px: (n: number) => number): void {
    const n = b.parts.length;
    const segW = px(9);
    const segH = px(5);
    const gap = px(2);
    const totalW = n * segW + (n - 1) * gap;
    const x0 = b.motion.x - totalW / 2;
    const y0 = b.motion.y - b.layout.length / 2 - px(20);
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x0 - px(2), y0 - px(2), totalW + px(4), segH + px(9));
    // Bow → stern order reads left to right.
    const order = [...b.parts].sort((a, c) => c.center.x - a.center.x || a.center.y - c.center.y);
    order.forEach((part, i) => {
      const f = structureFraction(part);
      const x = x0 + i * (segW + gap);
      g.fillStyle(0x222222, 1);
      g.fillRect(x, y0, segW, segH);
      g.fillStyle(hpColor(f), 1);
      g.fillRect(x, y0 + segH * (1 - f), segW, segH * f);
    });
    const w = clamp(sinkProgress(b, world.tuning), 0, 1);
    g.fillStyle(0x0a1a2a, 1);
    g.fillRect(x0, y0 + segH + px(2), totalW, px(3));
    g.fillStyle(COLOR.water, 1);
    g.fillRect(x0, y0 + segH + px(2), totalW * w, px(3));
  }

  /** Edge-of-screen arrow pointing at an off-screen enemy. */
  private drawEnemyArrow(g: Phaser.GameObjects.Graphics, e: Boat): void {
    if (e.sinkingSince !== null) return;
    const view = this.oceanCam.worldView;
    const m = this.px(this.oceanCam, 18);
    if (Phaser.Geom.Rectangle.Contains(view, e.motion.x, e.motion.y)) return;
    const cx = view.centerX;
    const cy = view.centerY;
    const dx = e.motion.x - cx;
    const dy = e.motion.y - cy;
    const sx = (view.width / 2 - m) / Math.abs(dx || 1e-6);
    const sy = (view.height / 2 - m) / Math.abs(dy || 1e-6);
    const s = Math.min(sx, sy);
    const x = cx + dx * s;
    const y = cy + dy * s;
    const a = Math.atan2(dy, dx);
    const L = this.px(this.oceanCam, 14);
    const tip = { x: x + Math.cos(a) * L, y: y + Math.sin(a) * L };
    const l = { x: x + Math.cos(a + 2.5) * L * 0.8, y: y + Math.sin(a + 2.5) * L * 0.8 };
    const r = { x: x + Math.cos(a - 2.5) * L * 0.8, y: y + Math.sin(a - 2.5) * L * 0.8 };
    g.fillStyle(COLOR.enemyArrow, 0.9);
    g.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
    g.lineStyle(this.px(this.oceanCam, 1.5), 0x000000, 0.7);
    g.strokeTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  private drawDebug(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    for (const b of world.boats) {
      const ct = boatTuning(b.side, world.tuning).cannons;
      // Hitboxes.
      g.lineStyle(px(1), COLOR.debug, 0.9);
      for (const part of b.parts) {
        g.strokePoints(part.def.polygon.map((p) => toWorld(p, b.motion, b.motion.heading)), true);
      }
      // Firing arcs and range.
      for (const c of b.cannons) {
        const from = world.muzzle(b, c);
        const face = world.cannonFacing(b, c);
        const online = cannonOnline(b, c, world.tuning);
        g.lineStyle(px(1), online ? (c.load >= 1 ? 0x7dff8a : 0x2f8a3a) : 0x666666, 0.5);
        g.beginPath();
        g.moveTo(from.x, from.y);
        g.arc(from.x, from.y, ct.range, face - ct.arc * DEG, face + ct.arc * DEG, false);
        g.closePath();
        g.strokePath();
      }
      g.lineStyle(px(1), 0xffffff, 0.15);
      g.strokeCircle(b.motion.x, b.motion.y, ct.range);
    }
    // Each enemy's seek point and preferred range.
    for (const e of world.enemies) {
      const brain = world.brains.get(e.id);
      if (!brain?.seek) continue;
      g.lineStyle(px(1.5), 0xff60ff, 0.9);
      g.lineBetween(e.motion.x, e.motion.y, brain.seek.x, brain.seek.y);
      g.strokeCircle(brain.seek.x, brain.seek.y, px(6));
      g.lineStyle(px(1), 0xff60ff, 0.25);
      g.strokeCircle(world.player.motion.x, world.player.motion.y, brain.range);
    }
    const t = world.player.target;
    if (t) {
      g.lineStyle(px(1.5), 0x60ffb0, 0.9);
      g.lineBetween(world.player.motion.x, world.player.motion.y, t.x, t.y);
    }
    // Every shell's landing point (incl. yours) — debug only, never a red X.
    g.fillStyle(0xffff60, 0.9);
    for (const s of world.shells) g.fillCircle(s.to.x, s.to.y, px(2));
  }

  // ------------------------------------------------------------ strip overlay

  private drawStrip(world: World): void {
    const g = this.gStrip;
    const cam = this.stripCam;
    const px = (n: number) => this.px(cam, n);
    g.clear();
    this.drawRings(g, px);

    const b = world.player;
    const m = b.motion;
    const sink = world.sinkAnim(b);
    const show = sink < 1;

    // Shells near the boat (ball lifted toward the strip's "up").
    const up = rotate({ x: 0, y: -1 }, m.heading);
    const arcH = world.tuning.visuals.shellArcHeight;
    for (const s of world.shells) {
      const k = clamp(s.elapsed / s.flightTime, 0, 1);
      const gx = lerp(s.from.x, s.to.x, k);
      const gy = lerp(s.from.y, s.to.y, k);
      if (dist({ x: gx, y: gy }, m) > b.layout.length * 1.5) continue;
      const h = 4 * arcH * k * (1 - k) * 0.4;
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(gx, gy, 0.5);
      g.fillStyle(0x15171a, 1);
      g.fillCircle(gx + up.x * h, gy + up.y * h, 0.6);
    }

    if (show) this.drawReloadRings(g, world, b, px, 9);

    b.parts.forEach((part, i) => {
      const label = this.labels[i];
      if (!label) return;
      const c = toWorld(part.center, m, m.heading);
      const bw = Math.min(px(70), polygonWidth(part.def.polygon) * 0.7);
      const f = structureFraction(part);
      const fill = part.capacity > 0 ? part.water / part.capacity : 0;
      const along = rotate({ x: 1, y: 0 }, m.heading);
      const down = rotate({ x: 0, y: 1 }, m.heading);
      const at = (dx: number, dy: number) => ({ x: c.x + along.x * dx + down.x * dy, y: c.y + along.y * dx + down.y * dy });
      label.setPosition(at(0, -px(9)).x, at(0, -px(9)).y);
      label.setRotation(m.heading);
      label.setScale(this.dpr / cam.zoom / 2);
      label.setVisible(show);
      if (!show) return;
      // HP bar and water bar, drawn as rotated quads.
      const bar = (dy: number, h: number, frac: number, color: number, bg: number) => {
        const quad = (w: number) => [at(-bw / 2, dy), at(-bw / 2 + w, dy), at(-bw / 2 + w, dy + h), at(-bw / 2, dy + h)];
        g.fillStyle(bg, 0.85);
        g.fillPoints(quad(bw), true);
        if (frac > 0) {
          g.fillStyle(color, 1);
          g.fillPoints(quad(bw * clamp(frac, 0, 1)), true);
        }
      };
      bar(px(1), px(5), f, hpColor(f), 0x1a1a1a);
      bar(px(7.5), px(3.5), fill, COLOR.water, 0x0a1a2a);
    });
  }
}

function polygonWidth(poly: readonly Vec[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    lo = Math.min(lo, p.x);
    hi = Math.max(hi, p.x);
  }
  return hi - lo;
}

function hpColor(f: number): number {
  if (f <= 0) return COLOR.wrecked;
  if (f > 0.6) return lerpColor(COLOR.hpMid, COLOR.hpGood, (f - 0.6) / 0.4);
  return lerpColor(COLOR.hpBad, COLOR.hpMid, f / 0.6);
}
