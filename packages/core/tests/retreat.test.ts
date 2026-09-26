/**
 * 战斗中"撤退"（2026-09-11 船长改口径：与低安遇袭同一套承伤算法）：
 * 脱身那一口 = **敌群火力（威胁 × foeDpsPerThreat）× combat.retreatHitFirepowerSec**，
 * **先扣装甲、吸完再进结构**，结构 5% 底线（绝不弃船）、无弃船骰、转自动返航。
 * 取代旧口径「轻损 = 失利扣损骰 ×0.5 = 结构 −7.5%~15%（与敌人强弱无关、装甲不动）」。
 *
 * ⚠ **2026-09-14 船长改判：「玩家撤离战斗按照 10 秒算」⇒ K 由 1 秒改为 10 秒**，且范围经船长裁定
 * 扩为**四档同一 K**：玩家主动撤退 / 结构<50% 自动脱离 / 战斗超时 / **无法交战**（够不着）；
 * 虫洞的撤离战不吃本值（走真实战斗损伤）。**窝点档按派生后威胁算**（与界面/战斗同口径）。
 *
 * ⚠ **2026-09-26 船长再改判「甲：单纯削减时间」⇒ K 10 → 5 秒**（起因：「目前撤退的修理损伤有些大，
 * 我记得之前是敌人10秒的DPS输出吧？」——现值确实是 10 秒，但卡面威胁已整体上调 ⇒ 双重放大）。
 * 与低安遇袭那口（`encounter.hitFirepowerSec` = 5 秒）**同口径**；**不计玩家抗性**（船长令
 * 「之前没有抗性就算了」）。本文件里的具体读数已按 K=5 重算。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { retreatBattle, startExpedition } from '../src/expedition'
import { durabilityOf, hullLayerCaps } from '../src/shipyard'
import { applyArmorFirstDamage, firepowerHitHp } from '../src/hullDamage'
import { LAIR_THREAT_MUL } from '../src/lairs'
import { anomaly, makeTestCtx } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({ quietEvents: true })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  return { state, ctx }
}

/** 打到"交火中"（母港目标零航程：推进 1s 进入 battle，未分胜负） */
function enterBattle(state: GameState, ctx: SimContext): void {
  expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
  advanceGame(state, 1_000, ctx)
  expect(state.expedition.phase).toBe('battle')
  expect(state.expedition.battle).not.toBeNull()
}

/** 本场脱身那一口的期望值（测试卡 ano-a 威胁 8；K 取 balance 现值） */
function expectedBite(ctx: SimContext): number {
  const threat = ctx.anomalies.get('ano-a')!.threat
  return firepowerHitHp(ctx, threat, ctx.balance.combat.retreatHitFirepowerSec)
}

