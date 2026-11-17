import type { LabRecipeDef } from '@whale/core'
import { L10N } from './l10n/table'

export const LAB_RECIPES: readonly LabRecipeDef[] = [
  {
    id: 'jump-fuel',
    category: 'fuel',
    name: '超空间折跃燃料',
    outputItemId: 'jump-fuel',
    outputUnits: 600,
    cycleMs: 5 * 60 * 1000,
    materials: [
      { itemId: 'min-jumplasma', units: 60 },
      { itemId: 'min-cryoslurry', units: 60 },
      { itemId: 'min-curvature', units: 12 },
      { itemId: 'min-voidcrystal', units: 60 },
      { itemId: 'min-isotope', units: 100 },
    ],
  },
  {
    id: 'synaptic-accelerant',
    category: 'accelerant',
    name: L10N['item.factionBeacon.009']!.zh,
    outputItemId: 'synaptic-accelerant',
    outputUnits: 1,
    cycleMs: 30 * 60 * 1000,
    materials: [
      { itemId: 'min-voidcrystal', units: 2_100 },
      { itemId: 'min-curvature', units: 400 },
      { itemId: 'min-isotope', units: 4_000 },
    ],
  },
  {
    id: 'invasion-beacon',
    category: 'beacon',
    name: '信号发射器',
    outputItemId: 'invasion-beacon',
    outputUnits: 1,
    cycleMs: 2 * 60 * 60 * 1000,
    materials: [
      { itemId: 'min-voidcrystal', units: 10_000 },
      { itemId: 'part-qchip', units: 2_000 },
      { itemId: 'part-circuit', units: 18_000 },
    ],
  },
  {
    id: 'jump-fuel-dense',
    category: 'fuel',
    name: '浓缩折跃燃料',
    outputItemId: 'jump-fuel',
    outputUnits: 600,
    cycleMs: 6 * 60 * 1000,
    materials: [
      { itemId: 'min-voidcrystal', units: 15 },
      { itemId: 'min-jumplasma', units: 400 },
      { itemId: 'min-cryoslurry', units: 400 },
      { itemId: 'min-curvature', units: 200 },
      { itemId: 'part-coolant', units: 400 },
    ],
    requiresTech: 'fuelRecipeAdvanced',
  },
  ...([
    ['invasion-beacon-r', 'item.factionBeacon.001'],
    ['invasion-beacon-c', 'item.factionBeacon.003'],
    ['invasion-beacon-h', 'item.factionBeacon.005'],
    ['invasion-beacon-d', 'item.factionBeacon.007'],
  ] as const).map(([id, nameId]): LabRecipeDef => ({
    id, category: 'beacon', name: L10N[nameId]!.zh, outputItemId: id, outputUnits: 1,
    cycleMs: 2 * 60 * 60 * 1000,
    materials: [
      { itemId: 'min-voidcrystal', units: 40_000 },
      { itemId: 'part-qchip', units: 2_000 },
      { itemId: 'part-circuit', units: 18_000 },
      { itemId: 'part-grav-comp', units: 8_859 },
    ],
  })),
]

export function buildLabRecipeCatalog(): ReadonlyMap<string, LabRecipeDef> {
  return new Map(LAB_RECIPES.filter((r) => r.unreleased !== true).map((r) => [r.id, r]))
}
