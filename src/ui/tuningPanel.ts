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
  size: [0, 15, 1],
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
  markerStartScale: [1, 5, 0.1],
  turnLead: [0, 1.5, 0.05],
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
  playerCrewStats: [0.25, 3, 0.05],
  repairRate: [0, 20, 0.1],
  bailRate: [0, 10, 0.1],
  walkSpeed: [0.5, 15, 0.25],
  oarBaseline: [0, 1, 0.05],
  sailBaseline: [0, 1, 0.05],
  mobilityCap: [1, 3, 0.05],
  lookoutRange: [0, 1, 0.05],
  repairCeiling: [0, 1, 0.05],
  wreckedRepairable: [0, 1, 1],
  hitDamage: [0, 60, 1],
  splashFraction: [0, 1, 0.05],
  wetThreshold: [0, 1, 0.05],
  wetSlowdown: [0, 1, 0.05],
  thinkInterval: [0.05, 2, 0.05],
  stickiness: [0, 100, 1],
  commitTime: [0, 10, 0.1],
  arcLookahead: [0, 5, 0.1],
  homeBonus: [0, 100, 1],
  roleBonus: [0, 100, 1],
  standbyBonus: [0, 100, 1],
  walkPenalty: [0, 20, 0.5],
  helpPenalty: [0, 100, 1],
  statAffinity: [0, 50, 1],
  floodPartAt: [0, 1, 0.05],
  floodSinkAt: [0, 1, 0.05],
  moderateWaterAt: [0, 1, 0.01],
  bailStopAt: [0, 0.5, 0.01],
  flooding: [0, 150, 1],
  functionDamage: [0, 150, 1],
  engageCannon: [0, 150, 1],
  otherDamage: [0, 150, 1],
  mobility: [0, 150, 1],
  lookout: [0, 150, 1],
  idleCannon: [0, 150, 1],
  severitySpan: [0, 50, 1],
  setupOceanFraction: [0.3, 0.75, 0.01],
  expandedOceanFraction: [0.25, 0.75, 0.01],
  minRange: [0, 120, 1],
  seekAttach: [0, 1, 1],
  ramLine: [0, 60, 1],
  ramRange: [0, 200, 5],
  introFights: [0, 1, 1],
  dockDistance: [0, 20, 0.5],
  grappleTime: [0, 5, 0.1],
  dockRelSpeed: [0, 15, 0.25],
  dockEaseTime: [0, 3, 0.05],
  dockGap: [0, 5, 0.1],
  ramSpeed: [0, 20, 0.5],
  ramDamage: [0, 10, 0.1],
  ramSelfDamage: [0, 2, 0.05],
  ramMaxAngle: [0, 89, 1],
  ramWarnTime: [0, 4, 0.1],
  ramMinWarning: [0, 3, 0.05],
  bounce: [0, 1, 0.05],
  cap: [0, 4, 1],
  perSide: [1, 2, 1],
  driftSpeed: [0, 8, 0.1],
  driftDecay: [0, 5, 0.1],
  recallWindow: [0, 6, 0.1],
  pushSpeed: [0, 15, 0.25],
  redockDelay: [0, 10, 0.5],
  alongsideGrab: [0, 30, 1],
  swingTime: [0.1, 4, 0.05],
  swingHittable: [0, 1, 1],
  evacuateAt: [0, 1, 0.05],
  minHomeCrew: [0, 10, 1],
  repelHelpPenalty: [0, 100, 1],
  tileCap: [1, 6, 1],
  retreatAt: [0, 1, 0.05],
  swingInterval: [0, 4, 0.05],
  castOffMin: [0, 6, 0.1],
  castOffTimeout: [1, 20, 0.5],
  boatDamage: [0, 5, 0.05],
  spreadPerMeter: [0, 0.5, 0.005],
  hitRadius: [0, 3, 0.05],
  repelBoarders: [0, 150, 1],
  board: [0, 150, 1],
  minTilePx: [30, 90, 1],
  panelSlideTime: [0, 2, 0.05],
};

