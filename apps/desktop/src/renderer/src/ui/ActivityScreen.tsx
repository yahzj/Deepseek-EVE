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
 * 性能口径（沿用约定第十四章 · 与 `ui/aiWorkFx.tsx` 一致）：每个场景 = 一个小 SVG
 * （约 10~18 个节点）+ 若干条 CSS 动画，**只动 `transform` / `opacity`**；不碰 `filter` /
 * `box-shadow` / 宽高；不新建 rAF；引擎每 tick 整树重渲染由 `memo` 挡住（kind 不变即跳过）。
 *
 * 视觉口径：物件一律 **SVG 线稿**（细描边 / `currentColor` / viewBox，约定第九章），
 * 配色与 `ui/ShipStatusWin.tsx` 的 `WORK_ACCENT` 同源（采掘绿 / 打捞青 / 扫描蓝 / 航运蓝）。
 */
import { memo } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { getMiningParams, salvagerCyclesOf, wormholeScanWindowMs } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'
import { debugEnabled } from '../panels/DebugPanel'
import { sceneOfShipwin } from './ShipStatusWin'
import type { ShipwinScene } from './ShipStatusWin'
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

/* ═══════════ 四个场景的演出（memo：kind 不变即整棵 SVG 子树跳过 diff） ═══════════ */

/** 采掘：主控射出采掘激光，矿石碎屑错相位回流货舱 */
const MineFx = memo(function MineFx() {
  return (
    <>
      <path d="M120 120 L196 92 L268 110 L196 138 Z" />
      <path className="app-act-flame" d="M120 120 L86 106 L104 120 L86 134 Z" fill="currentColor" stroke="none" opacity="0.75" />
      <path className="app-act-beam" d="M268 110 H430" />
      <path d="M436 82 L492 60 L556 76 L492 100 Z" />
      <path d="M443 70 L470 62 M447 90 L478 84" strokeOpacity="0.45" />
      <rect className="app-act-chip" x="366" y="88" width="9" height="9" />
      <rect className="app-act-chip is-late" x="404" y="124" width="9" height="9" />
      <rect className="app-act-chip is-late2" x="346" y="132" width="9" height="9" />
    </>
  )
})

/** 打捞：牵引锥呼吸 + 扫描弧扫过残片，残片被吸向舰体 */
const SalvageFx = memo(function SalvageFx() {
  return (
    <>
      <path d="M120 120 L196 92 L268 110 L196 138 Z" />
      <path className="app-act-cone" d="M268 110 L470 62 L470 158 Z" fill="currentColor" fillOpacity="0.1" />
      <path className="app-act-beam" d="M268 110 H470" />
      <path className="app-act-arc" d="M420 46 C438 26 462 14 496 8" />
      <path d="M456 66 L510 84 L476 108 Z" />
      <path d="M492 132 L544 124 L544 152 Z" />
      <rect className="app-act-chip" x="386" y="96" width="9" height="9" />
      <rect className="app-act-chip is-late" x="430" y="128" width="9" height="9" />
    </>
  )
})

/** 长途运输·承运：外挂货柜随舰体轻晃，后方拖出航迹（空舱就位段走通用 travel，不在此列） */
const HaulFx = memo(function HaulFx() {
  return (
    <>
      <g className="app-act-haulbody">
        <path d="M96 120 L172 92 L244 110 L172 138 Z" />
        <path className="app-act-flame" d="M96 120 L62 106 L80 120 L62 134 Z" fill="currentColor" stroke="none" opacity="0.75" />
        <rect x="176" y="96" width="54" height="26" rx="3" />
        <rect x="238" y="96" width="42" height="26" rx="3" />
        <path d="M186 96 V122 M202 96 V122 M248 96 V122 M262 96 V122" strokeOpacity="0.5" />
      </g>
      <path className="app-act-trail" d="M300 110 H364" />
      <path className="app-act-trail is-late" d="M330 84 H392" />
      <path className="app-act-trail is-late2" d="M330 136 H392" />
      <path d="M452 110 L508 96 L540 110 L508 124 Z" strokeOpacity="0.5" />
    </>
  )
})

/** 扫描虫洞：主控展开扫描阵列，扇形扫描波自舰体向外掠出，回波信号点闪回 */
const ScanFx = memo(function ScanFx() {
  return (
    <>
      <path d="M120 120 L196 92 L268 110 L196 138 Z" />
      <path className="app-act-array" d="M196 92 V62 M196 62 L172 48 M196 62 L220 48" />
      <path className="app-act-wave" d="M300 44 C332 76 332 144 300 176" />
      <path className="app-act-wave is-late" d="M356 26 C398 74 398 146 356 194" />
      <path className="app-act-wave is-late2" d="M412 8 C464 72 464 148 412 212" />
      <circle className="app-act-echo" cx="466" cy="70" r="5" />
      <circle className="app-act-echo is-late" cx="486" cy="150" r="4" />
      <circle className="app-act-echo is-late2" cx="440" cy="112" r="3" />
    </>
  )
})

/** 长途运输·就位（`tripLegsLeft === 1`）：空舱赶去航线端点——只有航迹与远方端点，没有货柜 */
const HaulPosFx = memo(function HaulPosFx() {
  return (
    <>
      <g className="app-act-haulbody">
        <path d="M120 120 L196 92 L268 110 L196 138 Z" />
        <path className="app-act-flame" d="M120 120 L86 106 L104 120 L86 134 Z" fill="currentColor" stroke="none" opacity="0.75" />
      </g>
      <path className="app-act-trail" d="M300 110 H392" />
      <path className="app-act-trail is-late" d="M330 84 H420" />
      <path className="app-act-trail is-late2" d="M330 136 H420" />
      <path d="M468 110 L524 96 L556 110 L524 124 Z" strokeOpacity="0.5" />
      <circle className="app-act-echo" cx="496" cy="110" r="4" />
    </>
  )
})

const SCENES: Record<ActivityKind, ComponentType> = {
  mine: MineFx,
  salvage: SalvageFx,
  haul: HaulFx,
  scan: ScanFx,
}

/** 活动 → 底色氛围类（复用状态窗那套 `.bg-<scene>`，同源配色） */
const SCENE_CLASS: Record<ActivityKind, string> = {
  mine: 'work-mine',
  salvage: 'work-salvage',
  haul: 'work-haul',
  scan: 'work-scan',
}

/* ═══════════ 读数与进度 ═══════════ */

interface Readout {
  title: string
  lines: string[]
  /** 进度 0~1；null = 本活动没有可算的进度 */
  progress: number | null
  progressLabel: string
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
  // 长途运输两段不同画面：就位（空舱赶路）vs 承运（挂柜拖尾）
  const Scene = kind === 'haul' && state.hauling.tripLegsLeft <= 1 ? HaulPosFx : SCENES[kind]
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
      <div className={`app-act-stage bg-${SCENE_CLASS[kind]}`}>
        <svg
          className="app-act-svg"
          viewBox="0 0 560 220"
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <Scene />
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
