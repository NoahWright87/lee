// Placeholder art drawn in code, plus the step that trims crack art to each
// part's outline. Real art (src/config/art.ts) replaces the generated parts.

import Phaser from 'phaser';
import { ART, GEN_PPM } from '../config/art';
import type { BoatLayout, PartDef } from '../config/boats';
import { LEE_DEFS } from '../config/lees';
import type { Side } from '../config/tuning';
import { polygonBounds, Rng, type Vec } from '../sim/math';
import { drawIcon, drawLeeFigure, type IconKind } from '../ui/crewArt';

export const CRACK_STAGES = Math.max(1, ART.cracks.length);
const PAD = 2;

interface Palette {
  deck: Record<PartDef['art'], string>;
  plank: string;
  outline: string;
  trim: string;
  detail: string;
}

const PALETTES: Record<Side, Palette> = {
  player: {
    deck: { bow: '#c99a62', midship: '#b9874f', stern: '#a8763f', cannon: '#8d6a48' },
    plank: 'rgba(60,35,15,0.28)',
    outline: '#2b1a0e',
    trim: '#f2c14e',
    detail: '#5b3a1f',
  },
  enemy: {
    deck: { bow: '#6f6460', midship: '#625650', stern: '#574a44', cannon: '#4a403c' },
    plank: 'rgba(0,0,0,0.3)',
    outline: '#120c0a',
    trim: '#e8e0cf',
    detail: '#2b2320',
  },
};

export function artKey(side: Side, slot: PartDef['art']): string {
  return `art:${side}:${slot}`;
}

/** Queue any art files from the manifest. Call from preload(). */
export function preloadArt(scene: Phaser.Scene): void {
  for (const side of ['player', 'enemy'] as const) {
    for (const [slot, path] of Object.entries(ART.parts[side])) {
      if (path) scene.load.image(artKey(side, slot as PartDef['art']), path);
    }
  }
  ART.cracks.forEach((path, i) => {
    if (path) scene.load.image(`art:crack:${i}`, path);
  });
  if (ART.cannonBarrel) scene.load.image('art:barrel', ART.cannonBarrel);
  for (const def of Object.values(LEE_DEFS)) if (def.art) scene.load.image(`art:lee:${def.id}`, def.art);
}

const ICONS: IconKind[] = ['gun', 'row', 'sail', 'lookout', 'repair', 'bail', 'walk', 'idle', 'cannon', 'oars', 'sails', 'spyglass'];

/** Texture key for a Lee type's figure (supplied art or the stick figure). */
export function leeTextureKey(scene: Phaser.Scene, defId: string): string {
  const art = `art:lee:${defId}`;
  return scene.textures.exists(art) ? art : 'lee:figure';
}

/** Lee figure, ghost outline, and every task/station icon. */
export function buildCrewTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h)!;
    draw(tex.getContext());
    tex.refresh();
  };
  make('lee:figure', 96, 160, (ctx) => drawLeeFigure(ctx, 96, 160));
  make('lee:ghost', 96, 160, (ctx) => drawLeeFigure(ctx, 96, 160, { ghost: true }));
  for (const k of ICONS) make(`icon:${k}`, 96, 96, (ctx) => drawIcon(ctx, k, 96));
}

export function partTextureKey(side: Side, layout: BoatLayout, part: PartDef): string {
  return `part:${side}:${layout.id}:${part.id}`;
}

export function crackTextureKey(layout: BoatLayout, part: PartDef, stage: number): string {
  return `crack:${layout.id}:${part.id}:${stage}`;
}

/** Whether a part uses supplied art (true) or a generated texture (false). */
export function suppliedArt(scene: Phaser.Scene, side: Side, part: PartDef): string | null {
  const own = artKey(side, part.art);
  if (scene.textures.exists(own)) return own;
  const fallback = artKey('player', part.art);
  return scene.textures.exists(fallback) ? fallback : null;
}

