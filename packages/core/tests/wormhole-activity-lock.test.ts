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
import { gateMainActivity, mainActivityOf } from '../src/activityGate'
import { startMining } from '../src/mining'
import { wormholeScanStart, wormholeScanStop, wormholeScanBlockReason, WORMHOLE_SCAN_UNLOCK_STANDING } from '../src/wormholeScan'
import { startScan, frontierGalaxyIds } from '../src/explore'
import { HOME_GALAXY_ID, startExpedition } from '../src/expedition'
import { shortestTravelMinutes } from '../src/travel'
import { goStandbyAt } from '../src/location'

const ctx = buildSimContext()
const T1 = 'sh-falconet'
/** 主控活动现场（按各命令写入的字段构造；名字与界面活动栏同类目）——**2026-09-21 起：这一批全部"进洞自动停"** */
const ACTIVITIES: Array<[string, (s: GameState) => void]> = [
  // ⚠ 「扫描星系」**2026-09-15 起不在这张表里**（船长：无人扫描艇不占主控）——见 ⑤ 那条对照用例
  // ⚠ 远征必须走**真命令**（`expeditionStatus` 还看 phase/目标星系等字段；手搓 active 会造出"假忙"，
  //    2026-09-13 那条老用例就踩过这个坑）
  ['掩护巡逻', (s) => void (s.standby.active = true)],
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

/** **进洞时会自动停掉**的那一档（船长 2026-09-14「进洞自动停止」；2026-09-21 扩到七项） */
function startWormholeScan(s: GameState): void {
  s.wormholeScan = { active: true, progressMs: 7 * 60_000 }
}

/** 远征在途（真命令；2026-09-21 起属于"不可中断"那一档 ⇒ 照旧拦进洞） */
function startExpeditionHere(s: GameState): void {
  void startExpedition(s, 'ano-training', ctx)
}

function fresh(): { state: GameState; pilot: string; mate: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 4242 })
  const mate = addShipToFleet(state, T1)
  state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING // 扫描虫洞的解锁门槛（另见 wormhole-unlock.test.ts）
  return { state, pilot: state.shipId, mate }
}

