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
  CHAIN_TIERS,
  chainLevelRewardIsk,
  chainPendingRewardIsk,
  chainProgressOf,
  claimChainReward,
  firstStatOf,
  firstTaskBoard,
  firstTaskProgress,
  firstTaskNotice,
  firstTasksMarkSeen,
  milestoneBoard,
  FIRST_TASKS,
  advanceFirstChains,
  sequentialPrefixDone,
  visibleFirstTasks,
} from '../src/firstTasks'
import { sellAtMarket, learnBlueprint, listSellHolding, placeSellOrder } from '../src/market'
import { startMining, getMiningParams } from '../src/mining'
import { fitModule } from '../src/equipment'
import { startRecycleRun, startRefineRun } from '../src/industry'
import { repairShip, unstoreShip } from '../src/shipyard'
import { startManufacturing } from '../src/manufacturing'
import { startScan, HOME_SCAN_WINDOW_MS, scanWindowMsFor } from '../src/explore'
import { countAiCore } from '../src/ai'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { ONB_DONE, beginAfterAwaken } from '../src/onboarding'

const ctx = buildSimContext()
const HOME = HOME_GALAXY_ID
/** 母港唯一矿带（丰饶之环 · 声望门槛 0） */
const BELT = 'belt-fortune'
/** 母港矿带产的原矿（市场有行、也是「第一次采集原矿」那条的主角） */
const BELT_ORE = 'ore-veldspar'

/** 非序章档（母港已探明，可直接开采）：只用来测计数与任务判定本身 */
function testState(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 11 })
}

/**
 * **把队列推到某条任务前面**（2026-09-20 船长报障「未显示的第一次任务可以提前完成」后新增）。
 *
 * `advanceFirstTasks` 现在**只判当前那一条**（`FIRST_TASKS` 里第一条没完成的）⇒ 想验"轮到它时会发生什么"，
 * 就得先把排在它前面的任务标记完成。本函数**只写 done 标记**（奖励/通讯由 `advanceFirstTasks` 统一发），
 * 不触发任何判定 ⇒ 断言到的奖励一定是"这一条自己发的"。
 */
