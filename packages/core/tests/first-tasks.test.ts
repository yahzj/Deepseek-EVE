/**
 * **「第一次」任务系列 · 端到端**（2026-09-17 教程重做批 · 阶段④）。
 *
 * 这一组用例钉的是"**事件 → 计数 → 判定 → 通讯/奖励 → 次数链 → 领奖**"这条链上的每一环，
 * 以及最容易悄悄坏掉的三件事：
 * ① 奖励只发一次（去重键 = `importantTasks[id].done`）；
 * ② 链的**记账**（`advanceFirstChains`，每拍）与**发钱**（`claimChainReward`，点一次领一次）分开；
 * ③ 终身计数读档往返不丢（`firstStats` 落盘）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../src/state'
import type { GameState } from '../src/state'
import { advanceGame } from '../src/engine'
import {
  CHAIN_REWARD_ISK_BASE,
  FIRST_TASKS,
  advanceFirstChains,
  chainLevelRewardIsk,
  chainPendingRewardIsk,
  chainProgressOf,
  claimChainReward,
  firstStatOf,
  firstTaskBoard,
  visibleFirstTasks,
} from '../src/firstTasks'
import { startMining, getMiningParams } from '../src/mining'
import { fitModule } from '../src/equipment'
import { startRecycleRun, startRefineRun } from '../src/industry'
import { repairShip } from '../src/shipyard'
import { startScan, HOME_SCAN_WINDOW_MS, scanWindowMsFor } from '../src/explore'
import { countAiCore } from '../src/ai'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const HOME = HOME_GALAXY_ID
/** 母港唯一矿带（丰饶之环 · 声望门槛 0） */
const BELT = 'belt-fortune'

/** 非序章档（母港已探明，可直接开采）：只用来测计数与任务判定本身 */
function testState(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 11 })
}

describe('「第一次」任务：卡片文案齐备（船长 2026-09-18：正文要"一定量的文本丰富"）', () => {
  it('13 条都写了 detail（一段话讲清怎么做/做什么/奖励）', () => {
    for (const def of FIRST_TASKS) {
      expect(def.detail.length, `${def.id} 的 detail 太短`).toBeGreaterThan(30)
      // ⚠ 原有一条 `brief ≤ 30 字` 的断言随船长 2026-09-18 废止「说明文案 ≤30 字」一并撤除
    }
  })
})
describe('「第一次」任务：计数 → 完成 → 奖励（一次性）', () => {
  it('采矿计数随产量增长，采到第一单位即判过「第一次采集原矿」', () => {
    const state = testState()
    expect(firstStatOf(state, 'mineUnits')).toBe(0)
    expect(startMining(state, BELT, ctx).ok).toBe(true)
    // 推进到至少产出一次（采矿循环 30 秒/次；多推几拍保证出料）
    for (let i = 0; i < 60 && firstStatOf(state, 'mineUnits') === 0; i++) advanceGame(state, 5_000, ctx)
    const mined = firstStatOf(state, 'mineUnits')
    expect(mined).toBeGreaterThan(0)
    expect(state.importantTasks['first-mine']?.done).toBe(true)
  })

  it('奖励只发一次：「第一次采集原矿」发采集器 MK1（船长 2026-09-18），重复推进不再加', () => {
    const state = testState()
    expect(startMining(state, BELT, ctx).ok).toBe(true)
    for (let i = 0; i < 60 && state.importantTasks['first-mine']?.done !== true; i++) advanceGame(state, 5_000, ctx)
    expect(state.moduleBay['mod-miner-1']).toBe(1)
    // 再推进一段（计数继续涨）——奖励不再发第二次
    for (let i = 0; i < 20; i++) advanceGame(state, 5_000, ctx)
    expect(state.moduleBay['mod-miner-1']).toBe(1)
  })

  it('母港扫描窗口 = 10 秒（船长 2026-09-18）；其余星系照旧 10 分钟基准', () => {
    const state = testState()
    expect(scanWindowMsFor(state, ctx, HOME)).toBe(HOME_SCAN_WINDOW_MS)
    expect(HOME_SCAN_WINDOW_MS).toBe(10_000)
    expect(scanWindowMsFor(state, ctx, 'galaxy-far')).toBeGreaterThan(HOME_SCAN_WINDOW_MS)
  })

  it('前置未完成 ⇒ 任务在任务中心不显示（船长：「两者都隐藏」）', () => {
    // 序章新档：一处都没点亮 ⇒ 只有「第一次扫描」与不设前置的那几条可见
    const fresh = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    const visible = visibleFirstTasks(fresh).map((d) => d.id)
    expect(visible).toContain('first-scan')
    expect(visible).not.toContain('first-mine') // 前置 = first-scan
    // 完成前置 ⇒ 后继出现
    fresh.importantTasks['first-scan'] = { done: true }
    expect(visibleFirstTasks(fresh).map((d) => d.id)).toContain('first-mine')
  })
})

