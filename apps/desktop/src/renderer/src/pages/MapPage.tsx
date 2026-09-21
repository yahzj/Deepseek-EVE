/**
 * 星图页（标签页结构）：本地矿带开采（主控 + AI 副船指派）/ 星图·远征调度 / 常驻悬赏 / 残骸打捞 / 任务中心。
 * 顶部二级标签切换各功能区（配合左侧主菜单「出港」展开选择，见 App）。
 */
import { useEffect, useRef, useState } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  aiTaskView,
  countAiCore,
  formatDurationMs,
  getMiningParams,
  idleAiShipIds,
  isExplored,
  isSiteBuilt,
  marketGoodOf,
  marketQuote,
  miningStatus,
  oneLegMs,
  salvagerCyclesOf,
  legMsFor,
  outboundLegMsFor,
  shipDisplayName,
  recycleTierOf,
  wreckBaseDensity,
  wreckDensityOf,
  RECYCLE_YIELD_PER_M3,
  RECYCLE_POOL_AVG_ISK,
  RARE_WRECK_VOLUME_M3,
  wreckGroupOfAnomaly,
} from '@whale/core'
import type { AiCoreType, BeltDef, GalaxyDef } from '@whale/core'
import { unlocked, WORMHOLE_SCAN_UNLOCK_STANDING } from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { FlavorTip, recycleFeatureOf } from '../ui/wreckFlavor'
import { AiTaskBar } from '../ui/aiProgress'
import { ExpeditionPanel, BountyPanel } from '../panels/Expedition'
import { WormholeScanTab } from '../panels/WormholeScan'
import { HaulingPanel } from '../panels/Hauling'
import type { GameEngine } from '../game/engine'
import type { PageProps, ToastFn } from './common'
import { isk, MONEY_GLYPH, rareWreckRefsOf } from './common'
import { tr, cmdText } from '../i18n/locale'

/** 星图页的功能区（「星图·远征」放第一：这里本来就是玩家查看大地图的主入口）；icon = Glyphs 字形名 */
export type MapTab = 'star' | 'mine' | 'bounty' | 'salvage' | 'haul' | 'whscan'
/** 跨页跳转目标（2026-09-09 船长定：工业页精炼炉卡「去矿带/去打捞」→ 星图对应卡高亮数秒自清） */
export interface MapGotoTarget {
  tab: 'mine' | 'salvage'
  ids: string[]
  seq: number
}
/**
 * 任务中心**内层**标签定位（2026-09-11 船长：「步骤 2/7 跳转任务中心时，不会切到指定标签页」）。
 * ⚠ **2026-09-14 已迁到 `pages/TaskCenterPage.tsx`**（任务中心搬成独立一级页）；本文件保留**类型再导出**
 * 只为不打断既有 import 路径，新代码请从 `TaskCenterPage` 引。
 */
export type { TaskFocusTarget } from './TaskCenterPage'
export const MAP_TABS: Array<{ key: MapTab; label: string; icon: string }> = [
  { key: 'star', label: tr("ui.MapPage.002"), icon: 'nav-map' },
  { key: 'mine', label: tr("ui.MapPage.003"), icon: 'nav-mine' },
  { key: 'bounty', label: tr("ui.MapPage.004"), icon: 'nav-bounty' },
  { key: 'salvage', label: tr("ui.MapPage.005"), icon: 'nav-salvage' },
  /* 长途运输（2026-09-09 船长：独立出任务中心、置于残骸打捞之后；至少建成一座副空间站解锁） */
  { key: 'haul', label: tr("ui.MapPage.006"), icon: 'nav-haul' },
  /* 任务中心 2026-09-14 已搬成左侧导航的独立一级页（船长：移出星图、放在通讯上方）⇒ 本页不再有该选项卡 */
  /* 扫描虫洞（2026-09-14 船长：放进「出港界面的选项卡内」）：✅ 同日解除不可见 ⇒ **常驻标签**（解锁门槛在页内：协会声望 ≥ 40） */
  { key: 'whscan', label: tr("ui.MapPage.007"), icon: 'nav-wormhole' },
]

/**
 * **星图页签的「第一次」前置**（2026-09-17 船长定：星图相关的采矿/战斗等**先完成「第一次扫描」**）。
 * 值 = `FIRST_UNLOCKS` 的键；表里没有的页签（星图·远征 / 扫描虫洞）⇒ 开局即可用（虫洞另有声望门槛）。
 * **未解锁 = 页签不显示**（船长选「两者都隐藏」——页面与任务都隐藏）；App 层用同一张表做跳转拦截。
 */
export const TAB_UNLOCK_KEY: Partial<Record<MapTab, string>> = {
  mine: 'mapMine',
  bounty: 'mapBounty',
  salvage: 'mapSalvage',
  haul: 'mapHaul',
}

/* 矿带 / 打捞排序（2026-09-09 船长拍板：危险=所在星系安全等级 sec 降序=安全在前，为默认；
 * 选择存本地，键形如 whale-idle:*-sort）。 */
type BeltSortKey = 'danger' | 'galaxy' | 'value' | 'name'
const BELT_SORT_KEY = 'whale-idle:mine-sort'
const BELT_SORT_LABEL: Record<BeltSortKey, string> = {
  danger: tr("ui.MapPage.008"),
  galaxy: tr("ui.MapPage.009"),
  value: tr("ui.MapPage.010"),
  name: tr("ui.MapPage.011"),
}
type WreckSortKey = 'danger' | 'galaxy' | 'density' | 'name'
const WRECK_SORT_KEY = 'whale-idle:salvage-sort'
const WRECK_SORT_LABEL: Record<WreckSortKey, string> = {
  danger: tr("ui.MapPage.008"),
  galaxy: tr("ui.MapPage.009"),
  density: tr("ui.MapPage.012"),
  name: tr("ui.MapPage.001"),
}

