/**
 * 星图页（标签页结构）：本地矿带开采（主控 + AI 副船指派）/ 星图·远征调度 / 战斗悬赏 / 残骸打捞 / 任务中心。
 * 顶部二级标签切换各功能区（配合左侧主菜单「出港」展开选择，见 App）。
 */
import { useState } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  formatDurationMs,
  getMiningParams,
  idleAiShipIds,
  isExplored,
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
} from '@whale/core'
import type { AiCoreType, BeltDef, GalaxyDef } from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { ExpeditionPanel, TaskPanel, BountyPanel } from '../panels/Expedition'
import type { GameEngine } from '../game/engine'
import type { PageProps, ToastFn } from './common'
import { isk, MONEY_GLYPH } from './common'

/** 星图页的功能区（「星图·远征」放第一：这里本来就是玩家查看大地图的主入口）；icon = Glyphs 字形名 */
export type MapTab = 'star' | 'mine' | 'bounty' | 'salvage' | 'task'
export const MAP_TABS: Array<{ key: MapTab; label: string; icon: string }> = [
  { key: 'star', label: '星图·远征', icon: 'nav-map' },
  { key: 'mine', label: '矿带开采', icon: 'nav-mine' },
  { key: 'bounty', label: '战斗悬赏', icon: 'nav-bounty' },
  { key: 'salvage', label: '残骸打捞', icon: 'nav-salvage' },
  { key: 'task', label: '任务中心', icon: 'nav-task' },
]