/** Ranges by path prefix, checked before RANGES (Lee stats are multipliers around 1). */
const PATH_RANGES: [RegExp, Range][] = [
  [/^boarding\.(range|rangeSlack)$/, [0, 20, 0.5]],
  [/^jobs\.(ramAngle|boardAngle)$/, [0, 90, 1]],
  [/^jobs\.(stoppedFix|stoppedAim)$/, [1, 2, 0.05]],
  [/^jobs\./, [0, 10, 0.05]],
  [/^refit\.barAnimTime$/, [0, 2, 0.05]],
  [/^layout\.closeViewStart$/, [5, 80, 1]],
  [/^enemyAI\.chasedMaxOffset$/, [30, 120, 1]],
  [/^camera\.(lookAhead|rangeHysteresis)$/, [0, 3, 0.05]],
  [/^input\.(arriveRadius|orbitGrab|boatGrab)$/, [0, 100, 1]],
  [/^attach\.(touchGap|holdPush|alongsideGap|ramCooldown)$/, [0, 10, 0.1]],
  [/^crewAI\.helpThreshold$/, [0, 150, 1]],
  [/^ai\.\w+\.boardShare$/, [0, 1, 0.05]],
  [/^ai\.\w+\.boardAt$/, [0, 300, 5]],
  [/^lees\./, [0, 3, 0.05]],
  [/^pistol\.range$/, [0, 40, 0.5]],
  [/^(pistol|melee)\.rate$/, [0, 3, 0.05]],
  [/^pistol\.spread$/, [0, 5, 0.05]],
  [/^items\.\w+\.arc$/, [5, 360, 5]],
  [/^items\./, [0, 5, 0.01]],
  [/^traits\./, [0, 3, 0.05]],
  [/^ships\.\w+\.(crewMin|crewMax|treasures)$/, [0, 16, 1]],
  [/^ships\./, [0.2, 3, 0.05]],
  [/^guns\.reloadTime$/, [0.3, 10, 0.1]],
];

/** Keys read only when a fight is built. */
const NEXT_RUN = /^(boat\.parts\..*|ships\..*|items\..*|crew\.hp|lees\.\w+\.hp|global\.(enemyStart\w+|playerAdvantage|playerCrewStats)|fights\.(packHullScaling|spawnSpread)|tiles\.durability|enemyAI\.rangeJitter|ai\..*|run\..*|escalation\..*)$/;

const FOLDER_NAMES: Record<string, string> = {
  meta: 'Version',
  global: 'Global (and sandbox assists)',
  boat: 'Baseline hull (every ship scales this)',
  ships: 'Ships (multipliers, crew limits, treasures)',
  'ships.basic': 'Basic Ship',
  'ships.longdistance': 'Long Distance Relation Ship',
  'ships.friend': 'Friend Ship',
  'ships.hard': 'Hard Ship',
  jobs: 'Jobs & action buttons',
  guns: 'Guns: the standard cannon',
  items: 'Items (parts, Treasures, Trinkets; next fight)',
  ai: 'Enemy AI profiles',
  attach: 'Ramming & touching',
  boarding: 'Boarding',
  pistol: 'Pistols',
  melee: 'Swords (melee)',
  enemyAI: 'Enemy AI (steering)',
  fights: 'Fights',
  tiles: 'Tiles (durability, blow-outs)',
  explosion: 'Explosions (volatile parts)',
  run: 'Run (draft, rewards, recruits, between fights)',
  leveling: 'XP and levels',
  escalation: 'Escalation (after the encounter list)',
  traits: 'Lee traits',
  telegraph: 'Telegraph (red X)',
  camera: 'Camera',
  input: 'Input',
  visuals: 'Visuals',
  movement: 'Movement',
  parts: 'Parts (next fight)',
  function: 'Part function loss',
  flooding: 'Flooding & sinking',
  crew: 'Crew (rates, mobility, flooding)',
  crewAI: 'Crew AI',
  ladder: 'Urgency ladder (crew)',
  lees: 'Lee stats (per type)',
  basic: 'Basic Lee',
  hard: 'Hard Lee',
  quick: 'Quick Lee',
  deft: 'Deft Lee',
  handy: 'Handy Lee',
  loud: 'Loud Lee',
  layout: 'Layout (refit, close-up)',
  refit: 'Refit (stat bars)',
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
    const close = document.createElement('button');
    close.className = 'hud-btn';
    close.textContent = 'Close';
    close.onclick = () => this.close();
    bar.append(title, close);

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
        if (p === 'meta') continue;
        const folder = gui.addFolder(FOLDER_NAMES[p] ?? FOLDER_NAMES[key] ?? key);
        this.buildFolder(folder, value as Record<string, unknown>, p);
        if (path) folder.close();
        continue;
      }
      if (typeof value !== 'number') continue;
      const [min, max, step] = PATH_RANGES.find(([re]) => re.test(p))?.[1] ?? RANGES[key] ?? autoRange(value);
      if (p.startsWith('meta.')) continue;
      const label = NEXT_RUN.test(p) && !p.includes('.parts.') ? `${key} (next fight)` : key;
      gui
        .add(obj, key, Math.min(min, value), Math.max(max, value), step)
        .name(label)
        .onChange(() => {
          this.ctl.saveTuning();
          this.ctl.tuningChanged();
        });
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
