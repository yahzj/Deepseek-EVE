import { countWare, countModule, manufacturingRunViews, missingMaterials, ownsBlueprint, recipeCapability, canStartBlueprint, sortManuRows, plugCraftUnlockedOf } from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { ItemHover, ModuleHover } from '../../ui/shipInfo'
import { pinMarked } from '../../ui/marks'
import { AiSlotText } from '../../ui/aiSlots'
import { HintIcon } from '../../ui/Hint'
import { itemGlyphName, partToneKeyOf, toneOf } from '../../ui/Glyphs'
import { ASSEMBLER_CARD_MIN_H, LazyMount, useIdleChunk } from '../../ui/LazyMount'
import { useL10n } from '../../i18n/locale'
import { BLUEPRINT_LEARN_TABS, MANU_TABS_CRAFT, SUB_ALL, manuSubsOf, moduleSubKeyOf, presentSubs, type BlueprintLearnKey, type ManuTabKey } from '../../ui/itemSubs'
import { tr } from '../../i18n/locale'
import { productBaseOf, bookPriceOf } from './blueprintValue'
import { cardLiveKeyOf } from './cardLiveKey'
import { BlueprintCard } from './BlueprintCard'
import { manufacturingBlueprintVisible } from './blueprintPolicy'

interface ManuItem {
  id: string
  kindLabel: string
  subKey: string
  productGlyph: string
  productTone?: string
  name: string
  description: string
  materials: readonly MaterialNeed[]
  buildSeconds: number
  productLabel: string
  productNode: ReactNode
  productBase: number
  countOwned: () => number
  ownedWhere: string
  bookPrice: number
  productKey: string
  productRef?: { kind: 'module' | 'ship' | 'item'; refId: string }
  productUnits?: number
  singleUse: boolean
  learnless: boolean
  partTier?: 'basic' | 'advanced'
}

