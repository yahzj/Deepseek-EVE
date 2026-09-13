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
import {
  wormholeAdvanceNode,
  wormholeDescend,
  wormholeExtract,
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
    // 层末（清空待处理节点）后：深入被拒、撤离放行
    run.pendingNode = null
    const desc = wormholeDescend(run, 9)
    expect(desc.ok).toBe(false)
    expect(desc.mustExtract).toBe(true)
    const ex = wormholeExtract(run)
    expect(ex.ok).toBe(true)
    expect(run.phase).toBe('extracting')
  })

  it('深入下一层：层末可用，深度 +1、节点数按层（层 3 起 3 个）', () => {
    const run = wormholeStartRun(ctx, [T1, T1], 42)!.run!
    run.pendingNode = null // 模拟已清空本层
    expect(wormholeDescend(run, 42).ok).toBe(true)
    expect(run.depth).toBe(2)
    expect(run.nodeIndex).toBe(0)
    expect(run.nodesPerLayer).toBe(wormholeNodesPerLayer(2))
    run.pendingNode = null
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
