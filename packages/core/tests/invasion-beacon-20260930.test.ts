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
import {
  HIGH_SEC_PENALTY,
  INVASION_BEACON_FAMILIES,
  INVASION_BEACON_ITEM_ID,
  beaconLaunchHighSecOf,
  consumableStockOf,
  useInvasionBeacon,
} from '../src/consumables'
import { weekendCoreCandidates } from '../src/weekendEvent'
import { securityZoneOf } from '../src/sideTasks'
import { DSI_FACTION_ID, noteStandingEarned } from '../src/expedition'

const ctx = buildSimContext()

/** 一个**非高安**星系（高安点火要付声望代价 ⇒ 绝大多数用例应在非高安点火） */
function nonHighSecId(): string {
  return [...ctx.galaxies.keys()].find((id) => securityZoneOf(ctx, id) !== '高安')!
}
/** 一个**高安**星系（专测"高安点火要扣声望"） */
function highSecId(): string {
  return [...ctx.galaxies.keys()].find((id) => securityZoneOf(ctx, id) === '高安')!
}

/** 造一个"有可入侵目标"的档：把全图都标成已探索（`weekendCoreCandidates` = 已探索 且 非高安 且 无已建成副站）
 *  ⚠ **2026-09-30 船长令**「信号发射器不可以在有空间站的地方使用」⇒ 还要**离开基地**
 *  （`awayGalaxy` 非空 = 不在母港/已建成副站），否则一律被 `core.consumable.010` 拦下。
 *  ⚠ 同日令「在高安使用要扣声望」⇒ 默认落在**非高安**，高安那条单独造。 */
