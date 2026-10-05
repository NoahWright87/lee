// Owns the live tuning, the current World, the run (or the sandbox), which
// screen is up, and session settings (speed, debug, pause). The Phaser scene
// and the DOM HUD both talk to this.
//
// Flow: MENU → choose ship → draft → starting part → REFIT → FIGHT → post-fight
// (results, level-ups, reward) → REFIT → ... until the boat sinks or the crew
// is gone (RUN OVER). The run is saved locally at every step outside a fight;
// reloading mid-fight returns to the refit before it. Sandbox mode is the old
// test bench: any ship, any part, any Lee, any encounter, free refit, nothing
// permanent.

import type { EnemySpec } from '../config/encounters';
import { ITEMS } from '../config/items';
import type { Facing } from '../config/slots';
import { defaultTuning, mergeTuning, TUNING_VERSION, type Tuning } from '../config/tuning';
import { defaultBuild } from '../sim/loadout';
import type { Vec } from '../sim/math';
import {
  addCrew,
  addItem,
  applyFight,
  autoArrangeRun,
  autoPickAll,
  chooseBonus,
  crewSpecs,
  draftPick,
  enemySetups,
  equip,
  finishPost,
  fixHomes,
  loadRun,
  newRun,
  release,
  saveRun,
  setFacing,
  setHome,
  setupFor,
  takeReward,
  takeStartPart,
  unequip,
  wearTrinket,
  type LoadResult,
  type RunState,
} from '../sim/run';
import type { BonusKey } from '../sim/levels';
import { enemySetup } from '../sim/setup';
import { World } from '../sim/world';

const STORAGE_KEY = 'lee.tuning.current';
const PRESETS_KEY = 'lee.tuning.presets';
const SPEED_KEY = 'lee.speeds';
const RUN_KEY = 'lee.run';
const SANDBOX_KEY = 'lee.sandbox';
/** Everything Reset All Saved Data removes (named tuning presets are kept). */
const RESET_KEYS = [STORAGE_KEY, SPEED_KEY, RUN_KEY, SANDBOX_KEY, 'lee.crew.arrangement', 'lee.crew.noteSeen'];

export type SpeedMode = 'ranged' | 'melee';
export type Mode = 'run' | 'sandbox';
export type Screen = 'menu' | 'chooseShip' | 'draft' | 'startPart' | 'refit' | 'fight' | 'post' | 'over';

/** Sandbox: a free run plus the encounter you're testing against. */
export interface SandboxState {
  run: RunState;
  enemies: EnemySpec[];
}

function loadSpeeds(): Record<SpeedMode, 1 | 2> {
  const out: Record<SpeedMode, 1 | 2> = { ranged: 1, melee: 1 };
  try {
    const saved = JSON.parse(safeGet(SPEED_KEY) ?? '{}');
    for (const k of ['ranged', 'melee'] as const) if (saved[k] === 2) out[k] = 2;
  } catch {
    /* defaults */
  }
  return out;
}

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

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: nothing persists */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* fine */
  }
}

type Listener = () => void;

