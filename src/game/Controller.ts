// Owns the live tuning, the current World, the run (or the sandbox), which
// screen is up, and session settings (speed, debug, pause). The Phaser scene
// and the DOM HUD both talk to this.
//
// Flow: MENU → choose a ship and a difficulty (a preset ship, or Custom) →
// PORT (shop, heal, repair, choose where to sail) → SEA MAP (tap a stop in
// reach) → a fight stop: REFIT → FIGHT → post-fight (results, level-ups,
// surrender, special pick) → back to the MAP; an event stop: its post screen →
// MAP; the destination: the next PORT... endless, until the boat sinks or the
// crew is gone (RUN OVER). Refit is open from the map and the port too.
// The run is saved locally at every step outside a fight; reloading mid-fight
// returns to the refit before it. Sandbox mode is the old test bench: any
// ship, any part, any Lee, any encounter (or a generated one), free refit,
// nothing permanent.

import type { EnemySpec } from '../config/encounters';
import { ITEMS } from '../config/items';
import type { Facing } from '../config/slots';
import { defaultTuning, mergeTuning, TUNING_VERSION, type Tuning } from '../config/tuning';
import type { Boat } from '../sim/boat';
import { presetBuild } from '../sim/loadout';
import { applyMove, stow as stowPick, type Dest, type Displaced, type Pick } from '../sim/stack';
import type { Vec } from '../sim/math';
import {
  addCrew,
  addItem,
  answerSurrender,
  pickCapture,
  skipCapture,
  applyFight,
  blankRun,
  cargo,
  autoArrangeRun,
  autoEquipAll,
  autoPickAll,
  chooseBonus,
  crewSpecs,
  discard,
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
  skipReward,
  takeReward,
  unequip,
  wearTrinket,
  type LoadResult,
  type RunState,
} from '../sim/run';
import { buy, buyChassis, buyHeal, buyHealAll, buyRepair, enterPort, makePlan, reroll, sell, type Shop } from '../sim/port';
import { leavePort, sailTo } from '../sim/seaMap';
import { generateEnemies } from '../sim/budget';
import { structureFraction } from '../sim/boat';
import { rngFor } from '../sim/math';
import type { BonusKey } from '../sim/levels';
import { enemySetup } from '../sim/setup';
import type { Job } from '../config/lees';
import type { Lee } from '../sim/crew';
import type { NessSpec } from '../sim/ness';
import { World } from '../sim/world';
import { difficulty, DIFFICULTIES } from '../config/difficulty';

const STORAGE_KEY = 'lee.tuning.current';
const PRESETS_KEY = 'lee.tuning.presets';
const SPEED_KEY = 'lee.speeds';
const ZOOM_KEY = 'lee.zoom';
const RUN_KEY = 'lee.run';
const SANDBOX_KEY = 'lee.sandbox';
/** Everything Reset All Saved Data removes (named tuning presets are kept). */
const RESET_KEYS = [STORAGE_KEY, SPEED_KEY, ZOOM_KEY, RUN_KEY, SANDBOX_KEY, 'lee.crew.arrangement', 'lee.crew.noteSeen'];

export type SpeedMode = 'ranged' | 'melee';
export type Mode = 'run' | 'sandbox';
export type Screen = 'menu' | 'chooseShip' | 'port' | 'map' | 'refit' | 'fight' | 'post' | 'over';
/** What the refit screen is for: setting up a fight (LAUNCH), or a look between stops (DONE back to the map or port). */
export type RefitFor = 'fight' | 'map' | 'port';

/** Sandbox: a free run plus the encounter you're testing against. */
export interface SandboxState {
  run: RunState;
  enemies: EnemySpec[];
  /** Sea monsters to fight alongside (or instead of) the ships. */
  nesses: NessSpec[];
}

/** The speed button cycles Pause → 0.5× → 1× → 3×. */
export const SPEEDS = [0, 0.5, 1, 3] as const;
export type Speed = (typeof SPEEDS)[number];

