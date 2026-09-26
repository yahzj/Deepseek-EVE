/**
 * 造船厂面板（2026-09-20 船长「将组装机内容拆分，舰船蓝图部分单独拆除。新增一个组装机同级页面：造船厂」）。
 *
 * 从 `panels/Industry.tsx` 的 ManufacturingPanel 迁出的舰船蓝图渲染：
 * - 复用同一张 `BlueprintCard`（劳动者制 / 开工 / 一次性与永久 / 求购跳市场完全同款）；
 * - 筛选三行（**2026-09-26 船长令**）：「**蓝图**」（原「学会」行；一次性那一轴并入它，原「图纸」行删除）
 *   · 「**类别**」（`SHIP_SUBS`，与手册舰船图鉴、我的舰队同一把尺）· 「**子类**」（舰船级别 T1~T5）
 *   ＋ 搜索栏；
 * - 引擎零改动（`manufacturingRuns` 本就支持舰船蓝图）。
 */
import { useEffect, useMemo, useState } from 'react'
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
  SHIP_SUBS,
  SHIP_TIER_SUBS,
  SUB_ALL,
  presentSubs,
  shipRolePasses,
  subText,
  type BlueprintLearnKey,
} from '../ui/itemSubs'
import { BlueprintCard, bookPriceOf, cardLiveKeyOf, productBaseOf } from './Industry'

/**
 * 造船厂目录条目（2026-09-22 工业页卡顿修复第 3 步）。
 * ⚠ 与组装机同规矩：**只放"目录级"字段**，随心跳变的实时数一律不进模型（否则 `useMemo` 每拍失效、
 * 卡片 `memo` 击穿）；实时数走 `cardLiveKeyOf` 指纹 + 卡片自己现取。
 */
interface ShipItem {
  id: string
  kindLabel: string
  subKey: string
  /** 该蓝图产出的船型 id：**类别**与**级别**两维的判据都按它现取船型定义（`shipRolePasses`） */
  shipId: string
  productGlyph: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode: ReactNode
  productBase: number
  /** 产物引用（2026-09-23 船长令：舰船产物**只显示市场当前价格**） */
  productRef: { kind: 'ship' | 'module' | 'item'; refId: string }
  /** 舰船"自己有多少"的取数闭包（仓库 ＋ 在役舰队；数值每次现取） */
  countOwned: () => number
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
  /** 「**子类**」维度 = 舰船级别（键 `t<级别>`；与组装机旧「舰船蓝图」子筛选同一张单点表） */
  const [sub, setSub] = useState<string>(SUB_ALL)
  /**
   * 「**类别**」维度（**2026-09-26 船长令**：「**将手册舰船图鉴的类别插入造船厂子类上一级**」）：
   * 键取单一表 `SHIP_SUBS`、判据走唯一入口 `shipRolePasses`（= core `shipCategoryKeyOf`），
   * 与手册舰船图鉴、我的舰队、虫洞编队同一把尺。
   * ⚠ 与「子类」**互不重置**：两维各自独立、与其它条件取「与」（2026-09-12 船长在舰队页定的口径）。
   */
  const [cat, setCat] = useState<string>(SUB_ALL)
  /**
   * 「**蓝图**」维度（原「学会」行。**2026-09-26 船长令**：「**将造船的一次性蓝图筛选移动到学会的
   * 筛选内，并将学会的筛选改名为蓝图。删除原先的图纸筛选**」）：四档把"学没学会"与"是不是一次性"
   * 两轴合成一条按钮，原第三行「图纸」筛选随之删除（与组装机同一张 `BLUEPRINT_LEARN_TABS`）。
   */
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()

  useEffect(() => {
    if (!focusBlueprintId) return
    setSub(SUB_ALL)
    setCat(SUB_ALL)
    setLearn(SUB_ALL)
  }, [focusBlueprintId])

