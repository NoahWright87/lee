// Owns the live tuning, the current World, and run-level settings (speed,
// debug). The Phaser scene and the DOM HUD both talk to this.

import { defaultTuning, mergeTuning, type Tuning } from '../config/tuning';
import { World } from '../sim/world';

const STORAGE_KEY = 'lee.tuning.current';
const PRESETS_KEY = 'lee.tuning.presets';

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
  /** Bumped on every restart so views know to rebuild. */
  runId = 0;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<Listener>();

  constructor() {
    this.tuning = defaultTuning();
    const saved = safeGet(STORAGE_KEY);
    if (saved) {
      try {
        this.tuning = mergeTuning(defaultTuning(), JSON.parse(saved));
      } catch {
        /* corrupt save: use defaults */
      }
    }
    this.world = new World(this.tuning);
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
    this.world.start();
    this.notify();
  }

  /** New fight with the current tuning. `running` skips the START screen. */
  restart(running = false): void {
    this.world = new World(this.tuning);
    this.runId++;
    if (running) this.world.start();
    this.notify();
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

  /** Call after mutating `tuning` in place. */
  saveTuning(): void {
    safeSet(STORAGE_KEY, JSON.stringify(this.tuning));
  }

  /** Replace all values in place (the World holds a reference to this object). */
  replaceTuning(next: Tuning): void {
    const merged = mergeTuning(defaultTuning(), next);
    assignDeep(this.tuning, merged);
    this.saveTuning();
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

function assignDeep(target: Record<string, any>, source: Record<string, any>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object') assignDeep(target[k], v);
    else target[k] = v;
  }
}
