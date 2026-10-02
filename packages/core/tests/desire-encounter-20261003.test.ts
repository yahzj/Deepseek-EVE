/**
 * **遭遇战（含入侵伏击）里选的目标距离也要记住**（**2026-10-03 船长报障**：
 * 「**入侵战斗中，我方选择的期望距离不会保存**」）。
 *
 * ## 病根（探针实测）
 * `setBattleDesire` 的「第三宿主」判据原先只在**旗舰战**成立（`weekendFlagshipEncounterOf`）⇒
 * **普通遭遇战**（入侵伏击、低安遇袭）里拖距离条／点战术按钮一律被拒
 * （`core.expedition.001`「当前不在交火中」）——**既不改本场期望距离、也不落星系偏好**
 * （读写两条路本来就通：`fightEncounter` 开战读 `desirePrefOf(enc.galaxyId)`）。
 *
 * ## 修法
 * 宿主判据放宽为「**遭遇槽里任意正在打的遭遇战**」（旗舰战与普通伏击战同一条承载方式）；
 * 偏好仍写**本场所在星系**（`enc.galaxyId`），旗舰战那一支的口径一字未动。
 *
 * ⚠ 夹具用**普通编队遭遇战**（`startFleetBattleFor` ＋ 手搭遭遇槽）：与旗舰战走同一条判据，
 * 且不必凑「核心条满 ＋ 旗舰现身」那一整套入侵前置（先例：`encounter-sunk-ship-20260928`）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { desirePrefOf, setDesirePrefOf } from '../src/combat'
import { fightEncounter } from '../src/encounters'
import { setBattleDesire } from '../src/expedition'

const ctx = buildSimContext()
const CARD = 'ink-harass'
const GALAXY = 'galaxy-kor'
/** 玩家在战斗里拖到的目标距离（写入端写的那个值；落在钳制区间内） */
const PLAYER_DESIRE = 2_500

/**
 * 一场普通遭遇战（非旗舰）：只搭"遭遇槽 ＋ 待应战"，
 * **开战走真入口 `fightEncounter`**（它才是读取 `desirePrefOf(enc.galaxyId)` 的那一处）。
 */
function world(desirePref?: number): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 21 })
  if (desirePref !== undefined) setDesirePrefOf(s, GALAXY, desirePref)
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
  const r = fightEncounter(s, ctx)
  expect(r.ok, r.ok ? '' : `应战失败：${String(r.errorId ?? '')}`).toBe(true)
  expect(s.encounter.battle, '战斗已挂进遭遇槽').not.toBeNull()
  return s
}

describe('遭遇战 · 期望距离的写入与记忆（2026-10-03 报障）', () => {
  it('① 普通遭遇战里能改期望距离（修前被拒 `core.expedition.001`）', () => {
    const s = world()
    const r = setBattleDesire(s, PLAYER_DESIRE, ctx)
    expect(r.ok, r.ok ? '' : `被拒了：${String(r.errorId ?? '')}`).toBe(true)
    expect(s.encounter.battle!.myDesireM, '本场期望距离真的改了').toBe(PLAYER_DESIRE)
    expect(desirePrefOf(s, GALAXY), '偏好写**本场所在星系**（与读取端同源）').toBe(PLAYER_DESIRE)
  })

  it('② 写下的偏好在下一场同星系遭遇里被读回（记忆闭环）', () => {
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
