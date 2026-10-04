// One scene, one world, two cameras:
//  - ocean camera (top ~75%): zoomed out, frames both boats, takes steering input
//  - strip camera (bottom ~25%): your boat, large, always bow-right, with its crew.
//    While your boat is attached to others the strip expands (to about half the
//    screen) and frames every attached deck in the direction it lies: a boat on
//    your port side above yours, starboard below, a rammed one where it hit.
// In setup mode the strip grows to about half the screen and frames the deck
// grid at touch size; the DOM setup layer draws the interactive grid on top,
// using the projection published to the Controller.
// Overlays that must stay a readable size on screen (HP pips, X markers, the
// path preview) are drawn per camera with sizes divided by that camera's zoom.

import Phaser from 'phaser';
import { LAYOUTS } from '../config/boats';
import { shipName } from '../config/ships';
import {
  gunOnline,
  gunSpec,
  isDerelict,
  motionParams,
  sinkProgress,
  structureFraction,
  type Boat,
  type GunState,
} from '../sim/boat';
import { leeWorldPos } from '../sim/combat';
import { activity, workerAt } from '../sim/crew';
import { clamp, DEG, dist, lerp, rotate, toLocal, toWorld, type Vec } from '../sim/math';
import { FIXED_DT, predictAlongside, predictPath } from '../sim/steering';
import { TelegraphSystem } from '../sim/telegraph';
import type { World, WorldEvent } from '../sim/world';
import { BoatView, lerpColor } from './BoatView';
import type { Controller } from './Controller';
import { CrewView } from './CrewView';
import {
  buildCrackTextures,
  buildCrewTextures,
  buildParticleTextures,
  buildPartTextures,
  buildWaterTexture,
  preloadArt,
} from './textures';

/** Fraction of the screen height given to the ocean view during a fight (setup mode uses tuning.layout). */
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
  pipPlayer: 0xf6e7c1,
  pipEnemy: 0xffa040,
  neutral: 0xf6e7c1,
  link: 0xd9c08a,
  minRange: 0xff8a6a,
};

/** Debug colors for crew pips by activity. */
const ACTIVITY_COLOR: Record<string, number> = {
  gun: 0xffd27a,
  row: 0x7dff8a,
  sail: 0x7dd6ff,
  lookout: 0xd59bff,
  repair: 0xff9b5a,
  bail: 0x3a9cf0,
  board: 0xff5a5a,
  repel: 0xffa0d0,
  melee: 0xff2020,
  swing: 0xffffff,
  walk: 0xffffff,
  idle: 0x777777,
};

