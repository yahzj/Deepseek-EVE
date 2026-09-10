/**
 * 重复清剿停环提示（2026-09-10 船长定）：
 * - 停环文案带当前 装甲/结构 百分比（便于玩家判断停在哪一层）；
 * - 同时写入一次性提示 autoLoopStopNotice（引擎写入 → 心跳读取即清并弹窗；日志之外告知玩家）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { setAutoLoopBounty, advanceAutoLoopBounty } from '../src/expedition'
import { anomaly, makeTestCtx } from './helpers'

describe('重复清剿停环提示（2026-09-10）', () => {
  it('耐久不足且无组件：停环文案带 装甲/结构 数字，并写入一次性提示', () => {
    const ctx = makeTestCtx({ anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 10 })] })
    const state = createInitialState({ nowWallMs: 0, seed: 2026 })
    const ship = state.fleet[state.shipId]!
    ship.durability = 0.3
    ship.armorPct = 0.2 // 装甲 20% / 结构 30%：都低于 50% 门槛且货仓无组件
    setAutoLoopBounty(state, ctx, 'ano-x')
    expect(state.autoLoopAnomalyId).toBe('ano-x')

    const reason = advanceAutoLoopBounty(state, ctx)
    expect(reason).not.toBeNull()
    expect(state.autoLoopAnomalyId).toBeNull() // 停环（清开关）
    const text = state.autoLoopStopNotice ?? ''
    expect(text).toContain('重复清剿已暂停')
    expect(text).toContain('装甲 20%')
    expect(text).toContain('结构 30%')
    // 日志同文案（玩家回看事件日志也带数字）
    expect(state.logs.some((l) => l.kind === 'warn' && l.text === text)).toBe(true)
  })

  it('未停环时（作业中/正常继续）不写入提示', () => {
    const ctx = makeTestCtx({ anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 10 })] })
    const state = createInitialState({ nowWallMs: 0, seed: 2027 })
    setAutoLoopBounty(state, ctx, 'ano-x')
    // 首次调用即出发（条件满足）→ 无停环提示
    const reason = advanceAutoLoopBounty(state, ctx)
    expect(reason).toBeNull()
    expect(state.autoLoopStopNotice).toBeUndefined()
  })
})
