/**
 * 轻量全局悬停提示（Tooltip）——全站统一的悬停说明机制。
 *
 * 用法：
 * - App 根部渲染一次 <TooltipLayer/>（fixed 单例，z 最高）；
 * - 纯文本：任意条目外包 <HoverTip as="li" tip="说明文字">…</HoverTip>；
 * - 富内容：调用 showTip(<ReactNode>, e.clientX, e.clientY) / moveTip(...) / hideTip()，
 *   或直接在组件上挂事件（ShipHover 等内部复用）；内容与文本提示同层渲染、同一定位规则；
 * - 位置：跟随鼠标（默认光标右下方），右侧/下方放不下自动翻到左/上方，并始终收敛在视口内；
 *   渲染后按实际尺寸再精修一次（富内容高度不同也能正确避让边缘）；
 * - 滚动列表内同样不受裁切（fixed 定位）。
 *
 * 2026-09-06 手机浏览器适配（船长：悬浮窗在手机上显示不正常/疑似拿不到鼠标位置）：
 * - 手机横屏（.app-root.is-mobile-rot）时，提示层位于旋转后的"局部坐标空间"，与
 *   clientX/Y（物理视口）不一致 → 先按 root 的 --mob-scale/--mob-x/--mob-y 换算回局部坐标
 *   再布局与收边（与教程高亮框同一套逆变换）；
 * - 触屏合成鼠标事件常给出 (0,0) 等无效坐标 → 用全局最近一次真实 pointer 位置兜底；
 * - 无 hover 环境改为"点到即看"：任何 pointerdown/滚动都会收起当前提示，触碰带说明的元素后
 *   由浏览器合成的 enter 事件重新显示（锚在触点），避免提示残留在角落里。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ElementType, MouseEvent, ReactNode } from 'react'

interface TipState {
  content: ReactNode
  /** 锚点（局部坐标；渲染后按实际尺寸精修一次；< 0 表示已精修过） */
  cx: number
  cy: number
  x: number
  y: number
}

/** 预估提示宽度（与实际 CSS max-width 一致；渲染后按实测精修） */
const TIP_W = 300
const PAD = 8

/**
 * **全站统一的悬停延迟**（毫秒）——**所有**提示路径共用这一个数
 * （2026-09-15 船长：「鼠标悬浮按钮的提示会和上一级的悬浮提示相互冲突。**且悬浮的反应时间太快**。
 * 建议**所有 UI 统一下**」）。
 *
 * 三条路径共用它：① 原生 `title` / `data-tip` 的**全局接管层**（本文件下方那个 useEffect）；
 * ② **富内容提示**（`hoverTipProps`，ShipHover / InfoHover 等）；③ `HoverTip` 组件。
 *
 * 沿革：2026-09-13 船长定 **200ms**（原话「停住才弹」——鼠标扫过一排按钮时不一路弹提示）；
 * **2026-09-15 船长反馈"反应时间太快" ⇒ 改成 500ms**（观感上更接近系统提示的手感，
 * 又不至于像原生那样等 1 秒）。
 */
export const TIP_DELAY_MS = 500

/**
 * 「原生提示源已被摘走」的暂存属性：属性链把 `title` 值挪到这里（`title` 属性摘掉、浏览器不弹），
 * 离开时原样放回 ⇒ 任何读 `title` 的代码不受影响；同时它也参与命中判定（摘走期间仍能再认出这个元素）。
 * （A 类 = SVG 的 `<title>` 子元素，处理方式是**清空文本**、不是挪属性，见下方接管层注释。）
 */
const TIP_STASH_ATTR = 'data-tip-native'

/**
 * **SVG 元素的作者属性**（2026-09-14 新增）：HTML 元素用 `title`，但 **React 的 SVG 类型不接受
 * `title` 属性**（SVG 的提示源本来是 `<title>` 子元素，而那个会被浏览器弹系统默认提示）⇒
 * SVG 里的悬停说明一律写 `data-tip="…"`，由本层接管成站内自绘提示。优先级：`title` > `data-tip` > 暂存。
 */
const TIP_ATTR = 'data-tip'

