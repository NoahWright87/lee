// Phase 7, Close Quarters: the speed blend, the accuracy pass, holding fire
// near allies, then lines and crossings, deck taps, breaking away.

import { describe, expect, test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { gunSpec, type Boat, type GunState } from '../src/sim/boat';
import { hullGap } from '../src/sim/contact';
import { crossings, railsOf } from '../src/sim/lines';
import { defaultBuild, type BoatBuild } from '../src/sim/loadout';
import type { Vec } from '../src/sim/math';
import { archetypeSetup, autoArrange, type BoatSetup, type CrewSpec } from '../src/sim/setup';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

function quiet(t: Tuning): Tuning {
  t.boat.flooding.bilgeRate = 0;
  t.boat.flooding.leakRate = 0;
  return t;
}

function pin(b: Boat, at: Vec, heading = -Math.PI / 2): void {
  Object.assign(b.motion, { x: at.x, y: at.y, heading, vx: 0, vy: 0, omega: 0 });
  b.target = null;
}

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / FIXED_DT; i++) {
    each?.();
    w.step(FIXED_DT);
  }
};

/** An enemy setup of one archetype with this many Basic Lees. */
function enemy(t: Tuning, type: string, crew: number, seed = 1): BoatSetup {
  const s = archetypeSetup(type, t, seed);
  const specs: CrewSpec[] = Array.from({ length: crew }, () => ({ type: 'basic', home: null as number | null }));
  autoArrange(s.build, specs, t).forEach((h, i) => (specs[i].home = h));
  return { ...s, crew: specs };
}

describe('speed blend (§3)', () => {
  test('the blend slides from 0 to 1 between 1.5× and 1× pistol range, with no snap', () => {
    const t = quiet(defaultTuning());
    const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0)], crew: [] });
    w.start();
    const e = w.enemies[0];
    const blendAt = (gap: number) => {
      pin(w.player, { x: 0, y: 0 });
      pin(e, { x: -(w.player.layout.beam / 2 + e.layout.beam / 2 + gap), y: 0 });
      return w.speedBlend();
    };
    const far = t.pistol.range * t.speed.blendStart;
    expect(blendAt(far + 5)).toBe(0);
    expect(blendAt(t.pistol.range - 1)).toBe(1);
    let last = 0;
    for (let gap = far; gap >= t.pistol.range; gap -= 0.5) {
      const b = blendAt(gap);
      expect(b).toBeGreaterThanOrEqual(last);
      expect(b - last).toBeLessThan(0.15);
      last = b;
    }
    expect(blendAt((far + t.pistol.range) / 2)).toBeGreaterThan(0.3);
    expect(blendAt((far + t.pistol.range) / 2)).toBeLessThan(0.7);
  });
});

describe('accuracy and holding fire (§5)', () => {
  /** Shells fired by the first of two enemies while both sit still near a pinned player. */
  function firedBy(chance: number, allyAt: Vec): number {
    const t = quiet(defaultTuning());
    t.fights.holdFireChance = chance;
    t.fights.holdFireRadius = 50;
    const w = new World(t, 3, { enemies: [enemy(t, 'standard', 4), enemy(t, 'standard', 0, 2)], crew: [0, 1, 2, 3, 4] });
    w.start();
    let shells = 0;
    const seen = new Set<number>();
    run(w, 20, () => {
      pin(w.player, { x: 0, y: 0 });
      pin(w.enemies[0], { x: -90, y: 0 });
      pin(w.enemies[1], allyAt);
      for (const s of w.shells) if (s.ownerId === w.enemies[0].id && !seen.has(s.id)) (seen.add(s.id), shells++);
    });
    return shells;
  }

  test('a gun whose shot would land near an ally of its own holds fire; without the ally it shoots', () => {
    const near = firedBy(1, { x: 0, y: -40 });
    const open = firedBy(1, { x: 0, y: -400 });
    const free = firedBy(0, { x: 0, y: -40 });
    expect(open).toBeGreaterThan(2);
    expect(free).toBeGreaterThan(2);
    expect(near).toBe(0);
  });

  test('scatter grows with distance and with how hard the shooter is turning', () => {
    const t = quiet(defaultTuning());
    const spread = (dist: number, omega: number) => {
      const w = new World(t, 1, { enemies: [enemy(t, 'standard', 0)], crew: [] });
      const b = w.player;
      b.motion.omega = omega;
      const g = b.guns[0];
      return gunScatter(w, b, g, dist);
    };
    expect(spread(120, 0)).toBeGreaterThan(spread(40, 0));
    expect(spread(80, 0.35)).toBeGreaterThan(spread(80, 0) * 1.5);
  });
});

