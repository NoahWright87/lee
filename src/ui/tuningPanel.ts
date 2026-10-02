// Live slider panel over the ocean view. Built by walking the Tuning object,
// so any new number added to src/config/tuning.ts shows up automatically.

import GUI, { type Controller as GuiController } from 'lil-gui';
import type { Controller } from '../game/Controller';

type Range = [min: number, max: number, step: number];

/** Slider ranges by key name. Unknown keys get an automatic range. */
const RANGES: Record<string, Range> = {
  cruiseSpeed: [2, 30, 0.5],
  idleSpeed: [0, 10, 0.5],
  acceleration: [0.5, 15, 0.5],
  drag: [0, 5, 0.1],
  turnRate: [5, 90, 1],
  turnAcceleration: [10, 400, 5],
  lateralDrag: [0.2, 10, 0.1],
  turnSpeedLoss: [0, 0.8, 0.01],
  orbitRadiusScale: [0.8, 3, 0.05],
  orbitCapture: [0, 5, 0.1],
  hp: [1, 400, 1],
  waterCapacity: [1, 200, 1],
  leakMultiplier: [0, 5, 0.05],
  perSide: [0, 4, 1],
  reloadTime: [0.3, 10, 0.1],
  range: [20, 300, 5],
  arc: [5, 90, 1],
  damage: [1, 60, 1],
  spread: [0, 20, 0.25],
  flightTimeBase: [0.2, 5, 0.05],
  flightTimePerMeter: [0, 0.03, 0.0005],
  impactRadius: [0, 5, 0.1],
  cannonOfflineAt: [0, 1, 0.05],
  engineMinFactor: [0, 1, 0.05],
  leakRate: [0, 10, 0.1],
  spreadRate: [0, 5, 0.05],
  bilgeRate: [0, 5, 0.05],
  sinkThreshold: [0.1, 1, 0.01],
  waterSpeedPenalty: [0, 1, 0.05],
  waterTurnPenalty: [0, 1, 0.05],
  waterCurveExponent: [0.3, 4, 0.1],
  playerAdvantage: [0.5, 3, 0.05],
  previewHorizon: [1, 10, 0.25],
  sinkDuration: [0.5, 6, 0.1],
  resultDelay: [0, 4, 0.1],
  dodgeRadiusHulls: [0.5, 5, 0.1],
  enemyStartNorth: [50, 600, 10],
  enemyStartEast: [-400, 400, 10],
  preferredRange: [20, 250, 5],
  rangeCorrection: [0, 4, 0.1],
  lookAhead: [20, 200, 5],
  orbitDirection: [-1, 1, 1],
  rangeJitter: [0, 60, 1],
  spacing: [0, 200, 5],
  firstFightEnemies: [1, 8, 1],
  enemiesAddedPerFight: [0, 3, 0.25],
  maxEnemies: [1, 10, 1],
  spawnSpread: [0, 90, 1],
  repairBetweenFights: [0, 1, 0.05],
  nextFightDelay: [0, 10, 0.5],
  friendlyFire: [0, 1, 1],
  maxIncomingShells: [0, 10, 1],
  packHullScaling: [0, 1.5, 0.05],
  packReloadScaling: [0, 1.5, 0.05],
  minWarningTime: [0, 4, 0.05],
  ringStartRadius: [3, 60, 1],
  markerSize: [1, 15, 0.5],
  fadeInTime: [0, 1, 0.01],
  lingerTime: [0, 2, 0.05],
  enemyBias: [0, 1, 0.05],
  minVisibleHeight: [80, 800, 10],
  maxVisibleHeight: [100, 1500, 10],
  padding: [0, 200, 5],
  smoothing: [0.1, 10, 0.1],
  stripBoatFill: [0.3, 1, 0.01],
  targetFollowsCamera: [0, 1, 1],
  shellArcHeight: [0, 40, 1],
  oceanReloadRings: [0, 1, 1],
};

/** Keys read only when a fight is built. */
const NEXT_RUN = /(^|\.)(parts\..*|cannons\.perSide|global\.enemyStart\w+|campaign\.(packHullScaling|firstFightEnemies|enemiesAddedPerFight|maxEnemies|spawnSpread|repairBetweenFights)|enemyAI\.rangeJitter)$/;

const FOLDER_NAMES: Record<string, string> = {
  global: 'Global',
  player: 'Player boat',
  enemy: 'Enemy boat',
  enemyAI: 'Enemy AI',
  campaign: 'Fights & progression',
  telegraph: 'Telegraph (red X)',
  camera: 'Camera',
  input: 'Input',
  visuals: 'Visuals',
  movement: 'Movement',
  parts: 'Parts (next fight)',
  cannons: 'Cannons',
  function: 'Part function loss',
  flooding: 'Flooding & sinking',
};

