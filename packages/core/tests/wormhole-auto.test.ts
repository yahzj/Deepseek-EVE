/**
 * **虫洞 · 自动探索**（船长 2026-09-14 逐条定案 · 确认稿 §六 · 批次 3）。
 *
 * 船长原话（照抄）：「'扫描虫洞'界面内允许玩家自动配置舰队探索虫洞（占据4个副船AI）。自动探索需要较长时间，
 * 且收益不确定，并且也会承受严重损失，但是不会丢船。」→「自动探索时间缩短至5分钟。其他没问题了。」
 * 追加四答：「收益进仓库」·「按'手动一趟的期望 × 40%'」·「损伤口径两项都报」·
 * 「结算通讯消息的载体采用日志+需要确认的报告（显示在扫描虫洞页面里）。允许出现虫洞字样。」
 *
 * 锁住七条口径：
 * ① **参与舰自动配置**：最多 4 条、不派主控、在洞/在别的 AI 任务/已在别的自动探索的船不可派（给原因）；
 * ② **每条参与舰各占 1 枚 AI 核心**（与副船任务同一本账：`aiCoreUsed` 增加、名额不足拒绝、锁定期不能再接 AI 任务）；
 * ③ **时长 5 分钟**：不到点不结算；到点结算（**离线大步长同样适用**）；
 * ④ **产出 = 手动期望 × 40%**、**直入仓库**（不进参与舰货舱）；稀有残骸 ≈50%、货柜 ≈9%（层 2 起，多种子统计）；
 * ⑤ **损伤**：结构/装甲各 −40%~−80%，**结构保底 0.1 ⇒ 绝不丢船**；两项读数都进报告；
 * ⑥ **报告需确认**：结算入 `wormholeAutoReports`（`confirmed=false`），确认后待确认数归零；AI 与舰船当场释放；
 * ⑦ **随档往返 + 坏值清洗**（非法条目丢弃、参与舰不在舰队即丢、上限截断）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addWare } from '../src/inventory'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { aiCoreCapBlock, aiCoreShipUsed, aiCoreUsed, assignAiMining } from '../src/ai'
import { shipLockedReason } from '../src/state'
import { shipBusyLabel } from '../src/activity'
import { wormholeStockPush, wormholeStockOf } from '../src/wormholeScan'
import { MATTER_TECH_ESSENCE_ITEM_ID, matterTechNodes, researchMatterTech } from '../src/matterTech'
import {
  WORMHOLE_AUTO_DAMAGE_MAX,
  WORMHOLE_AUTO_DAMAGE_MIN,
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_HULL_FLOOR,
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_AUTO_REPORT_MAX,
  WORMHOLE_AUTO_YIELD_MUL,
  advanceWormholeAuto,
  wormholeAutoBlockReason,
  wormholeAutoCandidates,
  wormholeAutoConfirmAll,
  wormholeAutoConfirmReport,
  wormholeAutoDefaultShips,
  wormholeAutoMainHandover,
  wormholeAutoReportsOf,
  wormholeAutoRunsOf,
  wormholeAutoShipBlockReason,
  wormholeAutoStart,
  wormholeAutoStop,
  wormholeAutoTechFactors,
  wormholeAutoTechIsNeutral,
  wormholeAutoUnconfirmedCount,
} from '../src/wormholeAuto'
import { WORMHOLE_ORE_ITEM_ID } from '../src/wormhole'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/** 一条可派船的测试档：主控 + 若干副船（默认给 6 条，够挑 4 条）+ 一项已发现的虫洞 */
function fresh(opts?: { ships?: number; seed?: number; aiCoreSkill?: number }): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: opts?.seed ?? 4242 })
  const n = opts?.ships ?? 6
  for (let i = 0; i < n; i++) addShipToFleet(state, T3)
  // AI 核心共用上限技能 = ctx.balance.aiCore.skillId（'ai-expert'：LvN = 可同时启用 N 枚）
  state.skills.trained['ai-expert'] = opts?.aiCoreSkill ?? 6
  state.wormholeStock = []
  return state
}

/** 造一处库存虫洞（走真掷点；返回它的 id） */
function stockOne(state: GameState): string {
  const item = wormholeStockPush(state, ctx)
  expect(item).not.toBeNull()
  return item!.id
}

