import { describe, expect, test } from 'vitest';
import { SLOOP } from '../src/config/boats';
import { defaultTuning } from '../src/config/tuning';
import {
  applyDamage,
  cannonOnline,
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
import { NORTH } from '../src/sim/math';
import { FIXED_DT } from '../src/sim/steering';

const make = (side: 'player' | 'enemy' = 'enemy', tune = defaultTuning()): Boat =>
  createBoat(1, side, SLOOP, tune, { x: 0, y: 0 }, NORTH);
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

  test('player advantage scales HP', () => {
    const t = defaultTuning();
    t.global.playerAdvantage = 2;
    expect(part(make('player', t), 'midship').layers[0].maxHp).toBe(200);
    expect(part(make('enemy', t), 'midship').layers[0].maxHp).toBe(100);
  });
});

describe('part function', () => {
  test('a cannon section goes offline past its threshold', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    const port = part(b, 'port');
    const gun = b.cannons.find((c) => c.partIndex === port.index)!;
    expect(cannonOnline(b, gun, t)).toBe(true);
    applyDamage(port, port.layers[0].maxHp * 0.65);
    expect(cannonOnline(b, gun, t)).toBe(false);
    // The other side still fires.
    const stbd = b.cannons.find((c) => c.partIndex === part(b, 'starboard').index)!;
    expect(cannonOnline(b, stbd, t)).toBe(true);
  });

  test('engine damage scales speed and turning down in proportion', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    const healthy = motionParams(b, t);
    applyDamage(part(b, 'stern'), 1000);
    expect(engineFactor(b, t)).toBeCloseTo(t.ships.standard.function.engineMinFactor);
    const wrecked = motionParams(b, t);
    expect(wrecked.cruiseSpeed).toBeCloseTo(healthy.cruiseSpeed * t.ships.standard.function.engineMinFactor);
    expect(wrecked.turnRate).toBeCloseTo(healthy.turnRate * t.ships.standard.function.engineMinFactor);
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
    t.ships.standard.flooding.spreadRate = 0;
    t.ships.standard.flooding.bilgeRate = 0;
    const b = make('enemy', t);
    const mid = part(b, 'midship');
    applyDamage(mid, 50); // half damaged
    const leaked = stepFlooding(b, t, 1);
    expect(leaked).toBeCloseTo(t.ships.standard.flooding.leakRate * 0.5 * t.ships.standard.parts.midship.leakMultiplier);
  });

  test('water spreads to neighbors and evens out', () => {
    const t = defaultTuning();
    t.ships.standard.flooding.bilgeRate = 0;
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
    expect(totalWater(b)).toBeCloseTo(10 - t.ships.standard.flooding.bilgeRate);
  });

  test('water slows the boat along the configured curve', () => {
    const t = defaultTuning();
    const b = make('enemy', t);
    expect(waterFactors(b, t).speed).toBe(1);
    const line = t.ships.standard.flooding.sinkThreshold * totalCapacity(b);
    part(b, 'midship').water = line / 2;
    const f = t.ships.standard.flooding;
    expect(waterFactors(b, t).speed).toBeCloseTo(1 - f.waterSpeedPenalty * Math.pow(0.5, f.waterCurveExponent));
    expect(sinkProgress(b, t)).toBeCloseTo(0.5);
  });
});
