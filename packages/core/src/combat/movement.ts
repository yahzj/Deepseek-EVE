/** 战斗域：movement，从原引擎按职责迁移，保持结算顺序。 */
import type { BattleBalance } from '../types'
import type { UnitSpec } from './model'
import { isAlive, inRange } from './combatMath'
import { battleSpeedBonusOf } from './alienEquipment'

export function combatSpeed(maxSpeedMps: number, agility: number, bal: BattleBalance): number {
  return Math.max(20, maxSpeedMps * bal.speedFactor * (1 + (agility - 0.5) * 2 * bal.agilitySpeedBonus))
}

/**
 * 开火失稳乘子的**当前有效值**（2026-09-10 船长：推进器失稳代价只在**点火期**生效）：
 * 点火期 = 装配值（`1 − 最重一件 hitPenalty`）；冷却期 = 1（没点火就不失稳）。
 */
export function effectiveHitMul(spec: Pick<UnitSpec, 'hitMul'>, boosting: boolean): number {
  return boosting ? (spec.hitMul ?? 1) : 1
}

/**
 * 推进器周期状态（2026-09-10 船长定：**爆发 60 秒 → 冷却 60 秒，开场即启动**）。
 * **由战斗时钟推导**（`lastTickGameMs - startedAtGameMs`）→ 不占任何存档字段、战中重载不丢。
 * 引擎（距离步进取我方机动）与界面（战斗界面底部推进器冷却格）**同源读这一个函数**。
 *
 * **2026-09-14 船长（新增「微型跃迁引擎」）**：周期改为**逐单位**——第三参 `cycle` 给该单位自己的
 * 点火/冷却毫秒（缺省仍是 `balance.battle` 的全局值）。同一个函数、同一个时钟锚（**开场即点火**），
 * 只是窗口长短各算各的 ⇒ 装微型跃迁引擎那条船 10 秒爆发、其余船仍 60 秒。
 */
export function thrusterPhase(
  battle: Pick<import('../state').BattleState, 'lastTickGameMs' | 'startedAtGameMs'>,
  bal: BattleBalance,
  cycle?: { boostMs?: number; cooldownMs?: number },
): { boosting: boolean; remainMs: number; cycleMs: number; posMs: number } {
  const boostMs = cycle?.boostMs ?? bal.thrusterBoostMs
  const cooldownMs = cycle?.cooldownMs ?? bal.thrusterCooldownMs
  const cycleMs = Math.max(1, boostMs + cooldownMs)
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  const posMs = elapsed % cycleMs
  const boosting = posMs < boostMs
  return { boosting, posMs, cycleMs, remainMs: boosting ? boostMs - posMs : cycleMs - posMs }
}

/** 某单位的推进器周期（没写覆盖 = 全局 `balance.battle`）——引擎与界面取周期的**单点** */
export function unitThrusterCycle(
  u: Pick<UnitSpec, 'thrusterBoostMs' | 'thrusterCooldownMs'>,
  bal: BattleBalance,
): { boostMs: number; cooldownMs: number } {
  return {
    boostMs: u.thrusterBoostMs ?? bal.thrusterBoostMs,
    cooldownMs: u.thrusterCooldownMs ?? bal.thrusterCooldownMs,
  }
}

