import { useEffect, useRef, useState } from 'react'
import {
  aiEfficiency,
  aiTaskView,
  usableAiCoresOf,
  getMiningParams,
  beltYieldRows,
  beltValuePerHour,
  idleAiShipIds,
  isExplored,
  isSiteBuilt,
  marketGoodOf,
  marketQuote,
  miningStatus,
  salvageFleetCyclesOf,
  salvageReturnMs,
  outboundLegMsFor,
  shipDisplayName,
  wreckDensityOf,
  WEEKEND_WRECK_TARGET,
  weekendWreckDensityOf,
  weekendRareWreckCountOf,
  RARE_WRECK_VOLUME_M3,
  wreckGroupOfAnomaly,
  shipWrecksOf,
  hullRecoveryChanceOf,
  wreckEquipmentRecoveryChanceOf,
  wreckLootRowsOf,
  SHIP_WRECK_DECAY_MS,
  standingOf,
  DSI_FACTION_ID,
} from '@whale/core'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, BeltDef, GalaxyDef } from '@whale/core'
import type { ShipWreckRecord } from '@whale/core'
import { unlocked, WORMHOLE_SCAN_UNLOCK_STANDING } from '@whale/core'
import { NetIncomeLinePerHour, YieldLines, yieldLinesOf, marketPriceOf, type YieldRow } from '../ui/yieldView'
import { Panel } from '@whale/ui'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { aiCoreText } from '../ui/labelsText'
import { FlavorTip, recycleFeatureOf } from '../ui/wreckFlavor'
import { AiTaskBar } from '../ui/aiProgress'
import { ExpeditionPanel, BountyPanel } from '../panels/Expedition'
import { WormholeScanTab } from '../panels/WormholeScan'
import { HaulingPanel } from '../panels/Hauling'
import type { GameEngine } from '../game/engine'
import type { PageProps, ToastFn } from './common'
import { isk, rareWreckRefsOf } from './common'
import { invasionWreckRowsOf, wreckAiHostOf, wreckCardSequenceOf } from './wreckCards'
import { isEn, tr, cmdText } from '../i18n/locale'
import { wreckGroupText } from '@whale/data'
import { fmtDuration } from '../i18n/fmt'

export type MapTab = 'star' | 'mine' | 'bounty' | 'salvage' | 'haul' | 'whscan'
export interface MapGotoTarget {
  tab: 'mine' | 'salvage'
  ids: string[]
  seq: number
}
export type { TaskFocusTarget } from './TaskCenterPage'
export const MAP_TABS: Array<{ key: MapTab; label: string; icon: string }> = [
  { key: 'star', get label() { return tr("ui.MapPage.002") }, icon: 'nav-map' },
  { key: 'mine', get label() { return tr("ui.MapPage.003") }, icon: 'nav-mine' },
  { key: 'bounty', get label() { return tr("ui.MapPage.004") }, icon: 'nav-bounty' },
  { key: 'salvage', get label() { return tr("ui.MapPage.005") }, icon: 'nav-salvage' },
  { key: 'haul', get label() { return tr("ui.MapPage.006") }, icon: 'nav-haul' },
  { key: 'whscan', get label() { return tr("ui.MapPage.007") }, icon: 'nav-wormhole' },
]

export const TAB_UNLOCK_KEY: Partial<Record<MapTab, string>> = {
  mine: 'mapMine',
  bounty: 'mapBounty',
  salvage: 'mapSalvage',
  haul: 'mapHaul',
}

