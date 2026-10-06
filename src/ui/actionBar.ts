// The four action buttons at the seam between the ocean and the close-up:
// ⏩ SAIL (RETREAT in melee), 🔫 FIRE, ⚔️ BOARD / RAM / CHARGE, 🛠️ FIX. A tap
// moves one Lee (best fit) into that job; holding repeats. Under each button,
// one pip per Lee in that job: color = Lee type, fill = HP, number = level,
// ring = progress on what it's doing; hollow pips are empty seats. A pip
// slides between buttons over the time its Lee takes to walk there. When a
// RAM or BOARD approach is underway, the enemy ship's pips fade in above the
// buttons, grouped the same way. Reads the world; orders go through the Controller.

import { JOB_INFO, JOBS, type Job } from '../config/lees';
import type { Controller } from '../game/Controller';
import type { Boat } from '../sim/boat';
import type { Tuning } from '../config/tuning';
import { activity, jobSeats, type Lee } from '../sim/crew';
import { el } from './dom';

const PIP = 18;
const GAP = 3;
/** Seconds a dead Lee's pip lingers for its death effect. */
const DEATH = 0.6;

interface PipEl {
  el: HTMLDivElement;
  level: HTMLSpanElement;
  /** Seen dead since (world time), or null. */
  deadAt: number | null;
}

/** One row of pips (yours or the enemy's) over the four buttons. */
class PipRow {
  readonly root: HTMLDivElement;
  private pips = new Map<number, PipEl>();
  private hollow: HTMLDivElement[] = [];

  /** Extra rows stack downward (yours, under the buttons) or upward (theirs, above them). */
  private dir: 1 | -1;

  constructor(cls: string, dir: 1 | -1) {
    this.root = el('div', `pip-row ${cls}`);
    this.dir = dir;
  }

  clear(): void {
    this.root.replaceChildren();
    this.pips.clear();
    this.hollow = [];
  }

  /**
   * Lay out a crew's pips. `colX(job)` is the center of that button's column
   * (px, in this row's frame). Seats (sail, fire) add hollow pips.
   */
  update(boat: Boat, time: number, t: Tuning, colX: (j: Job) => number, seats: (j: Job) => number): void {
    const crew = boat.crew.lees;
    const rows: Record<Job, Lee[]> = { sail: [], fire: [], board: [], fix: [] };
    for (const l of crew) if (l.alive) rows[l.job].push(l);
    // Slot index of each Lee within its job's row (by id, so the order is stable).
    const slot = new Map<number, { job: Job; i: number; n: number }>();
    for (const j of JOBS) {
      rows[j].sort((a, b) => a.id - b.id);
      rows[j].forEach((l, i) => slot.set(l.id, { job: j, i, n: Math.max(rows[j].length, Math.min(seats(j), 8)) }));
    }
    const xOf = (job: Job, i: number, n: number) => {
      const per = Math.max(1, Math.min(n, 4));
      const col = i % per;
      return colX(job) + (col - (per - 1) / 2) * (PIP + GAP);
    };
    const yOf = (i: number, n: number) => this.dir * Math.floor(i / Math.max(1, Math.min(n, 4))) * (PIP + GAP);
    const live = new Set<number>();
    for (const l of crew) {
      let p = this.pips.get(l.id);
      if (!l.alive) {
        if (!p) continue;
        if (p.deadAt === null) {
          p.deadAt = time;
          p.el.classList.add('dead');
        }
        if (time - p.deadAt > DEATH) {
          p.el.remove();
          this.pips.delete(l.id);
        } else live.add(l.id);
        continue;
      }
      live.add(l.id);
      if (!p) {
        const d = el('div', 'pip');
        const level = el('span', 'pip-lv');
        d.append(level);
        this.root.append(d);
        p = { el: d, level, deadAt: null };
        this.pips.set(l.id, p);
      }
      const s = slot.get(l.id)!;
      let x = xOf(s.job, s.i, s.n);
      let y = yOf(s.i, s.n);
      // In transit: slide from the old button to the new one over the walk.
      const k = l.jobEta > 0 ? Math.min(1, Math.max(0, (time - l.jobSince) / l.jobEta)) : 1;
      if (k < 1 && l.jobFrom !== l.job) {
        const from = xOf(l.jobFrom, rows[l.jobFrom].length, rows[l.jobFrom].length + 1);
        const e = k * k * (3 - 2 * k);
        x = from + (x - from) * e;
        y = y * e;
      }
      const st = p.el.style;
      st.transform = `translate(${(x - PIP / 2).toFixed(1)}px, ${y.toFixed(1)}px)`;
      st.setProperty('--c', l.def.color);
      st.setProperty('--hp', `${Math.round((100 * Math.max(0, l.hp)) / Math.max(1, l.maxHp))}%`);
      const prog = actionProgress(l, t);
      const busy = prog !== null;
      st.setProperty('--p', `${Math.round(100 * Math.min(1, Math.max(0, prog ?? 0)))}%`);
      p.el.classList.toggle('busy', busy);
      p.el.classList.toggle('transit', k < 1);
      p.el.classList.toggle('away', l.deck !== l.boat || !!l.swing);
      p.el.classList.toggle('fighting', l.engaged);
      p.el.title = `${l.label} · level ${l.level} · ${Math.round(l.hp)}/${Math.round(l.maxHp)} HP`;
      const lv = String(l.level);
      if (p.level.textContent !== lv) p.level.textContent = lv;
    }
    for (const [id, p] of this.pips) {
      if (live.has(id)) continue;
      p.el.remove();
      this.pips.delete(id);
    }
    // Hollow pips: empty seats of sail and fire.
    let h = 0;
    for (const j of ['sail', 'fire'] as Job[]) {
      const n = rows[j].length;
      const total = Math.min(seats(j), 8);
      for (let i = n; i < total; i++) {
        let d = this.hollow[h];
        if (!d) {
          d = el('div', 'pip hollow');
          this.root.append(d);
          this.hollow.push(d);
        }
        d.style.display = '';
        d.style.transform = `translate(${(xOf(j, i, total) - PIP / 2).toFixed(1)}px, ${yOf(i, total).toFixed(1)}px)`;
        h++;
      }
    }
    for (let i = h; i < this.hollow.length; i++) this.hollow[i].style.display = 'none';
  }
}