  /** 该船型的总持有（舰船仓库 + 在役舰队；与旧组装机口径同源） */
  const shipStockOf = (shipId: string): number => shipOwnedCount(state, shipId)

  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }).length === 0
  }

  const items = useMemo<ShipItem[]>(() => {
    const out: ShipItem[] = []
    for (const sbp of engine.shipBlueprints) {
      const shipDef = engine.ctx.ships.get(sbp.shipId)
      const prodName = shipDef?.name ?? sbp.shipId
      /**
       * **2026-09-23 船长令**：「造船厂那，**不要显示舰船的括号内属性**，应该在行情价格后面显示（利润率%）」
       * ⇒ 产物标签只留船名（旧的「（货舱 N m³ · M 秒 × K 单位/循环）」**不再进产物行**；
       * 那些参数仍在产物名的悬停卡（`ShipHover`）里可查，信息没丢，只是不占卡面）。
       */
      const prodLabel = prodName
      /** 产物名后的参数（货舱/循环）——**只进悬停卡**（2026-09-23 船长令：卡面上的括号属性去掉） */
      const prodParams = shipDef
        ? `（货舱 ${shipDef.cargoM3.toLocaleString('zh-CN')} m³ · ${shipDef.cycleSeconds} 秒 × ${shipDef.oreUnitsPerCycle} 单位/循环）`
        : ''
      // 产物名一律金色（2026-09-13 船长）
      const prodText = <span className="app-gold">{prodName}</span>
      const shipId = sbp.shipId
      out.push({
        id: sbp.id,
        kindLabel: '舰船', // l10n-keep：内容层联合 key（渲染处走 Industry 的 kindLabelText）
        // 舰船蓝图按舰船级别分档（键与 itemSubs.SHIP_TIER_SUBS 同源）
        subKey: shipDef ? `t${shipDef.tier}` : '',
        shipId,
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
        productBase: shipDef ? (productBaseOf(engine, 'ship', shipId) || shipDef.priceIsk || 0) : 0,
        /** 造船厂卡的产物读数（2026-09-23 船长令）：舰船 ⇒ **只显示市场当前价格** */
        productRef: { kind: 'ship' as const, refId: shipId },
        countOwned: () => shipOwnedCount(engine.state, shipId),
        ownedWhere: '仓库＋机库', // l10n-keep：内容层联合 key（渲染处走 Industry 的 ownedWhereText）
        bookPrice: bookPriceOf(engine, sbp.id, 0),
        productKey: `ship:${shipId}`,
        singleUse: sbp.singleUse === true,
        learnless: false,
      })
    }
    return out
  }, [engine.ctx, engine.shipBlueprints])

  /** 2026-09-20 筛选清理（船长「明显不存在的子类筛选隐藏」）：只列真有内容的档 —— 与组装机同一套 `presentSubs` 口径 */
  const tierShown = presentSubs(SHIP_TIER_SUBS, (key) => items.some((it) => it.subKey === key))
  /** 类别候选（同一套 `presentSubs` 口径；判据 = 唯一入口 `shipRolePasses`，船型定义按 id 现取） */
  const catShown = presentSubs(SHIP_SUBS, (key) =>
    items.some((it) => shipRolePasses(engine.ctx.ships.get(it.shipId), key)),
  )

  const visible = items
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    /**
     * 「**蓝图**」维度（原「学会」＋ 原三级「图纸」合并，2026-09-26 船长令）：四档各自判，
     * 学会那一轴 × 是不是一次性那一轴。⚠ 舰船蓝图没有"隐式蓝图"（那是零件体系的事）
     * ⇒ 这里不带上组装机那句 `learnless` 判定。
     */
    .filter((it) => {
      if (learn === SUB_ALL) return true
      const learned = ownsBlueprint(state, it.id)
      if (learn === 'learned') return learned
      if (learn === 'unlearned') return !learned
      if (learn === 'learned-single') return learned && it.singleUse
      return !learned && it.singleUse // 'unlearned-single'
    })
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    .filter((it) => shipRolePasses(engine.ctx.ships.get(it.shipId), cat))
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  /** 每张卡的实时指纹（心跳只让指纹变了的卡重渲染；制造线先按蓝图归并一遍，O(线)） */
  const runSigByBp = new Map<string, string>()
  for (const v of runViews) {
    if (v.blueprintId === null) continue
    runSigByBp.set(v.blueprintId, `${runSigByBp.get(v.blueprintId) ?? ''}${v.id}.${Math.round(v.remainingMs / 1000)}.${Math.round(v.percent)}.${v.worker ?? '-'}|`)
  }
  const liveKeyOf = (it: ShipItem): string =>
    cardLiveKeyOf(engine, it.id, it.materials, runSigByBp.get(it.id) ?? '', it.countOwned())
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
            {t('ui.Shipyard.005', {
              p1: runViews.filter((v) => items.some((i) => i.id === v.blueprintId)).length,
              p2: items.length,
              p3: learnedN,
            })}
            {kq.length > 0
              ? t('ui.IndustryPage.108', { n: sorted.length })
              : learn !== SUB_ALL || cat !== SUB_ALL || sub !== SUB_ALL
                ? t('ui.Industry.127', { n: sorted.length })
                : ''}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-filter-block">
        {/* 第 1 行「蓝图」＝原「学会」行（2026-09-26 船长令改名，并把原第 3 行「图纸」的两档并进来） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.Industry.136')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            {BLUEPRINT_LEARN_TABS.map((l) => (
              <button
                key={l.key}
                role="tab"
                aria-selected={learn === l.key}
                className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
                onClick={() => setLearn(l.key)}
              >
                {/* ⚠ 筛选档一律走 `subText`（有 id 取当前语言）；直接写 `l.label` 会在英文界面漏中文 */}
                {subText(l)}
              </button>
            ))}
          </div>
        </div>
        {/* 第 2 行「类别」＝手册舰船图鉴那一维，插在「子类」上一级（2026-09-26 船长令） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.ShipPage.004')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={cat === SUB_ALL}
              className={`app-tasktab${cat === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setCat(SUB_ALL)}
            >
              {t('ui.IndustryPage.001')}
            </button>
            {catShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={cat === s.key}
                className={`app-tasktab${cat === s.key ? ' is-active' : ''}`}
                onClick={() => setCat(s.key)}
              >
                {subText(s)}
              </button>
            ))}
          </div>
        </div>
        {/* 第 3 行「子类」＝舰船级别（与组装机旧「舰船蓝图」子筛选同一张单点表） */}
        <div className="app-fleet-row">
          <span className="app-dim">{t('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setSub(SUB_ALL)}
            >
              {t('ui.IndustryPage.001')}
            </button>
            {tierShown.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => setSub(s.key)}
              >
                {subText(s)}
              </button>
            ))}
          </div>
        </div>
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
              kindLabel="舰船" /* l10n-keep：内容层联合 key（渲染处走 Industry 的 kindLabelText） */
              productGlyph={it.productGlyph}
              productBase={it.productBase}
              productRef={it.productRef}
              countOwned={it.countOwned}
              ownedWhere={it.ownedWhere}
              onNeedMineral={onNeedMineral}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={onGotoWormhole}
              highlighted={focusBlueprintId === it.id}
              liveKey={liveKeyOf(it)}
            />
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{t('ui.Shipyard.006')}</div>
        ) : null}
      </div>
    </Panel>
  )
}
