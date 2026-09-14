/**
 * **虫洞 · 主控活动互斥（两个方向都要成立）**——船长 2026-09-13 定案，2026-09-14 复查报障后补测。
 *
 * 船长原话（照抄）：「之前订下的，探索虫洞时，主控不能进行其他活动。进入虫洞时必须无活动。好像失效了？」
 *
 * 两个方向（缺一不可）：
 * ① **进洞门槛**：主控手上有**任何**主控活动（采矿 / 打捞 / 长途运输 / 扫描星系 / **扫描虫洞** /
 *    远征 / 掩护巡逻 / 快递投送 / **亲自开炉精炼** / **亲自开线制造**）⇒ **进不去**
 *    （`wormholeEntryBlockReason`，判据 `shipBusyForWormhole` → `shipActivityBusy`）；
 * ② **洞内锁定**：人在洞里（`run.attending === true`）⇒ 别的活动**开不了**
 *    （`wormholePilotHoldReason` / 各活动自己的 block reason）；
 * ③ **临时离开**（关掉虫洞界面）⇒ 活动停止、**主控释放**（这条 2026-09-13 船长批准，
 *    与「洞内锁定」不冲突：离开之后不算"正在探索"）。
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
import { wormholeScanStart, wormholeScanBlockReason, WORMHOLE_SCAN_UNLOCK_STANDING } from '../src/wormholeScan'
import { startScan, frontierGalaxyIds } from '../src/explore'
import { startExpedition } from '../src/expedition'

const ctx = buildSimContext()
const T1 = 'sh-falconet'
/** 主控活动现场（按各命令写入的字段构造；名字与界面活动栏同类目）——这些**照旧拦住进洞** */
const ACTIVITIES: Array<[string, (s: GameState) => void]> = [
  ['长途运输', (s) => void (s.hauling.active = true)],
  [
    '扫描星系',
    (s) => {
      s.scanning.active = true
      s.scanning.galaxyId = 'galaxy-hub'
      s.scanning.finishAtGameMs = 600_000
      s.scanning.startedAtGameMs = 0
    },
  ],
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
  })

  it('② **洞内锁定**：人在洞里 ⇒ 别的活动开不了（真命令复核）', () => {
    const { state, pilot } = fresh()
    const beltId = [...ctx.belts.keys()][0]!
    const scanTarget = frontierGalaxyIds(state, ctx)[0]!
    expect(wormholeEnter(state, ctx, [pilot], 4242).ok).toBe(true)
    expect(state.wormhole.run!.attending).toBe(true)
    // 兜底判据（各活动命令共用的那一把尺）
    expect(wormholePilotHoldReason(state)).not.toBeNull()
    // 真命令：采矿 / 扫描虫洞 / 扫描星系 三个都该被拒，且理由是"在虫洞里"
    const mining = startMining(state, beltId, ctx)
    expect(mining.ok, '在洞里还能开采矿 = 主控干两件事').toBe(false)
    expect(mining.error ?? '').toContain('虫洞')
    const whscan = wormholeScanStart(state, ctx)
    expect(whscan.ok).toBe(false)
    expect(wormholeScanBlockReason(state) ?? '').toContain('虫洞')
    const scan = startScan(state, scanTarget, ctx)
    expect(scan.ok).toBe(false)
    expect(scan.error ?? '').toContain('虫洞')
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
})
