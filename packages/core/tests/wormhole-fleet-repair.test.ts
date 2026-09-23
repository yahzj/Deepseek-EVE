/**
 * **洞内 4 舰编队 · 逐舰维修 / 逐舰护盾充能 / 逐舰组件账本**（2026-09-16 船长裁定「甲：逐舰维修」）。
 *
 * 起因（船长转述玩家报障）：「**玩家反应，船体维修装置在虫洞里无效**」——查实根因：
 * ① 旧口径**只预载主控**（`combat.ts` 的 D 批施工期边界「僚舰修理包不参战」）⇒ 装置装在僚舰上
 *    **完全不工作**（`battle.repair === null`）；② 量级被洞内火力盖过（另案）。
 * 本批按船长「甲」落码：**每艘船各自的装置、各自的组件（本舰货舱优先）、各自被修**；
 * 护盾充能装置同批逐舰化。
 *
 * 本文件锁住六件事：
 * ① **僚舰装置真参战**（装了就有账本、真回血）；
 * ② **组件逐舰各扣各的**（主控货舱的民用件只给主控用，僚舰用僚舰货舱的军用件）；
 * ③ **退款逐舰**（未用组件各回仓库；幂等）；
 * ④ **老档在途战斗兼容**（只有 `repair` 单份 ⇒ 退化成"只有主控修"，即旧行为）；
 * ⑤ **护盾充能逐舰**（僚舰破盾后能被自己的装置点起来）；
 * ⑥ **战报按类型合计全队消耗**（不是只报主控那一份）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { countWare } from '../src/inventory'
import { REPAIR_PULSE_MS, SHIELD_PULSE_MS, refundRepairKitsAll, repairLedgersOf, repairUsageText } from '../src/combat'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { WormholePlace } from '../src/wormholeGrid'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
/** 民用维修装置（吃民用组件，每跳 5/5） */
const REP_CIV = 'mod-hullrep-civ'
/** 军用维修装置（吃军用组件） */
const REP_MIL = 'mod-hullrep-1'
/** 护盾充能装置（MK1，每 15 秒回满盾的一个比例） */
const SHIELD_CHG = 'mod-shieldchg-1'

function fresh(seed = 21): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟 2×T3 编队（主控 = 第一艘；僚舰 = 第二艘） */
function enterRun(seed = 21): { state: GameState; run: WormholeRunState; leader: string; wing: string } {
  const state = fresh(seed)
  /**
   * **本文件全程用「关」模式**（**2026-09-23 船长令**：开关关 = 只从**舰队各舰货仓**取用）——
   * 本文件全部夹具都把组件放在**各舰自己的货仓**里（正是"逐舰各扣各的"那条口径要测的东西）；
   * 缺省（开）会只读母港仓库 ⇒ 夹具里的料看不见。
   */
  state.resupplyFromWarehouse = false
  const a = addShipToFleet(state, T3)
  const b = addShipToFleet(state, T3)
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a, b], seed).ok).toBe(true)
  return { state, run: state.wormhole.run!, leader: a, wing: b }
}

function standOnPlace(run: WormholeRunState, place: WormholePlace): void {
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = place
  g.activated = g.activated.filter((k) => k !== cell.key)
}

/** 开一场洞内节点战并返回 battle */
function startBattle(state: GameState, run: WormholeRunState): NonNullable<WormholeRunState['battle']> {
  standOnPlace(run, 'ship')
  const r = wormholeStartBattle(state, ctx, 'node', 0)
  expect(r.ok, r.error ?? '').toBe(true)
  return run.battle!
}

/** 推进 seconds 秒（每拍 1 秒；洞内战斗在 `advanceWormhole` 里步进） */
function tickSeconds(state: GameState, seconds: number): void {
  for (let i = 0; i < seconds; i++) {
    state.gameMs += 1000
    advanceWormhole(state, ctx)
  }
}

/**
 * **隔离测量用**：把敌舰（含其机群条目）的武器冷却拉到很远 ⇒ 本场敌舰不开火。
 * 为什么需要：层 1 节点敌人对两艘无装配 T3 的火力足以在 30 秒内打沉我方（探针实测），
 * 而"维修脉冲有没有跳、跳了几次、回了多少血"要在**不被击沉**的前提下量。
 * ⚠ 只改运行态冷却（规格每拍重建，冷却表是运行态），不动任何建档口径。
 */
