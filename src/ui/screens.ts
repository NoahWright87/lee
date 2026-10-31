// Full-screen run screens over the canvas: the menu, choosing a ship and a
// difficulty (each preset ship comes crewed and fitted; Custom starts with
// nothing), after a fight or an event (results → level-ups → capture picks → surrender → a
// pick), and Run Over. Plus the ⚙️ system menu (on every screen) and the
// message for a saved run that can't be continued. The port and the sea map
// have their own screens (port.ts, seaMap.ts).

import { ITEMS } from '../config/items';
import { LEE_DEFS, STAT_LABELS } from '../config/lees';
import { NESS } from '../config/ness';
import { SHIP_ORDER, SHIPS } from '../config/ships';
import { countTags, tagName } from '../config/tags';
import { DECK_ZOOMS, OCEAN_ZOOMS, type Controller, type ZoomChoice, type ZoomKind } from '../game/Controller';
import { bonusLabel } from '../sim/levels';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../config/difficulty';
import { STOP_TYPES } from '../config/sea';
import { buildFor, cargo, cargoLimit, crewMax, hullShare, itemOf, SAVE_VERSION, type RunState } from '../sim/run';
import { depthNow } from '../sim/seaMap';
import { itemIcon, itemLine, jobBars, levelBadge, loadoutIcons, memberFigure } from './cards';
import { button, confirmAction, el } from './dom';
import { shipPreview } from './shipPreview';

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

type PostStep = 'results' | 'levels' | 'capture' | 'surrender' | 'reward';

