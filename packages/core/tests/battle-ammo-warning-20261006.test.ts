import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, type GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { ammoLoadTotals, createPlayerSpec, startFleetBattleFor } from '../src/combat'
import { loadAmmoTier } from '../src/combatAmmo'
import { battleAmmoPreloadPlan } from '../src/battleAmmoPreflight'
import { wormholePreparationPlan, wormholeEnterPrepared } from '../src/wormholePreparation'
import { wormholeEnter } from '../src/wormhole'
import { wormholeStartBattle } from '../src/wormholeBattle'
import { wormholeHoldStow } from '../src/wormholeSalvage'
import { gameSaveMethods, ROOT } from './helpers/save-shell'
import type { CommandResult } from '../src/engine'

const ctx = buildSimContext()
const BASE = 'ammo-kinetic-l'
const MK2 = 'ammo-kinetic-2'
function setup(count = 2) {
  const state = createInitialState({ nowWallMs: 0, seed: 7, prologue: true })
  const fleet = Array.from({ length: count }, () => addShipToFleet(state, 'sh-thresher'))
  state.shipId = fleet[0]!
  for (const uid of fleet) state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  const need = ammoLoadTotals(createPlayerSpec(state, ctx, fleet[0]!)!, ctx.balance.battle, state).kinetic!
  return { state, fleet, need }
}

