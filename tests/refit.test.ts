// Phase 5 refit: every tile is a stack (Lee → station → floor inside; rail →
// hull module outside), one gesture moves anything, lower layers carry what's
// above them, same-layer things swap back or go to cargo, gun attachments ride
// with their gun, and corner guns turn to either side.

import { describe, expect, test } from 'vitest';
import { SHIPS } from '../src/config/ships';
import { defaultTuning } from '../src/config/tuning';
import { createBoat } from '../src/sim/boat';
import { gunFacing, slotById } from '../src/sim/loadout';
import { addCrew, addItem, ashore, buildFor, cargo, newRun, whereIs, wearTrinket } from '../src/sim/run';
import { applyMove, destinations, leeAt, stackAt, stow, type Pick, type Spot } from '../src/sim/stack';
import { FACING_ANGLE } from '../src/config/slots';

const t = defaultTuning();
const tile = (col: number, row: number): Spot => ({ kind: 'tile', col, row });
const fresh = () => newRun('basic', 3, t);

describe('slots', () => {
  test('every deck tile takes a gun or station, every edge a rail item and a hull module; outside corners take nothing', () => {
    for (const ship of Object.values(SHIPS)) {
      const b = createBoat(0, 'player', { ship: ship.id, loadout: {} }, t, { x: 0, y: 0 }, 0);
      const fixtures = ship.slots.filter((s) => s.type === 'edge' || s.type === 'interior');
      expect(fixtures).toHaveLength(b.grid.tiles.length);
      const edges = b.grid.tiles.reduce((n, x) => n + x.edges.length, 0);
      expect(ship.slots.filter((s) => s.type === 'rail')).toHaveLength(edges);
      expect(ship.slots.filter((s) => s.type === 'hull')).toHaveLength(edges);
      for (const s of fixtures) {
        const tl = b.grid.tiles.find((x) => x.col === s.tile![0] && x.row === s.tile![1])!;
        expect(s.type).toBe(tl.edges.length ? 'edge' : 'interior');
      }
    }
  });

  test('a corner gun faces its side, and can be turned to its other side', () => {
    const corner = slotById(SHIPS.basic, 'fix:0,0')!;
    expect(corner.facings!.sort()).toEqual(['port', 'stern']);
    expect(gunFacing({ ship: 'basic', loadout: {} }, corner)).toBeCloseTo(FACING_ANGLE.port);
    expect(gunFacing({ ship: 'basic', loadout: {}, facings: { 'fix:0,0': 'stern' } }, corner)).toBeCloseTo(FACING_ANGLE.stern);
    // Not a way it can face: ignored.
    expect(gunFacing({ ship: 'basic', loadout: {}, facings: { 'fix:0,0': 'bow' } }, corner)).toBeCloseTo(FACING_ANGLE.port);
  });
});

