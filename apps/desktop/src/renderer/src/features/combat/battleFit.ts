/**
 * **战场「装不下就整块等比缩放」**（2026-09-25 船长令 · 方案甲＋乙；**2026-09-26 改成只缩战场**）。
 *
 * 为什么要有这一层（船长报障「战斗画面被压成一条」的读数结论，详见
 * `docs/design/battle-ui-opt-20260926.md` §一）：
 * - 手机竖屏会走「旋转＋按宽缩放」，逻辑空间被机型宽高比锁死（1200×约 540~555px）；
 * - 而战斗界面内部按桌面版式要 **约 700px**（顶栏 69 ＋ 距离尺 89 ＋ 战场 353 ＋ 底栏 191）；
 * - 舞台与车道各自 `overflow: hidden` ⇒ 硬裁会把两排血条整条裁掉。
 *
 * ⚠ **2026-09-26 改判（本批）**：原来是**整屏**等比缩放（顶栏/战场/底栏一起缩）⇒ 手机上叠上旋转那层
 * 0.703 以后，字与按钮一起被缩到 ≈×0.55：13px 的字只剩 ≈7.2 物理 px、战术键高 ≈21 物理 px
 * （触屏下限 24、原生惯例 44）——即"能看全，但看不清也点不准"。
 * 现改成 **只缩战场**（`.app-bts-stage` 内的 `.app-bts-stage-fit`）：
 * - **顶栏与底栏保持 1:1 逻辑尺寸**（下面的手机版式再把字号/触控抬到可读可点）；
 * - **战场（距离尺 ＋ 车道）** 拿到"剩下的高度"作预算，按 `k = min(1, 预算 ÷ 内容高)` 缩
 *   ⇒ 舰船图形略小，但读数与操作不再跟着缩。
 *
 * 量尺寸一律用 `offsetHeight / clientHeight / scrollHeight`（**不受 transform 影响**）⇒ 无自激循环；
 * 只盯外层（`ResizeObserver`），被缩的那层自身不盯（它的高是本层给的，盯了会自激）。
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * 只缩不放的缩放系数：`k = min(1, 可用高 / 内容自然高)`。
 * 任一边量不到（0 / NaN）时按 1 处理 —— 宁可维持现状，也不要把战场缩没。
 */
export function fitScale(avail: number, need: number): number {
  if (!Number.isFinite(avail) || !Number.isFinite(need) || avail <= 0 || need <= 0) return 1
  const k = avail / need
  return k >= 1 ? 1 : k
}

export interface BattleFitRefs {
  /** `.app-battle-screen`（整屏覆盖层）—— 标记 `is-bts-fit`（缩了就不再让整屏滚动） */
  screen: RefObject<HTMLElement | null>
  /** `.app-bts-stage`（战场外层）—— 它的 `clientHeight` 就是"预算"（屏高 − 顶栏 − 底栏） */
  stage: RefObject<HTMLElement | null>
  /** `.app-bts-stage-fit`（战场内层）—— 量「内容自然高」并承接缩放 */
  fit: RefObject<HTMLElement | null>
  /** `.app-bts-lane`（战场车道）—— 量它自己声明的内容高 */
  lane: RefObject<HTMLElement | null>
}

/** 读数指纹：没变就一个字节都不写（战斗界面按引擎节拍重渲染，避免每拍抖一次样式） */
interface Stamp {
  lane: number
  laneBox: number
  avail: number
  top: number
  dock: number
  k: number
  need: number
}

