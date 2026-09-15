/**
 * **虫洞 · 主控活动互斥（两个方向都要成立）**——船长 2026-09-13 定案，2026-09-14 复查报障后补测。
 *
 * 船长原话（照抄）：「之前订下的，探索虫洞时，主控不能进行其他活动。进入虫洞时必须无活动。好像失效了？」
 *
 * 两个方向（缺一不可）：
 * ① **进洞门槛**：主控手上有**任何**主控活动（采矿 / 打捞 / 长途运输 / **扫描虫洞** /
 *    远征 / 掩护巡逻 / 快递投送 / **亲自开炉精炼** / **亲自开线制造**）⇒ **进不去**
 *    （`wormholeEntryBlockReason`，判据 `shipBusyForWormhole` → `shipActivityBusy`）；
 * ② **洞内锁定**：人在洞里（`run.attending === true`）⇒ 别的活动**开不了**
 *    （`wormholePilotHoldReason` / 各活动自己的 block reason）；
 * ③ **临时离开**（关掉虫洞界面）⇒ 活动停止、**主控释放**（这条 2026-09-13 船长批准，
 *    与「洞内锁定」不冲突：离开之后不算"正在探索"）。
 *
 * ⚠ **2026-09-15 改判**（船长：「玩家扫描星系将不再占用玩家的主控活动」）：**星系扫描退出主控活动表**
 * （无人扫描艇 ⇒ 不占主控、不牵动舰船）⇒ 上面两张清单各少一档，且**两个方向都放行**：
 * 扫描期间能进洞 / 进洞后能派扫描艇 / 别的活动在跑也能派（见本文件「⑤ 星系扫描不占主控」）。
 *
 * ⚠ 本文件刻意用**真命令**建"在洞里"这个现场（`wormholeEnter`），别的活动则按各自命令写入的同一批字段
 * 构造（探针式：测的是门槛读的输入契约），并在 ② 里用真命令复核。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeEntryBlockReason, wormholeEntryAutoStops, wormholeLeave } from '../src/wormhole'
import { shipBusyForWormhole, shipActivityBusy } from '../src/wormhole'
import { shipBusyLabel } from '../src/activity'
import { wormholePilotHoldReason } from '../src/state'
import { startMining } from '../src/mining'
import { wormholeScanStart, wormholeScanStop, wormholeScanBlockReason, WORMHOLE_SCAN_UNLOCK_STANDING } from '../src/wormholeScan'
import { startScan, frontierGalaxyIds } from '../src/explore'
import { startExpedition } from '../src/expedition'
import { goStandbyAt } from '../src/location'

const ctx = buildSimContext()
const T1 = 'sh-falconet'
/** 主控活动现场（按各命令写入的字段构造；名字与界面活动栏同类目）——这些**照旧拦住进洞** */
const ACTIVITIES: Array<[string, (s: GameState) => void]> = [
  // ⚠ 「扫描星系」**2026-09-15 起不在这张表里**（船长：无人扫描艇不占主控）——见 ⑤ 那条对照用例
  // ⚠ 远征必须走**真命令**（`expeditionStatus` 还看 phase/目标星系等字段；手搓 active 会造出"假忙"，
  //    2026-09-13 那条老用例就踩过这个坑）
  ['远征', (s) => void startExpedition(s, 'ano-training', ctx)],
  ['掩护巡逻', (s) => void (s.standby.active = true)],
  ['快递投送', (s) => void (s.sideTasks.deliver = { taskId: 1, arriveAtGameMs: 600_000 } as never)],
  [
    '亲自开炉（精炼）',
    (s) => {
      s.refineRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never)
    },
  ],
  [
    '亲自开线（制造）',
    (s) => {
      s.manufacturingRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never)
    },
  ],
]

/** **进洞时会自动停掉**的那一档（船长 2026-09-14：「进洞自动停止」）——不拦人，进洞那一刻停掉它 */
function startWormholeScan(s: GameState): void {
  s.wormholeScan = { active: true, progressMs: 7 * 60_000 }
}

