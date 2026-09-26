/**
 * **所有声望门槛一律读「累计获得」那一本账**（**2026-09-26 船长令**：
 * 「**修改原先的所有声望门槛，改为根据玩家的累计声望**」）。
 *
 * 两条账的分工（`expedition.ts` 唯一入口）：
 * - `standingsEarned` = **累计获得**（只增不减）⇒ **一切门槛读它**（`standingOf`）；
 * - `standings` = **可支配**（只有「章鱼人兑换」扣它）⇒ 只用来回答"还买得起几张图纸"。
 *
 * 本文件逐条钉住"哪些门槛"——船长原话是"**所有**"，所以凡界面上会拦人的声望闸都要在这里出现一次：
 * 虫洞扫描解锁 · 矿带 / 商品购买门槛 · 暗市闸 · 周末入侵 · 通讯 `standing` 触发器 · 卖价声望加成。
 * 反面同样钉住：**可支配再高也不能顶替累计**（否则花掉声望就能反向锁人）。
 *
 * ⚠ 改前只有「虫洞闸（`comms.ts` 那条触发器）」与「矿带命令侧」读累计，其余各处直读 `standings`
 * ⇒ 换过插件图纸的玩家会看到"星图说锁着、点下去却能开工"这类错位；本组用例就是防它回退。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { CommsMessageDef, MarketGoodDef, SimContext } from '../src/types'
import { advanceComms, commsInbox } from '../src/comms'
import { spendStanding, spendableStandingOf, standingOf } from '../src/expedition'
import { bmGateLocked, bmGateReason, goodLockedReason, marketQuote, marketSellPreview } from '../src/market'
import { WEEKEND_MIN_STANDING, weekendInvasionAllowedFor } from '../src/weekendEvent'
import { WORMHOLE_SCAN_UNLOCK_STANDING, wormholeScanStanding, wormholeScanUnlocked } from '../src/wormholeScan'
import { clearInitialStanding, makeTestCtx, setStanding } from './helpers'

const ctx = buildSimContext()

function fresh(seed = 7): GameState {
  const s = createInitialState({ nowWallMs: 0, seed })
  clearInitialStanding(s) // 新档初始 40 ⇒ 本组用例自己设值
  return s
}

/** 只放门槛字段的商品定义（这几条闸只读 `standingReq` / `bmStanding`） */
const reqGood = (standingReq: number): MarketGoodDef => ({ standingReq }) as MarketGoodDef
const bmGood = (bmStanding: number): MarketGoodDef => ({ bmStanding }) as MarketGoodDef

describe('两条账的分工：累计只增、可支配可被兑换扣', () => {
  it('花掉声望只扣可支配那本，累计那本一分不动', () => {
    const s = fresh()
    setStanding(s, 'dsi', 50)
    expect(spendStanding(s, 'dsi', 30)).toBe(true)
    expect(spendableStandingOf(s, 'dsi')).toBe(20)
    expect(standingOf(s, 'dsi')).toBe(50)
  })

  it('**老档 / 合成状态缺 `standingsEarned` 时回退读旧值**（口径与拆分前一致）', () => {
    const s = fresh()
    setStanding(s, 'dsi', 55)
    delete s.standingsEarned
    expect(standingOf(s, 'dsi')).toBe(55)
    expect(wormholeScanUnlocked(s)).toBe(true)
  })
})

describe('虫洞扫描解锁：按累计判', () => {
  it('累计达标即可、花掉声望不会把已解锁的锁回去', () => {
    const s = fresh()
    setStanding(s, 'dsi', WORMHOLE_SCAN_UNLOCK_STANDING)
    expect(spendStanding(s, 'dsi', 30)).toBe(true) // 可支配掉到 10
    expect(wormholeScanStanding(s)).toBe(WORMHOLE_SCAN_UNLOCK_STANDING)
    expect(wormholeScanUnlocked(s)).toBe(true)
  })

  it('累计不足就是锁着——**可支配再多也不算**', () => {
    const s = fresh()
    setStanding(s, 'dsi', WORMHOLE_SCAN_UNLOCK_STANDING - 1)
    s.standings['dsi'] = 999
    expect(wormholeScanUnlocked(s)).toBe(false)
  })
})

