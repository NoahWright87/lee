// The refit screen: the player's home between fights (replaces Phase 2/3's
// setup mode). The canvas shows your boat from above (ocean) and its deck at
// touch size (strip); this DOM layer sits on top.
//
//  - Deck: place and move Lees (tap or drag), as before. Each tile says what a
//    selected Lee would do there and what it changes.
//  - Parts: the boat's typed slots (edge slots with a facing arrow), shown a
//    layer at a time (fixtures, rails, floors, hull & treasures), and the cargo
//    hold. Pick an item to light up the slots it fits (others dim), pick a slot
//    to see what's in it. The stat card shows before → after.
//  - Crew: the roster with levels, XP, stats after every modifier, trinkets,
//    and Release.
//  - Sandbox (sandbox only): your ship and the encounter you fight.
//
// Always visible: the boat's stat card (computed from a real boat with this
// crew), warnings, the next fight, and Launch.

import { ARCHETYPE_NAMES, ARCHETYPES, ENCOUNTERS, crewCount, type EnemySpec } from '../config/encounters';
import { CATEGORY_NAMES, ITEMS, type ItemDef } from '../config/items';
import { LEE_DEFS, STAT_LABELS } from '../config/lees';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import { FACING_ARROW, FACING_NAME, FACINGS, SLOT_TYPES, type Facing, type SlotType } from '../config/slots';
import { countTags, tagName } from '../config/tags';
import type { Controller } from '../game/Controller';
import { boatCard, type BoatCard } from '../sim/boatStats';
import { roleName } from '../sim/crew';
import type { Tile } from '../sim/grid';
import { bonusLabel } from '../sim/levels';
import { buildTags, slotById } from '../sim/loadout';
import type { Vec } from '../sim/math';
import {
  canEquip,
  cargo,
  crewMax,
  crewMin,
  crewSpecs,
  encounterSummary,
  equip as equipRun,
  itemOf,
  runSlots,
  setupFor,
  slotType,
  type CrewMember,
  type RunState,
} from '../sim/run';
import { World } from '../sim/world';
import { fullStats, itemCard, itemIcon, levelBadge, memberFigure, tagChips } from './cards';
import { iconUrl, STATION_ICON, gunIcon } from './crewArt';
import { button, confirmAction, el } from './dom';

type Tab = 'deck' | 'parts' | 'crew' | 'sandbox';
type Layer = 'fixture' | 'rail' | 'floor' | 'hull';

/** What's picked up in the Parts tab: an owned item, or (sandbox) an item from the catalog. */
type Pick = { uid: number } | { id: string };

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

const LAYER_TYPES: Record<Layer, SlotType[]> = { fixture: ['edge', 'interior', 'attachment'], rail: ['rail'], floor: ['floor'], hull: ['hull', 'treasure'] };
const LAYER_NAMES: Record<Layer, string> = { fixture: 'Guns & stations', rail: 'Rails', floor: 'Floors', hull: 'Hull & treasures' };

function layerOf(type: SlotType): Layer | null {
  for (const [k, v] of Object.entries(LAYER_TYPES)) if (v.includes(type)) return k as Layer;
  return null;
}

/** Card rows: [label, value, format, higher is better]. */
const CARD_ROWS: [string, (c: BoatCard) => number, (v: number, c: BoatCard) => string][] = [
  ['Speed', (c) => c.speed, (v) => `${v.toFixed(1)} m/s`],
  ['Turning', (c) => c.turn, (v) => `${v.toFixed(1)}°/s`],
  ['Hull HP', (c) => c.hullHp, (v) => `${Math.round(v)}`],
  ['Flood resistance', (c) => c.floodResist, (v) => (Number.isFinite(v) ? `${Math.round(v)} s` : '∞')],
  ['Gun range', (c) => c.range, (v) => `${Math.round(v)} m`],
  ['Arc coverage', (c) => c.arcCoverage, (v) => `${Math.round(v)}°`],
  ['Hull dmg/min', (c) => c.hullDpm, (v) => `${Math.round(v)}`],
  ['Crew dmg/min', (c) => c.crewDpm, (v) => `${Math.round(v)}`],
  ['Guns manned', (c) => c.gunsManned, (v, c) => `${v}/${c.guns}`],
  ['Crew', (c) => c.crew, (v, c) => `${v}/${c.crewMax}`],
];

export class RefitPanel {
  /** Deck grid + lower panel (over the strip). */
  readonly root: HTMLDivElement;
  /** Tabs, stat card, warnings (over the ocean). */
  readonly top: HTMLDivElement;
  /** Info card (over the bottom of the ocean). */
  readonly card: HTMLDivElement;
  private ctl: Controller;
  private toast: (text: string) => void;
  private gridEl: HTMLDivElement;
  private tileEls: HTMLDivElement[] = [];
  private below: HTMLDivElement;
  private bar: HTMLDivElement;
  private tab: Tab = 'deck';
  private layer: Layer = 'fixture';
  /** Deck tab: selected crew member (uid). */
  private selLee: number | null = null;
  /** Parts tab: selected slot and/or picked item. */
  private selSlot: string | null = null;
  private pick: Pick | null = null;
  /** Crew tab: selected member, and which of its trinket slots (if any). */
  private selMember: number | null = null;
  private selTrinket: number | null = null;
  /** Lees whose station a refit removed (flagged until the next launch). */
  private displaced = new Set<number>();
  private drag: { uid: number; x: number; y: number; id: number; ghost: HTMLDivElement | null; from: HTMLElement; over: number | null } | null = null;
  private suppressClick = false;
  private builtFor: unknown = null;
  private lastSig = '';
  private preview: BoatCard | null = null;

  constructor(ctl: Controller, toast: (text: string) => void) {
    this.ctl = ctl;
    this.toast = toast;
    this.root = el('div', 'setup hidden');
    this.gridEl = el('div', 'setup-grid');
    this.below = el('div', 'setup-below');
    this.bar = el('div', 'setup-bar');
    this.root.append(this.gridEl, this.below, this.bar);
    this.top = el('div', 'refit-top hidden');
    this.card = el('div', 'lee-card hidden');
    ctl.onChange(() => this.render());
  }

  private get run(): RunState | null {
    return this.ctl.active;
  }

  private get tiles(): Tile[] {
    return this.ctl.world.player.grid.tiles;
  }

  private get on(): boolean {
    return this.ctl.screen === 'refit' && this.ctl.world.phase === 'ready' && !!this.run;
  }

