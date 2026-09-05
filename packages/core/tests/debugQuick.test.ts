/**
 * V15 调试模式测试：debugQuick=1 时 训练/采矿/制造/远征航行/扫描 按 1 秒完成、
 * 交火即时按胜率预览判定并走正常结算；普通模式（false）行为不受影响。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame, enqueueSkill } from '../src/engine'
import { startMining, miningStatus } from '../src/mining'
import { startManufacturing } from '../src/manufacturing'
import { startExpedition } from '../src/expedition'
import { startScan, isExplored } from '../src/explore'
import { makeTestCtx, skill, belt, anomaly } from './helpers'
import { loadSaveFile, serializeSaveFile } from '../src/save'

function freshState(quick = true): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 42 })
  s.debugQuick = quick
  s.wallet.isk = 5_000_000
  return s
}

describe('V15 debugQuick：作业 1 秒化', () => {
  let ctx: SimContext

  beforeEach(() => {
    ctx = makeTestCtx({ skills: [skill('nav-1')] })
  })

  it('训练：普通需 60s+ 的一级在 1s 内完成；debugQuick=false 时回到原时长', () => {
    const s = freshState(true)
    expect(enqueueSkill(s, 'nav-1', 1, ctx.skills).ok).toBe(true)
    advanceGame(s, 999, ctx)
    expect(s.skills.trained['nav-1'] ?? 0).toBe(0)
    advanceGame(s, 1, ctx)
    expect(s.skills.trained['nav-1']).toBe(1)
    // 普通模式：rank1 一级 = 60s，1s 内不应完成
    const n = freshState(false)
    enqueueSkill(n, 'nav-1', 1, ctx.skills)
    advanceGame(n, 1000, ctx)
    expect(n.skills.trained['nav-1'] ?? 0).toBe(0)
  })

  it('采矿：循环 1 秒、行程腿 1 秒（快速产出）', () => {
    const s = freshState(true)
    expect(startMining(s, 'belt-a', ctx).ok).toBe(true)
    advanceGame(s, 1000, ctx) // T4 显式行程 1 秒：先到带
    expect(miningStatus(s, ctx).phase).toBe('mining')
    advanceGame(s, 1000, ctx) // 一个循环 12s → 1s
    expect(miningStatus(s, ctx).tripUnits).toBeGreaterThan(0)
  })

  it('制造：批次 1 秒完成', () => {
    const s = freshState(true)
    s.learnedRecipes.push('bp-a')
    s.warehouse.items['min-a'] = 50
    expect(startManufacturing(s, 'bp-a', ctx).ok).toBe(true)
    advanceGame(s, 999, ctx)
    expect(s.manufacturingRuns).toHaveLength(1)
    advanceGame(s, 1, ctx)
    expect(s.manufacturingRuns).toHaveLength(0)
  })

  it('远征：去程/返航 1 秒；交火保留真实战斗（调试不跳过战斗，供验证）', () => {
    const s = freshState(true)
    s.standings['dsi'] = 5
    s.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(s, 'ano-hard', ctx).ok).toBe(true)
    // 去程 2 分钟 → debug 1 秒
    advanceGame(s, 1000, ctx)
    expect(s.expedition.phase).toBe('battle')
    expect(s.expedition.battle).not.toBeNull()
    // 战斗按实时引擎推进（不被 debugQuick 即时跳过）；循环小步推进至战斗上限后必然结算
    for (let i = 0; i < 40 && s.expedition.active; i++) {
      advanceGame(s, 20_000, ctx)
    }
    expect(s.expedition.active).toBe(false)
    expect(s.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('扫描：1 秒完成点亮', () => {
    const s = freshState(true)
    expect(startScan(s, 'galaxy-far', ctx).ok).toBe(true)
    expect(s.scanning.active).toBe(true)
    advanceGame(s, 1000, ctx)
    expect(s.scanning.active).toBe(false)
    expect(isExplored(s, 'galaxy-far')).toBe(true)
  })

  it('debugQuick=false 时以上路径不变（抽样：制造仍按原时长）', () => {
    const s = freshState(false)
    s.learnedRecipes.push('bp-a')
    s.warehouse.items['min-a'] = 50
    expect(startManufacturing(s, 'bp-a', ctx).ok).toBe(true)
    advanceGame(s, 1_000, ctx)
    expect(s.manufacturingRuns).toHaveLength(1) // bp-a 10 分钟
  })
})

describe('V15 存档：debugQuick 字段', () => {
  it('初始为 false；开关后往返保存保留', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.debugQuick).toBe(false)
    s.debugQuick = true
    const loaded = loadSaveFile(serializeSaveFile(s, 1000))
    expect(loaded.state.debugQuick).toBe(true)
    expect(loaded.state.version).toBe(21)
  })

  it('v14 档迁移：补 debugQuick=false 且其余无损', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    s.wallet.isk = 77
    const raw = s as unknown as Record<string, unknown>
    delete raw.debugQuick
    raw.version = 14
    const loaded = loadSaveFile(serializeSaveFile(s, 1000))
    expect(loaded.state.version).toBe(21)
    expect(loaded.state.debugQuick).toBe(false)
    expect(loaded.state.wallet.isk).toBe(77)
  })
})
