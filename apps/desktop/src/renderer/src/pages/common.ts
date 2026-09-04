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
