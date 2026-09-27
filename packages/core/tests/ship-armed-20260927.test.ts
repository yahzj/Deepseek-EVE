/**
 * **「装了武器吗」单点判据 ＋ 抵达日志口径**（**2026-09-27 玩家报障修复**）。
 *
 * 报障：装**激光炮**或**无人机**的船打悬赏时，抵达目标日志提示「未装配武器：仅基础舰炮还击。」
 * 根因：`expedition` 那处判据只认 `turret` / `missile`（注释自陈 V18B-1 口径），
 * 漏了 **V18B-2 归位的 `laser`（能量系）** 与**无人机线**；而 `weekendLaunch` 另有**一份不同的**判据（5 个槽）。
 * 本批抽全仓单点 `equipment.shipHasWeapon`（判据 = `WEAPON_SLOTS` 五类槽）⇒ 两处共用。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { shipHasWeapon } from '../src/equipment'
import { startExpedition } from '../src/expedition'
import { advanceGame } from '../src/engine'
import { clearInitialStanding, setStanding } from './helpers'

const ctx = buildSimContext()
/** 目标异常（真 ctx 里挑一个；用例自己点亮它的星系） */
const ANO = [...ctx.anomalies.values()][0]!
/** 按槽位动态挑一件（不写死 id，表里换名字也不影响本用例） */
const firstOf = (slot: string): string => [...ctx.modules.values()].find((m) => m.slot === slot)!.id

function fresh(): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  state.wallet.isk = 500_000
  clearInitialStanding(state)
  setStanding(state, 'dsi', 100)
  state.exploredGalaxies.push(ANO.galaxyId)
  return state
}
function fitHigh(state: GameState, modId: string): void {
  state.fleet[state.shipId]!.fitted = { high: [modId], mid: [null], low: [null] }
}
function arrivedLog(state: GameState): string {
  return state.logs.map((l) => l.text).filter((t) => t.includes('抵达目标')).join(' ｜ ')
}

describe('装了武器吗：单点判据 ＋ 抵达日志', () => {
  it('五类武器槽都算「已装武器」；加成件与插件不算', () => {
    for (const slot of ['turret', 'missile', 'laser', 'drone-rack', 'drone-tac']) {
      const state = fresh()
      fitHigh(state, firstOf(slot))
      expect(shipHasWeapon(state, ctx, state.shipId), `槽位 ${slot} 应算武器`).toBe(true)
    }
    for (const slot of ['support', 'drone-relay', 'target-lock', 'plug']) {
      const state = fresh()
      fitHigh(state, firstOf(slot))
      expect(shipHasWeapon(state, ctx, state.shipId), `槽位 ${slot} 不该算武器`).toBe(false)
    }
  })

  it('**装激光/无人机的船，抵达日志不再说「未装配武器」**（报障回归）', () => {
    for (const slot of ['turret', 'missile', 'laser', 'drone-rack']) {
      const state = fresh()
      fitHigh(state, firstOf(slot))
      expect(startExpedition(state, ANO.id, ctx).ok, `出发(${slot})`).toBe(true)
      advanceGame(state, 1_000, ctx)
      expect(arrivedLog(state).includes('未装配武器'), `${slot} 不该被判「未装配武器」`).toBe(false)
    }
  })
})