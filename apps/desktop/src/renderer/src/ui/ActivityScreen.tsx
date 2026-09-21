/**
 * **主控活动窗口（2026-09-20 船长令）**：主控亲自执行「采掘 / 打捞 / 长途运输 / 扫描虫洞」时，
 * 弹出一个与**战斗窗口同款**的窗口，播放主控正在干的事；可最小化（最小化后右下角浮动还原标）。
 *
 * 船长原话（照抄）：
 * 「我打算给主控执行挖矿/打捞/长途运输/扫描虫洞时，添加一个主控动画窗口播放主控正在执行的活动。
 *   可以参考之前给AI做的小SVG动画。」「是类似战斗场景那样弹出一个窗口，可以进行最小化。」
 * 「1.保留。2.可以给读数。3.进度条也显示。」
 *
 * 三条口径落地：
 * - **窗口形态**：走公共壳 `ui/WinBox.tsx`（战斗窗口同源）——居中窗口、顶栏最小化、浮动还原标；
 * - **读数**：顶栏活动名 + 底栏关键读数（矿带 / 本趟产出 / 航线 / 扫描进度）；
 * - **进度条**：采掘循环 / 打捞循环 / 运输航段 / 扫描窗口各一条。
 * - **旧小窗保留**（`ui/ShipStatusWin.tsx`，左导航「出港」上方）：与本窗口并存，两者都消费
 *   同一个场景推导 `sceneOfShipwin`（唯一事实源，不各写一份判定）。
 *
 * 性能口径（沿用约定第十四章 · 与 `ui/aiWorkFx.tsx` 一致）：整幅演出 = 一张 SVG
 * （星野 / 漂浮物 / 作业件 / **真实舰形**）+ 若干条 CSS 动画，**只动 `transform` / `opacity`**；
 * 不碰 `filter` / `box-shadow` / 宽高；不新建 rAF；引擎每 tick 整树重渲染由 `memo` 挡住
 * （见 `ActArt`：活动与舰体不变即不重建节点）。
 *
 * 视觉口径：物件一律 **SVG 线稿**（细描边 / `currentColor` / viewBox，约定第九章），
 * 配色与 `ui/ShipStatusWin.tsx` 的 `WORK_ACCENT` 同源（采掘绿 / 打捞青 / 扫描蓝 / 航运蓝）。
 */