function autoRange(v: number): Range {
  if (v === 0) return [0, 1, 0.01];
  const hi = Math.abs(v) * 4;
  return [v < 0 ? -hi : 0, hi, Math.abs(v) >= 10 ? 1 : 0.01];
}

export class TuningPanel {
  readonly root: HTMLDivElement;
  private gui: GUI;
  private ctl: Controller;
  private presetState = { name: 'my preset', load: '' };
  private loadCtl: GuiController | null = null;

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = document.createElement('div');
    this.root.className = 'tune-panel hidden';

    const bar = document.createElement('div');
    bar.className = 'tune-bar';
    const title = document.createElement('span');
    title.textContent = 'Tuning';
    const restart = document.createElement('button');
    restart.className = 'hud-btn';
    restart.textContent = 'Restart';
    restart.onclick = () => ctl.restart(false);
    const close = document.createElement('button');
    close.className = 'hud-btn';
    close.textContent = 'Close';
    close.onclick = () => this.close();
    bar.append(title, restart, close);

    const body = document.createElement('div');
    body.className = 'tune-body';
    this.root.append(bar, body);

    this.gui = new GUI({ container: body, title: 'Values (saved automatically)', width: 0 });
    this.gui.domElement.style.width = '100%';
    this.buildFolder(this.gui, ctl.tuning as unknown as Record<string, unknown>, '');
    this.buildPresets();
    this.gui.folders.forEach((f, i) => {
      if (i > 0) f.close();
    });
  }

  private buildFolder(gui: GUI, obj: Record<string, unknown>, path: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const p = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') {
        const folder = gui.addFolder(FOLDER_NAMES[key] ?? key);
        this.buildFolder(folder, value as Record<string, unknown>, p);
        if (path) folder.close();
        continue;
      }
      if (typeof value !== 'number') continue;
      const [min, max, step] = RANGES[key] ?? autoRange(value);
      const label = NEXT_RUN.test(p) && !p.includes('.parts.') ? `${key} (next fight)` : key;
      gui
        .add(obj, key, Math.min(min, value), Math.max(max, value), step)
        .name(label)
        .onChange(() => this.ctl.saveTuning());
    }
  }

  private buildPresets(): void {
    const f = this.gui.addFolder('Presets');
    const actions = {
      save: () => {
        const name = this.presetState.name.trim();
        if (!name) return;
        this.ctl.savePreset(name);
        this.refreshPresetList();
      },
      load: () => {
        if (this.ctl.loadPreset(this.presetState.load)) this.refreshValues();
      },
      remove: () => {
        this.ctl.deletePreset(this.presetState.load);
        this.refreshPresetList();
      },
      exportJson: async () => {
        const json = JSON.stringify(this.ctl.tuning);
        try {
          await navigator.clipboard.writeText(json);
          alert('Tuning copied to clipboard.');
        } catch {
          prompt('Copy this tuning JSON:', json);
        }
      },
      importJson: () => {
        const json = prompt('Paste tuning JSON:');
        if (!json) return;
        try {
          this.ctl.replaceTuning(JSON.parse(json));
          this.refreshValues();
        } catch {
          alert('That is not valid tuning JSON.');
        }
      },
      reset: () => {
        if (!confirm('Reset every value to its default?')) return;
        this.ctl.resetTuning();
        this.refreshValues();
      },
    };
    f.add(this.presetState, 'name').name('Preset name');
    f.add(actions, 'save').name('Save preset');
    this.loadCtl = f.add(this.presetState, 'load', this.presetNames()).name('Preset');
    f.add(actions, 'load').name('Load preset');
    f.add(actions, 'remove').name('Delete preset');
    f.add(actions, 'exportJson').name('Export (copy JSON)');
    f.add(actions, 'importJson').name('Import (paste JSON)');
    f.add(actions, 'reset').name('Reset all to defaults');
  }

  private presetNames(): string[] {
    const names = Object.keys(this.ctl.presets());
    return names.length ? names : [''];
  }

  private refreshPresetList(): void {
    const names = this.presetNames();
    if (!names.includes(this.presetState.load)) this.presetState.load = names[0];
    if (this.loadCtl) this.loadCtl = this.loadCtl.options(names).name('Preset');
  }

  private refreshValues(): void {
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
  }

  open(): void {
    this.refreshValues();
    this.refreshPresetList();
    this.root.classList.remove('hidden');
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  toggle(): void {
    if (this.root.classList.contains('hidden')) this.open();
    else this.close();
  }
}
