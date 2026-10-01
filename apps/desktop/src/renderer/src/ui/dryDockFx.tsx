/**
 * **太空坞线稿**（**2026-10-01 船长令**：「造船厂的在建舰船，建议将扩大队列卡片的高度，将动画移动到卡片内的
 * 上方，并参考左上角 SVG 动画中的船坞，构建一个更大的船坞，舰船的 SVG 放在船坞中间（最好是建到一半的，
 * 少几根线条。）先照着这个做出一个效果」→「观感上，给人感觉像是一个房子的侧视图」→
 * 「你还要考虑到，这是太空坞，是无重力环境，不是放在地球上的。我们造的是飞船」→
 * 「能否将动画旋转90度，两条主梁可以离中间更近一些，然后按进度逐段显影，使用各舰真实线稿」）。
 *
 * ## 四版演进（每版都是被船长一句话推翻的，留档免得再犯）
 *
 * | 版本 | 船长判词 | 病根 |
 * |---|---|---|
 * | v1 | 像房子 | 两侧竖直矩形墙 ＋ 平屋顶跨梁 ⇒ 任何文化里都读作"房子" |
 * | v2 | **太空坞、无重力** | 抄了地球干船坞的形制：**坞墩托底**（托船重的）＋ **挖下去的地面线**（靠重力的船台） |
 * | v3 | **旋转 90° · 主梁靠近 · 按进度逐段显影** | 竖直停泊让"进度"只能自下而上读；主梁离得太开、笼子太散。本版：**水平停泊**（船头朝右）· 主梁各收到 ±48 · 坞内改用**各舰真实线稿**并按进度**从船尾向船头逐段显影** |
 *
 * ## 本版四条形态
 *
 * 1. **无重力**：不画地面线、坞槽、托架——坞体是悬在空间里的**开放式桁架笼**；飞船**不接触坞**，
 *    靠 **4 条系留臂**（端点留空隙）拉住，并**极缓慢悬浮漂移**（CSS `hud-dock-float`）；
 * 2. **水平停泊**（船长：旋转 90°）：船头朝右，沿坞的纵轴停泊；
 * 3. **主梁靠近中心**（船长）：两条纵向主梁＝中线上下各 **48**，三道桁架拱跨接两梁；
 * 4. **按进度逐段显影**（船长）：坞内画的是**该舰的真实线稿**（`ui/shipArt` 的 `SHIP_ART`，
 *    经 `ShipSpriteShape` 嵌入 —— 240×110、船头朝右，与全仓同一份资产），用 `clipPath` 把显影宽度
 *    从**船尾**推向**船头**：进度越高、线越多 —— 这才是"建到一半"的**真实**含义，
 *    不再靠"故意少画几根线"来假装。
 *
 * ## 纪律
 *
 * - 形状一律 SVG 线稿（`currentColor` ＋ 细描边；§6）；CSS 只负责氛围光与动效；
 * - 动效只碰 `transform` / `opacity`（飞船悬浮漂移 ＋ 焊点闪烁），`prefers-reduced-motion` 与玩家
 *   「关特效」（`body.no-fx`）下全停（§十四）；
 * - 纯展示件（`aria-hidden`），不参与交互；坞景高度由外层 `.hud-dock-art` 定死 ⇒ 卡片不跳动。
 */
import type { ShipRole } from '@whale/core'
import { ShipSpriteShape, shipArtSizeOf } from './ShipSprite'

/** 坞景画布（船长要的"更大的船坞"）：与 `.hud-dock-art` 的 190px 高同比例 */
const VB_W = 380
const VB_H = 190
/** 坞体两条纵向主梁的**半间距**（船长：「两条主梁可以离中间更近一些」⇒ 收到 ±48） */
const BEAM_Y = 48
/** 梁的半纵长（坞的开口范围；两端再各留一段端环） */
const BEAM_HALF = 150
/** 三道桁架拱沿纵轴的 x 偏移（两端各一道 ＋ 正中一道） */
const ARCH_X = [-96, 0, 96] as const
/** 舰体显示宽度（占坞长 ~62%，两端留给端环与系留臂） */
const SHIP_W = 230

