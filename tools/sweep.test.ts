// Quick run simulation (a tuning tool, not a test): a scripted captain sails
// each ship through generated sea maps, port to port, and prints how deep it
// got, fights won, gold earned and Lees lost. Use it to compare how fast enemy
// budgets ramp against what a player can buy.
//
//   npm run sweep              (SWEEP_SEEDS=4, SWEEP_JOURNEYS=3 by default)
//
// Between fights it plays a simple, honest game: in port it repairs, heals,
// buys what it can afford that fits an empty spot (Auto-equip), and sails to
// the first destination; at sea it follows the map's guaranteed route (the
// fights on the way are the fights it gets). In a fight the captain plays each
// ship's style: the Friend Ship targets the enemy (the BOARD/RAM autopilot),
// sends most of its crew to ⚔️ as it closes (BOARD then throws its hooks,
// lowers its planks and sends Lees over its ropes by itself); the Long Distance Relation Ship orbits
// at long-gun range, the rest orbit at cannon range. Every other ship cuts any
// line that holds it and mashes ⏩ to get its oars manned (it never kites or
// dodges), so a person does better: read the numbers as
// "how hard is this for someone not trying". A fight still going at 400 s
// counts as a loss (usually a skirmisher it never catches); SWEEP_LOG=1 prints
// every fight.