describe('战斗中撤退（按敌方火力扣装甲/结构）', () => {
  it('非交火状态拒绝；撤退 = 按敌火先扣装甲（装甲吃满才进结构）、转返航、无弃船', () => {
    const { state, ctx } = world()
    expect(retreatBattle(state, ctx).ok).toBe(false) // 无战斗
    enterBattle(state, ctx)
    const caps = hullLayerCaps(state, ctx, state.shipId)!
    const ship = state.fleet[state.shipId]!
    const armorBefore = ship.armorPct ?? 1
    const structBefore = ship.durability
    const K = ctx.balance.combat.retreatHitFirepowerSec
    const bite = expectedBite(ctx)
    const iskBefore = state.wallet.isk
    // 威胁 8 × 0.8/秒 × 5 秒 = 32 HP（2026-09-26 船长裁定「甲」：K 10 → 5 秒）
    expect(bite).toBeCloseTo(8 * ctx.balance.battle.foeDpsPerThreat * K, 6)
    expect(K).toBe(5)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    /**
     * **撤退不收维修费**（船长 2026-09-15「**删除撤离费**」）：
     * 旧口径 = `min(钱包, 该卡期望奖励 × defeatCostRatio(0.5) × 0.5)`（= 奖励的 25%，四档一起收），
     * 高价值悬赏撤一次要掉 21~37 万信用点；现**整条删除** ⇒ 钱包一分不动、日志也不再提维修费。
     * 判据用"恰好等于"（不是 ≤）⇒ 任何形式的扣费回潮都会红。
     */
    expect(state.wallet.isk).toBe(iskBefore)
    expect(state.logs.some((l) => l.text.includes('维修花去'))).toBe(false)
    expect(state.expedition.phase).toBe('back') // 自动返航
    // 期望：这一口**先由装甲池吸收、吃满才进结构**（测试船甲 < 64 ⇒ 甲清零、余量落结构）
    const armorHp = armorBefore * caps.capA
    const eat = Math.min(armorHp, bite)
    const rest = Math.max(0, bite - eat)
    expect(ship.armorPct ?? 1).toBeCloseTo((armorHp - eat) / caps.capA, 3)
    expect(ship.durability).toBeCloseTo(Math.max(0.05, structBefore - rest / caps.capH), 3)
    expect(eat).toBe(armorHp) // 装甲被吃满（不是"结构先掉、装甲不动"）
    expect(ship.armorPct).toBe(0)
    expect(rest).toBeGreaterThan(0) // 余量确实进了结构
    expect(state.fleet[state.shipId]).toBeDefined() // 绝不弃船
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('撤退'))).toBe(true)
    // 日志给的是"装甲 -X%（现 装甲 x% / 结构 y%）"这一套（与遇袭同款说法）
    expect(state.logs.some((l) => l.text.includes('装甲 -'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('现 装甲'))).toBe(true)
  })

  it('装甲够厚时**分文不动结构**（先扣装甲这条本身，用小口直打算法单点）', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    const caps = hullLayerCaps(state, ctx, state.shipId)!
    const ship = state.fleet[state.shipId]!
    const structBefore = ship.durability
    // 一口只吃 1 HP（远小于甲池）⇒ 结构必须一处不动（旧实现曾直接扣结构，这条就是它的守卫）
    const hit = applyArmorFirstDamage(state, ctx, state.shipId, 1)!
    expect(hit.hullLost).toBe(0)
    expect(ship.durability).toBe(structBefore)
    expect(hit.armorLost).toBeCloseTo(1 / caps.capA, 3)
  })

  it('装甲打穿后余量进结构；结构触底压 5% 下限（保护性钳制，不弃船）并显著告警', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    // P0 承伤持久化：耐久=结构层——把本场玩家单位甲/结构都打到 0（仅剩盾）模拟结构崩坏
    const u = state.expedition.battle!.units['player']!
    u.hp = { s: 500, a: 0, h: 0 }
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(durabilityOf(state, state.shipId)).toBe(0.05)
    expect(state.logs.some((l) => l.text.includes('濒临崩溃'))).toBe(true)
  })

  it('战斗已分胜负（结算窗口）时不可撤退；撤退同时停止重复清剿', () => {
    const { state, ctx } = world()
    state.autoLoopAnomalyId = 'ano-a'
    enterBattle(state, ctx)
    // 手工处决：全灭敌方 → 下一拍 ended='me'（处于慢镜结算窗口）
    const b = state.expedition.battle!
    const units = Object.values(b.units) as Array<{
      side: string
      hp: { s: number; a: number; h: number }
    }>
    for (const u of units) {
      if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    }
    advanceGame(state, 100, ctx)
    expect(b.ended).toBe('me')
    const r = retreatBattle(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('胜负')

    // 重新进入未分胜负的战斗并撤退 → 清剿停环
    state.expedition.active = false
    state.expedition.battle = null
    state.autoLoopAnomalyId = 'ano-a'
    enterBattle(state, ctx)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(state.autoLoopAnomalyId).toBeNull()
  })
})

/* ═══════════ 战斗超时判负（2026-09-10 船长定） ═══════════
 * 旧口径：打满 maxBattleMs 按剩余血量比判定，且 meRatio >= bestFoe 即判我方胜
 * （= 平局算赢）→ "打不死敌人但敌人也打不着我"的风筝流可白拿全额赏金。
 * 新口径：打满上限**一律判负**，并视同**被迫撤退**（轻损结算、停重复清剿、转返航）。 */
