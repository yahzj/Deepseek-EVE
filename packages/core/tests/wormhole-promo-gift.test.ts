/**
 * **限时促销「虫洞大量生成」的一次性赠送**（船长 2026-09-16）。
 *
 * 船长原话：「将扫描虫洞所需时间*0.25，持续到9月20号，并给予所有玩家5个虫洞（同样持续到
 * 20号为止，到20号之后提醒我清理这个过期的赠送）」＋ 四答：**每人只发一次 5 个** ·
 * **只给已解锁者**（协会声望 ≥ 40）· 到期**只停止赠送**（不回收已发出的）· 展示与扫描加速合并。
 *
 * 本文件锁住七件事：
 * ① 窗口内 + 已解锁 ⇒ 一次发 **5 处**并记录已领取；
 * ② **幂等**：连跑多拍不重复发（`state.promoClaimed` 是唯一凭据）；
 * ③ **只给已解锁者**：未达标不发、也不记领取 ⇒ 达标后（仍在活动期内）下一拍补发；
 * ④ **到期只停止赠送**：活动后不再发（含未领取的老档）；
 * ⑤ **允许暂时超过库存上限**：手里 3 处 + 送 5 处 = 8 处（赠送不被上限"吃掉"）；
 * ⑥ **到期不回收**：已发出的虫洞在活动结束后仍在库存里；
 * ⑦ **存档往返**：领取记录随档落盘 ⇒ 读回来不会重发（老档无该字段 ⇒ 自动补发一次）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { DSI_FACTION_ID } from '../src/expedition'
import { PROMOS } from '../src/tuning'
import {
  WORMHOLE_SCAN_UNLOCK_STANDING,
  wormholeStockFull,
  wormholeStockMaxOf,
  wormholeStockOf,
  wormholeStockPush,
} from '../src/wormholeScan'

const ctx = buildSimContext()
const PROMO_ID = 'wh-bloom-20260916'
/** 活动期内（2026-09-18 12:00 当地） */
const IN_WINDOW = new Date(2026, 8, 18, 12, 0, 0, 0).getTime()
/** 失效之后（2026-09-21 00:00 当地 = 截止次日零点） */
const AFTER = new Date(2026, 8, 21, 0, 0, 0, 0).getTime()

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 解锁「扫描虫洞」（协会声望达标） */
function unlock(s: GameState): void {
  s.standings[DSI_FACTION_ID] = WORMHOLE_SCAN_UNLOCK_STANDING
}

/** 推进一拍（把现实墙钟写进 state ⇒ 促销判定走它） */
function tick(s: GameState, wallMs: number, ms = 1_000): void {
  advanceGame(s, ms, ctx, { nowWallMs: wallMs })
}

describe('虫洞 · 限时促销赠送（2026-09-16「虫洞大量生成」）', () => {
  it('促销表守卫：id / 赠送数 / 截止日 / 点击去向（改表会红，防止静默失效）', () => {
    const p = PROMOS.find((x) => x.id === PROMO_ID)
    expect(p, `促销表里应有 ${PROMO_ID}`).toBeTruthy()
    expect(p!.giftWormholes).toBe(5)
    expect(p!.until).toBe('2026-09-20')
    // 船长 2026-09-16：「点击后，不会跳转扫描虫洞界面」⇒ 本促销必须写明去向 = 扫描虫洞页
    expect(p!.open).toBe('wormhole-scan')
  })

  it('① 已解锁 + 活动期内 ⇒ 一次发 5 处并记录已领取', () => {
    const s = fresh()
    unlock(s)
    expect(wormholeStockOf(s)).toHaveLength(0)
    tick(s, IN_WINDOW)
    expect(wormholeStockOf(s)).toHaveLength(5)
    expect(s.promoClaimed?.[PROMO_ID]).toBe(true)
  })

  it('② 幂等：连跑三拍仍是 5 处（每人只发一次）', () => {
    const s = fresh()
    unlock(s)
    tick(s, IN_WINDOW)
    tick(s, IN_WINDOW + 60_000, 60_000)
    tick(s, IN_WINDOW + 120_000, 60_000)
    expect(wormholeStockOf(s)).toHaveLength(5)
  })

  it('③ 只给已解锁者：未达标不发也不记；达标后（仍在活动期）下一拍补发', () => {
    const s = fresh()
    tick(s, IN_WINDOW)
    expect(wormholeStockOf(s)).toHaveLength(0)
    expect(s.promoClaimed?.[PROMO_ID]).toBeUndefined()
    unlock(s)
    tick(s, IN_WINDOW + 1_000)
    expect(wormholeStockOf(s)).toHaveLength(5)
    expect(s.promoClaimed?.[PROMO_ID]).toBe(true)
  })

  it('④ 到期只停止赠送：活动结束后不再发（未领取的老档也拿不到）', () => {
    const s = fresh()
    unlock(s)
    tick(s, AFTER)
    expect(wormholeStockOf(s)).toHaveLength(0)
    expect(s.promoClaimed?.[PROMO_ID]).toBeUndefined()
  })

  it('⑤ 允许暂时超过库存上限：手里 3 处 + 送 5 处 = 8 处（赠送不被上限吃掉）', () => {
    const s = fresh()
    unlock(s)
    s.wallMs = IN_WINDOW
    for (let i = 0; i < 3; i++) wormholeStockPush(s, ctx) // 走扫描产出的同一条路径铺垫
    expect(wormholeStockOf(s)).toHaveLength(3)
    tick(s, IN_WINDOW)
    expect(wormholeStockOf(s)).toHaveLength(8)
    // 放宽只作用于赠送这一条路径：扫描的"满则停机"判据不变（用掉降到上限以下即恢复）
    expect(wormholeStockMaxOf(s)).toBe(5)
    expect(wormholeStockFull(s)).toBe(true)
  })

  it('⑥ 到期不回收：活动结束后已发出的 5 处仍在库存里', () => {
    const s = fresh()
    unlock(s)
    tick(s, IN_WINDOW)
    const ids = wormholeStockOf(s).map((x) => x.id)
    expect(ids).toHaveLength(5)
    tick(s, AFTER, 60_000)
    expect(wormholeStockOf(s).map((x) => x.id)).toEqual(ids)
  })

  it('⑦ 存档往返：领取记录随档落盘 ⇒ 读回来不重发（老档无该字段 ⇒ 自动补发一次）', () => {
    const s = fresh()
    unlock(s)
    tick(s, IN_WINDOW)
    const back = loadSaveFile(serializeSaveFile(s, IN_WINDOW)).state
    expect(back.promoClaimed?.[PROMO_ID]).toBe(true)
    expect(wormholeStockOf(back)).toHaveLength(5)
    tick(back, IN_WINDOW + 1_000)
    expect(wormholeStockOf(back)).toHaveLength(5)
    // 反向：老档（没有 promoClaimed 键）在活动期内应当被补发
    const legacy = fresh(9)
    unlock(legacy)
    delete legacy.promoClaimed
    tick(legacy, IN_WINDOW)
    expect(wormholeStockOf(legacy)).toHaveLength(5)
  })
})
