/** 入侵连续抽卡回归：各卡读取编队默认，战中选择仅本场生效。 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { setBattleDesire, setDesirePrefOf, desirePrefOf } from '../src/index'
import { startExpeditionArrived as startExpedition } from './helpers/command-arrived'
import { setFleetDistance } from './helpers/fleet-range'
import { confirmBattleRange } from '../src/battleRangeConfirm'
import { finishDeparture } from './helpers/departure-ready'
import { weekendAssaultDrawOf, weekendNoteAssaultDispatch } from '../src/weekendBounty'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
/** 被占星系（真正在打的那个） */
const PER = 'galaxy-redring'
const NOW = 1794974400000

/** 夹具照抄 `tests/offline-invasion-loop.test.ts`（同一场入侵的最小可跑状态） */
function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  s.exploredGalaxies.push(PER, 'galaxy-abyss')
  const ship = s.fleet[s.shipId]!
  ship.fitted = { high: ['mod-laser-1'], mid: [], low: [] } as never
  s.moduleBay['mod-laser-1'] = 1
  s.warehouse.items['ammo-plasma-l'] = 20_000
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: NOW,
    coreId: 'galaxy-abyss',
    peripheryIds: [PER],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

/** 打一场入侵并收起场（返回"玩家在战斗里设 5,000"这一步的返回） */
function fightOneInvasion(s: GameState): { cardId: string; cardGalaxy: string | undefined; ok: boolean } {
  const dispatch = weekendAssaultDrawOf(s, ctx, PER, NOW)!
  const card = ctx.anomalies.get(dispatch.cardId)
  let r = startExpedition(s, dispatch.cardId, ctx, { foeGalaxyId: PER })
  if (r.rangeConfirmation) {
    r = confirmBattleRange(s, ctx, s.fleetRange?.desireM ?? s.pendingBattleRange!.desireM, NOW)
    if (r.ok) finishDeparture(s, ctx)
  }
  expect(r.ok, '入侵应能开战').toBe(true)
  const d = setBattleDesire(s, 5_000, ctx)
  expect(d.ok, '入侵战斗里应能设期望距离').toBe(true)
  // 清理本场活动，保留编队默认和射程证据。
  s.expedition.active = false
  s.expedition.battle = null
  s.expedition.anomalyId = null
  delete s.expedition.sortie
  weekendNoteAssaultDispatch(s) // 记一次出发 ⇒ 下一场换一支
  s.gameMs += 600_000
  return { cardId: dispatch.cardId, cardGalaxy: card?.galaxyId, ok: d.ok }
}

describe('入侵的本场距离与编队默认隔离', () => {
  it('① 连打三场，战中5,000不会覆盖编队默认', () => {
    const s = world()
    setFleetDistance(s, ctx, 2500)
    const seenCards: string[] = []
    for (let i = 0; i < 3; i++) {
      const one = fightOneInvasion(s)
      seenCards.push(one.cardId)
      expect(
        s.fleetRange?.desireM,
        `第${i + 1}场实际卡${one.cardId}不能把本场选择自动存为默认`,
      ).toBe(2500)
      expect(s.expedition.battle, '本场已收场').toBeNull()
    }
    expect(seenCards.length).toBe(3)
  })

  it('② 不污染母港：入侵不动「母港」那一份设定', () => {
    const s = world()
    setDesirePrefOf(s, 'galaxy-hub', 9_876)
    fightOneInvasion(s)
    expect(desirePrefOf(s, 'galaxy-hub'), '母港那份应逐字不动（旧口径会被入侵改成战斗里设的值）').toBe(9_876)
    expect(s.fleetRange?.desireM, '战中选择不保存为默认').toBeUndefined()
  })

  it('③ 下一场开战采用编队默认，而非上一场战中选择', () => {
    const s = world()
    fightOneInvasion(s)
    // 下一场不继承上一场拖动后的5,000。
    const dispatch = weekendAssaultDrawOf(s, ctx, PER, NOW)!
    setFleetDistance(s, ctx, 2500)
    let r = startExpedition(s, dispatch.cardId, ctx, { foeGalaxyId: PER })
    if (r.rangeConfirmation) {
      r = confirmBattleRange(s, ctx, 2500, NOW)
      if (r.ok) finishDeparture(s, ctx)
    }
    expect(r.ok).toBe(true)
    expect(s.expedition.battle?.myDesireM, '开战采用显式设置的编队默认').toBe(2500)
  })
})