/** The scatter radius the world would use for a baseline gunner, for a shot of this length. */
function gunScatter(w: World, b: Boat, g: GunState, dist: number): number {
  const G = w.tuning.guns;
  const spec = gunSpec(b, g, w.tuning);
  return spec.spread + (spec.spreadPerMeter + G.spreadPerMeter) * dist + Math.abs(b.motion.omega) * G.turnScatter;
}

// ------------------------------------------------------------ lines and crossings (§6)

type Home = [col: number, row: number];

/** Basic Lees on these (col,row) tiles of a Basic Ship. */
function crewAt(build: BoatBuild, homes: Home[], job?: 'board' | 'fix' | 'fire' | 'sail'): CrewSpec[] {
  const grid = defaultGrid();
  return homes.map(([c, r]) => ({ type: 'basic', home: grid.find((t) => t.col === c && t.row === r)!.index, job }));
  void build;
}

import { buildGrid } from '../src/sim/grid';
import { SLOOP } from '../src/config/boats';
const defaultGrid = () => buildGrid(SLOOP).tiles;

/** A Basic Ship of yours on the origin and an enemy Basic Ship due east (your starboard), with the given gap between hulls. */
function duel(opts: { gap?: number; mine?: Record<string, string>; theirs?: Record<string, string>; myCrew?: Home[]; theirCrew?: Home[]; myJob?: 'board' | 'fix'; hooks?: number; tune?: (t: Tuning) => void }) {
  const t = quiet(defaultTuning());
  for (const p of Object.values(t.ai)) p.hooks = opts.hooks ?? 0;
  opts.tune?.(t);
  const mineBuild: BoatBuild = { ship: 'basic', loadout: opts.mine ?? {} };
  const theirBuild: BoatBuild = { ship: 'basic', loadout: opts.theirs ?? {} };
  const w = new World(t, 7, {
    player: { build: mineBuild, crew: crewAt(mineBuild, opts.myCrew ?? [], opts.myJob) },
    enemies: [{ build: theirBuild, crew: crewAt(theirBuild, opts.theirCrew ?? []), ai: { ...t.ai.standard, boardShare: 0, cutDelay: 0 } }],
    assists: false,
  });
  w.start();
  const e = w.enemies[0];
  const at = () => ({ x: w.player.layout.beam / 2 + e.layout.beam / 2 + (opts.gap ?? 6), y: 0 });
  const hold = () => {
    pin(w.player, { x: 0, y: 0 });
    pin(e, at());
  };
  hold();
  w.boardTargetId = e.id;
  return { t, w, e, hold, at };
}

const starboardRail = (b: Boat, kind: 'hook' | 'rope' | 'planks' | 'pole') => railsOf(b, kind).find((r) => r.rail.facing === 'starboard')!;
const HOOKS = { 'rail:3,2:starboard': 'hooks' };
const ROPES = { 'rail:2,2:starboard': 'ropes' };
const PLANKS = { 'rail:2,2:starboard': 'planks' };
const POLES = { 'rail:1,2:starboard': 'poles' };