/**
 * **富内容提示的属主标记**（2026-09-15 统一时加）：凡是用 `hoverTipProps()` 接线的元素都带这个属性
 * ⇒ 全局接管层认得它、**不再对同一个元素重复接管**（否则同一处会先弹富内容、再被 title 路径顶掉，
 * 正是船长报的「按钮的提示会和上一级的悬浮提示相互冲突」）。
 */
const TIP_HOVER_ATTR = 'data-tip-hover'

/**
 * **把元素自身与整条祖先链上的 `title` 置空**（记原值，离开时放回）——原生提示与富卡两条路共用一份记账。
 *
 * 为什么是「链」：浏览器在悬停元素自身没有 `title` 时**会顺着祖先链找最近的一条**并弹系统默认提示
 *（2026-09-15 船长报的「按钮提示和上一级冲突」就是这条回退）⇒ 只清自己那颗必然漏。
 *
 * 为什么**进入就压、而不是停够延迟再压**（2026-09-17 船长二次报障「默认的悬停 title 和新的悬浮窗
 * 会同时出现」的根治点）：浏览器原生提示与我们的自绘提示**延迟同一档**（都约 500ms）——等延迟到点才
 * 置空，原生提示往往已经先弹出来了，随后自绘提示再弹一次 ⇒ 同屏两个。改成**指针一进就置空**：
 * 原生提示永远没机会弹，延迟只用来决定「我们这条什么时候画出来」。
 */
/** `n` = 压住这条元素的属主数：接管层与富卡可能同时压同一批元素 ⇒ 引用计数，减到 0 才真的还原 */
let mutedChain: Array<{ el: Element; text: string; n: number }> = []

/** 压住 `el` 自身与祖先链上的 `title`（引用计数 +1；承诺调用方离开时按同一条链 `releaseTitleChain` 一次） */
function muteTitleChain(el: Element): void {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const t = n.getAttribute('title')
    const rec = mutedChain.find((m) => m.el === n)
    if (rec) {
      if (t !== null && t !== '') {
        rec.text = t // React 写了新值（读数型 title 会变）⇒ 以新值为「原值」
        n.setAttribute('title', '')
      }
      rec.n += 1
      continue
    }
    if (t !== null && t !== '') {
      mutedChain.push({ el: n, text: t, n: 1 })
      n.setAttribute('title', '')
    }
  }
}

/** 只补压、不再计数（同一属主的重复压制：React 把 `title` 写回来了；链上新出现的祖先算本次这一份） */
function reblankTitleChain(el: Element): void {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const t = n.getAttribute('title')
    if (t === null || t === '') continue
    const rec = mutedChain.find((m) => m.el === n)
    if (rec) rec.text = t
    else mutedChain.push({ el: n, text: t, n: 1 })
    n.setAttribute('title', '')
  }
}

/** 某个属主放手：走同一条链把计数减一，减到 0 才还原（元素当前已有非空 title ⇒ 作者层自己写的，以它为准） */
function releaseTitleChain(el: Element): void {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const i = mutedChain.findIndex((m) => m.el === n)
    if (i < 0) continue
    const rec = mutedChain[i]!
    rec.n -= 1
    if (rec.n > 0) continue
    mutedChain.splice(i, 1)
    if (!rec.el.isConnected) continue // 已从文档里摘掉的元素不用还
    const now = rec.el.getAttribute('title')
    if (now === null || now === '') rec.el.setAttribute('title', rec.text)
  }
}

const listeners = new Set<(s: TipState | null) => void>()
let current: TipState | null = null
let raf = 0

function emit(): void {
  for (const fn of listeners) fn(current)
}

/** 布局空间度量：桌面 = 视口（恒等）；手机横屏 = root 旋转前的局部空间（与提示层坐标系一致） */
interface Metrics {
  rot: boolean
  s: number
  L: number
  T: number
  bw: number
  bh: number
}

