/**
 * 承伤口径：**按敌方火力扣装甲与结构**（2026-09-11 船长定，先用于低安遇袭，随后「希望能将其应用到战斗中撤退」）。
 *
 * 为什么要抽成单独模块：同一套算法现在有**两个使用方**——
 * ① 低安遇袭受损档（`encounters.ts`，一口 = 敌群火力 × `encounter.hitFirepowerSec`）；
 * ② 战斗撤退/自动撤退/超时判负那一口（`expedition.ts`，一口 = 敌群火力 × `combat.retreatHitFirepowerSec`）。
 * 两处若各写一份，日后调数值/改底线必然漂移，故算法、底线、日志用的比例换算全部收在这里。
 *
 * 口径（与既有文案一致，别改错）：
 * - **一口伤害 HP = 敌群火力（威胁 × `battle.foeDpsPerThreat`）× 秒数**；
 * - 施加时**先扣装甲、吸完再进结构**（旧实现曾直接扣结构、装甲不动，与日志"被咬下一块装甲"不符）；
 * - 层满值走 `hullLayerCaps`（与维修、修理组件同一把尺：含模块与技能放大）；
 * - **结构不低于 5%**（绝不弃船），触底时 `floored = true` 由调用方告警。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import { hullLayerCaps } from './shipyard'

/** 结构底线：绝不弃船（沿用旧口径 5%） */
export const HULL_FLOOR_FRAC = 0.05

/** 敌群火力代理（HP/秒）：威胁 × `battle.foeDpsPerThreat`（0.8 = 每秒 0.8 HP 每点威胁） */
export function foeFirepowerDps(ctx: SimContext, threat: number): number {
  return Math.max(1, threat) * ctx.balance.battle.foeDpsPerThreat
}

/** 一口伤害（HP）= 敌群火力 × 暴露秒数（至少 1 HP，避免 0 伤害） */
export function firepowerHitHp(ctx: SimContext, threat: number, seconds: number): number {
  return Math.max(1, foeFirepowerDps(ctx, threat) * seconds)
}

/** 受击结算结果（日志用：扣了多少、剩多少，都是比例 0~1） */
export interface HullHit {
  /** 剩余装甲比例 */
  armorTo: number
  /** 剩余结构比例 */
  hullTo: number
  /** 本口被吃掉的装甲比例 */
  armorLost: number
  /** 本口被吃掉的结构比例 */
  hullLost: number
  /** 是否已触到 5% 结构底线（绝不弃船） */
  floored: boolean
}

/**
 * 施加一口伤害：**先扣装甲、吸完再进结构**，结构不低于 5%（绝不弃船）。
 * 换算用 `hullLayerCaps`（与维修、修理组件同一把尺：含模块与技能放大的层满值）。
 */
export function applyArmorFirstDamage(state: GameState, ctx: SimContext, shipId: string, hp: number): HullHit | null {
  const ship = state.fleet[shipId]
  if (!ship) return null
  const caps = hullLayerCaps(state, ctx, shipId)
  const capA = caps && caps.capA > 0 ? caps.capA : 0
  const capH = caps && caps.capH > 0 ? caps.capH : 1
  const round = (v: number): number => Math.round(v * 1000) / 1000
  const armorHp = Math.max(0, ship.armorPct ?? 1) * capA
  const hullHp = Math.max(0, ship.durability) * capH
  const eatA = Math.min(armorHp, hp)
  const rest = Math.max(0, hp - eatA)
  const armorAfter = armorHp - eatA
  const floorHp = capH * HULL_FLOOR_FRAC
  const hullAfter = Math.max(floorHp, hullHp - rest)
  const hit: HullHit = {
    armorTo: capA > 0 ? round(armorAfter / capA) : 0,
    hullTo: round(hullAfter / capH),
    armorLost: capA > 0 ? round((armorHp - armorAfter) / capA) : 0,
    hullLost: round((hullHp - hullAfter) / capH),
    floored: rest > 0 && hullAfter <= floorHp + 1e-9,
  }
  ship.armorPct = hit.armorTo
  ship.durability = hit.hullTo
  return hit
}

/** 比例 → 日志用整数百分数 */
export function pctOf(v: number): number {
  return Math.round(v * 100)
}

/** 一口受击的通用日志片段（装甲先扣，故先报装甲、再报结构；无结构损失时省略结构段） */
export function hitDamageText(hit: HullHit): string {
  const hullPart = hit.hullLost > 0 ? `、结构 -${pctOf(hit.hullLost)}%` : ''
  return `装甲 -${pctOf(hit.armorLost)}%${hullPart}（现 装甲 ${pctOf(hit.armorTo)}% / 结构 ${pctOf(hit.hullTo)}%）`
}