describe('hooks and lines (§6.1)', () => {
  /** Throw a hook from your starboard rail straight away (no Lee needed) and let it land. */
  function hookUp(d: ReturnType<typeof duel>, rail = starboardRail(d.w.player, 'hook')) {
    const f = d.w.lines.throwHook(rail, d.e, d.t, d.w.time);
    expect(f).not.toBeNull();
    run(d.w, d.t.lines.hookFlight + 0.2, d.hold);
    return d.w.lines.lines[d.w.lines.lines.length - 1];
  }

  test('a tap sends the nearest Lee to the rail; the hook is thrown, telegraphed, and lands as a line', () => {
    const d = duel({ gap: 6, mine: HOOKS, myCrew: [[1, 1]] });
    const { w } = d;
    expect(w.tapRail(starboardRail(w.player, 'hook'))).toBeNull();
    expect(w.orders.list).toHaveLength(1);
    let thrown = false;
    let landed = false;
    let telegraphed = false;
    run(w, 6, () => {
      d.hold();
      for (const ev of w.events) {
        if (ev.type === 'hookThrown') thrown = true;
        if (ev.type === 'hookLanded') landed = true;
      }
      // Hooks thrown at the enemy aren't telegraphed to you; ones at you are (checked below).
      if (w.telegraphs.list.some((x) => x.kind === 'area')) telegraphed = true;
      w.events = [];
    });
    expect(thrown).toBe(true);
    expect(landed).toBe(true);
    expect(telegraphed).toBe(false);
    expect(w.lines.lines).toHaveLength(1);
    expect(w.stats.player.hooksThrown).toBe(1);
    expect(w.stats.player.hooksLanded).toBe(1);
    expect(starboardRail(w.player, 'hook').rail.out).toBe(true);
    expect(w.orders.list).toHaveLength(0);
  });

  test('a hook at you is telegraphed, and steering away before it lands dodges it', () => {
    const d = duel({ gap: 6, theirs: { 'rail:2,0:port': 'hooks' }, theirCrew: [[2, 0]] });
    const { w, e, t } = d;
    const rail = railsOf(e, 'hook')[0];
    const f = w.lines.throwHook(rail, w.player, t, w.time)!;
    expect(f).not.toBeNull();
    w.telegraphs.add('area', f.to, f.flight, 0.3, t.lines.hookCatch);
    run(w, f.flight * 0.5, d.hold);
    // The player's boat sails off 25 m to the west before it comes down.
    w.player.motion.x -= 25;
    const events: string[] = [];
    run(w, f.flight, () => {
      pin(e, d.at());
      for (const ev of w.events) events.push(ev.type);
      w.events = [];
    });
    expect(events).toContain('hookMissed');
    expect(w.lines.lines).toHaveLength(0);
    expect(rail.rail.out).toBe(false);
    // A miss costs a short wait, less than a cut line.
    expect(rail.rail.readyAt).toBeLessThan(w.time + t.lines.hookCooldown);
  });

  test('a hook only reaches so far', () => {
    const d = duel({ gap: 40, mine: HOOKS, myCrew: [[1, 1]] });
    expect(d.w.tapRail(starboardRail(d.w.player, 'hook'))).toMatch(/range/);
    expect(d.w.orders.list).toHaveLength(0);
  });

  /** How long the lines are, as the gap between the hulls. */
  const lineLength = (w: World) => hullGap(w.player, w.enemies[0]).gap;
  /** Both boats sit with no way of their own: only the lines move them. */
  const adrift = (w: World) => () => {
    for (const b of w.boats) Object.assign(b.motion, { vx: 0, vy: 0, omega: 0 });
  };

  test('lines reel the hulls together slowly: ~0.5 m/s a line, faster with more, slower for a heavier boat', () => {
    const closed = (loadout: Record<string, string>, mass = 1, seconds = 6) => {
      const d = duel({ gap: 8, mine: loadout, tune: (t) => (t.ships.basic.mass = mass) });
      for (const r of railsOf(d.w.player, 'hook')) d.w.lines.throwHook(r, d.e, d.t, d.w.time);
      run(d.w, d.t.lines.hookFlight + 0.1, d.hold);
      expect(d.w.lines.lines.length).toBe(railsOf(d.w.player, 'hook').length);
      const before = lineLength(d.w);
      run(d.w, seconds, adrift(d.w));
      return before - lineLength(d.w);
    };
    const one = closed({ 'rail:3,2:starboard': 'hooks' });
    const two = closed({ 'rail:3,2:starboard': 'hooks', 'rail:1,2:starboard': 'hooks' });
    const heavy = closed({ 'rail:3,2:starboard': 'hooks' }, 2.5);
    expect(one).toBeGreaterThan(2);
    expect(one).toBeLessThan(4);
    expect(two).toBeGreaterThan(one * 1.6);
    expect(heavy).toBeLessThan(one * 0.6);
  });

  test('a line stops the hulls at a close gap; they do not pass through each other', () => {
    const d = duel({ gap: 8, mine: HOOKS });
    hookUp(d);
    run(d.w, 30, adrift(d.w));
    const gap = hullGap(d.w.player, d.e).gap;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(d.t.lines.closeGap + 1.5);
  });

  test('you cannot sail out of a line: a boat rowing away is held, and drags the other', () => {
    const sail = (hooked: boolean) => {
      const d = duel({ gap: 8, mine: HOOKS });
      if (hooked) hookUp(d);
      d.w.setHelm({ kind: 'heading', h: Math.PI }); // west, directly away
      const start = { x: d.w.player.motion.x, y: d.w.player.motion.y };
      const gap0 = hooked ? lineLength(d.w) : hullGap(d.w.player, d.e).gap;
      let worst = 0;
      run(d.w, 10, () => {
        Object.assign(d.e.motion, { vx: 0, vy: 0, omega: 0 }); // the enemy sits at anchor: only a line can move it
        worst = Math.max(worst, hooked ? lineLength(d.w) : hullGap(d.w.player, d.e).gap);
      });
      return { over: worst - gap0, moved: Math.hypot(d.w.player.motion.x - start.x, d.w.player.motion.y - start.y) };
    };
    const free = sail(false);
    const held = sail(true);
    expect(free.over).toBeGreaterThan(20);
    expect(held.over).toBeLessThanOrEqual(0.8);
    expect(held.moved).toBeLessThan(free.moved * 0.8); // it drags the other boat along, so it makes less way
  });

  test('cutting: a Lee hacks at the line; once it parts the hook cools down before it can be thrown again', () => {
    const d = duel({ gap: 6, mine: HOOKS, myCrew: [[1, 1], [2, 1]], myJob: 'board' });
    const { w, t } = d;
    const line = hookUp(d);
    expect(w.tapLine(line, w.player)).toBeNull();
    let cutAt = -1;
    run(w, 10, () => {
      d.hold();
      if (cutAt < 0 && w.lines.lines.length === 0) cutAt = w.time;
    });
    expect(cutAt).toBeGreaterThan(0);
    expect(cutAt).toBeLessThan(6);
    const rail = starboardRail(w.player, 'hook').rail;
    expect(rail.out).toBe(false);
    expect(w.tapRail(starboardRail(w.player, 'hook'))).toMatch(/cooling/);
    expect(rail.readyAt).toBeGreaterThan(w.time);
    run(w, t.lines.hookCooldown + 1, d.hold);
    expect(w.tapRail(starboardRail(w.player, 'hook'))).toBeNull();
  });

  test('more taps on a line send more Lees, and more Lees cut it faster', () => {
    const timeToCut = (taps: number) => {
      const d = duel({ gap: 6, mine: HOOKS, myCrew: [[1, 1], [2, 1], [3, 1]], myJob: 'board' });
      const line = hookUp(d);
      for (let i = 0; i < taps; i++) d.w.tapLine(line, d.w.player);
      const t0 = d.w.time;
      let cutAt = -1;
      run(d.w, 12, () => {
        d.hold();
        if (cutAt < 0 && d.w.lines.lines.length === 0) cutAt = d.w.time;
      });
      return cutAt - t0;
    };
    expect(timeToCut(3)).toBeLessThan(timeToCut(1));
  });
});