import { test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { structureFraction } from '../src/sim/boat';
import { rngFor } from '../src/sim/math';
import { buy, buyHealAll, buyRepair, enterPort, makePlan } from '../src/sim/port';
import { answerSurrender, applyFight, pickCapture, hullShare, autoEquipAll, cargo, discard, enemySetups, finishPost, newRun, setupFor, takeReward, type RunState } from '../src/sim/run';
import { leavePort, playerValue, sailTo } from '../src/sim/seaMap';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

const SEEDS = Math.max(1, Number(process.env.SWEEP_SEEDS ?? 4));
const JOURNEYS = Math.max(1, Number(process.env.SWEEP_JOURNEYS ?? 3));

/** Close quarters for the scripted captain: the Friend Ship just presses BOARD (the crew hooks, planks and ropes itself); everyone else cuts lines and breaks away. */
function quarters(w: World, ship: string): void {
  const p = w.player;
  if (ship === 'friend') return;
  for (const line of w.lines.linesOf(p)) if (!w.orders.find(p, 'cutLine', { line })) w.tapLine(line, p);
  if (w.lines.held(p) && w.orders.list.some((o) => o.boat === p && o.kind === 'cutLine')) w.order('sail');
}

/**
 * Sea monsters for the scripted captain: steer off any ring that is about to open under the boat, step the Lees out of flashing
 * deck zones, and stab a head that is down. (Depth charges and the like go off by themselves.)
 */
function monsters(w: World): void {
  const p = w.player;
  if (!w.nesses.alive().length) return;
  // Man the guns (🔫), and keep somebody on 🛠️ while the hull is hurt or wet: what a person would mash.
  const alive = p.crew.lees.filter((l) => l.alive);
  if (alive.filter((l) => l.job === 'fire').length < Math.ceil(alive.length / 2)) w.order('fire');
  const wet = p.parts.some((x) => x.capacity > 0 && x.water / x.capacity > 0.15);
  if (wet && alive.filter((l) => l.job === 'fix').length < 2) w.order('fix');
  for (const z of w.zones.pending(p)) w.tapZone(z, p);
  for (const n of w.nesses.list) if (n.state === 'surfaced' && n.stunUntil !== null && !w.orders.list.some((o) => o.kind === 'stab')) w.tapHead(n, p);
}

/** The point to head for to get clear of a ring about to open under the boat, or null if none threatens it. */
function ringThreat(w: World): { x: number; y: number } | null {
  const p = w.player.motion;
  for (const n of w.nesses.list) {
    if (n.state !== 'emerging' || !n.emergeAt) continue;
    const k = w.tuning.ness.kinds[n.kind];
    const d = Math.hypot(p.x - n.emergeAt.x, p.y - n.emergeAt.y);
    const safe = k.ringRadius + Math.max(w.player.layout.length, w.player.layout.beam) / 2 + 12;
    if (d >= safe * 1.3) continue;
    // Straight away from the ring's center (or along the keel if sitting right on it).
    const a = d > 1 ? Math.atan2(p.y - n.emergeAt.y, p.x - n.emergeAt.x) : p.heading;
    return { x: p.x + Math.cos(a) * 80, y: p.y + Math.sin(a) * 80 };
  }
  return null;
}

/** Steer clear of the ring where a Ness is about to rise (returns true if it did). */
function dodgeRing(w: World): boolean {
  const away = ringThreat(w);
  if (!away) return false;
  if (w.helm.kind !== 'drift') w.setHelm({ kind: 'drift' });
  w.player.target = away;
  return true;
}

/** Fight the set-up encounter with the scripted captain. */
function fight(run: RunState, ship: string, seed: number, t: Tuning): { won: boolean; time: number; lost: number } {
  const w = new World(t, seed * 977 + run.fight, { player: setupFor(run, t), enemies: enemySetups(run, t), nesses: run.encounter?.nesses, assists: false, carry: { hp: run.hull, water: run.hull.map(() => 0) } });
  w.start();
  let nextOrder = 0;
  let nextQuarters = 0;
  while (w.phase !== 'over' && w.time < 400) {
    const e = w.liveEnemies()[0] ?? w.enemies[0];
    const p = w.player.motion;
    const bearing = e ? Math.atan2(e.motion.y - p.y, e.motion.x - p.x) : 0;
    const d = e ? Math.hypot(e.motion.x - p.x, e.motion.y - p.y) : 0;
    if (!e || w.isOut(e)) {
      // Only sea monsters left: hold position and play the deck.
      if (!ringThreat(w) && w.helm.kind !== 'stop') w.setHelm({ kind: 'stop' });
    } else if (ship === 'friend') {
      if (w.boardTargetId !== e.id || (w.helm.kind !== 'board' && w.helm.kind !== 'ram')) w.targetEnemy(e);
      const alive = w.player.crew.lees.filter((l) => l.alive);
      if (d < 90 && w.time >= nextOrder && alive.filter((l) => l.job === 'board').length < Math.round(alive.length * 0.7)) {
        w.order('board');
        nextOrder = w.time + 0.5;
      }
    } else {
      const want = ship === 'longdistance' ? 150 : 90;
      const off = Math.min(120, Math.max(30, 90 - (d - want))) * (Math.PI / 180);
      const h = bearing - off;
      w.player.target = { x: p.x + Math.cos(h) * 60, y: p.y + Math.sin(h) * 60 };
    }
    if (w.time >= nextQuarters) {
      quarters(w, ship);
      monsters(w);
      nextQuarters = w.time + 0.4;
    }
    dodgeRing(w);
    w.step(FIXED_DT);
    if (process.env.SWEEP_TRACE && w.nesses.list.length && Math.floor(w.time * 60) % 180 === 0) {
      console.log(`  t${w.time.toFixed(0)} water ${Math.round(w.player.parts.reduce((x, q) => x + q.water, 0))} alive ${w.player.crew.lees.filter((l) => l.alive).length} jobs ${w.player.crew.lees.map((l) => l.job[0]).join('')} guns ${w.player.guns.map((g) => `${w.gunnerOf(w.player, g) ? 'M' : '-'}${g.load.toFixed(1)}${w.nessTargets().some((x) => w.canHit(w.player, g, w.muzzle(w.player, g), x.part.pos, w.tuning.ness.common.minRangeShare)) ? '!' : ''}`).join(' ')} shells ${w.stats.player.shellsFired}/${w.stats.player.shellsHit} ${w.nesses.list.map((n) => `${n.kind}:${n.state}:${Math.round(n.parts[0].hp)}`).join(' ')}`);
    }
  }
  const won = w.result?.winner === 'player';
  applyFight(run, { won, lees: w.player.crew.lees, enemies: w.enemyOutcomes(), nesses: w.nessOutcomes(), lastEnemy: w.lastEnemyStanding(), joined: w.defectors(), hull: w.player.parts.map((x) => structureFraction(x)) }, t);
  return { won, time: w.time, lost: w.stats.player.leesLost };
}

/** In port: fix up, buy what fits, keep the hold legal. */
function shop(run: RunState, t: Tuning): void {
  buyRepair(run, t);
  buyHealAll(run, t);
  for (const where of ['tavern', 'shop', 'specialty'] as const) {
    (run.port?.stock[where] ?? []).forEach((_, i) => {
      if (where === 'tavern' && run.crew.length >= Math.round(t.ships[run.ship].crewMax * 0.8)) return;
      buy(run, where, i, t);
    });
  }
  autoEquipAll(run, t);
  while (cargo(run).length > Math.round(t.ships[run.ship].cargo)) discard(run, cargo(run)[0].uid);
}

test('run sweep', () => {
  const t = defaultTuning();
  // The captain places its own seek point (like the enemy brain), so no orbit capture.
  t.boat.movement.orbitCapture = 0;
  const rows: string[] = [];
  for (const ship of ['basic', 'longdistance', 'friend', 'hard']) {
    let depth = 0;
    let won = 0;
    let gold = 0;
    let lost = 0;
    let time = 0;
    let fights = 0;
    let timeouts = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const run = newRun(ship, seed, t);
      enterPort(run, makePlan(rngFor(seed, 'first port'), run, t, new Set()), t);
      run.stage = 'port';
      voyage: for (let j = 0; j < JOURNEYS; j++) {
        shop(run, t);
        leavePort(run, 0, t);
        const route = [...run.map!.route.slice(1)];
        for (const stop of route) {
          if (!sailTo(run, stop, t)) break voyage;
          if (run.stage === 'refit') {
            const before = `hull ${Math.round(hullShare(run, t) * 100)}% budget ${run.encounter?.budget} ${run.encounter?.type} vs ${Math.round(playerValue(run))} [${run.encounter?.enemies.map((e) => `${e.ship}/${e.ai}:${Object.values(e.fullLoadout ?? {}).join(",")}`).join(" + ")}]`;
            const r = fight(run, ship, seed, t);
            if (process.env.SWEEP_LOG) console.log(`${ship} s${seed} j${run.journey} ${before} → ${r.won ? 'won' : 'LOST'} ${Math.round(r.time)}s`);
            fights++;
            if (!r.won && r.time >= 400) timeouts++;
            time += r.time;
            lost += r.lost;
            if (run.stage === 'over') break voyage;
          }
          if (run.stage === 'post') {
            const post = run.pending!;
            post.captures.forEach((c, i) => c.options.length && pickCapture(run, i, c.options[0]));
            if (post.surrender) answerSurrender(run, run.crew.length < t.ships[run.ship].crewMax, t);
            if (post.reward.length) takeReward(run, 0, t);
            finishPost(run);
            autoEquipAll(run, t);
            while (cargo(run).length > Math.round(t.ships[run.ship].cargo)) discard(run, cargo(run)[0].uid);
          }
          if (run.stage === 'port') break;
        }
      }
      depth += run.journey + (run.map ? 0.5 : 0);
      won += run.won;
      gold += run.totals.goldEarned;
    }
    rows.push(`${ship.padEnd(13)} journeys ${(depth / SEEDS).toFixed(1)}/${JOURNEYS} · fights won ${(won / SEEDS).toFixed(1)} · gold ${Math.round(gold / SEEDS)} · avg fight ${Math.round(time / Math.max(1, fights))}s · Lees lost ${(lost / SEEDS).toFixed(1)} · runs ended by a 400 s timeout ${timeouts}/${SEEDS}`);
  }
  console.log(rows.join('\n'));
}, 3_600_000);