export class Screens {
  readonly root: HTMLDivElement;
  readonly gear: HTMLButtonElement;
  private menu: HTMLDivElement;
  private ctl: Controller;
  private sig = '';
  private postStep: PostStep = 'results';
  private postFor = -1;
  /** Picking someone to release for a recruit (reward card index, or -1 for a surrender), or null. */
  private releaseFor: number | null = null;
  /** Difficulty picked on the ship screen. */
  private diff = 'normal';
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
    // How close each view is. "Normal" is the original framing.
    const view = el('div', 'zoom-picks');
    const pick = (kind: ZoomKind, title: string, list: ZoomChoice[]) => {
      const row = el('div', 'zoom-row');
      row.append(el('span', 'zoom-title', title));
      const group = el('div', 'zoom-group');
      for (const z of list) {
        const b = button(z.label, `hud-btn zoom-btn${this.ctl.zoom[kind] === z.id ? ' on' : ''}`, () => {
          this.ctl.setZoom(kind, z.id);
          for (const sib of group.querySelectorAll('.zoom-btn')) sib.classList.toggle('on', sib === b);
        });
        group.append(b);
      }
      row.append(group);
      view.append(row);
    };
    pick('ocean', 'Ocean view (top)', OCEAN_ZOOMS);
    pick('deck', 'Deck view (bottom)', DECK_ZOOMS);
    buttons.append(view);
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
    const full = ['menu', 'chooseShip', 'post', 'over'].includes(ctl.screen);
    this.root.classList.toggle('hidden', !full);
    if (!full) {
      this.sig = '';
      return;
    }
    if (ctl.screen === 'post' && run?.pending && this.postFor !== run.pending.id) {
      this.postFor = run.pending.id;
      this.postStep = 'results';
      this.releaseFor = null;
    }
    const sig = JSON.stringify([ctl.screen, run && JSON.stringify(run), this.postStep, this.releaseFor, this.diff, ctl.canContinue(), this.saveErrorDismissed, ctl.saved.ok]);
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
    body.append(el('h1', 'title', 'Lee'), el('div', 'subtitle', 'Choose a ship, crew it with Lees, and see how far you get.'));
    const buttons = el('div', 'menu-buttons');
    buttons.append(button('New Run', 'big-btn primary', () => ctl.newRun()));
    if (ctl.canContinue() && ctl.saved.ok) {
      const r = ctl.saved.run;
      const b = button('Continue', 'big-btn', () => ctl.continueRun());
      const where = r.stage === 'port' ? `in ${r.port?.name ?? 'port'}` : `journey ${r.journey + 1}`;
      b.append(el('small', '', `${r.noHull ? 'No ship yet' : SHIPS[r.ship]?.name ?? r.ship} · ${where} · 🪙 ${r.gold}`));
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
    body.append(el('h2', '', 'Choose a ship'), el('div', 'subtitle', 'Each comes crewed and fitted. You start in port.'));
    // Difficulty: one row of three.
    const diffs = el('div', 'row seg center');
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      const b = button(d.name, `hud-btn${this.diff === id ? ' on' : ''}`, () => {
        this.diff = id;
        this.render();
      });
      b.title = d.blurb;
      diffs.append(b);
    }
    body.append(diffs, el('div', 'card-sub center', DIFFICULTIES[this.diff].blurb));
    const list = el('div', 'card-list');
    const gold = Math.round(t.economy.startGold * DIFFICULTIES[this.diff].gold);
    for (const id of SHIP_ORDER) {
      const ship = SHIPS[id];
      // The whole card is the button.
      const card = button('', 'card ship-card pick', () => ctl.chooseShip(id, this.diff));
      card.setAttribute('aria-label', `Sail the ${ship.name}`);
      const head = el('div', 'card-row');
      head.append(el('div', 'card-title', ship.name), el('div', 'card-sub', `${ship.style} · 🪙 ${gold} · hold ${Math.round(t.ships[id]?.cargo ?? 6)}`));
      card.append(head, shipPreview(ship, ship.preset.loadout, 220, ship.preset.facings), el('div', 'card-text', ship.blurb));
      // The crew and parts it comes with, as pictures.
      const row = el('div', 'ship-kit');
      for (const c of ship.preset.crew) row.append(memberFigure(c.type, 'chip-figure'));
      row.append(loadoutIcons([...Object.values(ship.preset.loadout), ...(ship.preset.treasures ?? [])]));
      card.append(row);
      list.append(card);
    }
    // Custom: nothing but a big purse in a port that has everything.
    const custom = button('', 'card ship-card pick custom', () => ctl.customStart(this.diff));
    const head = el('div', 'card-row');
    head.append(el('div', 'card-title', 'Custom'), el('div', 'card-sub', `No ship · 🪙 ${Math.round(t.economy.customGold * DIFFICULTIES[this.diff].gold)}`));
    custom.append(head, el('div', 'card-text', 'Start in a port with every service and a wide stock. Buy a hull, hire a crew, fit it out, then sail.'));
    list.append(custom);
    body.append(list);
  }

  // ------------------------------------------------------------ after a fight

  private renderPost(body: HTMLElement, run: RunState): void {
    const post = run.pending;
    if (!post) {
      body.append(button('Back to the map', 'big-btn primary', () => this.ctl.finishPost()));
      return;
    }
    if (this.postStep === 'levels' && !post.levelUps.length) this.postStep = 'capture';
    if (this.postStep === 'capture' && !this.openCapture(post)) this.postStep = 'surrender';
    if (this.postStep === 'surrender' && (!post.surrender || post.surrenderDone)) this.postStep = 'reward';
    if (this.postStep === 'results') this.renderResults(body, run);
    else if (this.postStep === 'levels') this.renderLevelUp(body, run);
    else if (this.postStep === 'capture') this.renderCapture(body, run);
    else if (this.postStep === 'surrender') this.renderSurrender(body, run);
    else this.renderReward(body, run);
  }

  private nextStep(run: RunState): void {
    const post = run.pending!;
    this.postStep = post.levelUps.length ? 'levels' : this.openCapture(post) ? 'capture' : post.surrender && !post.surrenderDone ? 'surrender' : 'reward';
    this.render();
  }

  /** The first captured ship with a pick still to make, or -1. */
  private openCapture(post: NonNullable<RunState['pending']>): number | false {
    const i = post.captures.findIndex((c) => c.taken.length < c.picks);
    return i >= 0 ? i : false;
  }

  /** A clean capture: your pick of the parts left working on the ship you took. */
  private renderCapture(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const post = run.pending!;
    const i = post.captures.findIndex((c) => c.taken.length < c.picks);
    if (i < 0) {
      queueMicrotask(() => this.nextStep(run));
      return;
    }
    const c = post.captures[i];
    const left = c.picks - c.taken.length;
    body.append(el('h2', '', `Captured: ${SHIPS[c.ship]?.name ?? c.ship}`), el('div', 'subtitle', `Pick ${left === 1 ? 'a part' : `${left} parts`} still working on her. The rest goes with the wreck.`));
    const list = el('div', 'bonus-list');
    for (const id of c.options) {
      const d = ITEMS[id];
      if (!d) continue;
      const btn = button('', 'big-btn bonus', () => ctl.pickCapture(i, id));
      btn.append(itemIcon(d), el('span', '', ` ${d.name}`));
      list.append(btn);
    }
    body.append(list, button('Leave them', 'big-btn', () => ctl.skipCapture(i)));
  }

  private renderResults(body: HTMLElement, run: RunState): void {
    const post = run.pending!;
    const t = this.ctl.tuning;
    const ev = post.event;
    if (ev) {
      const def = STOP_TYPES[ev.type];
      body.append(el('h2', '', `${def?.icon ?? ''} ${def?.name ?? 'At sea'}`), el('div', 'subtitle', ev.text));
    } else body.append(el('h2', 'win', `Fight ${post.fight} won`), el('div', 'subtitle', `${run.won} ${run.won === 1 ? 'fight' : 'fights'} won this run.`));
    // What it paid.
    const pay = el('div', 'spoils');
    if (post.gold) pay.append(el('div', 'spoil gold', `🪙 +${post.gold} gold`));
    for (const o of post.outcomes) pay.append(el('div', 'spoil', `${SHIPS[o.ship]?.name ?? o.ship}: ${o.how === 'sunk' ? 'sunk (its parts went down with it)' : 'captured'}`));
    for (const n of post.slain ?? []) pay.append(el('div', 'spoil', `${NESS[n.kind]?.name ?? n.kind}${n.level > 1 ? ` (Lv ${n.level})` : ''}: slain${n.trophy ? ` · trophy: ${ITEMS[n.trophy]?.name ?? n.trophy}` : ''}`));
    for (const id of post.spoils) {
      const d = ITEMS[id];
      if (!d) continue;
      const row = el('div', 'spoil');
      row.append(itemIcon(d), el('span', '', `Taken: ${d.name}`));
      pay.append(row);
    }
    // The free fixing line after fights (and at a Cove, where it's the point); not after every event.
    if ((post.repaired > 0 || post.healed > 0) && (!ev || ev.type === 'cove'))
      pay.append(el('div', 'spoil fix', `Free fixing: hull ${Math.round(hullShare(run, t) * 100)}% · Lees healed ${Math.round(post.healed * 100)}% of their wounds`));
    if (pay.childElementCount) body.append(pay);
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
    if (post.xp.length) {
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
    }
    body.append(button('Continue', 'big-btn primary', () => this.nextStep(run)));
  }

  /** The last enemy Lee standing offers to join. */
  private renderSurrender(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    const s = run.pending!.surrender!;
    const def = LEE_DEFS[s.type] ?? LEE_DEFS.basic;
    if (this.releaseFor === -1) {
      this.renderRelease(body, run, `Release someone to make room for the ${def.name}.`, (uid) => ctl.answerSurrender(true, uid));
      return;
    }
    body.append(el('h2', '', 'Surrender!'), el('div', 'subtitle', `The last of their crew throws down his sword and asks to join yours.`));
    const card = el('div', 'card');
    const head = el('div', 'card-row');
    const names = el('div', 'card-names');
    names.append(el('div', 'card-title', `${def.name}${s.level > 1 ? ` · Lv ${s.level}` : ''}`), el('div', 'card-text', `${def.role} · joins wounded, ashore`));
    head.append(memberFigure(s.type), names);
    card.append(head, jobBars(s.type, t));
    body.append(card);
    const full = run.crew.length >= crewMax(run, t);
    const row = el('div', 'menu-buttons');
    row.append(
      button(full ? 'Take him (crew full: release someone)' : 'Take him', 'big-btn primary', () => {
        if (full) {
          this.releaseFor = -1;
          this.render();
        } else ctl.answerSurrender(true);
      }),
      button('Send him off', 'big-btn', () => ctl.answerSurrender(false)),
    );
    body.append(row);
  }

  /** Pick a Lee to release (crew full). */
  private renderRelease(body: HTMLElement, run: RunState, why: string, then: (uid: number) => void): void {
    const t = this.ctl.tuning;
    body.append(el('h2', '', 'Crew is full'), el('div', 'subtitle', `${why} Their trinkets go to cargo.`));
    const list = el('div', 'release-list');
    for (const m of run.crew) {
      const row = el('div', 'release-row');
      row.append(memberFigure(m.type, 'chip-figure'), el('span', '', m.label), levelBadge(m, t));
      row.append(
        button('Release', 'hud-btn danger', () => {
          if (!confirmAction(`Release ${m.label} for good?`)) return;
          this.releaseFor = null;
          then(m.uid);
        }),
      );
      list.append(row);
    }
    body.append(
      list,
      button('Back', 'big-btn', () => {
        this.releaseFor = null;
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
    body.append(el('h2', '', `${m.label}: level ${up.level}`), el('div', 'subtitle', `Pick one bonus.${left > 1 ? ` ${left - 1} more level-up${left > 2 ? 's' : ''} after this.` : ''}`));
    const head = el('div', 'card-row');
    head.append(memberFigure(m.type, 'chip-figure'), el('div', 'card-sub', m.bonuses.length ? `So far: ${m.bonuses.map((b) => bonusLabel(b, t, STAT_LABELS)).join(', ')}` : LEE_DEFS[m.type]?.role ?? ''));
    body.append(head);
    const list = el('div', 'bonus-list');
    up.offers.forEach((b, i) => {
      const btn = button(bonusLabel(b, t, STAT_LABELS), `big-btn bonus${i === 0 ? ' suggested' : ''}`, () => ctl.chooseBonus(m.uid, b));
      if (i === 0) btn.append(el('small', '', 'Auto-pick'));
      list.append(btn);
    });
    body.append(list);
    const row = el('div', 'row');
    if (left > 1) row.append(button('Auto-pick all', 'hud-btn', () => ctl.autoPickAll()));
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
    if (this.releaseFor !== null && this.releaseFor >= 0) {
      const card = post.reward[this.releaseFor];
      const i = this.releaseFor;
      this.renderRelease(body, run, `Release someone to make room for the ${card.kind === 'recruit' ? LEE_DEFS[card.type].name : 'recruit'}.`, (uid) => ctl.takeReward(i, uid));
      return;
    }
    const kind = post.event?.type;
    const title = kind === 'wreck' ? 'Take one' : kind === 'castaway' ? 'A castaway' : 'A rare find';
    const sub = kind === 'castaway' ? 'Take him aboard (he waits ashore until placed).' : `It goes into your hold (${cargo(run).length}/${cargoLimit(run, t)}).`;
    body.append(el('h2', '', title), el('div', 'subtitle', sub));
    const list = el('div', 'card-list');
    post.reward.forEach((card, i) => {
      if (card.kind === 'recruit') {
        const full = run.crew.length >= crewMax(run, t);
        const def = LEE_DEFS[card.type];
        const b = button('', 'card reward-card pick', () => {
          if (full) {
            this.releaseFor = i;
            this.render();
          } else ctl.takeReward(i);
        });
        const names = el('div', 'card-names');
        names.append(el('div', 'card-title', `${def.name}${card.level > 1 ? ` · Lv ${card.level}` : ''}`), el('div', 'card-text', `Recruit · ${def.role}${full ? ' · crew full: release someone' : ''}`));
        if (def.trait) names.append(el('div', 'card-sub', `${def.trait.name}: ${def.trait.text}`));
        const head = el('div', 'card-row');
        head.append(memberFigure(card.type), names);
        b.append(head, jobBars(card.type, t));
        list.append(b);
      } else {
        const def = ITEMS[card.item];
        if (!def) return;
        const b = button('', 'card reward-card pick', () => ctl.takeReward(i));
        b.append(itemLine(def));
        list.append(b);
      }
    });
    body.append(list, button(kind === 'castaway' ? 'Leave him' : 'Take nothing', 'big-btn', () => ctl.skipReward()));
  }

  // ------------------------------------------------------------ run over

  private renderOver(body: HTMLElement, run: RunState): void {
    const ctl = this.ctl;
    const t = ctl.tuning;
    body.append(el('h2', 'lose', 'Run over'), el('div', 'subtitle', `${run.won} ${run.won === 1 ? 'fight' : 'fights'} won in the ${SHIPS[run.ship].name}.`));
    const tot = run.totals;
    const stats = el('div', 'run-stats');
    for (const [k, v] of [
      ['Depth', depthNow(run).toFixed(1)],
      ['Ports visited', String(tot.ports)],
      ['Gold earned', `🪙 ${tot.goldEarned}`],
      ['Fights won', String(run.won)],
      ['Sunk · captured', `${tot.sunk} · ${tot.captured}`],
    ]) {
      const row = el('div', 'sc-row');
      row.append(el('span', 'sc-k', k), el('span', 'sc-v', v));
      stats.append(row);
    }
    body.append(stats);
    const build = buildFor(run);
    body.append(shipPreview(SHIPS[run.ship], build.loadout, 280, build.facings));
    const all = [...Object.values(build.loadout), ...(build.treasures ?? [])];
    body.append(loadoutIcons(all));
    const tags = countTags([SHIPS[run.ship].tags, ...all.map((i) => ITEMS[i]?.tags ?? []), ...run.crew.map((m) => LEE_DEFS[m.type]?.tags ?? [])]);
    if (Object.keys(tags).length) body.append(el('div', 'card-sub', `Tags: ${Object.entries(tags).map(([k, v]) => `${tagName(k)} ${v}`).join(' · ')}`));
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
