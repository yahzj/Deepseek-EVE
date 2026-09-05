/**
 * T8 星系停留 / 连续出击 / 重复冷却 / 修理组件优先 / 返航空间站（位置模型）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import {
  advanceAutoLoopBounty,
  bountyCooldownRemainingMs,
  recallExpedition,
  setAutoLoopBounty,
  startExpedition,
} from '../src/expedition'
import { isExplored, startScan } from '../src/explore'
import { startMining } from '../src/mining'
import { changeShip, repairWithKits, repairShip } from '../src/shipyard'
import { goStandbyAt, startTransitHome } from '../src/location'
import { shortestTravelMinutes, travelLegMs } from '../src/travel'
import { makeTestCtx, anomaly, mineral, ship } from './helpers'

/** 远星系低威胁悬赏（快速可胜）：2026-09-06 起胜利自动返航母港（不再停留目标星系） */
function worldWithFarBounty() {
  const ctx: SimContext = makeTestCtx({
    ships: [ship('sh-falconet', { cargo: 120 })],
    anomalies: [anomaly('ano-far-easy', 'galaxy-far', { threat: 1, reward: 2_000, combatSeconds: 2, loot: [{ itemId: 'ore-a', units: 5 }] })],
    quietEvents: true,
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
  state.exploredGalaxies.push('galaxy-far')
  return { state, ctx }
}

describe('T8（2026-09-06 语义：胜利自动返航）与重复冷却', () => {
  it('胜利 = 结算并自动返航（不可召回）；同目标 10 秒冷却（扫描属性因子）；到港后可再出发', () => {
    const { state, ctx } = worldWithFarBounty()
    expect(startExpedition(state, 'ano-far-easy', ctx).ok).toBe(true)
    expect(state.awayGalaxy).toBeNull() // 作业中位置由作业表达
    // 即时开战 + 秒杀交火 → 结算转自动返航（back）
    for (let i = 0; i < 40 && !(state.expedition.active && state.expedition.phase === 'back'); i++) {
      advanceGame(state, 20_000, ctx)
    }
    expect(state.expedition.phase).toBe('back')
    expect(state.expedition.returnReason).toBe('victory')
    expect(state.expedition.active).toBe(true)
    expect(state.awayGalaxy).toBeNull() // 不再停留目标星系
    const cd = bountyCooldownRemainingMs(state, 'ano-far-easy')
    expect(cd).toBeGreaterThan(0)
    expect(cd).toBeLessThanOrEqual(10_000)
    // 冷却内拒绝再出发
    expect(startExpedition(state, 'ano-far-easy', ctx).ok).toBe(false)
    // 胜利返航不可召回（路程必付）
    const r = recallExpedition(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('不可召回')
    // 返航到港（原去程并入返航 2×单程）→ 空闲停靠母港
    for (let i = 0; i < 60 && state.expedition.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.expedition.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    // 冷却已过（返航远超 10s）→ 可从母港再次出发（付出真实返航路程）
    expect(bountyCooldownRemainingMs(state, 'ano-far-easy')).toBe(0)
    expect(startExpedition(state, 'ano-far-easy', ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('battle')
    expect(state.awayGalaxy).toBeNull()
  })

  it('失利/旧档返航仍可召回（口径不变）；扫描完成点亮后自动返航（不停留）', () => {
    const { state, ctx } = worldWithFarBounty()
    // —— 失利返航（无 returnReason 的旧档在途 back 同口径）：可召回（即时回港）——
    const exp = state.expedition
    exp.active = true
    exp.anomalyId = 'ano-far-easy'
    exp.phase = 'back'
    exp.returnReason = 'defeat'
    exp.finishAtGameMs = state.gameMs + 600_000
    const recallDefeat = recallExpedition(state, ctx)
    expect(recallDefeat.ok).toBe(true)
    expect(state.expedition.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    // —— 扫描完成：点亮 + 自动返航 ——
    const state2 = createInitialState({ nowWallMs: 0, seed: 5 })
    expect(startScan(state2, 'galaxy-far', ctx).ok).toBe(true)
    advanceGame(state2, 10 * 60_000, ctx) // 窗口走完
    expect(state2.scanning.returning).toBe(true)
    expect(state2.scanning.active).toBe(true)
    expect(isExplored(state2, 'galaxy-far')).toBe(true)
    expect(state2.awayGalaxy).toBeNull() // 完成不停留
    for (let i = 0; i < 60 && state2.scanning.active; i++) advanceGame(state2, 60_000, ctx)
    expect(state2.scanning.active).toBe(false)
    expect(state2.awayGalaxy).toBeNull()
  })

  it('从野外驻留（掩护巡逻）出发打悬赏：胜利返航仍按 目标↔母港 2×单程计费（与出发地无关），落点母港', () => {
    const { state, ctx } = worldWithFarBounty()
    // 先驻留 far（即时就位）
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(state.awayGalaxy).toBe('galaxy-far')
    // 打本地悬赏：零航程即时开战（outMs = 0——若按出发地计费，返航也会是 0）
    expect(startExpedition(state, 'ano-far-easy', ctx).ok).toBe(true)
    expect(state.expedition.outMs).toBe(0)
    for (let i = 0; i < 600 && !(state.expedition.active && state.expedition.phase === 'back'); i++) {
      advanceGame(state, 500, ctx)
    }
    expect(state.expedition.phase).toBe('back')
    expect(state.expedition.returnReason).toBe('victory')
    // 胜利返航按 目标↔母港 2×单程重算（与出发地无关）：剩余应接近整段 2×单程（检测步长 500ms 内）
    const homeLeg = travelLegMs(state, ctx, shortestTravelMinutes(ctx, 'galaxy-hub', 'galaxy-far'))
    const remain = state.expedition.finishAtGameMs - state.gameMs
    expect(remain).toBeGreaterThan(homeLeg * 2 - 1_500)
    expect(remain).toBeLessThanOrEqual(homeLeg * 2)
    expect(state.awayGalaxy).toBeNull()
    // 返航到港后停靠母港（驻留结束）
    for (let i = 0; i < 120 && state.expedition.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.expedition.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
  })
})

describe('T8 连续出击（2026-09-06 巡回讨伐：自动返航到港后自动再出击）', () => {
  it('开启落档；胜利自动返航期间等待；到港冷却结束自动再出发（巡回多轮）；战利品放不下/耐久不足自动暂停', () => {
    const { state, ctx } = worldWithFarBounty()
    expect(setAutoLoopBounty(state, ctx, 'ano-far-easy').ok).toBe(true)
    expect(state.autoLoopAnomalyId).toBe('ano-far-easy')
    // 第一单手动出发：即时开战 → 胜利 → 自动返航（此时 auto 步等待，不打断返航）
    expect(startExpedition(state, 'ano-far-easy', ctx).ok).toBe(true)
    for (let i = 0; i < 40 && !(state.expedition.active && state.expedition.phase === 'back'); i++) {
      advanceGame(state, 20_000, ctx)
    }
    expect(state.expedition.phase).toBe('back') // 胜利返航中
    expect(state.awayGalaxy).toBeNull()
    expect(advanceAutoLoopBounty(state, ctx)).toBeNull() // 返航中：等
    expect(state.expedition.active).toBe(true)
    // 到港（2×单程走完）→ 空闲且冷却结束 → 自动再出发（巡回第二单）
    for (let i = 0; i < 60 && state.expedition.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.expedition.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(advanceAutoLoopBounty(state, ctx)).toBeNull()
    expect(state.expedition.active).toBe(true) // 自动续战
    // 第二单打完并回港 → 第三单仍自动出发（巡回可持续）
    for (let i = 0; i < 80 && state.expedition.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.expedition.active).toBe(false)
    expect(advanceAutoLoopBounty(state, ctx)).toBeNull()
    expect(state.expedition.active).toBe(true) // 第三单自动再出发

    // —— 暂停条件 1：货仓放不下预期缴获（船在母港空闲时触发 auto）——
    const state2 = createInitialState({ nowWallMs: 0, seed: 6 })
    state2.exploredGalaxies.push('galaxy-far')
    state2.standings['dsi'] = 0
    // 塞满货仓（默认 800 m³ 用 0.01 体积矿物 × 80000）
    state2.fleet.sandcat.cargo['min-a'] = 80_000
    state2.autoLoopAnomalyId = 'ano-far-easy'
    state2.bountyCooldowns = {}
    const reason = advanceAutoLoopBounty(state2, ctx)
    expect(reason).toContain('货仓')
    expect(state2.autoLoopAnomalyId).toBeNull()

    // —— 暂停条件 2：耐久 < 0.5 且无修理组件 ——
    const state3 = createInitialState({ nowWallMs: 0, seed: 7 })
    state3.exploredGalaxies.push('galaxy-far')
    state3.fleet.sandcat.durability = 0.3
    state3.autoLoopAnomalyId = 'ano-far-easy'
    const reason2 = advanceAutoLoopBounty(state3, ctx)
    expect(reason2).toContain('耐久')
    expect(state3.autoLoopAnomalyId).toBeNull()
  })

  it('修理组件优先：货仓有组件时自动连用修复到阈值后再继续，组件不足才停', () => {
    const ctx = makeTestCtx({ quietEvents: true })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    // 测试修理组件（P2 固定 HP 语义：repairRestore=基础回复 HP；用超大值保证单件修满，专测"先修再出发"流程）
    const kit = { ...mineral('kit-a', 15), name: '纳米修理组件', description: '测试修理组件', repairRestore: 1_000_000 }
    const kitCtx = makeTestCtx({ items: [kit], quietEvents: true })
    state.fleet.sandcat.cargo['kit-a'] = 2
    state.fleet.sandcat.durability = 0.2
    // 单件即修满 → 只用 1 件即越过 0.5 阈值
    expect(repairWithKits(state, kitCtx, 0.5)).toBe(1)
    expect(state.fleet.sandcat.durability).toBe(1)
    expect(state.fleet.sandcat.cargo['kit-a']).toBe(1)
    // 循环条件检查：耐久 0.45（低于阈值）+ 1 件组件 → 自动消耗并继续
    const state2: GameState = createInitialState({ nowWallMs: 0, seed: 2 })
    state2.exploredGalaxies.push('galaxy-far')
    state2.fleet.sandcat.cargo['kit-a'] = 1
    state2.fleet.sandcat.durability = 0.45
    state2.autoLoopAnomalyId = 'ano-far-easy'
    const ctxB = makeTestCtx({
      anomalies: [anomaly('ano-far-easy', 'galaxy-far', { threat: 1, reward: 1_000, loot: [] })],
      items: [kit],
      quietEvents: true,
    })
    expect(advanceAutoLoopBounty(state2, ctxB)).toBeNull() // 组件修满 → 放行出发
    expect(state2.expedition.active).toBe(true)
    expect(state2.fleet.sandcat.durability).toBe(1)
    expect(state2.fleet.sandcat.cargo['kit-a']).toBeUndefined()
  })
})

describe('T8 位置模型：返航空间站与守卫', () => {
  it('野外空闲：换船被拒；换港返航即时到站（去程取消）；随后可换船', () => {
    const { state, ctx } = worldWithFarBounty()
    state.awayGalaxy = 'galaxy-far'
    // 换船守卫（含驾驶船在野外提示）
    const r = changeShip(state, 'sh-falconet', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('返航空间站')
    // 换港返航：去程取消 → 即时到站（无行程等待）
    expect(startTransitHome(state, ctx).ok).toBe(true)
    expect(state.transit.active).toBe(false) // 不留行程状态
    expect(state.awayGalaxy).toBeNull()
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    // 站内再发返航 → 拒绝
    expect(startTransitHome(state, ctx).ok).toBe(false)
  })

  it('野外不能维修驾驶船（返航后恢复）；采矿可从野外出发但自动循环以空间站为基准', () => {
    const { state, ctx } = worldWithFarBounty()
    state.fleet.sandcat.durability = 0.6
    state.awayGalaxy = 'galaxy-far'
    expect(repairShip(state, 'sandcat', ctx).ok).toBe(false)
    // 从野外直接采矿（belt-a 在母港星系 → 去程取消但初始出航（并入返航）仍按出发点计程；此处只验证入口与原点记录）
    const bal = makeTestCtx().balance
    const calmCtx = makeTestCtx({
      belts: [{ id: 'belt-far-a', name: '远带矿', oreId: 'ore-a', galaxyId: 'galaxy-far', description: '' }],
      balance: { ...bal, richVeinChance: 0 },
      quietEvents: true,
    })
    expect(startMining(state, 'belt-far-a', calmCtx).ok).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(state.mining.originGalaxy).toBe('galaxy-far')
  })
})

describe('T8 存档（v16.1 兼容字段）', () => {
  it('awayGalaxy/transit/bountyCooldowns/autoLoop 往返一致；非法条目被清', () => {
    const { state, ctx } = worldWithFarBounty()
    state.awayGalaxy = 'galaxy-far'
    // 旧档样式在途行程：手动构造（新指令即时到站不留行程；字段仍可序列化往返）
    state.transit = { active: true, fromGalaxy: 'galaxy-far', toGalaxy: 'galaxy-hub', finishAtGameMs: 120_000, legMs: 120_000 }
    state.bountyCooldowns['ano-x'] = state.gameMs + 5_000
    state.autoLoopAnomalyId = 'ano-far-easy'
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.awayGalaxy).toBe('galaxy-far')
    expect(loaded.state.transit.active).toBe(true)
    expect(loaded.state.bountyCooldowns['ano-x']).toBe(state.gameMs + 5_000)
    expect(loaded.state.autoLoopAnomalyId).toBe('ano-far-easy')

    const raw = JSON.stringify({
      format: SAVE_FORMAT,
      version: 16,
      savedAtWallMs: 0,
      state: {
        awayGalaxy: 'junk',
        transit: { active: true, fromGalaxy: 'junk', toGalaxy: 'junk', finishAtGameMs: 'x', legMs: -5 },
        bountyCooldowns: { a: 123, b: 'x', c: -1 },
        autoLoopAnomalyId: 42,
      },
    })
    const l2 = loadSaveFile(raw)
    expect(l2.state.awayGalaxy).toBe('junk')
    // 任意字符串星系都收（引擎侧有可达性校验兜底）；legMs 非法归 0；toGalaxy 存在则视为有效行程
    expect(l2.state.transit).toEqual({ active: true, fromGalaxy: 'junk', toGalaxy: 'junk', finishAtGameMs: 0, legMs: 0 })
    expect(l2.state.bountyCooldowns).toEqual({ a: 123 })
    expect(l2.state.autoLoopAnomalyId).toBeNull()
  })
})
