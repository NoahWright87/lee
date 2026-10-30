// The refit screen: one stacked view of your boat between fights.
//
//  - The deck (over the close-up strip): every inner tile is a stack, top to
//    bottom: Lee → station (a gun or station, with its gun attachment) →
//    floor. Around it, the outer tiles just outside the hull: rail item →
//    hull module. Treasures sit in their own small row.
//  - One gesture: tap a tile and its top thing rises and every valid spot
//    lights up green; tap the same tile again for the next layer down (and
//    again to let go). Tap a green spot: a ✅ appears there, the card shows
//    what changes (+Firepower −Speed), the moved gun's arc shows red (now)
//    and green (after). Tap the ✅ to commit. Moving a lower layer carries
//    what's above it: a manned cannon brings its Lee. A selected gun that can
//    turn shows ↻ on its tile.
//  - Cargo (parts, Lees ashore, trinkets, treasures): tap an item to light up
//    where it fits. Select something on the boat and tap the cargo to stow
//    it. Tabs only appear when the cargo is too full to scan.
//  - The selection card stays small: a Lee shows four job bars (the same
//    numbers the action buttons use), an item one line of what it does and
//    what it costs. ⓘ opens a Lee's full sheet; 📊 opens the stat bars.
//
// Before a fight it ends in LAUNCH; opened from the sea map or a port, DONE.

import { ARCHETYPE_NAMES, ARCHETYPES, crewCount, type EnemySpec } from '../config/encounters';
import { ITEMS, type ItemCategory } from '../config/items';
import { JOB_INFO, LEE_DEFS, STAT_LABELS } from '../config/lees';
import { NESS, NESS_ORDER } from '../config/ness';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import { FACING_ARROW, type Facing } from '../config/slots';
import type { Controller } from '../game/Controller';
import type { Tuning } from '../config/tuning';
import { BAR_KEYS, BAR_NAMES, boatBars, boatCard, type BoatBars, type BoatCard } from '../sim/boatStats';
import { startingJob } from '../sim/crew';
import type { NessSpec } from '../sim/ness';
import { bonusLabel } from '../sim/levels';
import { slotById, slotFacing } from '../sim/loadout';
import { addItem, ashore, autoEquipAll, buildFor, cargo, cargoLimit, cargoOver, crewMax, encounterSummary, itemOf, setupFor, type CrewMember, type RunState } from '../sim/run';
import { danger } from '../sim/seaMap';
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
import { fullStats, itemIcon, jobBars, levelBadge, memberFigure } from './cards';
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
/** About how many cargo chips fit without tabs. */
const CARGO_FITS = 12;