function pacifyFoes(battle: NonNullable<WormholeRunState['battle']>): void {
  for (const rt of Object.values(battle.units)) {
    if (rt.side !== 'foe') continue
    for (let i = 0; i < rt.weapons.length; i++) rt.weapons[i] = 9_999_999
  }
}

describe('虫洞 · 弹药/修理组件「取用来源开关」（2026-09-23 船长令）', () => {
  it('开（缺省）= 只从母港仓库取用：货仓里有料也不动', () => {
    const { state, run, leader } = enterRun()
    state.resupplyFromWarehouse = true
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 30 }
    state.warehouse.items['repairkit-civ'] = 30
    const battle = startBattle(state, run)
    pacifyFoes(battle)
    const rt = battle.units['player']!
    rt.hp.a = Math.max(1, rt.hp.a - 60)
    rt.hp.h = Math.max(1, rt.hp.h - 60)
    tickSeconds(state, 30)
    const used = battle.repairBy?.['player']?.kitsUsed ?? 0
    expect(used).toBeGreaterThan(0)
    expect(state.fleet[leader]!.cargo['repairkit-civ'], '开 = 只仓库 ⇒ 货仓一枚不动').toBe(30)
    expect(state.warehouse.items['repairkit-civ']).toBe(30 - used)
  })

  it('关 = 只从舰队各舰货仓取用：仓库堆满也不用', () => {
    const { state, run, leader } = enterRun() // `enterRun` 已把开关设为「关」
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 30 }
    state.warehouse.items['repairkit-civ'] = 999
    const battle = startBattle(state, run)
    pacifyFoes(battle)
    const rt = battle.units['player']!
    rt.hp.a = Math.max(1, rt.hp.a - 60)
    rt.hp.h = Math.max(1, rt.hp.h - 60)
    tickSeconds(state, 30)
    const used = battle.repairBy?.['player']?.kitsUsed ?? 0
    expect(used).toBeGreaterThan(0)
    expect(state.warehouse.items['repairkit-civ'], '关 = 只货仓 ⇒ 仓库堆满也不许动').toBe(999)
    expect(state.fleet[leader]!.cargo['repairkit-civ']).toBe(30 - used)
  })

  it('**共享池不够分**（玩家报障回归）：不再"谁先预载谁吃干、排在最后的船 0 枚开战即停机"', () => {
    const { state, run, leader, wing } = enterRun()
    state.resupplyFromWarehouse = true
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    // 全队只有 3 枚：旧口径下第一艘会按"整场窗口 121 枚/台"预留 ⇒ 第二艘 0 枚、开战即永久停机
    state.warehouse.items['repairkit-civ'] = 3
    const battle = startBattle(state, run)
    for (const tag of ['player', 'ally-1'] as const) {
      expect(battle.repairBy?.[tag]?.units[0]?.stopped, `${tag} 不该开战即停机`).toBe(false)
    }
    pacifyFoes(battle)
    for (const tag of ['player', 'ally-1'] as const) {
      const rt = battle.units[tag]!
      rt.hp.a = Math.max(1, rt.hp.a - 60)
      rt.hp.h = Math.max(1, rt.hp.h - 60)
    }
    tickSeconds(state, 11) // 5s / 10s 两跳
    const playerUsed = battle.repairBy?.['player']?.kitsUsed ?? 0
    const allyUsed = battle.repairBy?.['ally-1']?.kitsUsed ?? 0
    expect(allyUsed, '排在后面的船也必须拿得到料（本次报障的正题）').toBeGreaterThan(0)
    expect(playerUsed + allyUsed).toBe(3) // 只花掉真实库存这三枚
    expect(state.warehouse.items['repairkit-civ'] ?? 0).toBe(0)
  })
})

