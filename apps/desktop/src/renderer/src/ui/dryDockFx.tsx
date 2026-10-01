/**
 * **太空坞线稿**（**2026-10-01 船长令**：「造船厂的在建舰船，建议将扩大队列卡片的高度，将动画移动到卡片内的
 * 上方，并参考左上角 SVG 动画中的船坞，构建一个更大的船坞，舰船的 SVG 放在船坞中间（最好是建到一半的，
 * 少几根线条。）先照着这个做出一个效果」→「观感上，给人感觉像是一个房子的侧视图」→
 * 「你还要考虑到，这是太空坞，是无重力环境，不是放在地球上的。我们造的是飞船」→
 * 「能否将动画旋转90度，两条主梁可以离中间更近一些，然后按进度逐段显影，使用各舰真实线稿」→
 * 「基本上可以了，希望添加更多动效（比如无人机来回飞行焊接）」→
 * 「飞行速度太快了，停留也太多短暂，建议拉长整体周期，焊点光满希望更大，并且有蹦出火花，
 *  机械臂采用二段式的，同样是移动到两端后停止，焊接的循环」→
 * 「机械臂不见了。我希望无人机的节奏是：飞到左侧-开始焊接-停留好一会-飞到右侧-开始焊接-停留好一会，
 *  并且希望无人机能够转向，每次焊接对着舰船。我同时还发现一个BUG，舰船建造进度的亮部，
 *  在快要建造完成时也只有右下角1/4有显示」）。
 *
 * ## 形态要点（太空坞 · 无重力）
 *
 * 1. **没有"下"**：不画地面线、坞槽、托架——坞体是悬在空间里的**开放式桁架笼**；
 * 2. **船不接触坞**：飞船**悬浮**在坞正中，4 条**系留臂**（端点留空隙）拉住；
 * 3. **水平停泊**：飞船沿坞的纵轴停、**船头朝右**；
 * 4. **主梁靠拢**：两条纵向主梁＝中线上下各 **48**；三道桁架拱跨接两梁；
 * 5. **按进度逐段显影**：坞内画**该舰真实线稿**（`SHIP_ART`，经 `ShipSpriteShape`），用 `clipPath`
 *    把显影宽度**从船尾推向船头**；未成形的部分以极淡透明度整条描出。
 *
 * ## 动效清单（全部只动 `transform` / `opacity`；`prefers-reduced-motion` 与「关特效」下全停）
 *
 * ① 飞船极缓慢悬浮漂移 · ② **两只焊接无人机**：飞到一端 → 停下焊 → 飞到另一端 → 停下焊（10s 一趟、
 * 两端各停 ~2.2s），**到哪一端都转向把焊枪对着船体** · ③ **二段式机械臂**：肩＋前臂两节，
 * 整条臂沿船体在两端之间移动、两端各停 ~4.2s 焊接 · ④ 坞体航行灯缓慢呼吸 · ⑤ 焊点闪烁 ＋ **迸火花**。
 *
 * ## 三个踩过的坑（都写在代码里，免得后人再犯）
 *
 * 1. **定位与动效必须分层**：CSS 动画会写 `transform` ⇒ 若把定位也写在同一元素的 `transform` 属性上，
 *    属性会被动画覆盖（机械臂曾被搬到坞左上角外 ⇒ 船长报「机械臂不见了」）。
 * 2. **显影窗口的坐标要用舰形画布宽 `art.w`**：按显示宽算会让右端永远差一截（船长报
 *    「快要建造完成时也只有右下角 1/4 有显示」）。
 * 3. **坞内舰形的位置靠"嵌套 svg 视口"给**（早期版本靠变换叠加，实测把船甩到 svg 左上角外）。
 */
import type { ShipRole } from '@whale/core'
import { ShipSpriteShape, shipArtSizeOf } from './ShipSprite'

/** 坞景画布：与 `.hud-dock-art` 的 190px 高同比例 */
const VB_W = 380
const VB_H = 190
/** 两条纵向主梁的半间距（船长：「两条主梁可以离中间更近一些」） */
const BEAM_Y = 48
/** 梁的半纵长 */
const BEAM_HALF = 150
/** 三道桁架拱沿纵轴的 x 偏移 */
const ARCH_X = [-96, 0, 96] as const
/** 舰体显示宽度（占坞长 ~62%） */
const SHIP_W = 230
/** 无人机的横向摆动幅度（用户单位；用 `--vx` 喂给 CSS 动画） */
const DRONE_TRAVEL = 116

export function DryDockFx({
  progress,
  shipId,
  role,
}: {
  /** 建造进度 0~1 —— 逐段显影的驱动量 */
  progress: number
  /** 在建舰的舰级 id（真实线稿取 `SHIP_ART`） */
  shipId: string
  /** 回退剪影用的舰种（资产表未命中时才有意义；正式内容里 40/40 都有独立线稿） */
  role?: ShipRole
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, progress))
  const art = shipArtSizeOf(shipId)
  /**
   * 舰形用**嵌套 svg 视口**定位（`x/y` 定位置、`viewBox` 定缩放），不依赖任何外层 transform 叠加。
   * `ShipSpriteShape` 把画布中心摆到原点 ⇒ viewBox 取 `-w/2 -h/2 w h`。
   */
  const shipVp = { x: VB_W / 2 - art.w / 2, y: VB_H / 2 - art.h / 2, w: art.w, h: art.h }
  /**
   * 显影窗口（嵌套 svg 的局部坐标，viewBox 以原点为中心）。
   * ⚠ **必须按舰形画布宽 `art.w` 算**：早期按显示宽 `SHIP_W` 算 ⇒ 右端永远差 10 用户单位，
   * 进度到 100% 也盖不满 ⇒ 船长看到的"快建完时只有右下角 1/4 亮着"。
   */
  const clipX = -shipVp.w / 2 - 1
  const clipW = Math.max(1, shipVp.w * pct + 2)
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
        <clipPath id={CLIP_ID}>
          <rect x={clipX} y={0} width={clipW} height={shipVp.h} />
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
        const y2 = VB_H / 2 + sign * (shipVp.h / 2 + 6)
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
        {/* 未来段：整条淡淡描一遍（让玩家看出还差多少），再叠上已成形的这一段 */}
        <g opacity="0.14">
          <ShipSpriteShape shipId={shipId} role={role} size={SHIP_W} />
        </g>
        <g clipPath={`url(#${CLIP_ID})`}>
          <ShipSpriteShape shipId={shipId} role={role} size={SHIP_W} />
        </g>
      </svg>

      {/* ── 二段式焊接机械臂：整条臂在两端之间移动、端点停下焊 ──
          ⚠ **定位（外层）与动画（内层）分层**：CSS 动画会写 `transform`，写在同一元素上会覆盖定位。 */}
      <g transform={`translate(${VB_W / 2} ${VB_H / 2 + BEAM_Y - 6})`}>
        <g className="hud-dock-armcar">
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
      <circle className="hud-dock-spark" cx={shipVp.x + clipW} cy={VB_H / 2 - 15} r="2" />
      <circle className="hud-dock-spark is-late" cx={shipVp.x + clipW * 0.7} cy={VB_H / 2 + 19} r="1.7" />
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