describe('「第一次」任务：奖励（一次性）与计数落点回归', () => {
  it('「第一次学习技能」发基础 AI 核心 ×1（船长 2026-09-17：AI 核心放这条里给），且只发一次', () => {
    const state = testState()
    expect(state.aiCores.basic ?? 0).toBe(0)
    // 判据 = AI 核心操作学 Lv1（训练过程由 training 侧用例覆盖）⇒ 这里直接置位再走一拍引擎
    state.skills.trained['ai-expert'] = 1
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-skill']?.done).toBe(true)
    expect(state.aiCores.basic).toBe(1)
    // 再推进一段：不双发
    for (let i = 0; i < 5; i++) advanceGame(state, 1000, ctx)
    expect(state.aiCores.basic).toBe(1)
  })

  it('精炼炉出料记一批；**残骸回收炉不计入**（任务文案 = 「让精炼炉出一批料」）', () => {
    const state = testState()
    state.warehouse.items['ore-veldspar'] = 200
    expect(startRefineRun(state, 'ore-veldspar', 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 20 && firstStatOf(state, 'refineBatches') === 0; i++) advanceGame(state, 60_000, ctx)
    expect(firstStatOf(state, 'refineBatches')).toBeGreaterThan(0)
    // 残骸回收：同一页的另一台炉，不记精炼批数
    const wreck = [...ctx.items.values()].find((i) => i.kind === 'wreck')
    expect(wreck).toBeDefined()
    const before = firstStatOf(state, 'refineBatches')
    state.warehouse.items[wreck!.id] = 200
    expect(startRecycleRun(state, wreck!.id, 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 10; i++) advanceGame(state, 60_000, ctx)
    expect(firstStatOf(state, 'refineBatches')).toBe(before)
  })

  it('港内付费维修记一次（任务：「用修理组件或港内维修修一次船」）＋ 奖励民用修理组件 ×20', () => {
    const state = testState()
    state.wallet.isk = 500_000
    const fal = state.fleet['sh-falconet']!
    fal.armorPct = 0.4
    fal.durability = 0.4
    expect(firstStatOf(state, 'repairs')).toBe(0)
    expect(repairShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(firstStatOf(state, 'repairs')).toBe(1)
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-repair']?.done).toBe(true)
    // 奖励（船长 2026-09-18）：民用修理组件 ×20 进仓库（老档迁移不发奖励，故这里只查新完成的这一档）
    expect(state.warehouse.items['repairkit-civ'] ?? 0).toBe(20)
  })

  it('「第一次操作精炼炉」发动能弹药生产线蓝图（从②移到本条，船长 2026-09-18）', () => {
    const state = testState()
    state.warehouse.items['ore-veldspar'] = 200
    expect(state.blueprintStock['bp-ammo-kinetic'] ?? 0).toBe(0)
    expect(startRefineRun(state, 'ore-veldspar', 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 20 && state.importantTasks['first-refine']?.done !== true; i++) advanceGame(state, 60_000, ctx)
    expect(state.importantTasks['first-refine']?.done).toBe(true)
    expect(state.blueprintStock['bp-ammo-kinetic']).toBe(1)
  })

  it('「第一次完成悬赏」发一艘鲣鱼级（同型自动编号 #2，船长 2026-09-18）', () => {
    const state = testState()
    const before = Object.keys(state.fleet).length
    // 判据 = 胜场 ≥ 1；直接置位计数再走一拍引擎（战斗本身由战斗侧用例覆盖）
    state.firstStats = { ...(state.firstStats ?? {}), bountyWins: 1 }
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-bounty']?.done).toBe(true)
    expect(Object.keys(state.fleet).length).toBe(before + 1)
    const added = Object.entries(state.fleet).filter(([, v]) => v.defId === 'sh-falconet')
    expect(added.length).toBe(2) // 新档本来就有 1 艘鲣鱼 ⇒ 拿到第 2 艘
  })

  it('奖励发的装备真能用：采集器 MK1 装上沙猫级 ⇒ 每循环产量提高', () => {
    const state = testState()
    state.shipId = 'sandcat' // 采矿艇（2 高槽）
    const before = getMiningParams(state, ctx, { shipId: 'sandcat', beltId: BELT })!.unitsPerCycle
    // 这台就是「第一次采集原矿」发的那件（走同一个 key：`moduleBay`）
    state.moduleBay['mod-miner-1'] = 1
    const fit = fitModule(state, 'mod-miner-1', ctx)
    expect(fit.ok, fit.ok ? '' : fit.error).toBe(true)
    const after = getMiningParams(state, ctx, { shipId: 'sandcat', beltId: BELT })!.unitsPerCycle
    expect(after).toBeGreaterThan(before)
  })

  it('奖励发的装备真能用：打捞器 MK1 与民用船体维修装置都能装上对应舰船', () => {
    const state = testState()
    state.shipId = 'sandcat'
    state.moduleBay['mod-salvager-1'] = 1
    state.moduleBay['mod-hullrep-civ'] = 1
    const a = fitModule(state, 'mod-salvager-1', ctx)
    const b = fitModule(state, 'mod-hullrep-civ', ctx)
    expect(a.ok, a.ok ? '' : a.error).toBe(true)
    expect(b.ok, b.ok ? '' : b.error).toBe(true)
  })

  it('「第一次生产」发沙猫级舰船蓝图（2026-09-18 新建，不进市场、只靠本条发放）', () => {
    const state = testState()
    expect(state.blueprintStock['sbp-sandcat'] ?? 0).toBe(0)
    // 判据 = 组装机产出 ≥ 1 件；直接置位计数再走一拍引擎（制造链路由制造侧用例覆盖）
    state.firstStats = { ...(state.firstStats ?? {}), produceUnits: 1 }
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-produce']?.done).toBe(true)
    expect(state.blueprintStock['sbp-sandcat']).toBe(1)
  })

  it('任务中心序列：可领奖置顶 · 已全部完成（链满档且没得领）隐藏（船长 2026-09-18 两条 UI 规矩）', () => {
    const state = testState()
    // ① 全都还没做 ⇒ 顺序 = 原序，且没有隐藏项
    const fresh = firstTaskBoard(state)
    expect(fresh.every((r) => !r.hidden)).toBe(true)
    expect(fresh.map((r) => r.def.id)).toEqual(visibleFirstTasks(state).map((d) => d.id))

    // ② 扫描链满档（点亮 20 星系）＋ 该条已完成 ＋ 没领过 ⇒ 可领奖 ⇒ 置顶
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 20)
    state.importantTasks['first-scan'] = { done: true }
    advanceFirstChains(state)
    const board = firstTaskBoard(state)
    expect(board[0]!.def.id).toBe('first-scan')
    expect(board[0]!.pendingIsk).toBeGreaterThan(0)

    // ③ 领完奖（链满档 + 已领满）⇒ 这条**隐藏**（其余条目照旧显示）
    const beforeClaim = firstTaskBoard(state)
    claimChainReward(state, 'explorer')
    const after = firstTaskBoard(state)
    expect(after.some((r) => r.def.id === 'first-scan')).toBe(false)
    expect(after.length).toBe(beforeClaim.length - 1)
  })

  it('「第一次虫洞」发 2 处未探索虫洞（声望判据 + 允许超库存上限，船长 2026-09-18）', () => {
    const state = testState()
    state.standings['dsi'] = 40
    expect(state.wormholeStock?.length ?? 0).toBe(0)
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-wormhole']?.done).toBe(true)
    expect(state.wormholeStock?.length ?? 0).toBe(2)
  })
})

describe('「第一次」次数链：记账与领奖分开', () => {
  it('扫描链：每越过一档记一级（记账不掏钱），领奖时才发 ISK', () => {
    const state = testState()
    const chain = FIRST_TASKS.find((d) => d.id === 'first-scan')!.chain!
    expect(chainProgressOf(state, chain).level).toBe(0)
    // 点亮 5 个星系 = 第一档（阈值表 scan[0] = 5）
    const ids = [...ctx.galaxies.keys()].slice(0, 5)
    state.exploredGalaxies = ids
    const ups = advanceFirstChains(state)
    expect(ups.map((u) => u.id)).toContain('explorer')
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(1)
    // 记账不发钱：钱包没动
    expect(state.wallet.isk).toBe(createInitialState({ nowWallMs: 0, seed: 11 }).wallet.isk)
    // 领奖：第 1 级 = 基准 × 1⁵ = 2,500；再点一次为 0（幂等）
    expect(claimChainReward(state, 'explorer')).toBe(chainLevelRewardIsk(1))
    expect(claimChainReward(state, 'explorer')).toBe(0)
    // 再点亮到第 2 档（8 个）⇒ 又记一级；这次领第 2 级（基准 × 2⁵ = 80,000）
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 8)
    advanceFirstChains(state)
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(2)
    expect(claimChainReward(state, 'explorer')).toBe(chainLevelRewardIsk(2))
    expect(chainLevelRewardIsk(2)).toBe(CHAIN_REWARD_ISK_BASE * 32)
  })

  it('一次跨越两档：领奖按"已达成 − 已领"逐级求和（2⁵ + 3⁵ 那一档）', () => {
    const state = testState()
    // 直接点亮 12 个星系 = 第 3 档（5/8/12）
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 12)
    advanceFirstChains(state)
    expect(state.importantTasks['chain-explorer']?.delivered).toBe(3)
    const expectSum = chainLevelRewardIsk(1) + chainLevelRewardIsk(2) + chainLevelRewardIsk(3)
    expect(chainPendingRewardIsk(state, 'explorer')).toBe(expectSum)
    expect(claimChainReward(state, 'explorer')).toBe(expectSum)
    expect(claimChainReward(state, 'explorer')).toBe(0)
    // 基准 2,500、五次方 ⇒ 三级合计 2,500 × (1 + 32 + 243) = 690,000
    expect(expectSum).toBe(690_000)
  })

  it('未知链 id 领奖返回 0（界面误点不炸）', () => {
    const state = testState()
    expect(claimChainReward(state, 'no-such-chain')).toBe(0)
  })
})

describe('「第一次」任务：存档往返', () => {
  it('终身计数与领奖额随档往返（`firstStats` 落盘、缺省 0）', () => {
    const state = testState()
    state.importantTasks['first-scan'] = { done: true }
    state.exploredGalaxies = [...ctx.galaxies.keys()].slice(0, 5)
    advanceFirstChains(state)
    claimChainReward(state, 'explorer')
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.firstStats?.['paid-explorer']).toBe(1)
    expect(loaded.importantTasks['first-scan']?.done).toBe(true)
    // 读档后不再重复领
    expect(claimChainReward(loaded, 'explorer')).toBe(0)
  })

  it('新档不写 `firstStats` 键（真零迁移）；扫描这类"可推导计数"也不建表', () => {
    const fresh = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    expect(fresh.firstStats).toBeUndefined()
    expect(startScan(fresh, HOME, ctx).ok).toBe(true)
    expect(fresh.firstStats).toBeUndefined() // 扫描不写计数（走 exploredGalaxies）
  })
})
