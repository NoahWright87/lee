// Debug overlay for the crew AI: for every Lee on a boat, its task, target and
// the one-line reason it chose it, plus its best few scored options; and the
// boat's current needs with their scores. Tap the header to cycle boats
// (yours, then each enemy). Answers "why did that Lee go there?".

import { ITEMS } from '../config/items';
import { LEE_DEFS, LEE_STAT_KEYS, STAT_LABELS } from '../config/lees';
import { countTags, tagName } from '../config/tags';
import type { Controller } from '../game/Controller';
import { activity, boatLabel, leeStat } from '../sim/crew';
import { buildTags } from '../sim/loadout';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class CrewDebug {
  readonly root: HTMLDivElement;
  private head: HTMLButtonElement;
  private body: HTMLDivElement;
  private ctl: Controller;
  private boatIndex = 0;
  private nextAt = 0;

  constructor(ctl: Controller) {
    this.ctl = ctl;
    this.root = el('div', 'crew-debug hidden');
    this.head = el('button', 'crew-debug-head');
    this.head.onclick = () => {
      this.boatIndex = (this.boatIndex + 1) % Math.max(1, this.ctl.world.boats.length);
      this.nextAt = 0;
    };
    this.body = el('div', 'crew-debug-body');
    this.root.append(this.head, this.body);
  }

  frame(): void {
    const on = this.ctl.debug;
    this.root.classList.toggle('hidden', !on);
    if (!on) return;
    const now = performance.now();
    if (now < this.nextAt) return;
    this.nextAt = now + 200;
    const w = this.ctl.world;
    if (this.boatIndex >= w.boats.length) this.boatIndex = 0;
    const boat = w.boats[this.boatIndex];
    const name = boat.side === 'player' ? 'Your crew' : `${boatLabel(boat)} crew`;
    const alive = boat.crew.lees.filter((l) => l.alive).length;
    const mode = boat.side === 'player' ? w.helm.kind : w.brains.get(boat.id)?.mode ?? '';
    this.head.textContent = `${name} (${alive}/${boat.crew.lees.length})${mode ? ` · ${mode}` : ''} ▸`;

    const rows: HTMLElement[] = [];
    // Tags across the boat and its crew, and its loadout (enemies too: everything is explainable).
    const tags = countTags([...buildTags(boat.build), ...boat.crew.lees.map((l) => LEE_DEFS[l.def.id]?.tags ?? [])]);
    rows.push(el('div', 'cd-need', `Tags: ${Object.entries(tags).map(([k, v]) => `${tagName(k)} ${v}`).join(' · ') || 'none'}`));
    const items = [...Object.values(boat.build.loadout), ...(boat.build.treasures ?? [])].map((i) => ITEMS[i]?.name ?? i);
    rows.push(el('div', 'cd-need', `${boat.ship.name}: ${items.join(', ') || 'nothing equipped'}`));
    // Close combat, and ram X's in progress.
    const links = w.contacts.contactsOf(boat).map((c) => `close combat ↔ ${boatLabel(w.contacts.other(c, boat))} (gap ${c.gap.toFixed(1)} m)`);
    for (const x of w.contacts.warnings) {
      if (x.actorId !== boat.id && x.targetId !== boat.id) continue;
      links.push(`ram X ${Math.round(x.progress * 100)}% (shown ${x.shownFor.toFixed(1)}s)`);
    }
    if (links.length) rows.push(el('div', 'cd-need', `Contact: ${links.join(' · ')}`));
    for (const lee of boat.crew.lees) {
      const r = el('div', `cd-lee${lee.alive ? '' : ' lost'}`);
      const home = boat.grid.tiles[lee.home].label;
      const where = lee.swing ? ` · swinging to ${boatLabel(lee.swing.to)}` : lee.deck !== boat ? ` · on ${boatLabel(lee.deck)}` : '';
      const fight = lee.engaged && lee.meleeTarget !== null ? ` · vs ${w.findLee(lee.meleeTarget)?.lee.side === 'player' ? '' : 'enemy '}#${w.findLee(lee.meleeTarget)?.lee.number ?? '?'}` : '';
      r.append(el('div', 'cd-line', `#${lee.number} ${lee.alive ? activity(lee, boat) : `LOST (${lee.lostCause})`} · ${Math.round(lee.score)} · ${lee.job.toUpperCase()} · hp ${Math.round(lee.hp)} · started ${home}${where}${fight}`));
      r.append(el('div', 'cd-why', lee.reason));
      if (lee.alive) {
        // Stats after every modifier (type, levels, trinkets, treasures, traits, the tile), where they differ from 1.
        const mods = LEE_STAT_KEYS.map((k) => [k, leeStat(lee, k, boat, w.tuning)] as const).filter(([, v]) => Math.abs(v - 1) > 0.005);
        if (mods.length) r.append(el('div', 'cd-opts', `${lee.label} lv ${lee.level}: ${mods.map(([k, v]) => `${STAT_LABELS[k]} ×${v.toFixed(2)}`).join(' · ')}`));
      }
      if (lee.alive && (lee.deck !== boat || lee.swing) && lee.whyBoarded) r.append(el('div', 'cd-opts', `went over because: ${lee.whyBoarded}`));
      if (lee.alive && lee.options.length) r.append(el('div', 'cd-opts', lee.options.map((o) => `${o.label} ${o.score}`).join(' · ')));
      rows.push(r);
    }
    const needs = el('div', 'cd-needs');
    needs.append(el('div', 'cd-line', 'Needs (base score · tier)'));
    for (const n of [...boat.crew.needs].sort((a, b) => b.base - a.base)) {
      needs.append(el('div', 'cd-need', `${Math.round(n.base)} ${n.label} · ${n.job} · ${n.cannon ? 'per Lee' : n.tier} · ${n.why}`));
    }
    rows.push(needs);
    this.body.replaceChildren(...rows);
  }
}
