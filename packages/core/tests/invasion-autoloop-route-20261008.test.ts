import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { advanceAutoLoopInvasion, autoLoopInvasionGalaxy, autoLoopInvasionPlanOf, setAutoLoopInvasion, startExpedition, resolveBattleOutcome, retreatBattle, advanceExpedition, bountyCooldownMsFor } from '../src/expedition'
import { activityOverview } from '../src/activity'
import { advanceGame } from '../src/engine'
import { simulateOffline } from '../src/simulation'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendProgressAt, weekendWreckPenaltyFracOf, weekendGarrisonFoeCardId } from '../src/weekendEvent'
import { shortestTravelMinutes, travelLegMs } from '../src/travel'

const NOW = new Date(2026, 9, 9, 20).getTime()
const A = 'galaxy-redring', B = 'galaxy-grave', C = 'galaxy-kor'
const ctx = buildSimContext()
afterEach(() => vi.restoreAllMocks())

function world() {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const state = createInitialState({ nowWallMs: NOW, seed: 7 })
  state.debugQuick = false
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
  state.warehouse.items['ammo-plasma-l'] = 100_000
  state.weekendEvent = { seq: 1, startedAtWallMs: NOW, family: 'C', coreId: C, peripheryIds: [A, B], contributed: {} }
  return { state, ev: state.weekendEvent, uid }
}
function idle(state: ReturnType<typeof createInitialState>) {
  state.expedition.active = false
  state.expedition.battle = null
  state.expedition.anomalyId = null
  state.bountyCooldowns = {}
}

