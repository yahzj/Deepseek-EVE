/** 普通遭遇战沿用编队默认，允许战中调距但不自动保存。 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { withBattleRangeConsent } from '../src/battleRangeMemory'
import { setFleetDistance } from './helpers/fleet-range'
import { fightEncounter } from '../src/encounters'
import { setBattleDesire } from '../src/expedition'

const ctx = buildSimContext()
const CARD = 'ink-harass'
const GALAXY = 'galaxy-kor'
/** 玩家在战斗里拖到的目标距离（写入端写的那个值；落在钳制区间内） */
const PLAYER_DESIRE = 2_500

/** 普通遭遇走正式应战入口，不绕过射程确认。 */
function world(desirePref?: number): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 21 })
  if (desirePref !== undefined) setFleetDistance(s, ctx, desirePref)
  s.encounter = {
    active: true,
    shipId: s.shipId,
    galaxyId: GALAXY,
    name: '测试遭遇',
    threat: 40,
    anomalyId: CARD,
    origin: '测试',
    invitedAtGameMs: s.gameMs,
    deadlineGameMs: s.gameMs + 60_000,
    battle: null,
  }
  let r = fightEncounter(s, ctx)
  if (r.rangeConfirmation && desirePref !== undefined) r = withBattleRangeConsent(s, desirePref, () => fightEncounter(s, ctx))
  expect(r.ok, r.ok ? '' : `应战失败：${String(r.errorId ?? '')}`).toBe(true)
  expect(s.encounter.battle, '战斗已挂进遭遇槽').not.toBeNull()
  return s
}

describe('遭遇战的本场距离与编队默认', () => {
  it('① 普通遭遇战里能改期望距离（修前被拒 `core.expedition.001`）', () => {
    const s = world()
    const before = structuredClone(s.fleetRange)
    const r = setBattleDesire(s, PLAYER_DESIRE, ctx)
    expect(r.ok, r.ok ? '' : `被拒了：${String(r.errorId ?? '')}`).toBe(true)
    expect(s.encounter.battle!.myDesireM, '本场期望距离真的改了').toBe(PLAYER_DESIRE)
    expect(s.fleetRange, '只调整本场，不自动覆盖编队默认').toEqual(before)
  })

  it('② 编队默认在遭遇开战时被读回', () => {
    const s = world(PLAYER_DESIRE)
    expect(s.encounter.battle!.myDesireM, '开战那一刻就按记忆站').toBe(PLAYER_DESIRE)
  })

  it('③ 没有交火时仍拒（宿主判据别放太宽）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 22 })
    const r = setBattleDesire(s, PLAYER_DESIRE, ctx)
    expect(r.ok).toBe(false)
    expect(r.errorId).toBe('core.expedition.001')
  })
})