describe('战斗超时判负（视同被迫撤退）', () => {
  it('打满战斗上限 → 判负 + 轻损撤退：无赏金、停清剿、绝不弃船、日志写明超时', () => {
    const { state, ctx } = world()
    state.autoLoopAnomalyId = 'ano-a' // 巡回场：超时撤退须同时停环（船长定）
    enterBattle(state, ctx)
    const b = state.expedition.battle!
    // 双方都打不死对方 → 必然走到超时判定（不依赖击杀取样运气）
    const units = Object.values(b.units) as Array<{ hp: { s: number; a: number; h: number } }>
    for (const u of units) u.hp = { s: 1e9, a: 1e9, h: 1e9 }
    const iskBefore = state.wallet.isk
    const durBefore = durabilityOf(state, state.shipId)
    const armorBefore = state.fleet[state.shipId]!.armorPct ?? 1
    // 一步推到上限之外：战斗时钟走满 → 超时判定 → 撤退结算
    advanceGame(state, ctx.balance.battle.maxBattleMs + 5_000, ctx)

    expect(b.ended).toBe('foe') // 判负（旧口径在此为我方满血/敌未死 → 会判 'me'）
    expect(b.escapeReason).toBe('timeout') // 走的是"超时"来源，不是结构损失过半
    // **撤退不收维修费**（船长 2026-09-15「删除撤离费」）：钱包一分不动（旧口径会扣 奖励 ×25%）
    expect(state.wallet.isk).toBe(iskBefore)
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('战斗超时'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('舰船被迫撤退，正在返航'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('维修花去'))).toBe(false) // 文案同步：不再提维修费
    expect(state.autoLoopAnomalyId).toBeNull() // 超时 = 收手，停重复清剿
    expect(state.logs.some((l) => l.text.includes('重复清剿已停止（战斗超时）'))).toBe(true)
    const durAfter = durabilityOf(state, state.shipId)
    const armorAfter = state.fleet[state.shipId]!.armorPct ?? 1
    expect(durAfter).toBeGreaterThanOrEqual(0.05) // 下限保护：绝不因超时弃船
    expect(durAfter).toBeLessThanOrEqual(durBefore + 1e-9)
    // 与手动撤退**同一 K**：超时这一口也恰好 = 威胁 8 × 0.8/秒 × 5 秒 = 32 HP，且先吃装甲
    const caps = hullLayerCaps(state, ctx, state.shipId)!
    const bite = expectedBite(ctx)
    const armorHp = armorBefore * caps.capA
    const eat = Math.min(armorHp, bite)
    expect(armorAfter).toBeCloseTo((armorHp - eat) / caps.capA, 3)
    expect(state.logs.some((l) => l.text.includes('装甲 -'))).toBe(true)
    expect(state.fleet[state.shipId]).toBeDefined() // 船还在
  })

  // 承伤口径本体（与低安遇袭共用 `hullDamage.ts` 单点）
  it('一口伤害 = 敌群火力 × K 秒（线性随威胁），K 走 balance 可调常量', () => {
    const { ctx } = world()
    const K = ctx.balance.combat.retreatHitFirepowerSec
    // 2026-09-26 船长裁定「甲：单纯削减时间」：10 → 5 秒（四档同一 K；旧值 10 / 原 1 秒作废）
    expect(K).toBe(5)
    expect(firepowerHitHp(ctx, 8, K)).toBeCloseTo(32, 6)
    expect(firepowerHitHp(ctx, 40, K)).toBeCloseTo(160, 6) // 威胁 ×5 ⇒ 伤害 ×5
    expect(firepowerHitHp(ctx, 8, K * 3)).toBeCloseTo(96, 6) // 秒数线性
  })

  /**
   * **窝点档按派生威胁算这一口**（2026-09-14 船长裁定「顺手对齐」）：
   * 界面胜率/威胁与实战敌编成都按 `lairAnomalyOf` 派生后的卡（威胁 ×1.3/1.6/2.0），
   * 唯独撤退取数原先读基础卡 ⇒ 窝点档被少算。这里用 L3（×2.0）钉住"按派生值扣"。
   * ⚠ 基准卡威胁取 **2**（不是 1）：K 改成 5 秒后，威胁 2 派生 4 ⇒ 那一口 16 HP 才够打穿测试船甲池
   * （威胁 1 派生 2 ⇒ 8 HP < 甲池 10，本用例的第二段反向断言会失效）。
   */
  it('窝点档（L3 ×2.0）：脱身那一口按**派生后威胁**算（基础卡威胁 2 ⇒ 派生 4 ⇒ 16 HP 打穿甲池）', () => {
    const base = makeTestCtx({ quietEvents: true })
    const card = anomaly('ano-lair', 'galaxy-hub', { threat: 2, lairCore: '测试窝点' })
    const ctx: SimContext = { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) }
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(startExpedition(state, 'ano-lair', ctx, { lairTier: 3 }).ok).toBe(true)
    advanceGame(state, 1_000, ctx)
    expect(state.expedition.phase).toBe('battle')
    const caps = hullLayerCaps(state, ctx, state.shipId)!
    expect(retreatBattle(state, ctx).ok).toBe(true)
    const derivedThreat = Math.round(card.threat * LAIR_THREAT_MUL[3]) // 2 × 2.0 = 4
    const bite = firepowerHitHp(ctx, derivedThreat, ctx.balance.combat.retreatHitFirepowerSec) // 4×0.8×5 = 16
    expect(bite).toBe(16)
    const baseBite = firepowerHitHp(ctx, card.threat, ctx.balance.combat.retreatHitFirepowerSec) // 基础口径 = 8
    const ship = state.fleet[state.shipId]!
    const rest = Math.max(0, bite - caps.capA)
    expect(ship.armorPct).toBe(0) // 16 > 甲池 ⇒ 甲清零（按基础威胁的 8 不会清零，见下）
    expect(ship.durability).toBeCloseTo(Math.max(0.05, 1 - rest / caps.capH), 3)
    // 反向：若按基础威胁算，这一口吃不满甲池 ⇒ 结构分文不动（两者读数必须不同，否则本用例咬不住对齐）
    expect(baseBite).toBeLessThan(caps.capA)
    expect(caps.capA).toBeGreaterThan(0)
  })
})

