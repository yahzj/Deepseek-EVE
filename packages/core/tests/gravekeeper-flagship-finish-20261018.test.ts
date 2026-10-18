import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_SHIPS } from '@whale/data'
import { createInitialState } from '../src/state'
import { activeFoeSpecsOf, advanceBattleFor, applyFoeOverride, applyFoeUnitDamage, createFoeSpecs, flagshipBattleLedger } from '../src/combat'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf } from '../src/weekendBattle'
import { WEEKEND_FLAGSHIP_POOL_HP } from '../src/weekendEvent'
import { FOE_MOUNT_IDS } from '../src/foeMounts'
import { countWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const now = new Date(2026, 9, 16, 20).getTime()
const bossId = 'foe-d-invasion-eternal-tomb'
function fixture(rawLeft: number) {
  const state = createInitialState({ nowWallMs: now, seed: 11 })
  state.debugQuick = false
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.weekendEvent = {
    seq: 903, family: 'D', coreId: 'galaxy-maw', peripheryIds: [], startedAtWallMs: now,
    contributed: { 'galaxy-maw': 1 }, flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: WEEKEND_FLAGSHIP_POOL_HP - 101, octopusHpDone: 101 - rawLeft,
  }
  const spec = weekendFlagshipSpecOf(state, ctx, now)!
  const battle = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
  expect(battle).toBeTruthy()
  battle.units.player!.hp = { s: 1e9, a: 1e9, h: 1e9 }
  battle.units.player!.hpMax = { s: 1e9, a: 1e9, h: 1e9 }
  battle.units.player!.weapons = battle.units.player!.weapons.map(() => 1e9)
  const card = applyFoeOverride(ctx.anomalies.get(spec.cardId)!, battle.foeOverride!)
  const step = () => { state.gameMs += 100; advanceBattleFor(state, ctx, battle, state.shipId, spec.cardId) }
  const clear = () => {
    for (let i = 0; i < 500 && !battle.ended; i++) {
      for (const foe of activeFoeSpecsOf(card, ctx.balance.battle, battle.waveIdx ?? 0)) {
        const rt = battle.units[foe.tag]
        if (rt && rt.hp.s + rt.hp.a + rt.hp.h > 0) applyFoeUnitDamage(battle, foe, 1e9, 'plasma')
      }
      step()
    }
    expect(battle.ended).toBe('me')
  }
  return { state, spec, battle, step, clear }
}

describe('永陵舰级重构与击沉旗舰单次结算', () => {
  it('永陵舰级自带重构，独立建舰和入侵卡最终挂载都只有一件', () => {
    const ship = FOE_SHIPS.find(ship => ship.id === bossId)!
    expect(ship.mounts).toContain(FOE_MOUNT_IDS.dReconstruction)
    const card = ctx.anomalies.get('gravekeeper-flagship')!
    const slot = card.ships!.find(slot => slot.ship.id === bossId)!
    expect(slot.mounts).toBeUndefined()
    expect(ship.mounts!.filter(id => id === FOE_MOUNT_IDS.dReconstruction)).toHaveLength(1)
    const standalone = createFoeSpecs({ ...card, waves: undefined, ships: [{ ship }] }, ctx.balance.battle)
    expect(standalone[0]!.foeReviveEscort).toEqual({ everyMs: 60000, all: true })
    expect(activeFoeSpecsOf(card, ctx.balance.battle, 3).filter(foe => foe.foeReviveEscort)).toHaveLength(1)
  })

  it.each([.1, .49, 1.1, 100, 100.25, 100.49, 100.5, 100.75])('原始共享池剩%s：实战击沉后一次结束，不能再进1HP场', rawLeft => {
    const w = fixture(rawLeft)
    w.clear()
    const ledger = flagshipBattleLedger(w.battle, [bossId])
    expect(ledger.flagshipSeq).toBe(1)
    expect(w.battle.bossDownAtMs).toBeDefined()
    const result = weekendApplyBattleOutcome(w.state, ctx, w.spec.cardId, w.battle.ended === 'me', now + w.state.gameMs, w.battle,
      { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(result?.kind).toBe('flagship')
    expect(w.state.weekendEvent!.endedAtWallMs).toBeDefined()
    expect(w.state.weekendEvent!.flagshipDown).toBe('player')
    expect(countWare(w.state, 'blackbox-d')).toBe(1)
    expect(weekendStartFlagshipBattle(w.state, ctx, now + w.state.gameMs, [w.state.shipId])).toBeNull()
    const before = structuredClone(w.state.weekendEvent)
    weekendApplyBattleOutcome(w.state, ctx, w.spec.cardId, true, now + w.state.gameMs, w.battle, { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(w.state.weekendEvent).toEqual(before)
    expect(countWare(w.state, 'blackbox-d')).toBe(1)
  })

  it.each(['alive', 'unseen', 'no-kill-marker', 'wrong-boss', 'large-gap'] as const)('%s不因胜利或池子尾差误判击沉', mode => {
    const w = fixture(100.25)
    // 模拟更新前已开战的四舍五入HP，验证兼容补差的全部守卫。
    w.battle.foeOverride!.bossHp = 100
    w.battle.foeOverride!.bossHpLayers = { s: 0, a: 0, h: 100 }
    if (mode === 'unseen') {
      expect(flagshipBattleLedger(w.battle, [bossId]).flagshipSeq).toBe(0)
    } else {
      w.clear()
      const boss = Object.values(w.battle.units).find(unit => unit.foeShipId === bossId)!
      if (mode === 'alive') { boss.hp.h = .1; delete w.battle.bossDownAtMs }
      if (mode === 'no-kill-marker') delete w.battle.bossDownAtMs
      if (mode === 'wrong-boss') w.battle.foeOverride!.bossShipId = 'other'
      if (mode === 'large-gap') w.state.weekendEvent!.flagshipHpDone! -= 2
    }
    weekendApplyBattleOutcome(w.state, ctx, w.spec.cardId, mode !== 'alive', now + w.state.gameMs, w.battle,
      { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(w.state.weekendEvent!.endedAtWallMs).toBeUndefined()
    expect(w.state.weekendEvent!.flagshipDown).toBeUndefined()
    expect(countWare(w.state, 'blackbox-d')).toBe(0)
  })

  it('向上取整入场后仍剩小数HP，撤退结算不能提前击沉', () => {
    const w = fixture(100.25)
    w.clear()
    const boss = Object.values(w.battle.units).find(unit => unit.foeShipId === bossId)!
    boss.hp = { s: 0, a: 0, h: .1 }
    delete w.battle.bossDownAtMs
    w.battle.ended = null
    weekendApplyBattleOutcome(w.state, ctx, w.spec.cardId, false, now + w.state.gameMs, w.battle,
      { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(w.state.weekendEvent!.endedAtWallMs).toBeUndefined()
    expect(w.state.weekendEvent!.flagshipDown).toBeUndefined()
    expect(countWare(w.state, 'blackbox-d')).toBe(0)
  })

  it('更新前已按四舍五入开战，真实击沉后补齐共享池小数尾差', () => {
    const w = fixture(100.25)
    w.battle.foeOverride!.bossHp = 100
    w.battle.foeOverride!.bossHpLayers = { s: 30, a: 40, h: 30 }
    w.clear()
    expect(flagshipBattleLedger(w.battle, [bossId]).rawDmg).toBe(100)
    weekendApplyBattleOutcome(w.state, ctx, w.spec.cardId, true, now + w.state.gameMs, w.battle,
      { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(w.state.weekendEvent!.flagshipDown).toBe('player')
    expect(w.state.weekendEvent!.endedAtWallMs).toBeDefined()
    expect(countWare(w.state, 'blackbox-d')).toBe(1)
  })

  it('实际击沉但仍有护卫存活，撤退结算及存档续结同样消除尾差，不多发奖励', () => {
    const w = fixture(100.25)
    w.battle.waveIdx = 3
    w.step()
    const foes = activeFoeSpecsOf(applyFoeOverride(ctx.anomalies.get(w.spec.cardId)!, w.battle.foeOverride!), ctx.balance.battle, 3)
    const boss = foes.find(foe => foe.foeShipId === bossId)!
    applyFoeUnitDamage(w.battle, boss, 1e9, 'plasma')
    expect(w.battle.ended).toBeNull()
    expect(foes.filter(foe => foe !== boss).some(foe => w.battle.units[foe.tag]!.hp.h > 0)).toBe(true)
    w.state.encounter = { ...w.state.encounter, active: true, battle: w.battle, anomalyId: w.spec.cardId, galaxyId: 'galaxy-maw', shipId: w.state.shipId }
    const loaded = loadSaveFile(serializeSaveFile(w.state, now)).state
    const savedBattle = loaded.encounter.battle!
    expect(savedBattle.bossDownAtMs).toBeDefined()
    weekendApplyBattleOutcome(loaded, ctx, w.spec.cardId, false, now + w.state.gameMs, savedBattle,
      { galaxyId: 'galaxy-maw', kind: 'flagship' })
    expect(loaded.weekendEvent!.flagshipDown).toBe('player')
    expect(loaded.weekendEvent!.endedAtWallMs).toBeDefined()
    expect(countWare(loaded, 'blackbox-d')).toBe(1)
  })
})