type BeltSortKey = 'danger' | 'galaxy' | 'value' | 'name'
const BELT_SORT_KEY = 'whale-idle:mine-sort'
const BELT_SORT_LABEL: Record<BeltSortKey, string> = {
  get danger() { return tr("ui.MapPage.008") },
  get galaxy() { return tr("ui.MapPage.009") },
  get value() { return tr("ui.MapPage.010") },
  get name() { return tr("ui.MapPage.011") },
}
type WreckSortKey = 'danger' | 'galaxy' | 'density' | 'name'
const WRECK_SORT_KEY = 'whale-idle:salvage-sort'
const WRECK_SORT_LABEL: Record<WreckSortKey, string> = {
  get danger() { return tr("ui.MapPage.008") },
  get galaxy() { return tr("ui.MapPage.009") },
  get density() { return tr("ui.MapPage.012") },
  get name() { return tr("ui.MapPage.001") },
}

export function MapPage({ engine, onToast, mapTab = 'star', onMapTab, mapGoto = null, onOpenWormhole, onExploreWormhole, onAutoExploreWormhole, onGotoFit, bountyShopSeq = 0 }: PageProps & {
  mapTab?: MapTab
  onMapTab?: (tab: MapTab) => void
  mapGoto?: MapGotoTarget | null
  onOpenWormhole?: () => void
  onExploreWormhole?: (stockId: string) => void
  onAutoExploreWormhole?: (stockId: string) => void
  onGotoFit?: (shipId: string) => void
  bountyShopSeq?: number
}) {
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
      {mapTab === 'bounty' ? <BountyPanel engine={engine} onToast={onToast} focusShopSeq={bountyShopSeq} /> : null}
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
    }
  }

  const beltRows = engine.belts.map((belt) => {
    const galaxy = belt.galaxyId ? engine.ctx.galaxies.get(belt.galaxyId) : undefined
    const valuePerHour = beltValuePerHour(state, engine.ctx, belt, (id) => marketPriceOf(state, engine.ctx, id))
    return { belt, galaxyName: galaxy?.name ?? tr('ui.Expedition.007'), sec: galaxy?.security ?? 1, valuePerHour }
  })
  const byBeltName = (x: (typeof beltRows)[number], y: (typeof beltRows)[number]): number =>
    x.belt.name.localeCompare(y.belt.name, 'zh-Hans-CN') || x.belt.id.localeCompare(y.belt.id)
  const sortedBelts = [...beltRows].sort((x, y) => {
    if (sort === 'danger') {
      if (x.sec !== y.sec) return y.sec - x.sec
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
      return tr("ui.MapPage.082", { p1: view.shipName || tr('ui.MapPage.117'), p2: view.beltName, p3: fmtDuration(view.remainingMs ?? 0) })
    }
    if (view.phase === 'returning') {
      return tr("ui.MapPage.083", { p1: view.shipName || tr('ui.MapPage.117'), p2: fmtDuration(view.remainingMs ?? 0), p3: view.tripUnits.toLocaleString('zh-CN') })
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
            onStart={handleStart}
            onStop={handleStop}
            onAiAssign={handleAiAssign}
          />
        ))}
      </div>
    </Panel>
  )
}

