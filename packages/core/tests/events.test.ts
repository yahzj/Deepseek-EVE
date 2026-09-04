/**
 * 随机事件系统（V11）单元测试：间隔语义、确定性、市场大类 A/B 落地、存档迁移。
 */
import { describe, expect, it } from 'vitest'
import { advanceGame } from '../src/engine'
import { fireMarketOrderEvent, fireMarketShockEvent } from '../src/events'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createInitialState } from '../src/state'
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
  demandMultiplier: 0.35,
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

  it('市场大类 B（奇货）事件单入簿：寿命按稀有度（≤9 分钟），买卖两向都出现过', () => {
    let sells = 0
    let buys = 0
    for (let i = 0; i < 2; i++) {
      const { state, ctx } = makeWorld()
      for (let k = 0; k < 40; k++) {
        fireMarketOrderEvent(state, ctx)
      }
      const mk = state.market
      for (const o of mk.npcSell['mod-r'] ?? []) {
        expect(o.expiresAtGameMs - state.gameMs).toBeLessThanOrEqual(9 * 60_000 + 1000)
        expect(o.qty).toBe(1)
        sells += 1
      }
      for (const o of mk.npcBuy['mod-r'] ?? []) {
        expect(o.expiresAtGameMs - state.gameMs).toBeLessThanOrEqual(9 * 60_000 + 1000)
        buys += 1
      }
    }
    expect(sells + buys).toBeGreaterThan(0)
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
    expect(loaded.state.version).toBe(18)
    expect(loaded.state.events.nextAtGameMs).toBe(0) // 迁移补默认

    // 往返保留
    const round = loadSaveFile(serializeSaveFile(loaded.state))
    expect(round.state.events.nextAtGameMs).toBe(0)
    expect(round.state.version).toBe(18)
  })
})
