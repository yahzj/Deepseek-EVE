import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { buildSimContext } from '@whale/data'
import { activityOverview } from '../src/activity'
import { advanceAi, aiTaskView, aiEfficiency, assignAiMining, assignAiSalvage } from '../src/ai'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceGame } from '../src/engine'
import { advanceAutoLoopInvasion, advanceExpedition, expeditionStatus, resolveBattleOutcome, retreatBattle, setAutoLoopInvasion, startExpedition } from '../src/expedition'
import { addShipToFleet } from '../src/fleetBook'
import { startRefineRun } from '../src/industry'
import { jumpFuelLegMsOf, jumpFuelStockOf } from '../src/jumpFuel'
import { miningReturnLegMs } from '../src/location'
import { advanceMining, advanceShipReturns, getMiningParams, miningStatus, oneLegMs, oneOutboundLegMs, startMining, stopMining } from '../src/mining'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceSalvageOp, legMsFor, outboundLegMsFor, salvageReturnMs, salvagerCyclesOf, startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { changeShip, changeShipBlockReason } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { scaledReturnMs } from '../src/trips'
import { anomaly, belt, makeTestCtx, moduleDef, ship } from './helpers'

afterEach(() => vi.restoreAllMocks())
type Work = 'mining' | 'salvaging'
type Exit = 'stop' | 'switch' | 'queue'

