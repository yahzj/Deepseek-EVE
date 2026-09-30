/**
 * **信号发射器**（**2026-09-30 船长令**「信号发射器」· 口径见 `docs/design/lab-consumables-20260930.md`）用例。
 *
 * 船长 2026-09-29 六答：Q2「做个列表之类的，之后有新增入侵就添加选项」·
 * Q3a「和现有规则一样（**随机星系**入侵）」· Q3b「**只能在没有入侵时候使用**」·
 * Q3c「**消耗一个**，不做限制」· Q3d「能获得虚空晶必然声望达标。**不做限制**」。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { INVASION_BEACON_FAMILIES, INVASION_BEACON_ITEM_ID, consumableStockOf, useInvasionBeacon } from '../src/consumables'

const ctx = buildSimContext()

/** 造一个"有可入侵目标"的档：把全图都标成已探索（`weekendCoreCandidates` = 已探索 且 非高安 且 无已建成副站） */
function readyState() {
  const s = createInitialState({ nowWallMs: 0, seed: 41 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  addWare(s, INVASION_BEACON_ITEM_ID, 1)
  return s
}

describe('信号发射器 · 使用与拒绝', () => {
  it('没库存 ⇒ 拒绝（core.consumable.004），不写事件', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 41 })
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.004')
    expect(s.weekendEvent).toBeUndefined()
  })

  it('用掉一枚 ⇒ 按现有规则抽一场入侵（随机星系 ＋ 指定势力），并留日志', () => {
    const s = readyState()
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '扣掉一枚').toBe(0)
    const ev = s.weekendEvent!
    expect(ev, '事件已建立').toBeTruthy()
    expect(ctx.galaxies.has(ev.coreId), '核心星系是真的').toBe(true)
    expect(ev.peripheryIds.length, '外围星系非空').toBeGreaterThan(0)
    expect(ev.family, '势力 = 列表里选的那一支').toBe(INVASION_BEACON_FAMILIES[0]!.id)
    expect(ev.startedAtWallMs, '起点 = 现在（不是本周排期的 T0）').toBe(s.wallMs ?? ev.startedAtWallMs)
    expect(ev.endedAtWallMs, '新场未结束').toBeUndefined()
    expect(s.logs.some((l) => l.textId === 'core.consumable.008'), '启动日志').toBe(true)
  })

  it('已经有一场在进行 ⇒ 拒绝且**不消耗**（core.consumable.005）', () => {
    const s = readyState()
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const before = s.weekendEvent
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.005')
    expect(countWare(s, INVASION_BEACON_ITEM_ID), '第二枚原封不动').toBe(1)
    expect(s.weekendEvent, '原有那一场没被动过').toBe(before)
  })

  it('上一场已结束 ⇒ 可以再开一场（场次号 +1）', () => {
    const s = readyState()
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    const first = s.weekendEvent!.seq
    s.weekendEvent!.endedAtWallMs = (s.weekendEvent!.startedAtWallMs ?? 0) + 1
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    expect(s.weekendEvent!.seq).toBe(first + 1)
  })

  it('未知势力 ⇒ 拒绝（core.consumable.006）；没有可入侵星系 ⇒ 拒绝且不扣料（core.consumable.007）', () => {
    const a = readyState()
    const bad = useInvasionBeacon(a, ctx, 'ZZ')
    expect(bad.ok).toBe(false)
    expect(bad.errorId).toBe('core.consumable.006')
    expect(consumableStockOf(a, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)

    const b = createInitialState({ nowWallMs: 0, seed: 41 })
    addWare(b, INVASION_BEACON_ITEM_ID, 1)
    const none = useInvasionBeacon(b, ctx)
    expect(none.ok).toBe(false)
    expect(none.errorId, '一个星系都没探索 ⇒ 抽不到目标').toBe('core.consumable.007')
    expect(consumableStockOf(b, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
  })
})
