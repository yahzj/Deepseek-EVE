/**
 * **快递页读数样张**（正式工具 · **2026-09-24 入库**；船长报障「快递…写的还是 20 分钟」）。
 * 用真内容目录造一份"已建成一座副站"的档，把快递页会显示的那几行**按界面同一套算法**打出来
 * （快递 = 到下一个 120 分钟整点 · h:mm:ss；资源对照 = 20 分钟 · mm:ss），供船长核对——
 * **这是读数，不是观感结论**。
 *
 * 回归守卫在 `packages/core/tests/sideTasks.test.ts`（倒计时分族 · 抽到手 25 分钟后仍可出发）。
 *
 * 用法：`npm run courier:clock`（或 `npx tsx tools/courier-clock-sample.ts`）· **只读**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { buildSimContext } from '@whale/data'
import { COURIER_BOARD_PERIOD_MS, advanceGame, createInitialState, marketQuote, sideTaskBoard } from '@whale/core'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: 0, seed: 8 })
// 建成一座副站（快递解锁）+ 开市 ⇒ 首个 20 分钟整点出首板
const site = [...ctx.stations.values()][0]
state.stationSites[site.id] = { stage: 3, delivered: {} }
marketQuote(state, ctx, 'it-ore-a')
const PERIOD = ctx.balance.market.orderLifeMs.common
advanceGame(state, PERIOD + 1_000, ctx)

/** 与界面同款：快递用 h:mm:ss（一轮两小时），资源用 mm:ss */
const hms = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const ms2 = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

const show = (label: string): void => {
  const v = sideTaskBoard(state, ctx)
  const courierMin = Math.round(COURIER_BOARD_PERIOD_MS / 60_000)
  const resMin = Math.round(PERIOD / 60_000)
  console.log(`—— ${label}（gameMs = ${state.gameMs}）——`)
  console.log(`快递页页头：距下批刷新 ${hms(v.courierRemainingMs)} · 每 ${courierMin} 分钟一轮`)
  console.log(`快递卡一行：剩余 ${hms(v.courierRemainingMs)}`)
  console.log(`（对照）资源页：距下批刷新 ${ms2(v.remainingMs)} · 每 ${resMin} 分钟一轮`)
  console.log(`快递在板 ${v.courier.length} 单 · 到下一个 120 分钟整点还剩 ${hms(v.courierRemainingMs)}`)
}

show('首板（窗界 20 分钟，快递随首板补种）')
advanceGame(state, 25 * 60_000, ctx)
show('再过 25 分钟（资源已换一轮，快递仍是同一批）')
advanceGame(state, COURIER_BOARD_PERIOD_MS - state.gameMs + 1_000, ctx)
show('跨过 120 分钟整点（快递整批换新）')