export function MapPage({ engine, onToast, mapTab = 'star', onMapTab }: PageProps & {
  mapTab?: MapTab
  onMapTab?: (tab: MapTab) => void
}) {
  return (
    <div className="page-stack">
      {/* ───── 功能标签页（免滚动切换） ───── */}
      <div className="app-subtabs" role="tablist">
        {MAP_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={mapTab === t.key}
            className={`app-subtab${mapTab === t.key ? ' is-active' : ''}`}
            onClick={() => onMapTab?.(t.key)}
          >
            <span className="app-tab-ico">
              <Glyph name={t.icon} size={15} color={NAV_TONES[t.icon]} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {mapTab === 'mine' ? <MiningTab engine={engine} onToast={onToast} /> : null}
      {mapTab === 'star' ? <ExpeditionPanel engine={engine} onToast={onToast} /> : null}
      {mapTab === 'bounty' ? <BountyPanel engine={engine} onToast={onToast} /> : null}
      {mapTab === 'salvage' ? <SalvageTab engine={engine} onToast={onToast} /> : null}
      {mapTab === 'task' ? <TaskPanel engine={engine} onToast={onToast} /> : null}
    </div>
  )
}

/* ═══════════════ 标签二：矿带开采（矿带 = 常驻矩形卡片，操作入卡） ═══════════════ */

function MiningTab({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const view = miningStatus(state, engine.ctx)
  const activeBeltId = view.active ? state.mining.beltId : null

  function handleStart(beltId: string): void {
    // T4 延后项：远征中（确认后）走"取消远征再开采"转场入口
    const r = state.expedition.active ? engine.startMiningFromExpeditionAt(beltId) : engine.startMiningAt(beltId)
    if (!r.ok) onToast(r.error ?? '无法开采', true)
  }

  function handleStop(): void {
    if (engine.stopMiningNow()) onToast('已停止开采。')
  }

  function handleAiAssign(beltId: string, shipId: string, coreType: AiCoreType): void {
    const r = engine.assignAiMiningAt(shipId, coreType, beltId)
    if (!r.ok) onToast(r.error ?? '指派失败', true)
    else onToast('AI 副船已出发（详见「舰船」页 AI 指挥中心）。')
  }

  const phaseText = (): string => {
    if (view.phase === 'outbound') {
      return `${view.shipName || '矿船'} 前往矿带（${view.beltName}）· 约 ${formatDurationMs(view.remainingMs ?? 0)} 后开始采掘`
    }
    if (view.phase === 'returning') {
      return `${view.shipName || '矿船'} 返航卸货中 · 约 ${formatDurationMs(view.remainingMs ?? 0)} 后到港（本趟 ${view.tripUnits.toLocaleString('zh-CN')} 单位）`
    }
    return `${view.shipName || '矿船'} 采掘中（${view.beltName}）· 本趟采得 ${view.tripUnits.toLocaleString('zh-CN')} 单位`
  }

  return (
    <Panel
      title="本地矿带开采"
      right={view.active ? <span className="app-dim">作业中 · 实时进度与「停止」见顶部活动栏</span> : null}
    >
      {/* T1：作业状态与停止入口已收敛到顶部活动窗口；换驾驶=到「舰船」页直接切换（旧船自动返航卸货） */}
      {view.active ? (
        <div className="app-dim app-inv-empty">
          {phaseText()}——本卡「停止开采」也可直接操作；想换船去「舰船」页切换驾驶，旧船会自动返航卸货。
        </div>
      ) : (
        <div className="app-dim app-inv-empty">在下方矿带卡片上开始采掘——指令下达即抵达矿带开工。</div>
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
          自动循环（满舱返航卸入仓库 → 去程并入返航 → 自动再采掘）
        </label>
        <label className="app-check">
          <input
            type="checkbox"
            checked={view.stopAfterTrip}
            disabled={!view.autoCycle || !view.active}
            onChange={(e) => engine.setStopAfterTripAt(e.target.checked)}
          />
          本次返航卸货后停止
        </label>
      </div>

      {/* 矿带一览：矩形卡片挨个排布，主控/AI 操作都在卡内 */}
      <div className="app-belt-grid">
        {engine.belts.map((belt) => (
          <BeltCard
            key={belt.id}
            belt={belt}
            engine={engine}
            onToast={onToast}
            isActiveBelt={belt.id === activeBeltId}
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
  canStart,
  onStart,
  onStop,
  onAiAssign,
}: {
  belt: BeltDef
  engine: GameEngine
  onToast: ToastFn
  isActiveBelt: boolean
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
  const galaxyName = galaxy?.name ?? '母港'
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
    effLine = `${mp.unitsPerCycle} 单位/循环 · ${sec}s · ≈${perHourUnits.toLocaleString('zh-CN')} 单位/h`
    valLine = `估价 ≈${valuePerHour.toLocaleString('zh-CN')} ISK/h`
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
      onToast('交火中无法抽身采矿——请先让战斗分出胜负，或撤退脱离。', true)
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
    if (engine.cancelAiTaskAt(shipId)) onToast('AI 开采任务已取消（核心已归还）。')
    else onToast('取消失败：任务状态异常。', true)
  }

  return (
    <div className={`app-belt-card${isActiveBelt ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          {belt.name}
          {isActiveBelt ? <em className="app-belt-flag is-run"><span className="app-ico"><Glyph name="nav-mine" size={12} color={NAV_TONES["nav-mine"]} /></span>主控采掘中</em> : null}
          {locked ? (
            unexplored ? (
              <em className="app-belt-flag"><span className="app-ico"><Glyph name="ico-scan" size={12} color={ICO_TONES["ico-scan"]} /></span>所在星系未探索</em>
            ) : (
              <em className="app-belt-flag">✕ 需声望 {belt.standingReq}</em>
            )
          ) : null}
        </span>
        {aiCount > 0 ? (
          <span
            className="app-belt-ai-badge"
            title={`${aiCount} 艘 AI 副船正在此矿带采掘`}
          >
            <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>×{aiCount}
          </span>
        ) : null}
      </div>
      <div className="app-belt-desc">{belt.description}</div>
      {isActiveBelt ? (
        <div
          className={`app-card-progress${mv.phase !== 'mining' ? ' is-travel' : ''}`}
          title={`${mv.phaseLabel} · 进度 ${mv.percent}%（${mv.phase === 'mining' ? '当前采掘循环' : '行程'}）`}
        >
          <i style={{ width: `${mv.percent}%` }} />
        </div>
      ) : null}
      <div className="app-belt-ore">
        所在 {galaxyName} · 产出 {oreDef?.name ?? belt.oreId} · 市场收价 {buy !== undefined ? `${isk(buy)} ISK` : '—'}
        {unexplored ? '（到「星图·远征」对该星系「未知信号」扫描后解锁）' : ''}
      </div>
      {effLine || valLine ? (
        <div className="app-belt-econ" title="按物品本身估价（不随市场浮动）计算：每小时循环数 × 每循环产量 × 加权估价">
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
              <span key={o.itemId} className="app-belt-compose-item" title={`采掘时按权重抽取，长期平均约 ${o.weight}%`}>
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
            {aiWorkers.map(([sid, a]) => (
              <span key={sid} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>{shipDisplayName(state, engine.ctx, sid)}
                  <span className="app-dim">（{aiCoreName(a.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, a.coreType) * 100)}%）</span>
                </span>
                <button
                  className="app-btn is-small is-warn"
                  title={`取消 ${shipDisplayName(state, engine.ctx, sid)} 在此矿带的开采任务（AI 核心归还核心库）`}
                  onClick={() => cancelWorker(sid)}
                >
                  取消
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <button
          className={`app-btn is-small${isActiveBelt ? ' is-warn' : expeditionOn && !mineAsk ? ' is-warn' : ' is-primary'}`}
          disabled={locked || (!isActiveBelt && !canStart) || mineAsk}
          title={
            locked
              ? unexplored
                ? '所在星系未探索：先在星图对其「未知信号」执行扫描探索'
                : `需要「深空工业协会」声望 ${belt.standingReq}（当前 ${standing}）`
              : isActiveBelt
                ? '停止当前开采'
                : !canStart
                  ? '采矿作业进行中：先停止当前开采'
                  : mineAsk
                    ? '确认已展开在下方——用面板按钮操作'
                    : expeditionOn
                      ? '远征中：点击展开转开采确认（将取消本次远征并停止连击）'
                      : undefined
          }
          onClick={mineStartClick}
        >
          {isActiveBelt ? '停止开采' : expeditionOn ? (<><span className="app-ico"><Glyph name="ico-swap" size={13} color={ICO_TONES["ico-swap"]} /></span>转开采</>) : (<><span className="app-ico"><Glyph name="nav-mine" size={13} color={NAV_TONES["nav-mine"]} /></span>开始开采</>)}
        </button>
        {/* T4 延后项：远征中转开采的醒目内联警示（取代易忽略的底部提示） */}
        {mineAsk ? (
          <div className="app-ano-switch-confirm">
            <div className="app-sell-warn">
              ⚠ 远征中开采 = <b>转场</b>：本次远征将立即取消——
              <b> 无战果、无返程</b>
              {state.autoLoopAnomalyId !== null ? '，连续出击同步停止' : ''}，随即在「{belt.name}」开始采矿。
            </div>
            <div className="app-sell-confirm-btns">
              <button className="app-btn is-small is-danger" onClick={mineStartClick}>
                确认开采
              </button>
              <button className="app-btn is-small" onClick={() => setMineAsk(false)}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        <div className="app-belt-ai">
          <select className="app-select" value={aiShipId} onChange={(e) => setAiShipId(e.target.value)} title="选择空闲副船">
            <option value="">— 空闲副船 —</option>
            {idleShips.map((id) => {
              return (
                <option key={id} value={id}>
                  {shipDisplayName(state, engine.ctx, id)}
                </option>
              )
            })}
          </select>
          <select className="app-select" value={aiCoreSel} onChange={(e) => setAiCoreSel(e.target.value as AiCoreType)} title="AI 核心类型">
            {AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0).map((t) => (
              <option key={t} value={t}>{aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <button
            className="app-btn is-small"
            disabled={locked || !aiShipId}
            title={locked ? (unexplored ? '所在星系未探索' : `需声望 ${belt.standingReq}`) : aiShipId ? '指派 AI 副船开采此矿带' : '先选择空闲副船'}
            onClick={() => onAiAssign(belt.id, aiShipId, aiCoreSel)}
          >
            指派 AI 开采
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════ 标签三：残骸打捞（矿带页同款卡片网格；B3 采矿式单趟） ═══════════════ */

/** 打捞速率与回收保底估值（当前驾驶船装配/技能 × 当前密度现算；展示用近似；回收卡同口径共用 RECYCLE_POOL_AVG_ISK） */
function salvageEstimate(state: GameEngine['state'], engine: GameEngine, galaxyId: string, density: number): { eff: string | null; val: string | null } {
  const ctx = engine.ctx
  const cycles = salvagerCyclesOf(state, ctx, state.shipId)
  const anomalies = engine.anomalies.filter((a) => a.galaxyId === galaxyId)
  if (cycles.length === 0 || anomalies.length === 0) {
    return { eff: cycles.length === 0 ? '未装配打捞器（舰船页高槽安装后显示效率）' : null, val: null }
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
    eff: `${cycles.length} 台打捞器 · ≈${Math.round(volH).toLocaleString('zh-CN')} m³/h（当前密度现算${volH > capM3H ? '，超出回收炉速按炉速计' : ''}）`,
    val: `${isk(evH)} ISK/h 保底（按来源危险度池估价）`,
  }
}

function SalvageTab({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const me = state.salvaging
  // 正在该星系打捞的 AI 副船（名册：快速取消用）
  const aiWorkersBy = new Map<string, Array<{ sid: string; coreType: AiCoreType }>>()
  for (const [sid, a] of Object.entries(state.aiAssignments)) {
    if (a.task.kind === 'salvage') {
      const list = aiWorkersBy.get(a.task.galaxyId) ?? []
      list.push({ sid, coreType: a.coreType })
      aiWorkersBy.set(a.task.galaxyId, list)
    }
  }
  const galaxies = [...engine.ctx.galaxies.values()]
    .filter((g) => isExplored(state, g.id) && engine.anomalies.some((x) => x.galaxyId === g.id))
    .map((g) => ({
      galaxy: g,
      density: wreckDensityOf(state, g.id, engine.ctx),
      workers: aiWorkersBy.get(g.id) ?? [],
    }))
    .sort((a, b) => b.density - a.density)
  const idleShips = idleAiShipIds(state)

  const phaseText = (): string => {
    if (!me.active) return `${shipDisplayName(state, engine.ctx, state.shipId)} 停靠空间站——在下方残骸卡上开始打捞，或指派 AI 副船。`
    const gName = me.galaxyId ? engine.ctx.galaxies.get(me.galaxyId)?.name : ''
    if (me.phase === 'outbound') return `${shipDisplayName(state, engine.ctx, state.shipId)} 前往「${gName}」（出航中）`
    if (me.phase === 'returning') return `${shipDisplayName(state, engine.ctx, state.shipId)} 返航卸货中（本趟约 ${Math.round(me.tripM3 * 100) / 100} m³）`
    return `${shipDisplayName(state, engine.ctx, state.shipId)} 在「${gName}」持续打捞中 · 本趟约 ${Math.round(me.tripM3 * 100) / 100} m³`
  }

  function startAt(galaxyId: string): void {
    const r = engine.startSalvageOpAt(galaxyId)
    if (!r.ok) onToast(r.error ?? '无法打捞', true)
  }
  function stopNow(): void {
    if (engine.stopSalvageOpNow()) onToast('已停止打捞（货物留在船上）。')
  }
  function assignAi(galaxyId: string, shipId: string, coreType: AiCoreType): void {
    if (!shipId) {
      onToast('先选择一艘空闲副船。', true)
      return
    }
    const r = engine.assignAiSalvageAt(shipId, coreType, galaxyId)
    if (!r.ok) onToast(r.error ?? '指派失败', true)
    else onToast('AI 副船已出发打捞（满仓自动返港卸货后任务结束）。')
  }
  function cancelAi(sid: string): void {
    if (engine.cancelAiTaskAt(sid)) onToast('AI 打捞任务已取消（核心已归还）。')
    else onToast('取消失败：任务状态异常。', true)
  }

  return (
    <Panel
      title="残骸打捞"
      right={<span className="app-dim">密度随击杀注入 / 打捞放干消耗；残骸=体积 m³ 入仓</span>}
    >
      <div className="app-dim app-note">
        打捞需驾驶船高槽装有打捞器（无伤害件，升级只减周期）。单趟作业：下达即持续打捞 → 满仓自动返航卸货；
        残骸回母港用工业页「残骸回收」拆解（保底矿物 + 彩头：基础件 / 低安 MK2 / 蓝图碎片）。低安星系打捞作业中可能遇袭（航行与返航途中不会——移动不暴露）。
      </div>
      <div className="app-dim app-inv-empty">{phaseText()}</div>

      {galaxies.length === 0 ? (
        <div className="app-dim app-inv-empty">还没有可打捞的星系——先扫描探索点亮星图（星系内要有悬赏目标才会产生残骸）。</div>
      ) : (
        <div className="app-belt-grid">
          {galaxies.map(({ galaxy: g, density, workers }) => (
            <WreckCard
              key={g.id}
              galaxy={g}
              density={density}
              aiWorkers={workers}
              isActive={me.active && me.galaxyId === g.id}
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
    return { percent: Math.min(100, Math.round((s.phaseAccMs / leg) * 100)), label: '出航中', travel: true }
  }
  if (s.phase === 'returning') {
    // 返航腿 = 满载返航 + 空船去程（去程并入返航）
    const leg = Math.max(1, legMsFor(state, ctx, s.galaxyId) + outboundLegMsFor(state, ctx, s.galaxyId))
    return { percent: Math.min(100, Math.round((s.phaseAccMs / leg) * 100)), label: '返航卸货中', travel: true }
  }
  const cycles = salvagerCyclesOf(state, ctx, state.shipId)
  const step = cycles.length > 0 ? Math.min(...cycles) : 0
  return {
    percent: step > 0 ? Math.min(100, Math.round((s.cycleAccMs / step) * 100)) : 0,
    label: `打捞循环（${cycles.length} 台打捞器）`,
    travel: false,
  }
}

/** 一张星系残骸卡：密度/效率估价 + 副船名册（快速取消）+ 主控按钮 + AI 指派条 */
function WreckCard({
  galaxy: g,
  density,
  aiWorkers,
  isActive,
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
  const lowSec = typeof g.security === 'number' && g.security < 0

  return (
    <div className={`app-belt-card${isActive ? ' is-active' : ''}`}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          {g.name}
          {isActive ? <em className="app-belt-flag is-run"><span className="app-ico"><Glyph name="nav-salvage" size={12} color={NAV_TONES["nav-salvage"]} /></span>主控打捞中</em> : null}
          {lowSec ? <em className="app-belt-flag">⚠ 低安（打捞可能遇袭）</em> : null}
        </span>
        {aiWorkers.length > 0 ? (
          <span className="app-belt-ai-badge" title={`${aiWorkers.length} 艘 AI 副船正在此星系打捞`}>
            <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>×{aiWorkers.length}
          </span>
        ) : null}
      </div>
      <div className="app-belt-desc">该星系敌群残骸：共 {anomalies.length} 类悬赏目标会持续沉积残骸密度。</div>
      {prog ? (
        <div
          className={`app-card-progress${prog.travel ? ' is-travel' : ''}`}
          title={`${prog.label} · 进度 ${prog.percent}%`}
        >
          <i style={{ width: `${prog.percent}%` }} />
        </div>
      ) : null}
      <div className="app-belt-ore">
        残骸密度 <b>{density.toFixed(1)}</b>
        {lowSec ? '（低安回收箱可出 MK2 与高级碎片）' : ''} · 安全 {g.security?.toFixed(1)}
      </div>
      {est.eff || est.val ? (
        <div className="app-belt-econ" title="估算 = 当前打捞器装配 × 当前密度 × 打捞/回收技能（参考值，实际所得以回收拆解结算为准）">
          {est.eff ? <div><span className="app-ico"><Glyph name="nav-salvage" size={12} color={NAV_TONES["nav-salvage"]} /></span>{est.eff}</div> : null}
          {est.val ? <div className="app-belt-econ-val">{MONEY_GLYPH} {est.val}</div> : null}
        </div>
      ) : null}

      <div className="app-belt-actions">
        {aiWorkers.length > 0 ? (
          <div className="app-belt-workers">
            {aiWorkers.map((w) => (
              <span key={w.sid} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  <span className="app-ico"><Glyph name="nav-ai" size={12} color={NAV_TONES["nav-ai"]} /></span>{shipDisplayName(state, engine.ctx, w.sid)}
                  <span className="app-dim">（{aiCoreName(w.coreType)} · {Math.round(aiEfficiency(state, engine.ctx, w.coreType) * 100)}%）</span>
                </span>
                <button
                  className="app-btn is-small is-warn"
                  title={`取消 ${shipDisplayName(state, engine.ctx, w.sid)} 在此星系的打捞任务（AI 核心归还核心库）`}
                  onClick={() => onAiCancel(w.sid)}
                >
                  取消
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {isActive ? (
          <button className="app-btn is-small is-warn" onClick={onStop}>
            停止打捞
          </button>
        ) : (
          <button
            className="app-btn is-small is-primary"
            disabled={activeAnywhere}
            title={activeAnywhere ? '已有打捞作业进行中（其它星系）——先停止或等满仓自动返航' : '开始打捞（需高槽打捞器；单趟，满仓自动返航）'}
            onClick={onStart}
          >
            <span className="app-ico"><Glyph name="nav-salvage" size={13} color={NAV_TONES["nav-salvage"]} /></span>开始打捞
          </button>
        )}
        <div className="app-belt-ai">
          <select className="app-select" value={aiShipId} onChange={(e) => setAiShipId(e.target.value)} title="选择空闲副船（需该船高槽装有打捞器）">
            <option value="">— 空闲副船 —</option>
            {idleShips.map((id) => (
              <option key={id} value={id}>
                {shipDisplayName(state, engine.ctx, id)}
              </option>
            ))}
          </select>
          <select className="app-select" value={aiCoreSel} onChange={(e) => setAiCoreSel(e.target.value as AiCoreType)} title="AI 核心类型（效率越高行程/周期越快）">
            {AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0).map((t) => (
              <option key={t} value={t}>{aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）</option>
            ))}
          </select>
          <button
            className="app-btn is-small"
            disabled={activeAnywhere || !aiShipId}
            title={activeAnywhere ? '主控打捞作业进行中——AI 不受限，仍可派副船（副船独立于主控）' : aiShipId ? '指派 AI 副船打捞此星系（满仓自动返港后任务结束）' : '先选择空闲副船'}
            onClick={() => onAiAssign(g.id, aiShipId, aiCoreSel)}
          >
            指派 AI 打捞
          </button>
        </div>
      </div>
    </div>
  )
}
