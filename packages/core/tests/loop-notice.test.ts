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
    // ⚠ 2026-09-18 起"耐久低于 50%"是**再开前置**（`autoLoopReopenBlockReason`）⇒ 不能拿低耐久开局：
    //   先以健康状态开环，再把耐久打到线下——本用例验的是**停环侧**的口径（不变）。
    setAutoLoopBounty(state, ctx, 'ano-x')
    expect(state.autoLoopAnomalyId).toBe('ano-x')
    ship.durability = 0.3
    ship.armorPct = 0.2 // 装甲 20% / 结构 30%：都低于 50% 门槛且货仓无组件

    const reason = advanceAutoLoopBounty(state, ctx)
    expect(reason).not.toBeNull()
    expect(state.autoLoopAnomalyId).toBeNull() // 停环（清开关）
    const text = state.autoLoopStopNotice ?? ''
    expect(text).toContain('重复清剿已暂停')
    expect(text).toContain('装甲 20%')
    expect(text).toContain('结构 30%')
    // 日志同文案（玩家回看事件日志也带数字）
    expect(state.logs.some((l) => l.kind === 'combat' && l.text === text)).toBe(true)
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

/**
 * **再开重复清剿的前置**（船长 2026-09-18：「战损/耐久未恢复则先挡住」）：
 * ① 装甲或结构 < 50% ⇒ 拒；② 机群战损停环后未补货 ⇒ 拒。**关闭一律放行**。
 */
describe('重复清剿 · 再开前置（2026-09-18）', () => {
  const ctxOf = (): ReturnType<typeof makeTestCtx> =>
    makeTestCtx({ anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 10 })] })

  it('装甲或结构低于 50%：开环被拒（文案点明门槛），修好后放行', () => {
    const ctx = ctxOf()
    const state = createInitialState({ nowWallMs: 0, seed: 2031 })
    const ship = state.fleet[state.shipId]!
    ship.armorPct = 0.4
    const bad = setAutoLoopBounty(state, ctx, 'ano-x')
    expect(bad.ok, '耐久未恢复不许开环').toBe(false)
    expect(bad.error ?? '').toContain('50%')
    expect(state.autoLoopAnomalyId).toBeNull()
    // 修回线下以上 ⇒ 放行
    ship.armorPct = 1
    expect(setAutoLoopBounty(state, ctx, 'ano-x').ok).toBe(true)
    expect(state.autoLoopAnomalyId).toBe('ano-x')
  })

  it('机群战损停环后：未补货 ⇒ 再开被拒；补到超过停环时架数 ⇒ 放行', () => {
    const ctx = ctxOf()
    const state = createInitialState({ nowWallMs: 0, seed: 2032 })
    const ship = state.fleet[state.shipId]!
    // 模拟"机群战损过半"停环留下的记账：停环时还剩 1 架
    state.autoLoopDroneFloor = 1
    ship.droneLoad = { 'drone-scout': 1 }
    const still = setAutoLoopBounty(state, ctx, 'ano-x')
    expect(still.ok, '一架没补不许再开').toBe(false)
    expect(still.error ?? '').toContain('机群尚未补充')
    // 补到 3 架（> 停环时的 1）⇒ 放行，且开环后清掉记账
    ship.droneLoad = { 'drone-scout': 3 }
    expect(setAutoLoopBounty(state, ctx, 'ano-x').ok).toBe(true)
    expect(state.autoLoopDroneFloor, '开环即清记账').toBeNull()
  })

  it('关闭一律放行：耐久低 + 机群未补也停得掉；停环会清掉机群记账', () => {
    const ctx = ctxOf()
    const state = createInitialState({ nowWallMs: 0, seed: 2033 })
    const ship = state.fleet[state.shipId]!
    ship.armorPct = 0.2
    state.autoLoopDroneFloor = 5
    state.autoLoopAnomalyId = 'ano-x'
    expect(setAutoLoopBounty(state, ctx, null).ok, '关环不受前置限制').toBe(true)
    expect(state.autoLoopAnomalyId).toBeNull()
    expect(state.autoLoopDroneFloor).toBeNull()
  })

  it('非战损停环不套机群那条：只有"战损过半"那一路才记账', () => {
    const ctx = ctxOf()
    const state = createInitialState({ nowWallMs: 0, seed: 2034 })
    const ship = state.fleet[state.shipId]!
    // 耐久线下 + 无装置/无组件 ⇒ 走"耐久不足"停环（不传 droneFloor）
    setAutoLoopBounty(state, ctx, 'ano-x')
    ship.durability = 0.2
    ship.armorPct = 0.2
    expect(advanceAutoLoopBounty(state, ctx)).not.toBeNull()
    expect(state.autoLoopAnomalyId).toBeNull()
    expect(state.autoLoopDroneFloor, '非战损停环 ⇒ 记账为 null').toBeNull()
    // ⇒ 该情形下补耐久即可再开（机群那条不生效）
    ship.durability = 1
    ship.armorPct = 1
    expect(setAutoLoopBounty(state, ctx, 'ano-x').ok).toBe(true)
  })
})
