// The crew, as bars (Phase 7): for each role a square icon down the left of the
// screen (⏩ 🔫 ⚔️ 🛠️: a tap moves one Lee, best fit, and holding repeats), and
// beside it one column per Lee in that role. A column's height is its Lee's HP,
// colored by type; damage flashes red and then drains away; chevrons above a
// bar show buffs and debuffs; a highlighted border means the Lee is on an
// order (a tap on the deck). More Lees in a role means skinnier columns that
// still fit. Under a role's columns, a small portrait per Lee type. When a Lee
// changes role its bar slides between the rows over the time it walks there; on
// death it flashes and the column closes. The engaged enemy's bars appear on
// the other side while close combat is on. Reads the world; orders go through
// the Controller.

import { JOB_INFO, JOBS, type Job } from '../config/lees';
import type { Controller } from '../game/Controller';
import type { Boat } from '../sim/boat';
import type { Tuning } from '../config/tuning';
import { activity, isWet, jobSeats, type Lee } from '../sim/crew';
import { memberFigure } from './cards';
import { el } from './dom';

/** Panel geometry (CSS px): yours is big enough for a thumb, theirs is a compact read-out. */
interface Metrics {
  row: number;
  gap: number;
  icon: number;
  bar: number;
  /** Space above the bars for the buff chevrons, and below them for the type portraits. */
  above: number;
  below: number;
  maxBar: number;
}
const MINE: Metrics = { row: 56, gap: 3, icon: 44, bar: 34, above: 9, below: 13, maxBar: 22 };
const THEIRS: Metrics = { row: 44, gap: 3, icon: 26, bar: 26, above: 7, below: 10, maxBar: 14 };
/** Seconds a dead Lee's bar lingers for its death effect. */
const DEATH = 0.6;
/** Seconds a hit flashes before the red trail starts to drain. */
const FLASH = 0.18;

interface BarEl {
  el: HTMLDivElement;
  chev: HTMLSpanElement;
  lv: HTMLSpanElement;
  /** HP share last frame, and the world time it last dropped. */
  last: number;
  hitAt: number;
  deadAt: number | null;
}

/** One crew's bars: four rows of a role icon and its columns. */
class BarPanel {
  readonly root: HTMLDivElement;
  readonly icons = new Map<Job, HTMLButtonElement>();
  private rows = new Map<Job, HTMLDivElement>();
  private bars = new Map<number, BarEl>();
  private hollow: HTMLDivElement[] = [];
  private syms: HTMLElement[] = [];
  private m: Metrics;
  private mirror: boolean;

  constructor(cls: string, m: Metrics, mirror: boolean, makeIcon: (job: Job) => HTMLButtonElement) {
    this.m = m;
    this.mirror = mirror;
    this.root = el('div', `crew-bars ${cls}`);
    this.root.style.setProperty('--cb-row', `${m.row}px`);
    this.root.style.setProperty('--cb-gap', `${m.gap}px`);
    this.root.style.setProperty('--cb-icon', `${m.icon}px`);
    JOBS.forEach((job, i) => {
      const row = el('div', `cb-row job-${job}`);
      row.style.top = `${i * (m.row + m.gap)}px`;
      const icon = makeIcon(job);
      this.icons.set(job, icon);
      row.append(icon);
      this.rows.set(job, row);
      this.root.append(row);
    });
    this.root.style.height = `${JOBS.length * (m.row + m.gap) - m.gap}px`;
  }

  clear(): void {
    for (const b of this.bars.values()) b.el.remove();
    this.bars.clear();
    for (const d of this.hollow) d.remove();
    this.hollow = [];
    for (const d of this.syms) d.remove();
    this.syms = [];
  }

