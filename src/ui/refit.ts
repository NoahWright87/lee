// The refit screen: one stacked view of your boat between fights.
//
//  - The deck (over the close-up strip): every inner tile is a stack, top to
//    bottom: Lee → station (a gun or station, with its gun attachment) →
//    floor. Around it, the outer tiles just outside the hull: rail item →
//    hull module. Treasures sit in their own small row.
//  - One gesture: tap a tile and its top thing rises and every valid spot
//    lights up green; tap the same tile again for the next layer down (and
//    again to let go). Tap a green spot: a ✅ appears there, the stat bars
//    preview the change (green added, red removed), the moved gun's arc shows
//    red (now) and green (after), and anything displaced is labeled. Tap the
//    ✅ (the same spot again) to commit. Moving a lower layer carries what's
//    above it: a manned cannon brings its Lee.
//  - Cargo (one hold for parts, Lees ashore, trinkets and treasures) with
//    tabs; tap an item to light up where it fits, the same preview and ✅.
//    Select something on the boat and tap the cargo to stow it. Auto-equip
//    fills empty spots and places Lees ashore, never moving what's placed.
//  - Five stat bars (Firepower, Toughness, Speed, Boarding, Repair), with the
//    full numbers behind "Details".
//
// The run's first reward must be equipped before Launch.

import { ARCHETYPE_NAMES, ARCHETYPES, ENCOUNTERS, crewCount, type EnemySpec } from '../config/encounters';
import { CATEGORY_NAMES, ITEMS, type ItemCategory, type ItemDef } from '../config/items';
import { JOB_INFO, LEE_DEFS, STAT_LABELS } from '../config/lees';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import { FACING_ARROW, type Facing } from '../config/slots';
import type { Controller } from '../game/Controller';
import { BAR_KEYS, BAR_NAMES, boatBars, boatCard, type BoatBars, type BoatCard } from '../sim/boatStats';
import { startingJob } from '../sim/crew';
import { bonusLabel } from '../sim/levels';
import { slotById, slotFacing } from '../sim/loadout';
import { addItem, ashore, buildFor, cargo, encounterSummary, itemOf, setupFor, type CrewMember, type RunState } from '../sim/run';
import {
  allSpots,
  applyMove,
  destinations,
  itemAt,
  leeAt,
  pickedItem,
  pickedLee,
  sameDest,
  sameSpot,
  slotOf,
  spotKey,
  stackAt,
  type Dest,
  type Displaced,
  type Layer,
  type Pick,
  type Spot,
} from '../sim/stack';
import { World } from '../sim/world';
import { fullStats, itemCard, itemIcon, levelBadge, memberFigure } from './cards';
import { button, confirmAction, el } from './dom';

type Sel = Pick | { from: 'catalog'; item: string };
type Tab = 'all' | 'lees' | 'guns' | 'stations' | 'deck' | 'hull' | 'trinkets' | 'treasures';

const TABS: [Tab, string][] = [
  ['all', 'All'],
  ['lees', 'Lees'],
  ['guns', 'Guns'],
  ['stations', 'Stations'],
  ['deck', 'Deck'],
  ['hull', 'Hull'],
  ['trinkets', 'Trinkets'],
  ['treasures', 'Treasures'],
];
const TAB_OF: Record<ItemCategory, Tab> = { gun: 'guns', attachment: 'guns', station: 'stations', floor: 'deck', rail: 'hull', hull: 'hull', trinket: 'trinkets', treasure: 'treasures' };
const LAYER_NAMES: Record<Layer, string> = { lee: 'Lee', station: 'Station', floor: 'Floor', rail: 'Rail', hull: 'Hull module', treasure: 'Treasure' };

/** Card rows behind "Details": [label, value, format]. */
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

interface Preview {
  dest: Dest;
  run: RunState;
  displaced: Displaced[];
  bars: BoatBars;
  card: BoatCard;
}

function isTrinketSel(run: RunState, s: Sel | null): boolean {
  if (!s) return false;
  if (s.from === 'catalog') return ITEMS[s.item]?.category === 'trinket';
  return pickedItem(run, s)?.category === 'trinket';
}

