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
  manufacturingLoopOf,
  manufacturingRunViews,
  marketLockedReason,
  matNeedCount,
  missingMaterials,
  ownsBlueprint,
} from '@whale/core'
import type { AiCoreType, GameState, MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ItemHover, ModuleHover, ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { RowGlyph } from '../ui/itemView'
import { MONEY_GLYPH } from '../pages/common'

const CORE_ORDER: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 在市场目录里找某蓝图的市场商品（key）；找不到返回 null */
function bpGoodKey(engine: GameEngine, blueprintId: string): string | null {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === 'blueprint' && good.refId === blueprintId) return good.key
  }
  return null
}

/** 产物现货基准价（产物在市场目录的 basePrice；弹药等按单次产出数量折算） */
function productBaseOf(engine: GameEngine, kind: 'module' | 'ship' | 'item', refId: string, units = 1): number {
  for (const good of engine.ctx.marketGoods.values()) {
    if (good.kind === kind && good.refId === refId) return (good.basePrice ?? 0) * units
  }
  return 0
}

/** 精炼源矿石：精炼配方（def.refine）产出该矿物的矿石 id 列表；空 = 无精炼产出，只能市场购买 */
function refineSourcesOf(engine: GameEngine, mineralId: string): string[] {
  const out: string[] = []
  for (const def of engine.ctx.items.values()) {
    if (def.kind === 'wreck') continue
    if ((def.refine ?? []).some((r) => r.mineralId === mineralId)) out.push(def.id)
  }
  return out
}

/** 蓝图书市场价（组装机排序用：市场目录 basePrice；缺省 = 蓝图字段；再无 = 沉底） */
function bookPriceOf(engine: GameEngine, blueprintId: string, fallback: number): number {
  const k = bpGoodKey(engine, blueprintId)
  if (k) {
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.key === k) return g.basePrice ?? fallback
    }
  }
  return fallback
}

/** 组装机分组序（2026-09-08 船长定：按类型 + 蓝图价格排序）：装备 → 舰船 → 弹药 */
const MANU_KIND_ORDER: Record<string, number> = { 装备: 0, 舰船: 1, 弹药: 2 }

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
    <Panel className="is-fill" title="蓝图书架" right={<span className="app-dim">学习 = 永久可造；重复书只能出售</span>}>
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
  if (state.awayGalaxy !== null) return '你不在空间站（母港或已建成副站）——先返航停靠。'
  if (state.mining.active) return '采矿作业中：先停止开采。'
  if (state.salvaging.active) return '打捞作业中：先停止打捞（或等满仓自动返航）。'
  if (state.expedition.active) return '远征中：先召回或等待结束。'
  if (state.scanning.active) return '扫描探索中：先终止扫描。'
  if (state.standby.active) return '掩护巡逻进行中：先召回。'
  if (state.transit.active) return '返航途中：到站后再开线。'
  return null
}

/** 一张可制造蓝图的展示卡（与精炼炉卡同款结构：运转名册逐线 = 劳动者 + 进度 + 取消；
 * 开工按钮 = 手动制造（主控亲自）/ AI 核心下拉 + AI 制造；已学会 + 材料够即可随时加开（制造费已于 2026-09-08 取消）） */
