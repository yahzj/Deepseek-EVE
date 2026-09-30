/**
 * **竖直燃料罐**（**2026-09-30 船长令**：「**燃料罐的容量能否采用竖型的动态条**（内部需要有动画，
 * 液体条的顶部部分像真的液体一样波动，**燃料罐的外壳条有玻璃质感**）？并且**需要和主题配色的色表对接**」）。
 *
 * 三条实现口径：
 * 1. **形状一律 SVG**（仓库 §6：CSS 只许做背景氛围光效，不许拼形状）——罐体、颈口、刻度、玻璃高光、
 *    两层液面波都在这里画；CSS 那边只负责**波动动画**（动 SVG 内部元素的 `transform`）与布局；
 * 2. **配色派生自主题令牌**：液体 = `--wui-accent`（该主题的强调色）＋ 深处 `--wui-accent-deep`；
 *    空段 = `--wui-bg-track`；玻璃外壳 = `--wui-border-bright` ＋ 白色高光渐变；刻度/数字 = `--wui-text*`
 *    ⇒ 换主题整罐跟着换（七套主题各一份令牌，见 `packages/ui/src/index.css`）；
 * 3. **波动怎么做的**：罐内用一个 `clipPath` 裁出"内腔"，里面放**两条宽度 200% 的正弦波路径**
 *    （一条深、一条浅），分别以 3.6s / 5.4s **反向**横移 —— 错速 + 反向 ⇒ 液面看上去在**翻滚**；
 *    液位由外层 `<g>` 的 `translateY` 一次算好（`units / capacity`）。
 *    `prefers-reduced-motion` 与 `body.no-fx` 都会把动画停掉（静态液面，读数照旧）。
 */
import type { ReactNode } from 'react'

/** 一条正弦波路径（宽 = 罐内宽 × 2，便于横移 50% 无缝循环） */
function wavePath(width: number, height: number, amplitude: number): string {
  const seg = width / 4
  const mid = height / 2
  let d = `M0 ${mid}`
  for (let i = 0; i < 4; i++) {
    const x0 = i * seg
    d += ` Q${x0 + seg / 4} ${mid - amplitude} ${x0 + seg / 2} ${mid}`
    d += ` Q${x0 + (seg * 3) / 4} ${mid + amplitude} ${x0 + seg} ${mid}`
  }
  d += ` V${height + amplitude * 2} H0 Z`
  return d
}

export interface FuelTankProps {
  /** 当前库存（单位） */
  units: number
  /** 满格（单位）——刻度尺；缺省按"一趟长途"的 5 倍由调用方给 */
  capacity: number
  /** 罐身高度（px）——调用方量出可用高度后传进来（缺省 148） */
  height?: number
  /**
   * 罐身宽度（px）——缺省按高度的 0.46（细长罐形）。
   *
   * ⚠ **不要用 CSS 给罐子铺满父容器**（**2026-09-30 船长报障「燃料罐高度太低了」的真因**）：
   * SVG 一旦被 `width/height:100%` 撑开，`preserveAspectRatio` 就按**等比缩放到框内**解析 ——
   * 罐身 0.46 的宽高比 ＋ 罐列只有 84px 宽 ⇒ 实际画出来最高被卡在 `84 / 0.46 ≈ 182px`，
   * 无论如何加高容器都是这个高度。
   * 现在改成**由调用方量出宽高、组件按 1:1（`viewBox` = 实际像素）作画** ⇒ 想多高就多高、不变形。
   */
  width?: number
  /** 刻度提示：这些单位处画一条长刻度（例：一趟长途 ≈1,200 单位） */
  tickUnits?: number
  /** 无障碍名（读屏/悬停） */
  label: string
}