export class RefitPanel {
  /** Deck cells, cargo and buttons (over the strip). */
  readonly root: HTMLDivElement;
  /** Next fight, stat bars, warnings (over the ocean). */
  readonly top: HTMLDivElement;
  /** What's selected (over the bottom of the ocean). */
  readonly card: HTMLDivElement;
  private ctl: Controller;
  private toast: (text: string) => void;
  private gridEl: HTMLDivElement;
  private cells = new Map<string, { el: HTMLDivElement; spot: Spot }>();
  private treasureRow: HTMLDivElement;
  private cargoEl: HTMLDivElement;
  private bar: HTMLDivElement;
  private sandboxEl: HTMLDivElement;
  private sel: Sel | null = null;
  private preview: Preview | null = null;
  private tab: Tab = 'all';
  private details = false;
  private sandboxOpen = false;
  private builtFor: unknown = null;
  private lastSig = '';
  private now: { bars: BoatBars; card: BoatCard } | null = null;
  private nowFor = '';
  private barsEl = el('div', 'rf-bars');
  private barRows = new Map<keyof BoatBars, { fill: HTMLDivElement; delta: HTMLDivElement }>();

  constructor(ctl: Controller, toast: (text: string) => void) {
    this.ctl = ctl;
    this.toast = toast;
    this.root = el('div', 'setup rf hidden');
    this.gridEl = el('div', 'rf-grid');
    this.treasureRow = el('div', 'rf-treasures');
    this.cargoEl = el('div', 'rf-cargo');
    this.bar = el('div', 'setup-bar rf-bar');
    this.sandboxEl = el('div', 'rf-sandbox hidden');
    this.root.append(this.gridEl, this.treasureRow, this.cargoEl, this.bar, this.sandboxEl);
    this.top = el('div', 'refit-top hidden');
    this.card = el('div', 'lee-card rf-card hidden');
    // Tapping the cargo hold with something on the boat selected stows it.
    this.cargoEl.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.chip, .tab, .hud-btn')) return;
      this.stowSelected();
    };
    ctl.onChange(() => this.render());
  }

  private get run(): RunState | null {
    return this.ctl.active;
  }

  private get on(): boolean {
    return this.ctl.screen === 'refit' && this.ctl.world.phase === 'ready' && !!this.run;
  }

  // ------------------------------------------------------------ per frame

  /** Per frame: show/hide, keep the cells glued to the boat, keep the cargo below it. */
  frame(): void {
    const on = this.on;
    this.root.classList.toggle('hidden', !on);
    this.top.classList.toggle('hidden', !on);
    if (!on) {
      this.card.classList.add('hidden');
      if (this.sel || this.preview) this.clearSel();
      return;
    }
    const run = this.run!;
    if (this.builtFor !== run.ship + this.ctl.runId) this.buildCells();
    const proj = this.ctl.stripProjection;
    if (!proj) return;
    const g = SHIPS[run.ship].layout.grid;
    const tw = g.tileW;
    const th = g.tileH;
    let bottom = 0;
    for (const { el: d, spot } of this.cells.values()) {
      if (spot.kind === 'treasure') continue;
      let lx = g.origin.x + spot.col * tw;
      let ly = g.origin.y + spot.row * th;
      if (spot.kind === 'edge') {
        if (spot.facing === 'port') ly -= th;
        if (spot.facing === 'starboard') ly += th;
        if (spot.facing === 'bow') lx += tw;
        if (spot.facing === 'stern') lx -= tw;
      }
      const a = proj.toCss({ x: lx, y: ly });
      const b = proj.toCss({ x: lx + tw, y: ly + th });
      const s = d.style;
      s.left = `${Math.min(a.x, b.x)}px`;
      s.top = `${Math.min(a.y, b.y)}px`;
      s.width = `${Math.abs(b.x - a.x)}px`;
      s.height = `${Math.abs(b.y - a.y)}px`;
      bottom = Math.max(bottom, Math.max(a.y, b.y));
    }
    this.treasureRow.style.top = `${bottom + 4}px`;
    this.cargoEl.style.top = `${bottom + 4 + (this.treasureRow.childElementCount ? 40 : 0)}px`;
    this.render(true);
  }

  private buildCells(): void {
    const run = this.run!;
    this.builtFor = run.ship + this.ctl.runId;
    this.gridEl.replaceChildren();
    this.cells.clear();
    for (const spot of allSpots(run, this.ctl.tuning)) {
      if (spot.kind === 'treasure') continue;
      const d = el('div', 'rf-cell');
      d.onclick = (e) => {
        e.stopPropagation();
        this.tapSpot(spot);
      };
      this.gridEl.append(d);
      this.cells.set(spotKey(spot), { el: d, spot });
    }
    this.lastSig = '';
  }

  // ------------------------------------------------------------ selection

  private clearSel(): void {
    this.sel = null;
    this.preview = null;
    this.ctl.arcPreview = null;
    this.lastSig = '';
  }

  private select(s: Sel | null): void {
    this.sel = s;
    this.preview = null;
    this.lastSig = '';
    this.updateArcs();
    this.render();
  }

  /** Where a selection can go (a catalog item: as if it were in cargo). */
  private destsFor(run: RunState, s: Sel): Dest[] {
    if (s.from !== 'catalog') return destinations(run, s, this.ctl.tuning);
    const copy = structuredClone(run);
    const inst = addItem(copy, s.item);
    return destinations(copy, { from: 'cargo', uid: inst.uid }, this.ctl.tuning);
  }

  private tapSpot(spot: Spot): void {
    const run = this.run!;
    // ✅: tapping the previewed spot again commits.
    if (this.preview && 'spot' in this.preview.dest && sameSpot(this.preview.dest.spot, spot)) {
      this.commit();
      return;
    }
    if (this.sel) {
      const lee = leeAt(run, spot);
      const d: Dest = isTrinketSel(run, this.sel) && lee ? { member: lee.uid } : { spot };
      if (this.preview && sameDest(this.preview.dest, d)) {
        this.commit();
        return;
      }
      if (this.destsFor(run, this.sel).some((x) => sameDest(x, d))) {
        this.makePreview(d);
        return;
      }
      // The same tile again: the next layer down, then let go.
      if (this.sel.from === 'boat' && sameSpot(this.sel.spot, spot)) {
        const stack = stackAt(run, spot);
        const i = stack.indexOf(this.sel.layer);
        this.select(i >= 0 && i + 1 < stack.length ? { from: 'boat', spot, layer: stack[i + 1] } : null);
        return;
      }
    }
    const stack = stackAt(run, spot);
    this.select(stack.length ? { from: 'boat', spot, layer: stack[0] } : null);
  }

  /** Tap something in cargo: select it (or, with a trinket picked, preview it on that Lee ashore). */
  private tapChip(s: Sel): void {
    const run = this.run!;
    if (s.from === 'ashore' && this.sel && isTrinketSel(run, this.sel)) {
      const d: Dest = { member: s.member };
      if (this.preview && sameDest(this.preview.dest, d)) {
        this.commit();
        return;
      }
      if (this.destsFor(run, this.sel).some((x) => sameDest(x, d))) {
        this.makePreview(d);
        return;
      }
    }
    const same = !!this.sel && JSON.stringify(this.sel) === JSON.stringify(s);
    this.select(same ? null : s);
  }

  /** With something on the boat (or a worn trinket) selected: put it in cargo. */
  private stowSelected(): void {
    const s = this.sel;
    if (!s || (s.from !== 'boat' && s.from !== 'worn')) return;
    this.clearSel();
    this.ctl.stow(s);
  }

  /** Preview a move: the same code as the commit, on a copy of the run. */
  private makePreview(dest: Dest): void {
    const ctl = this.ctl;
    const copy = structuredClone(this.run!);
    const s = this.sel!;
    const pick: Pick = s.from === 'catalog' ? { from: 'cargo', uid: addItem(copy, s.item).uid } : s;
    const displaced = applyMove(copy, pick, dest, ctl.tuning);
    const w = new World(ctl.tuning, 1, { player: setupFor(copy, ctl.tuning), enemies: [], assists: ctl.mode === 'sandbox' });
    this.preview = { dest, run: copy, displaced, bars: boatBars(w.player, ctl.tuning), card: boatCard(w.player, ctl.tuning) };
    this.updateArcs(w);
    this.lastSig = '';
    this.render();
  }

  private commit(): void {
    const s = this.sel;
    const p = this.preview;
    if (!s || !p) return;
    this.clearSel();
    const out = this.ctl.move(s.from === 'catalog' ? { from: 'catalog', item: s.item } : s, p.dest);
    const note = out.filter((d) => d.to !== 'swap').map((d) => `${d.name} → ${d.to}`);
    if (note.length) this.toast(note.join(' · '));
  }

  /** Gun arcs on the ocean: the selected gun's (red while previewing a move), the previewed one in green. */
  private updateArcs(previewWorld?: World): void {
    const run = this.run;
    const s = this.sel;
    if (!run || !s) {
      this.ctl.arcPreview = null;
      return;
    }
    const gunSlot = (r: RunState, spot: Spot) => {
      const slot = slotOf(spot, 'station');
      return slot && itemOf(r, r.loadout[slot])?.category === 'gun' ? slot : null;
    };
    const oldSlot = s.from === 'boat' && s.spot.kind === 'tile' && s.layer !== 'lee' ? gunSlot(run, s.spot) : null;
    const p = this.preview;
    const moved = s.from === 'catalog' ? ITEMS[s.item] : pickedItem(run, s);
    const carriesGun = moved?.category === 'gun' || moved?.category === 'attachment' || (s.from === 'boat' && s.layer === 'floor' && !!oldSlot);
    const newSlot = p && previewWorld && carriesGun && 'spot' in p.dest && p.dest.spot.kind === 'tile' ? gunSlot(p.run, p.dest.spot) : null;
    this.ctl.arcPreview = { oldSlot, newSlot, boat: newSlot && previewWorld ? previewWorld.player : null };
  }

  // ------------------------------------------------------------ render

  private render(cheap = false): void {
    if (!this.on) return;
    const run = this.run!;
    const sig = JSON.stringify([run.loadout, run.facings, run.crew.map((m) => [m.uid, m.home, m.trinkets, m.level]), run.items.length, run.mustPlace, this.sel, this.preview?.dest, this.tab, this.details, this.sandboxOpen, this.ctl.runId, this.ctl.sandbox?.enemies]);
    if (cheap && sig === this.lastSig) return;
    this.lastSig = sig;
    const nowKey = JSON.stringify([run.loadout, run.facings, run.crew.map((m) => [m.uid, m.home, m.trinkets, m.level, m.job]), this.ctl.runId]);
    if (!this.now || this.nowFor !== nowKey) {
      const w = this.ctl.world;
      this.now = { bars: boatBars(w.player, this.ctl.tuning), card: boatCard(w.player, this.ctl.tuning) };
      this.nowFor = nowKey;
    }
    const dests = this.sel ? this.destsFor(run, this.sel) : [];
    this.renderCells(run, dests);
    this.renderTreasures(run, dests);
    this.renderCargo(run);
    this.renderTop(run);
    this.renderCard(run);
    this.renderBar(run);
    this.renderSandbox();
  }

  private renderCells(run: RunState, dests: Dest[]): void {
    const build = buildFor(run);
    const ship = SHIPS[run.ship];
    const trinket = isTrinketSel(run, this.sel);
    const selSpot = this.sel?.from === 'boat' ? this.sel.spot : null;
    const selLayer = this.sel?.from === 'boat' ? this.sel.layer : null;
    const pv = this.preview && 'spot' in this.preview.dest ? this.preview.dest.spot : null;
    const pvMember = this.preview && 'member' in this.preview.dest ? this.preview.dest.member : null;
    for (const { el: d, spot } of this.cells.values()) {
      d.replaceChildren(el('div', 'rf-face'));
      const mine = !!selSpot && sameSpot(selSpot, spot);
      const lee = leeAt(run, spot);
      const valid = trinket ? !!lee && dests.some((x) => 'member' in x && x.member === lee.uid) : dests.some((x) => 'spot' in x && sameSpot(x.spot, spot));
      const previewHere = (!!pv && sameSpot(pv, spot)) || (pvMember !== null && lee?.uid === pvMember);
      const kind = spot.kind === 'edge' ? `outer edge-${spot.facing}` : 'inner';
      d.className = `rf-cell ${kind}${valid ? ' valid' : ''}${mine ? ' mine' : ''}${previewHere ? ' preview' : ''}${this.sel && !valid && !mine && !previewHere ? ' dim' : ''}`;
      const raised = (layer: Layer) => (mine && selLayer === layer ? ' raised' : '');
      if (spot.kind === 'tile') {
        const floor = itemOf(run, itemAt(run, spot, 'floor'));
        if (floor) d.append(itemIcon(floor, `rf-floor${raised('floor')}`));
        const st = itemOf(run, itemAt(run, spot, 'station'));
        if (st) {
          const wrap = el('div', `rf-station${raised('station')}`);
          wrap.append(itemIcon(st, 'rf-icon'));
          const slotId = slotOf(spot, 'station')!;
          if (st.category === 'gun') {
            const slot = slotById(ship, slotId);
            if (slot) wrap.append(el('span', 'rf-arrow', FACING_ARROW[slotFacing(build, slot)]));
            const att = itemOf(run, run.loadout[`att:${slotId}`]);
            if (att) wrap.append(itemIcon(att, 'rf-att'));
          }
          d.append(wrap);
        }
        if (lee) d.append(this.token(lee, raised('lee')));
      } else if (spot.kind === 'edge') {
        const hull = itemOf(run, itemAt(run, spot, 'hull'));
        if (hull) d.append(itemIcon(hull, `rf-hull${raised('hull')}`));
        const rail = itemOf(run, itemAt(run, spot, 'rail'));
        if (rail) d.append(itemIcon(rail, `rf-rail${raised('rail')}`));
      }
      if (previewHere) {
        const ok = el('button', 'rf-ok', '✅');
        ok.onclick = (e) => {
          e.stopPropagation();
          this.commit();
        };
        d.append(ok);
        const labels = this.preview!.displaced.filter((x) => x.to !== 'swap').map((x) => `${x.name} → ${x.to}`);
        if (labels.length) d.append(el('div', 'rf-displaced', labels.join('\n')));
      }
    }
  }

  private token(m: CrewMember, raised: string): HTMLDivElement {
    const t = el('div', `rf-lee${raised}`);
    t.append(memberFigure(m.type, ''));
    if (m.level > 1) t.append(el('span', 'lv', `${m.level}`));
    if (m.trinkets.some((x) => x !== null)) t.append(el('span', 'rf-trinket-dot', '✧'));
    t.title = m.label;
    return t;
  }

  private renderTreasures(run: RunState, dests: Dest[]): void {
    const row = this.treasureRow;
    row.replaceChildren();
    const spots = allSpots(run, this.ctl.tuning).filter((s): s is Extract<Spot, { kind: 'treasure' }> => s.kind === 'treasure');
    if (!spots.length) return;
    row.append(el('span', 'rf-row-label', 'Treasures'));
    for (const spot of spots) {
      const def = itemOf(run, itemAt(run, spot, 'treasure'));
      const mine = this.sel?.from === 'boat' && sameSpot(this.sel.spot, spot);
      const valid = dests.some((x) => 'spot' in x && sameSpot(x.spot, spot));
      const pv = !!this.preview && 'spot' in this.preview.dest && sameSpot(this.preview.dest.spot, spot);
      const c = button('', `rf-treasure${valid ? ' valid' : ''}${mine ? ' mine' : ''}${pv ? ' preview' : ''}`, () => this.tapSpot(spot));
      c.append(def ? itemIcon(def) : el('span', 'slot-glyph', '✦'));
      if (pv) c.append(el('span', 'rf-ok-small', '✅'));
      row.append(c);
    }
  }

  private renderCargo(run: RunState): void {
    const box = this.cargoEl;
    box.replaceChildren();
    const ctl = this.ctl;
    const sandbox = ctl.mode === 'sandbox';
    const tabs = el('div', 'rf-tabs');
    for (const [k, label] of TABS) {
      tabs.append(
        button(label, `tab${this.tab === k ? ' on' : ''}`, () => {
          this.tab = k;
          this.lastSig = '';
          this.render();
        }),
      );
    }
    const head = el('div', 'rf-cargo-head');
    const boatSel = !!this.sel && (this.sel.from === 'boat' || this.sel.from === 'worn');
    head.append(
      el('span', 'cargo-head', boatSel ? '⬇ Tap the cargo to stow it' : sandbox ? 'Catalog (sandbox: unlimited)' : `Cargo · ${cargo(run).length} items · ${ashore(run).length} ashore`),
      button('Auto-equip', 'hud-btn', () => {
        this.clearSel();
        ctl.autoEquip();
      }),
    );
    box.classList.toggle('stow', boatSel);
    const list = el('div', 'cargo rf-list');
    const must = run.mustPlace;
    const chip = (s: Sel, icon: HTMLElement, label: string, mustGlow: boolean) => {
      const on = !!this.sel && JSON.stringify(this.sel) === JSON.stringify(s);
      const trinketDest = s.from === 'ashore' && isTrinketSel(run, this.sel);
      const pv = s.from === 'ashore' && !!this.preview && 'member' in this.preview.dest && this.preview.dest.member === s.member;
      const c = button('', `chip${on ? ' on' : ''}${mustGlow ? ' must' : ''}${trinketDest ? ' fits' : ''}`, () => this.tapChip(s));
      c.append(icon, el('span', '', label));
      if (pv) c.append(el('span', 'rf-ok-small', '✅'));
      list.append(c);
    };
    if (this.tab === 'all' || this.tab === 'lees') {
      for (const m of ashore(run)) chip({ from: 'ashore', member: m.uid }, memberFigure(m.type, 'chip-figure'), `${m.label}${m.level > 1 ? ` · Lv ${m.level}` : ''}`, must?.kind === 'lee' && must.uid === m.uid);
    }
    const show = (d: ItemDef) => this.tab === 'all' || TAB_OF[d.category] === this.tab;
    if (sandbox) {
      let last = '';
      for (const d of Object.values(ITEMS)) {
        if (!show(d)) continue;
        if (d.category !== last) {
          last = d.category;
          list.append(el('div', 'cargo-cat', CATEGORY_NAMES[d.category]));
        }
        chip({ from: 'catalog', item: d.id }, itemIcon(d), d.name, false);
      }
    } else {
      for (const inst of cargo(run)) {
        const d = ITEMS[inst.item];
        if (!d || !show(d)) continue;
        chip({ from: 'cargo', uid: inst.uid }, itemIcon(d), d.name, must?.kind === 'item' && must.uid === inst.uid);
      }
    }
    if (!list.childElementCount) list.append(el('span', 'tray-empty', this.tab === 'all' ? 'Cargo is empty: rewards after a fight land here.' : 'Nothing here.'));
    box.append(tabs, head, list);
  }

  /** Next fight, the five stat bars (with the preview), details, warnings. */
  private renderTop(run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const now = this.now!;
    const next = this.preview;
    const nextFight = el('div', 'next-fight', ctl.mode === 'sandbox' ? `Sandbox · ${this.sandboxSummary()}` : `Fight ${run.fight} · ${encounterSummary(run, t)}`);
    // The bars are the same elements from render to render, so changes animate.
    const bars = this.barsEl;
    const full: Record<keyof BoatBars, number> = { firepower: t.refit.barFirepower, toughness: t.refit.barToughness, speed: t.refit.barSpeed, boarding: t.refit.barBoarding, repair: t.refit.barRepair };
    const dur = `${Math.max(0, t.refit.barAnimTime)}s`;
    // Bars can overflow a little past "full" (to 120%).
    const w = (v: number) => `${(Math.min(1.2, Math.max(0, v)) / 1.2) * 100}%`;
    for (const k of BAR_KEYS) {
      let row = this.barRows.get(k);
      if (!row) {
        const r = el('div', 'rf-bar-row');
        const track = el('div', 'rf-track');
        const fill = el('div', 'rf-fill');
        const delta = el('div', 'rf-delta');
        track.append(fill, delta, el('div', 'rf-full'));
        r.append(el('span', 'rf-bar-k', BAR_NAMES[k]), track);
        bars.append(r);
        row = { fill, delta };
        this.barRows.set(k, row);
      }
      const a = now.bars[k] / Math.max(1e-6, full[k]);
      const b = next ? next.bars[k] / Math.max(1e-6, full[k]) : a;
      row.delta.className = `rf-delta ${b > a ? 'add' : 'remove'}`;
      row.fill.style.transitionDuration = dur;
      row.delta.style.transitionDuration = dur;
      row.fill.style.width = w(Math.min(a, b));
      row.delta.style.left = w(Math.min(a, b));
      row.delta.style.width = `calc(${w(Math.max(a, b))} - ${w(Math.min(a, b))})`;
    }
    const toggle = button(this.details ? 'Hide details' : 'Details', 'rf-details-btn', () => {
      this.details = !this.details;
      this.lastSig = '';
      this.render();
    });
    const out: HTMLElement[] = [nextFight, bars, toggle];
    if (this.details) {
      const stats = el('div', 'stat-card');
      for (const [name, get, fmt] of CARD_ROWS) {
        const a = get(now.card);
        const row = el('div', 'sc-row');
        row.append(el('span', 'sc-k', name));
        if (next && Math.abs(get(next.card) - a) > 1e-6) {
          const b = get(next.card);
          row.classList.add(name === 'Crew' ? 'same' : b > a ? 'up' : 'down');
          row.append(el('span', 'sc-v', `${fmt(a, now.card)} → ${fmt(b, next.card)}`));
        } else row.append(el('span', 'sc-v', fmt(a, now.card)));
        stats.append(row);
      }
      out.push(stats);
    }
    const warn = el('div', 'warnings');
    for (const x of this.warnings(run)) warn.append(el('div', 'warning', x));
    out.push(warn);
    this.top.replaceChildren(...out);
  }

  private warnings(run: RunState): string[] {
    const ctl = this.ctl;
    const out: string[] = [];
    if (ctl.mustPlace()) out.push(run.mustPlace?.kind === 'lee' ? 'Place your new recruit before the next fight: tap them in cargo, then a green tile.' : 'Equip your reward before the next fight: tap it in cargo, then a green spot.');
    const boat = ctl.world.player;
    if (boat.guns.length && !boat.crew.lees.some((l) => l.job === 'fire')) out.push('Nobody starts on the guns: they won’t fire until you send someone (🔫).');
    const n = ashore(run).length;
    if (n && !ctl.mustPlace()) out.push(`${n} Lee${n === 1 ? '' : 's'} ashore (in cargo).`);
    return out;
  }

  private sandboxSummary(): string {
    const e = this.ctl.sandbox?.enemies ?? [];
    if (!e.length) return 'no enemies';
    return e.map((s) => `${SHIPS[s.ship]?.name ?? s.ship} (${crewCount(s)} Lees)`).join(' + ');
  }

  // ------------------------------------------------------------ the selection card

  private renderCard(run: RunState): void {
    const c = this.card;
    c.replaceChildren();
    const s = this.sel;
    if (!s) {
      c.classList.add('hidden');
      return;
    }
    const ctl = this.ctl;
    const t = ctl.tuning;
    const out: HTMLElement[] = [];
    const buttons = el('div', 'card-buttons');
    if (this.preview) {
      // Compact while previewing: the bars and arcs are what matter now.
      out.push(el('div', 'card-sub rf-hint', 'Tap ✅ (or the same spot again) to confirm, or tap anything else.'));
      for (const d of this.preview.displaced) out.push(el('div', 'card-sub', d.to === 'swap' ? `${d.name} swaps places` : `${d.name} → ${d.to}`));
      buttons.append(button('Cancel', 'hud-btn', () => this.select(null)));
      out.push(buttons);
      c.append(...out);
      c.classList.remove('hidden');
      return;
    }
    const lee = s.from === 'catalog' ? null : pickedLee(run, s);
    const def = s.from === 'catalog' ? ITEMS[s.item] : pickedItem(run, s);
    if (lee) {
      const ldef = LEE_DEFS[lee.type];
      const head = el('div', 'card-head');
      head.append(memberFigure(lee.type));
      const names = el('div', 'card-names');
      const job = lee.home !== null ? lee.job ?? startingJob(ctl.world.player, lee.home) : null;
      names.append(el('div', 'card-name', lee.label), el('div', 'card-sub', job ? `Starts as ${JOB_INFO[job].icon} ${JOB_INFO[job].name}` : 'Ashore: stays behind'), el('div', 'card-flavor', ldef.flavor));
      head.append(names, levelBadge(lee, t));
      out.push(head);
      if (ldef.trait) out.push(el('div', 'card-trait', `${ldef.trait.name}: ${ldef.trait.text}`));
      if (lee.bonuses.length) out.push(el('div', 'card-sub', `Level bonuses: ${lee.bonuses.map((b) => bonusLabel(b, t, STAT_LABELS)).join(', ')}`));
      // Trinkets it wears: tap one to pick it up (onto another Lee, or into cargo).
      const tr = el('div', 'chips');
      lee.trinkets.forEach((u, i) => {
        const d = itemOf(run, u);
        const chip = button('', 'chip', () => {
          if (d) this.select({ from: 'worn', member: lee.uid, index: i });
        });
        chip.append(d ? itemIcon(d) : el('span', 'slot-glyph', '✧'), el('span', '', d ? d.name : 'empty trinket slot'));
        tr.append(chip);
      });
      out.push(tr);
      const w = ctl.world.player.crew.lees.find((l) => l.uid === lee.uid);
      out.push(fullStats(ldef, t, w?.mods ?? {}));
      buttons.append(
        button('Release', 'hud-btn danger', () => {
          if (!confirmAction(`Release ${lee.label}? They leave the crew for good; their trinkets go to cargo.`)) return;
          this.clearSel();
          ctl.releaseLee(lee.uid);
        }),
      );
      if (lee.home !== null) buttons.append(button('Send ashore', 'hud-btn', () => this.stowSelected()));
    } else if (def) {
      const extra: HTMLElement[] = [];
      if (s.from === 'boat') extra.push(el('div', 'card-sub', `${LAYER_NAMES[s.layer]} · tap the tile again for the layer under it`));
      out.push(itemCard(def, extra));
      if (s.from === 'boat' && s.layer === 'station' && def.category === 'gun' && s.spot.kind === 'tile') {
        const slotId = slotOf(s.spot, 'station')!;
        const slot = slotById(SHIPS[run.ship], slotId);
        const ways: Facing[] = slot?.type === 'interior' ? ['port', 'bow', 'starboard', 'stern'] : slot?.facings ?? [];
        if (slot && ways.length > 1 && (t.items[def.id]?.arc ?? 360) < 360) {
          const f = slotFacing(buildFor(run), slot);
          const nextWay = ways[(ways.indexOf(f) + 1) % ways.length];
          buttons.append(button(`Turn ${FACING_ARROW[nextWay]}`, 'hud-btn', () => ctl.setFacing(slotId, nextWay)));
        }
        const att = run.loadout[`att:${slotId}`];
        if (att !== undefined) buttons.append(button(`Take off ${itemOf(run, att)?.name ?? 'attachment'}`, 'hud-btn', () => ctl.unequip(att)));
      }
      if (s.from === 'boat' || s.from === 'worn') buttons.append(button('Stow in cargo', 'hud-btn', () => this.stowSelected()));
    }
    buttons.append(button('Done', 'hud-btn', () => this.select(null)));
    out.push(buttons);
    c.append(...out);
    c.classList.remove('hidden');
  }

  // ------------------------------------------------------------ buttons

  private renderBar(run: RunState): void {
    const ctl = this.ctl;
    const bar = this.bar;
    bar.replaceChildren();
    if (ctl.mode === 'sandbox') {
      bar.append(
        button(this.sandboxOpen ? 'Close sandbox' : 'Sandbox…', 'hud-btn', () => {
          this.sandboxOpen = !this.sandboxOpen;
          this.lastSig = '';
          this.render();
        }),
      );
    }
    const blocked = ctl.mustPlace();
    const launch = button('LAUNCH', `start-btn${blocked ? ' blocked' : ''}`, () => {
      if (blocked) {
        this.toast('Equip your reward first: tap it in cargo, then a green spot.');
        return;
      }
      if (!run.crew.some((m) => m.home !== null)) {
        this.toast('Nobody is aboard: place at least one Lee.');
        return;
      }
      this.clearSel();
      ctl.launch();
    });
    launch.append(el('small', '', blocked ? 'equip your reward' : ctl.mode === 'sandbox' ? 'sandbox' : `fight ${run.fight}`));
    bar.append(launch);
  }

  // ------------------------------------------------------------ sandbox

  private renderSandbox(): void {
    const box = this.sandboxEl;
    const open = this.sandboxOpen && this.ctl.mode === 'sandbox';
    box.classList.toggle('hidden', !open);
    if (!open) return;
    box.replaceChildren();
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
    const add = el('div', 'row add-lee');
    const type = el('select');
    for (const d of Object.values(LEE_DEFS)) type.append(new Option(d.name, d.id));
    const level = el('select');
    for (let l = 1; l <= Math.round(t.leveling.levelCap); l++) level.append(new Option(`Level ${l}`, String(l)));
    add.append(type, level, button('+ Add Lee', 'hud-btn', () => ctl.addLee(type.value, Number(level.value))));
    box.append(add);

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
      s.onchange = () =>
        update((e) => {
          e[bi].ship = s.value;
          e[bi].loadout = {};
          delete e[bi].fullLoadout;
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
        const lvl = el('input');
        lvl.type = 'number';
        lvl.min = '1';
        lvl.max = String(Math.round(t.leveling.levelCap));
        lvl.value = String(c.level ?? 1);
        lvl.onchange = () => update((e) => (e[bi].crew[ci].level = Math.max(1, Math.round(Number(lvl.value) || 1))));
        r.append(type, el('span', '', '×'), count, el('span', '', 'Lv'), lvl, button('✕', 'hud-btn', () => update((e) => e[bi].crew.splice(ci, 1))));
        card.append(r);
      });
      card.append(button('+ Lee type', 'hud-btn', () => update((e) => e[bi].crew.push({ type: 'basic', count: 1, level: 1 }))));
      list.append(card);
    });
    box.append(list, button('+ Enemy boat', 'hud-btn', () => update((e) => e.push({ ship: 'basic', ai: 'standard', crew: [{ type: 'basic', count: 4 }] }))));
    box.append(el('div', 'setup-hint', 'Enemies sail their ship’s standard fit. Sandbox assists (Tune → Global) apply here, never in a run. The cargo is the whole catalog.'));
  }
}