/** A pistol shot's streak, drawn briefly. */
interface Tracer {
  from: Vec;
  to: Vec;
  t: number;
  hit: boolean;
  player: boolean;
}

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
  private crewView: CrewView | null = null;
  /** The crew list the crew view was built for (setup replaces it). */
  private crewLees: unknown = null;
  /** Current ocean share of the screen (animates between setup and fight sizes). */
  private frac = OCEAN_FRACTION;
  private chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  private spray!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bubbles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private rings: Ring[] = [];
  private tracers: Tracer[] = [];
  /** Ship type labels over each enemy in the ocean view. */
  private labels = new Map<number, Phaser.GameObjects.Text>();
  /** 0..1: slide toward the setup layout / the expanded (attached) layout. */
  private setupK = 1;
  private expandK = 0;
  /** Strip camera framing (local to your boat): center offset and zoom, smoothed. */
  private stripFrame: { x: number; y: number; zoom: number } | null = null;
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
    for (const layout of LAYOUTS) {
      for (const side of ['player', 'enemy'] as const) buildPartTextures(this, layout, side);
      buildCrackTextures(this, layout);
    }
    buildCrewTextures(this);

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

    // Land in setup mode at setup size (no slide on first load).
    this.setupK = this.ctl.world.phase === 'ready' ? 1 : 0;
    this.frac = this.targetFrac();
    this.setupInput();
    this.scale.on('resize', () => {
      this.layout();
      this.snapCamera = true;
    });
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
    return Math.round(this.scale.height * this.frac);
  }

  /** 0 = fight layout, 1 = setup layout. */
  private get setupBlend(): number {
    return this.setupK;
  }

  /** Ocean share for the current blend of setup / fight / expanded layouts. */
  private targetFrac(): number {
    const lay = this.ctl.tuning.layout;
    const setup = clamp(lay.setupOceanFraction, 0.2, OCEAN_FRACTION);
    const expanded = clamp(lay.expandedOceanFraction, 0.25, OCEAN_FRACTION);
    return lerp(lerp(OCEAN_FRACTION, expanded, this.expandK), setup, this.setupK);
  }

  /** Slide the panels toward their setup, fight or expanded sizes. */
  private animatePanels(dt: number): void {
    const world = this.ctl.world;
    const step = dt / Math.max(0.01, this.ctl.tuning.layout.panelSlideTime);
    const toward = (v: number, want: number) => (want > v ? Math.min(want, v + step) : Math.max(want, v - step));
    this.setupK = toward(this.setupK, world.phase === 'ready' ? 1 : 0);
    this.expandK = toward(this.expandK, world.phase !== 'ready' && world.isAttached(world.player) ? 1 : 0);
    const f = this.targetFrac();
    if (Math.abs(f - this.frac) < 1e-4) return;
    this.frac = f;
    this.layout();
  }

  private layout(): void {
    const W = this.W;
    const H = this.scale.height;
    this.oceanCam.setViewport(0, 0, W, this.oceanH);
    this.stripCam.setViewport(0, this.oceanH, W, H - this.oceanH);
    this.ctl.oceanFrac = this.frac;
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
      this.ctl.world.setAlongside(null);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  /**
   * Steer toward the touched point. Holding on (or right beside) an enemy hull
   * means "come alongside it" instead. While attached, steering does nothing.
   */
  private aimAt(screen: Vec): void {
    const world = this.ctl.world;
    if (world.isAttached(world.player)) {
      world.player.target = null;
      world.setAlongside(null);
      return;
    }
    const w = this.oceanCam.getWorldPoint(screen.x, screen.y);
    const grab = world.tuning.attach.alongsideGrab + this.px(this.oceanCam, 10);
    const enemy = world.phase === 'running' ? world.enemyNear({ x: w.x, y: w.y }, grab) : null;
    world.setAlongside(enemy);
    if (!enemy) world.player.target = { x: w.x, y: w.y };
  }

  // ------------------------------------------------------------ frame

  update(_time: number, deltaMs: number): void {
    const ctl = this.ctl;
    const world = ctl.world;
    if (this.runId !== ctl.runId) this.rebuild();

    const dt = Math.min(deltaMs / 1000, 0.1);
    this.clock += dt;
    this.animatePanels(dt);
    if (!ctl.blocked && !ctl.paused && world.phase !== 'ready') {
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

    if (this.pointerScreen && (ctl.tuning.input.targetFollowsCamera || world.isAttached(world.player))) this.aimAt(this.pointerScreen);
    if (this.pointerId === null && (world.player.target || world.alongside)) {
      world.player.target = null;
      world.setAlongside(null);
    }

    this.handleEvents(world.drainEvents());
    this.updateCameras(dt);
    for (const v of this.views) v.update(world, dt);
    if (this.crewView && this.crewLees !== world.player.crew.lees) this.rebuildCrew();
    const inStrip = new Set(this.stripDecks(world));
    for (const v of this.views) if (v.boat.side !== 'player') for (const o of v.all()) this.setInStrip(o, inStrip.has(v.boat));
    this.emitSinkingBubbles(world);
    this.rings = this.rings.filter((r) => this.clock - r.t < r.dur);
    this.tracers = this.tracers.filter((tr) => this.clock - tr.t < 0.18);

    this.drawOcean(world);
    this.drawStrip(world);
    ctl.frame();
  }

  private rebuild(): void {
    this.runId = this.ctl.runId;
    for (const v of this.views) v.destroy();
    this.views = [];
    for (const l of this.labels.values()) l.destroy();
    this.labels.clear();
    this.rings = [];
    this.tracers = [];
    this.stripFrame = null;
    this.acc = 0;
    this.lastPhase = '';
    this.pointerId = null;
    this.pointerScreen = null;
    this.snapCamera = true;
    for (const e of [this.chips, this.spray, this.smoke, this.bubbles]) e.killAll();

    for (const boat of this.ctl.world.boats) {
      const view = new BoatView(this, boat);
      // The strip shows your boat, plus any boat attached to it (toggled per frame).
      if (boat.side !== 'player') for (const o of view.all()) this.onlyOcean(o);
      this.views.push(view);
      if (boat.side !== 'player') {
        const label = this.add.text(0, 0, shipName(boat.type), {
          fontFamily: 'system-ui, sans-serif',
          fontSize: `${Math.round(11 * this.dpr)}px`,
          color: '#ffd9b0',
          stroke: '#1a0e06',
          strokeThickness: Math.round(3 * this.dpr),
        }).setOrigin(0.5, 1).setDepth(45);
        this.onlyOcean(label);
        this.labels.set(boat.id, label);
      }
    }
    this.rebuildCrew();
  }

  /** Crew sprites (rebuilt when setup changes who's aboard). */
  private rebuildCrew(): void {
    this.crewView?.destroy();
    this.crewView = new CrewView(this, (o) => this.onlyStrip(o));
    this.crewLees = this.ctl.world.player.crew.lees;
  }

  /** Show or hide an object in the strip camera. */
  private setInStrip(o: Phaser.GameObjects.GameObject, show: boolean): void {
    const id = this.stripCam.id;
    o.cameraFilter = show ? o.cameraFilter & ~id : o.cameraFilter | id;
  }

  /** Decks the strip shows: yours, then every boat attached to it. */
  private stripDecks(world: World): Boat[] {
    return [world.player, ...world.attachedTo(world.player)];
  }

  private viewFor(boatId: number): BoatView | undefined {
    return this.views.find((v) => v.boat.id === boatId);
  }

  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const dir = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x) / DEG;
          const puff = e.gun === 'swivel' ? 3 : e.gun === 'carronade' || e.gun === 'scrap' ? 10 : e.gun === 'mortar' ? 8 : 6;
          this.smoke.setEmitterAngle({ min: dir - (e.gun === 'scrap' ? 40 : 25), max: dir + (e.gun === 'scrap' ? 40 : 25) });
          this.smoke.explode(puff, e.from.x, e.from.y);
          break;
        }
        case 'blowout':
          this.chips.explode(18, e.pos.x, e.pos.y);
          this.smoke.setEmitterAngle({ min: 0, max: 360 });
          this.smoke.explode(6, e.pos.x, e.pos.y);
          break;
        case 'explosion':
          this.chips.explode(40, e.pos.x, e.pos.y);
          this.smoke.setEmitterAngle({ min: 0, max: 360 });
          this.smoke.explode(20, e.pos.x, e.pos.y);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.7, r: 12, color: 0xffa040 });
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.35, r: 6, color: 0xfff0a0 });
          this.cameras.main.shake(260, 0.01);
          break;
        case 'hit':
          this.chips.explode(14, e.pos.x, e.pos.y);
          this.viewFor(e.boatId)?.flashPart(e.part);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.35, r: 4, color: 0xffd28a });
          break;
        case 'splash':
          this.spray.explode(12, e.pos.x, e.pos.y);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.7, r: 5, color: 0xe0f4ff });
          break;
        case 'leeLost': {
          // Your Lees splash when their fall animation reaches the water (CrewView); enemy Lees at once.
          const b = this.ctl.world.boats.find((x) => x.id === e.boatId);
          if (b && b.side !== 'player') {
            this.spray.explode(6, e.pos.x, e.pos.y);
            this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.6, r: 3, color: 0xe0f4ff });
          }
          break;
        }
        case 'sinking': {
          const b = this.ctl.world.boats.find((x) => x.id === e.boatId);
          if (b) this.rings.push({ x: b.motion.x, y: b.motion.y, t: this.clock, dur: 2.5, r: 26, color: 0xe0f4ff });
          break;
        }
        case 'melee':
          // A small flash on each sword hit.
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.22, r: e.killed ? 1.6 : 0.9, color: e.killed ? 0xff6040 : 0xfff3d6 });
          break;
        case 'pistol':
        case 'gatling':
          this.tracers.push({ from: e.from, to: e.to, t: this.clock, hit: e.hit, player: e.side === 'player' });
          break;
        case 'rammed':
          this.chips.explode(30, e.pos.x, e.pos.y);
          this.viewFor(e.target)?.flashPart(e.part);
          if (e.selfPart !== null) this.viewFor(e.rammer)?.flashPart(e.selfPart);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.6, r: 9, color: 0xffd28a });
          this.cameras.main.shake(180, 0.006);
          break;
        case 'bump':
          this.spray.explode(10, e.pos.x, e.pos.y);
          this.rings.push({ x: e.pos.x, y: e.pos.y, t: this.clock, dur: 0.4, r: 3, color: 0xe0f4ff });
          break;
        case 'docked': {
          const a = this.ctl.world.boats.find((x) => x.id === e.a);
          const b = this.ctl.world.boats.find((x) => x.id === e.b);
          if (a && b) this.rings.push({ x: (a.motion.x + b.motion.x) / 2, y: (a.motion.y + b.motion.y) / 2, t: this.clock, dur: 0.6, r: 10, color: COLOR.link });
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
    const focus = others.length ? others : world.enemies.length ? world.enemies.map((e) => e.motion) : [p];
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

    // Strip: player boat, bow right. Fight: centered. Setup: larger (tiles at touch size)
    // and near the top, leaving room for the tray below. Attached: zoomed out to frame
    // every attached deck, each where it lies relative to yours.
    const SH = this.scale.height - this.oceanH;
    const L = world.player.layout.length;
    const B = world.player.layout.beam;
    const grid = world.player.grid;
    let fightZ = Math.min((W * clamp(t.stripBoatFill, 0.2, 1)) / L, (SH * 0.62) / B);
    let fx = 0;
    let fy = 0;
    const decks = this.stripDecks(world);
    if (decks.length > 1) {
      // Bounding box of every deck in your boat's frame.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const b of decks) {
        const hl = b.layout.length / 2;
        const hb = b.layout.beam / 2;
        for (const c of [{ x: -hl, y: -hb }, { x: hl, y: -hb }, { x: hl, y: hb }, { x: -hl, y: hb }]) {
          const l = toLocal(toWorld(c, b.motion, b.motion.heading), p, p.heading);
          x0 = Math.min(x0, l.x);
          x1 = Math.max(x1, l.x);
          y0 = Math.min(y0, l.y);
          y1 = Math.max(y1, l.y);
        }
      }
      const zoom = Math.min((W * 0.94) / (x1 - x0), (SH * 0.86) / (y1 - y0));
      fightZ = Math.min(fightZ, zoom);
      fx = (x0 + x1) / 2;
      fy = (y0 + y1) / 2;
    }
    // Smooth the framing so the strip doesn't jump when a deck arrives or leaves.
    const k = this.stripFrame ? 1 - Math.exp(-6 * dt) : 1;
    const f = this.stripFrame ?? { x: fx, y: fy, zoom: fightZ };
    f.x += (fx - f.x) * k;
    f.y += (fy - f.y) * k;
    f.zoom = Math.exp(lerp(Math.log(f.zoom), Math.log(fightZ), k));
    this.stripFrame = f;
    const minTile = this.ctl.tuning.layout.minTilePx * this.dpr;
    const setupZ = Math.min(Math.max((W * 0.97) / L, minTile / Math.min(grid.tileW, grid.tileH)), (W * 0.98) / (grid.cols * grid.tileW));
    const s = this.setupBlend;
    const sz = lerp(f.zoom, setupZ, s);
    const boatY = lerp(SH / 2, (B * setupZ) / 2 + 16 * this.dpr, s);
    const d = (SH / 2 - boatY) / sz;
    const c = toWorld({ x: f.x * (1 - s), y: d + f.y * (1 - s) }, p, p.heading);
    this.stripCam.setZoom(sz);
    this.stripCam.setRotation(-p.heading);
    this.stripCam.centerOn(c.x, c.y);
    const diag = Math.hypot(W, SH) / sz;
    this.coverWithWater(this.waterStrip, c.x, c.y, diag, diag);
    // Local boat frame → CSS px, for the DOM setup grid; and world → CSS px for strip buttons.
    const dpr = this.dpr;
    const top = this.oceanH;
    const worldToCss = (w: Vec) => {
      const r = rotate({ x: w.x - c.x, y: w.y - c.y }, -p.heading);
      return { x: (r.x * sz + W / 2) / dpr, y: (top + SH / 2 + r.y * sz) / dpr };
    };
    this.ctl.stripProjection = {
      toCss: (l: Vec) => ({ x: (l.x * sz + W / 2) / dpr, y: (top + boatY + l.y * sz) / dpr }),
      worldToCss,
      top: top / dpr,
      zoom: sz / dpr,
    };
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
    this.drawTracers(g, px);
    if (this.ctl.debug) this.drawDebug(g, world, px);
    if (world.phase === 'ready') this.drawRangeRing(g, world, px);
    // Minimum-range rings while your finger is on the ocean (and always in debug).
    if ((this.pointerId !== null && world.phase === 'running') || this.ctl.debug) this.drawMinRangeRings(g, world, px);
    this.drawLinks(g, world, px);

    // Path preview (also before START). Hidden while attached: steering does nothing.
    const player = world.player;
    const attached = world.isAttached(player);
    const along = world.alongside ? world.enemies.find((e) => e.id === world.alongside!.boatId) : undefined;
    if (this.pointerId !== null && !attached && player.sinkingSince === null && (player.target || along)) {
      const horizon = Math.max(0.5, world.tuning.global.previewHorizon);
      const params = motionParams(player, world.tuning);
      const pts = along
        ? predictAlongside(player.motion, world.alongsideSpec(player, along, world.alongside!.side), { ...params, orbitCapture: 0 }, horizon)
        : predictPath(player.motion, player.target!, params, horizon);
      this.drawMarchingPath(g, pts, px);
      if (along) {
        // Coming alongside: a ring around the boat you're closing on.
        g.lineStyle(px(2), COLOR.path, 0.75);
        g.strokeCircle(along.motion.x, along.motion.y, along.layout.length / 2 + px(8));
      } else if (player.target) {
        g.lineStyle(px(2), COLOR.path, 0.7);
        g.strokeCircle(player.target.x, player.target.y, px(14));
        g.fillStyle(COLOR.path, 0.8);
        g.fillCircle(player.target.x, player.target.y, px(2.5));
      }
    }

    // Shells in flight: ball above its shadow, sized and lobbed by gun (a mortar arcs high, pellets are specks).
    const arcH = world.tuning.visuals.shellArcHeight;
    for (const s of world.shells) {
      const look = SHELL_LOOK[s.gun] ?? SHELL_LOOK.cannon;
      const k = clamp(s.elapsed / s.flightTime, 0, 1);
      const gx = lerp(s.from.x, s.to.x, k);
      const gy = lerp(s.from.y, s.to.y, k);
      const h = 4 * arcH * look.arc * k * (1 - k);
      const r = look.size;
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(gx, gy, Math.max(0.4 * r, px(2 * r)));
      g.fillStyle(look.color, 1);
      g.fillCircle(gx, gy - h, Math.max(0.6 * r, px(3 * r)));
      if (r >= 0.8) {
        g.fillStyle(0x9aa3ad, 1);
        g.fillCircle(gx - px(0.8 * r), gy - h - px(0.8 * r), Math.max(0.2, px(r)));
      }
    }

    this.drawTelegraphs(g, world, px);
    this.drawContactWarnings(g, world, px);

    for (const b of world.boats) {
      if (b.sinkingSince !== null && world.sinkAnim(b) >= 1) continue;
      if (world.tuning.visuals.oceanReloadRings) this.drawReloadRings(g, world, b, px, 3);
      this.drawBoatPips(g, world, b, px);
    }
    this.drawCrewPips(g, world, px);
    for (const e of world.enemies) this.drawEnemyArrow(g, e);
    // Ship type over each enemy (and DERELICT once its crew is gone).
    for (const e of world.enemies) {
      const label = this.labels.get(e.id);
      if (!label) continue;
      const gone = world.sinkAnim(e) >= 1;
      label.setVisible(!gone);
      if (gone) continue;
      const text = isDerelict(e) ? `${shipName(e.type)} · derelict` : shipName(e.type);
      if (label.text !== text) label.setText(text);
      label.setScale(1 / this.oceanCam.zoom).setPosition(e.motion.x, e.motion.y - e.layout.length / 2 - px(23));
      label.setAlpha(1 - world.sinkAnim(e));
    }
  }

  /** Pistol shots: a short bright streak (yours cream, theirs orange). */
  private drawTracers(g: Phaser.GameObjects.Graphics, px: (n: number) => number): void {
    for (const tr of this.tracers) {
      const a = 1 - clamp((this.clock - tr.t) / 0.18, 0, 1);
      g.lineStyle(Math.max(px(1.2), 0.08), tr.player ? 0xfff3d6 : 0xffa060, a);
      g.lineBetween(tr.from.x, tr.from.y, tr.to.x, tr.to.y);
      if (tr.hit) {
        g.fillStyle(0xff5040, a);
        g.fillCircle(tr.to.x, tr.to.y, Math.max(px(2), 0.25));
      }
    }
  }

  /** Each boat's minimum cannon range: inside it, its guns can't touch you. */
  private drawMinRangeRings(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    for (const b of world.boats) {
      if (b.sinkingSince !== null) continue;
      // One faint ring per distinct minimum range among its shell-firing guns.
      const rings = new Set<number>();
      for (const gun of b.guns) if (gun.mode !== 'stream') rings.add(Math.round(gunSpec(b, gun, world.tuning).minRange));
      for (const r of rings) {
        if (r <= 0) continue;
        g.lineStyle(px(1.5), b.side === 'player' ? COLOR.path : COLOR.minRange, 0.3);
        g.strokeCircle(b.motion.x, b.motion.y, r);
      }
    }
  }

  /** Links between attached boats: a rope line between them. */
  private drawLinks(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    for (const l of world.links.links) {
      const breaking = l.breakAt !== null;
      g.lineStyle(px(2.5), COLOR.link, breaking ? 0.35 + 0.35 * Math.sin(this.clock * 12) : 0.85);
      g.lineBetween(l.a.motion.x, l.a.motion.y, l.b.motion.x, l.b.motion.y);
    }
  }

  /**
   * Ram X's and dock rings. Red when it's being done to you (same language as
   * incoming shells); a neutral color when you're the one doing it.
   */
  private drawContactWarnings(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    for (const w of world.links.warnings) {
      const color = w.byPlayer ? COLOR.neutral : COLOR.threat;
      const { x, y } = w.pos;
      if (w.kind === 'dock') {
        // Progress ring filling up over the grapple time.
        const r = Math.max(px(16), 4);
        g.lineStyle(px(5), 0x000000, 0.4);
        g.strokeCircle(x, y, r);
        g.lineStyle(px(3), color, 0.95);
        g.beginPath();
        g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * w.progress, false);
        g.strokePath();
        continue;
      }
      this.drawThreatX(g, w.pos, w.progress, false, 1, color, w.byPlayer ? COLOR.pathDark : COLOR.threatDark, world, px);
    }
  }

  private drawRings(g: Phaser.GameObjects.Graphics, px: (n: number) => number): void {
    for (const r of this.rings) {
      const k = clamp((this.clock - r.t) / r.dur, 0, 1);
      g.lineStyle(Math.max(px(1.5), 0.15), r.color, (1 - k) * 0.9);
      g.strokeCircle(r.x, r.y, r.r * (0.3 + 0.7 * Math.sqrt(k)));
    }
  }

  /**
   * Setup: every gun's arc as a faint wedge from its muzzle (so you can see where
   * each can fire from the slot it's in), and the selected gun's arc bright,
   * with its minimum and maximum range.
   */
  private drawRangeRing(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    const b = world.player;
    const sel = this.ctl.arcPreview;
    for (const gun of b.guns) {
      const on = sel !== null && gun.slot === sel;
      this.drawGunArc(g, world, b, gun, px, on ? 0.28 : sel ? 0.05 : 0.09, on);
    }
  }

  /** One gun's arc: a wedge from its muzzle between its minimum and maximum range. */
  private drawGunArc(g: Phaser.GameObjects.Graphics, world: World, b: Boat, gun: GunState, px: (n: number) => number, alpha: number, outline: boolean): void {
    const spec = gunSpec(b, gun, world.tuning);
    const from = world.muzzle(b, gun);
    const face = world.gunFacing(b, gun);
    const color = gun.targets === 'crew' ? 0xffa0d0 : 0xffd27a;
    const full = spec.arcHalf >= Math.PI - 1e-6;
    const a0 = full ? 0 : face - spec.arcHalf;
    const a1 = full ? Math.PI * 2 : face + spec.arcHalf;
    const n = Math.max(8, Math.ceil(((a1 - a0) / DEG) / 4));
    const pts: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: from.x + Math.cos(a) * spec.range, y: from.y + Math.sin(a) * spec.range });
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: from.x + Math.cos(a) * spec.minRange, y: from.y + Math.sin(a) * spec.minRange });
    }
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
    if (outline) {
      g.lineStyle(px(2), color, 0.85);
      g.strokePoints(pts, true);
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
      if (t.kind === 'area') {
        // A burst of pellets: one shaded disk where they'll land, a ring closing in for timing.
        const r = Math.max(t.size, px(10));
        g.fillStyle(COLOR.threat, (0.12 + 0.22 * k) * a);
        g.fillCircle(t.pos.x, t.pos.y, r);
        g.lineStyle(px(2), COLOR.threat, (0.5 + 0.4 * k) * a);
        g.strokeCircle(t.pos.x, t.pos.y, r);
        if (!t.impacted) {
          g.lineStyle(px(1.2), COLOR.threat, 0.4 * a);
          g.strokeCircle(t.pos.x, t.pos.y, lerp(r * 2.2, r, k));
        }
        continue;
      }
      this.drawThreatX(g, t.pos, k, t.impacted, a, COLOR.threat, COLOR.threatDark, world, px, t.size);
    }
  }

  /**
   * An incoming-hit marker: an X that starts big and shrinks onto the impact
   * point as the hit approaches (its final size is the danger zone), with a
   * faint dashed ring closing in for timing.
   */
  private drawThreatX(
    g: Phaser.GameObjects.Graphics,
    pos: Vec,
    k: number,
    impacted: boolean,
    a: number,
    color: number,
    dark: number,
    world: World,
    px: (n: number) => number,
    size = 1,
  ): void {
    const tt = world.tuning.telegraph;
    const { x, y } = pos;
    const end = Math.max(tt.markerSize * size, px(6));
    if (!impacted) {
      const r = lerp(Math.max(tt.ringStartRadius, px(30)), end, k);
      g.lineStyle(px(1.2), color, 0.35 * a);
      const n = 24;
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2 + this.clock;
        const a1 = ((i + 1) / n) * Math.PI * 2 + this.clock;
        g.lineBetween(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
      }
    }
    const ss = impacted ? end * 1.15 : lerp(end * Math.max(1, tt.markerStartScale), end, k * k);
    g.lineStyle(px(4.5), dark, 0.5 * a);
    g.lineBetween(x - ss, y - ss, x + ss, y + ss);
    g.lineBetween(x - ss, y + ss, x + ss, y - ss);
    g.lineStyle(px(2.5), color, (0.55 + 0.45 * k) * a);
    g.lineBetween(x - ss, y - ss, x + ss, y + ss);
    g.lineBetween(x - ss, y + ss, x + ss, y - ss);
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
    for (const c of b.guns) {
      if (c.mode === 'stream') continue;
      const dx = Math.cos(c.face);
      const dy = Math.sin(c.face);
      const pos = toWorld({ x: c.local.x + dx * 2.4, y: c.local.y + dy * 2.4 }, b.motion, b.motion.heading);
      const off = toWorld({ x: dx * r * 1.2, y: dy * r * 1.2 }, { x: 0, y: 0 }, b.motion.heading);
      const x = pos.x + off.x;
      const y = pos.y + off.y;
      if (!gunOnline(b, c, world.tuning)) {
        g.lineStyle(px(1.5), COLOR.offline, 0.9);
        g.strokeCircle(x, y, r);
        g.lineBetween(x - r * 0.7, y + r * 0.7, x + r * 0.7, y - r * 0.7);
        continue;
      }
      const manned = workerAt(b, c.station) !== null;
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(x, y, r * 1.15);
      if (!manned) {
        // Unmanned: a dim empty ring (keeps whatever load it had).
        g.lineStyle(px(1.2), COLOR.offline, 0.7);
        g.strokeCircle(x, y, r);
      }
      g.lineStyle(px(1.8), COLOR.reload, manned ? (c.load >= 1 ? 1 : 0.95) : 0.35);
      g.beginPath();
      g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.load, false);
      g.strokePath();
      if (c.load >= 1) {
        g.fillStyle(COLOR.reload, 1);
        g.fillCircle(x, y, r * 0.45);
      }
    }
  }

  /** Tiny figures on each deck so crew losses and movement read in the ocean view. Debug colors them by task. */
  private drawCrewPips(g: Phaser.GameObjects.Graphics, world: World, px: (n: number) => number): void {
    const r = Math.max(px(1.7), 0.35);
    for (const lee of world.allLees()) {
      if (!lee.alive) continue;
      const alpha = lee.swing ? 1 : 1 - world.sinkAnim(lee.deck);
      if (alpha <= 0.01) continue;
      const p = leeWorldPos(lee);
      const color = this.ctl.debug ? ACTIVITY_COLOR[activity(lee)] : lee.side === 'player' ? COLOR.pipPlayer : COLOR.pipEnemy;
      g.fillStyle(0x000000, 0.75 * alpha);
      g.fillCircle(p.x, p.y, r * 1.45);
      g.fillStyle(color, alpha);
      g.fillCircle(p.x, p.y, r);
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
      // Hitboxes.
      g.lineStyle(px(1), COLOR.debug, 0.9);
      for (const part of b.parts) {
        g.strokePoints(part.def.polygon.map((p) => toWorld(p, b.motion, b.motion.heading)), true);
      }
      // Every gun's arc, facing and range rings (minimum and maximum).
      for (const c of b.guns) {
        const spec = gunSpec(b, c, world.tuning);
        const from = world.muzzle(b, c);
        const face = world.gunFacing(b, c);
        const online = gunOnline(b, c, world.tuning);
        const crew = c.targets === 'crew';
        const color = crew ? 0xffa0d0 : online ? (c.load >= 1 ? 0x7dff8a : 0x2f8a3a) : 0x666666;
        g.lineStyle(px(1), color, crew ? 0.35 : 0.5);
        g.beginPath();
        if (spec.arcHalf >= Math.PI - 1e-6) {
          g.strokeCircle(from.x, from.y, spec.range);
        } else {
          g.moveTo(from.x, from.y);
          g.arc(from.x, from.y, spec.range, face - spec.arcHalf, face + spec.arcHalf, false);
          g.closePath();
          g.strokePath();
        }
        if (spec.minRange > 0) {
          g.lineStyle(px(1), color, 0.3);
          g.beginPath();
          g.arc(from.x, from.y, spec.minRange, face - Math.min(Math.PI, spec.arcHalf), face + Math.min(Math.PI, spec.arcHalf), false);
          g.strokePath();
        }
        // Facing tick.
        g.lineStyle(px(2), color, 0.8);
        g.lineBetween(from.x, from.y, from.x + Math.cos(face) * px(18), from.y + Math.sin(face) * px(18));
      }
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
    // Docking distance around each hull and pistol range around your boat.
    const at = world.tuning.attach;
    for (const b of world.boats) {
      if (b.sinkingSince !== null) continue;
      g.lineStyle(px(1), 0xb0ffb0, 0.35);
      g.strokeCircle(b.motion.x, b.motion.y, b.layout.length / 2 + at.dockDistance);
    }
    g.lineStyle(px(1), 0xfff3d6, 0.3);
    g.strokeCircle(world.player.motion.x, world.player.motion.y, world.player.layout.length / 2 + world.tuning.pistol.range);
    // Melee engagements: a red tick between fighters.
    for (const l of world.allLees()) {
      if (!l.engaged || l.meleeTarget === null) continue;
      const o = world.findLee(l.meleeTarget);
      if (!o) continue;
      const a = leeWorldPos(l);
      const b = leeWorldPos(o.lee);
      g.lineStyle(px(1.5), 0xff3030, 0.9);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
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

    this.drawTracers(g, px);
    const fight = world.phase !== 'ready';
    const decks = this.stripDecks(world);
    if (this.crewView) {
      this.crewView.update(world, g, px, decks, fight, this.clock, this.ctl.debug, m.heading);
      for (const p of this.crewView.splashes) {
        this.spray.explode(10, p.x, p.y);
        this.rings.push({ x: p.x, y: p.y, t: this.clock, dur: 0.7, r: 2.5, color: 0xe0f4ff });
      }
    }
    if (!fight) return;

    // Per-part HP and water bars, tucked along the bottom of a plain tile of the part (below crew feet).
    const along = rotate({ x: 1, y: 0 }, m.heading);
    const down = rotate({ x: 0, y: 1 }, m.heading);
    for (const deck of decks) {
      if (world.sinkAnim(deck) >= 1 || (deck === b && !show)) continue;
      this.drawPartBars(g, deck, along, down);
      if (this.ctl.debug) this.drawTileBars(g, deck, along, down);
    }
  }

  /** Debug: each damaged tile's durability as a thin bar along its top edge. */
  private drawTileBars(g: Phaser.GameObjects.Graphics, b: Boat, along: Vec, down: Vec): void {
    for (const tile of b.grid.tiles) {
      if (tile.hp >= tile.maxHp && !tile.blown) continue;
      const c = toWorld({ x: tile.center.x, y: tile.y0 + 0.25 }, b.motion, b.motion.heading);
      const w = (tile.x1 - tile.x0) * 0.8;
      const at = (dx: number, dy: number) => ({ x: c.x + along.x * dx + down.x * dy, y: c.y + along.y * dx + down.y * dy });
      const quad = (x0: number, x1: number) => [at(x0, 0), at(x1, 0), at(x1, 0.16), at(x0, 0.16)];
      g.fillStyle(0x000000, 0.7);
      g.fillPoints(quad(-w / 2, w / 2), true);
      const f = clamp(tile.hp / tile.maxHp, 0, 1);
      g.fillStyle(0xd08a40, 1);
      if (f > 0) g.fillPoints(quad(-w / 2, -w / 2 + w * f), true);
    }
  }

  private drawPartBars(g: Phaser.GameObjects.Graphics, b: Boat, along: Vec, down: Vec): void {
    const m = b.motion;
    b.parts.forEach((part, i) => {
      const anchor = this.partAnchor(b, i);
      const f = structureFraction(part);
      const fill = part.capacity > 0 ? part.water / part.capacity : 0;
      const bw = Math.min(polygonWidth(part.def.polygon) * 0.7, b.grid.tileW * 0.8);
      const c = toWorld(anchor, m, m.heading);
      const at = (dx: number, dy: number) => ({ x: c.x + along.x * dx + down.x * dy, y: c.y + along.y * dx + down.y * dy });
      const bar = (dy: number, h: number, frac: number, color: number, bg: number) => {
        const quad = (w: number) => [at(-bw / 2, dy), at(-bw / 2 + w, dy), at(-bw / 2 + w, dy + h), at(-bw / 2, dy + h)];
        g.fillStyle(bg, 0.85);
        g.fillPoints(quad(bw), true);
        if (frac > 0) {
          g.fillStyle(color, 1);
          g.fillPoints(quad(bw * clamp(frac, 0, 1)), true);
        }
      };
      bar(0, 0.24, f, hpColor(f), 0x1a1a1a);
      bar(0.3, 0.17, fill, COLOR.water, 0x0a1a2a);
    });
  }

  /** Where a part's HP/water bars go (local frame): bottom of its plain tile nearest the part's middle. */
  private partAnchor(b: Boat, partIndex: number): Vec {
    const part = b.parts[partIndex];
    let best: Vec | null = null;
    let bestD = Infinity;
    for (const t of b.grid.tiles) {
      if (t.part !== partIndex || t.station) continue;
      const d = dist(t.center, part.center);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = { x: t.center.x, y: t.center.y + b.grid.tileH * 0.32 };
      }
    }
    return best ?? part.center;
  }
}

/** How each gun's shot looks in flight: ball size (× a cannon ball), arc height (× the base) and color. */
const SHELL_LOOK: Record<string, { size: number; arc: number; color: number }> = {
  cannon: { size: 1, arc: 1, color: 0x15171a },
  longGun: { size: 0.75, arc: 0.6, color: 0x1c2a3a },
  carronade: { size: 1.35, arc: 0.7, color: 0x1a120c },
  swivel: { size: 0.55, arc: 0.6, color: 0x2a2622 },
  mortar: { size: 1.6, arc: 3, color: 0x0e0e0e },
  scrap: { size: 0.35, arc: 0.3, color: 0x4a3a28 },
};

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
