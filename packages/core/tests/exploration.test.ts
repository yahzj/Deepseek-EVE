/**
 * 星图探索（V13）单元测试：
 * 初始迷雾/剪影推导/行动封锁/扫描探索作业/扫描期探索事件与加速/在途兜底点亮/v12→v13 迁移。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { startExpedition } from '../src/expedition'
import {
  acknowledgeScanView,
  actionBlockReason,
  ensureTransitExplored,
  frontierGalaxyIds,
  isExplored,
  markExplored,
  maxScanWindowMs,
  SCAN_WINDOW_MS,
  scanAwaitingView,
  scanStatus,
  startScan,
  stopScan,
} from '../src/explore'
import { EXPLORE_EVENTS } from '../src/events'
import { assignAiExpedition, assignAiMining, gainAiCore } from '../src/ai'
import { anomaly, belt, galaxy, makeTestCtx, moduleDef, ship , fittedOf } from './helpers'
import { shipBusyLabel } from '../src/activity'
import { loadSaveFile, MIN_MIGRATABLE_VERSION, serializeSaveFile } from '../src/save'

describe('V13 星图探索：迷雾与剪影', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    ctx = makeTestCtx()
  })

  it('初始：只亮母港；hub 的一跳邻居是剪影（frontier）', () => {
    expect(state.exploredGalaxies).toEqual(['galaxy-hub'])
    expect(isExplored(state, 'galaxy-hub')).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(frontierGalaxyIds(state, ctx)).toEqual(['galaxy-far'])
  })

  it('markExplored 去重；点亮后剪影推进到下一层', () => {
    expect(markExplored(state, 'galaxy-far')).toBe(true)
    expect(markExplored(state, 'galaxy-far')).toBe(false)
    expect(frontierGalaxyIds(state, ctx)).toEqual([])
    // 多跳世界：默认 hub–far 边仍存在，追加 hub–mid / mid–far
    const chainCtx = makeTestCtx({
      edges: [
        { from: 'galaxy-hub', to: 'galaxy-mid', travelMinutes: 1 },
        { from: 'galaxy-mid', to: 'galaxy-far', travelMinutes: 1 },
      ],
    })
    const s2 = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(frontierGalaxyIds(s2, chainCtx).sort()).toEqual(['galaxy-far', 'galaxy-mid'])
    markExplored(s2, 'galaxy-mid')
    expect(frontierGalaxyIds(s2, chainCtx)).toEqual(['galaxy-far'])
  })

  it('actionBlockReason：母港/已探索可行动，未探索给提示', () => {
    expect(actionBlockReason(state, null)).toBeNull()
    expect(actionBlockReason(state, 'galaxy-hub')).toBeNull()
    const r = actionBlockReason(state, 'galaxy-far')
    expect(r).toContain('尚未探索')
    markExplored(state, 'galaxy-far')
    expect(actionBlockReason(state, 'galaxy-far')).toBeNull()
  })
})

describe('V13 探索：行动封锁（远征/采矿/AI）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 500_000
    ctx = makeTestCtx({ belts: [belt('belt-far2', 'ore-a', '远星带', { galaxyId: 'galaxy-far' })] })
  })

  it('远征：未点亮星系目标拒绝出发（声望满足也不行），点亮后可出发', () => {
    state.standings['dsi'] = 5
    const r1 = startExpedition(state, 'ano-hard', ctx)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('尚未探索')
    markExplored(state, 'galaxy-far')
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
  })

  it('采矿：远处矿带未点亮拒绝开工；点亮后成功；母港矿带不受限', () => {
    const r1 = startMining(state, 'belt-far2', ctx)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('尚未探索')
    markExplored(state, 'galaxy-far')
    expect(startMining(state, 'belt-far2', ctx).ok).toBe(true)
    state.mining.active = false
    state.mining.beltId = null
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true) // hub 本地带不受限
  })

  it('AI 派发：采矿/远征目标未点亮拒绝', () => {
    // 给副船武装，把 AI 远征门槛（胜率 ≥80%）先满足——封锁检查在其后
    const tur = moduleDef('tur-ai2', 'turret', 0.5, {
      maxRangeM: 6000,
      minRangeM: 0,
      hitRate: 0.9,
      falloff: 0.3,
      reloadMs: 1000,
      dmgMult: 3,
      cpuUse: 10,
    })
    state.skills.trained['ai-expert'] = 1
    state.skills.trained['gunnery'] = 5
    state.fleet['sandcat2'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: 'tur-ai2', miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    gainAiCore(state, 'basic', 2)
    state.wallet.isk = 500_000
    state.warehouse.items['ammo-kinetic-l'] = 1_000
    // 手动首胜前置（AI 只打玩家亲手完成过的目标）：预置解锁，让本用例专测探索封锁
    state.completedBounties.push('ano-easy-far')
    const farCtx = makeTestCtx({
      modules: [tur],
      belts: [belt('belt-far3', 'ore-a', '远星带', { galaxyId: 'galaxy-far' })],
      anomalies: [anomaly('ano-easy-far', 'galaxy-far', { threat: 2, reward: 8_000 })],
    })
    const rm = assignAiMining(state, 'sandcat2', 'basic', 'belt-far3', farCtx)
    expect(rm.ok).toBe(false)
    expect(rm.error).toContain('尚未探索')
    // AI 远征已软下线（2026-09-05 船长定）：无论是否点亮一律"已下线"拒绝（探索封锁语义随之下线）
    const re = assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy-far', farCtx)
    expect(re.ok).toBe(false)
    expect(re.error).toContain('暂停受理')
    markExplored(state, 'galaxy-far')
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-far3', farCtx).ok).toBe(true)
    state.aiAssignments = {}
    gainAiCore(state, 'basic', 1)
    expect(assignAiExpedition(state, 'sandcat2', 'basic', 'ano-easy-far', farCtx).ok).toBe(false) // 仍拒绝：已下线
  })
})

describe('V13 探索：在途兜底点亮', () => {
  it('读档后远征进行中（老档迁移场景）：推进时目标星系自动点亮', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = makeTestCtx()
    state.expedition.active = true
    state.expedition.anomalyId = 'ano-hard'
    state.expedition.phase = 'out'
    state.expedition.finishAtGameMs = state.gameMs + 10 * 60_000
    state.expedition.outMs = 120_000
    state.expedition.durationMs = 4 * 60_000
    state.expedition.combatMs = 60_000
    state.expedition.power = 10
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    advanceGame(state, 1_000, ctx)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
  })

  it('ensureTransitExplored 直接可用（主控采矿/AI 任务同款兜底）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = makeTestCtx()
    ensureTransitExplored(state, ctx)
    expect(isExplored(state, 'galaxy-far')).toBe(false) // 无在途作业 → 不点亮
  })
})

describe('V13 扫描探索作业', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    ctx = makeTestCtx()
  })

  it('校验：母港无需扫描；非剪影不可扫描；已探索无需扫描', () => {
    expect(startScan(state, 'galaxy-hub', ctx).error).toContain('无需扫描')
    expect(startScan(state, 'galaxy-ghost', ctx).ok).toBe(false) // 未知星系
    markExplored(state, 'galaxy-far')
    expect(startScan(state, 'galaxy-far', ctx).error).toContain('无需扫描')
  })

  /**
   * **不占主控**（船长 2026-09-15：「玩家扫描星系将不再占用玩家的主控活动」）：
   * 修前这里会得到「采矿作业进行中：请先停止开采。」——扫描艇是无人艇，与主控手上那件事互不相干。
   * 「一次只派一艘」是唯一保留的互斥（`state.scanning` 单槽）：要换目标先召回。
   */
  it('不占主控：采矿中照样能派扫描艇；扫完前不能再派第二处（换目标先召回）', () => {
    const twoCtx = makeTestCtx({
      galaxies: [galaxy('galaxy-mid', '中途')],
      edges: [{ from: 'galaxy-hub', to: 'galaxy-mid', travelMinutes: 2 }],
    })
    state.mining.active = true
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(true)
    state.mining.active = false
    // 空闲扫描艇只有一艘：扫完前不能换目标，但**召回后立刻能换**（进度按星系各自保留）
    expect(startScan(state, 'galaxy-mid', twoCtx).error).toContain('另一处扫描')
    expect(stopScan(state, twoCtx).ok).toBe(true)
    expect(startScan(state, 'galaxy-mid', twoCtx).ok).toBe(true)
    expect(scanStatus(state).galaxyId).toBe('galaxy-mid')
  })

  it('剪影可扫描：去程取消，时长 = 10 分钟就地扫描窗口；完成即点亮并当场收尾', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    const st = scanStatus(state)
    expect(st.active).toBe(true)
    expect(st.galaxyId).toBe('galaxy-far')
    // 去程已取消：总时长 = 就地扫描窗口（默认 10 分钟）
    expect(st.totalMs).toBe(10 * 60_000)
    // 还差 1ms → 未完成
    advanceGame(state, 10 * 60_000 - 1, ctx)
    expect(state.scanning.active).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    advanceGame(state, 1, ctx)
    // 窗口完成：点亮 + **当场收尾**（2026-09-15：无人扫描艇没有返航段）+ 置"待查看"高亮位
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.scanning.active).toBe(false)
    expect(state.scanning.returning).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(state.logs.some((l) => l.text.includes('扫描完成'))).toBe(true)
    expect(scanAwaitingView(state)).toEqual({ galaxyId: 'galaxy-far' })
    // 舰船与位置全程不动（无人艇）：不在野外、也不产生任何行程
    expect(state.transit.active).toBe(false)
    expect(state.dockedSite).toBeNull()
  })

  it('去程取消：扫描时长与航行（warp/地图技能）无关，只算就地窗口', () => {
    const fastCtx = makeTestCtx({
      ships: [ship('warpy', { warpSpeedAus: 3.5 })],
    })
    state.shipId = 'warpy'
    state.fleet['warpy'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    expect(startScan(state, 'galaxy-far', fastCtx).ok).toBe(true)
    expect(scanStatus(state).totalMs).toBe(10 * 60_000) // 无航行段可缩
  })
})

