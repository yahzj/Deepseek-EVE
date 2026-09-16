/**
 * **后勤舰特性：修理队友 / 敌方 50% DPS 转修理**（船长 2026-09-16 逐条裁定 · 已确认）。
 *
 * 船长原话（照抄）：
 * - 「**后勤舰添加特性，维修装置可以修理血量最少的队友。**」
 * - 「**敌人后勤舰则是将50%的自身DPS转换为修理值。**」
 * - 「**敌方后勤舰新增一艘舰船**」＋「**T3巡洋**」＋「**先不进卡**」
 * - 补充裁定：「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）。**」
 *
 * 六问六答（全取推荐口径）：判据 = `ShipDef.repairPulseTargetsFleet === true`（**2026-09-16 当日改口径**：
 * 船长「**我发现之前给后勤舰的维修特性并添加到船体特性属性中？**」⇒ 由 `subClass === '后勤舰'` 硬判据
 * 改为**数据字段**驱动，界面「船体特性」栏与引擎同源；现在只有「亡军后勤舰」写了它）·
 * 目标 = **三层剩余比例最低者（含自己；并列取编队顺序靠前）** · **修复量不变** ·
 * 敌方 = **加 `repairPct` 字段 + 新建一艘 T3**（`foe-g-remnant-tender`「残军补给舰」· 备用壳体暂不进卡）·
 * 敌方口径 = **开火减半 + 每 5 秒按秒修理**（名义 DPS 取 `foeHullDpsOf` 那把尺）· **所有战斗生效**。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, SHIPS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import {
  REPAIR_PULSE_MS,
  createBattleState,
  createFoeSpecs,
  createPlayerSpec,
  foeNominalDpsOf,
  foeRepairDiscountedShot,
  pulseFoeRepair,
  repairLedgersOf,
} from '../src/combat'
import type { UnitSpec } from '../src/combat'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { AnomalyDef, SimContext } from '../src/types'

const ctx = buildSimContext()
/** 舰级个体从聚合表取（data 包只导出 FOE_SHIPS 聚合 + 少数个体） */
const shipOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)!
const FOE_G_REMNANT_TENDER = shipOf('foe-g-remnant-tender')
const FOE_G_ECHO_REMNANT = shipOf('foe-g-echo-remnant')
const FOE_G_NADIR_LOCK = shipOf('foe-g-nadir-lock')
const T3 = 'sh-thresher'
/** 我方后勤舰（唯一写 `repairPulseTargetsFleet: true` 的那艘 = 亡军后勤舰） */
const LOGI = 'sh-wh-g-destroyer'
/** 民用维修装置（每跳 甲 5 + 结构 5，耗民用组件） */
const REP_CIV = 'mod-hullrep-civ'

function fresh(seed = 21): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟 3 舰编队：主控 = 后勤舰（带维修装置）· 僚舰 2 艘（其中一艘也装维修装置 = 对照组） */
function enterRunWithLogi(seed = 21): {
  state: GameState
  run: WormholeRunState
  logi: string
  wingA: string
  wingB: string
} {
  const state = fresh(seed)
  const logi = addShipToFleet(state, LOGI)
  const wingA = addShipToFleet(state, T3)
  const wingB = addShipToFleet(state, T3)
  state.shipId = logi
  expect(wormholeEnter(state, ctx, [logi, wingA, wingB], seed).ok).toBe(true)
  /** 后勤舰 + wingB 各装一台民用维修装置（wingA 不装 ⇒ 只能被别人修） */
  for (const id of [logi, wingB]) state.fleet[id]!.fitted = { ...(state.fleet[id]!.fitted ?? {}), mid: [REP_CIV] }
  /** 民用修理组件给足（每跳耗 1 枚） */
  state.warehouse.items['repairkit-civ'] = 500
  return { state, run: state.wormhole.run!, logi, wingA, wingB }
}

/** 开一场洞内节点战 */
function startBattle(state: GameState, run: WormholeRunState): NonNullable<WormholeRunState['battle']> {
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  g.activated = g.activated.filter((k) => k !== cell.key)
  const r = wormholeStartBattle(state, ctx, 'node', 0)
  expect(r.ok, r.error ?? '').toBe(true)
  return run.battle!
}

