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
 * 原生 `title` 提示 → 自绘提示的**悬停延迟**（毫秒 · 2026-09-13 船长定）。
 * 船长原话：「玩家反应，按钮的鼠标悬浮提示有时候过宽。建议限制下宽度，允许多几行。」
 * 成因：过宽的其实是**浏览器原生 `title` 提示**——它不换行，长文案会拉成一整条
 * （自绘的 `.app-tip` 本来就是 300px 上限 + 自动换行，做不出"过宽"）。
 * 集中提问后船长选定：**所有带 `title` 的元素**都换自绘（不只按钮）＋ **悬停 200ms 后弹**
 * （鼠标扫过一排按钮时不一路弹提示，停住才弹；也不像原生那样等 1 秒）。
 */
const NATIVE_TIP_HOVER_MS = 200

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
   * 1. 指针进入有提示的元素、**停够 NATIVE_TIP_HOVER_MS**，才摘掉原生提示源并弹自绘提示
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
    let obs: MutationObserver | null = null

    type TipSrc = { el: Element; text: string; svgTitle: Element | null; from: 'title' | 'tip' | 'stash' }

    /** 某元素"能显示什么提示"：①`title` 属性 ②`data-tip`（SVG 作者属性）③暂存 ④SVG `<title>` 子元素（A 类兜底） */
    const srcOf = (el: Element | null): TipSrc | null => {
      if (!el || typeof el.closest !== 'function') return null
      const attrEl = el.closest(`[title], [${TIP_ATTR}], [${TIP_STASH_ATTR}]`)
      if (attrEl) {
        const title = attrEl.getAttribute('title')
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

    /** 摘掉原生提示源（A 类清文本 / `title` 属性挪进暂存）；`data-tip` 本就不弹原生提示，无需摘 */
    const take = (src: TipSrc): void => {
      if (src.svgTitle) {
        src.svgTitle.textContent = ''
        return
      }
      if (src.from !== 'title') return
      src.el.setAttribute(TIP_STASH_ATTR, src.text)
      src.el.removeAttribute('title')
    }

    /** 把原生提示源原样放回并清掉观察器（`data-tip` 作者属性不留痕） */
    const putBack = (): void => {
      obs?.disconnect()
      obs = null
      const s = shown
      shown = null
      if (!s) return
      if (s.svgTitle) {
        // 展示期间 React 改写过文本 ⇒ `s.text` 已被观察器同步成新值，以新值为准
        if ((s.svgTitle.textContent ?? '') === '') s.svgTitle.textContent = s.text
        return
      }
      const stashed = s.el.getAttribute(TIP_STASH_ATTR)
      if (stashed === null) return
      s.el.removeAttribute(TIP_STASH_ATTR)
      // 只在元素当前没有 title 时放回（React 若已写新值，以新值为准）
      if (!s.el.hasAttribute('title')) s.el.setAttribute('title', stashed)
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
      if (performance.now() - hoveredAt < NATIVE_TIP_HOVER_MS) return
      const src = srcOf(el)
      if (!src || src.text.trim() === '') return
      const a = anchorOf(src.el)
      take(src)
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
          if (src.el.hasAttribute('title')) {
            src.el.setAttribute(TIP_STASH_ATTR, fresh)
            src.el.removeAttribute('title')
          }
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
      if (timer !== 0) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        maybeTake()
      }, NATIVE_TIP_HOVER_MS)
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
 * 其余属性（className 等）原样透传给该标签。tip 为纯文本；富内容请用 showTip。
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
    <Tag
      {...rest}
      onMouseEnter={(e: MouseEvent<HTMLElement>) => showTip(tip, e.clientX, e.clientY)}
      onMouseMove={(e: MouseEvent<HTMLElement>) => moveTip(tip, e.clientX, e.clientY)}
      onMouseLeave={() => hideTip()}
    >
      {children}
    </Tag>
  )
}
