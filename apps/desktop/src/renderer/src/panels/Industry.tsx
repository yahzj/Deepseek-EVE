/**
 * 工业面板：蓝图书架 + 组装机（2026-09-08 与精炼炉完全同款劳动者制：主控亲自/AI 核心驱动；
 * 同一蓝图可同时开多条线、不同蓝图不限，皆受劳动者约束——每条线独立进度与取消，可随时加开）。
 * V9：蓝图 = 消耗品书。市场买书 → 书进"蓝图书架"（blueprintStock）→ 学习一本 → 永久可造；
 * 学会后的重复蓝图书只能放回市场出售。
 */
import {
  aiCoreName,
  aiEfficiency,
  calcBuildDurationMs,
  countAiCore,
  countWare,
  formatDurationMs,
  manufacturingRunViews,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
} from '@whale/core'
import type { AiCoreType, GameState, MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

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

/* ═══════════════ 组装机（2026-09-08 与精炼炉同款劳动者制：主控亲自 / AI 核心驱动；多蓝图 + 同蓝图多线） ═══════════════ */

/** 组装机类型筛选：全部 / 装备 / 舰船 / 弹药（2026-09-05 基础弹药可自制） */
type ManuTab = 'all' | 'equip' | 'ship' | 'ammo'
const MANU_TABS: Array<{ key: ManuTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'ammo', label: '弹药蓝图' },
]

/** 主控此刻不能"亲自再开一条制造线"的原因（null = 主控空闲可开；AI 核心驱动不受此限；
 * 与精炼炉卡的手动判定同口径：手动工作位全局限 1 条（精炼炉/回收炉/制造线共用）） */
function manualBuildNote(state: GameState): string | null {
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '你已亲自开着一条制造线：先取消或等它完成才能再亲自开一条（AI 核心不受此限）。'
  }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '你已亲自运转着一台精炼炉/回收炉：先停掉它才能亲自开制造线（AI 核心不受此限）。'
  }
  if (state.awayGalaxy !== null) return '你不在母港——先返航。'
  if (state.mining.active) return '采矿作业中：先停止开采。'
  if (state.salvaging.active) return '打捞作业中：先停止打捞（或等满仓自动返航）。'
  if (state.expedition.active) return '远征中：先召回或等待结束。'
  if (state.scanning.active) return '扫描探索中：先终止扫描。'
  if (state.standby.active) return '掩护巡逻进行中：先召回。'
  if (state.transit.active) return '返航途中：到站后再开线。'
  return null
}

