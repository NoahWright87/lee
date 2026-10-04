// Full-screen run screens over the canvas: the menu, choosing a ship, drafting
// the crew, the starting part, after a fight (results → level-ups → reward),
// and Run Over. Plus the ⚙️ system menu (on every screen) and the message for
// a saved run that can't be continued.

import { ITEMS } from '../config/items';
import { LEE_DEFS, STAT_LABELS } from '../config/lees';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import { countTags } from '../config/tags';
import type { Controller } from '../game/Controller';
import { bonusLabel } from '../sim/levels';
import { buildFor, crewMax, crewMin, draftOffer, itemOf, SAVE_VERSION, type RunState } from '../sim/run';
import { itemCard, itemIcon, leeTypeCard, levelBadge, loadoutIcons, memberFigure, slotSummary, tagChips } from './cards';
import { button, confirmAction, el } from './dom';
import { shipPreview } from './shipPreview';

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

type PostStep = 'results' | 'levels' | 'reward';

export class Screens {
  readonly root: HTMLDivElement;
  readonly gear: HTMLButtonElement;
  private menu: HTMLDivElement;
  private ctl: Controller;
  private sig = '';
  private postStep: PostStep = 'results';
  private postFor = -1;
  /** Picking someone to release for a recruit (reward card index), or null. */
  private releaseFor: number | null = null;
  private saveErrorDismissed = false;

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'screen hidden');
    this.gear = button('⚙️', 'gear-btn', () => this.openMenu());
    this.gear.title = 'Menu';
    this.menu = el('div', 'modal hidden');
    ctl.onChange(() => this.render());
    this.render();
  }

  // ------------------------------------------------------------ system menu

  private openMenu(): void {
    this.ctl.setPaused(true);
    this.menu.replaceChildren();
    const card = el('div', 'modal-card');
    card.append(el('h2', '', 'Menu'));
    const resume = button('Resume', 'big-btn primary', () => this.closeMenu());
    const buttons = el('div', 'modal-buttons');
    buttons.append(resume);
    if (this.ctl.mode === 'run') {
      buttons.append(
        button('Restart Run', 'big-btn', () => {
          if (!confirmAction('Abandon this run and choose a new ship? It can’t be undone.')) return;
          this.closeMenu();
          this.ctl.restartRun();
        }),
      );
    }
    if (this.ctl.screen !== 'menu') {
      buttons.append(
        button('Main menu', 'big-btn', () => {
          this.closeMenu();
          this.ctl.toMenu();
        }),
      );
    }
    buttons.append(
      button('Reset All Saved Data', 'big-btn danger', () => {
        if (!confirmAction('Wipe the saved run, the sandbox and your current tuning? (Named tuning presets are kept.) This can’t be undone.')) return;
        this.closeMenu();
        this.ctl.resetAll();
      }),
    );
    card.append(buttons, el('div', 'version', `Save v${SAVE_VERSION} · Build ${BUILD}`));
    this.menu.append(card);
    this.menu.onclick = (e) => {
      if (e.target === this.menu) this.closeMenu();
    };
    this.menu.classList.remove('hidden');
  }

  private closeMenu(): void {
    this.menu.classList.add('hidden');
    this.ctl.setPaused(false);
  }

  get menuRoot(): HTMLDivElement {
    return this.menu;
  }

  // ------------------------------------------------------------ screens

  private render(): void {
    const ctl = this.ctl;
    const run = ctl.run;
    const full = ['menu', 'chooseShip', 'draft', 'startPart', 'post', 'over'].includes(ctl.screen);
    this.root.classList.toggle('hidden', !full);
    if (!full) {
      this.sig = '';
      return;
    }
    if (ctl.screen === 'post' && run?.pending && this.postFor !== run.pending.fight) {
      this.postFor = run.pending.fight;
      this.postStep = 'results';
      this.releaseFor = null;
    }
    const sig = JSON.stringify([ctl.screen, run && JSON.stringify(run), this.postStep, this.releaseFor, ctl.canContinue(), this.saveErrorDismissed, ctl.saved.ok]);
    if (sig === this.sig) return;
    this.sig = sig;
    const body = el('div', 'screen-body');
    switch (ctl.screen) {
      case 'menu':
        this.renderMenu(body);
        break;
      case 'chooseShip':
        this.renderChooseShip(body);
        break;
      case 'draft':
        if (run) this.renderDraft(body, run);
        break;
      case 'startPart':
        if (run) this.renderStartPart(body, run);
        break;
      case 'post':
        if (run) this.renderPost(body, run);
        break;
      case 'over':
        if (run) this.renderOver(body, run);
        break;
    }
    this.root.replaceChildren(body);
    this.root.scrollTop = 0;
  }

  private renderMenu(body: HTMLElement): void {
    const ctl = this.ctl;
    body.classList.add('menu');
    body.append(el('h1', 'title', 'Lee'), el('div', 'subtitle', 'Choose a ship, draft a crew, and see how far you get.'));
    const buttons = el('div', 'menu-buttons');
    buttons.append(button('New Run', 'big-btn primary', () => ctl.newRun()));
    if (ctl.canContinue() && ctl.saved.ok) {
      const r = ctl.saved.run;
      const b = button('Continue', 'big-btn', () => ctl.continueRun());
      b.append(el('small', '', `${SHIPS[r.ship]?.name ?? r.ship} · fight ${r.fight} · ${r.crew.length} Lees`));
      buttons.append(b);
    }
    buttons.append(button('Sandbox', 'big-btn', () => ctl.enterSandbox()));
    body.append(buttons);
    if (!ctl.saved.ok && ctl.saved.reason !== 'none' && !this.saveErrorDismissed) {
      const box = el('div', 'save-error');
      box.append(
        el('div', '', ctl.saved.reason === 'version' ? 'This saved run is from an older version and can’t be continued.' : 'The saved run couldn’t be read, so it can’t be continued.'),
      );
      const row = el('div', 'row');
      row.append(
        button('Reset saved data', 'hud-btn', () => {
          if (confirmAction('Reset all saved data? (Named tuning presets are kept.)')) ctl.resetAll();
        }),
        button('Cancel', 'hud-btn', () => {
          this.saveErrorDismissed = true;
          this.render();
        }),
      );
      box.append(row);
      body.append(box);
    }
  }

  private renderChooseShip(body: HTMLElement): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    body.append(el('h2', '', 'Choose a ship'), el('div', 'subtitle', 'Each one asks for a different way of fighting.'));
    const list = el('div', 'card-list');
    for (const id of SHIP_ORDER) {
      const ship = SHIPS[id];
      const st = t.ships[id];
      const card = el('div', 'card ship-card');
      const head = el('div', 'card-row');
      const names = el('div', 'card-names');
      names.append(el('div', 'card-title', ship.name), el('div', 'card-sub', ship.style));
      head.append(names);
      card.append(head, shipPreview(ship, ship.defaults, 250), el('div', 'card-text', ship.blurb));
      const stats = el('div', 'ship-stats');
      const stat = (k: string, v: string) => {
        const s = el('span', 'ship-stat');
        s.append(el('small', '', k), el('b', '', v));
        stats.append(s);
      };
      stat('Speed', `×${st.speed.toFixed(2)}`);
      stat('Turning', `×${st.turn.toFixed(2)}`);
      stat('Hull', `×${st.hullHp.toFixed(2)}`);
      stat('Leaks', `×${st.leak.toFixed(2)}`);
      stat('Crew', `${st.crewMin}–${st.crewMax}`);
      stat('Treasures', `${st.treasures}`);
      card.append(stats, el('div', 'card-sub slots', slotSummary(ship)));
      card.append(loadoutIcons(Object.values(ship.defaults)));
      if (ship.tags.length) card.append(tagChips(ship.tags));
      card.append(button(`Sail the ${ship.name}`, 'big-btn primary', () => ctl.chooseShip(id)));
      list.append(card);
    }
    body.append(list);
  }

  private renderDraft(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const need = crewMin(run, t);
    body.append(el('h2', '', `Draft your crew · ${run.crew.length + 1} of ${need}`), el('div', 'subtitle', `${SHIPS[run.ship].name}: pick one Lee each round.`));
    if (run.crew.length) {
      const so = el('div', 'crew-so-far');
      for (const m of run.crew) {
        const chip = el('span', 'crew-chip');
        chip.append(memberFigure(m.type, 'chip-figure'), document.createTextNode(m.label));
        so.append(chip);
      }
      body.append(so);
    }
    const list = el('div', 'card-list');
    for (const type of draftOffer(run, t)) {
      list.append(leeTypeCard(type, t, 1, [button(`Draft ${LEE_DEFS[type].name}`, 'big-btn primary', () => ctl.draft(type))]));
    }
    body.append(list);
  }

  private renderStartPart(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    body.append(el('h2', '', 'Pick a starting part'), el('div', 'subtitle', 'Start steering your build. It goes into an empty slot if one fits, or into cargo.'));
    const list = el('div', 'card-list');
    for (const item of run.startOffer) {
      const def = ITEMS[item];
      if (!def) continue;
      list.append(itemCard(def, [button(`Take the ${def.name}`, 'big-btn primary', () => ctl.takeStartPart(item))]));
    }
    body.append(list);
  }

  // ------------------------------------------------------------ after a fight

  private renderPost(body: HTMLElement, run: RunState): void {
    const post = run.pending;
    if (!post) {
      body.append(button('Back to refit', 'big-btn primary', () => this.ctl.finishPost()));
      return;
    }
    if (this.postStep === 'levels' && !post.levelUps.length) this.postStep = 'reward';
    if (this.postStep === 'results') this.renderResults(body, run);
    else if (this.postStep === 'levels') this.renderLevelUp(body, run);
    else this.renderReward(body, run);
  }

  private renderResults(body: HTMLElement, run: RunState): void {
    const post = run.pending!;
    const t = this.ctl.tuning;
    body.append(el('h2', 'win', `Fight ${post.fight} won`), el('div', 'subtitle', `${run.won} ${run.won === 1 ? 'fight' : 'fights'} survived this run.`));
    if (post.lost.length) {
      const box = el('div', 'memorial');
      box.append(el('h3', '', 'Lost'));
      for (const f of post.lost) {
        const row = el('div', 'memorial-row');
        row.append(memberFigure(f.type, 'chip-figure lost'), el('div', '', `${f.line}`), el('small', '', `Level ${f.level}`));
        box.append(row);
      }
      body.append(box);
    }
    const xp = el('div', 'xp-list');
    xp.append(el('h3', '', 'Experience'));
    for (const g of post.xp) {
      const m = run.crew.find((x) => x.uid === g.uid);
      if (!m) continue;
      const row = el('div', 'xp-row');
      row.append(memberFigure(m.type, 'chip-figure'), el('span', 'xp-name', m.label), el('span', 'xp-gain', `+${g.gained} XP`));
      if (g.levelAfter > g.levelBefore) row.append(el('span', 'level-up', `Level ${g.levelBefore} → ${g.levelAfter}!`));
      row.append(levelBadge(m, t));
      xp.append(row);
    }
    body.append(xp);
    body.append(
      button('Continue', 'big-btn primary', () => {
        this.postStep = post.levelUps.length ? 'levels' : 'reward';
        this.render();
      }),
    );
  }

  private renderLevelUp(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const post = run.pending!;
    const up = post.levelUps[0];
    const m = run.crew.find((x) => x.uid === up.uid);
    if (!m) {
      queueMicrotask(() => ctl.chooseBonus(up.uid, up.offers[0]));
      return;
    }
    const left = post.levelUps.length;
    body.append(el('h2', '', `${m.label} reached level ${up.level}`), el('div', 'subtitle', `Pick one bonus.${left > 1 ? ` ${left - 1} more level-up${left > 2 ? 's' : ''} after this.` : ''}`));
    const head = el('div', 'card lee-mini');
    head.append(memberFigure(m.type), el('div', 'card-title', m.label), levelBadge(m, t));
    if (m.bonuses.length) head.append(el('div', 'card-sub', `So far: ${m.bonuses.map((b) => bonusLabel(b, t, STAT_LABELS)).join(', ')}`));
    body.append(head);
    const list = el('div', 'bonus-list');
    up.offers.forEach((b, i) => {
      const btn = button(bonusLabel(b, t, STAT_LABELS), `big-btn bonus${i === 0 ? ' suggested' : ''}`, () => ctl.chooseBonus(m.uid, b));
      if (i === 0) btn.append(el('small', '', 'Auto-pick'));
      list.append(btn);
    });
    body.append(list);
    const row = el('div', 'row');
    row.append(button('Auto-pick', 'hud-btn', () => ctl.chooseBonus(m.uid, up.offers[0])), button('Auto-pick all', 'hud-btn', () => ctl.autoPickAll()));
    body.append(row);
  }

  private renderReward(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const post = run.pending!;
    if (post.rewardTaken || !post.reward.length) {
      queueMicrotask(() => ctl.finishPost());
      return;
    }
    if (this.releaseFor !== null) {
      const card = post.reward[this.releaseFor];
      body.append(el('h2', '', 'Crew is full'), el('div', 'subtitle', `Release someone to make room for the ${card.kind === 'recruit' ? LEE_DEFS[card.type].name : 'recruit'}. Their trinkets go to cargo.`));
      const list = el('div', 'release-list');
      for (const m of run.crew) {
        const row = el('div', 'release-row');
        row.append(memberFigure(m.type, 'chip-figure'), el('span', '', m.label), levelBadge(m, t));
        row.append(
          button('Release', 'hud-btn danger', () => {
            if (!confirmAction(`Release ${m.label} for good?`)) return;
            const i = this.releaseFor!;
            this.releaseFor = null;
            ctl.takeReward(i, m.uid);
          }),
        );
        list.append(row);
      }
      body.append(list, button('Back', 'big-btn', () => {
        this.releaseFor = null;
        this.render();
      }));
      return;
    }
    body.append(el('h2', '', 'Pick a reward'), el('div', 'subtitle', 'One of three.'));
    const list = el('div', 'card-list');
    post.reward.forEach((card, i) => {
      if (card.kind === 'recruit') {
        const full = run.crew.length >= crewMax(run, t);
        const take = button(full ? `Recruit (release someone)` : `Recruit ${LEE_DEFS[card.type].name}`, 'big-btn primary', () => {
          if (full) {
            this.releaseFor = i;
            this.render();
          } else ctl.takeReward(i);
        });
        list.append(leeTypeCard(card.type, t, card.level, [el('div', 'card-sub', `Recruit · joins at level ${card.level}`), take]));
      } else {
        const def = ITEMS[card.item];
        if (!def) return;
        list.append(itemCard(def, [button(`Take the ${def.name}`, 'big-btn primary', () => ctl.takeReward(i))]));
      }
    });
    body.append(list);
  }

  // ------------------------------------------------------------ run over

  private renderOver(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    body.append(el('h2', 'lose', 'Run over'), el('div', 'subtitle', `${run.won} ${run.won === 1 ? 'fight' : 'fights'} survived in the ${SHIPS[run.ship].name}.`));
    const build = buildFor(run);
    body.append(shipPreview(SHIPS[run.ship], build.loadout, 280));
    const all = [...Object.values(build.loadout), ...(build.treasures ?? [])];
    body.append(loadoutIcons(all));
    const tags = countTags([SHIPS[run.ship].tags, ...all.map((i) => ITEMS[i]?.tags ?? []), ...run.crew.map((m) => LEE_DEFS[m.type]?.tags ?? [])]);
    if (Object.keys(tags).length) body.append(el('div', 'card-sub', `Tags: ${Object.entries(tags).map(([k, v]) => `${k} ${v}`).join(' · ')}`));
    const crew = el('div', 'xp-list');
    crew.append(el('h3', '', run.crew.length ? 'Survivors' : 'No survivors'));
    for (const m of run.crew) {
      const row = el('div', 'xp-row');
      row.append(memberFigure(m.type, 'chip-figure'), el('span', 'xp-name', m.label), levelBadge(m, t));
      const worn = m.trinkets.map((u) => itemOf(run, u)).filter(Boolean);
      for (const d of worn) row.append(itemIcon(d));
      crew.append(row);
    }
    body.append(crew);
    if (run.fallen.length) {
      const box = el('div', 'memorial');
      box.append(el('h3', '', 'In memory'));
      for (const f of run.fallen) {
        const row = el('div', 'memorial-row');
        row.append(memberFigure(f.type, 'chip-figure lost'), el('div', '', f.line), el('small', '', `Lv ${f.level} · fight ${f.fight}`));
        box.append(row);
      }
      body.append(box);
    }
    const row = el('div', 'menu-buttons');
    row.append(button('New Run', 'big-btn primary', () => ctl.restartRun()), button('Menu', 'big-btn', () => ctl.toMenu()));
    body.append(row);
  }
}