export class Controller {
  tuning: Tuning;
  world: World;
  /**
   * Game speed, remembered separately for sailing (ranged) and for close combat
   * (while your boat is attached): 2x for the sailing doesn't carry into a boarding fight.
   */
  speeds: Record<SpeedMode, 1 | 2> = loadSpeeds();
  debug = false;
  /** True while the rotate-your-phone overlay is up. */
  blocked = false;
  /** True while the ⚙️ system menu is open (the fight pauses). */
  paused = false;
  /** Bumped every time a new World is built so views know to rebuild. */
  runId = 0;
  mode: Mode | null = null;
  screen: Screen = 'menu';
  /** The real run (null until one is started or continued). */
  run: RunState | null = null;
  sandbox: SandboxState | null = null;
  /** What the saved run looked like at startup (for the menu and the save-error message). */
  saved: LoadResult;
  /** Selected gun slot on the refit screen (its arc is drawn on the ocean). */
  arcPreview: string | null = null;
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
        const data = JSON.parse(saved);
        // Tuning from an older shape is dropped rather than half-merged.
        if (data?.meta?.version === TUNING_VERSION) this.tuning = mergeTuning(defaultTuning(), data);
      } catch {
        /* corrupt save: use defaults */
      }
    }
    this.saved = loadRun(safeGet(RUN_KEY));
    this.world = this.idleWorld();
  }

  /** The run being played or set up right now: the real run, or the sandbox's. */
  get active(): RunState | null {
    return this.mode === 'sandbox' ? this.sandbox?.run ?? null : this.run;
  }

  /** A quiet world behind the menus: a Sloop and nobody to fight yet. */
  private idleWorld(): World {
    return new World(this.tuning, 1, { enemies: [], assists: false });
  }

  // ------------------------------------------------------------ worlds

  /** Build the world for the next fight of the active run (setup mode until Launch). */
  private buildWorld(): void {
    const run = this.active;
    if (!run) {
      this.world = this.idleWorld();
    } else {
      fixHomes(run);
      const enemies = this.mode === 'sandbox' ? this.sandbox!.enemies.map((s, i) => enemySetup(s, this.tuning, { salt: i + 1 })) : enemySetups(run, this.tuning);
      this.world = new World(this.tuning, (run.seed + run.fight * 7919) >>> 0, {
        fight: run.fight,
        player: setupFor(run, this.tuning),
        enemies,
        assists: this.mode === 'sandbox',
      });
    }
    this.runId++;
  }

  /** After the active run changed in refit: rebuild the world, save, notify. */
  changed(rebuild = true): void {
    if (rebuild) this.buildWorld();
    this.persist();
    this.notify();
  }

  private persist(): void {
    if (this.mode === 'run' && this.run) safeSet(RUN_KEY, saveRun(this.run));
    if (this.mode === 'sandbox' && this.sandbox) safeSet(SANDBOX_KEY, JSON.stringify(this.sandbox));
  }

  // ------------------------------------------------------------ menu

  /** A saved run that can be continued (not finished). */
  canContinue(): boolean {
    return this.saved.ok && this.saved.run.stage !== 'over';
  }

  /** Start a new run: choose a ship. */
  newRun(): void {
    this.mode = 'run';
    this.run = null;
    this.paused = false;
    this.screen = 'chooseShip';
    this.world = this.idleWorld();
    this.runId++;
    this.notify();
  }

  chooseShip(ship: string): void {
    this.run = newRun(ship, (Math.random() * 2 ** 31) >>> 0);
    this.screen = 'draft';
    this.changed();
  }

  draft(type: string): void {
    if (!this.run) return;
    draftPick(this.run, type, this.tuning);
    if (this.run.stage === 'startPart') this.screen = 'startPart';
    this.changed();
  }

  takeStartPart(item: string): void {
    if (!this.run) return;
    takeStartPart(this.run, item, this.tuning);
    this.screen = 'refit';
    this.changed();
  }

  continueRun(): void {
    if (!this.saved.ok) return;
    this.mode = 'run';
    this.run = this.saved.run;
    this.paused = false;
    const stage = this.run.stage;
    this.screen = stage === 'draft' ? 'draft' : stage === 'startPart' ? 'startPart' : stage === 'post' ? 'post' : stage === 'over' ? 'over' : 'refit';
    this.changed();
  }

  enterSandbox(): void {
    this.mode = 'sandbox';
    this.paused = false;
    if (!this.sandbox) {
      try {
        const s = JSON.parse(safeGet(SANDBOX_KEY) ?? 'null') as SandboxState | null;
        const ok = s && loadRun(saveRun(s.run));
        if (s && ok && ok.ok) this.sandbox = { run: ok.run, enemies: Array.isArray(s.enemies) ? s.enemies : [] };
      } catch {
        /* start fresh */
      }
    }
    if (!this.sandbox) this.sandbox = freshSandbox(this.tuning);
    this.screen = 'refit';
    this.changed();
  }

  toMenu(): void {
    this.mode = null;
    this.screen = 'menu';
    this.paused = false;
    this.saved = loadRun(safeGet(RUN_KEY));
    this.world = this.idleWorld();
    this.runId++;
    this.notify();
  }

  // ------------------------------------------------------------ system menu

  setPaused(p: boolean): void {
    this.paused = p;
    this.notify();
  }

  /** Abandon the current run and go straight to choosing a ship. */
  restartRun(): void {
    safeRemove(RUN_KEY);
    this.saved = { ok: false, reason: 'none' };
    this.newRun();
  }

  /** Wipe everything stored locally (named tuning presets are kept) and go to the menu. */
  resetAll(): void {
    for (const k of RESET_KEYS) safeRemove(k);
    this.tuning = defaultTuning();
    this.run = null;
    this.sandbox = null;
    this.saved = { ok: false, reason: 'none' };
    this.toMenu();
  }

  // ------------------------------------------------------------ refit

  /** Equip an owned item (by uid) in a slot. Sandbox: an item id from the catalog makes a new one. */
  equip(what: number | string, slot: string): boolean {
    const run = this.active;
    if (!run) return false;
    const uid = typeof what === 'string' ? addItem(run, what).uid : what;
    const ok = equip(run, uid, slot);
    if (!ok && typeof what === 'string') run.items = run.items.filter((x) => x.uid !== uid);
    this.changed();
    return ok;
  }

  unequip(uid: number): void {
    const run = this.active;
    if (!run) return;
    unequip(run, uid);
    // Sandbox: nothing piles up in a cargo hold.
    if (this.mode === 'sandbox') run.items = run.items.filter((x) => x.uid !== uid);
    this.changed();
  }

  wear(what: number | string, member: number, index: number): boolean {
    const run = this.active;
    if (!run) return false;
    const uid = typeof what === 'string' ? addItem(run, what).uid : what;
    const ok = wearTrinket(run, uid, member, index);
    if (!ok && typeof what === 'string') run.items = run.items.filter((x) => x.uid !== uid);
    this.changed();
    return ok;
  }

  setFacing(slot: string, facing: Facing): void {
    const run = this.active;
    if (!run) return;
    setFacing(run, slot, facing);
    this.changed();
  }

  /** Put a crew member on a tile (null = ashore); whoever was there swaps. Doesn't rebuild the boat. */
  placeLee(member: number, tile: number | null): void {
    const run = this.active;
    if (!run) return;
    setHome(run, member, tile);
    if (this.world.phase === 'ready') this.world.placePlayerCrew(crewSpecs(run, this.tuning));
    this.changed(false);
  }

  clearCrew(): void {
    const run = this.active;
    if (!run) return;
    for (const m of run.crew) m.home = null;
    if (this.world.phase === 'ready') this.world.placePlayerCrew(crewSpecs(run, this.tuning));
    this.changed(false);
  }

  autoArrangeCrew(): void {
    const run = this.active;
    if (!run) return;
    autoArrangeRun(run, this.tuning);
    if (this.world.phase === 'ready') this.world.placePlayerCrew(crewSpecs(run, this.tuning));
    this.changed(false);
  }

  releaseLee(member: number): void {
    const run = this.active;
    if (!run) return;
    release(run, member);
    this.changed();
  }

  /** Sandbox: add any Lee type at any level. */
  addLee(type: string, level: number): void {
    const run = this.active;
    if (!run || this.mode !== 'sandbox') return;
    const m = addCrew(run, type, level, this.tuning);
    const used = new Set(run.crew.map((x) => x.home));
    m.home = this.world.player.grid.tiles.findIndex((t) => !used.has(t.index));
    if (m.home < 0) m.home = null;
    this.changed();
  }

  /** Sandbox: switch ship (default loadout, crew kept and re-arranged). */
  setShip(ship: string): void {
    if (this.mode !== 'sandbox' || !this.sandbox) return;
    const run = this.sandbox.run;
    run.ship = ship;
    run.items = run.items.filter((i) => ITEMS[i.item]?.category === 'trinket');
    run.loadout = {};
    run.facings = {};
    for (const [slot, item] of Object.entries(defaultBuild(ship).loadout)) run.loadout[slot] = addItem(run, item).uid;
    autoArrangeRun(run, this.tuning);
    this.changed();
  }

  /** Sandbox: the encounter to fight. */
  setSandboxEnemies(enemies: EnemySpec[]): void {
    if (!this.sandbox) return;
    this.sandbox.enemies = enemies;
    this.changed();
  }

  // ------------------------------------------------------------ fights

  /** Launch: the fight starts. */
  launch(): void {
    if (!this.active) return;
    if (this.world.phase === 'ready') this.world.placePlayerCrew(crewSpecs(this.active, this.tuning));
    this.world.start();
    this.screen = 'fight';
    this.arcPreview = null;
    this.notify();
  }

  /** The fight is over and its result screen dismissed: apply it to the run (or just go back, in the sandbox). */
  finishFight(): void {
    const run = this.active;
    const w = this.world;
    if (!run || !w.result) return;
    if (this.mode === 'sandbox') {
      this.screen = 'refit';
      this.changed();
      return;
    }
    applyFight(run, w.player.crew.lees, w.result.winner === 'player', this.tuning);
    this.screen = run.stage === 'over' ? 'over' : 'post';
    this.persist();
    this.notify();
  }

  chooseBonus(member: number, bonus: BonusKey): void {
    if (!this.run) return;
    chooseBonus(this.run, member, bonus);
    this.persist();
    this.notify();
  }

  autoPickAll(): void {
    if (!this.run) return;
    autoPickAll(this.run);
    this.persist();
    this.notify();
  }

  takeReward(index: number, releaseFirst?: number): boolean {
    if (!this.run) return false;
    const ok = takeReward(this.run, index, this.tuning, releaseFirst);
    this.persist();
    this.notify();
    return ok;
  }

  /** Done after a fight: back to the refit screen for the next one. */
  finishPost(): void {
    if (!this.run) return;
    finishPost(this.run);
    this.screen = 'refit';
    this.changed();
  }

  // ------------------------------------------------------------ listeners

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

  /** Which speed setting applies right now. */
  speedMode(): SpeedMode {
    return this.world.phase === 'running' && this.world.isAttached(this.world.player) ? 'melee' : 'ranged';
  }

  /** Current game speed. */
  get speed(): 1 | 2 {
    return this.speeds[this.speedMode()];
  }

  setSpeed(s: 1 | 2): void {
    this.speeds[this.speedMode()] = s;
    safeSet(SPEED_KEY, JSON.stringify(this.speeds));
    this.notify();
  }

  toggleDebug(): void {
    this.debug = !this.debug;
    this.notify();
  }

  // ------------------------------------------------------------ tuning persistence

  /** After a live tuning edit: in setup, rebuild so "next fight" values show. */
  tuningChanged(): void {
    if (this.world.phase === 'ready' && this.active) this.buildWorld();
  }

  /** Call after mutating `tuning` in place. */
  saveTuning(): void {
    safeSet(STORAGE_KEY, JSON.stringify(this.tuning));
  }

  /** Replace all values in place (the World holds a reference to this object). */
  replaceTuning(next: Tuning): void {
    const ok = (next as { meta?: { version?: number } })?.meta?.version === TUNING_VERSION;
    const merged = ok ? mergeTuning(defaultTuning(), next) : defaultTuning();
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

/** A new sandbox: the Sloop, a mixed crew, against a lone Sloop. */
function freshSandbox(t: Tuning): SandboxState {
  const run = newRun('sloop', 12345);
  run.stage = 'refit';
  for (const type of ['quick', 'handy', 'deft', 'hard', 'loud', 'basic']) addCrew(run, type, 1, t);
  autoArrangeRun(run, t);
  return { run, enemies: [{ ship: 'sloop', ai: 'standard', crew: [{ type: 'basic', count: 4 }] }] };
}

function assignDeep(target: Record<string, any>, source: Record<string, any>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object' && !Array.isArray(v)) assignDeep(target[k], v);
    else target[k] = v;
  }
}