/** 推进 seconds 秒（每拍 1 秒） */
function tickSeconds(state: GameState, seconds: number): void {
  for (let i = 0; i < seconds; i++) {
    state.gameMs += 1000
    advanceWormhole(state, ctx)
  }
}

describe('后勤舰 · 我方（维修装置修最缺血的队友）', () => {
  it('后勤舰把维修脉冲指向**三层剩余比例最低的僚舰**（而非自己）', () => {
    const { state, run, logi, wingA } = enterRunWithLogi()
    const battle = startBattle(state, run)
    // 敌舰不开火（隔离测量）：只改运行态冷却
    for (const rt of Object.values(battle.units)) {
      if (rt.side !== 'foe') continue
      for (let i = 0; i < rt.weapons.length; i++) rt.weapons[i] = 9_999_999
    }
    // 后勤舰自己也掉血（且比例更低会不会被自己"抢走"？——本用例让僚舰更低）
    // ⚠ 战斗单位按 **tag** 索引（`player` / `ally-N`），不是舰 id
    const logiRt = battle.units['player']!
    const wingRt = battle.units['ally-1']!
    logiRt.hp = { ...logiRt.hp, a: Math.max(0, logiRt.hp.a - 5) } // 后勤舰轻微受损
    wingRt.hp = { ...wingRt.hp, a: Math.max(1, Math.floor(wingRt.hp.a * 0.2)) } // 僚舰重伤（比例明显更低）
    const wingBefore = { ...wingRt.hp }
    const logiBefore = { ...logiRt.hp }
    tickSeconds(state, 6) // 跨过第一跳（开战 +5 秒）
    const wingAfter = battle.units['ally-1']!.hp
    const logiAfter = battle.units['player']!.hp
    // 僚舰被修（甲 +5）
    expect(wingAfter.a, '僚舰应被修到').toBeGreaterThan(wingBefore.a)
    // 后勤舰自己**这一跳没被修**（它自己也有装置，但脉冲去修更缺血的那艘了）
    expect(logiAfter.a, '后勤舰这一跳不该修自己').toBe(logiBefore.a)
  })

  it('对照：**非后勤舰**装了维修装置仍只修自己（旧口径零变化）', () => {
    const { state, run, wingB, wingA, logi } = enterRunWithLogi()
    // 把后勤舰的维修装置摘掉 ⇒ 本场只有 wingB 那一台装置（对照组隔离干净）
    state.fleet[logi]!.fitted = { ...(state.fleet[logi]!.fitted ?? {}), mid: [] }
    const battle = startBattle(state, run)
    for (const rt of Object.values(battle.units)) {
      if (rt.side !== 'foe') continue
      for (let i = 0; i < rt.weapons.length; i++) rt.weapons[i] = 9_999_999
    }
    const bRt = battle.units['ally-2']!
    const aRt = battle.units['ally-1']!
    bRt.hp = { ...bRt.hp, a: Math.max(1, bRt.hp.a - 8) } // wingB（装了装置）轻微受损
    aRt.hp = { ...aRt.hp, a: Math.max(1, Math.floor(aRt.hp.a * 0.2)) } // wingA（没装）重伤
    const aBefore = aRt.hp.a
    const bBefore = bRt.hp.a
    tickSeconds(state, 6)
    expect(battle.units['ally-2']!.hp.a, 'wingB 修的是自己').toBeGreaterThan(bBefore)
    expect(battle.units['ally-1']!.hp.a, 'wingA 不该被 wingB 修（它不是后勤舰）').toBe(aBefore)
  })

  it('**全场都修不动（甲/结构均满）⇒ 空转**：不耗组件、不动账本', () => {
    const { state, run, logi } = enterRunWithLogi()
    const battle = startBattle(state, run)
    for (const rt of Object.values(battle.units)) {
      if (rt.side !== 'foe') continue
      for (let i = 0; i < rt.weapons.length; i++) rt.weapons[i] = 9_999_999
    }
    // 全员满血（开战即满）⇒ 后勤舰脉冲应空转
    const ledger = repairLedgersOf(battle).find((l) => l.tag === 'player')!.ledger
    const kitsBefore = ledger.kitsUsed
    tickSeconds(state, 6)
    expect(ledger.kitsUsed, '空转不该耗组件').toBe(kitsBefore)
  })
})

