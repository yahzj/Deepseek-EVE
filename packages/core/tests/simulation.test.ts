/**
 * 离线结算与时间格式化的单元测试（M1：含离线采矿摘要）。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { enqueueSkill } from '../src/engine'
import { countItem } from '../src/inventory'
import { setMiningAutoCycle, startMining } from '../src/mining'
import {
  DEFAULT_OFFLINE_CAP_MS,
  formatDurationMs,
  offlineSplit,
  simulateOffline,
} from '../src/simulation'
import { makeTestCtx, ore, ship, skill } from './helpers'

describe('离线切分', () => {
  it('离开 10 小时，按默认上限 8 小时结算，超出的 2 小时被放弃', () => {
    const tenHours = 10 * 60 * 60 * 1000
    const split = offlineSplit(tenHours)
    expect(split.deltaMs).toBe(DEFAULT_OFFLINE_CAP_MS)
    expect(split.overflowMs).toBe(2 * 60 * 60 * 1000)
  })

  it('没离开 / 时钟回拨 → 结算为 0', () => {
    expect(offlineSplit(0).deltaMs).toBe(0)
    expect(offlineSplit(-5000)).toEqual({ deltaMs: 0, overflowMs: 0 })
  })
})

describe('离线结算：技能训练', () => {
  it('离开 10 小时：练完 60 秒技能，游戏时间只推进 8 小时', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    const ctx: SimContext = makeTestCtx({ skills: [skill('a')] })
    enqueueSkill(state, 'a', 1, ctx.skills)

    simulateOffline(state, 1_000, 1_000 + 10 * 60 * 60 * 1000, ctx)

    expect(state.skills.trained['a']).toBe(1)
    expect(state.skills.queue).toHaveLength(0)
    expect(state.gameMs).toBe(DEFAULT_OFFLINE_CAP_MS)
    expect(state.logs.some((l) => l.text.includes('离线归来'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('离线结算完成'))).toBe(true)
  })

  it('超出上限的需求不会被结算：训练需 100 小时，离线 10 小时只推进 8 小时进度', () => {
    const longDef = skill('long', 1)
    const longCtx = makeTestCtx({
      skills: [{ ...longDef, baseMs: 100 * 60 * 60 * 1000 }], // 一级就要 100 小时
    })
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    enqueueSkill(state, 'long', 1, longCtx.skills)

    simulateOffline(state, 1_000, 1_000 + 10 * 60 * 60 * 1000, longCtx)

    expect(state.skills.trained['long']).toBeUndefined()
    expect(state.skills.queue).toHaveLength(1)
    expect(state.skills.queue[0]!.progressMs).toBe(DEFAULT_OFFLINE_CAP_MS)
    expect(state.logs.some((l) => l.text.includes('未结算'))).toBe(true)
  })
})

describe('离线结算：采矿产出与摘要', () => {
  /** 关闭富矿脉以获得确定性的循环时序。本地带（去程已取消并入返航，定稿）：指令即采掘 12s/循环 10 单位。
   *  80 循环采满 800 → 第 81 循环节拍（972s）触发返航；返航腿 = 满载 120s + 空船去程 60s = 180s。 */
  const calmCtx = (): SimContext => {
    const bal = makeTestCtx().balance
    return makeTestCtx({ balance: { ...bal, richVeinChance: 0 } })
  }

  it('离线 20 分钟：完成一趟自动卸货，已回矿带恢复采掘', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    const ctx = calmCtx()
    startMining(state, 'belt-a', ctx)

    // 时间线：0s 立即采掘 → 972s 满舱转返航 → 1152s 满载到港卸货（800 入仓库）→ 回带再采掘
    // 到 1200s 时已采 4 循环（40 单位，仍在船上）
    simulateOffline(state, 1_000, 1_000 + 1_200_000, ctx)

    expect(state.warehouse.items['ore-a']).toBe(800) // 第一趟已卸入仓库
    expect(countItem(state, 'ore-a')).toBe(40) // 卸货后回带又采了 4 循环
    expect(state.mining.active).toBe(true)
    expect(state.mining.phase).toBe('mining')
    expect(state.gameMs).toBe(1_200_000)
    const summary = state.logs.find((l) => l.text.includes('离线结算完成'))
    expect(summary).toBeDefined()
    expect(summary!.text).toContain('离线采集')
    expect(summary!.text).toContain('矿甲×840')
  })

  it('离线 40 分钟：完成两趟自动卸货并开始第三趟采掘，货仓+仓库合计入账', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    const ctx = calmCtx()
    startMining(state, 'belt-a', ctx)

    // 0s 采掘 → 972s 满舱 → 1152s 卸货（第一趟）→ 2124s 满舱 → 2304s 卸货（第二趟）
    // → 回到矿带采掘至 2400s = 96s（8 循环 = 80 单位，仍在船上）
    simulateOffline(state, 1_000, 1_000 + 2_400_000, ctx)

    expect(state.warehouse.items['ore-a']).toBe(1_600) // 前两趟已卸入仓库
    expect(countItem(state, 'ore-a')).toBe(80) // 第三趟采掘中
    expect(state.mining.active).toBe(true)
    expect(state.mining.phase).toBe('mining')
    const summary = state.logs.find((l) => l.text.includes('离线结算完成'))
    expect(summary!.text).toContain('离线采集')
    expect(summary!.text).toContain('矿甲×1680')
  })

  it('离线关闭自动循环（玩家设定）时仍遵守：满舱即停', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    const ctx = calmCtx()
    setMiningAutoCycle(state, false)
    startMining(state, 'belt-a', ctx)
    simulateOffline(state, 1_000, 1_000 + 1_200_000, ctx)
    expect(state.mining.active).toBe(false)
    expect(countItem(state, 'ore-a')).toBe(800)
  })

  it('没在开采时离线：不产生采集摘要，事件计数不为负', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 1 })
    const ctx = makeTestCtx()
    simulateOffline(state, 1_000, 1_000 + 600_000, ctx)
    const summary = state.logs.find((l) => l.text.includes('离线结算完成'))
    expect(summary!.text).not.toContain('离线采集')
    expect(summary!.text).toContain('0 条事件') // 回归保护：无事件时计数为 0 而不是 -1
  })

  it('时钟回拨（现在时间早于存档时间）→ 不结算、不报错', () => {
    const state = createInitialState({ nowWallMs: 5_000, seed: 1 })
    simulateOffline(state, 5_000, 3_000, makeTestCtx())
    expect(state.gameMs).toBe(0)
  })
})

describe('中文时长格式化', () => {
  it('各档位输出符合预期', () => {
    expect(formatDurationMs(0)).toBe('0秒')
    expect(formatDurationMs(59_000)).toBe('59秒')
    expect(formatDurationMs(61_000)).toBe('1分1秒')
    expect(formatDurationMs(3_721_000)).toBe('1小时2分1秒')
    expect(formatDurationMs(90_061_000)).toBe('1天1小时1分1秒')
  })

  it('负值安全处理为 0 秒', () => {
    expect(formatDurationMs(-100)).toBe('0秒')
  })
})
