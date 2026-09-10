/**
 * 无人机专用舰高槽 −2（2026-09-10 船长拍板：梭鱼级 5→3、王鲭级 6→4；其余带机巢舰船不动）。
 *
 * 覆盖三件事：
 * ① **布局钉住**——两舰槽位（高/中/低）防回归；
 * ② **旧档兼容**——超长位由 repair 链把尾件退回装备库（不丢装备、无人机清单保留）；
 * ③ **装配面**——三槽无人机配置合法，第四件被拒（该高槽类无空位）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  countModule,
  createInitialState,
  fitModule,
  repairDeprecatedModules,
} from '../src/index'

const ctx = buildSimContext()

describe('无人机专用舰高槽 −2（2026-09-10 船长拍板）', () => {
  it('布局钉住：梭鱼 3/3/2、王鲭 4/2/2', () => {
    expect(ctx.ships.get('sh-swarm')!.slots).toEqual({ high: 3, mid: 3, low: 2 })
    expect(ctx.ships.get('sh-sentinel')!.slots).toEqual({ high: 4, mid: 2, low: 2 })
  })

  it('旧档兼容：四槽时代的梭鱼装配 → 尾件退回装备库、清单与前三件保留', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const uid = addShipToFleet(state, 'sh-swarm')
    const entry = state.fleet[uid]!
    // 四槽时代遗留：甲板×2 + 导控×2（旧 D2 配装）
    entry.fitted = {
      high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2'],
      mid: [null, null, null],
      low: [null, null],
    }
    entry.droneLoad = { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }
    state.moduleBay['mod-drone-tac-2'] = 0

    repairDeprecatedModules(state, ctx)

    const after = state.fleet[uid]!
    expect(after.fitted.high).toHaveLength(3)
    expect(after.fitted.high).toEqual(['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2'])
    expect(countModule(state, 'mod-drone-tac-2')).toBe(1) // 第 4 件退库，不丢装备
    expect(after.droneLoad).toEqual({ 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }) // 清单保留
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[uid]!.fitted.high).toHaveLength(3)
    expect(countModule(state, 'mod-drone-tac-2')).toBe(1)
  })

  it('装配面：三槽装满后第四件被拒（无空位）；王鲭四槽恰好容下 D3 配装', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const swarm = addShipToFleet(state, 'sh-swarm')
    state.fleet[swarm]!.fitted = { high: [null, null, null], mid: [null, null, null], low: [null, null] }
    state.moduleBay['mod-drone-rack-2'] = 2
    state.moduleBay['mod-drone-tac-2'] = 2
    state.shipId = swarm
    expect(fitModule(state, 'mod-drone-rack-2', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-drone-rack-2', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-drone-tac-2', ctx).ok).toBe(true)
    const overflow = fitModule(state, 'mod-drone-tac-2', ctx)
    expect(overflow.ok).toBe(false) // 3 高槽已满
    expect(state.fleet[swarm]!.fitted.high.filter(Boolean)).toHaveLength(3)

    const sent = addShipToFleet(state, 'sh-sentinel')
    state.fleet[sent]!.fitted = { high: [null, null, null, null], mid: [null, null], low: [null, null] }
    state.moduleBay['mod-drone-rack-3'] = 2
    state.moduleBay['mod-drone-tac-3'] = 2
    state.shipId = sent
    for (const id of ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3']) {
      expect(fitModule(state, id, ctx).ok).toBe(true)
    }
    expect(state.fleet[sent]!.fitted.high.filter(Boolean)).toEqual([
      'mod-drone-rack-3',
      'mod-drone-rack-3',
      'mod-drone-tac-3',
      'mod-drone-tac-3',
    ])
  })
})
