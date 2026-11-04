/**
 * 自动交易折叠区（定投 / 网格 / 移动止盈）。
 *
 * 包装并导出核心量化机器人面板 `BotPanel`，保持既有引用路径与向后兼容。
 */
export { BotPanel as AutoTrade } from './bot/BotPanel'
export { BotPanel } from './bot/BotPanel'
export type { BotPanelProps, BotTemplate } from './bot/BotPanel'