describe('入侵循环路线与安全边界', () => {
  it('指定外围先完成，之后按既有顺序外围再核心；预览不改状态或抽签', () => {
    const { state, ev } = world()
    expect(setAutoLoopInvasion(state, ctx, B, NOW).ok).toBe(true)
    const before = JSON.stringify(state)
    expect(autoLoopInvasionPlanOf(state, ctx, NOW).galaxyId).toBe(B)
    expect(JSON.stringify(state)).toBe(before)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(state.expedition.foeGalaxyId).toBe(B)
    expect(ev.assaultDraws).toBe(1)
    idle(state); ev.contributed[B] = 1
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(autoLoopInvasionGalaxy(state)).toBe(A)
    expect(state.expedition.foeGalaxyId).toBe(A)
    idle(state); ev.contributed[A] = 1
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(state.expedition.foeGalaxyId).toBe(C)
    expect(state.expedition.anomalyId).not.toBe('alien-broodmother')
    idle(state); ev.contributed[C] = 1
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toContain('旗舰需手动挑战')
    expect(autoLoopInvasionGalaxy(state)).toBeNull()
    expect(state.encounter.active).toBe(false)
    expect(state.expedition.active).toBe(false)
    expect(ev.assaultDraws).toBe(3)
    expect(state.logs.filter(log => log.textId === 'core.invasionLoop.001')).toHaveLength(2)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(state.logs.filter(log => log.textId === 'core.invasionLoop.002')).toHaveLength(1)
  })
  it.each([A, C])('从已满外围/未解锁核心%s开启均先去未满外围', requested => {
    const { state, ev } = world()
    ev.contributed[A] = 1
    expect(setAutoLoopInvasion(state, ctx, requested, NOW).ok).toBe(true)
    expect(autoLoopInvasionGalaxy(state)).toBe(B)
  })
  it('NPC铺底满时跳过外围，但离线片使用传入时刻而非当前真实时刻', () => {
    const { state } = world()
    expect(setAutoLoopInvasion(state, ctx, A, NOW).ok).toBe(true)
    vi.mocked(Date.now).mockReturnValue(NOW + 73 * 3_600_000)
    expect(autoLoopInvasionPlanOf(state, ctx, NOW + 47 * 3_600_000).galaxyId).toBe(A)
    expect(autoLoopInvasionPlanOf(state, ctx, NOW + 49 * 3_600_000).galaxyId).toBe(C)
    expect(autoLoopInvasionPlanOf(state, ctx, NOW + 73 * 3_600_000).status).toBe('complete')
  })
  it('零外围直接核心，全清拒绝开启；手动已收复刷取仍可用且半量', () => {
    const { state, ev } = world()
    ev.peripheryIds = []
    expect(setAutoLoopInvasion(state, ctx, C, NOW).ok).toBe(true)
    expect(autoLoopInvasionPlanOf(state, ctx, NOW).galaxyId).toBe(C)
    ev.contributed[C] = 1
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).not.toBeNull()
    expect(setAutoLoopInvasion(state, ctx, C, NOW).errorId).toBe('core.invasionLoop.007')
    expect(weekendWreckPenaltyFracOf(state, ev, C, NOW)).toBe(.5)
    const card = weekendGarrisonFoeCardId(state, ev, C)
    expect(startExpedition(state, card, ctx, { foeGalaxyId: C }).ok).toBe(true)
  })
  it.each(['battle', 'back'] as const)('%s在途目标不改绑，不重复出发，返航后才切换', phase => {
    const { state, ev } = world()
    expect(setAutoLoopInvasion(state, ctx, A, NOW).ok).toBe(true)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    const battle = state.expedition.battle
    ev.contributed[A] = 1
    state.expedition.phase = phase
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(autoLoopInvasionGalaxy(state)).toBe(A)
    expect(state.expedition.foeGalaxyId).toBe(A)
    expect(state.expedition.battle).toBe(battle)
    expect(ev.assaultDraws).toBe(1)
    idle(state)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(state.expedition.foeGalaxyId).toBe(B)
  })
  it('未探索的下一目标暂停，不自动探索、不消费出击次数', () => {
    const { state, ev } = world()
    expect(setAutoLoopInvasion(state, ctx, A, NOW).ok).toBe(true)
    ev.contributed[A] = 1
    state.exploredGalaxies = state.exploredGalaxies.filter(id => id !== B)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toContain('尚未探索')
    expect(state.exploredGalaxies).not.toContain(B)
    expect(autoLoopInvasionGalaxy(state)).toBeNull()
    expect(ev.assaultDraws).toBeUndefined()
  })
  it('实际目标航路不可达时暂停，不能因敌卡来自母港绕过', () => {
    const { state } = world()
    const isolated = { ...ctx, galaxies: new Map(ctx.galaxies).set('isolated', { ...ctx.galaxies.get(B)!, id: 'isolated' }) }
    state.weekendEvent!.peripheryIds = ['isolated']
    state.exploredGalaxies.push('isolated')
    expect(setAutoLoopInvasion(state, isolated, 'isolated', NOW).ok).toBe(true)
    expect(advanceAutoLoopInvasion(state, isolated, NOW)).not.toBeNull()
    expect(autoLoopInvasionGalaxy(state)).toBeNull()
  })
  it('主控实验室运行时等待，不抢停实验线，界面无伪冷却条', () => {
    const { state } = world()
    setAutoLoopInvasion(state, ctx, A, NOW)
    state.labRuns = [{ id: 7, active: true, worker: 'pilot', recipeId: 'missing', batches: 1, progressMs: 0, totalMs: 60_000 }] as never
    const before = structuredClone(state.labRuns)
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    expect(state.expedition.active).toBe(false)
    expect(state.labRuns).toEqual(before)
    const row = activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!
    expect(row.subParams?.p2Id).toBe('core.busy.030')
    expect(row.percent).toBeNull()
  })
  it('战败和手动撤退终止入侵循环，不换星系继续打', () => {
    for (const outcome of ['defeat', 'retreat']) {
      const { state } = world()
      setAutoLoopInvasion(state, ctx, A, NOW)
      advanceAutoLoopInvasion(state, ctx, NOW)
      if (outcome === 'defeat') {
        state.expedition.battle!.ended = 'foe'
        resolveBattleOutcome(state, ctx)
      } else expect(retreatBattle(state, ctx).ok).toBe(true)
      expect(autoLoopInvasionGalaxy(state)).toBeNull()
      expect(state.autoLoopStopNotice).toContain('重复出击已暂停')
    }
  })
  it('普通入侵卡返航按实际目标星系的航程计时，不按卡母港计时', () => {
    const { state } = world()
    setAutoLoopInvasion(state, ctx, B, NOW)
    advanceAutoLoopInvasion(state, ctx, NOW)
    expect(state.expedition.outMs).toBe(travelLegMs(state, ctx, shortestTravelMinutes(ctx, 'galaxy-hub', B)))
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(state.expedition.finishAtGameMs - state.expedition.returnAtGameMs!).toBe(state.expedition.outMs)
  })
  it('活动结束、换场或手动关闭都不继承路线，已有字段读档不丢', () => {
    const { state, ev } = world()
    setAutoLoopInvasion(state, ctx, B, NOW)
    const back = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(autoLoopInvasionGalaxy(back)).toBe(B)
    expect(autoLoopInvasionPlanOf(back, ctx, NOW).galaxyId).toBe(B)
    ev.endedAtWallMs = NOW
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBe('入侵活动已结束')
    state.weekendEvent = { ...ev, seq: 2, endedAtWallMs: undefined, autoLoopGalaxyId: undefined }
    expect(advanceAutoLoopInvasion(state, ctx, NOW)).toBeNull()
    setAutoLoopInvasion(state, ctx, B, NOW)
    setAutoLoopInvasion(state, ctx, null, NOW)
    expect(autoLoopInvasionGalaxy(state)).toBeNull()
  })
})