function readyState() {
  const s = createInitialState({ nowWallMs: 0, seed: 41 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.awayGalaxy = nonHighSecId()
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
    const bad = useInvasionBeacon(a, ctx, { familyId: 'ZZ' })
    expect(bad.ok).toBe(false)
    expect(bad.errorId).toBe('core.consumable.006')
    expect(consumableStockOf(a, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)

    const b = createInitialState({ nowWallMs: 0, seed: 41 })
    b.awayGalaxy = nonHighSecId() // 先离开基地（否则先被位置限制 core.consumable.010 拦）
    addWare(b, INVASION_BEACON_ITEM_ID, 1)
    const none = useInvasionBeacon(b, ctx)
    expect(none.ok).toBe(false)
    expect(none.errorId, '一个星系都没探索 ⇒ 抽不到目标').toBe('core.consumable.007')
    expect(consumableStockOf(b, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
  })

  it('**指定星系**时在基地（母港 / 已建成副站）⇒ 拒绝 core.consumable.010，不扣料（**2026-09-30 船长令**：不可以在有空间站的地方使用）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 41 })
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const target = weekendCoreCandidates(s, ctx)[0]!
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.010')
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    expect(s.weekendEvent, '没建事件').toBeUndefined()
  })

  it('**默认使用**（不指定星系）⇒ **不看位置**：在母港也能开，且不扣声望（**2026-09-30 船长纠正**）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 41 }) // 母港（高安）· dockedSite 空
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const spendable = s.standings[DSI_FACTION_ID] ?? 0
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '扣掉一枚').toBe(0)
    expect(s.standings[DSI_FACTION_ID] ?? 0, '默认那条不扣声望').toBe(spendable)
    expect(s.weekendEvent, '入侵照常起来').toBeTruthy()
  })

  /**
   * **指定星系那条路**（**2026-09-30 船长裁定**：「直接使用是随机星系（这个要提醒玩家）。
   * **选择了星系后是固定**。」）——资格判据与随机那条**同一套** `weekendCoreCandidates`。
   */
  it('指定星系 ⇒ 落点就是它（不随机），外围按它算，扣一枚', () => {
    const s = readyState()
    /* 目标取**合格候选**（与界面同一条判据：非高安 · 已探索 · 无已建副站），不挑家星系 */
    const candidates = weekendCoreCandidates(s, ctx)
    expect(candidates.length, '全图已探索 ⇒ 合格目标非空').toBeGreaterThan(0)
    const target = candidates[Math.min(3, candidates.length - 1)]!
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.weekendEvent!.coreId, '落点 = 玩家选的那个').toBe(target)
    expect(s.weekendEvent!.peripheryIds.length, '外围非空').toBeGreaterThan(0)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '扣掉一枚').toBe(0)
  })

  it('指定不合格星系 ⇒ 拒绝 core.consumable.009 且不扣料（未探索 / 高安 / 已有已建副站）', () => {
    /* ① 没探索过（**先离开基地**，否则先撞位置限制） */
    const a = createInitialState({ nowWallMs: 0, seed: 41 })
    a.awayGalaxy = nonHighSecId()
    addWare(a, INVASION_BEACON_ITEM_ID, 1)
    a.exploredGalaxies = [] // 全部标成未探索
    const r1 = useInvasionBeacon(a, ctx, { galaxyId: [...ctx.galaxies.keys()][0]! })
    expect(r1.ok).toBe(false)
    expect(r1.errorId).toBe('core.consumable.009')
    expect(consumableStockOf(a, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    expect(a.weekendEvent, '没建事件').toBeUndefined()

    /* ② 高安星系（拿全探索档里第一个高安作目标） */
    const b = readyState()
    const highSec = [...ctx.galaxies.keys()].find((id) => !weekendCoreCandidates(b, ctx).includes(id) && ctx.galaxies.has(id))
    if (highSec !== undefined) {
      const r2 = useInvasionBeacon(b, ctx, { galaxyId: highSec })
      expect(r2.ok, '高安或已建副站 ⇒ 拒').toBe(false)
      expect(r2.errorId).toBe('core.consumable.009')
      expect(consumableStockOf(b, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    }
  })

  /**
   * **高安点火的声望代价**（**2026-09-30 船长令**：「且当玩家在高安使用时候，弹出二次警告，警告玩家
   * 这么做会被扣声望」→ 船长「按你推荐来」＝扣**可支配声望 10 点**、不足则拒）。
   */
  it('**指定星系** ＋ 在高安（非基地）⇒ 允许，但**可支配声望 −10**，累计不动', () => {
    const s = readyState()
    s.awayGalaxy = highSecId()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const target = weekendCoreCandidates(s, ctx)[0]!
    const before = { spendable: s.standings[DSI_FACTION_ID] ?? 0, earned: s.standingsEarned?.[DSI_FACTION_ID] ?? 0 }
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.standings[DSI_FACTION_ID] ?? 0, '可支配 −10').toBe(before.spendable - HIGH_SEC_PENALTY)
    expect(s.standingsEarned?.[DSI_FACTION_ID] ?? 0, '累计不动（已达成的门槛不受影响）').toBe(before.earned)
    expect(
      s.logs.some((l) => l.textId === 'core.consumable.012'),
      '留下扣声望的日志',
    ).toBe(true)
  })

  it('**指定星系** 且在高安但**可支配声望不足** ⇒ 拒绝 core.consumable.011，不扣料也不建事件', () => {
    const s = readyState()
    s.awayGalaxy = highSecId() // 新档声望为 0
    const target = weekendCoreCandidates(s, ctx)[0]!
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.011')
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    expect(s.weekendEvent, '没建事件').toBeUndefined()
  })

  it('在**非高安**点火 ⇒ 不扣声望', () => {
    /* ⚠ 另有一条：**在空间站（母港也是高安）时不该报"高安点火"** ——那是位置门的活
       （船长 2026-09-30 报障：「提示我处于大鲸鱼，还有扣声望警告」）*/
    const atHome = createInitialState({ nowWallMs: 0, seed: 41 })
    expect(beaconLaunchHighSecOf(atHome, ctx), '在母港 ⇒ 不算高安点火（该由位置门拒）').toBe(false)
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const before = s.standings[DSI_FACTION_ID] ?? 0
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    expect(s.standings[DSI_FACTION_ID] ?? 0, '非高安不扣').toBe(before)
  })
})