describe('市场：商品购买门槛与暗市闸都按累计判', () => {
  it('累计 39 挡在 40 门槛外（文案报的是累计值），可支配 999 也白搭', () => {
    const s = fresh()
    setStanding(s, 'dsi', 39)
    s.standings['dsi'] = 999
    expect(goodLockedReason(s, reqGood(40))).toContain('当前 39')
    expect(bmGateLocked(s, bmGood(40))).toBe(true)
    expect(bmGateReason(s, bmGood(40))).toContain('当前 39')
  })

  it('累计达标即放行——可支配为 0 也不锁（换光图纸不影响买货）', () => {
    const s = fresh()
    setStanding(s, 'dsi', 40)
    s.standings['dsi'] = 0
    expect(goodLockedReason(s, reqGood(40))).toBeNull()
    expect(bmGateLocked(s, bmGood(40))).toBe(false)
    expect(bmGateReason(s, bmGood(40))).toBeNull()
  })

  it('卖价声望加成按累计：只抬累计 ⇒ ×1.15（封顶）；只抬可支配 ⇒ 一分不加', () => {
    const tctx = makeTestCtx() // 轻量市场（`it-ore-a` = 物品类，唯一吃声望加成的类目）
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    clearInitialStanding(s)
    s.warehouse.items['ore-a'] = 1_000
    marketQuote(s, tctx, 'it-ore-a')
    const base = marketSellPreview(s, tctx, 'it-ore-a').gross
    expect(base).toBeGreaterThan(0)
    // 只抬累计（20 点已越过 +15% 的封顶线 = 15 点）
    s.standingsEarned = { dsi: 20 }
    const byEarned = marketSellPreview(s, tctx, 'it-ore-a').gross
    // 只抬可支配
    s.standingsEarned = { dsi: 0 }
    s.standings['dsi'] = 20
    const bySpendable = marketSellPreview(s, tctx, 'it-ore-a').gross
    expect(byEarned / base).toBeCloseTo(1.15, 2)
    expect(bySpendable).toBe(base)
  })
})

describe('周末入侵门槛：按累计判', () => {
  it('累计不足就开不了新场（可支配 999 也不算）', () => {
    const s = fresh()
    setStanding(s, 'dsi', WEEKEND_MIN_STANDING - 1)
    s.standings['dsi'] = 999
    expect(weekendInvasionAllowedFor(s)).toBe(false)
  })

  it('累计达标即可开（可支配 0 也行）', () => {
    const s = fresh()
    setStanding(s, 'dsi', WEEKEND_MIN_STANDING)
    s.standings['dsi'] = 0
    expect(weekendInvasionAllowedFor(s)).toBe(true)
  })
})

describe('通讯 `standing` 触发器：按累计判', () => {
  const msg: CommsMessageDef = {
    id: 'msg-test-standing-gate',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    subject: '门槛测试信',
    body: ['测试正文'],
    trigger: { kind: 'standing', factionId: 'dsi', min: 40 },
  }
  const withMsg: SimContext = { ...ctx, commsMessages: new Map([[msg.id, msg]]) } as SimContext

  it('累计达标就送达——可支配 0 也照送', () => {
    const s = fresh()
    setStanding(s, 'dsi', 40)
    s.standings['dsi'] = 0
    advanceComms(s, withMsg)
    expect(commsInbox(s, withMsg).some((e) => e.id === msg.id)).toBe(true)
  })

  it('累计不足就不送达——可支配 999 也白搭', () => {
    const s = fresh()
    setStanding(s, 'dsi', 39)
    s.standings['dsi'] = 999
    advanceComms(s, withMsg)
    expect(commsInbox(s, withMsg).some((e) => e.id === msg.id)).toBe(false)
  })
})
