import { describe, expect, test } from 'vitest';
import { defaultTuning } from '../src/config/tuning';
import {
  applyDamage,
  gunOnline,
  gunSpec,
  createBoat,
  engineFactor,
  motionParams,
  sinkProgress,
  stepFlooding,
  structureFraction,
  totalCapacity,
  totalWater,
  waterFactors,
  type Boat,
} from '../src/sim/boat';
import { defaultBuild, type BoatBuild } from '../src/sim/loadout';
import { DEG, NORTH } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';

const make = (side: 'player' | 'enemy' = 'enemy', tune = defaultTuning(), build: BoatBuild = defaultBuild('sloop'), advantage = 1): Boat =>
  createBoat(1, side, build, tune, { x: 0, y: 0 }, NORTH, { advantage });
const part = (b: Boat, id: string) => b.parts.find((p) => p.def.id === id)!;

describe('layered damage', () => {
  test('damage hits the top layer first and overflows downward', () => {
    const b = make();
    const mid = part(b, 'midship');
    mid.layers.unshift({ kind: 'plate', hp: 15, maxHp: 15 });
    const r = applyDamage(mid, 20);
    expect(mid.layers[0].hp).toBe(0);
    expect(r.structureDamage).toBe(5);
    expect(r.dealt).toBe(20);
    expect(structureFraction(mid)).toBeCloseTo(95 / 100);
  });

  test('a single-layer part takes damage directly and stops at zero', () => {
    const b = make();
    const bow = part(b, 'bow');
    const r = applyDamage(bow, 1000);
    expect(r.dealt).toBe(40);
    expect(structureFraction(bow)).toBe(0);
  });

  test('the advantage assist scales HP', () => {
    const t = defaultTuning();
    expect(part(make('player', t, defaultBuild('sloop'), 2), 'midship').layers[0].maxHp).toBe(200);
    expect(part(make('enemy', t), 'midship').layers[0].maxHp).toBe(100);
  });
});

describe('part function', () => {
  test('guns on a side go offline past its threshold', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    const port = part(b, 'port');
    const gun = b.guns.find((c) => c.partIndex === port.index)!;
    expect(gunOnline(b, gun, t)).toBe(true);
    applyDamage(port, port.layers[0].maxHp * 0.65);
    expect(gunOnline(b, gun, t)).toBe(false);
    // The other side still fires.
    const stbd = b.guns.find((c) => c.partIndex === part(b, 'starboard').index)!;
    expect(gunOnline(b, stbd, t)).toBe(true);
  });

  test('engine damage scales speed and turning down in proportion', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    const healthy = motionParams(b, t);
    applyDamage(part(b, 'stern'), 1000);
    expect(engineFactor(b, t)).toBeCloseTo(t.boat.function.engineMinFactor);
    const wrecked = motionParams(b, t);
    expect(wrecked.cruiseSpeed).toBeCloseTo(healthy.cruiseSpeed * t.boat.function.engineMinFactor);
    expect(wrecked.turnRate).toBeCloseTo(healthy.turnRate * t.boat.function.engineMinFactor);
  });
});

describe('flooding', () => {
  test('an undamaged boat stays dry', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    for (let i = 0; i < 600; i++) stepFlooding(b, t, FIXED_DT);
    expect(totalWater(b)).toBe(0);
  });

  test('leak rate = rate × damage fraction × leak multiplier', () => {
    const t = defaultTuning();
    t.boat.flooding.spreadRate = 0;
    t.boat.flooding.bilgeRate = 0;
    const b = make('enemy', t);
    const mid = part(b, 'midship');
    applyDamage(mid, 50); // half damaged
    const leaked = stepFlooding(b, t, 1);
    expect(leaked).toBeCloseTo(t.boat.flooding.leakRate * 0.5 * t.boat.parts.midship.leakMultiplier);
  });

  test('water spreads to neighbors and evens out', () => {
    const t = defaultTuning();
    t.boat.flooding.bilgeRate = 0;
    const b = make('enemy', t);
    const bow = part(b, 'bow');
    bow.water = bow.capacity;
    for (let i = 0; i < 60 / FIXED_DT; i++) stepFlooding(b, t, FIXED_DT);
    const fills = b.parts.map((p) => p.water / p.capacity);
    const avg = totalWater(b) / totalCapacity(b);
    for (const f of fills) expect(f).toBeCloseTo(avg, 2);
    expect(totalWater(b)).toBeCloseTo(bow.capacity, 6); // conserved
  });

  test('the passive bilge drains water', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    part(b, 'midship').water = 10;
    stepFlooding(b, t, 1);
    expect(totalWater(b)).toBeCloseTo(10 - t.boat.flooding.bilgeRate);
  });

  test('water slows the boat along the configured curve', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    expect(waterFactors(b, t).speed).toBe(1);
    const line = t.boat.flooding.sinkThreshold * totalCapacity(b);
    part(b, 'midship').water = line / 2;
    const f = t.boat.flooding;
    expect(waterFactors(b, t).speed).toBeCloseTo(1 - f.waterSpeedPenalty * Math.pow(0.5, f.waterCurveExponent));
    expect(sinkProgress(b, t)).toBeCloseTo(0.5);
  });
});

