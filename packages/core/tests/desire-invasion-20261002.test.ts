/**
 * **入侵的期望距离记忆**（**船长 2026-10-02 报障**：「**在打入侵时，玩家设置的目标距离并不会保存**」）。
 *
 * 真因（探针实测，2026-10-02）：**入侵池卡在数据里写死 `galaxyId: 'galaxy-hub'`**
 * （`ink-harass` / `ink-raid` …，它们本就不属于任何被占星系），而期望距离的写（`setBattleDesire`）与读
 * （`beginBattleAt` → `startBattleFor`）旧口径都取 `anomaly.galaxyId` ⇒ 全落在**母港**那把键上：
 * ① 被占星系一份都没记（= 船长报的"不保存"）；② **母港那份设定被入侵悄悄改掉**。
 *
 * 修后口径：两侧都取 **`exp.foeGalaxyId`（本场实际作战星系）**，没有它时回落卡自带星系
 * ⇒ 普通远征/普通悬赏逐字不变。
 *
 * ⚠ 本文件补的正是**原来没有任何用例守着**的那条：入侵**每场重抽一张卡**，而记忆必须按**星系**稳定。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { setBattleDesire, setDesirePrefOf, startExpedition, desirePrefOf } from '../src/index'
import { weekendAssaultDrawOf, weekendNoteAssaultDispatch } from '../src/weekendBounty'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
/** 被占星系（真正在打的那个） */
const PER = 'galaxy-redring'

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
    startedAtWallMs: Date.now(),
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
  const dispatch = weekendAssaultDrawOf(s, ctx, PER, Date.now())!
  const card = ctx.anomalies.get(dispatch.cardId)
  const r = startExpedition(s, dispatch.cardId, ctx, { foeGalaxyId: PER })
  expect(r.ok, '入侵应能开战').toBe(true)
  const d = setBattleDesire(s, 5_000, ctx)
  expect(d.ok, '入侵战斗里应能设期望距离').toBe(true)
  /** 收场：清远征槽（偏好表挂在 `expedition.desirePrefByGalaxy` 上，不受影响） */
  s.expedition.active = false
  s.expedition.battle = null
  s.expedition.anomalyId = null
  weekendNoteAssaultDispatch(s) // 记一次出发 ⇒ 下一场换一支
  s.gameMs += 600_000
  return { cardId: dispatch.cardId, cardGalaxy: card?.galaxyId, ok: d.ok }
}

describe('入侵的期望距离记忆（2026-10-02 船长报障）', () => {
  it('① 连打三场（每场重抽卡）：被占星系始终记得住 5,000', () => {
    const s = world()
    const seenCards: string[] = []
    for (let i = 0; i < 3; i++) {
      const one = fightOneInvasion(s)
      seenCards.push(one.cardId)
      expect(
        desirePrefOf(s, PER),
        `第 ${i + 1} 场后，被占星系「${PER}」应记得 5,000（抽到 ${one.cardId} / 卡自带星系 ${String(one.cardGalaxy)}）`,
      ).toBe(5_000)
      expect(s.expedition.battle, '本场已收场').toBeNull()
    }
    console.log(
      `  [读数] 三连场抽到的卡 = ${seenCards.join(' / ')}；` +
        `偏好表 = ${JSON.stringify(s.expedition.desirePrefByGalaxy)}`,
    )
  })

  it('② 不污染母港：入侵不动「母港」那一份设定', () => {
    const s = world()
    setDesirePrefOf(s, 'galaxy-hub', 9_876)
    fightOneInvasion(s)
    expect(desirePrefOf(s, 'galaxy-hub'), '母港那份应逐字不动（旧口径会被入侵改成战斗里设的值）').toBe(9_876)
    expect(desirePrefOf(s, PER), '而被占星系应记下 5,000').toBe(5_000)
  })

  it('③ 下一场开战按记忆站（不再回默认档）＋ 普通远征零变化', () => {
    const s = world()
    fightOneInvasion(s)
    /** 第二场：开战那一拍就该用 5,000（`beginBattleAt` 显式读本场实际作战星系） */
    const dispatch = weekendAssaultDrawOf(s, ctx, PER, Date.now())!
    const r = startExpedition(s, dispatch.cardId, ctx, { foeGalaxyId: PER })
    expect(r.ok).toBe(true)
    expect(s.expedition.battle?.myDesireM, '开战即按记下的 5,000 站').toBe(5_000)
  })
})
