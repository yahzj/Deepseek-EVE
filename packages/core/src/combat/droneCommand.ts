import type { BattleState } from '../state'
import type { SimContext } from '../types'
import { droneLoadM3 } from '../ships/fitting/drones'
import { isAlive } from './combatMath'
import type { UnitSpec, WeaponSpec } from './model'

const commandBase = Symbol('droneCommandBase')
type DamageBase = Pick<WeaponSpec, 'shotDmg' | 'shotsByType'>
type CommandSpec = UnitSpec & {
  [commandBase]?: { targetWeightMul: number | undefined; weapons: DamageBase[] }
}

/** 开战体积固定整场；旧战斗只从初装账回退，绝不读战损或当前备机库存。 */
export function droneCommandVolumeM3Of(battle: BattleState, ctx?: SimContext): number {
  const saved = battle.droneCommandVolumeM3
  if (saved !== undefined && Number.isFinite(saved) && saved >= 0) return saved
  if (!ctx) return 0
  const loads = battle.droneLoadAtStartBy
    ? Object.values(battle.droneLoadAtStartBy)
    : [battle.droneLoadAtStart]
  const volume = loads.reduce((sum, load) => sum + droneLoadM3(load, ctx), 0)
  battle.droneCommandVolumeM3 = volume
  return volume
}

/** 返回独立规格；按本舰原伤害倍率取最高存活来源，重入时始终从未加光环的值重算。 */
export function applyDroneCommandAura(
  specs: readonly UnitSpec[],
  battle?: BattleState,
  ctx?: SimContext,
): UnitSpec[] {
  let source: UnitSpec | undefined
  let shared = 0
  let sourceOrder = Infinity
  const formation = new Map(battle?.myFleet?.map((entry, index) => [entry.tag, index]))
  for (const [index, spec] of specs.entries()) {
    if (spec.side !== 'me' || !spec.droneCommand || (battle && !isAlive(battle, spec.tag))) continue
    const value = (spec.droneDamageBonusPct ?? 0) * spec.droneCommand.sharePct
    const order = formation.get(spec.tag) ?? formation.size + index
    // 并列固定取编队首位，同一来源也不再接收次高者的分享。
    if (Number.isFinite(value) && value > 0 && (value > shared || value === shared && order < sourceOrder)) {
      source = spec
      shared = value
      sourceOrder = order
    }
  }
  let volume = 0
  if (specs.some(spec => spec.side === 'me' && spec.droneCommand)) {
    if (battle) volume = droneCommandVolumeM3Of(battle, ctx)
    else if (ctx) {
      const load: Record<string, number> = {}
      for (const spec of specs) for (const weapon of spec.weapons) {
        if (spec.side !== 'me' || weapon.src !== 'drone' || !weapon.artId || weapon.reserve || weapon.disabled) continue
        load[weapon.artId] = (load[weapon.artId] ?? 0) + (weapon.count ?? 1)
      }
      volume = droneLoadM3(load, ctx)
    }
  }
  return specs.map((spec: CommandSpec): UnitSpec => {
    if (spec.side !== 'me') return spec
    const mul = source && spec.tag !== source.tag && (!battle || isAlive(battle, spec.tag)) ? 1 + shared : 1
    const previous = spec[commandBase]
    if (!previous && !spec.droneCommand && mul === 1) return spec
    const base = previous ?? {
      targetWeightMul: spec.targetWeightMul,
      weapons: spec.weapons.map(weapon => ({ shotDmg: weapon.shotDmg,
        shotsByType: weapon.shotsByType ? { ...weapon.shotsByType } : undefined })),
    }
    const out: CommandSpec = { ...spec, [commandBase]: base,
      weapons: spec.weapons.map((weapon, index) => {
        if (weapon.src !== 'drone' || weapon.repairDrone) return weapon
        const damage = base.weapons[index]!
        return { ...weapon,
          ...(damage.shotDmg !== undefined ? { shotDmg: damage.shotDmg * mul } : {}),
          ...(damage.shotsByType ? { shotsByType: Object.fromEntries(Object.entries(damage.shotsByType)
            .map(([type, value]) => [type, value! * mul])) } : {}),
        }
      }),
    }
    if (spec.droneCommand) {
      out.targetWeightMul = (base.targetWeightMul ?? 1) * (1 + volume * spec.droneCommand.targetWeightPerM3)
    } else if (base.targetWeightMul !== undefined) out.targetWeightMul = base.targetWeightMul
    else delete out.targetWeightMul
    return out
  })
}
