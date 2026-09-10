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
  aiCoreCap,
  aiCoreUsed,
  aiCoreShipUsed,
  aiCoreIndustryUsed,
  aiCoreCapBlock,
  industryAiBonus,
  aiEfficiency,
  aiTaskView,
  assignAiExpedition,
  assignAiMining,
  advanceAi,
  buyBasicAiCore,
  cancelAiTask,
  countAiCore,
  gainAiCore,
  idleAiShipIds,
} from '../src/ai'
import { anomaly, makeTestCtx, fittedOf, ship } from './helpers'
import { aiWinPreview } from '../src/combat'
import { startRefineRun, stopRefineRun } from '../src/industry'
import { startManufacturing, cancelManufacturing } from '../src/manufacturing'
import { learnBlueprint } from '../src/market'
import { changeShip } from '../src/shipyard'

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

  it('AI 核心调度学（卷B3⑩）：核心档位之上每级 +2 个百分点累加（基础 40% → 满级 50%）', () => {
    state.skills.trained['ai-core-dispatch'] = 5
    expect(aiEfficiency(state, ctx, 'basic')).toBe(0.5) // 0.4 + 0.02×5
    expect(aiEfficiency(state, ctx, 'gamma')).toBe(0.6)
    expect(aiEfficiency(state, ctx, 'beta')).toBe(0.7)
    expect(aiEfficiency(state, ctx, 'alpha')).toBe(0.85) // 0.75 + 0.10
    // 每级累加生效抽查
    state.skills.trained['ai-core-dispatch'] = 2
    expect(aiEfficiency(state, ctx, 'basic')).toBe(0.44) // 0.4 + 0.04
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

  it('启用上限 = AI 核心上限技能贡献（现唯一 = AI 核心操作学等级）；Lv0 = 0 不能启用', () => {
    expect(aiCoreCap(state, ctx)).toBe(0)
    state.skills.trained['ai-expert'] = 2
    expect(aiCoreCap(state, ctx)).toBe(2)
  })

  it('工业专用扩容：「工业自动化基础」+1/级、「工业自动化」+2/级，只对站内产业生效（2026-09-11 新增 rank3 技能）', () => {
    expect(industryAiBonus(state, ctx)).toBe(0)
    state.skills.trained['industrial-ai-cap'] = 2
    expect(industryAiBonus(state, ctx)).toBe(4) // 每级 +2（balance aiCore.industrySkillSlots）
    // 2026-09-11 船长定：新增 rank3「工业自动化基础」每级 +1，与工业自动化**叠加**
    state.skills.trained['industrial-ai-cap-basic'] = 3
    expect(industryAiBonus(state, ctx)).toBe(4 + 3)
    // 两项都练满：基础 5×1 + 工业自动化 5×2 = 15（站内上限 = 共用 5 + 扩容 15 = 20）
    state.skills.trained['industrial-ai-cap-basic'] = 5
    state.skills.trained['industrial-ai-cap'] = 5
    expect(industryAiBonus(state, ctx)).toBe(15)
    // 清零新技能 → 回落到只有工业自动化的 10（证明新技能确实进表、不是摆设）
    state.skills.trained['industrial-ai-cap-basic'] = 0
    expect(industryAiBonus(state, ctx)).toBe(10)
    state.skills.trained['industrial-ai-cap-basic'] = 5
    // ai-expert = 0：AI 副船（默认 ship scope）仍被共用上限为 0 拦截；
    // 站内产业（industry scope）可先用工业扩容工位（used 0 < 0+15）
    expect(aiCoreCapBlock(state, ctx)).not.toBeNull()
    expect(aiCoreCapBlock(state, ctx) ?? '').toContain('AI 核心上限为 0')
    expect(aiCoreCapBlock(state, ctx, 'industry')).toBeNull()
    // 共用上限满、扩容还有空余：产业照常放行（副船仍拦截）
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = {
      durability: 1,
      armorPct: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    state.aiAssignments['sandcat2'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: '', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    expect(aiCoreUsed(state)).toBe(1)
    expect(aiCoreCapBlock(state, ctx)).not.toBeNull() // 1/1 满 → 副船拒
    expect(aiCoreCapBlock(state, ctx, 'industry')).toBeNull() // 1 < 1+15 → 产业可开
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
    // 关闭富矿脉保时序/数量确定（红利窗口用例自建 p=1 环境）
    const bal = makeTestCtx().balance
    ctx = makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
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
    expect(r3.error).toContain('AI 核心启用已满')
  })

  it('指派成功：扣核心、占用启用数、可取消并归还', () => {
    expect(aiCoreUsed(state)).toBe(0)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    expect(countAiCore(state, 'basic')).toBe(1) // 用掉 1 颗
    expect(aiCoreUsed(state)).toBe(1)
    expect(idleAiShipIds(state)).not.toContain('sandcat2')
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    expect(countAiCore(state, 'basic')).toBe(2) // 归还
    expect(aiCoreUsed(state)).toBe(0)
  })

  it('伽马/贝塔核心可指派采矿（2026-09-08 玩家反馈修复配套回归：核心类型不限基础）', () => {
    gainAiCore(state, 'gamma', 1)
    expect(assignAiMining(state, 'sandcat2', 'gamma', 'belt-a', ctx).ok).toBe(true)
    expect(countAiCore(state, 'gamma')).toBe(0) // 出库占用
    expect(countAiCore(state, 'basic')).toBe(2) // 基础库存不受影响
    // 效率 50%：6 秒循环实际需 12 秒采 5 单位
    advanceGame(state, 11_999, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a'] ?? 0).toBe(0) // 不足一个循环
    advanceGame(state, 1, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(5)
    // 贝塔核心同样可指派（回归：非基础类型全部可用，2026-09-08）
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    gainAiCore(state, 'beta', 1)
    expect(assignAiMining(state, 'sandcat2', 'beta', 'belt-a', ctx).ok).toBe(true)
    expect(countAiCore(state, 'beta')).toBe(0) // 出库占用
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

  it('AI 核心调度学满级：基础核心 40%→50% → 6 秒循环实际需 12 秒采 5 单位', () => {
    state.skills.trained['ai-core-dispatch'] = 5 // 6000ms / 0.5 = 12000ms
    assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx)
    advanceGame(state, 11_999, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a'] ?? 0).toBe(0) // 不足一个循环
    advanceGame(state, 1, ctx)
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(5)
  })

  it('满舱自动返航卸货入物品仓库后继续出航（效率计入行程）', () => {
    assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx)
    // sandcat2 货仓 100 m³：每循环 5 单位 → 20 循环采满
    // 循环实际 15s → 300s 采满；第 21 个循环节拍触发返航（+15s）；
    // 满载返航腿与主控一致不再 ÷0.4：满舱占比 1 → 120s（卷B2⑥）
    advanceGame(state, 315_000, ctx)
    expect(state.mining.phase || state.fleet['sandcat2']).toBeDefined()
    expect(state.aiAssignments['sandcat2']!.task.kind).toBe('mining')
    const task = state.aiAssignments['sandcat2']!.task as { phase: string }
    expect(task.phase).toBe('returning')
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(100)
    // 120 秒后到港卸货 → 仓库 100 单位，转入出航
    advanceGame(state, 120_000, ctx)
    expect(countWare(state, 'ore-a')).toBe(100)
    const task2 = state.aiAssignments['sandcat2']!.task as { phase: string }
    expect(task2.phase).toBe('outbound')
  })

  it('返航腿与主控同口径：部分货载按占比缩放（25% 货载 → 实返航 30 秒，不再 ÷核心效率）', () => {
    // 手工构造"返航中"采矿任务 + 25 m³ 货载（25/100 → 满仓基准 120s×0.25=30s；
    // 卷B2⑥ 返航腿不再 ÷0.4——旧口径 ÷0.4 需 75s，旧满仓口径需 300s）
    state.fleet['sandcat2']!.cargo['ore-a'] = 25
    state.aiAssignments['sandcat2'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'returning', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 25 },
    }
    advanceGame(state, 29_999, ctx)
    expect((state.aiAssignments['sandcat2']!.task as { phase: string }).phase).toBe('returning') // 尚未到港
    expect(state.fleet['sandcat2']!.cargo['ore-a'] ?? 0).toBe(25)
    advanceGame(state, 1, ctx) // 第 30 秒整：到港卸货（回归点：÷0.4 口径下此刻仍在返航）
    expect(countWare(state, 'ore-a')).toBe(25)
    expect(state.fleet['sandcat2']!.cargo['ore-a'] ?? 0).toBe(0)
    expect((state.aiAssignments['sandcat2']!.task as { phase: string }).phase).toBe('outbound') // 转出航继续循环
  })

  it('aiTaskView 与主控同口径：返航给进度与剩余（满仓 120s 腿，不再 ÷0.4；半程 = 50%）', () => {
    state.fleet['sandcat2']!.cargo['ore-a'] = 100
    state.aiAssignments['sandcat2'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'returning', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 100 },
    }
    const v0 = aiTaskView(state, ctx, 'sandcat2')!
    expect(v0.kind).toBe('mining')
    expect(v0.label).toBe('返航卸货中')
    expect(v0.percent).toBe(0)
    advanceGame(state, 59_999, ctx)
    expect((state.aiAssignments['sandcat2']!.task as { phase: string }).phase).toBe('returning')
    advanceGame(state, 1, ctx)
    const v1 = aiTaskView(state, ctx, 'sandcat2')!
    expect(v1.remainingMs).toBe(60_000)
    expect(v1.percent).toBe(50)
  })

  it('富矿红利窗口独立推进：触发当轮 ×3、次轮 ×3、只在触发写日志', () => {
    const bal = makeTestCtx().balance
    const p1Ctx = makeTestCtx({ balance: { ...bal, richVeinChance: 5 } }) // cycleReal=15s → p=1 必中
    assignAiMining(state, 'sandcat2', 'basic', 'belt-a', p1Ctx)
    advanceGame(state, 30_000, p1Ctx) // 2 循环：触发 15 + 窗口 15
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(30)
    expect((state.aiAssignments['sandcat2']!.task as { rvLeft?: number }).rvLeft).toBe(0)
    expect(state.logs.filter((l) => l.text.includes('富矿脉')).length).toBe(1) // 窗口结束不写日志
    advanceGame(state, 15_000, p1Ctx) // 第 3 循环重新触发
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(45)
    expect((state.aiAssignments['sandcat2']!.task as { rvLeft?: number }).rvLeft).toBe(1)
    expect(state.logs.filter((l) => l.text.includes('富矿脉')).length).toBe(2)
  })

  it('两艘 AI 副船各自独立计窗口', () => {
    const bal = makeTestCtx().balance
    const p1Ctx = makeTestCtx({ balance: { ...bal, richVeinChance: 5 } })
    state.skills.trained['ai-expert'] = 2
    state.fleet['sandcat3'] = { defId: 'sandcat2', durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', p1Ctx).ok).toBe(true)
    expect(assignAiMining(state, 'sandcat3', 'basic', 'belt-a', p1Ctx).ok).toBe(true)
    advanceGame(state, 15_000, p1Ctx) // 两船各完成 1 循环：各自触发
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(15)
    expect(state.fleet['sandcat3']!.cargo['ore-a']).toBe(15)
    expect((state.aiAssignments['sandcat2']!.task as { rvLeft?: number }).rvLeft).toBe(1)
    expect((state.aiAssignments['sandcat3']!.task as { rvLeft?: number }).rvLeft).toBe(1)
    advanceGame(state, 15_000, p1Ctx) // 各自消耗窗口循环
    expect(state.fleet['sandcat2']!.cargo['ore-a']).toBe(30)
    expect(state.fleet['sandcat3']!.cargo['ore-a']).toBe(30)
    expect((state.aiAssignments['sandcat2']!.task as { rvLeft?: number }).rvLeft).toBe(0)
    expect((state.aiAssignments['sandcat3']!.task as { rvLeft?: number }).rvLeft).toBe(0)
  })
})

describe('AI 打捞任务', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    gainAiCore(state, 'basic', 1)
    ctx = makeTestCtx()
  })

  it('返航腿与主控同口径：部分货载按占比缩放（25 m³ → 实返航 30 秒，不再 ÷核心效率）→ 到港卸货后自动循环续趟', () => {
    // 手工构造"返航中"打捞任务（galaxy-hub 本地：基准腿 = localLegMs 120s）+ 25 m³ 货载
    // → 120s×0.25=30s 实返航（卷B2⑥ 不再 ÷0.4——旧 ÷0.4 口径需 75s，旧满仓口径需 300s）
    state.fleet['sandcat2']!.cargo['ore-a'] = 25 // 计数 = 体积（m³）
    state.aiAssignments['sandcat2'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'salvage', galaxyId: 'galaxy-hub', phase: 'returning', phaseAccMs: 0, cycleAccMs: 0, deviceAccMs: {}, tripM3: 25 },
    }
    advanceGame(state, 29_999, ctx)
    expect((state.aiAssignments['sandcat2']!.task as { phase: string }).phase).toBe('returning')
    advanceGame(state, 1, ctx) // 第 30 秒整：到港卸货 → 自动循环：同星系再出航（任务不结束、核心不归还）
    expect(countWare(state, 'ore-a')).toBe(25)
    expect(state.aiAssignments['sandcat2']).toBeDefined()
    expect((state.aiAssignments['sandcat2']!.task as { phase: string }).phase).toBe('outbound')
    expect(countAiCore(state, 'basic')).toBe(1) // 循环中：核心仍占用
    // 取消任务 → 归还核心
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    expect(state.aiAssignments['sandcat2']).toBeUndefined()
    expect(countAiCore(state, 'basic')).toBe(2) // 占用 1 枚已归还
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
    expect(r.error).toContain('暂停受理')
    expect(state.aiAssignments['sandcat2']).toBeUndefined() // 未占用启用数
    expect(countAiCore(state, 'basic')).toBe(1) // 核心未耗
    expect(aiCoreUsed(state)).toBe(0)
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
      expect(state.logs.some((l) => l.text.includes('自动远征暂停受理'))).toBe(true)
      expect(state.logs.some((l) => l.text.includes('战报'))).toBe(false) // 未进入战斗结算
      expect(state.wallet.isk).toBe(walletBefore) // 无奖励入账
      expect(state.completedBounties).toEqual(['ano-easy']) // 无新首胜
      expect(state.standings['dsi']).toBeUndefined() // 无声望
    }
  })
})

