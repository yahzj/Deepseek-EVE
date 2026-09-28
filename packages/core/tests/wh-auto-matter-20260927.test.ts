/**
 * **自动探索的谜质线**（**2026-09-27 玩家报障修复**）。
 *
 * 报障原话（船长转述）：「**而且自动探索不给谜质**」——与同批的"全是势力的安全货柜"是同一次报障的两条。
 *
 * 根因：`wormholeAutoSim` 的"值得去的格"白名单只有 `vein / graveyard / ruins / ship`，
 * **`matter`（谜质格）根本不在内** ⇒ 模拟器整趟都不去谜质格 ⇒ 谜质恒为 0。
 *
 * 船长两问均取推荐项：
 * ① **谜质线怎么补 = 甲「与手动同口径」**：手动每格取回 1 台谜质储存器、撤离成功折 1 枚虫洞谜质；
 *    自动线没有 `run`/本趟货仓 ⇒ 直接按"撤离成功"折算成虫洞谜质入仓库（1 台 = 1 枚）；
 * ② **去不去抢 = E「与遗迹同档」**：谜质与遗迹同为 rank 2、按远近竞争。
 *    只挂 rank 0（与矿脉同档）实测 200 趟只有 48 趟拿得到（玩家仍会报"不给"）；
 *    给 rank 3（最优先）实测稀有残骸 −45%、货柜 −四成，代价过重。
 *
 * 本文件钉四件事：
 * ① 谜质线**确实存在**（真实结算路径：200 趟里绝大多数趟拿得到）；
 * ② 量级在**合理带内**（既不是 0，也不是白送）；
 * ③ 谜质进的是**仓库**、且 id 与「谜质科技」的研究货币**同一个**；
 * ④ **回归护栏**（源码级）：白名单含 `matter`、且 rank 与遗迹并列（防后人改回 rank 0 或提到 rank 3）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeStockPush } from '../src/wormholeScan'
import { WORMHOLE_ESSENCE_ITEM_ID } from '../src/wormholeSalvage'
import {
  advanceWormholeAuto,
  wormholeAutoReportsOf,
  wormholeAutoStart,
  WORMHOLE_AUTO_DURATION_MS,
} from '../src/wormholeAuto'

const ctx = buildSimContext()
/** 与 `wormhole-core-drop.test.ts` 同款夹具（4× 三级巡洋舰 · AI 专家 6 级） */
const T3 = 'sh-thresher'
const SEEDS = 200

/** 跑一趟自动探索，返回报告 + 结算后的档（夹具与 `wormhole-core-drop.test.ts` 一致） */
function runOnce(seed: number) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uids = [0, 1, 2, 3].map(() => addShipToFleet(state, T3))
  state.skills.trained['ai-expert'] = 6
  state.wormholeStock = []
  if (!wormholeStockPush(state, ctx)) throw new Error('上架失败')
  const stockId = state.wormholeStock![0]!.id
  const started = wormholeAutoStart(state, ctx, stockId, uids)
  if (!started.ok) throw new Error(`派队失败：${started.error}`)
  state.gameMs += WORMHOLE_AUTO_DURATION_MS + 1
  advanceWormholeAuto(state, ctx)
  const report = wormholeAutoReportsOf(state)[0]
  if (!report) throw new Error('没出报告')
  return { state, report }
}

/** 一次性把 200 趟跑完（用例之间共用，省得各跑一遍） */
const batch = (() => {
  const out: Array<ReturnType<typeof runOnce>> = []
  for (let seed = 1; seed <= SEEDS; seed++) out.push(runOnce(seed))
  return out
})()

describe('自动探索的谜质线（2026-09-27 玩家报障修复 · 船长甲 + E）', () => {
  it('① 谜质线确实存在：绝大多数趟都拿得到虫洞谜质', () => {
    const withEssence = batch.filter((b) => b.report.gains.some((g) => g.itemId === WORMHOLE_ESSENCE_ITEM_ID))
    expect(withEssence.length, `出谜质的趟数（实测 194/${SEEDS}）`).toBeGreaterThanOrEqual(150)
  })

  it('② 量级在合理带内：既不是 0，也不是白送一堆', () => {
    const total = batch.reduce(
      (n, b) => n + b.report.gains.filter((g) => g.itemId === WORMHOLE_ESSENCE_ITEM_ID).reduce((m, g) => m + g.units, 0),
      0,
    )
    const avg = total / SEEDS
    /** 实测 1.91 枚/趟；带子给宽（1.0~3.5）只为兜"整条线又没了"或"数量级写错" */
    expect(avg, '平均枚数/趟').toBeGreaterThanOrEqual(1.0)
    expect(avg, '平均枚数/趟').toBeLessThanOrEqual(3.5)
  })

  it('③ 进的是仓库，且 id 与「谜质科技」的研究货币是同一个', () => {
    const b = batch.find((x) => x.report.gains.some((g) => g.itemId === WORMHOLE_ESSENCE_ITEM_ID))!
    const inReport = b.report.gains.find((g) => g.itemId === WORMHOLE_ESSENCE_ITEM_ID)!.units
    expect(b.state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] ?? 0, '仓库里的虫洞谜质').toBeGreaterThanOrEqual(inReport)
    /** 研究货币就是它 ⇒ 自动探索的谜质能直接投进「谜质科技」 */
    expect(WORMHOLE_ESSENCE_ITEM_ID).toBe('mat-wh-essence')
  })

  it('④ 回归护栏：模拟器白名单含谜质格，且 rank 与遗迹并列（防改回 rank 0 / 提到最优先）', () => {
    // ⚠ vitest 的工作目录通常是包目录（`packages/core`）⇒ 两种根都试一下
    const rootA = join(process.cwd(), 'src/wormholeAutoSim.ts')
    const rootB = join(process.cwd(), 'packages/core/src/wormholeAutoSim.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : rootB, 'utf8')
    /** 白名单那一行必须含 `'matter'`（改回旧白名单 ⇒ 整条谜质线又归零） */
    expect(src.includes("place === 'matter'"), "白名单里应有 place === 'matter'").toBe(true)
    /** rank 那一行必须把 matter 与 ruins **并列**（rank 0 = 玩家仍会报"不给谜质"；rank 3 = 稀有/货柜被挤没） */
    expect(
      src.includes("w.place === 'ruins' || w.place === 'matter' ? 2"),
      '谜质应与遗迹同档（rank 2）',
    ).toBe(true)
  })
})