  /** Lay out a crew's bars. `avail` is the width the columns may use (px); `seats(job)` adds hollow columns for empty seats. */
  update(boat: Boat, time: number, t: Tuning, avail: number, seats: (j: Job) => number, danger: (l: Lee) => boolean = () => false): void {
    const m = this.m;
    const rows: Record<Job, Lee[]> = { sail: [], fire: [], board: [], fix: [] };
    for (const l of boat.crew.lees) if (l.alive) rows[l.job].push(l);
    // Columns within a role are grouped by Lee type (then id), so a type's portrait sits under its group.
    const order = new Map<number, { job: Job; i: number; n: number }>();
    const widths: Record<Job, number> = { sail: 0, fire: 0, board: 0, fix: 0 };
    for (const j of JOBS) {
      rows[j].sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : a.id - b.id));
      const n = Math.max(rows[j].length, Math.min(seats(j), 8));
      widths[j] = Math.max(5, Math.min(m.maxBar, Math.floor((avail - 4) / Math.max(1, n)) - 2));
      rows[j].forEach((l, i) => order.set(l.id, { job: j, i, n }));
    }
    const colX = (job: Job, i: number) => m.icon + 6 + i * (widths[job] + 2);
    const rowY = (job: Job) => JOBS.indexOf(job) * (m.row + m.gap);
    const place = (e: HTMLElement, x: number, y: number) => {
      e.style.transform = `translate(${this.mirror ? -x : x}px, ${y}px)`;
    };
    const live = new Set<number>();
    for (const l of boat.crew.lees) {
      let b = this.bars.get(l.id);
      if (!l.alive) {
        if (!b) continue;
        if (b.deadAt === null) {
          b.deadAt = time;
          b.el.classList.add('dead');
        }
        if (time - b.deadAt > DEATH) {
          b.el.remove();
          this.bars.delete(l.id);
        } else live.add(l.id);
        continue;
      }
      live.add(l.id);
      const frac = Math.min(1, Math.max(0, l.hp / Math.max(1, l.maxHp)));
      if (!b) {
        const d = el('div', 'cb-bar');
        const chev = el('span', 'cb-chev');
        const lag = el('div', 'cb-lag');
        const fill = el('div', 'cb-fill');
        const prog = el('div', 'cb-prog');
        const lv = el('span', 'cb-lv');
        d.append(chev, lag, fill, prog, lv);
        this.root.append(d);
        b = { el: d, chev, lv, last: frac, hitAt: -99, deadAt: null };
        this.bars.set(l.id, b);
      }
      const o = order.get(l.id)!;
      const w = widths[o.job];
      let x = colX(o.job, o.i);
      let y = rowY(o.job);
      // In transit: slide from the old role's row to the new one over the walk.
      const k = l.jobEta > 0 ? Math.min(1, Math.max(0, (time - l.jobSince) / l.jobEta)) : 1;
      if (k < 1 && l.jobFrom !== l.job) {
        const e = k * k * (3 - 2 * k);
        const fx = colX(l.jobFrom, rows[l.jobFrom].length);
        x = fx + (x - fx) * e;
        y = rowY(l.jobFrom) + (y - rowY(l.jobFrom)) * e;
      }
      place(b.el, x, y + m.above);
      const st = b.el.style;
      st.setProperty('--w', `${w}px`);
      st.setProperty('--h', `${m.bar}px`);
      st.setProperty('--c', l.def.color);
      if (frac < b.last - 1e-4) b.hitAt = time;
      // A heal (or a first sight) snaps the red trail; a hit leaves it, then it drains.
      b.el.classList.toggle('healing', frac > b.last + 1e-4);
      b.last = frac;
      st.setProperty('--hp', `${(frac * 100).toFixed(1)}%`);
      st.setProperty('--lag', `${(frac * 100).toFixed(1)}%`);
      const prog = actionProgress(l, t);
      st.setProperty('--p', `${Math.round(100 * Math.min(1, Math.max(0, prog ?? 0)))}%`);
      b.el.classList.toggle('busy', prog !== null);
      b.el.classList.toggle('hit', time - b.hitAt < FLASH);
      b.el.classList.toggle('transit', k < 1);
      b.el.classList.toggle('away', l.deck !== l.boat || !!l.swing);
      b.el.classList.toggle('fighting', l.engaged);
      b.el.classList.toggle('order', l.order !== null);
      b.el.classList.toggle('danger', danger(l));
      b.el.classList.toggle('low', frac < 0.3);
      const buff = buffOf(l, boat, t);
      b.chev.textContent = buff > 0 ? '▲' : buff < 0 ? '▼' : '';
      b.chev.className = `cb-chev${buff > 0 ? ' up' : buff < 0 ? ' down' : ''}`;
      b.el.title = `${l.label} · level ${l.level} · ${Math.round(l.hp)}/${Math.round(l.maxHp)} HP${l.order !== null ? ' · answering a tap' : ''}`;
      const lv = w >= 12 ? String(l.level) : '';
      if (b.lv.textContent !== lv) b.lv.textContent = lv;
    }
    for (const [id, b] of this.bars) {
      if (live.has(id)) continue;
      b.el.remove();
      this.bars.delete(id);
    }
    // Hollow columns: empty seats of sail and fire.
    let h = 0;
    for (const j of ['sail', 'fire'] as Job[]) {
      const n = rows[j].length;
      const total = Math.min(seats(j), 8);
      for (let i = n; i < total; i++) {
        let d = this.hollow[h];
        if (!d) {
          d = el('div', 'cb-bar hollow');
          this.root.append(d);
          this.hollow.push(d);
        }
        d.style.display = '';
        d.style.setProperty('--w', `${widths[j]}px`);
        d.style.setProperty('--h', `${m.bar}px`);
        place(d, colX(j, i), rowY(j) + m.above);
        h++;
      }
    }
    for (let i = h; i < this.hollow.length; i++) this.hollow[i].style.display = 'none';
    // A small portrait under each group of a type, centered under its columns.
    let sIdx = 0;
    for (const j of JOBS) {
      let i = 0;
      while (i < rows[j].length) {
        const type = rows[j][i].def.id;
        let n = 1;
        while (i + n < rows[j].length && rows[j][i + n].def.id === type) n++;
        let img = this.syms[sIdx] as HTMLImageElement | undefined;
        if (!img || img.dataset.type !== type) {
          img?.remove();
          img = memberFigure(type, 'cb-sym');
          img.dataset.type = type;
          this.root.append(img);
          this.syms[sIdx] = img;
        }
        const size = m.below;
        const center = colX(j, i) + (n * (widths[j] + 2) - 2) / 2;
        place(img, center - size / 2, rowY(j) + m.above + m.bar + 1);
        img.style.width = img.style.height = `${size}px`;
        img.style.display = '';
        sIdx++;
        i += n;
      }
    }
    for (let i = sIdx; i < this.syms.length; i++) this.syms[i].style.display = 'none';
  }
}

