/**
 * **按布局加载对应的应用级样式**（2026-09-25 · ui-redesign-2）
 *
 * 船长两次报障的根因：**两套外壳共用同一批类名**（`.app-nav-side` / `.app-workspace` /
 * `.app-page-main` / `.app-log-dock` …），而本分支为"底栏 + 左列活动栏"改写了这些规则
 * ⇒ 无论怎么卡特异度，两套规则都会互相串味（modern 底栏被压成 168px 侧栏、
 * classic 导航项吃到 12px 小字，反复 5 轮都对不齐）。
 *
 * ⇒ 改成**两份样式表、按布局只启用一份**，从根上消除冲突：
 *   · `tools/_ui-artifacts/layout-css/styles-modern.css`  = 本分支现有样式（新版外观一字不改）；
 *   · `tools/_ui-artifacts/layout-css/styles-classic.css` = **main 分支原文**（旧版 = main 上当前使用的界面）。
 * 两份都由 `tools/_ui-artifacts/scripts/_split-layout-css.mjs` 从 `styles.css` 拆分生成，
 * 改样式请改 `styles.css` 再跑那个脚本。
 *
 * ⚠ 两份样式都用 `?url` 交给 Vite **各自处理成独立 CSS 文件**（PostCSS 照跑、与原来
 *   直接 import styles.css 的产物口径一致）。试过 `?raw` 内联成字符串，会跳过 PostCSS，放弃。
 *
 * 用法（两个入口都要调，且**必须在首屏渲染前**）：
 *   import { installLayoutStyles } from './ui/layoutStyles'
 *   installLayoutStyles()
 */
// 两份生成件与本文件同目录（`ui/layout-css/`），**已入库**；由 `tools/layout-css-split.ts` 生成，
// 改样式请改 `styles.css` 后跑 `npm run ui:layout-css`（详见该工具头部注释）。
import classicUrl from './layout-css/styles-classic.css?url'
import modernUrl from './layout-css/styles-modern.css?url'

export type LayoutKind = 'modern' | 'classic'

const LAYOUT_KEY = 'whale-idle:layout'
const LAYOUT_SET_KEY = 'whale-idle:layout-set'
const LINK_ID = 'whale-layout-style'

/**
 * 当前应采用的布局（没在设置里选过 ⇒ **classic**，见船长 2026-09-25 二次裁定
 * 「默认旧档采用旧界面，新界面需要去设置切换」＋「一律默认旧版」）。
 * ⚠ 与 `App.tsx` 里的 `readLayoutPref()` **同口径**（两处各自一份，因为 App 不能反向 import 本模块
 * 之外的启动期代码）；改口径时两处一起改。
 */
export function readLayoutPref(): LayoutKind {
  try {
    if (localStorage.getItem(LAYOUT_SET_KEY) !== '1') return 'classic'
    return localStorage.getItem(LAYOUT_KEY) === 'modern' ? 'modern' : 'classic'
  } catch {
    return 'classic'
  }
}

/**
 * 装上当前布局的样式表。
 * - 已装上且布局没变 ⇒ 空操作（重复调用无副作用）；
 * - 布局变了 ⇒ 换掉同一个 `<link>` 的 `href` ⇒ **两份永不同时生效**。
 */
export function installLayoutStyles(kind: LayoutKind = readLayoutPref()): void {
  const href = kind === 'modern' ? modernUrl : classicUrl
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (existing) {
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href)
    return
  }
  const link = document.createElement('link')
  link.id = LINK_ID
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}