describe('V13 扫描期事件：加速 + 探索池', () => {
  it('扫描期间到点事件从「探索发现」池抽取', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = makeTestCtx()
    state.events.nextAtGameMs = state.gameMs + 30_000
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    advanceGame(state, 40_000, ctx) // boost ×2：30s 倒计时被 80s 进度覆盖 → 必触发
    // ⚠ 按"最后一条 ✦ 事件"读，而不是"日志最后一条"：开局那一拍还会判过「第一次扫描」
    //   （母港本就已点亮）⇒ 2026-09-20 起它带奖励，会往日志尾部补一条奖励行（`core.firstRewards.001`）
    const last = state.logs.filter((l) => l.text.startsWith('✦')).at(-1)!
    expect(last.text.startsWith('✦')).toBe(true)
    expect(EXPLORE_EVENTS.some((e) => last.text.includes(e.text))).toBe(true)
  })

  it('无扫描时事件走常规池（回归：默认四类不受影响）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = makeTestCtx()
    state.events.nextAtGameMs = state.gameMs + 1_000
    advanceGame(state, 2_000, ctx)
    const last = state.logs.filter((l) => l.text.startsWith('✦')).at(-1)! // 同上：只看事件行
    expect(last.text.startsWith('✦')).toBe(true)
    // 常规池文本不应来自探索池（探索池有独特词条）
    expect(EXPLORE_EVENTS.some((e) => last.text.includes(e.text))).toBe(false)
  })
})

