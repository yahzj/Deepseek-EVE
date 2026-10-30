import { naturalHoldings, salesTaxRate, shipStoredCount } from '@whale/core'
import type { GameState, MarketGoodDef } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { isk } from '../../pages/common'
import { tr } from '../../i18n/locale'

/** mm:ss（向上取整到秒） */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 距离下一个市场窗口（订单补给/刷新）还剩多少毫秒 */
export function nextSupplyIn(engine: PageProps['engine']): number {
  const bal = engine.ctx.balance.market
  const since = engine.state.gameMs - engine.state.market.lastTickGameMs
  const rem = bal.tickMs - (since % bal.tickMs)
  return rem >= 0 ? rem : bal.tickMs
}

/** 某商品现存供应单中最早到期的那笔剩余毫秒；无供应单返回 undefined */
export function earliestSellRemaining(engine: PageProps['engine'], goodKey: string): number | undefined {
  const orders = engine.state.market.npcSell[goodKey]
  if (!orders || orders.length === 0) return undefined
  let earliest: number | undefined
  for (const o of orders) {
    if (earliest === undefined || o.expiresAtGameMs < earliest) earliest = o.expiresAtGameMs
  }
  if (earliest === undefined) return undefined
  return Math.max(0, earliest - engine.state.gameMs)
}

/** 玩家自己这件东西的库存（舰船 = 舰船仓库 ＋ 在役舰队；其余走 core「自然库存」单点） */
export function myStockOf(state: GameState, good: MarketGoodDef): number {
  if (good.kind === 'ship') {
    let n = shipStoredCount(state, good.refId)
    for (const [uid, e] of Object.entries(state.fleet)) {
      if ((e.defId ?? uid) === good.refId) n += 1
    }
    return n
  }
  return naturalHoldings(state, good)
}

/** 舰队（机库）里同型艘数——舰船可卖量的提示用（可卖只看舰船仓库） */
export function fleetCountOf(state: GameState, defId: string): number {
  return Object.entries(state.fleet).filter(([uid, e]) => (e.defId ?? uid) === defId).length
}

/* ═══════════════ 市场栏（标题 + 有货冒泡列表；搜索/类型过滤已提升到页面级跨栏） ═══════════════ */

/** 挂单回执文案（2026-09-10 船长定：挂单瞬间先与现有簿面对冲 → 回执写明即时成交部分）
 *  `unit`：量词（舰船「艘」/ 其余「件」；2026-09-14 舰船挂卖单放行后加） */
export function placeOrderToast(
  side: '买' | '卖', // l10n-keep：side 是字面量联合 key（显示时按 id 取译名）
  name: string,
  want: number,
  price: number,
  filled: number,
  resting: number,
  unit = '件',
): string {
  const n = (v: number): string => v.toLocaleString('zh-CN')
  // side 是字面量联合 key（不是文案）⇒ 显示时才按 id 取译名（l10n-keep 的同款口径）
  const sideText = side === '买' ? tr('ui.MarketPage.159') : tr('ui.MarketPage.160')
  if (filled <= 0) return tr("ui.MarketPage.139", { side: sideText, name: name, p3: n(want), p4: isk(price) })
  if (resting <= 0) return tr("ui.MarketPage.140", { side: sideText, name: name, p3: n(filled), p4: isk(price) })
  return tr("ui.MarketPage.141", { side: sideText, p2: n(filled), unit: unit, p4: n(resting), unit2: unit, p6: isk(price) })
}

/**
 * 贸易税说明（2026-09-13 船长：各页常驻说明统一收进标题后的圆形感叹号）。
 * 税率随「会计学 / 贸易谈判学」等级变化 ⇒ 每次渲染现算；市场详情与未选中时的占位面板共用这一份文案。
 */
export function taxTipText(state: GameState, ctx: PageProps['engine']['ctx']): string {
  const rate = salesTaxRate(state, ctx)
  const lvA = state.skills.trained[ctx.balance.market.taxSkillAId] ?? 0
  const lvB = state.skills.trained[ctx.balance.market.taxSkillBId] ?? 0
  const skillNote =
    lvA + lvB > 0
      ? tr("ui.MarketPage.142", { lvA: lvA, p2: lvA * 8, lvB: lvB, p4: lvB * 8 })
      : tr("ui.MarketPage.033")
  return tr("ui.MarketPage.143", { p1: Math.round(rate * 1000) / 10, skillNote: skillNote })
}
