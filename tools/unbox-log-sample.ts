/**
 * **拆解日志样张**（正式工具 · **2026-09-24 入库**；船长令：「拆解货柜的事件日志内，要显示获得的物品数量」）。
 * 逐种货柜各拆一箱，原样打印那条事件日志（含数量与来源后缀），交船长核对文案。
 *
 * 回归守卫在 `packages/core/tests/wormhole-unbox.test.ts`（日志里 `×N` 之和必须等于实得件数）。
 *
 * 用法：`npm run unbox:log-sample`（或 `npx tsx tools/unbox-log-sample.ts`）· **只读**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { buildSimContext } from '@whale/data'
import { createInitialState } from '@whale/core'
import { addWare } from '../packages/core/src/inventory'
import { UNBOX_CYCLE_MS, advanceRefining, startUnboxRun } from '../packages/core/src/industry'

const ctx = buildSimContext()
const BOXES = ['box-relic-a', 'box-bp-shallow', 'box-valuables', 'box-military']

for (const boxId of BOXES) {
  if (!ctx.items.has(boxId)) {
    console.log(`${boxId.padEnd(16)} （内容目录里没有这只箱子，跳过）`)
    continue
  }
  const state = createInitialState({ nowWallMs: 0, seed: 8 })
  addWare(state, boxId, 1)
  const r = startUnboxRun(state, ctx, boxId, 'pilot')
  if (!r.ok) {
    console.log(`${boxId.padEnd(16)} 开工失败：${r.error}`)
    continue
  }
  state.gameMs += UNBOX_CYCLE_MS
  advanceRefining(state, ctx)
  const line = [...state.logs].reverse().find((l) => l.text.includes('📦 拆解'))
  console.log(`${boxId.padEnd(16)} ${line ? line.text : '（没出日志）'}`)
}
