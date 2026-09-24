/**
 * **一次性图纸"被吞"链路复刻**（正式工具 · **2026-09-24 入库**）。
 *
 * 玩家原话（船长转述）：「刚刚在造的锤头鲨级一次性蓝图，还差 2 小时完成，离线后过了一段时间上线发现
 * 船不见了，蓝图显示已消耗」。玩家存档实证：`spentOneTimeRecipes` 里躺着长尾鲨/锤头鲨/牛鲨三张一次性
 * 舰船图、`shipStore` 里一艘都没有、`manufacturingRuns` 空、`autoLoopAnomalyId` 开着。
 *
 * 本工具用**真内容目录**把那条链重放一遍（一次性锤头鲨 → 开重复清剿 → 存档读档 → 离线跨过完工时刻）：
 *  · 修复前：清剿到点 → `startExpedition` → 活动闸门掐掉造船线 → 书没了、船也没了；
 *  · 修复后：等待表把「亲自开线」算进"占着主控"⇒ 清剿**等**，造船线跑完 ⇒ 船进舰船仓库。
 * 回归守卫在 `packages/core/tests/one-time-blueprint.test.ts`（6 例）；本工具负责"整条链一眼看完"。
 *
 * 用法：`npm run once:repro`（或 `npx tsx tools/once-blueprint-repro.ts`）· **只读**（不碰真档）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { buildSimContext } from '@whale/data'
import {
  autoLoopWaitLabel,
  createInitialState,
  loadSaveFile,
  manufacturingRunViews,
  serializeSaveFile,
  simulateOffline,
  startManufacturing,
} from '@whale/core'

const ctx = buildSimContext()
const BP = 'sbp-once-hammerhead'
const SHIP = 'sh-hammerhead'

/** 造一份"玩家档"：给图、给料、按玩家存档里那个清剿目标开环 */
function playerLike(): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const bp = ctx.shipBlueprints.get(BP)!
  for (const m of bp.materials) state.warehouse.items[m.itemId] = m.count + 1_000
  state.blueprintStock[BP] = 1
  state.autoLoopAnomalyId = 'ano-chasm-aberrations' // 玩家存档里开着的那个目标
  return state
}

const s1 = playerLike()
const started = startManufacturing(s1, BP, 'pilot', ctx)
console.log('① 开工：', started.ok ? 'ok' : started.error)
console.log('   书架上还剩：', s1.blueprintStock[BP] ?? 0, '· 名额标记：', JSON.stringify(s1.spentOneTimeRecipes))
console.log('   跑线视图：', JSON.stringify(manufacturingRunViews(s1, ctx).map((v) => ({ bp: v.blueprintId, worker: v.worker, 剩余ms: v.remainingMs }))))
console.log('② 清剿等待表（修好后应认得这条线）：', autoLoopWaitLabel(s1))

// 真实通道：存档 → 读档 → 离线 6 小时（跨过 4.82 小时的工期）
const back = loadSaveFile(serializeSaveFile(s1, 0)).state
console.log('③ 读档后跑线：', back.manufacturingRuns.length, '条 · bookSpent =', back.manufacturingRuns[0]?.bookSpent)
simulateOffline(back, 0, 6 * 3_600_000, ctx)
console.log('④ 离线 6 小时后：')
console.log('   舰船仓库：', JSON.stringify(back.shipStore))
console.log('   跑线表：', back.manufacturingRuns.length, '条')
console.log('   书架上：', back.blueprintStock[BP] ?? 0, '· 名额标记：', JSON.stringify(back.spentOneTimeRecipes))
console.log('   结论：', back.shipStore?.[SHIP] === 1 ? `✅ 船到手（${SHIP} ×1），书按"已兑现"不退` : '❌ 船仍不见')