  // ------------------------------------------------------------ per frame

  /** Per frame: show/hide and keep the grid glued to the boat. */
  frame(): void {
    const on = this.on;
    this.root.classList.toggle('hidden', !on);
    this.top.classList.toggle('hidden', !on);
    if (!on) {
      this.card.classList.add('hidden');
      return;
    }
    if (this.builtFor !== this.ctl.world.player.grid) this.buildTiles();
    const proj = this.ctl.stripProjection;
    if (!proj) return;
    let bottom = 0;
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
    });
    const hull = proj.toCss({ x: 0, y: this.ctl.world.player.layout.beam / 2 }).y;
    const below = this.tab === 'crew' || this.tab === 'sandbox' ? proj.top + 6 : Math.max(bottom, hull) + 10;
    this.below.style.top = `${below}px`;
    this.gridEl.classList.toggle('hidden', this.tab === 'crew' || this.tab === 'sandbox');
    if (!this.drag) this.render(true);
  }

  private buildTiles(): void {
    const boat = this.ctl.world.player;
    this.builtFor = boat.grid;
    this.gridEl.replaceChildren();
    this.tileEls = this.tiles.map((t) => {
      const d = el('div', 'tile');
      const face = el('div', 'tile-face');
      const part = boat.layout.parts[t.part];
      const clip = clipToRect(part.polygon, t.x0, t.y0, t.x1, t.y1);
      const w = t.x1 - t.x0;
      const h = t.y1 - t.y0;
      face.style.clipPath = `polygon(${clip.map((p) => `${(((p.x - t.x0) / w) * 100).toFixed(1)}% ${(((p.y - t.y0) / h) * 100).toFixed(1)}%`).join(', ')})`;
      d.append(face);
      d.onclick = () => this.tapTile(t.index);
      this.gridEl.append(d);
      return d;
    });
    this.lastSig = '';
  }

  // ------------------------------------------------------------ render

  private render(cheap = false): void {
    if (this.drag || !this.on) return;
    const run = this.run!;
    const sig = JSON.stringify([run.loadout, run.facings, run.crew.map((m) => [m.uid, m.home, m.trinkets, m.level]), run.items.length, this.tab, this.layer, this.selLee, this.selSlot, this.pick, this.selMember, this.selTrinket, this.tileEls.length, this.ctl.runId, this.ctl.sandbox?.enemies]);
    if (cheap && sig === this.lastSig) return;
    this.lastSig = sig;
    this.preview = this.computePreview();
    this.renderTop();
    this.renderTiles();
    this.renderBelow();
    this.renderBar();
    this.renderCard();
  }

  /** The tab bar, the stat card (with a before → after preview), warnings, the next fight. */
  private renderTop(): void {
    const ctl = this.ctl;
    const run = this.run!;
    const tabs = el('div', 'tabs');
    const names: [Tab, string][] = [['deck', 'Deck'], ['parts', 'Parts'], ['crew', 'Crew']];
    if (ctl.mode === 'sandbox') names.push(['sandbox', 'Sandbox']);
    for (const [k, label] of names) {
      const b = button(label, `tab${this.tab === k ? ' on' : ''}`, () => this.setTab(k));
      tabs.append(b);
    }
    const now = boatCard(ctl.world.player, ctl.tuning);
    const next = this.preview;
    const stats = el('div', 'stat-card');
    for (const [name, get, fmt] of CARD_ROWS) {
      const a = get(now);
      const row = el('div', 'sc-row');
      row.append(el('span', 'sc-k', name));
      if (next && Math.abs(get(next) - a) > 1e-6) {
        const b = get(next);
        const better = name === 'Crew' ? 0 : b > a ? 1 : -1;
        row.classList.add(better > 0 ? 'up' : better < 0 ? 'down' : 'same');
        row.append(el('span', 'sc-v', `${fmt(a, now)} → ${fmt(b, next)}`));
      } else row.append(el('span', 'sc-v', fmt(a, now)));
      stats.append(row);
    }
    const warn = el('div', 'warnings');
    for (const w of this.warnings()) warn.append(el('div', 'warning', w));
    const nextFight = el('div', 'next-fight', ctl.mode === 'sandbox' ? `Sandbox · ${this.sandboxSummary()}` : `Fight ${run.fight} · ${encounterSummary(run, ctl.tuning)}`);
    this.top.replaceChildren(tabs, nextFight, stats, warn);
  }

  /** Non-blocking warnings. */
  private warnings(): string[] {
    const ctl = this.ctl;
    const run = this.run!;
    const t = ctl.tuning;
    const boat = ctl.world.player;
    const out: string[] = [];
    const hullGuns = boat.guns.filter((g) => g.targets === 'hull');
    if (boat.guns.length && !boat.guns.some((g) => boat.crew.lees.some((l) => l.home === g.station))) out.push('No gunner on any gun: your guns won’t fire until someone mans one.');
    else if (!hullGuns.length && !boat.guns.length) out.push('No guns at all.');
    for (const uid of this.displaced) {
      const m = run.crew.find((x) => x.uid === uid);
      if (m) out.push(`${m.label}'s station was removed: now damage control.`);
    }
    if (ctl.mode === 'run' && run.crew.length < crewMin(run, t)) out.push(`Short-handed: ${run.crew.length} of the ${SHIPS[run.ship].name}'s usual ${crewMin(run, t)}.`);
    const ashore = run.crew.filter((m) => m.home === null).length;
    if (ashore) out.push(`${ashore} Lee${ashore === 1 ? '' : 's'} ashore (not placed).`);
    const spareGun = cargo(run).find((c) => ITEMS[c.item]?.category === 'gun');
    if (spareGun) {
      const empty = runSlots(run, t).find((s) => run.loadout[s.id] === undefined && canEquip(run, spareGun.uid, s.id));
      if (empty) out.push(`An empty slot could take the ${ITEMS[spareGun.item].name} in your cargo.`);
    }
    return out;
  }

  private sandboxSummary(): string {
    const e = this.ctl.sandbox?.enemies ?? [];
    if (!e.length) return 'no enemies';
    return e.map((s) => `${SHIPS[s.ship]?.name ?? s.ship} (${crewCount(s)} Lees)`).join(' + ');
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.selLee = null;
    this.selSlot = null;
    this.pick = null;
    this.selTrinket = null;
    if (tab !== 'crew') this.selMember = null;
    this.ctl.arcPreview = null;
    this.lastSig = '';
    this.render();
  }

  // ------------------------------------------------------------ tiles

  private renderTiles(): void {
    const run = this.run!;
    this.tileEls.forEach((d, i) => {
      for (const c of [...d.querySelectorAll('.token, .slot-mark, .tile-label, .tile-icon')]) c.remove();
      d.className = 'tile';
      const tile = this.tiles[i];
      if (this.tab === 'deck') {
        if (tile.station) {
          d.classList.add('station');
          const icon = el('img', 'tile-icon');
          icon.src = iconUrl((tile.station === 'gun' ? gunIcon(tile.fixture?.item) : STATION_ICON[tile.station]) as never);
          icon.draggable = false;
          d.append(icon);
        }
        const m = run.crew.find((x) => x.home === i);
        d.classList.toggle('occupied', !!m);
        if (m) d.append(this.token(m, this.selLee === m.uid));
      } else if (this.tab === 'parts') {
        this.renderSlotMarks(d, tile);
      }
    });
    if (this.tab === 'deck') this.updateLabels();
  }

  /** Slot markers on a tile for the current layer, highlighted when the picked item fits. */
  private renderSlotMarks(d: HTMLDivElement, tile: Tile): void {
    const run = this.run!;
    const ids = this.slotsOnTile(tile);
    const pickDef = this.pickDef();
    if (!ids.length) {
      d.classList.add('no-slot');
      return;
    }
    let fitsAny = false;
    for (const id of ids) {
      const slot = slotById(SHIPS[run.ship], id);
      if (!slot) continue;
      const mark = el('div', `slot-mark ${slot.type}${slot.type === 'rail' ? ` edge-${slot.facing}` : ''}${this.selSlot === id ? ' selected' : ''}`);
      const uid = run.loadout[id];
      const def = itemOf(run, uid);
      if (def) mark.append(itemIcon(def, 'slot-item'));
      else mark.append(el('span', 'slot-glyph', SLOT_TYPES[slot.type].glyph));
      if (slot.type === 'edge' && slot.facing) mark.append(el('span', 'slot-arrow', FACING_ARROW[slot.facing]));
      if (slot.type === 'interior' && def?.category === 'gun') {
        const f = run.facings[id] ?? slot.facing ?? 'bow';
        mark.append(el('span', 'slot-arrow', FACING_ARROW[f]));
      }
      // Attachment on the gun here.
      if (slot.type === 'edge' || slot.type === 'interior') {
        const att = itemOf(run, run.loadout[`att:${id}`]);
        if (att) mark.append(itemIcon(att, 'slot-att'));
      }
      if (pickDef && this.pickFits(pickDef, id)) fitsAny = true;
      d.append(mark);
    }
    d.classList.add(ids.some((id) => run.loadout[id] !== undefined) ? 'filled' : 'empty-slot');
    if (pickDef) d.classList.add(fitsAny ? 'fits' : 'dim');
    const m = run.crew.find((x) => x.home === tile.index);
    if (m && this.layer === 'fixture') d.classList.add('has-lee');
  }

  /** Slot ids on a tile in the current layer. */
  private slotsOnTile(tile: Tile): string[] {
    const ship = SHIPS[this.run!.ship];
    if (this.layer === 'floor') return [`floor:${tile.col},${tile.row}`];
    const want = this.layer === 'fixture' ? ['edge', 'interior'] : this.layer === 'rail' ? ['rail'] : [];
    return ship.slots.filter((s) => s.tile && s.tile[0] === tile.col && s.tile[1] === tile.row && want.includes(s.type)).map((s) => s.id);
  }

  private pickDef(): ItemDef | undefined {
    const p = this.pick;
    if (!p) return undefined;
    return 'uid' in p ? itemOf(this.run!, p.uid) : ITEMS[p.id];
  }

  /** Does the picked item fit this slot (attachments: the gun slot's attachment)? */
  private pickFits(def: ItemDef, slotId: string): boolean {
    const run = this.run!;
    if (def.category === 'attachment') {
      const gun = itemOf(run, run.loadout[slotId]);
      return gun?.category === 'gun';
    }
    const type = slotType(run, slotId);
    return !!type && def.fits.includes(type);
  }

  // ------------------------------------------------------------ deck tab

  private token(m: CrewMember, selected: boolean): HTMLDivElement {
    const t = el('div', `token${selected ? ' selected' : ''}`);
    t.append(memberFigure(m.type, ''), el('span', 'badge', m.label.replace(/.*#/, '')));
    if (m.level > 1) t.append(el('span', 'lv', `${m.level}`));
    if (this.displaced.has(m.uid)) t.classList.add('flag');
    t.title = m.label;
    t.onpointerdown = (e) => this.pressToken(m.uid, e, t);
    t.onclick = (e) => {
      e.stopPropagation();
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.tapLee(m.uid);
    };
    return t;
  }

  /** Card for a crew arrangement (cheap: re-boards the crew on the existing boat). */
  private crewCard(homes: Map<number, number | null>): BoatCard {
    const run = this.run!;
    const w = this.ctl.world;
    const specs = crewSpecs(run, this.ctl.tuning).map((s) => ({ ...s, home: homes.has(s.uid!) ? homes.get(s.uid!)! : s.home }));
    w.placePlayerCrew(specs);
    const card = boatCard(w.player, this.ctl.tuning);
    w.placePlayerCrew(crewSpecs(run, this.ctl.tuning));
    return card;
  }

  /** Homes after moving `uid` to `tile` (null = ashore), swapping like Controller.placeLee. */
  private moved(uid: number, tile: number | null): Map<number, number | null> {
    const run = this.run!;
    const out = new Map<number, number | null>();
    const m = run.crew.find((x) => x.uid === uid)!;
    if (tile !== null) {
      const other = run.crew.find((x) => x !== m && x.home === tile);
      if (other) out.set(other.uid, m.home);
    }
    out.set(uid, tile);
    return out;
  }

  private updateLabels(): void {
    const run = this.run!;
    const sel = this.selLee;
    if (sel === null) return;
    const boat = this.ctl.world.player;
    const now = this.crewCard(new Map());
    const me = run.crew.find((m) => m.uid === sel);
    this.tileEls.forEach((d, i) => {
      d.classList.add('targets');
      d.classList.toggle('mine', me?.home === i);
      if (me?.home === i) return;
      const other = run.crew.find((m) => m.home === i);
      const station = this.tiles[i].station;
      const role = station ? roleName(boat, i) : 'Repairs';
      const fx = effects(now, this.crewCard(this.moved(sel, i))).slice(0, 2);
      const label = el('div', `tile-label${fx.length ? '' : ' quiet'}`);
      label.append(el('b', '', other ? `⇄ ${role}` : role));
      for (const f of fx) label.append(el('span', `fx ${f.good ? 'good' : 'bad'}`, f.text));
      d.append(label);
    });
  }

  private tapLee(uid: number): void {
    const run = this.run!;
    const sel = this.selLee;
    if (sel === null || sel === uid) {
      this.selLee = sel === uid ? null : uid;
      this.lastSig = '';
      this.render();
      return;
    }
    const target = run.crew.find((m) => m.uid === uid)?.home ?? null;
    if (target === null) {
      this.selLee = uid;
      this.lastSig = '';
      this.render();
      return;
    }
    this.selLee = null;
    this.ctl.placeLee(sel, target);
  }

  private tapTile(tile: number): void {
    if (this.tab === 'parts') {
      this.tapSlotTile(tile);
      return;
    }
    if (this.tab !== 'deck') return;
    const run = this.run!;
    const sel = this.selLee;
    if (sel === null) {
      const occupant = run.crew.find((m) => m.home === tile);
      if (occupant) this.tapLee(occupant.uid);
      return;
    }
    this.selLee = null;
    this.displaced.delete(sel);
    if (run.crew.find((m) => m.uid === sel)?.home === tile) {
      this.lastSig = '';
      this.render();
      return;
    }
    this.ctl.placeLee(sel, tile);
  }

  private pressToken(uid: number, e: PointerEvent, from: HTMLElement): void {
    if (this.drag || this.tab !== 'deck') return;
    e.stopPropagation();
    from.setPointerCapture(e.pointerId);
    this.drag = { uid, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, from, over: null };
    from.onpointermove = (m) => this.moveDrag(m);
    from.onpointerup = (u) => this.endDrag(u, false);
    from.onpointercancel = (u) => this.endDrag(u, true);
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.ghost && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
      d.ghost = el('div', 'token drag-ghost');
      const m = this.run!.crew.find((x) => x.uid === d.uid)!;
      d.ghost.append(memberFigure(m.type, ''), el('span', 'badge', m.label.replace(/.*#/, '')));
      document.body.append(d.ghost);
      d.from.classList.add('dragging');
      this.card.classList.add('hidden');
    }
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
      const over = this.tileAtPoint(e.clientX, e.clientY);
      this.tileEls.forEach((t, i) => t.classList.toggle('drop', i === over));
      d.over = over;
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
    this.selLee = null;
    this.lastSig = '';
    if (cancelled) {
      this.render();
      return;
    }
    const tile = this.tileAtPoint(e.clientX, e.clientY);
    this.displaced.delete(d.uid);
    if (tile !== null) this.ctl.placeLee(d.uid, tile);
    else this.ctl.placeLee(d.uid, null); // dropped off the deck: ashore
  }

  private tileAtPoint(x: number, y: number): number | null {
    for (let i = 0; i < this.tileEls.length; i++) {
      const r = this.tileEls[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return null;
  }

  // ------------------------------------------------------------ parts tab

  private tapSlotTile(tile: number): void {
    const ids = this.slotsOnTile(this.tiles[tile]);
    if (!ids.length) return;
    // Several rail slots on a corner tile: cycle through them.
    const i = this.selSlot ? ids.indexOf(this.selSlot) : -1;
    this.tapSlot(ids[(i + 1) % ids.length]);
  }

  /** Tap a slot: with an item picked, equip it there (if it fits); otherwise select the slot. */
  private tapSlot(slotId: string): void {
    const def = this.pickDef();
    if (def && this.pickFits(def, slotId)) {
      const target = def.category === 'attachment' ? `att:${slotId}` : slotId;
      this.doEquip(target);
      return;
    }
    this.pick = null;
    this.selSlot = this.selSlot === slotId ? null : slotId;
    const run = this.run!;
    this.ctl.arcPreview = this.selSlot && itemOf(run, run.loadout[this.selSlot])?.category === 'gun' ? this.selSlot : null;
    this.lastSig = '';
    this.render();
  }

  private tapCargo(p: Pick): void {
    const same = this.pick && JSON.stringify(this.pick) === JSON.stringify(p);
    this.pick = same ? null : p;
    const def = this.pickDef();
    if (def) {
      // Show the layer the item goes in.
      if (def.category === 'trinket') {
        this.toast('Trinkets are worn by Lees: equip it from the Crew tab.');
      } else {
        const layer = layerOf(def.category === 'attachment' ? 'edge' : def.fits[0]);
        if (layer) this.layer = layer;
      }
      // Keep a selected slot only if the item fits it.
      if (this.selSlot && !this.pickFits(def, this.selSlot) && !(def.category === 'attachment' && this.selSlot.startsWith('att:'))) this.selSlot = null;
    }
    this.lastSig = '';
    this.render();
  }

  /** Where the picked item would go: the selected slot if it fits, else the first empty slot it fits. */
  private pickTarget(): string | null {
    const def = this.pickDef();
    const run = this.run!;
    if (!def) return null;
    if (this.selSlot) {
      if (def.category === 'attachment' && this.selSlot.startsWith('att:')) return this.selSlot;
      if (this.pickFits(def, this.selSlot)) return def.category === 'attachment' ? `att:${this.selSlot}` : this.selSlot;
    }
    for (const s of runSlots(run, this.ctl.tuning)) {
      if (def.category === 'attachment') {
        if (s.type !== 'attachment') continue;
      } else if (!def.fits.includes(s.type)) continue;
      if (run.loadout[s.id] === undefined) return s.id;
    }
    return null;
  }

  private doEquip(slot: string): void {
    const p = this.pick;
    if (!p) return;
    const before = this.stationHomes();
    const ok = this.ctl.equip('uid' in p ? p.uid : p.id, slot);
    if (!ok) {
      this.toast('That doesn’t fit there.');
      return;
    }
    this.flagDisplaced(before);
    this.pick = null;
    this.selSlot = slot.startsWith('att:') ? slot.slice(4) : slot;
    const run = this.run!;
    this.ctl.arcPreview = itemOf(run, run.loadout[this.selSlot])?.category === 'gun' ? this.selSlot : null;
    this.lastSig = '';
    this.render();
  }

  private doUnequip(uid: number): void {
    const before = this.stationHomes();
    this.ctl.unequip(uid);
    this.flagDisplaced(before);
    this.lastSig = '';
    this.render();
  }

  /** Lees whose home tile has a station, by uid. */
  private stationHomes(): Set<number> {
    const out = new Set<number>();
    for (const m of this.run!.crew) if (m.home !== null && this.tiles[m.home]?.station) out.add(m.uid);
    return out;
  }

  /** After an equipment change: any Lee whose station disappeared is now damage control; say so. */
  private flagDisplaced(before: Set<number>): void {
    const run = this.run!;
    const tiles = this.ctl.world.player.grid.tiles;
    for (const uid of before) {
      const m = run.crew.find((x) => x.uid === uid);
      if (!m || m.home === null || tiles[m.home]?.station) continue;
      this.displaced.add(uid);
      this.toast(`${m.label}'s station was removed: now damage control.`);
    }
  }

  private computePreview(): BoatCard | null {
    if (this.tab !== 'parts' || !this.pick) return null;
    const target = this.pickTarget();
    if (!target) return null;
    const run = structuredClone(this.run!);
    const p = this.pick;
    let uid: number;
    if ('uid' in p) uid = p.uid;
    else {
      uid = run.nextUid++;
      run.items.push({ uid, item: p.id });
    }
    if (!equipRun(run, uid, target)) return null;
    const w = new World(this.ctl.tuning, 1, { player: setupFor(run, this.ctl.tuning), enemies: [], assists: this.ctl.mode === 'sandbox' });
    return boatCard(w.player, this.ctl.tuning);
  }

  // ------------------------------------------------------------ lower panel

  private renderBelow(): void {
    const box = this.below;
    box.replaceChildren();
    box.className = `setup-below tab-${this.tab}`;
    if (this.tab === 'deck') this.renderDeckBelow(box);
    else if (this.tab === 'parts') this.renderPartsBelow(box);
    else if (this.tab === 'crew') this.renderCrewBelow(box);
    else this.renderSandboxBelow(box);
  }

  private renderDeckBelow(box: HTMLDivElement): void {
    const run = this.run!;
    const tray = el('div', 'setup-tray');
    const ashore = run.crew.filter((m) => m.home === null);
    if (!ashore.length) tray.append(el('span', 'tray-empty', run.crew.length ? 'All hands aboard' : 'No crew'));
    for (const m of ashore) tray.append(this.token(m, this.selLee === m.uid));
    tray.onclick = (e) => {
      if (e.target !== tray || this.selLee === null) return;
      const uid = this.selLee;
      this.selLee = null;
      this.ctl.placeLee(uid, null);
    };
    const sel = this.selLee !== null ? run.crew.find((m) => m.uid === this.selLee) : null;
    const hint = el(
      'div',
      'setup-hint',
      !sel ? 'Tap a Lee, then a tile (or drag it). Its tile sets its job.' : sel.home === null ? `Place ${sel.label}: tap a tile` : `Move ${sel.label}: tap a tile, another Lee to swap, or the tray to send ashore`,
    );
    box.append(tray, hint);
  }

  private renderPartsBelow(box: HTMLDivElement): void {
    const run = this.run!;
    const ctl = this.ctl;
    const layers = el('div', 'chips layers');
    for (const l of Object.keys(LAYER_NAMES) as Layer[]) {
      layers.append(
        button(LAYER_NAMES[l], `chip${this.layer === l ? ' on' : ''}`, () => {
          this.layer = l;
          this.selSlot = null;
          this.ctl.arcPreview = null;
          this.lastSig = '';
          this.render();
        }),
      );
    }
    box.append(layers);
    const def = this.pickDef();
    if (this.layer === 'hull') {
      const chips = el('div', 'chips slots');
      for (const s of runSlots(run, ctl.tuning).filter((x) => x.type === 'hull' || x.type === 'treasure')) {
        const it = itemOf(run, run.loadout[s.id]);
        const slot = slotById(SHIPS[run.ship], s.id);
        const name = s.type === 'treasure' ? `Treasure ${Number(s.id.split(':')[1]) + 1}` : `${SHIPS[run.ship].layout.parts.find((p) => p.id === slot?.part)?.label ?? slot?.part} hull`;
        const c = button('', `chip slot-chip${this.selSlot === s.id ? ' on' : ''}${def ? (this.pickFits(def, s.id) ? ' fits' : ' dim') : ''}`, () => this.tapSlot(s.id));
        c.append(it ? itemIcon(it) : el('span', 'slot-glyph', SLOT_TYPES[s.type].glyph), el('span', '', it ? `${name}: ${it.name}` : `${name}: empty`));
        chips.append(c);
      }
      box.append(chips);
    }
    // Cargo (sandbox: the whole catalog).
    const head = el('div', 'cargo-head', ctl.mode === 'sandbox' ? 'Catalog (sandbox: unlimited)' : `Cargo (${cargo(run).length}${ctl.tuning.run.cargoLimit > 0 ? ` / ${ctl.tuning.run.cargoLimit}` : ''})`);
    const list = el('div', 'cargo');
    const entries: { pick: Pick; def: ItemDef }[] =
      ctl.mode === 'sandbox'
        ? Object.values(ITEMS).map((d) => ({ pick: { id: d.id } as Pick, def: d }))
        : cargo(run).map((c) => ({ pick: { uid: c.uid } as Pick, def: ITEMS[c.item] }));
    if (!entries.length) list.append(el('span', 'tray-empty', 'Cargo is empty: rewards after a fight land here.'));
    let lastCat = '';
    for (const { pick, def: d } of entries) {
      if (!d) continue;
      if (ctl.mode === 'sandbox' && d.category !== lastCat) {
        lastCat = d.category;
        list.append(el('div', 'cargo-cat', CATEGORY_NAMES[d.category]));
      }
      const on = !!this.pick && JSON.stringify(this.pick) === JSON.stringify(pick);
      const fitsSel = this.selSlot && !this.pick ? this.pickFitsDef(d, this.selSlot) : false;
      const c = button('', `chip cargo-item${on ? ' on' : ''}${fitsSel ? ' fits' : ''}`, () => this.tapCargo(pick));
      c.append(itemIcon(d), el('span', '', d.name));
      list.append(c);
    }
    box.append(head, list);
    const hint = def
      ? `${def.name}: tap a highlighted slot${def.category === 'trinket' ? ' (trinkets: Crew tab)' : ''}.`
      : this.selSlot
        ? 'Pick an item from the cargo to put it here, or tap another slot.'
        : 'Pick an item to see where it fits, or tap a slot.';
    box.append(el('div', 'setup-hint', hint));
  }

  private pickFitsDef(def: ItemDef, slotId: string): boolean {
    const run = this.run!;
    if (slotId.startsWith('att:')) return def.category === 'attachment';
    const type = slotType(run, slotId);
    return !!type && def.fits.includes(type);
  }

  private renderCrewBelow(box: HTMLDivElement): void {
    const run = this.run!;
    const ctl = this.ctl;
    const t = ctl.tuning;
    const head = el('div', 'cargo-head', `Crew ${run.crew.length} / ${crewMax(run, t)}${ctl.mode === 'run' ? ` · minimum ${crewMin(run, t)}` : ''}`);
    const list = el('div', 'crew-list');
    const boat = ctl.world.player;
    for (const m of run.crew) {
      const row = el('div', `crew-item${this.selMember === m.uid ? ' on' : ''}${this.displaced.has(m.uid) ? ' flag' : ''}`);
      row.onclick = () => {
        this.selMember = this.selMember === m.uid ? null : m.uid;
        this.selTrinket = null;
        this.lastSig = '';
        this.render();
      };
      const names = el('div', 'ci-names');
      names.append(el('b', '', m.label), el('small', '', m.home === null ? 'ashore' : `${roleName(boat, m.home)} · ${boat.grid.tiles[m.home]?.label ?? ''}`));
      const trinkets = el('div', 'ci-trinkets');
      m.trinkets.forEach((u, i) => {
        const d = itemOf(run, u);
        const c = button('', `trinket-slot${this.selMember === m.uid && this.selTrinket === i ? ' on' : ''}`, () => {
          this.selMember = m.uid;
          this.selTrinket = this.selTrinket === i && this.selMember === m.uid ? null : i;
          this.lastSig = '';
          this.render();
        });
        c.append(d ? itemIcon(d) : el('span', 'slot-glyph', SLOT_TYPES.trinket.glyph));
        trinkets.append(c);
      });
      row.append(memberFigure(m.type, 'chip-figure'), names, levelBadge(m, t), trinkets);
      list.append(row);
    }
    box.append(head, list);
    if (ctl.mode === 'sandbox') {
      const add = el('div', 'row add-lee');
      const type = el('select');
      for (const d of Object.values(LEE_DEFS)) type.append(new Option(d.name, d.id));
      const level = el('select');
      for (let l = 1; l <= Math.round(t.leveling.levelCap); l++) level.append(new Option(`Level ${l}`, String(l)));
      add.append(type, level, button('+ Add Lee', 'hud-btn', () => ctl.addLee(type.value, Number(level.value))));
      box.append(add);
    }
    const tags = countTags([...buildTags(this.ctl.world.player.build), ...run.crew.map((m) => LEE_DEFS[m.type]?.tags ?? [])]);
    if (Object.keys(tags).length) box.append(el('div', 'setup-hint', `Tags aboard: ${Object.entries(tags).map(([k, v]) => `${tagName(k)} ${v}`).join(' · ')}`));
  }

  private renderSandboxBelow(box: HTMLDivElement): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const sb = ctl.sandbox!;
    const shipRow = el('div', 'row');
    const ship = el('select');
    for (const id of SHIP_ORDER) ship.append(new Option(SHIPS[id].name, id));
    ship.value = sb.run.ship;
    ship.onchange = () => ctl.setShip(ship.value);
    shipRow.append(el('b', '', 'Your ship'), ship);
    box.append(shipRow);

    box.append(el('div', 'cargo-head', 'Encounter builder'));
    const preset = el('select');
    preset.append(new Option('Load an encounter…', ''));
    ENCOUNTERS.forEach((e, i) => preset.append(new Option(`${i + 1}. ${e.name}`, String(i))));
    for (const id of Object.keys(ARCHETYPES)) preset.append(new Option(`Archetype: ${ARCHETYPE_NAMES[id] ?? id}`, `a:${id}`));
    preset.onchange = () => {
      const v = preset.value;
      if (!v) return;
      const specs = v.startsWith('a:') ? [ARCHETYPES[v.slice(2)]] : ENCOUNTERS[Number(v)].enemies;
      ctl.setSandboxEnemies(structuredClone(specs));
    };
    box.append(preset);
    const list = el('div', 'enc-list');
    const update = (fn: (e: EnemySpec[]) => void) => {
      const next = structuredClone(sb.enemies);
      fn(next);
      ctl.setSandboxEnemies(next);
    };
    sb.enemies.forEach((spec, bi) => {
      const card = el('div', 'enc-boat');
      const row = el('div', 'row');
      const s = el('select');
      for (const id of SHIP_ORDER) s.append(new Option(SHIPS[id].name, id));
      s.value = spec.ship;
      s.onchange = () => update((e) => {
        e[bi].ship = s.value;
        e[bi].loadout = {};
      });
      const ai = el('select');
      for (const id of Object.keys(t.ai)) ai.append(new Option(`AI: ${id}`, id));
      ai.value = spec.ai;
      ai.onchange = () => update((e) => (e[bi].ai = ai.value));
      row.append(s, ai, button('✕', 'hud-btn', () => update((e) => e.splice(bi, 1))));
      card.append(row);
      spec.crew.forEach((c, ci) => {
        const r = el('div', 'row crew-entry');
        const type = el('select');
        for (const d of Object.values(LEE_DEFS)) type.append(new Option(d.name, d.id));
        type.value = c.type;
        type.onchange = () => update((e) => (e[bi].crew[ci].type = type.value));
        const count = el('input');
        count.type = 'number';
        count.min = '0';
        count.max = '12';
        count.value = String(c.count ?? 1);
        count.onchange = () => update((e) => (e[bi].crew[ci].count = Math.max(0, Math.round(Number(count.value) || 0))));
        const level = el('input');
        level.type = 'number';
        level.min = '1';
        level.max = String(Math.round(t.leveling.levelCap));
        level.value = String(c.level ?? 1);
        level.onchange = () => update((e) => (e[bi].crew[ci].level = Math.max(1, Math.round(Number(level.value) || 1))));
        r.append(type, el('span', '', '×'), count, el('span', '', 'Lv'), level, button('✕', 'hud-btn', () => update((e) => e[bi].crew.splice(ci, 1))));
        card.append(r);
      });
      card.append(button('+ Lee type', 'hud-btn', () => update((e) => e[bi].crew.push({ type: 'basic', count: 1, level: 1 }))));
      list.append(card);
    });
    box.append(list, button('+ Enemy boat', 'hud-btn', () => update((e) => e.push({ ship: 'sloop', ai: 'standard', crew: [{ type: 'basic', count: 4 }] }))));
    box.append(el('div', 'setup-hint', 'Enemies get their ship’s default loadout. Sandbox assists (Tune → Global) apply here, never in a run.'));
  }

  private renderBar(): void {
    const ctl = this.ctl;
    const run = this.run!;
    const bar = this.bar;
    bar.replaceChildren();
    if (this.tab === 'deck') {
      bar.append(
        button('Clear all', 'hud-btn', () => {
          this.selLee = null;
          ctl.clearCrew();
        }),
        button('Auto-arrange', 'hud-btn', () => {
          this.selLee = null;
          this.displaced.clear();
          ctl.autoArrangeCrew();
        }),
      );
    }
    const launch = button(ctl.mode === 'sandbox' ? 'LAUNCH' : `LAUNCH · fight ${run.fight}`, 'start-btn', () => {
      this.selLee = null;
      this.selSlot = null;
      this.pick = null;
      this.displaced.clear();
      if (!run.crew.some((m) => m.home !== null)) {
        this.toast('Nobody is aboard: place at least one Lee.');
        return;
      }
      ctl.launch();
    });
    bar.append(launch);
  }

  // ------------------------------------------------------------ info card

  private renderCard(): void {
    const c = this.card;
    c.replaceChildren();
    let content: HTMLElement[] | null = null;
    if (this.tab === 'deck' && this.selLee !== null) content = this.deckCard();
    else if (this.tab === 'parts' && (this.selSlot || this.pick)) content = this.partsCard();
    else if (this.tab === 'crew' && this.selMember !== null) content = this.memberCard();
    if (!content) {
      c.classList.add('hidden');
      return;
    }
    c.append(...content);
    c.classList.remove('hidden');
  }

  private deckCard(): HTMLElement[] | null {
    const run = this.run!;
    const m = run.crew.find((x) => x.uid === this.selLee);
    if (!m) return null;
    const boat = this.ctl.world.player;
    const def = LEE_DEFS[m.type];
    const head = el('div', 'card-head');
    head.append(memberFigure(m.type));
    const names = el('div', 'card-names');
    names.append(el('div', 'card-name', m.label), el('div', 'card-flavor', def.flavor));
    head.append(names, levelBadge(m, this.ctl.tuning));
    const role = el('div', 'card-role');
    if (m.home === null) role.append(el('b', '', 'Ashore'), el('span', '', ' · stays behind unless placed'));
    else role.append(el('b', '', roleName(boat, m.home)), el('span', '', ` · ${boat.grid.tiles[m.home].label}`));
    const buttons = el('div', 'card-buttons');
    if (m.home !== null) buttons.append(button('Send ashore', 'hud-btn', () => {
      this.selLee = null;
      this.ctl.placeLee(m.uid, null);
    }));
    buttons.append(button('Done', 'hud-btn', () => {
      this.selLee = null;
      this.lastSig = '';
      this.render();
    }));
    const out: HTMLElement[] = [head, role];
    if (def.trait) out.push(el('div', 'card-trait', `${def.trait.name}: ${def.trait.text}`));
    out.push(buttons);
    return out;
  }

  private partsCard(): HTMLElement[] | null {
    const run = this.run!;
    const ctl = this.ctl;
    const out: HTMLElement[] = [];
    const pickDef = this.pickDef();
    const slotId = this.selSlot;
    const slot = slotId ? (slotId.startsWith('treasure:') ? null : slotById(SHIPS[run.ship], slotId)) : null;
    const slotName = (id: string): string => {
      if (id.startsWith('treasure:')) return `Treasure slot ${Number(id.split(':')[1]) + 1}`;
      if (id.startsWith('att:')) return `Attachment on ${slotName(id.slice(4))}`;
      const s = slotById(SHIPS[run.ship], id);
      if (!s) return id;
      const where = s.part ? SHIPS[run.ship].layout.parts.find((p) => p.id === s.part)?.label ?? s.part : s.tile ? this.tiles.find((x) => x.col === s.tile![0] && x.row === s.tile![1])?.label ?? '' : '';
      return `${SLOT_TYPES[s.type].name} slot${s.facing && (s.type === 'edge' || s.type === 'rail') ? ` ${FACING_ARROW[s.facing]} ${FACING_NAME[s.facing]}` : ''}${where ? ` · ${where}` : ''}`;
    };
    if (pickDef) {
      const target = this.pickTarget();
      const extra: HTMLElement[] = [el('div', 'card-sub', target ? `Into: ${slotName(target)}` : 'No free slot it fits: tap a highlighted slot to swap.')];
      const buttons = el('div', 'card-buttons');
      if (target) buttons.append(button('Equip', 'hud-btn primary', () => this.doEquip(target)));
      buttons.append(button('Cancel', 'hud-btn', () => {
        this.pick = null;
        this.lastSig = '';
        this.render();
      }));
      extra.push(buttons);
      out.push(itemCard(pickDef, extra));
      return out;
    }
    if (!slotId) return null;
    const uid = run.loadout[slotId];
    const def = itemOf(run, uid);
    const extra: HTMLElement[] = [el('div', 'card-sub', slotName(slotId))];
    const buttons = el('div', 'card-buttons');
    if (def && uid !== undefined) {
      buttons.append(button('Unequip', 'hud-btn', () => this.doUnequip(uid)));
      if (def.category === 'gun' && slot?.type === 'interior' && (ctl.tuning.items[def.id]?.arc ?? 360) < 360) {
        const f = run.facings[slotId] ?? slot.facing ?? 'bow';
        buttons.append(button(`Rotate ${FACING_ARROW[f]}`, 'hud-btn', () => ctl.setFacing(slotId, FACINGS[(FACINGS.indexOf(f) + 1) % FACINGS.length] as Facing)));
      }
      if (def.category === 'gun') {
        const att = itemOf(run, run.loadout[`att:${slotId}`]);
        const attChip = button('', 'chip slot-chip', () => {
          this.selSlot = `att:${slotId}`;
          this.lastSig = '';
          this.render();
        });
        attChip.append(att ? itemIcon(att) : el('span', 'slot-glyph', SLOT_TYPES.attachment.glyph), el('span', '', att ? `Attachment: ${att.name}` : 'Attachment: empty'));
        extra.push(attChip);
      }
      buttons.append(button('Done', 'hud-btn', () => {
        this.selSlot = null;
        this.ctl.arcPreview = null;
        this.lastSig = '';
        this.render();
      }));
      extra.push(buttons);
      out.push(itemCard(def, extra));
      return out;
    }
    const empty = el('div', 'card item-card');
    const type = slotId.startsWith('treasure:') ? 'treasure' : slotId.startsWith('att:') ? 'attachment' : slot?.type ?? 'edge';
    empty.append(el('div', 'card-title', `Empty ${SLOT_TYPES[type].name.toLowerCase()} slot`), el('div', 'card-sub', slotName(slotId)), el('div', 'card-text', SLOT_TYPES[type].help));
    const fits = (ctl.mode === 'sandbox' ? Object.values(ITEMS) : cargo(run).map((c) => ITEMS[c.item])).filter((d) => d && this.pickFitsDef(d, slotId));
    empty.append(el('div', 'card-sub', fits.length ? `Fits here from ${ctl.mode === 'sandbox' ? 'the catalog' : 'your cargo'}: ${[...new Set(fits.map((d) => d.name))].join(', ')}` : 'Nothing in your cargo fits here.'));
    buttons.append(button('Done', 'hud-btn', () => {
      this.selSlot = null;
      this.lastSig = '';
      this.render();
    }));
    empty.append(buttons);
    out.push(empty);
    return out;
  }

  private memberCard(): HTMLElement[] | null {
    const run = this.run!;
    const ctl = this.ctl;
    const t = ctl.tuning;
    const m = run.crew.find((x) => x.uid === this.selMember);
    if (!m) return null;
    const def = LEE_DEFS[m.type];
    const lee = ctl.world.player.crew.lees.find((l) => l.uid === m.uid);
    const head = el('div', 'card-head');
    head.append(memberFigure(m.type));
    const names = el('div', 'card-names');
    names.append(el('div', 'card-name', m.label), el('div', 'card-sub', `${def.role} · ${m.fights} fights · ${m.kills} kills`), el('div', 'card-flavor', def.flavor));
    head.append(names, levelBadge(m, t));
    const out: HTMLElement[] = [head];
    if (def.trait) out.push(el('div', 'card-trait', `${def.trait.name}: ${def.trait.text}`));
    if (m.bonuses.length) out.push(el('div', 'card-sub', `Level bonuses: ${m.bonuses.map((b) => bonusLabel(b, t, STAT_LABELS)).join(', ')}`));
    out.push(fullStats(def, t, lee?.mods ?? {}));
    if (def.tags.length) out.push(tagChips(def.tags));
    // Trinkets: pick a slot, then a trinket from cargo.
    const ti = this.selTrinket;
    if (ti !== null) {
      const worn = itemOf(run, m.trinkets[ti]);
      const box = el('div', 'trinket-pick');
      box.append(el('div', 'card-sub', `Trinket slot ${ti + 1}${worn ? `: ${worn.name}` : ': empty'}`));
      if (worn) box.append(button(`Take off ${worn.name}`, 'hud-btn', () => {
        this.ctl.unequip(m.trinkets[ti]!);
      }));
      const options = ctl.mode === 'sandbox' ? Object.values(ITEMS).filter((d) => d.category === 'trinket').map((d) => ({ pick: d.id as number | string, def: d })) : cargo(run).filter((c) => ITEMS[c.item]?.category === 'trinket').map((c) => ({ pick: c.uid as number | string, def: ITEMS[c.item] }));
      if (!options.length) box.append(el('div', 'card-sub', 'No trinkets in cargo.'));
      const chips = el('div', 'chips');
      for (const o of options) {
        const c = button('', 'chip', () => this.ctl.wear(o.pick, m.uid, ti));
        c.append(itemIcon(o.def), el('span', '', `${o.def.name}: ${o.def.description}`));
        chips.append(c);
      }
      box.append(chips);
      out.push(box);
    } else out.push(el('div', 'card-sub', 'Tap a trinket slot on the crew list to equip one.'));
    const buttons = el('div', 'card-buttons');
    buttons.append(
      button('Release', 'hud-btn danger', () => {
        if (!confirmAction(`Release ${m.label}? They leave the crew for good; their trinkets go to cargo.`)) return;
        this.selMember = null;
        this.ctl.releaseLee(m.uid);
      }),
      button('Done', 'hud-btn', () => {
        this.selMember = null;
        this.selTrinket = null;
        this.lastSig = '';
        this.render();
      }),
    );
    out.push(buttons);
    return out;
  }
}

interface Effect {
  text: string;
  good: boolean;
}

/** What changes between two crew arrangements, biggest first. */
function effects(a: BoatCard, b: BoatCard): Effect[] {
  const out: (Effect & { size: number })[] = [];
  const add = (d: number, text: string, size: number) => {
    if (Math.abs(d) < 1e-6) return;
    out.push({ text: `${d > 0 ? '+' : '−'}${text}`, good: d > 0, size });
  };
  const dg = b.gunsManned - a.gunsManned;
  add(dg, `${Math.abs(dg)} gun${Math.abs(dg) === 1 ? '' : 's'}`, Math.abs(dg) * 0.5);
  const ds = Math.round(((b.speed - a.speed) / Math.max(1e-6, a.speed)) * 100);
  add(ds, `${Math.abs(ds)}% speed`, Math.abs(ds) / 100);
  const dt = Math.round(((b.turn - a.turn) / Math.max(1e-6, a.turn)) * 100);
  add(dt, `${Math.abs(dt)}% turning`, Math.abs(dt) / 100);
  const dr = b.repair - a.repair;
  add(dr, `${Math.abs(dr).toFixed(1)} repair/s`, Math.abs(dr) / 5);
  const dh = Math.round(b.hullDpm - a.hullDpm);
  if (!dg) add(dh, `${Math.abs(dh)} dmg/min`, Math.abs(dh) / Math.max(1, a.hullDpm));
  return out.sort((x, y) => y.size - x.size);
}
