/**
 * **界面字体选择**（2026-11-02 船长令，多轮迭代后的最终口径）：
 *
 * ①「增加一个字体选择的功能在设置界面……把字体 `D:\Downloads\unifont-18.0.01 (1).otf` 嵌入到项目里」；
 * ②「我想试试，英文和数字用这个 `D:\Downloads\unscii-16 (1).otf` 字体显示，行不行呀」
 * ③「不是单独的，是跟 unifont 一起显示，不用单独做选项……选项不要叫 GNU Unifont，叫复古」
 * ④「这个16的字体不太行，换成 `D:\Downloads\unscii-8-tall.otf`」
 * ⑤「unscii-8-tall效果太差了，我想换成 `D:\Downloads\Oxanium-VariableFont_wght.ttf`」
 * ⑥「现在这个效果很好，但是不适合复古这个选项，可以把这个中英字体跟默认做到一块去」
 * ⑦「我不是这个意思，默认是微软雅黑+Oxanium（英文/数字），复古是 GNU Unifont + `D:\Downloads\Eunomia-Bold.otf`（英文/数字）」
 * ⑧「复古这个选项里，还是统一只用 unifont 这个字体吧」（并要求字体选择默认保存、下次打开保持）⇒ **最终两档**：
 *   · `default` —— 「默认」：中文用系统微软雅黑栈，**英文/数字用 Oxanium**；
 *   · `retro`   —— 「复古」：**统一只用 GNU Unifont**（中文 + 英文/数字都是它的像素点阵字形）。
 *
 * 口径：
 * - 本机偏好，存 `localStorage`（键 `whale-idle:ui-font`，与 `whale-idle:ui-zoom` / `:ui-fs` 同族），
 *   **不进存档**（与语言/配色/布局同一类：存档保持语言与外观中立）；点选即落盘，
 *   下次启动由 `prebootRenderer()` 读回并应用（刷新/重启后仍是玩家选的那一档）。
 * - 生效方式 = 在 `<html>` 上写 `data-ui-font="retro"` ＋ CSS 变量 `--ui-font`（字体栈单点），
 *   样式钩子写在 `panels/appSettings.css`（面板级 css 先例：`panels/fittingRange.css`）；
 *   选 `default` 时**把这两个标记都撤掉** ⇒ 回到 `packages/ui/src/index.css` 的默认字体栈
 *   （Oxanium + 微软雅黑），与「默认」口径一致。
 * - 等宽/代码读数：两档都覆盖 `--wui-mono`（读数也按同档字体走；中文读数自动回退对应中文栈）。
 *
 * ⚠ 启动时的应用由 `game/boot.ts` 的 `prebootRenderer()` 接线（本模块只导出函数，
 * 两个入口共用同一个启动点）：
 * ```ts
 * applyFontChoice(readFontChoice())
 * ```
 * 本模块环境安全：非浏览器（工具/测试/SSR）没有 `document` / `localStorage` 时直接返回。
 */

/** 可选的界面字体（只此两项；不要加「跟随系统」——默认就是系统栈，跟随系统等于重复项） */
export type FontChoice = 'default' | 'retro'

/** 偏好键（与 `whale-idle:ui-zoom` / `ui-fs` 同族；本机偏好，不进存档） */
export const FONT_KEY = 'whale-idle:ui-font'

/** 可选值表（设置面板按钮组按此顺序渲染，避免 UI 与读取逻辑各写一份） */
export const FONT_CHOICES: readonly FontChoice[] = ['default', 'retro']

/**
 * 「复古」档字体栈（写进 CSS 变量 `--ui-font`；逐字符回退）：
 * 1. `GNU Unifont` —— 内嵌 GNU Unifont 18.0.01 的全字库像素点阵（中文、英文、数字、符号全包）；
 * 2. 系统中文栈兜底（字体文件缺失/个别字符未覆盖时仍可读）。
 * 族名是 `@font-face` 的自定义名（见 `panels/appSettings.css`）：自定义名避免与玩家系统里
 * 已安装的同名字体混用，保证「内嵌文件」而不是「系统字体」被使用。
 */
const RETRO_STACK =
  "'GNU Unifont', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif"

/** 选择 → CSS 字体栈（`default` = 不覆盖，返回 null ⇒ 用 index.css 的默认栈 Oxanium + 雅黑） */
const STACK: Record<FontChoice, string | null> = {
  default: null,
  retro: RETRO_STACK,
}

/** CSS 变量名（`applyFontChoice` 写入、`appSettings.css` 读取；单点） */
export const FONT_VAR = '--ui-font'

/**
 * 读取本机字体偏好（容错：坏值/读不到 ⇒ `default`，即现状）。
 * 兼容旧值：本功能早期版本曾把像素档存为 `'unifont'` / `'unscii'`，读到就迁移成 `retro`。
 */
export function readFontChoice(): FontChoice {
  try {
    if (typeof localStorage === 'undefined') return 'default'
    const raw = localStorage.getItem(FONT_KEY)
    return raw === 'retro' || raw === 'unifont' || raw === 'unscii' ? 'retro' : 'default'
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
 * - `retro`：`<html data-ui-font="retro">` ＋ `--ui-font: <复古栈>`；
 * - `default`：撤掉属性与变量 ⇒ `packages/ui/src/index.css` 的默认字体栈生效（Oxanium + 雅黑）。
 */
export function applyFontChoice(choice: FontChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  const stack = STACK[choice]
  if (stack === null) {
    delete root.dataset.uiFont
    root.style.removeProperty(FONT_VAR)
    return
  }
  root.dataset.uiFont = choice
  root.style.setProperty(FONT_VAR, stack)
}

/** 玩家在设置里点选：**即时生效 + 本机落盘**（两步同一个入口，避免调用点各写一半） */
export function chooseFont(choice: FontChoice): void {
  saveFontChoice(choice)
  applyFontChoice(choice)
}