function reachQueue(state: GameState, taskId: string): void {
  const idx = FIRST_TASKS.findIndex((d) => d.id === taskId)
  expect(idx, `未知任务 id：${taskId}`).toBeGreaterThanOrEqual(0)
  for (const d of FIRST_TASKS.slice(0, idx)) state.importantTasks[d.id] = { done: true }
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

  it('奖励前移（船长 2026-09-20：「采集器是扫描星系给，打捞器应该是挖矿任务给」）：两件工具都赶在用到它的那条之前', () => {
    const mods = (id: string): string[] =>
      (FIRST_TASKS.find((d) => d.id === id)?.reward?.modules ?? []).map((m) => m.moduleId)
    expect(mods('first-scan')).toEqual(['mod-miner-1']) // 采集器 MK1
    expect(mods('first-mine')).toEqual(['mod-salvager-1']) // 打捞器 MK1
    expect(mods('first-salvage')).toEqual([]) // 打捞那条不再有实物奖励（只发情报信）
    // 顺序解锁下：扫描 → 采矿 → 打捞 ⇒ 走到「第一次打捞残骸」时打捞器已经在手上
    const order = FIRST_TASKS.map((d) => d.id)
    expect(order.indexOf('first-mine')).toBeLessThan(order.indexOf('first-salvage'))
    /**
     * **同日第二条令**：「任务完成后额外给玩家 100 橄榄岩用于下一阶段任务」——
     * 下一阶段是「第一次操作精炼炉」，精炼每批 100 单位 ⇒ 这批料正好凑够第一炉。
     */
    const wares = (id: string) => (FIRST_TASKS.find((d) => d.id === id)?.reward?.ware ?? []).map((w) => `${w.itemId}×${w.units}`)
    expect(wares('first-mine')).toEqual(['ore-veldspar×100'])
  })

  it('奖励真的按新口径发：扫描给采集器 MK1、挖矿给打捞器 MK1 ＋ 100 橄榄岩（各只发一次）', () => {
    // ① 扫描（非序章档：母港已点亮 ⇒ 首拍即判过）
    const s1 = testState()
    advanceGame(s1, 1000, ctx)
    expect(s1.importantTasks['first-scan']?.done).toBe(true)
    expect(s1.moduleBay['mod-miner-1']).toBe(1)
    expect(s1.moduleBay['mod-salvager-1']).toBeUndefined()
    for (let i = 0; i < 5; i++) advanceGame(s1, 1000, ctx)
    expect(s1.moduleBay['mod-miner-1']).toBe(1) // 不双发
    // ② 采矿（计数置位 ⇒ 下一拍判过）
    const s2 = testState()
    s2.importantTasks['first-scan'] = { done: true }
    s2.firstStats = { ...(s2.firstStats ?? {}), mineUnits: 1 }
    const oreBefore = s2.warehouse.items['ore-veldspar'] ?? 0
    advanceGame(s2, 1000, ctx)
    expect(s2.importantTasks['first-mine']?.done).toBe(true)
    expect(s2.moduleBay['mod-salvager-1']).toBe(1)
    expect(s2.moduleBay['mod-miner-1']).toBeUndefined() // 采集器不再挂这条
    expect((s2.warehouse.items['ore-veldspar'] ?? 0) - oreBefore, '额外给 100 橄榄岩').toBe(100)
    // 再推几拍：不双发
    for (let i = 0; i < 5; i++) advanceGame(s2, 1000, ctx)
    expect((s2.warehouse.items['ore-veldspar'] ?? 0) - oreBefore).toBe(100)
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
    /**
     * ⚠ **顺序解锁下"轮到它"才判过**（2026-09-20 船长报障：未显示的任务不该提前完成）⇒
     * 本用例钉的是"这一条完成时发什么"，故先把排在它前面的任务标记完成（= 队列走到它了）。
     */
    reachQueue(state, 'first-skill')
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
    reachQueue(state, 'first-repair') // 顺序解锁：先推到它前面
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
    reachQueue(state, 'first-refine') // 顺序解锁：先推到它前面
    state.warehouse.items['ore-veldspar'] = 200
    expect(state.blueprintStock['bp-ammo-kinetic'] ?? 0).toBe(0)
    expect(startRefineRun(state, 'ore-veldspar', 'pilot', ctx).ok).toBe(true)
    for (let i = 0; i < 20 && state.importantTasks['first-refine']?.done !== true; i++) advanceGame(state, 60_000, ctx)
    expect(state.importantTasks['first-refine']?.done).toBe(true)
    expect(state.blueprintStock['bp-ammo-kinetic']).toBe(1)
  })

  it('「第一次完成悬赏」发一艘鲣鱼级（同型自动编号 #2，船长 2026-09-18）', () => {
    const state = testState()
    reachQueue(state, 'first-bounty') // 顺序解锁：先推到它前面
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
    reachQueue(state, 'first-produce') // 顺序解锁：先推到它前面
    expect(state.blueprintStock['sbp-sandcat'] ?? 0).toBe(0)
    // 判据 = 组装机产出 ≥ 1 件；直接置位计数再走一拍引擎（制造链路由制造侧用例覆盖）
    state.firstStats = { ...(state.firstStats ?? {}), produceUnits: 1 }
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-produce']?.done).toBe(true)
    expect(state.blueprintStock['sbp-sandcat']).toBe(1)
  })

  it('「第一条船」的计数落在**造船交付**处：真造出一艘才算，从舰船仓库转入舰队不算（2026-09-18 修）', () => {
    const state = testState()
    reachQueue(state, 'first-ship') // 顺序解锁：先推到它前面
    // 备料 + 学会沙猫级蓝图（正常路径里蓝图来自「第一次生产」的奖励）
    state.blueprintStock['sbp-sandcat'] = 1
    expect(learnBlueprint(state, ctx, 'sbp-sandcat').ok).toBe(true)
    state.warehouse.items['min-tritanium'] = 400
    state.warehouse.items['min-pyerite'] = 100
    expect(firstStatOf(state, 'ships')).toBe(0)
    expect(startManufacturing(state, 'sbp-sandcat', 'pilot', ctx).ok).toBe(true)
    // 工期 15 分钟（`sbp-sandcat.buildSeconds`）——推进到交付
    for (let i = 0; i < 60 && firstStatOf(state, 'ships') === 0; i++) advanceGame(state, 30_000, ctx)
    expect(firstStatOf(state, 'ships')).toBe(1)
    expect(state.firstShipBuilt).toBe(true)
    expect(state.importantTasks['first-ship']?.done).toBe(true)

    // 反例：仓库转舰队（原先误挂计数的那条路径）不该再加
    state.shipStore = { ...(state.shipStore ?? {}), sandcat: 1 }
    expect(unstoreShip(state, 'sandcat', ctx).ok).toBe(true)
    expect(firstStatOf(state, 'ships')).toBe(1)
  })

  it('任务中心序列：**顺序解锁，一次只给当前这一条**（船长 2026-09-20 玩家反馈「一次性太多了」）', () => {
    const state = testState()
    // ① 新档 ⇒ 只有第一条（第一次扫描）
    expect(firstTaskBoard(state).map((r) => r.def.id)).toEqual(['first-scan'])
    expect(firstTaskBoard(state).map((r) => r.def.id)).toEqual(visibleFirstTasks(state).map((d) => d.id))

    // ② 做完第一条 ⇒ 换成下一条（已完成的**不再占位**）
    state.importantTasks['first-scan'] = { done: true }
    expect(visibleFirstTasks(state).map((d) => d.id)).toEqual(['first-mine'])
    expect(firstTaskBoard(state).map((r) => r.def.id)).toEqual(['first-mine'])

    // ③ 一次跳完前两条 ⇒ 当前这条永远是"数组序里第一条没完成的"
    //    ⚠ 第 3 条 = 「第一次操作精炼炉」（**2026-09-20 船长三选②**：它从第 6 条前移到采矿之后）
    state.importantTasks['first-mine'] = { done: true }
    expect(visibleFirstTasks(state).map((d) => d.id)).toEqual(['first-refine'])

    // ④ **末段并列批**（2026-09-20 第三道令）：顺序段（前 11 条）走完 ⇒ 一次给两条，不再逐个解锁
    for (const d of FIRST_TASKS.slice(0, 11)) state.importantTasks[d.id] = { done: true }
    expect(visibleFirstTasks(state).map((d) => d.id)).toEqual(['first-haul', 'first-wormhole'])
    expect(firstTaskProgress(state)).toEqual({ done: 11, total: 13 })

    // ⑤ 13 条全完成 ⇒ 空数组（页头读数走 firstTaskProgress）
    for (const d of FIRST_TASKS) state.importantTasks[d.id] = { done: true }
    expect(visibleFirstTasks(state)).toEqual([])
    expect(firstTaskBoard(state)).toEqual([])
    expect(firstTaskProgress(state)).toEqual({ done: 13, total: 13 })

    // ⑥ 页头读数在只做了一条时 = 1/13
    const s2 = testState()
    s2.importantTasks['first-scan'] = { done: true }
    expect(firstTaskProgress(s2)).toEqual({ done: 1, total: 13 })
  })

  it('未显示的第一次任务**不能提前完成**（2026-09-20 船长报障：「未显示的第一次任务可以提前完成」）', () => {
    const state = testState()
    // ① 把"排在后面几条"的判据统统先做掉：港内维修一次 ＋ 虫洞声望 40 ＋ 采矿计数 1
    state.wallet.isk = 500_000
    state.fleet['sh-falconet']!.armorPct = 0.4
    expect(repairShip(state, 'sh-falconet', ctx).ok).toBe(true)
    state.standings['dsi'] = 40
    state.firstStats = { ...(state.firstStats ?? {}), mineUnits: 1 }
    advanceGame(state, 1000, ctx)
    // 只判过当前那一条（第一次扫描）——后面的一律不判过、奖励一件都不发
    expect(Object.entries(state.importantTasks).filter(([, v]) => v.done === true).map(([k]) => k)).toEqual(['first-scan'])
    expect(state.warehouse.items['repairkit-civ'] ?? 0).toBe(0)
    expect(state.wormholeStock?.length ?? 0).toBe(0)

    // ② 一拍最多判过一条：下一拍只前进到「第一次采集原矿」，不会顺手把精炼也判掉
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-mine']?.done).toBe(true)
    expect(state.importantTasks['first-refine']?.done).toBeUndefined()

    // ③ 自愈：轮到时按档内现状补齐（先前做的维修没白干，奖励照发）
    reachQueue(state, 'first-repair')
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-repair']?.done).toBe(true)
    expect(state.warehouse.items['repairkit-civ'] ?? 0).toBe(20)
  })

  it('里程碑页数据：`milestoneBoard` 给全部 13 条链、`unlocked` 只认"对应「第一次」已完成"', () => {
    const state = testState()
    const all = milestoneBoard(state)
    expect(all).toHaveLength(13)
    expect(all.every((r) => r.unlocked === false)).toBe(true)
    // 完成「第一次扫描」⇒ 只有它那条链解锁（顺序解锁口径下这是当前唯一的一条链）
    state.importantTasks['first-scan'] = { done: true }
    const rows = milestoneBoard(state)
    expect(rows.filter((r) => r.unlocked).map((r) => r.chainId)).toEqual(['explorer'])
    const explorer = rows.find((r) => r.chainId === 'explorer')!
    expect(explorer.taskId).toBe('first-scan')
    expect(explorer.taskTitle).toBe('第一次扫描')
    expect(explorer.total).toBeGreaterThan(0)
    // 链进度与领奖读数与 core 既有单点同源（面板只渲染）
    expect(explorer.count).toBe(chainProgressOf(state, FIRST_TASKS[0]!.chain!).count)
    expect(explorer.pendingIsk).toBe(chainPendingRewardIsk(state, 'explorer'))
  })

  it('「第一次虫洞」发 2 处未探索虫洞（声望判据 + 允许超库存上限，船长 2026-09-18）', () => {
    const state = testState()
    reachQueue(state, 'first-wormhole') // 顺序解锁：先推到它前面
    state.standings['dsi'] = 40
    expect(state.wormholeStock?.length ?? 0).toBe(0)
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-wormhole']?.done).toBe(true)
    expect(state.wormholeStock?.length ?? 0).toBe(2)
  })
})

