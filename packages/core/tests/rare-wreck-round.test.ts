/**
 * **稀有残骸轮不吃普通池放干** —— 2026-09-25 玩家报障的复现与回归锁。
 *
 * 船长转述（原话）：「**玩家反应，当星系的残骸里有稀有残骸时，打捞稀有残骸会同时消耗普通残骸，
 * 但是没有回收普通残骸**」。
 *
 * 原实现（`salvaging.pullOneWreck` 稀有分支）照样调了 `salvage.salvageRoundPull`：
 * 它按"本轮按 mul 出普通残骸"的口径扣了 2% 放干（先入侵池、再星系池），可稀有轮的产出是
 * **固定 30 m³ 的稀有残骸**（不吃 mul）⇒ **扣了不给**，普通池白掉一截。现按**甲案**修：
 * 稀有轮走只读的 `salvageRoundMulOf`，**两池一个都不扣**；稀有池捞干、轮到普通池后放干照旧。
 *
 * 本用例断言的四个点：
 * 1. 稀有轮：拿到的确实是稀有残骸（按卡归族，见 `rareWreckItemIdOfCard`），数量 −1、体积 30 m³；
 * 2. 稀有轮：**星系密度与入侵池一字不动**（甲案的核心）；
 * 3. 只读取数仍准确：`salvageRoundMulOf` = max(0.5, (密度 ＋ 入侵残骸)/10)；
 * 4. 对照组（稀有池捞干后的那一轮起）：走普通池，**照扣**放干 —— 保证修复没把放干整体关掉。
 *
 * ⚠ 术语（**2026-09-26 船长裁定原话**：「**优先捞稀有池，稀有池捞完后开始普通池。同池内，
 * 入侵残骸优先。**」）：本文件里的"两池"= **稀有池**与**普通池**（旧注释写"常规池"，同指普通池）；
 * 三级序全文见 `salvaging.pullOneWreck` 头注。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import {
  injectRareWreck,
  injectWeekendWreck,
  injectWreckDensity,
  rareWreckCountOf,
  RARE_WRECK_VOLUME_M3,
  rareWreckItemIdOf,
  salvageRoundMulOf,
  WRECK_FLOOR,
  WRECK_DRAIN_SHARE,
  weekendWreckDensityOf,
  wreckItemIdOf,
} from '../src/salvage'
import { pullOneWreck } from '../src/salvaging'
import { anomaly, makeTestCtx } from './helpers'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'

/** 测试窝点卡：`lairCore` 非空 ⇒ 进稀有残骸注册集合（与 data 层同判据） */
const LAIR = 'ano-lair-rare'
const GAL = 'galaxy-hub'
/** 修复前的那一轮会扣多少（用于把"白掉的量"写成可读数字） */
const DENSITY0 = 190

const ctx: SimContext = makeTestCtx({
  anomalies: [anomaly(LAIR, GAL, { threat: 30, lairCore: '测试海盗', foeFamily: 'A' })],
})

function world(opts?: { weekend?: number }): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  injectRareWreck(state, GAL, LAIR, 2)
  injectWreckDensity(state, ctx, GAL, DENSITY0)
  if (opts?.weekend !== undefined) injectWeekendWreck(state, GAL, opts.weekend)
  return state
}

describe('稀有残骸轮 vs 普通残骸池（放干口径）', () => {
  it('稀有轮：给稀有残骸，但不扣星系密度、也不扣入侵池', () => {
    const state = world({ weekend: 50 })
    const densBefore = state.galaxyWrecks[GAL]!.density
    const invBefore = weekendWreckDensityOf(state, GAL)
    expect(densBefore).toBe(DENSITY0)
    // 只读取数与 salvageRoundPull 同一算式
    expect(salvageRoundMulOf(state, ctx, GAL)).toBeCloseTo((DENSITY0 + 50) / 10, 10)

    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId, '稀有轮应产出稀有残骸').toBe(rareWreckItemIdOf(LAIR))
    expect(pulled.volumeM3).toBe(RARE_WRECK_VOLUME_M3)
    expect(rareWreckCountOf(state, GAL)).toBe(1)

    // ⚠ 甲案核心：两池一个都不动
    expect(state.galaxyWrecks[GAL]!.density, '稀有轮把普通池扣了（= 玩家报障）').toBe(densBefore)
    expect(weekendWreckDensityOf(state, GAL), '稀有轮把入侵池扣了').toBe(invBefore)

    const wouldHaveDrained = (densBefore - WRECK_FLOOR) * WRECK_DRAIN_SHARE + invBefore * WRECK_DRAIN_SHARE
    console.log(
      `  [读数] 稀有轮：星系池 ${densBefore} → ${state.galaxyWrecks[GAL]!.density}（旧实现会掉 ${wouldHaveDrained.toFixed(2)}）· ` +
        `入侵池 ${invBefore} → ${weekendWreckDensityOf(state, GAL)} · 产出 ${pulled.itemId} ${pulled.volumeM3} m³`,
    )
  })

  it('对照：稀有捞完后的常规轮，放干照旧（修复没关掉放干本身）', () => {
    const state = world()
    // 先把 2 件稀有捞完（每轮一件；这两轮都不动密度）
    for (let i = 0; i < 2; i += 1) expect(pullOneWreck(state, ctx, GAL, 60_000)!.itemId).toBe(rareWreckItemIdOf(LAIR))
    expect(rareWreckCountOf(state, GAL)).toBe(0)
    const densBefore = state.galaxyWrecks[GAL]!.density
    expect(densBefore, '稀有轮不该动密度').toBe(DENSITY0)

    const normal = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(normal.itemId, '稀尽后应回到常规残骸池').toBe(wreckItemIdOf(LAIR))
    expect(state.galaxyWrecks[GAL]!.density).toBeCloseTo(
      DENSITY0 - (DENSITY0 - WRECK_FLOOR) * WRECK_DRAIN_SHARE,
      10,
    )
    console.log(
      `  [读数] 常规轮：星系池 ${densBefore} → ${state.galaxyWrecks[GAL]!.density.toFixed(2)} · 产出 ${normal.itemId} ${normal.volumeM3.toFixed(2)} m³`,
    )
  })

  it('星系无稀有存量时，走常规分支（放干照旧）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    injectWreckDensity(state, ctx, GAL, DENSITY0)
    // ⚠ 无记录时 `injectWreckDensity` 是在**基础密度**上叠加 ⇒ 这里按"读到的值"算期望，不写死 190
    const before = state.galaxyWrecks[GAL]!.density
    const pulled = pullOneWreck(state, ctx, GAL, 60_000)!
    expect(pulled.itemId).toBe(wreckItemIdOf(LAIR))
    expect(state.galaxyWrecks[GAL]!.density).toBeCloseTo(before - (before - WRECK_FLOOR) * WRECK_DRAIN_SHARE, 10)
  })
})
