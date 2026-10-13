// Placeholder crew art drawn on a plain canvas, so the Phaser scene (textures)
// and the DOM setup screen (data URLs) share one look. Real art replaces the
// Lee figure via LeeDef.art; icons stay code-drawn for now.

import type { ActivityKind } from '../config/lees';

export type IconKind = ActivityKind | 'cannon' | 'gatling' | 'oars' | 'sails' | 'spyglass' | 'pistol' | 'recall';

const INK = '#f6e7c1';
const OUTLINE = '#1a120a';

/** Stick-figure Lee, drawn into a w × h box (feet at the bottom). */
/** Stick-figure Lee. `shirt` tells types apart; `band` (a bandana) marks the enemy crew. */
export function drawLeeFigure(ctx: CanvasRenderingContext2D, w: number, h: number, opts: { ghost?: boolean; shirt?: string; band?: string } = {}): void {
  const s = h / 80;
  const cx = w / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const limbs = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    // Body.
    ctx.moveTo(cx, 26 * s);
    ctx.lineTo(cx, 52 * s);
    // Arms.
    ctx.moveTo(cx - 14 * s, 44 * s);
    ctx.lineTo(cx, 33 * s);
    ctx.lineTo(cx + 14 * s, 44 * s);
    // Legs.
    ctx.moveTo(cx - 11 * s, 76 * s);
    ctx.lineTo(cx, 52 * s);
    ctx.lineTo(cx + 11 * s, 76 * s);
    ctx.stroke();
  };
  if (opts.ghost) {
    ctx.setLineDash([5 * s, 4 * s]);
    limbs(3.5 * s, INK);
    ctx.beginPath();
    ctx.arc(cx, 14 * s, 11 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  limbs(11 * s, OUTLINE);
  limbs(6 * s, opts.shirt ?? '#2b2018');
  // Shirt band across the chest so the figure reads on any deck color.
  ctx.fillStyle = opts.shirt ?? '#c0392b';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.roundRect(cx - 8 * s, 28 * s, 16 * s, 16 * s, 4 * s);
  ctx.fill();
  ctx.stroke();
  // Head.
  ctx.fillStyle = INK;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(cx, 14 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(cx - 4 * s, 13 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.arc(cx + 4 * s, 13 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  if (opts.band) {
    // Bandana: a band over the top of the head and a knot.
    ctx.fillStyle = opts.band;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.arc(cx, 14 * s, 11 * s, Math.PI * 1.05, Math.PI * 1.95);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 9 * s, 8 * s);
    ctx.lineTo(cx + 16 * s, 4 * s);
    ctx.lineTo(cx + 15 * s, 11 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A square icon (size × size), light ink with a dark outline so it reads on decks and water. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, size: number): void {
  const s = size / 64;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const both = (path: () => void, width: number, fill = false) => {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = width + 6;
    path();
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = width;
    path();
    if (fill) ctx.fill();
    ctx.stroke();
  };
  switch (kind) {
    case 'gun':
    case 'cannon':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(10, 30);
        ctx.lineTo(52, 22);
        ctx.lineTo(54, 32);
        ctx.lineTo(12, 40);
        ctx.closePath();
      }, 4, true);
      both(() => {
        ctx.beginPath();
        ctx.arc(24, 44, 9, 0, Math.PI * 2);
      }, 4);
      break;
    case 'row':
    case 'oars':
      for (const flip of [1, -1]) {
        both(() => {
          ctx.beginPath();
          ctx.moveTo(32 - 20 * flip, 8);
          ctx.lineTo(32 + 12 * flip, 44);
        }, 5);
        both(() => {
          ctx.beginPath();
          ctx.ellipse(32 + 16 * flip, 50, 6, 10, -0.7 * flip, 0, Math.PI * 2);
        }, 3, true);
      }
      break;
    case 'sail':
    case 'sails':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(26, 6);
        ctx.lineTo(26, 58);
      }, 4);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(30, 8);
        ctx.quadraticCurveTo(60, 30, 30, 50);
        ctx.closePath();
      }, 3, true);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(10, 56);
        ctx.lineTo(48, 56);
      }, 4);
      break;
    case 'lookout':
    case 'spyglass':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(8, 44);
        ctx.lineTo(48, 18);
        ctx.lineTo(54, 28);
        ctx.lineTo(14, 52);
        ctx.closePath();
      }, 3, true);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(30, 30);
        ctx.lineTo(36, 40);
      }, 3);
      break;
    case 'repair':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(14, 52);
        ctx.lineTo(38, 28);
      }, 8);
      both(() => {
        ctx.beginPath();
        ctx.arc(44, 20, 12, Math.PI * 0.9, Math.PI * 2.6);
      }, 6);
      break;
    case 'bail':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(14, 24);
        ctx.lineTo(50, 24);
        ctx.lineTo(44, 56);
        ctx.lineTo(20, 56);
        ctx.closePath();
      }, 3, true);
      both(() => {
        ctx.beginPath();
        ctx.arc(32, 24, 16, Math.PI, 0);
      }, 3);
      ctx.fillStyle = '#3a9cf0';
      ctx.beginPath();
      ctx.ellipse(32, 30, 14, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'walk':
      for (const [x, y, r] of [[22, 40, -0.3], [42, 22, 0.3]] as const) {
        both(() => {
          ctx.beginPath();
          ctx.ellipse(x, y, 7, 11, r, 0, Math.PI * 2);
        }, 2, true);
      }
      break;
    case 'melee':
      // Crossed swords.
      for (const flip of [1, -1]) {
        both(() => {
          ctx.beginPath();
          ctx.moveTo(32 - 22 * flip, 10);
          ctx.lineTo(32 + 16 * flip, 50);
        }, 5);
        both(() => {
          ctx.beginPath();
          ctx.moveTo(32 + 8 * flip, 50);
          ctx.lineTo(32 + 22 * flip, 40);
        }, 4);
      }
      break;
    case 'board':
      // A sword pointing forward with an arrowhead: going over to fight.
      both(() => {
        ctx.beginPath();
        ctx.moveTo(8, 50);
        ctx.lineTo(50, 14);
      }, 5);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(10, 36);
        ctx.lineTo(22, 50);
      }, 4);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(38, 12);
        ctx.lineTo(54, 10);
        ctx.lineTo(52, 26);
      }, 4);
      break;
    case 'repel':
      // Shield.
      both(() => {
        ctx.beginPath();
        ctx.moveTo(32, 8);
        ctx.lineTo(52, 16);
        ctx.quadraticCurveTo(50, 46, 32, 58);
        ctx.quadraticCurveTo(14, 46, 12, 16);
        ctx.closePath();
      }, 3, true);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(32, 16);
      ctx.lineTo(32, 48);
      ctx.moveTo(20, 28);
      ctx.lineTo(44, 28);
      ctx.stroke();
      break;
    case 'swing':
      // A rope from above, the Lee's arc across.
      both(() => {
        ctx.beginPath();
        ctx.moveTo(32, 4);
        ctx.lineTo(46, 40);
      }, 3);
      both(() => {
        ctx.beginPath();
        ctx.arc(32, 22, 26, Math.PI * 0.85, Math.PI * 0.15, true);
      }, 3);
      both(() => {
        ctx.beginPath();
        ctx.arc(46, 44, 6, 0, Math.PI * 2);
      }, 3, true);
      break;
    case 'recall':
      // Curved arrow back home.
      both(() => {
        ctx.beginPath();
        ctx.arc(32, 36, 18, Math.PI * 1.9, Math.PI * 0.95, true);
      }, 5);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(6, 30);
        ctx.lineTo(15, 42);
        ctx.lineTo(25, 30);
      }, 4);
      break;
    case 'gatling':
      // A bundle of barrels on a swivel.
      for (const dy of [-7, 0, 7]) {
        both(() => {
          ctx.beginPath();
          ctx.moveTo(18, 30 + dy);
          ctx.lineTo(56, 30 + dy * 0.6);
        }, 3.5);
      }
      both(() => {
        ctx.beginPath();
        ctx.arc(18, 30, 10, 0, Math.PI * 2);
      }, 3, true);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(18, 40);
        ctx.lineTo(12, 58);
        ctx.moveTo(18, 40);
        ctx.lineTo(26, 58);
      }, 3);
      break;
    case 'pistol':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(10, 22);
        ctx.lineTo(54, 22);
        ctx.lineTo(54, 32);
        ctx.lineTo(30, 32);
        ctx.lineTo(24, 54);
        ctx.lineTo(12, 52);
        ctx.lineTo(18, 32);
        ctx.lineTo(10, 32);
        ctx.closePath();
      }, 3, true);
      break;
    case 'pump':
      // A hand pump: a box, a handle and a spout.
      both(() => {
        ctx.beginPath();
        ctx.rect(18, 26, 22, 30);
      }, 3, true);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(29, 26);
        ctx.lineTo(29, 12);
        ctx.lineTo(52, 8);
        ctx.moveTo(40, 34);
        ctx.lineTo(54, 34);
      }, 4);
      ctx.fillStyle = '#3a9cf0';
      ctx.beginPath();
      ctx.arc(55, 44, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'powder':
      // A powder keg with a fuse.
      both(() => {
        ctx.beginPath();
        ctx.ellipse(32, 38, 16, 18, 0, 0, Math.PI * 2);
      }, 3, true);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(17, 30);
      ctx.lineTo(47, 30);
      ctx.moveTo(17, 46);
      ctx.lineTo(47, 46);
      ctx.stroke();
      both(() => {
        ctx.beginPath();
        ctx.moveTo(32, 20);
        ctx.quadraticCurveTo(40, 10, 48, 12);
      }, 3);
      ctx.fillStyle = '#ff8a3a';
      ctx.beginPath();
      ctx.arc(49, 11, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'idle':
      both(() => {
        ctx.beginPath();
        ctx.moveTo(14, 22);
        ctx.lineTo(32, 22);
        ctx.lineTo(14, 44);
        ctx.lineTo(32, 44);
      }, 4);
      both(() => {
        ctx.beginPath();
        ctx.moveTo(38, 34);
        ctx.lineTo(50, 34);
        ctx.lineTo(38, 50);
        ctx.lineTo(50, 50);
      }, 3);
      break;
  }
  ctx.restore();
}

const urlCache = new Map<string, string>();

function canvasUrl(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const url = c.toDataURL();
  urlCache.set(key, url);
  return url;
}

export function iconUrl(kind: IconKind): string {
  return canvasUrl(`icon:${kind}`, 64, 64, (ctx) => drawIcon(ctx, kind, 64));
}

/** A Lee's figure as an image URL: supplied art, or the stick figure in its type's shirt. */
export function leeUrl(art: string | null, shirt = '#c0392b', band?: string): string {
  return art ?? canvasUrl(`lee:${shirt}:${band ?? ''}`, 48, 80, (ctx) => drawLeeFigure(ctx, 48, 80, { shirt, band }));
}

/** Station icon by station kind (guns: by gun item, see gunIcon). */
export const STATION_ICON: Record<string, IconKind> = { gun: 'cannon', cannon: 'cannon', gatling: 'gatling', oars: 'oars', sails: 'sails', lookout: 'spyglass', pump: 'pump', powder: 'powder' };

/** Icon for a gun station: the gatling has its own, every other gun the cannon. */
export function gunIcon(item: string | undefined): IconKind {
  return item === 'gatling' ? 'gatling' : 'cannon';
}
