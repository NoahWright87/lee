// Debug overlay for the crew AI: for every Lee on a boat, its task, target and
// the one-line reason it chose it, plus its best few scored options; and the
// boat's current needs with their scores. Tap the header to cycle boats
// (yours, then each enemy). Answers "why did that Lee go there?".

import type { Controller } from '../game/Controller';
import { activity } from '../sim/crew';

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
    const name = boat.side === 'player' ? 'Your crew' : `Enemy ${w.enemies.indexOf(boat) + 1} crew`;
    const alive = boat.crew.lees.filter((l) => l.alive).length;
    this.head.textContent = `${name} (${alive}/${boat.crew.lees.length}) ▸`;

    const rows: HTMLElement[] = [];
    for (const lee of boat.crew.lees) {
      const r = el('div', `cd-lee${lee.alive ? '' : ' lost'}`);
      const home = boat.grid.tiles[lee.home].label;
      r.append(el('div', 'cd-line', `#${lee.number} ${lee.alive ? activity(lee, boat) : 'LOST'} · ${Math.round(lee.score)} · hp ${Math.round(lee.hp)} · home ${home}`));
      r.append(el('div', 'cd-why', lee.reason));
      if (lee.alive && lee.options.length) r.append(el('div', 'cd-opts', lee.options.map((o) => `${o.label} ${o.score}`).join(' · ')));
      rows.push(r);
    }
    const needs = el('div', 'cd-needs');
    needs.append(el('div', 'cd-line', 'Needs (base score · tier)'));
    for (const n of [...boat.crew.needs].sort((a, b) => b.base - a.base)) {
      needs.append(el('div', 'cd-need', `${Math.round(n.base)} ${n.label} · ${n.cannon ? 'per Lee' : n.tier} · ${n.why}`));
    }
    rows.push(needs);
    this.body.replaceChildren(...rows);
  }
}