function viewMetrics(): Metrics {
  if (typeof document !== 'undefined') {
    const root = document.querySelector<HTMLElement>('.app-root.is-mobile-rot')
    if (root) {
      const cs = window.getComputedStyle(root)
      const s = parseFloat(cs.getPropertyValue('--mob-scale'))
      const L = parseFloat(cs.getPropertyValue('--mob-x'))
      const T = parseFloat(cs.getPropertyValue('--mob-y'))
      if (Number.isFinite(s) && s > 0 && Number.isFinite(L) && Number.isFinite(T)) {
        return {
          rot: true,
          s,
          L,
          T,
          bw: root.offsetWidth || 1200,
          bh: root.offsetHeight || window.innerHeight,
        }
      }
    }
  }
  return { rot: false, s: 1, L: 0, T: 0, bw: window.innerWidth, bh: window.innerHeight }
}

/** 物理视口坐标 → 提示层局部坐标（局部(lx,ly)→视口：X = L + s·ly；Y = T − s·lx） */
function toLocal(m: Metrics, x: number, y: number): { x: number; y: number } {
  if (!m.rot) return { x, y }
  return { x: (m.T - y) / m.s, y: (x - m.L) / m.s }
}

/** 最近一次真实指针位置（pointerdown/pointermove 维护；兜底触屏合成事件给出的 (0,0) 坐标） */
const lastPt = { x: -1, y: -1 }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
  window.addEventListener('pointermove', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
}

/** 首帧占位定位（粗估；TooltipLayer 渲染后会按实际尺寸精修一次） */
function place(content: ReactNode, cx: number, cy: number): void {
  const m = viewMetrics()
  let px = cx
  let py = cy
  if (px === 0 && py === 0 && lastPt.x >= 0) {
    px = lastPt.x
    py = lastPt.y
  }
  const lp = toLocal(m, px, py)
  const estH = 160
  let x = lp.x + 14
  let y = lp.y + 16
  if (x + TIP_W + PAD > m.bw) x = lp.x - TIP_W - 12 // 右侧放不下 → 锚点左侧
  if (y + estH + PAD > m.bh) y = lp.y - estH - 10 // 下方放不下 → 锚点上方
  x = Math.max(PAD, Math.min(m.bw - TIP_W - PAD, x))
  y = Math.max(PAD, Math.min(m.bh - estH - PAD, y))
  current = { content, cx: lp.x, cy: lp.y, x: Math.round(x), y: Math.round(y) }
  emit()
}

/** 显示富内容/文本提示（跟随光标右下，自动边缘翻转与收敛） */
export function showTip(content: ReactNode, clientX: number, clientY: number): void {
  place(content, clientX, clientY)
}

/**
 * 当前正在展示的"富内容提示属主"（`hoverTipProps` 每次调用一个身份标）。
 * 用于 mousemove 时判断"这条提示是不是我这条"、以及 leave 时该不该收。
 */
let shownOwner: object | null = null
/** 等待延迟的那一条（同一时刻只可能有一条：鼠标只有一个） */
let pendingOwner: object | null = null
let pendingTimer = 0

/** 取消"等待中"的那条（离开 / 换归属 / 卸载时调用） */
function cancelPending(): void {
  if (pendingTimer !== 0) {
    window.clearTimeout(pendingTimer)
    pendingTimer = 0
  }
  pendingOwner = null
}

type HoverEnterEvent = MouseEvent<HTMLElement>

/**
 * **内层优先**：从指针所在元素往上走到本元素之间，若中途有**更深的提示归属**
 * （自己带 `title` / `data-tip`，或另一个 `hoverTipProps`）⇒ 本次不接（让给内层）。
 * 这是「按钮的提示与上一级提示相互冲突」的根治点：外层行/卡不再抢内层按钮的提示。
 */
function deeperOwnerWins(e: HoverEnterEvent): boolean {
  const cur = e.currentTarget
  let n: Element | null = (e.target as Element | null) ?? null
  while (n && n !== cur && n.nodeType === 1) {
    if (n.hasAttribute('title') || n.hasAttribute(TIP_ATTR) || n.hasAttribute(TIP_HOVER_ATTR)) return true
    n = n.parentElement
  }
  return false
}

/**
 * **富内容提示的统一接线**（2026-09-15 统一）：与全局接管层共用同一延迟（`TIP_DELAY_MS`）、
 * 同一单例提示层、同一"内层优先"判据。
 *
 * 用法：`<li {...hoverTipProps(content)}>…</li>`
 * ⚠ **不要与 `title` 同时用**（一个元素只该有一个提示归属）：`title` 走接管层、`hoverTipProps` 走这条，
 * 两者都在同一个单例层上画 ⇒ 同时挂会互相顶。
 */