/** 一张可制造蓝图的展示卡（与精炼炉卡同款结构：运转名册逐线 = 劳动者 + 进度 + 取消；
 * 开工按钮 = 手动制造（主控亲自）/ AI 核心下拉 + AI 制造；已学会 + 材料/制造费够即可随时加开） */
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
  // 该蓝图的全部制造线（同蓝图可多条；与精炼炉同资源多台运转同构）
  const runs = manufacturingRunViews(state, engine.ctx).filter((v) => v.blueprintId === blueprintId)
  const running = runs.length > 0
  const owned = ownsBlueprint(state, blueprintId)
  const buildMs = calcBuildDurationMs(state, engine.ctx, { materials, buildSeconds, buildCostIsk })
  const canPayFee = state.wallet.isk >= buildCostIsk
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  const short = missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk })
  const goodKey = bpGoodKey(engine, blueprintId)
  const lock = !owned && goodKey ? marketLockedReason(state, engine.ctx, goodKey) : null
  // 每卡独立的 AI 核心选择（一枚核心驱动一条线；核心库存被占用后自动回落可用类型）
  const [coreSel, setCoreSel] = useState<AiCoreType>('basic')
  const usableCores = CORE_ORDER.filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const manualNote = manualBuildNote(state)

  function handleAcquire(): void {
    const r = engine.acquireBlueprintAt(blueprintId)
    if (!r.ok) onToast(r.error ?? '获取失败', true)
    else if (r.pending) onToast('市场暂无蓝图书：已挂收购单，到货后请到「蓝图书架」点学习。')
    else onToast('蓝图书已购得并自动学会：现在可以开始制造了。')
  }

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) {
      onToast(r.error ?? '开工失败', true)
      return
    }
    onToast(
      worker === 'pilot'
        ? '主控亲自开工：材料与制造费已扣除，线已开（期间不可离港作业）。'
        : `${aiCoreName(worker)}已接入：材料与制造费已扣除，线已开（核心占用一枚，完成/取消自动归还）。`,
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? '取消失败', true)
    else onToast('已取消该条制造线：材料全额退回物品仓库（制造费不退；AI 核心已归还），其余线不受影响。')
  }

  const payShortTxt = canPayFee ? '' : `制造费不足：需要 ${buildCostIsk.toLocaleString('zh-CN')} ISK`
  const feedTxt = short.length > 0 ? short.join('；') : payShortTxt
  const manualTitle =
    manualNote ??
    feedTxt ??
    (running
      ? '主控亲自再加开一条线：材料与制造费立即扣除（主控手动工作位全局限 1 条，其余线须 AI 驱动）'
      : '主控亲自开一条制造线：材料与制造费立即扣除，期间不可离港作业')
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? '接入一枚闲置 AI 核心再加开一条线（核心出库占用；完成/取消自动归还）'
        : '接入 AI 核心自动制造：材料与制造费立即扣除（核心出库占用一枚；不占主控与副船名额）'
      : '没有可用 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。'

  return (
    <div className="app-belt-card">
      <div className="app-belt-head">
        <span className="app-belt-name">
          {kindLabel === '舰船' ? '◈ ' : kindLabel === '弹药' ? '▣ ' : ''}
          {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? '造船中' : '制造中'}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
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

      <div className="app-belt-ore">
        产物：<span className="app-gold">{productLabel}</span>
        {running ? (
          <>
            {' '}
            · 已开 {runs.length} 条线，首条约 {formatDurationMs(Math.min(...runs.map((v) => v.remainingMs)))} 到点
          </>
        ) : (
          <> · 主控耗时 {formatDurationMs(buildMs)}（技能修正后；AI 核心另按效率拉长）</>
        )}
      </div>
      <ul className="app-bp-mats">
        {materials.map((need) => {
          const needCount = matNeedCount(state, need.count) // 材料学折扣后的实际需求
          const have = countWare(state, need.itemId)
          const enough = have >= needCount
          const matName = engine.ctx.items.get(need.itemId)?.name ?? need.itemId
          // 空闲态才标红缺口；制造中仓库余量只影响「加开一条线」，红色会误读成故障
          return (
            <li key={need.itemId} className={`app-bp-mat${!enough && !running ? ' is-short' : ''}`}>
              {matName} ×{needCount.toLocaleString('zh-CN')}
              {needCount !== need.count ? (
                <span className="app-dim">（原 ×{need.count.toLocaleString('zh-CN')}，材料学折扣后）</span>
              ) : null}
              <span className="app-dim">（仓库 {have.toLocaleString('zh-CN')}）</span>
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        制造费 {buildCostIsk.toLocaleString('zh-CN')} ISK/条
        {running ? <span className="app-dim"> · 已付 {runs.length} 条</span> : null}
        {running && feedTxt ? <span className="app-dim">（余料不足「加开一条线」，缺口见按钮提示）</span> : null}
      </div>

      <div className="app-belt-actions">
        {/* 该蓝图逐条制造线名册（每行：劳动者 + 剩余 + 进度 + 取消）——精炼炉运转名册同款结构 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers" style={{ marginTop: 2 }}>
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span
                  className="app-belt-worker-name"
                  title={`总耗时 ${formatDurationMs(v.durationMs)}；到点自动${kindLabel === '舰船' ? '停入船坞' : '入库'}${v.worker === null ? '（旧作业：老规则免占用线，跑完即止）' : ''}`}
                >
                  {v.worker === null ? '⚙ 旧作业' : v.worker === 'pilot' ? '⛏ 主控亲自' : `⚙ ${v.workerLabel}驱动`} · 剩余约{' '}
                  {formatDurationMs(v.remainingMs)}
                </span>
                <span className="app-progress-mini" title={`制造进度 ${v.percent}%`}>
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => handleCancel(v.id)}
                  title="取消这条制造线：材料按材料学折扣后的实际用量全额退回（制造费不退；AI 核心自动归还），其它线不受影响"
                >
                  ■ 取消
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {owned ? (
          <>
            <button
              className="app-btn is-small is-primary"
              disabled={manualNote !== null || !canPayFee || short.length > 0}
              title={manualTitle}
              onClick={() => runWith('pilot')}
            >
              手动制造
            </button>
            {usableCores.length > 0 ? (
              <div className="app-belt-ai">
                <select
                  className="app-select"
                  value={core ?? ''}
                  onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                  title="选择接入 AI 核心：一枚核心驱动一条线（驱动期间该核心被占用；核心库存即并行上限）"
                >
                  {usableCores.map((t) => (
                    <option key={t} value={t}>
                      {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                    </option>
                  ))}
                </select>
                <button
                  className="app-btn is-small"
                  disabled={!core || !canPayFee || short.length > 0}
                  title={aiTitle}
                  onClick={() => core && runWith(core)}
                >
                  AI 制造
                </button>
              </div>
            ) : (
              <button className="app-btn is-small" disabled title="没有 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。">
                AI 制造
              </button>
            )}
          </>
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

  /** 可开工判定（与卡片按钮同口径）：已学会 + 材料足 + 钱包够（劳动者判定由卡片按钮各自表达） */
  function canStartNow(
    blueprintId: string,
    materials: readonly MaterialNeed[],
    buildSeconds: number,
    buildCostIsk: number,
  ): boolean {
    if (!ownsBlueprint(state, blueprintId)) return false
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
      right={<span className="app-dim">制造线 {runViews.length} 条 · 装备 {equipN} · 舰船 {shipN} · 已学会 {learnedN}</span>}
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
        已学会的配方才能开工；卡片会标出材料缺口与制造费。劳动者与精炼炉完全相同：<b>主控亲自
        （全局限 1 条、占主控不可离港）</b>或<b>一枚 AI 核心驱动一条线</b>（核心库存即并行上限）；同一蓝图
        可同时开多条线、不同蓝图也并行，材料/制造费够即可随时加开。制造中 / 可开工的配方排在最前。
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