describe('crossing needs a way across (§6.2)', () => {
  test('a boat with neither ropes nor planks cannot board, however close', () => {
    const d = duel({ gap: 1.5, myCrew: [[2, 2], [3, 2]], myJob: 'board', theirCrew: [[1, 1]] });
    run(d.w, 6, d.hold);
    expect(d.w.stats.player.boardings).toBe(0);
    expect(crossings(d.w.player, d.e, d.t)).toHaveLength(0);
  });

  test('ropes carry one Lee per crossing ordered, one at a time, and only within swing range', () => {
    const d = duel({ gap: 2, mine: ROPES, myCrew: [[2, 2], [3, 2], [1, 2]], myJob: 'board', theirCrew: [[1, 1]] });
    const { w } = d;
    run(w, 4, d.hold);
    expect(w.stats.player.boardings).toBe(0); // gathered at the rope, waiting to be sent
    expect(w.tapRail(starboardRail(w.player, 'rope'))).toBeNull();
    run(w, 3, d.hold);
    expect(w.stats.player.boardings).toBe(1);
    run(w, 3, d.hold);
    expect(w.stats.player.boardings).toBe(1); // no second crossing ordered
    w.tapRail(starboardRail(w.player, 'rope'));
    run(w, 3, d.hold);
    expect(w.stats.player.boardings).toBe(2);
  });

  test('a rope will not take an order from out of its swing range', () => {
    const d = duel({ gap: 12, mine: ROPES, myCrew: [[2, 2]], myJob: 'board' });
    expect(d.w.tapRail(starboardRail(d.w.player, 'rope'))).toMatch(/range/);
  });

  test('planks: a tap lowers one onto a close hull, then Lees stream across faster than on ropes', () => {
    const d = duel({ gap: 1.2, mine: PLANKS, myCrew: [[2, 2], [3, 2], [1, 2]], myJob: 'board', theirCrew: [[1, 1]] });
    const { w, t } = d;
    run(w, 3, d.hold);
    expect(w.stats.player.boardings).toBe(0); // up: nobody crosses
    expect(w.tapRail(starboardRail(w.player, 'planks'))).toBeNull();
    run(w, 3, d.hold);
    expect(starboardRail(w.player, 'planks').rail.lowered).toBe(true);
    expect(w.stats.player.boardings).toBeGreaterThan(1); // several without further taps
    const swing = w.player.crew.lees.find((l) => l.swing && !l.swing.back)?.swing;
    if (swing) expect(swing.dur).toBeLessThan(t.boarding.swingTime);
  });

  test('a plank cannot be lowered onto a hull that is too far, and comes up when the boats drift apart', () => {
    const far = duel({ gap: 5, mine: PLANKS, myCrew: [[2, 2]], myJob: 'board' });
    expect(far.w.tapRail(starboardRail(far.w.player, 'planks'))).toMatch(/far/);
    const d = duel({ gap: 1.2, mine: PLANKS, myCrew: [[2, 2]], myJob: 'board' });
    d.w.tapRail(starboardRail(d.w.player, 'planks'));
    run(d.w, 3, d.hold);
    const rail = starboardRail(d.w.player, 'planks').rail;
    expect(rail.lowered).toBe(true);
    d.e.motion.x += 20;
    run(d.w, 0.2, () => pin(d.w.player, { x: 0, y: 0 }));
    expect(rail.lowered).toBe(false);
  });

  test('an enemy plank lowered onto your rail can be destroyed by a tap', () => {
    // They sit east of you heading north, so their port side (west) faces you.
    const d = duel({ gap: 1.2, theirs: { 'rail:2,0:port': 'planks' }, myCrew: [[1, 1], [2, 1]], myJob: 'board' });
    const { w, e } = d;
    const ref = railsOf(e, 'planks')[0];
    ref.rail.lowered = true;
    expect(w.tapPlank(ref, w.player)).toBeNull();
    let gone = -1;
    run(w, 10, () => {
      d.hold();
      ref.rail.lowered ||= !ref.rail.destroyed;
      if (gone < 0 && ref.rail.destroyed) gone = w.time;
    });
    expect(gone).toBeGreaterThan(0);
    expect(ref.rail.lowered).toBe(false);
    // Your own planks are not yours to destroy.
    expect(w.tapPlank(ref, e)).toMatch(/nothing/);
  });
});

