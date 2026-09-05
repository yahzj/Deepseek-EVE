/**
 * AI 核心系统（v8）单元测试：购买/名额/指派/效率计时/远征软下线善后/取消/迁移由 save 负责。
 * AI 远征已软下线（2026-09-05 船长定）：旧战斗结算路径的用例随之下线，
 * 恢复远征时再补回（引擎旧逻辑保留未删）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { MarketGoodDef, SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { countWare } from '../src/inventory'
import {
  aiEfficiency,
  aiSlotsUsed,
  assignAiExpedition,
  assignAiMining,
  buyBasicAiCore,
  cancelAiTask,
  countAiCore,
  gainAiCore,
  idleAiShipIds,
  maxAiSlots,
} from '../src/ai'
import { anomaly, makeTestCtx, fittedOf } from './helpers'
import { aiWinPreview } from '../src/combat'

/** 基础核心的市场卡（测试世界不自动生成核心，手动补一张） */
const CORE_BASIC_GOOD: MarketGoodDef = {
  key: 'core-basic',
  kind: 'aicore',
  refId: 'basic',
  rarity: 'common',
  basePrice: 25_000,
  playerSellable: false,
}

describe('AI 核心库与名额', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx({ marketGoods: [CORE_BASIC_GOOD] })
  })

  it('效率表：基础 40% / 伽马 50% / 贝塔 60% / 阿尔法 75%', () => {
    expect(aiEfficiency(state, ctx, 'basic')).toBe(0.4)
    expect(aiEfficiency(state, ctx, 'gamma')).toBe(0.5)
    expect(aiEfficiency(state, ctx, 'beta')).toBe(0.6)
    expect(aiEfficiency(state, ctx, 'alpha')).toBe(0.75)
  })

  it('购买基础核心：扣款入库；钱不够拒绝', () => {
    expect(countAiCore(state, 'basic')).toBe(0)
    state.wallet.isk = 24_999
    expect(buyBasicAiCore(state, ctx).ok).toBe(false)
    state.wallet.isk = 25_000
    expect(buyBasicAiCore(state, ctx).ok).toBe(true)
    expect(state.wallet.isk).toBe(0)
    expect(countAiCore(state, 'basic')).toBe(1)
  })

  it('名额 = 人工智能专家等级；技能 0 级不能指挥', () => {
    expect(maxAiSlots(state, ctx)).toBe(0)
    state.skills.trained['ai-expert'] = 2
    expect(maxAiSlots(state, ctx)).toBe(2)
  })
})

