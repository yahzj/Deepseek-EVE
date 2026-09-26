/**
 * **会话级页面视图记忆**（2026-09-26 船长令）。
 *
 * 船长原话（照抄）：「**我希望舰船、技能、工业、任务中心、通讯这几个导航栏页面，能记住玩家上次
 * 选择的子页面和滚动条位置。在本次游戏启动期间记忆，不入存档。**」
 *
 * ── 为什么必须有这个单点 ────────────────────────────────────────────────
 * 六个一级页都是**条件渲染**（`App.tsx` 里 `{page === 'xxx' ? <X /> : null}`）⇒ 玩家一切走就**卸载**，
 * 页面自己的 `useState`（子页签）与 DOM 的 `scrollTop`（滚动位置）**一起消失**，切回来必然回到默认值。
 * ⇒ 状态必须活在页面之外。本模块就是那个"外面"：
 *
 * · **两份模块级 `Map`** —— 活到**本进程结束**：刷新页面 / 重开 App 即清空；
 * · **不进存档、不写 localStorage**（船长明确「本次游戏启动期间记忆，不入存档」）；
 *   为什么不用 localStorage：那是跨启动记忆，与本条令的"本次启动"相反；存档更不行 ——
 *   这是纯界面状态、与存档结构无关，按约定「随档字段两处落笔」的红线也不该牵扯进来。
 *
 * ── 两条边界（照设计总结）────────────────────────────────────────────
 * 1. **每个子页签各记各的**：键里带子页签（见各调用点的键式），在技能树滚到中间 → 切「战斗」→
 *    切回「工程」应回到原位置，而不是共用一个位置；
 * 2. **对不上就夹紧**：内容变短（船卖了 / 信读了 / 换了大类）时旧值可能超出可滚范围，浏览器自己
 *    夹紧 ⇒ 不报错、不跳顶（本模块不干预，只如实写回）。
 *
 * ⚠ **登录界面/切页不算换页**：本模块只在**卸载**时保留、**挂载**时恢复，页面在被切走期间
 * 不产生任何写入 ⇒ 窗口尺寸变化、旋转、切导航再切回来都不会污染位置。
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

/** 子页签等"玩家上次的选择"（字符串键 ⇒ 字符串值；缺省即"没选过"，由调用点给默认值） */
const PICK = new Map<string, string>()
/** 滚动位置（像素；按 key 分条，键式见各调用点） */
const SCROLL = new Map<string, number>()

/** 读一个会话级选择（没记过返回 `null`，由调用点决定默认值） */
export function sessionPick(key: string): string | null {
  const v = PICK.get(key)
  return v === undefined ? null : v
}

/** 写一个会话级选择（`null` = 清除这条记忆） */
export function setSessionPick(key: string, value: string | null): void {
  if (value === null) PICK.delete(key)
  else PICK.set(key, value)
}

/** 读一个会话级滚动位置（没记过返回 `null`） */
export function sessionScroll(key: string): number | null {
  const v = SCROLL.get(key)
  return v === undefined ? null : v
}

/** 写一个会话级滚动位置（负数按 0 记；`null` = 清除） */
export function setSessionScroll(key: string, top: number | null): void {
  if (top === null) SCROLL.delete(key)
  else SCROLL.set(key, Math.max(0, Math.round(top)))
}

/**
 * **给一个滚动容器接上"挂载恢复 + 滚动即记"**。
 *
 * 用法：`const ref = useSessionScroll('ship.fleet', scrollRef)` —— 注意它**不创建** ref，
 * 而是**接手**调用点已有的那个（ShipPage 那支 ref 还兼着"量列宽"的活，必须共用同一个节点）。
 *
 * `ref` 为 `null`（页面没渲染那个容器）时本钩子什么都不做 —— 条件渲染下这是常态，不是错误。
 * `active` 给"同一个容器承载多种视图"的场合（技能页树视图/书视图共用一支滚动容器）：
 * 取 `false` 时本钩子让位，由当前视图的那一份实例负责读写（见 `SkillsTreePage`）。
 */
export function useSessionScroll(
  key: string,
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  /**
   * ⚠ **只读一次**（`useRef` 惰性初始化）：`active` 为 `false` 期间不读、也不覆盖它 ⇒
   * 切视图回来时用的仍是"离开那个视图时"的位置，而不是被另一个视图的位置顶掉。
   */
  const restoreTo = useRef<number | null>(sessionScroll(key))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    // 恢复走**布局阶段**（绘制前）：先设 `scrollTop` 再量宽，避免"先按未滚动状态量一次"的闪烁
    const want = restoreTo.current
    if (want !== null && want > 0) el.scrollTop = want
    /**
     * 写回时机：每次滚动（含玩家滚轮/拖动条/键盘）＋ **卸载那一刻**。
     * 卸载时 `scrollTop` 仍可读（DOM 节点此刻还在）⇒ 页面被切走的瞬间把最后位置存下来。
     */
    const save = (): void => setSessionScroll(key, el.scrollTop)
    el.addEventListener('scroll', save, { passive: true })
    return () => {
      el.removeEventListener('scroll', save)
      save()
    }
  }, [key, ref, active])
}

/** "能滚吗"：`overflow-y` 为 auto/scroll 且内容确实超出时才算 */
function scrollableIn(el: HTMLElement): HTMLElement | null {
  const oy = getComputedStyle(el).overflowY
  if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) return el
  return null
}

/**
 * **从一支已知容器反查它"真正会滚"的那一层**，再套 `useSessionScroll`。
 *
 * 为什么需要它：本仓的二级窗布局是"**固定头 ＋ 内滚体**"，内滚体常常不在页面直接掌控里 ——
 * 技能页/工业页的主列表就是 `Panel` 自带的 `div.wui-panel-body`（`overflow:auto` 写死在共用件里）。
 * 页面对应位置**包一层 div** 传进来即可，不必为了记位置去改共用件的结构。
 *
 * 查找顺序（命中即用；都不命中 ⇒ 什么都不做，条件渲染下这是常态）：
 * ① 自己 ② 自己的祖先（`html > body > div` 止）③ 自己的后代（容器全都不滚、由更内层滚动时）。
 */
export function useSessionScrollFrom(key: string, ref: RefObject<HTMLElement | null>): void {
  const target = useRef<HTMLElement | null>(null)
  const restoreTo = useRef<number | null>(sessionScroll(key))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // ① 自己就是滚动体（如技能页树视图的书单、通讯页信件列表）
    let t = scrollableIn(el)
    // ② 祖先就是那个"内滚体"（技能页/工业页的主列表 = `Panel` 的 `.wui-panel-body`）
    const ancestor = el.closest('.wui-panel-body, .app-win-body') as HTMLElement | null
    if (!t && ancestor) t = scrollableIn(ancestor) ?? ancestor
    // ③ 容器全都不滚、由更内层滚动（极端情形兜底）
    if (!t) t = Array.from(el.querySelectorAll<HTMLElement>('*')).find((n) => scrollableIn(n) !== null) ?? null
    if (!t) return
    target.current = t
    const want = restoreTo.current
    if (want !== null && want > 0) t.scrollTop = want
    const save = (): void => setSessionScroll(key, t.scrollTop)
    t.addEventListener('scroll', save, { passive: true })
    return () => {
      t.removeEventListener('scroll', save)
      save()
    }
  }, [key, ref])
}