export class ActionBar {
  readonly root: HTMLDivElement;
  private ctl: Controller;
  private buttons = new Map<Job, { btn: HTMLButtonElement; label: HTMLSpanElement }>();
  private mine: BarPanel;
  private theirs: BarPanel;
  private theirsFor: number | null = null;
  private theirsAlpha = 0;
  private stopped: HTMLDivElement;
  private builtFor = -1;
  private hold: { job: Job; next: number; first: boolean; id: number } | null = null;

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'action-bar hidden');
    this.mine = new BarPanel('mine', MINE, false, (job) => {
      const btn = el('button', `action-btn job-${job}`);
      const icon = el('span', 'action-icon', JOB_INFO[job].icon);
      const label = el('span', 'action-label', JOB_INFO[job].name);
      btn.append(icon, label);
      btn.onpointerdown = (e) => this.press(job, e, btn);
      btn.onpointerup = (e) => this.release(e);
      btn.onpointercancel = (e) => this.release(e);
      btn.onlostpointercapture = (e) => this.release(e);
      btn.oncontextmenu = (e) => e.preventDefault();
      this.buttons.set(job, { btn, label });
      return btn;
    });
    this.theirs = new BarPanel('theirs', THEIRS, true, (job) => el('div', `cb-icon job-${job}`, JOB_INFO[job].icon) as unknown as HTMLButtonElement);
    this.stopped = el('div', 'stopped-badge hidden', '⚓ STOPPED');
    this.root.append(this.theirs.root, this.mine.root, this.stopped);
  }

  private press(job: Job, e: PointerEvent, btn: HTMLButtonElement): void {
    e.preventDefault();
    e.stopPropagation();
    btn.setPointerCapture(e.pointerId);
    this.fire(job, btn);
    const t = this.ctl.tuning.jobs;
    this.hold = { job, next: performance.now() + Math.max(0.05, t.holdDelay) * 1000, first: true, id: e.pointerId };
  }

  private release(e: PointerEvent): void {
    if (!this.hold || this.hold.id !== e.pointerId) return;
    const b = this.buttons.get(this.hold.job)?.btn;
    b?.style.setProperty('--hold', '0');
    this.hold = null;
  }

  /** One order. A full job (or nobody to move) gives the button a little shake. */
  private fire(job: Job, btn: HTMLButtonElement): void {
    const lee = this.ctl.order(job);
    if (!lee) {
      btn.classList.remove('shake');
      void btn.offsetWidth;
      btn.classList.add('shake');
    }
  }

  frame(): void {
    const ctl = this.ctl;
    const w = ctl.world;
    // Hidden before the start and once it's over (the result card takes the space).
    const on = ctl.screen === 'fight' && w.phase === 'running';
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.hold = null;
      return;
    }
    if (this.builtFor !== ctl.runId) {
      this.builtFor = ctl.runId;
      this.mine.clear();
      this.theirs.clear();
      this.theirsFor = null;
    }
    // Hold to repeat, with the ring filling toward the next one.
    const now = performance.now();
    if (this.hold) {
      const t = ctl.tuning.jobs;
      const b = this.buttons.get(this.hold.job)!.btn;
      const period = (this.hold.first ? Math.max(0.05, t.holdDelay) : Math.max(0.05, t.holdRepeat)) * 1000;
      b.style.setProperty('--hold', String(Math.min(1, 1 - (this.hold.next - now) / period)));
      if (now >= this.hold.next) {
        this.fire(this.hold.job, b);
        this.hold.first = false;
        this.hold.next = now + Math.max(0.05, t.holdRepeat) * 1000;
      }
    }

    // Labels: SAIL / RETREAT (while connected or with boarders out); ⚔️ BOARD / RAM / CHARGE (greyed without a target).
    const sail = this.buttons.get('sail')!;
    const retreat = w.canRetreat();
    setText(sail.label, retreat ? 'RETREAT' : 'SAIL');
    sail.btn.classList.toggle('retreat', retreat);
    const melee = w.meleeMode();
    const board = this.buttons.get('board')!;
    setText(board.label, melee === 'ram' ? 'RAM' : melee === 'charge' ? 'CHARGE' : 'BOARD');
    board.btn.classList.toggle('disabled', melee === null);
    board.btn.classList.toggle('charge', melee === 'charge');
    const t = ctl.tuning;
    for (const job of ['sail', 'fire'] as Job[]) {
      const b = this.buttons.get(job)!.btn;
      const full = jobSeats(w.player, job, t) <= w.player.crew.lees.filter((l) => l.alive && l.job === job).length;
      b.classList.toggle('full', full && !(job === 'sail' && retreat));
    }
    this.stopped.classList.toggle('hidden', !w.player.stopped || w.player.sinkingSince !== null);

    // Bars: columns use the width of their side of the screen.
    const width = this.root.clientWidth || 360;
    this.mine.update(w.player, w.time, t, Math.max(60, width * 0.58 - MINE.icon - 10), (j) => jobSeats(w.player, j, t), (l) => w.zones.inDanger(l));

    // Enemy bars: the ship you're closing on (or that's closing on you), only while melee is imminent.
    const engaged = w.engagedEnemy();
    if (engaged && this.theirsFor !== engaged.id) {
      this.theirs.clear();
      this.theirsFor = engaged.id;
    }
    this.theirsAlpha += ((engaged ? 1 : 0) - this.theirsAlpha) * 0.12;
    this.theirs.root.style.opacity = this.theirsAlpha.toFixed(2);
    const shown = this.theirsFor !== null ? w.enemies.find((e) => e.id === this.theirsFor) : undefined;
    if (shown) this.theirs.update(shown, w.time, t, Math.max(50, width * 0.38 - THEIRS.icon - 8), (j) => jobSeats(shown, j, t));
    if (!engaged && this.theirsAlpha < 0.02) {
      this.theirs.clear();
      this.theirsFor = null;
    }
  }

}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

