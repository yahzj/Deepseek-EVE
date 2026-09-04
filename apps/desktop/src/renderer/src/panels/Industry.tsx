/**
 * 工业面板：蓝图制造台（市场求购蓝图书 / 蓝图书架学习 / 开始制造 / 进度，产物：装备或舰船）。
 * V9：蓝图 = 消耗品书。市场买书 → 书进"蓝图书架"（blueprintStock）→ 学习一本 → 永久可造；
 * 学会后的重复蓝图书只能放回市场出售。
 */
import {
  calcBuildDurationMs,
  countWare,
  formatDurationMs,
  manufacturingStatus,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
} from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

/** 在市场目录里找某蓝图的市场商品（key）；找不到返回 null */
function bpGoodKey(engine: GameEngine, blueprintId: string): string | null {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'blueprint' && good.refId === blueprintId) return good.key
  }
  return null
}

/* ═══════════════ 蓝图书架 ═══════════════ */

/** 蓝图书架：持有的蓝图书（学习 → 永久学会；多余的书市价出售） */
export function BlueprintShelfPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)

  function handleLearn(blueprintId: string): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '学习失败', true)
    else onToast('已学习该配方：可到制造台无限次制造。')
  }

  function handleSell(blueprintId: string): void {
    const key = bpGoodKey(engine, blueprintId)
    if (!key) {
      onToast('该蓝图不在市场流通目录（无法出售）。', true)
      return
    }
    const r = engine.sellHoldingAt(key)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast('出售指令已受理：市场收购簿有单即时成交，否则自动挂卖单。')
  }

  if (entries.length === 0) {
    return (
      <Panel title="蓝图书架" right={<span className="app-dim">学习 = 永久可造</span>}>
        <div className="app-dim app-note">
          书架上还没有蓝图书：到下方制造台点「市场求购蓝图书」，市场有货即买下入架；然后回到这里点「学习」即可永久学会配方（重复书只能出售）。
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="蓝图书架" right={<span className="app-dim">学习 = 永久可造；重复书只能出售</span>}>
      <ul className="app-inv-list">
        {entries.map(([id, n]) => {
          const bp = engine.blueprints.find((b) => b.id === id) ?? engine.shipBlueprints.find((b) => b.id === id)
          const learned = ownsBlueprint(state, id)
          return (
            <li key={id} className="app-inv-row">
              <div className="app-inv-main">
                <span className="app-inv-name">{bp?.name ?? id}</span>
                <span className="app-inv-count">
                  ×{n}
                  {learned ? ' · 配方已学会（重复书可出售）' : ' · 尚未学习'}
                </span>
              </div>
              <div className="app-inv-btns">
                {!learned ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    学习
                  </button>
                ) : null}
                <button className="app-btn is-small" onClick={() => handleSell(id)}>
                  市价出售
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/* ═══════════════ 蓝图制造台（任务中心式目录，参考星图页任务中心） ═══════════════ */

/** 制造台类型筛选：全部 / 装备 / 舰船（与任务中心 app-tasktab 同款筛选风格） */
type ManuTab = 'all' | 'equip' | 'ship'
const MANU_TABS: Array<{ key: ManuTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
]

/** 一张可制造蓝图的统一展示卡（装备蓝图与舰船蓝图共用） */
function BlueprintCard({
  engine,
  onToast,
  blueprintId,
  name,
  description,
  materials,
  buildSeconds,
  buildCostIsk,
  productLabel,
  kindLabel,
}: {
  engine: GameEngine
  onToast: ToastFn
  blueprintId: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  buildCostIsk: number
  /** 产物标签（如 装备名 或 舰船名+属性） */
  productLabel: string
  /** 产物类别徽标：装备 / 舰船 */
  kindLabel: string
}) {
  const state = engine.state
  const mf = manufacturingStatus(state, engine.ctx)
  const owned = ownsBlueprint(state, blueprintId)
  const buildMs = calcBuildDurationMs(state, engine.ctx, { materials, buildSeconds, buildCostIsk })
  const canPayFee = state.wallet.isk >= buildCostIsk
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  const short = missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk })
  const goodKey = bpGoodKey(engine, blueprintId)
  const lock = !owned && goodKey ? marketLockedReason(state, engine.ctx, goodKey) : null

  function handleAcquire(): void {
    const r = engine.acquireBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '获取失败', true)
    else if (r.pending) onToast('市场暂无蓝图书：已挂收购单，到货后请到「蓝图书架」点学习。')
    else onToast('蓝图书已购得并自动学会：现在可以开始制造了。')
  }

  function handleBuild(): void {
    const r = engine.startManufacturingAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '开工失败', true)
  }

  return (
    <div className={`app-bp-card${owned ? ' is-owned' : ''}`}>
      <div className="app-bp-top">
        <span className="app-chip">{kindLabel}</span>
        <span className="app-bp-name">{name}</span>
        {owned ? <span className="app-chip">已学会</span> : bookCount > 0 ? <span className="app-chip">蓝图书 ×{bookCount}</span> : null}
        {lock ? <span className="app-chip is-exotic" title={lock}>🔒 {lock}</span> : null}
      </div>
      <div className="app-bp-product">
        产物：<span className="app-gold">{productLabel}</span> · 耗时 {formatDurationMs(buildMs)}（技能修正后）
      </div>
      <ul className="app-bp-mats">
        {materials.map((need) => {
          const needCount = matNeedCount(state, need.count) // 材料学折扣后的实际需求
          const have = countWare(state, need.itemId)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(need.itemId)?.name ?? need.itemId
          return (
            <li key={need.itemId} className={`app-bp-mat${enough ? '' : ' is-short'}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? <span className="app-dim">（原 ×{need.count.toLocaleString('zh-CN')}，材料学折扣后）</span> : null}
              <span className="app-dim">（仓库 {have.toLocaleString('zh-CN')}）</span>
            </li>
          )
        })}
      </ul>
      <div className="app-bp-bottom">
        <span className="app-dim">制造费 {buildCostIsk.toLocaleString('zh-CN')} ISK</span>
        {owned ? (
          <button
            className="app-btn is-small is-primary"
            disabled={!canPayFee || mf.active || short.length > 0}
            title={short.join('；')}
            onClick={handleBuild}
          >
            开始制造
          </button>
        ) : lock ? (
          <button className="app-btn is-small" disabled title={lock}>
            🔒 声望未达标
          </button>
        ) : (
          <button className="app-btn is-small" onClick={handleAcquire}>
            市场求购蓝图书{bookCount > 0 ? '（书已到手，先学习）' : ''}
          </button>
        )}
      </div>
      <div className="app-bp-desc">{description}</div>
    </div>
  )
}

export function ManufacturingPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const mf = manufacturingStatus(state, engine.ctx)
  const [tab, setTab] = useState<ManuTab>('all')

  /** 目录数据（舰船 + 装备统一成条目；任务中心式：可开工冒泡在前，再按名称） */
  const items: Array<{
    id: string
    kindLabel: string
    name: string
    description: string
    materials: readonly MaterialNeed[]
    buildSeconds: number
    buildCostIsk: number
    productLabel: string
    canStart: boolean
  }> = []
  const pushShip = (): void => {
    for (const sbp of engine.shipBlueprints) {
      const shipDef = engine.ctx.ships.get(sbp.shipId)
      items.push({
        id: sbp.id,
        kindLabel: '舰船',
        name: sbp.name,
        description: sbp.description,
        materials: sbp.materials,
        buildSeconds: sbp.buildSeconds,
        buildCostIsk: sbp.buildCostIsk,
        productLabel: shipDef
          ? `${shipDef.name}（货舱 ${shipDef.cargoM3.toLocaleString('zh-CN')} m³ · ${shipDef.cycleSeconds} 秒 × ${shipDef.oreUnitsPerCycle} 单位/循环）`
          : sbp.shipId,
        canStart: canStartNow(sbp.id, sbp.materials, sbp.buildSeconds, sbp.buildCostIsk),
      })
    }
  }
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      const moduleName = engine.ctx.modules.get(bp.moduleId)?.name ?? bp.moduleId
      items.push({
        id: bp.id,
        kindLabel: '装备',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        buildCostIsk: bp.buildCostIsk,
        productLabel: moduleName,
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds, bp.buildCostIsk),
      })
    }
  }
  pushShip()
  pushEquip()

  /** 可开工判定（与卡片按钮同口径）：已学会 + 材料足 + 钱包够 + 无作业中 */
  function canStartNow(
    blueprintId: string,
    materials: readonly MaterialNeed[],
    buildSeconds: number,
    buildCostIsk: number,
  ): boolean {
    if (mf.active || !ownsBlueprint(state, blueprintId)) return false
    if (state.wallet.isk < buildCostIsk) return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk }).length === 0
  }

  const visible = items.filter((it) => tab === 'all' || (tab === 'ship' ? it.kindLabel === '舰船' : it.kindLabel === '装备'))
  const sorted = [...visible].sort(
    (a, b) => Number(b.canStart) - Number(a.canStart) || a.name.localeCompare(b.name, 'zh-Hans-CN'),
  )
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const shipN = items.filter((i) => i.kindLabel === '舰船').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      title="蓝图制造台"
      right={<span className="app-dim">装备 {equipN} · 舰船 {shipN} · 已学会 {learnedN}；工业理论每级 -5% 耗时</span>}
    >
      {/* 制造中：只显示进度，不可并行开工 */}
      {mf.active ? (
        <div className="app-mf-running">
          <div className="app-mf-title">
            {mf.kind === 'ship' ? '🚢 造船中：' : '制造中：'}
            <span className="app-gold">{mf.productName}</span>
          </div>
          <ProgressBar
            value={mf.percent}
            tone="warn"
            label={`剩余约 ${formatDurationMs(mf.remainingMs)}（到点自动${mf.kind === 'ship' ? '停入船坞' : '入库'}）`}
          />
        </div>
      ) : null}

      {/* 任务中心式筛选：全部 / 装备蓝图 / 舰船蓝图；可开工冒泡在前（材料不足卡标红缺口） */}
      <div className="app-task-tabs" role="tablist">
        {MANU_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="app-dim app-exp-idle">
        已学会的配方才能开工；卡片会标出材料缺口与制造费。同一时刻只能制造一件（到点自动入库/入船坞）。
        {' '}可开工的配方排在最前。
      </div>

      <div className="app-bp-list">
        {sorted.map((it) => (
          <BlueprintCard
            key={it.id}
            engine={engine}
            onToast={onToast}
            blueprintId={it.id}
            name={it.name}
            description={it.description}
            materials={it.materials}
            buildSeconds={it.buildSeconds}
            buildCostIsk={it.buildCostIsk}
            productLabel={it.productLabel}
            kindLabel={it.kindLabel}
          />
        ))}
      </div>
    </Panel>
  )
}

