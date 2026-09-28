/**
 * **自动探索的货柜种类**（**2026-09-27 玩家报障修复**）。
 *
 * 报障原话（船长转述）：「虫洞自动探索有些不对，**玩家带出的全是势力的安全货柜，没有其他货柜**」。
 *
 * 根因：`wormholeAuto` 发货处**写死**了 `wormholeRelicBoxIdOf(family)`（只有本族安全货柜），
 * 而手动路径早已演进出"全货柜池"（贵重品柜 ＋ 本族安全柜 ＋ 图纸货柜档 ＋ 军用备货柜）⇒
 * 自动探索永远只出安全货柜。船长选**甲**：自动探索改走**与手动同一条池**。
 *
 * 落法：把"命中之后是哪一种货柜"抽成**单点** `wormholeSalvage.wormholeRollRelicBoxKind`
 * （手动逐格与自动探索共用）；手动路径改为调用它（**等价重构**，随机数消耗顺序逐字保持）。
 *
 * 本文件钉三件事：
 * ① 单点在**层 2** 能抽出全部 4 类（含**图纸货柜**——这正是报障里缺的那类）；
 * ② 图纸货柜**按层档**解锁（浅档层 2 起 · 中档层 5 起 · 深档层 7 起）；
 * ③ **回归护栏**：自动探索发货处不再出现"写死本族安全货柜"那种写法（源码级断言）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { wormholeRollRelicBoxKind } from '../src/wormholeSalvage'

const ctx = buildSimContext()

/** 确定性伪随机（本文件只做分布抽样，不依赖引擎流） */
function mk(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 抽 `n` 次，返回 id → 占比 */
function tally(depth: number, family: string, n = 20000): Record<string, number> {
  const rng = mk(987654 + depth * 31 + family.charCodeAt(0))
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const id = wormholeRollRelicBoxKind(rng, ctx, depth, family)
    if (id !== undefined) out[id] = (out[id] ?? 0) + 1 / n
  }
  return out
}

describe('自动探索的货柜种类（2026-09-27 玩家报障修复 · 船长选甲）', () => {
  it('① 层 2：四类都能抽出，**图纸货柜在列**（报障里缺的就是它）', () => {
    const t = tally(2, 'A')
    const ids = Object.keys(t)
    expect(ids, '贵重品货柜').toContain('box-valuables')
    expect(ids, '本族安全货柜').toContain('box-relic-a')
    expect(ids, '军用备货柜').toContain('box-military')
    expect(ids, '**浅档图纸货柜**（本次报障的核心）').toContain('box-bp-shallow')
    // 贵重品柜约占一半，其余平分（口径见 wormholeRelicBoxPoolOf 的注释）
    expect(t['box-valuables']!).toBeGreaterThan(0.45)
    expect(t['box-valuables']!).toBeLessThan(0.55)
    expect(ids.length).toBe(4)
  })

  it('② 图纸货柜按层档解锁：浅档层 2 起 · 中档层 5 起 · 深档层 7 起', () => {
    expect(Object.keys(tally(2, 'A'))).toContain('box-bp-shallow')
    expect(Object.keys(tally(4, 'A')), '层 4 还不到中档').not.toContain('box-bp-mid')
    expect(Object.keys(tally(5, 'A')), '层 5 起出中档').toContain('box-bp-mid')
    expect(Object.keys(tally(6, 'A')), '层 6 还不到深档').not.toContain('box-bp-deep')
    expect(Object.keys(tally(7, 'A')), '层 7 起出深档').toContain('box-bp-deep')
  })

  it('③ 回归护栏：自动探索发货处不再"写死本族安全货柜"，而是走种类单点', () => {
    // ⚠ vitest 的工作目录通常是包目录（`packages/core`）⇒ 两种根都试一下
    const rootA = join(process.cwd(), 'src/wormholeAuto.ts')
    const rootB = join(process.cwd(), 'packages/core/src/wormholeAuto.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : rootB, 'utf8')
    /** 旧写法：`gains.push({ itemId: wormholeRelicBoxIdOf(family), units: 1 })` */
    expect(src.includes('itemId: wormholeRelicBoxIdOf(family)'), '旧写死写法不应再出现').toBe(false)
    expect(src.includes('wormholeRollRelicBoxKind('), '应当调用种类抽取单点').toBe(true)
  })
})
