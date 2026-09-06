/**
 * T1 顶部活动窗口支持测试：
 * 统一停止指令（取消制造/召回远征/边界）+ activityOverview 视图（含空态与各活动条目）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame, enqueueSkill } from '../src/engine'
import { activityOverview } from '../src/activity'
import { cancelManufacturing, startManufacturing } from '../src/manufacturing'
import { recallExpedition, startExpedition } from '../src/expedition'
import { startMining } from '../src/mining'
import { startScan } from '../src/explore'
import { makeTestCtx, skill } from './helpers'

describe('T1 统一停止指令', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 5_000_000
    ctx = makeTestCtx({ skills: [skill('nav-x')] })
  })

  it('取消制造：材料全额退回仓库、制造费不退、作业结束', () => {
    state.learnedRecipes.push('bp-a')
    state.warehouse.items['min-a'] = 50
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).ok).toBe(true)
    const walletBefore = state.wallet.isk
    advanceGame(state, 3_000, ctx)
    const runId = state.manufacturingRuns[0]!.id
    expect(cancelManufacturing(state, ctx, runId).ok).toBe(true)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(state.warehouse.items['min-a']).toBe(50) // 材料全退
    expect(state.wallet.isk).toBe(walletBefore) // 制造费不退（取消不补回）
    expect(state.logs.some((l) => l.text.includes('已取消制造'))).toBe(true)
    // 空态：无作业再取消 → 拒绝
    expect(cancelManufacturing(state, ctx, runId).ok).toBe(false)
  })

  it('召回远征：去程已取消 → 出发即交火不可召回；返航（back）可召回（无战果回港）', () => {
    state.standings['dsi'] = 5
    state.exploredGalaxies.push('galaxy-far')
    // 去程取消：下达即开战，交火中拒绝召回
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true) // hub 目标即时开战
    expect(state.expedition.phase).toBe('battle')
    const r = recallExpedition(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('交火中')
    expect(state.logs.some((l) => l.text.includes('已召回'))).toBe(false)
    // 返航中（去程并入返航的 back 相位）仍可召回
    const s2 = createInitialState({ nowWallMs: 0, seed: 42 })
    s2.standings['dsi'] = 5
    s2.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(s2, 'ano-hard', ctx).ok).toBe(true) // far 目标即时开战
    s2.expedition.phase = 'back' // 手工转返航（供召回语义验证）
    s2.expedition.battle = null
    s2.expedition.finishAtGameMs = s2.gameMs + 240_000
    expect(recallExpedition(s2, ctx).ok).toBe(true)
    expect(s2.expedition.active).toBe(false)
    expect(s2.logs.some((l) => l.text.includes('已召回'))).toBe(true)
  })
})

describe('T1 activityOverview 视图', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.wallet.isk = 5_000_000
    ctx = makeTestCtx({ skills: [skill('nav-y')] })
  })

  it('空态返回 []', () => {
    expect(activityOverview(state, ctx)).toEqual([])
  })

  it('训练/采矿/扫描/制造 各出一卡（字段齐全）', () => {
    enqueueSkill(state, 'nav-y', 1, ctx.skills)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    // 扫描与采矿互斥（引擎校验），此处仅构造视图态验证展示
    state.scanning = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 60_000, startedAtGameMs: state.gameMs, originGalaxy: null }
    state.learnedRecipes.push('bp-a')
    state.warehouse.items['min-a'] = 20
    // 制造与采矿/扫描并行允许（2026-09-08：制造带劳动者——主控手动与出海互斥，故用 AI 核心驱动来并行）
    state.aiCores['basic'] = 1
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    const acts = activityOverview(state, ctx)
    const kinds = acts.map((a) => a.kind).sort()
    expect(kinds).toContain('train')
    expect(kinds).toContain('mining')
    expect(kinds).toContain('scan')
    expect(kinds).toContain('manufacture')
    const train = acts.find((a) => a.kind === 'train')!
    expect(train.stopable).toBe(true)
    expect(train.stop).toBe('remove-training')
    expect(train.percent).toBeGreaterThanOrEqual(0)
    const mining = acts.find((a) => a.kind === 'mining')!
    expect(mining.stop).toBe('stop-mining')
    const scan = acts.find((a) => a.kind === 'scan')!
    expect(scan.stop).toBe('stop-scan')
    expect(scan.remainingMs).toBeGreaterThan(0)
    const mf = acts.find((a) => a.kind === 'manufacture')!
    expect(mf.stop).toBe('cancel-manufacture')
  })

  it('远征出卡：交火中可撤退；返航（back）可召回；AI 采矿任务出卡且带 stopParam', () => {
    state.standings['dsi'] = 5
    state.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    // 去程取消：下达即交火 → 活动卡停止动作 = 撤退
    let acts = activityOverview(state, ctx)
    let exp = acts.find((a) => a.kind === 'expedition')!
    expect(exp.stopable).toBe(true)
    expect(exp.stop).toBe('retreat-battle')
    // 手工转返航（back，去程并入返航中）→ 可召回
    state.expedition.phase = 'back'
    state.expedition.battle = null
    state.expedition.finishAtGameMs = state.gameMs + 240_000
    // 手工挂一条 AI 采矿任务（用初始武装艇 sh-falconet）
    state.aiAssignments['sh-falconet'] = {
      coreType: 'basic',
      startedAtGameMs: state.gameMs,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    acts = activityOverview(state, ctx)
    exp = acts.find((a) => a.kind === 'expedition')!
    expect(exp.stopable).toBe(true)
    expect(exp.stop).toBe('recall-expedition')
    const ai = acts.find((a) => a.kind === 'ai')!
    expect(ai.id).toBe('ai-sh-falconet')
    expect(ai.stop).toBe('cancel-ai')
    expect(ai.stopParam).toBe('sh-falconet')
  })
})