/* ═══════════ 手动撤退 = 立刻回港（2026-09-11 船长） ═══════════
 * 船长：「玩家战斗手动撤退后应该是立刻回港，现在战斗撤退有返港时间。」
 * ⇒ 手动撤退不再付返航航程（到港时刻 = 战斗停表时刻，下一拍即入港卸货）；
 *    自动撤退（结构损失过半）与超时判负**仍按原口径返航**（"被迫撤离，正在返航"）。 */
describe('手动撤退 = 立刻回港（自动/超时仍返航）', () => {
  it('手动撤退：返航段为 0（finishAtGameMs = returnAtGameMs），推进一拍即到港卸货', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    const exp = state.expedition
    expect(exp.phase).toBe('back')
    expect(exp.returnReason).toBe('retreat')
    expect(exp.returnAtGameMs).toBeDefined()
    expect(exp.finishAtGameMs).toBe(exp.returnAtGameMs) // 零航程 = 立刻回港
    expect(state.logs.some((l) => l.text.includes('即刻回港'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('即刻返回最近的空间站'))).toBe(true)
    // 下一拍：入港 → 远征结束、船停在站上（active=false）
    advanceGame(state, 1_000, ctx)
    expect(state.expedition.active).toBe(false)
    expect(state.expedition.phase).toBe('out')
    expect(state.logs.some((l) => l.text.includes('舰队已停靠'))).toBe(true)
  })

  it('自动撤退（结构损失过半）仍要返航航程（未被手动口径带偏）', () => {
    const { state, ctx } = world()
    state.autoLoopAnomalyId = 'ano-a'
    enterBattle(state, ctx)
    // 把结构打到 50% 以下 → 步进自动中止（连续作战保险）
    const u = state.expedition.battle!.units['player']!
    u.hp = { s: 0, a: 0, h: 1 }
    advanceGame(state, 5_000, ctx)
    const exp = state.expedition
    expect(exp.phase).toBe('back')
    expect(exp.returnReason).toBe('retreat')
    expect(exp.finishAtGameMs).toBeGreaterThan(exp.returnAtGameMs!) // 仍付航程
    expect(state.logs.some((l) => l.text.includes('自动撤退'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('自动返航（去程时间并入返航）'))).toBe(true)
  })

  it('超时判负仍要返航航程（"被迫撤退，正在返航"口径不变）', () => {
    const { state, ctx } = world()
    enterBattle(state, ctx)
    const b = state.expedition.battle!
    for (const u of Object.values(b.units) as Array<{ hp: { s: number; a: number; h: number } }>) {
      u.hp = { s: 1e9, a: 1e9, h: 1e9 }
    }
    advanceGame(state, ctx.balance.battle.maxBattleMs + 5_000, ctx)
    const exp = state.expedition
    expect(exp.returnReason).toBe('retreat')
    expect(exp.finishAtGameMs).toBeGreaterThan(exp.returnAtGameMs!) // 仍付航程
  })
})