function BeltCard({
  belt,
  engine,
  onToast,
  isActiveBelt,
  focus = false,
  onStart,
  onStop,
  onAiAssign,
}: {
  belt: BeltDef
  engine: GameEngine
  onToast: ToastFn
  isActiveBelt: boolean
  focus?: boolean
  onStart: (beltId: string) => void
  onStop: () => void
  onAiAssign: (beltId: string, shipId: string, coreType: AiCoreType) => void
}) {
  const state = engine.state
  const oreDef = engine.ctx.items.get(belt.oreId)
  const mv = miningStatus(state, engine.ctx)
  const standing = standingOf(state, DSI_FACTION_ID)
  const galaxy = belt.galaxyId ? engine.ctx.galaxies.get(belt.galaxyId) : undefined
  const galaxyName = galaxy?.name ?? tr('ui.Expedition.007')
  const yieldRows: YieldRow[] = []
  let effLine: string | null = null
  const mp = getMiningParams(state, engine.ctx, { beltId: belt.id })
  if (mp) {
    const rows = beltYieldRows(state, engine.ctx, belt) ?? []
    for (const r of rows) {
      yieldRows.push({ itemId: r.itemId, perHour: Math.round(r.perHour) })
    }
    const sec = Math.round(mp.cycleMs / 1000)
    effLine = tr("ui.MapPage.085", { p1: mp.unitsPerCycle, sec: sec })
  }
  const unexplored = belt.galaxyId ? !isExplored(state, belt.galaxyId) : false
  const locked = (belt.standingReq ?? 0) > standing || unexplored
  const good = oreDef ? marketGoodOf(engine.ctx, 'item', oreDef.id) : undefined
  const quote = good ? marketQuote(state, engine.ctx, good.key) : undefined
  const buy = quote?.buy
  const idleShips = idleAiShipIds(state)
  const aiWorkers = Object.entries(state.aiAssignments).filter(
    ([, a]) => a.task.kind === 'mining' && a.task.beltId === belt.id,
  ) as Array<[string, { coreType: AiCoreType; task: { kind: 'mining'; beltId: string } }]>
  const aiCount = aiWorkers.length
  const [aiShipId, setAiShipId] = useState('')
  const [aiCoreSel, setAiCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const effCore = usableCores.includes(aiCoreSel) ? aiCoreSel : (usableCores[usableCores.length - 1] ?? 'basic')
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
      setMineAsk(true)
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
            className="app-belt-ai-badge is-work-mine"
            title={tr("ui.MapPage.089", { aiCount: aiCount })}
          >
            {/* 图标不传色 ⇒ 继承徽标墨色（同「残骸打捞」那张卡的徽标；理由见 `WreckCard` 里那段注释）。
                底色 = **采矿作业色**（`is-work-mine`，**2026-10-02 船长令「按你推荐来」**）：
                徽标挂在矿带卡上 ⇒ 一眼看出这一枚 AI 在采矿。 */}
            <span className="app-ico"><Glyph name="nav-ai" size={12} /></span>×{aiCount}
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
      {effLine || yieldRows.length > 0 ? (
        <div className="app-belt-econ" title={tr("ui.MapPage.027")}>
          {effLine ? <div><span className="app-ico"><Glyph name="nav-mine" size={12} color={NAV_TONES["nav-mine"]} /></span>{effLine}</div> : null}
          {/* 产出逐项列（2026-09-23 船长令）：原来的「≈N ISK/h」折算值已彻底拿掉 */}
          <YieldLines lines={yieldLinesOf(state, engine.ctx, yieldRows)} />
          {/**
           * **净收益/h（仅调试模式 · 2026-09-29 船长令「希望在调试模式下看到各个活动的净收益」）**：
           * 采矿是**连续型活动**（没有"批"与"周期"）⇒ 净/h = Σ(每小时产出 × 行情价)，**无耗料成本可扣**。
           * 行情取数与上面那行「行情 P」同一把尺（`marketPriceOf`）。发布版不渲染。
           */}
          <NetIncomeLinePerHour
            rows={yieldRows.map((r) => ({ perHour: r.perHour ?? 0, price: marketPriceOf(state, engine.ctx, r.itemId) }))}
          />
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
                      <span className="app-dim">（{aiCoreText(a.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, a.coreType) * 100)}%）</span>
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
          disabled={locked || mineAsk}
          title={
            locked
              ? unexplored
                ? tr("ui.MapPage.028")
                : tr("ui.MapPage.093", { p1: belt.standingReq ?? 0, standing: standing })
              : isActiveBelt
                ? tr("ui.MapPage.029")
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
              <option key={t} value={t}>{aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
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


function salvageEstimate(
  state: GameEngine['state'],
  engine: GameEngine,
  galaxyId: string,
  density: number,
): { eff: string | null } {
  const ctx = engine.ctx
  const cycles = salvageFleetCyclesOf(state, ctx, !state.salvaging.active || state.salvaging.galaxyId !== galaxyId)
  const anomalies = [...engine.ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === galaxyId)
  if (cycles.length === 0 || anomalies.length === 0) {
    return { eff: cycles.length === 0 ? tr("ui.MapPage.049") : null }
  }
  const roundsPerHour = cycles.reduce((s, c) => s + 3_600_000 / c, 0)
  const avgThreat = anomalies.reduce((s, a) => s + a.threat, 0) / anomalies.length
  const v0 = Math.max(0.1, avgThreat * 0.06)
  const mul = Math.max(0.5, density / 10)
  const diveLv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  const assay = (state.skills.trained['wreck-assaying'] ?? 0) > 0 ? 0.01 * Math.pow(1.2, Math.min(5, state.skills.trained['wreck-assaying'] ?? 0)) : 0
  const volH = roundsPerHour * v0 * mul * (1 + 0.12 * diveLv) * (1 + assay)
  return {
    eff: tr("ui.MapPage.095", { p1: cycles.length, p2: Math.round(volH).toLocaleString('zh-CN'), p3: '' }),
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
    }
  }

  const aiWorkersBy = new Map<string, Array<{ sid: string; coreType: AiCoreType }>>()
  for (const [sid, a] of Object.entries(state.aiAssignments)) {
    if (a.task.kind === 'salvage') {
      const list = aiWorkersBy.get(a.task.galaxyId) ?? []
      list.push({ sid, coreType: a.coreType })
      aiWorkersBy.set(a.task.galaxyId, list)
    }
  }
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
  const pinTierOf = (x: (typeof wreckRows)[number]): number => {
    if (shipWrecksOf(state, x.galaxy.id).length > 0) return 0
    if (weekendWreckDensityOf(state, x.galaxy.id) > 0 || weekendRareWreckCountOf(state, x.galaxy.id) > 0) return 1
    return 2
  }
  const sortedGalaxies = [...wreckRows].sort((x, y) => {
    const pin = pinTierOf(x) - pinTierOf(y)
    if (pin !== 0) return pin
    if (sort === 'danger') {
      if (x.sec !== y.sec) return y.sec - x.sec
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
      {/**
       * ⚠ **2026-09-26 船长令**：「**残骸打捞页面的说明文本太多了。只留第三行打捞需要打捞器：
       * 先在「装配」页给驾驶船的高槽装一台（MK1/2/3）和装配按钮。其余删除**」
       * ⇒ 本页**只剩这一行说明**（原"当前未在打捞 / 打捞对象自动判定"两行已删）；
       * 打捞对象由 core 自动判定（优先入侵残骸 ⇒ 否则按各组存量比同步捞），读数在各张卡上。
       * **打捞需要打捞器 ⇒ 一行提示 ＋ 去「装配」的入口**（**2026-09-20 船长令**：
       * 「打捞需要打捞器的提示，添加让玩家去装配的提示」）。
       * ⚠ **2026-09-26 船长复令：「常驻显示，现在位置不变」** ⇒ 原先 `noSalvager ? … : null` 的
       * 条件**已去掉**：无论有没有装打捞器，这一行都常住在正文同一位置（装配入口也常在）。
       * 按钮与舰船页那枚「装配」同款（`nav-fit` 字形 ＋ `ui.App.003`），落点是**这艘驾驶船**的装配页。
       */}
      {/* 打捞前置提示：**常驻**（2026-09-26 船长复令「常驻显示，现在位置不变」）——一行文字 ＋ 装配入口 */}
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
            {/**
             * **一个星系最多三张卡，按优先序排**（**2026-09-26 船长报障与建议**：「**之前残留的手动选择残骸的卡片
             * 还遗留在残骸打捞页面内**」＋「**建议在残骸打捞页面内，有玩家舰船残骸的卡片置顶，其次是有入侵残骸的**」）：
             *
             * 1. **玩家舰船残骸卡**（有才出）——四级序最高优先，卡上直接给「开始打捞」；
             * 2. **入侵残骸卡**（有才出）——独立残骸场，48h 衰减、先捞它最划算；
             * 3. **星系残骸（全部）卡**——常规密度，带**各组存量读数**；**AI 那一套（指派条 ＋ 徽标 ＋
             *    副船名册）挂"置顶那张卡"**（`wreckAiHostOf`，见其头注）。
             *
             * ⚠ **每组的"手动选择"卡已撤**：打捞对象自 2026-09-26 起由 core 自动判定
             * （「分组后不要再让玩家手动选择打捞对象了……优先打捞入侵残骸，没有入侵残骸则是根据两种残骸的
             * 数量比同步打捞」）⇒ 那些卡上的「开始打捞」本来就是同一个动作、纯属残留；
             * **各组存量改成"全部"卡上的一行读数**（信息没丢，只是不再假装可选）。
             *
             * ⚠ **跨星系置顶**（船长 2026-09-26 复问「残骸打捞的相关置顶是不是还没做」后补齐）：
             * 星系之间的顺序由 `sortedGalaxies` 的分级给出——**第 0 档 = 有玩家舰船残骸**、
             * **第 1 档 = 有入侵残骸**、第 2 档 = 其余；同档内才走玩家选的排序。见 `pinTierOf` 头注。
             */}
            {sortedGalaxies.flatMap(({ galaxy: g, density, workers }) => {
              const targets = engine.salvageTargetsAt(g.id, true) // 只读（渲染期不写档）
              const wrecks = shipWrecksOf(state, g.id)
              const invWreck = weekendWreckDensityOf(state, g.id)
              /** **入侵残骸场里的箱子**（2026-09-27 船长令）：矿物可能被捞干、箱子还在 ⇒ 读数与卡序都要看它 */
              const invRare = weekendRareWreckCountOf(state, g.id)
              const invasionRows = invasionWreckRowsOf(state, engine.ctx, g.id)
              const groupRows = targets.filter((t) => t.groupKey !== WEEKEND_WRECK_TARGET)
              /** 卡片序列 = 纯函数（同一个星系最多三张；顺序即优先级，见 `wreckCardSequenceOf` 头注） */
              const cardSeq = wreckCardSequenceOf({
                shipWreckCount: wrecks.length,
                invasionWreckM3: invWreck,
                invasionRareCount: invRare,
              })
              const mk = (opts: { key: string; label: string; cardDensity: number; showAi?: boolean; showGroupRows?: boolean; invasionPool?: typeof invasionRows[number] }) => (
                <WreckCard
                  key={`${g.id}|${opts.key}`}
                  galaxy={g}
                  density={opts.cardDensity}
                  densityLabel={opts.label}
                  groupRows={groupRows}
                  shipWrecks={opts.key === 'ship-wrecks' ? wrecks : []}
                  invasionPool={opts.invasionPool}
                  aiWorkers={opts.showAi ? workers : []}
                  isActive={me.active && me.galaxyId === g.id}
                  focus={focusIds.includes(g.id)}
                  idleShips={idleShips}
                  engine={engine}
                  onStart={() => startAt(g.id)}
                  onStop={stopNow}
                  onAiAssign={assignAi}
                  onAiCancel={cancelAi}
                  onToast={onToast}
                  showAi={opts.showAi === true}
                  showGroupRows={opts.showGroupRows === true}
                />
              )
              /**
               * **AI 那一套（指派条 ＋ 徽标 ＋ 副船名册）挂"置顶那张卡"**（船长 2026-10-02 报障
               * 「入侵残骸的打捞片无法指派AI」）：原先是只挂「全部」卡 ⇒ 有入侵残骸时玩家看的是
               * 上面那张、指派条却压在下面那张。规则见 `wreckAiHostOf` 头注（一处入口、不重复名册）。
               * **各组存量读数仍只归「全部」卡**（那行与 AI 无关）⇒ 两个开关分开传。
               */
              const aiHost = wreckAiHostOf(cardSeq)
              return cardSeq.flatMap((kind) => {
                const aiHere = kind === aiHost
                const rowsHere = kind === 'all'
                if (kind === 'ship-wrecks') {
                  return mk({
                    key: 'ship-wrecks',
                    label: tr('ui.weekend.110', { p1: String(wrecks.length) }),
                    cardDensity: 0,
                    showAi: aiHere,
                    showGroupRows: rowsHere,
                  })
                }
                if (kind === 'invasion') {
                  return invasionRows.map((row, i) => mk({
                    key: `${WEEKEND_WRECK_TARGET}:${row.key}`,
                    label: row.name ?? tr('ui.MapPage.121'),
                    cardDensity: row.density,
                    showAi: aiHere && i === 0,
                    invasionPool: row,
                  }))
                }
                return mk({ key: '', label: tr('ui.MapPage.120'), cardDensity: density, showAi: aiHere, showGroupRows: rowsHere })
              })
            })}
          </div>
        </>
      )}
    </Panel>
  )
}

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
    const leg = salvageReturnMs(state, ctx, s.galaxyId)
    return { percent: Math.min(100, Math.round((s.phaseAccMs / leg) * 100)), label: tr("ui.MapPage.057"), travel: true }
  }
  const cycles = salvageFleetCyclesOf(state, ctx)
  const step = cycles.length > 0 ? Math.min(...cycles) : 0
  return {
    percent: step > 0 ? Math.min(100, Math.round((s.cycleAccMs / step) * 100)) : 0,
    label: tr("ui.MapPage.105", { p1: cycles.length }),
    travel: false,
  }
}

function WreckCard({
  galaxy: g,
  density,
  densityLabel,
  showAi = false,
  showGroupRows = false,
  aiWorkers,
  isActive,
  focus = false,
  idleShips,
  engine,
  onStart,
  onStop,
  onAiAssign,
  onAiCancel,
  groupRows = [],
  shipWrecks = [],
  invasionPool,
}: {
  galaxy: GalaxyDef
  density: number
  densityLabel?: string
  showAi?: boolean
  showGroupRows?: boolean
  groupRows?: Array<{ groupKey: string; stockM3: number }>
  invasionPool?: ReturnType<typeof invasionWreckRowsOf>[number]
  shipWrecks?: ShipWreckRecord[]
  aiWorkers: Array<{ sid: string; coreType: AiCoreType }>
  isActive: boolean
  focus?: boolean
  idleShips: string[]
  engine: GameEngine
  onStart: () => void
  onStop: () => void
  onAiAssign: (galaxyId: string, shipId: string, coreType: AiCoreType) => void
  onAiCancel: (shipId: string) => void
  onToast: ToastFn
}) {
  const state = engine.state
  const anomalies = [...engine.ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === g.id)
  const est = salvageEstimate(state, engine, g.id, density)
  const prog = isActive ? salvageProgressOf(engine) : null
  const [aiShipId, setAiShipId] = useState('')
  const [aiCoreSel, setAiCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const effCore = usableCores.includes(aiCoreSel) ? aiCoreSel : (usableCores[usableCores.length - 1] ?? 'basic')
  const lowSec = typeof g.security === 'number' && g.security < 0
  const notes: string[] = []
  const namedList: string[] = []
  const genericList: string[] = []
  const groupKeys: string[] = []
  for (const a of anomalies) {
    const group = wreckGroupOfAnomaly(a.id)
    if (!group || groupKeys.includes(group.key)) continue
    groupKeys.push(group.key)
    if (group.note.length > 0) {
      const note = wreckGroupText(group.key, isEn() ? 'en' : 'zh', 'note') ?? group.note
      if (!notes.includes(note)) notes.push(note)
    }
    const feature = recycleFeatureOf(
      { lowSec, threat: group.threat, loot: group.theme },
      { mods: engine.ctx.modules, items: engine.ctx.items },
    )
    for (const p of feature.named) if (!namedList.includes(p)) namedList.push(p)
    for (const p of feature.generic) if (!genericList.includes(p)) genericList.push(p)
  }
  const flavorNote = notes.slice(0, 3).join('；') + (notes.length > 3 ? tr("ui.MapPage.106", { p1: notes.length }) : '')
  const cap = (list: string[]): string[] => list.slice(0, 4).concat(list.length > 4 ? [tr("ui.MapPage.107", { p1: list.length })] : [])
  const flavorLabel = namedList.length > 0 ? tr("ui.MapPage.058") : tr("ui.MapPage.059")
  const refs = rareWreckRefsOf(engine, g.id)
  const rareCount = invasionPool ? invasionPool.rare : refs.count
  const rareText = invasionPool ? invasionPool.name ?? tr('ui.MapPage.121') : refs.text

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
          <span className="app-belt-ai-badge is-work-salvage" title={tr("ui.MapPage.108", { p1: aiWorkers.length })}>
            {/**
             * ⚠ **图标不传色**（**船长 2026-10-02 报障**：「**卡片内 AI 工作的图标（卡片右上角的那个）
             * 颜色不对**」）：本徽标底色是**作业活动色**、文字是**墨色**（`--wui-x222`），而图标原先传
             * `NAV_TONES['nav-ai']`（默认主题 = **品红 255 138 181**）⇒ 浅色图标压在浅底上，
             * 与徽标其余部分不是一个体系。`Glyph` 缺省走 `currentColor` ⇒ 不传即继承徽标自己的墨色，
             * 与右边那个「×N」同色。
             *
             * 底色 = **打捞作业色**（`is-work-salvage`，**2026-10-02 船长令「按你推荐来」**）：
             * 徽标挂在残骸打捞卡上 ⇒ 与矿带卡那枚（`is-work-mine`）一眼分得开。
             */}
            <span className="app-ico"><Glyph name="nav-ai" size={12} /></span>×{aiWorkers.length}
          </span>
        ) : null}
      </div>
      {!invasionPool ? <div className="app-belt-desc">{tr("ui.MapPage.062")} {anomalies.length} {tr("ui.MapPage.063")}</div> : null}
      {!invasionPool ? <FlavorTip
        note={flavorNote}
        featureLabel={flavorLabel}
        named={cap(namedList)}
        generic={cap(genericList)}
      /> : null}
      {prog ? (
        <div
          className={`app-card-progress${prog.travel ? ' is-travel' : ''}`}
          title={tr("ui.MapPage.109", { p1: prog.label, p2: prog.percent })}
        >
          <i style={{ width: `${prog.percent}%` }} />
        </div>
      ) : null}
      {/**
       * **玩家舰船残骸（置于最上）**（**2026-09-26 船长令**：「**玩家如果在该星系打捞，优先打捞该残骸
       * （比稀有残骸优先级还高）**」＋报障「建议在残骸打捞页面内，有玩家舰船残骸的卡片置顶」）：
       * 一具一行（船名 ＋ 还可回收件数 ＋ 剩余小时）；同星系多具按"最新那具优先"排。
       */}
      {shipWrecks.length > 0
        ? shipWrecks.map((w) => (
            <div key={w.shipId} className="app-belt-invwreck is-shipwreck">
              <span className="app-belt-invwreck-label">
                {tr('ui.weekend.111', {
                  p1: w.name,
                  p2: String(wreckLootRowsOf(w, engine.ctx).length),
                  p3: String(Math.max(0, Math.round((1 - w.decayAccMs / SHIP_WRECK_DECAY_MS) * 48))),
                })}
              </span>
              {w.recoveryRules === 2 && !w.hullRolled ? <span className="app-dim">{tr('ui.shipRecovery.002', {
                  hull: `${Math.round(hullRecoveryChanceOf(w, engine.state) * 100)}%`,
                  equipment: `${Math.round(wreckEquipmentRecoveryChanceOf(engine.state) * 100)}%`,
              })}</span> : null}
              <div className="app-card-progress is-shipwreck">
                <i style={{ width: `${Math.max(0, Math.min(100, (1 - w.decayAccMs / SHIP_WRECK_DECAY_MS) * 100))}%` }} />
              </div>
            </div>
          ))
        : null}
      {/* 每族存量以 m3 独立显示，不与常驻密度混算百分比。 */}
      <div className="app-belt-ore">
        {densityLabel ? <em className="app-chip">{densityLabel}</em> : null}
        {invasionPool ? tr('ui.hud.144', { p1: density.toFixed(1) }) : <>{tr("ui.MapPage.064")} <b>{density.toFixed(1)}</b></>}
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
      {/**
       * **各组存量读数**（2026-09-26 船长报障后改）：原先每组一张卡、各自挂「开始打捞」——
       * 那是"手动选择"时代的残留（目标自 2026-09-26 起由 core 自动判定）。
       * 现在只把存量并成**本卡的一行读数**：信息不丢、也不再假装可选。
       */}
      {groupRows.length > 0 && showGroupRows ? (
        <div className="app-belt-ore">
          {groupRows.map((t) => (
            <em key={t.groupKey} className="app-chip" title={engine.ctx.items.get(`wreck-${t.groupKey}`)?.name ?? t.groupKey}>
              {engine.ctx.items.get(`wreck-${t.groupKey}`)?.name ?? t.groupKey} {t.stockM3.toFixed(1)}
            </em>
          ))}
        </div>
      ) : null}
      {!invasionPool && est.eff ? (
        <div className="app-belt-econ" title={tr("ui.MapPage.067")}>
          {est.eff ? <div><span className="app-ico"><Glyph name="nav-salvage" size={12} color={NAV_TONES["nav-salvage"]} /></span>{est.eff}</div> : null}
          {/* 「≈N 信用点/h 拆解估价」已删（2026-09-23 船长令：残骸的信用点收入估价移除） */}
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
                      <span className="app-dim">（{aiCoreText(w.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, w.coreType) * 100)}%）</span>
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
            /**
             * **换打捞点允许直接切**（**2026-09-21 船长答 2「允许切换」**的同一把尺）：别处正在打捞时
             * 这里照点——core 先停旧点那一趟（残骸留在船上）＋写「已切换打捞点」日志，再开新点。
             */
            title={tr("ui.MapPage.070")}
            onClick={onStart}
          >
            <span className="app-ico"><Glyph name="nav-salvage" size={13} color={NAV_TONES["nav-salvage"]} /></span>{tr("ui.MapPage.071")}
          </button>
        )}
        {/**
         * **AI 指派条挂"该星系置顶那张卡"**（**船长 2026-10-02 报障**「**入侵残骸的打捞片无法指派AI**」；
         * 规则与理由见 `wreckAiHostOf` 头注）：不再是"只挂「全部」卡"——有入侵残骸时玩家看的是上面那张，
         * 指派条却压在下面那张。**名册与徽标同挂这一张**（同一份名册画两遍＝他 2026-09-26 报过的"重复卡"观感）。
         */}
        {showAi ? (
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
              <option key={t} value={t}>{aiCoreText(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <button
            className="app-btn is-small"
            disabled={!aiShipId || usableCores.length === 0}
            title={usableCores.length === 0 ? tr("ui.MapPage.045") : aiShipId ? tr("ui.MapPage.075") : tr("ui.MapPage.047")}
            onClick={() => onAiAssign(g.id, aiShipId, effCore)}
          >
            {tr("ui.MapPage.076")}
          </button>
        </div>
        ) : null}
      </div>
    </div>
  )
}