function loadSpeeds(): Record<SpeedMode, Speed> {
  const out: Record<SpeedMode, Speed> = { ranged: 1, melee: 1 };
  try {
    const saved = JSON.parse(safeGet(SPEED_KEY) ?? '{}');
    // Pause is never remembered across reloads.
    for (const k of ['ranged', 'melee'] as const) if (SPEEDS.includes(saved[k]) && saved[k] > 0) out[k] = saved[k];
  } catch {
    /* defaults */
  }
  return out;
}

/** Zoom choices for the two views (the ocean on top, the deck below). "Normal" is the original framing; the rest scale it. */
export interface ZoomChoice {
  id: string;
  label: string;
  mul: number;
  /** The camera frames what's in play by itself (the multiplier is not used). */
  fit?: boolean;
}
/** Ocean: a multiplier on how much sea is shown (bigger = further out), or Fit: every boat that could be fighting you. */
export const OCEAN_ZOOMS: ZoomChoice[] = [
  { id: 'closer', label: 'Closer', mul: 0.75 },
  { id: 'normal', label: 'Normal', mul: 1 },
  { id: 'wider', label: 'Wider', mul: 1.4 },
  { id: 'widest', label: 'Widest', mul: 2 },
  { id: 'fit', label: 'Fit', mul: 1, fit: true },
];
/** Deck: a multiplier on how big the deck is drawn (bigger = closer; the ends of a long ship can run off the screen), or Fit: every deck with Lees in play. */
export const DECK_ZOOMS: ZoomChoice[] = [
  { id: 'wider', label: 'Wider', mul: 0.8 },
  { id: 'normal', label: 'Normal', mul: 1 },
  { id: 'closer', label: 'Closer', mul: 1.3 },
  { id: 'closest', label: 'Closest', mul: 1.7 },
  { id: 'fit', label: 'Fit', mul: 1, fit: true },
];
export type ZoomKind = 'ocean' | 'deck';