describe('预警装弹读数与真实装载同源', () => {
  it('四舰只分一次共享仓库，主控优先，重复实例不多算；只读预览不改随机数或库存', () => {
    const { state, fleet, need } = setup(4)
    state.warehouse.items = { [BASE]: need + 7 }
    const before = structuredClone(state)
    const plan = battleAmmoPreloadPlan(state, ctx, [...fleet.slice(1), fleet[0]!, fleet[0]!])
    expect(plan.source).toBe('warehouse')
    expect(plan.rows.map(row => [row.shipId, row.can, row.missing])).toEqual([
      [fleet[0], need, 0], [fleet[1], 7, need - 7], [fleet[2], 0, need], [fleet[3], 0, need],
    ])
    expect(state).toEqual(before)
    const cardId = [...ctx.anomalies.keys()].find(id => id.startsWith('wh-'))!
    expect(cardId).toBeTruthy()
    const actual = startFleetBattleFor(state, ctx, [...fleet.slice(1), fleet[0]!], cardId, 0)!
    expect(actual.ammo.kin).toBe(plan.rows.reduce((sum, row) => sum + row.can, 0))
    expect(state.warehouse.items[BASE] ?? 0).toBe(0)
  })
  it.each([true, false])('取用开关%s只算实际可取来源，包括选档回落的现行口径', warehouse => {
    const { state, fleet, need } = setup()
    state.resupplyFromWarehouse = warehouse
    state.warehouse.items = { [BASE]: 4, [MK2]: need * 3 }
    state.fleet[fleet[0]!]!.cargo = { [BASE]: 3, [MK2]: 2 }
    state.fleet[fleet[1]!]!.cargo = { [MK2]: 5000 }
    state.fleet[fleet[0]!]!.ammoPref = { kinetic: BASE }
    const before = structuredClone(state)
    const plan = battleAmmoPreloadPlan(state, ctx, fleet)
    expect(plan.source).toBe(warehouse ? 'warehouse' : 'cargo')
    const clone = structuredClone(state)
    for (const row of plan.rows) {
      const actual = loadAmmoTier(clone, ctx, row.shipId, row.type, row.need)
      expect([row.itemId, row.can, row.missing]).toEqual([actual.id, actual.loaded, row.need - actual.loaded])
    }
    expect(state).toEqual(before)
    expect(plan.rows.reduce((n, row) => n + row.can, 0)).toBe(warehouse ? need * 2 : need + 3)
  })
  it('混装逐弹种独立检查；纯无人机与无武器不误报缺弹', () => {
    const { state, fleet } = setup()
    state.fleet[fleet[0]!]!.fitted.high.push('mod-missile-1')
    const rows = battleAmmoPreloadPlan(state, ctx, fleet).rows
    expect(new Set(rows.map(row => row.type))).toEqual(new Set(['kinetic', 'explosive']))
    expect(rows.every(row => row.need > 0 && row.can === 0)).toBe(true)
    for (const uid of fleet) state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
    state.fleet[fleet[0]!]!.droneLoad = { 'drone-scout': 2 }
    expect(battleAmmoPreloadPlan(state, ctx, fleet).rows).toEqual([])
  })
  it('破片炮只检查爆破弹，基础不足时按真实规则采用MK3而非动能', () => {
    const { state, fleet } = setup(1)
    state.fleet[fleet[0]!]!.fitted.high = ['mod-wh-a-frag']
    state.warehouse.items = { 'ammo-kinetic-l': 100_000, 'ammo-explosive-l': 3, 'ammo-explosive-3': 11 }
    state.fleet[fleet[0]!]!.ammoPref = { explosive: 'ammo-explosive-3' }
    const before = structuredClone(state)
    const rows = battleAmmoPreloadPlan(state, ctx, fleet).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'explosive', itemId: 'ammo-explosive-3', can: 11 })
    expect(rows[0]!.missing).toBe(rows[0]!.need - 11)
    expect(state).toEqual(before)
  })
  it('信号空间谜质加速增加真实预载需求，预警与实际预载一致', () => {
    const { state, fleet } = setup()
    state.warehouse.items = { [BASE]: 10000 }
    expect(wormholeEnter(state, ctx, fleet, 7).ok).toBe(true)
    expect(wormholeHoldStow(state, ctx, 'mat-reload').ok).toBe(true)
    const normal = battleAmmoPreloadPlan(state, ctx, fleet)
    const preview = battleAmmoPreloadPlan(state, ctx, fleet, undefined, true)
    expect(preview.rows[0]!.need).toBeGreaterThan(normal.rows[0]!.need)
    const run = state.wormhole.run!
    const cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.place = 'ship'
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(run.battle!.ammo.kin).toBe(preview.rows.reduce((n, row) => n + row.can, 0))
  })
  it('有限物资按同一快照选档，库存分配不重复，母港富余不掩盖本趟缺口', () => {
    const { state, fleet } = setup()
    state.warehouse.items = { [BASE]: 100000, [MK2]: 100000 }
    const prep = wormholePreparationPlan(state, ctx, fleet, { targets: { [BASE]: 5, [MK2]: 6 }, unload: [] })
    expect(prep.ok).toBe(true)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, prep).ok).toBe(true)
    const run = state.wormhole.run!
    const before = structuredClone(state)
    const plan = battleAmmoPreloadPlan(state, ctx, fleet, run.supplies!.items, true)
    expect(plan.source).toBe('expedition')
    expect(plan.rows.map(row => row.itemId)).toEqual([MK2, MK2])
    expect(plan.rows.map(row => row.can)).toEqual([6, 0])
    expect(state).toEqual(before)
    const cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.place = 'ship'
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(run.battle!.expeditionAmmo!.loaded[MK2]).toBe(6)
    expect(run.supplies!.items[BASE]).toBe(5)
  })
})

function warningProbe() {
  const { state, fleet, need } = setup(1)
  const clock = { now: 1000 }
  const notify = vi.fn(), persist = vi.fn()
  const methods = gameSaveMethods(['withBattleAmmoWarning', 'withActivitySwitch'], {
    Date: { now: () => clock.now }, structuredClone, battleAmmoPreloadPlan,
    ACTIVITY_CONFIRM_ID: 'confirm-activity', SWITCH_ASK_MS: 30000,
    haltCurrentActivity: (s: GameState) => { s.mining.active = false; return 'mining' },
    shipDisplayName: () => '测试舰', tr: (id: string, params?: unknown) => `${id}:${JSON.stringify(params)}`,
  })
  Object.assign(methods, { state, ctx, ammoAsk: null, switchAsk: null, notify, persist })
  const warn = methods.withBattleAmmoWarning as (key: string, ships: string[], run: () => CommandResult, supplies?: Record<string, number>, preflight?: (s: GameState) => CommandResult) => CommandResult
  return { state, fleet, need, clock, methods, warn: warn.bind(methods), notify, persist }
}