function fresh(): { state: GameState; pilot: string; mate: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 4242 })
  const mate = addShipToFleet(state, T1)
  state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING // 扫描虫洞的解锁门槛（另见 wormhole-unlock.test.ts）
  return { state, pilot: state.shipId, mate }
}

describe('虫洞 · 主控活动互斥（船长 2026-09-13 定案 · 2026-09-14 复查 + 「进洞自动停止」）', () => {
  it('**① 进洞门槛**：主控手上有任何主控活动 ⇒ 进不去（每一档都要给拒因）', () => {
    const notBusy: string[] = []
    const missed: string[] = []
    const drift: string[] = []
    for (const [name, setup] of ACTIVITIES) {
      const { state, pilot } = fresh()
      setup(state)
      const core = shipActivityBusy(state, pilot)
      const badge = shipBusyLabel(state, ctx, pilot)
      if (core === null) notBusy.push(name)
      // 两边（进洞门槛的判据 vs 界面忙态徽标）必须同时"忙"
      if ((core !== null) !== (badge !== null)) drift.push(`${name}（${core ?? '闲'} vs ${badge ?? '闲'}）`)
      if (wormholeEntryBlockReason(state, ctx, [pilot]) === null) missed.push(name)
    }
    expect(notBusy, `这些活动在跑；但"主控忙态"没认出来（现场/判据缺档）`).toEqual([])
    expect(drift, `这些活动两边忙态口径漂移（shipActivityBusy vs shipBusyLabel）`).toEqual([])
    expect(missed, `这些活动在跑；但主控照样能进洞（漏在门槛外）`).toEqual([])
  })

  /**
   * **「扫描虫洞 / 开采 / 打捞」三项例外**（船长 2026-09-14：「**进洞自动停止**」＋
   * 「『进洞会自动停掉的那一项活动』**同样落实到采矿/打捞**」）：
   * 它们都是"就地作业" ⇒ **不拦**，进洞那一刻**自动停掉**（与手点活动栏「停止」同一条路径、无损）。
   */
  it('**①′ 扫描虫洞 ⇒ 不拦，进洞那一刻自动停扫（进度保留 + 日志）**', () => {
    const { state, pilot } = fresh()
    startWormholeScan(state)
    // 徽标照旧报"忙"（它确实占着主控），但**进洞门槛放行**
    expect(shipBusyLabel(state, ctx, pilot)).toBe('扫描虫洞中')
    expect(shipActivityBusy(state, pilot)).toBe('扫描虫洞中')
    expect(wormholeEntryAutoStops(state).map((a) => a.label)).toEqual(['扫描虫洞中'])
    expect(wormholeEntryBlockReason(state, ctx, [pilot])).toBeNull()
    // 进洞 ⇒ 自动停扫：active 归 false、**进度一字不动**、日志写明"自动停掉"与已扫分钟
    const r = wormholeEnter(state, ctx, [pilot], 4242)
    expect(r.ok).toBe(true)
    expect(state.wormholeScan!.active).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(7 * 60_000)
    const logs = state.logs.map((l) => l.text)
    expect(logs.some((t) => t.includes('自动停掉') && t.includes('7 分钟'))).toBe(true)
    /**
     * 进度保留 ⇒ 出洞后能接着扫：人在洞里时扫描仍被挡（`wormholeScanBlockReason` 的那条
     * 「已经在虫洞里了」），**把本趟收掉之后**（`run = null`）就能续扫，且进度还是那 7 分钟。
     */
    expect(wormholeScanStart(state, ctx).ok).toBe(false)
    state.wormhole.run = null
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    expect(state.wormholeScan!.progressMs).toBe(7 * 60_000)
  })

  it('**①″ 开采 / 打捞 ⇒ 同样不拦，进洞那一刻自动停掉（货物留在船上 + 日志）**', () => {
    const beltId = [...ctx.belts.keys()][0]!
    // ── 开采：手搓"正在采掘且本趟已采 12 单位"的现场（门槛读的就是这两个字段） ──
    {
      const { state, pilot } = fresh()
      state.mining.active = true
      state.mining.beltId = beltId
      state.mining.phase = 'mining'
      state.mining.tripUnits = 12
      expect(shipActivityBusy(state, pilot)).toBe('采矿中')
      expect(wormholeEntryAutoStops(state).map((a) => a.label)).toEqual(['采矿中'])
      expect(wormholeEntryBlockReason(state, ctx, [pilot]), '开采中应当能进洞了').toBeNull()
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
      // 自动停采：走的是与「停止开采」同一个单点（字段全清、本趟读数进日志）
      expect(state.mining.active).toBe(false)
      expect(state.mining.beltId).toBeNull()
      expect(state.mining.tripUnits).toBe(0)
      const logs = state.logs.map((l) => l.text)
      expect(logs.some((t) => t.includes('自动停掉「开采」') && t.includes('12 单位'))).toBe(true)
    }
    // ── 打捞：同款现场 ──
    {
      const { state, pilot } = fresh()
      state.salvaging.active = true
      state.salvaging.galaxyId = 'galaxy-hub'
      state.salvaging.phase = 'salvaging'
      state.salvaging.tripM3 = 33.5
      expect(shipActivityBusy(state, pilot)).toBe('打捞中')
      expect(wormholeEntryAutoStops(state).map((a) => a.label)).toEqual(['打捞中'])
      expect(wormholeEntryBlockReason(state, ctx, [pilot]), '打捞中应当能进洞了').toBeNull()
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
      expect(state.salvaging.active).toBe(false)
      expect(state.salvaging.galaxyId).toBeNull()
      expect(state.salvaging.tripM3).toBe(0)
      const logs = state.logs.map((l) => l.text)
      expect(logs.some((t) => t.includes('自动停掉「打捞」') && t.includes('33.5'))).toBe(true)
    }
    // ── 边界：**副船的 AI 采矿**不算主控活动 ⇒ 照旧拦住（不替玩家停别人的派工） ──
    {
      const { state, pilot, mate } = fresh()
      state.aiAssignments[mate] = {
        coreType: 'basic',
        startedAtGameMs: 0,
        task: { kind: 'mining', beltId, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
      }
      const blocked = wormholeEntryBlockReason(state, ctx, [pilot, mate])
      expect(blocked ?? '').toContain('AI 采矿中')
      expect(wormholeEntryAutoStops(state)).toEqual([]) // 主控自己没在作业 ⇒ 没有要自动停的东西
    }
    // ── 边界：**远征不在自动停名单里**（船长 2026-09-14：「远征无法自动停」）⇒ 照旧拦住 ──
    {
      const { state, pilot } = fresh()
      startExpedition(state, 'ano-training', ctx)
      expect(wormholeEntryAutoStops(state).map((a) => a.name)).toEqual([])
      expect(wormholeEntryBlockReason(state, ctx, [pilot]) ?? '').toContain('远征')
    }
  })

  /**
   * **长途运输：警告 + 自动停**（船长 2026-09-14：「**长途运输发出警告**」）——
   * 它停掉**有可见后果**（本段航程中止、船被挪回出发站）⇒ 自动停名单里带 `warn` 标记，
   * 准备页据此摆**琥珀色警告条**（而不是轻描淡写的预告），但**照旧不拦进洞**。
   */
  it('**①‴ 长途运输 ⇒ 不拦，进洞那一刻自动停运（船即时返港停靠出发站 + warn 标记）**', () => {
    const { state, pilot } = fresh()
    state.hauling = { ...state.hauling, active: true, routeA: null, routeB: 'site-x', fromSiteId: null, toSiteId: 'site-x' }
    state.dockedSite = 'site-x'
    state.awayGalaxy = 'galaxy-hub'
    const stops = wormholeEntryAutoStops(state)
    expect(stops.map((a) => a.label)).toEqual(['长途运输中'])
    expect(stops[0]!.warn, '长途运输要发警告').toBe(true)
    expect(wormholeEntryBlockReason(state, ctx, [pilot]), '长途运输中应当能进洞了').toBeNull()
    expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
    // 自动停运：与手点「停止运输」同一个单点（清空航段 + 瞬时返港停靠出发站 + 清野外标记）
    expect(state.hauling.active).toBe(false)
    expect(state.hauling.toSiteId).toBeNull()
    expect(state.dockedSite).toBeNull() // 出发站 = 母港（fromSiteId null）
    expect(state.awayGalaxy).toBeNull()
    const logs = state.logs.map((l) => l.text)
    expect(logs.some((t) => t.includes('自动停掉「长途运输」') && t.includes('母港'))).toBe(true)
  })

  it('② **洞内锁定**：人在洞里 ⇒ 别的活动开不了（真命令复核）', () => {
    const { state, pilot } = fresh()
    const beltId = [...ctx.belts.keys()][0]!
    const scanTarget = frontierGalaxyIds(state, ctx)[0]!
    expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
    expect(state.wormhole.run!.attending).toBe(true)
    // 兜底判据（各活动命令共用的那一把尺）
    expect(wormholePilotHoldReason(state)).not.toBeNull()
    // 真命令：采矿 / 扫描虫洞 两个都该被拒，且理由是"在虫洞里"
    const mining = startMining(state, beltId, ctx)
    expect(mining.ok, '在洞里还能开采矿 = 主控干两件事').toBe(false)
    expect(mining.error ?? '').toContain('虫洞')
    const whscan = wormholeScanStart(state, ctx)
    expect(whscan.ok).toBe(false)
    expect(wormholeScanBlockReason(state) ?? '').toContain('虫洞')
    // 对照（2026-09-15）：**星系扫描不占主控 ⇒ 人在洞里照样能派扫描艇**（它不是"主控手上的事"）
    expect(startScan(state, scanTarget, ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(true)
    state.scanning.active = false
    // ②′ 两边忙态口径一致（`shipBusyForWormhole` vs 界面徽标 `shipBusyLabel`）
    expect(shipBusyForWormhole(state, pilot) !== null).toBe(shipBusyLabel(state, ctx, pilot) !== null)
  })

  it('③ **临时离开 ⇒ 主控释放**（2026-09-13 船长批准的口径，与"洞内锁定"不冲突）', () => {
    const { state, pilot } = fresh()
    const beltId = [...ctx.belts.keys()][0]!
    expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
    wormholeLeave(state)
    expect(state.wormhole.run!.attending).toBe(false)
    // 临时离开 = 活动停止 ⇒ 主控可以去做别的（本趟进度原样保存）
    expect(wormholePilotHoldReason(state)).toBeNull()
    expect(startMining(state, beltId, ctx).ok).toBe(true)
  })

  /**
   * **④ 扫描虫洞占着主控**（船长 2026-09-14 玩家反馈：「**虫洞扫描不占用主控活动**」）。
   *
   * 修前的漏洞 = **判据只有单向**：`wormholeScanBlockReason` 挡住"别人在跑时开扫"，
   * 却没有任何地方挡住"扫描时去干别的" ⇒ 一边扫描一边出海采矿/打捞/远征。
   * 修法 = 把它并进各主控活动共用的 `wormholePilotHoldReason`（一处生效，九个入口全覆盖）。
   */
  it('④ **扫描虫洞占用主控**：开采 / 远征 / 掩护巡逻 全部开不了（真命令）', () => {
    const { state } = fresh()
    const beltId = [...ctx.belts.keys()][0]!
    const scanTarget = frontierGalaxyIds(state, ctx)[0]!
    startWormholeScan(state) // 手搓现场：正在扫描虫洞（已扫 7 分钟）
    // 单点：占用判据必须点名"扫描虫洞"
    expect(wormholePilotHoldReason(state) ?? '').toContain('扫描虫洞')
    // 真命令逐条：一律被拒、拒因点名"扫描虫洞"
    const cases: Array<[string, { ok: boolean; error?: string }]> = [
      ['开采', startMining(state, beltId, ctx)],
      ['远征', startExpedition(state, 'ano-training', ctx)],
      ['掩护巡逻', goStandbyAt(state, 'galaxy-hub', ctx)],
    ]
    for (const [name, r] of cases) {
      expect(r.ok, `${name}：扫描虫洞期间还能开工 = 主控干两件事`).toBe(false)
      expect(r.error ?? '', `${name} 的拒因要点名"扫描虫洞"`).toContain('扫描虫洞')
    }
    // 对照（2026-09-15）：**星系扫描不占主控 ⇒ 扫描虫洞期间照样能派扫描艇**
    expect(startScan(state, scanTarget, ctx).ok).toBe(true)
    state.scanning.active = false
    // 停扫 ⇒ 立刻放行，且**进度保留**（回来可续扫）
    expect(wormholeScanStop(state).ok).toBe(true)
    expect(wormholePilotHoldReason(state)).toBeNull()
    expect(startMining(state, beltId, ctx).ok).toBe(true)
    expect(state.wormholeScan!.progressMs).toBe(7 * 60_000)
  })

  /**
   * **⑤ 星系扫描不占主控**（船长 2026-09-15：「玩家扫描星系将不再占用玩家的主控活动」）。
   * 两个方向都要放行：**扫描在跑 ⇒ 照旧能进洞**；**别的活动在跑 ⇒ 照旧能派扫描艇**（后者已在
   * `exploration.test.ts` 里用真命令钉住；这里钉"进洞门槛"这一侧，并确认忙态徽标不再报"扫描探索中"）。
   */
  it('⑤ 星系扫描不占主控：扫描在跑照旧能进洞；忙态徽标不再报"扫描探索中"', () => {
    const { state, pilot } = fresh()
    state.scanning.active = true
    state.scanning.galaxyId = 'galaxy-hub'
    state.scanning.finishAtGameMs = 600_000
    state.scanning.startedAtGameMs = 0
    // 两边（门槛判据 vs 界面徽标）都**不该**认它
    expect(shipActivityBusy(state, pilot)).toBeNull()
    expect(shipBusyLabel(state, ctx, pilot)).toBeNull()
    expect(wormholeEntryAutoStops(state)).toEqual([]) // 也不在"进洞自动停"名单里（它压根不占主控）
    expect(wormholeEntryBlockReason(state, ctx, [pilot])).toBeNull()
    expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
    expect(state.scanning.active).toBe(true) // 进洞不动扫描（无人扫描艇照旧在扫）
  })

  /**
   * **④′ 反方向也补齐**（同一批修）：长途运输 / 快递在途 / 亲自开炉 / 亲自开线**期间开不了扫**。
   * 判据读的就是这些字段（与 `mining.ts` / `industry.ts` / `manufacturing.ts` 同一批现场）。
   */
  it('④′ 长途运输 / 快递在途 / 亲自开炉 / 亲自开线 ⇒ 开不了扫（两个方向成对）', () => {
    const expectBlocked = (name: string, patch: (s: GameState) => void, keyword: string): void => {
      const { state } = fresh()
      patch(state)
      const why = wormholeScanBlockReason(state)
      expect(why, `${name} 期间不该能开扫`).not.toBeNull()
      expect(why ?? '', `${name} 的拒因要点名它自己`).toContain(keyword)
    }
    expectBlocked('长途运输', (s) => void (s.hauling = { ...s.hauling, active: true }), '长途运输')
    expectBlocked('快递投送在途', (s) => void (s.sideTasks.deliver = { taskId: 1, arriveAtGameMs: 600_000 } as never), '快递')
    expectBlocked(
      '亲自开炉（精炼）',
      (s) => void s.refineRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never),
      '精炼炉',
    )
    expectBlocked(
      '亲自开线（制造）',
      (s) => void s.manufacturingRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never),
      '制造',
    )
    // 对照：AI 核心驱动的炉/线**不占主控** ⇒ 照旧能开扫
    {
      const { state } = fresh()
      state.refineRuns.push({ id: 1, active: true, worker: 'basic', blueprintId: 'bp-titanium', count: 1 } as never)
      state.manufacturingRuns.push({ id: 2, active: true, worker: 'basic', blueprintId: 'bp-titanium', count: 1 } as never)
      expect(wormholeScanBlockReason(state), 'AI 核心驱动的产线不占主控').toBeNull()
    }
  })
})
