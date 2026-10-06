// DOM HUD over the canvas: the ⚙️ menu, the run screens, the refit screen,
// the action buttons and pips, the speed button, tune/debug toggles, the
// result screen, strip gauges, crew debug, and the rotate-your-phone overlay. Reads the Controller; the canvas
// never draws UI chrome.

import { ACTIVITY_KINDS, type ActivityKind } from '../config/lees';
import { gunOnline, motionParams, shipStats, sinkProgress } from '../sim/boat';
import { DEG } from '../sim/math';
import { JOB_INFO } from '../config/lees';
import type { Controller } from '../game/Controller';
import { ActionBar } from './actionBar';
import type { SideStats } from '../sim/world';
import { CrewDebug } from './crewDebug';
import { el, fmtTime } from './dom';
import { RefitPanel } from './refit';
import { Screens } from './screens';
import { TuningPanel } from './tuningPanel';

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  gun: 'Gunning',
  row: 'Rowing',
  sail: 'Sailing',
  lookout: 'Lookout',
  pump: 'Pumping',
  powder: 'Powder',
  repair: 'Repairing',
  bail: 'Bailing',
  board: 'Boarding',
  repel: 'Repelling',
  melee: 'Sword fight',
  swing: 'Swinging',
  walk: 'Walking',
  idle: 'Idle',
};

export class Hud {
  private ctl: Controller;
  private root: HTMLElement;
  private refit: RefitPanel;
  private screens: Screens;
  private crewDebug: CrewDebug;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  private gauges: HTMLDivElement;
  private crewText: HTMLSpanElement;
  private moveText: HTMLSpanElement;
  private speedBtn: HTMLButtonElement;
  private actions: ActionBar;
  private debugBtn: HTMLButtonElement;
  private result: HTMLDivElement;
  private resultBody: HTMLDivElement;
  private resultTitle: HTMLHeadingElement;
  private resultSub: HTMLDivElement;
  private primaryBtn: HTMLButtonElement;
  private secondaryBtn: HTMLButtonElement;
  private fightPill: HTMLDivElement;
  private waterFill: HTMLDivElement;
  private waterText: HTMLSpanElement;
  private gunsText: HTMLSpanElement;
  private sinkBanner: HTMLDivElement;
  private panel: TuningPanel;
  private shownResultFor = -1;

  constructor(root: HTMLElement, ctl: Controller) {
    this.ctl = ctl;
    this.root = root;
    const ocean = el('div', 'hud-ocean');
    const strip = el('div', 'hud-strip');
    root.append(ocean, strip);

    // Top bar: ⚙️ on every screen, then Tune and Debug (playtest tools).
    this.screens = new Screens(ctl);
    const top = el('div', 'hud-top');
    const left = el('div', 'hud-group');
    const tuneBtn = el('button', 'hud-btn', 'Tune');
    tuneBtn.onclick = () => this.panel.toggle();
    this.debugBtn = el('button', 'hud-btn', 'Debug');
    this.debugBtn.onclick = () => ctl.toggleDebug();
    left.append(this.screens.gear, tuneBtn, this.debugBtn);
    const right = el('div', 'hud-group');
    // One button cycling Pause → 0.5× → 1× → 3× (remembered separately for sailing and close combat).
    this.speedBtn = el('button', 'hud-btn speed-btn', '1×');
    this.speedBtn.onclick = () => ctl.cycleSpeed();
    right.append(this.speedBtn);
    this.fightPill = el('div', 'fight-pill');
    top.append(left, this.fightPill, right);

    this.refit = new RefitPanel(ctl, (text) => this.showToast(text));
    this.crewDebug = new CrewDebug(ctl);
    this.toast = el('div', 'toast hidden');

    // Result screen.
    this.result = el('div', 'result hidden');
    const card = el('div', 'result-card');
    this.resultTitle = el('h1', 'result-title');
    this.resultSub = el('div', 'result-sub');
    this.resultBody = el('div', 'result-stats');
    const buttons = el('div', 'result-buttons');
    this.primaryBtn = el('button', 'big-btn primary', 'Continue');
    this.primaryBtn.onclick = () => {
      this.panel.close();
      ctl.finishFight();
    };
    this.secondaryBtn = el('button', 'big-btn', 'Again');
    this.secondaryBtn.onclick = () => {
      // Sandbox: the same fight again, right away.
      this.panel.close();
      ctl.finishFight();
      ctl.launch();
    };
    const tune = el('button', 'big-btn', 'Tune');
    tune.onclick = () => this.panel.open();
    buttons.append(this.primaryBtn, this.secondaryBtn, tune);
    card.append(this.resultTitle, this.resultSub, this.resultBody, buttons);
    this.result.append(card);

    this.panel = new TuningPanel(ctl);
    ocean.append(this.refit.top, this.crewDebug.root, this.refit.card, this.toast, this.result);
    root.append(this.refit.root, this.screens.root, top, this.panel.root, this.screens.menuRoot);

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
    const crew = el('div', 'gauge crew');
    crew.append(el('span', 'gauge-label', 'CREW'));
    this.crewText = el('span', 'gauge-value');
    crew.append(this.crewText);
    const move = el('div', 'gauge move');
    move.append(el('span', 'gauge-label', 'SPEED'));
    this.moveText = el('span', 'gauge-value');
    move.append(this.moveText);
    gauges.append(water, guns, crew, move);
    this.gauges = gauges;
    this.sinkBanner = el('div', 'sink-banner hidden', 'SINKING');
    strip.append(gauges, this.sinkBanner);
    this.actions = new ActionBar(ctl);
    this.root.append(this.actions.root);

    ctl.onChange(() => this.sync());
    ctl.onFrame(() => this.frame());
    this.sync();
  }