export function hoverTipProps(content: ReactNode): {
  'data-tip-hover': string
  onMouseEnter: (e: HoverEnterEvent) => void
  onMouseMove: (e: HoverEnterEvent) => void
  onMouseLeave: () => void
} {
  const me = {}
  let last: { x: number; y: number } = { x: 0, y: 0 }
  /** 本次悬停压住的那颗元素（离开时只放自己这一份；`null` = 没压过） */
  let mutedEl: Element | null = null
  return {
    [TIP_HOVER_ATTR]: '1',
    onMouseEnter: (e: HoverEnterEvent) => {
      if (deeperOwnerWins(e)) return
      /**
       * ★ **富卡这条路同样要压掉原生提示**（2026-09-17 船长报「默认的悬停 title 和新的悬浮窗同时出现」）：
       * 接管层只压"有 `title`/`data-tip` 的那些元素"，而富卡元素走的是本路径 ⇒ 若它自身或**祖先卡片/行**
       * 上有原生 `title`，浏览器就会顺着祖先链把系统提示弹出来、与富卡同屏。压法与接管层共用同一份记账
       * （模块级 `muteTitleChain` / `releaseTitleChain`，引用计数：两条路可同时压同一批元素），**指针一进就压**、离开时只放自己这一份。
       */
      const el = e.currentTarget as unknown as Element | null
      if (el && typeof el.closest === 'function' && mutedEl === null) {
        muteTitleChain(el)
        mutedEl = el
      }
      last = { x: e.clientX, y: e.clientY }
      if (shownOwner === me) return // 从内部子元素绕回来：已经在展示，不重启延迟
      cancelPending()
      pendingOwner = me
      pendingTimer = window.setTimeout(() => {
        pendingTimer = 0
        if (pendingOwner !== me) return
        pendingOwner = null
        shownOwner = me
        showTip(content, last.x, last.y)
      }, TIP_DELAY_MS)
    },
    onMouseMove: (e: HoverEnterEvent) => {
      last = { x: e.clientX, y: e.clientY }
      if (shownOwner === me) moveTip(content, last.x, last.y)
    },
    onMouseLeave: () => {
      if (mutedEl !== null) {
        releaseTitleChain(mutedEl)
        mutedEl = null
      }
      if (pendingOwner === me) cancelPending()
      if (shownOwner === me) {
        shownOwner = null
        hideTip()
      }
    },
  }
}

/** 指针高频更新：rAF 节流 */
export function moveTip(content: ReactNode, clientX: number, clientY: number): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    place(content, clientX, clientY)
  })
}

/** 隐藏提示 */
export function hideTip(): void {
  if (raf !== 0) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (current !== null) {
    current = null
    emit()
  }
}

