import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { ceilFinalQuantity } from '../src/quantity'
import { applyDamage, createPlayerSpec, activeFoeSpecsOf } from '../src/combat'
import { createInitialState } from '../src/state'
import { addWare, removeWare, addItem, removeItem } from '../src/inventory'
import { addModule, removeModule } from '../src/equipment'
import { advanceMining, getMiningParams, startMining } from '../src/mining'
import { advanceRefining, refineBatchOutputOf, startRefineRun } from '../src/industry'
import { labBatchUnitsOf } from '../src/lab'
import { matNeedCount } from '../src/manufacturing'
import { placeBuyOrder } from '../src/market'
import { addShipToFleet } from '../src/shipyard'
import { weekendFlagshipHpRemaining } from '../src/weekendEvent'
import type { LabRecipeDef } from '../src/types'
import { makeTestCtx } from './helpers'
import { FIRST_TASKS } from '../src/firstTasks'
import { grantFirstReward } from '../src/firstRewards'
import { moneyAmount, moneyDelta, moneyExact, moneyExactText } from '../src/money'
import { gainAiCore, spendAiCores } from '../src/aiCores'
import { noteStandingEarned, spendStanding } from '../src/standing'

const ctx = buildSimContext()
describe('最终整数数量向上取整，连续量与比例不混用', () => {
  it.each([[0,0],[1,1],[1.01,2],[1.5,2],[.001,1],[-1.2,-1],[100.00001,101]])('%s变为%s', (value, expected) => {
    expect(ceilFinalQuantity(value)).toBe(expected)
  })
  it('整数邻域只吸收浮点噪声，不抹真实小数或极小正值', () => {
    expect(ceilFinalQuantity(150 * 1.08)).toBe(162)
    expect(ceilFinalQuantity(100 + 1e-9)).toBe(101)
    expect(ceilFinalQuantity(1e-20)).toBe(1)
    expect(ceilFinalQuantity(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER - 1)
    expect(Object.is(ceilFinalQuantity(-.1), -0)).toBe(false)
    expect(ceilFinalQuantity(NaN)).toBeNaN()
    expect(ceilFinalQuantity(Infinity)).toBe(Infinity)
  })
  it('仓库、货仓和装备最终写入及消耗使用同一单位，不产生小数库存', () => {
    const state = createInitialState({ nowWallMs: 0 })
    expect(addWare(state, 'test', 1.2)).toBe(true)
    expect(state.warehouse.items.test).toBe(2)
    expect(removeWare(state, 'test', .2)).toBe(true)
    expect(state.warehouse.items.test).toBe(1)
    expect(addItem(state, 'test', .2)).toBe(true)
    expect(state.fleet[state.shipId]!.cargo.test).toBe(1)
    expect(removeItem(state, 'test', .2)).toBe(true)
    expect(state.fleet[state.shipId]!.cargo.test).toBeUndefined()
    addModule(state, 'test', 1.1)
    expect(state.moduleBay.test).toBe(2)
    expect(removeModule(state, 'test', .1)).toBe(true)
    expect(state.moduleBay.test).toBe(1)
  })
  it('玩家和所有敌卡各层建档HP为整数，抗性与回避仍为原小数', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.skills.trained['hull-reinforcement'] = 1
    const me = createPlayerSpec(state, ctx, state.shipId)!
    for (const hp of Object.values(me.hp)) expect(Number.isInteger(hp)).toBe(true)
    for (const card of ctx.anomalies.values()) for (let i = 0; i < (card.waves?.length ?? 1); i++) {
      for (const foe of activeFoeSpecsOf(card, ctx.balance.battle, i)) {
        for (const hp of Object.values(foe.hp)) expect(Number.isInteger(hp), `${card.id}/${foe.tag}`).toBe(true)
      }
    }
    const scout = ctx.ships.get('sh-nautilus')!
    state.shipId = addShipToFleet(state, scout.id)
    expect(createPlayerSpec(state, ctx, state.shipId)!.evasion).toBeCloseTo(scout.evasion!, 12)
  })
  it('抗性与混伤中间扣血保留精度；跨层扣血不超现有HP', () => {
    const res = { hull: { kinetic: .3 } }
    const hit = applyDamage({ s: 0, a: 0, h: 100 }, res, 1.1, 'kinetic')
    expect(hit.dealt).toBeCloseTo(.77, 12)
    expect(hit.hp.h).toBeCloseTo(99.23, 12)
    expect(res.hull.kinetic).toBe(.3)
    const lethal = applyDamage({ s: .1, a: .2, h: .3 }, {}, 100, 'kinetic')
    expect(lethal.hp).toEqual({ s: 0, a: 0, h: 0 })
    expect(lethal.dealt).toBeCloseTo(.6)
  })
  it('材料与单批产物在最终边界上取整，预览函数即实际数量来源', () => {
    const state = createInitialState({ nowWallMs: 0 })
    expect(matNeedCount(state, 10.1)).toBe(11)
    const recipe: LabRecipeDef = { id: 'test', category: 'fuel', name: 'test', outputItemId: 'jump-fuel', outputUnits: 2.1, cycleMs: 1000, materials: [] }
    expect(labBatchUnitsOf(state, recipe)).toBe(3)
    const mineral = [...ctx.items.values()].find(item => item.kind === 'mineral')!
    const rows = refineBatchOutputOf(state, ctx, { ...mineral, refine: [{ mineralId: mineral.id, perOre: .0101 }] }, 100)
    expect(rows).toEqual([{ mineralId: mineral.id, units: 2 }])
    const belt = [...ctx.belts.values()].find(belt => !belt.outputs?.length)!
    const params = getMiningParams(state, ctx, { beltId: belt.id })
    expect(params).toBeTruthy()
    expect(Number.isInteger(params!.unitsPerCycle)).toBe(true)
  })
  it('挂单扣款与验证读取相同向上取整单价，可买上限仍受钱包限制', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.wallet.isk = 20
    const good = [...ctx.marketGoods.values()].find(good => good.kind === 'item' && good.rarity === 'common')!
    const order = placeBuyOrder(state, ctx, good.key, 10.1, 2)
    expect(order).toBeTruthy()
    expect(order!.price).toBe(11)
    expect(order!.qty).toBe(1)
    expect(state.wallet.isk).toBe(9)
  })
  it('共享池最终入场向上取整，但章鱼连续削血账本不变', () => {
    const event = { seq: 1, family: 'D', coreId: 'galaxy-maw', peripheryIds: [], contributed: {}, startedAtWallMs: 1,
      flagshipHpMax: 1000, flagshipHpDone: 899, octopusHpDone: .75 }
    const before = structuredClone(event)
    expect(weekendFlagshipHpRemaining(event)).toBe(101)
    expect(event).toEqual(before)
  })
  it('采矿小数单批产量只在完整循环兑现，拆步与整段推进等价', () => {
    const c = makeTestCtx({ quietEvents: true, marketGoods: [] })
    const a = createInitialState({ nowWallMs: 0, seed: 42 })
    a.skills.trained.mining = 1
    expect(startMining(a, 'belt-a', c).ok).toBe(true)
    const b = structuredClone(a)
    const p = getMiningParams(a, c, { beltId: 'belt-a' })!
    expect(p.unitsPerCycle).toBe(11)
    advanceMining(a, p.cycleMs * 3 + 1, c)
    for (const delta of [1, p.cycleMs - 1, 1, p.cycleMs - 1, p.cycleMs + 1]) advanceMining(b, delta, c)
    expect(b.fleet[b.shipId]!.cargo).toEqual(a.fleet[a.shipId]!.cargo)
    expect(b.mining).toEqual(a.mining)
    expect(b.rng).toEqual(a.rng)
    expect(a.mining.tripUnits).toBeGreaterThanOrEqual(3 * p.unitsPerCycle)
  })
  it('精炼按完整批次取整，分段等待不会多产，余料不足整批仍保留', () => {
    const c = makeTestCtx({ quietEvents: true, marketGoods: [] })
    const a = createInitialState({ nowWallMs: 0, seed: 42 })
    a.skills.trained.refining = 5
    a.warehouse.items['ore-a'] = 35
    expect(startRefineRun(a, 'ore-a', 'pilot', c).ok).toBe(true)
    const cycle = a.refineRuns[0]!.cycleMs
    const b = structuredClone(a)
    a.gameMs = cycle * 3 + 1
    advanceRefining(a, c)
    for (const delta of [1, cycle - 1, 1, cycle - 1, cycle + 1]) {
      b.gameMs += delta
      advanceRefining(b, c)
    }
    expect(a.warehouse.items['min-b']).toBe(24)
    expect(a.warehouse.items['ore-a']).toBe(5)
    expect(b.warehouse).toEqual(a.warehouse)
    expect(b.refineRuns).toEqual(a.refineRuns)
  })
  it('首次奖励、AI核心和声望写入与扣除都按最终整数，日志不显示未到账的小数', () => {
    const state = createInitialState({ nowWallMs: 0 })
    state.aiCores.basic = 0
    const before = state.wallet.isk
    grantFirstReward(state, ctx, { ...FIRST_TASKS[0]!, reward: { isk: 10.1,
      blueprints: [{ blueprintId: 'test', units: 1.1 }], ware: [{ itemId: 'test', units: 1.1 }],
      modules: [{ moduleId: 'test', units: 1.1 }], aiCores: [{ type: 'basic', units: 1.1 }] } }, (_, id) => id)
    expect(state.wallet.isk - before).toBe(11)
    expect(state.blueprintStock.test).toBe(2)
    expect(state.warehouse.items.test).toBe(2)
    expect(state.moduleBay.test).toBe(2)
    expect(state.aiCores.basic).toBe(2)
    expect(state.logs.at(-1)!.text).not.toContain('1.1')
    gainAiCore(state, 'basic', .1)
    expect(state.aiCores.basic).toBe(3)
    expect(spendAiCores(state, 'basic', 1.1)).toBe(true)
    expect(state.aiCores.basic).toBe(1)
    noteStandingEarned(state, 'test', 1.1)
    expect(state.standings.test).toBe(2)
    expect(spendStanding(state, 'test', .1)).toBe(true)
    expect(state.standings.test).toBe(1)
    expect(state.standingsEarned!.test).toBe(2)
  })
  it('中英金额精确显示统一向上取整，正负号和英文单复数正确', () => {
    expect(moneyExact(1.1)).toBe('2')
    expect(moneyAmount(1.1, 'en')).toBe('2')
    expect(moneyExact(-1.2)).toBe('-1')
    expect(moneyExact(-.1)).toBe('0')
    expect(moneyAmount(-1.2, 'en')).toBe('-1')
    expect(moneyDelta(-1.2, 'en')).toBe('−1')
    expect(moneyExactText(.1, 'en')).toBe('1 credit')
    expect(moneyExactText(1.1, 'en')).toBe('2 credits')
  })
})