export class ActionBar {
  readonly root: HTMLDivElement;
  private ctl: Controller;
  private buttons = new Map<Job, { btn: HTMLButtonElement; label: HTMLSpanElement }>();
  private mine = new PipRow('mine', 1);
  private theirs = new PipRow('theirs', -1);
  private theirsFor: number | null = null;
  private theirsAlpha = 0;
  private stopped: HTMLDivElement;
  private builtFor = -1;
  private hold: { job: Job; next: number; first: boolean; id: number } | null = null;

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'action-bar hidden');
    const btns = el('div', 'action-buttons');
    for (const job of JOBS) {
      const btn = el('button', `action-btn job-${job}`);
      const icon = el('span', 'action-icon', JOB_INFO[job].icon);
      const label = el('span', 'action-label', JOB_INFO[job].name);
      btn.append(icon, label);
      btn.onpointerdown = (e) => this.press(job, e, btn);
      btn.onpointerup = (e) => this.release(e);
      btn.onpointercancel = (e) => this.release(e);
      btn.onlostpointercapture = (e) => this.release(e);
      btn.oncontextmenu = (e) => e.preventDefault();
      btns.append(btn);
      this.buttons.set(job, { btn, label });
    }
    this.stopped = el('div', 'stopped-badge hidden', '⚓ STOPPED · fixing and aim +25%');
    this.root.append(this.theirs.root, btns, this.mine.root, this.stopped);
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
    const w = this.ctl.world;
    const retreat = job === 'sail' && w.canRetreat();
    const lee = this.ctl.order(job);
    if (!lee && !retreat) {
      btn.classList.remove('shake');
      void btn.offsetWidth;
      btn.classList.add('shake');
    }
  }

  frame(): void {
    const ctl = this.ctl;
    const w = ctl.world;
    const on = ctl.screen === 'fight' && w.phase !== 'ready';
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

    // Labels: SAIL / RETREAT; ⚔️ BOARD / RAM / CHARGE (greyed without a target).
    const sail = this.buttons.get('sail')!;
    const retreat = w.canRetreat();
    setText(sail.label, w.retreating ? 'RETREATING' : retreat ? 'RETREAT' : 'SAIL');
    sail.btn.classList.toggle('retreat', retreat || w.retreating);
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

    // Pips: positions are in the bar's frame; each button's column center.
    const width = this.root.clientWidth || 360;
    const colX = (j: Job) => ((JOBS.indexOf(j) + 0.5) / JOBS.length) * width;
    this.mine.update(w.player, w.time, t, colX, (j) => jobSeats(w.player, j, t));

    // Enemy pips: the ship you're closing on (or that's closing on you), only while melee is imminent.
    const engaged = this.engagedEnemy();
    if (engaged && this.theirsFor !== engaged.id) {
      this.theirs.clear();
      this.theirsFor = engaged.id;
    }
    this.theirsAlpha += ((engaged ? 1 : 0) - this.theirsAlpha) * 0.12;
    this.theirs.root.style.opacity = this.theirsAlpha.toFixed(2);
    const shown = this.theirsFor !== null ? w.enemies.find((e) => e.id === this.theirsFor) : undefined;
    if (shown) this.theirs.update(shown, w.time, t, colX, (j) => jobSeats(shown, j, t));
    if (!engaged && this.theirsAlpha < 0.02) {
      this.theirs.clear();
      this.theirsFor = null;
    }
  }

  /**
   * The enemy whose pips show: in close combat with you, or on a RAM/BOARD
   * approach (yours toward it, or its own toward you) and close enough that
   * melee is imminent.
   */
  private engagedEnemy(): Boat | null {
    const w = this.ctl.world;
    const touching = w.touching(w.player).find((e) => !w.isOut(e));
    if (touching) return touching;
    const near = (e: Boat) => w.closeness(w.player) > 0 && w.closeBoats().includes(e);
    const h = w.helm;
    if (h.kind === 'board' || h.kind === 'ram') {
      const e = w.enemies.find((x) => x.id === h.boatId && !w.isOut(x));
      if (e && (near(e) || Math.hypot(e.motion.x - w.player.motion.x, e.motion.y - w.player.motion.y) < 90)) return e;
    }
    for (const e of w.enemies) {
      if (w.isOut(e)) continue;
      const mode = w.brains.get(e.id)?.mode;
      if ((mode === 'alongside' || mode === 'ram' || mode === 'hold') && Math.hypot(e.motion.x - w.player.motion.x, e.motion.y - w.player.motion.y) < 90) return e;
    }
    return null;
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