describe('虫洞 · 主控活动互斥（船长 2026-09-13 定案 · 2026-09-14 复查 + 「进洞自动停止」· 2026-09-21 统一批）', () => {
  /**
   * ⚠ **2026-09-21 船长令改判**：「统一为能够直接切换（自动取消当前活动）」＋「3 纳入」（换驾驶与进洞
   * 并入同一条单点）⇒ 进洞门槛的"主控那一档"改走 `activityGate`：**能自动停的七项一律放行**（进洞那一刻
   * 停掉 + 统一日志），**只剩远征 / 快递投送 / 战斗中 / 洞里 / 返航途中**才拒。
   * 本用例钉两件事：① 七项都能识别为"要自动停的"；② 两边忙态口径（`shipActivityBusy` vs `shipBusyLabel`）不漂移。
   */
  it('**① 进洞自动停名单**：可自动停的七项都认得出来（忙态两边一致）', () => {
    const notBusy: string[] = []
    const drift: string[] = []
    for (const [name, setup] of ACTIVITIES) {
      const { state, pilot } = fresh()
      setup(state)
      const core = shipActivityBusy(state, pilot)
      const badge = shipBusyLabel(state, ctx, pilot)
      if (core === null) notBusy.push(name)
      // 两边（进洞门槛的判据 vs 界面忙态徽标）必须同时"忙"
      if ((core !== null) !== (badge !== null)) drift.push(`${name}（${core ?? '闲'} vs ${badge ?? '闲'}）`)
    }
    expect(notBusy, `这些活动在跑；但"主控忙态"没认出来（现场/判据缺档）`).toEqual([])
    expect(drift, `这些活动两边忙态口径漂移（shipActivityBusy vs shipBusyLabel）`).toEqual([])
  })

  it('**①ˣ 不可中断的两项 ⇒ 照旧拦进洞**（远征 / 快递投送；措辞统一为"不能中断"）', () => {
    // ── 远征在途：**返航腿**（没有在途战斗，所以拒因就是"远征不能中断"本身） ──
    {
      const { state, pilot } = fresh()
      state.expedition.active = true
      state.expedition.phase = 'back'
      state.expedition.battle = null
      expect(wormholeEntryAutoStops(state)).toEqual([]) // 不在自动停名单里
      const why = wormholeEntryBlockReason(state, ctx, [pilot])
      expect(why ?? '', '远征在飞还能进洞').toContain('不能中断')
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(false)
      expect(state.wormhole.run).toBeNull()
    }
    // ── 远征**交火中**（真命令）⇒ 拒因换成"战斗中"那句（船长：「处在战斗中的时候也设置为不可取消」） ──
    {
      const { state, pilot } = fresh()
      startExpeditionHere(state)
      const why = wormholeEntryBlockReason(state, ctx, [pilot])
      expect(why ?? '').toContain('战斗中')
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(false)
    }
    // ── 快递投送在途（手搓现场：投送没有"接单即出发"的便捷入口） ──
    {
      const { state, pilot } = fresh()
      state.sideTasks.deliver = { taskId: 1, arriveAtGameMs: 600_000 } as never
      expect(wormholeEntryAutoStops(state)).toEqual([])
      const why = wormholeEntryBlockReason(state, ctx, [pilot])
      expect(why ?? '', '快递在途还能进洞').toContain('不能中断')
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(false)
    }
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
    // 进洞 ⇒ 自动停扫：active 归 false、**进度一字不动**、统一日志带已扫分钟
    const r = wormholeEnter(state, ctx, [pilot], 4242)
    expect(r.ok).toBe(true)
    expect(state.wormholeScan!.active).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(7 * 60_000)
    const logs = state.logs.map((l) => l.text)
    expect(logs.some((t) => t.includes('已自动停止「扫描虫洞」') && t.includes('7 分钟'))).toBe(true)
    expect(state.logs.some((l) => l.textId === 'core.activityGate.007')).toBe(true) // 带读数那一版 id
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
      expect(logs.some((t) => t.includes('已自动停止「开采」') && t.includes('12 单位'))).toBe(true)
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
      expect(logs.some((t) => t.includes('已自动停止「打捞」') && t.includes('33.5'))).toBe(true)
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
    // ── 边界：**掩护巡逻 / 亲自开炉 / 亲自开线**（2026-09-21 起并入自动停名单） ──
    for (const [name, setup] of ACTIVITIES) {
      const { state, pilot } = fresh()
      setup(state)
      expect(wormholeEntryAutoStops(state).length, `${name} 应进"进洞自动停"名单`).toBe(1)
      expect(wormholeEntryBlockReason(state, ctx, [pilot]), `${name} 不该再拦进洞`).toBeNull()
      expect(wormholeEnter(state, ctx, [pilot], 4242).ok, `${name} 应能进洞`).toBe(true)
      expect(
        state.logs.some((l) => l.textId === 'core.activityGate.001' || l.textId === 'core.activityGate.007'),
        `${name} 停机要写统一日志`,
      ).toBe(true)
      expect(state.standby.active).toBe(false)
      expect(state.refineRuns.some((r) => r.active && r.worker === 'pilot')).toBe(false)
      expect(state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')).toBe(false)
    }
    // ── 边界：**远征不在自动停名单里**（船长 2026-09-14：「远征无法自动停」）⇒ 照旧拦住 ──
    {
      const { state, pilot } = fresh()
      state.expedition.active = true
      state.expedition.phase = 'back'
      state.expedition.battle = null
      expect(wormholeEntryAutoStops(state).map((a) => a.name)).toEqual([])
      expect(wormholeEntryBlockReason(state, ctx, [pilot]) ?? '').toContain('不能中断')
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
    expect(logs.some((t) => t.includes('已自动停止「长途运输」') && t.includes('母港'))).toBe(true)
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
   * ⚠ **2026-09-21 改口径**（船长：「统一为能够直接切换（自动取消当前活动）」）：判据仍是一处生效、
   * 九个入口全覆盖，但**行为从"硬拒"改成"自动停扫 + 统一日志"**——扫描进度保留，回来可续扫。
   * 只有远征/快递那两项（不可中断）才继续"拒"。
   */
  it('④ **扫描虫洞占用主控**：开采 / 掩护巡逻 ⇒ **自动停扫后照常开工**；远征 ⇒ 拒（真命令）', () => {
    const { state } = fresh()
    const beltId = [...ctx.belts.keys()][0]!
    const scanTarget = frontierGalaxyIds(state, ctx)[0]!
    startWormholeScan(state) // 手搓现场：正在扫描虫洞（已扫 7 分钟）
    // 单点：占着主控这件事仍被认出来（统一判据报"可自动停"）
    expect(mainActivityOf(state)).toBe('wormholeScan')
    expect(gateMainActivity(state, 'mining').action).toBe('halt')
    // 真命令：开采 ⇒ 自动停扫（进度保留）+ 开工
    const mining = startMining(state, beltId, ctx)
    expect(mining.ok, '扫描虫洞期间开采应当自动停扫后放行').toBe(true)
    expect(state.mining.active).toBe(true)
    expect(state.wormholeScan!.active).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(7 * 60_000) // 进度保留
    expect(state.logs.some((l) => l.text.includes('已自动停止「扫描虫洞」'))).toBe(true)
    // 远征：开矿在跑 ⇒ 自动停采后照常出发（战争优先）
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    expect(state.mining.active).toBe(false)
    // 远征在途（且已交火）⇒ **拒**（不可中断那一档：此刻的拒因是"战斗中"）
    const whscan = wormholeScanStart(state, ctx)
    expect(whscan.ok).toBe(false)
    expect(whscan.error ?? '').toContain('战斗中')
    expect(wormholeScanBlockReason(state)).toBeNull() // 本入口自己的前置没意见（是战斗/远征在飞拦下的）
    // 掩护巡逻（远征在途 ⇒ 先拒；把远征收掉再验自动停扫）
    state.expedition.active = false
    state.expedition.battle = null
    state.expedition.phase = 'out'
    state.wormholeScan = { active: true, progressMs: 7 * 60_000 }
    /**
     * ⚠ 目标要选**另一个已探索星系**：母港 = 当前所在，会被 `goStandbyAt` 自己那条"已停靠、无需前往"
     * 挡下来（2026-09-21 起跨活动判据排在**本入口自己的前置校验之后**，所以这里必须给一个能开工的现场）。
     */
    const elsewhere = [...ctx.galaxies.keys()].find(
      (g) => g !== HOME_GALAXY_ID && Number.isFinite(shortestTravelMinutes(ctx, HOME_GALAXY_ID, g)),
    )!
    state.exploredGalaxies.push(elsewhere)
    const patrol = goStandbyAt(state, elsewhere, ctx)
    expect(patrol.ok, '扫描虫洞期间掩护巡逻应当自动停扫后放行').toBe(true)
    expect(state.standby.active).toBe(false) // 即时就位：active 归 false、船在目标星系留守
    expect(state.awayGalaxy).toBe(elsewhere)
    expect(state.wormholeScan!.active).toBe(false)
    // 对照（2026-09-15）：**星系扫描不占主控 ⇒ 扫描虫洞期间照样能派扫描艇**
    expect(startScan(state, scanTarget, ctx).ok).toBe(true)
    state.scanning.active = false
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
   * **④′ 反方向也补齐**（同一批修；**2026-09-21 改口径**）：
   * 长途运输 ⇒ 开扫**先警告**（`core.activityGate.002`，界面两段确认）· 快递在途 ⇒ **拒**（不可中断）·
   * 亲自开炉 / 亲自开线 ⇒ **自动停掉后照常开扫**。两个方向仍由同一把尺兜住（不再各写一份）。
   */
  it('④′ 长途运输（警告）/ 快递（拒）/ 亲自开炉·开线（自动停）⇒ 开扫的三种口径', () => {
    // 长途运输：首击只警告（可中断那一档）
    {
      const { state } = fresh()
      state.hauling = { ...state.hauling, active: true }
      expect(wormholeScanBlockReason(state)).toBeNull() // 本入口自己的前置没意见
      const r = wormholeScanStart(state, ctx)
      expect(r.ok).toBe(false)
      expect(r.errorId).toBe('core.activityGate.002')
      expect(r.error ?? '').toContain('本段报酬拿不到')
      expect(state.wormholeScan?.active).not.toBe(true)
    }
    // 快递投送在途：**拒**（在途不可中断）
    {
      const { state } = fresh()
      state.sideTasks.deliver = { taskId: 1, arriveAtGameMs: 600_000 } as never
      const r = wormholeScanStart(state, ctx)
      expect(r.ok).toBe(false)
      expect(r.error ?? '').toContain('不能中断')
    }
    // 亲自开炉 / 亲自开线：**自动停掉**后照常开扫（进度丢弃——船长 2026-09-21 答 2）
    for (const [name, patch] of [
      [
        '亲自开炉（精炼）',
        (s: GameState) => void s.refineRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never),
      ],
      [
        '亲自开线（制造）',
        (s: GameState) =>
          void s.manufacturingRuns.push({ id: 1, active: true, worker: 'pilot', blueprintId: 'bp-titanium', count: 1 } as never),
      ],
    ] as Array<[string, (s: GameState) => void]>) {
      const { state } = fresh()
      patch(state)
      const r = wormholeScanStart(state, ctx)
      expect(r.ok, `${name} 期间开扫应当自动停掉它`).toBe(true)
      expect(state.refineRuns.some((x) => x.active && x.worker === 'pilot')).toBe(false)
      expect(state.manufacturingRuns.some((x) => x.active && x.worker === 'pilot')).toBe(false)
      expect(state.logs.some((l) => l.text.startsWith('已自动停止「'))).toBe(true)
    }
    // 对照：AI 核心驱动的炉/线**不占主控** ⇒ 照旧能开扫（且**不受影响**）
    {
      const { state } = fresh()
      state.refineRuns.push({ id: 1, active: true, worker: 'basic', blueprintId: 'bp-titanium', count: 1 } as never)
      state.manufacturingRuns.push({ id: 2, active: true, worker: 'basic', blueprintId: 'bp-titanium', count: 1 } as never)
      expect(wormholeScanBlockReason(state), 'AI 核心驱动的产线不占主控').toBeNull()
      expect(wormholeScanStart(state, ctx).ok).toBe(true)
      expect(state.refineRuns[0]!.active).toBe(true)
      expect(state.manufacturingRuns[0]!.active).toBe(true)
    }
  })
})