describe('「第一次」顺序（2026-09-20 船长第三道令：「将第一次完成悬赏和第一次打捞残骸交换位置」）', () => {
  it('数组序：… 精炼 → **悬赏** → 维修 → **打捞** → 生产 …（悬赏前移，打捞挪到维修之后）', () => {
    const ids = FIRST_TASKS.map((d) => d.id)
    expect(ids.indexOf('first-refine')).toBeLessThan(ids.indexOf('first-bounty'))
    expect(ids.indexOf('first-bounty')).toBeLessThan(ids.indexOf('first-repair'))
    expect(ids.indexOf('first-repair')).toBeLessThan(ids.indexOf('first-salvage'))
    expect(ids.indexOf('first-salvage')).toBeLessThan(ids.indexOf('first-produce'))
  })

  it('三条原先没有奖励的条目各补 10,000 信用点（打捞 / 挂单 / 指派 AI 副船），其余条目不变', () => {
    for (const id of ['first-salvage', 'first-order', 'first-ai']) {
      expect(FIRST_TASKS.find((d) => d.id === id)?.reward, id).toEqual({ isk: 10_000 })
    }
    // 有实物奖励的条目照旧（发奖路径不变）
    expect(FIRST_TASKS.find((d) => d.id === 'first-scan')?.reward).toEqual({ modules: [{ moduleId: 'mod-miner-1', units: 1 }] })
    expect(FIRST_TASKS.find((d) => d.id === 'first-bounty')?.reward).toEqual({ ships: [{ defId: 'sh-falconet', units: 1 }] })
  })

  it('「第一次挂单销售」的判据走**界面那条路**也记上（2026-09-20 船长报障「第一次挂单销售任务无法完成」）', () => {
    /**
     * 病根：界面上唯一的"挂出卖单"入口是市场页 → `engine.placeSellOrderAt` → core 的 **`listSellHolding`**，
     * 而它走 `pushSellOrder` 那条路、**不经过 `placeSellOrder`** ⇒ 原先只有后者记 `bumpFirst('orders')`，
     * 界面挂单**永远不计数**、这条任务因此**永远做不完**（工具与用例都直接调 `placeSellOrder`，一直没暴露）。
     * 本用例钉死两条路各自都记一笔（且不重复）。
     */
    const state = testState()
    reachQueue(state, 'first-order') // 顺序解锁：先推到它前面
    // 备一批可卖的原矿（原矿是可上市商品）
    state.warehouse.items[BELT_ORE] = 200
    const good = [...ctx.marketGoods.values()].find(
      (g) => g.kind !== 'ship' && g.playerSellable !== false && g.refId === BELT_ORE,
    )
    expect(good, '原矿应当有市场行').toBeDefined()
    expect(firstStatOf(state, 'orders')).toBe(0)

    // ① 界面路径：listSellHolding（= engine.placeSellOrderAt 的底层）
    const listed = listSellHolding(state, ctx, good!.key, Math.max(1, Math.round(good!.basePrice ?? 1)), 10)
    expect(listed.ok, listed.error).toBe(true)
    expect(firstStatOf(state, 'orders')).toBe(1)

    // ② 排队到它那一拍 ⇒ 判过（并从仓库拿走 10 单位作托管）
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-order']?.done).toBe(true)
    advanceGame(state, 1000, ctx) // 奖励（10,000 信用点）在完成的下一拍发
    expect(state.wallet.isk).toBeGreaterThan(0)

    // ③ core API 那条路（placeSellOrder）同样记一笔，两条路互不重复
    const before = firstStatOf(state, 'orders')
    const o2 = placeSellOrder(state, ctx, good!.key, Math.max(1, Math.round(good!.basePrice ?? 1)), 5)
    expect(o2, 'core API 挂单应当成功').not.toBeNull()
    expect(firstStatOf(state, 'orders')).toBe(before + 1)
  })

  it('整船挂单（舰船仓库 → 挂卖单）也计一次「第一次挂单销售」', () => {
    const state = testState()
    reachQueue(state, 'first-order')
    // 舰船市场行的 refId = 舰船 defId（`shipStore` 的键同源）；沙猫级是"协会保底艇"⇒ 市场没有它的行，
    // 故用开局那艘鲣鱼级（`sh-falconet`）当货源。
    state.shipStore = { ...(state.shipStore ?? {}), 'sh-falconet': 1 }
    const shipGood = [...ctx.marketGoods.values()].find(
      (g) => g.kind === 'ship' && g.refId === 'sh-falconet' && g.playerSellable !== false,
    )
    expect(shipGood, '鲣鱼级应当有可挂卖的市场行').toBeDefined()
    const r = listSellHolding(state, ctx, shipGood!.key, Math.max(1, Math.round(shipGood!.basePrice ?? 1)), 1)
    expect(r.ok, r.error).toBe(true)
    expect(firstStatOf(state, 'orders')).toBe(1)
    advanceGame(state, 1000, ctx)
    expect(state.importantTasks['first-order']?.done).toBe(true)
  })

  it('「第一次打捞残骸」的 10,000 信用点真的到手（走 `grantFirstReward` 同一路径，只发一次）', () => {
    const s = testState()
    reachQueue(s, 'first-salvage') // 顺序解锁：先推到它前面
    s.firstStats = { ...(s.firstStats ?? {}), salvageRuns: 1 }
    const before = s.wallet.isk
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks['first-salvage']?.done).toBe(true)
    expect(s.wallet.isk).toBe(before + 10_000)
    for (let i = 0; i < 3; i++) advanceGame(s, 1000, ctx)
    expect(s.wallet.isk).toBe(before + 10_000) // 不双发
  })
})

