/**
 * 工业面板：蓝图书架 + 组装机（v21 仿精炼炉/矿带卡：多张蓝图并行、制造中卡内自带进度与取消）。
 * V9：蓝图 = 消耗品书。市场买书 → 书进"蓝图书架"（blueprintStock）→ 学习一本 → 永久可造；
 * 学会后的重复蓝图书只能放回市场出售。
 */
import {
  calcBuildDurationMs,
  countWare,
  formatDurationMs,
  manufacturingRunViews,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
} from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
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

/* ═══════════════ 蓝图书架（紧凑小卡网格：书+数量+状态+学习/出售；船长 2026-09-05 定形态） ═══════════════ */

/** 蓝图书架：持有的蓝图书（学习 → 永久学会；多余的书市价出售） */
export function BlueprintShelfPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const entries = Object.entries(state.blueprintStock).filter(([, n]) => n > 0)

  function handleLearn(blueprintId: string): void {
    const r = engine.learnBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '学习失败', true)
    else onToast('已学习该配方：可到组装机无限次制造。')
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
          书架上还没有蓝图书：到下方组装机点「市场求购蓝图书」，市场有货即买下入架；然后回到这里点「学习」即可永久学会配方（重复书只能出售）。
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="蓝图书架" right={<span className="app-dim">学习 = 永久可造；重复书只能出售</span>}>
      <div className="app-shelf-grid">
        {entries.map(([id, n]) => {
          const bp = engine.blueprints.find((b) => b.id === id) ?? engine.shipBlueprints.find((b) => b.id === id)
          const learned = ownsBlueprint(state, id)
          const kindShip = (bp && 'shipId' in bp) || (!bp && engine.shipBlueprints.some((b) => b.id === id))
          return (
            <div key={id} className={`app-belt-card app-shelf-card${learned ? ' is-learned' : ''}`}>
              <div className="app-belt-head">
                <span className="app-belt-name" title={bp?.name ?? id}>
                  {kindShip ? '◈ ' : '▦ '}
                  {bp?.name ?? id}
                </span>
                <span className="app-chip" style={{ marginLeft: 'auto' }}>
                  ×{n}
                </span>
              </div>
              <div className="app-belt-desc">
                {learned ? '配方已学会（重复书可出售）' : '尚未学习——学习后永久可造'}
              </div>
              <div className="app-belt-actions">
                {!learned ? (
                  <button className="app-btn is-small is-primary" onClick={() => handleLearn(id)}>
                    学习
                  </button>
                ) : null}
                <button className="app-btn is-small" onClick={() => handleSell(id)} title="按市场收购价卖出这本蓝图书（重复书只能出售）">
                  市价出售
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ═══════════════ 组装机（v21 仿精炼炉/矿带卡；多蓝图并行制造） ═══════════════ */

/** 组装机类型筛选：全部 / 装备 / 舰船 / 弹药（2026-09-05 基础弹药可自制） */
type ManuTab = 'all' | 'equip' | 'ship' | 'ammo'
const MANU_TABS: Array<{ key: ManuTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'ammo', label: '弹药蓝图' },
]

/** 一张可制造蓝图的展示卡（v21 仿精炼炉/矿带卡结构：制造中该卡自带进度与取消，多蓝图可并行） */
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
  // 该蓝图的制造线（同蓝图至多一条）
  const run = manufacturingRunViews(state, engine.ctx).find((v) => v.blueprintId === blueprintId)
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

  function handleCancel(): void {
    const r = engine.cancelManufacturingAt(run!.id)
    if (!r.ok) onToast(r.error ?? '取消失败', true)
    else onToast('已取消制造：材料全额退回物品仓库（制造费不退）。')
  }

  return (
    <div className="app-belt-card">
      <div className="app-belt-head">
        <span className="app-belt-name">
          {kindLabel === '舰船' ? '◈ ' : kindLabel === '弹药' ? '▣ ' : ''}
          {name}
          {run ? <em className="app-belt-flag is-run">{kindLabel === '舰船' ? '造船中' : '制造中'}</em> : null}
        </span>
        {owned ? (
          <span className="app-chip" style={{ marginLeft: 'auto' }}>
            已学会
          </span>
        ) : bookCount > 0 ? (
          <span className="app-chip" style={{ marginLeft: 'auto' }}>
            蓝图书 ×{bookCount}
          </span>
        ) : lock ? (
          <span className="app-chip is-exotic" title={lock} style={{ marginLeft: 'auto' }}>
            ✕ {lock}
          </span>
        ) : (
          <span className="app-chip" style={{ marginLeft: 'auto' }}>
            {kindLabel}
          </span>
        )}
      </div>
      <div className="app-belt-desc">{description}</div>

      {run ? (
        <>
          <div className="app-belt-ore">
            产物：<span className="app-gold">{productLabel}</span> · 剩余约 {formatDurationMs(run.remainingMs)}（总耗时{' '}
            {formatDurationMs(run.durationMs)}）
          </div>
          <div
            className="app-card-progress"
            title={`制造进度 ${run.percent}%（到点自动${kindLabel === '舰船' ? '停入船坞' : '入库'}）`}
          >
            <i style={{ width: `${run.percent}%` }} />
          </div>
        </>
      ) : (
        <>
          <div className="app-belt-ore">
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
                  {needCount !== need.count ? (
                    <span className="app-dim">（原 ×{need.count.toLocaleString('zh-CN')}，材料学折扣后）</span>
                  ) : null}
                  <span className="app-dim">（仓库 {have.toLocaleString('zh-CN')}）</span>
                </li>
              )
            })}
          </ul>
          <div className="app-belt-econ">制造费 {buildCostIsk.toLocaleString('zh-CN')} ISK</div>
        </>
      )}

      <div className="app-belt-actions">
        {run ? (
          <button
            className="app-btn is-small is-warn"
            onClick={handleCancel}
            title="取消这条制造线：材料按材料学折扣后的实际用量全额退回（制造费不退）"
          >
            ■ 取消制造
          </button>
        ) : owned ? (
          <button
            className="app-btn is-small is-primary"
            disabled={!canPayFee || short.length > 0}
            title={short.join('；') || '开始制造（材料与制造费立即扣除；可多张蓝图并行制造）'}
            onClick={handleBuild}
          >
            开始制造
          </button>
        ) : lock ? (
          <button className="app-btn is-small" disabled title={lock}>
            ✕ 声望未达标
          </button>
        ) : (
          <button className="app-btn is-small" onClick={handleAcquire}>
            市场求购蓝图书{bookCount > 0 ? '（书已到手，先学习）' : ''}
          </button>
        )}
      </div>
    </div>
  )
}

