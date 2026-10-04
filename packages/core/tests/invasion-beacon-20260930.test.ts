/**
 * **信号发射器**（**2026-09-30 船长令**「信号发射器」· 口径见 `docs/design/lab-consumables-20260930.md`）用例。
 *
 * 船长 2026-09-29 六答：Q2「做个列表之类的，之后有新增入侵就添加选项」·
 * Q3a「和现有规则一样（**随机星系**入侵）」· Q3b「**只能在没有入侵时候使用**」·
 * Q3c「**消耗一个**，不做限制」· Q3d「能获得虚空晶必然声望达标。**不做限制**」。
 *
 * 🔴 **2026-10-02 船长令改判**：「**信号发射器召唤的敌人是随机的（目前只有R和H）**」⇒
 * **势力随机**（池 = `WEEKEND_FINISHED_FAMILIES`，占位族 A/C/G 永不出现）；Q2 那张"选项列表"
 * 降为**显式覆盖**用（界面仍不提供选择器）⇒ 本文件里"势力 = 列表第一支"那条已按新令改写。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import {
  HIGH_SEC_PENALTY,
  INVASION_BEACON_FAMILIES,
  INVASION_BEACON_ITEM_ID,
  beaconLaunchHighSecOf,
  consumableStockOf,
  useInvasionBeacon,
} from '../src/consumables'
import {
  WEEKEND_FAMILIES,
  WEEKEND_FINISHED_FAMILIES,
  WEEKEND_STANDING_BEACON,
  WEEKEND_STANDING_MAX,
  weekendCoreCandidates,
  weekendHasBuiltStation,
  weekendRandomFamilyOf,
  weekendStandingGainOf,
} from '../src/weekendEvent'
import { weekendWarnCommsOf } from '../src/weekendComms'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { securityZoneOf } from '../src/securityZone'
import { DSI_FACTION_ID, noteStandingEarned } from '../src/expedition'
import { startMining } from '../src/mining'

const ctx = buildSimContext()

/** 一个**非高安**星系（高安点火要付声望代价 ⇒ 绝大多数用例应在非高安点火） */
function nonHighSecId(): string {
  return [...ctx.galaxies.keys()].find((id) => securityZoneOf(ctx, id) !== '高安')!
}
/** 一个**高安**星系（专测"高安点火要扣声望"） */
function highSecId(): string {
  return [...ctx.galaxies.keys()].find((id) => securityZoneOf(ctx, id) === '高安')!
}
/**
 * 一个**"属高安但没有空间站"**的星系 —— **2026-10-03 船长裁「乙」后，"要警告 + 扣声望"看的是
 * 玩家选定的目标星系属高安**（不再看玩家所在地）；母港自带空间站（会被 `core.consumable.010` 拦）⇒ 排除。
 */