function canvasFor(scene: Phaser.Scene, key: string, poly: readonly Vec[], ppm: number) {
  const b = polygonBounds(poly);
  const w = Math.ceil((b.maxX - b.minX) * ppm) + PAD * 2;
  const h = Math.ceil((b.maxY - b.minY) * ppm) + PAD * 2;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  const map = (p: Vec) => ({ x: (p.x - b.minX) * ppm + PAD, y: (p.y - b.minY) * ppm + PAD });
  const path = () => {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const q = map(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
  };
  return { tex, ctx, w, h, map, path, bounds: b };
}

/** Generate deck textures for every part of a layout (skipping parts with supplied art). */
export function buildPartTextures(scene: Phaser.Scene, layout: BoatLayout, side: Side): void {
  const pal = PALETTES[side];
  for (const part of layout.parts) {
    if (suppliedArt(scene, side, part)) continue;
    const ppm = GEN_PPM;
    const { tex, ctx, w, h, map, path } = canvasFor(scene, partTextureKey(side, layout, part), part.polygon, ppm);

    path();
    ctx.fillStyle = pal.deck[part.art];
    ctx.fill();

    // Planks along the length, clipped to the part.
    ctx.save();
    path();
    ctx.clip();
    ctx.strokeStyle = pal.plank;
    ctx.lineWidth = 1;
    for (let y = PAD + ppm * 0.6; y < h; y += ppm * 0.6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    drawPartDetail(ctx, part, pal, map, ppm);
    ctx.restore();

    // Team trim then outline.
    path();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = Math.max(3, ppm * 0.3);
    ctx.stroke();
    path();
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(1.5, ppm * 0.1);
    ctx.stroke();
    tex.refresh();
  }
}

function drawPartDetail(
  ctx: CanvasRenderingContext2D,
  part: PartDef,
  pal: Palette,
  map: (p: Vec) => Vec,
  ppm: number,
): void {
  const b = polygonBounds(part.polygon);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  ctx.fillStyle = pal.detail;
  ctx.strokeStyle = pal.detail;
  switch (part.art) {
    case 'bow': {
      // Bowsprit and anchor hatch.
      const a = map({ x: b.minX + 1, y: 0 });
      const t = map({ x: b.maxX, y: 0 });
      ctx.lineWidth = ppm * 0.35;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      const hatch = map({ x: b.minX + 1.2, y: -1 });
      ctx.fillRect(hatch.x, hatch.y, ppm * 1.6, ppm * 2);
      break;
    }
    case 'midship': {
      // Mast and two cargo hatches.
      const m = map({ x: cx + 1, y: cy });
      ctx.beginPath();
      ctx.arc(m.x, m.y, ppm * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.trim;
      ctx.beginPath();
      ctx.arc(m.x, m.y, ppm * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.detail;
      for (const hx of [b.minX + 1, b.maxX - 3.2]) {
        const p = map({ x: hx, y: cy - 1.1 });
        ctx.fillRect(p.x, p.y, ppm * 2.2, ppm * 2.2);
      }
      break;
    }
    case 'cannon': {
      // Gun-deck: a dark rail along the outboard edge with port hatches.
      const outboard = (part.broadside ?? -1) < 0 ? b.minY : b.maxY;
      const rail = map({ x: b.minX, y: outboard });
      const railH = ppm * 0.6;
      ctx.fillRect(rail.x, (part.broadside ?? -1) < 0 ? rail.y : rail.y - railH, (b.maxX - b.minX) * ppm, railH);
      for (let x = b.minX + 1; x < b.maxX - 1; x += 2.4) {
        const p = map({ x, y: cy - 0.5 });
        ctx.fillRect(p.x, p.y, ppm * 1.2, ppm * 1);
      }
      break;
    }
    case 'stern': {
      // Engine housing, rudder post, and cabin.
      const e = map({ x: cx - 0.5, y: cy - 2.2 });
      ctx.fillRect(e.x, e.y, ppm * 4, ppm * 4.4);
      ctx.fillStyle = pal.trim;
      for (let i = 0; i < 3; i++) {
        const g = map({ x: cx, y: cy - 1.6 + i * 1.3 });
        ctx.fillRect(g.x, g.y, ppm * 3, ppm * 0.35);
      }
      ctx.fillStyle = pal.detail;
      const r = map({ x: b.minX, y: -0.4 });
      ctx.fillRect(r.x, r.y, ppm * 1.4, ppm * 0.8);
      break;
    }
  }
}

/** Crack overlays per part and stage: supplied crack art trimmed to the outline, or generated cracks. */
export function buildCrackTextures(scene: Phaser.Scene, layout: BoatLayout): void {
  for (const part of layout.parts) {
    for (let stage = 0; stage < CRACK_STAGES; stage++) {
      const art = `art:crack:${stage}`;
      const ppm = GEN_PPM;
      const { tex, ctx, w, h, map, path } = canvasFor(scene, crackTextureKey(layout, part, stage), part.polygon, ppm);
      ctx.save();
      path();
      ctx.clip();
      if (scene.textures.exists(art)) {
        const src = scene.textures.get(art).getSourceImage() as CanvasImageSource & { width: number; height: number };
        const k = ppm / ART.crackPxPerMeter;
        // Tile the generic crack art, offset per part so seams differ.
        const ox = -((part.id.length * 37) % Math.max(1, src.width * k));
        for (let x = ox; x < w; x += src.width * k) {
          for (let y = 0; y < h; y += src.height * k) ctx.drawImage(src, x, y, src.width * k, src.height * k);
        }
      } else {
        drawGeneratedCracks(ctx, part, stage, map, ppm);
      }
      ctx.restore();
      tex.refresh();
    }
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function drawGeneratedCracks(
  ctx: CanvasRenderingContext2D,
  part: PartDef,
  stage: number,
  map: (p: Vec) => Vec,
  ppm: number,
): void {
  const rng = new Rng(hashString(part.id) + stage * 7919);
  const b = polygonBounds(part.polygon);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const cracks = Math.max(1, Math.round((area / 30) * (1 + stage * 0.5)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < cracks; i++) {
    let p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
    let a = rng.range(0, Math.PI * 2);
    const segs = 4 + Math.floor(rng.next() * 4);
    ctx.strokeStyle = 'rgba(20,10,4,0.9)';
    ctx.lineWidth = Math.max(1.5, ppm * (0.08 + stage * 0.03));
    ctx.beginPath();
    let q = map(p);
    ctx.moveTo(q.x, q.y);
    for (let s = 0; s < segs; s++) {
      a += rng.range(-0.9, 0.9);
      const l = rng.range(0.5, 1.4);
      p = { x: p.x + Math.cos(a) * l, y: p.y + Math.sin(a) * l };
      q = map(p);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  // Later stages punch holes.
  const holes = stage >= 1 ? stage + Math.floor(area / 40) : 0;
  for (let i = 0; i < holes; i++) {
    const c = map({ x: rng.range(b.minX + 0.6, b.maxX - 0.6), y: rng.range(b.minY + 0.4, b.maxY - 0.4) });
    const r = ppm * rng.range(0.35, 0.6 + stage * 0.15);
    ctx.fillStyle = 'rgba(230,200,150,0.55)';
    jaggedCircle(ctx, c, r * 1.35, rng);
    ctx.fillStyle = 'rgba(8,4,2,0.95)';
    jaggedCircle(ctx, c, r, rng);
  }
}

function jaggedCircle(ctx: CanvasRenderingContext2D, c: Vec, r: number, rng: Rng): void {
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.65, 1.15);
    const x = c.x + Math.cos(a) * rr;
    const y = c.y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Subtle tileable wave texture. */
export function buildWaterTexture(scene: Phaser.Scene, key = 'water'): void {
  const size = 256;
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#0d2c4d';
  ctx.fillRect(0, 0, size, size);
  const rng = new Rng(42);
  // Soft blotches for depth variation (drawn wrapped so the tile is seamless).
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(14, 40);
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, rng.next() > 0.5 ? 'rgba(30,80,130,0.18)' : 'rgba(5,20,40,0.18)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  // Little wave crests.
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const w = rng.range(6, 16);
    ctx.strokeStyle = `rgba(150,200,240,${rng.range(0.12, 0.3).toFixed(2)})`;
    ctx.lineWidth = rng.range(1, 2);
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + dx - w, y + dy);
        ctx.quadraticCurveTo(x + dx, y + dy - w * 0.35, x + dx + w, y + dy);
        ctx.stroke();
      }
    }
  }
  tex.refresh();
}

/** Small textures for particles. */
export function buildParticleTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h)!;
    draw(tex.getContext());
    tex.refresh();
  };
  make('chip', 8, 4, (ctx) => {
    ctx.fillStyle = '#d9a86a';
    ctx.fillRect(0, 0, 8, 4);
    ctx.fillStyle = '#7a4f24';
    ctx.fillRect(0, 3, 8, 1);
  });
  make('dot', 16, 16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
  make('ring', 32, 32, (ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.stroke();
  });
}
