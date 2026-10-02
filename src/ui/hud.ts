// DOM HUD over the canvas: START, speed toggle, tune/debug toggles, result
// screen, strip gauges, and the rotate-your-phone overlay. Reads the
// Controller; the canvas never draws UI chrome.

import { cannonOnline, sinkProgress } from '../sim/boat';
import type { Controller } from '../game/Controller';
import type { SideStats } from '../sim/world';
import { TuningPanel } from './tuningPanel';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

export class Hud {
  private ctl: Controller;
  private startBtn: HTMLButtonElement;
  private speedBtns: HTMLButtonElement[];
  private debugBtn: HTMLButtonElement;
  private result: HTMLDivElement;
  private resultBody: HTMLDivElement;
  private resultTitle: HTMLHeadingElement;
  private resultSub: HTMLDivElement;
  private primaryBtn: HTMLButtonElement;
  private fightPill: HTMLDivElement;
  /** performance.now() when the next fight auto-starts, or null. */
  private autoNextAt: number | null = null;
  private waterFill: HTMLDivElement;
  private waterText: HTMLSpanElement;
  private gunsText: HTMLSpanElement;
  private sinkBanner: HTMLDivElement;
  private panel: TuningPanel;
  private shownResultFor = -1;

  constructor(root: HTMLElement, ctl: Controller) {
    this.ctl = ctl;
    const ocean = el('div', 'hud-ocean');
    const strip = el('div', 'hud-strip');
    root.append(ocean, strip);

    // Top bar.
    const top = el('div', 'hud-top');
    const left = el('div', 'hud-group');
    const tuneBtn = el('button', 'hud-btn', 'Tune');
    tuneBtn.onclick = () => this.panel.toggle();
    this.debugBtn = el('button', 'hud-btn', 'Debug');
    this.debugBtn.onclick = () => ctl.toggleDebug();
    left.append(tuneBtn, this.debugBtn);
    const right = el('div', 'hud-group seg');
    this.speedBtns = ([1, 2] as const).map((s) => {
      const b = el('button', 'hud-btn', `${s}x`);
      b.onclick = () => ctl.setSpeed(s);
      right.append(b);
      return b;
    });
    this.fightPill = el('div', 'fight-pill');
    top.append(left, this.fightPill, right);

    this.startBtn = el('button', 'start-btn', 'START');
    this.startBtn.onclick = () => ctl.start();

    // Result screen.
    this.result = el('div', 'result hidden');
    const card = el('div', 'result-card');
    this.resultTitle = el('h1', 'result-title');
    this.resultSub = el('div', 'result-sub');
    this.resultBody = el('div', 'result-stats');
    const buttons = el('div', 'result-buttons');
    this.primaryBtn = el('button', 'big-btn primary', 'Again');
    this.primaryBtn.onclick = () => {
      this.panel.close();
      this.autoNextAt = null;
      if (ctl.world.result?.winner === 'player') ctl.nextFight();
      else ctl.restart(true);
    };
    const tune = el('button', 'big-btn', 'Tune');
    tune.onclick = () => {
      this.autoNextAt = null; // tuning: wait for a tap
      this.updatePrimaryLabel();
      this.panel.open();
    };
    buttons.append(this.primaryBtn, tune);
    card.append(this.resultTitle, this.resultSub, this.resultBody, buttons);
    this.result.append(card);

    this.panel = new TuningPanel(ctl);
    ocean.append(top, this.startBtn, this.result, this.panel.root);

    // Strip gauges.
    const gauges = el('div', 'strip-gauges');
    const water = el('div', 'gauge water');
    const wl = el('span', 'gauge-label', 'WATER');
    const bar = el('div', 'gauge-bar');
    this.waterFill = el('div', 'gauge-fill');
    bar.append(this.waterFill);
    this.waterText = el('span', 'gauge-value');
    water.append(wl, bar, this.waterText);
    const guns = el('div', 'gauge guns');
    guns.append(el('span', 'gauge-label', 'GUNS'));
    this.gunsText = el('span', 'gauge-value');
    guns.append(this.gunsText);
    gauges.append(water, guns);
    this.sinkBanner = el('div', 'sink-banner hidden', 'SINKING');
    strip.append(gauges, this.sinkBanner);

    ctl.onChange(() => this.sync());
    ctl.onFrame(() => this.frame());
    this.sync();
  }

