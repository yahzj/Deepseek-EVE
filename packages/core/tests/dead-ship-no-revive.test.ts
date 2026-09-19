/**
 * **报障修复：阵亡（三层全 0）的单位不可被任何维修路径拉回场上**
 * （船长 2026-09-19 转述玩家：「**生物损管腔之类的修理会让已经损毁的船复活**」）。
 *
 * 根因：`battle.units` 里的尸体**永不摘除**（多波增援 / 战报 / "在场过 = 存在"这一条都靠它），
 * 而维修脉冲原先只查「甲 + 结构是否已满」，**不查存活** ⇒ 三条路都会把尸体修活：
 * ① 本舰自己的无消耗自愈件（生体损管腔 / 生体甲壳板，`repairFree`）；
 * ② 本舰自己的船体维修装置（耗组件，还会白扣一枚）；
 * ③ 后勤舰的选靶（「三层剩余比例最低的队友」在尸体上恒为 0 ⇒ **永远首选尸体**）。
 * 敌方侧同一根因：阵亡的敌舰会被自家后勤修活，且**阵亡的后勤舰照旧供血**。
 *
 * 为什么必须修（后果面）：洞内收口按「三层全 0」判沉船（`wormholeBattle.sunkShipIds`）⇒
 * 被修活的船**照常归队**（玩家的"已沉没"舰船复活、连船带货一起保住）；
 * 同一条路还会让「我方全灭判负」永远触发不了（场上永远留着一条 4 点结构的船）。
 *
 * 判据与既有三处**同一把尺**：`combat.isAlive`（`hp.s/​hp.a/​hp.h` 任一 > 0）——
 * 被动护盾回充（`stepBattle`）与护盾充能脉冲（`pulseShieldChargeFor`）**本来就查存活**，
 * 只有维修脉冲这两处漏了。本文件把四条通道一起钉住。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { REPAIR_PULSE_MS, createBattleState, createFoeSpecs, pulseFoeRepair, repairLedgersOf } from '../src/combat'
import type { UnitSpec } from '../src/combat'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
/** 我方后勤舰（唯一带 `repairPulseTargetsFleet` 的船：维修脉冲改修最缺血的队友） */
const LOGI = 'sh-wh-g-destroyer'
/** 民用船体维修装置（每跳甲/结构各 5，耗民用组件） */
const REP_CIV = 'mod-hullrep-civ'
/** 无消耗自愈件（结构）：每 5 秒平值自修 4 点结构（= 玩家报障里点名的「生体损管腔」） */
const FREE_DC = 'mod-lair-dc-c'
const shipOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)!

function fresh(seed = 5): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟 2×T3 编队（主控 = 第一艘；僚舰 = 第二艘） */
function enterT3Run(seed: number): { state: GameState; run: WormholeRunState; leader: string; wing: string } {
  const state = fresh(seed)
  const leader = addShipToFleet(state, T3)
  const wing = addShipToFleet(state, T3)
  state.shipId = leader
  expect(wormholeEnter(state, ctx, [leader, wing], seed).ok).toBe(true)
  return { state, run: state.wormhole.run!, leader, wing }
}