describe('ships and loadouts', () => {
  test('ship numbers scale the baseline hull and movement', () => {
    const t = defaultTuning();
    const sloop = make('enemy', t);
    const hard = make('enemy', t, defaultBuild('hardship'));
    expect(part(hard, 'midship').layers[0].maxHp).toBeCloseTo(100 * t.ships.hardship.hullHp);
    // Same crew effects (none aboard), so the ratio is the ships' speed ratio.
    expect(motionParams(hard, t).cruiseSpeed / motionParams(sloop, t).cruiseSpeed).toBeCloseTo(t.ships.hardship.speed / t.ships.sloop.speed);
  });

  test('a gun points the way its slot faces, and its arc comes from the gun', () => {
    const t = defaultTuning();
    const b = make('enemy', t, { ship: 'sloop', loadout: { 'fix:1,0': 'cannon', 'fix:4,1': 'longGun', 'fix:0,1': 'cannon' } });
    const port = b.guns.find((g) => g.slot === 'fix:1,0')!;
    const bow = b.guns.find((g) => g.slot === 'fix:4,1')!;
    const stern = b.guns.find((g) => g.slot === 'fix:0,1')!;
    expect(port.face).toBeCloseTo(-Math.PI / 2);
    expect(bow.face).toBeCloseTo(0);
    expect(Math.abs(stern.face)).toBeCloseTo(Math.PI);
    // Muzzles sit at the hull edge they face.
    expect(port.local.y).toBeLessThan(-4.9);
    expect(bow.local.x).toBeGreaterThan(13.9);
    expect(stern.local.x).toBeLessThan(-13.9);
    expect(gunSpec(b, port, t).arcHalf / DEG).toBeCloseTo(35);
    expect(gunSpec(b, bow, t).arcHalf / DEG).toBeCloseTo(17.5);
    expect(gunSpec(b, bow, t).range).toBeCloseTo(t.guns.range * 1.5);
  });

  test('a slot only takes items that fit it', () => {
    const t = defaultTuning();
    // A sail is interior-only; a mortar too; a cannon is edge-only.
    const b = make('enemy', t, { ship: 'sloop', loadout: { 'fix:1,0': 'sail', 'fix:2,1': 'cannon', 'fix:1,1': 'mortar' } });
    expect(b.build.loadout).toEqual({ 'fix:1,1': 'mortar' });
  });

  test('attachments change their gun; plating adds an armor layer; treasures and floors apply', () => {
    const t = defaultTuning();
    const b = make('enemy', t, {
      ship: 'sloop',
      loadout: { 'fix:1,0': 'cannon', 'att:fix:1,0': 'gunShield', 'fix:3,0': 'cannon', 'hull:midship': 'ironPlating', 'floor:2,1': 'reinforcedPlanks' },
      treasures: ['ironE', 'sextant'],
    });
    const shielded = b.guns.find((g) => g.slot === 'fix:1,0')!;
    const plain = b.guns.find((g) => g.slot === 'fix:3,0')!;
    expect(gunSpec(b, shielded, t).arcHalf).toBeCloseTo(gunSpec(b, plain, t).arcHalf * 0.7);
    expect(gunSpec(b, plain, t).range).toBeCloseTo(t.guns.range * 1.1);
    const mid = part(b, 'midship');
    expect(mid.layers.map((l) => l.kind)).toEqual(['armor', 'structure']);
    expect(mid.layers[1].maxHp).toBeCloseTo(100 + 10);
    const tile = b.grid.tiles.find((x) => x.col === 2 && x.row === 1)!;
    expect(tile.maxHp).toBeCloseTo(t.tiles.durability * 2);
    expect(b.mods.occupant[tile.index].impactTaken).toBeCloseTo(0.75);
  });

  test('every ship has the slot counts and default loadout its data says, on its own grid', () => {
    const t = defaultTuning();
    for (const id of ['sloop', 'skiff', 'friendship', 'hardship']) {
      const b = make('enemy', t, defaultBuild(id));
      expect(Object.keys(b.build.loadout).length).toBe(Object.keys(defaultBuild(id).loadout).length);
      expect(t.ships[id].crewMax).toBeLessThanOrEqual(b.grid.tiles.length);
    }
  });
});
