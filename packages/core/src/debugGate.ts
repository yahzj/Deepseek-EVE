/**
 * **调试模式的「本机门禁」**（2026-09-25 船长令）。
 *
 * 船长原话（照抄）：「**是否可以设置只有本地开启，上传后的版本都是关闭隐藏的**」
 * —— 即：本机（开发 / 内网联调）能用调试模式；**发布版一律关闭且隐藏**，
 * 连"玩家自己在 DevTools 里置了标志"也不能生效（否则等于把开发工具发给了玩家）。
 *
 * 本模块只做**纯判定**（不碰 `location` / `localStorage`，便于单测）：
 * 由调用方把 `location.protocol` 与 `location.hostname` 传进来。
 *
 * 判定口径（**失败即关**：拿不准的宿主一律按发布版处理）：
 * - 协议必须是 `http:` / `https:` —— `file:` 等（**桌面打包版就是这一类**）一律按发布版；
 * - 宿主只有这几种算「本机」：
 *   · `localhost` / `127.0.0.1` / `::1`（含 `[::1]` 写法）
 *   · `*.local`（mDNS 主机名）
 *   · **内网 IPv4**：`10.x` · `172.16~31.x` · `192.168.x`
 *     （留内网是**故意的**：船长要用手机连电脑的内网地址测网页版，手机上正是靠它才进得了
 *      调试模式才可见的入口；公网域名/公网 IP 一律关闭。）
 *
 * ⚠ 与「上传后的版本」配套的是同一份产物：**不靠构建开关**，所以不存在"忘了切发布模式"的风险。
 */

/** 内网 IPv4（10/8 · 172.16/12 · 192.168/16） */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * 这台客户端算不算「本机」（= 调试模式可用）。
 * @param protocol `location.protocol`，形如 `http:` / `https:` / `file:`
 * @param hostname `location.hostname`，形如 `localhost` / `192.168.1.7` / `game.example.com`
 */
export function isLocalDebugOrigin(protocol: string, hostname: string): boolean {
  const proto = (protocol || '').toLowerCase()
  if (proto !== 'http:' && proto !== 'https:') return false
  const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.endsWith('.local')) return true
  return isPrivateIPv4(host)
}