function highSecTargetId(s: ReturnType<typeof createInitialState>): string | undefined {
  return [...ctx.galaxies.keys()].find(
    (id) => securityZoneOf(ctx, id) === '高安' && id !== HOME_GALAXY_ID && !weekendHasBuiltStation(s, ctx, id),
  )
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

  it('用掉一枚 ⇒ 按现有规则抽一场入侵（随机星系 ＋ **随机势力**），并留日志', () => {
    const s = readyState()
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '扣掉一枚').toBe(0)
    const ev = s.weekendEvent!
    expect(ev, '事件已建立').toBeTruthy()
    expect(ctx.galaxies.has(ev.coreId), '核心星系是真的').toBe(true)
    expect(ev.peripheryIds.length, '外围星系非空').toBeGreaterThan(0)
    /** 🔴 **势力随机**（船长 2026-10-02 令）：落在"做完了的族"里，**且绝不是占位族** */
    expect(WEEKEND_FINISHED_FAMILIES, '先决：随机池非空').toContain(ev.family)
    for (const placeholder of ['A', 'C', 'G']) {
      expect(ev.family, `占位族 ${placeholder} 不该被召唤出来`).not.toBe(placeholder)
      expect(WEEKEND_FINISHED_FAMILIES, `占位族 ${placeholder} 不该在随机池里`).not.toContain(placeholder)
    }
    expect(ev.family, '与"纯函数抽族"同源（同一 (种子, 场次)）').toBe(weekendRandomFamilyOf(s, ev.seq))
    expect(ev.startedAtWallMs, '起点 = 现在（不是本周排期的 T0）').toBe(s.wallMs ?? ev.startedAtWallMs)
    expect(ev.endedAtWallMs, '新场未结束').toBeUndefined()
    expect(s.logs.some((l) => l.textId === 'core.consumable.008'), '启动日志').toBe(true)
  })

  it('势力是**随机**的：跨场次能同时抽到 R 与 H；同一 (种子, 场次) 可复现', () => {
    /** 连开多场（每场结束再点一枚），把抽到的族收齐 */
    const seen = new Set<string>()
    const s = readyState()
    for (let i = 0; i < 12; i++) {
      addWare(s, INVASION_BEACON_ITEM_ID, 1)
      const r = useInvasionBeacon(s, ctx)
      expect(r.ok, `第 ${i + 1} 次召唤应成功`).toBe(true)
      seen.add(s.weekendEvent!.family)
      /** 收场 ⇒ 下一枚才能用（Q3b：只能在没有入侵时使用） */
      s.weekendEvent!.endedAtWallMs = (s.weekendEvent!.startedAtWallMs ?? 0) + 1
    }
    expect([...seen].sort(), '12 场里 R 与 H 都该出现过（随机而非恒定）').toEqual(['H', 'R'])
    /** 纯函数：同一个 (种子, 场次) 恒得同一族 */
    const probe = readyState()
    expect(weekendRandomFamilyOf(probe, 7)).toBe(weekendRandomFamilyOf(probe, 7))
    expect(WEEKEND_FAMILIES.length, '族池（含占位族）仍是五支 —— 随机池只是它的子集').toBeGreaterThan(
      WEEKEND_FINISHED_FAMILIES.length,
    )
    console.log(
      `  [读数] 发射器随机池 = ${WEEKEND_FINISHED_FAMILIES.join('/')}（族池共 ${WEEKEND_FAMILIES.length} 支，占位族不进随机）·` +
        ` 12 场实测出现：${[...seen].sort().join('/')}`,
    )
  })

  it('显式指定仍可用（覆盖随机）：清单 = "做完了的族"逐字一致；表外 id 照旧拒', () => {
    /** 清单由"做完了的族"派生 ⇒ 两张表不可能漂移（R 族 10-01 做完了却漏登记就是这类漏） */
    expect(INVASION_BEACON_FAMILIES.map((f) => f.id), '清单与随机池同一份').toEqual([...WEEKEND_FINISHED_FAMILIES])
    const s = readyState()
    expect(useInvasionBeacon(s, ctx, { familyId: 'R' }).ok).toBe(true)
    expect(s.weekendEvent!.family, '显式指定 R ⇒ 就是 R（不吃随机）').toBe('R')
    s.weekendEvent!.endedAtWallMs = (s.weekendEvent!.startedAtWallMs ?? 0) + 1
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    expect(useInvasionBeacon(s, ctx, { familyId: 'H' }).ok).toBe(true)
    expect(s.weekendEvent!.family, '显式指定 H ⇒ 就是 H').toBe('H')
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

  it('**指定星系**时玩家在空间站（母港）也**允许**（2026-09-30 船长报障：别要求玩家先离开自己的空间站）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 41 })
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    noteStandingEarned(s, DSI_FACTION_ID, 50) // 母港在高安 ⇒ 指定那条要付声望（代价，非门槛）
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const target = weekendCoreCandidates(s, ctx)[0]!
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.weekendEvent!.coreId, '落点 = 所选星系（玩家在不在空间站无关）').toBe(target)
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '扣掉一枚').toBe(0)
  })

  it('**指定星系** ＋ 开到高安（不在空间站）⇒ **允许**（但要付声望）', () => {
    const s = readyState()
    s.awayGalaxy = highSecId()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const target = weekendCoreCandidates(s, ctx)[0]!
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.weekendEvent!.coreId).toBe(target)
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

  it('**指定星系**的**唯一禁令**＝目标星系有空间站（母港 / 已建成副站）⇒ 拒 core.consumable.010、不扣料', () => {
    /* ① 目标 = 母港（自带空间站） */
    const a = readyState() // 自带 1 枚
    const r1 = useInvasionBeacon(a, ctx, { galaxyId: HOME_GALAXY_ID })
    expect(r1.ok).toBe(false)
    expect(r1.errorId).toBe('core.consumable.010')
    expect(consumableStockOf(a, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    expect(a.weekendEvent, '没建事件').toBeUndefined()
  })

  it('**指定星系**时"未探索 / 高安 / 无副站"都**不再是**限制（只剩空间站那一条）', () => {
    /* 高安但无空间站的星系 ⇒ 允许（2026-09-30 船长令：只有"有空间站"这一条禁令） */
    const s = readyState()
    s.awayGalaxy = highSecId()
    noteStandingEarned(s, DSI_FACTION_ID, 50) // 高安点火要付声望
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const hiTarget = [...ctx.galaxies.keys()].find(
      (id) => securityZoneOf(ctx, id) === '高安' && id !== HOME_GALAXY_ID && !weekendHasBuiltStation(s, ctx, id),
    )
    if (hiTarget !== undefined) {
      const r = useInvasionBeacon(s, ctx, { galaxyId: hiTarget })
      expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
      expect(s.weekendEvent!.coreId).toBe(hiTarget)
    }
  })

  /**
   * **目标属高安的声望代价**（**2026-09-30 船长令**：「且当玩家在高安使用时候，弹出二次警告，警告玩家
   * 这么做会被扣声望」→ 船长「按你推荐来」＝扣**可支配声望 10 点**、不足则拒）。
   *
   * 🔴 **2026-10-03 船长裁「乙」改判**（玩家报障：「**在穹顶墓园使用信号发射器，却跳出高安警告，
   * 警告内写的星系是大鲸鱼IV**」＋ 船长追述「**不是在玩家所在地点使用，而是玩家选择在哪个星系使用
   * 信号发射器**」）⇒ 判据从"玩家所在地"改为「**玩家选定的目标星系**属高安」。本组用例随之改写：
   * 触发条件是**目标属高安**，与玩家在哪无关（旧写法是"把 awayGalaxy 挪到高安"）。
   */
  it('**指定目标属高安** ⇒ 允许，但**可支配声望 −10**，累计不动', () => {
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const target = highSecTargetId(s)!
    expect(target, '该内容包里要有"属高安且无空间站"的星系').toBeTruthy()
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

  it('**目标属高安**但**可支配声望不足** ⇒ 拒绝 core.consumable.011，不扣料也不建事件', () => {
    const s = readyState()
    const target = highSecTargetId(s)! // 新档声望为 0
    const r = useInvasionBeacon(s, ctx, { galaxyId: target })
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.consumable.011')
    expect(consumableStockOf(s, INVASION_BEACON_ITEM_ID), '不扣料').toBe(1)
    expect(s.weekendEvent, '没建事件').toBeUndefined()
  })

  it('**非高安目标** ⇒ 不扣声望（含"默认那条路"一律不警告）', () => {
    /**
     * ⚠ **2026-10-03 裁「乙」后的判据**：`beaconLaunchHighSecOf(ctx)`（**不传目标** = 默认那条路，
     * 由候选集随机抽、候选集本身排除高安）恒 false ⇒ 从物品页/货仓页用发射器**不会**弹高安警告
     * （旧口径看玩家所在地，正是那次误报的来源）。
     */
    expect(beaconLaunchHighSecOf(ctx), '不指定目标 ⇒ 一律不警告').toBe(false)
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const before = s.standings[DSI_FACTION_ID] ?? 0
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    expect(s.standings[DSI_FACTION_ID] ?? 0, '非高安不扣').toBe(before)
  })

  /**
   * 🔴 **本条的回归**（**2026-10-03 玩家报障**）：「**玩家在穹顶墓园使用信号发射器，但是跳出了高安警告，
   * 警告内写的星系是大鲸鱼IV**」。
   *
   * 真因：旧判据取的是 `state.awayGalaxy ?? 母港`，而**采矿/打捞期间 `awayGalaxy` 被有意清空**
   * （见 `location.ts` 站内工业门槛那段）⇒ 在穹顶墓园（security −1.0，低安）采矿的玩家被判成
   * "人在母港大鲸鱼Ⅳ（+1.0，高安）"⇒ 误弹警告、名字也写成母港。现口径看**目标**⇒ 不警告 ✓。
   */
  it('在**穹顶墓园采矿**时选定穹顶墓园 ⇒ **不弹高安警告**、不扣声望（报障回归）', () => {
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const VAULT = 'galaxy-vault' // 穹顶墓园（低安）
    const belt = [...ctx.belts.values()].find((b) => b.galaxyId === VAULT)!
    expect(startMining(s, belt.id, ctx).ok, '脚手架自检：在穹顶墓园采上矿').toBe(true)
    expect(s.awayGalaxy, '采矿期间 awayGalaxy 是 null（这正是旧判据踩的坑）').toBeNull()
    expect(securityZoneOf(ctx, VAULT), '穹顶墓园是低安').toBe('低安')
    expect(beaconLaunchHighSecOf(ctx, VAULT), '**目标低安 ⇒ 不警告**（旧口径这里是 true）').toBe(false)
    const before = s.standings[DSI_FACTION_ID] ?? 0
    const r = useInvasionBeacon(s, ctx, { galaxyId: VAULT })
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.standings[DSI_FACTION_ID] ?? 0, '不扣声望').toBe(before)
    expect(s.weekendEvent?.beaconHighSec, '不写"高安那场"的留痕').toBeUndefined()
    console.log(`  [读数] 在穹顶墓园采矿（awayGalaxy=null）＋ 目标穹顶墓园：警告=${beaconLaunchHighSecOf(ctx, VAULT)} · 声望 ${before} → ${s.standings[DSI_FACTION_ID]}`)
  })
})

/**
 * **高安点火那一场的通讯变体**（**2026-10-01 船长令**：「如果玩家在高安使用信号发射器，触发入侵的通讯
 * 会在开头怀疑玩家，并在文本中说扣玩家的声望。」）＋ 船长对措辞的两条口径：只写"怀疑"（"只发现了你的
 * 舰船信号"式，不写"登记在你名下"这种确凿证据）；实况段改成能接住质问的承接口气（裁定「按 B」）。
 */
describe('信号发射器 · 目标属高安那一场的通讯变体', () => {
  /** 目标属高安那一场（⚠ **2026-10-03 裁「乙」后判据 = 目标星系属高安**；
   *  玩家在哪无关，`awayGalaxy` 不再影响判定） */
  function highSecLitState() {
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    const target = highSecTargetId(s)!
    expect(useInvasionBeacon(s, ctx, { galaxyId: target }).ok, '目标属高安 ⇒ 允许点火（扣声望）').toBe(true)
    return s
  }

  it('目标属高安 ⇒ 事件留痕 `beaconHighSec`，预警信**首段**换成质问（`core.weekend.044`）并喂上扣分槽 p4', () => {
    const s = highSecLitState()
    expect(s.weekendEvent?.beaconHighSec, '点火来源写进这一场事件').toBe(true)
    const mail = weekendWarnCommsOf(s, ctx, s.weekendEvent!)
    expect(mail.bodyIds).toEqual(['core.weekend.044', 'core.weekend.011', 'core.weekend.012'])
    expect(mail.params?.['p4'], '扣分槽 = 实扣数').toBe(HIGH_SEC_PENALTY)
    expect(mail.paragraphs[0]).toContain('只检测到你的舰船信号')
    expect(mail.paragraphs[0]).toContain('有理由怀疑')
    expect(mail.paragraphs[0]).toContain(`扣除 ${HIGH_SEC_PENALTY} 点可支配声望`)
    expect(mail.paragraphs[0], '只写怀疑，不写确凿证据').not.toContain('登记在你名下')
  })

  it('非高安目标 ⇒ 不留痕，预警信仍是原两段（无质问、不喂 p4）', () => {
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    expect(useInvasionBeacon(s, ctx, { galaxyId: nonHighSecId() }).ok).toBe(true)
    expect(s.weekendEvent?.beaconHighSec).toBeUndefined()
    const mail = weekendWarnCommsOf(s, ctx, s.weekendEvent!)
    expect(mail.bodyIds).toEqual(['core.weekend.011', 'core.weekend.012'])
    expect(mail.params?.['p4']).toBeUndefined()
  })

  it('默认路点火（不指定星系 · 不扣声望）⇒ 同样没有质问段', () => {
    const s = readyState()
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    expect(s.weekendEvent?.beaconHighSec).toBeUndefined()
    expect(weekendWarnCommsOf(s, ctx, s.weekendEvent!).bodyIds).toEqual(['core.weekend.011', 'core.weekend.012'])
  })

  it('实况段承接质问，星系数量、核心、星图标记和避险四件事齐备', () => {
    const s = readyState()
    noteStandingEarned(s, DSI_FACTION_ID, 50)
    expect(useInvasionBeacon(s, ctx, { galaxyId: nonHighSecId() }).ok).toBe(true)
    const mail = weekendWarnCommsOf(s, ctx, s.weekendEvent!)
    const live = mail.paragraphs[mail.bodyIds.indexOf('core.weekend.011')]!
    expect(live.startsWith('目前，')).toBe(true)
    expect(live, '原稿的侦查叙述已换掉').not.toContain('就在刚刚')
    expect(live).toContain(`${s.weekendEvent!.peripheryIds.length + 1} 处星系`)
    expect(live).toContain(ctx.galaxies.get(s.weekendEvent!.coreId)!.name)
    expect(live).toContain('占领范围已在星图标明')
    expect(live).toContain('非战斗作业请避开')
  })

  it('存档往返：留痕跟着这一场走（读档后照样发质问段）', () => {
    const s = highSecLitState()
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.weekendEvent?.beaconHighSec).toBe(true)
    expect(weekendWarnCommsOf(back, ctx, back.weekendEvent!).bodyIds[0]).toBe('core.weekend.044')
  })

  /**
   * **玩家自己点火的场次：结算声望固定 5 点**（**2026-10-01 船长令**：「**玩家用信号发射器召唤的入侵，
   * 每次完成只给 5 声望。**」）——每周那场自己爆发的入侵仍按贡献 0~15 点，判据单点 = `weekendStandingGainOf`。
   */
  it('点火场次 ⇒ 事件留痕 `beaconLit`，结算声望**固定 5 点**（每周那场仍按贡献算）', () => {
    const s = readyState()
    expect(useInvasionBeacon(s, ctx).ok).toBe(true)
    const ev = s.weekendEvent!
    expect(ev.beaconLit, '点火来源留痕').toBe(true)
    expect(weekendStandingGainOf(ev, 1), '点火场：满贡献也是固定 5 点').toBe(WEEKEND_STANDING_BEACON)
    expect(weekendStandingGainOf({}, 1), '每周那场：满贡献 15 点').toBe(WEEKEND_STANDING_MAX)
    expect(weekendStandingGainOf({}, 0.5), '每周那场：半贡献 8 点').toBe(8)
    expect(loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent?.beaconLit, '读档后仍在').toBe(true)
  })
})
