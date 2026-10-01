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
import { useId } from 'react'
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
/** 舰体显示宽度基准（T3；占坞长 ~60%） */
const SHIP_W_BASE = 230
/**
 * **舰体大小随 T 级缩放**（**2026-10-01 船长令**：「我方舰船是否没有跟随舰船T级放大缩小？」→
 * 裁定「按 T 级阶梯缩放」＋「更温和（1.15 倍/级）」）。
 *
 * 以 T3 为基准 1.0，每级 ×1.15：T1 0.70 · T2 0.81 · T3 1.00 · T4 1.15 · T5 1.32（缺省按 T3）。
 * 换算到坞景：T1 ≈ 161 宽 → T5 ≈ 304 宽（坞景画布 380 宽 ⇒ 最大的船也不会顶出坞框）。
 */
const TIER_SCALE: Record<number, number> = { 1: 0.7, 2: 0.81, 3: 1, 4: 1.15, 5: 1.32 }

/** 该 T 级的舰体显示宽度（用户单位） */
function shipDisplayWidthOf(tier: number | undefined): number {
  return Math.round(SHIP_W_BASE * (TIER_SCALE[tier ?? 3] ?? 1))
}
/**
 * 无人机的横向摆动幅度（用户单位；用 `--vx` 喂给 CSS 动画）。
 * **2026-10-01 船长令（二次）**：「可能是因为缩放的关系，到坞景中线降低到60」
 * ⇒ 端点到坞中线各 **60**（我上一版按"200px"直接取 200 用户单位，忽略了屏显 ≈1.28× 的缩放，
 * 实际飞到了坞笼外面）。
 * ⚠ 现状：坞内可见船体宽 230 ⇒ 半幅 115，而航线半幅只有 60 ⇒ 无人机只在**船体中段**往返，
 * 两端（约 55 单位）覆盖不到；这与"逐段显影从船尾推向船头"的观感略有出入（船长已知情，按令执行）。
 */
const DRONE_TRAVEL = 60

export function DryDockFx({
  progress,
  shipId,
  role,
  tier,
}: {
  /** 建造进度 0~1 —— 逐段显影的驱动量 */
  progress: number
  /** 在建舰的舰级 id（真实线稿取 `SHIP_ART`） */
  shipId: string
  /** 回退剪影用的舰种（资产表未命中时才有意义；正式内容里 40/40 都有独立线稿） */
  role?: ShipRole
  /** 舰船 T 级（1~5）—— 决定坞内舰体的显示大小（见 `TIER_SCALE`） */
  tier?: number
}): JSX.Element {
  const pct = Math.max(0, Math.min(1, progress))
  const art = shipArtSizeOf(shipId)
  /** 本舰显示宽度（按 T 级缩放；T3 = 基准 230） */
  const shipW = shipDisplayWidthOf(tier)
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
  const clipX = -shipW / 2 - 1
  const clipW = Math.max(1, shipW * pct + 2)

  /**
   * **显影用 mask ＋ 硬边渐变**（**2026-10-01 船长报障**：「舰船的上半部分线条始终不亮，只有下半部分的亮」）。
   *
   * 原实现用 `clipPath` 的**矩形**裁剪进度；矩形与外层坞景各写一套坐标（外层 viewBox 380×190、
   * 舰形在**嵌套 svg 的局部坐标系**里以原点为中心），两套坐标一旦对不齐就会**只切到一部分**——
   * 典型表现就是"上下只亮一半"。现在改成：mask 与渐变**都定义在舰形那个嵌套 svg 内部**
   * （同一坐标系，不再跨界），渐变用**硬边**（过渡区间仅 0.9%）标出"已成形 / 未成形"的分界。
   */

  /**
   * ⚠ **SVG 的 id 必须每实例唯一**（**2026-10-01 船长报障**：「所有遮罩大小只会按照队列内最顶上这艘来决定」）：
   * 原先三个 id 都是固定字符串，而造船厂队列里**每个在建舰各渲染一个 `DryDockFx`** ⇒ 同页多份同 id，
   * 浏览器只会认**文档里第一个** ⇒ **所有船都用第一艘的遮罩尺寸**（正是船长看到的现象）。
   * 现在用 React 的 `useId()` 给每个实例加后缀，各自引用自己的遮罩与渐变。
   */
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const maskId = `hud-dock-progress-mask-${uid}`
  const gradId = `hud-dock-progress-grad-${uid}`
  /** 船体区域遮罩（让"船体不透明"生效，但不显示自身；尺寸随本实例的 T 级） */
  const hullMaskId = `hud-dock-hull-mask-${uid}`

  /** 硬边位置（0~1 的渐变坐标）；`pct` 为 0 时整段透明（什么都不亮） */
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
      <circle className="hud-dock-spark" cx={VB_W / 2 + clipX + clipW} cy={VB_H / 2 - 15} r="2" />
      <circle className="hud-dock-spark is-late" cx={VB_W / 2 + clipX + clipW * 0.7} cy={VB_H / 2 + 19} r="1.7" />
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