import { memo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { fleetDefOf, getMiningParams, salvagerCyclesOf, wormholeScanWindowMs } from '@whale/core'
import type { GameState, ShipRole, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'
import { debugEnabled } from '../panels/DebugPanel'
import { toneOf } from './Glyphs'
import { sceneOfShipwin, WORK_ACCENT } from './ShipStatusWin'
import type { ShipwinScene } from './ShipStatusWin'
import { ACTIVITY_SCENES, ACT_H, ACT_W } from './activityArt'
import type { ActSceneId } from './activityArt'
import { WinBox } from './WinBox'

/**
 * **本窗口的可见开关 = 调试模式**（2026-09-20 船长令：「建议先做一个开关，只有开启调试模式才能看到」）。
 *
 * 复用既有调试入口 `panels/DebugPanel.tsx` 的 `debugEnabled()`（`localStorage['whale-idle:debug'] === '1'`，
 * 与顶栏「⇄ 调试」按钮、性能 Hub 采集同一个开关）——**不另造开关机制**。
 *
 * 关掉时本窗口**完全不存在**：既不弹窗、也不出浮动还原标；状态窗（左侧那个保留的小窗）不受影响，
 * 仍照常按活动换场景。⇒ 玩家侧零变化，船长开调试即可验收。
 */
function activityWinEnabled(): boolean {
  return debugEnabled()
}

/** 本窗口认得的活动（= `sceneOfShipwin` 的作业态子集；其余场景窗口不弹） */
export type ActivityKind = 'mine' | 'salvage' | 'haul' | 'scan'

/** 场景 → 本窗口的活动种类；不属于本窗口的场景返回 null */
function activityOf(scene: ShipwinScene): ActivityKind | null {
  switch (scene) {
    case 'work-mine':
      return 'mine'
    case 'work-salvage':
      return 'salvage'
    case 'work-haul':
      return 'haul'
    case 'work-scan':
      return 'scan'
    default:
      return null
  }
}

/** 主控是否正在做本窗口负责的活动（供 `App.tsx` 决定弹不弹） */
export function activityKindOf(state: GameState): ActivityKind | null {
  return activityOf(sceneOfShipwin(state))
}

/* ═══════════ 演出：布景与道具 + 真实舰体都在 activityArt 里画进同一张 SVG ═══════════
 *
 * 2026-09-21 船长：「目前还是过于简陋」+「还不如左上角的小窗来的精细，需要补齐细节
 * （包括我方舰船外形等）可以先参考左上角的小窗」。
 * ⇒ 本文件不再自画舰体（第一版是个菱形占位符），改为：
 *    ① 背景、漂浮物、作业件、**舰体** = `./activityArt` 的场景组件（内部走 `ShipSpriteShape`，
 *       与全站同源：25 舰各自外形、引擎尾焰按真实喷口、面板线与发光件沿用 `.shipart-*` 资产类）；
 *    ② 本文件只管：窗口壳 / 底栏读数与进度条 / 动画节拍（`--act-cycle` 与 `--act-delay`）。
 *    舰体与作业光带同在一个 `app-act-float` 组里轻浮 ⇒ 光带不脱靶（小窗 `app-swin-work` 同款）。
 */

/** 活动 → 布景 id（长途运输按航段分两支：就位 / 承运） */
function sceneIdOf(kind: ActivityKind, state: GameState): ActSceneId {
  if (kind === 'haul') return state.hauling.tripLegsLeft <= 1 ? 'haul-pos' : 'haul'
  return kind
}

/** 活动 → 底色氛围类（复用状态窗那套 `.bg-<scene>`，同源配色） */
const SCENE_CLASS: Record<ActivityKind, ShipwinScene> = {
  mine: 'work-mine',
  salvage: 'work-salvage',
  haul: 'work-haul',
  scan: 'work-scan',
}

/**
 * **动画节拍**（2026-09-21 船长：「跟真实进度挂钩」）：
 * `--act-cycle` = 一个作业周期的毫秒数、`--act-delay` = 已走毫秒取负 ⇒ 进度层动画（`app-act-tick`）
 * 的**相位锁真实进度**：周期完成那一刻正好是峰值（出货 / 到站 / 扫完一遍的瞬间亮一下）。
 *
 * 这里只夹**节拍快慢**：周期短于 1.6s 会闪成一片、长于 12s 会近乎静止（扫描虫洞的"小时带"就是
 * 3.6e6ms），故夹到 [1.6s, 12s] —— **相位照样按真实进度对齐，读数与进度条不受任何影响**
 * （真相由底栏读数与进度条负责，动画只负责动感）。
 */
const BEAT_MIN_MS = 1_600
const BEAT_MAX_MS = 12_000

/** 节拍 → 舞台上的 CSS 变量（无周期/无进度 ⇒ 不挂钩，动画走 CSS 里的缺省值） */
function beatStyle(cycleMs: number | null, progress: number | null): CSSProperties | undefined {
  if (cycleMs === null || progress === null || cycleMs <= 0) return undefined
  const cycle = Math.min(BEAT_MAX_MS, Math.max(BEAT_MIN_MS, cycleMs))
  return { '--act-cycle': `${Math.round(cycle)}ms`, '--act-delay': `-${Math.round(cycle * progress)}ms` } as CSSProperties
}

/**
 * 演出层（`memo`：引擎每 tick 整树重渲染时，只要活动与舰体没变就不重建这上百个 SVG 节点——
 * 星野 96 点 + 漂浮物 + 作业件 + 舰形资产，约 200 个节点，10Hz 白重建是纯浪费）。
 * 节拍变量挂在外层舞台上，不进来 ⇒ 进度每 tick 变化不会击穿这层 memo。
 */
const ActArt = memo(function ActArt({
  sceneId,
  shipId,
  role,
  accent,
}: {
  sceneId: ActSceneId
  shipId?: string
  role?: ShipRole
  accent: string
}) {
  const Scene = ACTIVITY_SCENES[sceneId]
  return <Scene fx={{ shipId, role, accent, engine: true }} />
})

/* ═══════════ 读数与进度 ═══════════ */

interface Readout {
  title: string
  lines: string[]
  /** 进度 0~1；null = 本活动没有可算的进度 */
  progress: number | null
  progressLabel: string
  /** 一个作业周期的毫秒数（进度条的**分母**＝动画节拍的挂钩点）；null = 本活动算不出周期 */
  cycleMs: number | null
}

/** 取一条活动的读数与进度（纯读状态，不改任何东西） */
function readoutOf(kind: ActivityKind, state: GameState, ctx: SimContext): Readout {
  if (kind === 'mine') {
    const m = state.mining
    const p = getMiningParams(state, ctx)
    const belt = m.beltId !== null ? ctx.belts.get(m.beltId)?.name : undefined
    const cycle = p?.cycleMs ?? 0
    return {
      title: tr('ui.ActivityWin.001'),
      lines: [
        `${tr('ui.ActivityWin.010')}${belt ?? '—'}`,
        `${tr('ui.ActivityWin.011')}${m.tripUnits.toLocaleString('zh-CN')}`,
        `${tr('ui.ActivityWin.012')}${(p?.unitsPerCycle ?? 0).toLocaleString('zh-CN')}`,
      ],
      progress: cycle > 0 ? Math.min(1, m.cycleAccMs / cycle) : null,
      progressLabel: tr('ui.ActivityWin.020'),
      cycleMs: cycle > 0 ? cycle : null,
    }
  }
  if (kind === 'salvage') {
    const s = state.salvaging
    /**
     * 打捞进度：作业以**最短打捞器周期**为统一推进步（`salvaging.ts`：多台各自维护相位），
     * 故进度 = `cycleAccMs / 最短周期`——满一格 = 有一台打捞器完成一轮、捞上一次。
     * 出航/返航段（`phase !== 'salvaging'`）不显示循环进度（那两段是航行，读的是航段进度）。
     */
    const cycles = salvagerCyclesOf(state, ctx, state.shipId)
    const stepMs = cycles.length > 0 ? Math.min(...cycles) : 0
    const working = s.phase === 'salvaging'
    return {
      title: tr('ui.ActivityWin.002'),
      lines: [
        `${tr('ui.ActivityWin.013')}${Math.round(s.tripM3).toLocaleString('zh-CN')} m³`,
        `${tr('ui.ActivityWin.018')}${cycles.length}`,
        `${tr('ui.ActivityWin.019')}${(stepMs / 1000).toFixed(1)} s`,
      ],
      progress: working && stepMs > 0 ? Math.min(1, s.cycleAccMs / stepMs) : null,
      progressLabel: tr('ui.ActivityWin.023'),
      cycleMs: working && stepMs > 0 ? stepMs : null,
    }
  }
  if (kind === 'haul') {
    const h = state.hauling
    const a = h.routeA === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.routeA)?.name ?? h.routeA)
    const b = h.routeB === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.routeB)?.name ?? h.routeB)
    const to = h.toSiteId === null ? tr('ui.ActivityWin.004') : (ctx.stations.get(h.toSiteId)?.name ?? h.toSiteId)
    // 就位段（`tripLegsLeft === 1`）= 空舱赶去航线端点，与承运段画面/标题都不同（船长要"区分就位与承运"）
    const positioning = h.tripLegsLeft <= 1
    return {
      title: tr(positioning ? 'ui.ActivityWin.030' : 'ui.ActivityWin.003'),
      lines: [
        `${tr('ui.ActivityWin.014')}${a} ⇄ ${b}`,
        `${tr('ui.ActivityWin.015')}${to}`,
        positioning ? tr('ui.ActivityWin.031') : `${tr('ui.ActivityWin.016')}×${h.tripMul.toFixed(1)}`,
      ],
      progress: h.legMs > 0 ? Math.min(1, h.phaseAccMs / h.legMs) : null,
      progressLabel: tr('ui.ActivityWin.021'),
      cycleMs: h.legMs > 0 ? h.legMs : null,
    }
  }
  const sc = state.wormholeScan ?? { active: false, progressMs: 0 }
  const win = wormholeScanWindowMs(state)
  /**
   * 扫描进度条**按"小时带"走**（2026-09-20 自查修正）：
   *
   * 直接拿整窗口当分母是**看不出来的**——窗口基准 12 小时（还要吃技能与谜质科技的削减），而 tick 是
   * 10Hz ⇒ 每帧进度只涨 0.0002%，条子实际上是死的。故进度条改为**当前这一小时的完成度**
   * （每小时扫满一次、条子扫过一遍），整窗的绝对进度由**读数**如实给出（`x.x h / y.y h（z%）`）。
   * 这样"条子在动"与"数值可信"两件事都有：条子负责动感，数字负责真相。
   */
  const HOUR = 3_600_000
  const inHour = sc.progressMs % HOUR
  const totalH = win / HOUR
  const doneH = sc.progressMs / HOUR
  const pct = win > 0 ? Math.min(100, Math.floor((sc.progressMs / win) * 100)) : 0
  return {
    title: tr('ui.ActivityWin.005'),
    lines: [
      `${tr('ui.ActivityWin.017')}${doneH.toFixed(1)} h / ${totalH.toFixed(1)} h（${pct}%）`,
      tr('ui.ActivityWin.024', { p1: win > 0 ? Math.max(0, (win - sc.progressMs) / HOUR).toFixed(1) : '—' }),
    ],
    progress: win > 0 ? Math.min(1, inHour / HOUR) : null,
    progressLabel: tr('ui.ActivityWin.022'),
    // 节拍挂钩点＝整窗时长（相位峰值落在"这一小时带扫满"那刻；节拍再长也只夹快慢，见 beatStyle）
    cycleMs: win > 0 ? win : null,
  }
}

