/**
 * **金钱栏 · 宽度自适应金额**（2026-09-13 船长二次口径：「**如果有条件，还是优先显示全额数字**。
 * 可以考虑调整字间距宽。如果实在显示不下，采用数量级缩写（**但是仍要尽可能保证数字够长**）」）。
 *
 * 口径（三条，按优先级 —— 候选序列由 `core/money.ts` 的 `moneyFitCandidates` 给出）：
 * 1. **优先全额**：`1,234,567` 这种一位不省地显示（千分位照写）；
 * 2. **实在显示不下才缩写**：缩写档**逐级降级**，先只减小数位（`1.23 亿` → `1.2 亿` → `1 亿`，
 *    **有效数字一位不丢**），最后才降单位（`万` 档）；
 * 3. **精确值永远可查**：`title` 恒挂全精度（全站 `title` 走自绘提示层），缩写不损失信息。
 *
 * ⚠ **"单位"是第一个可以让位的东西**：`1,234,567,890 信用点` 装不下时，先试**去掉「信用点」的全额**
 * （数字一位不少），而不是直接跳 `12.35 亿 信用点` —— 船长要的是"能显全额就显全额"，
 * 多出来的有效数字比重复一遍单位名值钱，单位由 `title` 兜住。**要翻成"单位优先"，改 `moneyFitCandidates` 的档序即可。**
 *
 * 怎么"实测"：容器里放一个**不可见**的测量用 `<span>`（与正文同字体/同字号/同字距），
 * 逐候选写入并读 `scrollWidth`，取**第一个不溢出**的；容器宽度变化用 `ResizeObserver` 重算
 * （窗口缩放/侧栏宽度调整都能跟上）。测量本身**不产生可见布局变化**（绝对定位 + `visibility: hidden`）。
 *
 * 为什么不用纯 CSS（`text-overflow: ellipsis`）：那会把数字**从中间截断**（`1,234,5…`），
 * 船长要的是"**够长且完整可读**"——宁可换成 `1.23 亿`，也不要 `1,234,5…`（`ellipsis` 只当最后一道保险）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { moneyExactText, moneyFitCandidates } from '@whale/core'
import { tr } from '../i18n/locale'

/** 测量用的样式：与正文完全同源（字体/字号/字距/字重都由 `inherit` 从容器继承） */
const PROBE_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  // 不参与布局，也不被父级 overflow 裁掉（scrollWidth 才准）
  contain: 'layout style',
}

/**
 * **同一套自适应读数、换一个单位词**（**2026-09-29 船长令**：「在钱包的右侧，新增一个容器显示玩家的声望」）。
 *
 * 为什么给 `MoneyFit` 加这个口子而不另写一份：这份"逐候选实测宽度"的机制与坑（`clientWidth` 含内边距、
 * 亚像素 ±1 容错、`ResizeObserver` 复量、字体加载后补量）全部与金额那份相同 —— 复制一份必然漂。
 * 声望与金额的差别**只有单位词**：`moneyFitCandidates` 把它写死成「信用点 / ISK」，
 * 所以这里传 `unit` 时**跳过单位档**（只用数字档），单位词由调用方用当前语言给。
 *
 * `exact`：`title` 里那句"全精度"文案（默认沿用钱包那句「钱包余额：…」；
 * 声望这类非金额读数**必须显式换**，否则提示会说"信用点"）。
 */
export function MoneyFit({
  amount,
  className,
  unit,
  exact,
}: {
  amount: number
  className?: string
  /** 单位词（给 ⇒ **只用数字档**、单位由调用方渲染；不给 ⇒ 沿用金额那套「信用点」档） */
  unit?: string
  /** `title` 文案（给 ⇒ 用它；不给 ⇒ 钱包那句） */
  exact?: string
}) {
  const boxRef = useRef<HTMLSpanElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const [text, setText] = useState(() => moneyExactText(amount))

  /** 逐候选试宽：返回第一个装得下的（都装不下就取最短的那个） */
  const pick = (): void => {
    const box = boxRef.current
    const probe = probeRef.current
    if (!box || !probe) return
    // ⚠ `clientWidth` **含左右内边距**（它是 padding box 的宽），必须减掉才是能放字的宽度，
    // 否则判断会宽出 2×8px ⇒ 挑中的候选照样被裁（这条是读代码抓出来的，不是估的）。
    const cs = getComputedStyle(box)
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const avail = box.clientWidth - padX
    if (avail <= 0) return
    /**
     * 候选来源：给 `unit` ⇒ 取数字档（剥掉原有的单位词，含"万/亿"缩写里的数量级词保留）
     * ——`moneyFitCandidates` 的档位里单位词是尾缀，按长度排的次序不受影响。
     */
    const cands = unit === undefined ? moneyFitCandidates(amount) : moneyFitCandidates(amount).map((c) => c.replace(/(信用点|ISK)$/, '').trim())
    let chosen = cands[cands.length - 1]!
    for (const c of cands) {
      probe.textContent = unit === undefined ? c : `${c} ${unit}`
      // +1 容错：亚像素取整/字体回退会让 scrollWidth 偶尔少 1px
      if (probe.scrollWidth <= avail + 1) {
        chosen = c
        break
      }
    }
    setText((prev) => (prev === chosen ? prev : chosen))
  }

  // 首帧就量（useLayoutEffect：在浏览器绘制前定稿，避免"先撑破再缩回"的闪动）
  useLayoutEffect(pick)
  // 依赖：数值变化 + 容器宽度变化（ResizeObserver）
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => pick())
    ro.observe(box)
    return () => ro.disconnect()
  }, [amount])
  // 字体加载完成后字宽会变（网页版首屏），补量一次
  useEffect(() => {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts
    if (fonts?.ready) void fonts.ready.then(() => pick())
  }, [amount])

  return (
    <span
      ref={boxRef}
      className={className}
      title={exact ?? tr("ui.MoneyFit.001", { p1: moneyExactText(amount) })}
    >
      {text}
      {unit !== undefined ? <span className="app-standing-key"> {unit}</span> : null}
      <span ref={probeRef} style={PROBE_STYLE} aria-hidden="true" />
    </span>
  )
}
