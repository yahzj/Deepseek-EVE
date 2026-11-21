import { useId } from 'react'
import type { ShipRole } from '@whale/core'
import { ShipSpriteShape, shipArtSizeOf } from './ShipSprite'

const VB_W = 380
const VB_H = 190
const BEAM_Y = 48
const BEAM_HALF = 150
const ARCH_X = [-96, 0, 96] as const
const SHIP_W_BASE = 230
const TIER_SCALE: Record<number, number> = { 1: 0.7, 2: 0.81, 3: 1, 4: 1.15, 5: 1.32 }

function shipDisplayWidthOf(tier: number | undefined): number {
  return Math.round(SHIP_W_BASE * (TIER_SCALE[tier ?? 3] ?? 1))
}
const DRONE_TRAVEL = 60

export function DryDockFx({
  progress,
  shipId,
  role,
  tier,
}: {
  progress: number
  shipId: string
  role?: ShipRole
  tier?: number
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, progress))
  const art = shipArtSizeOf(shipId)
  const shipW = shipDisplayWidthOf(tier)
  const shipVp = { x: VB_W / 2 - art.w / 2, y: VB_H / 2 - art.h / 2, w: art.w, h: art.h }
  const clipX = -shipVp.w / 2 - 1
  const clipW = Math.max(1, shipVp.w * pct + 2)


  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const maskId = `hud-dock-progress-mask-${uid}`
  const gradId = `hud-dock-progress-grad-${uid}`
  const hullMaskId = `hud-dock-hull-mask-${uid}`

  const edge = Math.max(0.0001, Math.min(1, pct))
  const gradFrom = Math.max(0, edge - 0.009)

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        {/* 船体区域遮罩：白色＝保留、黑色＝抹掉；椭圆形状取船体的横长比（不可见，只影响被遮罩的元素） */}
        <mask id={hullMaskId} maskUnits="userSpaceOnUse" x={0} y={0} width={VB_W} height={VB_H}>
          <rect x="0" y="0" width={VB_W} height={VB_H} fill="#fff" />
          <rect
            x={VB_W / 2 - shipW / 2}
            y={VB_H / 2 - (shipW * (art.h / art.w)) / 2}
            width={shipW}
            height={shipW * (art.h / art.w)}
            fill="#000"
          />
        </mask>
      </defs>
      {/* ── 坞体：两条纵向主梁（±48）＋ 三道桁架拱 ＋ 端环（两头开口，没有坞门）── */}
      <path d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 - BEAM_Y} H${VB_W / 2 + BEAM_HALF}`} />
      <path d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 + BEAM_Y} H${VB_W / 2 + BEAM_HALF}`} />
      {/**
        * **三道桁架拱（菱形）拆成两半画**（**2026-10-01 船长令**：「我想做一个立体效果，棱的左侧在舰船
        * 前面，右侧在舰船后面的话，就像是舰船穿过棱形，更有立体感」）：
        * - **右半**（上顶点 → 右顶点 → 下顶点）在**舰船之前**画 ⇒ 落在船体后面；
        * - **左半**（上顶点 → 左顶点 → 下顶点）挪到**舰船之后**画 ⇒ 压在船体前面；
        * ⇒ 船看起来是从这三道框里**穿过去**的（同一个菱形，一半在前一半在后）。
        */}
      {/**
        * **舰船"不透明"用遮罩实现**（**2026-10-01 船长令**：「能否让船坞的舰船中间是不透明的」）：
        * 起初试过"在船体处铺一层底色填充"，三版截图都不行（椭圆总会显形成一团阴影盘）。
        * 改成把**后半菱形**用 `hud-dock-hull-mask` 遮罩掉船体范围内的部分 —— 遮罩本身**不可见**，
        * 效果就是"后方线条在船体处被挡住"，同时船体自己的线条完整保留。
        */}
      {ARCH_X.map((dx) => (
        <path
          key={`arch-back-${dx}`}
          className="hud-dock-arch-back"
          mask={`url(#${hullMaskId})`}
          d={`M${VB_W / 2 + dx} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 + dx + 14} ${VB_H / 2} L${VB_W / 2 + dx} ${VB_H / 2 + BEAM_Y}`}
        />
      ))}
      {/* 端环（两头是开口的桁架环） */}
      <path
        d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 - BEAM_HALF - 16} ${VB_H / 2} L${VB_W / 2 - BEAM_HALF} ${VB_H / 2 + BEAM_Y}`}
        opacity="0.6"
      />
      <path
        d={`M${VB_W / 2 + BEAM_HALF} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 + BEAM_HALF + 16} ${VB_H / 2} L${VB_W / 2 + BEAM_HALF} ${VB_H / 2 + BEAM_Y}`}
        opacity="0.6"
      />
      {/* 梁间横向联系 */}
      {ARCH_X.map((dx) => (
        <g key={`tie-${dx}`} opacity="0.3">
          <path d={`M${VB_W / 2 + dx - 14} ${VB_H / 2 - BEAM_Y} V${VB_H / 2 - BEAM_Y + 10}`} />
          <path d={`M${VB_W / 2 + dx - 14} ${VB_H / 2 + BEAM_Y} V${VB_H / 2 + BEAM_Y - 10}`} />
        </g>
      ))}

      {/* ── 系留臂（4 条；端点与船体留 6px 空隙 ⇒ 船是被"拉住"、不是被"托住"）── */}
      {([
        [-70, -1],
        [70, -1],
        [-70, 1],
        [70, 1],
      ] as const).map(([dx, sign]) => {
        const x = VB_W / 2 + dx
        const y1 = VB_H / 2 + sign * BEAM_Y
        // 端点跟**舰体实际显示高度**走（船大 ⇒ 臂端点外移）
        const y2 = VB_H / 2 + sign * ((shipW * (art.h / art.w)) / 2 + 6)
        return (
          <g key={`tether-${dx}-${sign}`} opacity="0.7">
            <path d={`M${x} ${y1} L${x} ${y2}`} />
            <circle cx={x} cy={y2} r="1.6" opacity="0.85" />
          </g>
        )
      })}

      {/* ── 坞内的在建舰：真实线稿 ＋ 按进度逐段显影（船尾 → 船头）── */}
      <svg
        className="hud-dock-craft"
        x={shipVp.x}
        y={shipVp.y}
        width={shipVp.w}
        height={shipVp.h}
        viewBox={`${-shipVp.w / 2} ${-shipVp.h / 2} ${shipVp.w} ${shipVp.h}`}
        color="var(--hud-accent-soft)"
        overflow="visible"
      >
        <defs>
          {/* 硬边渐变：从"已成形"到"未成形"只跨 0.9% ⇒ 分界线清楚，且**上下同一条线** */}
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset={gradFrom} stopColor="#fff" stopOpacity="1" />
            <stop offset={edge} stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* mask 的坐标口径与舰形一致（同在舰形画布内）⇒ 不会出现"只切到一半" */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-shipVp.w / 2} y={-shipVp.h / 2} width={shipVp.w} height={shipVp.h}>
            <rect x={-shipVp.w / 2} y={-shipVp.h / 2} width={shipVp.w} height={shipVp.h} fill={`url(#${gradId})`} />
          </mask>
        </defs>
        {/* **舰船本体不透明**（**2026-10-01 船长令**：「能否让船坞的舰船中间是不透明的」）：
            先在舰形**线条之前**铺一层与坞景底色同色的填充 —— 后方（右半菱形等）线条被真正盖住，
            立体感不再依赖"线稿透光"的视觉习惯。颜色取坞景深色底，不引入新色值。 */}
        {/* ⚠ 实测第一版过大过暗（截图里像扣了个阴影盘）：改成**基本贴合舰形画布**的椭圆、
            颜色取坞景最深底、略留透光 ⇒ 只"压掉"后方线条，不喧宾夺主。 */}
        {/* ⚠ 两版实测（截图对比）：太大 ⇒ 像"扣了个阴影盘"；本版**收到船体横向范围内**、
            再用略低的透明度，只做"挡住后方线条"这一件事。 */}
        {/* 未来段：整条淡淡描一遍（让玩家看出还差多少），再叠上已成形的这一段 */}
        <g opacity="0.14">
          <ShipSpriteShape shipId={shipId} role={role} size={shipW} />
        </g>
        <g mask={`url(#${maskId})`}>
          <ShipSpriteShape shipId={shipId} role={role} size={shipW} />
        </g>
      </svg>

      {/* 桁架拱的**左半**（前层）：压在船体之上 ⇒ 与前面那半合起来就是"船穿过菱形框"的立体感 */}
      {ARCH_X.map((dx) => (
        <path
          key={`arch-front-${dx}`}
          className="hud-dock-arch-front"
          d={`M${VB_W / 2 + dx} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 + dx - 14} ${VB_H / 2} L${VB_W / 2 + dx} ${VB_H / 2 + BEAM_Y}`}
        />
      ))}
      {/* ── 二段式焊接机械臂（**2026-10-01 船长令**：「机械臂不用让它移动」）──
          **固定在一处、原地做二段屈伸焊接**（不再沿船体移动）；定位直接写在这一个 `<g>` 上
          （没有 CSS 动画来写 transform ⇒ 不会被覆盖）。 */}
      <g transform={`translate(${VB_W / 2} ${VB_H / 2 + BEAM_Y - 6})`}>
        <g className="hud-dock-arm2">
          <path d="M0 0 L-16 -12" opacity="0.85" />
          <g className="hud-dock-armseg">
            <path d="M-16 -12 L-30 -22" opacity="0.85" />
          </g>
          <g transform="translate(-30 -22)">
            <g className="hud-dock-weldwrap">
              <circle className="hud-dock-weld" cx="0" cy="0" r="2.1" />
              <path className="hud-dock-spark-ray" d="M0 0 L-3.7 -2.1" />
              <path className="hud-dock-spark-ray is-2" d="M0 0 L-4.2 0.4" />
              <path className="hud-dock-spark-ray is-3" d="M0 0 L-3.2 2.3" />
            </g>
          </g>
        </g>
      </g>

      {/* ── 焊接无人机 ×2：飞到一端 → 停下焊 → 飞到另一端 → 停下焊 ──
          三层分工：外层**定位**（属性）· 中层 `--vx` **飞行位移**（CSS）· 内层 `scaleX(±1)` **转向**（CSS）。 */}
      {[
        { y: VB_H / 2 - 34, late: false, up: true },
        { y: VB_H / 2 + 34, late: true, up: false },
      ].map((d) => (
        <g key={`drone-${d.late}`} transform={`translate(${VB_W / 2} ${d.y})`}>
          <g
            className={`hud-dock-drone${d.late ? ' is-late' : ''}`}
            style={{ ['--vx' as string]: `${DRONE_TRAVEL}px` }}
          >
            <g className="hud-dock-drone-turn">
              <g className="hud-dock-drone-body">
                <rect x="-7" y="-2.5" width="14" height="5" rx="1.5" />
                <path d="M-9 -2.5 H9 M-9 2.5 H9" opacity="0.7" />
                <path d={d.up ? 'M-4 -4.5 V-6.5 M4 -4.5 V-6.5' : 'M-4 4.5 V6.5 M4 4.5 V6.5'} opacity="0.6" />
                <g className="hud-dock-weldwrap">
                  <circle className="hud-dock-weld" cx="9.5" cy="0" r="2.1" />
                  <path className="hud-dock-spark-ray" d="M9.5 0 L13.2 -2.1" />
                  <path className="hud-dock-spark-ray is-2" d="M9.5 0 L14 0.4" />
                  <path className="hud-dock-spark-ray is-3" d="M9.5 0 L13 2.3" />
                  <path className="hud-dock-spark-ray is-4" d="M9.5 0 L11.6 -3.1" />
                  <path className="hud-dock-spark-ray is-5" d="M9.5 0 L11.4 3" />
                </g>
              </g>
            </g>
          </g>
        </g>
      ))}

      {/* 焊点（两处，错相位闪）——跟着显影前沿走 */}
      <circle className="hud-dock-spark" cx={VB_W / 2 + (clipX + clipW) * (shipW / shipVp.w)} cy={VB_H / 2 - 15} r="2" />
      <circle className="hud-dock-spark is-late" cx={VB_W / 2 + (clipX + clipW * 0.7) * (shipW / shipVp.w)} cy={VB_H / 2 + 19} r="1.7" />
      {/* 坞体航行灯（缓慢呼吸） */}
      <path
        className="hud-dock-beacon"
        d={
          `M${VB_W / 2 - BEAM_HALF - 6} ${VB_H / 2 - BEAM_Y - 3} h8 ` +
          `M${VB_W / 2 + BEAM_HALF - 2} ${VB_H / 2 - BEAM_Y - 3} h8 ` +
          `M${VB_W / 2 - BEAM_HALF - 6} ${VB_H / 2 + BEAM_Y + 3} h8 ` +
          `M${VB_W / 2 + BEAM_HALF - 2} ${VB_H / 2 + BEAM_Y + 3} h8`
        }
        opacity="0.6"
      />
    </svg>
  )
}