/* ═══════════ 组件 ═══════════ */

export function ActivityScreen({
  state,
  ctx,
  open,
  onMinimize,
  onRestore,
}: {
  state: GameState
  ctx: SimContext
  open: boolean
  onMinimize: () => void
  onRestore: () => void
}): ReactNode {
  // 调试模式未开 ⇒ 本窗口完全不存在（不弹窗、也不出浮动还原标）
  if (!activityWinEnabled()) return null
  const kind = activityKindOf(state)
  if (kind === null) return null
  const r = readoutOf(kind, state, ctx)
  // 主控舰真实外形（与状态窗同一把尺：`fleetDefOf` 取 defId、配色取 `WORK_ACCENT`、缺 def 回角色色）
  const def = fleetDefOf(state, ctx, state.shipId)
  const accent = WORK_ACCENT[SCENE_CLASS[kind]] ?? toneOf(def?.role)
  return (
    <WinBox
      variant="app-winbox is-activity"
      title={r.title}
      open={open}
      onMinimize={onMinimize}
      minimizeText={tr('ui.ActivityWin.006')}
      chipText={`${tr('ui.ActivityWin.007')}${r.title}`}
      chipTitle={tr('ui.ActivityWin.008')}
      onRestore={onRestore}
    >
      <div className={`app-act-stage bg-${SCENE_CLASS[kind]}`} style={beatStyle(r.cycleMs, r.progress)}>
        <svg
          className="app-act-svg"
          viewBox={`0 0 ${ACT_W} ${ACT_H}`}
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <ActArt sceneId={sceneIdOf(kind, state)} shipId={def?.id} role={def?.role} accent={accent} />
        </svg>
      </div>
      <div className="app-act-dock">
        {r.lines.map((t, i) => (
          <span key={i} className="app-act-line">{t}</span>
        ))}
        {r.progress !== null ? (
          <span className="app-act-progress" title={r.progressLabel}>
            <i className="app-act-bar" style={{ width: `${Math.round(r.progress * 100)}%` }} />
            <b className="app-act-pct">{Math.round(r.progress * 100)}%</b>
          </span>
        ) : null}
      </div>
    </WinBox>
  )
}
