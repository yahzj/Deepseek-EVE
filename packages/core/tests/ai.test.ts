/**
 * AI 核心系统（v8）单元测试：购买/名额/指派/效率计时/远征结算/掉落/取消/迁移由 save 负责。
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
import { anomaly, makeTestCtx, moduleDef, ship, skill } from './helpers'
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
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
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
    state.fleet['sandcat3'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
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
    state2.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
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
  it('只接高胜率单：最终成功率不足 80% 拒绝；未亲手完成的目标一律拒绝；指派成功则按效率拉长耗时', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx = makeTestCtx({ anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 2, reward: 8_000 })] })
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
    gainAiCore(state, 'basic', 1)

    // 手动首胜解锁：即使胜率合格，未亲手完成过的目标 AI 一律拒接
    const noClear1 = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-a', ctx)
    const noClear2 = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy', ctx)
    expect(noClear1.ok).toBe(false)
    expect(noClear2.ok).toBe(false)
    // 模拟玩家已手动首胜过这两个目标
    state.completedBounties.push('ano-a', 'ano-easy')

    // AI 门槛 = "最终成功率"口径 aiWinPreview ≥80%（favor 修正 + 扩散；与结算 favor、AI 面板展示同源）
    const gate = (anomalyId: string): boolean => {
      const a = ctx.anomalies.get(anomalyId)!
      return aiWinPreview(state, ctx, a, 'sandcat2') >= 0.8
    }
    const r1 = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-a', ctx)
    expect(r1.ok).toBe(gate('ano-a'))
    if (r1.ok) cancelAiTask(state, 'sandcat2', ctx)
    const r2 = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy', ctx)
    expect(r2.ok).toBe(gate('ano-easy'))
    if (r2.ok) {
      // 母港目标无航程：outMs 仅 1ms 保底 → 下一拍即到港开战
      const task = state.aiAssignments['sandcat2']!.task as { finishAtGameMs: number; outMs: number }
      expect(task.outMs).toBeGreaterThanOrEqual(1)
      expect(task.finishAtGameMs).toBe(task.outMs)
      cancelAiTask(state, 'sandcat2', ctx)
    }
    // 低耐久拒绝（与预览无关的硬门槛）
    const state2 = createInitialState({ nowWallMs: 0, seed: 1 })
    const ctx2 = makeTestCtx({ anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 2 })] })
    state2.skills.trained['ai-expert'] = 1
    state2.fleet['sandcat2'] = { durability: 0.3, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
    gainAiCore(state2, 'basic', 1)
    state2.completedBounties.push('ano-easy') // 已解锁，仍被低耐久门槛拒绝
    expect(assignAiExpedition(state2, 'sandcat2', 'basic', 'ano-easy', ctx2).ok).toBe(false)
  })

  it('到点结算：任务结束 + 战报；胜利全额奖金且可能掉核心', () => {
    // 给副船装炮台 + 弹药，把 AI 指派门槛推到 ≥80%（同源 preview）
    const tur = moduleDef('tur-ai', 'turret', 0.5, {
      maxRangeM: 6000,
      minRangeM: 0,
      hitRate: 0.9,
      falloff: 0.3,
      reloadMs: 1000,
      dmgMult: 3,
      cpuUse: 10,
    })
    for (const seedNum of [1, 5, 9, 13, 17]) {
      const state = createInitialState({ nowWallMs: 0, seed: seedNum })
      const ctx = makeTestCtx({
        modules: [tur],
        anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 2, reward: 8_000 })],
        balance: { ...makeTestCtx().balance, aiCore: { ...makeTestCtx().balance.aiCore, drops: [{ minThreat: 1, rewards: [{ type: 'gamma', chance: 1 }] }] } },
      })
      state.skills.trained['ai-expert'] = 1
      state.skills.trained['gunnery'] = 5
      state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: 'tur-ai', shield: null, armor: null, propulsion: null } }
      state.warehouse.items['ammo-kinetic-l'] = 1_000
      gainAiCore(state, 'basic', 1)
      state.completedBounties.push('ano-easy') // 玩家已手动首胜 → AI 解锁（自动远征前提）
      const walletBefore = state.wallet.isk
      const r = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy', ctx)
      expect(r.ok).toBe(true) // 武装副船必须过 ≥80% 门槛（若失败说明预览数值需校准）
      advanceGame(state, 600_000, ctx)

      expect(state.aiAssignments['sandcat2']).toBeUndefined() // 任务结束
      expect(state.logs.some((l) => l.text.includes('[AI') && l.text.includes('战报'))).toBe(true)
      // AI 结算不写首胜清单、不发放声望（声望只属于亲手完成）
      expect(state.completedBounties).toEqual(['ano-easy'])
      expect(state.standings['dsi']).toBeUndefined()
      if (state.wallet.isk > walletBefore) {
        // 胜利路径：全额 8000（±15% 浮动），必掉伽马（定制掉落表）
        expect(state.wallet.isk - walletBefore).toBeGreaterThanOrEqual(6_800)
        expect(countAiCore(state, 'gamma')).toBe(1)
        expect(state.logs.some((l) => l.text.includes('缴获'))).toBe(true)
        break // 找到一条胜利路径即通过
      }
      // 失利路径：核心已归还
      expect(countAiCore(state, 'basic')).toBe(1)
    }
  })

  it('失利低耐久自动维修 / 弃船归还核心（两分支宽松断言）', () => {
    // 用高威胁目标强制低胜率，直接构造任务（绕过 ≥80% 门槛）再调用结算
    const hardCtx = makeTestCtx({ anomalies: [anomaly('ano-hard9', 'galaxy-hub', { threat: 9000, reward: 8_000 })] })
    const s1 = createInitialState({ nowWallMs: 0, seed: 3 })
    s1.skills.trained['ai-expert'] = 1
    s1.fleet['sandcat2'] = { durability: 0.5, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
    // 直接构造"已出发"任务（两阶段：out 已到港），走完整战斗失败路径
    s1.aiAssignments['sandcat2'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'expedition', anomalyId: 'ano-hard9', finishAtGameMs: 0, outMs: 0, power: 10, phase: 'out', battle: null },
    }
    // 高威胁目标：到港开战并很快战败（500 发级余量：时间足够战斗走完）
    advanceGame(s1, 120_000, hardCtx)
    // 任务必结束、核心必归还
    expect(s1.aiAssignments['sandcat2']).toBeUndefined()
    expect(countAiCore(s1, 'basic')).toBe(1)
    // 战败路径：耐久下降或弃船（日志有战报/损毁）
    expect(s1.logs.some((l) => l.text.includes('战报') || l.text.includes('舰船损毁'))).toBe(true)
  })
})
