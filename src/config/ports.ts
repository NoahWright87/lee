// Ports are data: which services exist, how often a port has each, what a
// specialty can be, and the names ports are built from. A new service or
// specialty is an entry here plus (for a service) its panel in the port screen.

import { LEE_DEFS } from './lees';
import { TAGS } from './tags';

export type ServiceId = 'shipwright' | 'tavern' | 'shop' | 'specialty' | 'dealer' | 'shipyard' | 'bank';

export interface ServiceDef {
  id: ServiceId;
  name: string;
  icon: string;
  /** One line on the destination card and the port's tab. */
  text: string;
  /** Chance a generated port has it (1 = always). */
  chance: number;
}

export const SERVICES: Record<ServiceId, ServiceDef> = {
  shipwright: { id: 'shipwright', name: 'Shipwright', icon: '🔨', text: 'Repair the hull', chance: 1 },
  tavern: { id: 'tavern', name: 'Tavern', icon: '🍺', text: 'Heal and hire Lees', chance: 1 },
  shop: { id: 'shop', name: 'Shop', icon: '🛒', text: 'Buy parts; sell anything', chance: 0.85 },
  specialty: { id: 'specialty', name: 'Specialty shop', icon: '⭐', text: 'Stock that leans on the specialty', chance: 0.6 },
  dealer: { id: 'dealer', name: 'Trinket dealer', icon: '🔮', text: 'Rare trinkets and treasures, dear', chance: 0.2 },
  shipyard: { id: 'shipyard', name: 'Shipyard', icon: '⚓', text: 'Buy a new hull', chance: 0.35 },
  bank: { id: 'bank', name: 'Bank', icon: '🏦', text: 'Interest on gold you carry out', chance: 0.4 },
};

export const SERVICE_ORDER: ServiceId[] = ['shop', 'specialty', 'dealer', 'tavern', 'shipwright', 'shipyard', 'bank'];

/** A specialty: a tag (Barrage: a gunsmith port) or a Lee type (a port full of Hard Lees). */
export type Specialty = { kind: 'tag'; id: string } | { kind: 'lee'; id: string };

export function specialtyName(s: Specialty): string {
  if (s.kind === 'tag') return (TAGS as Record<string, { name: string }>)[s.id]?.name ?? s.id;
  return `${LEE_DEFS[s.id]?.name ?? s.id}s`;
}

/** Every specialty a port can have, with a base weight (your build adds to it). */
export function specialtyPool(): [Specialty, number][] {
  const out: [Specialty, number][] = Object.keys(TAGS).map((id) => [{ kind: 'tag', id }, 3]);
  for (const d of Object.values(LEE_DEFS)) if (d.draftWeight > 0) out.push([{ kind: 'lee', id: d.id }, 1]);
  return out;
}

/** Shop sizes. */
export const STOCK = { shop: 6, specialty: 5, dealer: 3, tavern: 3 };

/** Port names: "{first} {second}". Placeholders until the lore pass. */
export const PORT_NAME_FIRST = ['Port', 'Fort', 'Saint', 'Old', 'New', 'Cape', 'Little', 'Upper', 'Lower', 'Bay of'];
export const PORT_NAME_SECOND = ['Lee', 'Barnacle', 'Gull', 'Plank', 'Kettle', 'Tarry', 'Rope', 'Biscuit', 'Anchor', 'Mizzen', 'Brine', 'Lantern', 'Pickle', 'Hammock', 'Doubloon'];