describe('末段并列批（2026-09-20 船长第三道令：完成第 11 条后三条一起显示）', () => {
  /** 顺序段（前 11 条）走完的档 */
  function prefixDone(): GameState {
    const s = testState()
    for (const d of FIRST_TASKS.slice(0, 11)) s.importantTasks[d.id] = { done: true }
    return s
  }

  it('顺序段走完 ⇒ 一次显示两条「第一次」（长途运输 ＋ 虫洞）；顺序段里仍是"一次只出一条"', () => {
    const s = prefixDone()
    expect(FIRST_TASKS[10]!.id).toBe('first-ai') // 第 11 条 = 指派 AI 副船（顺序段到此为止）
    expect(visibleFirstTasks(s).map((d) => d.id)).toEqual(['first-haul', 'first-wormhole'])
    expect(firstTaskBoard(s).map((r) => r.def.id)).toEqual(['first-haul', 'first-wormhole'])
    expect(visibleFirstTasks(testState()).map((d) => d.id)).toEqual(['first-scan'])
  })

  it('并列期间两条互不阻塞：同拍可以都判过，奖励各发各的（飞鱼级 ＋ 2 处虫洞）', () => {
    const s = prefixDone()
    s.firstStats = { ...(s.firstStats ?? {}), haulTrips: 1 }
    s.standings['dsi'] = 40
    const fleetBefore = Object.keys(s.fleet).length
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks['first-haul']?.done).toBe(true)
    expect(s.importantTasks['first-wormhole']?.done).toBe(true)
    expect(Object.keys(s.fleet).length).toBe(fleetBefore + 1)
    expect(s.wormholeStock?.length ?? 0).toBe(2)
    expect(visibleFirstTasks(s)).toEqual([]) // 都做完了 ⇒ 列表空
  })

  it('并列期间"先干哪条都行"：只满足一条 ⇒ 只判过那一条，另一条留着', () => {
    const s = prefixDone()
    s.firstStats = { ...(s.firstStats ?? {}), haulTrips: 1 }
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks['first-haul']?.done).toBe(true)
    expect(s.importantTasks['first-wormhole']?.done).toBeUndefined()
    expect(visibleFirstTasks(s).map((d) => d.id)).toEqual(['first-wormhole'])
  })

  it('导航提醒按"显示组"记账：并列批出现 ⇒ 亮一次（标题两条串起来），记账写组签名', () => {
    const s = testState()
    for (const d of FIRST_TASKS.slice(0, 10)) s.importantTasks[d.id] = { done: true }
    expect(firstTasksMarkSeen(s)).toBe(true) // 看过当前那一条（第 11 条）
    expect(s.firstTaskSeenId).toBe('first-ai')
    s.importantTasks['first-ai'] = { done: true }
    expect(firstTaskNotice(s)).toEqual({ taskId: 'first-haul', title: '第一次长途运输、第一次虫洞' })
    expect(firstTasksMarkSeen(s)).toBe(true)
    expect(s.firstTaskSeenId).toBe('first-haul|first-wormhole')
    expect(firstTaskNotice(s)).toBeNull()
  })

  it('老档存的单条 id 照旧匹配（零迁移）：顺序段的签名与旧档值形态逐字相同', () => {
    const s = testState()
    s.firstTaskSeenId = 'first-scan' // 旧档形态（单条 id）
    expect(firstTaskNotice(s)).toBeNull()
  })
})

