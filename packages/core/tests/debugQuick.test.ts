/**
 * V15 调试模式测试：debugQuick=1 时 训练/采矿/制造/远征航行/扫描 按 1 秒完成、
 * 交火即时按胜率预览判定并走正常结算；普通模式（false）行为不受影响。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame, enqueueSkill } from '../src/engine'
import { startMining, miningStatus } from '../src/mining'
import { startManufacturing } from '../src/manufacturing'
import { startExpedition, resolveBattleOutcome } from '../src/expedition'
import { startScan, isExplored } from '../src/explore'
import { makeTestCtx, skill, belt, anomaly } from './helpers'
import { loadSaveFile, serializeSaveFile } from '../src/save'

function freshState(quick = true): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 42 })
  s.debugQuick = quick
  s.wallet.isk = 5_000_000
  return s
}

describe('V15 debugQuick：作业 1 秒化', () => {
  let ctx: SimContext

  beforeEach(() => {
    ctx = makeTestCtx({ skills: [skill('nav-1')] })
  })

  it('训练：普通需 60s+ 的一级在 1s 内完成；debugQuick=false 时回到原时长', () => {
    const s = freshState(true)
    expect(enqueueSkill(s, 'nav-1', 1, ctx.skills).ok).toBe(true)
    advanceGame(s, 999, ctx)
    expect(s.skills.trained['nav-1'] ?? 0).toBe(0)
    advanceGame(s, 1, ctx)
    expect(s.skills.trained['nav-1']).toBe(1)
    // 普通模式：rank1 一级 = 60s，1s 内不应完成
    const n = freshState(false)
    enqueueSkill(n, 'nav-1', 1, ctx.skills)
    advanceGame(n, 1000, ctx)
    expect(n.skills.trained['nav-1'] ?? 0).toBe(0)
  })

  it('采矿：指令即采掘，循环 1 秒（快速产出；去程已取消）', () => {
    const s = freshState(true)
    expect(startMining(s, 'belt-a', ctx).ok).toBe(true)
    // 去程取消：无需 1 秒行程，直接采掘
    expect(miningStatus(s, ctx).phase).toBe('mining')
    advanceGame(s, 1000, ctx) // 一个循环 12s → 1s
    expect(miningStatus(s, ctx).tripUnits).toBeGreaterThan(0)
  })

  it('制造：批次 1 秒完成', () => {
    const s = freshState(true)
    s.learnedRecipes.push('bp-a')
    s.warehouse.items['min-a'] = 50
    expect(startManufacturing(s, 'bp-a', 'pilot', ctx).ok).toBe(true)
    advanceGame(s, 999, ctx)
    expect(s.manufacturingRuns).toHaveLength(1)
    advanceGame(s, 1, ctx)
    expect(s.manufacturingRuns).toHaveLength(0)
  })

  it('远征：去程取消（下达即开战）；返航 1 秒/单程×2；交火保留真实战斗（调试不跳过战斗，供验证）', () => {
    const s = freshState(true)
    s.standings['dsi'] = 5
    s.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(s, 'ano-hard', ctx).ok).toBe(true)
    // 去程取消：下达即进入交火
    expect(s.expedition.phase).toBe('battle')
    expect(s.expedition.battle).not.toBeNull()
    // 战斗按实时引擎推进（不被 debugQuick 即时跳过）；循环小步推进至战斗上限后必然结算
    for (let i = 0; i < 40 && s.expedition.active; i++) {
      advanceGame(s, 20_000, ctx)
    }
    expect(s.expedition.active).toBe(false)
    expect(s.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('扫描：1 秒完成点亮并自动返航（2026-09-06：完成不再停留）', () => {
    const s = freshState(true)
    expect(startScan(s, 'galaxy-far', ctx).ok).toBe(true)
    expect(s.scanning.active).toBe(true)
    advanceGame(s, 1000, ctx) // 窗口 1 秒走完 → 点亮 + 转自动返航
    expect(s.scanning.returning).toBe(true)
    expect(s.scanning.active).toBe(true)
    expect(isExplored(s, 'galaxy-far')).toBe(true)
    expect(s.awayGalaxy).toBeNull()
    // 返航腿走完 → 停靠母港
    for (let i = 0; i < 40 && s.scanning.active; i++) advanceGame(s, 20_000, ctx)
    expect(s.scanning.active).toBe(false)
    expect(s.awayGalaxy).toBeNull()
  })

  it('本地悬赏（母港目标）战后返航：调试模式 1 秒、普通模式仍 2 分钟（2026-09-10 修复写死 120s）', () => {
    // 本地返航段（目标星系 = 返航基准）此前写死 LOCAL_RETURN_MS=120s，不吃 debugQuick——
    // 调试模式下"战斗后的返航"永远要等 2 分钟（船长 2026-09-10 反馈）。现在与其它本地腿同口径。
    const localCtx = makeTestCtx({ quietEvents: true, skills: [skill('nav-1')] })
    const world = (quick: boolean): GameState => {
      const s = freshState(quick)
      expect(startExpedition(s, 'ano-a', localCtx).ok).toBe(true) // ano-a 在母港 = 本地目标
      expect(s.expedition.phase).toBe('battle') // 去程取消：下达即交火
      const b = s.expedition.battle!
      b.lastTickGameMs = s.gameMs
      b.ended = 'me' // 模拟胜负已分（结算窗口由 killcam 控制，测试直连结算函数）
      resolveBattleOutcome(s, localCtx)
      expect(s.expedition.phase).toBe('back')
      return s
    }

    const quick = world(true)
    expect(quick.expedition.finishAtGameMs - (quick.expedition.returnAtGameMs ?? 0)).toBe(1_000)
    advanceGame(quick, 1_000, localCtx) // 1 秒后到港
    expect(quick.expedition.active).toBe(false)
    expect(quick.awayGalaxy).toBeNull()

    const normal = world(false)
    expect(normal.expedition.finishAtGameMs - (normal.expedition.returnAtGameMs ?? 0)).toBe(120_000)
  })

  it('debugQuick=false 时以上路径不变（抽样：制造仍按原时长）', () => {
    const s = freshState(false)
    s.learnedRecipes.push('bp-a')
    s.warehouse.items['min-a'] = 50
    expect(startManufacturing(s, 'bp-a', 'pilot', ctx).ok).toBe(true)
    advanceGame(s, 1_000, ctx)
    expect(s.manufacturingRuns).toHaveLength(1) // bp-a 10 分钟
  })
})

describe('V15 存档：debugQuick 字段', () => {
  it('初始为 false；开关后往返保存保留', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.debugQuick).toBe(false)
    s.debugQuick = true
    const loaded = loadSaveFile(serializeSaveFile(s, 1000))
    expect(loaded.state.debugQuick).toBe(true)
    expect(loaded.state.version).toBe(24)
  })

  it('v14 档迁移：补 debugQuick=false 且其余无损', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    s.wallet.isk = 77
    const raw = s as unknown as Record<string, unknown>
    delete raw.debugQuick
    raw.version = 14
    const loaded = loadSaveFile(serializeSaveFile(s, 1000))
    expect(loaded.state.version).toBe(24)
    expect(loaded.state.debugQuick).toBe(false)
    expect(loaded.state.wallet.isk).toBe(77)
  })
})
