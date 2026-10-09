import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { startExpedition, setBattleDesire, setAutoLoopInvasion, advanceAutoLoopInvasion } from '../src/expedition'
import { advanceBattleFor, battleArcsFor, createPlayerSpec, desirePrefOf, setDesirePrefOf, startBattleFor, startFleetBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const NOW = new Date(2026, 9, 9, 20).getTime()
const CORE = 'galaxy-kor', PER = 'galaxy-redring'
afterEach(() => vi.restoreAllMocks())

function world(family = 'C') {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const state = createInitialState({ nowWallMs: NOW, seed: 7 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.fleet[uid]!.fitted = { high: ['mod-laser-1'], mid: [], low: [] }
  state.warehouse.items['ammo-plasma-l'] = 100000
  state.weekendEvent = { seq: 1, startedAtWallMs: NOW, family, coreId: CORE, peripheryIds: [PER], contributed: {} }
  return state
}

function idle(state: GameState) {
  state.expedition.active = false
  state.expedition.battle = null
  state.expedition.anomalyId = null
  state.bountyCooldowns = {}
}

describe('入侵目标距离不因首波量程缩小', () => {
  it.each(['alien-escort', 'alien-main', 'ink-raid', 'ink-main'])('同星系同卡%s后波选择在连续开局与读档后保持', cardId => {
    const state = world(cardId.startsWith('alien') ? 'C' : 'H')
    expect(startExpedition(state, cardId, ctx, { foeGalaxyId: CORE }).ok).toBe(true)
    const first = state.expedition.battle!
    const firstMax = battleArcsFor(state, ctx)!.maxM
    first.waveIdx = 1
    const chosen = battleArcsFor(state, ctx)!.maxM
    expect(chosen).toBeGreaterThan(firstMax)
    expect(setBattleDesire(state, chosen, ctx).ok).toBe(true)
    expect(first.myDesireM).toBe(chosen)
    expect(desirePrefOf(state, CORE)).toBe(chosen)
    idle(state)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    for (const current of [state, loaded]) {
      for (let i = 0; i < 3; i++) {
        expect(startExpedition(current, cardId, ctx, { foeGalaxyId: CORE }).ok).toBe(true)
        const battle = current.expedition.battle!
        expect(battle.myDesireM).toBe(chosen)
        expect(battle.distanceM).toBe(firstMax)
        current.gameMs += 100
        advanceBattleFor(current, ctx, battle, current.shipId, cardId)
        expect(battle.distanceM).toBeLessThanOrEqual(battleArcsFor(current, ctx)!.maxM)
        expect(battle.myDesireM).toBe(chosen)
        expect(desirePrefOf(current, CORE)).toBe(chosen)
        idle(current)
      }
    }
  })

  it('循环抽到不同卡仍保留本星系目标，自动转场读各星系自己的偏好', () => {
    const state = world()
    setDesirePrefOf(state, PER, 8250)
    setDesirePrefOf(state, CORE, 7000)
    setDesirePrefOf(state, 'galaxy-hub', 3000)
    expect(setAutoLoopInvasion(state, ctx, PER, NOW).ok).toBe(true)
    const cards = new Set<string>()
    for (let i = 0; i < 12; i++) {
      advanceAutoLoopInvasion(state, ctx, NOW)
      expect(state.expedition.foeGalaxyId).toBe(PER)
      expect(state.expedition.battle!.myDesireM).toBe(8250)
      expect(desirePrefOf(state, PER)).toBe(8250)
      cards.add(state.expedition.anomalyId!)
      idle(state)
    }
    expect(cards.size).toBe(2)
    state.weekendEvent!.contributed[PER] = 1
    advanceAutoLoopInvasion(state, ctx, NOW)
    expect(state.expedition.foeGalaxyId).toBe(CORE)
    expect(state.expedition.battle!.myDesireM).toBe(7000)
    expect(desirePrefOf(state, PER)).toBe(8250)
    expect(desirePrefOf(state, 'galaxy-hub')).toBe(3000)
  })

  it('真实换波与在途整档重载不重置目标，也不扩大当前波实际距离上限', () => {
    const state = world()
    setDesirePrefOf(state, CORE, 8250)
    startExpedition(state, 'alien-main', ctx, { foeGalaxyId: CORE })
    const battle = state.expedition.battle!
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    for (let i = 0; i < 100 && battle.waveIdx !== 1; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, battle, state.shipId, 'alien-main')
    }
    expect(battle.waveIdx).toBe(1)
    expect(battle.myDesireM).toBe(8250)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(loaded.expedition.battle!.myDesireM).toBe(8250)
    loaded.gameMs += 100
    advanceBattleFor(loaded, ctx, loaded.expedition.battle!, loaded.shipId, 'alien-main')
    expect(loaded.expedition.battle!.myDesireM).toBe(8250)
    expect(loaded.expedition.battle!.distanceM).toBeLessThanOrEqual(battleArcsFor(loaded, ctx)!.maxM)
  })

  it('旗舰首波不压小核心目标，普通单舰/编队及虫洞仍按原上限钳制', () => {
    const state = world()
    state.weekendEvent!.contributed = { [CORE]: 1, [PER]: 1 }
    setDesirePrefOf(state, CORE, 20000)
    const flagship = weekendStartFlagshipBattle(state, ctx, NOW, [state.shipId])!
    expect(flagship).not.toBeNull()
    expect(flagship.distanceM).toBeLessThan(20000)
    expect(flagship.myDesireM).toBe(20000)
    const single = startBattleFor(state, ctx, state.shipId, 'alien-main', 0, 20000)!
    const fleet = startFleetBattleFor(state, ctx, [state.shipId], 'alien-main', 0, 20000)!
    const wormhole = startFleetBattleFor(state, ctx, [state.shipId], 'alien-main', 0, 20000,
      { depth: 1, kind: 'node', waves: 2 })!
    for (const battle of [single, fleet]) {
      expect(battle.myDesireM).toBeLessThan(20000)
      expect(battle.myDesireM).toBe(battle.distanceM)
    }
    // 虫洞派生卡的开局实际距离另有规则；既有目标上限为派生后首波射程。
    expect(wormhole.myDesireM).toBe(6600)
    expect(wormhole.distanceM).toBe(2760)
  })

  it('无偏好仍为原主武器默认值，新的手动选择仍受当前波上限约束', () => {
    const state = world()
    startExpedition(state, 'alien-escort', ctx, { foeGalaxyId: PER })
    expect(state.expedition.battle!.myDesireM).toBe(4416)
    const me = createPlayerSpec(state, ctx, state.shipId)!
    expect(me.weapons.length).toBeGreaterThan(0)
    const maxM = battleArcsFor(state, ctx)!.maxM
    setBattleDesire(state, maxM + 50000, ctx)
    expect(state.expedition.battle!.myDesireM).toBe(maxM)
    expect(desirePrefOf(state, PER)).toBe(maxM)
  })

  it('战场目标数字显示原目标，滑条图形仍按当前量程钳制', () => {
    const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/panels/BattleScreen.tsx', import.meta.url), 'utf8')
    expect(source).toContain('const desireM = Math.min(farM, Math.max(nearM, combat.myDesireM))')
    expect(source).toContain("dragV === null ? Math.round(combat.myDesireM) : sliderToDesire(sliderV)")
  })
})