export function DryDockFx({
  progress,
  shipId,
  role,
}: {
  /** 建造进度 0~1（`manufacturingRunViews` 的 `percent / 100`）—— **逐段显影的驱动量** */
  progress: number
  /** 该在建舰的舰级 id（真实线稿取 `SHIP_ART`；未命中则回退 role 剪影） */
  shipId: string
  /** 回退剪影用的舰种（资产表未命中时才有意义） */
  role?: ShipRole
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, progress))
  /** 舰体显示高度：**走单点** `shipArtSizeOf`（命中资产 240×110 / 未命中回退剪影 140×64）
      —— 系留臂端点与裁剪窗都按它算，绝不在这里再写死一个比例（坞景第一版就是栽在这） */
  const art = shipArtSizeOf(shipId)
  /**
   * **坞内垂直对齐用"内容中心"而不是"画布几何中心"**：
   * 命中独立线稿 ⇒ 内容大体占满 240×110，两者重合；**未命中走 140×64 回退剪影时**，
   * 那条剪影的内容中心在 y≈50（画布中心是 32）⇒ 直接按几何中心摆，船看着会**沉在坞中线下方**。
   * 补偿量按比例换算到当前显示高度。
   */
  const contentShiftY = art.hit ? 0 : Math.round(((32 - 50) * SHIP_W * (art.h / art.w)) / art.h)
  const shipH = Math.round(SHIP_W * (art.h / art.w))
  /** 显影前沿的 x（从船尾即左端起算；两端各留 2px 余量，免得描边被切） */
  const clipX = VB_W / 2 - SHIP_W / 2 - 1
  const clipW = Math.max(1, SHIP_W * pct + 2)
  const CLIP_ID = 'hud-dock-progress-clip'

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
        {/* 显影窗口：宽度跟着进度长 ⇒ 建造从**船尾（引擎段）**往**船头**推进 */}
        <clipPath id={CLIP_ID}>
          <rect x={clipX} y={0} width={clipW} height={VB_H} />
        </clipPath>
      </defs>

      {/* ── 坞体：两条纵向主梁（±48）＋ 三道桁架拱 ＋ 端环（两头开口，没有坞门）── */}
      <path d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 - BEAM_Y} H${VB_W / 2 + BEAM_HALF}`} />
      <path d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 + BEAM_Y} H${VB_W / 2 + BEAM_HALF}`} />
      {ARCH_X.map((dx) => (
        <path
          key={dx}
          d={
            `M${VB_W / 2 + dx - 14} ${VB_H / 2} L${VB_W / 2 + dx} ${VB_H / 2 - BEAM_Y} ` +
            `L${VB_W / 2 + dx + 14} ${VB_H / 2} L${VB_W / 2 + dx} ${VB_H / 2 + BEAM_Y} Z`
          }
          opacity="0.55"
        />
      ))}
      {/* 端环（坞的两头是开口的桁架环；不画坞门） */}
      <path
        d={`M${VB_W / 2 - BEAM_HALF} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 - BEAM_HALF - 16} ${VB_H / 2} L${VB_W / 2 - BEAM_HALF} ${VB_H / 2 + BEAM_Y}`}
        opacity="0.6"
      />
      <path
        d={`M${VB_W / 2 + BEAM_HALF} ${VB_H / 2 - BEAM_Y} L${VB_W / 2 + BEAM_HALF + 16} ${VB_H / 2} L${VB_W / 2 + BEAM_HALF} ${VB_H / 2 + BEAM_Y}`}
        opacity="0.6"
      />
      {/* 梁间横向联系（每道拱两侧各一小段：把笼子编起来，但不遮住船） */}
      {ARCH_X.map((dx) => (
        <g key={`tie-${dx}`} opacity="0.3">
          <path d={`M${VB_W / 2 + dx - 14} ${VB_H / 2 - BEAM_Y} V${VB_H / 2 - BEAM_Y + 10}`} />
          <path d={`M${VB_W / 2 + dx - 14} ${VB_H / 2 + BEAM_Y} V${VB_H / 2 + BEAM_Y - 10}`} />
        </g>
      ))}

      {/* ── 系留臂：坞体 → 飞船（4 条；端点与船体留 6px 空隙 ⇒ 船是**被拉住**、不是被托住）── */}
      {([
        [-70, -1],
        [70, -1],
        [-70, 1],
        [70, 1],
      ] as const).map(([dx, sign]) => {
        const x = VB_W / 2 + dx
        const y1 = VB_H / 2 + sign * BEAM_Y
        const y2 = VB_H / 2 + sign * (shipH / 2 + 6)
        return (
          <g key={`tether-${dx}-${sign}`} opacity="0.7">
            <path d={`M${x} ${y1} L${x} ${y2}`} />
            <circle cx={x} cy={y2} r="1.6" opacity="0.85" />
          </g>
        )
      })}

      {/* ── 坞内的在建舰：**真实线稿** ＋ 按进度逐段显影（船尾 → 船头）── */}
      <g className="hud-dock-craft" color="var(--hud-accent-soft)" transform={`translate(0 ${contentShiftY})`}>
        {/* 未来段：整条淡淡描一遍（让玩家看出还差多少），再叠上已成形的这一段 */}
        <g opacity="0.14">
          <ShipSpriteShape shipId={shipId} role={role} size={SHIP_W} />
        </g>
        <g clipPath={`url(#${CLIP_ID})`}>
          <ShipSpriteShape shipId={shipId} role={role} size={SHIP_W} />
        </g>
      </g>

      {/* 焊点（两处，错相位闪；只动 opacity）——跟着**显影前沿**走 */}
      <circle className="hud-dock-spark" cx={clipX + clipW} cy={VB_H / 2 - 15} r="2" />
      <circle className="hud-dock-spark is-late" cx={clipX + clipW * 0.7} cy={VB_H / 2 + 19} r="1.7" />
      {/* 坞体航行灯（静态细条；太空坞靠灯识别姿态） */}
      <path
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