describe('虫洞 · 逐舰维修（船长 2026-09-16 裁定「甲」）', () => {
  it('① 僚舰装装置 ⇒ 真参战：有账本、30 秒内被修（对比甲：血量高于不装那组）', () => {
    const run = (fitted: boolean) => {
      const { state, run: whRun, wing } = enterRun()
      state.fleet[wing]!.fitted = fitted ? { high: [], mid: [REP_CIV], low: [] } : { high: [], mid: [], low: [] }
      state.fleet[wing]!.cargo = { 'repairkit-civ': 60 }
      const battle = startBattle(state, whRun)
      if (fitted) expect(battle.repairBy?.['ally-1'], '僚舰的维修账本').toBeTruthy()
      else expect(battle.repairBy?.['ally-1'], '没装装置就不该有账本').toBeUndefined()
      pacifyFoes(battle)
      const rt = battle.units['ally-1']!
      rt.hp.a = Math.max(1, rt.hp.a - 60)
      rt.hp.h = Math.max(1, rt.hp.h - 60)
      tickSeconds(state, 30)
      const after = battle.units['ally-1']!.hp
      return { a: after.a, h: after.h, pulses: battle.repairBy?.['ally-1']?.pulses ?? 0, used: battle.repairBy?.['ally-1']?.kitsUsed ?? 0 }
    }
    const off = run(false)
    const on = run(true)
    expect(off.pulses, '不带装置 ⇒ 0 跳').toBe(0)
    expect(on.pulses, '装了装置 ⇒ 30 秒 6 跳').toBe(Math.floor(30_000 / REPAIR_PULSE_MS))
    expect(on.used).toBe(on.pulses)
    // 敌舰两跑都不开火（隔离）⇒ 血差 = 僚舰自己那台装置的修复量
    expect(on.a + on.h, '僚舰装了装置却没有回血').toBeGreaterThan(off.a + off.h)
  })

  it('② 组件逐舰各扣各的：主控用主控货舱的民用件、僚舰用僚舰货舱的军用件', () => {
    const { state, run, leader, wing } = enterRun()
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.fitted = { high: [], mid: [REP_MIL], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 40 }
    state.fleet[wing]!.cargo = { 'repairkit-mil': 30 }
    const battle = startBattle(state, run)
    const player = battle.repairBy?.['player']
    const ally = battle.repairBy?.['ally-1']
    expect(player?.units[0]?.kitId).toBe('repairkit-civ')
    expect(ally?.units[0]?.kitId).toBe('repairkit-mil')
    /**
     * **按需取用**（**2026-09-23 船长令**：取用改"按需" + 开关）：开战**不预扣**，料各留在自己货仓；
     * 逐舰语义改由"**谁跳谁扣谁自己的**"体现（旧口径是"预载一次抽足、记在各舰账本上"）。
     */
    expect(state.fleet[leader]!.cargo['repairkit-civ'] ?? 0).toBe(40)
    expect(state.fleet[wing]!.cargo['repairkit-mil'] ?? 0).toBe(30)
    pacifyFoes(battle)
    for (const tag of ['player', 'ally-1'] as const) {
      const rt = battle.units[tag]!
      rt.hp.a = Math.max(1, rt.hp.a - 60)
      rt.hp.h = Math.max(1, rt.hp.h - 60)
    }
    tickSeconds(state, 30)
    const civUsed = player!.kitsUsed
    const milUsed = ally!.kitsUsed
    expect(civUsed, '主控跳了就扣自己的民用件').toBeGreaterThan(0)
    expect(milUsed, '僚舰跳了就扣自己的军用件').toBeGreaterThan(0)
    expect(state.fleet[leader]!.cargo['repairkit-civ']).toBe(40 - civUsed)
    expect(state.fleet[wing]!.cargo['repairkit-mil']).toBe(30 - milUsed)
    // ⚠ 关键：僚舰的组件**不是**从主控货仓/仓库扣的（旧口径把僚舰用量记到主控头上）
    expect(state.fleet[leader]!.cargo['repairkit-mil'] ?? 0).toBe(0)
    expect(countWare(state, 'repairkit-civ') + countWare(state, 'repairkit-mil')).toBe(0)
  })

  it('③ 退款逐舰（新口径）：不预载 ⇒ 无料可退；池子只按实际跳掉的枚数减少', () => {
    const { state, run, leader, wing } = enterRun()
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.fitted = { high: [], mid: [REP_MIL], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 40 }
    state.fleet[wing]!.cargo = { 'repairkit-mil': 30 }
    const battle = startBattle(state, run)
    // 新账本 `kits` 为空（不再预留）⇒ 没有"未用组件"这回事
    expect(Object.keys(battle.repairBy?.['player']?.kits ?? {})).toHaveLength(0)
    expect(Object.keys(battle.repairBy?.['ally-1']?.kits ?? {})).toHaveLength(0)
    refundRepairKitsAll(state, battle)
    expect(state.fleet[leader]!.cargo['repairkit-civ'] ?? 0).toBe(40)
    expect(state.fleet[wing]!.cargo['repairkit-mil'] ?? 0).toBe(30)
    expect(countWare(state, 'repairkit-civ')).toBe(0)
    expect(countWare(state, 'repairkit-mil')).toBe(0)
    refundRepairKitsAll(state, battle) // 幂等
    expect(state.fleet[leader]!.cargo['repairkit-civ'] ?? 0).toBe(40)
    expect(countWare(state, 'repairkit-civ')).toBe(0)
  })

  it('④ 老档在途战斗兼容：只有 `repair` 单份 ⇒ 只有主控修（旧行为，零迁移）', () => {
    const { state, run, leader, wing } = enterRun()
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 80 }
    const battle = startBattle(state, run)
    expect(battle.repairBy).toBeTruthy()
    pacifyFoes(battle)
    // 复刻"本批之前开的在途战斗"：抹掉逐舰表，只留主控那一份
    const single = battle.repairBy!['player']!
    battle.repairBy = undefined
    battle.repair = single
    expect(repairLedgersOf(battle)).toHaveLength(1)
    const playerBefore = { ...battle.units['player']!.hp }
    const allyBefore = { ...battle.units['ally-1']!.hp }
    battle.units['player']!.hp.a = Math.max(1, playerBefore.a - 60)
    battle.units['ally-1']!.hp.a = Math.max(1, allyBefore.a - 60)
    tickSeconds(state, 30)
    expect(single.pulses, '主控那一份照旧跳').toBeGreaterThan(0)
    expect(battle.units['ally-1']!.hp.a, '老档里僚舰不该被修（旧行为）').toBeLessThanOrEqual(allyBefore.a)
  })

  it('⑤ 护盾充能装置逐舰：僚舰破盾后能被自己的装置点起来', () => {
    const run = (fitted: boolean) => {
      const { state, run: whRun, wing } = enterRun()
      state.fleet[wing]!.fitted = fitted ? { high: [], mid: [SHIELD_CHG], low: [] } : { high: [], mid: [], low: [] }
      const battle = startBattle(state, whRun)
      pacifyFoes(battle)
      const rt = battle.units['ally-1']!
      rt.hp.s = 0 // 破盾（被动回充在盾 0 时恒为 0 ⇒ 只有充能装置能点起来）
      tickSeconds(state, 31)
      return { s: battle.units['ally-1']!.hp.s, pulses: battle.shieldChargeBy?.['ally-1']?.pulses ?? 0 }
    }
    const off = run(false)
    const on = run(true)
    expect(off.pulses).toBe(0)
    expect(on.pulses, '首跳在开战 +30 秒').toBe(Math.floor(31_000 / SHIELD_PULSE_MS))
    expect(on.s, '僚舰的充能装置没把盾点起来').toBeGreaterThan(off.s)
  })

  it('⑥ 战报按类型合计全队消耗（不只报主控那份）', () => {
    const { state, run, leader, wing } = enterRun()
    state.fleet[leader]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.fitted = { high: [], mid: [REP_MIL], low: [] }
    state.fleet[leader]!.cargo = { 'repairkit-civ': 50 }
    state.fleet[wing]!.cargo = { 'repairkit-mil': 50 }
    const battle = startBattle(state, run)
    battle.repairBy!['player']!.kitsUsed = 2
    battle.repairBy!['player']!.kitsUsedByType = { 'repairkit-civ': 2 }
    battle.repairBy!['ally-1']!.kitsUsed = 3
    battle.repairBy!['ally-1']!.kitsUsedByType = { 'repairkit-mil': 3 }
    const text = repairUsageText(battle, ctx)
    expect(text).toContain('民用修理组件 ×2')
    expect(text).toContain('军用修理组件 ×3')
  })
})
