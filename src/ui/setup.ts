// Setup mode: place Lees on the deck grid before a fight. The grid is DOM
// laid exactly over the boat the strip camera draws (via the Controller's
// strip projection), so tiles are crisp, labelled, comfortable touch targets.
//
//  - Tap a Lee (tray or deck) to select it; tap a tile to put it there. Tapping
//    another Lee swaps them. Drag-and-drop does the same; drop off the deck to
//    send a Lee back to the tray.
//  - While a Lee is selected every tile says what it would make that Lee.

import { LEE_DEFS, LEE_STAT_KEYS, STAT_LABELS } from '../config/lees';
import { CREWS } from '../config/crews';
import type { Controller } from '../game/Controller';
import { roleName } from '../sim/crew';
import type { Tile } from '../sim/grid';
import type { Vec } from '../sim/math';
import { iconUrl, leeUrl, STATION_ICON } from './crewArt';

const NOTE_KEY = 'lee.crew.noteSeen';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* fine: the note just shows again */
  }
}

/** Clip a polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
function clipToRect(poly: readonly Vec[], x0: number, y0: number, x1: number, y1: number): Vec[] {
  let out = [...poly];
  const edges: [(p: Vec) => boolean, (a: Vec, b: Vec) => Vec][] = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })],
  ];
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length];
      const b = input[i];
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cross(a, b));
    }
  }
  return out;
}

function tier(v: number): string {
  if (v < 0.75) return 'Low';
  if (v < 1.15) return 'Average';
  if (v < 1.6) return 'Good';
  return 'Great';
}

export class SetupPanel {
  readonly root: HTMLDivElement;
  /** Info card; lives over the ocean panel so it never covers the deck. */
  readonly card: HTMLDivElement;
  private ctl: Controller;
  private gridEl: HTMLDivElement;
  private tileEls: HTMLDivElement[] = [];
  private tray: HTMLDivElement;
  private bar: HTMLDivElement;
  private hint: HTMLDivElement;
  /** Tray, hint and buttons stacked under the deck. */
  private below: HTMLDivElement;
  private selected: number | null = null;
  private drag: { slot: number; x: number; y: number; id: number; ghost: HTMLDivElement | null; from: HTMLElement } | null = null;
  private suppressClick = false;
  private builtFor: unknown = null;
  private lastSig = '';

  constructor(ctl: Controller, onStart: () => void) {
    this.ctl = ctl;
    this.root = el('div', 'setup hidden');
    this.gridEl = el('div', 'setup-grid');
    this.tray = el('div', 'setup-tray');
    this.hint = el('div', 'setup-hint');
    this.bar = el('div', 'setup-bar');
    const clear = el('button', 'hud-btn', 'Clear all');
    clear.onclick = () => {
      this.selected = null;
      ctl.clearCrew();
    };
    const auto = el('button', 'hud-btn', 'Auto-arrange');
    auto.onclick = () => {
      this.selected = null;
      ctl.autoArrangeCrew();
    };
    const start = el('button', 'start-btn', 'START');
    start.onclick = () => {
      this.selected = null;
      onStart();
    };
    this.bar.append(clear, auto, start);
    this.below = el('div', 'setup-below');
    this.below.append(this.tray, this.hint, this.bar);
    this.root.append(this.gridEl, this.below);
    this.card = el('div', 'lee-card hidden');
    // Tapping the tray background with a placed Lee selected sends it back.
    this.tray.onclick = (e) => {
      if (e.target !== this.tray || this.selected === null) return;
      if (this.ctl.arrangement[this.selected] !== null) this.ctl.placeLee(this.selected, null);
      this.selected = null;
      this.render();
    };
    ctl.onChange(() => this.render());
  }

  private get tiles(): Tile[] {
    return this.ctl.world.player.grid.tiles;
  }

  /** Per frame: show/hide and keep the grid glued to the boat. */
  frame(): void {
    const w = this.ctl.world;
    const on = w.phase === 'ready';
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.card.classList.add('hidden');
      this.selected = null;
      return;
    }
    if (this.builtFor !== w.player.grid) this.buildTiles();
    const proj = this.ctl.stripProjection;
    if (!proj) return;
    let bottom = 0;
    let left = Infinity;
    let right = -Infinity;
    this.tiles.forEach((t, i) => {
      const a = proj.toCss({ x: t.x0, y: t.y0 });
      const b = proj.toCss({ x: t.x1, y: t.y1 });
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const s = this.tileEls[i].style;
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.width = `${Math.abs(b.x - a.x)}px`;
      s.height = `${Math.abs(b.y - a.y)}px`;
      bottom = Math.max(bottom, Math.max(a.y, b.y));
      left = Math.min(left, x);
      right = Math.max(right, x + Math.abs(b.x - a.x));
    });
    const hull = proj.toCss({ x: 0, y: w.player.layout.beam / 2 }).y;
    this.below.style.top = `${Math.max(bottom, hull) + 10}px`;
    if (!this.drag) this.render(true);
  }

  private buildTiles(): void {
    const boat = this.ctl.world.player;
    this.builtFor = boat.grid;
    this.gridEl.replaceChildren();
    this.tileEls = this.tiles.map((t) => {
      const d = el('div', `tile${t.station ? ` station ${t.station}` : ''}`);
      const face = el('div', 'tile-face');
      const part = boat.layout.parts[t.part];
      const clip = clipToRect(part.polygon, t.x0, t.y0, t.x1, t.y1);
      const w = t.x1 - t.x0;
      const h = t.y1 - t.y0;
      face.style.clipPath = `polygon(${clip.map((p) => `${(((p.x - t.x0) / w) * 100).toFixed(1)}% ${(((p.y - t.y0) / h) * 100).toFixed(1)}%`).join(', ')})`;
      d.append(face);
      if (t.station) {
        const icon = el('img', 'tile-icon');
        icon.src = iconUrl(STATION_ICON[t.station] as never);
        icon.draggable = false;
        d.append(icon);
      }
      d.onclick = () => this.tapTile(t.index);
      this.gridEl.append(d);
      return d;
    });
    this.lastSig = '';
  }

  /** Rebuild tokens, labels, tray and card when anything they show changes. */
  private render(cheap = false): void {
    if (this.drag) return; // the dragged token holds pointer capture; don't rebuild it
    const a = this.ctl.arrangement;
    const sig = JSON.stringify([a, this.selected, this.tileEls.length]);
    if (cheap && sig === this.lastSig) return;
    this.lastSig = sig;
    if (this.selected !== null && this.selected >= a.length) this.selected = null;
    const sel = this.selected;

    this.tileEls.forEach((d, i) => {
      for (const c of [...d.querySelectorAll('.token')]) c.remove();
      const slot = a.indexOf(i);
      d.classList.toggle('occupied', slot >= 0);
      if (slot >= 0) d.append(this.token(slot, sel === slot));
    });
    this.updateLabels(sel);

    this.tray.replaceChildren();
    const ashore = a.map((t, slot) => (t === null ? slot : -1)).filter((s) => s >= 0);
    if (!ashore.length) this.tray.append(el('span', 'tray-empty', a.length ? 'All hands aboard' : 'No crew (Tune → crew size)'));
    for (const slot of ashore) this.tray.append(this.token(slot, sel === slot));

    this.hint.textContent =
      sel === null
        ? 'Tap a Lee, then a tile (or drag it). Its tile sets its job.'
        : a[sel] === null
          ? `Place #${sel + 1}: tap a tile`
          : `Move #${sel + 1}: tap a tile, another Lee to swap, or the tray to unload`;
    this.renderCard();
  }

  /** With a Lee selected, every tile says what it would make that Lee. */
  private updateLabels(sel: number | null): void {
    const a = this.ctl.arrangement;
    const boat = this.ctl.world.player;
    this.tileEls.forEach((d, i) => {
      for (const c of [...d.querySelectorAll('.tile-label')]) c.remove();
      d.classList.toggle('targets', sel !== null);
      d.classList.toggle('mine', sel !== null && a[sel] === i);
      if (sel === null || a[sel] === i) return;
      const t = this.tiles[i];
      const slot = a.indexOf(i);
      const role = roleName(boat, i);
      const label = el('div', 'tile-label');
      if (slot >= 0) {
        // Occupied: the role it would get, and that tapping swaps.
        label.append(el('b', '', `⇄ ${role}`));
      } else {
        label.append(el('b', '', role));
        const detail = t.station ? t.label : boat.layout.parts[t.part].label;
        if (detail !== role) label.append(el('span', '', detail));
      }
      d.append(label);
    });
  }

  private token(slot: number, selected: boolean): HTMLDivElement {
    const def = LEE_DEFS[CREWS.player.lee] ?? Object.values(LEE_DEFS)[0];
    const t = el('div', `token${selected ? ' selected' : ''}`);
    const img = el('img');
    img.src = leeUrl(def.art);
    img.draggable = false;
    t.append(img, el('span', 'badge', String(slot + 1)));
    t.onpointerdown = (e) => this.pressToken(slot, e, t);
    t.onclick = (e) => {
      e.stopPropagation();
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.tapLee(slot);
    };
    return t;
  }

  // ------------------------------------------------------------ taps

  private tapLee(slot: number): void {
    const a = this.ctl.arrangement;
    const sel = this.selected;
    if (sel === null || sel === slot) {
      this.selected = sel === slot ? null : slot;
      this.render();
      return;
    }
    const target = a[slot];
    if (target === null) {
      // Another tray Lee: select it instead.
      this.selected = slot;
      this.render();
      return;
    }
    this.selected = null;
    this.ctl.placeLee(sel, target);
  }

  private tapTile(tile: number): void {
    const sel = this.selected;
    if (sel === null) {
      const occupant = this.ctl.arrangement.indexOf(tile);
      if (occupant >= 0) this.tapLee(occupant);
      return;
    }
    this.selected = null;
    if (this.ctl.arrangement[sel] === tile) {
      this.render();
      return;
    }
    this.ctl.placeLee(sel, tile);
  }

  // ------------------------------------------------------------ drag and drop

  private pressToken(slot: number, e: PointerEvent, from: HTMLElement): void {
    if (this.drag) return;
    e.stopPropagation();
    from.setPointerCapture(e.pointerId);
    this.drag = { slot, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, from };
    from.onpointermove = (m) => this.moveDrag(m);
    from.onpointerup = (u) => this.endDrag(u, false);
    from.onpointercancel = (u) => this.endDrag(u, true);
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.ghost && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
      d.ghost = el('div', 'token drag-ghost');
      const img = el('img');
      img.src = leeUrl((LEE_DEFS[CREWS.player.lee] ?? Object.values(LEE_DEFS)[0]).art);
      d.ghost.append(img, el('span', 'badge', String(d.slot + 1)));
      document.body.append(d.ghost);
      d.from.classList.add('dragging');
      this.card.classList.add('hidden');
      this.updateLabels(d.slot);
    }
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      this.tileEls.forEach((t, i) => t.classList.toggle('drop', i === this.tileAtPoint(e.clientX, e.clientY)));
    }
  }

  private endDrag(e: PointerEvent, cancelled: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.from.onpointermove = null;
    d.from.onpointerup = null;
    d.from.onpointercancel = null;
    if (!d.ghost) return; // a tap: the click handler takes it
    d.ghost.remove();
    d.from.classList.remove('dragging');
    for (const t of this.tileEls) t.classList.remove('drop');
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    this.selected = null;
    this.lastSig = '';
    if (cancelled) {
      this.render();
      return;
    }
    const tile = this.tileAtPoint(e.clientX, e.clientY);
    if (tile !== null) this.ctl.placeLee(d.slot, tile);
    else if (this.ctl.arrangement[d.slot] !== null) this.ctl.placeLee(d.slot, null); // dropped off the deck
    else this.render();
  }

  private tileAtPoint(x: number, y: number): number | null {
    for (let i = 0; i < this.tileEls.length; i++) {
      const r = this.tileEls[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return null;
  }

  // ------------------------------------------------------------ info card

  private renderCard(): void {
    const slot = this.selected;
    if (slot === null || this.ctl.world.phase !== 'ready') {
      this.card.classList.add('hidden');
      return;
    }
    const boat = this.ctl.world.player;
    const t = this.ctl.tuning;
    const def = LEE_DEFS[CREWS.player.lee] ?? Object.values(LEE_DEFS)[0];
    const home = this.ctl.arrangement[slot];
    this.card.replaceChildren();

    const head = el('div', 'card-head');
    const img = el('img', 'card-figure');
    img.src = leeUrl(def.art);
    const names = el('div', 'card-names');
    names.append(el('div', 'card-name', `${def.name} #${slot + 1}`), el('div', 'card-flavor', def.flavor));
    head.append(img, names);

    const role = el('div', 'card-role');
    if (home === null) role.append(el('b', '', 'In the tray'), el('span', '', ' — stays ashore unless placed'));
    else {
      const tile = boat.grid.tiles[home];
      role.append(el('b', '', roleName(boat, home)), el('span', '', ` — ${tile.station ? tile.label : `${boat.layout.parts[tile.part].label} deck`}`));
    }

    const stats = el('div', 'card-stats');
    for (const k of LEE_STAT_KEYS) {
      const v = (t.lees[def.id]?.[k] ?? def.stats[k]) * t.global.playerCrewStats;
      const row = el('div', 'card-stat');
      const bar = el('div', 'card-bar');
      const fill = el('div', 'card-fill');
      fill.style.width = `${Math.min(100, v * 50)}%`;
      bar.append(fill);
      row.append(el('span', 'card-stat-k', STAT_LABELS[k]), bar, el('span', 'card-stat-v', tier(v)));
      stats.append(row);
    }

    const special = el('div', 'card-special');
    special.append(el('b', '', 'Special: '), el('span', '', def.abilities.length ? `${def.abilities.length} ability` : '—'));

    this.card.append(head, role, stats, special);

    if (!storageGet(NOTE_KEY)) {
      const note = el('div', 'card-note');
      note.append(el('span', '', 'During the fight, Lees run to wherever they are needed most (an open gun facing the enemy, a hit part, rising water), then come back here when it passes.'));
      const ok = el('button', 'hud-btn', 'Got it');
      ok.onclick = () => {
        storageSet(NOTE_KEY, '1');
        note.remove();
      };
      note.append(ok);
      this.card.append(note);
    }

    const buttons = el('div', 'card-buttons');
    if (home !== null) {
      const tray = el('button', 'hud-btn', 'To tray');
      tray.onclick = () => {
        this.selected = null;
        this.ctl.placeLee(slot, null);
      };
      buttons.append(tray);
    }
    const done = el('button', 'hud-btn', 'Done');
    done.onclick = () => {
      this.selected = null;
      this.render();
    };
    buttons.append(done);
    this.card.append(buttons);
    this.card.classList.remove('hidden');
  }
}
