/**
 * 玩家标记（收藏）测试（2026-09-10）：
 * - 切换指令：标记 / 取消 / 幂等往返；非法 id（查不到的商品、资源、蓝图、船）被拒绝；
 * - 存档：白名单往返保留、老档缺字段 = 四类全空、剪枝（不在舰队的船标记清除、重复项去重）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState, emptyMarks } from '../src/state'
import { isMarked, markedIds, markTargetExists, pruneMarks, toggleMark } from '../src/marks'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { makeTestCtx } from './helpers'

/** 测试世界：默认目录里自动生成 it-ore-a（物品）、bp-bp-a（蓝图）、ship-sandcat（船价 >0）等商品卡 */
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ctx = makeTestCtx()
  return { state, ctx }
}

describe('玩家标记 · 切换指令', () => {
  it('新档四类全空；标记后写入、再切换取消', () => {
    const { state, ctx } = world()
    expect(state.marks).toEqual(emptyMarks())
    for (const kind of ['goods', 'recipes', 'blueprints', 'ships'] as const) {
      expect(markedIds(state, kind)).toHaveLength(0)
    }

    expect(toggleMark(state, ctx, 'goods', 'it-ore-a').ok).toBe(true)
    expect(isMarked(state, 'goods', 'it-ore-a')).toBe(true)

    // 切换幂等性：同一目标连切两次回到未标记，且不残留重复项
    expect(toggleMark(state, ctx, 'goods', 'it-ore-a').ok).toBe(true)
    expect(isMarked(state, 'goods', 'it-ore-a')).toBe(false)
    expect(toggleMark(state, ctx, 'goods', 'it-ore-a').ok).toBe(true)
    expect(toggleMark(state, ctx, 'goods', 'it-ore-a').ok).toBe(true)
    expect(markedIds(state, 'goods')).toHaveLength(0)
  })

  it('四类标记各自独立：互不串类、可同时存在', () => {
    const { state, ctx } = world()
    expect(toggleMark(state, ctx, 'goods', 'it-ore-a').ok).toBe(true)
    expect(toggleMark(state, ctx, 'recipes', 'ore-a').ok).toBe(true) // 可精炼资源
    expect(toggleMark(state, ctx, 'blueprints', 'bp-a').ok).toBe(true)
    expect(toggleMark(state, ctx, 'ships', state.shipId).ok).toBe(true)

    expect(markedIds(state, 'goods')).toEqual(['it-ore-a'])
    expect(markedIds(state, 'recipes')).toEqual(['ore-a'])
    expect(markedIds(state, 'blueprints')).toEqual(['bp-a'])
    expect(markedIds(state, 'ships')).toEqual([state.shipId])
  })

  it('非法目标被拒绝且不写入：查不到的商品 / 不可精炼的矿物 / 不存在的蓝图 / 不在舰队的船', () => {
    const { state, ctx } = world()
    // min-a 是矿物（无精炼配方）、不是残骸 → 不能作为精炼卡标记
    const bad: Array<['goods' | 'recipes' | 'blueprints' | 'ships', string]> = [
      ['goods', 'it-不存在'],
      ['recipes', 'min-a'],
      ['recipes', '不存在'],
      ['blueprints', 'bp-不存在'],
      ['ships', '不存在的船'],
    ]
    for (const [kind, id] of bad) {
      expect(markTargetExists(state, ctx, kind, id)).toBe(false)
      const r = toggleMark(state, ctx, kind, id)
      expect(r.ok).toBe(false)
      expect(r.error).toBeTruthy()
    }
    expect(state.marks).toEqual(emptyMarks())
  })

  it('可标记目标判定：市场商品 / 可精炼资源 / 可回收残骸 / 装备与舰船蓝图 / 舰队船实例', () => {
    const { state, ctx } = world()
    expect(markTargetExists(state, ctx, 'goods', 'it-ore-a')).toBe(true)
    expect(markTargetExists(state, ctx, 'recipes', 'ore-a')).toBe(true) // 有精炼配方
    expect(markTargetExists(state, ctx, 'blueprints', 'bp-a')).toBe(true) // 装备蓝图
    expect(markTargetExists(state, ctx, 'blueprints', 'sbp-a')).toBe(true) // 舰船蓝图
    expect(markTargetExists(state, ctx, 'ships', state.shipId)).toBe(true)
  })
})

describe('玩家标记 · 存档', () => {
  it('往返保留：四类标记原样写回、读回一致', () => {
    const { state, ctx } = world()
    toggleMark(state, ctx, 'goods', 'it-ore-a')
    toggleMark(state, ctx, 'recipes', 'ore-a')
    toggleMark(state, ctx, 'blueprints', 'bp-a')
    toggleMark(state, ctx, 'ships', state.shipId)

    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.marks).toEqual({
      goods: ['it-ore-a'],
      recipes: ['ore-a'],
      blueprints: ['bp-a'],
      ships: [state.shipId],
    })
  })

  it('老档（无 marks 字段）：读入 = 四类全空，其余字段不受影响', () => {
    const { state } = world()
    const file = JSON.parse(serializeSaveFile(state, 0)) as { state: Record<string, unknown> }
    delete file.state.marks
    // 老档里连字段都没有：应补空表而不是报错
    const loaded = loadSaveFile(JSON.stringify(file))
    expect(loaded.state.marks).toEqual(emptyMarks())
    expect(loaded.state.shipId).toBe(state.shipId)
  })

  it('剪枝：不在舰队的船标记清除；重复项与坏值（非字符串/空串）被丢弃', () => {
    const { state, ctx } = world()
    toggleMark(state, ctx, 'ships', state.shipId)
    state.marks.ships.push('早卖掉#1') // 舰队里已没有的实例
    state.marks.ships.push('早卖掉#1') // 重复
    state.marks.ships.push('') // 坏值
    state.marks.goods.push('it-ore-a', 'it-ore-a') // 重复项
    state.marks.blueprints.push('', 'bp-a') // 坏值 + 正常项

    pruneMarks(state)
    expect(state.marks.ships).toEqual([state.shipId])
    expect(state.marks.goods).toEqual(['it-ore-a'])
    expect(state.marks.blueprints).toEqual(['bp-a'])

    // 读档路径同样剪枝（normalizeState 内部调用 pruneMarks）
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.marks).toEqual(state.marks)
  })

  it('卖船/丢船后：该船的标记随读档自动失效，其余标记保留', () => {
    const { state, ctx } = world()
    // 经典开局舰队 = 沙猫（当前驾驶）+ 鲣鱼：两艘都打上标记
    const other = Object.keys(state.fleet).find((uid) => uid !== state.shipId)!
    toggleMark(state, ctx, 'ships', state.shipId)
    toggleMark(state, ctx, 'ships', other)
    expect(state.marks.ships).toHaveLength(2)

    delete state.fleet[other] // 模拟卖船：标记仍在档里，读档时被剪掉
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.marks.ships).toEqual([state.shipId])
  })
})
