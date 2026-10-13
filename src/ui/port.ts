// The port screen: a header (name, specialties, gold, hold), one tab per
// service, and SAIL. Every service is a short list of small cards with a
// price on the button. Selling happens in the shops, from your hold. SAIL
// shows the destinations (name, specialties, services, the kind of sea), and
// warns before you leave with something unused (Auto-equip / Leave anyway).

import { DIFFICULTIES } from '../config/difficulty';
import { ITEMS } from '../config/items';
import { LEE_DEFS } from '../config/lees';
import { SERVICE_ORDER, SERVICES, specialtyName, type ServiceId } from '../config/ports';
import { MAP_STYLES } from '../config/sea';
import { SHIPS } from '../config/ships';
import type { Controller } from '../game/Controller';
import {
  bankInterest,
  buyPrice,
  chassisPrice,
  healPrice,
  healAllPrice,
  itemMatches,
  leaveWarnings,
  recruitPrice,
  repairPrice,
  rerollPrice,
  sailBlockers,
  sellPrice,
  shipyardStock,
  tradeInValue,
  type PortPlan,
  type Shop,
} from '../sim/port';
import { cargo, cargoLimit, cargoOver, crewMax, hullShare, type RunState } from '../sim/run';
import { itemIcon, itemLine, jobBars, levelBadge, memberFigure } from './cards';
import { button, confirmAction, el, pct } from './dom';
import { shipPreview } from './shipPreview';

type Tab = ServiceId | 'sail';