export function updateFoeCharge(
  b: import('../state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
  desireM: number,
): void {
  const margin = bal.foeChargeTriggerMarginM ?? 1_000
  const arrived = b.distanceM <= desireM
  for (const f of foes) {
    if (f.foeCanCharge !== true) continue
    const rt = b.foeCharges?.[f.tag]
    if (!isAlive(b, f.tag)) {
      if (rt && b.foeCharges) delete b.foeCharges[f.tag]
      continue
    }
    const w = f.weapons[0]
    const inOwnRange = w ? inRange(b.distanceM, w) : false
    const wantCharge = !inOwnRange || b.distanceM > desireM + margin
    if (rt?.on === true) {
      if (arrived) {
        rt.on = false
        rt.cdUntilMs = nowMs + (f.foeChargeCooldownMs ?? bal.foeChargeCooldownMs)
      }
      continue
    }
    if (nowMs >= (rt?.cdUntilMs ?? 0) && wantCharge) {
      if (!b.foeCharges) b.foeCharges = {}
      b.foeCharges[f.tag] = { ...(rt ?? {}), on: true }
    }
  }
}

/**
 * **冲锋解除：自身炮台命中我方**（船长 2026-09-14：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）。
 * ⚠ **只算炮台主武器**（`weapons[0]`）：机群（`src:'drone'`）命中**不算**——那是舰载机打的，
 * 不是"自身炮台"；近防炮同理（防御武器，不在这里结算）。
 */
export function releaseFoeChargeOnHit(
  b: import('../state').BattleState,
  tag: string,
  bal: BattleBalance,
  /** 本单位的冲锋冷却覆写（挂载件给的，2026-09-16 船长：A 族海盗 30 秒）——缺省走全局 */
  cdMs?: number,
): void {
  const rt = b.foeCharges?.[tag]
  if (rt?.on !== true) return
  rt.on = false
  rt.cdUntilMs = b.lastTickGameMs + (cdMs ?? bal.foeChargeCooldownMs)
}

/**
 * **单位机动倍率（单点）**——两侧"周期/状态 ⇒ 机动乘子"都从这里取，免得同一段判断散在多处：
 * - **我方**：推进器**周期爆发**（`thrusterPhase`，周期逐单位；点火窗口内 ×(1+`thrusterBoost`)，冷却期 ×1）；
 * - **敌方**：**冲锋**（`b.foeCharges[tag].on` ⇒ ×(舰级 `foeChargeMul` ?? 全局 `bal.foeChargeMul`)）。
 *
 * 两侧都只乘进**自己那一项**：编队速度 = "逐单位乘各自倍率 → 取平均"（见 `stepBattle`），
 * 故倍率**不外溢**到队里别的船。
 * ⚠ 只合并这一层：**冲锋的状态机**（事件驱动：命中解除 / 到达解除 / 冷却）与**推进器的相位**
 * （时钟推导：`elapsed % 周期`）不是一回事，各自的"何时开、何时关"留在原处，不硬并成一个函数。
 */
export function unitSpeedMulOf(
  u: UnitSpec,
  b: import('../state').BattleState,
  bal: BattleBalance,
  side: 'me' | 'foe',
): number {
  if (side === 'me') {
    const boosting = thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
    return 1 + battleSpeedBonusOf(u, b, boosting)
  }
  if (b.foeCharges?.[u.tag]?.on !== true) return 1
  return u.foeChargeMul ?? bal.foeChargeMul
}

/** 正在冲锋的敌单位条数（界面标记用）。⚠ 只数**存活**：阵亡单位的状态在同一拍已清掉，这里再兜一层 */
export function foeChargeCount(
  b: Pick<import('../state').BattleState, 'foeCharges' | 'units'>,
): number {
  let n = 0
  for (const [tag, rt] of Object.entries(b.foeCharges ?? {})) {
    if (rt?.on !== true) continue
    const u = b.units[tag]
    if (!u || !(u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)) continue
    n += 1
  }
  return n
}

/**
 * 距离机动的单方转向步（米）：
 * - 已到位（差 <0.5m）不动；
 * - 否则以 ≤ 本步全速航程推进，且绝不越过期望距离 → 到达后下一拍即停，不产生过冲振荡。
 * 比例收尾段（剩余 < 本步航程时推力 = 剩余）让系统天然收敛，拔河也只在平衡点静止。
 */
export function steerStep(cur: number, desire: number, speedMps: number, dtSec: number): number {
  const gap = desire - cur
  if (Math.abs(gap) < 0.5) return 0
  const cap = Math.max(5 * dtSec, speedMps * dtSec)
  const step = Math.min(Math.abs(gap), cap)
  return gap > 0 ? step : -step
}
