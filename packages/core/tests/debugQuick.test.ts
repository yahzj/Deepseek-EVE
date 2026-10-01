/**
 * V15 调试模式测试：debugQuick=1 时 训练/采矿/制造/远征航行/扫描 按 1 秒完成、
 * 交火即时按胜率预览判定并走正常结算；普通模式（false）行为不受影响。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { advanceGame, enqueueSkill } from '../src/engine'
import { startMining, miningStatus } from '../src/mining'
import { startManufacturing } from '../src/manufacturing'
import { startRefineRun, startRecycleRun, startUnboxRun } from '../src/industry'
import { startExpedition, resolveBattleOutcome } from '../src/expedition'
import { startScan, isExplored, scanAwaitingView } from '../src/explore'
import { makeTestCtx, skill, belt, anomaly } from './helpers'
import { addWare } from '../src/inventory'
import { buildSimContext } from '@whale/data'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { setStanding } from './helpers'

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

  /**
   * **精炼炉那一族（精炼 / 回收 / 拆解）也要吃 1 秒化**（**2026-10-01 补**）。
   *
   * 为什么单列一条：全仓 20 处 `state.debugQuick` 触点里 `industry.ts` 原先**零处** ——
   * 调试面板自称「**所有作业**按 1 秒完成」、V15 文档的覆盖表里也没有炉子，
   * 而制造线与实验室都吃（实验室还是船长 2026-09-30 专门下令补的）⇒ 属实现漏项。
   * 这三条用**真内容目录**建现场（矿 / 残骸 / 货柜各取一个确定 id，口径同 `halt-material-refund.test.ts`）。
   */
  it('炉子产线（精炼 / 回收 / 拆解）：调试模式批次 1 秒完成（2026-10-01 补）', () => {
    const rctx = buildSimContext()
    const ORE = 'ore-veldspar'
    const WRECK = 'wreck-a-hi'
    const BOX = 'box-relic-a'
    const s = freshState(true)
    addWare(s, ORE, 1_000)
    expect(startRefineRun(s, ORE, 'pilot', rctx).ok).toBe(true)
    expect(s.refineRuns[0]!.cycleMs, '调试模式固定 1 秒（不吃技能乘区）').toBe(1000)
    s.refineRuns.length = 0
    addWare(s, WRECK, 1_000)
    expect(startRecycleRun(s, WRECK, 'pilot', rctx).ok).toBe(true)
    expect(s.refineRuns[0]!.cycleMs).toBe(1000)
    s.refineRuns.length = 0
    addWare(s, BOX, 5)
    expect(startUnboxRun(s, rctx, BOX, 'pilot').ok).toBe(true)
    expect(s.refineRuns[0]!.cycleMs).toBe(1000)

    // 普通模式：同一台炉仍按配方周期（不受影响）
    const n = freshState(false)
    addWare(n, ORE, 1_000)
    expect(startRefineRun(n, ORE, 'pilot', rctx).ok).toBe(true)
    expect(n.refineRuns[0]!.cycleMs, '普通模式照配方周期').toBeGreaterThan(1000)
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
    setStanding(s, 'dsi', 5)
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

  it('扫描：1 秒完成点亮并当场收尾（2026-09-15 无人扫描艇：无返航段、不牵动位置）', () => {
    const s = freshState(true)
    expect(startScan(s, 'galaxy-far', ctx).ok).toBe(true)
    expect(s.scanning.active).toBe(true)
    advanceGame(s, 1000, ctx) // 窗口 1 秒走完 → 点亮 + 收尾
    expect(s.scanning.active).toBe(false)
    expect(s.scanning.returning).toBe(false)
    expect(isExplored(s, 'galaxy-far')).toBe(true)
    expect(s.awayGalaxy).toBeNull()
    expect(scanAwaitingView(s)).toEqual({ galaxyId: 'galaxy-far' })
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
    expect(loaded.state.version).toBe(CURRENT_STATE_VERSION)
  })

})
