// The sea map screen: the sea between two ports, scrolling up from the port
// you left (bottom) to your destination (top). Your boat sits at a stop with
// its travel radius around it; stops in reach have a dotted route to them.
// Tap a stop to see what you know about it (type, danger, the enemy's ship;
// crew and parts with the right gear); tap it again, or SAIL, to go. Cleared
// stops stay (you can sail back through them). No steering here.

import { ITEMS } from '../config/items';
import { LEE_DEFS } from '../config/lees';
import { MAP_STYLES, MODIFIERS, STOP_TYPES } from '../config/sea';
import { SHIPS } from '../config/ships';
import type { Controller } from '../game/Controller';
import { cargo, cargoLimit, cargoOver, hullShare, type RunState } from '../sim/run';
import { cantSail, danger, hidden, inReach, intel, type SeaMap, type Stop } from '../sim/seaMap';
import { itemIcon } from './cards';
import { button, confirmAction, el, pct } from './dom';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export class MapScreen {
  readonly root: HTMLDivElement;
  private ctl: Controller;
  private sig = '';
  private sel: number | null = null;
  /** True while the boat is sailing a hop (input ignored). */
  private sailing = false;
  private overboard = false;
  private scrollFor = '';

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'screen map-screen hidden');
    ctl.onChange(() => this.render());
  }

  private render(): void {
    const ctl = this.ctl;
    const run = ctl.run;
    const on = ctl.screen === 'map' && ctl.mode === 'run' && !!run?.map;
    this.root.classList.toggle('hidden', !on);
    if (!on || !run) {
      this.sig = '';
      this.sel = null;
      this.overboard = false;
      return;
    }
    if (this.sailing) return;
    const sig = JSON.stringify([JSON.stringify(run), this.sel, this.overboard]);
    if (sig === this.sig) return;
    this.sig = sig;
    const map = run.map!;
    const t = ctl.tuning;
    const body = el('div', 'map-body');

    // Header: where to, gold, hold, hull, the sea.
    const head = el('div', 'map-head');
    const top = el('div', 'port-title');
    top.append(el('span', 'port-name', `⛵ To ${map.destPort.name}`), el('span', 'gold', `🪙 ${run.gold}`));
    const sub = el('div', 'port-sub');
    const over = cargoOver(run, t);
    sub.append(
      el('span', '', map.styles.map((id) => `${MAP_STYLES[id]?.icon ?? ''} ${MAP_STYLES[id]?.name ?? id}`).join(' + ')),
      el('span', '', `Hull ${pct(hullShare(run, t))}`),
      el('span', over ? 'hold over' : 'hold', `Hold ${cargo(run).length}/${cargoLimit(run, t)}`),
    );
    head.append(top, sub);
    const tools = el('div', 'row map-tools');
    tools.append(button('🛠️ Refit', 'hud-btn', () => ctl.openRefit()));
    if (over) tools.append(button(`🌊 Throw ${over} overboard`, 'hud-btn danger', () => ((this.overboard = true), this.render())));
    head.append(tools);
    body.append(head);

    if (this.overboard) {
      body.append(this.renderOverboard(run));
      this.root.replaceChildren(body);
      return;
    }

    // The sea.
    const sea = el('div', 'map-sea');
    const canvas = el('div', 'map-canvas');
    const w = Math.max(240, Math.min(this.root.clientWidth || 360, 460));
    const k = w / map.width;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${map.height * k}px`;
    const lines = svg('svg', { class: 'map-svg', viewBox: `0 0 ${map.width} ${map.height}`, width: w, height: map.height * k });
    const here = map.stops[map.at];
    const reach = new Set(inReach(map));
    lines.append(svg('circle', { cx: here.x, cy: here.y, r: map.radius, class: 'map-radius' }));
    for (const id of reach) {
      const s = map.stops[id];
      lines.append(svg('line', { x1: here.x, y1: here.y, x2: s.x, y2: s.y, class: `map-route${this.sel === id ? ' on' : ''}` }));
    }
    canvas.append(lines);
    for (const s of map.stops) canvas.append(this.stopEl(run, map, s, k, reach.has(s.id)));
    const boat = el('div', 'map-boat', '⛵');
    boat.style.left = `${here.x * k}px`;
    boat.style.top = `${here.y * k}px`;
    canvas.append(boat);
    sea.append(canvas);
    body.append(sea);

    // The selected stop's card.
    if (this.sel !== null && map.stops[this.sel]) body.append(this.stopCard(run, map.stops[this.sel], reach.has(this.sel)));
    else body.append(el('div', 'map-hint', 'Tap a stop to see it. Stops inside the circle are one hop away.'));

    const scroll = sea.scrollTop;
    this.root.replaceChildren(body);
    // Follow the boat when it moves (or the map is new); otherwise keep where you were looking.
    const key = `${map.journey}:${map.at}`;
    if (this.scrollFor !== key) {
      this.scrollFor = key;
      sea.scrollTop = Math.max(0, here.y * k - sea.clientHeight * 0.6);
    } else sea.scrollTop = scroll;
    this.boatEl = boat;
    this.scale = k;
  }

  private boatEl: HTMLDivElement | null = null;
  private scale = 1;

  /** A stop on the map: its icon (or fog), danger, cleared. */
  private stopEl(run: RunState, map: SeaMap, s: Stop, k: number, near: boolean): HTMLElement {
    const t = this.ctl.tuning;
    const def = STOP_TYPES[s.type];
    const fog = hidden(s);
    const dest = s.id === map.dest;
    const cls = ['map-stop', near ? 'near' : 'far', s.cleared ? 'cleared' : '', fog ? 'fog' : '', dest ? 'dest' : '', s.id === map.at ? 'here' : '', this.sel === s.id ? 'on' : ''].filter(Boolean).join(' ');
    const b = button('', cls, () => this.tap(s.id));
    b.style.left = `${s.x * k}px`;
    b.style.top = `${s.y * k}px`;
    const icon = s.id === 0 ? '🏠' : fog ? MODIFIERS.fog.icon : (def?.icon ?? '?');
    b.append(el('span', 'stop-icon', icon));
    if (s.cleared && s.id !== 0) b.append(el('span', 'stop-done', '✓'));
    const skulls = !fog && !s.cleared ? danger(run, s, t) : null;
    if (skulls) b.append(el('span', `stop-danger d${skulls}`, '💀'.repeat(skulls)));
    if (dest) b.append(el('span', 'stop-label', map.destPort.name));
    return b;
  }

  private tap(id: number): void {
    const run = this.ctl.run;
    if (!run?.map || this.sailing) return;
    if (this.sel === id && inReach(run.map).includes(id)) {
      this.sail(id);
      return;
    }
    this.sel = id;
    this.render();
  }

  /** Sail: the boat glides along the dotted route, then the stop happens. */
  private sail(id: number): void {
    const ctl = this.ctl;
    const run = ctl.run;
    if (!run?.map) return;
    const why = cantSail(run, id, ctl.tuning);
    if (why) {
      this.flash(why);
      return;
    }
    const s = run.map.stops[id];
    const time = Math.max(0, ctl.tuning.map.hopTime);
    const boat = this.boatEl;
    this.sailing = true;
    if (boat && time > 0) {
      boat.style.transition = `left ${time}s ease-in-out, top ${time}s ease-in-out`;
      boat.style.left = `${s.x * this.scale}px`;
      boat.style.top = `${s.y * this.scale}px`;
    }
    window.setTimeout(() => {
      this.sailing = false;
      this.sel = null;
      this.sig = '';
      ctl.sailTo(id);
    }, time * 1000);
  }

  private flash(text: string): void {
    const note = el('div', 'map-flash', text);
    this.root.append(note);
    window.setTimeout(() => note.remove(), 2400);
  }

  /** What you know about a stop, and SAIL. */
  private stopCard(run: RunState, s: Stop, near: boolean): HTMLElement {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const map = run.map!;
    const card = el('div', 'map-card');
    const def = STOP_TYPES[s.type];
    const fog = hidden(s);
    const head = el('div', 'card-row');
    if (s.id === map.dest) head.append(el('div', 'card-title', `⚓ ${map.destPort.name}`), el('div', 'card-sub', 'Your destination'));
    else if (s.id === 0) head.append(el('div', 'card-title', '🏠 The port you left'), el('div', 'card-sub', 'Nothing more for you there'));
    else if (fog) head.append(el('div', 'card-title', `${MODIFIERS.fog.icon} Fog`), el('div', 'card-sub', MODIFIERS.fog.text));
    else {
      const skulls = danger(run, s, t);
      head.append(el('div', 'card-title', `${def.icon} ${def.name}`), el('div', 'card-sub', s.cleared ? 'Cleared' : skulls ? '💀'.repeat(skulls) : ''));
    }
    card.append(head);
    if (!fog && s.id !== map.dest && s.id !== 0 && !s.cleared) {
      card.append(el('div', 'card-text', def.text));
      if (s.enemies.length) card.append(this.intelRows(run, s));
    }
    const row = el('div', 'row');
    if (s.id === map.at) row.append(el('span', 'card-sub', 'You are here.'));
    else if (near) row.append(button(s.id === map.dest ? 'Sail into port ▸' : 'Sail here ▸', 'big-btn primary', () => this.sail(s.id)));
    else row.append(el('span', 'card-sub', 'Out of reach: sail closer first.'));
    card.append(row);
    return card;
  }

  /** The enemy, as far as you can see: always the ship type; crew with a Spyglass; parts with a manned Crow's Nest. */
  private intelRows(run: RunState, s: Stop): HTMLElement {
    const know = intel(run);
    const box = el('div', 'intel');
    for (const e of s.enemies) {
      const row = el('div', 'intel-row');
      row.append(el('b', '', SHIPS[e.ship]?.name ?? e.ship));
      if (know.has('crew')) {
        const n = e.crew.reduce((a, c) => a + (c.count ?? 1), 0);
        const levels = e.crew.map((c) => c.level ?? 1);
        const lv = Math.min(...levels) === Math.max(...levels) ? `Lv ${levels[0]}` : `Lv ${Math.min(...levels)}–${Math.max(...levels)}`;
        const types = el('span', 'intel-crew');
        types.append(el('span', '', ` · ${n} ${n === 1 ? 'Lee' : 'Lees'}, ${lv} `));
        for (const c of e.crew) {
          const dot = el('span', 'intel-dot', '●'.repeat(Math.max(1, c.count ?? 1)));
          dot.style.color = LEE_DEFS[c.type]?.color ?? '#ccc';
          dot.title = LEE_DEFS[c.type]?.name ?? c.type;
          types.append(dot);
        }
        row.append(types);
      }
      if (know.has('parts')) {
        const icons = el('span', 'intel-parts');
        for (const i of [...Object.values(e.fullLoadout ?? {}), ...(e.treasures ?? [])]) icons.append(itemIcon(ITEMS[i], 'item-icon small'));
        row.append(icons);
      }
      box.append(row);
    }
    if (!know.has('crew')) box.append(el('div', 'card-sub', 'A Spyglass (worn) shows their crew.'));
    else if (!know.has('parts')) box.append(el('div', 'card-sub', 'A manned Crow’s Nest shows their parts.'));
    return box;
  }

  /** Over the hold's limit at sea: throw things overboard. */
  private renderOverboard(run: RunState): HTMLElement {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const box = el('div', 'map-card');
    const over = cargoOver(run, t);
    box.append(el('h3', '', over ? `Throw ${over} overboard` : 'The hold fits'), el('div', 'card-sub', 'Or equip something in refit to make room.'));
    const list = el('div', 'sell-list');
    for (const inst of cargo(run)) {
      const def = ITEMS[inst.item];
      if (!def) continue;
      const row = el('div', 'sell-row');
      row.append(
        itemIcon(def),
        el('span', 'sell-name', def.name),
        button('🌊 Overboard', 'hud-btn danger', () => {
          if (confirmAction(`Throw the ${def.name} overboard for good?`)) ctl.discard(inst.uid);
        }),
      );
      list.append(row);
    }
    box.append(list, button('Done', 'big-btn primary', () => ((this.overboard = false), this.render())));
    return box;
  }
}
