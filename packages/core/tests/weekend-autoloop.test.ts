/**
 * **入侵「重复出击」**（⟪**2026-09-25 船长令**⟫：「**入侵活动的悬赏，允许玩家开启自动重复，照常计算返回时间。**」）
 *
 * 本文件钉四件事（口径见 `src/expedition.ts` 那段注释）：
 * (a) **开关与落档**：目标存 `weekendEvent.autoLoopGalaxyId`；与常驻悬赏的「重复清剿」**互斥**；
 *     非占领区 / 活动已结束 ⇒ 拒绝开启；
 * (b) **再出发走手动出击那条路**：`foeGalaxyId` = 被占星系（⇒ 去程/返航按目标星系照常计算）、
 *     **每场重抽**（`assaultDraws` 递增）、赏金按入侵口径为 0；
 * (c) **停止口径**：该星系被夺回 / 活动结束 ⇒ 自动停并清掉目标；
 * (d) **等待表同源**：别的作业（采矿）占着主控时只等、不出发。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceAutoLoopInvasion, autoLoopInvasionGalaxy, setAutoLoopInvasion, setAutoLoopBounty } from '../src/expedition'
import { weekendFoePoolOf } from '../src/weekendEvent'
import { weekendBattleInvolvedOf } from '../src/weekendBattle'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
/** 循环目标固定用**外围**星系：核心的进度还受"至少夺回一个外围"的门禁管，构造夺回态更绕 */
const TARGET = 'galaxy-home'
const CORE = 'galaxy-kor'

/**
 * 建场（照 `weekend-battle.test.ts` 的写法，**两处必须与它不同**）：
 * - `startedAtWallMs` = **现在**：NPC 铺底按"开赛至今的小时数"涨 ⇒ 若像那边一样写 0，铺底早就把
 *   进度顶到 100%，星系就不算"仍被占"了（第一版用例正是这么挂的）；
 * - `debugQuick = false`：1 秒化会把铺底压缩成几秒，同样会瞬间顶满。
 */
function setup(family = 'A'): { s: ReturnType<typeof createInitialState>; ev: WeekendEventState } {
  const now = Date.now()
  const s = createInitialState({ nowWallMs: now, seed: 7 })
  s.debugQuick = false
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: now,
    coreId: CORE,
    peripheryIds: [TARGET],
    family,
    contributed: {},
  }
  s.weekendEvent = ev
  return { s, ev }
}

describe('入侵重复出击 · 开关与互斥', () => {
  it('开启后目标落档在 weekendEvent.autoLoopGalaxyId；关闭即清', () => {
    const { s, ev } = setup()
    expect(autoLoopInvasionGalaxy(s)).toBeNull()
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    expect(autoLoopInvasionGalaxy(s)).toBe(TARGET)
    expect(setAutoLoopInvasion(s, ctx, null).ok).toBe(true)
    expect(autoLoopInvasionGalaxy(s)).toBeNull()
  })

  it('与常驻悬赏的重复清剿互斥（开一边顶掉另一边）', () => {
    const { s, ev } = setup()
    const card = [...ctx.anomalies.values()].find((a) => a.hidden !== true)!
    expect(setAutoLoopBounty(s, ctx, card.id).ok).toBe(true)
    expect(s.autoLoopAnomalyId).toBe(card.id)
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    expect(s.autoLoopAnomalyId, '开入侵环要顶掉常驻那条').toBeNull()
    expect(autoLoopInvasionGalaxy(s)).toBe(TARGET)
  })

  it('非占领区 / 活动已结束 ⇒ 拒绝开启', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, 'galaxy-hub').ok, '不在占领集合里').toBe(false)
    ev.endedAtWallMs = 1
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok, '活动已结束').toBe(false)
    expect(autoLoopInvasionGalaxy(s)).toBeNull()
  })
})

describe('入侵重复出击 · 再出发', () => {
  it('出发走手动出击那条路：foeGalaxyId = 被占星系（照常算往返）、每场重抽、赏金 0', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    const drawsBefore = ev.assaultDraws ?? 0
    expect(advanceAutoLoopInvasion(s, ctx), '首次推进应当能出发').toBeNull()
    expect(s.expedition.active, '应当有一场远征在跑').toBe(true)
    expect(s.expedition.foeGalaxyId, '目标星系 = 被占星系（不是卡自带母港）').toBe(TARGET)
    /**
     * **赏金 0 是靠"这一场算入侵场次"在结算处收口的**（weekendBattleInvolvedOf ⇒ 结算走 0 分支），
     * 不是靠这里的 override（ewardIskOverride 是"原卡 ×1.4"的退役基底，手动出击也照传）。
     */
    expect(weekendBattleInvolvedOf(s, ctx, s.expedition.anomalyId, Date.now()), '这一场算入侵场次 ⇒ 结算不发赏金').toBeDefined()
    expect(ev.assaultDraws ?? 0, '抽过才计数 ⇒ 下一场换一支').toBe(drawsBefore + 1)
    const firstCard = s.expedition.anomalyId
    /**
     * 让这一场**整场结束**（只把 ctive 置 false 不够：活动闸门看的是"主控是不是在打仗"，
     * 直接改 active 会得到「战斗中：这一场打完才能切换主控活动」）。这里按空闲态清干净。
     */
    s.expedition.active = false
    s.expedition.battle = null
    expect(advanceAutoLoopInvasion(s, ctx)).toBeNull()
    expect(ev.assaultDraws ?? 0, '第二场也要抽（每场一支）').toBe(drawsBefore + 2)
    // 「每场重抽」= 抽签盐随场次前进、抽到的卡来自该区域池（两次同卡在概率上允许，故不断言"必不同"）
    expect(weekendFoePoolOf('A', false)).toContain(s.expedition.anomalyId)
    expect(s.expedition.anomalyId, '两场都是真卡（不是占位 id）').toBeTruthy()
    void firstCard
  })

  it('别的作业占着主控（采矿）⇒ 只等、不出发', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    s.mining.active = true
    expect(advanceAutoLoopInvasion(s, ctx)).toBeNull()
    expect(s.expedition.active, '等待期间不该出发').toBe(false)
    expect(autoLoopInvasionGalaxy(s), '也不该被停').toBe(TARGET)
  })
})

describe('入侵重复出击 · 停止口径', () => {
  it('该星系被夺回 ⇒ 自动停并清目标', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    ev.contributed[TARGET] = 1 // 进度拉满 = 已夺回（`weekendProgressAt` = clamp01(npc + contributed)）
    expect(advanceAutoLoopInvasion(s, ctx)).toBe('该星系已被夺回')
    expect(autoLoopInvasionGalaxy(s)).toBeNull()
    expect(s.autoLoopStopNotice ?? '').toContain('重复出击已暂停')
  })

  it('活动结束 ⇒ 自动停并清目标', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, TARGET).ok).toBe(true)
    ev.endedAtWallMs = Date.now()
    expect(advanceAutoLoopInvasion(s, ctx)).toBe('入侵活动已结束')
    expect(autoLoopInvasionGalaxy(s)).toBeNull()
  })
})