function loadZoom(): Record<ZoomKind, string> {
  const out: Record<ZoomKind, string> = { ocean: 'normal', deck: 'normal' };
  try {
    const saved = JSON.parse(safeGet(ZOOM_KEY) ?? '{}');
    if (OCEAN_ZOOMS.some((z) => z.id === saved.ocean)) out.ocean = saved.ocean;
    if (DECK_ZOOMS.some((z) => z.id === saved.deck)) out.deck = saved.deck;
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
   * (the close-up open): 3× for the sailing doesn't carry into a boarding fight.
   */
  speeds: Record<SpeedMode, Speed> = loadSpeeds();
  /** Which zoom the top (ocean) and bottom (deck) views use; remembered. */
  zoom: Record<ZoomKind, string> = loadZoom();
  debug = false;
  /** True while the rotate-your-phone overlay is up. */
  blocked = false;
  /** True while the ⚙️ system menu is open (the fight pauses). */
  paused = false;
  /** Bumped every time a new World is built so views know to rebuild. */
  runId = 0;
  mode: Mode | null = null;
  screen: Screen = 'menu';
  refitFor: RefitFor = 'fight';
  /** The real run (null until one is started or continued). */
  run: RunState | null = null;
  sandbox: SandboxState | null = null;
  /** What the saved run looked like at startup (for the menu and the save-error message). */
  saved: LoadResult;
  /**
   * Refit gun arcs on the ocean: every gun's arc in grey; the selected gun's
   * old arc in red and, while a move is previewed, its new arc in green
   * (drawn from `boat`, the previewed build).
   */
  arcPreview: { oldSlot: string | null; newSlot: string | null; boat: Boat | null } | null = null;
  /** Ocean share of the screen right now (animates between setup and fight). Written by the scene. */
  oceanFrac = 0.75;
  stripProjection: StripProjection | null = null;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<Listener>();
  private toastListeners = new Set<(text: string) => void>();
  /** The deck view's tap targets right now, with where each is on screen (CSS px). Set by the scene; tests and tools read it. */
  tapTargets: () => { id: string; kind: string; label: string; css: { x: number; y: number } | null }[] = () => [];

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

  /** A quiet world behind the menus: a Basic Ship and nobody to fight yet. */
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
      const sandbox = this.mode === 'sandbox';
      const enemies = sandbox ? this.sandbox!.enemies.map((s, i) => enemySetup(s, this.tuning, { salt: i + 1 })) : this.refitFor === 'fight' ? enemySetups(run, this.tuning) : [];
      this.world = new World(this.tuning, (run.seed + run.fight * 7919) >>> 0, {
        fight: run.fight,
        player: setupFor(run, this.tuning),
        enemies,
        nesses: sandbox ? this.sandbox!.nesses : undefined,
        assists: sandbox,
        hesitation: difficulty(run.difficulty).hesitation,
        surrender: difficulty(run.difficulty).surrender,
        // The hull's damage carries (the sandbox always sails a fresh boat).
        carry: sandbox ? undefined : { hp: run.hull, water: run.hull.map(() => 0) },
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

  /** Choose a ship: it comes with its preset (loadout and crew) and a little gold, in the first port. */
  chooseShip(ship: string, diff = 'normal'): void {
    const run = newRun(ship, (Math.random() * 2 ** 31) >>> 0, this.tuning, diff);
    enterPort(run, makePlan(rngFor(run.seed, 'first port'), run, this.tuning, new Set()), this.tuning);
    run.stage = 'port';
    this.run = run;
    this.showStage();
    this.changed();
  }

  /** Custom start: no ship, a big purse, and a port that has everything. */
  customStart(diff = 'normal'): void {
    const run = blankRun('basic', (Math.random() * 2 ** 31) >>> 0, diff);
    run.noHull = true;
    run.gold = Math.round(Math.max(0, this.tuning.economy.customGold) * (DIFFICULTIES[diff]?.gold ?? 1));
    enterPort(run, makePlan(rngFor(run.seed, 'first port'), run, this.tuning, new Set()), this.tuning, { full: true });
    run.stage = 'port';
    this.run = run;
    this.showStage();
    this.changed();
  }

  /** Show the screen for where the run is. */
  private showStage(): void {
    const run = this.run;
    if (!run) return;
    const stage = run.stage;
    this.screen = stage === 'post' ? 'post' : stage === 'over' ? 'over' : stage === 'port' ? 'port' : stage === 'map' ? 'map' : 'refit';
    this.refitFor = 'fight';
  }

  continueRun(): void {
    if (!this.saved.ok) return;
    this.mode = 'run';
    this.run = this.saved.run;
    this.paused = false;
    this.showStage();
    this.changed();
  }

  enterSandbox(): void {
    this.mode = 'sandbox';
    this.paused = false;
    if (!this.sandbox) {
      try {
        const s = JSON.parse(safeGet(SANDBOX_KEY) ?? 'null') as SandboxState | null;
        const ok = s && loadRun(saveRun(s.run));
        if (s && ok && ok.ok) this.sandbox = { run: ok.run, enemies: Array.isArray(s.enemies) ? s.enemies : [], nesses: Array.isArray(s.nesses) ? s.nesses : [] };
      } catch {
        /* start fresh */
      }
    }
    if (!this.sandbox) this.sandbox = freshSandbox(this.tuning);
    this.screen = 'refit';
    this.refitFor = 'fight';
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

  /** Move something on the refit screen (commit). Sandbox catalog items are made first. Returns what else moved. */
  move(pick: Pick | { from: 'catalog'; item: string }, dest: Dest): Displaced[] {
    const run = this.active;
    if (!run) return [];
    let p: Pick;
    if (pick.from === 'catalog') p = { from: 'cargo', uid: addItem(run, pick.item).uid };
    else p = pick;
    const out = applyMove(run, p, dest, this.tuning);
    this.dropSandboxCargo();
    this.changed();
    return out;
  }

  /** Stow a thing from the boat (a Lee goes ashore, an item to cargo). */
  stow(pick: Pick): void {
    const run = this.active;
    if (!run) return;
    stowPick(run, pick);
    this.dropSandboxCargo();
    this.changed();
  }

  /** Auto-equip: everything in cargo into empty spots, Lees ashore onto free tiles. Nothing placed moves. */
  autoEquip(): void {
    const run = this.active;
    if (!run) return;
    autoEquipAll(run, this.tuning);
    this.changed();
  }

  /** Sandbox: nothing piles up in a cargo hold (Lees ashore stay). */
  private dropSandboxCargo(): void {
    if (this.mode !== 'sandbox' || !this.sandbox) return;
    const run = this.sandbox.run;
    const loose = new Set(cargo(run).map((x) => x.uid));
    run.items = run.items.filter((x) => !loose.has(x.uid));
  }

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
    const build = presetBuild(ship);
    run.facings = { ...(build.facings ?? {}) };
    for (const [slot, item] of Object.entries(build.loadout)) run.loadout[slot] = addItem(run, item).uid;
    (build.treasures ?? []).forEach((item, i) => (run.loadout[`treasure:${i}`] = addItem(run, item).uid));
    autoArrangeRun(run, this.tuning);
    this.changed();
  }

  /** Sandbox: generate an enemy from a budget (optionally on a given chassis), the way the sea does. */
  generateSandbox(budget: number, chassis?: string): void {
    if (!this.sandbox) return;
    this.sandbox.enemies = generateEnemies(budget, (Math.random() * 2 ** 31) >>> 0, this.tuning, { chassis });
    this.changed();
  }

  /** Sandbox: the sea monsters to fight. */
  setSandboxNesses(nesses: NessSpec[]): void {
    if (!this.sandbox) return;
    this.sandbox.nesses = nesses;
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
    if (!this.active || this.refitFor !== 'fight') return;
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
    applyFight(
      run,
      {
        won: w.result.winner === 'player',
        lees: w.player.crew.lees,
        enemies: w.enemyOutcomes(),
        lastEnemy: w.lastEnemyStanding(),
        joined: w.defectors(),
        hull: w.player.parts.map((p) => structureFraction(p)),
      },
      this.tuning,
    );
    this.screen = run.stage === 'over' ? 'over' : 'post';
    this.persist();
    this.notify();
  }

  /** Take a part from a captured ship. */
  pickCapture(capture: number, item: string): boolean {
    if (!this.run) return false;
    const ok = pickCapture(this.run, capture, item);
    this.persist();
    this.notify();
    return ok;
  }

  skipCapture(capture: number): void {
    if (!this.run) return;
    skipCapture(this.run, capture);
    this.persist();
    this.notify();
  }

  answerSurrender(accept: boolean, releaseFirst?: number): boolean {
    if (!this.run) return false;
    const ok = answerSurrender(this.run, accept, this.tuning, releaseFirst);
    this.persist();
    this.notify();
    return ok;
  }

  skipReward(): void {
    if (!this.run) return;
    skipReward(this.run);
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

  /** Done after a fight or event: back to the sea map. */
  finishPost(): void {
    if (!this.run) return;
    finishPost(this.run);
    this.showStage();
    this.changed();
  }

  // ------------------------------------------------------------ port and map

  /** Run something on the run, then save and redraw (rebuilding the boat if asked). */
  private act<T>(fn: (run: RunState) => T, rebuild = false): T | undefined {
    if (!this.run) return undefined;
    const out = fn(this.run);
    this.changed(rebuild);
    return out;
  }

  buy(shop: Shop | 'tavern', index: number): boolean {
    return !!this.act((r) => buy(r, shop, index, this.tuning));
  }

  sell(uid: number): boolean {
    return !!this.act((r) => sell(r, uid, this.tuning));
  }

  reroll(shop: Shop | 'tavern'): boolean {
    return !!this.act((r) => reroll(r, shop, this.tuning));
  }

  repair(): boolean {
    return !!this.act((r) => buyRepair(r, this.tuning), true);
  }

  heal(member?: number): boolean {
    return !!this.act((r) => (member === undefined ? buyHealAll(r, this.tuning) : buyHeal(r, member, this.tuning)));
  }

  buyChassis(ship: string): boolean {
    return !!this.act((r) => buyChassis(r, ship, this.tuning), true);
  }

  /** Throw (or leave behind) an item in cargo for good. */
  discard(uid: number): void {
    this.act((r) => discard(r, uid));
  }

  /** Leave port for one of its destinations: onto the sea map. */
  leavePort(offer: number): boolean {
    const ok = !!this.act((r) => leavePort(r, offer, this.tuning));
    if (ok) this.showStage();
    this.notify();
    return ok;
  }

  /** Sail to a stop on the map. A fight opens its refit; an event its post screen; the destination its port. */
  sailTo(stop: number): boolean {
    const ok = !!this.act((r) => sailTo(r, stop, this.tuning));
    if (ok) {
      this.showStage();
      this.changed();
    }
    return ok;
  }

  /** Refit between stops (from the map or a port): no fight, DONE goes back. */
  openRefit(): void {
    if (!this.run || this.run.noHull) return;
    this.refitFor = this.run.stage === 'port' ? 'port' : 'map';
    this.screen = 'refit';
    this.changed();
  }

  /** DONE in a refit between stops. */
  closeRefit(): void {
    this.showStage();
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

  /** Show a short message in the HUD (a tap that couldn't be taken, and why). */
  toast(text: string): void {
    for (const fn of this.toastListeners) fn(text);
  }

  onToast(fn: (text: string) => void): () => void {
    this.toastListeners.add(fn);
    return () => this.toastListeners.delete(fn);
  }

  frame(): void {
    for (const fn of this.frameListeners) fn();
  }

  /** Which speed setting the button changes right now: close combat once the blend is more than half done. */
  speedMode(): SpeedMode {
    return this.world.phase === 'running' && this.world.speedBlend() > 0.5 ? 'melee' : 'ranged';
  }

  /** The speed setting shown on the button (0 = paused by it). */
  get speed(): Speed {
    return this.speeds[this.speedMode()];
  }

  /** The game speed the sim actually runs at: the sailing setting blended into the close-combat one as an enemy comes in range. */
  get effectiveSpeed(): number {
    if (this.world.phase !== 'running') return this.speeds.ranged;
    const set = this.speed;
    if (set === 0) return 0;
    const k = this.world.speedBlend();
    return this.speeds.ranged + (this.speeds.melee - this.speeds.ranged) * k;
  }

  /** The multiplier for a view's chosen zoom. */
  zoomMul(kind: ZoomKind): number {
    const list = kind === 'ocean' ? OCEAN_ZOOMS : DECK_ZOOMS;
    return list.find((z) => z.id === this.zoom[kind])?.mul ?? 1;
  }

  /** Is this view on "Fit": the camera frames everything in play by itself? */
  zoomFit(kind: ZoomKind): boolean {
    const list = kind === 'ocean' ? OCEAN_ZOOMS : DECK_ZOOMS;
    return list.find((z) => z.id === this.zoom[kind])?.fit === true;
  }

  setZoom(kind: ZoomKind, id: string): void {
    const list = kind === 'ocean' ? OCEAN_ZOOMS : DECK_ZOOMS;
    if (!list.some((z) => z.id === id)) return;
    this.zoom[kind] = id;
    safeSet(ZOOM_KEY, JSON.stringify(this.zoom));
    this.notify();
  }

  /** The speed button: Pause → 0.5× → 1× → 3× → Pause… */
  cycleSpeed(): void {
    const mode = this.speedMode();
    const i = SPEEDS.indexOf(this.speeds[mode]);
    this.speeds[mode] = SPEEDS[(i + 1) % SPEEDS.length];
    safeSet(SPEED_KEY, JSON.stringify(this.speeds));
    this.notify();
  }

  /** An action button (a tap, or a repeat while held). Returns the Lee moved, or null. */
  order(job: Job): Lee | null {
    const w = this.world;
    if (w.phase !== 'running' || w.result) return null;
    // ⏩ while connected reads RETREAT, but it only puts a Lee on the oars: the lines have to be cut (a tap on each) and you steer away.
    return w.order(job);
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

/** A new sandbox: the Basic Ship's preset plus a Hard and a Loud Lee, against a lone Basic Ship. */
function freshSandbox(t: Tuning): SandboxState {
  const run = newRun('basic', 12345, t);
  for (const type of ['hard', 'loud']) addCrew(run, type, 1, t);
  autoEquipAll(run, t);
  return { run, enemies: [{ ship: 'basic', ai: 'standard', crew: [{ type: 'basic', count: 4 }] }], nesses: [] };
}

function assignDeep(target: Record<string, any>, source: Record<string, any>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object' && !Array.isArray(v)) assignDeep(target[k], v);
    else target[k] = v;
  }
}
