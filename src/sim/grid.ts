// The deck grid: tiles laid over a boat's parts, the stations on them, and
// walking distances between them. Built from boat data (BoatLayout.grid), so
// a different boat is a different grid, not different code.

import type { BoatLayout, StationKind } from '../config/boats';
import { dist, type Vec } from './math';

/**
 * Something sitting on a tile alongside the deck and any Lee (fire, smoke...).
 * Nothing creates layers yet; tiles carry the stack so later conditions are additions.
 */
export interface TileLayer {
  kind: string;
  amount: number;
}

export interface Tile {
  index: number;
  col: number;
  row: number;
  /** Index of the part this tile belongs to. */
  part: number;
  station: StationKind | null;
  /** Human name of what the tile is: "Port cannon 2", "Sails", "Midship deck". */
  label: string;
  center: Vec;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Orthogonal neighbors (tile indices). */
  neighbors: number[];
  layers: TileLayer[];
}

export interface Grid {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  tiles: Tile[];
  /** dist[a][b]: walking distance between tile centers, m (Infinity if unreachable). */
  dist: number[][];
  /** next[a][b]: first tile to step to from a toward b (-1 if none). */
  next: number[][];
}

const STATION_CODES: Record<string, StationKind | null> = { C: 'cannon', G: 'gatling', O: 'oars', S: 'sails', L: 'lookout', '.': null };

export function buildGrid(layout: BoatLayout): Grid {
  const g = layout.grid;
  const tiles: Tile[] = [];
  const at = new Map<string, number>();
  const cells = (rows: string[], r: number) => (rows[r] ?? '').trim().split(/\s+/);

  for (let row = 0; row < g.rows; row++) {
    const partCells = cells(g.parts, row);
    const stationCells = cells(g.stations, row);
    for (let col = 0; col < g.cols; col++) {
      const partId = partCells[col] ?? '-';
      if (partId === '-') continue;
      const part = layout.parts.findIndex((p) => p.id === partId);
      if (part < 0) throw new Error(`grid tile ${col},${row}: unknown part "${partId}"`);
      const code = stationCells[col] ?? '.';
      if (!(code in STATION_CODES)) throw new Error(`grid tile ${col},${row}: unknown station "${code}"`);
      const x0 = g.origin.x + col * g.tileW;
      const y0 = g.origin.y + row * g.tileH;
      at.set(`${col},${row}`, tiles.length);
      tiles.push({
        index: tiles.length,
        col,
        row,
        part,
        station: STATION_CODES[code],
        label: '',
        center: { x: x0 + g.tileW / 2, y: y0 + g.tileH / 2 },
        x0,
        y0,
        x1: x0 + g.tileW,
        y1: y0 + g.tileH,
        neighbors: [],
        layers: [],
      });
    }
  }

  for (const t of tiles) {
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const n = at.get(`${t.col + dc},${t.row + dr}`);
      if (n !== undefined) t.neighbors.push(n);
    }
  }

  labelTiles(layout, tiles, g.rows);

  // All-pairs walking distances (Floyd–Warshall; grids are tiny).
  const n = tiles.length;
  const d = tiles.map((a) => tiles.map((b) => (a === b ? 0 : Infinity)));
  const next = tiles.map((a) => tiles.map((b) => (a === b ? a.index : -1)));
  for (const a of tiles) {
    for (const b of a.neighbors) {
      d[a.index][b] = dist(a.center, tiles[b].center);
      next[a.index][b] = b;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Strictly shorter only, so ties keep the first-found route (deterministic).
        if (d[i][k] + d[k][j] < d[i][j] - 1e-9) {
          d[i][j] = d[i][k] + d[k][j];
          next[i][j] = next[i][k];
        }
      }
    }
  }
  return { cols: g.cols, rows: g.rows, tileW: g.tileW, tileH: g.tileH, tiles, dist: d, next };
}

function labelTiles(layout: BoatLayout, tiles: Tile[], rows: number): void {
  const sideName = (t: Tile) => {
    const b = layout.parts[t.part].broadside;
    if (b) return b < 0 ? 'Port' : 'Starboard';
    if (t.row === 0) return 'Port';
    if (t.row === rows - 1) return 'Starboard';
    return '';
  };
  const cannonCount: Record<string, number> = {};
  // Number cannons stern → bow on each side.
  const order = [...tiles].sort((a, b) => a.col - b.col || a.row - b.row);
  for (const t of order) {
    const side = sideName(t);
    switch (t.station) {
      case 'cannon': {
        cannonCount[side] = (cannonCount[side] ?? 0) + 1;
        t.label = `${side} cannon ${cannonCount[side]}`.trim();
        break;
      }
      case 'gatling':
        t.label = side ? `${side} gatling` : 'Gatling';
        break;
      case 'oars':
        t.label = side ? `${side} oars` : 'Oars';
        break;
      case 'sails':
        t.label = 'Sails';
        break;
      case 'lookout':
        t.label = 'Lookout';
        break;
      default:
        t.label = `${layout.parts[t.part].label} deck`;
    }
  }
}

/** Tile indices to walk through from `from` to `to` (excluding `from`, including `to`). */
export function pathTo(grid: Grid, from: number, to: number): number[] {
  const out: number[] = [];
  let at = from;
  for (let guard = 0; at !== to && guard < grid.tiles.length; guard++) {
    at = grid.next[at][to];
    if (at < 0) return [];
    out.push(at);
  }
  return out;
}

/** The tile containing a local point, or the nearest tile within `slack` meters of its edge. */
export function tileAt(grid: Grid, p: Vec, slack = 0): Tile | null {
  let best: Tile | null = null;
  let bestD = Infinity;
  for (const t of grid.tiles) {
    const dx = Math.max(t.x0 - p.x, 0, p.x - t.x1);
    const dy = Math.max(t.y0 - p.y, 0, p.y - t.y1);
    const d = Math.hypot(dx, dy);
    if (d === 0) return t;
    if (d <= slack && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Tile at grid coordinates. */
export function tileAtCell(grid: Grid, col: number, row: number): Tile | null {
  return grid.tiles.find((t) => t.col === col && t.row === row) ?? null;
}