function BlueprintCard({
  engine,
  onToast,
  blueprintId,
  name,
  description,
  materials,
  buildSeconds,
  productLabel,
  productNode,
  kindLabel,
  productGlyph,
  productBase,
  onNeedMineral,
}: {
  engine: GameEngine
  onToast: ToastFn
  blueprintId: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  /** 产物标签（如 装备名 或 舰船名+属性） */
  productLabel: string
  /** 产物名悬浮卡（ModuleHover/ShipHover/ItemHover——查看成品属性的统一入口；无解析 = 纯文本） */
  productNode?: ReactNode
  /** 产物类别徽标：装备 / 舰船 */
  kindLabel: string
  /** 产物图标键（与图鉴行同口径：物品/弹药 = 物品 kind、装备 = 槽位、舰船 = 船族；卡名前的 SVG 小图标） */
  productGlyph: string
  /** 产物市场现货基准价（×单次产出数量；0 = 市场无卡不显示估算） */
  productBase: number
  /** 点需求材料：有精炼源 → 跳到精炼炉对应源矿石卡；无源 → 跳市场（2026-09-08 船长定） */
  onNeedMineral?: (itemId: string) => void
}) {
  const state = engine.state
  // 该蓝图的全部制造线（同蓝图可多条；与精炼炉同资源多台运转同构）
  const runs = manufacturingRunViews(state, engine.ctx).filter((v) => v.blueprintId === blueprintId)
  const running = runs.length > 0
  const owned = ownsBlueprint(state, blueprintId)
  // 制造费已取消（2026-09-08）：耗时/缺口等 spec 计算的费用字段恒置 0
  const spec = { materials, buildSeconds, buildCostIsk: 0 }
  const buildMs = calcBuildDurationMs(state, engine.ctx, spec)
  const bookCount = state.blueprintStock[blueprintId] ?? 0
  const short = missingMaterials(state, engine.ctx, spec)
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
        ? '主控亲自开工：材料已扣除，线已开（期间不可离港作业）。'
        : `${aiCoreName(worker)}已接入：材料已扣除，线已开（核心占用一枚，完成/取消自动归还）。`,
    )
  }

  function handleCancel(runId: number): void {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(r.error ?? '取消失败', true)
    else onToast('已取消该条制造线：材料全额退回物品仓库（AI 核心已归还），其余线不受影响。')
  }

  // 2026-09-10 船长定：循环制造（开关 + 目标件数）从逐条制造线**上移到整张生产卡**——
  // 一张卡一个开关，作用于该卡全部制造线（含主控亲自那条），打开后新开的线自动继承；
  // 目标件数 = 全卡合计；「关→开」= 开一批新循环（合计与停因清零）。判定/计数都在 core。
  const loop = manufacturingLoopOf(state, blueprintId)
  const [goalDraft, setGoalDraft] = useState('')
  function commitLoop(on: boolean, goalText: string): void {
    const n = Number.parseInt(goalText, 10)
    const goal = Number.isFinite(n) && n > 0 ? n : null
    const r = engine.setManufacturingLoopAt(blueprintId, on, on ? goal : null)
    if (!r.ok) onToast(r.error ?? '开关操作失败', true)
  }

  const feedTxt = short.length > 0 ? short.join('；') : ''
  // 2026-09-08（二号·组装机收益体检 A 项）：卡面补「净 ≈ISK/h」——产物现货基准价 − 材料收价
  // （材料学折扣后），按当前技能单件耗时折算每小时；未计销路与成交税（卖出按空间站收购档约
  // 6~7 折，自用装配则按现货计）——与精炼/回收卡「净口径估算」同款视觉。
  const matIsk = materials.reduce(
    (s, m) => s + matNeedCount(state, m.count) * (engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0),
    0,
  )
  const netPerH = productBase > 0 ? Math.round(((productBase - matIsk) / Math.max(1, buildMs)) * 3_600_000) : null
  const manualTitle =
    manualNote ??
    feedTxt ??
    (running
      ? '主控亲自再加开一条线：材料立即扣除（主控手动工作位全局限 1 条，其余线须 AI 驱动）'
      : '主控亲自开一条制造线：材料立即扣除，期间不可离港作业')
  const aiTitle = feedTxt
    ? feedTxt
    : core
      ? running
        ? '接入一枚闲置 AI 核心再加开一条线（核心出库占用；完成/取消自动归还）'
        : '接入 AI 核心自动制造：材料立即扣除（核心出库占用一枚；不占主控与副船名额）'
      : '没有可用 AI 核心——先在市场购买「基础 AI 核心」（空间站直购）。'

  return (
    <div className="app-belt-card">
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={productGlyph} /> {name}
          {running ? (
            <em className="app-belt-flag is-run">
              {kindLabel === '舰船' ? '造船中' : '制造中'}
              {runs.length > 1 ? ` ×${runs.length}` : ''}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 状态徽标（已学会/蓝图书存量/声望锁/类型） */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="blueprints" id={blueprintId} />
          {owned ? (
            <span className="app-chip">已学会</span>
          ) : bookCount > 0 ? (
            <span className="app-chip">蓝图书 ×{bookCount}</span>
          ) : lock ? (
            <span className="app-chip is-exotic" title={lock}>
              ✕ {lock}
            </span>
          ) : (
            <span className="app-chip">{kindLabel}</span>
          )}
        </span>
      </div>
      <div className="app-belt-desc">{description}</div>

      <div className="app-belt-ore">
        产物：{productNode ?? <span className="app-gold">{productLabel}</span>}
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
              {onNeedMineral ? (
                (() => {
                  const srcs = refineSourcesOf(engine, need.itemId)
                  const srcName = (id: string): string => engine.ctx.items.get(id)?.name ?? id
                  return (
                    <span
                      className="app-bp-mat-act"
                      role="button"
                      tabIndex={0}
                      title={
                        srcs.length > 0
                          ? `「${matName}」由精炼炉炼出（${srcs.map(srcName).join('、')} 等）——点击跳到精炼炉该资源卡`
                          : `「${matName}」无法经精炼炉产出——点击到市场购买`
                      }
                      onClick={() => onNeedMineral?.(need.itemId)}
                    >
                      {srcs.length > 0 ? '⚒ 去精炼' : '🛒 去市场'}
                    </span>
                  )
                })()
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="app-belt-econ">
        <div>
          制造免费：只耗材料与时间
          {running && feedTxt ? <span className="app-dim">（余料不足「加开一条线」，缺口见按钮提示）</span> : null}
        </div>
        {netPerH !== null ? (
          <div
            className={`app-belt-econ-val${netPerH < 0 ? ' is-neg' : ''}`}
            title={`净收益估算：每件产物（市场现货基准价）− 每件材料（站内收价，材料学折扣后），按当前技能单件耗时折算每小时；不随市场收购波动、未计成交税。${
              netPerH < 0 ? '当前价格与技能下制造不如直接卖材料。' : '卖出给空间站按收购档（约 6~7 折），自用装配则按现货价计。'
            }`}
          >
            {MONEY_GLYPH} ≈{netPerH.toLocaleString('zh-CN')} ISK/h{netPerH < 0 ? '（净亏：直接卖材料更划算）' : '（净 · 现货价）'}
          </div>
        ) : null}
      </div>

      <div className="app-belt-actions">
        {/* 循环制造（2026-09-10 船长定：开关与目标件数**单独领出来挂在生产卡上**，不再逐线各一份）——
            作用于本卡全部制造线（含主控亲自那条），新开的线自动继承；目标件数 = 全卡合计口径 */}
        {owned || running ? (
          <div className="app-belt-loop">
            <label
              className="app-toggle"
              title={`循环制造：本卡全部制造线完成一件后自动续做同一蓝图（含主控亲自那条；劳动者/核心保持占用）；${loop.on ? '关闭后' : '打开后'}本卡在跑的线完成当前件即止`}
            >
              <input
                type="checkbox"
                className="app-toggle-input"
                checked={loop.on}
                onChange={(e) => commitLoop(e.target.checked, e.target.checked ? (goalDraft || (loop.goal > 0 ? String(loop.goal) : '')) : '')}
              />
              <span className="app-toggle-track" aria-hidden="true" />
              <span className="app-toggle-label">循环制造</span>
            </label>
            {loop.on ? (
              <span className="app-mf-goal">
                目标
                <input
                  type="number"
                  min={1}
                  className="app-mf-goal-input"
                  placeholder="∞"
                  value={goalDraft !== '' ? goalDraft : loop.goal > 0 ? String(loop.goal) : ''}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  onBlur={(e) => {
                    setGoalDraft('')
                    commitLoop(true, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setGoalDraft('')
                      commitLoop(true, (e.target as HTMLInputElement).value)
                    }
                  }}
                  title="目标件数：本卡全部制造线合计做到这么多件就停（留空 = 直到材料不足自动停）；回车/失焦生效"
                />
                件<em className="app-dim">（全卡合计）</em>
              </span>
            ) : null}
            {loop.produced > 0 ? <span className="app-mf-made">已产 {loop.produced.toLocaleString('zh-CN')} 件</span> : null}
            {loop.stopWhy.length > 0 ? <span className="app-mf-why">已停线：{loop.stopWhy}</span> : null}
            <span className="app-dim app-mf-note">
              作用于本卡全部制造线{runs.length > 0 ? `（当前 ${runs.length} 条）` : ''}
            </span>
          </div>
        ) : null}
        {/* 该蓝图逐条制造线名册（每行：劳动者 + 剩余 + 进度 + 取消）——精炼炉运转名册同款结构；
            2026-09-10 起循环开关已在卡片级，行内不再各带一份 */}
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
                  title="取消这条制造线：材料按材料学折扣后的实际用量全额退回（AI 核心自动归还），其它线不受影响"
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
              disabled={manualNote !== null || short.length > 0}
              title={manualTitle}
              onClick={() => runWith('pilot')}
            >
              手动制造
            </button>
            {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10） */}
            <div className="app-belt-ai">
              <select
                className="app-select"
                value={usableCores.length === 0 ? '' : (core ?? '')}
                onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                disabled={usableCores.length === 0}
                title={
                  usableCores.length === 0
                    ? '无可用 AI 核心：核心库为空或全部已在占用中——去市场购入「基础 AI 核心」（空间站直购），或先取消占用中的任务、训练「AI 核心操作学」/「工业自动化」扩容'
                    : '选择接入 AI 核心：一枚核心驱动一条线（驱动期间该核心被占用并计入 AI 核心启用上限——上限由 AI 核心上限技能决定，与 AI 副船任务共用）'
                }
              >
                {usableCores.length === 0 ? (
                  <option value="">无可用 AI 核心</option>
                ) : (
                  usableCores.map((t) => (
                    <option key={t} value={t}>
                      {aiCoreName(t)}（{Math.round(aiEfficiency(state, engine.ctx, t) * 100)}%）
                    </option>
                  ))
                )}
              </select>
              <button
                className="app-btn is-small"
                disabled={!core || short.length > 0}
                title={core ? aiTitle : '无可用 AI 核心：先去市场购入「基础 AI 核心」，或等占用中的核心归还'}
                onClick={() => core && runWith(core)}
              >
                AI 制造
              </button>
            </div>
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

export function ManufacturingPanel({ engine, onToast, onNeedMineral }: { engine: GameEngine; onToast: ToastFn; onNeedMineral?: (itemId: string) => void }) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTab>('all')

  /** 目录数据（舰船 + 装备统一成条目；制造中冒泡在前，再按名称） */
  const items: Array<{
    id: string
    kindLabel: string
    productGlyph: string
    name: string
    description: string
    materials: readonly MaterialNeed[]
    buildSeconds: number
    productLabel: string
    productNode: ReactNode
    running: boolean
    canStart: boolean
    productBase: number
    bookPrice: number
  }> = []
  const pushShip = (): void => {
    for (const sbp of engine.shipBlueprints) {
      const shipDef = engine.ctx.ships.get(sbp.shipId)
      const prodLabel = shipDef
        ? `${shipDef.name}（货舱 ${shipDef.cargoM3.toLocaleString('zh-CN')} m³ · ${shipDef.cycleSeconds} 秒 × ${shipDef.oreUnitsPerCycle} 单位/循环）`
        : sbp.shipId
      const prodText = <span className="app-gold">{prodLabel}</span>
      items.push({
        id: sbp.id,
        kindLabel: '舰船',
        productGlyph: shipDef?.role ?? 'blueprint',
        name: sbp.name,
        description: sbp.description,
        materials: sbp.materials,
        buildSeconds: sbp.buildSeconds,
        productLabel: prodLabel,
        // note = 船介绍（与市场舰船商品行同口径：悬浮显示舰船介绍而非默认战斗数值说明）
        productNode: shipDef ? (
          <ShipHover ship={shipDef} note={shipDef.description}>
            {prodText}
          </ShipHover>
        ) : (
          prodText
        ),
        running: runViews.some((v) => v.blueprintId === sbp.id),
        canStart: canStartNow(sbp.id, sbp.materials, sbp.buildSeconds),
        productBase: shipDef ? (productBaseOf(engine, 'ship', sbp.shipId) || shipDef.priceIsk || 0) : 0,
        bookPrice: bookPriceOf(engine, sbp.id, 0),
      })
    }
  }
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue // 弹药等物品蓝图单独分类
      const moduleDef = engine.ctx.modules.get(bp.moduleId!)
      const prodLabel = moduleDef?.name ?? bp.moduleId!
      const prodText = <span className="app-gold">{prodLabel}</span>
      items.push({
        id: bp.id,
        kindLabel: '装备',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: moduleDef ? productBaseOf(engine, 'module', bp.moduleId!) : 0,
        bookPrice: bookPriceOf(engine, bp.id, 0),
      })
    }
  }
  /** 弹药蓝图（2026-09-05：基础弹自制；产物为物品按 outputUnits 入仓） */
  const pushAmmo = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      const units = bp.outputUnits ?? 1
      const prodLabel = `${itemDef?.name ?? bp.itemId} ×${units} 发`
      const prodText = <span className="app-gold">{prodLabel}</span>
      items.push({
        id: bp.id,
        kindLabel: '弹药',
        productGlyph: itemDef?.kind ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: itemDef ? (
          <ItemHover item={itemDef} nameOf={(id) => engine.ctx.items.get(id)?.name}>
            {prodText}
          </ItemHover>
        ) : (
          prodText
        ),
        running: runViews.some((v) => v.blueprintId === bp.id),
        canStart: canStartNow(bp.id, bp.materials, bp.buildSeconds),
        productBase: itemDef ? productBaseOf(engine, 'item', bp.itemId, units) : 0,
        bookPrice: bookPriceOf(engine, bp.id, 0),
      })
    }
  }
  pushShip()
  pushEquip()
  pushAmmo()

  /** 可开工判定（与卡片按钮同口径）：已学会 + 材料足（制造费已取消；劳动者判定由卡片按钮各自表达） */
  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    if (!ownsBlueprint(state, blueprintId)) return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
  }

  const visible = items.filter(
    (it) => tab === 'all' || (tab === 'ship' ? it.kindLabel === '舰船' : tab === 'equip' ? it.kindLabel === '装备' : it.kindLabel === '弹药'),
  )
  // 2026-09-08 船长定：按「类型（装备→舰船→弹药）→ 蓝图价格（升序）」排序；无市场价沉底
  const bpP = (v: number): number => (v > 0 ? v : Number.MAX_SAFE_INTEGER)
  // 2026-09-10 船长定：已标记（收藏）的蓝图在默认排序下置顶——「全部」标签下会排在类型分组之前
  // （标签本身是筛选、不是排序键，故各处标签都按同一口径置顶）；组内保持类型→价格顺序。
  const sorted = pinMarked(
    state,
    'blueprints',
    [...visible].sort(
      (a, b) =>
        (MANU_KIND_ORDER[a.kindLabel] ?? 9) - (MANU_KIND_ORDER[b.kindLabel] ?? 9) ||
        bpP(a.bookPrice) - bpP(b.bookPrice) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN'),
    ),
    (it) => it.id,
  )
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const shipN = items.filter((i) => i.kindLabel === '舰船').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title="组装机"
      right={
        <>
          <span className="app-dim">
            制造线 {runViews.length} 条 · 装备 {equipN} · 舰船 {shipN} · 已学会 {learnedN}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      {/* 筛选与说明固定（固定头+下滚）：类型标签行/说明常显，卡网格独立内滚 */}
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
        已学会的配方才能开工，制造免费只耗材料与时间；你亲自开限 1 条、其余每条由一枚 AI 核心驱动（同一蓝图可多条、不同蓝图并行）。
      </div>

      <div className="app-win-body">
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
              productLabel={it.productLabel}
              productNode={it.productNode}
              kindLabel={it.kindLabel}
              productGlyph={it.productGlyph}
              productBase={it.productBase}
              onNeedMineral={onNeedMineral}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}
