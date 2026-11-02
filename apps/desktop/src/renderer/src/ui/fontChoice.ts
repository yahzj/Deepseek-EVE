/**
 * **界面字体选择**（2026-11-02 船长令：「增加一个字体选择的功能在设置界面……把字体
 * `D:\Downloads\unifont-18.0.01 (1).otf` 嵌入到项目里，作为可选字体之一」）。
 *
 * 口径：
 * - 本机偏好，存 `localStorage`（键 `whale-idle:ui-font`，与 `whale-idle:ui-zoom` / `:ui-fs` 同族），
 *   **不进存档**（与语言/配色/布局同一类：存档保持语言与外观中立）；
 * - 可选值只有两项：`default`（沿用现有系统字体栈，行为与改动前逐像素一致）与 `unifont`
 *   （内嵌的 GNU Unifont 18.0.01 像素点阵全字库，授权原文见 `assets/licenses/`）；
 * - 生效方式 = 在 `<html>` 上写 `data-ui-font="unifont"` ＋ CSS 变量 `--ui-font`（字体栈单点），
 *   样式钩子写在 `panels/appSettings.css`（面板级 css 先例：`panels/fittingRange.css`）；
 *   选 `default` 时**把这两个标记都撤掉** ⇒ 一条覆盖规则都不命中，外观回到现状。
 * - 等宽/代码字体 `--wui-mono` **刻意不覆盖**：像素字体在数字读数与代码上可读性差，
 *   而设置里的百分比等读数依赖等宽对齐（判断与理由见 `panels/appSettings.css` 头注）。
 *
 * ⚠ 启动时的应用由 `game/boot.ts` 的 `prebootRenderer()` 接线（本模块只导出函数，
 * 两个入口共用同一个启动点）：
 * ```ts
 * applyFontChoice(readFontChoice())
 * ```
 * 本模块环境安全：非浏览器（工具/测试/SSR）没有 `document` / `localStorage` 时直接返回。
 */

/** 可选的界面字体（只此两项；不要加「跟随系统」——默认就是系统栈，跟随系统等于重复项） */
export type FontChoice = 'default' | 'unifont'

/** 偏好键（与 `whale-idle:ui-zoom` / `whale-idle:ui-fs` 同族；本机偏好，不进存档） */
export const FONT_KEY = 'whale-idle:ui-font'

/** 可选值表（设置面板按钮组按此顺序渲染，避免 UI 与读取逻辑各写一份） */
export const FONT_CHOICES: readonly FontChoice[] = ['default', 'unifont']

/**
 * Unifont 生效时的字体栈（写进 CSS 变量 `--ui-font`）。
 *
 * `GNU Unifont` = `@font-face` 注册的**自定义族名**（见 `panels/appSettings.css`；字体文件里的
 * 原族名是 `Unifont`，这里用带前缀的名字避免与玩家系统里已安装的 Unifont 混用，
 * 也保证「内嵌文件」而不是「系统字体」被使用）；后面跟现有中文系统栈兜底
 * （字体文件缺失/加载失败时仍可读，不至于掉到 serif）。
 */
const UNIFONT_STACK = "'GNU Unifont', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif"

/** CSS 变量名（`applyFontChoice` 写入、`appSettings.css` 读取；单点） */
export const FONT_VAR = '--ui-font'

/** 读取本机字体偏好（容错：坏值/读不到 ⇒ `default`，即现状） */
export function readFontChoice(): FontChoice {
  try {
    if (typeof localStorage === 'undefined') return 'default'
    return localStorage.getItem(FONT_KEY) === 'unifont' ? 'unifont' : 'default'
  } catch {
    return 'default'
  }
}

/** 保存本机字体偏好（玩家点选即存；`default` 也显式写入，便于将来回看玩家选过什么） */
export function saveFontChoice(choice: FontChoice): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(FONT_KEY, choice)
  } catch {
    /* 存不了就算了：本次会话内仍然生效（与缩放/字号的处理一致） */
  }
}

/**
 * 把字体选择应用到界面（**幂等**；非浏览器环境直接返回）。
 *
 * - `unifont`：`<html data-ui-font="unifont">` ＋ `--ui-font: <Unifont 栈>`；
 * - `default`：撤掉属性与变量 ⇒ 现有 `body` / `html[data-locale='en'] body` 规则原样生效，
 *   与本次改动前逐像素一致。
 */
export function applyFontChoice(choice: FontChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  if (choice === 'unifont') {
    root.dataset.uiFont = 'unifont'
    root.style.setProperty(FONT_VAR, UNIFONT_STACK)
  } else {
    delete root.dataset.uiFont
    root.style.removeProperty(FONT_VAR)
  }
}

/** 玩家在设置里点选：**即时生效 + 本机落盘**（两步同一个入口，避免调用点各写一半） */
export function chooseFont(choice: FontChoice): void {
  saveFontChoice(choice)
  applyFontChoice(choice)
}