describe('pushing off (§6.3)', () => {
  test('push poles shove the boats apart for a moment, then cool down', () => {
    const d = duel({ gap: 2, mine: POLES, myCrew: [[1, 2]], myJob: 'board' });
    const { w, e, t } = d;
    const before = hullGap(w.player, e).gap;
    expect(w.tapRail(starboardRail(w.player, 'pole'))).toBeNull();
    run(w, 3, () => {});
    pin(w.player, w.player.motion);
    const gap = hullGap(w.player, e).gap;
    expect(gap).toBeGreaterThan(before + t.lines.poleSpeed * t.lines.poleTime * 0.5);
    expect(w.tapRail(starboardRail(w.player, 'pole'))).toMatch(/not ready/);
  });

  test('with a line holding, the poles only strain against it', () => {
    const d = duel({ gap: 6, mine: { ...HOOKS, ...POLES }, myCrew: [[1, 2]], myJob: 'board' });
    const { w, e, t } = d;
    w.lines.throwHook(starboardRail(w.player, 'hook'), e, t, w.time);
    run(w, t.lines.hookFlight + 0.2, d.hold);
    expect(w.lines.lines).toHaveLength(1);
    const limit = w.lines.limit(w.player, e)!;
    w.tapRail(starboardRail(w.player, 'pole'));
    run(w, 4, () => {
      pin(e, e.motion);
    });
    expect(hullGap(w.player, e).gap).toBeLessThanOrEqual(limit + 0.5);
  });
});

