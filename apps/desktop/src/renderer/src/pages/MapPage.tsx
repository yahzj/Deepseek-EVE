/**
 * 星图页（标签页结构）：本地矿带开采（主控 + AI 副船指派）/ 星图·远征调度 / 悬赏情报。
 * 顶部二级标签切换三个功能区（配合顶部主菜单「星图」展开选择，见 App）。
 */
import { useState } from 'react'
import {
  AI_CORE_ORDER,
  aiCoreName,
  aiEfficiency,
  countAiCore,
  formatDurationMs,
  idleAiShipIds,
  isExplored,
  marketGoodOf,
  marketQuote,
  miningStatus,
  oneLegMs,
  shipDisplayName,
} from '@whale/core'
import type { AiCoreType, BeltDef } from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { ExpeditionPanel, TaskPanel } from '../panels/Expedition'
import type { GameEngine } from '../game/engine'
import type { PageProps, ToastFn } from './common'
import { isk } from './common'

/** 星图页的三个功能区（「星图·远征」放第一：这里本来就是玩家查看大地图的主入口） */
export type MapTab = 'star' | 'mine' | 'bounty'
export const MAP_TABS: Array<{ key: MapTab; label: string; icon: string }> = [
  { key: 'star', label: '星图·远征', icon: '✦' },
  { key: 'mine', label: '矿带开采', icon: '⛏' },
  { key: 'bounty', label: '任务中心', icon: '⚔' },
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
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {mapTab === 'mine' ? <MiningTab engine={engine} onToast={onToast} /> : null}
      {mapTab === 'star' ? <ExpeditionPanel engine={engine} onToast={onToast} /> : null}
      {mapTab === 'bounty' ? <TaskPanel engine={engine} onToast={onToast} /> : null}
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
        <div className="app-dim app-inv-empty">矿船停靠空间站——在下方矿带卡片上开始自动采掘，或指派 AI 副船。</div>
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
          自动循环（满舱返航 → 卸入仓库 → 再出航）
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
  const standing = state.standings['dsi'] ?? 0
  const galaxy = belt.galaxyId ? engine.ctx.galaxies.get(belt.galaxyId) : undefined
  const galaxyName = galaxy?.name ?? '母港'
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
      setMineAsk(true)
      onToast(
        '⚡ 远征中开采 = 转场：本次远征将取消（无战果）' +
          (state.autoLoopAnomalyId !== null ? '，连续出击同步停止' : '') +
          '——再点一次确认。',
        true,
      )
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
          {isActiveBelt ? <em className="app-belt-flag is-run">⛏ 主控采掘中</em> : null}
          {locked ? (
            unexplored ? (
              <em className="app-belt-flag">🔭 所在星系未探索</em>
            ) : (
              <em className="app-belt-flag">🔒 需声望 {belt.standingReq}</em>
            )
          ) : null}
        </span>
        {aiCount > 0 ? (
          <span
            className="app-belt-ai-badge"
            title={`${aiCount} 艘 AI 副船正在此矿带采掘`}
          >
            🤖×{aiCount}
          </span>
        ) : null}
      </div>
      <div className="app-belt-desc">{belt.description}</div>
      <div className="app-belt-ore">
        所在 {galaxyName} · 产出 {oreDef?.name ?? belt.oreId} · 市场收价 {buy !== undefined ? `${isk(buy)} ISK` : '—'}
        {unexplored ? '（到「星图·远征」对该星系「未知信号」扫描后解锁）' : ''}
      </div>
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
                  🤖 {shipDisplayName(state, engine.ctx, sid)}
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
          className={`app-btn is-small${isActiveBelt ? ' is-warn' : mineAsk ? ' is-warn' : ' is-primary'}`}
          disabled={locked || (!isActiveBelt && !canStart)}
          title={
            locked
              ? unexplored
                ? '所在星系未探索：先在星图对其「未知信号」执行扫描探索'
                : `需要「深空工业协会」声望 ${belt.standingReq}（当前 ${standing}）`
              : isActiveBelt
                ? '停止当前开采'
                : !canStart
                  ? '采矿作业进行中：先停止当前开采'
                  : expeditionOn
                    ? state.expedition.phase === 'battle'
                      ? '交火中无法抽身采矿——先让战斗分出胜负或撤退'
                      : mineAsk
                        ? '再点一次确认：开采将取消本次远征（无战果）并停止连续出击'
                        : '远征中可转开采（取消本次远征、连击同步停）'
                    : undefined
          }
          onClick={mineStartClick}
        >
          {isActiveBelt ? '停止开采' : mineAsk ? '⚡ 再点确认开采' : '开始开采'}
        </button>

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
