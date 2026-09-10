/**
 * AI 工作动画（2026-09-10 船长定：AI 指挥中心「执行中」列表每行左侧一个**按工作内容差分**的简单动画）。
 * 船长确认口径：范围 = 仅「执行中」列表（AI 副船 + 站内工业）；粒度 = 6 类；风格 = SVG 线稿
 * （与舰船资产同语言：细描边 / currentColor / viewBox；见约定第九章「视觉物件一律 SVG 线稿」）。
 *
 * 性能口径（约定第十四章，2026-09-10 船长问"是否会大幅消耗性能"）：
 * - 每个动画 = 一个小 SVG（56×36，约 6~12 个节点）+ 1~3 条 CSS 动画，**只动 transform/opacity**
 *   两个合成器属性；不碰 filter / box-shadow / 宽高（第十四章第 5 条实测绘制尖峰 50~60ms 的正是那类）；
 * - 不新建 rAF 逐帧循环：动画全交给 CSS，与引擎 10Hz tick 解耦（战斗画面那条 rAF 与本处无关）；
 * - 本组件走 memo：引擎每 tick 触发整树重渲染（App 层订阅），kind 不变即整棵 SVG 子树跳过 diff；
 * - 行数量级 = AI 核心上限（「AI 核心操作学」等级，常见 1~4 艘副船 + 站内工业 1~3 条），个位数；
 *   切走标签页即卸载。整体开销远小于战斗画面，实测复核见 docs/design/ai-work-fx-20260910.md。
 *
 * 检索入口：`AiWorkFx`（唯一实现；判定「哪一行画哪一种」在 ShipPage 的 aiWorkKindOf）。
 */
import { memo } from 'react'

/** 六类工作（与船长确认的差分粒度一致）；配色见 styles.css `.app-inv-fx.is-*`（与 NAV_TONES 同族语汇） */
export type AiWorkKind = 'mining' | 'salvage' | 'standby' | 'refine' | 'reclaim' | 'craft'

/** 各场景共用的舰影线稿（朝右的小镖形；本地坐标同 56×36 画布） */
function hull(): JSX.Element {
  return <path d="M8 20 L17 15 L26 17.5 L17 22 Z" />
}

/** 采矿：采掘激光脉动打向矿点，矿石碎屑错相位回流货舱 */
function MiningFx(): JSX.Element {
  return (
    <>
      {hull()}
      <path className="app-aifx-beam" d="M26.5 17.5 H44" />
      <path d="M45 14 l4 0 l2.5 4 l-2.5 4 l-4 0 l-2.5 -4 z" />
      <rect className="app-aifx-chip" x="36" y="12.6" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late" x="40" y="19.4" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late2" x="34" y="21.6" width="2.6" height="2.6" />
    </>
  )
}

/** 打捞：扇形牵引光束呼吸，残片被吸向舰体 */
function SalvageFx(): JSX.Element {
  return (
    <>
      {hull()}
      <path className="app-aifx-beam2" d="M26.5 17.5 L45 11 L45 24 Z" fill="currentColor" fillOpacity="0.1" />
      <path className="app-aifx-beam" d="M26.5 17.5 H45" />
      <path d="M44 9 l7 3 l-5 4 z" />
      <path d="M47 22 l6 -2 l1 4 z" />
      <rect className="app-aifx-chip" x="38" y="14" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late" x="41" y="20" width="2.6" height="2.6" />
    </>
  )
}

/** 掩护巡逻：舰影小幅巡航 + 扫描弧扫过 + 远端敌情点闪烁 */
function StandbyFx(): JSX.Element {
  return (
    <>
      <g className="app-aifx-hull">
        <path className="app-aifx-flame" d="M8 20 L3.5 17.2 L5 20 L3.5 22.8 Z" fill="currentColor" stroke="none" opacity="0.8" />
        <path d="M9 20 L18 15 L27 17.5 L18 22 Z" />
      </g>
      <path className="app-aifx-arc" d="M29 18 C31 13.5 34 10.5 38 9" />
      <path className="app-aifx-arc is-late" d="M31 21 C33 16 36.5 12.5 41 11" />
      <path className="app-aifx-foe" d="M48 13 l5 2.5 l-5 2.5 z" />
    </>
  )
}

/** 炉体（精炼炉与回收炉共用同一工业形象语言） */
function furnace(): JSX.Element {
  return (
    <>
      <path d="M20 30 L23 12 H33 L36 30 Z" />
      <path d="M17 30 H39" />
      <path d="M25 12 V8.5 H31 V12" />
    </>
  )
}

/** 精炼炉：炉内火焰脉动 + 火星上升 */
function RefineFx(): JSX.Element {
  return (
    <>
      {furnace()}
      <path className="app-aifx-fire" d="M28 28 c-3 -4 1 -6.5 0 -9 c3 2.5 4.5 5.5 0 9 z" />
      <path className="app-aifx-fire is-late" d="M24.5 28.5 c-2 -2.5 0.5 -4 0 -5.5 c2 1.6 2.8 3.4 0 5.5 z" />
      <circle className="app-aifx-spark" cx="28" cy="10" r="1.2" />
      <circle className="app-aifx-spark is-late" cx="33" cy="12" r="1" />
    </>
  )
}

/** 回收炉：残骸碎块落入炉口，底部产出料闪动 */
function ReclaimFx(): JSX.Element {
  return (
    <>
      {furnace()}
      <rect className="app-aifx-fall" x="25.4" y="2.6" width="3.4" height="3.4" />
      <rect className="app-aifx-fall is-late" x="29.6" y="1.4" width="2.8" height="2.8" />
      <rect className="app-aifx-work" x="26.4" y="31.4" width="3.4" height="2.8" />
      <circle className="app-aifx-spark is-late" cx="28" cy="9" r="1.1" />
    </>
  )
}

/** 组装制造：机械臂下压抬起 + 台面工件脉动 + 装配火花 */
function CraftFx(): JSX.Element {
  return (
    <>
      <path d="M17 30 H39" />
      <path d="M24 26 H32" />
      <rect className="app-aifx-work" x="25.6" y="22" width="5.2" height="4" />
      <path className="app-aifx-arm" d="M11 5 V12.5 L20 19.6" />
      <circle className="app-aifx-spark" cx="21.5" cy="21" r="1.1" />
      <circle className="app-aifx-spark is-late" cx="26" cy="20" r="0.9" />
    </>
  )
}

const SCENES: Record<AiWorkKind, () => JSX.Element> = {
  mining: MiningFx,
  salvage: SalvageFx,
  standby: StandbyFx,
  refine: RefineFx,
  reclaim: ReclaimFx,
  craft: CraftFx,
}

/**
 * AI 工作动画槽（固定尺寸 56×36，见 `.app-inv-fx`）——纯展示件，不参与任何交互。
 * memo：props 只有 kind（字符串），引擎 tick 引发的整树重渲染不会重算这个子树。
 */
export const AiWorkFx = memo(function AiWorkFx({ kind }: { kind: AiWorkKind }) {
  const Scene = SCENES[kind]
  return (
    <span className={`app-inv-fx is-${kind}`} aria-hidden="true">
      <svg
        viewBox="0 0 56 36"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Scene />
      </svg>
    </span>
  )
})
