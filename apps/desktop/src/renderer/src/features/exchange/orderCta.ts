/**
 * 「确认下单」主按钮的插槽。
 *
 * 2026-11-06 船长令：按钮要贴在右栏「持仓与委托」这张表的右下角，而不是视口角落。
 * 按钮的状态与提交逻辑都在 TradePanel 内，所以用 context 把挂载点从 ProExchange 传下去，
 * 由 TradePanel 用 portal 渲染过去；没有插槽时（简单界面等）仍在原地渲染。
 */
import { createContext } from 'react'

export const OrderCtaSlotContext = createContext<HTMLElement | null>(null)