/** Each stat bar's "full" value. */
function barFull(t: Tuning): Record<keyof BoatBars, number> {
  const r = t.refit;
  const f = (v: number) => Math.max(1e-6, v);
  return { firepower: f(r.barFirepower), toughness: f(r.barToughness), speed: f(r.barSpeed), boarding: f(r.barBoarding), repair: f(r.barRepair) };
}

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
  /** Next fight, warnings, the optional stat panel (over the ocean). */
  readonly top: HTMLDivElement;
  /** What's selected (over the bottom of the ocean). */
  readonly card: HTMLDivElement;
  /** A Lee's full sheet (over everything). */
  readonly sheet: HTMLDivElement;
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
  private statsOpen = false;
  private sheetFor: number | null = null;
  private sandboxOpen = false;
  private genBudget = 400;
  private genChassis = '';
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
    this.sheet = el('div', 'rf-sheet hidden');
    this.sheet.onclick = (e) => {
      if (e.target === this.sheet) this.openSheet(null);
    };
    // Tapping the cargo hold with something on the boat selected stows it.
    this.cargoEl.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.chip, .tab, .hud-btn')) return;
      this.stowSelected();
    };
    // Tapping the water around the deck lets go.
    this.root.onclick = (e) => {
      if (e.target === this.root || e.target === this.gridEl) this.select(null);
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
      this.sheet.classList.add('hidden');
      this.sheetFor = null;
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
    const cargoTop = bottom + 4 + (this.treasureRow.childElementCount ? 40 : 0);
    this.cargoEl.style.top = `${cargoTop}px`;
    // Down to just above LAUNCH.
    this.cargoEl.style.maxHeight = `calc(100% - ${cargoTop}px - max(10px, env(safe-area-inset-bottom)) - 64px)`;
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
      d.dataset.spot = spotKey(spot);
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
    const sig = JSON.stringify([run.loadout, run.facings, run.crew.map((m) => [m.uid, m.home, m.trinkets, m.level]), run.items.length, run.gold, this.ctl.refitFor, this.sel, this.preview?.dest, this.tab, this.statsOpen, this.sheetFor, this.sandboxOpen, this.ctl.runId, this.ctl.sandbox?.enemies, this.ctl.sandbox?.nesses]);
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
    this.renderSheet(run);
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
        // The selected gun can turn: ↻ right on its tile.
        const turn = mine && selLayer === 'station' && !this.preview ? this.nextFacing(run, spot) : null;
        if (turn) {
          const b = el('button', 'rf-rotate', '↻');
          b.title = `Turn ${FACING_ARROW[turn.way]}`;
          b.onclick = (e) => {
            e.stopPropagation();
            this.ctl.setFacing(turn.slot, turn.way);
          };
          d.append(b);
        }
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

  /** The next way a gun on this tile can face, or null if it can't turn. */
  private nextFacing(run: RunState, spot: Spot): { slot: string; way: Facing } | null {
    const def = itemOf(run, itemAt(run, spot, 'station'));
    if (!def || def.category !== 'gun' || spot.kind !== 'tile') return null;
    if ((this.ctl.tuning.items[def.id]?.arc ?? 360) >= 360) return null;
    const slotId = slotOf(spot, 'station')!;
    const slot = slotById(SHIPS[run.ship], slotId);
    const ways: Facing[] = slot?.type === 'interior' ? ['port', 'bow', 'starboard', 'stern'] : slot?.facings ?? [];
    if (!slot || ways.length < 2) return null;
    const f = slotFacing(buildFor(run), slot);
    return { slot: slotId, way: ways[(ways.indexOf(f) + 1) % ways.length] };
  }

  private renderCargo(run: RunState): void {
    const box = this.cargoEl;
    box.replaceChildren();
    const sandbox = this.ctl.mode === 'sandbox';
    const over = sandbox ? 0 : cargoOver(run, this.ctl.tuning);
    const boatSel = !!this.sel && (this.sel.from === 'boat' || this.sel.from === 'worn');
    box.classList.toggle('stow', boatSel);
    // Every chip with the tab it belongs to; tabs only show when there are too many to scan.
    const chips: { tab: Tab; make: () => HTMLElement }[] = [];
    const chip = (tab: Tab, s: Sel, icon: () => HTMLElement, label: string, mustGlow = false) =>
      chips.push({
        tab,
        make: () => {
          const on = !!this.sel && JSON.stringify(this.sel) === JSON.stringify(s);
          const trinketDest = s.from === 'ashore' && isTrinketSel(run, this.sel);
          const pv = s.from === 'ashore' && !!this.preview && 'member' in this.preview.dest && this.preview.dest.member === s.member;
          const c = button('', `chip${on ? ' on' : ''}${mustGlow ? ' must' : ''}${trinketDest ? ' fits' : ''}`, () => this.tapChip(s));
          c.append(icon(), el('span', '', label));
          if (pv) c.append(el('span', 'rf-ok-small', '✅'));
          return c;
        },
      });
    for (const m of ashore(run)) chip('lees', { from: 'ashore', member: m.uid }, () => memberFigure(m.type, 'chip-figure'), `${m.label}${m.level > 1 ? ` · Lv ${m.level}` : ''}`);
    if (sandbox) for (const d of Object.values(ITEMS)) chip(TAB_OF[d.category], { from: 'catalog', item: d.id }, () => itemIcon(d), d.name);
    else
      for (const inst of cargo(run)) {
        const d = ITEMS[inst.item];
        if (d) chip(TAB_OF[d.category], { from: 'cargo', uid: inst.uid }, () => itemIcon(d), d.name, over > 0);
      }
    const present = TABS.filter(([k]) => k === 'all' || chips.some((c) => c.tab === k));
    const showTabs = present.length > 2 && chips.length > CARGO_FITS;
    if (!showTabs || !present.some(([k]) => k === this.tab)) this.tab = 'all';
    if (showTabs) {
      const tabs = el('div', 'rf-tabs');
      for (const [k, label] of present)
        tabs.append(
          button(label, `tab${this.tab === k ? ' on' : ''}`, () => {
            this.tab = k;
            this.lastSig = '';
            this.render();
          }),
        );
      box.append(tabs);
    }
    const list = el('div', 'cargo rf-list');
    const leeSel = !!this.sel && this.sel.from === 'boat' && this.sel.layer === 'lee';
    const hold = sandbox ? 'Cargo' : `Hold ${cargo(run).length}/${cargoLimit(run, this.ctl.tuning)}`;
    list.append(el('span', `rf-row-label${over ? ' over' : ''}`, boatSel ? (leeSel ? '⬇ Ashore' : '⬇ Stow') : hold));
    for (const c of chips) if (this.tab === 'all' || c.tab === this.tab) list.append(c.make());
    if (!chips.length && !boatSel) list.append(el('span', 'tray-empty', 'empty'));
    box.append(list);
  }

  /** Next fight, warnings, and (behind 📊) the five stat bars with every number. */
  private renderTop(run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const now = this.now!;
    const next = this.preview;
    const head = el('div', 'rf-head');
    const fight = ctl.mode === 'sandbox' ? `Sandbox · ${this.sandboxSummary()}` : this.headline(run);
    head.append(
      el('div', 'next-fight', fight),
      button('📊', `rf-stats-btn${this.statsOpen ? ' on' : ''}`, () => {
        this.statsOpen = !this.statsOpen;
        this.lastSig = '';
        this.render();
      }),
    );
    const out: HTMLElement[] = [head];
    const warn = this.warnings(run);
    if (warn.length) {
      const box = el('div', 'warnings');
      for (const x of warn) box.append(el('div', 'warning', x));
      out.push(box);
    }
    if (this.statsOpen) {
      // The bars are the same elements from render to render, so changes animate.
      const bars = this.barsEl;
      const full = barFull(t);
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
        const a = now.bars[k] / full[k];
        const b = next ? next.bars[k] / full[k] : a;
        row.delta.className = `rf-delta ${b > a ? 'add' : 'remove'}`;
        row.fill.style.transitionDuration = dur;
        row.delta.style.transitionDuration = dur;
        row.fill.style.width = w(Math.min(a, b));
        row.delta.style.left = w(Math.min(a, b));
        row.delta.style.width = `calc(${w(Math.max(a, b))} - ${w(Math.min(a, b))})`;
      }
      const panel = el('div', 'rf-stats');
      panel.append(bars);
      // Every number too, while nothing is selected (the card needs the room otherwise).
      const stats = el('div', 'stat-card');
      if (!this.sel) panel.append(stats);
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
      out.push(panel);
    }
    this.top.replaceChildren(...out);
  }

  /** "+Firepower −Speed": what a previewed change does, in words, without the bars. */
  private deltaChips(): HTMLElement | null {
    const p = this.preview;
    const now = this.now;
    if (!p || !now) return null;
    const full = barFull(this.ctl.tuning);
    const row = el('div', 'rf-deltas');
    for (const k of BAR_KEYS) {
      const d = (p.bars[k] - now.bars[k]) / full[k];
      if (Math.abs(d) < 0.02) continue;
      row.append(el('span', `rf-dchip ${d > 0 ? 'up' : 'down'}`, `${d > 0 ? '+' : '−'}${BAR_NAMES[k]}`));
    }
    if (!row.childElementCount) row.append(el('span', 'rf-dchip same', 'Same stats'));
    return row;
  }

  private warnings(run: RunState): string[] {
    const ctl = this.ctl;
    const out: string[] = [];
    if (ctl.mode === 'run') {
      const over = cargoOver(run, ctl.tuning);
      if (over) out.push(`The hold is ${over} over (${cargo(run).length}/${cargoLimit(run, ctl.tuning)}): equip, sell or throw something away before you sail.`);
      if (run.crew.length > crewMax(run, ctl.tuning)) out.push(`Too many Lees for this ship (${run.crew.length}/${crewMax(run, ctl.tuning)}).`);
    }
    const boat = ctl.world.player;
    if (boat.guns.length && !boat.crew.lees.some((l) => l.job === 'fire')) out.push('Nobody starts on the guns.');
    return out;
  }

  /** "Fight 4 · Friend Ship · 💀💀" (or where you are, between stops). */
  private headline(run: RunState): string {
    const ctl = this.ctl;
    const gold = `🪙 ${run.gold}`;
    if (ctl.refitFor === 'port') return `In port · ${run.port?.name ?? ''} · ${gold}`;
    if (ctl.refitFor === 'map') return `At sea · ${gold}`;
    const enc = run.encounter;
    const stop = enc && run.map ? run.map.stops[enc.stop ?? -1] : null;
    const skulls = stop ? danger(run, stop, ctl.tuning) : null;
    const kind = enc?.type === 'hard' ? 'Hard fight' : 'Fight';
    return `${kind} ${run.fight} · ${encounterSummary(run)}${skulls ? ` · ${'💀'.repeat(skulls)}` : ''}`;
  }

  private sandboxSummary(): string {
    const e = this.ctl.sandbox?.enemies ?? [];
    const n = this.ctl.sandbox?.nesses ?? [];
    if (!e.length && !n.length) return 'no enemies';
    return [...e.map((s) => `${SHIPS[s.ship]?.name ?? s.ship} (${crewCount(s)} Lees)`), ...n.map((s) => `${NESS[s.kind]?.name ?? s.kind}${(s.level ?? 1) > 1 ? ` Lv ${s.level}` : ''}`)].join(' + ');
  }

  // ------------------------------------------------------------ the selection card

  /** Small and fixed: one Lee or item, what a previewed move changes. No buttons: tap the boat, the cargo or the water. */
  private renderCard(run: RunState): void {
    const c = this.card;
    c.replaceChildren();
    const s = this.sel;
    if (!s) {
      c.classList.add('hidden');
      return;
    }
    const ctl = this.ctl;
    const lee = s.from === 'catalog' ? null : pickedLee(run, s);
    const def = s.from === 'catalog' ? ITEMS[s.item] : pickedItem(run, s);
    // What tapping the same tile again picks up.
    let under: string | null = null;
    if (s.from === 'boat') {
      const stack = stackAt(run, s.spot);
      const i = stack.indexOf(s.layer);
      if (i >= 0 && i + 1 < stack.length) under = LAYER_NAMES[stack[i + 1]];
    }
    const head = el('div', 'rf-card-head');
    if (lee) {
      const job = lee.home !== null ? lee.job ?? startingJob(ctl.world.player, lee.home) : null;
      const names = el('div', 'rf-card-names');
      names.append(el('div', 'rf-card-name', `${lee.label}${lee.level > 1 ? ` · Lv ${lee.level}` : ''}`), el('div', 'rf-card-sub', job ? `${JOB_INFO[job].icon} ${JOB_INFO[job].name}` : 'Ashore'));
      head.append(memberFigure(lee.type, 'rf-card-figure'), names);
      if (under) head.append(el('span', 'rf-under', `tap again: ${under}`));
      head.append(button('ⓘ', 'rf-info', () => this.openSheet(lee.uid)));
      c.append(head, this.jobBars(lee));
      // Trinkets it wears: tap one to pick it up (onto another Lee, or into cargo).
      const tr = el('div', 'rf-trinkets');
      lee.trinkets.forEach((u, i) => {
        const d = itemOf(run, u);
        const chip = button('', `chip small${d ? '' : ' empty'}`, () => {
          if (d) this.select({ from: 'worn', member: lee.uid, index: i });
        });
        chip.append(d ? itemIcon(d) : el('span', 'slot-glyph', '✧'), el('span', '', d ? d.name : 'trinket'));
        tr.append(chip);
      });
      c.append(tr);
    } else if (def) {
      const names = el('div', 'rf-card-names');
      names.append(el('div', 'rf-card-name', def.name));
      if (def.id !== 'ironE') {
        names.append(el('div', 'rf-card-text', def.description));
        if (def.tradeoff) names.append(el('div', 'rf-card-cost', def.tradeoff));
      }
      head.append(itemIcon(def, 'rf-card-icon'), names);
      if (under) head.append(el('span', 'rf-under', `tap again: ${under}`));
      c.append(head);
      // A gun's attachment rides with it; take it off here.
      if (s.from === 'boat' && s.layer === 'station' && s.spot.kind === 'tile' && !this.preview) {
        const att = run.loadout[`att:${slotOf(s.spot, 'station')}`];
        const ad = itemOf(run, att);
        if (att !== undefined && ad) {
          const off = button('', 'chip small', () => ctl.unequip(att));
          off.append(itemIcon(ad), el('span', '', `${ad.name} ✕`));
          c.append(off);
        }
      }
    }
    if (this.preview) {
      const d = this.deltaChips();
      if (d) c.append(d);
      for (const x of this.preview.displaced) if (x.to !== 'swap') c.append(el('div', 'rf-card-sub', `${x.name} → ${x.to}`));
    }
    c.classList.remove('hidden');
  }

  /** The four job bars, with this Lee's levels, trinkets and treasures. */
  private jobBars(m: CrewMember): HTMLDivElement {
    const mods = this.ctl.world.player.crew.lees.find((l) => l.uid === m.uid)?.mods ?? {};
    return jobBars(m.type, this.ctl.tuning, mods);
  }

  private openSheet(uid: number | null): void {
    this.sheetFor = uid;
    this.lastSig = '';
    this.render();
  }

  /** A Lee's full sheet: type, trait, level and bonuses, every stat, Release. */
  private renderSheet(run: RunState): void {
    const box = this.sheet;
    const m = this.sheetFor === null ? null : run.crew.find((x) => x.uid === this.sheetFor) ?? null;
    box.classList.toggle('hidden', !m);
    if (!m) return;
    const ctl = this.ctl;
    const t = ctl.tuning;
    const def = LEE_DEFS[m.type] ?? LEE_DEFS.basic;
    const card = el('div', 'rf-sheet-card');
    const head = el('div', 'card-head');
    const names = el('div', 'card-names');
    names.append(el('div', 'card-name', m.label), el('div', 'card-sub', def.role));
    head.append(memberFigure(m.type), names, levelBadge(m, t), button('✕', 'rf-sheet-x', () => this.openSheet(null)));
    card.append(head, el('div', 'card-flavor', def.flavor));
    if (def.trait) card.append(el('div', 'card-trait', `${def.trait.name}: ${def.trait.text}`));
    if (m.bonuses.length) card.append(el('div', 'card-sub', `Level bonuses: ${m.bonuses.map((b) => bonusLabel(b, t, STAT_LABELS)).join(', ')}`));
    const w = ctl.world.player.crew.lees.find((l) => l.uid === m.uid);
    card.append(fullStats(def, t, w?.mods ?? {}));
    card.append(
      button('Release', 'hud-btn danger', () => {
        if (!confirmAction(`Release ${m.label}? They leave the crew for good; their trinkets go to cargo.`)) return;
        this.openSheet(null);
        this.clearSel();
        ctl.releaseLee(m.uid);
      }),
    );
    box.replaceChildren(card);
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
    // Auto-equip only when it would do something.
    if (this.autoEquipUseful(run))
      bar.append(
        button('Auto-equip', 'hud-btn', () => {
          this.clearSel();
          ctl.autoEquip();
        }),
      );
    if (ctl.mode === 'run' && ctl.refitFor !== 'fight') {
      const done = button('DONE', 'start-btn', () => {
        this.clearSel();
        ctl.closeRefit();
      });
      done.append(el('small', '', ctl.refitFor === 'port' ? 'back to port' : 'back to the map'));
      bar.append(done);
      return;
    }
    const launch = button('LAUNCH', 'start-btn', () => {
      if (!run.crew.some((m) => m.home !== null)) {
        this.toast('Nobody is aboard.');
        return;
      }
      this.clearSel();
      ctl.launch();
    });
    launch.append(el('small', '', ctl.mode === 'sandbox' ? 'sandbox' : `fight ${run.fight}`));
    bar.append(launch);
  }

  private autoEquipUseful(run: RunState): boolean {
    if (!cargo(run).length && !ashore(run).length) return false;
    const copy = structuredClone(run);
    autoEquipAll(copy, this.ctl.tuning);
    return JSON.stringify([copy.loadout, copy.crew.map((m) => [m.home, m.trinkets])]) !== JSON.stringify([run.loadout, run.crew.map((m) => [m.home, m.trinkets])]);
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
    // Generate: a budget (and optionally a chassis), built the way the sea builds enemies.
    const gen = el('div', 'row');
    const budget = el('input');
    budget.type = 'number';
    budget.min = '50';
    budget.step = '10';
    budget.value = String(this.genBudget);
    budget.onchange = () => (this.genBudget = Math.max(1, Math.round(Number(budget.value) || t.budget.base)));
    const chassis = el('select');
    chassis.append(new Option('Any ship', ''));
    for (const id of SHIP_ORDER) chassis.append(new Option(SHIPS[id].name, id));
    chassis.value = this.genChassis;
    chassis.onchange = () => (this.genChassis = chassis.value);
    gen.append(el('span', '', 'Budget'), budget, chassis, button('Generate', 'hud-btn', () => ctl.generateSandbox(this.genBudget, this.genChassis || undefined)));
    box.append(gen);
    const preset = el('select');
    preset.append(new Option('Load an archetype…', ''));
    for (const id of Object.keys(ARCHETYPES)) preset.append(new Option(`Archetype: ${ARCHETYPE_NAMES[id] ?? id}`, id));
    preset.onchange = () => {
      const v = preset.value;
      if (v) ctl.setSandboxEnemies(structuredClone([ARCHETYPES[v]]));
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
          delete e[bi].budget;
        });
      const ai = el('select');
      for (const id of Object.keys(t.ai)) ai.append(new Option(`AI: ${id}`, id));
      ai.value = spec.ai;
      ai.onchange = () => update((e) => (e[bi].ai = ai.value));
      row.append(s, ai, button('✕', 'hud-btn', () => update((e) => e.splice(bi, 1))));
      if (spec.budget) row.append(el('span', 'card-sub', `${spec.budget} pts · ${Object.keys(spec.fullLoadout ?? {}).length} parts`));
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
    // Sea monsters: any number, any kind, alone or with the ships.
    const monsters = el('div', 'enc-list');
    const updateNess = (fn: (n: NessSpec[]) => void) => {
      const next = structuredClone(sb.nesses);
      fn(next);
      ctl.setSandboxNesses(next);
    };
    sb.nesses.forEach((spec, ni) => {
      const row = el('div', 'row enc-boat');
      const kind = el('select');
      for (const id of NESS_ORDER) kind.append(new Option(NESS[id].name, id));
      kind.value = spec.kind;
      kind.onchange = () => updateNess((n) => (n[ni].kind = kind.value));
      const lvl = el('input');
      lvl.type = 'number';
      lvl.min = '1';
      lvl.max = '10';
      lvl.value = String(spec.level ?? 1);
      lvl.onchange = () => updateNess((n) => (n[ni].level = Math.max(1, Math.round(Number(lvl.value) || 1))));
      row.append(kind, el('span', '', 'Lv'), lvl, button('✕', 'hud-btn', () => updateNess((n) => n.splice(ni, 1))));
      monsters.append(row);
    });
    box.append(monsters, button('+ Ness', 'hud-btn', () => updateNess((n) => n.push({ kind: NESS_ORDER[0], level: 1 }))));
    box.append(el('div', 'setup-hint', 'Enemies sail their ship’s standard fit (generated ones their own parts). Sandbox assists (Tune → Global) apply here, never in a run. The cargo is the whole catalog.'));
  }
}
