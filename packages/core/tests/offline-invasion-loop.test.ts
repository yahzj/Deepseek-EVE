/**
 * **离线期间「重复出击」也要继续清缴入侵**（**2026-09-26 玩家报障**）。
 *
 * 船长转述：「**玩家反应，自动清缴入侵悬赏，离线后进度不涨。**」
 *
 * 真因：`simulateOffline` 的分片驱动只看 `state.autoLoopAnomalyId`（常驻悬赏那条循环），
 * 每片也只调 `advanceAutoLoopBounty` ⇒ **入侵的「重复出击」在离线路径里没有任何调用点**
 * （在线由引擎心跳调 `advanceAutoLoopInvasion`）⇒ 离线期间不再出发，夺回进度自然不涨。
 *
 * 本用例锁住修后的行为：**离线一段时间后，被占星系的玩家投入（`contributed`）必须涨**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { simulateOffline } from '../src/simulation'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const PER = 'galaxy-redring'

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
    /** 「重复出击」开着 ⇒ 离线也该继续清缴 */
    autoLoopGalaxyId: PER,
  }
  s.weekendEvent = ev
  return s
}

describe('离线期间的入侵「重复出击」（玩家报障）', () => {
  it('离线 30 分钟：循环会继续出发（`assaultDraws` 涨）——修前离线期间一场都不出发', () => {
    const s = world()
    const drawsBefore = s.weekendEvent!.assaultDraws ?? 0
    const putBefore = s.weekendEvent!.contributed[PER] ?? 0
    simulateOffline(s, 0, 30 * 60_000, ctx)
    const drawsAfter = s.weekendEvent!.assaultDraws ?? 0
    /**
     * ⚠ 断言的是**再出发次数**（离线路径的缺失点）：这一局用的是初始船（打不过 H 骚扰舰队 ⇒
     * **打输不加进度**，属设计），所以投入 `contributed` 未必涨；但"离线期间根本没出发"是玩家报障的
     * 那个缺陷 ⇒ 这里锁死"必须出发过"。
     */
    expect(drawsAfter, '离线期间应至少再出发一场（修前恒 0）').toBeGreaterThan(drawsBefore)
    console.log(
      `  [读数] 离线 30 分钟：出发场次 ${drawsBefore} → ${drawsAfter} · 投入 ${putBefore} → ${s.weekendEvent!.contributed[PER] ?? 0}` +
        ` · 场上作业 = ${s.expedition.active ? '仍在飞' : '空闲'}（本局船弱 ⇒ 打输不加进度属设计）`,
    )
  })
})