describe('V14 存档迁移与续扫进度', () => {
  it('下限那一版的老档读入：补 explored=[hub]、scanning 默认与 scanProgress 空表，其余无损', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 123_456
    const raw = state as unknown as Record<string, unknown>
    delete raw.exploredGalaxies
    delete raw.scanning
    delete raw.scanProgress
    raw.version = MIN_MIGRATABLE_VERSION // 2026-09-19：迁移链下限（原 v12 已不可迁）
    const text = serializeSaveFile(state, 999)
    const loaded = loadSaveFile(text)
    expect(loaded.state.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.state.exploredGalaxies).toEqual(['galaxy-hub'])
    expect(loaded.state.scanning).toEqual({
      active: false,
      galaxyId: null,
      finishAtGameMs: 0,
      startedAtGameMs: 0,
      originGalaxy: null,
      returning: false,
      awaitingView: false,
      lastGalaxyId: null,
    })
    expect(loaded.state.scanProgress).toEqual({})
    expect(loaded.state.wallet.isk).toBe(123_456)
    // 往返保存：新字段保留
    const again = loadSaveFile(serializeSaveFile(loaded.state, 1000))
    expect(again.state.version).toBe(CURRENT_STATE_VERSION)
    expect(again.state.exploredGalaxies).toEqual(['galaxy-hub'])
  })
})

