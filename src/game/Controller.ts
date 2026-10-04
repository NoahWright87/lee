// Owns the live tuning, the current World, your crew arrangement, and
// run-level settings (speed, debug). The Phaser scene and the DOM HUD both
// talk to this.

import { SLOOP } from '../config/boats';
import { defaultTuning, mergeTuning, type Tuning } from '../config/tuning';
import type { Vec } from '../sim/math';
import { autoArrange, World, type CrewPlacement } from '../sim/world';

const STORAGE_KEY = 'lee.tuning.current';
const PRESETS_KEY = 'lee.tuning.presets';
const CREW_KEY = 'lee.crew.arrangement';

/** How the strip camera maps the boat's local frame to CSS pixels (set by the scene each frame). */
export interface StripProjection {
  /** Your boat's local frame → CSS px (setup mode). */
  toCss: (local: Vec) => Vec;
  /** World point → CSS px through the strip camera. */
  worldToCss: (world: Vec) => Vec;
  /** Top of the strip panel, CSS px. */
  top: number;
  /** CSS px per meter in the strip. */
  zoom: number;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: tuning just won't persist */
  }
}

type Listener = () => void;

export class Controller {
  tuning: Tuning;
  world: World;
  speed: 1 | 2 = 1;
  debug = false;
  /** True while the rotate-your-phone overlay is up. */
  blocked = false;
  /** Bumped every time a new World is built so views know to rebuild. */
  runId = 0;
  /** 1-based fight number in the current run. */
  fight = 1;
  /** Enemy ships sunk in earlier fights of this run. */
  private sunkBefore = 0;
  /** Enemy ship types forced by the encounter picker (every fight), or null for the campaign's. */
  encounter: string[] | null = null;
  /** Your crew: home tile per Lee slot (null = in the tray). Persists between fights and sessions. */
  arrangement: CrewPlacement;
  /** Ocean share of the screen right now (animates between setup and fight). Written by the scene. */
  oceanFrac = 0.75;
  stripProjection: StripProjection | null = null;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<Listener>();

  constructor() {
    this.tuning = defaultTuning();
    const saved = safeGet(STORAGE_KEY);
    if (saved) {
      try {
        this.tuning = mergeTuning(defaultTuning(), migrate(JSON.parse(saved)));
      } catch {
        /* corrupt save: use defaults */
      }
    }
    this.arrangement = this.loadArrangement();
    this.world = this.buildWorld(1);
  }

  private buildWorld(fight: number, carry?: ReturnType<World['playerCarry']>): World {
    this.arrangement = this.normalized(this.arrangement);
    return new World(this.tuning, undefined, { fight, carry, crew: this.arrangement, encounter: this.encounter ?? undefined });
  }

  // ------------------------------------------------------------ crew arrangement

  crewSize(): number {
    return Math.max(0, Math.round(this.tuning.player.crew.size));
  }

  /** Fit an arrangement to the current crew size and grid: one Lee per tile, extra Lees to the tray. */
  private normalized(a: CrewPlacement): CrewPlacement {
    const n = this.crewSize();
    const tiles = this.world?.player.grid.tiles.length ?? 15;
    const used = new Set<number>();
    const out: CrewPlacement = [];
    for (let i = 0; i < n; i++) {
      const v = a[i];
      if (typeof v === 'number' && v >= 0 && v < tiles && !used.has(v)) {
        used.add(v);
        out.push(v);
      } else out.push(null);
    }
    return out;
  }

  private loadArrangement(): CrewPlacement {
    const saved = safeGet(CREW_KEY);
    if (saved) {
      try {
        const a = JSON.parse(saved);
        if (Array.isArray(a)) return a;
      } catch {
        /* corrupt save: auto-arrange */
      }
    }
    return autoArrange(SLOOP, 'player', this.crewSize());
  }

  /** Change the arrangement (setup mode): updates the frozen world's crew and saves. */
  setArrangement(a: CrewPlacement): void {
    this.arrangement = this.normalized(a);
    safeSet(CREW_KEY, JSON.stringify(this.arrangement));
    if (this.world.phase === 'ready') this.world.placePlayerCrew(this.arrangement);
    this.notify();
  }

  /** Put Lee `slot` on `tile` (null = back to the tray). Whoever was there swaps into the slot's old spot. */
  placeLee(slot: number, tile: number | null): void {
    const a = [...this.normalized(this.arrangement)];
    if (slot < 0 || slot >= a.length) return;
    const from = a[slot];
    if (tile !== null) {
      const other = a.indexOf(tile);
      if (other >= 0 && other !== slot) a[other] = from;
    }
    a[slot] = tile;
    this.setArrangement(a);
  }

