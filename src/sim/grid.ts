// The deck grid: tiles laid over a boat's parts, and walking distances between
// them. Built from boat data (BoatLayout.grid), so a different boat is a
// different grid, not different code. Tiles are units with layers: a floor
// upgrade under a fixture (a gun or station), a rail item on the edge, any
// Lees standing there, and a durability. What sits on them comes from the
// ship's loadout (sim/loadout.ts).

import type { BoatLayout } from '../config/boats';
import type { RailKind, StationKind } from '../config/items';
import type { Facing } from '../config/slots';
import { dist, type Vec } from './math';

/**
 * Something sitting on a tile alongside the deck and any Lee (fire, smoke...).
 * Nothing creates layers yet; tiles carry the stack so later conditions are additions.
 */
export interface TileLayer {
  kind: string;
  amount: number;
}

/** A gun or station fixed to a tile (from an edge or interior slot). */
export interface Fixture {
  slot: string;
  item: string;
  /** Destroyed for the rest of the fight (its tile blew out). */
  destroyed: boolean;
}

/** A rail item on one edge segment of a tile. */
export interface RailState {
  slot: string;
  item: string;
  kind: RailKind;
  facing: Facing;
  /** Fences: HP left (others: unused). */
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface Tile {
  index: number;
  col: number;
  row: number;
  /** Index of the part this tile belongs to. */
  part: number;
  /** What working this tile does (from its fixture), or null for plain deck. */
  station: StationKind | null;
  fixture: Fixture | null;
  rails: RailState[];
  /** Floor upgrade item id, or null. */
  floor: string | null;
  /** Sides of the boat this tile is on (no tile beyond it that way). */
  edges: Facing[];
  hp: number;
  maxHp: number;
  /** Blown out: its fixture is destroyed; still walkable. */
  blown: boolean;
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

export function buildGrid(layout: BoatLayout): Grid {
  const g = layout.grid;
  const tiles: Tile[] = [];
  const at = new Map<string, number>();
  const cells = (rows: string[], r: number) => (rows[r] ?? '').trim().split(/\s+/);

  for (let row = 0; row < g.rows; row++) {
    const partCells = cells(g.parts, row);
    for (let col = 0; col < g.cols; col++) {
      const partId = partCells[col] ?? '-';
      if (partId === '-') continue;
      const part = layout.parts.findIndex((p) => p.id === partId);
      if (part < 0) throw new Error(`grid tile ${col},${row}: unknown part "${partId}"`);
      const x0 = g.origin.x + col * g.tileW;
      const y0 = g.origin.y + row * g.tileH;
      at.set(`${col},${row}`, tiles.length);
      tiles.push({
        index: tiles.length,
        col,
        row,
        part,
        station: null,
        fixture: null,
        rails: [],
        floor: null,
        edges: [],
        hp: 1,
        maxHp: 1,
        blown: false,
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

  const dirs: [number, number, Facing][] = [[0, -1, 'port'], [1, 0, 'bow'], [0, 1, 'starboard'], [-1, 0, 'stern']];
  for (const t of tiles) {
    for (const [dc, dr, facing] of dirs) {
      const n = at.get(`${t.col + dc},${t.row + dr}`);
      if (n !== undefined) t.neighbors.push(n);
      else t.edges.push(facing);
    }
  }

  labelTiles(layout, tiles);

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

/** Name every tile for what's on it: "Port cannon 2", "Sails", "Midship deck". Call again after a loadout changes. */
export function labelTiles(layout: BoatLayout, tiles: Tile[], name: (item: string) => string = (i) => i): void {
  const sideName = (t: Tile) => {
    const b = layout.parts[t.part].broadside;
    if (t.edges.includes('port')) return 'Port';
    if (t.edges.includes('starboard')) return 'Starboard';
    if (t.edges.includes('bow')) return 'Bow';
    if (t.edges.includes('stern')) return 'Stern';
    return b ? (b < 0 ? 'Port' : 'Starboard') : '';
  };
  const count: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const key = (t: Tile) => `${sideName(t)}|${t.fixture?.item ?? ''}`;
  for (const t of tiles) if (t.fixture) totals[key(t)] = (totals[key(t)] ?? 0) + 1;
  // Number repeated fixtures stern → bow on each side.
  const order = [...tiles].sort((a, b) => a.col - b.col || a.row - b.row);
  for (const t of order) {
    if (!t.fixture) {
      t.label = `${layout.parts[t.part].label} deck`;
      continue;
    }
    const side = t.station === 'gun' || t.station === 'oars' ? sideName(t) : '';
    const k = key(t);
    count[k] = (count[k] ?? 0) + 1;
    const n = totals[k] > 1 && side ? ` ${count[k]}` : '';
    const what = name(t.fixture.item);
    t.label = side ? `${side} ${what.charAt(0).toLowerCase()}${what.slice(1)}${n}` : what;
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
