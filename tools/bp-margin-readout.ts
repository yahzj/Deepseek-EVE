/**
 * **蓝图卡"利润率"读数**（正式工具 · **2026-09-24 入库**）——船长报障取证：
 * 「组装机零件的利润率不对，组装机是一次性生产 10 个的，现在的利润只计算一个」。
 *
 * 本工具**直接调用卡面那两个真函数**（`marginPctOf` / `marketPriceOf`），逐张蓝图打印：
 * 每批件数 · 单件行情 · 整批收入 · 材料成本 · **旧口径%（只算一件）** · **新口径%（整批）**，
 * 外加卡面那一行的**文案读数**（`名称 · 行情 P · 整批 P×N（利润率 M%）`）。
 * `units = 1` 那一列就是修复前的行为（同一函数、同一入参，只差件数）⇒ 一屏看清口径差异。
 *
 * ⚠ 读数是"每件行情 × 件数"的**口径核对**，不是观感结论；行情取 `marketPriceOf`（市场折线右端价，
 * 新档无价史时回落簿面报价）。
 *
 * 用法：`npm run bp:margin`（或 `npx tsx tools/bp-margin-readout.ts`）· **只读**。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { buildSimContext } from '@whale/data'
import { createInitialState, matNeedCount, marketQuote } from '@whale/core'
import { marginPctOf, marketPriceOf } from '../apps/desktop/src/renderer/src/ui/yieldView'

const ctx = buildSimContext()
const state = createInitialState({ nowWallMs: 0, seed: 7 })
/** 先开市（`marketQuote` 内部 `ensureMarket`）——避免整屏 null */
for (const key of ctx.marketGoods.keys()) marketQuote(state, ctx, key)

const num = (v: number): string => v.toLocaleString('zh-CN')

function row(
  bpId: string,
  kind: 'module' | 'ship' | 'item',
  refId: string,
  units: number,
  materials: ReadonlyArray<{ itemId: string; count: number }>,
): void {
  const price = marketPriceOf(state, ctx, refId)
  const matCost = materials.reduce(
    (sum, m) => sum + matNeedCount(state, m.count) * (marketPriceOf(state, ctx, m.itemId) ?? ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const name =
    kind === 'module' ? ctx.modules.get(refId)?.name : kind === 'ship' ? ctx.ships.get(refId)?.name : ctx.items.get(refId)?.name
  const oldPct = marginPctOf(price, matCost, 1)
  const newPct = marginPctOf(price, matCost, units)
  const fmt = (v: number | null): string => (v === null ? '—' : `${v}%`)
  // 卡面那一行的**文案读数**（与 `GoodsLine` 同款：名称 · 行情 P [· 整批 P×N]（利润率 M%））
  const line =
    `${name ?? refId} · 行情 ${num(price ?? 0)}` +
    (price !== null && units > 1 ? ` · 整批 ${num(price * units)}` : '') +
    (newPct !== null ? `（利润率 ${newPct}%）` : '')
  console.log(
    `${bpId.padEnd(26)} ${(name ?? refId).padEnd(14)} 每批${String(units).padStart(3)}件 ` +
      `单价${num(price ?? 0).padStart(8)} 整批收入${num((price ?? 0) * units).padStart(10)} 材料${num(matCost).padStart(9)} ` +
      `旧${fmt(oldPct).padStart(6)} → 新${fmt(newPct).padStart(6)}  ｜卡面：${line}`,
  )
}

console.log('=== 组装机蓝图卡 · 利润率读数（旧 = 只算一件；新 = 按整批）===')
console.log('—— 装备 / 物品（零件 / 消耗品）——')
for (const [bpId, bp] of ctx.blueprints) {
  if (bp.moduleId) row(bpId, 'module', bp.moduleId, 1, bp.materials)
  else if (bp.itemId) row(bpId, 'item', bp.itemId, bp.outputUnits ?? 1, bp.materials)
}
console.log('—— 舰船 ——')
for (const [bpId, bp] of ctx.shipBlueprints) {
  if (bp.shipId) row(bpId, 'ship', bp.shipId, 1, bp.materials)
}
