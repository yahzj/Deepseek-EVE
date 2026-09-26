/**
 * **装填冷却条上的无人机条目**：机群被打光后必须"看得见"。
 *
 * **2026-09-26 玩家报障**（船长转述）：「**玩家战斗中如果无人机被摧毁，中间下方的各种装备条的内容也要更新，
 * 玩家今天反应就是无人机显示就绪不会开火，但是无人机实际上已经被打掉了。**」
 *
 * 冷却条只反映**装填周期**：机群全灭时它照样归零 ⇒ 那一格会继续写「就绪」，玩家以为马上开火。
 * 界面的修法是"再看一眼存活架数"（`BattleScreen` 取**视图锚那条舰**的 `drones`，与画机体同一份读数）。
 * 本用例锁的正是那份读数：**机群池全灭 ⇒ 视图里该机型的存活架数为 0**（谁把这条链改坏了，这里当场红）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { battleArcsFor } from '../src/combat'
import { beginBattleAt } from '../src/expedition'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const CARD = 'ink-harass'

function world(): { s: GameState; artId: string } {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  const ship = s.fleet[s.shipId]!
  ship.fitted = { high: ['mod-drone-rack-1', 'mod-laser-1'], mid: [], low: [] } as never
  s.moduleBay['mod-drone-rack-1'] = 1
  s.moduleBay['mod-laser-1'] = 1
  ship.droneLoad = { 'drone-scout': 2 }
  s.warehouse.items['ammo-plasma-l'] = 20_000
  s.exploredGalaxies.push('galaxy-redring')
  expect(beginBattleAt(s, ctx, CARD, s.shipId, 0), `开不出「${CARD}」这场战斗`).toBe(true)
  // 我方机群条目（`src: 'drone'`）——界面就是按它出那一格的
  const drone = view(s).me.find((w) => w.src === 'drone')
  expect(drone, '本场应有一条无人机武器条目（用例前提）').toBeDefined()
  expect(drone!.artId, '无人机条目应带机型 id（界面按它查存活架数）').toBeDefined()
  return { s, artId: drone!.artId! }
}

/** 视图（显式给战斗上下文：本用例不经 startExpedition，故走 F 批的 override 口径） */
function view(s: GameState) {
  return battleArcsFor(s, ctx, { battle: s.expedition.battle!, anomaly: ctx.anomalies.get(CARD)!, leaderShipId: s.shipId })!
}

/** 视图锚（主控）那条舰、该机型的**存活**架数——界面读的就是这个 */
function aliveOf(s: GameState, artId: string): number {
  const leader = view(s).myUnits.find((u) => u.leader)
  return leader?.drones.find((d) => d.artId === artId)?.count ?? 0
}

describe('战斗中机群被打光 ⇒ 装填条读到的存活架数归零', () => {
  it('开战时存活 = 载机数；池全灭后 = 0（界面据此把「就绪」改写成「机群已损失」）', () => {
    const { s, artId } = world()
    expect(aliveOf(s, artId), '开战时应有 2 架').toBe(2)
    const battle = s.expedition.battle!
    expect(Object.keys(battle.dronePools ?? {}).length, '本场应建了机群池').toBeGreaterThan(0)
    /** 把机群池打光（等价于点防/敌火把这一型全部击落）——池键 = `舰tag:条目下标` */
    battle.dronePools = Object.fromEntries(
      Object.entries(battle.dronePools ?? {}).map(([k, p]) => [k, { ...p, alive: false, hp: { s: 0, a: 0, h: 0 } }]),
    )
    expect(aliveOf(s, artId), '全灭后存活架数必须归零（否则条上会继续写「就绪」）').toBe(0)
    console.log(`  [读数] 机型 ${artId}：开战 2 架 → 全灭后 ${aliveOf(s, artId)} 架（界面那一格 ⇒ 机群已损失）`)
  })
})
