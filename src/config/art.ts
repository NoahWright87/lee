// Art manifest. Every slot is optional: leave it null and the game draws a
// placeholder in code. To drop in real art, put files in /public/art and set
// the path here (relative to the site root, e.g. 'art/bow.png'). No code changes.
//
// PART SPRITES
//   Top-down, bow pointing RIGHT, transparent background. The image is stretched
//   to the part's bounding box in the boat layout (src/config/boats.ts), so draw
//   at the same aspect ratio. Sloop part boxes (length × width, meters):
//     bow      7 × 10      midship 12 × 3.33
//     cannon  12 × 3.33    stern    9 × 10
//   Suggested resolution: 24 px per meter (e.g. midship 288 × 80 px).
//   The deck grid (5 × 3 tiles of 4 × 3.33 m) sits on top of these.
//
// LEES
//   Set `art` on a Lee type in src/config/lees.ts: a standing figure, feet at
//   the bottom, about 3:5 (e.g. 96 × 160 px). Drawn ~1.25 × 2 m on deck.
//   The cannon sprite is drawn as the PORT section (top edge = outboard side);
//   the starboard section uses the same image flipped.
//
// CRACKS
//   One generic set for every part: 3–4 transparent images, least to most
//   damaged. Each stage is tiled at `crackPxPerMeter` and trimmed to each part's
//   outline automatically. Stages stack (stage 3 draws over 1 and 2).
//
// CANNON
//   One barrel image, pointing RIGHT (muzzle on the right), ~2.6 m × 0.8 m.

export interface ArtManifest {
  /** Separate sets so player and enemy can look different. Falls back to `player`. */
  parts: Record<'player' | 'enemy', Partial<Record<'bow' | 'midship' | 'stern' | 'cannon', string | null>>>;
  cracks: (string | null)[];
  crackPxPerMeter: number;
  cannonBarrel: string | null;
}

export const ART: ArtManifest = {
  parts: {
    player: { bow: null, midship: null, stern: null, cannon: null },
    enemy: { bow: null, midship: null, stern: null, cannon: null },
  },
  cracks: [null, null, null, null],
  crackPxPerMeter: 24,
  cannonBarrel: null,
};

/** Pixels per meter for textures generated in code. */
export const GEN_PPM = 24;