  private sync(): void {
    const { ctl } = this;
    const w = ctl.world;
    this.startBtn.classList.toggle('hidden', w.phase !== 'ready');
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', ctl.speed === i + 1));
    this.debugBtn.classList.toggle('on', ctl.debug);
    if (w.phase === 'over' && w.result) {
      if (this.shownResultFor !== ctl.runId) {
        this.shownResultFor = ctl.runId;
        this.showResult();
      }
    } else {
      this.result.classList.add('hidden');
      this.shownResultFor = -1;
      this.autoNextAt = null;
    }
  }

  private frame(): void {
    const w = this.ctl.world;
    const p = w.player;
    const s = Math.min(1, sinkProgress(p, w.tuning));
    this.waterFill.style.width = `${(s * 100).toFixed(1)}%`;
    this.waterFill.classList.toggle('danger', s > 0.7);
    this.waterText.textContent = `${Math.round(s * 100)}%`;
    const online = p.cannons.filter((c) => cannonOnline(p, c, w.tuning)).length;
    this.gunsText.textContent = `${online}/${p.cannons.length}`;
    this.sinkBanner.classList.toggle('hidden', p.sinkingSince === null);
    const live = w.liveEnemies().length;
    this.fightPill.textContent = `Fight ${w.fight} · ${live}/${w.enemies.length} left`;

    if (this.autoNextAt !== null) {
      if (performance.now() >= this.autoNextAt) {
        this.autoNextAt = null;
        this.panel.close();
        this.ctl.nextFight();
      } else {
        this.updatePrimaryLabel();
      }
    }
  }

  private updatePrimaryLabel(): void {
    const won = this.ctl.world.result?.winner === 'player';
    if (!won) {
      this.primaryBtn.textContent = 'Again';
      return;
    }
    const left = this.autoNextAt === null ? 0 : Math.ceil((this.autoNextAt - performance.now()) / 1000);
    this.primaryBtn.textContent = left > 0 ? `Next fight (${left})` : 'Next fight';
  }

  private showResult(): void {
    const w = this.ctl.world;
    const r = w.result!;
    const won = r.winner === 'player';
    const ctl = this.ctl;
    this.resultTitle.textContent = won ? 'Victory' : 'Sunk';
    this.resultTitle.className = `result-title ${won ? 'win' : 'lose'}`;
    const sunk = ctl.shipsSunk();
    this.resultSub.textContent = won
      ? `Fight ${w.fight} cleared · ${sunk} ${sunk === 1 ? 'ship' : 'ships'} sunk this run`
      : `Reached fight ${w.fight} · ${sunk} ${sunk === 1 ? 'ship' : 'ships'} sunk this run`;
    const delay = w.tuning.campaign.nextFightDelay;
    this.autoNextAt = won && delay > 0 ? performance.now() + delay * 1000 : null;
    this.updatePrimaryLabel();
    const s: SideStats = w.stats.player;
    const pct = s.shellsFired ? Math.round((100 * s.shellsHit) / s.shellsFired) : 0;
    const rows: [string, string, boolean?][] = [
      ['Time', fmtTime(r.time)],
      ['Ships sunk', `${w.enemies.filter((e) => e.sinkingSince !== null).length} of ${w.enemies.length}`],
      ['Shells fired / hit', `${s.shellsFired} / ${s.shellsHit} (${pct}%)`],
      ['Damage dealt / taken', `${Math.round(s.damageDealt)} / ${Math.round(s.damageTaken)}`],
      ['Shells dodged', `${s.shellsDodged} of ${w.stats.enemy.shellsFired}`, true],
      ['Water taken', `${Math.round(s.waterTaken)}`],
    ];
    this.resultBody.replaceChildren(
      ...rows.map(([k, v, key]) => {
        const row = el('div', `stat${key ? ' key' : ''}`);
        row.append(el('span', 'stat-k', k), el('span', 'stat-v', v));
        return row;
      }),
    );
    this.result.classList.remove('hidden');
  }
}

/** Portrait column sizing and the rotate overlay. Returns the column size in CSS px. */
export function measureLayout(): { width: number; height: number; blocked: boolean } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(vw, Math.round(vh * 0.62));
  const blocked = vw > vh && width < 320;
  return { width, height: vh, blocked };
}