describe('AI 核心统一启用上限（2026-09-08 船长定：AI 副船任务与站内 AI 设施共用同一上限）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 7 })
    ctx = makeTestCtx()
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    state.warehouse.items['ore-a'] = 400 // 精炼炉用料
    state.warehouse.items['min-a'] = 20 // 制造 bp-a 用料（10/线）
    gainAiCore(state, 'basic', 3)
  })

  it('Lv0 上限 0：有核心也不能开 AI 炉', () => {
    const r = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('AI 核心上限为 0')
  })

  it('AI 炉占用启用数：满额再开拒；停炉即释放', () => {
    state.skills.trained['ai-expert'] = 1
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(1)
    const r2 = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('AI 核心启用已满')
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(0)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true) // 释放后可再开
  })

  it('AI 副船任务与 AI 炉互占名额（同一上限池）', () => {
    state.skills.trained['ai-expert'] = 1
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(1)
    const r = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('AI 核心启用已满')
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true) // 副船取消后名额释放
  })

  it('玩家反馈修复（2026-09-09）：站内工业占用先抵工业扩容工位——工业核心全开不再拦截副船任务', () => {
    state.skills.trained['ai-expert'] = 1 // 共用 1
    state.skills.trained['industrial-ai-cap'] = 1 // 工业扩容 2 → 站内总容量 1+2=3
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(aiCoreIndustryUsed(state)).toBe(2)
    expect(aiCoreUsed(state)).toBe(2)
    // 旧实现把 2 台全计进共用名额 → 误判 2/1 已满 → 副船被拦；修复后扩容先被抵用、共用名额空着
    expect(aiCoreCapBlock(state, ctx)).toBeNull()
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    // 副船 1 + 炉 2 = 3 = 1+2 全满：站内再开拒（工业 scope 按全量口径）
    const r = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('AI 核心启用已满')
    // 副船再派同样拒（副船已占满共用 1/1，扩容不归副船）
    state.fleet['sandcat3'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    const r2 = assignAiMining(state, 'sandcat3', 'basic', 'belt-a', ctx)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('AI 核心启用已满')
  })

  it('工业占用超出工业扩容的部分，才计入副船共用名额（与引擎同口径）', () => {
    state.skills.trained['ai-expert'] = 2 // 共用 2
    state.skills.trained['industrial-ai-cap'] = 1 // 工业扩容 2 → 站内总容量 2+2=4
    // sandcat3 不在默认 ctx 舰船目录 → 本测试用追加了该船的 ctx2 指派对
    const ctx2 = makeTestCtx({ ships: [ship('sandcat3', { cargo: 100, cycle: 6, perCycle: 5 })] })
    state.fleet['sandcat3'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    gainAiCore(state, 'basic', 2) // 合计 5 颗：炉 3 + 船 2
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true) // 第 3 台：2 台抵扩容 + 1 台挤占共用
    expect(aiCoreIndustryUsed(state)).toBe(3)
    // 工业挤占 1 枚共用名额 → 副船只剩 1 名额
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
    const r2 = assignAiMining(state, 'sandcat3', 'basic', 'belt-a', ctx2)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('AI 核心启用已满')
    // 停 1 台炉 → 挤占清零 → 第二艘副船可派
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    const r3 = assignAiMining(state, 'sandcat3', 'basic', 'belt-a', ctx2)
    expect(r3.ok).toBe(true)
    // 工业侧全量口径不变：副船 2 + 炉 2 = 4 = 2+2 → 站内再开拒
    const r4 = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(r4.ok).toBe(false)
    expect(r4.error).toContain('AI 核心启用已满')
  })

  it('制造线同池：Lv2 炉+线并行；第三处（副船）满额拒；停/取消后释放', () => {
    state.skills.trained['ai-expert'] = 2
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(2)
    const r = assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('AI 核心启用已满')
    // 停炉 + 取消线 → 全部释放 → 可再启用
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(0)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-a', ctx).ok).toBe(true)
  })

  it('存量超限（读档/技能低于占用）不中断：照常结算归还，但新启用被拒直到降到上限内', () => {
    state.skills.trained['ai-expert'] = 2
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
    state.skills.trained['ai-expert'] = 1 // 模拟技能低于当前占用（读档/变更后）
    expect(aiCoreUsed(state)).toBe(2) // 存量仍计入
    const blocked = startRefineRun(state, 'ore-a', 'basic', ctx)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('AI 核心启用已满')
    const before = state.refineRuns[0]!.batchesDone
    advanceGame(state, 16_000, ctx) // 存量炉照常推进（不中断）
    expect(state.refineRuns[0]!.batchesDone).toBeGreaterThan(before)
    // 停一台仍超限（占用 1 ≥ 上限 1）→ 新开仍被拒
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(false)
    expect(stopRefineRun(state, ctx, state.refineRuns[0]!.id).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(0)
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true) // 降到上限内可再开
  })

  it('旧作业豁免的制造线（worker 缺省）不计入启用数', () => {
    // Lv0：唯一上限来源为 0 → 只有旧作业豁免线时启用数仍为 0
    state.manufacturingRuns.push({ active: true, id: 99, blueprintId: 'bp-a', finishAtGameMs: 0, durationMs: 1000 })
    expect(aiCoreUsed(state)).toBe(0)
    expect(aiCoreCap(state, ctx)).toBe(0)
  })
})