export function MapPage({ engine, onToast, mapTab = 'star', onMapTab, mapGoto = null, onOpenWormhole, onExploreWormhole, onAutoExploreWormhole, onGotoFit }: PageProps & {
  mapTab?: MapTab
  onMapTab?: (tab: MapTab) => void
  mapGoto?: MapGotoTarget | null
  /** **开虫洞面板**（船长 2026-09-13「活动栏直接开面板」）：面板本体挂在 App 那一层，这里只把入口按钮接上去 */
  onOpenWormhole?: () => void
  /** 从「扫描虫洞」页选一处库存虫洞开始探索（App 层开面板并带上该库存项） */
  onExploreWormhole?: (stockId: string) => void
  /** 自动探索：打开**与主控探索同一个准备页**（App 层开面板的自动模式；船长 2026-09-14） */
  onAutoExploreWormhole?: (stockId: string) => void
  /**
   * **去「装配」页**（**2026-09-20 船长令**：「打捞需要打捞器的提示，添加让玩家去装配的提示」）：
   * 打捞页在驾驶船没装打捞器时给一行提示 ＋ 一个直接落到该船装配页的按钮。
   */
  onGotoFit?: (shipId: string) => void
}) {
  // 外部跳转高亮（与组装机「去精炼」同款 is-goto 视觉；多目标 = 全部高亮、滚动定位第一张；
  // seq 只在跨页跳转时递增，普通切回本页不重放）
  const [hlIds, setHlIds] = useState<string[]>([])
  const lastGotoSeq = useRef(-1)
  useEffect(() => {
    if (!mapGoto || mapGoto.tab !== mapTab || mapGoto.seq === lastGotoSeq.current) return
    lastGotoSeq.current = mapGoto.seq
    setHlIds(mapGoto.ids)
    const t = window.setTimeout(() => setHlIds([]), 3500)
    const raf = requestAnimationFrame(() => {
      for (const id of mapGoto.ids) {
        const el = document.querySelector(`[data-card-id="${id}"]`)
        if (el) {
          el.scrollIntoView({ block: 'center' })
          break
        }
      }
    })
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapGoto?.seq, mapTab])

  // 长途运输解锁门（2026-09-09 船长）：至少建成一座副空间站（母港之外的第二端点）才有航线
  const builtStationCount = [...engine.ctx.stations.values()].filter((s) => isSiteBuilt(engine.state, s)).length

  return (
    <div className="page-stack page-fill">
      {/* ───── 功能标签页（免滚动切换） ───── */}
      <div className="app-subtabs" role="tablist">
        {/* 「扫描虫洞」标签**常显**（船长 2026-09-14：「可以解除虫洞对玩家的不可见状态了」），
            但**未达解锁门槛时置灰不可点**（船长 2026-09-14 追加 · 乙案）：悬停写明还差多少声望，
            点它只给一条引导、不切标签（与上面「长途运输」那条同一套写法）。

            ⚠ 变更留档：上线批当时按"常显"落码（为了让玩家进去看门槛），本批按船长新裁定改成"置灰"。 */}
        {/* 未过「第一次」前置的页签**不显示**（`TAB_UNLOCK_KEY` 缺项 ⇒ 开局即可用） */}
        {MAP_TABS.filter((t) => unlocked(engine.state, TAB_UNLOCK_KEY[t.key] ?? t.key)).map((t) => {
          /** 「扫描虫洞」未解锁：置灰 + 悬停短提示 + 点击只给引导（判据与页内文案同一把声望尺） */
          const lockedTip =
            t.key === 'whscan' && !engine.wormholeScanUnlocked()
              ? tr("ui.MapPage.078", { WORMHOLE_SCAN_UNLOCK_STANDING: WORMHOLE_SCAN_UNLOCK_STANDING, p2: engine.wormholeScanStanding() })
              : null
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={mapTab === t.key}
              aria-disabled={lockedTip !== null || undefined}
              title={lockedTip ?? undefined}
              className={`app-subtab${mapTab === t.key ? ' is-active' : ''}${lockedTip ? ' is-locked' : ''}`}
              onClick={() => {
                // 长途运输未解锁（未建成副空间站）：点击给引导提示，不切标签
                if (t.key === 'haul' && builtStationCount < 1) {
                  onToast(tr("ui.MapPage.079"), true)
                  return
                }
                // 扫描虫洞未解锁：同样只给引导（悬停另有短提示）
                if (lockedTip) {
                  onToast(lockedTip, true)
                  return
                }
                onMapTab?.(t.key)
              }}
            >
              <span className="app-tab-ico">
                <Glyph name={t.icon} size={15} color={NAV_TONES[t.icon]} />
              </span>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {mapTab === 'mine' ? <MiningTab engine={engine} onToast={onToast} focusIds={mapGoto?.tab === 'mine' ? hlIds : []} /> : null}
      {mapTab === 'star' ? <ExpeditionPanel engine={engine} onToast={onToast} onOpenWormhole={onOpenWormhole} /> : null}
      {mapTab === 'bounty' ? <BountyPanel engine={engine} onToast={onToast} /> : null}
      {mapTab === 'salvage' ? <SalvageTab engine={engine} onToast={onToast} onGotoFit={onGotoFit} focusIds={mapGoto?.tab === 'salvage' ? hlIds : []} /> : null}
      {mapTab === 'haul' ? <HaulingPanel engine={engine} onToast={onToast} /> : null}
      {mapTab === 'whscan' ? (
        <WormholeScanTab
          engine={engine}
          onToast={onToast}
          onExplore={(id) => onExploreWormhole?.(id)}
          onAutoExplore={(id) => onAutoExploreWormhole?.(id)}
          // 「返回虫洞」（船长 2026-09-14）：与活动栏那条同一入口（`App.openWormhole()`）
          onReturn={() => onOpenWormhole?.()}
        />
      ) : null}
    </div>
  )
}

/* ═══════════════ 标签二：矿带开采（矿带 = 常驻矩形卡片，操作入卡） ═══════════════ */

function MiningTab({ engine, onToast, focusIds = [] }: { engine: GameEngine; onToast: ToastFn; focusIds?: readonly string[] }) {
  const state = engine.state
  const view = miningStatus(state, engine.ctx)
  const activeBeltId = view.active ? state.mining.beltId : null
  const [sort, setSort] = useState<BeltSortKey>(() => {
    try {
      const v = localStorage.getItem(BELT_SORT_KEY)
      return v === 'danger' || v === 'galaxy' || v === 'value' || v === 'name' ? v : 'danger'
    } catch {
      return 'danger'
    }
  })

  function changeSort(next: BeltSortKey): void {
    setSort(next)
    try {
      localStorage.setItem(BELT_SORT_KEY, next)
    } catch {
      // 忽略
    }
  }

  // 排序行数据（与矿带卡内效率行同口径：矿石价值 = 每小时产出估价，按物品 baseSellPriceIsk 加权）
  const beltRows = engine.belts.map((belt) => {
    const galaxy = belt.galaxyId ? engine.ctx.galaxies.get(belt.galaxyId) : undefined
    const mp = getMiningParams(state, engine.ctx, { beltId: belt.id })
    let valuePerHour: number | null = null
    if (mp) {
      const cyclesPerHour = 3_600_000 / mp.cycleMs
      const rows = belt.outputs?.length ? belt.outputs : [{ itemId: belt.oreId, weight: 1 }]
      const wsum = rows.reduce((s, r) => s + r.weight, 0)
      let valuePerUnit = 0
      for (const r of rows) {
        const d = engine.ctx.items.get(r.itemId)
        valuePerUnit += (r.weight / wsum) * (d?.baseSellPriceIsk ?? 0)
      }
      valuePerHour = Math.round(Math.round(mp.unitsPerCycle * cyclesPerHour) * valuePerUnit)
    }
    return { belt, galaxyName: galaxy?.name ?? tr('ui.Expedition.007'), sec: galaxy?.security ?? 1, valuePerHour }
  })
  const byBeltName = (x: (typeof beltRows)[number], y: (typeof beltRows)[number]): number =>
    x.belt.name.localeCompare(y.belt.name, 'zh-Hans-CN') || x.belt.id.localeCompare(y.belt.id)
  const sortedBelts = [...beltRows].sort((x, y) => {
    if (sort === 'danger') {
      if (x.sec !== y.sec) return y.sec - x.sec // sec 降序 = 安全在前
      return byBeltName(x, y)
    }
    if (sort === 'galaxy') {
      const g = x.galaxyName.localeCompare(y.galaxyName, 'zh-Hans-CN')
      if (g !== 0) return g
      return byBeltName(x, y)
    }
    if (sort === 'value') {
      const xv = x.valuePerHour ?? -1
      const yv = y.valuePerHour ?? -1
      if (xv !== yv) return yv - xv
      return byBeltName(x, y)
    }
    return byBeltName(x, y)
  })

  function handleStart(beltId: string): void {
    // T4 延后项：远征中（确认后）走"取消远征再开采"转场入口
    const r = state.expedition.active ? engine.startMiningFromExpeditionAt(beltId) : engine.startMiningAt(beltId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.388'), true)
  }

  function handleStop(): void {
    if (engine.stopMiningNow()) onToast(tr("ui.MapPage.080"))
  }

  function handleAiAssign(beltId: string, shipId: string, coreType: AiCoreType): void {
    const r = engine.assignAiMiningAt(shipId, coreType, beltId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.196'), true)
    else onToast(tr("ui.MapPage.081"))
  }

  const phaseText = (): string => {
    if (view.phase === 'outbound') {
      return tr("ui.MapPage.082", { p1: view.shipName || tr('ui.MapPage.117'), p2: view.beltName, p3: formatDurationMs(view.remainingMs ?? 0) })
    }
    if (view.phase === 'returning') {
      return tr("ui.MapPage.083", { p1: view.shipName || tr('ui.MapPage.117'), p2: formatDurationMs(view.remainingMs ?? 0), p3: view.tripUnits.toLocaleString('zh-CN') })
    }
    return tr("ui.MapPage.084", { p1: view.shipName || tr('ui.MapPage.117'), p2: view.beltName, p3: view.tripUnits.toLocaleString('zh-CN') })
  }

  return (
    <Panel
      className="is-fill"
      title={tr("ui.MapPage.013")}
      right={view.active ? <span className="app-dim">{tr("ui.MapPage.014")}</span> : null}
    >
      {/* T1：作业状态与停止入口已收敛到顶部活动窗口；换驾驶=到「舰船」页直接切换（旧船自动返航卸货） */}
      {view.active ? (
        <div className="app-dim app-inv-empty">
          {phaseText()}{tr("ui.MapPage.015")}
        </div>
      ) : (
        <div className="app-dim app-inv-empty">{tr("ui.MapPage.016")}</div>
      )}

      {/* 设置行 */}
      <div className="app-mining-settings">
        <label className="app-check">
          <input
            type="checkbox"
            checked={view.autoCycle}
            disabled={view.active}
            onChange={(e) => engine.setAutoCycleAt(e.target.checked)}
          />
          {tr("ui.MapPage.017")}
        </label>
        <label className="app-check">
          <input
            type="checkbox"
            checked={view.stopAfterTrip}
            disabled={!view.autoCycle || !view.active}
            onChange={(e) => engine.setStopAfterTripAt(e.target.checked)}
          />
          {tr("ui.MapPage.018")}
        </label>
      </div>

      {/* 矿带排序行（默认：危险 = 星系安全等级降序 = 安全在前；选择存本地） */}
      <div className="app-task-sortrow">
        <span className="app-dim">{tr("ui.MapPage.019")}</span>
        <select className="app-select" value={sort} onChange={(e) => changeSort(e.target.value as BeltSortKey)}>
          {(Object.keys(BELT_SORT_LABEL) as BeltSortKey[]).map((k) => (
            <option key={k} value={k}>
              {BELT_SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {/* 矿带一览：矩形卡片挨个排布，主控/AI 操作都在卡内 */}
      <div className="app-belt-grid">
        {sortedBelts.map(({ belt }) => (
          <BeltCard
            key={belt.id}
            belt={belt}
            engine={engine}
            onToast={onToast}
            isActiveBelt={belt.id === activeBeltId}
            focus={focusIds.includes(belt.id)}
            canStart={!view.active}
            onStart={handleStart}
            onStop={handleStop}
            onAiAssign={handleAiAssign}
          />
        ))}
      </div>
    </Panel>
  )
}

/** 一张矿带卡片：信息 + 主控「开始/停止」与「指派 AI」操作容器 */
function BeltCard({
  belt,
  engine,
  onToast,
  isActiveBelt,
  focus = false,
  canStart,
  onStart,
  onStop,
  onAiAssign,
}: {
  belt: BeltDef
  engine: GameEngine
  onToast: ToastFn
  isActiveBelt: boolean
  focus?: boolean
  canStart: boolean
  onStart: (beltId: string) => void
  onStop: () => void
  onAiAssign: (beltId: string, shipId: string, coreType: AiCoreType) => void
}) {
  const state = engine.state
  const oreDef = engine.ctx.items.get(belt.oreId)
  const mv = miningStatus(state, engine.ctx)
  const standing = state.standings['dsi'] ?? 0
  const galaxy = belt.galaxyId ? engine.ctx.galaxies.get(belt.galaxyId) : undefined
  const galaxyName = galaxy?.name ?? tr('ui.Expedition.007')
  // 效率行（试点 2026-09-05）：每循环产量 × 循环时长 → 每小时产出与每小时估价。
  // 估价按物品本身 baseSellPriceIsk（不随市场浮动）；复合带按权重加权期望价值。
  let effLine: string | null = null
  let valLine: string | null = null
  const mp = getMiningParams(state, engine.ctx, { beltId: belt.id })
  if (mp) {
    const cyclesPerHour = 3_600_000 / mp.cycleMs
    const rows = belt.outputs?.length ? belt.outputs : [{ itemId: belt.oreId, weight: 1 }]
    const wsum = rows.reduce((s, r) => s + r.weight, 0)
    let valuePerUnit = 0
    for (const r of rows) {
      const d = engine.ctx.items.get(r.itemId)
      valuePerUnit += (r.weight / wsum) * (d?.baseSellPriceIsk ?? 0)
    }
    const perHourUnits = Math.round(mp.unitsPerCycle * cyclesPerHour)
    const valuePerHour = Math.round(perHourUnits * valuePerUnit)
    const sec = Math.round(mp.cycleMs / 1000)
    effLine = tr("ui.MapPage.085", { p1: mp.unitsPerCycle, sec: sec, p3: perHourUnits.toLocaleString('zh-CN') })
    valLine = tr("ui.MapPage.086", { p1: valuePerHour.toLocaleString('zh-CN') })
  }
  // V13：所在星系未探索的矿带不可开采（卡片可见但锁定，提示先扫描）
  const unexplored = belt.galaxyId ? !isExplored(state, belt.galaxyId) : false
  const locked = (belt.standingReq ?? 0) > standing || unexplored
  const good = oreDef ? marketGoodOf(engine.ctx, 'item', oreDef.id) : undefined
  const quote = good ? marketQuote(state, engine.ctx, good.key) : undefined
  const buy = quote?.buy
  const idleShips = idleAiShipIds(state)
  // 正在此矿带采掘的 AI 副船（右上角徽标计数 + 卡内快速取消）
  const aiWorkers = Object.entries(state.aiAssignments).filter(
    ([, a]) => a.task.kind === 'mining' && a.task.beltId === belt.id,
  ) as Array<[string, { coreType: AiCoreType; task: { kind: 'mining'; beltId: string } }]>
  const aiCount = aiWorkers.length
  const [aiShipId, setAiShipId] = useState('')
  const [aiCoreSel, setAiCoreSel] = useState<AiCoreType>('basic')
  // 2026-09-08 紧急修复（玩家反馈"无法用伽马 AI 核心采矿"）：basic 用光只剩伽马时，
  // 下拉显示与提交类型脱节 → 归一为当前有库存的类型（同工业页炉卡写法）
  const usableCores = AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const effCore = usableCores.includes(aiCoreSel) ? aiCoreSel : (usableCores[0] ?? 'basic')
  // T4 延后项：远征中可「转开采」（两步确认）
  const [mineAsk, setMineAsk] = useState(false)
  const expeditionOn = state.expedition.active

  function mineStartClick(): void {
    if (isActiveBelt) {
      onStop()
      return
    }
    if (!expeditionOn) {
      onStart(belt.id)
      return
    }
    if (state.expedition.phase === 'battle') {
      onToast(tr("ui.MapPage.087"), true)
      return
    }
    if (!mineAsk) {
      setMineAsk(true) // 展开卡片内联警示（替代底部 toast——警示要够明显）
      return
    }
    setMineAsk(false)
    onStart(belt.id)
  }

  function cancelWorker(shipId: string): void {
    if (engine.cancelAiTaskAt(shipId)) onToast(tr("ui.MapPage.088"))
    else onToast(tr("ui.MapPage.077"), true)
  }

  return (
    <div
      className={`app-belt-card${isActiveBelt ? ' is-active' : ''}${locked ? ' is-locked' : ''}${focus ? ' is-goto' : ''}`}
      data-card-id={belt.id}
    >
      <div className="app-belt-head">
        <span className="app-belt-name">
          {belt.name}
          {isActiveBelt ? <em className="app-belt-flag is-run"><span className="app-ico"><Glyph name="nav-mine" size={12} color={NAV_TONES["nav-mine"]} /></span>{tr("ui.MapPage.020")}</em> : null}
          {locked ? (
            unexplored ? (
              <em className="app-belt-flag"><span className="app-ico"><Glyph name="ico-scan" size={12} color={ICO_TONES["ico-scan"]} /></span>{tr("ui.MapPage.021")}</em>
            ) : (
              <em className="app-belt-flag">{tr("ui.MapPage.022")} {belt.standingReq}</em>
            )
          ) : null}
        </span>
        {aiCount > 0 ? (
          <span
            className="app-belt-ai-badge"
            title={tr("ui.MapPage.089", { aiCount: aiCount })}
          >
            <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>×{aiCount}
          </span>
        ) : null}
      </div>
      <div className="app-belt-desc">{belt.description}</div>
      {isActiveBelt ? (
        <div
          className={`app-card-progress${mv.phase !== 'mining' ? ' is-travel' : ''}`}
          title={tr("ui.MapPage.090", { p1: mv.phaseLabel, p2: mv.percent, p3: mv.phase === 'mining' ? tr("ui.MapPage.023") : tr("ui.MapPage.024") })}
        >
          <i style={{ width: `${mv.percent}%` }} />
        </div>
      ) : null}
      <div className="app-belt-ore">
        {tr("ui.MapPage.025")} {galaxyName}{tr('ui.MapPage.112', { ore: oreDef?.name ?? belt.oreId })}{tr('ui.MapPage.113', { v: buy !== undefined ? isk(buy) : '—' })}
        {unexplored ? tr("ui.MapPage.026") : ''}
      </div>
      {effLine || valLine ? (
        <div className="app-belt-econ" title={tr("ui.MapPage.027")}>
          {effLine ? <div><span className="app-ico"><Glyph name="nav-mine" size={12} color={NAV_TONES["nav-mine"]} /></span>{effLine}</div> : null}
          {valLine ? <div className="app-belt-econ-val">{MONEY_GLYPH} {valLine}</div> : null}
        </div>
      ) : null}
      {/* V16 复合矿带：本带可采出的全部产物与权重（每循环按权重抽取一种） */}
      {belt.outputs && belt.outputs.length > 1 ? (
        <div className="app-belt-compose">
          {belt.outputs.map((o) => {
            const def = engine.ctx.items.get(o.itemId)
            return (
              <span key={o.itemId} className="app-belt-compose-item" title={tr("ui.MapPage.091", { p1: o.weight })}>
                {def?.name ?? o.itemId} {o.weight}%
              </span>
            )
          })}
        </div>
      ) : null}

      {/* 操作容器：主控开始/停止 + 本带副船（快速取消）+ AI 指派（副船独立于主控，任何状态可用） */}
      <div className="app-belt-actions">
        {aiWorkers.length > 0 ? (
          <div className="app-belt-workers">
            {aiWorkers.map(([sid, a]) => {
              const aiView = aiTaskView(state, engine.ctx, sid)
              return (
                <div key={sid} className="app-belt-worker is-ai">
                  <div className="app-belt-worker-line">
                    <span className="app-belt-worker-name">
                      <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>{shipDisplayName(state, engine.ctx, sid)}
                      <span className="app-dim">（{aiCoreName(a.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, a.coreType) * 100)}%）</span>
                    </span>
                    <button
                      className="app-btn is-small is-warn"
                      title={tr("ui.MapPage.092", { p1: shipDisplayName(state, engine.ctx, sid) })}
                      onClick={() => cancelWorker(sid)}
                    >
                      {tr("ui.ActivityBar.004")}
                    </button>
                  </div>
                  <div className="app-belt-worker-line">
                    <AiTaskBar view={aiView} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        <button
          className={`app-btn is-small${isActiveBelt ? ' is-warn' : expeditionOn && !mineAsk ? ' is-warn' : ' is-primary'}`}
          disabled={locked || (!isActiveBelt && !canStart) || mineAsk}
          title={
            locked
              ? unexplored
                ? tr("ui.MapPage.028")
                : tr("ui.MapPage.093", { p1: belt.standingReq ?? 0, standing: standing })
              : isActiveBelt
                ? tr("ui.MapPage.029")
                : !canStart
                  ? tr("ui.MapPage.030")
                  : mineAsk
                    ? tr("ui.MapPage.031")
                    : expeditionOn
                      ? tr("ui.MapPage.032")
                      : undefined
          }
          onClick={mineStartClick}
        >
          {isActiveBelt ? tr("ui.MapPage.033") : expeditionOn ? (<><span className="app-ico"><Glyph name="ico-swap" size={13} color={ICO_TONES["ico-swap"]} /></span>{tr("ui.MapPage.034")}</>) : (<><span className="app-ico"><Glyph name="nav-mine" size={13} color={NAV_TONES["nav-mine"]} /></span>{tr("ui.MapPage.035")}</>)}
        </button>
        {/* T4 延后项：远征中转开采的醒目内联警示（取代易忽略的底部提示） */}
        {mineAsk ? (
          <div className="app-ano-switch-confirm">
            <div className="app-sell-warn">
              {tr("ui.MapPage.036")} <b>{tr("ui.MapPage.037")}</b>{tr('ui.MapPage.114')}
              <b> {tr("ui.MapPage.038")}</b>
              {state.autoLoopAnomalyId !== null ? tr("ui.MapPage.039") : ''}{tr('ui.MapPage.115')}{belt.name}{tr("ui.MapPage.040")}
            </div>
            <div className="app-sell-confirm-btns">
              <button className="app-btn is-small is-danger" onClick={mineStartClick}>
                {tr("ui.MapPage.041")}
              </button>
              <button className="app-btn is-small" onClick={() => setMineAsk(false)}>
                {tr("ui.ActivityBar.004")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="app-belt-ai">
          <select className="app-select" value={aiShipId} onChange={(e) => setAiShipId(e.target.value)} title={tr("ui.MapPage.042")}>
            <option value="">{tr("ui.MapPage.043")}</option>
            {idleShips.map((id) => {
              return (
                <option key={id} value={id}>
                  {shipDisplayName(state, engine.ctx, id)}
                </option>
              )
            })}
          </select>
          <select className="app-select" value={effCore} onChange={(e) => setAiCoreSel(e.target.value as AiCoreType)} title={tr("ui.MapPage.044")}>
            {usableCores.map((t) => (
              <option key={t} value={t}>{aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <button
            className="app-btn is-small"
            disabled={locked || !aiShipId || usableCores.length === 0}
            title={locked ? (unexplored ? tr("ui.MapPage.021") : tr("ui.MapPage.094", { p1: belt.standingReq ?? 0 })) : usableCores.length === 0 ? tr("ui.MapPage.045") : aiShipId ? tr("ui.MapPage.046") : tr("ui.MapPage.047")}
            onClick={() => onAiAssign(belt.id, aiShipId, effCore)}
          >
            {tr("ui.MapPage.048")}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ 标签三：残骸打捞（矿带页同款卡片网格；B3 采矿式自动循环） ═══════════════ */

/** 打捞速率与拆解估价（当前驾驶船装配/技能 × 当前密度现算；展示用近似；回收卡同口径共用 RECYCLE_POOL_AVG_ISK） */
function salvageEstimate(state: GameEngine['state'], engine: GameEngine, galaxyId: string, density: number): { eff: string | null; val: string | null } {
  const ctx = engine.ctx
  const cycles = salvagerCyclesOf(state, ctx, state.shipId)
  const anomalies = engine.anomalies.filter((a) => a.galaxyId === galaxyId)
  if (cycles.length === 0 || anomalies.length === 0) {
    return { eff: cycles.length === 0 ? tr("ui.MapPage.049") : null, val: null }
  }
  const roundsPerHour = cycles.reduce((s, c) => s + 3_600_000 / c, 0)
  const avgThreat = anomalies.reduce((s, a) => s + a.threat, 0) / anomalies.length
  const v0 = Math.max(0.1, avgThreat * 0.06)
  const mul = Math.max(0.5, density / 10)
  const diveLv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  const assay = (state.skills.trained['wreck-assaying'] ?? 0) > 0 ? 0.01 * Math.pow(1.2, Math.min(5, state.skills.trained['wreck-assaying'] ?? 0)) : 0
  const volH = roundsPerHour * v0 * mul * (1 + 0.12 * diveLv) * (1 + assay)
  const tier = recycleTierOf(wreckBaseDensity(galaxyId, ctx))
  const refLv = Math.min(5, state.skills.trained['salvage-refining'] ?? 0)
  const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
  const capM3H = 1440 / Math.max(0.6, 1 - 0.04 * recLv) // 回收炉时（周期技能缩短后）
  const effM3 = Math.min(volH, capM3H)
  const evH = Math.round(effM3 * RECYCLE_YIELD_PER_M3[tier] * RECYCLE_POOL_AVG_ISK[tier] * (1 + 0.08 * refLv))
  return {
    eff: tr("ui.MapPage.095", { p1: cycles.length, p2: Math.round(volH).toLocaleString('zh-CN'), p3: volH > capM3H ? tr("ui.MapPage.050") : '' }),
    val: tr("ui.MapPage.096", { p1: isk(evH) }),
  }
}

function SalvageTab({
  engine,
  onToast,
  onGotoFit,
  focusIds = [],
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「去装配」：跳到驾驶船的装配页（本轮船长令：打捞需要打捞器，得有个去装配的入口） */
  onGotoFit?: (shipId: string) => void
  focusIds?: readonly string[]
}) {
  const state = engine.state
  const me = state.salvaging
  const [sort, setSort] = useState<WreckSortKey>(() => {
    try {
      const v = localStorage.getItem(WRECK_SORT_KEY)
      return v === 'danger' || v === 'galaxy' || v === 'density' || v === 'name' ? v : 'danger'
    } catch {
      return 'danger'
    }
  })

  function changeSort(next: WreckSortKey): void {
    setSort(next)
    try {
      localStorage.setItem(WRECK_SORT_KEY, next)
    } catch {
      // 忽略
    }
  }

  // 正在该星系打捞的 AI 副船（名册：快速取消用）
  const aiWorkersBy = new Map<string, Array<{ sid: string; coreType: AiCoreType }>>()
  for (const [sid, a] of Object.entries(state.aiAssignments)) {
    if (a.task.kind === 'salvage') {
      const list = aiWorkersBy.get(a.task.galaxyId) ?? []
      list.push({ sid, coreType: a.coreType })
      aiWorkersBy.set(a.task.galaxyId, list)
    }
  }
  // 2026-09-09 排序（默认危险=sec 降序=安全在前；旧硬排 wreckDensity 降序退役，改为可选「残骸密度最高」）
  const wreckRows = [...engine.ctx.galaxies.values()]
    .filter((g) => isExplored(state, g.id) && engine.anomalies.some((x) => x.galaxyId === g.id))
    .map((g) => ({
      galaxy: g,
      sec: g.security ?? 1,
      density: wreckDensityOf(state, g.id, engine.ctx),
      workers: aiWorkersBy.get(g.id) ?? [],
    }))
  const byWreckName = (x: (typeof wreckRows)[number], y: (typeof wreckRows)[number]): number =>
    x.galaxy.name.localeCompare(y.galaxy.name, 'zh-Hans-CN') || x.galaxy.id.localeCompare(y.galaxy.id)
  const sortedGalaxies = [...wreckRows].sort((x, y) => {
    if (sort === 'danger') {
      if (x.sec !== y.sec) return y.sec - x.sec // sec 降序 = 安全在前
      return byWreckName(x, y)
    }
    if (sort === 'galaxy' || sort === 'name') return byWreckName(x, y)
    if (sort === 'density') {
      if (x.density !== y.density) return y.density - x.density
      return byWreckName(x, y)
    }
    return byWreckName(x, y)
  })
  const idleShips = idleAiShipIds(state)
  /**
   * 驾驶船**一台打捞器都没装**（打捞门槛与 core 同一把尺：`salvagerCyclesOf` 空表 ⇔ 出发会被拒）
   * ⇒ 面板上给一行"去装配"的提示（**2026-09-20 船长令**）。
   */
  const noSalvager = salvagerCyclesOf(state, engine.ctx, state.shipId).length === 0

  const phaseText = (): string => {
    if (!me.active) return tr("ui.MapPage.097", { p1: shipDisplayName(state, engine.ctx, state.shipId) })
    const gName = me.galaxyId ? engine.ctx.galaxies.get(me.galaxyId)?.name : ''
    if (me.phase === 'outbound') return tr("ui.MapPage.098", { p1: shipDisplayName(state, engine.ctx, state.shipId) ?? "", gName: gName ?? "" })
    if (me.phase === 'returning') return tr("ui.MapPage.099", { p1: shipDisplayName(state, engine.ctx, state.shipId), p2: Math.round(me.tripM3 * 100) / 100 })
    return tr("ui.MapPage.100", { p1: shipDisplayName(state, engine.ctx, state.shipId) ?? "", gName: gName ?? "", p3: Math.round(me.tripM3 * 100) / 100 })
  }

  function startAt(galaxyId: string): void {
    const r = engine.startSalvageOpAt(galaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.390'), true)
  }
  function stopNow(): void {
    if (engine.stopSalvageOpNow()) onToast(tr("ui.MapPage.101"))
  }
  function assignAi(galaxyId: string, shipId: string, coreType: AiCoreType): void {
    if (!shipId) {
      onToast(tr("ui.MapPage.102"), true)
      return
    }
    const r = engine.assignAiSalvageAt(shipId, coreType, galaxyId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.ShipPage.196'), true)
    else onToast(tr("ui.MapPage.103"))
  }
  function cancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast(tr("ui.MapPage.104"))
    else onToast(tr("ui.MapPage.077"), true)
  }

  // 循环偏好（与采矿同款：默认自动循环；「本次返航卸货后停止」= 做单趟）
  const autoCycleOn = me.autoCycle !== false
  const stopAfterTripOn = me.stopAfterTrip === true

  return (
    <Panel
      className="is-fill"
      title={tr("ui.MapPage.005")}
      hint={
        <HintIcon tip={tr("ui.MapPage.051")} />
      }
      right={<span className="app-dim">{tr("ui.MapPage.052")}</span>}
    >
      <div className="app-dim app-inv-empty">{phaseText()}</div>

      {/**
       * **打捞需要打捞器 ⇒ 一行提示 ＋ 去「装配」的入口**（**2026-09-20 船长令**：
       * 「打捞需要打捞器的提示，添加让玩家去装配的提示」）。
       * 判据 = 驾驶船当前**一台打捞器都没装**（`salvagerCyclesOf` 空表，与 core 出发门槛同一把尺）；
       * 装的按钮与舰船页那枚「装配」同款（`nav-fit` 字形 ＋ `ui.App.003`），落点是**这艘驾驶船**的装配页。
       */}
      {noSalvager ? (
        <div className="app-dim app-inv-empty app-salvage-need">
          <span>{tr('ui.MapPage.118')}</span>
          {onGotoFit ? (
            <button
              className="app-btn is-small"
              title={tr('ui.FirstTasks.029', { p1: tr('ui.App.003') })}
              onClick={() => onGotoFit(state.shipId)}
            >
              <span className="app-ico">
                <Glyph name="nav-fit" size={13} color={NAV_TONES['nav-fit']} />
              </span>
              {tr('ui.App.003')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 打捞循环设置行（2026-09-09 船长定：与采矿同款；自动循环默认开） */}
      <div className="app-mining-settings">
        <label className="app-check">
          <input
            type="checkbox"
            checked={autoCycleOn}
            disabled={me.active}
            onChange={(e) => engine.setSalvageAutoCycleAt(e.target.checked)}
          />
          {tr("ui.MapPage.053")}
        </label>
        <label className="app-check">
          <input
            type="checkbox"
            checked={stopAfterTripOn}
            disabled={!autoCycleOn || !me.active}
            onChange={(e) => engine.setSalvageStopAfterTripAt(e.target.checked)}
          />
          {tr("ui.MapPage.018")}
        </label>
      </div>

      {sortedGalaxies.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.MapPage.054")}</div>
      ) : (
        <>
          {/* 打捞排序行（默认：危险 = 星系安全等级降序 = 安全在前；选择存本地） */}
          <div className="app-task-sortrow">
            <span className="app-dim">{tr("ui.MapPage.055")}</span>
            <select className="app-select" value={sort} onChange={(e) => changeSort(e.target.value as WreckSortKey)}>
              {(Object.keys(WRECK_SORT_LABEL) as WreckSortKey[]).map((k) => (
                <option key={k} value={k}>
                  {WRECK_SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="app-belt-grid">
            {sortedGalaxies.map(({ galaxy: g, density, workers }) => (
              <WreckCard
                key={g.id}
                galaxy={g}
                density={density}
                aiWorkers={workers}
                isActive={me.active && me.galaxyId === g.id}
                focus={focusIds.includes(g.id)}
                activeAnywhere={me.active}
                idleShips={idleShips}
                engine={engine}
                onStart={() => startAt(g.id)}
                onStop={stopNow}
                onAiAssign={assignAi}
                onAiCancel={cancelAi}
                onToast={onToast}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** 残骸打捞主控作业进度：返航（去程并入）= 行程进度；打捞中 = 主循环周期（最短打捞器周期档）进度 */
function salvageProgressOf(engine: GameEngine): { percent: number; label: string; travel: boolean } | null {
  const s = engine.state.salvaging
  if (!s.active || s.galaxyId === null) return null
  const state = engine.state
  const ctx = engine.ctx
  if (s.phase === 'outbound') {
    const leg = Math.max(1, outboundLegMsFor(state, ctx, s.galaxyId))
    return { percent: Math.min(100, Math.round((s.phaseAccMs / leg) * 100)), label: tr("ui.MapPage.056"), travel: true }
  }
  if (s.phase === 'returning') {
    // 返航腿 = 满载返航 + 空船去程（去程并入返航）
    const leg = Math.max(1, legMsFor(state, ctx, s.galaxyId) + outboundLegMsFor(state, ctx, s.galaxyId))
    return { percent: Math.min(100, Math.round((s.phaseAccMs / leg) * 100)), label: tr("ui.MapPage.057"), travel: true }
  }
  const cycles = salvagerCyclesOf(state, ctx, state.shipId)
  const step = cycles.length > 0 ? Math.min(...cycles) : 0
  return {
    percent: step > 0 ? Math.min(100, Math.round((s.cycleAccMs / step) * 100)) : 0,
    label: tr("ui.MapPage.105", { p1: cycles.length }),
    travel: false,
  }
}

/** 一张星系残骸卡：密度/效率估价 + 副船名册（快速取消）+ 主控按钮 + AI 指派条 */
function WreckCard({
  galaxy: g,
  density,
  aiWorkers,
  isActive,
  focus = false,
  activeAnywhere,
  idleShips,
  engine,
  onStart,
  onStop,
  onAiAssign,
  onAiCancel,
  onToast,
}: {
  galaxy: GalaxyDef
  density: number
  aiWorkers: Array<{ sid: string; coreType: AiCoreType }>
  isActive: boolean
  focus?: boolean
  activeAnywhere: boolean
  idleShips: string[]
  engine: GameEngine
  onStart: () => void
  onStop: () => void
  onAiAssign: (galaxyId: string, shipId: string, coreType: AiCoreType) => void
  onAiCancel: (shipId: string) => void
  onToast: ToastFn
}) {
  const state = engine.state
  const anomalies = engine.anomalies.filter((a) => a.galaxyId === g.id)
  const est = salvageEstimate(state, engine, g.id, density)
  const prog = isActive ? salvageProgressOf(engine) : null
  const [aiShipId, setAiShipId] = useState('')
  const [aiCoreSel, setAiCoreSel] = useState<AiCoreType>('basic')
  // 2026-09-08 紧急修复：核心下拉与提交类型脱节（basic 无库存时仍按 basic 提交被拒）
  const usableCores = AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const effCore = usableCores.includes(aiCoreSel) ? aiCoreSel : (usableCores[0] ?? 'basic')
  const lowSec = typeof g.security === 'number' && g.security < 0
  // B3.1：星系卡「回收产出倾向 / 特色掉落」汇总（= 该星系各悬赏敌群**所属的残骸组**；回收卡同款行，去重合并）。
  // 2026-09-10 船长定"说明精简"：特色掉落只讲特色（主题件具名 + 系列泛化），星图卡不加保底矿物块。
  // 2026-09-19 残骸合并：卡级特色已退役 ⇒ 改按**组**去重（同族同地区的多张卡只算一份）。
  const notes: string[] = []
  const namedList: string[] = []
  const genericList: string[] = []
  const groupKeys: string[] = []
  for (const a of anomalies) {
    const group = wreckGroupOfAnomaly(a.id)
    if (!group || groupKeys.includes(group.key)) continue
    groupKeys.push(group.key)
    if (group.note.length > 0 && !notes.includes(group.note)) notes.push(group.note)
    const feature = recycleFeatureOf(
      { lowSec, threat: group.threat, loot: group.theme },
      { mods: engine.ctx.modules, items: engine.ctx.items },
    )
    for (const p of feature.named) if (!namedList.includes(p)) namedList.push(p)
    for (const p of feature.generic) if (!genericList.includes(p)) genericList.push(p)
  }
  const flavorNote = notes.slice(0, 3).join('；') + (notes.length > 3 ? tr("ui.MapPage.106", { p1: notes.length }) : '')
  // 汇总去重后仍限长：具名优先（星图卡是多敌群合并，可能很长）
  const cap = (list: string[]): string[] => list.slice(0, 4).concat(list.length > 4 ? [tr("ui.MapPage.107", { p1: list.length })] : [])
  const flavorLabel = namedList.length > 0 ? tr("ui.MapPage.058") : tr("ui.MapPage.059")
  // 赏金任务·窝点战果（2026-09-10 船长定）：该星系留下的稀有残骸（打捞必得；回站回收炉开高级箱）
  // 2026-09-11：口径抽到 `pages/common.rareWreckRefsOf`，与星图「星系行动」弹窗共用一份
  const { count: rareCount, text: rareText } = rareWreckRefsOf(engine, g.id)

  return (
    <div
      className={`app-belt-card${isActive ? ' is-active' : ''}${focus ? ' is-goto' : ''}`}
      data-card-id={g.id}
    >
      <div className="app-belt-head">
        <span className="app-belt-name">
          {g.name}
          {isActive ? <em className="app-belt-flag is-run"><span className="app-ico"><Glyph name="nav-salvage" size={12} color={NAV_TONES["nav-salvage"]} /></span>{tr("ui.MapPage.060")}</em> : null}
          {lowSec ? <em className="app-belt-flag">{tr("ui.MapPage.061")}</em> : null}
        </span>
        {aiWorkers.length > 0 ? (
          <span className="app-belt-ai-badge" title={tr("ui.MapPage.108", { p1: aiWorkers.length })}>
            <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>×{aiWorkers.length}
          </span>
        ) : null}
      </div>
      <div className="app-belt-desc">{tr("ui.MapPage.062")} {anomalies.length} {tr("ui.MapPage.063")}</div>
      <FlavorTip
        note={flavorNote}
        featureLabel={flavorLabel}
        named={cap(namedList)}
        generic={cap(genericList)}
      />
      {prog ? (
        <div
          className={`app-card-progress${prog.travel ? ' is-travel' : ''}`}
          title={tr("ui.MapPage.109", { p1: prog.label, p2: prog.percent })}
        >
          <i style={{ width: `${prog.percent}%` }} />
        </div>
      ) : null}
      <div className="app-belt-ore">
        {tr("ui.MapPage.064")} <b>{density.toFixed(1)}</b>
        {lowSec ? tr("ui.MapPage.065") : ''}{tr('ui.MapPage.116', { v: g.security?.toFixed(1) ?? '—' })}
        {rareCount > 0 ? (
          <>
            {' · '}
            <em className="app-chip is-rare" title={tr("ui.MapPage.110", { rareText: rareText, RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3 })}>
              {tr("ui.MapPage.066")}{rareCount}
            </em>
          </>
        ) : null}
      </div>
      {est.eff || est.val ? (
        <div className="app-belt-econ" title={tr("ui.MapPage.067")}>
          {est.eff ? <div><span className="app-ico"><Glyph name="nav-salvage" size={12} color={NAV_TONES["nav-salvage"]} /></span>{est.eff}</div> : null}
          {est.val ? <div className="app-belt-econ-val">{MONEY_GLYPH} {est.val}</div> : null}
        </div>
      ) : null}

      <div className="app-belt-actions">
        {aiWorkers.length > 0 ? (
          <div className="app-belt-workers">
            {aiWorkers.map((w) => {
              const aiView = aiTaskView(state, engine.ctx, w.sid)
              return (
                <div key={w.sid} className="app-belt-worker is-ai">
                  <div className="app-belt-worker-line">
                    <span className="app-belt-worker-name">
                      <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>{shipDisplayName(state, engine.ctx, w.sid)}
                      <span className="app-dim">（{aiCoreName(w.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, w.coreType) * 100)}%）</span>
                    </span>
                    <button
                      className="app-btn is-small is-warn"
                      title={tr("ui.MapPage.111", { p1: shipDisplayName(state, engine.ctx, w.sid) })}
                      onClick={() => onAiCancel(w.sid)}
                    >
                      {tr("ui.ActivityBar.004")}
                    </button>
                  </div>
                  <div className="app-belt-worker-line">
                    <AiTaskBar view={aiView} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {isActive ? (
          <button className="app-btn is-small is-warn" onClick={onStop}>
            {tr("ui.MapPage.068")}
          </button>
        ) : (
          <button
            className="app-btn is-small is-primary"
            disabled={activeAnywhere}
            title={activeAnywhere ? tr("ui.MapPage.069") : tr("ui.MapPage.070")}
            onClick={onStart}
          >
            <span className="app-ico"><Glyph name="nav-salvage" size={13} color={NAV_TONES["nav-salvage"]} /></span>{tr("ui.MapPage.071")}
          </button>
        )}
        <div className="app-belt-ai">
          <select className="app-select" value={aiShipId} onChange={(e) => setAiShipId(e.target.value)} title={tr("ui.MapPage.072")}>
            <option value="">{tr("ui.MapPage.043")}</option>
            {idleShips.map((id) => (
              <option key={id} value={id}>
                {shipDisplayName(state, engine.ctx, id)}
              </option>
            ))}
          </select>
          <select className="app-select" value={effCore} onChange={(e) => setAiCoreSel(e.target.value as AiCoreType)} title={tr("ui.MapPage.073")}>
            {usableCores.map((t) => (
              <option key={t} value={t}>{aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <button
            className="app-btn is-small"
            disabled={activeAnywhere || !aiShipId || usableCores.length === 0}
            title={activeAnywhere ? tr("ui.MapPage.074") : usableCores.length === 0 ? tr("ui.MapPage.045") : aiShipId ? tr("ui.MapPage.075") : tr("ui.MapPage.047")}
            onClick={() => onAiAssign(g.id, aiShipId, effCore)}
          >
            {tr("ui.MapPage.076")}
          </button>
        </div>
      </div>
    </div>
  )
}
