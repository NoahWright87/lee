import Phaser from 'phaser';
import { BattleScene } from './game/BattleScene';
import { Controller } from './game/Controller';
import { Hud, measureLayout } from './ui/hud';
import './ui/style.css';

const controller = new Controller();
const app = document.getElementById('app')!;
const rotate = document.getElementById('rotate')!;
const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

const initial = measureLayout();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d2c4d',
  banner: false,
  scale: {
    mode: Phaser.Scale.NONE,
    width: Math.round(initial.width * dpr),
    height: Math.round(initial.height * dpr),
    zoom: 1 / dpr,
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 3 },
});
game.registry.set('dpr', dpr);
game.scene.add('battle', BattleScene, true, { controller });

new Hud(document.getElementById('hud')!, controller);

function applyLayout(): void {
  const { width, height, blocked } = measureLayout();
  app.style.width = `${width}px`;
  app.style.height = `${height}px`;
  rotate.classList.toggle('hidden', !blocked);
  controller.blocked = blocked;
  game.scale.setZoom(1 / dpr);
  game.scale.resize(Math.round(width * dpr), Math.round(height * dpr));
}

applyLayout();
window.addEventListener('resize', applyLayout);
window.addEventListener('orientationchange', () => setTimeout(applyLayout, 100));
// Block page scroll/zoom gestures on mobile, except inside panels that scroll.
const SCROLLERS = '.screen, .tune-body, .result-card, .lee-card, .setup-below, .refit-top';
document.addEventListener(
  'touchmove',
  (e) => {
    const t = e.target as Element | null;
    if (!t?.closest?.(SCROLLERS)) e.preventDefault();
  },
  { passive: false },
);

// Handy for poking at state from the console while tuning.
(window as unknown as { lee: unknown }).lee = { controller, game };