describe('V14 扫描终止与续扫', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    ctx = makeTestCtx()
  })

  it('无作业时终止返回错误', () => {
    expect(stopScan(state, ctx).ok).toBe(false)
  })

  it('立即召回（去程已取消）：尚未产生窗口进度则无保留，舰船停靠原样', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(stopScan(state, ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
    expect(state.transit.active).toBe(false) // 无人扫描艇：不产生任何行程
    expect(state.awayGalaxy).toBeNull()
  })

  it('扫描窗口中召回：保存已完成窗口毫秒；下次续扫只补剩余窗口', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    // 去程取消：总作业 = 就地窗口 600s；扫到 300s 处终止 → 进度 300_000
    advanceGame(state, 300_000, ctx)
    expect(state.scanning.active).toBe(true)
    expect(stopScan(state, ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(state.scanProgress['galaxy-far']).toBe(300_000)
    expect(state.transit.active).toBe(false) // 无人扫描艇：不返航、不停靠
    expect(state.awayGalaxy).toBeNull()
    // 续扫：剩余窗口 300s = 300_000
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(scanStatus(state).totalMs).toBe(300_000)
    // 补扫完成 → 点亮、清进度并当场收尾
    advanceGame(state, 300_000, ctx)
    expect(state.scanning.active).toBe(false)
    expect(state.scanning.returning).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
    expect(state.awayGalaxy).toBeNull()
  })

  /**
   * **完成即收尾 + 待查看高亮**（船长 2026-09-15：「当扫描完成后这个进度条依旧存在并高亮，
   * 直到玩家进入星图界面查看后才移除」）：窗口走完 ⇒ `scanning.active` 立刻归 false，
   * 但 `scanAwaitingView` 亮着；玩家进星图（界面调 `acknowledgeScanView`）才收。
   * 收尾后**没有"返航段"这一档** ⇒ `stopScan` 只会回"没有进行中的扫描"。
   */
  it('窗口完整走完即自动完成：当场收尾 + 待查看高亮亮起，进星图看过才收', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    // 窗口还差 1ms：仍在作业中
    advanceGame(state, 600_000 - 1, ctx)
    expect(state.scanning.active).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(scanAwaitingView(state)).toBeNull() // 还没扫完 ⇒ 没有待查看
    advanceGame(state, 1, ctx)
    expect(state.scanning.active).toBe(false) // 完成即收尾（无返航段）
    expect(state.scanning.returning).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(state.transit.active).toBe(false)
    // 待查看位亮着，并记着是哪个星系（顶部那条进度条据此留格高亮）
    expect(scanAwaitingView(state)).toEqual({ galaxyId: 'galaxy-far' })
    expect(state.scanning.lastGalaxyId).toBe('galaxy-far')
    // 已收尾 ⇒ 此时"终止"无事可做（修前这里会因为返航段而报"正在自动返航，不可终止"）
    expect(stopScan(state, ctx).ok).toBe(false)
    // 玩家进「星图」看过 ⇒ 收掉高亮；再收一次返回 false（幂等，不该反复写档）
    expect(acknowledgeScanView(state)).toBe(true)
    expect(scanAwaitingView(state)).toBeNull()
    expect(acknowledgeScanView(state)).toBe(false)
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
  })

  it('normalize 兜底：进度记录被收敛在窗口合法上限内（= 24 小时，不是基准 10 分钟）', () => {
    state.scanProgress['galaxy-far'] = 999_999_999
    const loaded = loadSaveFile(serializeSaveFile(state, 1))
    expect(loaded.state.scanProgress['galaxy-far']).toBe(maxScanWindowMs())
    expect(maxScanWindowMs()).toBe(24 * 60 * 60_000) // 2026-09-23 船长令：最深星系 ×144 = 24 小时
  })

  it('低安续扫进度不被读档截断（2026-09-11 修复）：15 分钟进度存档后原样读回', () => {
    // 低于合法上限的合法进度：修前会被"基准 10 分钟"钳掉，修后必须原样保留
    state.scanProgress['galaxy-far'] = 15 * 60_000
    const loaded = loadSaveFile(serializeSaveFile(state, 1))
    expect(loaded.state.scanProgress['galaxy-far']).toBe(15 * 60_000)
    expect(loaded.state.scanProgress['galaxy-far']!).toBeGreaterThan(SCAN_WINDOW_MS)
  })
})