/** 开一场洞内节点战并返回 battle */
function startBattle(state: GameState, run: WormholeRunState): NonNullable<WormholeRunState['battle']> {
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  g.activated = g.activated.filter((k) => k !== cell.key)
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

/** 敌舰不开火（隔离测量）：只改运行态冷却，不动建档口径 */
function pacifyFoes(battle: NonNullable<WormholeRunState['battle']>): void {
  for (const rt of Object.values(battle.units)) {
    if (rt.side !== 'foe') continue
    for (let i = 0; i < rt.weapons.length; i++) rt.weapons[i] = 9_999_999
  }
}

/** 打成"三层全 0"= 引擎判沉船的同一把尺 */
function sink(battle: NonNullable<WormholeRunState['battle']>, tag: string): void {
  battle.units[tag]!.hp = { s: 0, a: 0, h: 0 }
}

/** 三层合计（> 0 即引擎口径的"活着"） */
function hpSum(battle: NonNullable<WormholeRunState['battle']>, tag: string): number {
  const h = battle.units[tag]!.hp
  return h.s + h.a + h.h
}

describe('报障：阵亡单位不可被修活（船长 2026-09-19 转述玩家）', () => {
  it('① 无消耗自愈件（生体损管腔）不会把阵亡的**自己**修活', () => {
    const { state, run, wing } = enterT3Run(5)
    state.fleet[wing]!.fitted = { high: [], mid: [FREE_DC], low: [] }
    const battle = startBattle(state, run)
    expect(repairLedgersOf(battle).find((l) => l.tag === 'ally-1'), '僚舰该有自愈账本').toBeTruthy()
    pacifyFoes(battle)
    sink(battle, 'ally-1')
    tickSeconds(state, 11) // 跨过两跳（开战 +5s / +10s）
    expect(hpSum(battle, 'ally-1'), '阵亡单位被自己的自愈件修活了').toBe(0)
  })

  it('② 船体维修装置不会把阵亡的**自己**修活（也不白扣组件）', () => {
    const { state, run, wing } = enterT3Run(6)
    state.fleet[wing]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.fleet[wing]!.cargo = { 'repairkit-civ': 40 }
    const battle = startBattle(state, run)
    pacifyFoes(battle)
    const ledger = repairLedgersOf(battle).find((l) => l.tag === 'ally-1')!.ledger
    const kitsBefore = ledger.kitsUsed
    sink(battle, 'ally-1')
    tickSeconds(state, 11)
    expect(hpSum(battle, 'ally-1'), '阵亡单位被自己的维修装置修活了').toBe(0)
    expect(ledger.kitsUsed, '尸体上不该扣组件').toBe(kitsBefore)
  })

  it('③ 后勤舰不会拉起阵亡僚舰：这一跳改修活着的重伤僚舰', () => {
    const state = fresh(7)
    const logi = addShipToFleet(state, LOGI)
    const wingA = addShipToFleet(state, T3)
    const wingB = addShipToFleet(state, T3)
    state.shipId = logi
    expect(wormholeEnter(state, ctx, [logi, wingA, wingB], 7).ok).toBe(true)
    const run = state.wormhole.run!
    state.fleet[logi]!.fitted = { high: [], mid: [REP_CIV], low: [] }
    state.warehouse.items['repairkit-civ'] = 200
    const battle = startBattle(state, run)
    expect(battle.units['ally-1']!.hp.h + battle.units['ally-1']!.hp.a, '僚舰 A 应满血入场').toBeGreaterThan(0)
    pacifyFoes(battle)
    // 僚舰 B 重伤（活着）· 僚舰 A 阵亡（尸体的"剩余比例"恒为 0，旧口径必然首选它）
    const bRt = battle.units['ally-2']!
    bRt.hp = { ...bRt.hp, a: Math.max(1, Math.floor(bRt.hp.a * 0.3)) }
    const bBefore = bRt.hp.a
    sink(battle, 'ally-1')
    tickSeconds(state, 6)
    expect(hpSum(battle, 'ally-1'), '阵亡僚舰被后勤舰修活了').toBe(0)
    expect(battle.units['ally-2']!.hp.a, '后勤舰本该去修活着的重伤僚舰').toBeGreaterThan(bBefore)
  })

  it('④ 敌方后勤不会把阵亡敌舰修活', () => {
    const specs = foeSpecsOf()
    const tender = specs.find((s) => (s.repairPct ?? 0) > 0)!
    const other = specs.find((s) => (s.repairPct ?? 0) === 0)!
    const battle = createBattleState({ ...specs[0]!, tag: 'player', side: 'me' }, specs, 0, 5_000)
    sink(battle, other.tag)
    const ledger = { nextPulseAtMs: REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    pulseFoeRepair(battle, specs, ledger)
    expect(hpSum(battle, other.tag), '阵亡敌舰被自家后勤修活了').toBe(0)
    expect(ledger.healed, '没有可修目标 ⇒ 这一跳不该有修理量').toBe(0)
    expect(tender.repairPct, '本用例前提：卡里有后勤舰').toBe(0.5)
  })

  it('⑤ 阵亡的敌方后勤舰不再供血（尸体不产生修理值）', () => {
    const specs = foeSpecsOf()
    const tender = specs.find((s) => (s.repairPct ?? 0) > 0)!
    const other = specs.find((s) => (s.repairPct ?? 0) === 0)!
    const battle = createBattleState({ ...specs[0]!, tag: 'player', side: 'me' }, specs, 0, 5_000)
    const otherRt = battle.units[other.tag]!
    otherRt.hp = { ...otherRt.hp, a: Math.max(1, Math.floor(otherRt.hp.a * 0.5)) }
    const before = otherRt.hp.a
    sink(battle, tender.tag)
    const ledger = { nextPulseAtMs: REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    pulseFoeRepair(battle, specs, ledger)
    expect(ledger.healed, '后勤舰已阵亡 ⇒ 不该再产生修理值').toBe(0)
    expect(battle.units[other.tag]!.hp.a, '阵亡后勤舰不该继续修活着的同伴').toBe(before)
  })

  it('⑥ 收口照常判损：被击沉的僚舰在整趟结算里仍然算沉船（不会复活归队）', () => {
    const { state, run, leader, wing } = enterT3Run(8)
    state.fleet[wing]!.fitted = { high: [], mid: [FREE_DC], low: [] }
    const battle = startBattle(state, run)
    pacifyFoes(battle)
    sink(battle, 'ally-1')
    tickSeconds(state, 11)
    battle.ended = 'me' // 强制收口：收口路径只认 ended
    tickSeconds(state, 5) // 越过击杀慢镜（`bal.killcamMs`）后收口才落地
    expect(state.fleet[wing], '被击沉的僚舰应已从舰队移除（船 + 货仓 + 装备全损）').toBeUndefined()
    expect(state.fleet[leader], '主控仍在').toBeTruthy()
  })
})

/* ═══════════ 敌方后勤舰的合成卡（与 logistics-repair.test.ts 同一口径）═══════════ */

/** 一张只含"补给舰 + 一艘普通敌舰"的合成卡 */
function syntheticCard(): AnomalyDef {
  const base = ctx.anomalies.get('wh-exile-blockade')!
  return {
    ...base,
    ships: [
      { ship: shipOf('foe-g-remnant-tender'), count: 1 },
      { ship: shipOf('foe-g-echo-remnant'), count: 1 },
    ],
  } as AnomalyDef
}

function foeSpecsOf(): UnitSpec[] {
  return createFoeSpecs(syntheticCard(), ctx.balance.battle)
}