export function TooltipLayer(): ReactNode {
  const [state, setState] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  // 无 hover 的触屏交互：点任意处/滚动先收起提示（触碰带说明元素后由合成 enter 重新显示）
  useEffect(() => {
    const dismiss = (): void => hideTip()
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  /**
   * ⚠ **原生 title 一律改走自绘提示**（2026-09-13 船长：「按钮的鼠标悬浮提示有时候过宽…
   * 限制下宽度，允许多几行」）——机制：
   * 1. 指针进入有提示的元素、**停够 TIP_DELAY_MS**，才摘掉原生提示源并弹自绘提示
   *    （`.app-tip`：max-width 300px + `white-space: pre-line` + `overflow-wrap: anywhere`
   *    ⇒ **限宽、可多行**，且 `\n` 仍按行渲染；扫过不弹、停住才弹）；
   * 2. 指针真正离开（`relatedTarget` 不在其内部）⇒ 原生提示源**原样放回**并收起自绘提示
   *    ⇒ 任何读 `title` 的代码（如"点了禁用按钮弹原因"那条链）行为不变；
   * 3. 展示期间 React 又把 `title` 写回来（读数型说明每拍刷新）⇒ 观察器**再摘一次**并刷新提示文本；
   * 4. 同时挂 `pointerover/pointerout`：禁用控件的 mouse 事件在部分浏览器不打、pointer 事件照打。
   *    （**2026-09-14 实测**：当前 Chromium 对 `disabled` 按钮两者都照打、接管正常 ⇒ 禁用控件不是漏网原因）
   *
   * **2026-09-14 船长：「部分情况仍会出现系统默认的鼠标悬浮 title 窗口」——补齐两类漏网**：
   * - **A. SVG 的 `<title>` 子元素**（`<text><title>…</title></text>` 这种）：它**不是属性**，
   *   `closest('[title]')` 完全看不见 ⇒ 浏览器按 SVG 标准照弹原生提示。现在一并纳入：停够延迟后
   *   **清空该 `<title>` 的文本**（空 title 不弹提示）并弹自绘提示，离开时把原文本放回。
   *   ⚠ 只清文本、**不摘元素**：`<title>` 归 React 管，摘掉它会让 React 卸载父节点时
   *   `removeChild` 抛 NotFoundError（悬停中切页就会炸）；清文本对 React 完全无感。
   *   （作者层已同步清扫那两处、体检加了「TSX 禁 `<title>` 子元素」守卫 ⇒ 这层只是兜底。）
   * - **B. 悬停期间才写入 `title`**（进入时还没有、React 随后才写进来）：原先只在"已经摘过 title"
   *   之后才挂观察器 ⇒ 这一段没人管，原生提示趁虚而入。现在**进入即挂观察**，一旦出现可展示文本、
   *   且已停够延迟，就立刻接管。
   *
   * ⚠ 已知边界（如实登记）：B 类的观察只挂在**指针所在的那个元素**上；若提示源是它的**祖先**
   * （`closest('[title]')` 指到上层），而 title 是在悬停期间才写到那个祖先上的，本层不会补捉——
   * 作者层避免"先无后有"的祖先 title 即可（本仓 311 处 title 都是渲染即带）。
   */
  useEffect(() => {
    let timer = 0
    /** 指针当前所在元素（可能还没接管：在等延迟，或在等 title 出现） */
    let hovered: Element | null = null
    /** 进入 hovered 的时刻（用来补足悬停延迟；后到的 title 不必重新计时） */
    let hoveredAt = 0
    /** 已接管、正在展示自绘提示（`svgTitle` 非空 = A 类：清的是它的文本） */
    let shown: { el: Element; text: string; svgTitle: Element | null; from: 'title' | 'tip' | 'stash' } | null = null
    /** 已被我们压住的原生提示源（**进入即压**；与「是否已展示自绘提示」分开记账） */
    let mutedSrc: TipSrc | null = null
    let obs: MutationObserver | null = null

    type TipSrc = { el: Element; text: string; svgTitle: Element | null; from: 'title' | 'tip' | 'stash' }

    /** 某元素"能显示什么提示"：①`title` 属性 ②`data-tip`（SVG 作者属性）③暂存 ④SVG `<title>` 子元素（A 类兜底）
     *  ⚠ **`title=""` 视为"没有 title"**：接管时给元素写的是**空 title**（见 `take`，用它压住祖先的原生提示）
     *  ⇒ 这里必须继续认出"暂存里那份真文本"，否则一接管就丢掉文案。
     *  ⚠ **带 `data-tip-hover` 的元素归 `hoverTipProps` 那条路径**（富内容提示）⇒ 本层返回 null，不重复接管。 */
    const srcOf = (el: Element | null): TipSrc | null => {
      if (!el || typeof el.closest !== 'function') return null
      const attrEl = el.closest(`[title], [${TIP_ATTR}], [${TIP_STASH_ATTR}]`)
      if (attrEl) {
        if (attrEl.hasAttribute(TIP_HOVER_ATTR)) return null
        /**
         * **富卡元素比这个 title 源更深 ⇒ 让富卡那条路赢**（内层优先）。
         * 不加这条：指针在富卡元素上、而它的**祖先容器**带 `title` 时，本层会把那个祖先的 title 当成提示源
         * 接管起来（`closest` 沿链找到的就是它）⇒ 500ms 后拿祖先文本把富卡顶掉（同一时刻只有一条自绘提示）。
         * ⚠ 本仓当前**没有**这种嵌套（`ui:tip-check` ② 判据实测 0 处），这是防日后接线踩到。
         */
        const richOwner = el.closest(`[${TIP_HOVER_ATTR}]`)
        if (richOwner && attrEl !== richOwner && attrEl.contains(richOwner)) return null
        const rawTitle = attrEl.getAttribute('title')
        const title = rawTitle !== null && rawTitle !== '' ? rawTitle : null
        const authored = attrEl.getAttribute(TIP_ATTR)
        const stashed = attrEl.getAttribute(TIP_STASH_ATTR)
        const from = title !== null ? 'title' : authored !== null ? 'tip' : 'stash'
        return { el: attrEl, text: title ?? authored ?? stashed ?? '', svgTitle: null, from }
      }
      // SVG 链兜底：往上找第一个带**直接** `<title>` 子元素的祖先（`<svg>` 根自身不参与）
      for (let n: Element | null = el; n && n.tagName.toLowerCase() !== 'svg'; n = n.parentElement) {
        const t = Array.from(n.children).find((c) => c.tagName.toLowerCase() === 'title')
        if (t) return { el: n, text: (t.textContent ?? '').trim(), svgTitle: t, from: 'title' }
      }
      return null
    }

    // 整链压制与还原走模块级的 `muteTitleChain` / `restoreTitleChain`（与富卡那条路共用一份记账）

    /**
     * **压住原生提示源**（A 类 = 清空 SVG `<title>` 文本；B 类 = `title` 文本挪进暂存 ＋ 整链置空）。
     *
     * ⚠ **2026-09-15 第一次修**（船长报「按钮的提示会和上一级的悬浮提示相互冲突」）：
     * 旧实现 `removeAttribute('title')` 之后，指针下这个元素就"没有 title"了 ⇒ 浏览器**顺着祖先链
     * 找到上一级卡片/行的 title、弹出系统默认提示** ⇒ 改成写**空 title**（空 title 自己不弹、同时截断
     * 祖先链查找）＋ 把整条祖先链的 title 一并压住。原文案仍在 `TIP_STASH_ATTR` 里，离开时原样放回。
     *
     * ⚠ **2026-09-17 第二次修**（船长报「默认的悬停 title 和新的悬浮窗会同时出现」）：上面这套原先只在
     * **停够 `TIP_DELAY_MS` 之后**才执行 ⇒ 那 500ms 里原生 title 仍然有效、浏览器原生提示先弹，随后自绘
     * 提示再弹 ⇒ 同屏两个。现在**指针一进就压**（`armAgain` 调用本函数），延迟只决定「我们这条何时画出来」。
     */
    const muteNative = (src: TipSrc): void => {
      if (src.svgTitle) {
        if ((src.svgTitle.textContent ?? '') !== '') src.svgTitle.textContent = ''
      } else if (src.from === 'title') {
        // 文本挪进暂存：摘走期间仍能认出这个元素（`srcOf`），也继续供自绘提示取文本
        src.el.setAttribute(TIP_STASH_ATTR, src.text)
      }
      const same = mutedSrc !== null && mutedSrc.el === src.el
      if (mutedSrc !== null && !same) unmuteNative()
      if (same) reblankTitleChain(src.el)
      else muteTitleChain(src.el)
      mutedSrc = src
    }

    /** 把原生提示源原样放回并清掉观察器（`data-tip` 作者属性不留痕） */
    const putBack = (): void => {
      unmuteNative()
      shown = null
    }

    /** 还原本次压制（整链 ＋ 暂存属性），并断开观察器 */
    const unmuteNative = (): void => {
      obs?.disconnect()
      obs = null
      const s = mutedSrc
      mutedSrc = null
      if (s) releaseTitleChain(s.el)
      if (!s) return
      if (s.svgTitle) {
        // 展示期间 React 改写过文本 ⇒ `s.text` 已被观察器同步成新值，以新值为准
        if ((s.svgTitle.textContent ?? '') === '') s.svgTitle.textContent = s.text
        return
      }
      const stashed = s.el.getAttribute(TIP_STASH_ATTR)
      if (stashed === null) return
      s.el.removeAttribute(TIP_STASH_ATTR)
      // 只在元素当前"没有 title"或"还是我们写的空占位"时放回（React 若已写新值，以新值为准）
      const now = s.el.getAttribute('title')
      if (now === null || now === '') s.el.setAttribute('title', stashed)
    }

    /** 锚点：鼠标位置（2026-09-13 船长「要跟随鼠标走」）；触屏合成事件给 (0,0) 时回落元素底边中点 */
    const anchorOf = (el: Element): { x: number; y: number } => {
      const r = el.getBoundingClientRect()
      return {
        x: lastPt.x >= 0 ? lastPt.x : Math.round(r.left + Math.min(r.width / 2, 160)),
        y: lastPt.y >= 0 ? lastPt.y : Math.round(r.bottom - 4),
      }
    }

    /** 停够延迟且当前确有可展示文本 ⇒ 接管（B 类文本后到时由观察器再叫一次） */
    const maybeTake = (): void => {
      if (shown) return
      const el = hovered
      if (!el || !el.isConnected) return
      if (performance.now() - hoveredAt < TIP_DELAY_MS) return
      const src = srcOf(el)
      if (!src || src.text.trim() === '') return
      muteNative(src) // 兜底：B 类（title 悬停期间才写入）与 React 写回都在这里补压
      const a = anchorOf(src.el)
      shown = { el: src.el, text: src.text, svgTitle: src.svgTitle, from: src.from }
      watch(el, src.svgTitle)
      showTip(src.text, a.x, a.y)
    }

    /**
     * 观察器：**进入即挂**（覆盖 B 类"悬停期间才写入 title"），接管后继续盯
     * （覆盖读数型 title 被 React 写回；A 类额外盯 `<title>` 文本被改写）。
     */
    const watch = (el: Element, svgTitle: Element | null): void => {
      obs?.disconnect()
      obs = new MutationObserver(() => {
        if (!hovered || !hovered.isConnected) {
          putBack()
          hideTip()
          hovered = null
          return
        }
        if (!shown) {
          maybeTake() // B 类：可展示文本刚出现 ⇒ 立刻接管
          return
        }
        const src = srcOf(hovered)
        if (!src || src.el !== shown.el) return
        if (src.svgTitle) {
          // A 类：我们主动清空了文本 ⇒ 只有"非空的新文本"才算被 React 改写
          if ((src.svgTitle.textContent ?? '') !== '') src.svgTitle.textContent = ''
          const fresh = src.text.trim()
          if (fresh === '' || fresh === shown.text) return
          shown.text = fresh
        } else {
          const fresh = src.text
          if (fresh.trim() === '') return
          // React 把 title 写回来了（读数型 title 会随状态变）⇒ 重新压掉；原值以新值为准（见 muteTitleChain）
          muteNative(src)
          if (fresh === shown.text) return
          shown.text = fresh
        }
        const a = anchorOf(shown.el)
        showTip(shown.text, a.x, a.y)
      })
      obs.observe(el, { attributes: true, attributeFilter: ['title', TIP_ATTR] })
      if (svgTitle) obs.observe(svgTitle, { childList: true, characterData: true, subtree: true })
    }

    /** 提示归属元素（有 `title`/`data-tip`/暂存就归它；都没有就归指针所在元素本身） */
    const ownerOf = (el: Element): Element => srcOf(el)?.el ?? el

    const armAgain = (el: Element): void => {
      hovered = el
      hoveredAt = performance.now()
      // ★ 指针一进就压掉原生提示源（不等延迟）——否则浏览器原生提示会与自绘提示同屏（2026-09-17 船长报障）
      const src0 = srcOf(el)
      if (src0 && src0.text.trim() !== '') muteNative(src0)
      if (timer !== 0) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        maybeTake()
      }, TIP_DELAY_MS)
      watch(el, null)
    }

    /**
     * ⚠ **浏览器按"外层 → 内层"顺序派发 `mouseover`**（进一个按钮会先给 body/顶栏、再给按钮），
     * 所以子元素进来时**不能早退**——否则 `hovered` 会停在最外层容器上、内层永远轮不到接管
     * （2026-09-14 用真产物端到端实测到过这个回归：悬停「设置」根本不弹自绘提示）。
     * ⇒ 同属一个提示归属元素时只"跟着更新、延迟不重启"；换了归属才重开一轮。
     */
    const onEnter = (e: Event): void => {
      const t = e.target as Element | null
      if (!t || typeof t.closest !== 'function') return
      if (hovered === t) return
      if (hovered && hovered.contains(t) && ownerOf(t) === ownerOf(hovered)) {
        hovered = t
        watch(t, null)
        return
      }
      putBack()
      hideTip()
      armAgain(t)
    }
    const onLeave = (e: Event): void => {
      if (!hovered) return
      // 注意：本文件顶部的 `MouseEvent` 是 React 的类型，这里要的是 DOM 事件的 relatedTarget
      const to = (e as unknown as { relatedTarget?: Node | null }).relatedTarget ?? null
      const toEl = to !== null && to.nodeType === 1 ? (to as Element) : null
      if (toEl !== null) {
        const owner = ownerOf(hovered)
        if (toEl === owner || owner.contains(toEl)) return // 指针还在提示归属元素里（如从内层移到按钮本体）⇒ 不动
        putBack()
        hideTip()
        armAgain(toEl)
        return
      }
      if (timer !== 0) {
        window.clearTimeout(timer)
        timer = 0
      }
      putBack()
      hideTip()
      hovered = null
    }
    /** 提示跟随鼠标（`moveTip` 自带 rAF 节流；只在提示已展示时重排） */
    const onMove = (e: Event): void => {
      if (!shown || shown.text === '') return
      const me = e as unknown as { clientX: number; clientY: number }
      if (typeof me.clientX !== 'number') return
      moveTip(shown.text, me.clientX, me.clientY)
    }
    document.addEventListener('mouseover', onEnter, true)
    document.addEventListener('mouseout', onLeave, true)
    document.addEventListener('pointerover', onEnter, true)
    document.addEventListener('pointerout', onLeave, true)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('pointermove', onMove, true)
    return () => {
      putBack()
      document.removeEventListener('mouseover', onEnter, true)
      document.removeEventListener('mouseout', onLeave, true)
      document.removeEventListener('pointerover', onEnter, true)
      document.removeEventListener('pointerout', onLeave, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('pointermove', onMove, true)
    }
  }, [])

  // 渲染后按实际尺寸精修落点（首帧估算 → 实测翻转/收敛一次；cx < 0 表示已精修）
  useLayoutEffect(() => {
    if (!state || state.cx < 0) return
    const el = ref.current
    if (!el) return
    const m = viewMetrics()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = state.cx + 14
    let y = state.cy + 16
    if (x + w + PAD > m.bw) x = state.cx - w - 12
    if (y + h + PAD > m.bh) y = state.cy - h - 10
    x = Math.max(PAD, Math.min(m.bw - w - PAD, x))
    y = Math.max(PAD, Math.min(m.bh - h - PAD, y))
    setState((s) => (s && s.cx >= 0 ? { ...s, cx: -1, cy: -1, x: Math.round(x), y: Math.round(y) } : s))
  }, [state])

  if (!state) return null
  return (
    <div ref={ref} className="app-tip" style={{ left: state.x, top: state.y }}>
      {state.content}
    </div>
  )
}

/**
 * 把任意元素包成"悬停出说明"。as 决定渲染标签（li/div/span…），
 * 其余属性（className 等）原样透传给该标签。tip 为纯文本；富内容请用 `hoverTipProps`。
 *
 * ⚠ **2026-09-15 统一**：此前这里是**即时弹**（`onMouseEnter` 直接 showTip）——与 title 接管层的
 * 延迟不一致（船长：「建议所有 UI 统一下」）。现在走 `hoverTipProps`，与全站同延迟、同"内层优先"。
 */
export function HoverTip({
  as,
  tip,
  children,
  ...rest
}: {
  as?: ElementType
  tip: string
  children: ReactNode
  [key: string]: unknown
}) {
  const Tag = (as ?? 'div') as ElementType
  if (!tip) return <Tag {...rest}>{children}</Tag>
  return (
    <Tag {...rest} {...hoverTipProps(tip)}>
      {children}
    </Tag>
  )
}
