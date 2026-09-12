/**
 * 页面公共：Toast 回调类型与通用展示小件。
 */
import { marketQuote } from '@whale/core'
import type { GameEngine } from '../game/engine'

/** 全局浮动提示回调（App 提供） */
export type ToastFn = (text: string, warn?: boolean) => void

/** 页面组件统一签名 */
export interface PageProps {
  engine: GameEngine
  onToast: ToastFn
}

/** 千分位 ISK 显示 */
export function isk(n: number): string {
  return n.toLocaleString('zh-CN')
}

/**
 * 货币图形前缀（估价/ISK 金额行用），2026-09-05 船长指示标注：
 * 目前暂用 emoji ◆ 作为"估价"前缀；**将来统一金钱符号图形时，只需同步替换本常量**，
 * 各调用处（如 MapPage 矿带卡"估价"行）经本常量引用即自动跟随，无需逐个改。
 */
export const MONEY_GLYPH = '◆'

/** m³ 显示 */
export function m3(n: number): string {
  return `${Math.floor(n).toLocaleString('zh-CN')} m³`
}

/** 货仓/仓库里按物品表汇总体积（供没有 SimContext 处调用——页面用 engine.ctx） */
export function sumVolume(
  engine: GameEngine,
  items: Record<string, number>,
): number {
  let total = 0
  for (const [id, units] of Object.entries(items)) {
    total += units * (engine.ctx.items.get(id)?.unitM3 ?? 0)
  }
  return total
}

/** 船状态卡里的货仓占用（m³） */
export function cargoVolumeOf(engine: GameEngine, cargo: Record<string, number>): number {
  return sumVolume(engine, cargo)
}

/** 某物品当前市场收购价（NPC 收玩家价）；不在市场目录/簿为空时返回 undefined */
export function itemBuyQuote(engine: GameEngine, itemId: string): number | undefined {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'item' && good.refId === itemId) {
      return marketQuote(engine.state, engine.ctx, good.key).buy
    }
  }
  return undefined
}

/**
 * **星系稀有残骸战果**（窝点战果；2026-09-11 船长：「稀有残骸能否在星图的星系详细里看到？」）。
 * 与 `state.galaxyWrecks[星系].rareBy`（按敌群记账）**同源**，供两处共用一份口径：
 * 星图「星系行动」弹窗（Expedition）与「残骸打捞」星系卡（MapPage）——
 * 抽成一处避免两边漂移。`text` = `窝点名 ×n、…`（无战果 = 空串）。
 */
export function rareWreckRefsOf(
  engine: GameEngine,
  galaxyId: string,
): { count: number; text: string; refs: Array<[string, number]> } {
  const by = engine.state.galaxyWrecks[galaxyId]?.rareBy ?? {}
  const refs = Object.entries(by).filter(([, n]) => n > 0)
  const count = refs.reduce((s, [, n]) => s + n, 0)
  const text = refs.map(([aid, n]) => `${engine.ctx.anomalies.get(aid)?.name ?? aid} ×${n}`).join('、')
  return { count, text, refs }
}
