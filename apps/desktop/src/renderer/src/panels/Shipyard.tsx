/**
 * 造船厂面板（2026-09-20 船长「将组装机内容拆分，舰船蓝图部分单独拆除。新增一个组装机同级页面：造船厂」）。
 *
 * 从 `panels/Industry.tsx` 的 ManufacturingPanel 迁出的舰船蓝图渲染：
 * - 复用同一张 `BlueprintCard`（劳动者制 / 开工 / 一次性与永久 / 求购跳市场完全同款）；
 * - 筛选：舰船级别（T1~T5）二级 + 一次性/永久三级 + 「学会」维度 + 搜索栏（与组装机同款口径）；
 * - 引擎零改动（`manufacturingRuns` 本就支持舰船蓝图）。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@whale/ui'
import type { GameState, MaterialNeed } from '@whale/core'
import {
  manufacturingRunViews,
  ownsBlueprint,
  recipeCapability,
  shipOwnedCount,
  sortManuRows,
  countWare,
} from '@whale/core'
import { missingMaterials } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipHover } from '../ui/shipInfo'
import { MarkStar, pinMarked } from '../ui/marks'
import { AiSlotText } from '../ui/aiSlots'
import { HintIcon } from '../ui/Hint'
import { useL10n } from '../i18n/locale'
import {
  BLUEPRINT_LEARN_TABS,
  BLUEPRINT_USE_TABS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  presentSubs,
  type BlueprintLearnKey,
  type BlueprintUseKey, subText } from '../ui/itemSubs'
import { BlueprintCard, bookPriceOf, productBaseOf } from './Industry'

interface ShipItem {
  id: string
  kindLabel: string
  subKey: string
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
  ownedCount: number
  ownedWhere: string
  bookPrice: number
  productKey: string
  singleUse: boolean
  learnless: boolean
}

export function ShipyardPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  onGotoMarket?: (goodKey: string) => void
  onGotoWormhole?: () => void
  /** 蓝图书架「去造船厂」的定位目标（蓝图 id）：先清掉筛选再高亮那张卡 */
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const { t } = useL10n()
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [useKind, setUseKind] = useState<BlueprintUseKey>(SUB_ALL)
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()

  useEffect(() => {
    if (!focusBlueprintId) return
    setSub(SUB_ALL)
    setUseKind(SUB_ALL)
  }, [focusBlueprintId])

  /** 该船型的总持有（舰船仓库 + 在役舰队；与旧组装机口径同源） */
  const shipStockOf = (shipId: string): number => shipOwnedCount(state, shipId)

  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
  }

  const items: ShipItem[] = []
  for (const sbp of engine.shipBlueprints) {
    const shipDef = engine.ctx.ships.get(sbp.shipId)
    const prodName = shipDef?.name ?? sbp.shipId
    /** 产物名后的参数（货舱/循环）：不上色（2026-09-13 船长口径） */
    const prodParams = shipDef
      ? `（货舱 ${shipDef.cargoM3.toLocaleString('zh-CN')} m³ · ${shipDef.cycleSeconds} 秒 × ${shipDef.oreUnitsPerCycle} 单位/循环）`
      : ''
    const prodLabel = prodName + prodParams
    // 产物名一律金色（2026-09-13 船长）
    const prodText = <span className="app-gold">{prodName}</span>
    items.push({
      id: sbp.id,
      kindLabel: '舰船',
      // 舰船蓝图按舰船级别分档（键与 itemSubs.SHIP_TIER_SUBS 同源）
      subKey: shipDef ? `t${shipDef.tier}` : '',
      productGlyph: shipDef?.role ?? 'blueprint',
      name: sbp.name,
      description: sbp.description,
      materials: sbp.materials,
      buildSeconds: sbp.buildSeconds,
      productLabel: prodLabel,
      productNode: shipDef ? (
        <ShipHover ship={shipDef} note={shipDef.description}>
          {prodText}
          {prodParams}
        </ShipHover>
      ) : (
        <>
          {prodText}
          {prodParams}
        </>
      ),
      running: runViews.some((v) => v.blueprintId === sbp.id),
      canStart: canStartNow(sbp.id, sbp.materials, sbp.buildSeconds),
      productBase: shipDef ? (productBaseOf(engine, 'ship', sbp.shipId) || shipDef.priceIsk || 0) : 0,
      ownedCount: shipStockOf(sbp.shipId),
      ownedWhere: '仓库＋机库',
      bookPrice: bookPriceOf(engine, sbp.id, 0),
      productKey: `ship:${sbp.shipId}`,
      singleUse: sbp.singleUse === true,
      learnless: false,
    })
  }

  /** 2026-09-20 筛选清理（船长「明显不存在的子类筛选隐藏」）：只列真有内容的档 —— 与组装机同一套 `presentSubs` 口径 */
  const tierShown = presentSubs(SHIP_TIER_SUBS, (key) => items.some((it) => it.subKey === key))
  const usesShown = presentSubs(BLUEPRINT_USE_TABS, (key) =>
    items.some((it) => (sub === SUB_ALL || it.subKey === sub) && (key === 'single' ? it.singleUse : !it.singleUse)),
  )

  const visible = items
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    .filter(
      (it) =>
        learn === SUB_ALL ||
        (learn === 'learned' ? ownsBlueprint(state, it.id) : !ownsBlueprint(state, it.id)),
    )
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    .filter((it) => useKind === SUB_ALL || (useKind === 'single' ? it.singleUse : !it.singleUse))
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={t('ui.IndustryPage.114')}
      hint={
        <HintIcon tip={t('ui.IndustryPage.115')} />
      }
      right={
        <>
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={t('ui.Shipyard.001')}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              spellCheck={false}
            />
          </span>
          <span className="app-dim">
            制造线 {runViews.filter((v) => items.some((i) => i.id === v.blueprintId)).length} 条 · 舰船 {items.length} · 已学会 {learnedN}
            {kq.length > 0
              ? ` · 匹配 ${sorted.length} 张`
              : learn !== SUB_ALL || sub !== SUB_ALL || useKind !== SUB_ALL
                ? ` · 当前 ${sorted.length} 张`
                : ''}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-filter-block">
        <div className="app-fleet-row">
          <span className="app-dim">学会：</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {BLUEPRINT_LEARN_TABS.map((l) => (
              <button
                key={l.key}
                role="tab"
                aria-selected={learn === l.key}
                className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
                onClick={() => setLearn(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {/* 二级子筛选 = 舰船级别（与组装机旧「舰船蓝图」子筛选同一张单点表） */}
        <div className="app-fleet-row">
          <span className="app-dim">子类：</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => {
                setSub(SUB_ALL)
                setUseKind(SUB_ALL)
              }}
            >
              全部
            </button>
            {tierShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => {
                  setSub(s.key)
                  setUseKind(SUB_ALL)
                }}
              >
                {subText(s)}
              </button>
            ))}
          </div>
        </div>
        {/* 三级筛选：一次性 / 永久（选了子类才出现，与组装机同款） */}
        {/* 2026-09-20 筛选清理：只剩「全部」一项时整行隐藏 */}
        {sub !== SUB_ALL && usesShown.length > 1 ? (
          <div className="app-fleet-row">
            <span className="app-dim">图纸：</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              {usesShown.map((u) => (
                <button
                  key={u.key}
                  role="tab"
                  aria-selected={useKind === u.key}
                  className={`app-tasktab${useKind === u.key ? ' is-active' : ''}`}
                  onClick={() => setUseKind(u.key)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
              kindLabel="舰船"
              productGlyph={it.productGlyph}
              productBase={it.productBase}
              ownedCount={it.ownedCount}
              ownedWhere={it.ownedWhere}
              onNeedMineral={onNeedMineral}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={onGotoWormhole}
              highlighted={focusBlueprintId === it.id}
            />
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">该筛选下暂无舰船蓝图——换个分类、或把「全部子类 / 全部图纸」点回来看看。</div>
        ) : null}
      </div>
    </Panel>
  )
}