/**
 * **2026-09-15 船长定案：星系扫描无人化**——原话：
 * 「玩家扫描星系将不再占用玩家的主控活动（也不显示在主控活动里，而是在 AI 活动的图标右侧显示一个进度条，
 * 当扫描完成后这个进度条依旧存在并高亮，直到玩家进入星图界面查看后才移除）」。
 *
 * 三条口径（① 1A 双向放行 / ② 2A 不牵动舰船 · 无返航段 / ③ 3甲 不再暴露）：
 * 本块钉 ①②；③ 在 `t25.test.ts`（暴露）与 `b1.test.ts`（暴露清单）里；界面条与"看过即收"见 ④。
 */
describe('2026-09-15 星系扫描无人化：不占主控 / 不牵动舰船 / 待查看', () => {
  let state: GameState
  /** 两处剪影的星图（hub–far 之外再加 hub–mid）：才测得出"扫描 A 的同时干别的 / 换目标先召回" */
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 500_000
    ctx = makeTestCtx({
      galaxies: [galaxy('galaxy-mid', '中途')],
      edges: [{ from: 'galaxy-hub', to: 'galaxy-mid', travelMinutes: 2 }],
    })
  })

  it('① 双向放行（真命令）：扫描中能采矿、能远征；驾驶船不再报忙', () => {
    state.standings['dsi'] = 5
    markExplored(state, 'galaxy-far') // 远征目标（悬赏在 far）
    expect(startScan(state, 'galaxy-mid', ctx).ok).toBe(true)
    // 忙态徽标（换驾驶 / 派副船 / 进洞共用那把尺）：修前这里是 '扫描探索中'
    expect(shipBusyLabel(state, ctx, state.shipId)).toBeNull()
    // 扫描中采矿（修前：「扫描探索中：先终止扫描。」）
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(true) // 扫描不受影响，照旧在跑
    state.mining.active = false
    state.mining.beltId = null
    // 扫描中远征（修前同样被拒）
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(true)
  })

  it('② 不牵动舰船：野外驻留时开扫、扫完，位置/停靠/行程一律原样（无返航、无自动停靠、无卸货）', () => {
    state.awayGalaxy = 'galaxy-far' // 野外驻留（掩护巡逻）——修前开扫会把它清零
    state.dockedSite = null
    expect(startScan(state, 'galaxy-mid', ctx).ok).toBe(true)
    expect(state.awayGalaxy).toBe('galaxy-far')
    advanceGame(state, 10 * 60_000, ctx) // 窗口走完（far 无关；扫的是 mid）
    expect(isExplored(state, 'galaxy-mid')).toBe(true)
    expect(state.scanning.active).toBe(false)
    // 修前：完成 → 自动返航段 → 停靠「最近已建成站」+ 自动卸货；现在一律不动
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.dockedSite).toBeNull()
    expect(state.transit.active).toBe(false)
  })

  it('④ 完成待查看：set → 界面收条（幂等）；老档的"返航段"读档一次性收口并补亮', () => {
    // —— 新档：完成即亮待查看位 ——
    expect(startScan(state, 'galaxy-mid', ctx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, ctx)
    expect(scanAwaitingView(state)).toEqual({ galaxyId: 'galaxy-mid' })
    const round = loadSaveFile(serializeSaveFile(state, 1))
    expect(scanAwaitingView(round.state)).toEqual({ galaxyId: 'galaxy-mid' }) // 随档往返
    expect(acknowledgeScanView(round.state)).toBe(true)
    expect(scanAwaitingView(loadSaveFile(serializeSaveFile(round.state, 2)).state)).toBeNull()
    // —— 老档：正处在"自动返航段"（returning=true）的扫描 ——
    const old = createInitialState({ nowWallMs: 0, seed: 42 })
    old.exploredGalaxies.push('galaxy-mid') // 老档里窗口完成时星系已点亮（finishScan 先落地）
    old.scanning = {
      active: true,
      galaxyId: 'galaxy-mid',
      finishAtGameMs: 99_999,
      startedAtGameMs: 0,
      originGalaxy: 'galaxy-hub',
      returning: true,
    }
    const migrated = loadSaveFile(serializeSaveFile(old, 3)).state
    expect(migrated.scanning.active).toBe(false) // 返航段取消 ⇒ 一次性收口
    expect(migrated.scanning.returning).toBe(false)
    expect(migrated.scanning.finishAtGameMs).toBe(0)
    expect(isExplored(migrated, 'galaxy-mid')).toBe(true) // 情报不丢
    expect(scanAwaitingView(migrated)).toEqual({ galaxyId: 'galaxy-mid' }) // 收口时补亮，让玩家看一眼
  })
})