describe('真实开战外壳软确认', () => {
  it('首击列清可装/需量/缺额，不扣弹不停止活动；30秒内同按钮二击才执行', () => {
    const p = warningProbe()
    p.state.mining.active = true
    const before = structuredClone(p.state)
    const run = vi.fn(() => ({ ok: true }))
    const first = p.warn('fight', p.fleet, run)
    expect(first.ok).toBe(false)
    expect(first.errorId).toBe('ui.battleAmmo.001')
    expect(first.errorParams!.details).toContain(`"missing":${p.need}`)
    expect(p.state).toEqual(before)
    expect(run).not.toHaveBeenCalled()
    expect(p.notify).not.toHaveBeenCalled()
    expect(p.persist).not.toHaveBeenCalled()
    expect(p.warn('fight', p.fleet, run).ok).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(p.methods.ammoAsk).toBeNull()
  })
  it.each(['expire', 'button', 'fleet', 'stock', 'source', 'fit'])('%s变化后重新提示，不沿用旧确认', change => {
    const p = warningProbe()
    const run = vi.fn(() => ({ ok: true }))
    p.warn('fight', p.fleet, run)
    let key = 'fight'
    if (change === 'expire') p.clock.now += 30001
    if (change === 'button') key = 'other-fight'
    if (change === 'fleet') p.fleet.push(addShipToFleet(p.state, 'sh-thresher'))
    if (change === 'stock') p.state.warehouse.items[MK2] = 1
    if (change === 'source') p.state.resupplyFromWarehouse = false
    if (change === 'fit') p.state.fleet[p.fleet[0]!]!.fitted.high.push('mod-turret-kin-1')
    expect(p.warn(key, p.fleet, run).ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
  it('装弹足量直接执行；无效目标/活动硬拒保留原错误，校验只动副本', () => {
    const p = warningProbe()
    const run = vi.fn(() => ({ ok: false, errorId: 'original-error' }))
    const before = structuredClone(p.state)
    expect(p.warn('fight', p.fleet, run, undefined, clone => { clone.warehouse.items[BASE] = 9999; return { ok: false } })).toEqual({ ok: false, errorId: 'original-error' })
    expect(p.state).toEqual(before)
    p.state.warehouse.items[BASE] = p.need
    const success = vi.fn(() => ({ ok: true }))
    expect(p.warn('fight', p.fleet, success).ok).toBe(true)
    expect(success).toHaveBeenCalledTimes(1)
  })
  it('与活动切换两段确认叠加只需依次确认，不重复弹药警告', () => {
    const p = warningProbe()
    p.state.mining.active = true
    const command = () => p.state.mining.active ? { ok: false, errorId: 'confirm-activity' } : { ok: true }
    const switchActivity = p.methods.withActivitySwitch as (key: string, run: () => CommandResult) => CommandResult
    const run = () => switchActivity.call(p.methods, 'expedition', command)
    expect(p.warn('fight', p.fleet, run).errorId).toBe('ui.battleAmmo.001')
    expect(p.warn('fight', p.fleet, run).errorId).toBe('confirm-activity')
    expect(p.warn('fight', p.fleet, run).ok).toBe(true)
    expect(p.state.mining.active).toBe(false)
  })
  it('不相关矿物入库或货仓矿石变化不会让同一弹药缺口的二次确认失效', () => {
    const p = warningProbe()
    const run = vi.fn(() => ({ ok: true }))
    p.warn('fight', p.fleet, run)
    p.state.warehouse.items['ore-veldspar'] = 100
    p.state.fleet[p.fleet[0]!]!.cargo['ore-veldspar'] = 20
    expect(p.warn('fight', p.fleet, run).ok).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('不改变预载需求的维修心跳不会持续重置确认；弹药补足后无需第二次点击', () => {
    const p = warningProbe()
    const run = vi.fn(() => ({ ok: true }))
    p.warn('fight', p.fleet, run)
    p.state.fleet[p.fleet[0]!]!.armorPct = 0.99
    expect(p.warn('fight', p.fleet, run).ok).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    p.warn('fight', p.fleet, run)
    p.state.warehouse.items[BASE] = p.need
    expect(p.warn('fight', p.fleet, run).ok).toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('载入另一份相同内容的存档仍需重新确认，不继承旧会话首击', () => {
    const p = warningProbe()
    const run = vi.fn(() => ({ ok: true }))
    p.warn('fight', p.fleet, run)
    p.methods.state = structuredClone(p.state)
    expect(p.warn('fight', p.fleet, run).ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
  it('所有手动战斗入口复用同一警告；关闭重复作战不被缺弹拦住', () => {
    const names = ['startExpeditionAt', 'startExpeditionFromMiningAt', 'startLairExpeditionAt', 'challengeWeekendFlagship', 'fightEncounterNow',
      'bountyLoopAt', 'invasionLoopAt', 'assignAiExpeditionAt', 'wormholeFight', 'wormholeTravel', 'wormholeActivate']
    const methods = gameSaveMethods(names, { weekendSanitizeFlagshipSquad: () => ['chosen'], weekendPrepSquadOf: () => ['default'],
      Date: { now: () => 1 }, wormholeTravelTo: (s: GameState) => { s.wormhole.run!.battle = {} as never; return { ok: true } },
      wormholeActivateAt: (s: GameState) => { s.wormhole.run!.battle = {} as never; return { ok: true } }, structuredClone })
    const state = setup(1).state
    state.wormhole.run = { fleet: [state.shipId] } as never
    const warn = vi.fn(() => ({ ok: false, error: 'warning' }))
    const stop = vi.fn(() => ({ ok: true }))
    Object.assign(methods, { state, ctx, withBattleAmmoWarning: warn, withWormholeAmmoWarning: warn, bountyLoopReady: stop, invasionLoopReady: stop })
    const inputs: unknown[][] = [['card'], ['card'], ['card', 1], [['chosen']], [], ['card'], ['galaxy'], ['ship', 'basic', 'card'], ['node'], [1, 2], []]
    for (const [i, name] of names.entries()) {
      expect((methods[name] as (...args: unknown[]) => CommandResult).apply(methods, inputs[i]!)).toEqual({ ok: false, error: 'warning' })
    }
    expect(warn).toHaveBeenCalledTimes(names.length)
    for (const name of ['bountyLoopAt', 'invasionLoopAt']) expect((methods[name] as (id: null) => CommandResult).call(methods, null).ok).toBe(true)
    expect(stop).toHaveBeenCalledTimes(2)
  })
  it('警告文本分行、旗舰提示有alert语义，多行警告延长阅读时间且有高度边界', () => {
    const css = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/styles.css'), 'utf8')
    const app = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/App.tsx'), 'utf8')
    const prep = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/panels/WeekendFlagshipPrep.tsx'), 'utf8')
    expect(css).toMatch(/\.app-toast\s*\{[^}]*white-space:\s*pre-line/s)
    expect(css).toMatch(/\.app-toast\s*\{[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/\.app-root\.is-mobile-rot \.app-toast\s*\{[^}]*max-height: calc\(var\(--mob-h/s)
    expect(app).toContain("warn && text.includes('\\n') ? 15_000 : 3200")
    expect(prep).toContain('app-battle-ammo-warning" role="alert"')
  })
})