describe('the stack', () => {
  test('a tile shows its layers top first; tapping cycles down them', () => {
    const run = fresh();
    // The Quick Lee mans the cannon at (2,2).
    expect(stackAt(run, tile(2, 2))).toEqual(['lee', 'station']);
    const floor = addItem(run, 'grippy');
    applyMove(run, { from: 'cargo', uid: floor.uid }, { spot: tile(2, 2) });
    expect(stackAt(run, tile(2, 2))).toEqual(['lee', 'station', 'floor']);
    expect(stackAt(run, { kind: 'edge', col: 2, row: 2, facing: 'starboard' })).toEqual([]);
  });

  test('moving a manned cannon brings its Lee (and its attachment); the gun that was there swaps back', () => {
    const run = fresh();
    const shield = addItem(run, 'gunShield');
    applyMove(run, { from: 'cargo', uid: shield.uid }, { spot: tile(2, 2) });
    const quick = leeAt(run, tile(2, 2))!;
    const cannonThere = run.loadout['fix:3,2'];
    const moved = applyMove(run, { from: 'boat', spot: tile(2, 2), layer: 'station' }, { spot: tile(3, 2) });
    expect(leeAt(run, tile(3, 2))?.uid).toBe(quick.uid);
    expect(run.loadout['att:fix:3,2']).toBe(shield.uid);
    expect(run.loadout['att:fix:2,2']).toBeUndefined();
    // The cannon and the Lee that were at (3,2) are now at (2,2).
    expect(run.loadout['fix:2,2']).toBe(cannonThere);
    expect(leeAt(run, tile(2, 2))).not.toBeNull();
    expect(moved.some((d) => d.to === 'swap')).toBe(true);
  });

  test('a station that can\'t go back where the other came from goes to cargo instead', () => {
    const run = fresh();
    // The sail (interior) onto the port cannon's edge tile: no, a sail is interior-only. The other way round:
    const mortar = addItem(run, 'mortar');
    applyMove(run, { from: 'cargo', uid: mortar.uid }, { spot: tile(1, 1) });
    expect(destinations(run, { from: 'boat', spot: tile(1, 1), layer: 'station' }, t).some((d) => 'spot' in d && d.spot.kind === 'tile' && d.spot.row === 0)).toBe(false);
    // A cannon (edge only) moved onto the mortar's tile isn't offered either; a swivel (edge or interior) is, and the mortar goes to cargo.
    const swivel = addItem(run, 'swivel');
    applyMove(run, { from: 'cargo', uid: swivel.uid }, { spot: tile(2, 0) }); // the port cannon goes to cargo
    expect(cargo(run).map((x) => x.item)).toContain('cannon');
    const out = applyMove(run, { from: 'boat', spot: tile(2, 0), layer: 'station' }, { spot: tile(1, 1) });
    expect(run.loadout['fix:1,1']).toBe(swivel.uid);
    expect(out).toEqual([{ name: 'Mortar', to: 'cargo' }]);
    expect(whereIs(run, mortar.uid)).toBeNull();
  });

  test('moving a floor carries the station and the Lee on it', () => {
    const run = fresh();
    const planks = addItem(run, 'reinforcedPlanks');
    applyMove(run, { from: 'cargo', uid: planks.uid }, { spot: tile(3, 2) });
    const lee = leeAt(run, tile(3, 2))!;
    const gun = run.loadout['fix:3,2'];
    applyMove(run, { from: 'boat', spot: tile(3, 2), layer: 'floor' }, { spot: tile(3, 0) });
    expect(run.loadout['floor:3,0']).toBe(planks.uid);
    expect(run.loadout['fix:3,0']).toBe(gun);
    expect(leeAt(run, tile(3, 0))?.uid).toBe(lee.uid);
  });

  test('outside the hull: moving a hull module carries the rail item on it', () => {
    const run = fresh();
    const plate = addItem(run, 'ironPlating');
    const spikes = addItem(run, 'spikes');
    const a: Spot = { kind: 'edge', col: 4, row: 1, facing: 'bow' };
    const b: Spot = { kind: 'edge', col: 2, row: 0, facing: 'port' };
    applyMove(run, { from: 'cargo', uid: plate.uid }, { spot: a });
    applyMove(run, { from: 'cargo', uid: spikes.uid }, { spot: a });
    expect(stackAt(run, a)).toEqual(['rail', 'hull']);
    applyMove(run, { from: 'boat', spot: a, layer: 'hull' }, { spot: b });
    expect(stackAt(run, b)).toEqual(['rail', 'hull']);
    expect(stackAt(run, a)).toEqual([]);
    // Plating on an edge armors that tile's part.
    const boat = createBoat(0, 'player', buildFor(run), t, { x: 0, y: 0 }, 0);
    expect(boat.parts.find((p) => p.def.id === 'port')!.layers[0].kind).toBe('armor');
  });

  test('Lees go anywhere on deck and swap; one from ashore sends whoever stood there ashore', () => {
    const run = fresh();
    const p: Pick = { from: 'boat', spot: tile(1, 1), layer: 'lee' };
    expect(destinations(run, p, t)).toHaveLength(SHIPS.basic.slots.filter((s) => s.type === 'edge' || s.type === 'interior').length - 1);
    const handy = leeAt(run, tile(1, 1))!;
    const quick = leeAt(run, tile(2, 2))!;
    applyMove(run, p, { spot: tile(2, 2) });
    expect(leeAt(run, tile(2, 2))?.uid).toBe(handy.uid);
    expect(leeAt(run, tile(1, 1))?.uid).toBe(quick.uid);
    const recruit = addCrew(run, 'deft', 1, t);
    applyMove(run, { from: 'ashore', member: recruit.uid }, { spot: tile(1, 1) });
    expect(ashore(run).map((m) => m.uid)).toEqual([quick.uid]);
  });

  test('trinkets light up the Lees who can wear one; a full Lee swaps its first one out', () => {
    const run = fresh();
    const [a, b] = run.crew;
    const items = ['cutlass', 'seaLegs', 'toolBelt'].map((i) => addItem(run, i));
    expect(destinations(run, { from: 'cargo', uid: items[0].uid }, t)).toHaveLength(run.crew.length);
    wearTrinket(run, items[0].uid, a.uid, 0);
    wearTrinket(run, items[1].uid, a.uid, 1);
    applyMove(run, { from: 'cargo', uid: items[2].uid }, { member: a.uid });
    expect(a.trinkets).toEqual([items[2].uid, items[1].uid]);
    expect(whereIs(run, items[0].uid)).toBeNull();
    // Worn → another Lee.
    applyMove(run, { from: 'worn', member: a.uid, index: 1 }, { member: b.uid });
    expect(b.trinkets).toContain(items[1].uid);
  });

  test('stowing: a Lee goes ashore, a gun goes to cargo with its attachment', () => {
    const run = fresh();
    const shield = addItem(run, 'gunShield');
    applyMove(run, { from: 'cargo', uid: shield.uid }, { spot: tile(3, 2) });
    const lee = leeAt(run, tile(3, 2))!;
    stow(run, { from: 'boat', spot: tile(3, 2), layer: 'lee' });
    expect(lee.home).toBeNull();
    stow(run, { from: 'boat', spot: tile(3, 2), layer: 'station' });
    expect(run.loadout['fix:3,2']).toBeUndefined();
    expect(cargo(run).map((x) => x.uid)).toContain(shield.uid);
  });
});
