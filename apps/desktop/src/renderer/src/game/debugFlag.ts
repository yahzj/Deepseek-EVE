/**
 * **调试模式的客户端开关（含「本机门禁」）**。
 *
 * 2026-09-25 船长令：「**是否可以设置只有本地开启，上传后的版本都是关闭隐藏的**」
 * ⇒ 两道闸门叠在一起（见 `@whale/core` 的 `isLocalDebugOrigin`）：
 *   ① **本机门禁**：协议是 http(s) 且宿主是本机/内网（`localhost` / `127.0.0.1` / `::1` /
 *      `*.local` / 内网 IPv4）。**发布版（公网域名、桌面打包版的 `file:`）一律不放行**；
 *   ② **本机上的开关**：`localStorage['whale-idle:debug']`（设置里的「调试模式」那枚开关，
 *      或 DevTools 里手写）——只有①放行的机器上它才生效。
 *
 * 于是：**同一份产物**在船长本机是"可开可关"，传到公网后**连手动置标志也不生效**
 * （不靠构建开关 ⇒ 不存在"忘了切发布模式"的风险）。
 *
 * ⚠ 读写在存储被禁（桌面端某些环境）时一律按"关"处理，绝不让整树崩掉。
 */
import { isLocalDebugOrigin } from '@whale/core'

const DEBUG_KEY = 'whale-idle:debug'

/** 这台机器算不算「本机」（调试模式可用；发布版恒 false） */
export function debugAllowed(): boolean {
  try {
    if (typeof location === 'undefined') return false
    return isLocalDebugOrigin(location.protocol, location.hostname)
  } catch {
    return false
  }
}

/** 调试入口是否可用（**本机门禁 ∧ 标志位**；发布版恒 false） */
export function debugEnabled(): boolean {
  if (!debugAllowed()) return false
  try {
    // 兼容 '1' 与 'true'（船长手输开关时大小写/词形不一，原先只认精确的 '1'）
    const v = localStorage.getItem(DEBUG_KEY)
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

/** 设置面板里的「开发者」开关用：写/清调试标志（**不依赖 DevTools 与 origin 猜测**） */
export function setDebugEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1')
    else localStorage.removeItem(DEBUG_KEY)
  } catch {
    /* 存储被禁：忽略 */
  }
}

/** 新虫洞只在显式本机实验标记/隔离验收下开启，普通调试不改变信号空间入口。 */
export function futureWormholeEnabled(): boolean {
  if (!debugEnabled()) return false
  try {
    return localStorage.getItem('whale-idle:future-wormhole') === '1' || localStorage.getItem('whale-idle:wh-expedition-test') === '1'
  } catch { return false }
}

export function setFutureWormholeEnabled(on: boolean): void {
  if (!debugAllowed()) return
  try {
    if (on) localStorage.setItem('whale-idle:future-wormhole', '1')
    else localStorage.removeItem('whale-idle:future-wormhole')
    window.dispatchEvent(new Event('whale-future-wormhole-change'))
  } catch { /* 存储被禁仍不开启。 */ }
}
