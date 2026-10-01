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
 *
 * **动效清单**（2026-10-01 船长令「希望添加更多动效（比如无人机来回飞行焊接）」）：
 * ① 飞船极缓慢悬浮漂移 · ② **两只焊接无人机沿船体上下往返**、机身焊光微闪（错相位）·
 * ③ **坞壁机械臂缓慢屈伸** · ④ 坞体航行灯缓慢呼吸 · ⑤ 两处焊点闪烁。
 * 全部**只动 `transform` / `opacity`**，且 `prefers-reduced-motion` 与「关特效」下全停（§十四）。
 *    不再靠"故意少画几根线"来假装。
 *
 * ## 纪律
 *
 * - 形状一律 SVG 线稿（`currentColor` ＋ 细描边；§6）；CSS 只负责氛围光与动效；
 * - 动效只碰 `transform` / `opacity`（飞船悬浮漂移 ＋ 焊点闪烁），`prefers-reduced-motion` 与玩家
 *   「关特效」（`body.no-fx`）下全停（§十四）；
 * - 纯展示件（`aria-hidden`），不参与交互；坞景高度由外层 `.hud-dock-art` 定死 ⇒ 卡片不跳动。

## 资产实情（2026-10-01 更正一次误报）

数据层 **40 个舰级 100% 都有独立线稿**（`SHIP_ART` 的 `sh-*` 键 40/40），逐段显影对每一艘都成立；
`ShipSpriteShape` 里那条 140×64 回退**在正式内容里走不到**（只对异常旧档/未录形生效）。
我一度把"23/40"当事实报给船长 —— 那是**统计脚本只匹配单引号键**、而 `shipArtData.tsx` 用双引号键
导致整文件被跳过所致。**教训**：统计资产先对齐"键的书写形态"，别拿一次正则的结果当结论。
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
/** 无人机的横向摆动幅度（用户单位；用 `--vx` 喂给 CSS 动画，避免写死两套 keyframes） */
const DRONE_TRAVEL = 116
/** 无人机轨道相对坞中线的纵向偏移（一上一下，贴着船体两侧飞） */
const DRONE_Y = 28
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
   * **让舰形以坞中线为中心**：`ShipSpriteShape` 自己带 `transform="scale(s) translate(-w/2,-h/2)"`，
   * 而那句在坞景里**整条被当成了位移**（实机读数：`matrix(0.958,0,0,0.958,-115,-52.7)`，舰形中心
   * 跑到 svg 左上角外、偏移 −176/−94 px）⇒ 坞景自己把变换显式写出来，摆到 (0,0)：
   * 先 `translate(-w/2,-h/2)` 把舰形移到原点，再按目标宽度缩放。
   */
  /**
   * **舰形用"嵌套 svg 视口"定位**（2026-10-01 实机实测后的方案）：
   * 之前试过两条路都不成立 —— ① 只靠 `ShipSpriteShape` 自带的 `scale(s) translate(-w/2,-h/2)`：
   * 实测把整条舰甩到 svg 左上角外（中心偏移 −176/−94 px，截图见工作文档）；
   * ② 在外层 `<g>` 上写变换、再给子层加"反向抵消"：实测只收敛到 −57/−39，抵消不干净。
   * 现在改成：**坞景里嵌一个 `<svg viewBox="0 0 w h">` 小视口**，把舰形画布坐标直接映射进坞的坐标系
   * —— 不依赖任何外层 transform 的叠加，位置与缩放各由 `<svg>` 的几何属性一次定死。
   */
  const shipVp = { x: VB_W / 2 - art.w / 2, y: VB_H / 2 - art.h / 2, w: art.w, h: art.h }
  /** 把 `ShipSpriteShape` **自己那句** `scale(s) translate(-w/2,-h/2)` 反向抵消（先反缩放、再反平移）
      —— 实机实测那句话在坞景里会把整条舰甩到 svg 左上角外（读数 −176/−94 px，截图为证），
      而坞景这一层的 transform 是生效的 ⇒ 由坞景独占定位，子组件只出"未变换的形状"。 */
  const undoShip = `translate(${art.w / 2},${art.h / 2}) scale(${(SHIP_W / art.w).toFixed(5)})`
  /**
   * ⚠ **2026-10-01 撤掉一次"内容中心补偿"**：上一笔我曾按"回退剪影的内容中心 y≈50、画布中心 32"
   * 加过 30px 的垂直补偿 —— 那是**在错误前提下猜的**（当时真正的病是 `transform-box` 缺失、
   * 舰形整条堆在原点，见下）。前提修好后这个补偿只会把船推离坞中线 ⇒ **删除**。
   * 若日后真发现某些舰形在坞内不居中，**先用读数确认**（别再用坐标手算）。
   */
  const shipH = Math.round(SHIP_W * (art.h / art.w))
  /** 显影前沿的 x（从船尾即左端起算；两端各留 2px 余量，免得描边被切） */
  const clipX = -1
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
        {/* 显影窗口：宽度跟着进度长 ⇒ 建造从**船尾（引擎段）**往**船头**推进 */}
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

      {/* ── 坞壁机械臂（船长令：从桁架伸向船体、缓慢屈伸）：只动 rotate，布局/动效分层 ── */}
      <g transform={`translate(${VB_W / 2 + 118} ${VB_H / 2 + BEAM_Y - 2})`}>
        <g className="hud-dock-arm">
          <path d="M0 0 L-30 -16" opacity="0.8" />
          <circle cx="-31" cy="-17" r="2" opacity="0.9" />
        </g>
      </g>
      {/* ── 焊接无人机（船长令「无人机来回飞行焊接」）：两只一上一下沿船体往返，机身焊光微闪 ── */}
      <g transform={`translate(${VB_W / 2} ${VB_H / 2 - 34})`}>
        <g className="hud-dock-drone" style={{ ['--vx' as string]: `${DRONE_TRAVEL}px` }}>
          <g className="hud-dock-drone-body">
            <rect x="-7" y="-2.5" width="14" height="5" rx="1.5" />
            <path d="M-9 -2.5 H9 M-9 2.5 H9" opacity="0.7" />
            <path d="M-4 -4.5 V-6.5 M4 -4.5 V-6.5" opacity="0.6" />
            <circle className="hud-dock-weld" cx="9.5" cy="0" r="1.7" />
          </g>
        </g>
      </g>
      <g transform={`translate(${VB_W / 2} ${VB_H / 2 + 34})`}>
        <g className="hud-dock-drone is-late" style={{ ['--vx' as string]: `${DRONE_TRAVEL}px` }}>
          <g className="hud-dock-drone-body">
            <rect x="-7" y="-2.5" width="14" height="5" rx="1.5" />
            <path d="M-9 -2.5 H9 M-9 2.5 H9" opacity="0.7" />
            <path d="M-4 4.5 V6.5 M4 4.5 V6.5" opacity="0.6" />
            <circle className="hud-dock-weld" cx="9.5" cy="0" r="1.7" />
          </g>
        </g>
      </g>
      {/* 焊点（两处，错相位闪；只动 opacity）——跟着**显影前沿**走 */}
      <circle className="hud-dock-spark" cx={shipVp.x + clipW} cy={VB_H / 2 - 15} r="2" />
      <circle className="hud-dock-spark is-late" cx={shipVp.x + clipW * 0.7} cy={VB_H / 2 + 19} r="1.7" />
      {/* 坞体航行灯（静态细条；太空坞靠灯识别姿态） */}
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
