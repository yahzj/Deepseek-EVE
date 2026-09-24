/**
 * **实战胜利记录**（`state.winRecord`，**2026-09-24 船长令**）。
 *
 * 船长原话（设计裁定，逐条落地）：「**③按敌卡。记录残血最多的一次，如果都是满血则不覆盖。夹回当前射程内。**」
 *
 * 用途 = 胜率预估"**打过的卡按打过的距离算**"那一支的唯一输入（消费侧见 `winEstimate.ts`）：
 * 有记录的卡不再三点采样，直接按**记录距离**跑满局数。
 *
 * 本用例锁四件事：
 * ① **只由实战胜利写入**——键 = 本场目标卡 id · 距离 = 本场实际期望距离 · 剩余比例 =（装甲+结构）÷ 满值；
 * ② **只在更高时覆盖**（等值/更低都不写 ⇒ "都是满血则不覆盖"）；
 * ③ **失败不写**（打输了没有任何"这个距离可行"的证据）；
 * ④ **随档**（`save.ts` 清洗器逐字段重建 ⇒ 漏登记就会被清空；空表不落键 ⇒ 老档零迁移）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { DSI_FACTION_ID, resolveBattleOutcome, startExpedition } from '../src/expedition'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const CARD = 'ano-pirate-post'

/** 造局：满声望、全星系已探索、单舰出击（与 `bounty-reward-display.test.ts` 同款） */
function world(c: SimContext = ctx): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  const uid = addShipToFleet(state, 'sh-mako')
  state.shipId = uid
  state.standings[DSI_FACTION_ID] = 30
  for (const g of c.galaxies.keys()) if (!state.exploredGalaxies.includes(g)) state.exploredGalaxies.push(g)
  const r = startExpedition(state, CARD, c)
  expect(r.ok, r.error ?? '').toBe(true)
  return state
}

/** 把玩家这场打完时的装甲/结构压到指定剩余比例（满值为 1；护盾不进分子） */
function wearDown(state: GameState, keep: number): void {
  const u = state.expedition.battle!.units['player']!
  const full = u.hpMax ?? u.hp
  u.hp.a = full.a * keep
  u.hp.h = full.h * keep
}

describe('实战胜利记录（2026-09-24 船长令）', () => {
  it('真打赢 ⇒ 按敌卡记一行：距离 = 本场期望距离、剩余比例 =（甲+结构）÷ 满值', () => {
    const state = world()
    const battle = state.expedition.battle!
    const desire = battle.myDesireM
    expect(desire).toBeGreaterThan(0)
    wearDown(state, 0.5)
    battle.ended = 'me'
    resolveBattleOutcome(state, ctx)
    const rec = state.winRecord?.[CARD]
    expect(rec).toBeDefined()
    expect(rec!.desireM).toBe(desire)
    expect(rec!.remainPct).toBeCloseTo(0.5, 6)
  })

  it('只在更高时覆盖：更低不写、等值不写（"都是满血则不覆盖"）、更高才写', () => {
    const state = world()
    // 先记一行 0.9
    wearDown(state, 0.9)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(state.winRecord?.[CARD]?.remainPct).toBeCloseTo(0.9, 6)
    // 再打一场更惨的胜利（0.3）：记录原样
    const s2 = world()
    const desire2 = s2.expedition.battle!.myDesireM
    wearDown(s2, 0.3)
    s2.winRecord = { [CARD]: { desireM: 111, remainPct: 0.9 } }
    s2.expedition.battle!.ended = 'me'
    resolveBattleOutcome(s2, ctx)
    expect(s2.winRecord![CARD], '更惨的胜利不覆盖').toEqual({ desireM: 111, remainPct: 0.9 })
    expect(desire2).toBeGreaterThan(0) // 本场确实有期望距离（只是没被写进去）
    // 等值（两次都满血）也不写
    const s3 = world()
    s3.winRecord = { [CARD]: { desireM: 111, remainPct: 1 } }
    s3.expedition.battle!.ended = 'me' // 满血胜利
    resolveBattleOutcome(s3, ctx)
    expect(s3.winRecord![CARD]!.desireM, '等值不覆盖（距离保持原值）').toBe(111)
    // 更高才写（距离换成这一场的）
    const s4 = world()
    const desire4 = s4.expedition.battle!.myDesireM
    wearDown(s4, 0.8)
    s4.winRecord = { [CARD]: { desireM: 222, remainPct: 0.4 } }
    s4.expedition.battle!.ended = 'me'
    resolveBattleOutcome(s4, ctx)
    expect(s4.winRecord![CARD]).toEqual({ desireM: desire4, remainPct: 0.8 })
  })

  it('打输/撤退 ⇒ 不写（打输了不算"这个距离可行"的证据）', () => {
    const state = world()
    state.expedition.battle!.ended = 'foe'
    resolveBattleOutcome(state, ctx)
    expect(state.winRecord).toBeUndefined()
  })

  it('随档：读档后记录还在（空表不落键 ⇒ 老档零迁移）', () => {
    const state = world()
    wearDown(state, 0.7)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    const desire = state.winRecord![CARD]!.desireM
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(back.winRecord?.[CARD]).toEqual({ desireM: desire, remainPct: state.winRecord![CARD]!.remainPct })
    // 没有记录的档：不落键（与改动前逐字一致）
    const fresh = createInitialState({ nowWallMs: 0, seed: 5 })
    const file = JSON.parse(serializeSaveFile(fresh, 1)) as { state: Record<string, unknown> }
    expect('winRecord' in file.state).toBe(false)
  })

  it('读档清洗：非法行（距离 ≤0 / 比例越界）不落盘，合法行保留', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.winRecord = {
      'ano-ok': { desireM: 1500, remainPct: 0.42 },
      'ano-zero': { desireM: 0, remainPct: 0.5 },
      'ano-neg': { desireM: -3, remainPct: 0.5 },
      'ano-high': { desireM: 900, remainPct: 3 },
    }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(back.winRecord).toEqual({
      'ano-ok': { desireM: 1500, remainPct: 0.42 },
      'ano-high': { desireM: 900, remainPct: 1 },
    })
  })
})
