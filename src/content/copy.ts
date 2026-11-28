/**
 * Game copy: the menu and help words people read in Lee, kept in one place so
 * they are easy to find and rewrite.
 *
 * Every entry says who wrote it:
 *   - `author: "ai"`   — drafted by an AI assistant. Fair game for a rewrite.
 *   - `author: "noah"` — written (or rewritten and approved) by Noah. Leave it alone.
 *
 * When Noah rewrites an entry, change its `text` and flip `author` to "noah".
 * If he reads an AI entry and is happy with it as is, flipping `author` is enough.
 * New menu or help copy goes here too, marked "ai" until he's had a go at it.
 *
 * Only the page, the menus and the help hints live here. Game data and the
 * in-game screens keep their own words and aren't marked yet:
 *   - `src/config/*.ts` (ships, Lees, items, Nesses, slots, ports, difficulty blurbs)
 *   - `src/sim/*.ts`    (event text, crew lines)
 *   - `src/ui/*.ts`     (results, level-ups, rewards, run over, port, refit, HUD)
 *
 * The page title and the rotate message in `index.html` are filled in from here
 * at build time (see `vite.config.ts`).
 *
 * Plain data only: no imports, so tools and tests can read it.
 */

export type Author = "ai" | "noah";

export interface CopyEntry {
  readonly author: Author;
  readonly text: string;
}

export const COPY = {
  page: {
    title: { author: "ai", text: "Lee — Ranged Combat Prototype" },
    rotate: { author: "ai", text: "Rotate your phone to portrait" },
  },

  mainMenu: {
    title: { author: "ai", text: "Lee" },
    subtitle: { author: "ai", text: "Choose a ship, crew it with Lees, and see how far you get." },
    newRun: { author: "ai", text: "New Run" },
    saveTooOld: { author: "ai", text: "This saved run is from an older version and can’t be continued." },
    saveUnreadable: { author: "ai", text: "The saved run couldn’t be read, so it can’t be continued." },
    resetSavedData: { author: "ai", text: "Reset saved data" },
    resetSavedDataConfirm: { author: "ai", text: "Reset all saved data? (Named tuning presets are kept.)" },
  },

  /** The ⚙️ menu, on every screen. */
  systemMenu: {
    oceanView: { author: "ai", text: "Ocean view (top)" },
    deckView: { author: "ai", text: "Deck view (bottom)" },
    restartRun: { author: "ai", text: "Restart Run" },
    restartRunConfirm: { author: "ai", text: "Abandon this run and choose a new ship? It can’t be undone." },
    mainMenu: { author: "ai", text: "Main menu" },
    resetAll: { author: "ai", text: "Reset All Saved Data" },
    resetAllConfirm: {
      author: "ai",
      text: "Wipe the saved run, the sandbox and your current tuning? (Named tuning presets are kept.) This can’t be undone.",
    },
  },

  chooseShip: {
    heading: { author: "ai", text: "Choose a ship" },
    subtitle: { author: "ai", text: "Each comes crewed and fitted. You start in port." },
    customText: {
      author: "ai",
      text: "Start in a port with every service and a wide stock. Buy a hull, hire a crew, fit it out, then sail.",
    },
  },

  seaMap: {
    hint: { author: "ai", text: "Tap a stop to see it. Stops inside the circle are one hop away." },
  },
} as const satisfies CopyTree;

/** Any nesting of entries, arrays of entries and groups. */
type CopyTree = { readonly [key: string]: CopyEntry | readonly CopyEntry[] | CopyTree };
