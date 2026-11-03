/**
 * 深空证券交易所 · 选中标的单点（Spatial Memory & 路由状态同步）
 * 支持从侧边栏微卡片、全局路由或内部列表高亮选中指定标的。
 */

export const DEFAULT_EXCHANGE_CODE = 'SMHI'

let currentSelectedCode = DEFAULT_EXCHANGE_CODE
type CodeListener = (code: string) => void
const listeners = new Set<CodeListener>()

/** 获取当前记忆/选中的标的代码 */
export function getExchangeSelectedCode(): string {
  return currentSelectedCode
}

/** 设置选中的标的代码，并通知所有活跃订阅者（如 ExchangePage）高亮定位 */
export function setExchangeSelectedCode(code: string): void {
  if (!code) return
  currentSelectedCode = code
  for (const fn of listeners) {
    try {
      fn(code)
    } catch {
      // 容错防御
    }
  }
}

/** 订阅标的选中变化 */
export function subscribeExchangeSelectedCode(fn: CodeListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
