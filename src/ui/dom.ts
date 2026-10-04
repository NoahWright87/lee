// Small DOM helpers shared by the HUD, the refit screen and the run screens.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

/** A confirm step for destructive actions (native, so it works the same everywhere). */
export function confirmAction(text: string): boolean {
  try {
    return window.confirm(text);
  } catch {
    return false;
  }
}

export const pct = (f: number): string => `${Math.round(f * 100)}%`;

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}