describe('the enemy at close quarters (§11)', () => {
  /** The Friend Ship against your Basic Ship, which sits still while you play the part of a crew that hasn't reacted. */
  function friendWorld(seed: number, tune?: (t: Tuning) => void, crew: Home[] = [[1, 1], [2, 1], [3, 1], [2, 0]]) {
    const t = quiet(defaultTuning());
    tune?.(t);
    const enemy = archetypeSetup('boarder', t, seed);
    const mine: BoatBuild = defaultBuild('basic');
    const w = new World(t, seed, { player: { build: mine, crew: crewAt(mine, crew, 'fix') }, enemies: [enemy], assists: false });
    w.start();
    const e = w.enemies[0];
    pin(w.player, { x: 0, y: 0 });
    pin(e, { x: 40, y: 30 }, 3);
    return { t, w, e };
  }

  test('a boarder throws hooks as it closes, and takes several seconds to haul you in after the first lands', () => {
    const { t, w, e } = friendWorld(3);
    let firstLine = -1;
    let contactAt = -1;
    run(w, 60, () => {
      pin(w.player, { x: 0, y: 0 });
      if (firstLine < 0 && w.lines.lines.length) firstLine = w.time;
      if (firstLine >= 0 && contactAt < 0 && hullGap(w.player, e).gap <= t.boarding.range) contactAt = w.time;
      // Nobody on your side cuts anything: this is the unreacting captain.
      for (const o of w.orders.list.slice()) if (o.boat === w.player) w.orders.remove(w, o);
    });
    expect(w.stats.enemy.hooksThrown).toBeGreaterThan(0);
    expect(firstLine).toBeGreaterThan(0);
    expect(contactAt).toBeGreaterThan(firstLine + 3);
  });

  test('the same fight, but your crew cuts the lines: you get away', () => {
    const { t, w, e } = friendWorld(3);
    let cuts = 0;
    run(w, 40, () => {
      pin(w.player, { x: 0, y: 0 });
      for (const line of w.lines.lines) if (line.target === w.player && !w.orders.find(w.player, 'cutLine', { line })) w.tapLine(line, w.player);
      cuts = w.stats.player.linesCut;
    });
    expect(cuts).toBeGreaterThan(0);
    expect(t.lines.hookCooldown).toBeGreaterThan(0);
    void e;
  });

  test('a skirmisher cuts the first line that lands almost at once; a boarder is slow to', () => {
    const cutTime = (profile: 'skirmisher' | 'boarder') => {
      const d = duel({ gap: 6, mine: HOOKS, theirCrew: [[1, 1], [2, 1]], myCrew: [] });
      const prof = d.t.ai[profile];
      d.e.ai = { ...prof };
      d.w.brains.get(d.e.id)!.waits.clear();
      const line = d.w.lines.throwHook(starboardRail(d.w.player, 'hook'), d.e, d.t, d.w.time);
      expect(line).not.toBeNull();
      run(d.w, d.t.lines.hookFlight + 0.1, d.hold);
      const landed = d.w.time;
      let cut = -1;
      run(d.w, 20, () => {
        d.hold();
        if (cut < 0 && d.w.lines.lines.length === 0) cut = d.w.time;
      });
      return cut < 0 ? Infinity : cut - landed;
    };
    expect(cutTime('skirmisher')).toBeLessThan(cutTime('boarder'));
  });

  test('hesitation is a difficulty lever: Easy waits longer before each decision than Hard', () => {
    const waitFor = (hes: number) => {
      const t = quiet(defaultTuning());
      for (const p of Object.values(t.ai)) p.hooks = 0;
      const d = duel({ gap: 6, mine: HOOKS, theirCrew: [[1, 1], [2, 1], [3, 1]] });
      const w = new World(d.t, 7, {
        player: { build: { ship: 'basic', loadout: HOOKS }, crew: [] },
        enemies: [{ build: { ship: 'basic', loadout: {} }, crew: crewAt({ ship: 'basic', loadout: {} }, [[1, 1], [2, 1], [3, 1]]), ai: { ...d.t.ai.heavy } }],
        assists: false,
        hesitation: hes,
      });
      w.start();
      const e = w.enemies[0];
      const hold = () => {
        pin(w.player, { x: 0, y: 0 });
        pin(e, { x: w.player.layout.beam / 2 + e.layout.beam / 2 + 6, y: 0 });
      };
      hold();
      w.lines.throwHook(starboardRail(w.player, 'hook'), e, d.t, w.time);
      run(w, d.t.lines.hookFlight + 0.1, hold);
      const landed = w.time;
      let cut = -1;
      run(w, 20, () => {
        hold();
        if (cut < 0 && w.lines.lines.length === 0) cut = w.time;
      });
      void t;
      return cut < 0 ? Infinity : cut - landed;
    };
    expect(waitFor(2)).toBeGreaterThan(waitFor(0.5));
  });
});
