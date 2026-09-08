/**
 * 采矿作业的单元测试：开始/停止、循环结算、技能加成、货舱满自动停、随机消耗。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { countItem } from '../src/inventory'
import { beltTravelMinutes, miningStatus, oneLegMs, richVeinP, setMiningAutoCycle, setMiningStopAfterTrip, startMining, stopMining } from '../src/mining'
import { makeTestCtx, belt, ship, skill , fittedOf } from './helpers'

describe('采矿作业', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    ctx = makeTestCtx()
  })

  it('开始开采：矿带生效、状态置为运行、写日志', () => {
    const result = startMining(state, 'belt-a', ctx)
    expect(result.ok).toBe(true)
    expect(state.mining.active).toBe(true)
    expect(state.mining.beltId).toBe('belt-a')
    expect(state.mining.tripUnits).toBe(0)
    expect(state.logs.some((l) => l.text.includes('开始开采'))).toBe(true)
  })

  it('非法指令：未知矿带拒绝；开采中重复开始拒绝', () => {
    expect(startMining(state, '不存在的带', ctx).ok).toBe(false)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(false)
  })

  it('去程取消：指令即开始采掘，每 12 秒完成一个循环：10 单位矿石入舱', () => {
    startMining(state, 'belt-a', ctx)
    // 去程已取消：指令下达即视为已抵达矿带，立即采掘（无出航等待）
    expect(state.mining.phase).toBe('mining')
    expect(countItem(state, 'ore-a')).toBe(0)
    advanceGame(state, 12_000, ctx)
    expect(countItem(state, 'ore-a')).toBe(10)
    expect(state.mining.tripUnits).toBe(10)
    // 半循环：进度保留在 cycleAccMs（12 秒 = 1 循环，余半循环）
    advanceGame(state, 6_000, ctx)
    expect(countItem(state, 'ore-a')).toBe(10)
    const view = miningStatus(state, ctx)
    expect(view.percent).toBeCloseTo(50, 0)
  })

  it('采矿技术等级加成产量：Lv2 时每循环 11 单位', () => {
    state.skills.trained['mining'] = 2 // balance.yieldSkillId = 'mining'
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 12_000, ctx)
    expect(countItem(state, 'ore-a')).toBe(11) // floor(10 × 1.12)
  })

  it('采矿护卫舰操作缩短循环：Lv5 时循环 10.2 秒', () => {
    state.skills.trained['mining-frigate'] = 5 // balance.timeSkillId = 'mining-frigate'
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 10_200, ctx)
    expect(countItem(state, 'ore-a')).toBe(10)
    // 10.2 秒整时刚好一循环；10 秒时不足一循环
  })

  it('货舱放不下整个循环：自动循环开启时转返航；关闭时停采并警告', () => {
    // 换一艘只有 30 m³ 货舱的小船：只能装 3 个循环（10 单位 × 1 m³）
    // 关闭富矿脉保证循环数精确
    const bal = makeTestCtx().balance
    const tinyCtx = makeTestCtx({ ships: [ship('tiny', { cargo: 30 })], balance: { ...bal, richVeinChance: 0 } })
    state.fleet['tiny'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    state.shipId = 'tiny'

    // 场景一：默认自动循环 → 满舱转返航（不停止）；4 轮节拍后满舱
    startMining(state, 'belt-a', tinyCtx)
    advanceGame(state, 48_000, tinyCtx) // 3 循环 = 30 单位 + 第 4 循环节拍（满舱检查）→ 转返航
    expect(countItem(state, 'ore-a')).toBe(30)
    expect(state.mining.active).toBe(true)
    expect(state.mining.phase).toBe('returning')
    expect(state.logs.some((l) => l.text.includes('自动返航'))).toBe(true)

    // 场景二：关闭自动循环 → 满舱停采并警告
    const state2 = createInitialState({ nowWallMs: 0, seed: 1 })
    state2.fleet['tiny'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    state2.shipId = 'tiny'
    setMiningAutoCycle(state2, false)
    startMining(state2, 'belt-a', tinyCtx)
    advanceGame(state2, 48_000, tinyCtx)
    expect(countItem(state2, 'ore-a')).toBe(30)
    expect(state2.mining.active).toBe(false)
    expect(state2.mining.beltId).toBeNull()
    expect(state2.logs.some((l) => l.kind === 'warn' && l.text.includes('货舱已满'))).toBe(true)
  })

  it('自动循环全流程：立即采掘 → 采满 → 满载返航（去程并入）卸入仓库 → 自动回带再采掘', () => {
    // 关闭富矿脉：采满 800 = 80 循环 × 12 秒，第 81 循环节拍（972s）触发返航
    const bal = makeTestCtx().balance
    const calmCtx = makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
    startMining(state, 'belt-a', calmCtx) // sandcat：800 m³ / 10u 每循环
    advanceGame(state, 972_000, calmCtx)
    expect(state.mining.phase).toBe('returning')
    expect(countItem(state, 'ore-a')).toBe(800) // 满舱在返航中
    // 满载返航 120s + 空船去程 60s 并入 = 180s：到港卸货后直接回带采掘
    advanceGame(state, 180_000, calmCtx)
    expect(state.mining.phase).toBe('mining')
    expect(countItem(state, 'ore-a')).toBe(0) // 货仓已清空
    expect(state.warehouse.items['ore-a']).toBe(800) // 全部进仓库
    expect(state.logs.some((l) => l.text.includes('卸入物品仓库'))).toBe(true)
    // 回到矿带：恢复采掘
    advanceGame(state, 12_000, calmCtx)
    expect(countItem(state, 'ore-a')).toBe(10)
  })

  it('勾选“本次返航后停止”：卸货完成后停采，不再自动周转', () => {
    const bal = makeTestCtx().balance
    const calmCtx = makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
    setMiningStopAfterTrip(state, true)
    startMining(state, 'belt-a', calmCtx)
    advanceGame(state, 972_000 + 180_000, calmCtx) // 采满 + 满载返航（去程并入）= 到港卸货即停
    expect(state.mining.active).toBe(false)
    expect(state.warehouse.items['ore-a']).toBe(800)
    expect(state.logs.some((l) => l.text.includes('自动循环已结束'))).toBe(true)
  })

  it('每次循环消耗一次种子随机数（富矿脉判定可复现）', () => {
    // 市场窗口与随机事件也会消耗随机数——本测试只数采矿消耗，故两者都关闭；
    // 卷B2⑥：富矿触发会开启 2 循环红利窗口（窗口内不掷点），关闭富矿脉保证每循环恒掷一次
    const bal = makeTestCtx().balance
    const noMarketCtx = makeTestCtx({ marketGoods: [], quietEvents: true, balance: { ...bal, richVeinChance: 0 } })
    startMining(state, 'belt-a', noMarketCtx)
    advanceGame(state, 120_000, noMarketCtx) // 10 个循环
    expect(state.rng.count).toBe(10)
  })

  it('手动停止：记录本趟产出；未在开采时停止返回 false', () => {
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 60_000, ctx) // 5 循环 = 50 单位
    expect(stopMining(state, ctx)).toBe(true)
    expect(state.mining.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('50 单位'))).toBe(true)
    expect(stopMining(state, ctx)).toBe(false)
  })

  it('推进游戏时间不影响闲置的采矿状态', () => {
    advanceGame(state, 999_999, ctx)
    expect(state.mining.active).toBe(false)
    expect(countItem(state, 'ore-a')).toBe(0)
  })

  it('技能相关：引擎不硬编码技能名——加成的技能 id 来自平衡配置', () => {
    // 把"产量加成技能"指向一个任意技能 id，验证引擎按配置生效
    const customBalance = makeTestCtx().balance
    const customCtx = makeTestCtx({
      balance: { ...customBalance, mining: { ...customBalance.mining, yieldSkillId: '任意技能' } },
    })
    state.skills.trained['任意技能'] = 5
    startMining(state, 'belt-a', customCtx)
    advanceGame(state, 12_000, customCtx) // 立即采掘（去程取消）
    expect(countItem(state, 'ore-a')).toBe(13) // floor(10 × 1.30)
  })

  it('技能中途升级立刻生效（同一段推进内按新参数结算后续循环）', () => {
    // 先用 Lv0 挖 2 个循环，直接把技能等级改到 5，再推进——后续循环按新产量算
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 24_000, ctx) // 2 个循环 = 20 单位
    expect(countItem(state, 'ore-a')).toBe(20)
    state.skills.trained['mining'] = 5 // 产量翻到 floor(10×1.3)=13
    advanceGame(state, 12_000, ctx)
    expect(countItem(state, 'ore-a')).toBe(33)
  })
})

describe('矿带挂星系：去程取消与并入返航的航程（星图拓展）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    // 默认测试世界：hub ↔ far（单程 2 分钟）
    ctx = makeTestCtx({ belts: [belt('belt-far', 'ore-a', '远带', { galaxyId: 'galaxy-far' })] })
  })

  it('母港星系/无归属矿带：返航基准单程 = 本地 120 秒', () => {
    expect(oneLegMs(state, ctx, 'belt-a')).toBe(120_000)
    expect(oneLegMs(state, ctx, null)).toBe(120_000)
  })

  it('挂在远星系（2 分钟航程）：返航单程 = 120 秒基准 + 2 分钟航程', () => {
    const beltFar = ctx.belts.get('belt-far')!
    expect(beltTravelMinutes(ctx, beltFar)).toBe(2)
    expect(oneLegMs(state, ctx, 'belt-far')).toBe(120_000 + 2 * 60_000)
    // V13 探索封锁：出发前需先点亮目标星系
    state.exploredGalaxies.push('galaxy-far')
    expect(startMining(state, 'belt-far', ctx).ok).toBe(true)
    expect(miningStatus(state, ctx).legMs).toBe(120_000 + 2 * 60_000)
  })

  it('不可达星系：拒绝出发（避免矿船卡在路上）', () => {
    const ctxNoRoute = makeTestCtx({
      belts: [belt('belt-lost', 'ore-a', '失落带', { galaxyId: 'galaxy-nowhere' })],
      edges: [],
    })
    const r = startMining(state, 'belt-lost', ctxNoRoute)
    expect(r.ok).toBe(false)
    expect(state.mining.active).toBe(false)
  })
})

describe('富矿脉红利窗口（卷B2⑥：概率触发 + 连续 2 循环 ×3）', () => {
  /** richVeinChance=5 → p = min(1, 12s/60s×5×1) = 1：每次掷点必中，确定性验证窗口机制 */
  const p1Ctx = (): SimContext => {
    const bal = makeTestCtx().balance
    return makeTestCtx({ marketGoods: [], quietEvents: true, balance: { ...bal, richVeinChance: 5 } })
  }

  it('richVeinP 按分钟缩放：基础 3%/分钟 × 勘探学系数，封顶 1；chance=0 恒 0', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = makeTestCtx()
    expect(richVeinP(12_000, state, ctx)).toBeCloseTo(0.006, 10) // 12s = 0.2 分钟 × 3%
    expect(richVeinP(60_000, state, ctx)).toBeCloseTo(0.03, 10) // 1 分钟 = 3%
    state.skills.trained['rich-vein-prospecting'] = 5
    expect(richVeinP(12_000, state, ctx)).toBeCloseTo(0.012, 10) // 满级系数 ×2
    const zero = makeTestCtx({ balance: { ...ctx.balance, richVeinChance: 0 } })
    expect(richVeinP(60_000, state, zero)).toBe(0) // 0 = 禁用
    const cap = makeTestCtx({ balance: { ...ctx.balance, richVeinChance: 5 } })
    expect(richVeinP(60_000, state, cap)).toBe(1) // 封顶 1
  })

  it('触发当轮与次轮各 ×3、只在触发写日志、窗口计数正确', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = p1Ctx()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 36_000, ctx) // 3 循环（12s×3）
    // 循环1：触发 30 单位 rvLeft=1；循环2：窗口 30 单位 rvLeft=0（不掷点）；循环3：再触发 30 单位 rvLeft=1
    expect(countItem(state, 'ore-a')).toBe(90)
    expect(state.mining.rvLeft).toBe(1)
    expect(state.logs.filter((l) => l.text.includes('富矿脉')).length).toBe(2) // 只在触发写日志，窗口结束不写
  })

  it('窗口内不掷点（rng 时序）；禁用时每循环恰好 1 次', () => {
    const s1 = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = p1Ctx()
    startMining(s1, 'belt-a', ctx)
    advanceGame(s1, 36_000, ctx) // 3 循环 → 掷点 2 次（中间窗口循环跳过）
    expect(s1.rng.count).toBe(2)
    const s2 = createInitialState({ nowWallMs: 0, seed: 42 })
    const bal = makeTestCtx().balance
    const calm = makeTestCtx({ marketGoods: [], quietEvents: true, balance: { ...bal, richVeinChance: 0 } })
    startMining(s2, 'belt-a', calm)
    advanceGame(s2, 36_000, calm) // 3 循环 → 每循环掷 1 次
    expect(s2.rng.count).toBe(3)
  })

  it('停止开采清零窗口（窗口绑定矿带）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = p1Ctx()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 12_000, ctx) // 触发 → rvLeft=1
    expect(state.mining.rvLeft).toBe(1)
    expect(stopMining(state, ctx)).toBe(true)
    expect(state.mining.rvLeft).toBe(0)
  })

  it('自动循环返航卸货后回原带保留窗口（返航不清零）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = p1Ctx()
    state.fleet[state.shipId]!.cargo['ore-a'] = 10 // 返航中货载 10/800 → 返航腿 180s×0.0125=2250ms
    state.mining = {
      active: true,
      beltId: 'belt-a',
      phase: 'returning',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 10,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
      rvLeft: 1,
    }
    advanceGame(state, 3_000, ctx) // 到港卸货 → 回带采掘（窗口保留）
    expect(state.mining.phase).toBe('mining')
    expect(countItem(state, 'ore-a')).toBe(0)
    expect(state.warehouse.items['ore-a']).toBe(10)
    expect(state.mining.rvLeft).toBe(1)
    expect(state.rng.count).toBe(0)
    advanceGame(state, 12_000, ctx) // 回带首个循环消耗窗口：×3 且不掷点
    expect(countItem(state, 'ore-a')).toBe(30)
    expect(state.mining.rvLeft).toBe(0)
    expect(state.rng.count).toBe(0)
  })

  it('旧档零迁移：rvLeft 缺失按 0（无窗口）起步', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const ctx = p1Ctx()
    startMining(state, 'belt-a', ctx)
    state.mining.rvLeft = undefined
    advanceGame(state, 12_000, ctx) // 照常掷点 → 触发
    expect(countItem(state, 'ore-a')).toBe(30)
    expect(state.mining.rvLeft).toBe(1)
  })
})