export class PortScreen {
  readonly root: HTMLDivElement;
  private ctl: Controller;
  private tab: Tab = 'shop';
  private sig = '';
  /** A destination waiting on the leave-port warning. */
  private leaving: number | null = null;
  /** The port the tab belongs to (a new port opens on its first tab). */
  private tabFor = '';

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'screen port-screen hidden');
    ctl.onChange(() => this.render());
  }

  private render(): void {
    const ctl = this.ctl;
    const run = ctl.run;
    const on = ctl.screen === 'port' && ctl.mode === 'run' && !!run?.port;
    this.root.classList.toggle('hidden', !on);
    if (!on || !run) {
      this.sig = '';
      this.leaving = null;
      return;
    }
    const sig = JSON.stringify([JSON.stringify(run), this.tab, this.leaving, this.tabFor]);
    if (sig === this.sig) return;
    this.sig = sig;
    const port = run.port!;
    const tabs = this.tabs(run);
    const key = `${run.seed}:${port.index}`;
    if (this.tabFor !== key) {
      this.tabFor = key;
      this.tab = tabs[0];
      this.root.scrollTop = 0;
    }
    if (!tabs.includes(this.tab)) this.tab = tabs[0];
    const body = el('div', 'screen-body port');

    // Header: name, specialties, gold, hold.
    const head = el('div', 'port-head');
    const title = el('div', 'port-title');
    title.append(el('span', 'port-name', `⚓ ${port.name}`), el('span', 'gold', `🪙 ${run.gold}`));
    const sub = el('div', 'port-sub');
    sub.append(
      el('span', '', port.specialties.map((s) => `⭐ ${specialtyName(s)}`).join(' · ') || 'No specialty'),
      el('span', cargoOver(run, ctl.tuning) ? 'hold over' : 'hold', run.noHull ? 'No ship yet' : `Hold ${cargo(run).length}/${cargoLimit(run, ctl.tuning)}`),
    );
    head.append(title, sub);
    if (port.services.includes('bank') && run.gold > 0) head.append(el('div', 'card-sub', `🏦 Bank: leave with ${run.gold} gold, collect +${bankInterest(run, ctl.tuning)} at the next port.`));
    body.append(head);

    // Tabs.
    const bar = el('div', 'port-tabs');
    for (const id of tabs) {
      const label = id === 'sail' ? '⛵ Sail' : `${SERVICES[id].icon} ${SERVICES[id].name.split(' ')[0]}`;
      bar.append(
        button(label, `tab${this.tab === id ? ' on' : ''}`, () => {
          this.tab = id;
          this.leaving = null;
          this.render();
        }),
      );
    }
    body.append(bar);

    const content = el('div', 'port-content');
    switch (this.tab) {
      case 'shop':
      case 'specialty':
      case 'dealer':
        this.renderShop(content, run, this.tab);
        break;
      case 'tavern':
        this.renderTavern(content, run);
        break;
      case 'shipwright':
        this.renderShipwright(content, run);
        break;
      case 'shipyard':
        this.renderShipyard(content, run);
        break;
      case 'sail':
        this.renderSail(content, run);
        break;
      default:
        break;
    }
    body.append(content);

    // Bottom: refit (once you have a ship).
    const foot = el('div', 'port-foot');
    if (!run.noHull) foot.append(button('🛠️ Refit', 'big-btn', () => ctl.openRefit()));
    if (this.tab !== 'sail') foot.append(button('⛵ Sail…', 'big-btn primary', () => ((this.tab = 'sail'), this.render())));
    body.append(foot);
    const scroll = this.root.scrollTop;
    this.root.replaceChildren(body);
    this.root.scrollTop = scroll;
  }

  /** Tabs for this port's services (the bank has no tab: it's automatic). */
  private tabs(run: RunState): Tab[] {
    const port = run.port!;
    const out: Tab[] = SERVICE_ORDER.filter((id) => id !== 'bank' && port.services.includes(id));
    if (run.noHull) {
      // Custom start: the shipyard first.
      out.sort((a, b) => (a === 'shipyard' ? -1 : b === 'shipyard' ? 1 : 0));
    }
    out.push('sail');
    return out;
  }

  // ------------------------------------------------------------ shops

  private renderShop(box: HTMLElement, run: RunState, shop: Shop): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const port = run.port!;
    box.append(el('div', 'card-sub', SERVICES[shop].text + (shop === 'specialty' ? `: ${port.specialties.map(specialtyName).join(', ')}` : '')));
    const list = el('div', 'shop-list');
    (port.stock[shop] ?? []).forEach((e, i) => {
      if (e.kind !== 'item') return;
      const def = ITEMS[e.item];
      if (!def) return;
      const price = buyPrice(port, e.item, t, shop);
      const row = el('div', `shop-row${e.sold ? ' sold' : ''}`);
      const line = itemLine(def);
      if (itemMatches(port, e.item)) line.querySelector('.card-title')?.append(el('span', 'spec-star', ' ⭐'));
      row.append(line);
      row.append(
        e.sold
          ? el('span', 'sold-tag', 'Sold')
          : button(`🪙 ${price}`, `price-btn${price > run.gold ? ' dear' : ''}`, () => {
              if (price > run.gold) return;
              ctl.buy(shop, i);
            }),
      );
      list.append(row);
    });
    box.append(list, this.rerollRow(run, shop));
    this.renderSell(box, run);
  }

  private rerollRow(run: RunState, shop: Shop | 'tavern'): HTMLElement {
    const price = rerollPrice(run, this.ctl.tuning);
    const row = el('div', 'row reroll');
    row.append(button(`🎲 Reroll · 🪙 ${price}`, `hud-btn${price > run.gold ? ' dim' : ''}`, () => this.ctl.reroll(shop)));
    return row;
  }

  /** Your hold, with what each thing sells for here (if the port has a shop). Over the limit, things can be left on the dock too. */
  private renderSell(box: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const port = run.port!;
    const items = cargo(run);
    const over = cargoOver(run, t);
    const shop = (['shop', 'specialty', 'dealer'] as const).some((x) => port.services.includes(x));
    box.append(el('h3', '', `${shop ? 'Sell from your hold' : 'Your hold'}${over ? ` · ${over} over` : ''}`));
    if (!items.length) {
      box.append(el('div', 'card-sub', 'Nothing in the hold. Take parts off in refit to sell them.'));
      return;
    }
    const list = el('div', 'sell-list');
    for (const inst of items) {
      const def = ITEMS[inst.item];
      if (!def) continue;
      const row = el('div', 'sell-row');
      row.append(itemIcon(def), el('span', 'sell-name', def.name));
      if (itemMatches(port, def.id)) row.append(el('span', 'spec-star', '⭐'));
      if (shop) row.append(button(`+🪙 ${sellPrice(port, def.id, t)}`, 'price-btn sell', () => ctl.sell(inst.uid)));
      if (over)
        row.append(
          button('✕', 'hud-btn', () => {
            if (confirmAction(`Leave the ${def.name} on the dock for good?`)) ctl.discard(inst.uid);
          }),
        );
      list.append(row);
    }
    box.append(list);
  }

  // ------------------------------------------------------------ tavern

  private renderTavern(box: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const port = run.port!;
    // Healing.
    const hurt = run.crew.filter((m) => m.hp < 0.999);
    const all = healAllPrice(run, t);
    box.append(el('h3', '', 'Heal'));
    if (!hurt.length) box.append(el('div', 'card-sub', 'Nobody is hurt.'));
    else {
      box.append(button(`Heal everyone · 🪙 ${all}`, `big-btn${all > run.gold ? ' dim' : ''}`, () => ctl.heal()));
      const list = el('div', 'heal-list');
      for (const m of hurt) {
        const row = el('div', 'heal-row');
        const bar = el('div', 'hp-bar');
        const fill = el('div', 'hp-fill');
        fill.style.width = pct(m.hp);
        bar.append(fill);
        row.append(memberFigure(m.type, 'chip-figure'), el('span', 'sell-name', m.label), bar, button(`🪙 ${healPrice(run, m.uid, t)}`, 'price-btn', () => ctl.heal(m.uid)));
        list.append(row);
      }
      box.append(list);
    }
    // Too many Lees for the ship (after a shipyard change).
    const max = crewMax(run, t);
    if (!run.noHull && run.crew.length > max) {
      box.append(el('h3', 'warn', `Too many Lees (${run.crew.length}/${max}): release ${run.crew.length - max}`));
      const list = el('div', 'heal-list');
      for (const m of run.crew) {
        const row = el('div', 'heal-row');
        row.append(
          memberFigure(m.type, 'chip-figure'),
          el('span', 'sell-name', m.label),
          levelBadge(m, t),
          button('Release', 'hud-btn danger', () => {
            if (confirmAction(`Release ${m.label} for good?`)) ctl.releaseLee(m.uid);
          }),
        );
        list.append(row);
      }
      box.append(list);
    }
    // Recruits.
    box.append(el('h3', '', `Hire · crew ${run.crew.length}${run.noHull ? '' : `/${max}`}`));
    const list = el('div', 'shop-list');
    (port.stock.tavern ?? []).forEach((e, i) => {
      if (e.kind !== 'lee') return;
      const def = LEE_DEFS[e.type] ?? LEE_DEFS.basic;
      const price = recruitPrice(port, e.type, e.level, t);
      const full = !run.noHull && run.crew.length >= max;
      const row = el('div', `shop-row${e.sold ? ' sold' : ''}`);
      const head = el('div', 'card-row');
      const names = el('div', 'card-names');
      names.append(el('div', 'card-title', `${def.name}${e.level > 1 ? ` · Lv ${e.level}` : ''}`), el('div', 'card-text', def.role + (def.trait ? ` · ${def.trait.name}` : '')));
      head.append(memberFigure(e.type, 'chip-figure'), names, jobBars(e.type, t));
      row.append(head);
      row.append(
        e.sold
          ? el('span', 'sold-tag', 'Hired')
          : button(full ? 'Crew full' : `🪙 ${price}`, `price-btn${price > run.gold || full ? ' dear' : ''}`, () => {
              if (price > run.gold || full) return;
              ctl.buy('tavern', i);
            }),
      );
      list.append(row);
    });
    box.append(list, this.rerollRow(run, 'tavern'));
  }

  // ------------------------------------------------------------ shipwright and shipyard

  private renderShipwright(box: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    if (run.noHull) {
      box.append(el('div', 'card-sub', 'No hull to repair yet.'));
      return;
    }
    const share = hullShare(run, t);
    const price = repairPrice(run, t);
    const bar = el('div', 'hp-bar big');
    const fill = el('div', 'hp-fill');
    fill.style.width = pct(share);
    bar.append(fill);
    box.append(el('h3', '', `Hull ${pct(share)}`), bar);
    if (price <= 0) box.append(el('div', 'card-sub', 'Good as new.'));
    else {
      const can = Math.min(1, run.gold / price);
      box.append(button(can >= 1 ? `Repair it all · 🪙 ${price}` : `Repair what 🪙 ${run.gold} buys (${pct(can)} of it)`, `big-btn primary${run.gold <= 0 ? ' dim' : ''}`, () => ctl.repair()));
    }
    const d = DIFFICULTIES[run.difficulty];
    box.append(el('div', 'card-sub', `After every fight the crew patch ${pct(Math.min(1, t.run.autoRepair * (d?.freeFix ?? 1)))} of the damage for free.`));
  }

  private renderShipyard(box: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const port = run.port!;
    const credit = tradeInValue(run, t);
    box.append(el('div', 'card-sub', run.noHull ? 'Buy a hull to start.' : `Your ${SHIPS[run.ship].name} trades in for 🪙 ${credit}. Your crew and gear go into storage; place them in refit.`));
    const list = el('div', 'card-list');
    for (const id of shipyardStock(run)) {
      const ship = SHIPS[id];
      const price = chassisPrice(port, id, t);
      const net = price - credit;
      const card = el('div', 'card');
      const head = el('div', 'card-row');
      head.append(el('div', 'card-title', ship.name), el('div', 'card-sub', `${ship.style} · crew ${Math.round(t.ships[id]?.crewMax ?? 0)} · hold ${Math.round(t.ships[id]?.cargo ?? 0)} · treasures ${Math.round(t.ships[id]?.treasures ?? 0)}`));
      card.append(head, shipPreview(ship, {}, 200), el('div', 'card-text', ship.blurb));
      card.append(
        button(credit ? `🪙 ${price} − ${credit} = ${net}` : `🪙 ${price}`, `big-btn primary${net > run.gold ? ' dim' : ''}`, () => {
          if (net > run.gold) return;
          if (!run.noHull && !confirmAction(`Trade in your ${SHIPS[run.ship].name} for the ${ship.name}? Everything comes off into storage.`)) return;
          if (ctl.buyChassis(id)) ctl.openRefit();
        }),
      );
      list.append(card);
    }
    box.append(list);
  }

  // ------------------------------------------------------------ sail

  private renderSail(box: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const port = run.port!;
    const blockers = sailBlockers(run, t);
    if (this.leaving !== null) {
      // The warning: something could still be used.
      const warn = leaveWarnings(run, t);
      box.append(el('h3', '', 'Leave anyway?'));
      for (const w of warn) box.append(el('div', 'warning', w));
      const row = el('div', 'menu-buttons');
      const go = this.leaving;
      row.append(
        button('Auto-equip, then sail', 'big-btn primary', () => {
          this.leaving = null;
          ctl.autoEquip();
          if (!sailBlockers(ctl.run!, t).length) ctl.leavePort(go);
        }),
        button('Leave anyway', 'big-btn', () => {
          this.leaving = null;
          ctl.leavePort(go);
        }),
        button('Back', 'hud-btn', () => {
          this.leaving = null;
          this.render();
        }),
      );
      box.append(row);
      return;
    }
    for (const b of blockers) box.append(el('div', 'warning', b));
    // Over the hold's limit: sell or leave things here (without a shop, leave only).
    if (cargoOver(run, t) > 0) this.renderSell(box, run);
    box.append(el('div', 'card-sub', 'Where to? The sea between here and there is shown under each port.'));
    const list = el('div', 'card-list');
    port.offers.forEach((plan, i) => {
      const card = button('', `card dest-card pick${blockers.length ? ' dim' : ''}`, () => {
        if (sailBlockers(run, t).length) return;
        if (leaveWarnings(run, t).length) {
          this.leaving = i;
          this.render();
        } else ctl.leavePort(i);
      });
      card.append(...destination(plan));
      list.append(card);
    });
    box.append(list);
  }
}

/** A destination card's insides: name, specialties, services, the kind of sea. */
export function destination(plan: PortPlan): HTMLElement[] {
  const head = el('div', 'card-row');
  head.append(el('div', 'card-title', `⚓ ${plan.name}`), el('div', 'card-sub', plan.specialties.map((s) => `⭐ ${specialtyName(s)}`).join(' · ')));
  const services = el('div', 'dest-services');
  for (const id of SERVICE_ORDER) {
    const has = id === 'shipwright' || id === 'tavern' || plan.services.includes(id);
    const s = el('span', `svc${has ? '' : ' off'}`, SERVICES[id].icon);
    s.title = `${SERVICES[id].name}${has ? '' : ' (none)'}`;
    services.append(s);
  }
  const sea = el('div', 'dest-sea');
  for (const id of plan.styles) {
    const st = MAP_STYLES[id];
    if (st) sea.append(el('div', 'sea-style', `${st.icon} ${st.name}: ${st.text}`));
  }
  return [head, services, sea];
}