export function ManufacturingPanel({
  engine,
  onToast,
  onNeedMineral,
  onGotoMarket,
  onGotoWormhole,
  onGotoPlugExchange,
  onGotoShelf,
  plugExchangeFocus,
  focusBlueprintId,
}: {
  engine: GameEngine
  onToast: ToastFn
  onNeedMineral?: (itemId: string) => void
  onGotoMarket?: (goodKey: string) => void
  onGotoWormhole?: () => void
  onGotoPlugExchange?: () => void
  onGotoShelf?: (blueprintId: string) => void
  plugExchangeFocus?: number
  focusBlueprintId?: string | null
}) {
  const state = engine.state
  const runViews = manufacturingRunViews(state, engine.ctx)
  const [tab, setTab] = useState<ManuTabKey>('all')
  const EAGER_FIRST = 12
  const idleChunk = useIdleChunk(12)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [cardH, setCardH] = useState(ASSEMBLER_CARD_MIN_H)
  useEffect(() => {
    const g = gridRef.current
    if (g === null) return
    const hs = [...g.querySelectorAll<HTMLElement>('.app-belt-card')]
      .map((el) => Math.round(el.getBoundingClientRect().height))
      .filter((h) => h > 80)
    if (hs.length < 4) return
    hs.sort((a, b) => a - b)
    const med = hs[Math.floor(hs.length / 2)] ?? ASSEMBLER_CARD_MIN_H
    setCardH((prev) => (Math.abs(prev - med) >= 8 ? med : prev))
  }, [idleChunk])
  useL10n()
  const [learn, setLearn] = useState<BlueprintLearnKey>(SUB_ALL)
  const [kw, setKw] = useState('')
  const kq = kw.trim().toLowerCase()
  const [sub, setSub] = useState<string>(SUB_ALL)
  const [craftableOnly, setCraftableOnly] = useState(false)
  useEffect(() => {
    if (!focusBlueprintId) return
    setTab('all')
    setSub(SUB_ALL)
    setLearn(SUB_ALL)
  }, [focusBlueprintId])

  useEffect(() => {
    if (!plugExchangeFocus) return
    if (!plugCraftUnlockedOf(engine.state)) return
    setTab('plug')
    setSub(SUB_ALL)
  }, [plugExchangeFocus, engine])

  const items = useMemo<ManuItem[]>(() => {
    const out: ManuItem[] = []
  const pushEquip = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId !== undefined) continue
      const moduleDef = engine.ctx.modules.get(bp.moduleId!)
      const prodLabel = moduleDef?.name ?? bp.moduleId!
      const prodText = <span className="app-gold">{prodLabel}</span>
      const moduleId = bp.moduleId!
      const isPlugBp = moduleDef?.slot === 'plug'
      out.push({
        id: bp.id,
        kindLabel: isPlugBp ? '舰船插件' : tr('ui.MarketPage.003'),
        subKey: isPlugBp ? '' : moduleDef ? moduleSubKeyOf(moduleDef.slot, moduleDef.id) : '',
        productGlyph: moduleDef?.slot ?? 'blueprint',
        name: bp.name,
        description: bp.description,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
        productLabel: prodLabel,
        productNode: moduleDef ? <ModuleHover mod={moduleDef}>{prodText}</ModuleHover> : prodText,
        productBase: moduleDef ? productBaseOf(engine, 'module', moduleId) : 0,
        productRef: { kind: 'module' as const, refId: moduleId },
        countOwned: () => countModule(engine.state, moduleId),
        ownedWhere: tr("ui.Industry.004"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `module:${moduleId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  const pushSupply = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind === 'part') continue
      const units = bp.outputUnits ?? 1
      const prodName = itemDef?.name ?? bp.itemId
      const prodLabel = tr("ui.Industry.120", { prodName: prodName, units: units })
      const unitTail = tr("ui.Industry.120", { prodName: '', units: units })
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {unitTail}
        </>
      )
      const itemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: tr("ui.MarketPage.007"),
        subKey: itemDef?.kind ?? '',
        productGlyph: itemGlyphName(itemDef?.id, itemDef?.kind ?? 'blueprint'),
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
        productBase: itemDef ? productBaseOf(engine, 'item', itemId, units) : 0,
        productRef: { kind: 'item' as const, refId: itemId },
        productUnits: units,
        countOwned: () => countWare(engine.state, itemId),
        ownedWhere: tr("ui.ItemsPage.001"),
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${itemId}`,
        singleUse: bp.singleUse === true,
        learnless: false,
      })
    }
  }
  const pushPart = (): void => {
    for (const bp of engine.blueprints) {
      if (bp.itemId === undefined) continue
      const itemDef = engine.ctx.items.get(bp.itemId)
      if (itemDef?.kind !== 'part') continue
      const prodName = itemDef?.name ?? bp.itemId
      const units = bp.outputUnits ?? 1
      const prodLabel = tr('ui.Industry.152', { prodName: prodName, units: units })
      const prodText = (
        <>
          <span className="app-gold">{prodName}</span>
          {tr('ui.Industry.153', { units: units })}
        </>
      )
      const partItemId = bp.itemId
      out.push({
        id: bp.id,
        kindLabel: '零件',
        subKey: bp.partTier ? `part-${bp.partTier}` : '',
        productGlyph: 'part',
        productTone: toneOf(partToneKeyOf(itemDef.id)),
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
        productBase: itemDef ? productBaseOf(engine, 'item', partItemId, bp.outputUnits ?? 1) : 0,
        productRef: { kind: 'item' as const, refId: partItemId },
        productUnits: units,
        countOwned: () => countWare(engine.state, partItemId),
        ownedWhere: '仓库',
        bookPrice: bookPriceOf(engine, bp.id, 0),
        productKey: `item:${partItemId}`,
        singleUse: bp.singleUse === true,
        learnless: bp.learnless === true,
        partTier: bp.partTier,
      })
    }
  }
  pushEquip()
  pushPart()
  pushSupply()
    return out
  }, [engine.ctx, engine.blueprints])

  const inTab = (kindLabel: string): boolean =>
    tab === 'all' || cardTabOf(kindLabel) === tab
  const cardTabOf = (kindLabel: string): ManuTabKey => {
    if (kindLabel === '舰船插件') return 'plug'
    if (kindLabel === '零件') return 'part'
    if (kindLabel === '消耗品') return 'supply'
    if (kindLabel === '舰船') return 'ship'
    return 'equip'
  }
  const availableItems = items.filter(it => manufacturingBlueprintVisible(state, engine.ctx, it.id))
  const subOptions = presentSubs(manuSubsOf(tab), (key) => availableItems.some((it) => inTab(it.kindLabel) && it.subKey === key))

  function canStartNow(blueprintId: string, materials: readonly MaterialNeed[], buildSeconds: number): boolean {
    const su = engine.ctx.blueprints.get(blueprintId)?.singleUse === true
      || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
    if (engine.ctx.blueprints.get(blueprintId)?.learnless === true) {
      return canStartBlueprint(state, engine.ctx, blueprintId) && missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }, blueprintId).length === 0
    }
    if (!ownsBlueprint(state, blueprintId) && recipeCapability(state, blueprintId, su).kind !== 'ok') return false
    return missingMaterials(state, engine.ctx, { materials, buildSeconds, buildCostIsk: 0 }, blueprintId).length === 0
  }

  const visible = availableItems
    .filter((it) => {
      if (kq.length === 0) return true
      if (it.name.toLowerCase().includes(kq)) return true
      if (it.productLabel.toLowerCase().includes(kq)) return true
      if ((it.description ?? '').toLowerCase().includes(kq)) return true
      if (it.kindLabel.toLowerCase().includes(kq)) return true
      return it.materials.some((m) => (engine.ctx.items.get(m.itemId)?.name ?? m.itemId).toLowerCase().includes(kq))
    })
    .filter((it) => {
      if (learn === SUB_ALL) return true
      const learned = it.learnless || ownsBlueprint(state, it.id)
      if (learn === 'learned') return learned
      if (learn === 'unlearned') return !learned
      return !learned && it.singleUse
    })
    .filter((it) => inTab(it.kindLabel))
    .filter((it) => sub === SUB_ALL || it.subKey === sub)
    .filter((it) => !craftableOnly || canStartNow(it.id, it.materials, it.buildSeconds))
  const sorted = pinMarked(state, 'blueprints', sortManuRows(visible), (it) => it.id)
  const filterActive = kq.length > 0 || learn !== SUB_ALL || sub !== SUB_ALL || craftableOnly
  const runSigByBp = new Map<string, string>()
  for (const v of runViews) {
    if (v.blueprintId === null) continue
    runSigByBp.set(v.blueprintId, `${runSigByBp.get(v.blueprintId) ?? ''}${v.id}.${Math.round(v.remainingMs / 1000)}.${Math.round(v.percent)}.${v.worker ?? '-'}|`)
  }
  const liveKeyOf = (it: (typeof items)[number]): string =>
    cardLiveKeyOf(engine, it.id, it.materials, runSigByBp.get(it.id) ?? '', it.countOwned())
  const equipN = items.filter((i) => i.kindLabel === '装备').length
  const partN = items.filter((i) => i.kindLabel === '零件').length
  const supplyN = items.filter((i) => i.kindLabel === '消耗品').length
  const learnedN = items.filter((i) => ownsBlueprint(state, i.id)).length

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.IndustryPage.059")}
      hint={
        // 常驻说明收进标题后的圆形感叹号（2026-09-13 船长口径）；2026-09-14 船长点名："组装机的说明并没有隐藏"
        <HintIcon tip={tr('ui.Industry.150')} />
      }
      right={
        <>
          {/* 搜索栏（船长 2026-09-19）：与精炼炉、物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
          <span className="app-head-search-wrap">
            <input
              className="app-head-search"
              type="text"
              placeholder={tr("ui.Industry.128")}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              spellCheck={false}
            />
          </span>
          <span className="app-dim">
            {/**
             * **两条读数合并成一条**（**2026-09-26 船长令**：「优化工业界面」→ 采纳"删2／优1"）。
             *
             * 原先这里**同时**显示两组数：
             * - `ui.Industry.156` 的分项汇总（制造线 / 装备 / 零件 / 消耗品 / 已学会）——**全目录**口径；
             * - 紧接着 `ui.Industry.127` 的「当前 N 张」——**筛完**口径。
             * 未筛选时两者里的"总数"是同一个数，连读两遍才知道哪个是筛后的 ⇒ 现在**二选一**：
             * - **筛选/搜索生效** ⇒ 只报「当前 N 张」（玩家此刻要知道的就是"筛剩多少"）；
             * - **没筛选** ⇒ 只报分项汇总（此刻要知道的是"池子里都有什么"）。
             */}
            {filterActive
              ? tr('ui.Industry.127', { n: sorted.length })
              : tr('ui.Industry.156', {
                  p1: runViews.length,
                  p2: equipN,
                  p3: partN,
                  p4: supplyN,
                  p5: learnedN,
                })}
          </span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      {/* 筛选固定、说明进标题后的圆形感叹号（固定头+下滚）：各筛选行常驻，卡网格独立内滚。
          ⚠ 行序（2026-09-19 丙组）：**学会（并列属性）+ 门类（一级）同排一行 → 子类（二级）→ 图纸（三级）**；
          胶囊行一律「全部」+ 同行灰字前缀（基线①）。
          ⚠ **学会与门类同排**（船长 2026-09-19：「建议和门类放在同一行。除非宽度不够才另外起一行」）——
          `.app-fleet-row` 自带 `flex-wrap: wrap`，窗口窄时门类那组会自动折到下一行，无需另写断点。 */}
      {/* 筛选区（整块外面加 `.app-filter-block` = 与内容之间的**虚线分隔**；背景线不占布局 ⇒ 高宽不变，
          船长 2026-09-19） */}
      <div className="app-filter-block">
      <div className="app-fleet-row">
        <span className="app-dim">{tr('ui.Industry.136')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {BLUEPRINT_LEARN_TABS.map((l) => (
            <button
              key={l.key}
              role="tab"
              aria-selected={learn === l.key}
              className={`app-tasktab${learn === l.key ? ' is-active' : ''}`}
              onClick={() => setLearn(l.key)}
            >
              {tr(l.id)}
            </button>
          ))}
        </div>
        <span className="app-dim">{tr('ui.Industry.134')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          {/**
           * **「舰船插件」档在取得第一个黑匣前整档不出现**（**2026-09-26 船长令**：
           * 「**组装机，门类：舰船插件筛选项不可用时，隐藏该选项**」）。
           *
           * 判据走 core 单点 `plugCraftUnlockedOf`（= 见过黑匣；与"解锁组装机插件选项"同一条令）。
           * ⚠ **沿革（本轮改判）**：先前是"标签仍在但置灰不可点 ＋ 悬停写原因"（当时的理由是
           * "让玩家知道有这一档"）⇒ 船长令改为**直接隐藏**：不可用的筛选项不该占位。
           * 因此 `disabled` / 锁定悬停 / 那条 `ui.IndustryPage.117` 提示在本处一并撤掉
           * （该 id 仍被章鱼人兑换窗口的未解锁态使用，不是死条目）。
           * ⚠ **筛选合并批（二号，同日晚）**：本行原先那句 `setUseKind(SUB_ALL)` 随第三级「图纸」筛选
           * **整维删除**而去掉（"一次性/永久"那一轴已并进上面的「蓝图」维度）。
           */}
          {MANU_TABS_CRAFT.filter((t) => t.key !== 'plug' || plugCraftUnlockedOf(engine.state)).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setSub(SUB_ALL) // 换一级标签即回「全部子类」（与市场页 changeKind 同款）
              }}
            >
              {tr(t.id)}
            </button>
          ))}
        </div>
        {/**
         * **「仅看可造」开关**（**2026-09-26 船长令**：优化工业界面）——与「学会」同排、贴在门类之后。
         *
         * 为什么放这一排而不是新起一行：它与「学会」同性质（**并列的布尔收窄**，不是层级维度），
         * 且 `.app-fleet-row` 自带 `flex-wrap`（窗口窄了自动折行，不必另写断点）⇒ 不新增行高。
         * 落款走既有胶囊样式（`.app-tasktab` ＋ `is-active`），与两个筛选行**同一套观感**。
         */}
        <span className="app-dim">{tr('ui.IndustryPage.127')}</span>
        <div className="app-task-tabs app-fleet-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={craftableOnly}
            className={`app-tasktab${craftableOnly ? ' is-active' : ''}`}
            title={tr('ui.IndustryPage.128')}
            onClick={() => setCraftableOnly((v) => !v)}
          >
            {tr('ui.IndustryPage.129')}
          </button>
        </div>
      </div>
      {/* 二级子筛选（2026-09-11 船长：按产物的类型二次分类 / 舰船按舰船级别）——
          复刻舰船页「舰队筛选」那套次级标签样式（app-task-tabs + app-fleet-tabs 去下边框 + app-tasktab 胶囊）；
          「全部」标签不带子筛选（与市场「全部类型」同款）；文案 = 裸「全部」+ 同行前缀（基线①） */}
      {subOptions.length > 0 ? (
        <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.Industry.129')}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sub === SUB_ALL}
              className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
              onClick={() => setSub(SUB_ALL)}
            >
              {tr('ui.IndustryPage.001')}
            </button>
            {subOptions.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sub === s.key}
                className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                onClick={() => setSub(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      </div>
      <div className="app-win-body">
        <div className="app-belt-grid" ref={gridRef}>
          {sorted.map((it, i) => (
            /**
             * **视口懒挂载**（**2026-09-27 船长令**：「**组装机的卡片太多了，能否采用流式加载？当卡片靠近玩家
             * 屏幕时才加载**」；方案获船长「**按你推荐来**」确认）。三档 eager：
             * ① **首屏块 `EAGER_FIRST` 张**立刻挂（进页先有一屏半真卡，不会一进来就一片空白）；
             * ② **空闲补块 `EAGER_IDLE` 张**（`useIdleChunk`）——滚得快时少看见空白；
             * ③ **被跳转定位的那一张**必须立刻挂（页面那条 `.app-belt-card.is-goto` 居中滚动要能 querySelector 到节点）。
             * 其余交给 `LazyMount` 的 IntersectionObserver（视口上下各 1 屏）。
             */
            <LazyMount
              key={it.id}
              eager={i < EAGER_FIRST + idleChunk || focusBlueprintId === it.id}
              minHeight={cardH}
            >
              <BlueprintCard
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
                productRef={it.productRef}
                productUnits={it.productUnits}
                productGlyph={it.productGlyph}
                productTone={it.productTone}
                productBase={it.productBase}
                countOwned={it.countOwned}
                ownedWhere={it.ownedWhere}
                onNeedMineral={onNeedMineral}
                onGotoMarket={onGotoMarket}
                onGotoWormhole={onGotoWormhole}
                onGotoPlugExchange={onGotoPlugExchange}
                onGotoShelf={onGotoShelf}
                highlighted={focusBlueprintId === it.id}
                learnless={it.learnless}
                /** 实时指纹：只有它变了的卡才会真正重渲染（详见 `cardLiveKeyOf` 的说明） */
                liveKey={liveKeyOf(it)}
              />
            </LazyMount>
          ))}
        </div>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">{tr("ui.Industry.093")}</div>
        ) : null}
      </div>
    </Panel>
  )
}