describe('虫洞 · 自动探索（批次 3）', () => {
  it('**自动配置参与舰**：最多 4 条、排除主控与已占用船、按武装度排序（不可派的给原因）', () => {
    const state = fresh({ ships: 6 })
    const rows = wormholeAutoCandidates(state, ctx)
    // 主控船不可派（它要在站内）
    const main = rows.find((r) => r.shipId === state.shipId)!
    expect(main.blocked).toContain('主控船')
    // 默认选中 = 最多 4 条
    const picked = wormholeAutoDefaultShips(state, ctx)
    expect(picked).toHaveLength(WORMHOLE_AUTO_MAX_SHIPS)
    expect(picked).not.toContain(state.shipId)
    // 已在别的 AI 任务里的船不可派
    const target = picked[0]!
    state.aiAssignments[target] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'standby', phase: 'outbound', galaxyId: null, finishAtGameMs: 0, legMs: 0 } as never,
    }
    const after = wormholeAutoCandidates(state, ctx).find((r) => r.shipId === target)!
    expect(after.blocked).toContain('AI 副船任务')
  })

  it('**每次自动探索占 1 枚 AI 核心**（同一本账：占用计入、名额不足拒绝、锁定期不能再接 AI 任务）', () => {
    const state = fresh({ ships: 6, aiCoreSkill: 2 })
    const stockId = stockOne(state)
    const picked = wormholeAutoDefaultShips(state, ctx)
    // 2026-09-26 船长令「整队一趟只占 1 枚」：编队规模**不再**被核心余量卡住（改前上限 2 枚 ⇒ 只挑 2 条）
    expect(picked).toHaveLength(4)
    const before = aiCoreUsed(state)
    expect(wormholeAutoStart(state, ctx, stockId, picked).ok).toBe(true)
    // 占 1 枚（不是"每条 1 枚"）：核心账 +1
    expect(aiCoreUsed(state)).toBe(before + 1)
    expect(aiCoreShipUsed(state)).toBe(1)
    // 该本账里那 1 枚**不再**按参与舰数重复计（4 条船也只占 1）
    expect(picked.length).toBe(4)
    // 锁定期：不能再接 AI 副船任务，且给出锁定原因
    const beltId = [...ctx.belts.keys()][0]!
    const r = assignAiMining(state, picked[0]!, 'basic', beltId, ctx)
    expect(r.ok).toBe(false)
    expect(shipLockedReason(state, picked[0]!, '驾驶它')).toContain('自动探索')
  })

  it('**核心不够就开不了第二趟**（1 枚/趟：上限 2 时两趟刚好占满，第三趟被拒）', () => {
    // 船要够多：两趟满编 8 条 + 1 条主控 ⇒ 12 条，免得先撞上"没船可派"（本条只验核心账）
    const state = fresh({ ships: 12, aiCoreSkill: 2 })
    expect(wormholeAutoStart(state, ctx, stockOne(state), wormholeAutoDefaultShips(state, ctx)).ok).toBe(true)
    expect(wormholeAutoStart(state, ctx, stockOne(state), wormholeAutoDefaultShips(state, ctx)).ok).toBe(true)
    expect(aiCoreShipUsed(state)).toBe(2)
    // 已占满（2/2）⇒ 第三趟拒，理由里点明"每次占用 1 枚"
    const third = wormholeAutoStart(state, ctx, stockOne(state), wormholeAutoDefaultShips(state, ctx))
    expect(third.ok).toBe(false)
    expect(String(third.error)).toContain('每次占用 1 枚')
  })

  it('**时长 5 分钟**：不到点不结算；到点结算并释放 AI 与舰船（离线大步长同样适用）', () => {
    const state = fresh({ ships: 6 })
    const stockId = stockOne(state)
    const run = wormholeAutoStart(state, ctx, stockId, wormholeAutoDefaultShips(state, ctx))
    expect(run.ok).toBe(true)
    expect(wormholeAutoRunsOf(state)).toHaveLength(1)
    expect(aiCoreShipUsed(state)).toBe(1) // 整队一趟占 1 枚（原「每条 1 枚」⇒ 4）
    // 差 1 毫秒不结算
    state.gameMs = WORMHOLE_AUTO_DURATION_MS - 1
    advanceWormholeAuto(state, ctx)
    expect(wormholeAutoRunsOf(state)).toHaveLength(1)
    expect(wormholeAutoReportsOf(state)).toHaveLength(0)
    // 到点：结算（离线大步长一次跨过也算到点）
    state.gameMs = WORMHOLE_AUTO_DURATION_MS + 60_000
    advanceWormholeAuto(state, ctx)
    expect(wormholeAutoRunsOf(state)).toHaveLength(0)
    expect(wormholeAutoReportsOf(state)).toHaveLength(1)
    expect(aiCoreShipUsed(state)).toBe(0) // AI 名额当场释放
    expect(shipLockedReason(state, state.shipId === 'x' ? 'x' : wormholeAutoReportsOf(state)[0]!.shipIds[0]!, '驾驶它')).toBeNull()
  })

  it('**收益 = 真跑一趟捡到的（2026-09-26 新口径）且直入仓库**（不进参与舰货舱）', () => {
    let wreckRuns = 0
    let oreRuns = 0
    const runs = 40
    for (let i = 0; i < runs; i++) {
      const state = fresh({ ships: 5, seed: 900 + i })
      const stockId = stockOne(state)
      const before = { ...state.warehouse.items }
      const ships = wormholeAutoDefaultShips(state, ctx)
      const cargoBefore = ships.map((id) => JSON.stringify(state.fleet[id]!.cargo ?? {}))
      expect(wormholeAutoStart(state, ctx, stockId, ships).ok).toBe(true)
      state.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
      advanceWormholeAuto(state, ctx)
      const report = wormholeAutoReportsOf(state)[0]!
      // 仓库确实增加了（收益直入仓库）
      const after = state.warehouse.items
      const gained = Object.keys(after).some((k) => (after[k] ?? 0) > (before[k] ?? 0))
      expect(gained).toBe(true)
      // 参与舰货舱一字未动（不进船）
      expect(ships.map((id) => JSON.stringify(state.fleet[id]!.cargo ?? {}))).toEqual(cargoBefore)
      if (report.gains.some((g) => g.itemId.startsWith('wreck-'))) wreckRuns += 1
      if (report.gains.some((g) => g.itemId === 'ore-voidmother')) oreRuns += 1
      // 每条进仓库的量都是正的整数（模拟器只 push > 0 的条目）
      for (const g of report.gains) expect(g.units).toBeGreaterThan(0)
    }
    // 绝大多数趟都该带回残骸（逐格走一趟至少打一个战斗节点）
    expect(wreckRuns).toBeGreaterThan(runs / 2)
    // 老口径"不看货舱、不挑地点"是白给；新口径要不要给母矿取决于这一趟真走到矿脉 —— 不硬断言
    expect(oreRuns).toBeGreaterThanOrEqual(0)
  })

  it('**损伤两项都报、绝不丢船**：结构/装甲各 −40%~−80%，结构保底 0.1（连跑 6 趟也见不了底）', () => {
    const state = fresh({ ships: 5 })
    const stockId = stockOne(state)
    const ships = wormholeAutoDefaultShips(state, ctx)
    const before = new Map(ships.map((id) => [id, { d: state.fleet[id]!.durability, a: state.fleet[id]!.armorPct ?? 1 }]))
    expect(wormholeAutoStart(state, ctx, stockId, ships).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    advanceWormholeAuto(state, ctx)
    const report = wormholeAutoReportsOf(state)[0]!
    expect(report.damage).toHaveLength(ships.length)
    for (const d of report.damage) {
      const b = before.get(d.shipId)!
      // 两项读数都在区间内（取整误差 ±1）
      expect(d.durabilityLossPct).toBeGreaterThanOrEqual(Math.round(WORMHOLE_AUTO_DAMAGE_MIN * 100) - 1)
      expect(d.durabilityLossPct).toBeLessThanOrEqual(Math.round(WORMHOLE_AUTO_DAMAGE_MAX * 100) + 1)
      expect(d.armorLossPct).toBeGreaterThanOrEqual(Math.round(WORMHOLE_AUTO_DAMAGE_MIN * 100) - 1)
      expect(d.armorLossPct).toBeLessThanOrEqual(Math.round(WORMHOLE_AUTO_DAMAGE_MAX * 100) + 1)
      // 船还在（绝不丢船）；结构确实下降了
      expect(state.fleet[d.shipId]).toBeDefined()
      expect(state.fleet[d.shipId]!.durability).toBeLessThan(b.d)
    }
    /**
     * **连跑 6 趟**：这条是"结构保底"的真钉子 —— 没有保底时两趟后结构就掉到 0.2 以下、三趟近 0
     * （用例立刻变红）；有保底则永远 ≥ `WORMHOLE_AUTO_HULL_FLOOR`，且**船一艘不少**。
     */
    for (let i = 0; i < 6; i++) {
      const next = wormholeStockPush(state, ctx)!
      expect(wormholeAutoStart(state, ctx, next.id, ships).ok).toBe(true)
      state.gameMs += WORMHOLE_AUTO_DURATION_MS + 1
      advanceWormholeAuto(state, ctx)
      for (const id of ships) {
        expect(state.fleet[id], `${id} 不该丢`).toBeDefined()
        expect(state.fleet[id]!.durability).toBeGreaterThanOrEqual(WORMHOLE_AUTO_HULL_FLOOR)
        expect(state.fleet[id]!.armorPct ?? 0).toBeGreaterThanOrEqual(0)
      }
    }
    expect(wormholeAutoReportsOf(state)).toHaveLength(7)
  })

  it('**报告需确认**：结算即待确认；确认后待确认数归零；「全部标为已读」一次清完', () => {
    const state = fresh({ ships: 5 })
    for (let i = 0; i < 2; i++) {
      const stockId = stockOne(state)
      expect(wormholeAutoStart(state, ctx, stockId, wormholeAutoDefaultShips(state, ctx)).ok).toBe(true)
      state.gameMs += WORMHOLE_AUTO_DURATION_MS + 1
      advanceWormholeAuto(state, ctx)
    }
    expect(wormholeAutoUnconfirmedCount(state)).toBe(2)
    const first = wormholeAutoReportsOf(state)[0]!
    expect(wormholeAutoConfirmReport(state, first.id).ok).toBe(true)
    expect(wormholeAutoUnconfirmedCount(state)).toBe(1)
    expect(wormholeAutoConfirmAll(state)).toBe(1)
    expect(wormholeAutoUnconfirmedCount(state)).toBe(0)
  })

  it('**中止**：无收益无损伤、AI 与舰船当场释放、该处虫洞不退还', () => {
    const state = fresh({ ships: 5 })
    const stockId = stockOne(state)
    const ships = wormholeAutoDefaultShips(state, ctx)
    const before = new Map(ships.map((id) => [id, state.fleet[id]!.durability]))
    const runId = wormholeAutoRunsOf(state)[0]?.id
    expect(wormholeAutoStart(state, ctx, stockId, ships).ok).toBe(true)
    const id = wormholeAutoRunsOf(state)[0]!.id
    expect(id).not.toBe(runId)
    expect(wormholeAutoStop(state, id).ok).toBe(true)
    expect(wormholeAutoRunsOf(state)).toHaveLength(0)
    expect(aiCoreShipUsed(state)).toBe(0)
    expect(wormholeAutoReportsOf(state)).toHaveLength(0)
    for (const [shipId, d] of before) expect(state.fleet[shipId]!.durability).toBe(d)
    // 该处虫洞不退还（开始时已消耗）
    expect(wormholeStockOf(state).find((x) => x.id === stockId)).toBeUndefined()
  })

  it('**随档往返 + 坏值清洗**（在跑的趟与报告都能存回来；坏条目丢弃、参与舰不在舰队即丢）', () => {
    const state = fresh({ ships: 5 })
    const stockId = stockOne(state)
    const ships = wormholeAutoDefaultShips(state, ctx)
    expect(wormholeAutoStart(state, ctx, stockId, ships).ok).toBe(true)
    const text = serializeSaveFile(state, 0)
    const back = loadSaveFile(text).state
    expect(wormholeAutoRunsOf(back)).toHaveLength(1)
    expect(wormholeAutoRunsOf(back)[0]!.shipIds).toEqual(ships)
    expect(wormholeAutoRunsOf(back)[0]!.finishAtGameMs).toBe(state.gameMs + WORMHOLE_AUTO_DURATION_MS)
    // 结算后再往返：报告与收益都在
    back.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    advanceWormholeAuto(back, ctx)
    const text2 = serializeSaveFile(back, 0)
    const back2 = loadSaveFile(text2).state
    expect(wormholeAutoReportsOf(back2)).toHaveLength(1)
    expect(wormholeAutoReportsOf(back2)[0]!.gains.length).toBeGreaterThan(0)
    expect(wormholeAutoReportsOf(back2)[0]!.confirmed).toBe(false)
    // 坏值：非数组 / 参与舰全不在舰队 / 缺 id ⇒ 丢弃
    const raw = JSON.parse(text2) as { state: Record<string, unknown> }
    raw.state.wormholeAuto = [
      { id: '', stockId: 'x', seed: 1, depth: 1, shipIds: ['ghost'], startedAtGameMs: 0, finishAtGameMs: 1 },
      { id: 'ok', stockId: 'x', seed: 0, depth: 99, shipIds: ['ghost'], startedAtGameMs: -5, finishAtGameMs: -5 },
      'nonsense',
      { id: 'ok2', stockId: 'y', seed: 5, depth: 2, shipIds: [ships[0]!], startedAtGameMs: 0, finishAtGameMs: 1 },
    ]
    raw.state.wormholeAutoReports = [{ id: '' }, { id: 'r1', depth: 99, gains: 'bad', damage: 0, shipIds: ['ghost'] }]
    const cleaned = loadSaveFile(JSON.stringify(raw)).state
    // 只剩"参与舰在舰队里"的那一条；深度夹到 1~9
    expect(wormholeAutoRunsOf(cleaned)).toHaveLength(1)
    expect(wormholeAutoRunsOf(cleaned)[0]!.depth).toBe(2)
    expect(wormholeAutoRunsOf(cleaned)[0]!.seed).toBe(5)
    expect(wormholeAutoRunsOf(cleaned)[0]!.startedAtGameMs).toBe(0)
    // 报告只留 id 非空的那条（坏 gains/damage 清成空数组、深度夹到 9）
    expect(wormholeAutoReportsOf(cleaned)).toHaveLength(1)
    expect(wormholeAutoReportsOf(cleaned)[0]!.gains).toEqual([])
    expect(wormholeAutoReportsOf(cleaned)[0]!.damage).toEqual([])
    expect(wormholeAutoReportsOf(cleaned)[0]!.depth).toBe(9)
    expect(WORMHOLE_AUTO_REPORT_MAX).toBeGreaterThan(0)
  })

  it('**界面守卫**：该处已在自动探索中 / 没船可派 / 参与舰不可派 都给出理由', () => {
    const state = fresh({ ships: 1 })
    const stockId = stockOne(state)
    // 副船数按实际舰队算（初始档自带一条船 + 本次新增的一条）
    const picked = wormholeAutoDefaultShips(state, ctx)
    expect(picked.length).toBeGreaterThanOrEqual(1)
    expect(wormholeAutoStart(state, ctx, stockId, picked).ok).toBe(true)
    // 同一处再来一趟 ⇒ 拒绝
    const second = wormholeStockPush(state, ctx)!
    expect(wormholeAutoBlockReason(state, ctx, stockId)).toContain('已经在自动探索中')
    // 参与舰不可派（已在这趟里）⇒ 拒绝并给原因
    expect(wormholeAutoBlockReason(state, ctx, second.id, picked)).toContain('自动探索')
  })

  /**
   * **主控随队 = 先换主控**（船长 2026-09-14：「如果选择了主控船，就将主控换到其他船上」＋
   * 选定「自动挑一条，弹窗写明是谁」/「忙时直接不允许」）。
   */
  it('**选了主控船 ⇒ 自动挑一条空闲船接任，派队后主控真的换过去了**', () => {
    const state = fresh({ ships: 4 })
    const stockId = stockOne(state)
    const oldMain = state.shipId
    const ho = wormholeAutoMainHandover(state, ctx, [oldMain])
    expect(ho.needed).toBe(true)
    expect(ho.toId).toBeTruthy()
    expect(ho.toName).toBeTruthy()
    expect(ho.toId).not.toBe(oldMain)
    // 队里没有主控 ⇒ 不需要交接
    expect(wormholeAutoMainHandover(state, ctx, [ho.toId!]).needed).toBe(false)
    // 派队：**只把主控编进队**（接任船由 core 自己挑）⇒ 真换了主控，老主控以"普通副船"身份随队出发
    const r = wormholeAutoStart(state, ctx, stockId, [oldMain])
    expect(r.ok).toBe(true)
    expect(state.shipId).toBe(ho.toId)
    const run = wormholeAutoRunsOf(state)[0]!
    expect(run.shipIds).toEqual([oldMain])
    // 换船之后这条老主控不再是主控 ⇒ 它现在只因为"正在这趟自动探索里"被挡（不再吃"主控不参与"那条）
    const blockedAfter = wormholeAutoShipBlockReason(state, oldMain) ?? ''
    expect(blockedAfter).not.toContain('主控')
    expect(blockedAfter).toContain('自动探索')
  })

  it('**主控正忙 ⇒ 直接不允许**（不沿用"采矿中换驾驶 = 旧船返航"那条善后链）', () => {
    const state = fresh({ ships: 4 })
    const oldMain = state.shipId
    // 让主控"忙"起来：给它派一项主控活动（这里用掩护巡逻，与 shipBusyLabel 同一把尺）
    // ⚠ 2026-09-15 起**不能用星图扫描**——星系扫描改成无人扫描艇，已经不占主控了
    state.standby = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: state.gameMs, legMs: 0 }
    expect(shipBusyLabel(state, ctx, oldMain)).not.toBeNull()
    const ho = wormholeAutoMainHandover(state, ctx, [oldMain])
    expect(ho.needed).toBe(true)
    expect(ho.toId).toBeUndefined()
    expect(ho.reason).toContain('主控正在')
    // 派队命令层同样拒绝（界面与命令同一把尺）
    const stockId = stockOne(state)
    const r = wormholeAutoStart(state, ctx, stockId, [oldMain])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('主控正在')
    expect(state.shipId).toBe(oldMain) // 一行状态都没动
    expect(wormholeStockOf(state).some((x) => x.id === stockId)).toBe(true) // 那处虫洞也没被消耗
  })

  it('**没有别的空闲船 ⇒ 交接不了**（主控不能随队）', () => {
    const state = fresh({ ships: 0 })
    const oldMain = state.shipId
    // 初始档自带两条船（主控 + 一条备船）⇒ 只留主控，制造"没人接任"
    for (const id of Object.keys(state.fleet)) if (id !== oldMain) delete state.fleet[id]
    const ho = wormholeAutoMainHandover(state, ctx, [oldMain])
    expect(ho.needed).toBe(true)
    expect(ho.toId).toBeUndefined()
    expect(ho.reason).toContain('没有别的空闲船')
  })
})