export function ManufacturingPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTab>('all')

  /** 目录数据（舰船 + 装备统一成条目；制造中冒泡在前，再按名称） */
  const items: Array<{
    id: string
    kindLabel: string
    name: string
    description: string
    materials: readonly MaterialNeed[]
    buildSeconds: number
    buildCostIsk: number
    productLabel: string
    running: boolean
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
        running: runViews.some((v) => v.blueprintId === sbp.id),
        canStart: canStartNow(sbp.id, sbp.materials, sbp.buildSeconds, sbp.buildCostIsk),
      })
    }
  }
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue // 弹药等物品蓝图单独分类
      const moduleName = engine.ctx.modules.get(bp.moduleId!)?.name ?? bp.moduleId!
      items.push({
        id: bp.id,
        kindLabel: '装备',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        buildCostIsk: bp.buildCostIsk,
        productLabel: moduleName,
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds, bp.buildCostIsk),
      })
    }
  }
  /** 弹药蓝图（2026-09-05：基础弹自制；产物为物品按 outputUnits 入仓） */
  const pushAmmo = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      const units = bp.outputUnits ?? 1
      items.push({
        id: bp.id,
        kindLabel: '弹药',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        buildCostIsk: bp.buildCostIsk,
        productLabel: `${itemDef?.name ?? bp.itemId} ×${units} 发`,
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds, bp.buildCostIsk),
      })
    }
  }
  pushShip()
  pushEquip()
  pushAmmo()

  /** 可开工判定（与卡片按钮同口径）：已学会 + 材料足 + 钱包够 + 该蓝图无线在跑 */
  function canStartNow(
    blueprintId: string,
    materials: readonly MaterialNeed[],
    buildSeconds: number,
    buildCostIsk: number,
  ): boolean {
    if (runViews.some((v) => v.blueprintId === blueprintId) || !ownsBlueprint(state, blueprintId)) return false
    if (state.wallet.isk < buildCostIsk) return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk }).length === 0
  }

  const visible = items.filter(
    (it) => tab === 'all' || (tab === 'ship' ? it.kindLabel === '舰船' : tab === 'equip' ? it.kindLabel === '装备' : it.kindLabel === '弹药'),
  )
  const sorted = [...visible].sort(
    (a, b) =>
      Number(b.running) - Number(a.running) ||
      Number(b.canStart) - Number(a.canStart) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN'),
  )
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const shipN = items.filter((i) => i.kindLabel === '舰船').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      title="组装机"
      right={<span className="app-dim">制造中 {runViews.length} · 装备 {equipN} · 舰船 {shipN} · 已学会 {learnedN}</span>}
    >
      {/* 筛选：全部 / 装备蓝图 / 舰船蓝图；制造中冒泡在前（材料不足卡标红缺口） */}
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
        已学会的配方才能开工；卡片会标出材料缺口与制造费。<b>多张蓝图可同时制造</b>（每条线独立进度，制造中卡自带
        进度与取消；制造不占主控，可与出海作业并行）。制造中 / 可开工的配方排在最前。
      </div>

      <div className="app-belt-grid">
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