/* ═══════════ 判据：数据字段（2026-09-16 船长「并添加到船体特性属性中」）═══════════ */

describe('后勤舰特性 · 判据 = 数据字段 `repairPulseTargetsFleet`', () => {
  it('卡面：亡军后勤舰写了它；**写了的船全部是「后勤舰」子分类**（与 content:check 同一条契约）', () => {
    const logi = SHIPS.find((s) => s.id === LOGI)!
    expect(logi.repairPulseTargetsFleet, '亡军后勤舰应声明该字段').toBe(true)
    expect(logi.subClass).toBe('后勤舰')
    const declared = SHIPS.filter((s) => s.repairPulseTargetsFleet === true)
    expect(declared.length, '现在恰好一艘').toBe(1)
    for (const s of declared) expect(s.subClass, `${s.id} 写了修队友就必须是后勤舰`).toBe('后勤舰')
  })

  it('引擎**读字段、不看子分类**：摘掉字段 ⇒ 退回只修自己；给普通船补上 ⇒ 立刻修队友', () => {
    const state = fresh(31)
    const logi = addShipToFleet(state, LOGI)
    const plain = addShipToFleet(state, T3)
    // 基线
    expect(createPlayerSpec(state, ctx, logi)!.logistics, '后勤舰原样 ⇒ 带 logistics').toBe(true)
    expect(createPlayerSpec(state, ctx, plain)!.logistics, '普通船 ⇒ 不带').toBeUndefined()
    // 补丁上下文（只换 `ships` 表，不动全局数据）
    const ships = new Map(ctx.ships)
    ships.set(LOGI, { ...ctx.ships.get(LOGI)!, repairPulseTargetsFleet: undefined })
    ships.set(T3, { ...ctx.ships.get(T3)!, repairPulseTargetsFleet: true })
    const patched: SimContext = { ...ctx, ships }
    expect(createPlayerSpec(state, patched, logi)!.logistics, '摘掉字段 ⇒ 不再是后勤舰口径').toBeUndefined()
    expect(createPlayerSpec(state, patched, plain)!.logistics, '普通船补上字段 ⇒ 立刻生效').toBe(true)
  })
})

/* ═══════════ 敌方：后勤舰把 50% 名义 DPS 转修理 ═══════════ */

/** 一张只含"补给舰 + 一艘普通敌舰"的合成卡（用于白盒验证修理机制） */
function syntheticCard(): AnomalyDef {
  const base = ctx.anomalies.get('wh-exile-blockade')!
  return {
    ...base,
    ships: [
      { ship: FOE_G_REMNANT_TENDER, count: 1 },
      { ship: FOE_G_ECHO_REMNANT, count: 1 },
    ],
  } as AnomalyDef
}

function foeSpecsOf(): UnitSpec[] {
  return createFoeSpecs(syntheticCard(), ctx.balance.battle)
}

