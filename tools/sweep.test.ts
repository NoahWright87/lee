// Quick run simulation (a tuning tool, not a test): a scripted captain sails
// each ship through the temporary encounter list and prints wins, fight length
// and Lees lost. Use it to compare how fast the enemy ramps against a crew of
// about the level and size a player has by then.
//
//   npm run sweep              (SWEEP_SEEDS=6 by default)
//
// Each run starts from the ship's preset crew, plus a Lee every other fight
// and a level every other fight. The captain plays each ship's intended style:
// the Friend Ship targets the enemy (the BOARD/RAM autopilot) and sends most
// of its crew to ⚔️ as it closes, the Long Distance Relation Ship orbits at
// long-gun range, the rest orbit at cannon range. It never dodges, kites or
// retreats, so a person does better: read the numbers as "how hard is this
// fight for someone not trying".

import { test } from 'vitest';
import { ENCOUNTERS } from '../src/config/encounters';
import { defaultTuning } from '../src/config/tuning';
import { addCrew, autoEquipAll, enemySetups, newRun, setupFor } from '../src/sim/run';
import { FIXED_DT } from '../src/sim/steering';
import { World } from '../src/sim/world';

const SEEDS = Math.max(1, Number(process.env.SWEEP_SEEDS ?? 6));
const FIGHTS = Math.max(1, Number(process.env.SWEEP_FIGHTS ?? ENCOUNTERS.length + 2));

test('run sweep', () => {
  const t = defaultTuning();
  // The captain places its own seek point (like the enemy brain), so no orbit capture.
  t.boat.movement.orbitCapture = 0;
  const rows: string[] = [];
  for (const ship of ['basic', 'longdistance', 'friend', 'hard']) {
    for (let f = 1; f <= FIGHTS; f++) {
      let wins = 0;
      let time = 0;
      let lost = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const run = newRun(ship, seed, t);
        // A plausible crew by fight f: the preset, plus one Lee and one level every other fight.
        const level = 1 + Math.floor((f - 1) / 2);
        for (const m of run.crew) m.level = level;
        const types = ['quick', 'handy', 'deft', 'loud', 'hard', 'basic'];
        for (let i = 0; i < Math.floor((f - 1) / 2); i++) addCrew(run, types[i % types.length], level, t);
        autoEquipAll(run, t);
        run.fight = f;
        const w = new World(t, seed, { player: setupFor(run, t), enemies: enemySetups(run, t), assists: false });
        w.start();
        let dir = 0;
        let nextOrder = 0;
        while (w.phase !== 'over' && w.time < 400) {
          const e = w.liveEnemies()[0] ?? w.enemies[0];
          const p = w.player.motion;
          const bearing = Math.atan2(e.motion.y - p.y, e.motion.x - p.x);
          const d = Math.hypot(e.motion.x - p.x, e.motion.y - p.y);
          if (dir === 0) dir = 1;
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
            const h = bearing - dir * off;
            w.player.target = { x: p.x + Math.cos(h) * 60, y: p.y + Math.sin(h) * 60 };
          }
          w.step(FIXED_DT);
        }
        if (w.result?.winner === 'player') wins++;
        time += w.time;
        lost += w.stats.player.leesLost;
      }
      rows.push(`${ship.padEnd(10)} fight ${f}: wins ${wins}/${SEEDS} · avg ${Math.round(time / SEEDS)}s · Lees lost ${lost}`);
    }
  }
  console.log(rows.join('\n'));
}, 3_600_000);