describe('AI 执勤船 × 切换驾驶（2026-09-09 bug 回归：伽玛核心丢失）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    const bal = makeTestCtx().balance
    ctx = makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
    gainAiCore(state, 'gamma', 1)
  })

  it('切换驾驶到 AI 执勤中的副船：任务自动召回、伽玛核心归还（不再卡死消失）', () => {
    expect(assignAiMining(state, 'sandcat2', 'gamma', 'belt-a', ctx).ok).toBe(true)
    expect(countAiCore(state, 'gamma')).toBe(0) // 出库占用
    expect(state.aiAssignments['sandcat2']).toBeDefined()
    // 玩家直接切换驾驶到这艘执勤船（旧实现漏召回 → 任务隐形占用核心）
    expect(changeShip(state, 'sandcat2', ctx).ok).toBe(true)
    expect(state.shipId).toBe('sandcat2')
    expect(state.aiAssignments['sandcat2']).toBeUndefined() // 任务已召回
    expect(countAiCore(state, 'gamma')).toBe(1) // 核心归还核心库
  })

  it('历史坏态兜底：作业船已是驾驶船时 advanceAi 直接召回并归还核心（覆盖换船入口漏召回路径）', () => {
    expect(assignAiMining(state, 'sandcat2', 'gamma', 'belt-a', ctx).ok).toBe(true)
    // 模拟坏态：不经过换船入口，直接把执勤船设为驾驶船（旧档/竞态残留；advanceGame 的
    // reconcilePilotShip 会改派驾驶，本用例直接驱动 advanceAi 验证引擎层兜底分支）
    state.shipId = 'sandcat2'
    advanceAi(state, 2_000, ctx)
    expect(state.aiAssignments['sandcat2']).toBeUndefined()
    expect(countAiCore(state, 'gamma')).toBe(1)
    expect(state.shipId).toBe('sandcat2') // 兜底只召回任务，不改驾驶归属
  })
})