describe('后勤舰 · 敌方（50% 自身 DPS → 修理值）', () => {
  it('舰级登记：T3 巡洋 · repairPct 0.5；名义 DPS = 面板单发 × 1000 ÷ 装填', () => {
    expect(FOE_G_REMNANT_TENDER.hullClassTier).toBe(3)
    expect(FOE_G_REMNANT_TENDER.repairPct).toBe(0.5)
    expect(FOE_G_REMNANT_TENDER.shotDmg).toBe(62) // 数据口径：T3 档基线 124 × 角色 0.50
    const specs = foeSpecsOf()
    const tender = specs.find((s) => s.repairPct !== undefined)!
    expect(tender.repairPct, '补给舰应带 repairPct').toBe(0.5)
    /**
     * 名义 DPS **按战斗中面板现算**（`Σ 单发 × 门数 × 1000 ÷ 装填`）——
     * ⚠ 不能拿数据表的 62 去断言：卡的**按卡归一**会分摊总战力预算，实战面板单发与建档值不同。
     */
    const perShot = tender.weapons.filter((w) => w.src !== 'drone').reduce((s, w) => s + (w.shotDmg ?? 0) * (w.count ?? 1), 0)
    expect(foeNominalDpsOf(tender)).toBeCloseTo((perShot * 1000) / 4000, 6)
    expect(foeNominalDpsOf(tender)).toBeGreaterThan(0)
    for (const s of specs) if (s !== tender) expect(s.repairPct, '其它敌舰不带 repairPct').toBeUndefined()
  })

  it('开火打折：`repairPct = 0.5` ⇒ 单发 ×0.5；无该字段 ⇒ **原值返回**（零行为变化）', () => {
    const [tender, normal] = foeSpecsOf()
    expect(foeRepairDiscountedShot(tender!, 62)).toBe(31)
    expect(foeRepairDiscountedShot(normal!, 62)).toBe(62)
  })

  it('每跳修理 = 名义 DPS × repairPct × 5 秒，修**非后勤**里三层比例最低者；**永不修自己**', () => {
    const specs = foeSpecsOf()
    const tender = specs.find((s) => (s.repairPct ?? 0) > 0)!
    const other = specs.find((s) => (s.repairPct ?? 0) === 0)!
    const battle = createBattleState(
      { ...specs[0]!, tag: 'player', side: 'me' },
      specs,
      0,
      5_000,
    )
    // 补给舰自己掉到最低血（若规则写成"含自己"就会被修）· 普通舰中伤
    battle.units[tender.tag]!.hp = { ...battle.units[tender.tag]!.hp, a: 1, h: 1 }
    const otherRt = battle.units[other.tag]!
    otherRt.hp = { ...otherRt.hp, a: Math.max(1, Math.floor(otherRt.hp.a * 0.5)) }
    const tenderBefore = { ...battle.units[tender.tag]!.hp }
    const otherBefore = { ...otherRt.hp }
    const ledger = { nextPulseAtMs: REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    pulseFoeRepair(battle, specs, ledger)
    const expectHeal = (foeNominalDpsOf(tender) * 0.5 * REPAIR_PULSE_MS) / 1000
    expect(ledger.healed).toBeCloseTo(expectHeal, 3)
    // 普通舰被修（甲优先，上限 = 缺口）
    expect(battle.units[other.tag]!.hp.a).toBeGreaterThan(otherBefore.a)
    // **补给舰自己一点没被修**（船长补充裁定：不以任何后勤舰为目标，含自己）
    expect(battle.units[tender.tag]!.hp.a).toBe(tenderBefore.a)
    expect(battle.units[tender.tag]!.hp.h).toBe(tenderBefore.h)
    expect(ledger.pulses).toBe(1)
  })

  it('**只有一个后勤舰、其它敌舰都满血 ⇒ 空转**（不产生修理、不超满血）', () => {
    const specs = foeSpecsOf()
    const battle = createBattleState({ ...specs[0]!, tag: 'player', side: 'me' }, specs, 0, 5_000)
    const ledger = { nextPulseAtMs: REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    pulseFoeRepair(battle, specs, ledger)
    expect(ledger.healed, '全满 ⇒ 修不动（且不会去修后勤舰自己）').toBe(0)
  })

  it('**回归钉子**：没有 `repairPct` 的敌阵**不会建账本**（`battle.foeRepair` 缺省 ⇒ 零开销零行为）', () => {
    const base = ctx.anomalies.get('wh-exile-blockade')!
    const card = { ...base, ships: [{ ship: FOE_G_ECHO_REMNANT, count: 2 }, { ship: FOE_G_NADIR_LOCK, count: 1 }] } as AnomalyDef
    const specs = createFoeSpecs(card, ctx.balance.battle)
    const battle = createBattleState({ ...specs[0]!, tag: 'player', side: 'me' }, specs, 0, 5_000)
    expect(specs.every((s) => s.repairPct === undefined)).toBe(true)
    // 建档函数（startBattleFor 里的那段）判据 = "敌阵里有没有 repairPct > 0"
    expect(specs.some((f) => (f.repairPct ?? 0) > 0), '本卡不该有后勤舰 ⇒ 不建账本').toBe(false)
    expect(battle.foeRepair).toBeUndefined()
  })
})
