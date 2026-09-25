/**
 * **战场「装不下就整块等比缩放」**（2026-09-25 船长令 · 方案甲＋乙）。
 *
 * 为什么要有这一层（船长报障「战斗画面被压成一条」的读数结论，详见
 * `docs/design/mobile-battle-fit-20260925.md`）：
 * - 手机竖屏会走「旋转＋按宽缩放」，逻辑空间被机型宽高比锁死（1200×约 540~555px）；
 * - 而战斗界面内部按桌面版式要 **约 700px**（顶栏 69 ＋ 距离尺 89 ＋ 战场 353 ＋ 底栏 191），
 *   其中战场那 353px 是它**自己声明的内容高**（两排舰影 ＋ 两排血条），
 *   可手机路径的历史规则把车道最小高压到了 210px（2026-09-06「舞台最小高下调给操作区让位」）
 *   ⇒ 舞台与车道各自 `overflow: hidden`，把血条整条裁掉。
 * - 2026-09-22 那套「窗口壳：固定设计尺寸 ＋ 装不下整块等比缩放」曾解决过同类问题，
 *   但同一天按船长令「界面回滚，战斗界面回滚到全屏显示」被一起撤掉了 ⇒ 手机上只剩硬裁。
 *
 * 本模块干三件事（**只缩不放**）：
 * 1. **车道先拿到自己声明的高度**：内容比最小高还高时，把它的 `min-height` 抬到内容高
 *    （手机上 210 → 353）⇒ 车道不再裁自己的血条；桌面车道本来就比内容高，这一条不触发。
 * 2. **量「内容自然高」**：把包裹层临时交回内容撑（`height: auto` 读一次 `offsetHeight`，
 *    同一拍内还原、不上屏），得到 `need`。
 * 3. **算缩放系数**：`k = min(1, 可用高 / need)`。`k = 1` ⇒ 高度 100% ＋ 不加 `transform`，
 *    **与改造前逐像素一致**（桌面宽窗口恒为这一支）；`k < 1` ⇒ 高度取 `need`、整块
 *    `transform: scale(k)`（`transform-origin: top center`），缩完正好铺满可用高。
 *
 * 量尺寸一律用 `offsetHeight / clientHeight / scrollHeight`（**不受 transform 影响**）⇒ 无自激循环；
 * 只盯外层可用区（`ResizeObserver`），舞台自身不盯（它的高是本层给的，盯了会自激）。
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
  /** `.app-battle-screen`（整屏覆盖层）—— 量「可用高」 */
  screen: RefObject<HTMLElement | null>
  /** `.app-battle-fit`（新增的包裹层）—— 量「内容自然高」并承接缩放 */
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
    const fit = refs.fit.current
    const lane = refs.lane.current
    if (!screen || !fit || !lane) return

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

    // ② 量内容自然高：临时交回内容撑（同拍还原，不上屏）
    const keepH = fit.style.height
    const keepT = fit.style.transform
    fit.style.height = 'auto'
    fit.style.transform = 'none'
    const need = fit.offsetHeight
    fit.style.height = keepH
    fit.style.transform = keepT

    // ③ 只缩不放
    const avail = screen.clientHeight
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
    // 真缩了 ⇒ 整屏不再需要滚动（内容已等比缩进可用高度）
    screen.classList.toggle('is-bts-fit', k < 1)
    // 读数落在 data-* 上，探针与「桌面零改动」对照都读它
    fit.dataset.btsK = k.toFixed(4)
    fit.dataset.btsNeed = String(need)
    fit.dataset.btsAvail = String(avail)
  }, [refs.screen, refs.fit, refs.lane])

  // 每次渲染后重算（战斗界面按引擎节拍重渲染；读数没变时不动 DOM）
  useLayoutEffect(() => {
    apply()
  })

  // 可用区尺寸变化（窗口/手机视口变化不触发 React 重渲染）也要重算
  useLayoutEffect(() => {
    const el = refs.screen.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [apply, refs.screen])
}
