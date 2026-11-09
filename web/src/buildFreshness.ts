/**
 * 网页版新鲜度判定（纯函数，无 DOM 依赖）。
 *
 * 网页构建产物只有一个入口脚本，文件名带内容哈希（`assets/index-XXXXXXXX.js`）；
 * 线上 `index.html` 换了脚本名，就说明部署了新版本。
 * 桌面版是打包加载，不适用；开发服务器没有 `/assets/` 入口，也不会误判。
 */

/** 从 index.html 里取入口脚本路径；取不到返回 null。 */
export function entryScriptOf(html: string): string | null {
  const tags = html.match(/<script[^>]*\ssrc=["'][^"']+["'][^>]*>/gi) ?? []
  for (const tag of tags) {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1]
    if (src && src.includes('/assets/')) return src
  }
  return null
}

/** 脚本地址的比较键：只看路径，忽略域名、协议与查询串。 */
export function scriptKey(src: string, base: string): string {
  try {
    return new URL(src, base).pathname
  } catch {
    return src
  }
}

/** 线上入口脚本与当前运行的是否已经不同（true = 有新版本）。 */
export function isNewerBuild(currentSrc: string, html: string, base: string): boolean {
  const nextSrc = entryScriptOf(html)
  if (nextSrc === null) return false
  return scriptKey(nextSrc, base) !== scriptKey(currentSrc, base)
}
