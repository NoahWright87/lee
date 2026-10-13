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
// ship's style: the Friend Ship targets the enemy (the BOARD/RAM autopilot)
// and sends most of its crew to ⚔️ as it closes, the Long Distance Relation
// Ship orbits at long-gun range, the rest orbit at cannon range. It never
// dodges, kites or retreats, so a person does better: read the numbers as
// "how hard is this for someone not trying". A fight still going at 400 s
// counts as a loss (usually a skirmisher it never catches); SWEEP_LOG=1 prints
// every fight.

import { test } from 'vitest';
import { defaultTuning, type Tuning } from '../src/config/tuning';
import { structureFraction } from '../src/sim/boat';
import { rngFor } from '../src/sim/math';
import { buy, buyHealAll, buyRepair, enterPort, makePlan } from '../src/sim/port';
import { answerSurrender, applyFight, hullShare, autoEquipAll, cargo, discard, enemySetups, finishPost, newRun, setupFor, takeReward, type RunState } from '../src/sim/run';
import { leavePort, playerValue, sailTo } from '../src/sim/seaMap';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

const SEEDS = Math.max(1, Number(process.env.SWEEP_SEEDS ?? 4));
const JOURNEYS = Math.max(1, Number(process.env.SWEEP_JOURNEYS ?? 3));

/** Fight the set-up encounter with the scripted captain. */
function fight(run: RunState, ship: string, seed: number, t: Tuning): { won: boolean; time: number; lost: number } {
  const w = new World(t, seed * 977 + run.fight, { player: setupFor(run, t), enemies: enemySetups(run, t), assists: false, carry: { hp: run.hull, water: run.hull.map(() => 0) } });
  w.start();
  let nextOrder = 0;
  while (w.phase !== 'over' && w.time < 400) {
    const e = w.liveEnemies()[0] ?? w.enemies[0];
    const p = w.player.motion;
    const bearing = Math.atan2(e.motion.y - p.y, e.motion.x - p.x);
    const d = Math.hypot(e.motion.x - p.x, e.motion.y - p.y);
    if (ship === 'friend') {
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
    w.step(FIXED_DT);
  }
  const won = w.result?.winner === 'player';
  applyFight(run, { won, lees: w.player.crew.lees, enemies: w.enemyOutcomes(), lastEnemy: w.lastEnemyStanding(), hull: w.player.parts.map((x) => structureFraction(x)) }, t);
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