export function useBattleFit(refs: BattleFitRefs): void {
  const last = useRef<Stamp | null>(null)

  const apply = useCallback((): void => {
    const screen = refs.screen.current
    const stage = refs.stage.current
    const fit = refs.fit.current
    const lane = refs.lane.current
    if (!screen || !stage || !fit || !lane) return

    // ① 量「车道的纯内容高」：临时摘掉 flex 拉伸与最小高，让盒子回到内容大小 —— 这样量到的
    //    scrollHeight 与"我们上一拍写进去的最小高"无关 ⇒ **不会自激振荡**
    //    （直接拿 scrollHeight 比 clientHeight 会：写 353 → 盒高变 353 → scrollHeight 也是 353
    //     → 判成"不用抬" → 又掉回 210 …… 这是实测踩过的坑）。
    //    ⚠ 血条是绝对定位挂在舰影下沿的，所以要用 scrollHeight（含绝对定位溢出），不能用 offsetHeight。
    const keepMin = lane.style.minHeight
    const keepFlex = lane.style.flex
    lane.style.minHeight = '0px'
    lane.style.flex = '0 0 auto'
    const laneNeed = lane.scrollHeight
    lane.style.minHeight = keepMin
    lane.style.flex = keepFlex
    // 车道拿到「自己声明的高度」⇒ 不再裁自己的两排血条（桌面本来比内容高，这里不改变观感）
    if (laneNeed > 0 && lane.style.minHeight !== `${laneNeed}px`) lane.style.minHeight = `${laneNeed}px`

    // ② 量战场内层的「内容自然高」（距离尺 ＋ 车道）：临时交回内容撑（同拍还原，不上屏）。
    //    ⚠ 它同时是**弹性子项**（`flex: 1 1 auto`）⇒ 只把 height 设成 auto 量到的仍是"分配高"，
    //       必须连 flex 一起摘掉，量到的才是**内容高**（这是本轮第一版踩的坑：need 量成 302、
    //       于是判定"装得下"、实际裁掉 134px）。
    const keepH = fit.style.height
    const keepT = fit.style.transform
    const keepFitFlex = fit.style.flex
    fit.style.flex = '0 0 auto'
    fit.style.height = 'auto'
    fit.style.transform = 'none'
    const need = fit.offsetHeight
    fit.style.height = keepH
    fit.style.transform = keepT
    fit.style.flex = keepFitFlex

    // ③ 只缩不放：**预算 = 战场外层自己的高**（= 屏高 − 顶栏 − 底栏，flex 分配的结果）
    const avail = stage.clientHeight
    const k = fitScale(avail, need)
    const topEl = screen.querySelector('.app-battle-screen-top')
    const dockEl = screen.querySelector('.app-bts-dock')
    const stamp: Stamp = {
      lane: laneNeed,
      laneBox: lane.clientHeight,
      avail,
      top: topEl?.clientHeight ?? 0,
      dock: dockEl?.clientHeight ?? 0,
      k,
      need,
    }
    const prev = last.current
    if (
      prev &&
      prev.lane === stamp.lane &&
      prev.laneBox === stamp.laneBox &&
      prev.avail === stamp.avail &&
      prev.top === stamp.top &&
      prev.dock === stamp.dock &&
      Math.abs(prev.k - stamp.k) < 0.0005
    ) {
      return
    }
    last.current = stamp

    if (k >= 1) {
      fit.style.height = '100%'
      fit.style.transform = 'none'
    } else {
      fit.style.height = `${need}px`
      fit.style.transform = `scale(${k})`
    }
    // 真缩了 ⇒ 整屏不再需要滚动（战场已等比缩进剩余高度）
    screen.classList.toggle('is-bts-fit', k < 1)
    // 读数落在 data-* 上，探针与「桌面零改动」对照都读它
    fit.dataset.btsK = k.toFixed(4)
    fit.dataset.btsNeed = String(need)
    fit.dataset.btsAvail = String(avail)
  }, [refs.screen, refs.stage, refs.fit, refs.lane])

  // 每次渲染后重算（战斗界面按引擎节拍重渲染；读数没变时不动 DOM）
  useLayoutEffect(() => {
    apply()
  })

  // 可用区尺寸变化（窗口/手机视口变化不触发 React 重渲染）也要重算
  useLayoutEffect(() => {
    const el = refs.stage.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [apply, refs.stage])
}