describe('「寻找人类」发布闸门（2026-09-20 船长第三道令：「完成 11 后与末段两条一起显示」）', () => {
  const TASK = 'find-humans'
  /** 序章演出结束的档（**旧口径"序章结束即发布"已作废** ⇒ 这一手不再发布它） */
  function prologueDone(): GameState {
    const s = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    expect(beginAfterAwaken(s).ok).toBe(true)
    expect(s.onboarding.step).toBe(ONB_DONE)
    return s
  }

  it('序章结束 ⇒ 不发布；前 10 条做完也不发布；第 11 条（指派 AI 副船）完成的那一拍才发布', () => {
    const s = prologueDone()
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks[TASK]).toBeUndefined()
    for (const def of FIRST_TASKS.slice(0, 10)) {
      s.importantTasks[def.id] = { done: true }
      advanceGame(s, 1000, ctx)
      expect(s.importantTasks[TASK], `${def.id} 完成后就发布了`).toBeUndefined()
    }
    expect(firstTaskProgress(s)).toEqual({ done: 10, total: 13 })
    // 第 11 条 = 顺序段最后一条 = 「第一次指派 AI 副船」
    const eleventh = FIRST_TASKS[10]!
    expect(eleventh.id).toBe('first-ai')
    s.importantTasks[eleventh.id] = { done: true }
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks[TASK]).toBeDefined()
    expect(s.importantTasks[TASK]?.done).toBe(false) // 完成方法未知：永久进行中
    expect(s.logs.filter((l) => l.textId === 'core.onboarding.001')).toHaveLength(1)
    // 发布与末段并列批同一拍：这一刻页面上是「寻找人类 ＋ 长途运输 ＋ 虫洞」
    expect(visibleFirstTasks(s).map((d) => d.id)).toEqual(['first-haul', 'first-wormhole'])
    expect(sequentialPrefixDone(s)).toBe(true)
  })

  it('发布只记一次：连推若干拍不重复发日志、不重置状态', () => {
    const s = prologueDone()
    for (const def of FIRST_TASKS) s.importantTasks[def.id] = { done: true }
    advanceGame(s, 1000, ctx)
    const once = s.logs.filter((l) => l.textId === 'core.onboarding.001').length
    expect(once).toBe(1)
    for (let i = 0; i < 5; i++) advanceGame(s, 1000, ctx)
    expect(s.logs.filter((l) => l.textId === 'core.onboarding.001').length).toBe(once)
  })

  it('序章演出期间不发布（演出盖住全屏）：前 11 条齐了也要等序章结束', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    for (const def of FIRST_TASKS) s.importantTasks[def.id] = { done: true }
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks[TASK]).toBeUndefined()
    expect(beginAfterAwaken(s).ok).toBe(true)
    advanceGame(s, 1000, ctx)
    expect(s.importantTasks[TASK]).toBeDefined()
  })

  it('老档：已发布的原样保留（不收回、不重置 allExplored）；顺序段齐却缺这条的档下一拍补发布', () => {
    // ① 老档里早就有这条（旧口径下序章结束时发的）⇒ 闸门只认"已存在即返回"
    const old = testState()
    old.importantTasks[TASK] = { done: false, allExplored: true }
    for (const def of FIRST_TASKS) old.importantTasks[def.id] = { done: true }
    advanceGame(old, 1000, ctx)
    expect(old.importantTasks[TASK]?.allExplored).toBe(true)
    expect(old.logs.filter((l) => l.textId === 'core.onboarding.001')).toHaveLength(0) // 不补发日志
    // ② 异常档（顺序段齐、缺这条）⇒ 现算补发布
    const broken = testState()
    for (const def of FIRST_TASKS.slice(0, 11)) broken.importantTasks[def.id] = { done: true }
    expect(broken.importantTasks[TASK]).toBeUndefined()
    advanceGame(broken, 1000, ctx)
    expect(broken.importantTasks[TASK]?.done).toBe(false)
  })
})

