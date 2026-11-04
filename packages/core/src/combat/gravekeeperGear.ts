import { ceilFinalQuantity } from '../quantity'
import type { BattleState } from '../state'
import type { UnitSpec } from './model'
import type { ModuleDef } from '../types'
import { stackWeight } from '../equipment'
import { healArmorHp } from './combatMath'

/** 同件正负效果同权重，全部乘数从原件重算，不逐拍累乘。 */
export function crisisEffectsOf(modules: readonly ModuleDef[]): UnitSpec['crisisOverload'] {
  const devices = modules.flatMap(m => m.crisisOverload ? [m.crisisOverload] : [])
  if (!devices.length) return undefined
  return devices.reduce((out, d, i) => {
    const w = stackWeight(i + 1)
    out.rangeMul *= 1 + d.rangeBonusPct * w
    out.damageMul *= 1 + d.damageBonusPct * w
    out.speedMul *= 1 - d.speedPenaltyPct * w
    out.droneInitialMul *= 1 - d.droneInitialCutPct * w
    out.droneCycleMul *= 1 - d.droneCycleCutPct * w
    return out
  }, { rangeMul: 1, damageMul: 1, speedMul: 1, droneInitialMul: 1, droneCycleMul: 1 })
}

/** 只缩放尚在运行的本舰无人机计时，已完成首次放飞不追溯。 */
export function syncPlayerCrisis(b: BattleState, specs: readonly UnitSpec[]): void {
  for (const spec of specs) {
    const rt = b.units[spec.tag], effect = spec.crisisOverload
    if (!effect || !rt || rt.hp.s !== 0 || rt.hp.a + rt.hp.h <= 0 || b.meCrisisActive?.[spec.tag]) continue
    const active = b.meCrisisActive ??= {}
    active[spec.tag] = true
    for (let i = 0; i < spec.weapons.length; i++) {
      if (spec.weapons[i]?.src !== 'drone') continue
      const pool = b.dronePools?.[`${spec.tag}:${i}`]
      const initial = pool?.launched === false && pool.launchRequeued !== true
      rt.weapons[i] = Math.round((rt.weapons[i] ?? 0) * (initial ? effect.droneInitialMul : effect.droneCycleMul))
    }
    const queue = b.droneLaunchBy?.[spec.tag]
    if (queue) {
      const initial = b.dronePools?.[queue.q[0] ?? '']?.launchRequeued !== true
      const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
      if (initial) queue.nextAtMs = elapsed + Math.max(0, queue.nextAtMs - elapsed) * effect.droneInitialMul
      queue.gapMs = Math.max(10, Math.round(queue.gapMs * effect.droneInitialMul))
    }
  }
}

/** 返回独立动态规格，供战斗与视图同源读取，绝不污染每拍基础规格。 */
export function playerGravekeeperSpecOf(b: BattleState, spec: UnitSpec, display = false): UnitSpec {
  const effect = b.meCrisisActive?.[spec.tag] ? spec.crisisOverload : undefined
  if (!effect && !spec.weapons.some(w => w.railCharge)) return spec
  return { ...spec, speedMps: spec.speedMps * (effect?.speedMul ?? 1),
    droneLaunchGapMs: effect ? Math.max(10, Math.round((spec.droneLaunchGapMs ?? 500) * effect.droneInitialMul)) : spec.droneLaunchGapMs,
    weapons: spec.weapons.map((w, i) => {
      const out = { ...w }
      // 炮台家族，不扩展到导弹、激光、基础炮或机群。
      if (effect && w.src === 'turret') {
        out.maxRangeM = Math.round(w.maxRangeM * effect.rangeMul)
        if (w.shotsByType) out.shotsByType = Object.fromEntries(Object.entries(w.shotsByType).map(([t, n]) => [t, ceilFinalQuantity(n! * effect.damageMul)]))
        if (w.shotDmg !== undefined) out.shotDmg = ceilFinalQuantity(w.shotDmg * effect.damageMul)
      }
      if (effect && w.src === 'drone') out.reloadMs = Math.max(1, Math.round(w.reloadMs * effect.droneCycleMul))
      if (w.railCharge) {
        const n = Math.min(w.railCharge.maxStacks, b.meRailStacks?.[`${spec.tag}#${i}`] ?? 0)
        out.secondaryDamagePct = n * w.railCharge.damageStepPct
        out.secondaryDamageType = 'plasma'
        if (display) out.reloadMs = Math.round(out.reloadMs * (1 + n * w.railCharge.reloadStepPct))
      }
      return out
    }),
  }
}

export function noteRailAttack(b: BattleState, spec: UnitSpec, index: number, reloadMs: number): number {
  const device = spec.weapons[index]?.railCharge
  if (!device) return reloadMs
  const book = b.meRailStacks ??= {}
  const key = `${spec.tag}#${index}`
  const n = book[key] = Math.min(device.maxStacks, (book[key] ?? 0) + 1)
  return Math.round(reloadMs * (1 + n * device.reloadStepPct))
}

/** 苏生按最大容量发放本段额度，满层溢出丢弃，不复活死舰。 */
export function advancePlayerRebirth(b: BattleState, spec: UnitSpec, nowMs: number): void {
  const ledger = b.meRebirths?.[spec.tag], protocol = spec.rebirthRepair, rt = b.units[spec.tag]
  if (!ledger || !protocol || !rt || rt.hp.s + rt.hp.a + rt.hp.h <= 0) return
  const until = Math.min(nowMs, ledger.repairUntilMs)
  const dt = Math.max(0, until - ledger.lastRepairAtMs)
  if (dt <= 0) return
  const max = rt.hpMax ?? spec.hp
  const armor = Math.min(Math.max(0, max.a - rt.hp.a), max.a * protocol.armorTotalPct * dt / protocol.repairMs)
  const hull = Math.min(Math.max(0, max.h - rt.hp.h), max.h * protocol.hullTotalPct * dt / protocol.repairMs)
  healArmorHp(rt.hp, armor)
  rt.hp.h += hull
  ledger.armorHealed += armor
  ledger.hullHealed += hull
  ledger.lastRepairAtMs = until
}