  /** The speed button shows the setting for the current mode (sailing or close combat). */
  private syncSpeed(): void {
    const ctl = this.ctl;
    const v = ctl.speed;
    const text = v === 0 ? '⏸' : v === 0.5 ? '½×' : `${v}×`;
    if (this.speedBtn.textContent !== text) this.speedBtn.textContent = text;
    this.speedBtn.classList.toggle('on', v === 0);
    this.speedBtn.title = ctl.speedMode() === 'melee' ? 'Speed during close combat' : 'Speed while sailing';
  }

  private sync(): void {
    const { ctl } = this;
    const w = ctl.world;
    this.syncSpeed();
    this.debugBtn.classList.toggle('on', ctl.debug);
    if (ctl.screen === 'fight' && w.phase === 'over' && w.result) {
      if (this.shownResultFor !== ctl.runId) {
        this.shownResultFor = ctl.runId;
        this.showResult();
      }
    } else {
      this.result.classList.add('hidden');
      this.shownResultFor = -1;
    }
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 3200);
  }

  private frame(): void {
    const w = this.ctl.world;
    const p = w.player;
    this.root.style.setProperty('--ocean-frac', `${(this.ctl.oceanFrac * 100).toFixed(2)}%`);
    this.refit.frame();
    this.crewDebug.frame();
    this.actions.frame();
    this.syncSpeed();
    const fighting = this.ctl.screen === 'fight';
    const full = !fighting && this.ctl.screen !== 'refit';
    this.gauges.classList.toggle('hidden', !fighting);
    this.root.classList.toggle('setup-mode', this.ctl.screen === 'refit');
    this.root.classList.toggle('full-screen', full);
    this.fightPill.classList.toggle('hidden', !fighting);
    const lees = p.crew.lees;
    this.crewText.textContent = `${lees.filter((l) => l.alive).length}/${lees.length}`;
    // Speed and turning as a share of a fully crewed, undamaged boat (oars, sails, engine, water).
    const mp = motionParams(p, w.tuning);
    const mv = w.tuning.boat.movement;
    const ss = shipStats(p, w.tuning);
    const spd = mp.cruiseSpeed / Math.max(1e-6, mv.cruiseSpeed * ss.speed * p.mods.speed);
    const trn = mp.turnRate / Math.max(1e-6, mv.turnRate * ss.turn * p.mods.turn * DEG * Math.sqrt(p.advantage));
    this.moveText.textContent = `${Math.round(spd * 100)}% · TURN ${Math.round(trn * 100)}%`;
    const s = Math.min(1, sinkProgress(p, w.tuning));
    this.waterFill.style.width = `${(s * 100).toFixed(1)}%`;
    this.waterFill.classList.toggle('danger', s > 0.7);
    this.waterText.textContent = `${Math.round(s * 100)}%`;
    // Manned guns of those still online.
    const online = p.guns.filter((c) => gunOnline(p, c, w.tuning));
    const manned = online.filter((c) => w.gunnerOf(p, c) !== null).length;
    this.gunsText.textContent = `${manned}/${online.length}`;
    this.sinkBanner.classList.toggle('hidden', p.sinkingSince === null);
    const live = w.liveEnemies().length;
    this.fightPill.textContent = `${this.ctl.mode === 'sandbox' ? 'Sandbox' : `Fight ${w.fight}`} · ${live}/${w.enemies.length} left`;
  }

  private showResult(): void {
    const w = this.ctl.world;
    const r = w.result!;
    const won = r.winner === 'player';
    const ctl = this.ctl;
    this.resultTitle.textContent = won ? 'Victory' : r.how === 'crew' ? 'Crew lost' : 'Sunk';
    this.resultTitle.className = `result-title ${won ? 'win' : 'lose'}`;
    const gone = w.player.crew.lees.filter((l) => !l.alive);
    const sandbox = ctl.mode === 'sandbox';
    this.resultSub.textContent = sandbox
      ? 'Sandbox: nothing is permanent here.'
      : won
        ? `Fight ${w.fight} won${gone.length ? ` · ${gone.length} ${gone.length === 1 ? 'Lee' : 'Lees'} lost for good` : ''}`
        : 'The run is over.';
    this.primaryBtn.textContent = sandbox ? 'Back to refit' : won ? 'Continue' : 'Run summary';
    this.secondaryBtn.classList.toggle('hidden', !sandbox);
    const s: SideStats = w.stats.player;
    const pct = s.shellsFired ? Math.round((100 * s.shellsHit) / s.shellsFired) : 0;
    const rows: [string, string, boolean?][] = [
      ['Time', fmtTime(r.time)],
      [
        'Ships sunk / crew killed',
        `${w.enemies.filter((e) => e.sinkingSince !== null).length} / ${w.enemies.filter((e) => e.sinkingSince === null && w.isOut(e)).length} of ${w.enemies.length}`,
      ],
      ['Shells fired / hit', `${s.shellsFired} / ${s.shellsHit} (${pct}%)`],
      ['Damage dealt / taken', `${Math.round(s.damageDealt)} / ${Math.round(s.damageTaken)}`],
      ['Shells dodged', `${s.shellsDodged} of ${w.stats.enemy.shellsFired}`, true],
      ['Water taken / bailed', `${Math.round(s.waterTaken)} / ${Math.round(s.waterBailed)}`],
      ['HP repaired', `${Math.round(s.hpRepaired)}`],
      ['Lees lost (you / enemy)', `${s.leesLost} / ${w.stats.enemy.leesLost}`, true],
    ];
    const e = w.stats.enemy;
    const lost = (x: SideStats) =>
      (['cannon', 'gatling', 'melee', 'pistol', 'sank', 'spikes', 'explosion'] as const)
        .filter((k) => x.lostBy[k] > 0)
        .map((k) => `${x.lostBy[k]} ${k === 'sank' ? 'sank' : k}`)
        .join(', ') || 'none';
    if (s.leesLost || e.leesLost) rows.push(['  by cause (you)', lost(s)], ['  by cause (enemy)', lost(e)]);
    // Close combat: only when it happened.
    if (s.closeTime > 0 || e.closeTime > 0) rows.push(['Time in close combat', fmtTime(Math.max(s.closeTime, e.closeTime))]);
    if (s.boardings || e.boardings) {
      rows.push([
        'Boardings (you / enemy)',
        `${s.boardings} / ${e.boardings} · ${Math.round(s.enemyDeckTime)}s / ${Math.round(e.enemyDeckTime)}s on decks`,
        true,
      ]);
    }
    if (s.meleeDealt || e.meleeDealt) {
      rows.push(['Melee kills (you / enemy)', `${s.meleeKills} / ${e.meleeKills}`, true], ['Melee damage dealt / taken', `${Math.round(s.meleeDealt)} / ${Math.round(s.meleeTaken)}`]);
    }
    if (s.pistolShots || e.pistolShots) {
      const pp = s.pistolShots ? Math.round((100 * s.pistolHits) / s.pistolShots) : 0;
      rows.push(['Pistol shots / hits', `${s.pistolShots} / ${s.pistolHits} (${pp}%) · dmg ${Math.round(s.pistolDealt)}`]);
    }
    if (s.gatlingShots || e.gatlingShots) {
      rows.push(['Gatling hits (you / enemy)', `${s.gatlingHits} of ${s.gatlingShots} / ${e.gatlingHits} of ${e.gatlingShots}`]);
    }
    if (s.ramsDone || s.ramsTaken) {
      rows.push(['Rams done / taken', `${s.ramsDone} / ${s.ramsTaken} · dealt ${Math.round(s.ramDealt)} · took ${Math.round(s.ramTaken)}`, true]);
    }
    if (s.retreats) rows.push(['Retreats', `${s.retreats}`]);
    if (s.tilesBlown || e.tilesBlown) rows.push(['Tiles blown out (you / enemy)', `${s.tilesBlown} / ${e.tilesBlown}${s.explosions || e.explosions ? ` · explosions ${s.explosions} / ${e.explosions}` : ''}`]);
    this.resultBody.replaceChildren(
      ...rows.map(([k, v, key]) => {
        const row = el('div', `stat${key ? ' key' : ''}`);
        row.append(el('span', 'stat-k', k), el('span', 'stat-v', v));
        return row;
      }),
      this.crewBreakdown(),
    );
    this.result.classList.remove('hidden');
  }

  /** Per-Lee breakdown: what each did, how long, how far from home, how often it switched. */
  private crewBreakdown(): HTMLElement {
    const w = this.ctl.world;
    const boat = w.player;
    const box = el('div', 'crew-result');
    box.append(el('div', 'crew-result-title', 'Your crew'));
    if (!boat.crew.lees.length) {
      box.append(el('div', 'crew-row-sub', 'Nobody sailed.'));
      return box;
    }
    const legend = el('div', 'time-legend');
    for (const k of ACTIVITY_KINDS) {
      const item = el('span', 'legend-item');
      item.append(el('i', `sw act-${k}`), el('span', '', ACTIVITY_LABEL[k]));
      legend.append(item);
    }
    box.append(legend);
    for (const lee of boat.crew.lees) {
      const st = lee.stats;
      const total = ACTIVITY_KINDS.reduce((a, k) => a + st.time[k], 0) || 1;
      const row = el('div', `crew-row${lee.alive ? '' : ' lost'}`);
      const tile = boat.grid.tiles[lee.home];
      const head = el('div', 'crew-row-head');
      head.append(
        el('b', '', `${lee.label} · ${JOB_INFO[lee.job].icon} ${JOB_INFO[lee.job].name}`),
        el('span', 'crew-row-home', `started on ${tile.label}`),
        el('span', `crew-row-status ${lee.alive ? 'ok' : 'lost'}`, lee.alive ? 'survived' : 'lost'),
      );
      const bar = el('div', 'time-bar');
      for (const k of ACTIVITY_KINDS) {
        if (st.time[k] <= 0) continue;
        const seg = el('i', `act-${k}`);
        seg.style.width = `${(100 * st.time[k]) / total}%`;
        seg.title = `${ACTIVITY_LABEL[k]} ${st.time[k].toFixed(0)}s`;
        bar.append(seg);
      }
      const bits: string[] = [];
      if (st.shellsFired) bits.push(`fired ${st.shellsFired} · hit ${st.shellsHit} · dmg ${Math.round(st.damageDealt)}`);
      if (st.hpRepaired >= 0.5) bits.push(`repaired ${Math.round(st.hpRepaired)}`);
      if (st.waterBailed >= 0.5) bits.push(`bailed ${Math.round(st.waterBailed)}`);
      if (st.boardings) bits.push(`boarded ${st.boardings}× · ${Math.round(st.onEnemyDeck)}s on enemy decks`);
      if (st.time.melee >= 0.5) bits.push(`melee ${Math.round(st.time.melee)}s · ${st.meleeKills} kills · dealt ${Math.round(st.meleeDealt)} · took ${Math.round(st.meleeTaken)}`);
      if (st.pistolShots) bits.push(`pistol ${st.pistolShots} shots · ${st.pistolHits} hits`);
      if (st.gatlingShots) bits.push(`gatling ${st.gatlingShots} rounds · ${st.gatlingHits} hits`);
      if (!lee.alive && lee.lostCause) bits.push(`lost to ${lee.lostCause === 'sank' ? 'the sea' : lee.lostCause}`);
      bits.push(`away ${Math.round((100 * st.awayFromHome) / total)}%`, `idle ${Math.round((100 * st.time.idle) / total)}%`, `${st.switches} switches`);
      row.append(head, bar, el('div', 'crew-row-sub', bits.join(' · ')));
      box.append(row);
    }
    return box;
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