describe('入侵循环活动视图', () => {
  it('只读实际抽卡冷却而非驻留卡；到点、切目标和全清状态同源', () => {
    const { state, ev } = world()
    setAutoLoopInvasion(state, ctx, A, NOW)
    let plan = autoLoopInvasionPlanOf(state, ctx, NOW)
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') throw new Error('没有路线')
    const cooldown = bountyCooldownMsFor(state, ctx)
    state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + cooldown / 2
    const snapshot = JSON.stringify(state)
    const row = activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!
    expect(row.remainingMs).toBe(cooldown / 2)
    expect(row.percent).toBe(50)
    expect(row.subParams?.p1).toBe(ctx.galaxies.get(A)!.name)
    expect(row.stop).toBe('stop-invasion-loop')
    expect(JSON.stringify(state)).toBe(snapshot)
    state.gameMs += cooldown
    expect(activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!.percent).toBeNull()
    ev.contributed[A] = 1
    expect(activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!.subParams?.p1).toBe(ctx.galaxies.get(B)!.name)
    ev.contributed[B] = 1; ev.contributed[C] = 1
    expect(activityOverview(state, ctx).some(row => row.kind === 'invasion-loop')).toBe(false)
  })
  it('仅驻留卡冷却不画假条，等待采矿无冷却条，返航只有一行且停止不取消当前行程', () => {
    const { state, ev } = world()
    setAutoLoopInvasion(state, ctx, A, NOW)
    let different = false
    for (let draws = 0; draws < 20; draws++) {
      ev.assaultDraws = draws
      const plan = autoLoopInvasionPlanOf(state, ctx, NOW)
      const stationed = weekendGarrisonFoeCardId(state, ev, A)
      if (plan.status === 'ready' && stationed !== plan.dispatch.cardId) {
        different = true
        state.bountyCooldowns[stationed] = state.gameMs + 60_000
        expect(activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!.percent).toBeNull()
        break
      }
    }
    expect(different).toBe(true)
    state.mining.active = true
    const waiting = activityOverview(state, ctx).find(row => row.kind === 'invasion-loop')!
    expect(waiting.subId).toBe('ui.invasionLoop.002')
    expect(waiting.percent).toBeNull()
    expect(waiting.remainingMs).toBeNull()
    state.mining.active = false; state.bountyCooldowns = {}
    advanceAutoLoopInvasion(state, ctx, NOW)
    state.expedition.phase = 'back'
    state.expedition.returnReason = 'victory'
    state.expedition.returnAtGameMs = state.gameMs
    state.expedition.finishAtGameMs = state.gameMs + 1000
    const returning = activityOverview(state, ctx).filter(row => row.kind === 'expedition' || row.kind === 'invasion-loop')
    expect(returning).toHaveLength(1)
    expect(returning[0]!.stop).toBe('stop-invasion-loop')
    setAutoLoopInvasion(state, ctx, null, NOW)
    expect(state.expedition.active).toBe(true)
    expect(state.expedition.finishAtGameMs).toBe(state.gameMs + 1000)
    state.gameMs += 1000; advanceExpedition(state, ctx)
    expect(state.expedition.active).toBe(false)
  })
})

describe('入侵路线真实连战与离线', () => {
  it('真实战斗结算逐星系推进，全清后停止且不开旗舰；同时间线离线结果一致', () => {
    const { state, ev } = world()
    ev.contributed = { [A]: .95, [B]: .95, [C]: .95 }
    // 隔离循环路由，弱化真实敌卡而不绕开战斗、进度或返航流程。
    const local = { ...ctx, anomalies: new Map(ctx.anomalies) }
    for (const id of ['alien-vanguard', 'alien-escort', 'alien-main']) {
      const card = local.anomalies.get(id)!
      local.anomalies.set(id, { ...card, ships: [{ ship: ctx.foeShips!.get('foe-alien-starcore-larva')!, count: 1, hpMul: .01, dmgMul: .01 }], waves: undefined })
    }
    setAutoLoopInvasion(state, local, A, NOW)
    const offline = structuredClone(state)
    const targets: string[] = []
    for (let elapsed = 0; elapsed < 3_600_000; elapsed += 30_000) {
      advanceGame(state, 30_000, local, { nowWallMs: NOW + elapsed + 30_000, offline: true })
      if (elapsed + 30_000 < 3_600_000) {
        const before = state.weekendEvent!.assaultDraws ?? 0
        advanceAutoLoopInvasion(state, local, NOW + elapsed + 30_000)
        if ((state.weekendEvent!.assaultDraws ?? 0) > before) targets.push(state.expedition.foeGalaxyId!)
      }
    }
    expect(targets).toEqual([A, B, C])
    expect([A, B, C].every(id => weekendProgressAt(state, ev, id, NOW + 3_600_000) === 1)).toBe(true)
    expect(autoLoopInvasionGalaxy(state)).toBeNull()
    expect(state.encounter.active).toBe(false)
    simulateOffline(offline, NOW, NOW + 3_600_000, local)
    expect(offline.weekendEvent!.contributed).toEqual(ev.contributed)
    expect(offline.weekendEvent!.assaultDraws).toBe(3)
    expect(autoLoopInvasionGalaxy(offline)).toBeNull()
    expect(offline.encounter.active).toBe(false)
  })
})
