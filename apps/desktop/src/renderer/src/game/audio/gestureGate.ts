/**
 * **网页首次手势门禁**（2026-11-11 网页载入优化）——
 * 网页版（`http/https`）在用户第一次点击/按键前，不创建 BGM / 环境底噪的 `HTMLAudioElement`。
 * 原因：`new Audio(url)` + `preload = 'auto'` 一建元素就开始下载整首音频
 * （停靠 BGM 3.3M + 环境 2.8M），而浏览器此时本来就禁止自动播放 —— 这些字节只会和首屏 JS 抢带宽，
 * 还拖慢弱网下的可交互时间。手势后再由 `installMusicGestureRetry` / `useSceneAudio` 正常起播。
 *
 * 边界：
 * - 桌面打包是 `file://`，读本地文件没有网络成本，不受门禁影响；
 * - 浏览器不支持 `navigator.userActivation`（老 Safari 等）时视为已激活，退回旧行为（立即加载）。
 */
export function webAwaitingFirstGesture(): boolean {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
    if (!/^https?:$/.test(window.location.protocol)) return false
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation
    return ua?.hasBeenActive === false
  } catch {
    return false
  }
}
