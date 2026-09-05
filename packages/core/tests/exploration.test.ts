/**
 * 星图探索（V13）单元测试：
 * 初始迷雾/剪影推导/行动封锁/扫描探索作业/扫描期探索事件与加速/在途兜底点亮/v12→v13 迁移。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { startExpedition } from '../src/expedition'
import {
  actionBlockReason,
  ensureTransitExplored,
  frontierGalaxyIds,
  isExplored,
  markExplored,
  scanStatus,
  startScan,
  stopScan,
} from '../src/explore'
import { EXPLORE_EVENTS } from '../src/events'
import { assignAiExpedition, assignAiMining, gainAiCore } from '../src/ai'
import { anomaly, belt, makeTestCtx, moduleDef, ship , fittedOf } from './helpers'
import { loadSaveFile, serializeSaveFile } from '../src/save'

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
    expect(re.error).toContain('已下线')
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

  it('校验：母港无需扫描；非剪影不可扫描；作业互斥；已探索无需扫描', () => {
    expect(startScan(state, 'galaxy-hub', ctx).error).toContain('无需扫描')
    expect(startScan(state, 'galaxy-ghost', ctx).ok).toBe(false) // 未知星系
    state.mining.active = true
    expect(startScan(state, 'galaxy-far', ctx).error).toContain('采矿作业进行中') // 剪影 + 作业中 → 互斥优先
    state.mining.active = false
    markExplored(state, 'galaxy-far')
    expect(startScan(state, 'galaxy-far', ctx).error).toContain('无需扫描')
  })

  it('剪影可扫描：去程取消，时长 = 10 分钟就地扫描窗口；完成点亮并自动返航（不停留）', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    const st = scanStatus(state)
    expect(st.active).toBe(true)
    expect(st.galaxyId).toBe('galaxy-far')
    expect(st.returning).toBe(false)
    // 去程已取消：总时长 = 就地扫描窗口（默认 10 分钟）
    expect(st.totalMs).toBe(10 * 60_000)
    // 还差 1ms → 未完成
    advanceGame(state, 10 * 60_000 - 1, ctx)
    expect(state.scanning.active).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    advanceGame(state, 1, ctx)
    // 窗口完成：点亮 + 进入自动返航段（2026-09-06：不再停留该星系）
    expect(state.scanning.returning).toBe(true)
    expect(state.scanning.active).toBe(true)
    expect(scanStatus(state).returning).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(state.logs.some((l) => l.text.includes('扫描完成'))).toBe(true)
    // 自动返航（2×单程）走完 → 停靠母港
    for (let i = 0; i < 60 && state.scanning.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.scanning.active).toBe(false)
    expect(state.scanning.returning).toBe(false)
    expect(state.awayGalaxy).toBeNull()
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
    const last = state.logs[state.logs.length - 1]!
    expect(last.text.startsWith('✦')).toBe(true)
    expect(EXPLORE_EVENTS.some((e) => last.text.includes(e.text))).toBe(true)
  })

  it('无扫描时事件走常规池（回归：默认四类不受影响）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = makeTestCtx()
    state.events.nextAtGameMs = state.gameMs + 1_000
    advanceGame(state, 2_000, ctx)
    const last = state.logs[state.logs.length - 1]!
    expect(last.text.startsWith('✦')).toBe(true)
    // 常规池文本不应来自探索池（探索池有独特词条）
    expect(EXPLORE_EVENTS.some((e) => last.text.includes(e.text))).toBe(false)
  })
})

describe('V14 存档迁移与续扫进度', () => {
  it('v12 档读入：补 explored=[hub]、scanning 默认与 scanProgress 空表，其余无损', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 123_456
    const raw = state as unknown as Record<string, unknown>
    delete raw.exploredGalaxies
    delete raw.scanning
    delete raw.scanProgress
    raw.version = 12
    const text = serializeSaveFile(state, 999)
    const loaded = loadSaveFile(text)
    expect(loaded.state.version).toBe(24)
    expect(loaded.state.exploredGalaxies).toEqual(['galaxy-hub'])
    expect(loaded.state.scanning).toEqual({ active: false, galaxyId: null, finishAtGameMs: 0, startedAtGameMs: 0, originGalaxy: null, returning: false })
    expect(loaded.state.scanProgress).toEqual({})
    expect(loaded.state.wallet.isk).toBe(123_456)
    // 往返保存：新字段保留
    const again = loadSaveFile(serializeSaveFile(loaded.state, 1000))
    expect(again.state.version).toBe(24)
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

  it('立即终止（去程已取消）：尚未产生窗口进度则无保留，舰船停靠原样', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(stopScan(state, ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
    expect(state.transit.active).toBe(false) // 即时返航空间站（无行程）
    expect(state.awayGalaxy).toBeNull()
  })

  it('扫描窗口中终止：保存已完成窗口毫秒并即时返航；下次续扫只补剩余窗口', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    // 去程取消：总作业 = 就地窗口 600s；扫到 300s 处终止 → 进度 300_000
    advanceGame(state, 300_000, ctx)
    expect(state.scanning.active).toBe(true)
    expect(stopScan(state, ctx).ok).toBe(true)
    expect(state.scanning.active).toBe(false)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    expect(state.scanProgress['galaxy-far']).toBe(300_000)
    // 终止 = 即时返航空间站（transit 不落行程；位置回母港）
    expect(state.transit.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    // 续扫：剩余窗口 300s = 300_000
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(scanStatus(state).totalMs).toBe(300_000)
    // 补扫完成 → 点亮、清进度并转入自动返航；返航到港后停靠母港
    advanceGame(state, 300_000, ctx)
    expect(state.scanning.active).toBe(true)
    expect(state.scanning.returning).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
    for (let i = 0; i < 60 && state.scanning.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.scanning.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
  })

  it('窗口完整走完即自动完成（点亮 + 自动返航，无停留段）；返航段不可终止', () => {
    expect(startScan(state, 'galaxy-far', ctx).ok).toBe(true)
    // 窗口还差 1ms：仍在作业中
    advanceGame(state, 600_000 - 1, ctx)
    expect(state.scanning.active).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(false)
    advanceGame(state, 1, ctx)
    expect(state.scanning.active).toBe(true) // 自动返航段（船在忙）
    expect(state.scanning.returning).toBe(true)
    expect(isExplored(state, 'galaxy-far')).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(state.transit.active).toBe(false)
    // 返航段不可终止
    expect(stopScan(state, ctx).ok).toBe(false)
    expect(state.scanning.active).toBe(true)
    // 到港收尾
    for (let i = 0; i < 60 && state.scanning.active; i++) advanceGame(state, 60_000, ctx)
    expect(state.scanning.active).toBe(false)
    expect(state.scanning.returning).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(state.scanProgress['galaxy-far']).toBeUndefined()
  })

  it('normalize 兜底：进度记录被收敛在窗口上限内', () => {
    state.scanProgress['galaxy-far'] = 999_999_999
    const loaded = loadSaveFile(serializeSaveFile(state, 1))
    expect(loaded.state.scanProgress['galaxy-far']).toBe(10 * 60_000)
  })
})
