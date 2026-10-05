// Tags are data only in this phase: every item, ship and Lee type can carry
// them, the game counts them across a boat and its crew (debug overlay), and
// cards show them. Nothing gives a bonus for them yet. A new tag is a new
// entry here.

export const TAGS = {
  skirmish: { name: 'Skirmish', color: '#5fb3e8' },
  board: { name: 'Board', color: '#e86a5f' },
  barrage: { name: 'Barrage', color: '#f2c14e' },
  bulwark: { name: 'Bulwark', color: '#9fd08a' },
} as const satisfies Record<string, { name: string; color: string }>;

export type Tag = keyof typeof TAGS;

export function tagName(t: string): string {
  return (TAGS as Record<string, { name: string }>)[t]?.name ?? t;
}

/** Count tags over any number of tagged things. */
export function countTags(lists: readonly (readonly string[])[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of lists) for (const t of list) out[t] = (out[t] ?? 0) + 1;
  return out;
}
