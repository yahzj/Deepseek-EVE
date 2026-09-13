/**
 * **虫洞 · 副本状态机与存档**（C 批 · 2026-09-13）。
 *
 * 锁住三组口径：
 * ① 副本推进（层 / 节点 / 回合）与两条硬约束——**战斗没结束不能撤**、**回合耗尽只能撤离**；
 * ② 层曲线取向：**收益涨得比威胁快**（船长 2026-09-13：「深层收益应该比难度曲线要更高」）；
 * ③ **v25 存档**：字段纯新增、老档迁移补空状态、往返不丢（含进行中的副本状态）。
 *
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），拍板权在船长；
 * 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { idleAiShipIds } from '../src/ai'
import { shipBusyLabel } from '../src/activity'
import { advanceGame } from '../src/engine'
import { fightEncounter } from '../src/encounters'
import { startExpedition } from '../src/expedition'
import { wormholeStartBattle } from '../src/wormholeBattle'
import { addShipToFleet } from '../src/shipyard'
import {
  shipBusyForWormhole,
  wormholeAdvanceNode,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeOutOfTurns,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
  wormholeMakeNode,
  wormholeNodesPerLayer,
  wormholeStartRun,
} from '../src/wormhole'

const ctx = buildSimContext()
const T1 = 'sandcat'
const T3 = 'sh-thresher'
const T5 = 'sh-colossal'

describe('虫洞 · 进洞门槛与锁定（船长 2026-09-13）', () => {
  it('**主控不闲置就进不去**：主控在采矿 ⇒ 拒绝，文案点名忙态', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    state.shipId = a
    state.mining.active = true // 主控在采矿（判据走 activity.shipBusyLabel）
    const r = wormholeEnter(state, ctx, [a], 7)
    expect(r.ok, '主控忙着还能进洞').toBe(false)
    expect(r.error ?? '').toContain('主控正在')
    expect(state.wormhole.run).toBeNull()
    // 收工后就能进
    state.mining.active = false
    expect(wormholeEnter(state, ctx, [a], 7).ok).toBe(true)
  })

  it('**编队里有人被占用就进不去**：某艘正在 AI 派工 ⇒ 拒绝并点名那艘船', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    state.aiAssignments[b] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: '', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    const r = wormholeEnter(state, ctx, [a, b], 7)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('AI 采矿')
    expect(state.wormhole.run).toBeNull()
  })

  it('**进洞的船被锁定**：洞内船对外一律算忙（AI 指派列表里没有它、忙态写着「虫洞探索中」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    const c = addShipToFleet(state, T1)
    state.shipId = a
    expect(idleAiShipIds(state)).toContain(b) // 进洞前：b/c 都是可指派的空闲船
    expect(wormholeEnter(state, ctx, [b, c], 7).ok).toBe(true)
    // 锁定：洞里那两艘不再出现在"可指派空闲船"里（船长：「已经进洞的船将被锁定（包括货仓）」）
    expect(idleAiShipIds(state)).not.toContain(b)
    expect(idleAiShipIds(state)).not.toContain(c)
    expect(shipBusyLabel(state, ctx, b)).toBe('虫洞探索中')
    // 也不能被重复编入（同一艘船不能同时下两个洞）
    state.wormhole.run = null
    expect(idleAiShipIds(state)).toContain(b)
  })
})

describe('虫洞 · 并行战斗与忙态口径（船长 2026-09-13）', () => {
  it('**（议案待议）主控活动互斥暂不实行**：洞内在跑时，别的活动入口不被虫洞挡（各按自己的前置判）', () => {
    // 船长 2026-09-13：「主控活动相互互斥这个先不要实行，维持现状，当做一个议案，用作之后优化的」
    // ⇒ 本用例把"维持现状"钉住：洞内跑着一趟时，远征收下（主控在洞外）、其余入口各自按前置判
    //   ——将来要实行议案（进洞=主控的一个活动）时，把这条改成"被虫洞挡"即可。
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [b], 7).ok).toBe(true) // a=主控留洞外，b 进洞
    const exp = startExpedition(state, 'ano-training', ctx)
    expect(exp.ok, `洞内在跑时出击被挡了（议案已生效？）：${exp.error ?? ''}`).toBe(true)
    expect(state.expedition.battle).toBeTruthy()
    // 归还：把外部那场收掉，避免影响同文件其它用例（各用例档独立，这里只是保险）
    state.expedition.battle = null
    state.expedition.active = false
  })

  it('**洞内战斗进行中，洞外照常能开新战斗**（船长 2026-09-13）：走"遭遇"这条不受活动位限制的路', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const holeBattle = run.battle!
    // 洞外触发一场遭遇（AI 船/主控在外都可能）：**战斗系统不因洞内战而关闭**
    state.encounter = {
      ...state.encounter,
      active: true,
      shipId: state.shipId, // 主控在洞外 ⇒ 锚点不冲突
      galaxyId: 'gx-home',
      name: '测试遭遇',
      threat: 40,
      anomalyId: 'ano-training',
      origin: 'test',
      invitedAtGameMs: 0,
      deadlineGameMs: 10_000_000,
    }
    const fights = fightEncounter(state, ctx)
    expect(fights.ok, fights.error ?? '').toBe(true)
    expect(state.encounter.battle, '洞外那场没开起来').toBeTruthy()
    // 锚点各在各边：洞内锚 = run.fleet[0]，洞外锚 = 主控（不在洞里 ⇒ 不会被两场同时读写）
    expect(run.fleet).not.toContain(state.shipId)
    const tickBefore = holeBattle.lastTickGameMs
    for (let i = 0; i < 2; i++) advanceGame(state, 500, ctx, { nowWallMs: 0 })
    expect(state.encounter.battle, '洞外那场被洞内那场吞了').toBeTruthy()
    const hole = state.wormhole.run?.battle
    if (hole) expect(hole.lastTickGameMs).toBeGreaterThanOrEqual(tickBefore) // 各推各的
  })

  it('**锚点锁定仍在**：主控编在洞里 ⇒ 出击被拒（这条属"锁定"裁定，不在议案退回范围）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const pilot = state.shipId
    const a = addShipToFleet(state, T1)
    expect(wormholeEnter(state, ctx, [pilot, a], 7).ok).toBe(true) // 船长裁定 B：主控可编入
    const r = startExpedition(state, 'ano-training', ctx)
    expect(r.ok, '主控被锁在洞里还能出击 = 两场战斗共用一个锚点').toBe(false)
    expect(r.error ?? '').toContain('虫洞里')
  })

  it('忙态口径不漂移：`shipBusyForWormhole` 与界面侧 `shipBusyLabel` 必须同时"忙/闲"', () => {
    const scenarios: Array<[string, (s: GameState) => void]> = [
      ['空闲', () => {}],
      [
        '主控采矿',
        (s) => {
          s.mining.active = true
        },
      ],
      [
        '主控远征',
        (s) => {
          startExpedition(s, 'ano-training', ctx) // 用真实状态转换，别手搓字段（手搓会造出"假忙"）
        },
      ],
    ]
    for (const [name, setup] of scenarios) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      const a = addShipToFleet(state, T1)
      const b = addShipToFleet(state, T1)
      state.shipId = a
      setup(state)
      expect(
        shipBusyForWormhole(state, a) !== null,
        `${name}：主控忙态两边不一致（${shipBusyForWormhole(state, a)} vs ${shipBusyLabel(state, ctx, a)}）`,
      ).toBe(shipBusyLabel(state, ctx, a) !== null)
      // 副船：AI 派工 ⇒ 两边都算忙
      state.aiAssignments[b] = {
        coreType: 'basic',
        startedAtGameMs: 0,
        task: { kind: 'mining', beltId: '', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
      }
      expect(shipBusyForWormhole(state, b) !== null).toBe(shipBusyLabel(state, ctx, b) !== null)
    }
  })
})

describe('虫洞 · 起程与副本推进', () => {
  it('合法编队可起程：锁定质量/回合、进入 inside、首节点是战斗', () => {
    const r = wormholeStartRun(ctx, [T1, T1, T1, T1], 12345)
    expect(r.ok).toBe(true)
    const run = r.run!
    expect(run.phase).toBe('inside')
    expect(run.depth).toBe(1)
    expect(run.totalMass).toBe(2_000)
    expect(run.turnsTotal).toBe(51) // 4×T1 = 51 回合（B 批表）
    expect(run.turnsLeft).toBe(51)
    expect(run.bag).toEqual([])
    expect(run.pendingNode?.kind).toBe('combat') // 每层首节点固定战斗
  })

  it('不合法编队照旧被拒（旗舰 / 超质量 / 空编队）', () => {
    expect(wormholeStartRun(ctx, [T5], 1).ok).toBe(false)
    // 4×T3 = 14,000 是**合法**上限内编成（设计稿表）；超限要用 2×T4 + 1×T3 = 17,500
    expect(wormholeStartRun(ctx, [T3, T3, T3, T3], 1).ok).toBe(true)
    expect(wormholeStartRun(ctx, ['sh-swordfish', 'sh-swordfish', T3], 1).ok).toBe(false)
    expect(wormholeStartRun(ctx, ['sh-x'], 1).ok).toBe(false)
    expect(wormholeStartRun(ctx, [], 1).ok).toBe(false)
  })

  it('节点推进：本层走完 ⇒ 进入层末抉择（pendingNode = null）', () => {
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 777)!.run!
    const turnsBefore = run.turnsLeft
    const first = wormholeAdvanceNode(ctx, run, 777)
    expect(first.ok).toBe(true)
    expect(first.spent).toBeGreaterThan(0)
    expect(run.turnsLeft).toBe(turnsBefore - first.spent!)
    // 层 1 有 2 个节点 ⇒ 再推进一步即到层末
    const second = wormholeAdvanceNode(ctx, run, 777)
    expect(second.ok).toBe(true)
    expect(second.atLayerEnd).toBe(true)
    expect(run.pendingNode).toBeNull()
  })

  it('**战斗没结束不能撤**：层内（还有待处理节点）撤离被拒', () => {
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 5)!.run!
    expect(run.pendingNode).not.toBeNull()
    const r = wormholeExtract(run)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('战斗没结束')
    expect(run.phase).toBe('inside') // 相位没动
  })

  it('**回合耗尽只能撤离**：回合不足时推进被拒、深入被拒、撤离放行', () => {
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 9)!.run!
    // 人为把回合压到走不动任何一个节点
    run.turnsLeft = 0
    const adv = wormholeAdvanceNode(ctx, run, 9)
    expect(adv.ok).toBe(false)
    expect(adv.mustExtract).toBe(true)
    // 层末（清空待处理节点 + 本层守卫已清）后：深入被拒、撤离放行
    run.pendingNode = null
    run.bossCleared = run.depth
    const desc = wormholeDescend(run, 9)
    expect(desc.ok).toBe(false)
    expect(desc.mustExtract).toBe(true)
    const ex = wormholeExtract(run)
    expect(ex.ok).toBe(true)
    expect(run.phase).toBe('extracting')
  })

  it('**层末守卫是门**（F 批）：守卫没清时不能深入、也不能撤离', () => {
    const run = wormholeStartRun(ctx, [T1, T1], 77)!.run!
    run.pendingNode = null // 层内走完，进入"层末抉择"
    expect(wormholeDescend(run, 77).ok).toBe(false)
    expect(wormholeDescend(run, 77).error ?? '').toContain('守卫')
    expect(wormholeExtract(run).ok).toBe(false)
    // 打通本层守卫后两条路都放行
    run.bossCleared = run.depth
    expect(wormholeDescend(run, 77).ok).toBe(true)
    expect(run.depth).toBe(2)
  })

  it('**逃生门**（2026-09-13 修死局）：回合付不起当前节点时，哪怕节点没结算、守卫没清，撤离也放行', () => {
    const run = wormholeStartRun(ctx, [T1, T1], 31)!.run!
    // 造"付不起"的现场：手上 1 回合，当前节点要 2 回合（拾取/事件节点没有「迎战」这条路）
    run.turnsLeft = 1
    run.pendingNode = { kind: 'pickup', waves: 1, pickups: 1, cost: 2, piles: [] }
    expect(wormholeOutOfTurns(run)).toBe(true)
    expect(wormholeAdvanceNode(ctx, run, 31).ok).toBe(false) // 结算被拒（只能撤离）
    const ex = wormholeExtract(run)
    expect(ex.ok, '回合付不起节点时撤不走 = 死局').toBe(true)
    expect(run.phase).toBe('extracting')
    // 负向：回合充足时这条路不该被打开（守卫照旧是门）
    const run2 = wormholeStartRun(ctx, [T1, T1], 31)!.run!
    run2.turnsLeft = 5
    run2.pendingNode = { kind: 'pickup', waves: 1, pickups: 1, cost: 2, piles: [] }
    expect(wormholeOutOfTurns(run2)).toBe(false)
    expect(wormholeExtract(run2).ok).toBe(false)
    expect(wormholeExtract(run2).error ?? '').toContain('战斗没结束')
    run2.pendingNode = null
    expect(wormholeExtract(run2).error ?? '').toContain('守卫') // 守卫未清照旧是门
    // 回合耗尽（= 0）时同样放行
    run2.turnsLeft = 0
    expect(wormholeOutOfTurns(run2)).toBe(true)
    expect(wormholeExtract(run2).ok).toBe(true)
  })

  it('战斗中的逃生门不生效：**战斗没结束一律不能撤**（船长裁定优先于回合）', () => {
    const run = wormholeStartRun(ctx, [T1, T1], 41)!.run!
    run.turnsLeft = 0
    run.pendingNode = null
    run.battle = {} as never // 只验"有没有战斗宿主"这一层判据
    const r = wormholeExtract(run)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('战斗中')
    expect(run.phase).toBe('inside')
  })

  it('深入下一层：层末可用，深度 +1、节点数按层（层 3 起 3 个）', () => {
    const run = wormholeStartRun(ctx, [T1, T1], 42)!.run!
    run.pendingNode = null // 模拟已清空本层
    run.bossCleared = run.depth
    expect(wormholeDescend(run, 42).ok).toBe(true)
    expect(run.depth).toBe(2)
    expect(run.nodeIndex).toBe(0)
    expect(run.nodesPerLayer).toBe(wormholeNodesPerLayer(2))
    run.pendingNode = null
    run.bossCleared = run.depth
    wormholeDescend(run, 42)
    expect(run.depth).toBe(3)
    expect(run.nodesPerLayer).toBe(3)
  })

  it('节点生成是确定性的（同 seed/depth/index ⇒ 同结果）', () => {
    const a = wormholeMakeNode(2026, 3, 1)
    const b = wormholeMakeNode(2026, 3, 1)
    expect(a).toEqual(b)
    expect(a.cost).toBeGreaterThanOrEqual(1)
  })
})

describe('虫洞 · 层曲线（收益涨得比威胁快 —— 船长 2026-09-13 定）', () => {
  it('威胁每层 ×1.16（层 1 = 45）、收益每层 ×1.2 ⇒ 单位威胁收益逐层严格上升', () => {
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeLayerThreat(2)).toBe(52) // round(45×1.16)
    expect(wormholeLayerThreat(3)).toBe(61) // round(45×1.16²)
    expect(wormholeLayerRewardMul(1)).toBeCloseTo(1, 9)
    expect(wormholeLayerRewardMul(2)).toBeCloseTo(1.2, 9)
    const perThreat = (d: number): number => wormholeLayerRewardMul(d) / wormholeLayerThreat(d)
    // 逐层**严格递增**（这正是"深层收益比难度曲线更高"的数学形式）
    for (let d = 1; d <= 12; d += 1) {
      expect(perThreat(d + 1), `第 ${d + 1} 层单位威胁收益应高于第 ${d} 层`).toBeGreaterThan(perThreat(d))
    }
  })
})

describe('虫洞 · v25 存档（纯新增字段 + 零迁移）', () => {
  it('当前存档版本 = 25，新档带空虫洞状态', () => {
    expect(CURRENT_STATE_VERSION).toBe(25)
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.version).toBe(25)
    expect(s.wormhole).toEqual({ run: null, lastFleetLost: 0 })
  })

  it('老档（缺 wormhole 字段）读档 ⇒ 补空状态，不报错', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    const raw = JSON.parse(serializeSaveFile(s, 0)) as { version: number; state: Record<string, unknown> }
    delete raw.state.wormhole
    raw.version = 24
    raw.state.version = 24
    const loaded = loadSaveFile(JSON.stringify(raw))
    expect(loaded.state.wormhole).toEqual({ run: null, lastFleetLost: 0 })
  })

  it('进行中的副本状态随档往返不丢（层/回合/背包/待处理节点）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 3 })
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 2026)!.run!
    run.bag.push({ itemId: 'ore-voidmother', units: 800 })
    run.turnsLeft -= 3
    s.wormhole = { run, lastFleetLost: 1 }
    const loaded = loadSaveFile(serializeSaveFile(s, 0)).state
    const back = loaded.wormhole.run!
    expect(back.phase).toBe('inside')
    expect(back.depth).toBe(1)
    expect(back.turnsLeft).toBe(run.turnsLeft)
    expect(back.turnsTotal).toBe(51)
    expect(back.fleet).toEqual([T1, T1, T1, T1])
    expect(back.bag).toEqual([{ itemId: 'ore-voidmother', units: 800 }])
    expect(back.pendingNode).toEqual(run.pendingNode)
    expect(loaded.wormhole.lastFleetLost).toBe(1)
  })

  it('坏掉的虫洞字段 ⇒ 当作"不在洞里"（不静默留半截状态）', () => {
    const s: GameState = createInitialState({ nowWallMs: 0, seed: 4 })
    const raw = JSON.parse(serializeSaveFile(s, 0)) as { state: Record<string, unknown> }
    raw.state.wormhole = { run: { phase: '飞升', depth: 'x', bag: 'nope' }, lastFleetLost: -5 }
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.wormhole.run).toBeNull()
    expect(loaded.wormhole.lastFleetLost).toBe(0)
  })
})
