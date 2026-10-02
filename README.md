# Lee: Ranged Combat Prototype

This prototype exists to answer one question: **is it fun to steer a boat with one thumb while it fights automatically, and can you read its damage state on a second panel?** See [`docs/PRD.md`](docs/PRD.md) for the full brief.

The earlier grid autobattler lives in [`legacy/`](legacy/). It is not part of the build.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (--host is on, so your phone on the same Wi-Fi can open it)
npm test           # simulation unit tests (vitest)
npm run build      # typecheck + production build to dist/ (what Netlify deploys)
```

Stack: TypeScript, [Phaser 3](https://phaser.io), Vite, lil-gui for the tuning panel, and Vitest.

## Playing

| Input | What it does |
|---|---|
| Touch and hold the ocean (top panel) | The boat seeks that point. A dashed line previews the next few seconds of movement. |
| Drag | The target follows your finger. |
| Release | The boat holds its current heading. |
| Hold close to a boat (or any point) | The boat settles into an orbit with that point on its beam, which is where the cannons fire. |
| Bottom strip | View only: your boat, bow to the right, showing HP, cracks, water and gun state. |
| **Tune** / **Debug** / **1x 2x** | Tuning panel, debug overlay (arcs, ranges, hitboxes, seek points, every shell's landing spot), and game speed. |

**Fights and progression.** Win a fight and the next one starts after a short countdown (or tap **Next fight**), with one more enemy ship each time, up to a cap. Sinking ends the run; **Again** starts over from fight 1. The pill at the top shows the fight number and how many ships are left. By default you start every fight with a fully repaired boat.

Cannons load and fire on their own when the target is inside their arc. Enemy shells mark their landing spot with a **red X** and a ring that shrinks until impact. Shells fly to a fixed point and hit whatever is there when they land. The enemy aims where you're going, so turning dodges.

## How the code is laid out

```
src/
  config/
    tuning.ts      every gameplay number (one place; the sliders are built from it)
    boats.ts       boat layouts as data: part shapes, roles, stat blocks, adjacency
    art.ts         art manifest (all null = placeholder art drawn in code)
  sim/             pure TypeScript game rules, no Phaser imports, deterministic
    steering.ts    "seek this point" + orbit; shared by player, enemy and path preview
    boat.ts        parts, layered damage, flooding, bilge, derived movement stats
    telegraph.ts   general "something lands here in N seconds" system (the red X)
    world.ts       the one world: any number of enemies, their brains, cannons, lead targeting,
                   threat budget, shells, sinking, stats, fight setup and carry-over
  game/
    BattleScene.ts one Phaser scene, two cameras (ocean + strip) reading the same world
    BoatView.ts    draws a boat: part sprites, crack overlays, deck water, barrels
    textures.ts    placeholder art + trimming crack art to each part's outline
    Controller.ts  current world, fight number and run progress, live tuning, presets, speed/debug
  ui/              DOM HUD, result screen, tuning panel, rotate overlay
tests/             steering/orbit/preview, damage & flooding, world rules
```

How the code meets the PRD's design-for-later constraints (§13):

- **Two views, one world.** The ocean and strip are two Phaser cameras on the same scene and the same `World`.
- **Shared steering.** `stepMotion` is the only movement code. The enemy feeds it a seek point. The path preview calls `predictPath`, which loops over `stepMotion`, and a test checks that the two match exactly.
- **Parts are data.** Each part's stats come from `tuning.<side>.parts`. Its shape, role and neighbors come from `config/boats.ts`.
- **Layered damage.** Each part has a `layers` stack, with its structure at the bottom. Damage hits the top layer first and carries over to the next. Armor can be added later as extra layers.
- **Reusable telegraphs.** `TelegraphSystem.add(kind, pos, warnTime)` makes a red X for any threat, each with its own warning time.
- **One place for numbers.** All tunables live in `config/tuning.ts`.

## Tuning

- Open **Tune** during a fight or from the result screen. Values save to the browser as you change them.
- Most values take effect immediately. Values marked *(next run)*, including the whole **Parts** folder, apply on the next fight.
- **Presets** let you save, load or delete named presets, export the tuning as JSON to your clipboard, import it by pasting, or reset to defaults.
- `playerAdvantage` multiplies the player's HP, divides their reload time and leak multipliers, and multiplies their turn rate by its square root. The enemy also starts with a slower, less agile hull (`enemy.movement`).
- The dodge window is set by `cannons.flightTimeBase` + `flightTimePerMeter × distance`, with `telegraph.minWarningTime` as the floor for enemy shells. Accuracy comes from lead targeting plus `cannons.spread`, tuned separately for each side.
- Orbiting is controlled by `movement.orbitRadiusScale` and `movement.orbitCapture`. Setting `orbitCapture = 0` gives plain point-seeking, where the boat loops through the point instead of circling it.
- **Several attackers** (**Fights & progression** folder):
  - **Ship count:** `firstFightEnemies`, `enemiesAddedPerFight` and `maxEnemies` set how many ships each fight has.
  - **Threat budget:** `maxIncomingShells` (default 3) caps how many enemy shells, and so how many red X's, can be in the air at once. A loaded enemy gun waits for a free slot, so a pack stays dodgeable.
  - **Pack scaling:** `packHullScaling` and `packReloadScaling` (default 0.8) give each ship in a bigger pack a lighter hull and a slower reload. More ships means more pressure from more directions, but not N times the damage. Set both to 0 for full-strength packs.
  - **Between fights:** `repairBetweenFights` (1 = fresh boat, 0 = keep all damage) and `nextFightDelay`.
  - **Crossfire:** `friendlyFire = 1` lets enemy shells hit other enemies.
  - **Spacing:** each enemy holds its own range (`enemyAI.rangeJitter`) and steers away from packmates closer than `enemyAI.spacing`.
- `input.targetFollowsCamera = 1` keeps the target under a still finger as the camera pans. The preview then becomes approximate, because the target moves with the camera.

## Adding art

Edit `src/config/art.ts` and drop files into `public/art/`. Each slot is optional; an empty one falls back to the placeholder. Part sprites are drawn top-down with the bow pointing right and stretched to fit the part's bounding box. You only supply one generic set of crack images: the game tiles them and trims them to each part's outline. Sizes and conventions are documented in `art.ts`.
