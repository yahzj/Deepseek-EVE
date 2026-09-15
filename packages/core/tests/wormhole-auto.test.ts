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
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { aiCoreCapBlock, aiCoreShipUsed, aiCoreUsed, assignAiMining } from '../src/ai'
import { shipLockedReason } from '../src/state'
import { shipBusyLabel } from '../src/activity'
import { wormholeStockPush, wormholeStockOf } from '../src/wormholeScan'
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
  wormholeAutoUnconfirmedCount,
} from '../src/wormholeAuto'

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

  it('**每条参与舰各占 1 枚 AI 核心**（同一本账：占用计入、名额不足拒绝、锁定期不能再接 AI 任务）', () => {
    const state = fresh({ ships: 6, aiCoreSkill: 2 })
    const stockId = stockOne(state)
    const picked = wormholeAutoDefaultShips(state, ctx)
    expect(picked).toHaveLength(2) // 上限 2 枚 ⇒ 自动配置只挑 2 条
    const before = aiCoreUsed(state)
    expect(wormholeAutoStart(state, ctx, stockId, picked).ok).toBe(true)
    expect(aiCoreUsed(state)).toBe(before + 2)
    expect(aiCoreShipUsed(state)).toBe(2)
    // 名额已满 ⇒ 再派被拒（同一本账）
    expect(aiCoreCapBlock(state, ctx, 'ship')).not.toBeNull()
    // 锁定期：不能再接 AI 副船任务，且给出锁定原因
    const beltId = [...ctx.belts.keys()][0]!
    const r = assignAiMining(state, picked[0]!, 'basic', beltId, ctx)
    expect(r.ok).toBe(false)
    expect(shipLockedReason(state, picked[0]!, '驾驶它')).toContain('自动探索')
  })

  it('**时长 5 分钟**：不到点不结算；到点结算并释放 AI 与舰船（离线大步长同样适用）', () => {
    const state = fresh({ ships: 6 })
    const stockId = stockOne(state)
    const run = wormholeAutoStart(state, ctx, stockId, wormholeAutoDefaultShips(state, ctx))
    expect(run.ok).toBe(true)
    expect(wormholeAutoRunsOf(state)).toHaveLength(1)
    expect(aiCoreShipUsed(state)).toBe(4)
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

  it('**产出 = 手动期望 × 40% 且直入仓库**（不进参与舰货舱；稀有残骸 ≈50%、货柜 ≈9% 层 2 起）', () => {
    expect(WORMHOLE_AUTO_YIELD_MUL).toBe(0.4)
    let rareHits = 0
    let boxHits = 0
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
      if (report.gains.some((g) => g.itemId.startsWith('wreck-rare-'))) rareHits += 1
      if (report.gains.some((g) => g.itemId.startsWith('box-relic-'))) boxHits += 1
      // 层 1 时不该出货柜（本用例的库存全是层 1~3 随机，只统计不硬断言层 1）
    }
    // 稀有残骸期望 0.5 件/趟 ⇒ 40 趟落在 8~32 次之间（宽松区间，防抖）
    expect(rareHits).toBeGreaterThan(6)
    expect(rareHits).toBeLessThan(34)
    // 货柜期望 ≈0.09/趟（层 2 起）⇒ 40 趟不会超过 12 次
    expect(boxHits).toBeLessThan(12)
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