describe('AI 采矿任务', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.skills.trained['ai-expert'] = 1
    // 舰队加一艘可指派的空闲船（sandcat2：100 m³ / 6s / 每循环 5 单位）
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    gainAiCore(state, 'basic', 2)
    ctx = makeTestCtx()
  })

  it('指派校验：主控船/未知船/重复指派/无核心/名额满 均拒绝', () => {
    expect(assignAiMining(state, 'sandcat', 'basic', 'belt-a', ctx).ok).toBe(false) // 主控
    expect(assignAiMining(state, '不存在', 'basic', 'belt-a', ctx).ok).toBe(false)
    expect(assignAiMining(state, 'sandcat2', 'alpha', 'belt-a', ctx).ok).toBe(false) // 无阿尔法核心
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(false) // 重复
    // 名额 1：第二艘船无空位（先把 sandcat3 加进舰队）
    state.fleet['sandcat3'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    const r3 = assignAiMining(state, 'sandcat3', 'basic', 'belt-a', ctx)
    expect(r3.ok).toBe(false)
    expect(r3.error).toContain('名额已满')
  })

  it('指派成功：扣核心、占用名额、可取消并归还', () => {
    expect(aiSlotsUsed(state)).toBe(0)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    expect(countAiCore(state, 'basic')).toBe(1) // 用掉 1 颗
    expect(aiSlotsUsed(state)).toBe(1)
    expect(idleAiShipIds(state)).not.toContain('sandcat2')
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    expect(countAiCore(state, 'basic')).toBe(2) // 归还
    expect(aiSlotsUsed(state)).toBe(0)
  })

  it('效率拉长节奏：基础核心 40% → 6 秒循环实际需 15 秒采 5 单位', () => {
    assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx)
    advanceGame(state, 14_000, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a'] ?? 0).toBe(0) // 不足一个循环
    advanceGame(state, 1_000, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(5)
    // 阿尔法 75%：6s/0.75 = 8 秒一个循环
    const state2 = createInitialState({ nowWallMs: 0, seed: 42 })
    state2.skills.trained['ai-expert'] = 1
    state2.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    gainAiCore(state2, 'alpha', 1)
    assignAiMining(state2, 'sandcat2', 'alpha', 'belt-a', ctx)
    advanceGame(state2, 8_000, ctx)
    expect(state2.fleet['sandcat2']!.cargo['ore-a']).toBe(5)
  })

  it('满舱自动返航卸货入物品仓库后继续出航（效率计入行程）', () => {
    assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx)
    // sandcat2 货仓 100 m³：每循环 5 单位 → 20 循环采满
    // 循环实际 15s → 300s 采满；第 21 个循环节拍触发返航（+15s）；满载返航腿 = 120s/0.4 = 300s
    advanceGame(state, 315_000, ctx)
    expect(state.mining.phase || state.fleet['sandcat2']).toBeDefined()
    expect(state.aiAssignments['sandcat2']!.task.kind).toBe('mining')
    const task = state.aiAssignments['sandcat2']!.task as { phase: string }
    expect(task.phase).toBe('returning')
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(100)
    // 300 秒后到港卸货 → 仓库 100 单位，转入出航
    advanceGame(state, 300_000, ctx)
    expect(countWare(state, 'ore-a')).toBe(100)
    const task2 = state.aiAssignments['sandcat2']!.task as { phase: string }
    expect(task2.phase).toBe('outbound')
  })
})

describe('AI 远征任务', () => {
  it('软下线（2026-09-05 船长定）：指派一律拒绝——即使已首胜解锁/武装达标/耐久合格，也不占名额不耗核心', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 2, reward: 8_000 })] })
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    gainAiCore(state, 'basic', 1)
    state.completedBounties.push('ano-easy') // 已亲手首胜（原解锁前提）
    const r = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已下线')
    expect(state.aiAssignments['sandcat2']).toBeUndefined() // 未占用名额
    expect(countAiCore(state, 'basic')).toBe(1) // 核心未耗
    expect(aiSlotsUsed(state)).toBe(0)
  })

  it('软下线：遗留远征任务推进时安全善后（取消 + 归还核心；不进入战斗、不结算奖励/声望）', () => {
    // 直接构造"进行中"的旧版远征任务（模拟旧档/旧版本遗留），推进应被善后而非开战
    for (const seedNum of [1, 5]) {
      const state = createInitialState({ nowWallMs: 0, seed: seedNum })
      const ctx = makeTestCtx({ anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 2, reward: 8_000 })] })
      state.skills.trained['ai-expert'] = 1
      state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
      // 模拟旧档：任务进行中=核心已被占用（库存 0），善后应归还 1 颗
      state.completedBounties.push('ano-easy')
      state.aiAssignments['sandcat2'] = {
        coreType: 'basic',
        startedAtGameMs: 0,
        task: { kind: 'expedition', anomalyId: 'ano-easy', finishAtGameMs: 0, outMs: 0, power: 10, phase: 'out', battle: null },
      }
      const walletBefore = state.wallet.isk
      advanceGame(state, 600_000, ctx)
      expect(state.aiAssignments['sandcat2']).toBeUndefined() // 任务已善后
      expect(countAiCore(state, 'basic')).toBe(1) // 核心归还
      expect(state.logs.some((l) => l.text.includes('AI 远征已下线'))).toBe(true)
      expect(state.logs.some((l) => l.text.includes('战报'))).toBe(false) // 未进入战斗结算
      expect(state.wallet.isk).toBe(walletBefore) // 无奖励入账
      expect(state.completedBounties).toEqual(['ano-easy']) // 无新首胜
      expect(state.standings['dsi']).toBeUndefined() // 无声望
    }
  })
})