export function FuelTank({ units, capacity, height = 148, width, tickUnits, label }: FuelTankProps): ReactNode {
  /** 1:1 作画（见 `width` 的注释）：`W`/`H` 既是几何单位、也是实际像素，因此下夹两档防止退化成一条线 */
  const H = Math.max(80, Math.round(height))
  const W = Math.max(28, Math.round(width ?? H * 0.46))
  const padX = 7
  const padTop = 16
  const padBottom = 10
  const innerW = W - padX * 2
  const innerH = H - padTop - padBottom
  const ratio = capacity > 0 ? Math.max(0, Math.min(1, units / capacity)) : 0
  const filled = units > 0
  /** 液面 y（罐内坐标）：满 = 顶部 0 */
  const surfaceY = innerH * (1 - ratio)
  /**
   * 波层要"高出液面一截"再被内腔裁掉 ⇒ 把波层整体画在 `surfaceY - amp*2`，
   * 让波峰波谷都落在裁区里（否则波动会在液面处露出直边）。
   */
  const amp = 2.8
  const waveW = innerW * 2
  const waveH = innerH - surfaceY + amp * 3
  const d = wavePath(waveW, waveH, amp)
  const tickY = tickUnits !== undefined && capacity > 0 ? innerH * (1 - Math.min(1, tickUnits / capacity)) : undefined
  const uid = `ft${W}x${H}${Math.round(capacity)}`.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg
      className={`hud-tank${filled ? ' is-filled' : ''}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      /**
       * **波长位移量**（**2026-09-30 船长报障「液体动画的循环并不对齐」的修法**）：
       * 交给 CSS 的必须是**用户单位**（px = SVG 用户单位）且**正好 2 个波长**（= 波层自身宽度的一半），
       * 这样 `translateX(0 → -shift)` 结束时波形与起点逐点重合 ⇒ 无缝。
       * 若像原先那样写百分比，SVG 会按 viewBox 参考框解析 ⇒ 位移不是整数波长 ⇒ 每轮跳一下。
       * （几何核对：波层宽 = `innerW × 2`，内含 4 个整周期 ⇒ 1 周期 = `innerW / 2` ⇒ 2 周期 = `innerW`。）
       */
      style={{ ['--tank-shift' as string]: `-${innerW}px` }}
      role="img"
      aria-label={label}
    >
      <defs>
        {/* 玻璃：斜向高光（SVG 渐变 —— 不用 CSS 拼形状） */}
        <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.16" />
          <stop offset="38%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.04" />
          <stop offset="100%" stopColor="rgb(var(--wui-text-hi))" stopOpacity="0.10" />
        </linearGradient>
        {/* 液体：上浅下深（有厚度感） */}
        <linearGradient id={`${uid}-fuel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--wui-accent))" stopOpacity="0.92" />
          <stop offset="100%" stopColor="rgb(var(--wui-accent-deep))" stopOpacity="0.96" />
        </linearGradient>
        {/* 内腔：液体的裁剪区（罐内圆角矩形） */}
        <clipPath id={`${uid}-clip`}>
          <rect x={padX} y={padTop} width={innerW} height={innerH} rx="5" />
        </clipPath>
      </defs>

      {/* 罐体：空段底（轨道） */}
      <rect
        x={padX}
        y={padTop}
        width={innerW}
        height={innerH}
        rx="5"
        fill="rgb(var(--wui-bg-track))"
      />

      {/* 液体（被内腔裁剪）：两层错速波 ＋ 主体 */}
      <g clipPath={`url(#${uid}-clip)`}>
        <g transform={`translate(0 ${padTop + surfaceY - amp * 2})`}>
          <g className="wave-b">
            <path d={d} fill="rgb(var(--wui-accent))" opacity="0.30" />
          </g>
          <g className="wave-a">
            <path d={d} fill={`url(#${uid}-fuel)`} />
          </g>
        </g>
        {/* 液下微光（呼吸；空罐不亮） */}
        {filled ? (
          <ellipse
            className="glow"
            cx={W / 2}
            cy={padTop + innerH - 6}
            rx={innerW * 0.42}
            ry="6"
            fill="rgb(var(--wui-accent))"
            opacity="0.35"
          />
        ) : null}
      </g>

      {/* 玻璃外壳：描边 ＋ 高光 ＋ 颈口 ＋ 液面参考刻度 */}
      <rect
        x={padX}
        y={padTop}
        width={innerW}
        height={innerH}
        rx="5"
        fill={`url(#${uid}-glass)`}
        stroke="rgb(var(--wui-border-bright))"
        strokeWidth="1.2"
      />
      {/* 玻璃反光条（细线稿语言，不用 CSS 造形） */}
      <path
        d={`M${padX + 3.2} ${padTop + 6} V${padTop + innerH - 6}`}
        stroke="rgb(var(--wui-text-hi))"
        strokeOpacity="0.20"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* 颈口（罐盖） */}
      <path
        d={`M${W / 2 - 6.5} ${padTop} v-4.4 a1.6 1.6 0 0 1 1.6 -1.6 h9.8 a1.6 1.6 0 0 1 1.6 1.6 V${padTop}`}
        fill="none"
        stroke="rgb(var(--wui-border-bright))"
        strokeWidth="1.2"
      />
      {/* 刻度：四等分短发丝线 */}
      {[0.25, 0.5, 0.75].map((t) => (
        <path
          key={t}
          d={`M${padX + innerW - 5} ${padTop + innerH * t} h-4`}
          stroke="rgb(var(--wui-text-dim))"
          strokeOpacity="0.55"
          strokeWidth="1"
        />
      ))}
      {/* 「一趟长途」长刻度（有值时画；给玩家一个"够不够飞一趟"的参照） */}
      {tickY !== undefined ? (
        <path
          d={`M${padX} ${padTop + tickY} h${innerW}`}
          stroke="rgb(var(--wui-text-hi))"
          strokeOpacity="0.34"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ) : null}
    </svg>
  )
}
