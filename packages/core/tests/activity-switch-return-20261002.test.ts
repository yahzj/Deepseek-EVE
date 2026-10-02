/**
 * 🔴 **切活动"自动停作业"之后，船必须返航**（**船长 2026-10-02 报障**，原话照抄）：
 *
 * > 「**关于前几轮修改了玩家主控活动的舰船返航情况，虽然你修了，但是只修了一半，之前有设定过，
 * > 玩家切换舰船的话，正在采矿的舰船会自动返航，并且返航图中可以切换其他舰船。但是打捞都没有**」
 *
 * **修的是哪一半**：上一次我只修了"**玩家手动点停止**"那条路（`stopMining` / `stopSalvageOp` 建返航账本）；
 * 而"**被别的活动挤掉**"走的是 `state.haltActivityForSwitch` —— 它只调**纯状态**的 `miningHalt` / `salvageHalt`，
 * **不建返航账本** ⇒ 船留在原地。本用例钉的就是这一半。
 *
 * 另加一条**必要的区分**（见 `state.haltedBySwitch`）：`startMining` / `startSalvageOp` 里那条
 * "新指令取消返航"必须**跳过**切活动这一路 —— 否则刚建好的账本会被新活动开工时删掉（实测踩到）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining } from '../src/mining'
import { startSalvageOp } from '../src/salvaging'
import { countWare } from '../src/inventory'
import { anomaly, belt, galaxy, makeTestCtx, moduleDef, ship } from './helpers'

function ctxOf() {
  return makeTestCtx({
    ships: [ship('sandcat', { cargo: 800 })],
    belts: [belt('belt-a', 'ore-a')],
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-scrap', '废场'), security: -0.6 },
    ],
    edges: [{ from: 'galaxy-hub', to: 'galaxy-scrap', travelMinutes: 2 }],
    anomalies: [anomaly('ano-far', 'galaxy-scrap', { threat: 40, tactic: 'brawl' })],
    modules: [moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
}

describe('切活动自动停作业 ⇒ 船返航（船长 2026-10-02 报障的另一半）', () => {
  it('打捞中下开采指令：自动停打捞 ⇒ 本趟残骸随返航卸入仓库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.debugQuick = true
    state.exploredGalaxies.push('galaxy-scrap')
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    state.galaxyWrecks['galaxy-scrap'] = { density: 30, rare: 0 }
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx)
    expect(state.fleet[state.shipId]!.cargo['wreck-ano-far'] ?? 0, '本趟应有收获').toBeGreaterThan(0)
    /** 🔴 切活动：新开采指令会把打捞挤掉（`AUTO_HALT` 档） */
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.salvaging.active, '打捞应已被自动停掉').toBe(false)
    expect(
      state.logs.some((l) => l.text.includes('打捞已停止') && l.text.includes('返航空间站')),
      '应写"返航空间站"日志（而不是静默清状态）',
    ).toBe(true)
    /** 推进到港：残骸应卸入物品仓库（修前这一步永远是 0） */
    advanceGame(state, 300_000, ctx)
    expect(countWare(state, 'wreck-ano-far'), '残骸应随返航卸入仓库').toBeGreaterThan(0)
    expect(state.fleet[state.shipId]!.cargo['wreck-ano-far'] ?? 0, '船上应已清空').toBe(0)
  })

  it('采矿中下打捞指令：自动停采矿 ⇒ 本趟原矿随返航卸入仓库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.debugQuick = true
    state.exploredGalaxies.push('galaxy-scrap')
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    state.galaxyWrecks['galaxy-scrap'] = { density: 30, rare: 0 }
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    advanceGame(state, 60_000, ctx)
    expect(state.fleet[state.shipId]!.cargo['ore-a'] ?? 0, '本趟应有收获').toBeGreaterThan(0)
    expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
    expect(state.mining.active, '采矿应已被自动停掉').toBe(false)
    expect(
      state.logs.some((l) => l.text.includes('开采已停止') && l.text.includes('返航空间站')),
      '应写"返航空间站"日志',
    ).toBe(true)
    advanceGame(state, 300_000, ctx)
    expect(countWare(state, 'ore-a'), '原矿应随返航卸入仓库').toBeGreaterThan(0)
  })
})