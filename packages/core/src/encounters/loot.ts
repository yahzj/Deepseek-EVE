/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { weekendInvolvedAt, foeOf } from './presence'
import { ceilFinalQuantity } from '../quantity'
import { injectWeekendWreck, weekendWreckInjectionOf, WRECK_ENCOUNTER_INJECT_FRAC, asFoeFamily, wreckInjectThreatOf, strongestBountyInjection, WRECK_INJECT_PER_THREAT, injectWreckDensity } from '../salvage'
import { firepowerHitHp, type HullHit, pctOf as pct } from '../hullDamage'

/**
 * **击退/全歼缴获**（2026-09-09 船长定）：伏击敌群赏金 × lootFracOfBounty（缺敌群 = 旧档按威胁×1 兜底）；
 * 只给 ISK，不计首胜/声望。
 *
 * ⚠ **入侵遭遇（占领区的遇袭 / 旗舰挑战）一分钱不给**（船长 2026-09-25「**入侵舰队不应该有赏金**」）——
 * 收入改在活动结束时按进度统一结算（`weekendEvent.WEEKEND_PROGRESS_ISK_PER_PCT`）。
 */
export function lootOf(state: GameState, ctx: SimContext, seizeF: number): number {
  if (weekendInvolvedAt(state, ctx)) return 0
  const foe = foeOf(state, ctx)
  const base = foe ? Math.max(0, foe.rewardIsk) : Math.max(1, Math.round(state.encounter.threat))
  return Math.max(1, ceilFinalQuantity(base * ctx.balance.encounter.lootFracOfBounty * seizeF))
}

/**
 * 胜利（击退/全歼）→ 向事发星系注入残骸（2026-09-10 船长定：= 该星系**最强悬赏卡**
 *  的注入量 ×0.5，与悬赏口径同源；星系无可见悬赏卡时回退旧口径 威胁×0.4）。
 *
 * ⚠ **2026-09-25 分流**（船长：「入侵……需要独立的残骸条」＋「按照击败卡的威胁注入」）：
 *  - **入侵遭遇**（占领区遇袭 / 旗舰挑战）⇒ 记进**独立池**（`weekendWrecks`，无保底、48h 衰减到 0），
 *    注入量 = **击败卡**的威胁公式 × `WRECK_ENCOUNTER_INJECT_FRAC`（沿用"遇袭半量"口径）；
 *  - 普通遭遇 ⇒ 逐字不变（最强卡 ×0.5 → 该星系残骸场）。
 */
export function dropWrecks(state: GameState, ctx: SimContext): void {
  const enc = state.encounter
  if (!enc.galaxyId) return
  const foe = foeOf(state, ctx)
  if (weekendInvolvedAt(state, ctx)) {
    /**
     * ⚠ **"击败卡"取遭遇槽自己记的那张**（`enc.anomalyId`），**不能**用 `foeOf` 的结果：
     * 入侵舰队卡是 **hidden** 卡，而 `foeOf` 会跳过 hidden 卡、回落到"该星系最近的可见悬赏"
     * ⇒ 拿原卡当代替会把注入量算错（H 族抽到的那支威胁 90~170，该星系原卡只有几十）。
     */
    const own = enc.anomalyId !== null ? ctx.anomalies.get(enc.anomalyId) : undefined
    const card = own ?? foe
    if (card) {
      injectWeekendWreck(
    state,
    enc.galaxyId,
    weekendWreckInjectionOf(card, WRECK_ENCOUNTER_INJECT_FRAC),
    // 来源族（2026-09-26）：遇到的是哪一族就记哪一族，回落当前事件族
    asFoeFamily(card.foeFamily) ?? asFoeFamily(state.weekendEvent?.family),
  )
    }
    return
  }
  // 注入口径体量走 `wreckInjectThreatOf`（`wreckThreat` ?? 威胁）⇒ 与悬赏线同源、且不受威胁重定标牵动
  const threat = foe ? Math.max(1, wreckInjectThreatOf(foe)) : Math.max(1, enc.threat)
  const strongest = strongestBountyInjection(enc.galaxyId, ctx)
  const amount = strongest !== null ? strongest * WRECK_ENCOUNTER_INJECT_FRAC : threat * WRECK_INJECT_PER_THREAT
  injectWreckDensity(state, ctx, enc.galaxyId, amount)
}

/** 一口遇袭伤害（HP）= 敌群火力代理 × 暴露系数（船长 2026-09-11 定：按敌人火力，不再用固定骰）。
 *  算法本体见 `hullDamage.ts`（与**战斗撤退**共用同一套：先扣装甲、吸完再进结构、结构 5% 底线）。 */
export function ambushHitHp(ctx: SimContext, threat: number): number {
  return firepowerHitHp(ctx, threat, ctx.balance.encounter.hitFirepowerSec)
}

/** 受损档日志（装甲先扣，故先报装甲、再报结构；与既有"被咬下一块装甲"文案同口径） */
export function hitLogText(shipName: string, galaxyName: string, foeName: string, suffix: string, hit: HullHit): string {
  const hullPart = hit.hullLost > 0 ? `、结构 -${pct(hit.hullLost)}%` : ''
  return `⚔ 遭遇（${galaxyName}·${foeName}）：${shipName} 寡不敌众被咬下一块装甲${suffix}——装甲 -${pct(hit.armorLost)}%${hullPart}（现 装甲 ${pct(hit.armorTo)}% / 结构 ${pct(hit.hullTo)}%）。`
}
