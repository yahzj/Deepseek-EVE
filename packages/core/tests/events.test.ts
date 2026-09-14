/**
 * 随机事件系统（V11）单元测试：间隔语义、确定性、市场大类 A/B 落地、存档迁移。
 */
import { describe, expect, it } from 'vitest'
import { advanceGame } from '../src/engine'
import { fireMarketOrderEvent, fireMarketShockEvent, eventCadenceFactor, exploredRewardMul } from '../src/events'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import type { GameState } from '../src/state'
import type { MarketGoodDef, SimContext } from '../src/types'
import { makeTestCtx } from './helpers'

/** 测试市场目录：一个常驻池矿石 + 一件稀有装备（市场大类 B 需要 rare 商品） */
const POOL_GOOD: MarketGoodDef = {
  key: 'it-ore-a',
  kind: 'item',
  refId: 'ore-a',
  rarity: 'common',
  basePrice: 12,
  poolTarget: 2_000,
  supplyFlow: 20,
}
const RARE_GOOD: MarketGoodDef = {
  key: 'mod-r',
  kind: 'module',
  refId: 'mod-a',
  rarity: 'rare',
  basePrice: 20_000,
  demandMultiplier: 0.65, // 收购档位 rare（2026-09-08 船长定）
}
/**
 * **只收不卖**的限定商品（2026-09-14 船长报障：玩家在限定奇货里看到"种族专属陵卫指挥舰"的 NPC 卖单，
 * 点了却买不了）——`playerBuyable: false` 就是"只收不卖"那批（种族专属舰船/装备/图纸，共 106 行）。
 * 这里用舰船形态（真 refId 在测试目录里不存在也没关系：`goodName` 会回落成 key）。
 */
const EXCLUSIVE_GOOD: MarketGoodDef = {
  key: 'ship-wh-d-exclusive',
  kind: 'ship',
  refId: 'sh-wh-d-destroyer',
  rarity: 'exotic',
  basePrice: 2_600_000,
  demandMultiplier: 0.75,
  playerBuyable: false,
}

function eventCount(state: GameState): number {
  return state.logs.filter((l) => l.text.startsWith('✦')).length
}

function makeWorld(): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed: 2024 })
  const ctx = makeTestCtx({ marketGoods: [POOL_GOOD, RARE_GOOD] })
  return { state, ctx }
}

