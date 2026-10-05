// A top-down drawing of a ship on a plain canvas (bow right): its hull, deck
// tiles, typed slots (edge slots with a facing arrow) and what's equipped. The
// Choose Ship cards and the Run Over summary use it.

import { ITEMS } from '../config/items';
import type { ShipDef } from '../config/ships';
import { FACING_ANGLE } from '../config/slots';
import { buildGrid, tileAtCell } from '../sim/grid';
import { polygonBounds } from '../sim/math';

export function shipPreview(ship: ShipDef, loadout: Record<string, string>, cssWidth = 260): HTMLCanvasElement {
  const L = ship.layout;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of L.parts) {
    const b = polygonBounds(p.polygon);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  const pad = 3;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = cssWidth / (maxX - minX + pad * 2);
  const cssHeight = (maxY - minY + pad * 2) * scale;
  const c = document.createElement('canvas');
  c.width = Math.round(cssWidth * dpr);
  c.height = Math.round(cssHeight * dpr);
  c.style.width = `${cssWidth}px`;
  c.style.height = `${Math.round(cssHeight)}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const X = (x: number) => (x - minX + pad) * scale;
  const Y = (y: number) => (y - minY + pad) * scale;
  const colors: Record<string, string> = { bow: '#c99a62', midship: '#b9874f', stern: '#a8763f', cannon: '#8d6a48' };
  for (const p of L.parts) {
    ctx.beginPath();
    p.polygon.forEach((v, i) => (i ? ctx.lineTo(X(v.x), Y(v.y)) : ctx.moveTo(X(v.x), Y(v.y))));
    ctx.closePath();
    ctx.fillStyle = colors[p.art] ?? '#b9874f';
    ctx.fill();
    ctx.strokeStyle = '#2b1a0e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const grid = buildGrid(L);
  ctx.strokeStyle = 'rgba(43,26,14,0.35)';
  ctx.lineWidth = 1;
  for (const t of grid.tiles) ctx.strokeRect(X(t.x0) + 1, Y(t.y0) + 1, (t.x1 - t.x0) * scale - 2, (t.y1 - t.y0) * scale - 2);
  const size = Math.min(L.grid.tileW, L.grid.tileH) * scale;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of ship.slots) {
    if (!s.tile) continue;
    const t = tileAtCell(grid, s.tile[0], s.tile[1]);
    if (!t) continue;
    const cx = X(t.center.x);
    const cy = Y(t.center.y);
    if (s.type === 'rail') {
      const a = FACING_ANGLE[s.facing!];
      const ex = cx + Math.cos(a) * ((t.x1 - t.x0) / 2) * scale * 0.95;
      const ey = cy + Math.sin(a) * ((t.y1 - t.y0) / 2) * scale * 0.95;
      ctx.fillStyle = loadout[s.id] ? '#e8dcc0' : 'rgba(232,220,192,0.35)';
      ctx.beginPath();
      ctx.arc(ex, ey, size * 0.1, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const item = loadout[s.id];
    if (item && ITEMS[item]) {
      ctx.font = `${Math.round(size * 0.48)}px system-ui, sans-serif`;
      ctx.fillText(ITEMS[item].icon, cx, cy);
    } else {
      ctx.strokeStyle = 'rgba(16,35,58,0.7)';
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(cx - size * 0.22, cy - size * 0.22, size * 0.44, size * 0.44);
      ctx.setLineDash([]);
    }
    if (s.type === 'edge' && s.facing) {
      const a = FACING_ANGLE[s.facing];
      const r = size * 0.38;
      ctx.fillStyle = '#10233a';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a + 2.6) * r * 0.45 + Math.cos(a) * r * 0.55, cy + Math.sin(a + 2.6) * r * 0.45 + Math.sin(a) * r * 0.55);
      ctx.lineTo(cx + Math.cos(a - 2.6) * r * 0.45 + Math.cos(a) * r * 0.55, cy + Math.sin(a - 2.6) * r * 0.45 + Math.sin(a) * r * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
  return c;
}