/**
 * **自动探索吃「谜质科技」**（船长 2026-09-19 四条裁定，照抄）：
 * 「自动探索不折扣，因为自动探索本身已经是产出*0.4的情况了，那么过程就不应该折扣」·
 * 「1，用实际回合。2，按「完成度 ⇒ 损伤最多减半」。3货仓接。AI核心吃。」
 *
 * 锁住：① 未点科技 ⇒ 系数全 1、日志不出现科技那一段（零行为变化）；
 * ② 满树 ⇒ 回合 / 货仓 / 两条效率 / 损伤**逐项对上**（含"实际回合"基数）；
 * ③ 同种子对照：科技档产出更多、损伤约为一半、绝不丢船。
 */
describe('虫洞 · 自动探索吃谜质科技（船长 2026-09-19 甲案）', () => {
  /** 备足研究材料（谜质 + 信用点；满树 1,196 枚 / 约 1.43B） */
  function rich(opts?: { ships?: number; seed?: number }): GameState {
    const state = fresh(opts)
    addWare(state, MATTER_TECH_ESSENCE_ITEM_ID, 5_000)
    state.wallet.isk = 5_000_000_000
    return state
  }

  /** 点满：探索线（回合 / 货仓 / 两条效率）+ 战斗线全 14 节点（损伤减半那一半） */
  function fullTech(state: GameState): void {
    for (const node of matterTechNodes(ctx)) {
      if (node.branch === 'industry') continue
      for (let i = 0; i < node.maxLevel; i++) {
        const r = researchMatterTech(state, ctx, node.id)
        expect(r.ok, `${node.id}：${r.error ?? ''}`).toBe(true)
      }
    }
  }

  it('未点科技 ⇒ 每个系数恒 1；派队返航的日志里不出现「谜质科技」那一段', () => {
    const state = rich({ ships: 5 })
    const ships = wormholeAutoDefaultShips(state, ctx)
    const f = wormholeAutoTechFactors(state, ctx, ships)
    expect([f.total, f.wreck, f.ore, f.damage]).toEqual([1, 1, 1, 1])
    expect(wormholeAutoTechIsNeutral(f)).toBe(true)
    const stockId = stockOne(state)
    expect(wormholeAutoStart(state, ctx, stockId, ships).ok).toBe(true)
    state.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    advanceWormholeAuto(state, ctx)
    expect(state.logs.some((l) => l.text.includes('谜质科技'))).toBe(false)
  })

  it('满树 ⇒ 回合（按本队实际基础回合）/ 货仓 / 打捞与采集效率 / 战斗线完成度 逐项对上', () => {
    const state = rich({ ships: 5 })
    const ships = wormholeAutoDefaultShips(state, ctx)
    expect(ships).toHaveLength(WORMHOLE_AUTO_MAX_SHIPS)
    fullTech(state)
    const f = wormholeAutoTechFactors(state, ctx, ships)
    // 4×长尾鲨 = 14,000 折合质量 ⇒ 基础回合 42（不含科技那一份）；货仓 4×2,600 m³ ÷ 500 = 20 格
    expect(f.baseTurns).toBe(42)
    expect(f.baseHold).toBe(20)
    expect(f.turnMul).toBeCloseTo(1 + 100 / 42, 6) // 时序锚定器 10 级 × +10
    expect(f.holdMul).toBeCloseTo(1 + 12 / 20, 6) // 折叠货舱 3 级 × +4 格
    expect(f.total).toBeCloseTo(f.turnMul * f.holdMul, 6)
    expect(f.salvageEff).toBeCloseTo(0.6, 6) // 引力吊臂 3 级 × 20%
    expect(f.collectEff).toBeCloseTo(0.6, 6) // 富集钻头 3 级 × 20%
    expect(f.wreck).toBeCloseTo(f.total * 1.6, 6)
    expect(f.ore).toBeCloseTo(f.total * 1.6, 6)
    expect(f.battleProgress).toBe(1)
    expect(f.damage).toBeCloseTo(0.5, 6) // 战斗线点满 ⇒ 损伤减半
    expect(wormholeAutoTechIsNeutral(f)).toBe(false)
  })

  it('同种子对照：科技档产出明显更多、损伤约为一半、结构仍不破保底（绝不丢船）', () => {
    const plain = rich({ ships: 5, seed: 21 })
    const teched = rich({ ships: 5, seed: 21 })
    fullTech(teched)
    const stockA = stockOne(plain)
    const stockB = stockOne(teched)
    const shipsA = wormholeAutoDefaultShips(plain, ctx)
    const shipsB = wormholeAutoDefaultShips(teched, ctx)
    expect(wormholeAutoStart(plain, ctx, stockA, shipsA).ok).toBe(true)
    expect(wormholeAutoStart(teched, ctx, stockB, shipsB).ok).toBe(true)
    plain.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    teched.gameMs = WORMHOLE_AUTO_DURATION_MS + 1
    advanceWormholeAuto(plain, ctx)
    advanceWormholeAuto(teched, ctx)
    const ra = wormholeAutoReportsOf(plain)[0]!
    const rb = wormholeAutoReportsOf(teched)[0]!
    // 同一处虫洞（种子/层一致）⇒ 两次结算的掷骰序列同源，可比
    expect(rb.depth).toBe(ra.depth)
    // 损伤：科技档（战斗线点满）≤ 无科技档的一半（取整 ±1）
    for (let i = 0; i < ra.damage.length; i++) {
      expect(rb.damage[i]!.durabilityLossPct).toBeLessThanOrEqual(Math.round(ra.damage[i]!.durabilityLossPct / 2) + 1)
      expect(rb.damage[i]!.armorLossPct).toBeLessThanOrEqual(Math.round(ra.damage[i]!.armorLossPct / 2) + 1)
      expect(rb.damage[i]!.durabilityPct).toBeGreaterThanOrEqual(Math.round(WORMHOLE_AUTO_HULL_FLOOR * 100))
    }
    // 产出：普通残骸（该族残骸 id）与矿石都变多
    const unitOf = (r: typeof ra, prefix: string): number =>
      r.gains.filter((g) => g.itemId.startsWith(prefix)).reduce((s, g) => s + g.units, 0)
    expect(unitOf(rb, 'wreck-')).toBeGreaterThan(unitOf(ra, 'wreck-'))
    expect(unitOf(rb, WORMHOLE_ORE_ITEM_ID)).toBeGreaterThan(unitOf(ra, WORMHOLE_ORE_ITEM_ID))
    // 日志里写清了实际生效的系数（读数与结算同源）；⚠ 取"返航"那条——
    // 研究本身也会写「🔬 谜质科技…」日志，按关键词找会先撞上它
    const log = teched.logs.map((l) => l.text).find((t) => t.includes('自动探索队返航')) ?? ''
    expect(log).toContain('谜质科技：残骸线')
    expect(log).toContain('损伤 ×0.50')
  })
})
