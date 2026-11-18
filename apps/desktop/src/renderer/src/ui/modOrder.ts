import { MODULE_SLOTS } from '@whale/core'
import type { DamageType, ModuleDef } from '@whale/core'

export const MOD_DMG_ORDER: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']

export const MOD_FRAME_RANK: Record<string, number> = {
  civ: -1,
  base: 0,
  mk1: 1,
  mk2: 2,
  mk3: 3,
  proto: 3.5,
  special: Number.POSITIVE_INFINITY,
}

export function modFrameOf(def: Pick<ModuleDef, 'id' | 'damageType'>): keyof typeof MOD_FRAME_RANK {
  const tail = def.id.replace(/^mod-/, '')
  if (def.damageType !== undefined && /^(lair|wh)-/.test(tail)) return 'special'
  if (/(^|-)civ$/.test(tail) || /-civ(-|$)/.test(tail)) return 'civ'
  if (/(^|-)proto$/.test(tail) || /-proto(-|$)/.test(tail)) return 'proto'
  if (/-3$/.test(tail)) return 'mk3'
  if (/-2$/.test(tail)) return 'mk2'
  if (/-1$/.test(tail)) return 'mk1'
  if (/^(lair|wh)-/.test(tail)) return 'special'
  return 'base'
}

export function nominalDpsOf(def: ModuleDef): number {
  if (def.dmgMult === undefined || !def.reloadMs) return 0
  return (def.dmgMult * (def.shots ?? 1)) / (def.reloadMs / 1000)
}

export function isWeaponModule(def: ModuleDef): boolean {
  return def.damageType !== undefined
}

export function modOrderKey(def: ModuleDef): [number, number, number, number, number, string, string] {
  const slotIdx = MODULE_SLOTS.indexOf(def.slot)
  if (isWeaponModule(def)) {
    const dt = MOD_DMG_ORDER.indexOf(def.damageType as DamageType)
    const frame = MOD_FRAME_RANK[modFrameOf(def)] ?? 0
    return [0, dt < 0 ? MOD_DMG_ORDER.length : dt, frame, nominalDpsOf(def), slotIdx, def.name, def.id]
  }
  return [1, 0, 0, 0, slotIdx, def.name, def.id]
}

export function compareModOrder(a: ModuleDef, b: ModuleDef): number {
  const ka = modOrderKey(a)
  const kb = modOrderKey(b)
  for (let i = 0; i < ka.length; i++) {
    const x = ka[i] as number | string
    const y = kb[i] as number | string
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y), 'zh-Hans-CN')
  }
  return 0
}

export function sortModEntries(
  entries: ReadonlyArray<readonly [string, number]>,
  ctx: { modules: ReadonlyMap<string, ModuleDef> },
): Array<[string, number]> {
  const known: Array<[string, number]> = []
  const unknown: Array<[string, number]> = []
  for (const e of entries) (ctx.modules.has(e[0]) ? known : unknown).push([e[0], e[1]])
  known.sort((x, y) => compareModOrder(ctx.modules.get(x[0])!, ctx.modules.get(y[0])!))
  unknown.sort((x, y) => x[0].localeCompare(y[0]))
  return [...known, ...unknown]
}