/** Progress on what a Lee is doing (0..1), or null for steady work (rowing, sailing, the lookout) and walking. */
function actionProgress(l: Lee, t: Tuning): number | null {
  if (l.swing) return l.swing.t / Math.max(1e-6, l.swing.dur);
  if (!l.working || l.engaged || l.deck !== l.boat) return null;
  const act = activity(l);
  const b = l.boat;
  if (act === 'gun' || act === 'pump') return l.progress;
  if (act === 'repair') {
    const part = b.parts[l.task.target];
    const st = part.layers[part.layers.length - 1];
    return st.hp / Math.max(1e-6, st.maxHp * t.crew.repairCeiling);
  }
  if (act === 'bail') {
    const part = b.parts[l.task.target];
    return 1 - (part.capacity > 0 ? part.water / part.capacity : 0);
  }
  return null;
}

/** +1 while something is helping the Lee (the pit-stop bonus while stopped and fixing, a plank under a boarder), -1 while something slows it (wet feet, wounds with enemies about), else 0. */
function buffOf(l: Lee, boat: Boat, t: Tuning): number {
  if (!l.alive) return 0;
  if (isWet(l, boat, t) || l.retreating) return -1;
  if (boat.stopped && l.job === 'fix' && boat.fx.fix > 1) return 1;
  if (l.boardBuff && l.deck !== l.boat) return 1;
  const tile = l.deck.grid.tiles[l.tile];
  const occ = l.deck === boat ? boat.mods.occupant[l.tile] : undefined;
  if (tile && occ && Object.values(occ).some((v) => v > 1.001)) return 1;
  return 0;
}