describe('导航「任务中心」的推进提醒（2026-09-20 船长令）', () => {
  /**
   * 船长原话：「**每推进一阶段第一次任务时，在导航栏的任务中心选项处进行提醒。**」
   * 口径与「赏金新板提示」同款（换板未看 ⇒ 亮 · 进页记账 ⇒ 灭）：**当前那一条 ≠ 看过的这一条** ⇒ 亮。
   */
  it('推进一阶段 ⇒ 亮（带当前那一条的标题）；记账一次 ⇒ 灭且幂等；再推进 ⇒ 又亮', () => {
    const s = testState()
    /**
     * ① **序章收尾已经替新档记过一笔**（开场信负责指路「待办清单在任务中心」）
     * ⇒ 新档开局不亮（不是"没记过"）；老档不经过序章收尾 ⇒ 首帧亮一次（与本组第 3 例）。
     */
    beginAfterAwaken(createInitialState({ nowWallMs: 0, seed: 11, prologue: true }))
    expect(firstTaskNotice(s), '当前是「第一次扫描」且没记过账 ⇒ 亮（老档语义）').toEqual({
      taskId: 'first-scan',
      title: '第一次扫描',
    })
    // ② 记一笔 ⇒ 灭；同一条重复记账返回 false（幂等）
    expect(firstTasksMarkSeen(s)).toBe(true)
    expect(firstTaskNotice(s)).toBeNull()
    expect(firstTasksMarkSeen(s)).toBe(false)
    expect(s.firstTaskSeenId).toBe('first-scan')
    // ③ 推进一阶段（完成扫描）⇒ 下一条顶上 ⇒ 又亮，且标题换成新那条
    s.importantTasks['first-scan'] = { done: true }
    expect(firstTaskNotice(s)).toEqual({ taskId: 'first-mine', title: '第一次采集原矿' })
    expect(firstTasksMarkSeen(s)).toBe(true)
    expect(firstTaskNotice(s)).toBeNull()
  })

  it('序章收尾会记一笔 ⇒ **新档开局不亮**，第一次推进后才亮', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 11, prologue: true })
    expect(firstTaskNotice(s), '演出期间还没记账').not.toBeNull()
    beginAfterAwaken(s)
    expect(s.firstTaskSeenId).toBe('first-scan')
    expect(firstTaskNotice(s), '序章收尾已提示过第一条 ⇒ 不亮').toBeNull()
    s.importantTasks['first-scan'] = { done: true }
    expect(firstTaskNotice(s)?.taskId).toBe('first-mine') // 推进后才亮
  })

  it('13 条全做完 ⇒ 不亮（没有"当前那一条"）；记账也不写键', () => {
    const s = testState()
    for (const d of FIRST_TASKS) s.importantTasks[d.id] = { done: true }
    expect(firstTaskNotice(s)).toBeNull()
    expect(firstTasksMarkSeen(s)).toBe(false)
    expect(s.firstTaskSeenId).toBeUndefined()
  })

  it('存档往返：记账随档；**没记过账就不写这个键**（老档与新档快照逐字一致 = 真零迁移）', () => {
    const fresh = testState()
    const raw = JSON.parse(serializeSaveFile(fresh, 1)) as { state: Record<string, unknown> }
    expect('firstTaskSeenId' in raw.state, '没记过账不该冒出这个键').toBe(false)
    expect(loadSaveFile(serializeSaveFile(fresh, 1)).state.firstTaskSeenId).toBeUndefined()
    // 记过账 ⇒ 往返保留（徽标也不再亮）
    firstTasksMarkSeen(fresh)
    const back = loadSaveFile(serializeSaveFile(fresh, 1)).state
    expect(back.firstTaskSeenId).toBe('first-scan')
    expect(firstTaskNotice(back)).toBeNull()
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

describe('链阈值（2026-09-18 船长第二轮标定）', () => {
  it('9 条新顶档：船长逐条指定的 L10 落地', () => {
    const top = (k: string): number => CHAIN_TIERS[k]!.at(-1)!
    expect(top('mineUnits')).toBe(10_000_000)
    expect(top('refineBatches')).toBe(1_000_000)
    expect(top('produceUnits')).toBe(1_000_000)
    expect(top('bountyWins')).toBe(10_000)
    expect(top('salvageRuns')).toBe(50_000)
    expect(top('wormholeRuns')).toBe(500)
    expect(top('ships')).toBe(1_000)
    expect(top('skills')).toBe(500) // 当前技能表满级 395 ⇒ 顶档留待新增技能
    expect(top('marketIncome')).toBe(100_000_000_000) // 交易收入 1,000 亿（税后）
  })

  it('未提到的三条与长途运输保持原值（船长：「没提到的保持原样」）', () => {
    expect(CHAIN_TIERS.scan).toEqual([5, 8, 12, 16, 20])
    expect(CHAIN_TIERS.repairs).toEqual([1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000])
    expect(CHAIN_TIERS.aiAssigns).toEqual([1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000])
    expect(CHAIN_TIERS.haulTrips).toEqual([1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000])
  })

  it('每条链严格递增（虫洞 L9 曾高于新 L10 的那个矛盾不再有）；扫描按内容上限 5 档、其余 10 档', () => {
    for (const [key, tiers] of Object.entries(CHAIN_TIERS)) {
      expect(tiers.length, `${key} 的档数不对`).toBe(key === 'scan' ? 5 : 10)
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!, `${key} 第 ${i + 1} 档没有递增`).toBeGreaterThan(tiers[i - 1]!)
      }
    }
  })

  it('L1~L5 保持原值（早期手感锚：平滑只动 L6~L10）', () => {
    expect(CHAIN_TIERS.mineUnits!.slice(0, 5)).toEqual([1_000, 2_500, 6_000, 15_000, 40_000])
    expect(CHAIN_TIERS.bountyWins!.slice(0, 5)).toEqual([1, 3, 8, 20, 50])
    expect(CHAIN_TIERS.ships!.slice(0, 5)).toEqual([1, 2, 4, 8, 15])
    expect(CHAIN_TIERS.skills!.slice(0, 5)).toEqual([5, 12, 25, 45, 70])
  })
})