function world(pilotWarp = 2, workerWarp = 8) {
  const ctx = makeTestCtx({ quietEvents: true,
    balance: { ...DEFAULT_BALANCE, travelEventChance: 0,
      combat: { ...DEFAULT_BALANCE.combat, minAbandonChance: 0, maxAbandonChance: 0 } },
    ships: [ship('sandcat', { cargo: 100, warpSpeedAus: pilotWarp }), ship('fuel-worker', { cargo: 100, warpSpeedAus: workerWarp })],
    belts: [belt('fuel-belt', 'ore-a', undefined, { galaxyId: 'galaxy-far' })],
    anomalies: [anomaly('fuel-card', 'galaxy-far', { threat: 1, reward: 100 }), anomaly('fuel-local', 'galaxy-hub', { threat: 1, reward: 100 })],
    modules: [moduleDef('fuel-salvager', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 1022 })
  state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
  state.jumpFuel = { mine: true, salvage: true, expedition: true, ai: true }
  state.warehouse.items['jump-fuel'] = 10000
  state.warehouse.items['ore-a'] = 100
  state.skills.trained['ai-expert'] = 2
  state.aiCores.basic = 2
  const worker = addShipToFleet(state, 'fuel-worker')
  state.fleet[worker]!.fitted.high = ['fuel-salvager']
  return { state, ctx, worker }
}

function working(mode: Work, units = 100) {
  const w = world()
  w.state.fleet[w.state.shipId]!.fitted.high = ['fuel-salvager']
  const result = mode === 'mining' ? startMining(w.state, 'fuel-belt', w.ctx) : startSalvageOp(w.state, 'galaxy-far', w.ctx)
  expect(result.ok).toBe(true)
  w.state.fleet[w.state.shipId]!.cargo = units > 0 ? { 'ore-a': units } : {}
  return w
}

function advanceWork(w: ReturnType<typeof world>, mode: Work, ms: number) {
  if (mode === 'mining') advanceMining(w.state, ms, w.ctx)
  else advanceSalvageOp(w.state, ms, w.ctx)
}

function baseMs(w: ReturnType<typeof world>, mode: Work, exit?: Exit) {
  if (mode === 'salvaging') return salvageReturnMs(w.state, w.ctx, 'galaxy-far', 1)
  const full = exit && exit !== 'stop' ? miningReturnLegMs(w.state, w.ctx, 'fuel-belt')
    : oneLegMs(w.state, w.ctx, 'fuel-belt') + oneOutboundLegMs(w.state, w.ctx, 'fuel-belt')
  return scaledReturnMs(full, w.state, w.ctx, w.state.shipId)
}

function reload(state: GameState) { return loadSaveFile(serializeSaveFile(state, 0)).state }
function startReturn(w: ReturnType<typeof world>, mode: Work) {
  advanceWork(w, mode, mode === 'mining' ? getMiningParams(w.state, w.ctx)!.cycleMs : 1000)
  expect(w.state[mode].phase).toBe('returning')
  expect(w.state[mode].phaseAccMs).toBe(0)
}

function exitWork(w: ReturnType<typeof world>, mode: Work, exit: Exit) {
  if (exit === 'stop') expect(mode === 'mining' ? stopMining(w.state, w.ctx) : stopSalvageOp(w.state, w.ctx)).toBe(true)
  else if (exit === 'switch') expect(changeShip(w.state, w.worker, w.ctx).ok).toBe(true)
  else {
    expect(startRefineRun(w.state, 'ore-a', 'pilot', w.ctx)).toMatchObject({ ok: true, queued: true })
    advanceGame(w.state, 1, w.ctx)
  }
}

describe.each(['mining', 'salvaging'] as const)('%s燃料返航各入口', mode => {
  it.each(['stop', 'switch', 'queue'] as const)('%s新返航按本入口既有航程扣一次燃料，保存后按真实边界卸货', exit => {
    for (const units of [0, 50, 100]) {
      const w = working(mode, units)
      const oldShip = w.state.shipId
      const rawMs = baseMs(w, mode, exit)
      const actualMs = jumpFuelLegMsOf(rawMs, 10)
      const originalCargo = structuredClone(w.state.fleet[oldShip]!.cargo)
      exitWork(w, mode, exit)
      expect(jumpFuelStockOf(w.state)).toBe(10000 - Math.ceil(rawMs / 1000))
      expect(w.state.logs.filter(v => v.textId === 'core.jumpFuel.001')).toHaveLength(1)
      if (actualMs === 1 && exit === 'queue') {
        expect(w.state.shipReturns[oldShip]).toBeUndefined()
        continue
      }
      const ret = w.state.shipReturns[oldShip]!
      expect(ret.legMs).toBe(actualMs)
      expect(w.state.fleet[oldShip]!.cargo).toEqual(originalCargo)
      const loaded = reload(reload(w.state))
      expect(loaded.shipReturns[oldShip]).toEqual(ret)
      const stock = jumpFuelStockOf(loaded)
      const remaining = ret.legMs - ret.phaseAccMs
      advanceShipReturns(loaded, remaining - 1, w.ctx)
      expect(loaded.shipReturns[oldShip]).toBeDefined()
      expect(loaded.fleet[oldShip]!.cargo).toEqual(originalCargo)
      advanceShipReturns(loaded, 1, w.ctx)
      expect(loaded.shipReturns[oldShip]).toBeUndefined()
      expect(loaded.fleet[oldShip]!.cargo).toEqual({})
      expect(jumpFuelStockOf(loaded)).toBe(stock)
    }
  })

  it.each(['stop', 'switch', 'queue'] as const)('%s已点火返航保持倍率、进度和航段，不重新扣料', exit => {
    const w = working(mode)
    const rawMs = baseMs(w, mode)
    const oldShip = w.state.shipId
    startReturn(w, mode)
    const actualMs = jumpFuelLegMsOf(rawMs, 10)
    const half = Math.floor(actualMs / 2)
    advanceWork(w, mode, half)
    expect(activityOverview(w.state, w.ctx).find(v => v.id === (mode === 'mining' ? 'mining' : 'salvage'))!.remainingMs).toBe(actualMs - half)
    // 中途关开关、耗尽仓库，都不能改变已经点火的本趟。
    w.state.jumpFuel = {}
    w.state.warehouse.items['jump-fuel'] = 0
    exitWork(w, mode, exit)
    const ret = w.state.shipReturns[oldShip]!
    expect(ret.legMs).toBe(actualMs)
    expect(ret.phaseAccMs).toBe(half + (exit === 'queue' ? 1 : 0))
    expect(jumpFuelStockOf(w.state)).toBe(0)
    expect(w.state.logs.filter(v => v.textId === 'core.jumpFuel.001')).toHaveLength(1)
    expect(reload(w.state).shipReturns[oldShip]).toEqual(ret)
  })

  it.each(['off', 'short'] as const)('%s新返航不扣料，旧返航不补点火', condition => {
    for (const exit of ['stop', 'switch', 'queue'] as const) {
      const w = working(mode)
      const oldShip = w.state.shipId
      const rawMs = baseMs(w, mode, exit)
      w.state.warehouse.items['jump-fuel'] = Math.ceil(rawMs / 1000) - 1
      if (condition === 'off') { w.state.warehouse.items['jump-fuel'] = 10000; w.state.jumpFuel = {} }
      const stock = jumpFuelStockOf(w.state)
      exitWork(w, mode, exit)
      expect(jumpFuelStockOf(w.state)).toBe(stock)
      expect(w.state.shipReturns[oldShip]!.legMs).toBe(rawMs)
    }
    const w = working(mode)
    w.state.jumpFuel = {}
    const rawMs = baseMs(w, mode)
    startReturn(w, mode)
    advanceWork(w, mode, 1000)
    w.state.jumpFuel = { mine: true, salvage: true }
    expect(mode === 'mining' ? stopMining(w.state, w.ctx) : stopSalvageOp(w.state, w.ctx)).toBe(true)
    expect(w.state.shipReturns[w.state.shipId]).toMatchObject({ legMs: rawMs, phaseAccMs: 1000 })
    expect(jumpFuelStockOf(w.state)).toBe(10000)
  })

  it.each([false, true])('站内待办首拍前重载，已返航=%s的快照不丢失也不重复扣料', returning => {
    const w = working(mode)
    const oldShip = w.state.shipId
    const rawMs = baseMs(w, mode, returning ? undefined : 'queue')
    if (returning) { startReturn(w, mode); advanceWork(w, mode, 1000) }
    const stock = jumpFuelStockOf(w.state)
    expect(startRefineRun(w.state, 'ore-a', 'pilot', w.ctx)).toMatchObject({ ok: true, queued: true })
    const pending = structuredClone(w.state.pendingActivityReturn)
    const loaded = reload(reload(w.state))
    expect(loaded.pendingActivityReturn).toEqual(pending)
    advanceGame(loaded, 1, w.ctx)
    expect(loaded.pendingActivityReturn).toBeNull()
    expect(loaded.shipReturns[oldShip]).toMatchObject({ legMs: jumpFuelLegMsOf(rawMs, 10), phaseAccMs: returning ? 1001 : 1 })
    expect(jumpFuelStockOf(loaded)).toBe(returning ? stock : stock - Math.ceil(rawMs / 1000))
    const remain = loaded.shipReturns[oldShip]!.legMs - loaded.shipReturns[oldShip]!.phaseAccMs
    advanceGame(loaded, remain - 1, w.ctx)
    expect(loaded.refineRuns).toHaveLength(0)
    advanceGame(loaded, 1, w.ctx)
    expect(loaded.shipReturns[oldShip]).toBeUndefined()
    expect(loaded.refineRuns).toHaveLength(1)
  })

  it('待办首拍前换船只在真正交接时点火，预检不改状态', () => {
    const w = working(mode)
    const rawMs = baseMs(w, mode, 'queue')
    const oldShip = w.state.shipId
    expect(startRefineRun(w.state, 'ore-a', 'pilot', w.ctx)).toMatchObject({ ok: true, queued: true })
    const snapshot = structuredClone(w.state)
    expect(changeShipBlockReason(w.state, w.worker, w.ctx)).toBeNull()
    expect(w.state).toEqual(snapshot)
    expect(changeShip(w.state, w.worker, w.ctx).ok).toBe(true)
    expect(w.state.shipReturns[oldShip]!.legMs).toBe(jumpFuelLegMsOf(rawMs, 10))
    expect(w.state.pendingActivityReturn).toBeNull()
    const stock = jumpFuelStockOf(w.state)
    advanceGame(w.state, 1, w.ctx)
    expect(jumpFuelStockOf(w.state)).toBe(stock)
    expect(w.state.shipReturns[w.worker]).toBeUndefined()
  })

  it('无效或旧档缺快照按原兼容路径恢复，不因异常字段产生加速', () => {
    const w = working(mode)
    expect(startRefineRun(w.state, 'ore-a', 'pilot', w.ctx)).toMatchObject({ ok: true, queued: true })
    const file = JSON.parse(serializeSaveFile(w.state, 0))
    file.state.pendingActivityReturn.progress = { phase: 'invalid', phaseAccMs: -1, fuelMul: '10', originGalaxy: 7 }
    const loaded = loadSaveFile(JSON.stringify(file)).state
    expect(loaded.pendingActivityReturn!.progress).toBeUndefined()
    advanceGame(loaded, 1, w.ctx)
    expect(loaded.shipReturns[loaded.shipId]!.legMs).toBe(jumpFuelLegMsOf(baseMs(w, mode, 'queue'), 10))
  })

  it('旧出航相位转站内待办的进度按燃料倍率折算，不能提前到港', () => {
    const w = working(mode)
    w.state[mode].phase = 'outbound'
    w.state[mode].phaseAccMs = 1000
    const rawMs = baseMs(w, mode, 'queue')
    expect(startRefineRun(w.state, 'ore-a', 'pilot', w.ctx)).toMatchObject({ ok: true, queued: true })
    const loaded = reload(w.state)
    advanceGame(loaded, 1, w.ctx)
    expect(loaded.shipReturns[loaded.shipId]).toMatchObject({ legMs: jumpFuelLegMsOf(rawMs, 10), phaseAccMs: 201 })
    expect(loaded.refineRuns).toHaveLength(0)
  })

  it('自动返航重载与下一趟不足燃料均保持真实计时', () => {
    const w = working(mode)
    const rawMs = baseMs(w, mode)
    startReturn(w, mode)
    const actualMs = jumpFuelLegMsOf(rawMs, 10)
    advanceWork(w, mode, 1000)
    const loaded = reload(w.state)
    const actualW = { ...w, state: loaded }
    expect(loaded[mode].fuelMul).toBe(10)
    advanceWork(actualW, mode, actualMs - 1001)
    expect(loaded[mode].phase).toBe('returning')
    advanceWork(actualW, mode, 1)
    expect(loaded[mode].phase).toBe(mode)
    loaded.warehouse.items['jump-fuel'] = 0
    loaded.fleet[loaded.shipId]!.cargo = { 'ore-a': 100 }
    startReturn(actualW, mode)
    expect(loaded[mode].fuelMul).toBe(1)
    if (mode === 'mining') expect(miningStatus(loaded, w.ctx).remainingMs).toBe(rawMs)
    else expect(salvageReturnMs(loaded, w.ctx, 'galaxy-far')).toBe(rawMs)
  })
})

describe('打捞真实星图读数', () => {
  it('直接调用星图进度函数，半仓加速返航与活动栏均为50%', () => {
    const file = new URL('../../../apps/desktop/src/renderer/src/pages/MapPage.tsx', import.meta.url)
    const text = readFileSync(file, 'utf8')
    const ast = ts.createSourceFile('MapPage.tsx', text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'salvageProgressOf')!
    const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const readProgress = new Function('salvageReturnMs', 'outboundLegMsFor', 'salvagerCyclesOf', 'tr', `${js};return salvageProgressOf`)(
      salvageReturnMs, outboundLegMsFor, salvagerCyclesOf, (id: string) => id,
    )
    const w = working('salvaging', 50)
    const actualMs = jumpFuelLegMsOf(baseMs(w, 'salvaging'), 10)
    w.state.salvaging.phase = 'returning'
    w.state.salvaging.fuelMul = 10
    w.state.salvaging.phaseAccMs = actualMs / 2
    const stock = jumpFuelStockOf(w.state)
    expect(readProgress(w)).toMatchObject({ percent: 50, travel: true })
    expect(activityOverview(w.state, w.ctx).find(v => v.id === 'salvage')).toMatchObject({ percent: 50, remainingMs: actualMs / 2 })
    expect(jumpFuelStockOf(w.state)).toBe(stock)
  })
})

describe('AI燃料按副船真实返航单程计费', () => {
  it.each(['mining', 'salvage'] as const)('%s扣料、点火日志、真实返航及保存一致，主控船速不影响', mode => {
    for (const [pilotWarp, workerWarp] of [[2, 8], [8, 8], [12, 1]]) {
      const w = world(pilotWarp, workerWarp)
      w.state.fleet[w.worker]!.cargo = { 'ore-a': 100 }
      expect((mode === 'mining' ? assignAiMining(w.state, w.worker, 'basic', 'fuel-belt', w.ctx)
        : assignAiSalvage(w.state, w.worker, 'basic', 'galaxy-far', w.ctx)).ok).toBe(true)
      const rawMs = mode === 'mining' ? oneLegMs(w.state, w.ctx, 'fuel-belt', w.worker) : legMsFor(w.state, w.ctx, 'galaxy-far', w.worker)
      const outMs = mode === 'salvage' ? aiTaskView(w.state, w.ctx, w.worker)!.remainingMs! : 0
      const cycleMs = mode === 'mining' ? getMiningParams(w.state, w.ctx, { shipId: w.worker, beltId: 'fuel-belt' })!.cycleMs : 1000
      const stock = Math.ceil(rawMs / 1000)
      w.state.warehouse.items['jump-fuel'] = stock
      advanceAi(w.state, outMs + Math.ceil(cycleMs / aiEfficiency(w.state, w.ctx, 'basic')), w.ctx)
      const task = w.state.aiAssignments[w.worker]!.task
      expect(task).toMatchObject({ phase: 'returning', phaseAccMs: 0, fuelMul: 10 })
      expect(jumpFuelStockOf(w.state)).toBe(0)
      const actualMs = jumpFuelLegMsOf(rawMs, 10)
      expect(aiTaskView(w.state, w.ctx, w.worker)!.remainingMs).toBe(actualMs)
      const fuelLog = w.state.logs.find(v => v.textId === 'core.jumpFuel.001')!
      expect(fuelLog.textParams!.p3).toBe(stock.toLocaleString('zh-CN'))
      advanceAi(w.state, Math.floor(actualMs / 2), w.ctx)
      const loaded = reload(w.state)
      const remaining = aiTaskView(loaded, w.ctx, w.worker)!.remainingMs!
      expect(remaining).toBe(actualMs - Math.floor(actualMs / 2))
      advanceAi(loaded, remaining - 1, w.ctx)
      expect(loaded.fleet[w.worker]!.cargo['ore-a']).toBe(100)
      advanceAi(loaded, 1, w.ctx)
      expect(loaded.fleet[w.worker]!.cargo).toEqual({})
      expect(jumpFuelStockOf(loaded)).toBe(0)
    }
  })
})

describe('远征燃料与返航显示', () => {
  it.each([false, true])('本地=%s的返航时间和半程进度保存重载保持', local => {
    const w = world()
    expect(startExpedition(w.state, local ? 'fuel-local' : 'fuel-card', w.ctx).ok).toBe(true)
    w.state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(w.state, w.ctx)
    const exp = w.state.expedition
    const actualMs = exp.finishAtGameMs - exp.returnAtGameMs!
    w.state.gameMs = exp.returnAtGameMs! + Math.floor(actualMs / 2)
    const view = expeditionStatus(w.state, w.ctx)
    expect(view.percent).toBe(50)
    const loaded = reload(reload(w.state))
    expect(loaded.expedition.returnAtGameMs).toBe(exp.returnAtGameMs)
    expect(expeditionStatus(loaded, w.ctx).percent).toBe(50)
    expect(expeditionStatus(loaded, w.ctx).remainingMs).toBe(view.remainingMs)
    expect(w.state.logs.some(v => v.textId === 'core.expedition.026')).toBe(false)
    const stock = jumpFuelStockOf(loaded)
    loaded.gameMs = loaded.expedition.finishAtGameMs - 1
    advanceExpedition(loaded, w.ctx)
    expect(loaded.expedition.active).toBe(true)
    loaded.gameMs++
    advanceExpedition(loaded, w.ctx)
    expect(loaded.expedition.active).toBe(false)
    expect(jumpFuelStockOf(loaded)).toBe(stock)
  })

  it('手动撤退即时回港不点火', () => {
    const w = world()
    expect(startExpedition(w.state, 'fuel-card', w.ctx).ok).toBe(true)
    expect(retreatBattle(w.state, w.ctx).ok).toBe(true)
    expect(w.state.expedition.finishAtGameMs).toBe(w.state.expedition.returnAtGameMs)
    expect(jumpFuelStockOf(w.state)).toBe(10000)
  })

  it.each([false, true])('核心=%s入侵重复出击点火按实际星系，关闭重复不取消返航', core => {
    const now = Date.UTC(2026, 9, 22, 4)
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: now, seed: 1022 })
    state.wallMs = now
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100
    state.standingsEarned = { dsi: 100 }
    state.shipId = addShipToFleet(state, 'sh-megalodon')
    state.fleet[state.shipId]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
    state.warehouse.items['ammo-plasma-l'] = 100000
    state.warehouse.items['jump-fuel'] = 60000
    state.jumpFuel = { expedition: true }
    state.weekendEvent = { seq: 1, startedAtWallMs: now, family: 'C', coreId: 'galaxy-kor', peripheryIds: core ? [] : ['galaxy-redring'], contributed: {} }
    expect(setAutoLoopInvasion(state, ctx, core ? 'galaxy-kor' : 'galaxy-redring', now).ok).toBe(true)
    expect(advanceAutoLoopInvasion(state, ctx, now)).toBeNull()
    const control = structuredClone(state)
    control.jumpFuel!.expedition = false
    for (const s of [state, control]) { s.expedition.battle!.ended = 'me'; resolveBattleOutcome(s, ctx) }
    const rawMs = control.expedition.finishAtGameMs - control.expedition.returnAtGameMs!
    expect(state.expedition.finishAtGameMs - state.expedition.returnAtGameMs!).toBe(jumpFuelLegMsOf(rawMs, 10))
    expect(60000 - jumpFuelStockOf(state)).toBe(Math.ceil(rawMs / 1000))
    const snapshot = structuredClone(state.expedition)
    expect(setAutoLoopInvasion(state, ctx, null, now).ok).toBe(true)
    expect(state.expedition).toEqual(snapshot)
  })
})