  clearCrew(): void {
    this.setArrangement(this.arrangement.map(() => null));
  }

  autoArrangeCrew(): void {
    this.setArrangement(autoArrange(this.world.player.layout, 'player', this.crewSize()));
  }

  /** True if nobody is placed on a cannon station. */
  noGunners(): boolean {
    const tiles = this.world.player.grid.tiles;
    return !this.arrangement.some((t) => t !== null && tiles[t]?.station === 'cannon');
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Called once per rendered frame (for HUD gauges). */
  onFrame(fn: Listener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  frame(): void {
    for (const fn of this.frameListeners) fn();
  }

  start(): void {
    this.world.placePlayerCrew(this.normalized(this.arrangement));
    this.world.start();
    this.notify();
  }

  /** New run from fight 1 with the current tuning and arrangement. `running` skips setup. */
  restart(running = false): void {
    this.fight = 1;
    this.sunkBefore = 0;
    this.world = this.buildWorld(1);
    this.runId++;
    if (running) this.world.start();
    this.notify();
  }

  /** After a win: the next fight, with more ships. Your damage carries over minus repairs; your crew returns at full HP. */
  nextFight(running = true): void {
    const w = this.world;
    if (w.result?.winner !== 'player') return;
    this.sunkBefore = this.shipsSunk();
    this.fight++;
    this.world = this.buildWorld(this.fight, w.playerCarry());
    this.runId++;
    if (running) this.world.start();
    this.notify();
  }

  /** From the result screen: back to setup for the next fight (after a win) or a fresh run (after a loss). */
  rearrange(): void {
    if (this.world.result?.winner === 'player') this.nextFight(false);
    else this.restart(false);
  }

  /** Enemy ships beaten (sunk or crew killed) this run, including the current fight. */
  shipsSunk(): number {
    return this.sunkBefore + this.world.enemies.filter((e) => this.world.isOut(e)).length;
  }

  /** Encounter picker: restart (in setup) with this mix of enemy types, or null to go back to the campaign. */
  setEncounter(types: string[] | null): void {
    this.encounter = types && types.length ? [...types] : null;
    this.restart(false);
  }

  setSpeed(s: 1 | 2): void {
    this.speed = s;
    this.notify();
  }

  toggleDebug(): void {
    this.debug = !this.debug;
    this.notify();
  }

  // ------------------------------------------------------------ tuning persistence

  /** After a live tuning edit: keep setup in step (crew size changes the tray). */
  tuningChanged(): void {
    if (this.world.phase === 'ready' && this.arrangement.length !== this.crewSize()) this.setArrangement(this.arrangement);
  }

  /** Call after mutating `tuning` in place. */
  saveTuning(): void {
    safeSet(STORAGE_KEY, JSON.stringify(this.tuning));
  }

  /** Replace all values in place (the World holds a reference to this object). */
  replaceTuning(next: Tuning): void {
    const merged = mergeTuning(defaultTuning(), migrate(next));
    assignDeep(this.tuning, merged);
    this.saveTuning();
    this.tuningChanged();
    this.notify();
  }

  resetTuning(): void {
    this.replaceTuning(defaultTuning());
  }

  presets(): Record<string, Tuning> {
    try {
      return JSON.parse(safeGet(PRESETS_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  savePreset(name: string): void {
    const all = this.presets();
    all[name] = structuredClone(this.tuning);
    safeSet(PRESETS_KEY, JSON.stringify(all));
  }

  deletePreset(name: string): void {
    const all = this.presets();
    delete all[name];
    safeSet(PRESETS_KEY, JSON.stringify(all));
  }

  loadPreset(name: string): boolean {
    const p = this.presets()[name];
    if (!p) return false;
    this.replaceTuning(p);
    return true;
  }
}

/** Phase 2 saves had one `enemy` block: it becomes the Sloop's (standard) tuning. */
function migrate(saved: any): any {
  if (saved && typeof saved === 'object' && saved.enemy && !saved.ships) {
    const { enemy, ...rest } = saved;
    const ai = { preferredRange: saved.enemyAI?.preferredRange };
    return { ...rest, ships: { standard: { ...enemy, ai: ai.preferredRange === undefined ? undefined : ai } } };
  }
  return saved;
}

function assignDeep(target: Record<string, any>, source: Record<string, any>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object') assignDeep(target[k], v);
    else target[k] = v;
  }
}