describe('随机事件系统（V11）', () => {
  it('10 分钟前绝不触发；推进 31 分钟必触发至少一次；同种子两次推进结果一致', () => {
    const { state, ctx } = makeWorld()
    advanceGame(state, 9 * 60_000, ctx) // 9 分钟 < 最小间隔 10 分钟
    expect(eventCount(state)).toBe(0)
    expect(state.events.nextAtGameMs).toBeGreaterThan(state.gameMs) // 未到期

    advanceGame(state, 22 * 60_000, ctx) // 累计 31 分钟 > 最大间隔 30 分钟 → 必触发
    expect(eventCount(state)).toBeGreaterThanOrEqual(1)
    expect(state.events.nextAtGameMs).toBeGreaterThan(state.gameMs) // 已重新播种

    // 确定性：同种子复现完全一致
    const a = makeWorld()
    advanceGame(a.state, 90 * 60_000, a.ctx)
    const b = makeWorld()
    advanceGame(b.state, 90 * 60_000, b.ctx)
    expect(a.state.events.nextAtGameMs).toBe(b.state.events.nextAtGameMs)
    expect(a.state.logs.map((l) => l.text)).toEqual(b.state.logs.map((l) => l.text))
  })

  it('8 小时大离线多次触发：事件数落在 10~30 分钟间隔的理论范围内', () => {
    const { state, ctx } = makeWorld()
    advanceGame(state, 8 * 60 * 60_000, ctx)
    const n = eventCount(state)
    // 间隔 ∈ [10,30] 分钟 → 8h 事件数 ∈ [16, 48]（留余量断言）
    expect(n).toBeGreaterThanOrEqual(12)
    expect(n).toBeLessThanOrEqual(52)
  })

  it('事件现金 · 已探索星系加成（2026-09-10 船长：每星系 +10%，封顶 ×2）', () => {
    const { state, ctx } = makeWorld()
    const ev = ctx.balance.events
    const n0 = state.exploredGalaxies.length // 新档默认已点亮母港等若干星系
    const mul = (n: number): number => Math.min(2, 1 + n * 0.1)
    expect(exploredRewardMul(state, ev)).toBeCloseTo(mul(n0), 6)
    state.exploredGalaxies = Array.from({ length: n0 + 5 }, (_, i) => `g${i}`)
    expect(exploredRewardMul(state, ev)).toBeCloseTo(mul(n0 + 5), 6) // +5 星系 = +50%
    state.exploredGalaxies = Array.from({ length: 50 }, (_, i) => `g${i}`)
    expect(exploredRewardMul(state, ev)).toBe(2) // 封顶 ×2
  })

  it('市场大类 A（行情突变动）能落地：冲击/池库存/大宗单进入簿面', () => {
    // 固定种子跑多轮，确保四个变体都被覆盖到（rng 序列确定，无随机性）
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const { state, ctx } = makeWorld()
      for (let k = 0; k < 40; k++) {
        fireMarketShockEvent(state, ctx)
      }
      const texts = state.logs.map((l) => l.text).join('|')
      if (texts.includes('收购周')) seen.add('acquisitionWeek')
      if (texts.includes('倾销潮')) seen.add('dumping')
      if (texts.includes('短波行情')) seen.add('shortwave')
      if (texts.includes('大宗')) seen.add('bulk')
      // 簿面或冲击至少被触碰
      const pool = state.market.pools['it-ore-a']!
      if (pool.shock !== 0 || pool.q !== 2_000) seen.add('stateChanged')
      expect(state.market.pools['it-ore-a']).toBeDefined()
    }
    expect(seen.has('acquisitionWeek') || seen.has('dumping') || seen.has('shortwave') || seen.has('bulk')).toBe(true)
  })

  it('市场大类 B（奇货）：黑市溢价现货（×1.8~2.0、寿命 8 分钟手慢无）与神秘买家收购都入簿', () => {
    let sells = 0
    let buys = 0
    let sawBlack = false
    for (let i = 0; i < 2; i++) {
      const { state, ctx } = makeWorld()
      for (let k = 0; k < 40; k++) {
        fireMarketOrderEvent(state, ctx)
      }
      const mk = state.market
      for (const o of mk.npcSell['mod-r'] ?? []) {
        // 2026-09-10（船长）：黑市 = 高价应急渠道——开价 ≈行情价 ×1.8~2.0，仅存 8 分钟
        expect(o.expiresAtGameMs - state.gameMs).toBeLessThanOrEqual(8 * 60_000 + 1000)
        expect(o.price).toBeGreaterThanOrEqual(20_000 * 1.5) // ≥基准价 1.5×（宽松防噪声）
        expect(o.qty).toBe(1)
        sells += 1
      }
      for (const o of mk.npcBuy['mod-r'] ?? []) {
        expect(o.expiresAtGameMs - state.gameMs).toBeLessThanOrEqual(9 * 60_000 + 1000) // 神秘买家寿命按稀有度
        buys += 1
      }
      const texts = state.logs.map((l) => l.text).join('|')
      if (texts.includes('黑市商人挂出一件') && texts.includes('溢价现货')) sawBlack = true
    }
    expect(sells + buys).toBeGreaterThan(0)
    expect(sawBlack).toBe(true) // 文案与机制一致：明示溢价
  })

  it('**只收不卖的商品绝不会被刷出卖单**（船长 2026-09-14 转玩家反馈：种族专属陵卫指挥舰出现买不了的 NPC 卖单）', () => {
    /**
     * 根因（已查实）：`rareGoods`（市场奇货的抽选池）只挡了 AI 核心与常驻档，**没挡 `playerBuyable: false`**，
     * 而变体 0「黑市溢价现货」直接往 `npcSell` 里 push ⇒ 会给种族专属舰船/装备/图纸**强刷一件买不了的现货**
     * （点买入被 `market.buyGood` 挡回「该商品只收不卖，市场不出售现货」——正是玩家看到的那一幕）。
     */
    const state = createInitialState({ nowWallMs: 0, seed: 77 })
    const ctx = makeTestCtx({ marketGoods: [POOL_GOOD, RARE_GOOD, EXCLUSIVE_GOOD] })
    for (let k = 0; k < 200; k++) fireMarketOrderEvent(state, ctx)
    // ① 一条卖单都不许有（改前这颗种子会强刷出"黑市溢价现货"）
    expect(state.market.npcSell[EXCLUSIVE_GOOD.key] ?? []).toHaveLength(0)
    // ② 「只收」那一半照旧：撞上它时降级成「神秘买家」求购（合法销路，专属货照样能出手）
    expect((state.market.npcBuy[EXCLUSIVE_GOOD.key] ?? []).length).toBeGreaterThan(0)
    // ③ 机制没被削弱：普通稀有件照旧出黑市现货
    expect((state.market.npcSell[RARE_GOOD.key] ?? []).length).toBeGreaterThan(0)
  })

  it('v10 档迁移到 v11：events 默认播种为 0，往返保留 nextAtGameMs', () => {
    const { state, ctx } = makeWorld()
    advanceGame(state, 5 * 60_000, ctx) // 让 nextAt 有真实值
    expect(state.events.nextAtGameMs).toBeGreaterThan(0)

    const raw = JSON.parse(serializeSaveFile(state))
    raw.state.version = 10
    delete raw.state.events // 模拟 v10 档（无 events 字段）
    raw.version = 10
    const loaded = loadSaveFile(JSON.stringify(raw))
    expect(loaded.state.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.state.events.nextAtGameMs).toBe(0) // 迁移补默认

    // 往返保留
    const round = loadSaveFile(serializeSaveFile(loaded.state))
    expect(round.state.events.nextAtGameMs).toBe(0)
    expect(round.state.version).toBe(CURRENT_STATE_VERSION)
  })

  /**
   * **随机事件的日志类型 = `event`**（2026-09-14 船长：「突发事件的事件日志内不够显眼」
   * ⇒ 从 `info` 独立出来，日志面板给琥珀橙醒目行 + 单独筛选档）。
   *
   * 两件事一起钉住：① 事件行的 `kind` 必须是 `event`（前缀 `✦` 照旧保留——桌面小弹卡与手册口径都认它）；
   * ② **存档白名单**（`save.ts` 的 `LOG_KINDS`）必须收 `event`，否则读档会把事件行**降级成 info**。
   */
  it('**日志类型 = event**：事件行按类型认（不再是 info），存档往返不降级', () => {
    const { state, ctx } = makeWorld()
    advanceGame(state, 31 * 60_000, ctx)
    const evs = state.logs.filter((l) => l.kind === 'event')
    expect(evs.length, '推进 31 分钟至少出一次事件').toBeGreaterThan(0)
    expect(evs.every((l) => l.text.startsWith('✦'))).toBe(true) // 前缀保留
    expect(state.logs.some((l) => l.kind === 'info' && l.text.startsWith('✦'))).toBe(false) // 不再混在 info 里
    const back = loadSaveFile(serializeSaveFile(state))
    expect(back.state.logs.filter((l) => l.kind === 'event').length).toBe(evs.length) // 白名单缺它就会变 0
  })

})

describe('星际奇遇学改版（2026-09-08 船长定：事件间隔每级 −8%，遇袭期望不变补偿）', () => {
  it('满级间隔因子 = 0.6；无技能 = 1', () => {
    const { state } = makeWorld()
    expect(eventCadenceFactor(state)).toBe(1)
    state.skills.trained['galactic-happenings'] = 5
    expect(eventCadenceFactor(state)).toBeCloseTo(0.6, 10)
  })

  it('同种子下满级首档间隔 ≈ 无技能 ×0.6（同一随机数、仅间隔缩放）', () => {
    const a = makeWorld()
    const b = makeWorld()
    b.state.skills.trained['galactic-happenings'] = 5
    advanceGame(a.state, 60_000, a.ctx)
    advanceGame(b.state, 60_000, b.ctx)
    const g0 = a.state.events.nextAtGameMs
    const g5 = b.state.events.nextAtGameMs
    expect(g0).toBeGreaterThan(0)
    expect(Math.abs(g5 - g0 * 0.6)).toBeLessThanOrEqual(1.5) // 各自 round 一次，容差 ±1.5ms
  })
})