describe('市场链：交易收入（税后）＋ 老档一次性折算', () => {
  it('卖货入账 ⇒ 累计 marketIncome（税后净额）；链判据走 income 而不是挂单张数', () => {
    const state = testState()
    const chain = FIRST_TASKS.find((d) => d.id === 'first-order')!.chain!
    expect(chain.stat).toBe('marketIncome')
    expect(chain.tierKey).toBe('marketIncome')
    // 备货并卖出（`sellAtMarket` 会 ensureMarket，按协会收购线成交）
    state.warehouse.items['min-tritanium'] = 500
    const before = state.wallet.isk
    const r = sellAtMarket(state, ctx, 'min-tritanium', 100)
    expect(r.sold).toBeGreaterThan(0)
    const gained = state.wallet.isk - before
    expect(gained).toBeGreaterThan(0)
    // 累计值 = 税后净入账（与钱包增量逐字一致——税后口径）
    expect(firstStatOf(state, 'marketIncome')).toBe(gained)
    expect(firstStatOf(state, 'orders')).toBe(0) // 直卖不算挂单
  })

  it('挂单成交也计入（挂单张数只作「第一次挂单销售」的判据）', () => {
    const state = testState()
    state.warehouse.items['min-tritanium'] = 500
    const order = sellAtMarket(state, ctx, 'min-tritanium', 100)
    expect(order.sold).toBeGreaterThan(0)
    const income = firstStatOf(state, 'marketIncome')
    expect(income).toBeGreaterThan(0)
    // 收入链进度随之推进（100 ISK 起 = 第一档）
    const chain = FIRST_TASKS.find((d) => d.id === 'first-order')!.chain!
    expect(chainProgressOf(state, chain).count).toBe(income)
  })

  it('老档一次性折算：按级别对齐（旧表级数 ⇒ 新表同级门槛），已达级数不倒退', () => {
    const state = testState()
    state.firstStats = { orders: 30 } // 旧表 [1,3,8,20,50…] ⇒ 已达第 4 级
    const file = JSON.parse(serializeSaveFile(state, 1)) as { version: number; state: Record<string, unknown> }
    file.version = 26 // 装成换口径之前的老档
    const loaded = loadSaveFile(JSON.stringify(file)).state
    expect(loaded.firstStats?.marketIncome).toBe(CHAIN_TIERS.marketIncome![3]) // 新表第 4 级 = 100,000
    const chain = FIRST_TASKS.find((d) => d.id === 'first-order')!.chain!
    expect(chainProgressOf(loaded, chain).level).toBe(4) // 折算后仍是第 4 级
    // 折算的落点直接是门槛值 ⇒ 再卖一点就升第 5 级
    expect(chainProgressOf(loaded, chain).next).toBe(CHAIN_TIERS.marketIncome![4])
  })

  it('挂单 0 张的老档不写该键（零迁移）；满档老档折到顶档', () => {
    const fresh = testState()
    const f1 = JSON.parse(serializeSaveFile(fresh, 1)) as { version: number; state: Record<string, unknown> }
    f1.version = 25
    const loadedFresh = loadSaveFile(JSON.stringify(f1)).state
    expect(loadedFresh.firstStats?.marketIncome).toBeUndefined()

    const maxed = testState()
    maxed.firstStats = { orders: 3000 } // 旧表顶档
    const f2 = JSON.parse(serializeSaveFile(maxed, 1)) as { version: number; state: Record<string, unknown> }
    f2.version = 26
    const loadedMaxed = loadSaveFile(JSON.stringify(f2)).state
    expect(loadedMaxed.firstStats?.marketIncome).toBe(CHAIN_TIERS.marketIncome![9])
  })
})

