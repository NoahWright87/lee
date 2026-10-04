// DOM HUD over the canvas: setup mode, speed toggle, tune/debug toggles,
// result screen, strip gauges, crew debug, and the rotate-your-phone overlay.
// Reads the Controller; the canvas never draws UI chrome.

import { ACTIVITY_KINDS, type ActivityKind } from '../config/lees';
import { shipName } from '../config/ships';
import { advantageOf, cannonOnline, motionParams, sinkProgress, type Boat } from '../sim/boat';
import { DEG } from '../sim/math';
import { roleName } from '../sim/crew';
import type { Controller } from '../game/Controller';
import type { SideStats } from '../sim/world';
import { CrewDebug } from './crewDebug';
import { SetupPanel } from './setup';
import { TuningPanel } from './tuningPanel';

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  gun: 'Gunning',
  row: 'Rowing',
  sail: 'Sailing',
  lookout: 'Lookout',
  repair: 'Repairing',
  bail: 'Bailing',
  board: 'Boarding',
  repel: 'Repelling',
  melee: 'Sword fight',
  swing: 'Swinging',
  walk: 'Walking',
  idle: 'Idle',
};

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
  private root: HTMLElement;
  private setup: SetupPanel;
  private crewDebug: CrewDebug;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  private gauges: HTMLDivElement;
  private crewText: HTMLSpanElement;
  private moveText: HTMLSpanElement;
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
  /** One Disengage button per boat attached to yours, keyed by boat id. */
  private disengage = new Map<number, HTMLButtonElement>();

  constructor(root: HTMLElement, ctl: Controller) {
    this.ctl = ctl;
    this.root = root;
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

    this.setup = new SetupPanel(ctl, () => {
      if (ctl.noGunners()) this.showToast('No gunner on any cannon: your guns won’t fire until someone mans one.');
      ctl.start();
    });
    this.crewDebug = new CrewDebug(ctl);
    this.toast = el('div', 'toast hidden');

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
    const rearrange = el('button', 'big-btn', 'Rearrange');
    rearrange.onclick = () => {
      this.panel.close();
      this.autoNextAt = null;
      ctl.rearrange();
    };
    const tune = el('button', 'big-btn', 'Tune');
    tune.onclick = () => {
      this.autoNextAt = null; // tuning: wait for a tap
      this.updatePrimaryLabel();
      this.panel.open();
    };
    buttons.append(this.primaryBtn, rearrange, tune);
    card.append(this.resultTitle, this.resultSub, this.resultBody, buttons);
    // Reading the breakdown holds the auto-advance to the next fight.
    const hold = () => {
      if (this.autoNextAt === null) return;
      this.autoNextAt = null;
      this.updatePrimaryLabel();
    };
    card.addEventListener('pointerdown', hold);
    card.addEventListener('scroll', hold);
    this.result.append(card);

    this.panel = new TuningPanel(ctl);
    ocean.append(top, this.setup.stats, this.crewDebug.root, this.setup.card, this.toast, this.result, this.panel.root);
    root.append(this.setup.root);

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
    this.root.append(this.disengageLayer);

    ctl.onChange(() => this.sync());
    ctl.onFrame(() => this.frame());
    this.sync();
  }

  private disengageLayer = el('div', 'disengage-layer');

  /**
   * Disengage buttons: one per attached boat, beside its deck in the strip,
   * kept out of the bottom of the screen where a resting thumb sits.
   */
  private syncDisengage(): void {
    const w = this.ctl.world;
    const proj = this.ctl.stripProjection;
    const attached = w.phase === 'running' && !w.result ? w.attachedTo(w.player) : [];
    const keep = new Set(attached.map((b) => b.id));
    for (const [id, btn] of this.disengage) {
      if (keep.has(id)) continue;
      btn.remove();
      this.disengage.delete(id);
    }
    if (!proj) return;
    const W = this.root.clientWidth || window.innerWidth;
    // At the seam between the ocean and the close-up, centered: never over the fight itself.
    const bw = 150;
    const bh = 52;
    const gap = 8;
    const total = attached.length * bw + (attached.length - 1) * gap;
    attached.forEach((b, i) => {
      let btn = this.disengage.get(b.id);
      if (!btn) {
        btn = el('button', 'disengage-btn');
        const target: Boat = b;
        btn.onclick = (ev) => {
          ev.stopPropagation();
          this.ctl.world.disengage(target);
        };
        this.disengageLayer.append(btn);
        this.disengage.set(b.id, btn);
      }
      const link = w.links.linkBetween(w.player, b);
      const casting = link ? w.links.castingOff(link) : false;
      const label = casting ? `Casting off…\n${w.castOffStatus(b)}` : attached.length > 1 ? `Disengage\n${shipName(b.type)}` : 'Disengage';
      if (btn.textContent !== label) btn.textContent = label;
      btn.disabled = casting;
      btn.classList.toggle('breaking', casting);
      btn.style.left = `${Math.round(W / 2 - total / 2 + i * (bw + gap))}px`;
      // Resting on the seam, just above it, so it covers neither the strip's gauges nor the decks.
      btn.style.top = `${Math.round(proj.top - bh - 6)}px`;
    });
  }

  /** Speed buttons show the setting for the current mode (sailing or close combat). */
  private syncSpeed(): void {
    const ctl = this.ctl;
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', ctl.speed === i + 1));
    const melee = ctl.speedMode() === 'melee';
    for (const b of this.speedBtns) b.title = melee ? 'Speed during close combat' : 'Speed while sailing';
  }

  private sync(): void {
    const { ctl } = this;
    const w = ctl.world;
    this.syncSpeed();
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
    this.setup.frame();
    this.crewDebug.frame();
    this.syncDisengage();
    this.syncSpeed();
    const setupMode = w.phase === 'ready';
    this.gauges.classList.toggle('hidden', setupMode);
    this.root.classList.toggle('setup-mode', setupMode);
    const lees = p.crew.lees;
    this.crewText.textContent = `${lees.filter((l) => l.alive).length}/${lees.length}`;
    // Speed and turning as a share of a fully crewed, undamaged boat (oars, sails, engine, water).
    const mp = motionParams(p, w.tuning);
    const mv = w.tuning.player.movement;
    const spd = mp.cruiseSpeed / Math.max(1e-6, mv.cruiseSpeed);
    const trn = mp.turnRate / Math.max(1e-6, mv.turnRate * DEG * Math.sqrt(advantageOf('player', w.tuning)));
    this.moveText.textContent = `${Math.round(spd * 100)}% · TURN ${Math.round(trn * 100)}%`;
    const s = Math.min(1, sinkProgress(p, w.tuning));
    this.waterFill.style.width = `${(s * 100).toFixed(1)}%`;
    this.waterFill.classList.toggle('danger', s > 0.7);
    this.waterText.textContent = `${Math.round(s * 100)}%`;
    // Manned guns of those still online.
    const online = p.cannons.filter((c) => c.kind === 'cannon' && cannonOnline(p, c, w.tuning));
    const manned = online.filter((c) => w.gunnerOf(p, c) !== null).length;
    this.gunsText.textContent = `${manned}/${online.length}`;
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
    this.resultTitle.textContent = won ? 'Victory' : r.how === 'crew' ? 'Crew lost' : 'Sunk';
    this.resultTitle.className = `result-title ${won ? 'win' : 'lose'}`;
    const sunk = ctl.shipsSunk();
    this.resultSub.textContent = won
      ? `Fight ${w.fight} cleared · ${sunk} ${sunk === 1 ? 'ship' : 'ships'} beaten this run`
      : `Reached fight ${w.fight} · ${sunk} ${sunk === 1 ? 'ship' : 'ships'} beaten this run`;
    const delay = w.tuning.campaign.nextFightDelay;
    this.autoNextAt = won && delay > 0 ? performance.now() + delay * 1000 : null;
    this.updatePrimaryLabel();
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
      (['cannon', 'gatling', 'melee', 'pistol', 'sank'] as const)
        .filter((k) => x.lostBy[k] > 0)
        .map((k) => `${x.lostBy[k]} ${k === 'sank' ? 'sank' : k}`)
        .join(', ') || 'none';
    if (s.leesLost || e.leesLost) rows.push(['  by cause (you)', lost(s)], ['  by cause (enemy)', lost(e)]);
    // Close combat: only when it happened.
    if (s.dockTime > 0 || e.dockTime > 0) rows.push(['Time attached', fmtTime(Math.max(s.dockTime, e.dockTime))]);
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
    if (s.disengages) rows.push(['Disengages', `${s.disengages}`]);
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
        el('b', '', `#${lee.number} ${roleName(boat, lee.home)}`),
        el('span', 'crew-row-home', tile.station ? tile.label : `${boat.layout.parts[tile.part].label} deck`),
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
