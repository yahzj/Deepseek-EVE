/**
 * 战斗中"撤退"（2026-09-11 船长改口径：与低安遇袭同一套承伤算法）：
 * 脱身那一口 = **敌群火力（威胁 × foeDpsPerThreat）× combat.retreatHitFirepowerSec（K = 1 秒）**，
 * **先扣装甲、吸完再进结构**，结构 5% 底线（绝不弃船）、无弃船骰、转自动返航。
 * 取代旧口径「轻损 = 失利扣损骰 ×0.5 = 结构 −7.5%~15%（与敌人强弱无关、装甲不动）」。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { retreatBattle, startExpedition } from '../src/expedition'
import { durabilityOf, hullLayerCaps } from '../src/shipyard'
import { firepowerHitHp } from '../src/hullDamage'
import { makeTestCtx } from './helpers'

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
    const bite = expectedBite(ctx)
    expect(bite).toBeCloseTo(8 * ctx.balance.battle.foeDpsPerThreat * 1, 6) // 威胁 8 × 0.8/秒 × 1 秒 = 6.4 HP
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('back') // 自动返航
    // 期望：这一口先由装甲池吸收（测试船甲 10 > 6.4 ⇒ 结构分文不动）
    const armorHp = armorBefore * caps.capA
    const eat = Math.min(armorHp, bite)
    const rest = Math.max(0, bite - eat)
    expect(ship.armorPct ?? 1).toBeCloseTo((armorHp - eat) / caps.capA, 3)
    expect(ship.durability).toBeCloseTo(Math.max(0.05, structBefore - rest / caps.capH), 3)
    expect(rest).toBe(0) // 装甲没被打穿
    expect(ship.durability).toBe(structBefore)
    expect(state.fleet[state.shipId]).toBeDefined() // 绝不弃船
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('撤退'))).toBe(true)
    // 日志给的是"装甲 -X%（现 装甲 x% / 结构 y%）"这一套（与遇袭同款说法）
    expect(state.logs.some((l) => l.text.includes('装甲 -'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('现 装甲'))).toBe(true)
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
    expect(state.wallet.isk).toBeLessThanOrEqual(iskBefore) // 判负：拿不到赏金（反被扣维修费）
    expect(state.logs.some((l) => l.kind === 'warn' && l.text.includes('战斗超时'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('舰船被迫撤退，正在返航'))).toBe(true)
    expect(state.autoLoopAnomalyId).toBeNull() // 超时 = 收手，停重复清剿
    expect(state.logs.some((l) => l.text.includes('重复清剿已停止（战斗超时）'))).toBe(true)
    const durAfter = durabilityOf(state, state.shipId)
    const armorAfter = state.fleet[state.shipId]!.armorPct ?? 1
    expect(durAfter).toBeGreaterThanOrEqual(0.05) // 下限保护：绝不因超时弃船
    expect(durAfter).toBeLessThanOrEqual(durBefore + 1e-9)
    // 与手动撤退**同一 K**：超时这一口也恰好 = 威胁 8 × 0.8/秒 × 1 秒 = 6.4 HP，且先吃装甲
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
    expect(K).toBe(1) // 船长 2026-09-11 定：撤退 K = 1 秒（三档同一 K）
    expect(firepowerHitHp(ctx, 8, K)).toBeCloseTo(6.4, 6)
    expect(firepowerHitHp(ctx, 40, K)).toBeCloseTo(32, 6) // 威胁 ×5 ⇒ 伤害 ×5
    expect(firepowerHitHp(ctx, 8, K * 3)).toBeCloseTo(19.2, 6) // 秒数线性
  })
})