describe('链条目奖金上卡（船长：写清楚当前这级的具体数额）', () => {
  it('nextRewardIsk = 第（已达级数+1）级的奖金；满档 ⇒ 0（2026-09-20 起读数走 `milestoneBoard`）', () => {
    const state = testState()
    state.importantTasks['first-scan'] = { done: true }
    state.importantTasks['first-mine'] = { done: true }
    state.firstStats = { mineUnits: 2_500 } // 达第 2 级（1,000 / 2,500）
    advanceFirstChains(state)
    const row = milestoneBoard(state).find((r) => r.chainId === 'digger')!
    expect(row.unlocked).toBe(true) // 对应「第一次采集原矿」已完成
    expect(row.level).toBe(2)
    expect(row.nextRewardIsk).toBe(chainLevelRewardIsk(3))
    expect(row.nextRewardIsk).toBe(607_500) // 具体数额（不是公式）

    // 满档：没有"下一级" ⇒ 0
    const s2 = testState()
    s2.importantTasks['first-scan'] = { done: true }
    s2.importantTasks['first-mine'] = { done: true }
    s2.firstStats = { mineUnits: CHAIN_TIERS.mineUnits!.at(-1)! }
    advanceFirstChains(s2)
    const maxedRow = milestoneBoard(s2).find((r) => r.chainId === 'digger')!
    expect(maxedRow.level).toBe(10)
    expect(maxedRow.nextRewardIsk).toBe(0)
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
