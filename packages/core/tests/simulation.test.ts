/**
 * 离线结算与时间格式化的单元测试（M1：含离线采矿摘要）。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { enqueueSkill } from '../src/engine'
import { countItem } from '../src/inventory'
import { setMiningAutoCycle, startMining } from '../src/mining'
import { ensureMarket } from '../src/market'
import {
  DEFAULT_OFFLINE_CAP_MS,
  formatDurationMs,
  offlineSplit,
  simulateOffline,
} from '../src/simulation'
import { formatDurationShort } from '../src/time'
import { FIRST_TASKS } from '../src/firstTasks'
import { TASK_FIND_HUMANS } from '../src/onboarding'
import { clearInitialStanding, makeTestCtx, ore, ship, skill } from './helpers'

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
    /**
     * ⚠ 先清掉"开局那一拍就会判过「第一次扫描」"的噪声（母港本就已点亮）：
     * 2026-09-20 起它带奖励（采集器 MK1）⇒ 离线窗口里会多一条奖励日志，而本用例的
     * "事件条数 = 新增日志 − 1"（`simulation.ts` 的粗口径）就会数出 1 而不是 0。
     * 本用例只钉"无事件时计数为 0 而不是 -1"这条回归 ⇒ 把 13 条「第一次」标记为已完成、
     * 贯穿任务标记为已发布（否则闸门也会补一条发布日志）。
     * ⚠ **2026-09-26 再补一处**：新档初始声望 = 40 ⇒ 真实数据里那封"虫洞扫描阵列已就绪"
     * 通讯（触发 = 声望 ≥ 40）会在离线窗口内送达并各写一条日志 ⇒ 同样要先清零。
     */
    clearInitialStanding(state)
    for (const def of FIRST_TASKS) state.importantTasks[def.id] = { done: true }
    state.importantTasks[TASK_FIND_HUMANS] = { done: false }
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

  /**
   * **离线静默模式**（船长 2026-09-21 裁定「乙案」，原话照抄：
   * 「**乙，甚至行情相关文本都不要给。就正常的离线总结。**」）。
   *
   * 为什么必须有用例守：离线是**一次性大推进**，而 `advanceEvents` 会把整段离线里到点的
   * 随机事件**全部补发**（`guard < 200`）⇒ 上线瞬间 ① 事件日志被逐条刷屏、
   * ② 订单事件的 `expiresAtGameMs` 锚在"触发那一刻"（离线时已跳到结算终点）⇒ 一批订单同生同灭、
   * ③ `pools[key].shock/q` 被线性叠加。
   * 本用例钉四件事：**事件确实发生了**（节奏未停）· **日志里没有 event 条** ·
   * **没有凭空多出订单** · **行情池没被改**。
   */
  it('离线期间随机事件静默：只留汇总，不刷日志、不建单、不动行情池', () => {
    const state = createInitialState({ nowWallMs: 1_000, seed: 7 })
    const ctx = makeTestCtx({ quietEvents: false }) // 显式**开启**事件流（默认测试上下文是关掉的）
    ensureMarket(state, ctx)
    const logCountBefore = state.logs.length

    // 离线 8 小时 ⇒ 事件节奏（10~30 分钟级）必然到点多次
    simulateOffline(state, 1_000, 1_000 + 8 * 3_600_000, ctx)

    const summary = state.logs.find((l) => l.text.includes('离线结算完成'))
    expect(summary).toBeDefined()
    const n = Number(/期间发生 (\d+) 条事件/.exec(summary!.text)?.[1] ?? '0')
    expect(n).toBeGreaterThan(0) // 事件**照旧发生**（只是静默）

    /**
     * ⚠ **不要断言"订单簿不变"**（第一版就这么写，实测红了）：市场有自己的
     * `advanceMarket` 窗口推进（补单/过期/池回归），离线 8 小时必然改变订单簿 ——
     * 那是**市场系统**的正常行为，不是随机事件造成的。
     * 所以这里只钉"**没有事件文本**"这一条（事件类日志一定以 `✦` 开头、kind 为 `event`，
     * 见 `events.logEvent`），它同时覆盖了"行情文本一条都不给"这条船长口径。
     */
    const newEventLogs = state.logs
      .slice(logCountBefore)
      .filter((l) => l.kind === 'event' || l.text.startsWith('✦'))
    expect(newEventLogs).toHaveLength(0)
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

  /**
   * **紧凑时长**（2026-09-16 船长：活动栏徽标「虫洞大量生成6个字显示不完全。建议宽度要保证标题文字
   * 都能显示」）——只保留**两级最大单位**：徽标窄格用它，全量格式仍走 `formatDurationMs`。
   */
  it('紧凑时长只保留两级最大单位（活动栏徽标用）', () => {
    expect(formatDurationShort(0)).toBe('0秒')
    expect(formatDurationShort(45_000)).toBe('45秒')
    expect(formatDurationShort(61_000)).toBe('1分1秒')
    expect(formatDurationShort(3_721_000)).toBe('1小时2分')
    expect(formatDurationShort(90_061_000)).toBe('1天1小时')
    // 4 天档（本活动的最长剩余）：全量格式 10 个汉字 ⇒ 徽标会截字，紧凑格式 7 个 ⇒ 放得下
    const fourDays = 4 * 86_400_000 + 21 * 3_600_000 + 5 * 60_000 + 3_000
    expect(formatDurationMs(fourDays)).toBe('4天21小时5分3秒')
    expect(formatDurationShort(fourDays)).toBe('4天21小时')
    // 中间单位缺位时按"前两级非零单位"接续（1天0小时3分 ⇒ 1天3分）
    expect(formatDurationShort(86_400_000 + 180_000)).toBe('1天3分')
    expect(formatDurationShort(-100)).toBe('0秒')
  })
})
